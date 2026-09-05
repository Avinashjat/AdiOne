/**
 * Store, serviceability, opening hours and ETA.
 *
 * THE BACKEND IS THE AUTHORITY. The mobile app may call
 * `checkServiceability` from the shared package to render "3.2 km away", but
 * every decision that gates an order is made here and re-made at order
 * creation. A client's answer is display, never permission.
 *
 * `MAX_SERVICE_RADIUS_KM` is read from Configuration on every evaluation, so
 * changing the radius in the admin panel takes effect without a redeploy and
 * without a literal `10` anywhere in this file.
 */

import { ConfigKey, ErrorCode, type ServiceabilityResult, type StoreDto } from '../../shared';
import {
  calculateDistance,
  checkServiceability as checkServiceabilityPure,
  estimateDeliveryTime,
  isValidCoordinates,
  resolveDeliveryFeePaise,
  toRoadDistanceKm,
  type EtaResult,
} from '../../shared/distance';
import {
  formatTime12h,
  getZonedParts,
  isWithinWindow,
  minutesSinceMidnight,
  parseTimeToMinutes,
} from '../../shared/datetime';
import { AppError } from '../../common/errors';
import * as configService from '../configuration/configuration.service';
import * as repository from './store.repository';
import type { StoreWithHours } from './store.repository';

export type { StoreWithHours };

/* -------------------------------------------------------------------------- */
/* Store resolution                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the store this deployment serves.
 *
 * "Active" here means "the store row that exists", not "currently trading" —
 * a paused store must still resolve so the catalog loads and the owner can
 * un-pause it. Whether it is *open* is `getStoreOpenState`; whether it will
 * take an order is `assertStoreAcceptingOrders`.
 */
export async function getActiveStore(): Promise<StoreWithHours> {
  const store = await repository.findStore();
  if (!store) {
    // Not a 404: from the customer's perspective the shop is simply not
    // trading, which is a service-availability condition.
    throw new AppError(ErrorCode.STORE_INACTIVE, {
      internalMessage: 'no store row exists — has the seed been run?',
    });
  }
  return store;
}

/* -------------------------------------------------------------------------- */
/* Task 3.3 — opening hours                                                   */
/* -------------------------------------------------------------------------- */

export interface StoreOpenState {
  /** False whenever the store is paused, closed for the day, or out of hours. */
  isOpen: boolean;
  /** Today's window in local time, null when closed all day. */
  todayOpensAt: string | null;
  todayClosesAt: string | null;
  /** Human-readable next opening, for the Store Closed screen. */
  nextOpenText: string | null;
}

/**
 * Evaluates opening hours in the STORE's timezone.
 *
 * Doing this in server UTC would close a Rajasthan shop at 16:30 local — the
 * kind of bug that silently costs a day of orders (PRD §2.2 M6).
 */
export async function getStoreOpenState(
  store: StoreWithHours,
  now: Date = new Date(),
): Promise<StoreOpenState> {
  // The owner's switch outranks the schedule. No `nextOpenText`: the shop is
  // not on a timetable right now, and promising "opens tomorrow at 8" when
  // nobody has decided that yet is worse than saying nothing.
  if (!store.isActive) {
    return { isOpen: false, todayOpensAt: null, todayClosesAt: null, nextOpenText: null };
  }

  const parts = getZonedParts(now, store.timezone);
  const nowMinutes = minutesSinceMidnight(parts);

  const today = store.hours.find((h) => h.dayOfWeek === parts.weekday);

  // A holiday closure overrides the weekly schedule entirely.
  const localMidnightUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const closed = await repository.hasClosureOn(store.id, localMidnightUtc);

  const closedAllDay = !today || today.isClosed || closed;
  if (closedAllDay) {
    return {
      isOpen: false,
      todayOpensAt: null,
      todayClosesAt: null,
      nextOpenText: describeNextOpening(store, parts.weekday),
    };
  }

  const isOpen = isWithinWindow(
    nowMinutes,
    parseTimeToMinutes(today.opensAt),
    parseTimeToMinutes(today.closesAt),
  );

  return {
    isOpen,
    todayOpensAt: today.opensAt,
    todayClosesAt: today.closesAt,
    nextOpenText: isOpen
      ? null
      : nowMinutes < parseTimeToMinutes(today.opensAt)
        ? `Opens today at ${formatTime12h(today.opensAt)}`
        : describeNextOpening(store, parts.weekday),
  };
}

