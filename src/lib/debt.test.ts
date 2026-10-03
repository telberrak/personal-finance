import { describe, expect, it } from 'vitest';
import { amortise, payoffPlan, type Debt } from './debt';

describe('amortise', () => {
  it('pays off a loan with the standard schedule', () => {
    // £10,000 at 6% over about 5 years needs £193.33 a month.
    const r = amortise(1_000_000, 6, 19_333);
    expect(r.months).toBe(60);
    expect(r.totalInterest).toBeGreaterThan(159_000);
    expect(r.totalInterest).toBeLessThan(161_000);
    expect(r.schedule.at(-1)!.balance).toBe(0);
  });

  it('shows what an extra payment saves', () => {
    const base = amortise(1_000_000, 6, 19_333);
    const extra = amortise(1_000_000, 6, 19_333, 10_000);
    expect(extra.months).toBeLessThan(base.months);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
  });

  it('knows when a payment never clears the debt', () => {
    expect(amortise(500_000, 24, 9_000).months).toBe(Infinity); // £100 interest a month, £90 paid
    expect(amortise(0, 24, 9_000).months).toBe(0);
  });
});

describe('payoffPlan', () => {
  const debts: Debt[] = [
    { id: 'card', name: 'Card', balance: 300_000, apr: 24, payment: 9_000 },
    { id: 'loan', name: 'Loan', balance: 80_000, apr: 7, payment: 5_000 },
  ];

  it('avalanche pays less interest; snowball clears a debt sooner', () => {
    const avalanche = payoffPlan(debts, 40_000, 'avalanche');
    const snowball = payoffPlan(debts, 40_000, 'snowball');
    expect(avalanche.feasible && snowball.feasible).toBe(true);
    expect(avalanche.totalInterest).toBeLessThan(snowball.totalInterest);
    expect(avalanche.order[0].id).toBe('card');
    expect(snowball.order[0].id).toBe('loan');
    expect(snowball.order[0].month).toBeLessThan(avalanche.order.find((o) => o.id === 'loan')!.month);
  });

  it('is not feasible below the minimum payments', () => {
    expect(payoffPlan(debts, 10_000, 'avalanche').feasible).toBe(false);
  });
});
