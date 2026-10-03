import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/utils';
import { searchTransactions } from '../lib/search';
import { db } from './db';
import {
  addTransaction,
  addTransfer,
  bulkDelete,
  bulkRecategorise,
  bulkTag,
  cleanTags,
  restoreTransactions,
  updateTransaction,
} from './repo';
import { seedDemoData } from './seed';

beforeEach(async () => {
  await resetDb();
  await seedDemoData('2026-10-14');
});

describe('tags', () => {
  it('are trimmed, de-duplicated and saved on transactions', async () => {
    expect(cleanTags([' Holiday 2027 ', 'holiday 2027', '', 'Work'])).toEqual(['Holiday 2027', 'Work']);
    expect(cleanTags(['  '])).toBeUndefined();
    const id = await addTransaction({
      accountId: 'current',
      date: '2026-10-10',
      amount: -5000,
      payee: 'Hotel',
      categoryId: 'fun',
      tags: ['Holiday 2027'],
    });
    await updateTransaction(id, { tags: ['Holiday 2027', 'Work'] });
    expect((await db.transactions.get(id))?.tags).toEqual(['Holiday 2027', 'Work']);
  });
});

describe('search', () => {
  it('combines text, amount, date, category and tag filters', async () => {
    await addTransaction({
      accountId: 'current',
      date: '2026-10-10',
      amount: -12000,
      payee: 'Grand Hotel',
      categoryId: 'fun',
      note: 'Rome',
      tags: ['Holiday 2027'],
    });
    const all = await db.transactions.toArray();
    expect(searchTransactions(all, { text: 'rome' }).map((t) => t.payee)).toEqual(['Grand Hotel']);
    expect(searchTransactions(all, { tag: 'holiday 2027' })).toHaveLength(1);
    expect(
      searchTransactions(all, { min: 11000, max: 13000, direction: 'out', from: '2026-10-01', to: '2026-10-31', categoryId: 'fun' }),
    ).toHaveLength(1);
    expect(searchTransactions(all, { text: 'hotel', direction: 'in' })).toHaveLength(0);
  });
});

describe('bulk edit', () => {
  it('recategorises, tags and untags many transactions, skipping transfers', async () => {
    await addTransfer({ fromAccountId: 'current', toAccountId: 'savings', amount: 1000, date: '2026-10-12' });
    const ids = (await db.transactions.toArray()).slice(0, 10).map((t) => t.id);
    const transfers = (await db.transactions.toArray()).filter((t) => t.transferId).map((t) => t.id);
    const n = await bulkRecategorise([...ids, ...transfers], 'shopping');
    expect(n).toBeGreaterThan(0);
    for (const t of await db.transactions.bulkGet(transfers)) expect(t?.categoryId).toBe('transfer');
    expect(await bulkTag(ids, 'Review')).toBe(10);
    expect(await bulkTag(ids, 'review')).toBe(0); // already there, case-insensitively
    expect(await bulkTag(ids, 'Review', false)).toBe(10);
  });

  it('deletes with linked pieces and can be undone', async () => {
    await addTransfer({ fromAccountId: 'current', toAccountId: 'savings', amount: 1000, date: '2026-10-12' });
    const half = (await db.transactions.toArray()).find((t) => t.transferId)!;
    const before = await db.transactions.count();
    const deleted = await bulkDelete([half.id]);
    expect(deleted).toHaveLength(2);
    expect(await db.transactions.count()).toBe(before - 2);
    await restoreTransactions(deleted);
    expect(await db.transactions.count()).toBe(before);
  });
});
