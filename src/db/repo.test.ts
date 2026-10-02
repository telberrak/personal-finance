import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/utils';
import { db } from './db';
import {
  addTransaction,
  addTransfer,
  archiveCategory,
  completeOnboarding,
  createBackup,
  deleteTransaction,
  importTransactions,
  mergeSplit,
  splitTransaction,
  renamePayee,
  restoreBackup,
  saveRecurring,
  setBudget,
  undoImport,
  updateSettings,
  updateTransaction,
  updateTransfer,
  ValidationError,
  type NewTransaction,
} from './repo';
import { seedDemoData } from './seed';
import { DEFAULT_SETTINGS } from './types';

const base: NewTransaction = { accountId: 'current', date: '2026-10-02', amount: -2340, payee: '  Tesco  ', categoryId: 'groceries' };

beforeEach(resetDb);

describe('transactions', () => {
  it('adds a trimmed transaction', async () => {
    const id = await addTransaction({ ...base, note: '  ' });
    expect(await db.transactions.get(id)).toMatchObject({ payee: 'Tesco', amount: -2340, note: undefined });
  });

  it.each([
    [{ amount: 0 }, 'non-zero'],
    [{ amount: 12.5 }, 'whole number'],
    [{ date: '02/10/2026' }, 'Invalid date'],
    [{ payee: '   ' }, 'Payee'],
    [{ categoryId: '' }, 'Category'],
  ])('rejects %j', async (patch, message) => {
    await expect(addTransaction({ ...base, ...patch })).rejects.toThrow(message);
    expect(await db.transactions.count()).toBe(0);
  });

  it('updates with validation', async () => {
    const id = await addTransaction(base);
    await updateTransaction(id, { amount: -500 });
    expect((await db.transactions.get(id))?.amount).toBe(-500);
    await expect(updateTransaction(id, { amount: 0 })).rejects.toBeInstanceOf(ValidationError);
    expect((await db.transactions.get(id))?.amount).toBe(-500);
  });

  it('deletes and undoes', async () => {
    const id = await addTransaction(base);
    const undo = await deleteTransaction(id);
    expect(await db.transactions.get(id)).toBeUndefined();
    await undo();
    expect(await db.transactions.get(id)).toMatchObject({ payee: 'Tesco' });
  });
});

describe('settings', () => {
  it('merges patches over defaults', async () => {
    await updateSettings({ payday: 28 });
    await updateSettings({ theme: 'dark' });
    expect(await db.settings.get('app')).toMatchObject({ payday: 28, theme: 'dark', monthlySavings: 20000 });
  });

  it('rejects an impossible payday or negative savings', async () => {
    await expect(updateSettings({ payday: 0 })).rejects.toThrow('Payday');
    await expect(updateSettings({ monthlySavings: -1 })).rejects.toThrow('Savings');
  });
});

describe('setup', () => {
  it('starts fresh with one account and the default categories', async () => {
    await seedDemoData();
    await completeOnboarding({ accountName: 'Monzo', balance: 123400, payday: 28, monthlySavings: 10000 });
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.toArray()).toMatchObject([{ name: 'Monzo', openingBalance: 123400, includeInSafeToSpend: true }]);
    expect(await db.categories.get('transfer')).toMatchObject({ system: true });
    expect(await db.settings.get('app')).toMatchObject({ onboarded: true, payday: 28, monthlySavings: 10000 });
  });
});

describe('transfers', () => {
  beforeEach(async () => {
    await db.accounts.bulkPut([
      { id: 'a', name: 'Current', type: 'current', openingBalance: 0, includeInSafeToSpend: true },
      { id: 'b', name: 'Savings', type: 'savings', openingBalance: 0, includeInSafeToSpend: false },
    ]);
  });

  it('creates, edits and deletes both halves together', async () => {
    const id = await addTransfer({ fromAccountId: 'a', toAccountId: 'b', amount: 5000, date: '2026-10-02' });
    const transferId = (await db.transactions.get(id))!.transferId!;
    await updateTransfer(transferId, { fromAccountId: 'b', toAccountId: 'a', amount: 7000, date: '2026-10-03' });
    const pair = await db.transactions.where('transferId').equals(transferId).toArray();
    expect(pair.map((t) => [t.accountId, t.amount, t.payee]).sort()).toEqual([
      ['a', 7000, 'Transfer from Savings'],
      ['b', -7000, 'Transfer to Current'],
    ]);
    const undo = await deleteTransaction(pair[0].id);
    expect(await db.transactions.count()).toBe(0);
    await undo();
    expect(await db.transactions.count()).toBe(2);
  });

  it('rejects a transfer to the same account', async () => {
    await expect(addTransfer({ fromAccountId: 'a', toAccountId: 'a', amount: 1, date: '2026-10-02' })).rejects.toThrow('two different');
  });
});

