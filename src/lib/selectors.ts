import type { Budget, Category, FinanceData, Recurring, Transaction } from '../db/types';
import { addDays, daysBetween, endOfMonth, shiftMonth, startOfMonth, type ISODate } from './dates';
import type { Pence } from './money';
import { nextPayday, occurrencesBetween } from './recurring';

/** A bill payment can land a few days either side of its due date (weekends, bank holidays). */
const MATCH_WINDOW_DAYS = 3;

export function totalBalance(data: Pick<FinanceData, 'accounts' | 'transactions'>): Pence {
  const opening = data.accounts.reduce((sum, a) => sum + a.openingBalance, 0);
  return data.transactions.reduce((sum, t) => sum + t.amount, opening);
}

export function inRange(t: { date: ISODate }, from: ISODate, to: ISODate): boolean {
  return t.date >= from && t.date <= to;
}

/** Day-to-day spending: money out that is not a recurring bill payment. Returned as a positive amount. */
export function dayToDaySpend(transactions: Transaction[], from: ISODate, to: ISODate): Pence {
  return transactions.reduce((sum, t) => (t.amount < 0 && !t.recurringId && inRange(t, from, to) ? sum - t.amount : sum), 0);
}

export interface BillOccurrence {
  rule: Recurring;
  date: ISODate;
  paid: boolean;
}

/** Every due date of the active recurring payments within [from, to], marked paid when a matching transaction exists. */
export function billOccurrences(recurring: Recurring[], transactions: Transaction[], from: ISODate, to: ISODate): BillOccurrence[] {
  const paymentsByRule = new Map<string, ISODate[]>();
  for (const t of transactions) {
    if (!t.recurringId) continue;
    const list = paymentsByRule.get(t.recurringId) ?? [];
    list.push(t.date);
    paymentsByRule.set(t.recurringId, list);
  }

  const out: BillOccurrence[] = [];
  for (const rule of recurring) {
    if (!rule.active) continue;
    const payments = paymentsByRule.get(rule.id) ?? [];
    for (const date of occurrencesBetween(rule, from, to)) {
      const paid = payments.some((p) => Math.abs(daysBetween(date, p)) <= MATCH_WINDOW_DAYS);
      out.push({ rule, date, paid });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rule.name.localeCompare(b.rule.name)));
}

export interface SafeToSpend {
  balance: Pence;
  billsBeforePayday: Pence;
  savings: Pence;
  safe: Pence;
  payday: ISODate;
  daysToPayday: number;
  perDay: Pence;
}

/** Balance minus unpaid bills due before the next payday, minus the savings set aside. */
export function safeToSpend(data: FinanceData, ref: ISODate): SafeToSpend {
  const balance = totalBalance(data);
  const payday = nextPayday(ref, data.settings.payday);
  // Bills from a few days back are included in case a payment is due but not yet taken.
  const billsBeforePayday = billOccurrences(data.recurring, data.transactions, addDays(ref, -MATCH_WINDOW_DAYS), addDays(payday, -1))
    .filter((o) => !o.paid)
    .reduce((sum, o) => sum + o.rule.amount, 0);
  const savings = data.settings.monthlySavings;
  const safe = balance - billsBeforePayday - savings;
  const daysToPayday = daysBetween(ref, payday);
  return {
    balance,
    billsBeforePayday,
    savings,
    safe,
    payday,
    daysToPayday,
    perDay: Math.max(0, Math.floor(safe / Math.max(1, daysToPayday))),
  };
}

/** Day-to-day spending per day of `month`, up to and including `ref` when the month is current. */
export function dailySpend(transactions: Transaction[], month: ISODate, ref: ISODate): Pence[] {
  const from = startOfMonth(month);
  const last = endOfMonth(month) < ref ? endOfMonth(month) : ref;
  const days = daysBetween(from, last) + 1;
  const out = new Array<Pence>(Math.max(0, days)).fill(0);
  for (const t of transactions) {
    if (t.amount < 0 && !t.recurringId && inRange(t, from, last)) out[daysBetween(from, t.date)] -= t.amount;
  }
  return out;
}

/** Spending so far this month compared with the same point last month (negative = spending less). */
export function spendVersusLastMonth(transactions: Transaction[], ref: ISODate): Pence {
  const now = dayToDaySpend(transactions, startOfMonth(ref), ref);
  const lastRef = shiftMonth(ref, -1);
  const then = dayToDaySpend(transactions, startOfMonth(lastRef), lastRef);
  return now - then;
}

export interface BudgetProgress {
  budget: Budget;
  category: Category;
  spent: Pence;
  remaining: Pence;
  ratio: number;
}

export function budgetProgress(budgets: Budget[], categories: Category[], transactions: Transaction[], month: ISODate): BudgetProgress[] {
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rows = budgets.flatMap((budget) => {
    const category = byId.get(budget.categoryId);
    if (!category) return [];
    const spent = transactions.reduce(
      (sum, t) => (t.categoryId === budget.categoryId && t.amount < 0 && inRange(t, from, to) ? sum - t.amount : sum),
      0,
    );
    return [
      { budget, category, spent, remaining: budget.monthlyLimit - spent, ratio: budget.monthlyLimit ? spent / budget.monthlyLimit : 0 },
    ];
  });
  return rows.sort((a, b) => a.category.order - b.category.order);
}

/** Transactions grouped by date, newest first, with each day's net total. */
export function groupByDay(transactions: Transaction[]): { date: ISODate; total: Pence; items: Transaction[] }[] {
  const groups = new Map<ISODate, Transaction[]>();
  const sorted = [...transactions].sort((a, b) =>
    a.date === b.date ? (b.time ?? '').localeCompare(a.time ?? '') : a.date < b.date ? 1 : -1,
  );
  for (const t of sorted) {
    const list = groups.get(t.date) ?? [];
    list.push(t);
    groups.set(t.date, list);
  }
  return Array.from(groups, ([date, items]) => ({ date, items, total: items.reduce((s, t) => s + t.amount, 0) }));
}