function describeNextOpening(store: StoreWithHours, fromWeekday: number): string | null {
  // Look ahead a week for the next day the store actually trades.
  for (let offset = 1; offset <= 7; offset += 1) {
    const weekday = (fromWeekday + offset) % 7;
    const hours = store.hours.find((h) => h.dayOfWeek === weekday && !h.isClosed);
    if (!hours) continue;
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      weekday
    ];
    return offset === 1
      ? `Opens tomorrow at ${formatTime12h(hours.opensAt)}`
      : `Opens ${dayName} at ${formatTime12h(hours.opensAt)}`;
  }
  return null;
}

/**
 * Gate used before accepting an order.
 *
 * `ALLOW_ORDERS_WHEN_CLOSED` exists because a shop may want to take orders
 * overnight for morning delivery; it is configuration, not a code branch.
 */
export async function assertStoreAcceptingOrders(
  store: StoreWithHours,
  now: Date = new Date(),
): Promise<void> {
  if (!store.isActive) {
    throw new AppError(ErrorCode.STORE_INACTIVE, {
      internalMessage: `store ${store.id} is inactive`,
    });
  }

  const allowWhenClosed = await configService.get(ConfigKey.ALLOW_ORDERS_WHEN_CLOSED);
  if (allowWhenClosed) return;

  const state = await getStoreOpenState(store, now);
  if (!state.isOpen) {
    throw new AppError(ErrorCode.STORE_CLOSED, {
      message: state.nextOpenText
        ? `The store is closed right now. ${state.nextOpenText}.`
        : 'The store is closed right now.',
      internalMessage: `store ${store.id} closed at ${now.toISOString()}`,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Task 3.1 — serviceability                                                  */
/* -------------------------------------------------------------------------- */

export interface ServiceabilityCheckResult {
  serviceable: boolean;
  distanceKm: number;
  maxRadiusKm: number;
  roadDistanceKm: number;
  deliveryFeePaise: number;
}

/**
 * The reusable check required by the spec, wired to configuration.
 *
 * A per-store `maxServiceRadiusKm` overrides the global config when set —
 * multi-store will need per-store radii, and the column already exists.
 */
export async function checkServiceability(
  latitude: number,
  longitude: number,
  store: StoreWithHours,
): Promise<ServiceabilityCheckResult> {
  if (!isValidCoordinates(latitude, longitude)) {
    throw new AppError(ErrorCode.INVALID_COORDINATES, {
      internalMessage: `invalid coordinates: ${latitude}, ${longitude}`,
    });
  }

  const { MAX_SERVICE_RADIUS_KM, ROAD_DISTANCE_FACTOR, DELIVERY_FEE_SLABS } =
    await configService.getMany([
      ConfigKey.MAX_SERVICE_RADIUS_KM,
      ConfigKey.ROAD_DISTANCE_FACTOR,
      ConfigKey.DELIVERY_FEE_SLABS,
    ]);

  const maxRadiusKm = store.maxServiceRadiusKm ?? MAX_SERVICE_RADIUS_KM;

  const { serviceable, distanceKm } = checkServiceabilityPure(
    latitude,
    longitude,
    store.latitude,
    store.longitude,
    maxRadiusKm,
  );

  // Straight line decides serviceability (it matches the promise we make);
  // the road factor prices the actual ride.
  const roadDistanceKm = toRoadDistanceKm(distanceKm, ROAD_DISTANCE_FACTOR);

  return {
    serviceable,
    distanceKm,
    maxRadiusKm,
    roadDistanceKm,
    deliveryFeePaise: resolveDeliveryFeePaise(roadDistanceKm, DELIVERY_FEE_SLABS),
  };
}

/** Throws unless the coordinates are inside the delivery area. */
export async function assertServiceable(
  latitude: number,
  longitude: number,
  store: StoreWithHours,
): Promise<ServiceabilityCheckResult> {
  const result = await checkServiceability(latitude, longitude, store);
  if (!result.serviceable) {
    throw new AppError(ErrorCode.OUT_OF_SERVICE_AREA, {
      message: `Sorry, we do not deliver to this location yet. We currently deliver up to ${result.maxRadiusKm} km from our store.`,
      internalMessage: `distance ${result.distanceKm}km exceeds ${result.maxRadiusKm}km`,
    });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Task 3.1 / 8.5 — ETA                                                       */
/* -------------------------------------------------------------------------- */

export async function estimateEta(input: {
  distanceKm: number;
  itemCount: number;
  storeId: string;
}): Promise<EtaResult> {
  const config = await configService.getMany([
    ConfigKey.ROAD_DISTANCE_FACTOR,
    ConfigKey.BASE_PREPARATION_MINUTES,
    ConfigKey.PER_ITEM_PICK_SECONDS,
    ConfigKey.AVG_DELIVERY_SPEED_KMPH,
    ConfigKey.ORDERS_PER_RIDER_BATCH,
    ConfigKey.BATCH_DELAY_MINUTES,
    ConfigKey.ETA_BUFFER_MINUTES,
  ]);

  const activeOrderCount = await repository.countActiveOrders(input.storeId);

  return estimateDeliveryTime({
    distanceKm: input.distanceKm,
    itemCount: input.itemCount,
    activeOrderCount,
    roadDistanceFactor: config.ROAD_DISTANCE_FACTOR,
    basePreparationMinutes: config.BASE_PREPARATION_MINUTES,
    perItemPickSeconds: config.PER_ITEM_PICK_SECONDS,
    avgDeliverySpeedKmph: config.AVG_DELIVERY_SPEED_KMPH,
    ordersPerRiderBatch: config.ORDERS_PER_RIDER_BATCH,
    batchDelayMinutes: config.BATCH_DELAY_MINUTES,
    etaBufferMinutes: config.ETA_BUFFER_MINUTES,
  });
}

/* -------------------------------------------------------------------------- */
/* Task 3.2 — the endpoint's payload                                          */
/* -------------------------------------------------------------------------- */

/**
 * Everything the app needs on open: may I order here, how far am I, how long
 * will it take, what will delivery cost, and is the shop even open.
 *
 * One round trip, because on rural 3G each additional call is a visible pause.
 */
export async function getServiceability(
  latitude: number,
  longitude: number,
): Promise<ServiceabilityResult> {
  const store = await getActiveStore();
  const [check, openState] = await Promise.all([
    checkServiceability(latitude, longitude, store),
    getStoreOpenState(store),
  ]);

  // ETA is meaningless outside the delivery area, so it is null rather than a
  // number the UI might display next to "we don't deliver here".
  const eta = check.serviceable
    ? await estimateEta({ distanceKm: check.distanceKm, itemCount: 0, storeId: store.id })
    : null;

  return {
    serviceable: check.serviceable,
    distanceKm: check.distanceKm,
    maxRadiusKm: check.maxRadiusKm,
    etaMinutes: eta?.etaMinutes ?? null,
    etaMinMinutes: eta?.etaMinMinutes ?? null,
    etaMaxMinutes: eta?.etaMaxMinutes ?? null,
    deliveryFeePaise: check.serviceable ? check.deliveryFeePaise : null,
    storeOpen: openState.isOpen,
  };
}

export async function getStoreDto(): Promise<StoreDto> {
  const store = await getActiveStore();
  const openState = await getStoreOpenState(store);
  const parts = getZonedParts(new Date(), store.timezone);
  const today = store.hours.find((h) => h.dayOfWeek === parts.weekday) ?? null;

  return {
    id: store.id,
    name: store.name,
    addressLine: store.addressLine,
    city: store.city,
    state: store.state,
    pincode: store.pincode,
    latitude: store.latitude,
    longitude: store.longitude,
    phone: store.phone,
    timezone: store.timezone,
    isActive: store.isActive,
    isOpenNow: openState.isOpen,
    opensAt: openState.todayOpensAt,
    closesAt: openState.todayClosesAt,
    todayHours: today
      ? {
          dayOfWeek: today.dayOfWeek,
          opensAt: today.opensAt,
          closesAt: today.closesAt,
          isClosed: today.isClosed,
        }
      : null,
  };
}

/** Distance from the store, for display. */
export function distanceFromStore(
  latitude: number,
  longitude: number,
  store: StoreWithHours,
): number {
  return calculateDistance(latitude, longitude, store.latitude, store.longitude);
}
