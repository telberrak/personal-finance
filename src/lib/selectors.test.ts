import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type FinanceData, type Recurring, type Transaction } from '../db/types';
import {
  accountBalance,
  billOccurrences,
  budgetProgress,
  dayToDaySpend,
  moneyInOut,
  overdueBills,
  safeToSpend,
  totalBalance,
} from './selectors';

const rule = (over: Partial<Recurring>): Recurring => ({
  id: 'r1',
  name: 'Council Tax',
  amount: 14800,
  frequency: 'monthly',
  startDate: '2026-01-15',
  method: 'direct-debit',
  accountId: 'a',
  categoryId: 'bills',
  active: true,
  ...over,
});
const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(),
  accountId: 'a',
  date: '2026-10-01',
  amount: -100,
  payee: 'X',
  categoryId: 'groceries',
  ...over,
});

describe('billOccurrences', () => {
  it('marks a bill paid when a linked payment lands within 3 days', () => {
    const rules = [rule({})];
    const late = billOccurrences(rules, [tx({ recurringId: 'r1', date: '2026-10-17', amount: -14800 })], '2026-10-01', '2026-10-31');
    expect(late).toMatchObject([{ rule: rules[0], date: '2026-10-15', paid: true }]);
    const tooLate = billOccurrences(rules, [tx({ recurringId: 'r1', date: '2026-10-20' })], '2026-10-01', '2026-10-31');
    expect(tooLate[0].paid).toBe(false);
  });

  it('skips inactive rules', () => {
    expect(billOccurrences([rule({ active: false })], [], '2026-10-01', '2026-10-31')).toEqual([]);
  });
});

const empty = { categories: [], budgets: [], rules: [], aliases: [], importBatches: [], goals: [], bankConnections: [] };

describe('safeToSpend', () => {
  it('subtracts unpaid bills before payday and savings, from everyday accounts only', () => {
    const data: FinanceData = {
      ...empty,
      accounts: [
        { id: 'a', name: 'Current', type: 'current', openingBalance: 148740, includeInSafeToSpend: true },
        { id: 's', name: 'Savings', type: 'savings', openingBalance: 500000, includeInSafeToSpend: false },
      ],
      transactions: [],
      recurring: [
        rule({}),
        rule({ id: 'r2', name: 'Rent', amount: 95000, startDate: '2026-01-01' }),
        rule({ id: 'r3', name: 'After payday', amount: 999, startDate: '2026-01-27' }),
        rule({ id: 'r4', name: 'Paused', amount: 5000, startDate: '2026-01-20', active: false }),
        rule({ id: 'r5', name: 'Ended', amount: 7000, startDate: '2026-01-20', endDate: '2026-09-30' }),
      ],
      settings: { ...DEFAULT_SETTINGS, payday: 25, monthlySavings: 20000 },
    };
    const s = safeToSpend(data, '2026-10-14');
    expect(s.balance).toBe(148740);
    expect(s.billsBeforePayday).toBe(14800); // rent (1st) is out of the window, the 27th is after payday
    expect(s.safe).toBe(148740 - 14800 - 20000);
    expect(s.daysToPayday).toBe(11);
  });
});

describe('spending', () => {
  const txs = [
    tx({ amount: -2340, categoryId: 'groceries', date: '2026-10-14' }),
    tx({ amount: -1199, categoryId: 'fun', recurringId: 'r9', date: '2026-10-13' }),
    tx({ amount: 4200, categoryId: 'refund', date: '2026-10-12' }),
    tx({ amount: -500, categoryId: 'groceries', date: '2026-09-30' }),
    tx({ amount: -10000, categoryId: 'transfer', transferId: 'x', date: '2026-10-10' }),
    tx({ amount: 10000, accountId: 's', categoryId: 'transfer', transferId: 'x', date: '2026-10-10' }),
  ];
  const current = { id: 'a', name: '', type: 'current' as const, openingBalance: 0, includeInSafeToSpend: true };
  const savings = { id: 's', name: '', type: 'savings' as const, openingBalance: 0, includeInSafeToSpend: false };

  it('excludes bill payments, income and transfers from day-to-day spend', () => {
    expect(dayToDaySpend(txs, '2026-10-01', '2026-10-31')).toBe(2340);
    expect(moneyInOut(txs, '2026-10-01', '2026-10-31')).toEqual({ moneyIn: 4200, moneyOut: 2340 + 1199 });
  });

  it('balances per account and in total', () => {
    expect(totalBalance({ accounts: [current, savings], transactions: txs }, 'all')).toBe(-2340 - 1199 + 4200 - 500);
    expect(totalBalance({ accounts: [current, savings], transactions: txs }, 'safe')).toBe(-2340 - 1199 + 4200 - 500 - 10000);
    expect(accountBalance(savings, txs)).toBe(10000);
  });

  it('tracks budget use per period, with refunds reducing spend', () => {
    const cats = [{ id: 'groceries', name: 'Groceries', color: 'groceries' as const, kind: 'expense' as const, order: 1 }];
    const withRefund = [...txs, tx({ amount: 340, categoryId: 'groceries', date: '2026-10-15' })];
    const [g] = budgetProgress([{ id: 'b', categoryId: 'groceries', monthlyLimit: 30000 }], cats, withRefund, {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(g.spent).toBe(2000);
    expect(g.remaining).toBe(28000);
  });

  it('rolls over what was left last period', () => {
    const cats = [{ id: 'groceries', name: 'Groceries', color: 'groceries' as const, kind: 'expense' as const, order: 1 }];
    const [g] = budgetProgress(
      [{ id: 'b', categoryId: 'groceries', monthlyLimit: 1000 }],
      cats,
      txs,
      { from: '2026-10-01', to: '2026-10-31' },
      { from: '2026-09-01', to: '2026-09-30' },
    );
    expect(g.rolledOver).toBe(500); // spent 500 of 1000 in September
    expect(g.limit).toBe(1500);
    expect(g.remaining).toBe(1500 - 2340);
  });
});

describe('overdueBills', () => {
  it('flags unpaid bills more than 3 days past due', () => {
    const rules = [rule({ startDate: '2026-10-10' })]; // first due 10 Oct, so earlier months do not count
    expect(overdueBills({ recurring: rules, transactions: [] }, '2026-10-12').length).toBe(0);
    expect(overdueBills({ recurring: rules, transactions: [] }, '2026-10-14').map((o) => o.date)).toEqual(['2026-10-10']);
    const paid = [tx({ recurringId: 'r1', date: '2026-10-11', amount: -14800 })];
    expect(overdueBills({ recurring: rules, transactions: paid }, '2026-10-14')).toEqual([]);
  });
});
