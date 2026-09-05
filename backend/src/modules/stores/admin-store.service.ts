/**
 * Admin store settings — location and address.
 *
 * The store's coordinates are the origin of every serviceability check, ETA and
 * delivery fee in the system, so moving the store silently changes who can
 * order. Every change is therefore audited with its before and after.
 *
 * Nothing caches the store row (see store.repository.findActiveStore), so an
 * update here takes effect on the very next request.
 */

import { prisma } from '../../infra/db/prisma';
import { AppError } from '../../common/errors';
import { ErrorCode, type StoreAvailabilityDto, type StoreHoursDto } from '../../shared';
import { isValidCoordinates } from '../../shared/distance';
import * as storeService from './store.service';

export interface UpdateStoreLocationInput {
  latitude: number;
  longitude: number;
  name?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
}

export async function updateStoreLocation(
  input: UpdateStoreLocationInput,
  actorUserId: string,
): Promise<{ id: string; latitude: number; longitude: number }> {
  if (!isValidCoordinates(input.latitude, input.longitude)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'Those coordinates are not valid.',
      internalMessage: `rejected ${input.latitude},${input.longitude}`,
    });
  }

  // 0,0 is in the Atlantic. It is what a broken geolocation call produces, and
  // silently accepting it would make the whole town unserviceable.
  if (input.latitude === 0 && input.longitude === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'Those coordinates look wrong (0, 0). Please set the location again.',
    });
  }

  const before = await storeService.getActiveStore();

  const after = await prisma.store.update({
    where: { id: before.id },
    data: {
      latitude: input.latitude,
      longitude: input.longitude,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.pincode !== undefined ? { pincode: input.pincode } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'store.update_location',
      entityType: 'Store',
      entityId: after.id,
      before: {
        latitude: before.latitude,
        longitude: before.longitude,
        city: before.city,
      },
      after: {
        latitude: after.latitude,
        longitude: after.longitude,
        city: after.city,
      },
    },
  });

  return { id: after.id, latitude: after.latitude, longitude: after.longitude };
}

/* -------------------------------------------------------------------------- */
/* Trading switch and opening hours                                           */
/* -------------------------------------------------------------------------- */

/** A store with no row for a day is treated as closed all day, not as 24h. */
const DEFAULT_HOURS: Omit<StoreHoursDto, 'dayOfWeek'> = {
  opensAt: '09:00',
  closesAt: '21:00',
  isClosed: true,
};

/**
 * The panel always renders seven rows, so the API always returns seven — a
 * missing day is a gap in the seed, not something the operator should have to
 * understand or work around.
 */
export async function getAvailability(): Promise<StoreAvailabilityDto> {
  const store = await storeService.getActiveStore();
  const openState = await storeService.getStoreOpenState(store);

  const hours: StoreHoursDto[] = Array.from({ length: 7 }, (_, dayOfWeek) => {
    const row = store.hours.find((h) => h.dayOfWeek === dayOfWeek);
    return row
      ? {
          dayOfWeek,
          opensAt: row.opensAt,
          closesAt: row.closesAt,
          isClosed: row.isClosed,
        }
      : { dayOfWeek, ...DEFAULT_HOURS };
  });

  return {
    isActive: store.isActive,
    isOpenNow: openState.isOpen,
    timezone: store.timezone,
    hours,
    nextOpenText: openState.nextOpenText,
  };
}

/**
 * The trading switch.
 *
 * Turning it off stops the app taking orders immediately and shows customers
 * the closed state; it does NOT hide the catalog, so people can still browse
 * and add to a cart for when the shop reopens. Audited, because "why did we
 * take no orders yesterday" is a question that gets asked later.
 */
export async function setTradingStatus(
  isActive: boolean,
  actorUserId: string,
): Promise<StoreAvailabilityDto> {
  const before = await storeService.getActiveStore();

  if (before.isActive !== isActive) {
    await prisma.store.update({ where: { id: before.id }, data: { isActive } });
    await prisma.auditLog.create({
      data: {
        actorUserId,
        action: isActive ? 'store.resume_trading' : 'store.pause_trading',
        entityType: 'Store',
        entityId: before.id,
        before: { isActive: before.isActive },
        after: { isActive },
      },
    });
  }

  return getAvailability();
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface UpdateStoreHoursInput {
  hours: StoreHoursDto[];
}

/**
 * Replaces the opening hours for the days supplied.
 *
 * Partial by design: "apply these hours to every day" and "Sunday is now
 * closed" are the same call with a different number of entries, and a day the
 * operator did not touch is left exactly as it was.
 */
export async function updateHours(
  input: UpdateStoreHoursInput,
  actorUserId: string,
): Promise<StoreAvailabilityDto> {
  const store = await storeService.getActiveStore();

  const seen = new Set<number>();
  for (const entry of input.hours) {
    if (seen.has(entry.dayOfWeek)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: 'Each day can only be set once.',
        internalMessage: `duplicate dayOfWeek ${entry.dayOfWeek}`,
      });
    }
    seen.add(entry.dayOfWeek);

    if (!TIME_PATTERN.test(entry.opensAt) || !TIME_PATTERN.test(entry.closesAt)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: 'Opening and closing times must be in 24-hour HH:mm form.',
        internalMessage: `bad window ${entry.opensAt}-${entry.closesAt}`,
      });
    }

    // No further checks on the window itself: equal times mean "open 24 hours"
    // to `isWithinWindow`, and a closing time earlier than the opening time is
    // a window across midnight (08:00–01:00), which it already handles. Both
    // are things a real shop does, so neither is an error.
  }

  const before = store.hours.map((h) => ({
    dayOfWeek: h.dayOfWeek,
    opensAt: h.opensAt,
    closesAt: h.closesAt,
    isClosed: h.isClosed,
  }));

  // Same projection as `before`, so the audit entry's two halves are directly
  // comparable and nothing beyond the four columns can ride along.
  const requested = input.hours.map((h) => ({
    dayOfWeek: h.dayOfWeek,
    opensAt: h.opensAt,
    closesAt: h.closesAt,
    isClosed: h.isClosed,
  }));

  // One transaction: a half-applied week would leave the shop open on days the
  // operator had just closed.
  await prisma.$transaction(
    requested.map((entry) =>
      prisma.storeHours.upsert({
        where: { storeId_dayOfWeek: { storeId: store.id, dayOfWeek: entry.dayOfWeek } },
        create: {
          storeId: store.id,
          dayOfWeek: entry.dayOfWeek,
          opensAt: entry.opensAt,
          closesAt: entry.closesAt,
          isClosed: entry.isClosed,
        },
        update: {
          opensAt: entry.opensAt,
          closesAt: entry.closesAt,
          isClosed: entry.isClosed,
        },
      }),
    ),
  );

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'store.update_hours',
      entityType: 'Store',
      entityId: store.id,
      before: { hours: before },
      after: { hours: requested },
    },
  });

  return getAvailability();
}
