/** Dates are stored as local calendar days, 'YYYY-MM-DD', so they never shift with time zones. */
export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): ISODate {
  return toISO(new Date());
}

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

export function startOfMonth(s: ISODate): ISODate {
  return s.slice(0, 8) + '01';
}

export function endOfMonth(s: ISODate): ISODate {
  const d = fromISO(s);
  return clampedDate(d.getFullYear(), d.getMonth(), 31);
}

export function shiftMonth(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  return clampedDate(d.getFullYear(), d.getMonth() + n, d.getDate());
}

export function dayOfMonth(s: ISODate): number {
  return Number(s.slice(8, 10));
}

const longFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const monthYearFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const fullFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export const formatLong = (s: ISODate) => longFmt.format(fromISO(s)); // Wednesday 14 October
export const formatShort = (s: ISODate) => shortFmt.format(fromISO(s)); // 14 Oct
export const formatMonth = (s: ISODate) => monthFmt.format(fromISO(s)); // October
export const formatMonthYear = (s: ISODate) => monthYearFmt.format(fromISO(s)); // October 2026
export const formatDate = (s: ISODate) => fullFmt.format(fromISO(s)); // 2 June 2027
export const monthAbbr = (s: ISODate) => formatShort(s).split(' ')[1];

/** "Today", "Yesterday", or "Monday 12 October" — for grouping transaction lists. */
export function dayHeading(s: ISODate, ref: ISODate): string {
  const diff = daysBetween(s, ref);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return weekdayFmt.format(fromISO(s));
}

/** "Today", "Tomorrow", "In 4 days" — for upcoming bills. */
export function dueLabel(s: ISODate, ref: ISODate): string {
  const diff = daysBetween(ref, s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1) return `In ${diff} days`;
  if (diff === -1) return 'Yesterday';
  return `${-diff} days ago`;
}