describe('categories, bills and budgets', () => {
  it('archiving a category moves its transactions and drops its budget', async () => {
    await seedDemoData('2026-10-14');
    const before = await db.transactions.where('categoryId').equals('fun').count();
    const shopping = await db.transactions.where('categoryId').equals('shopping').count();
    await archiveCategory('fun', 'shopping');
    expect(await db.transactions.where('categoryId').equals('fun').count()).toBe(0);
    expect(await db.transactions.where('categoryId').equals('shopping').count()).toBe(shopping + before);
    expect(await db.budgets.where('categoryId').equals('fun').count()).toBe(0);
    expect((await db.categories.get('fun'))?.archived).toBe(true);
    await expect(archiveCategory('eating', 'salary')).rejects.toThrow('same type');
  });

  it('remembers the old amount when a bill changes price', async () => {
    const bill = {
      name: 'Gym',
      amount: 2500,
      frequency: 'monthly' as const,
      startDate: '2026-01-03',
      method: 'direct-debit' as const,
      accountId: 'a',
      categoryId: 'bills',
      active: true,
    };
    const id = await saveRecurring(bill);
    await saveRecurring({ ...bill, id, name: 'Gym ' });
    expect((await db.recurring.get(id))?.previousAmount).toBeUndefined();
    await saveRecurring({ ...bill, id, amount: 2900 });
    expect(await db.recurring.get(id)).toMatchObject({ amount: 2900, previousAmount: 2500, priceAlertDismissed: false });
  });

  it('sets and clears budgets', async () => {
    await setBudget('groceries', 30000);
    await setBudget('groceries', 25000);
    expect(await db.budgets.toArray()).toMatchObject([{ categoryId: 'groceries', monthlyLimit: 25000 }]);
    await setBudget('groceries', null);
    expect(await db.budgets.count()).toBe(0);
  });
});

describe('imports and payee names', () => {
  it('imports a batch and undoes it', async () => {
    const batch = await importTransactions('a', 'october.csv', [
      { date: '2026-10-01', amount: -320, rawPayee: 'COFFEE 123', payee: 'Coffee', categoryId: 'eating' },
      { date: '2026-10-02', amount: 100000, rawPayee: 'ACME LTD', payee: 'Acme Ltd', categoryId: 'other-income' },
    ]);
    expect(await db.transactions.where('importBatchId').equals(batch.id).count()).toBe(2);
    expect(await db.categories.get('other-income')).toBeDefined();
    await undoImport(batch.id);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.importBatches.count()).toBe(0);
  });

  it('renames a payee in past transactions and remembers it', async () => {
    await addTransaction({ ...base, payee: 'TESCO STORES 3297' });
    await addTransaction({ ...base, payee: 'Tesco Stores 3297' });
    expect(await renamePayee('TESCO STORES 3297', 'Tesco')).toBe(2);
    expect((await db.transactions.toArray()).map((t) => t.payee)).toEqual(['Tesco', 'Tesco']);
    expect(await db.payeeAliases.toArray()).toMatchObject([{ from: 'tesco stores 3297', to: 'Tesco' }]);
  });
});

describe('backup', () => {
  it('round-trips all data but never exports the PIN', async () => {
    await seedDemoData('2026-10-14');
    await db.settings.update('app', { pinHash: 'secret', pinSalt: 'salt', payday: 20 });
    const backup = await createBackup();
    expect(JSON.stringify(backup)).not.toContain('secret');
    const count = await db.transactions.count();

    await resetDb();
    await db.settings.put({ ...DEFAULT_SETTINGS, pinHash: 'device-pin', pinSalt: 's2' });
    const { transactions } = await restoreBackup(JSON.stringify(backup));
    expect(transactions).toBe(count);
    expect(await db.transactions.count()).toBe(count);
    expect(await db.settings.get('app')).toMatchObject({ payday: 20, pinHash: 'device-pin', onboarded: true });
  });

  it('rejects files that are not backups', async () => {
    await expect(restoreBackup('{"hello":1}')).rejects.toThrow('not a Ledger backup');
    await expect(restoreBackup('not json')).rejects.toThrow('not a Ledger backup');
  });
});

