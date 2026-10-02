import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/utils';
import { db } from './db';
import { addTransaction, deleteTransaction, updateSettings, updateTransaction, ValidationError, type NewTransaction } from './repo';

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
