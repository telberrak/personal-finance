import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, shiftMonth, startOfMonth } from '../lib/dates';
import { billOccurrences } from '../lib/selectors';
import { resetDb } from '../test/utils';
import { db } from './db';
import { eraseAllData, resetDemoData, seedDemoData, seedIfEmpty } from './seed';

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

  it('is deterministic apart from ids', async () => {
    await seedDemoData(REF);
    const first = (await db.transactions.toArray()).map(key).sort();
    await resetDb();
    await seedDemoData(REF);
    expect((await db.transactions.toArray()).map(key).sort()).toEqual(first);
  });

  it('seeds only on first launch, so erased data stays erased', async () => {
    await seedIfEmpty();
    expect(await db.transactions.count()).toBeGreaterThan(0);
    await eraseAllData();
    await seedIfEmpty();
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.count()).toBe(1);
    expect(await db.categories.count()).toBeGreaterThan(0);
  });

  it('can reset back to demo data', async () => {
    await seedIfEmpty();
    await eraseAllData();
    await resetDemoData();
    expect(await db.recurring.count()).toBe(8);
  });
});