describe('split transactions', () => {
  beforeEach(async () => {
    await seedDemoData('2026-10-14');
  });

  const shop = () =>
    addTransaction({ accountId: 'current', date: '2026-10-10', time: '18:20', amount: -6000, payee: 'Tesco', categoryId: 'groceries' });

  it('divides a payment into linked pieces that keep the total', async () => {
    const id = await shop();
    const before = await db.transactions.count();
    const undo = await splitTransaction(id, [
      { categoryId: 'groceries', amount: 4500 },
      { categoryId: 'shopping', amount: 1500, note: 'Phone charger' },
    ]);
    const pieces = await db.transactions.filter((t) => t.payee === 'Tesco' && t.date === '2026-10-10').sortBy('splitIndex');
    expect(pieces.map((t) => [t.categoryId, t.amount, t.note])).toEqual([
      ['groceries', -4500, undefined],
      ['shopping', -1500, 'Phone charger'],
    ]);
    expect(pieces[0].id).toBe(id);
    expect(new Set(pieces.map((t) => t.splitId)).size).toBe(1);
    expect(await db.transactions.count()).toBe(before + 1);

    await undo();
    expect(await db.transactions.count()).toBe(before);
    expect(await db.transactions.get(id)).toMatchObject({ amount: -6000, categoryId: 'groceries' });
  });

  it('rejects parts that do not add up or use the wrong kind of category', async () => {
    const id = await shop();
    await expect(splitTransaction(id, [{ categoryId: 'groceries', amount: 6000 }])).rejects.toThrow('at least two');
    await expect(
      splitTransaction(id, [
        { categoryId: 'groceries', amount: 4000 },
        { categoryId: 'shopping', amount: 1000 },
      ]),
    ).rejects.toThrow('add up');
    await expect(
      splitTransaction(id, [
        { categoryId: 'groceries', amount: 3000 },
        { categoryId: 'salary', amount: 3000 },
      ]),
    ).rejects.toThrow('spending');
  });

  it('re-splits, shares payee/date edits, locks piece amounts, merges and deletes as a group', async () => {
    const id = await shop();
    await splitTransaction(id, [
      { categoryId: 'groceries', amount: 4500 },
      { categoryId: 'shopping', amount: 1500 },
    ]);
    await splitTransaction(id, [
      { categoryId: 'groceries', amount: 3000 },
      { categoryId: 'shopping', amount: 2000 },
      { categoryId: 'fun', amount: 1000 },
    ]);
    let pieces = await db.transactions.filter((t) => t.payee === 'Tesco').sortBy('splitIndex');
    expect(pieces.map((t) => t.amount)).toEqual([-3000, -2000, -1000]);

    await updateTransaction(pieces[1].id, { payee: 'Tesco Extra', date: '2026-10-11', categoryId: 'eating' });
    pieces = await db.transactions.filter((t) => t.splitId === pieces[0].splitId).sortBy('splitIndex');
    expect(pieces.map((t) => [t.payee, t.date])).toEqual(Array(3).fill(['Tesco Extra', '2026-10-11']));
    expect(pieces[1].categoryId).toBe('eating');
    await expect(updateTransaction(pieces[1].id, { amount: -2500 })).rejects.toThrow('Edit split');

    await mergeSplit(pieces[2].id);
    const merged = await db.transactions.get(id);
    expect(merged).toMatchObject({ amount: -6000, categoryId: 'groceries' });
    expect(merged?.splitId).toBeUndefined();

    await splitTransaction(id, [
      { categoryId: 'groceries', amount: 5000 },
      { categoryId: 'shopping', amount: 1000 },
    ]);
    const before = await db.transactions.count();
    const undo = await deleteTransaction(id);
    expect(await db.transactions.count()).toBe(before - 2);
    await undo();
    expect(await db.transactions.count()).toBe(before);
  });

  it('a split imported payment is still recognised as a duplicate', async () => {
    const batch = await importTransactions('current', 'a.csv', [
      { date: '2026-10-09', amount: -2000, rawPayee: 'BOOTS 123', payee: 'Boots', categoryId: 'shopping' },
    ]);
    const [t] = await db.transactions.where('importBatchId').equals(batch.id).toArray();
    await splitTransaction(t.id, [
      { categoryId: 'shopping', amount: 1200 },
      { categoryId: 'groceries', amount: 800 },
    ]);
    const { markDuplicates } = await import('../lib/importer');
    const rows = markDuplicates([{ date: '2026-10-09', amount: -2000, rawPayee: 'BOOTS 123' }], await db.transactions.toArray(), 'current');
    expect(rows[0].duplicate).toBe(true);
  });
});
