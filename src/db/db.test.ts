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
    expect(db.verno).toBe(5);
    expect(await db.transactions.get('t1')).toMatchObject({ payee: 'Tesco', amount: -250 });
    expect(await db.accounts.get('current')).toMatchObject({ includeInSafeToSpend: true });
    expect(await db.accounts.get('card')).toMatchObject({ includeInSafeToSpend: false });
    expect(await db.categories.get('transfer')).toMatchObject({ system: true });
    expect(await db.settings.get('app')).toMatchObject({ payday: 28, theme: 'dark', onboarded: true, budgetPeriod: 'month' });
    expect(await db.transactions.where('transferId').equals('x').count()).toBe(0); // the new index works
    db.close();
  });

  it('upgrades version 2, dropping the indexes on payee data', async () => {
    const v2 = new Dexie(NAME);
    v2.version(2).stores({
      accounts: 'id',
      categories: 'id, order',
      transactions: 'id, date, accountId, categoryId, recurringId, transferId, importBatchId, fingerprint',
      recurring: 'id',
      budgets: 'id, categoryId',
      settings: 'id',
      rules: 'id, priority',
      payeeAliases: 'id, &from',
      importBatches: 'id, importedAt',
      goals: 'id',
    });
    await v2
      .table('transactions')
      .put({ id: 't1', accountId: 'a', date: '2026-10-01', amount: -250, payee: 'Tesco', categoryId: 'g', fingerprint: 'f' });
    await v2.table('payeeAliases').put({ id: 'p1', from: 'tesco stores', to: 'Tesco' });
    v2.close();

    const db = new FinanceDB(NAME);
    await db.open();
    expect(db.verno).toBe(5);
    expect(await db.transactions.get('t1')).toMatchObject({ payee: 'Tesco', fingerprint: 'f' });
    expect(await db.payeeAliases.get('p1')).toMatchObject({ from: 'tesco stores' });
    expect(db.transactions.schema.indexes.map((i) => i.name)).not.toContain('fingerprint');
    expect(db.payeeAliases.schema.indexes).toHaveLength(0);
    expect(await db.keyring.count()).toBe(0);
    db.close();
  });
});
