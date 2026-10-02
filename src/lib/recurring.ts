import { addDays, clampedDate, dayOfMonth, fromISO, type ISODate } from './dates';

export type Frequency = 'weekly' | 'monthly' | 'yearly';

export interface Schedule {
  /** First payment date; also the anchor day for monthly and yearly schedules. */
  startDate: ISODate;
  frequency: Frequency;
}

/** Every payment date of a schedule that falls within [from, to], inclusive. */
export function occurrencesBetween(schedule: Schedule, from: ISODate, to: ISODate): ISODate[] {
  const { startDate, frequency } = schedule;
  if (to < from || to < startDate) return [];
  const out: ISODate[] = [];

  if (frequency === 'weekly') {
    let d = startDate;
    while (d < from) d = addDays(d, 7);
    for (; d <= to; d = addDays(d, 7)) out.push(d);
    return out;
  }

  const start = fromISO(startDate);
  const anchorDay = dayOfMonth(startDate);
  const step = frequency === 'monthly' ? 1 : 12;
  const fromDate = fromISO(from);
  // Jump close to `from` instead of walking from the start date month by month.
  let monthsAhead = (fromDate.getFullYear() - start.getFullYear()) * 12 + (fromDate.getMonth() - start.getMonth()) - step;
  monthsAhead = Math.max(0, Math.floor(monthsAhead / step) * step);

  for (; ; monthsAhead += step) {
    const d = clampedDate(start.getFullYear(), start.getMonth() + monthsAhead, anchorDay);
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** The next payment on or after `from`, looking up to a year and a week ahead. */
export function nextOccurrence(schedule: Schedule, from: ISODate): ISODate | undefined {
  return occurrencesBetween(schedule, from, addDays(from, 372))[0];
}

/** The next payday strictly after `ref` (on payday itself, the next one is a month away). */
export function nextPayday(ref: ISODate, paydayDay: number): ISODate {
  const d = fromISO(ref);
  const thisMonth = clampedDate(d.getFullYear(), d.getMonth(), paydayDay);
  return thisMonth > ref ? thisMonth : clampedDate(d.getFullYear(), d.getMonth() + 1, paydayDay);
}
