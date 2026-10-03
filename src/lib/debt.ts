/**
 * Debt maths: amortisation, payoff dates, extra-payment what-ifs and multi-debt payoff plans
 * (avalanche: highest interest first; snowball: smallest balance first). Monthly compounding at
 * APR / 12, amounts in pence, rounded each month like a lender would.
 */
import type { Pence } from './money';

export interface Debt {
  id: string;
  name: string;
  /** Amount owed (positive). */
  balance: Pence;
  /** Annual percentage rate, e.g. 22.9. */
  apr: number;
  /** Minimum or contractual monthly payment. */
  payment: Pence;
}

export interface Amortisation {
  /** Months until paid off; Infinity when the payment does not cover the interest. */
  months: number;
  totalInterest: Pence;
  schedule: { month: number; interest: Pence; principal: Pence; balance: Pence }[];
}

const MAX_MONTHS = 600; // 50 years

export const monthlyInterest = (balance: Pence, apr: number): Pence => Math.round((balance * apr) / 1200);

/** How a single debt pays off at a fixed monthly payment (plus an optional extra). */
export function amortise(balance: Pence, apr: number, payment: Pence, extra: Pence = 0): Amortisation {
  const schedule: Amortisation['schedule'] = [];
  let left = balance;
  let totalInterest = 0;
  for (let month = 1; left > 0 && month <= MAX_MONTHS; month++) {
    const interest = monthlyInterest(left, apr);
    const pay = Math.min(left + interest, payment + extra);
    if (pay <= interest) return { months: Infinity, totalInterest: Infinity, schedule };
    left = left + interest - pay;
    totalInterest += interest;
    schedule.push({ month, interest, principal: pay - interest, balance: left });
  }
  return { months: left > 0 ? Infinity : schedule.length, totalInterest, schedule };
}

export type Strategy = 'avalanche' | 'snowball';

export interface PayoffPlan {
  feasible: boolean;
  months: number;
  totalInterest: Pence;
  /** When each debt is cleared, in the order they are targeted. */
  order: { id: string; name: string; month: number }[];
}

/**
 * Pays every debt's minimum each month and puts the rest of `budget` on one target debt;
 * when a debt is cleared its payment rolls on to the next target.
 */
export function payoffPlan(debts: Debt[], budget: Pence, strategy: Strategy): PayoffPlan {
  const live = debts.filter((d) => d.balance > 0).map((d) => ({ ...d }));
  const minimums = live.reduce((s, d) => s + d.payment, 0);
  if (!live.length) return { feasible: true, months: 0, totalInterest: 0, order: [] };
  if (budget < minimums) return { feasible: false, months: Infinity, totalInterest: Infinity, order: [] };
  const rank = (a: Debt, b: Debt) =>
    strategy === 'avalanche' ? b.apr - a.apr || a.balance - b.balance : a.balance - b.balance || b.apr - a.apr;
  const order: PayoffPlan['order'] = [];
  let totalInterest = 0;
  for (let month = 1; month <= MAX_MONTHS; month++) {
    let money = budget;
    for (const d of live) {
      if (d.balance <= 0) continue;
      const interest = monthlyInterest(d.balance, d.apr);
      d.balance += interest;
      totalInterest += interest;
    }
    // Minimums first, then everything left to the target.
    for (const d of live) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.balance, d.payment, money);
      d.balance -= pay;
      money -= pay;
    }
    for (const d of [...live].filter((x) => x.balance > 0).sort(rank)) {
      if (money <= 0) break;
      const pay = Math.min(d.balance, money);
      d.balance -= pay;
      money -= pay;
    }
    for (const d of live) if (d.balance <= 0 && !order.some((o) => o.id === d.id)) order.push({ id: d.id, name: d.name, month });
    if (live.every((d) => d.balance <= 0)) return { feasible: true, months: month, totalInterest, order };
  }
  return { feasible: false, months: Infinity, totalInterest: Infinity, order };
}
