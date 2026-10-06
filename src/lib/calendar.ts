/** Cash-flow calendar: each day's bills, payday and balance (actual for past days, forecast after). */
import type { FinanceData } from '../db/types';
import { addDays, daysBetween, endOfMonth, fromISO, startOfMonth, type ISODate } from './dates';
import { forecastBalance } from './forecast';
import type { Pence } from './money';
import { nextPayday } from './recurring';
import { accountBalance, billOccurrences, isTransfer, type BillOccurrence } from './selectors';

/** One day in the calendar: its bills, whether it is payday, money in and out, and the end-of-day balance. */
export interface CalendarDay {
  date: ISODate;
  inMonth: boolean;
  bills: BillOccurrence[];
  payday: boolean;
  income: Pence;
  spending: Pence;
  /** End-of-day balance of the everyday accounts: actual up to today, forecast after. */
  balance: Pence | undefined;
  forecast: boolean;
  low: boolean;
}

/** Weeks (rows of 7 days) covering `month`, starting on `firstDay` (0 = Sunday, 1 = Monday…). */
export function calendarMonth(data: FinanceData, month: ISODate, ref: ISODate, firstDay = 1): CalendarDay[][] {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const lead = (fromISO(first).getDay() - firstDay + 7) % 7;
  const start = addDays(first, -lead);
  const days = Math.ceil((lead + daysBetween(first, last) + 1) / 7) * 7;
  const end = addDays(start, days - 1);

  const bills = billOccurrences(data.recurring, data.transactions, start, end);
  const paydays = new Set<ISODate>();
  for (let p = nextPayday(addDays(start, -1), data.settings.payday); p <= end; p = nextPayday(p, data.settings.payday)) paydays.add(p);
  const forecast =
    end > ref
      ? new Map(forecastBalance(data, ref, daysBetween(ref, end)).points.map((p) => [p.date, p.balance]))
      : new Map<ISODate, Pence>();
  const everyday = data.accounts.filter((a) => !a.archived && a.includeInSafeToSpend);

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    let income = 0;
    let spending = 0;
    for (const t of data.transactions) {
      if (t.date !== date || isTransfer(t)) continue;
      if (t.amount > 0) income += t.amount;
      else spending -= t.amount;
    }
    const isFuture = date > ref;
    const balance = isFuture ? forecast.get(date) : everyday.reduce((s, a) => s + accountBalance(a, data.transactions, date), 0);
    const day: CalendarDay = {
      date,
      inMonth: date >= first && date <= last,
      bills: bills.filter((b) => b.date === date),
      payday: paydays.has(date),
      income,
      spending,
      balance,
      forecast: isFuture,
      low: balance !== undefined && balance < data.settings.lowBalanceThreshold,
    };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(day);
  }
  return weeks;
}
