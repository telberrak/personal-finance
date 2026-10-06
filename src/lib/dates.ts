import { t } from '../i18n';
import { dateFormat } from './format';
/** Dates are stored as local calendar days, 'YYYY-MM-DD', so they never shift with time zones. */
export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

/** A local Date as YYYY-MM-DD. */
export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD as a local Date at midnight. */
export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Today's local date. */
export function today(): ISODate {
  return toISO(new Date());
}

/** Days in a month (monthIndex 0–11). */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** The given day of a month, clamped to its length (31 → 30 Apr, 28/29 Feb). */
export function clampedDate(year: number, monthIndex: number, day: number): ISODate {
  // Normalise the month first so callers can pass e.g. monthIndex 12 or -1.
  const first = new Date(year, monthIndex, 1);
  const y = first.getFullYear();
  const m = first.getMonth();
  return toISO(new Date(y, m, Math.min(day, daysInMonth(y, m))));
}

/** The date `n` days later (negative for earlier). */
export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The 1st of the month. */
export function startOfMonth(s: ISODate): ISODate {
  return s.slice(0, 8) + '01';
}

/** The last day of the month. */
export function endOfMonth(s: ISODate): ISODate {
  const d = fromISO(s);
  return clampedDate(d.getFullYear(), d.getMonth(), 31);
}

/** The same day `n` months later, clamped to the end of shorter months. */
export function shiftMonth(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  return clampedDate(d.getFullYear(), d.getMonth() + n, d.getDate());
}

/** The day of the month (1–31). */
export function dayOfMonth(s: ISODate): number {
  return Number(s.slice(8, 10));
}

const fmt = (options: Intl.DateTimeFormatOptions) => (s: ISODate) => dateFormat(options).format(fromISO(s));

// Formatted for the display locale (see lib/format). Examples are for English.
export const formatLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' }); // Wednesday 14 October
/** Dates formatted in the interface language and digits; the comments show English examples. */
export const formatShort = fmt({ day: 'numeric', month: 'short' }); // 14 Oct
export const formatMonth = fmt({ month: 'long' }); // October
export const formatMonthShort = fmt({ month: 'short' }); // Oct
export const formatMonthYear = fmt({ month: 'long', year: 'numeric' }); // October 2026
export const formatDate = fmt({ day: 'numeric', month: 'long', year: 'numeric' }); // 2 June 2027
export const formatDayMonth = fmt({ day: 'numeric', month: 'long' }); // 25 October
export const monthAbbr = formatMonthShort;
export const formatDay = fmt({ day: 'numeric' }); // 14

/** "Today", "Yesterday", or "Monday 12 October" — for grouping transaction lists. */
export function dayHeading(s: ISODate, ref: ISODate): string {
  const diff = daysBetween(s, ref);
  if (diff === 0) return t('time.today');
  if (diff === 1) return t('time.yesterday');
  return formatLong(s);
}

/** "Today", "Tomorrow", "In 4 days" — for upcoming bills. */
export function dueLabel(s: ISODate, ref: ISODate): string {
  const diff = daysBetween(ref, s);
  if (diff === 0) return t('time.today');
  if (diff === 1) return t('time.tomorrow');
  if (diff === -1) return t('time.yesterday');
  return diff > 1 ? t('time.inDays', { count: diff }) : t('time.daysAgo', { count: -diff });
}
