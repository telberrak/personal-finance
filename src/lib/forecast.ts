/**
 * Balance forecast: today's everyday balance, plus income and bills on their dates, minus your usual daily
 * spending, day by day. Used by Reports, Calendar and the low-balance alert.
 */
import type { FinanceData } from '../db/types';
import { addDays, daysBetween, endOfMonth, shiftMonth, startOfMonth, type ISODate } from './dates';
import type { Pence } from './money';
import { nextPayday } from './recurring';
import { billOccurrences, dayToDaySpend, isTransfer, MATCH_WINDOW_DAYS, totalBalance } from './selectors';

/** Expected balance on one day. */
export interface ForecastPoint {
  date: ISODate;
  balance: Pence;
}

/** Expected balance day by day, and its lowest point. */
export interface Forecast {
  points: ForecastPoint[];
  lowest: ForecastPoint;
  avgDailySpend: Pence;
  expectedIncome: Pence;
}

/** Typical monthly income: the larger of the last two complete months, so one odd month does not hide pay. */
function estimateMonthlyIncome(data: FinanceData, ref: ISODate): Pence {
  const totals = [1, 2].map((n) => {
    const m = shiftMonth(ref, -n);
    const from = startOfMonth(m);
    const to = endOfMonth(m);
    return data.transactions.reduce((s, t) => (t.amount > 0 && !isTransfer(t) && t.date >= from && t.date <= to ? s + t.amount : s), 0);
  });
  return Math.max(...totals);
}

/**
 * Day-by-day balance of the everyday accounts for the next `days` days:
 * today's balance, minus each unpaid bill on its due date, minus average daily spending,
 * plus expected income on each payday.
 */
export function forecastBalance(data: FinanceData, ref: ISODate, days = 45): Forecast {
  const avgDailySpend = Math.round(dayToDaySpend(data.transactions, addDays(ref, -30), addDays(ref, -1)) / 30);
  const expectedIncome = estimateMonthlyIncome(data, ref);
  const end = addDays(ref, days);

  const billsByDay = new Map<ISODate, Pence>();
  for (const o of billOccurrences(data.recurring, data.transactions, addDays(ref, -MATCH_WINDOW_DAYS), end)) {
    if (o.paid) continue;
    const day = o.date < ref ? ref : o.date; // late bills are expected any moment
    billsByDay.set(day, (billsByDay.get(day) ?? 0) + o.rule.amount);
  }
  const paydays = new Set<ISODate>();
  for (let p = nextPayday(ref, data.settings.payday); p <= end; p = nextPayday(p, data.settings.payday)) paydays.add(p);

  let balance = totalBalance(data, 'safe');
  const points: ForecastPoint[] = [];
  for (let i = 0; i <= daysBetween(ref, end); i++) {
    const date = addDays(ref, i);
    balance -= billsByDay.get(date) ?? 0;
    if (i > 0) balance -= avgDailySpend;
    if (paydays.has(date)) balance += expectedIncome;
    points.push({ date, balance });
  }
  const lowest = points.reduce((lo, p) => (p.balance < lo.balance ? p : lo), points[0]);
  return { points, lowest, avgDailySpend, expectedIncome };
}
