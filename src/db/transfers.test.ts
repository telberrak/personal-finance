import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/utils';
import { addDays, today } from '../lib/dates';
import { netWorth } from '../lib/networth';
import { everydayOutflow } from '../lib/selectors';
import { db } from './db';
import { deleteTransaction, logDueTransfers, markBillPaid, saveRecurring, type RecurringInput } from './repo';
import { TRANSFER_CATEGORY_ID, type Account } from './types';

const account = (over: Partial<Account>): Account => ({
  id: 'x',
  name: 'X',
  type: 'current',
  openingBalance: 0,
  includeInSafeToSpend: true,
  ...over,
});

beforeEach(async () => {
  await resetDb();
  await db.accounts.bulkPut([
    account({ id: 'current', name: 'Current account', openingBalance: 200000 }),
    account({ id: 'jisa', name: 'Junior ISA – Sara', type: 'investment', includeInSafeToSpend: false, excludeFromNetWorth: true }),
    account({ id: 'joint', name: 'Joint account' }),
  ]);
});

const monthly = (over: Partial<RecurringInput> = {}): RecurringInput => ({
  name: 'Junior ISA',
  amount: 5000,
  frequency: 'monthly',
  startDate: today(),
  method: 'standing-order',
  accountId: 'current',
  categoryId: 'bills',
  active: true,
  toAccountId: 'jisa',
  autoLog: true,
  ...over,
});

describe('recurring transfers', () => {
  it('records each due transfer once, as a transfer in both accounts', async () => {
    const id = await saveRecurring(monthly());
    expect((await db.recurring.get(id))?.categoryId).toBe(TRANSFER_CATEGORY_ID); // never spending
    expect(await logDueTransfers()).toBe(1);
    expect(await logDueTransfers()).toBe(0); // running again (or on a second device) adds nothing

    const pair = await db.transactions.where('recurringId').equals(id).sortBy('amount');
    expect(pair.map((t) => [t.accountId, t.amount, t.categoryId])).toEqual([
      ['current', -5000, TRANSFER_CATEGORY_ID],
      ['jisa', 5000, TRANSFER_CATEGORY_ID],
    ]);
    expect(pair[0].transferId).toBe(pair[1].transferId);
    // The same due date always gets the same ids, so synced devices cannot duplicate it.
    expect(pair[0].id).toBe(`rt-${id}-${today()}-out`);

    // Next month's is recorded when it falls due.
    expect(await logDueTransfers(addDays(today(), 40))).toBe(1);
  });

  it('does not fill in due dates from before the rule existed, or record a deleted one again', async () => {
    const id = await saveRecurring(monthly({ startDate: addDays(today(), -65) }));
    expect(await logDueTransfers()).toBe(0); // past due dates are not backfilled
    const later = addDays(today(), 31);
    expect(await logDueTransfers(later)).toBe(1);
    const [out] = await db.transactions
      .where('recurringId')
      .equals(id)
      .filter((t) => t.amount < 0)
      .toArray();
    await deleteTransaction(out.id);
    expect(await db.transactions.where('recurringId').equals(id).count()).toBe(0); // both sides went
    expect(await logDueTransfers(later)).toBe(0); // and it stays deleted
  });

  it('stops at the end date, skips paused rules, and leaves manual ones to "mark done"', async () => {
    await saveRecurring(monthly({ endDate: addDays(today(), 10) }));
    await saveRecurring(monthly({ name: 'Paused', active: false }));
    const manual = await saveRecurring(monthly({ name: 'Manual', autoLog: false }));
    expect(await logDueTransfers(addDays(today(), 90))).toBe(1); // only the first, once
    const rule = (await db.recurring.get(manual))!;
    const outId = await markBillPaid(rule, today());
    expect((await db.transactions.get(outId))?.transferId).toBeDefined();
  });

  it('takes money out of "safe to spend" only when it leaves your everyday accounts', async () => {
    const accounts = await db.accounts.toArray();
    const rule = { ...monthly(), id: 'r', categoryId: TRANSFER_CATEGORY_ID };
    expect(everydayOutflow(rule, accounts)).toBe(5000); // current → Junior ISA
    expect(everydayOutflow({ ...rule, toAccountId: 'joint' }, accounts)).toBe(0); // between everyday accounts
    expect(everydayOutflow({ ...rule, accountId: 'jisa', toAccountId: 'current' }, accounts)).toBe(0); // money coming in
    expect(everydayOutflow({ ...rule, toAccountId: undefined }, accounts)).toBe(5000); // a bill
  });

  it('refuses a transfer to the same account', async () => {
    await expect(saveRecurring(monthly({ toAccountId: 'current' }))).rejects.toThrow();
  });
});

describe('net worth', () => {
  it('leaves out accounts you hold for someone else, and lists them apart', async () => {
    await db.transactions.put({ id: 't', accountId: 'jisa', date: today(), amount: 300000, payee: 'Gift', categoryId: 'other-income' });
    const worth = netWorth({ accounts: await db.accounts.toArray(), transactions: await db.transactions.toArray() });
    expect(worth.net).toBe(200000);
    expect(worth.excluded.map((r) => [r.account.id, r.balance])).toEqual([['jisa', 300000]]);
  });
});
