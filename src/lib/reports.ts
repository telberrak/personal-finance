import type { Category, Transaction } from '../db/types';
import { endOfMonth, shiftMonth, startOfMonth, type ISODate } from './dates';
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
