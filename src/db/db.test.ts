import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { FinanceDB } from './db';

const NAME = 'ledger-migration-test';

afterEach(async () => {
  await Dexie.delete(NAME);
});

describe('schema migration', () => {
  it('upgrades a version 1 database without losing data', async () => {
    // Write data the way version 1 of the app did.
    const v1 = new Dexie(NAME);
    v1.version(1).stores({
      accounts: 'id',
      categories: 'id, order',
      transactions: 'id, date, accountId, categoryId, recurringId',
      recurring: 'id',
      budgets: 'id, categoryId',
      settings: 'id',
    });
    await v1.table('accounts').bulkPut([
      { id: 'current', name: 'Current account', type: 'current', openingBalance: 1000 },
      { id: 'card', name: 'Card', type: 'credit', openingBalance: -500 },
    ]);
    await v1
      .table('transactions')
      .put({ id: 't1', accountId: 'current', date: '2026-10-01', amount: -250, payee: 'Tesco', categoryId: 'groceries' });
    await v1.table('settings').put({ id: 'app', payday: 28, monthlySavings: 5000, theme: 'dark' });
    v1.close();

    const db = new FinanceDB(NAME);
    await db.open();
    expect(db.verno).toBe(2);
    expect(await db.transactions.get('t1')).toMatchObject({ payee: 'Tesco', amount: -250 });
    expect(await db.accounts.get('current')).toMatchObject({ includeInSafeToSpend: true });
    expect(await db.accounts.get('card')).toMatchObject({ includeInSafeToSpend: false });
    expect(await db.categories.get('transfer')).toMatchObject({ system: true });
    expect(await db.settings.get('app')).toMatchObject({ payday: 28, theme: 'dark', onboarded: true, budgetPeriod: 'month' });
    expect(await db.transactions.where('transferId').equals('x').count()).toBe(0); // the new index works
    db.close();
  });
});
