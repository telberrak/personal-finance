import type { Recurring, Transaction } from '../db/types';
import { addDays, daysBetween, type ISODate } from './dates';
import type { Pence } from './money';
import { payeeKey, payeesSimilar } from './payees';
import { occurrencesBetween, type Frequency } from './recurring';

const WINDOW = 3;
/** A bill amount may drift (energy, water) — allow 25% either way when matching. */
const AMOUNT_TOLERANCE = 0.25;

/**
 * The bill a payment most likely pays: similar payee, close amount, and an unpaid due date
 * within 3 days. `taken` holds "ruleId|date" occurrences already paid, so a bill is matched once.
 */
export function findBillMatch(
  tx: Pick<Transaction, 'date' | 'amount' | 'payee'>,
  recurring: Recurring[],
  taken: Set<string>,
): { rule: Recurring; occurrence: ISODate } | undefined {
  if (tx.amount >= 0) return undefined;
  const paid = -tx.amount;
  for (const rule of recurring) {
    if (!rule.active || !payeesSimilar(tx.payee, rule.name)) continue;
    if (Math.abs(paid - rule.amount) > rule.amount * AMOUNT_TOLERANCE) continue;
    const occurrence = occurrencesBetween(rule, addDays(tx.date, -WINDOW), addDays(tx.date, WINDOW)).find(
      (d) => !taken.has(`${rule.id}|${d}`),
    );
    if (occurrence) return { rule, occurrence };
  }
  return undefined;
}

/** "ruleId|date" for every bill occurrence that already has a linked payment. */
export function paidOccurrenceKeys(recurring: Recurring[], transactions: Transaction[]): Set<string> {
  const keys = new Set<string>();
  const byId = new Map(recurring.map((r) => [r.id, r]));
  for (const t of transactions) {
    const rule = t.recurringId ? byId.get(t.recurringId) : undefined;
    if (!rule) continue;
    const occ = occurrencesBetween(rule, addDays(t.date, -WINDOW), addDays(t.date, WINDOW))[0];
    if (occ) keys.add(`${rule.id}|${occ}`);
  }
  return keys;
}

/** A regular payment that looks like a bill but is not one yet. */
export interface RecurringSuggestion {
  key: string;
  payee: string;
  amount: Pence;
  frequency: Frequency;
  lastDate: ISODate;
  /** Day the next payment is expected. */
  nextDate: ISODate;
  count: number;
  categoryId: string;
  accountId: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Spots payments that repeat at a steady rhythm but are not set up as bills yet:
 * three or more payments to the same payee, a week or a month apart, with similar amounts.
 */
export function detectRecurring(transactions: Transaction[], recurring: Recurring[], ref: ISODate): RecurringSuggestion[] {
  const since = addDays(ref, -200);
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.transferId || t.recurringId || t.date < since || t.date > ref) continue;
    const key = payeeKey(t.payee);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const out: RecurringSuggestion[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    if (recurring.some((r) => payeesSimilar(r.name, list[0].payee))) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((t, i) => daysBetween(sorted[i].date, t.date));
    let frequency: Frequency | undefined;
    if (gaps.every((g) => g >= 26 && g <= 35)) frequency = 'monthly';
    else if (gaps.every((g) => g >= 6 && g <= 8)) frequency = 'weekly';
    if (!frequency) continue;
    const amounts = sorted.map((t) => -t.amount);
    const typical = median(amounts);
    if (amounts.some((a) => Math.abs(a - typical) > typical * 0.2)) continue;
    const last = sorted[sorted.length - 1];
    if (daysBetween(last.date, ref) > (frequency === 'monthly' ? 40 : 10)) continue;
    const next = occurrencesBetween({ startDate: last.date, frequency }, addDays(last.date, 1), addDays(last.date, 40))[0];
    out.push({
      key,
      payee: last.payee,
      amount: typical,
      frequency,
      lastDate: last.date,
      nextDate: next ?? addDays(last.date, frequency === 'weekly' ? 7 : 30),
      count: sorted.length,
      categoryId: last.categoryId,
      accountId: last.accountId,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
