/** Net worth: what you own minus what you owe, now and over time. */
import { LIABILITY_TYPES, type Account, type FinanceData } from '../db/types';
import { endOfMonth, shiftMonth, type ISODate } from './dates';
import type { Debt } from './debt';
import type { Pence } from './money';
import { accountBalance } from './selectors';

/** Whether an account is a debt (its balance counts against net worth). */
export const isLiability = (a: Account) => LIABILITY_TYPES.includes(a.type);

/** Assets, debts and their difference on a date. */
export interface NetWorth {
  assets: Pence;
  liabilities: Pence;
  net: Pence;
  rows: { account: Account; balance: Pence; liability: boolean }[];
}

/** Net worth on a date (today by default), from every account that is not archived. */
export function netWorth(data: Pick<FinanceData, 'accounts' | 'transactions'>, date?: ISODate): NetWorth {
  const rows = data.accounts
    .filter((a) => !a.archived)
    .map((account) => ({ account, balance: accountBalance(account, data.transactions, date), liability: isLiability(account) }));
  // A liability is owed money (negative); an overdrawn current account also counts against you.
  const assets = rows.reduce((s, r) => (r.balance > 0 ? s + r.balance : s), 0);
  const liabilities = rows.reduce((s, r) => (r.balance < 0 ? s - r.balance : s), 0);
  return { assets, liabilities, net: assets - liabilities, rows };
}

/** Net worth at the end of each of the last `months` months, then today. */
export function netWorthHistory(
  data: Pick<FinanceData, 'accounts' | 'transactions'>,
  ref: ISODate,
  months = 12,
): { date: ISODate; balance: Pence }[] {
  const points = [];
  for (let i = months; i >= 1; i--) {
    const date = endOfMonth(shiftMonth(ref, -i));
    points.push({ date, balance: netWorth(data, date).net });
  }
  points.push({ date: ref, balance: netWorth(data).net });
  return points;
}

/**
 * Debts for the payoff planner. Credit cards without a set minimum use the common UK rule:
 * 1% of the balance plus interest, at least £25.
 */
export function debtsOf(data: Pick<FinanceData, 'accounts' | 'transactions'>): Debt[] {
  return data.accounts
    .filter((a) => !a.archived && isLiability(a))
    .flatMap((a) => {
      const owed = -accountBalance(a, data.transactions);
      if (owed <= 0) return [];
      const apr = a.apr ?? 0;
      const payment =
        a.type === 'credit'
          ? (a.credit?.minPayment ?? Math.max(2500, Math.round(owed * 0.01 + (owed * apr) / 1200)))
          : (a.monthlyPayment ?? Math.max(2500, Math.round(owed * 0.02)));
      return [{ id: a.id, name: a.name, balance: owed, apr, payment }];
    });
}
