import type { Category, Transaction } from '../db/types';
import { addDays, daysBetween, endOfMonth, shiftMonth, startOfMonth, type ISODate } from './dates';
import type { Pence } from './money';
import { payeeKey } from './payees';
import { inRange, isTransfer } from './selectors';

export interface CategoryTotal {
  category: Category;
  total: Pence;
  share: number;
}

/** Money out per category (bills included), largest first. Refunds reduce their category. */
export function spendByCategory(transactions: Transaction[], categories: Category[], from: ISODate, to: ISODate): CategoryTotal[] {
  const totals = new Map<string, Pence>();
  for (const t of transactions) {
    if (isTransfer(t) || !inRange(t, from, to)) continue;
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) - t.amount);
  }
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rows = [...totals]
    .map(([id, total]) => ({ category: byId.get(id), total }))
    .filter((r): r is { category: Category; total: Pence } => !!r.category && r.category.kind === 'expense' && r.total > 0);
  const sum = rows.reduce((s, r) => s + r.total, 0);
  return rows.map((r) => ({ ...r, share: sum ? r.total / sum : 0 })).sort((a, b) => b.total - a.total);
}

export interface MonthTotal {
  month: ISODate;
  income: Pence;
  spending: Pence;
}

/** Income and spending for each of the last `months` months, oldest first, ending with the month of `ref`. */
export function monthlyTotals(transactions: Transaction[], ref: ISODate, months = 6): MonthTotal[] {
  const out: MonthTotal[] = [];
  for (let n = months - 1; n >= 0; n--) {
    const m = startOfMonth(shiftMonth(startOfMonth(ref), -n));
    const to = endOfMonth(m);
    let income = 0;
    let spending = 0;
    for (const t of transactions) {
      if (isTransfer(t) || !inRange(t, m, to)) continue;
      if (t.amount > 0) income += t.amount;
      else spending -= t.amount;
    }
    out.push({ month: m, income, spending });
  }
  return out;
}

export interface PayeeTotal {
  payee: string;
  total: Pence;
  count: number;
}

export function topPayees(transactions: Transaction[], from: ISODate, to: ISODate, limit = 5): PayeeTotal[] {
  const map = new Map<string, PayeeTotal>();
  for (const t of transactions) {
    if (t.amount >= 0 || isTransfer(t) || !inRange(t, from, to)) continue;
    const key = payeeKey(t.payee);
    const row = map.get(key) ?? { payee: t.payee, total: 0, count: 0 };
    row.total -= t.amount;
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export interface CategoryComparison {
  category: Category;
  current: Pence;
  previous: Pence;
  change: Pence;
}

/** Spending per category in two periods, largest current first. */
export function comparePeriods(
  transactions: Transaction[],
  categories: Category[],
  current: { from: ISODate; to: ISODate },
  previous: { from: ISODate; to: ISODate },
): CategoryComparison[] {
  const a = new Map(spendByCategory(transactions, categories, current.from, current.to).map((r) => [r.category.id, r.total]));
  const b = new Map(spendByCategory(transactions, categories, previous.from, previous.to).map((r) => [r.category.id, r.total]));
  return categories
    .filter((c) => a.has(c.id) || b.has(c.id))
    .map((category) => {
      const cur = a.get(category.id) ?? 0;
      const prev = b.get(category.id) ?? 0;
      return { category, current: cur, previous: prev, change: cur - prev };
    })
    .sort((x, y) => y.current - x.current || y.previous - x.previous);
}

/** The period of the same length just before [from, to]. */
export function previousPeriod(from: ISODate, to: ISODate): { from: ISODate; to: ISODate } {
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

export interface CategoryTrend {
  category: Category;
  /** Oldest first, one per month. */
  months: Pence[];
  average: Pence;
}

/** Spending per category for each of the last `months` complete months plus this one. */
export function categoryTrends(transactions: Transaction[], categories: Category[], ref: ISODate, months = 12): CategoryTrend[] {
  const starts = Array.from({ length: months }, (_, i) => startOfMonth(shiftMonth(ref, i - months + 1)));
  const rows = categories
    .filter((c) => c.kind === 'expense' && !c.system)
    .map((category) => {
      const values = starts.map((m) => spendByCategory(transactions, [category], m, endOfMonth(m))[0]?.total ?? 0);
      // Average over months that have any data, so a new install is not diluted by empty months.
      const active = values.filter((v) => v > 0);
      return { category, months: values, average: active.length ? Math.round(active.reduce((s, v) => s + v, 0) / active.length) : 0 };
    });
  return rows.filter((r) => r.average > 0).sort((a, b) => b.average - a.average);
}

export interface YearReview {
  year: number;
  income: Pence;
  spending: Pence;
  saved: Pence;
  savingsRate: number | undefined;
  transactions: number;
  topCategories: CategoryTotal[];
  topPayees: PayeeTotal[];
  biggestMonth: { month: ISODate; spending: Pence } | undefined;
  bills: Pence;
}

export function yearReview(transactions: Transaction[], categories: Category[], year: number): YearReview {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  let income = 0;
  let spending = 0;
  let bills = 0;
  let count = 0;
  for (const t of transactions) {
    if (isTransfer(t) || !inRange(t, from, to)) continue;
    count += 1;
    if (t.amount > 0) income += t.amount;
    else {
      spending -= t.amount;
      if (t.recurringId) bills -= t.amount;
    }
  }
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`).map((m) => ({
    month: m,
    spending: transactions.reduce((s, t) => (!isTransfer(t) && t.amount < 0 && inRange(t, m, endOfMonth(m)) ? s - t.amount : s), 0),
  }));
  const biggest = months.reduce((a, b) => (b.spending > a.spending ? b : a));
  return {
    year,
    income,
    spending,
    saved: income - spending,
    savingsRate: income > 0 ? (income - spending) / income : undefined,
    transactions: count,
    topCategories: spendByCategory(transactions, categories, from, to).slice(0, 5),
    topPayees: topPayees(transactions, from, to, 5),
    biggestMonth: biggest.spending > 0 ? biggest : undefined,
    bills,
  };
}
