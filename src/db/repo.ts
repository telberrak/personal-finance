/**
 * The only module that writes to the database. Screens read through useFinanceData() and
 * write through these functions, so validation, undo and (later) rules live in one place.
 */
import { newId } from '../lib/id';
import { db } from './db';
import { DEFAULT_SETTINGS, type Settings, type Transaction } from './types';

export { eraseAllData, resetDemoData } from './seed';

export class ValidationError extends Error {
  name = 'ValidationError';
}

export type NewTransaction = Omit<Transaction, 'id'>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateTransaction(t: NewTransaction): void {
  if (!Number.isInteger(t.amount) || t.amount === 0) throw new ValidationError('Amount must be a non-zero whole number of pence.');
  if (!ISO_DATE.test(t.date)) throw new ValidationError(`Invalid date: ${t.date}`);
  if (!t.payee.trim()) throw new ValidationError('Payee is required.');
  if (!t.accountId) throw new ValidationError('Account is required.');
  if (!t.categoryId) throw new ValidationError('Category is required.');
}

export async function addTransaction(input: NewTransaction): Promise<string> {
  const t = { ...input, payee: input.payee.trim(), note: input.note?.trim() || undefined };
  validateTransaction(t);
  const id = newId();
  await db.transactions.add({ ...t, id });
  return id;
}

export async function updateTransaction(id: string, patch: Partial<NewTransaction>): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const current = await db.transactions.get(id);
    if (!current) throw new ValidationError('Transaction not found.');
    const next = { ...current, ...patch };
    validateTransaction(next);
    await db.transactions.put(next);
  });
}

/** Deletes a transaction and returns a function that puts it back, for an Undo action. */
export async function deleteTransaction(id: string): Promise<() => Promise<void>> {
  const existing = await db.transactions.get(id);
  if (!existing) return async () => {};
  await db.transactions.delete(id);
  return async () => {
    await db.transactions.put(existing);
  };
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  if (patch.payday !== undefined && (!Number.isInteger(patch.payday) || patch.payday < 1 || patch.payday > 31)) {
    throw new ValidationError('Payday must be a day between 1 and 31.');
  }
  if (patch.monthlySavings !== undefined && (!Number.isInteger(patch.monthlySavings) || patch.monthlySavings < 0)) {
    throw new ValidationError('Savings must be zero or more.');
  }
  await db.transaction('rw', db.settings, async () => {
    const current = (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
    await db.settings.put({ ...current, ...patch });
  });
}
