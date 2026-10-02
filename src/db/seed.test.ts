import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, shiftMonth, startOfMonth } from '../lib/dates';
import { detectRecurring } from '../lib/matching';
import { billOccurrences, totalBalance } from '../lib/selectors';
import { resetDb } from '../test/utils';
import { db } from './db';
import { eraseAllData, resetDemoData, startWithDemoData } from './repo';
import { seedDemoData } from './seed';

const REF = '2026-10-14';

beforeEach(resetDb);

const key = (t: { date: string; payee: string; amount: number }) => `${t.date}|${t.payee}|${t.amount}`;

describe('demo seed', () => {
  it('marks every bill due before today as paid, and none after', async () => {
    await seedDemoData(REF);
    const [recurring, transactions] = await Promise.all([db.recurring.toArray(), db.transactions.toArray()]);
    const past = billOccurrences(recurring, transactions, startOfMonth(shiftMonth(REF, -1)), addDays(REF, -1));
    expect(past.length).toBeGreaterThan(0);
    expect(past.every((o) => o.paid)).toBe(true);
    expect(billOccurrences(recurring, transactions, addDays(REF, 4), addDays(REF, 30)).some((o) => o.paid)).toBe(false);
  });

  it('includes a transfer pair, a savings account and a detectable subscription', async () => {
    await seedDemoData(REF);
    const [accounts, transactions, recurring] = await Promise.all([
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.recurring.toArray(),
    ]);
    const transfers = transactions.filter((t) => t.transferId);
    expect(transfers.length % 2).toBe(0);
    expect(transfers.reduce((s, t) => s + t.amount, 0)).toBe(0);
    expect(totalBalance({ accounts, transactions }, 'all')).toBeGreaterThan(totalBalance({ accounts, transactions }, 'safe'));
    expect(detectRecurring(transactions, recurring, REF).map((s) => s.payee)).toContain('Disney Plus');
    expect((await db.settings.get('app'))?.onboarded).toBe(true);
  });

  it('is deterministic apart from ids', async () => {
    await seedDemoData(REF);
    const first = (await db.transactions.toArray()).map(key).sort();
    await resetDb();
    await seedDemoData(REF);
    expect((await db.transactions.toArray()).map(key).sort()).toEqual(first);
  });

  it('erasing keeps a usable app; resetting brings the demo back', async () => {
    await startWithDemoData();
    await eraseAllData();
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.count()).toBe(1);
    expect(await db.categories.count()).toBeGreaterThan(0);
    expect((await db.settings.get('app'))?.onboarded).toBe(true);
    await resetDemoData();
    expect(await db.recurring.count()).toBe(8);
  });
});
