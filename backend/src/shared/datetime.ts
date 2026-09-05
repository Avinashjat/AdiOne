/**
 * Timezone-aware date helpers.
 *
 * Store opening hours are a local-time concept. Evaluating them against server
 * UTC would close a Sikar store at 2:30 PM local — PRD §2.2 M6. Everything
 * here works in the store's configured IANA timezone.
 *
 * Implemented with `Intl` rather than a date library: Node 20+ and both React
 * Native engines ship full ICU, so this needs no dependency.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday, matching `store_hours.day_of_week`. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Breaks a UTC instant into calendar parts in the given IANA timezone. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);

  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0';

  // Intl renders midnight as "24" in some environments under hour12:false.
  const hour = Number(lookup('hour')) % 24;

  return {
    year: Number(lookup('year')),
    month: Number(lookup('month')),
    day: Number(lookup('day')),
    hour,
    minute: Number(lookup('minute')),
    second: Number(lookup('second')),
    weekday: WEEKDAY_INDEX[lookup('weekday')] ?? 0,
  };
}

/** Minutes since local midnight — the unit store hours are compared in. */
export function minutesSinceMidnight(parts: ZonedParts): number {
  return parts.hour * 60 + parts.minute;
}

/** Parses "HH:mm" (or "HH:mm:ss") into minutes since midnight. */
export function parseTimeToMinutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

export function formatMinutesAsTime(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "8:00 AM" — the display form used on the Store Closed screen. */
export function formatTime12h(time: string): string {
  const minutes = parseTimeToMinutes(time);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Whether `nowMinutes` falls inside an opening window.
 *
 * Handles windows that cross midnight (e.g. 08:00–01:00) rather than assuming
 * a store always closes on the same calendar day it opened.
 */
export function isWithinWindow(
  nowMinutes: number,
  opensAtMinutes: number,
  closesAtMinutes: number,
): boolean {
  if (opensAtMinutes === closesAtMinutes) return true; // open 24h
  if (closesAtMinutes > opensAtMinutes) {
    return nowMinutes >= opensAtMinutes && nowMinutes < closesAtMinutes;
  }
  // Crosses midnight: open from opensAt to 23:59 and from 00:00 to closesAt.
  return nowMinutes >= opensAtMinutes || nowMinutes < closesAtMinutes;
}

/** Start of the local day, as a UTC instant. Used for "today's orders". */
export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  const guess = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  // Correct for the zone's offset at that instant.
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offsetMinutes * 60_000);
}

export function endOfZonedDay(date: Date, timeZone: string): Date {
  const start = startOfZonedDay(date, timeZone);
  return new Date(start.getTime() + 24 * 60 * 60_000 - 1);
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

/** "2 mins ago" / "3 hours ago" — for admin order cards. */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} mins ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** "13 May 2025, 11:20 AM" — the order-details format in the mockups. */
export function formatDateTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
