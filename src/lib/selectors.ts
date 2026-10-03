import type { Account, Budget, Category, FinanceData, Recurring, Transaction } from '../db/types';
import { addDays, daysBetween, endOfMonth, shiftMonth, startOfMonth, type ISODate } from './dates';
import type { Pence } from './money';
import type { Period } from './periods';
import { nextPayday, occurrencesBetween } from './recurring';

/** A bill payment can land a few days either side of its due date (weekends, bank holidays). */
export const MATCH_WINDOW_DAYS = 3;

/** Moving money between your own accounts is neither spending nor income. */
export const isTransfer = (t: Transaction) => !!t.transferId;

export function inRange(t: { date: ISODate }, from: ISODate, to: ISODate): boolean {
  return t.date >= from && t.date <= to;
}

/**
 * An account's balance at the end of `date` (default: now). For valued accounts (investments,
 * pensions, property) the latest valuation on or before the date counts, plus any transactions after it.
 */
export function accountBalance(account: Account, transactions: Transaction[], date: ISODate = '9999-12-31'): Pence {
  const sorted = [...(account.valuations ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  // Before the first valuation the value is unknown: the earliest one is the best guess.
  const valuation = sorted.filter((v) => v.date <= date).at(-1) ?? sorted[0];
  const start = valuation ? valuation.value : account.openingBalance;
  return transactions.reduce(
    (sum, t) => (t.accountId === account.id && t.date <= date && (!valuation || t.date > valuation.date) ? sum + t.amount : sum),
    start,
  );
}

/** Total across accounts; by default only those counted in "safe to spend". */
export function totalBalance(data: Pick<FinanceData, 'accounts' | 'transactions'>, which: 'safe' | 'all' = 'safe'): Pence {
  const accounts = data.accounts.filter((a) => !a.archived && (which === 'all' || a.includeInSafeToSpend !== false));
  return accounts.reduce((sum, a) => sum + accountBalance(a, data.transactions), 0);
}

/** Day-to-day spending: money out that is not a bill payment or transfer. Returned as a positive amount. */
export function dayToDaySpend(transactions: Transaction[], from: ISODate, to: ISODate): Pence {
  return transactions.reduce(
    (sum, t) => (t.amount < 0 && !t.recurringId && !isTransfer(t) && inRange(t, from, to) ? sum - t.amount : sum),
    0,
  );
}

export function moneyInOut(transactions: Transaction[], from: ISODate, to: ISODate): { moneyIn: Pence; moneyOut: Pence } {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const t of transactions) {
    if (isTransfer(t) || !inRange(t, from, to)) continue;
    if (t.amount > 0) moneyIn += t.amount;
    else moneyOut -= t.amount;
  }
  return { moneyIn, moneyOut };
}

export interface BillOccurrence {
  rule: Recurring;
  date: ISODate;
  paid: boolean;
  /** The linked payment, when paid. */
  transactionId?: string;
}

/** Every due date of the active recurring payments within [from, to], marked paid when a matching transaction exists. */
export function billOccurrences(recurring: Recurring[], transactions: Transaction[], from: ISODate, to: ISODate): BillOccurrence[] {
  const paymentsByRule = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.recurringId) continue;
    const list = paymentsByRule.get(t.recurringId) ?? [];
    list.push(t);
    paymentsByRule.set(t.recurringId, list);
  }

  const out: BillOccurrence[] = [];
  for (const rule of recurring) {
    if (!rule.active) continue;
    const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
    const payments = paymentsByRule.get(rule.id) ?? [];
    for (const date of occurrencesBetween(rule, from, end)) {
      const payment = payments.find((p) => Math.abs(daysBetween(date, p.date)) <= MATCH_WINDOW_DAYS);
      out.push({ rule, date, paid: !!payment, transactionId: payment?.id });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rule.name.localeCompare(b.rule.name)));
}

/**
 * Unpaid bills whose due date (plus the matching window) has passed, within the last month.
 * Older gaps are usually from before you started tracking, not missed payments.
 */
export function overdueBills(data: Pick<FinanceData, 'recurring' | 'transactions'>, ref: ISODate): BillOccurrence[] {
  return billOccurrences(data.recurring, data.transactions, addDays(ref, -31), addDays(ref, -1)).filter(
    (o) => !o.paid && daysBetween(o.date, ref) > MATCH_WINDOW_DAYS,
  );
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

/** Balance of the everyday accounts, minus unpaid bills due before the next payday, minus the savings set aside. */
export function safeToSpend(data: FinanceData, ref: ISODate): SafeToSpend {
  const balance = totalBalance(data, 'safe');
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
    if (t.amount < 0 && !t.recurringId && !isTransfer(t) && inRange(t, from, last)) out[daysBetween(from, t.date)] -= t.amount;
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
  /** The limit for this period, including anything rolled over. */
  limit: Pence;
  rolledOver: Pence;
  remaining: Pence;
  ratio: number;
}

function spentIn(transactions: Transaction[], categoryId: string, from: ISODate, to: ISODate): Pence {
  // Refunds in a category reduce what was spent in it.
  return transactions.reduce((sum, t) => (t.categoryId === categoryId && !isTransfer(t) && inRange(t, from, to) ? sum - t.amount : sum), 0);
}

/**
 * Spending against each budget in a period. With `previous`, last period's unspent (or overspent)
 * amount is carried into this one.
 */
export function budgetProgress(
  budgets: Budget[],
  categories: Category[],
  transactions: Transaction[],
  period: Pick<Period, 'from' | 'to'>,
  previous?: Pick<Period, 'from' | 'to'>,
): BudgetProgress[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rows = budgets.flatMap((budget) => {
    const category = byId.get(budget.categoryId);
    if (!category || category.archived) return [];
    const spent = Math.max(0, spentIn(transactions, budget.categoryId, period.from, period.to));
    const rolledOver = previous
      ? budget.monthlyLimit - Math.max(0, spentIn(transactions, budget.categoryId, previous.from, previous.to))
      : 0;
    const limit = budget.monthlyLimit + rolledOver;
    return [{ budget, category, spent, limit, rolledOver, remaining: limit - spent, ratio: limit > 0 ? spent / limit : spent > 0 ? 1 : 0 }];
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
