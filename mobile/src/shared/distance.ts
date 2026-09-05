/**
 * ⚠️  GENERATED FILE — DO NOT EDIT.
 *
 * Copied from backend/src/shared by `npm run sync:shared`.
 * Edit the canonical file in backend/src/shared and re-run the sync.
 */

/**
 * Distance, serviceability and ETA — the three reusable functions required by
 * the spec (§57) and specified in PRD §15.
 *
 * These are pure functions with no I/O so they can be shared by the server and
 * both clients. The SERVER remains the sole authority: clients may call these
 * to *display* "3.2 km away", but the server recomputes and decides at every
 * meaningful step (app open, address save, checkout, order creation).
 */

import type { DeliveryFeeSlab } from './config-keys';

/** Mean Earth radius in km (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function isValidCoordinates(lat: number, lng: number): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/**
 * Great-circle (straight-line) distance in kilometres, rounded to 2 decimals.
 *
 * Haversine is used rather than a routing API because it needs no network
 * call, no API key and no rate limit, and because the serviceability promise
 * we make to customers ("we deliver up to 10 km from our store") is itself a
 * straight-line statement.
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
}

export interface ServiceabilityCheck {
  serviceable: boolean;
  distanceKm: number;
}

/**
 * The signature required by the spec.
 *
 * `maxRadiusKm` is supplied by the caller from Configuration
 * (`MAX_SERVICE_RADIUS_KM`) — it is never defaulted here, so there is no way
 * for a stale hardcoded radius to creep in.
 */
export function checkServiceability(
  userLatitude: number,
  userLongitude: number,
  storeLatitude: number,
  storeLongitude: number,
  maxRadiusKm: number,
): ServiceabilityCheck {
  const distanceKm = calculateDistance(
    userLatitude,
    userLongitude,
    storeLatitude,
    storeLongitude,
  );
  return { serviceable: distanceKm <= maxRadiusKm, distanceKm };
}

/**
 * Converts straight-line distance to an estimate of the actual ride.
 *
 * Roads are not straight. Applying this factor to ETA and delivery fee — but
 * NOT to the serviceability boundary — is deliberate: a customer 9.8 km away
 * in a straight line is inside our promise, but is a ~13 km ride and must be
 * priced and promised accordingly.
 */
export function toRoadDistanceKm(straightLineKm: number, roadDistanceFactor: number): number {
  return Math.round(straightLineKm * roadDistanceFactor * 100) / 100;
}

export interface EtaInput {
  distanceKm: number;
  itemCount: number;
  /** Orders currently between STORE_ACCEPTED and OUT_FOR_DELIVERY. */
  activeOrderCount: number;
  roadDistanceFactor: number;
  basePreparationMinutes: number;
  perItemPickSeconds: number;
  avgDeliverySpeedKmph: number;
  ordersPerRiderBatch: number;
  batchDelayMinutes: number;
  etaBufferMinutes: number;
}

export interface EtaResult {
  etaMinutes: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  breakdown: {
    preparationMinutes: number;
    travelMinutes: number;
    workloadMinutes: number;
    bufferMinutes: number;
    roadDistanceKm: number;
  };
}

/**
 * Estimated delivery time.
 *
 *   prep    = base + (items x perItemPickSeconds)
 *   travel  = roadKm / speed
 *   load    = ceil(activeOrders / batchSize) x batchDelay
 *   eta     = prep + travel + load + buffer
 *
 * Displayed as a 10-minute band rounded to the nearest 5 ("20–25 mins"),
 * because a single precise number invites a complaint when it slips by 90
 * seconds.
 */
export function estimateDeliveryTime(input: EtaInput): EtaResult {
  const roadDistanceKm = toRoadDistanceKm(input.distanceKm, input.roadDistanceFactor);

  const preparationMinutes =
    input.basePreparationMinutes + (input.itemCount * input.perItemPickSeconds) / 60;

  const travelMinutes =
    input.avgDeliverySpeedKmph > 0 ? (roadDistanceKm / input.avgDeliverySpeedKmph) * 60 : 0;

  const workloadMinutes =
    input.ordersPerRiderBatch > 0
      ? Math.floor(input.activeOrderCount / input.ordersPerRiderBatch) * input.batchDelayMinutes
      : 0;

  const raw = preparationMinutes + travelMinutes + workloadMinutes + input.etaBufferMinutes;
  const etaMinutes = Math.max(5, Math.round(raw / 5) * 5);

  return {
    etaMinutes,
    etaMinMinutes: Math.max(5, etaMinutes - 5),
    etaMaxMinutes: etaMinutes + 5,
    breakdown: {
      preparationMinutes: Math.round(preparationMinutes * 10) / 10,
      travelMinutes: Math.round(travelMinutes * 10) / 10,
      workloadMinutes,
      bufferMinutes: input.etaBufferMinutes,
      roadDistanceKm,
    },
  };
}

/**
 * Delivery fee for a distance, from the configured slabs.
 * The first slab whose `maxKm` covers the road distance wins; beyond the last
 * slab the last slab's fee applies (the address would not be serviceable
 * anyway, so this is only a safety net).
 */
export function resolveDeliveryFeePaise(
  roadDistanceKm: number,
  slabs: readonly DeliveryFeeSlab[],
): number {
  if (slabs.length === 0) return 0;
  const sorted = [...slabs].sort((a, b) => a.maxKm - b.maxKm);
  const match = sorted.find((slab) => roadDistanceKm <= slab.maxKm);
  return (match ?? sorted[sorted.length - 1]!).feePaise;
}

/** "3.2 km" / "800 m" — for the location bar in the mockup. */
export function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(1)} km`;
}

/** "20–25 mins" — the ETA band. */
export function formatEtaRange(minMinutes: number, maxMinutes: number): string {
  if (minMinutes === maxMinutes) return `${minMinutes} mins`;
  return `${minMinutes}–${maxMinutes} mins`;
}
