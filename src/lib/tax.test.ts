import { describe, expect, it } from 'vitest';
import type { Transaction } from '../db/types';
import { calendarMonth } from './calendar';
import { comparePeriods, previousPeriod, yearReview } from './reports';
import { taxSummary, taxSystem, taxYearOf, taxYearRange } from './tax';

const tx = (date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `${date}${amount}`,
  accountId: 'a',
  date,
  amount,
  payee: 'X',
  categoryId: 'groceries',
  ...extra,
});

describe('tax helper', () => {
  it('uses the UK tax year (6 April) and the French calendar year', () => {
    const gb = taxSystem('GB');
    expect(taxYearOf(gb, '2026-04-05')).toBe(2025);
    expect(taxYearOf(gb, '2026-04-06')).toBe(2026);
    expect(taxYearRange(gb, 2026)).toEqual({ from: '2026-04-06', to: '2027-04-05' });
    expect(taxYearRange(taxSystem('FR'), 2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('totals marked transactions per heading within the year', () => {
    const gb = taxSystem('GB');
    const list = [
      tx('2026-05-01', 120_000, { tax: 'gb-se-income' }),
      tx('2026-06-01', -3_000, { tax: 'gb-se-expense' }),
      tx('2027-05-01', 50_000, { tax: 'gb-se-income' }),
    ];
    const summary = taxSummary(list, gb, 2026);
    expect(summary.find((s) => s.heading.id === 'gb-se-income')?.total).toBe(120_000);
    expect(summary.find((s) => s.heading.id === 'gb-se-expense')?.total).toBe(3_000);
  });
});

describe('reports', () => {
  const cats = [{ id: 'groceries', name: 'Groceries', color: 'groceries' as const, kind: 'expense' as const, order: 1 }];
  it('compares a period with the one before it', () => {
    expect(previousPeriod('2026-10-01', '2026-10-31')).toEqual({ from: '2026-08-31', to: '2026-09-30' });
    const rows = comparePeriods(
      [tx('2026-10-05', -5000), tx('2026-09-10', -2000)],
      cats,
      { from: '2026-10-01', to: '2026-10-31' },
      { from: '2026-09-01', to: '2026-09-30' },
    );
    expect(rows[0]).toMatchObject({ current: 5000, previous: 2000, change: 3000 });
  });

  it('summarises a year', () => {
    const r = yearReview(
      [tx('2026-03-01', 200_000), tx('2026-03-02', -50_000, { recurringId: 'r' }), tx('2026-07-02', -10_000)],
      cats,
      2026,
    );
    expect(r).toMatchObject({ income: 200_000, spending: 60_000, saved: 140_000, bills: 50_000, transactions: 3 });
    expect(r.biggestMonth?.month).toBe('2026-03-01');
  });
});

describe('calendar', () => {
  it('lays out whole weeks starting on Monday with bills, paydays and balances', () => {
    const data = {
      accounts: [{ id: 'a', name: 'Current', type: 'current' as const, openingBalance: 100_000, includeInSafeToSpend: true }],
      categories: [],
      transactions: [tx('2026-10-02', -2_000)],
      recurring: [
        {
          id: 'r',
          name: 'Rent',
          amount: 80_000,
          frequency: 'monthly' as const,
          startDate: '2026-01-20',
          method: 'standing-order' as const,
          accountId: 'a',
          categoryId: 'bills',
          active: true,
        },
      ],
      budgets: [],
      rules: [],
      aliases: [],
      importBatches: [],
      goals: [],
      bankConnections: [],
      people: [],
      ious: [],
      settings: {
        id: 'app' as const,
        onboarded: true,
        payday: 25,
        monthlySavings: 0,
        theme: 'system' as const,
        language: 'en',
        currency: 'GBP',
        budgetPeriod: 'month' as const,
        budgetRollover: false,
        lowBalanceThreshold: 10_000,
        lockAfterMinutes: 5,
      },
    };
    const weeks = calendarMonth(data, '2026-10-01', '2026-10-14');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0].date).toBe('2026-09-28'); // a Monday
    const days = weeks.flat();
    expect(days.find((d) => d.date === '2026-10-20')?.bills[0].rule.name).toBe('Rent');
    expect(days.find((d) => d.date === '2026-10-25')?.payday).toBe(true);
    expect(days.find((d) => d.date === '2026-10-02')).toMatchObject({ spending: 2_000, balance: 98_000, forecast: false });
    expect(days.find((d) => d.date === '2026-10-20')?.forecast).toBe(true);
  });
});
