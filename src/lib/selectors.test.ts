import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type FinanceData, type Recurring, type Transaction } from '../db/types';
import { billOccurrences, budgetProgress, dayToDaySpend, safeToSpend, totalBalance } from './selectors';

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
    expect(late).toEqual([{ rule: rules[0], date: '2026-10-15', paid: true }]);
    const tooLate = billOccurrences(rules, [tx({ recurringId: 'r1', date: '2026-10-20' })], '2026-10-01', '2026-10-31');
    expect(tooLate[0].paid).toBe(false);
  });

  it('skips inactive rules', () => {
    expect(billOccurrences([rule({ active: false })], [], '2026-10-01', '2026-10-31')).toEqual([]);
  });
});

describe('safeToSpend', () => {
  it('subtracts unpaid bills before payday and savings', () => {
    const data: FinanceData = {
      accounts: [{ id: 'a', name: 'Current', type: 'current', openingBalance: 148740 }],
      categories: [],
      transactions: [],
      recurring: [
        rule({}),
        rule({ id: 'r2', name: 'Rent', amount: 95000, startDate: '2026-01-01' }),
        rule({ id: 'r3', name: 'After payday', amount: 999, startDate: '2026-01-27' }),
      ],
      budgets: [],
      settings: { ...DEFAULT_SETTINGS, payday: 25, monthlySavings: 20000 },
    };
    const s = safeToSpend(data, '2026-10-14');
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
  ];

  it('excludes bill payments and income from day-to-day spend', () => {
    expect(dayToDaySpend(txs, '2026-10-01', '2026-10-31')).toBe(2340);
    expect(totalBalance({ accounts: [{ id: 'a', name: '', type: 'current', openingBalance: 0 }], transactions: txs })).toBe(
      -2340 - 1199 + 4200 - 500,
    );
  });

  it('tracks budget use per month', () => {
    const [g] = budgetProgress(
      [{ id: 'b', categoryId: 'groceries', monthlyLimit: 30000 }],
      [{ id: 'groceries', name: 'Groceries', color: 'groceries', kind: 'expense', order: 1 }],
      txs,
      '2026-10-05',
    );
    expect(g.spent).toBe(2340);
    expect(g.remaining).toBe(27660);
  });
});
