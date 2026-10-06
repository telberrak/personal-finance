import type { BudgetPeriod } from '../db/types';
import { addDays, clampedDate, endOfMonth, formatMonthYear, formatShort, fromISO, startOfMonth, type ISODate } from './dates';

/** A budget period: its first and last day and its label. */
export interface Period {
  from: ISODate;
  to: ISODate;
  label: string;
}

/** The budget period containing `ref`: a calendar month, or payday to the day before the next payday. */
export function periodFor(ref: ISODate, mode: BudgetPeriod, payday: number): Period {
  if (mode === 'month') return { from: startOfMonth(ref), to: endOfMonth(ref), label: formatMonthYear(ref) };
  const d = fromISO(ref);
  const thisMonth = clampedDate(d.getFullYear(), d.getMonth(), payday);
  const from = thisMonth <= ref ? thisMonth : clampedDate(d.getFullYear(), d.getMonth() - 1, payday);
  const f = fromISO(from);
  const to = addDays(clampedDate(f.getFullYear(), f.getMonth() + 1, payday), -1);
  return { from, to, label: `${formatShort(from)} – ${formatShort(to)}` };
}

/** The period before (-1) or after (+1) the given one. */
export function shiftPeriod(p: Period, direction: -1 | 1, mode: BudgetPeriod, payday: number): Period {
  return periodFor(direction > 0 ? addDays(p.to, 1) : addDays(p.from, -1), mode, payday);
}
