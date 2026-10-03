import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type FinanceData, type Recurring, type Rule, type Transaction } from '../db/types';
import { addDays } from './dates';
import { forecastBalance } from './forecast';
import { detectRecurring, findBillMatch, paidOccurrenceKeys } from './matching';
import { periodFor, shiftPeriod } from './periods';
import { monthlyTotals, spendByCategory, topPayees } from './reports';
import { findRule, suggestCategory } from './rules';

let n = 0;
const tx = (over: Partial<Transaction>): Transaction => ({
  id: String(++n),
  accountId: 'a',
  date: '2026-10-01',
  amount: -100,
  payee: 'X',
  categoryId: 'groceries',
  ...over,
});
const bill = (over: Partial<Recurring>): Recurring => ({
  id: 'r1',
  name: 'Octopus Energy',
  amount: 8600,
  frequency: 'monthly',
  startDate: '2026-01-18',
  method: 'direct-debit',
  accountId: 'a',
  categoryId: 'bills',
  active: true,
  ...over,
});

describe('periods', () => {
  it('uses calendar months', () => {
    expect(periodFor('2026-10-14', 'month', 25)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
  });
  it('runs payday to the day before the next payday', () => {
    expect(periodFor('2026-10-14', 'payday', 25)).toMatchObject({ from: '2026-09-25', to: '2026-10-24' });
    expect(periodFor('2026-10-25', 'payday', 25)).toMatchObject({ from: '2026-10-25', to: '2026-11-24' });
    expect(periodFor('2026-03-05', 'payday', 31)).toMatchObject({ from: '2026-02-28', to: '2026-03-30' });
    const p = periodFor('2026-10-14', 'payday', 25);
    expect(shiftPeriod(p, -1, 'payday', 25)).toMatchObject({ from: '2026-08-25', to: '2026-09-24' });
    expect(shiftPeriod(p, 1, 'payday', 25)).toMatchObject({ from: '2026-10-25', to: '2026-11-24' });
  });
});

describe('rules', () => {
  const rules: Rule[] = [
    { id: '1', match: 'contains', pattern: 'tesco', categoryId: 'groceries', priority: 2 },
    { id: '2', match: 'startsWith', pattern: 'Tesco Petrol', categoryId: 'transport', priority: 1 },
    { id: '3', match: 'exact', pattern: 'salary', categoryId: 'salary', priority: 3 },
  ];
  it('picks the highest-priority matching rule', () => {
    expect(findRule(rules, 'TESCO PETROL 123')?.categoryId).toBe('transport');
    expect(findRule(rules, 'Tesco Express')?.categoryId).toBe('groceries');
    expect(findRule(rules, 'Salary from work')).toBeUndefined();
  });
  it('falls back to the last category used for the payee', () => {
    const history = [tx({ payee: 'Pret', categoryId: 'eating' }), tx({ payee: 'Pret', categoryId: 'groceries' })];
    expect(suggestCategory('pret', [], history, new Set(['eating', 'groceries']))).toBe('eating');
    expect(suggestCategory('pret', [], history, new Set(['groceries']))).toBe('groceries');
    expect(suggestCategory('Tesco', rules, history, new Set(['eating']))).toBeUndefined();
  });
});

describe('bill matching', () => {
  it('matches a similar payee and amount within 3 days, once per due date', () => {
    const rules = [bill({})];
    const taken = new Set<string>();
    const m = findBillMatch({ date: '2026-10-19', amount: -8650, payee: 'OCTOPUS ENERGY LTD' }, rules, taken);
    expect(m).toMatchObject({ rule: { id: 'r1' }, occurrence: '2026-10-18' });
    taken.add('r1|2026-10-18');
    expect(findBillMatch({ date: '2026-10-19', amount: -8600, payee: 'Octopus Energy' }, rules, taken)).toBeUndefined();
    expect(findBillMatch({ date: '2026-10-25', amount: -8600, payee: 'Octopus Energy' }, rules, new Set())).toBeUndefined();
    expect(findBillMatch({ date: '2026-10-18', amount: -20000, payee: 'Octopus Energy' }, rules, new Set())).toBeUndefined();
  });

  it('knows which due dates are already paid', () => {
    const keys = paidOccurrenceKeys([bill({})], [tx({ recurringId: 'r1', date: '2026-10-17' })]);
    expect([...keys]).toEqual(['r1|2026-10-18']);
  });
});

describe('detectRecurring', () => {
  const ref = '2026-10-14';
  it('suggests steady monthly payments that are not bills yet', () => {
    const txs = ['2026-07-09', '2026-08-09', '2026-09-09', '2026-10-09'].map((date) =>
      tx({ date, amount: -799, payee: 'Disney Plus', categoryId: 'fun' }),
    );
    const [s] = detectRecurring(txs, [], ref);
    expect(s).toMatchObject({ payee: 'Disney Plus', amount: 799, frequency: 'monthly', count: 4, nextDate: '2026-11-09' });
  });

  it('ignores irregular payees, existing bills and stale ones', () => {
    const coffee = ['2026-10-01', '2026-10-03', '2026-10-10', '2026-10-11'].map((date) => tx({ date, payee: 'Coffee' }));
    const existing = ['2026-07-18', '2026-08-18', '2026-09-18'].map((date) => tx({ date, payee: 'Octopus Energy', amount: -8600 }));
    const stale = ['2026-03-02', '2026-04-02', '2026-05-02'].map((date) => tx({ date, payee: 'Old Gym', amount: -2000 }));
    expect(detectRecurring([...coffee, ...existing, ...stale], [bill({})], ref)).toEqual([]);
  });
});

describe('reports', () => {
  const cats = [
    { id: 'groceries', name: 'Groceries', color: 'groceries' as const, kind: 'expense' as const, order: 1 },
    { id: 'eating', name: 'Eating out', color: 'eating' as const, kind: 'expense' as const, order: 2 },
    { id: 'salary', name: 'Salary', color: 'income' as const, kind: 'income' as const, order: 3 },
  ];
  const txs = [
    tx({ date: '2026-10-02', amount: -3000, payee: 'Tesco' }),
    tx({ date: '2026-10-03', amount: -1000, payee: 'Tesco' }),
    tx({ date: '2026-10-04', amount: -1000, payee: 'Pret', categoryId: 'eating' }),
    tx({ date: '2026-09-25', amount: 200000, payee: 'Salary', categoryId: 'salary' }),
    tx({ date: '2026-10-05', amount: -5000, payee: 'Transfer', categoryId: 'transfer', transferId: 't' }),
  ];
  it('splits spending by category', () => {
    const rows = spendByCategory(txs, cats, '2026-10-01', '2026-10-31');
    expect(rows.map((r) => [r.category.id, r.total, r.share])).toEqual([
      ['groceries', 4000, 0.8],
      ['eating', 1000, 0.2],
    ]);
  });
  it('totals each month and ranks payees', () => {
    const months = monthlyTotals(txs, '2026-10-14', 2);
    expect(months).toEqual([
      { month: '2026-09-01', income: 200000, spending: 0 },
      { month: '2026-10-01', income: 0, spending: 5000 },
    ]);
    expect(topPayees(txs, '2026-10-01', '2026-10-31')[0]).toEqual({ payee: 'Tesco', total: 4000, count: 2 });
  });
});

describe('forecastBalance', () => {
  it('subtracts bills and daily spend, and adds pay on payday', () => {
    const ref = '2026-10-14';
    const history = Array.from({ length: 30 }, (_, i) => tx({ date: addDays(ref, -1 - i), amount: -1000 }));
    const data: FinanceData = {
      accounts: [{ id: 'a', name: 'Current', type: 'current', openingBalance: 130000, includeInSafeToSpend: true }],
      categories: [],
      bankConnections: [],
      transactions: [
        ...history,
        tx({ date: '2026-08-25', amount: 200000, payee: 'Salary' }),
        tx({ date: '2026-09-25', amount: 200000, payee: 'Salary' }),
      ],
      recurring: [bill({})],
      budgets: [],
      rules: [],
      aliases: [],
      importBatches: [],
      goals: [],
      settings: { ...DEFAULT_SETTINGS, payday: 25 },
    };
    const f = forecastBalance(data, ref, 15);
    expect(f.avgDailySpend).toBe(1000);
    expect(f.expectedIncome).toBe(200000);
    const start = 130000 - 30000 + 400000;
    const at = (d: string) => f.points.find((p) => p.date === d)!.balance;
    expect(at(ref)).toBe(start);
    expect(at('2026-10-18')).toBe(start - 4 * 1000 - 8600);
    expect(at('2026-10-25')).toBe(start - 11 * 1000 - 8600 + 200000);
    expect(f.lowest.date).toBe('2026-10-24');
  });
});
