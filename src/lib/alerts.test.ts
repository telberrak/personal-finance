import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type FinanceData, type Recurring, type Transaction } from '../db/types';
import { computeAlerts, deliverable, genericText, outsideQuietHours } from './alerts';

const bill = (over: Partial<Recurring> = {}): Recurring => ({
  id: 'r1',
  name: 'Netflix',
  amount: 1099,
  frequency: 'monthly',
  startDate: '2026-09-15',
  method: 'card',
  accountId: 'a',
  categoryId: 'bills',
  active: true,
  ...over,
});

const tx = (id: string, date: string, amount: number, payee = 'Tesco'): Transaction => ({
  id,
  accountId: 'a',
  date,
  amount,
  payee,
  categoryId: 'groceries',
});

function data(over: Partial<FinanceData> = {}): FinanceData {
  return {
    accounts: [{ id: 'a', name: 'Current', type: 'current', openingBalance: 500_000, includeInSafeToSpend: true }],
    categories: [{ id: 'groceries', name: 'Groceries', color: 'groceries', kind: 'expense', order: 1 }],
    transactions: [],
    recurring: [],
    budgets: [],
    rules: [],
    aliases: [],
    importBatches: [],
    goals: [],
    bankConnections: [],
    people: [],
    ious: [],
    settings: { ...DEFAULT_SETTINGS, onboarded: true, payday: 28, lowBalanceThreshold: 0 },
    ...over,
  };
}

const now = new Date(2026, 9, 14, 12, 0); // 14 October 2026, noon
const ids = (d: FinanceData) => computeAlerts(d, now).map((a) => a.id);

describe('alerts', () => {
  it('warns the day before a bill at 9am, not once it is paid', () => {
    const alerts = computeAlerts(data({ recurring: [bill()] }), now);
    const due = alerts.find((a) => a.id === 'billDue:r1:2026-10-15')!;
    expect(due.title).toBe('Netflix is due tomorrow');
    expect(new Date(due.at)).toEqual(new Date(2026, 9, 14, 9, 0));
    const paid = { ...tx('p', '2026-10-15', -1099, 'Netflix'), recurringId: 'r1' };
    expect(ids(data({ recurring: [bill()], transactions: [paid] }))).not.toContain('billDue:r1:2026-10-15');
  });

  it('reminds about free trials and yearly renewals ahead of time', () => {
    const d = data({
      recurring: [bill({ id: 't', trialEndsOn: '2026-10-18' }), bill({ id: 'y', frequency: 'yearly', startDate: '2025-10-20' })],
    });
    const alerts = computeAlerts(d, now);
    expect(new Date(alerts.find((a) => a.id === 'trial:t:2026-10-18')!.at)).toEqual(new Date(2026, 9, 16, 9, 0));
    expect(new Date(alerts.find((a) => a.id === 'renewal:y:2026-10-20')!.at)).toEqual(new Date(2026, 9, 13, 9, 0));
  });

  it('flags budgets at 80% and 100%, low forecasts and unusual payments', () => {
    const history = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].map((d, i) => tx(`h${i}`, d, -2000));
    const d = data({
      budgets: [{ id: 'b', categoryId: 'groceries', monthlyLimit: 10_000 }],
      transactions: [...history, tx('big', '2026-10-13', -8500)],
      settings: { ...data().settings, lowBalanceThreshold: 10_000_000 },
    });
    const list = ids(d);
    expect(list).toContain('budget80:groceries:2026-10-01');
    expect(list).toContain('unusual:big');
    expect(list.some((id) => id.startsWith('low:'))).toBe(true);
  });

  it('honours types switched off and quiet hours', () => {
    const alerts = computeAlerts(data({ recurring: [bill()] }), now);
    expect(
      deliverable(alerts, { enabled: true, off: ['billDue'], quietStart: '22:00', quietEnd: '07:00' }).some((a) => a.type === 'billDue'),
    ).toBe(false);
    // 23:30 falls in quiet hours that cross midnight: moved to 07:00 the next day.
    expect(new Date(outsideQuietHours(new Date(2026, 9, 14, 23, 30).getTime(), '22:00', '07:00'))).toEqual(new Date(2026, 9, 15, 7, 0));
    expect(new Date(outsideQuietHours(new Date(2026, 9, 15, 6, 0).getTime(), '22:00', '07:00'))).toEqual(new Date(2026, 9, 15, 7, 0));
    expect(new Date(outsideQuietHours(new Date(2026, 9, 15, 13, 0).getTime(), '12:00', '14:00'))).toEqual(new Date(2026, 9, 15, 14, 0));
    const noon = new Date(2026, 9, 15, 12, 0).getTime();
    expect(outsideQuietHours(noon, '22:00', '07:00')).toBe(noon);
  });

  it('pushes only generic text', () => {
    const text = genericText('billDue');
    expect(text.title).toBe('A bill is due tomorrow');
    expect(JSON.stringify(text)).not.toMatch(/Netflix|£/);
  });
});
