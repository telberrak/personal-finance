import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/utils';
import { db } from '../db/db';
import { importTransactions, undoImport } from '../db/repo';
import { TRANSFER_CATEGORY_ID, type Account } from '../db/types';
import { guessMapping, mapRows } from './importer';
import { matchAccount, otherAccountName, pairTransfers } from './importPrep';

// Mizan's own export, edited in a spreadsheet: US dates, Source and Destination columns, blank lines.
const csv = [
  ['Date', 'Time', 'Account', 'Source', 'Destination', 'Payee', 'Category', 'Amount', 'Note', 'Bank description'],
  ['12/5/2025', '', 'Natwest', 'HSBC', '', 'Transfer from HSBC', 'Transfers', '200', '', ''],
  ['12/5/2025', '19:41', 'HSBC', '', '', 'Co-op', 'Groceries', '-3.65', 'milk', 'CO OP EALING'],
  ['', '', '', '', '', '', '', '', '', ''],
  ['12/5/2025', '', 'HSBC', 'HSBC', 'Natwest', 'Transfer to Natwest', 'Transfers', '-200', '', ''],
  ['12/15/2025', '', 'HSBC', 'Narwest', '', 'Transfer from Natwest', 'Transfers', '100', '', ''],
];

const account = (id: string, name: string): Account => ({ id, name, type: 'current', openingBalance: 0, includeInSafeToSpend: true });
const accounts = [
  account('hsbc', 'HSBC'),
  account('natwest', 'NatWest'),
  account('lloyds', 'Lloyd Credit Card'),
  account('revolut', 'Revolut'),
];

describe('importing a file that covers several accounts', () => {
  beforeEach(resetDb);

  it("recognises Mizan's export and reads accounts, transfers, payees, notes and times", () => {
    const mapping = guessMapping(csv);
    expect(mapping).toMatchObject({ dateFormat: 'mdy', account: 2, source: 3, destination: 4, payee: 5, description: 9, category: 6 });
    const rows = mapRows(csv, mapping);
    expect(rows).toHaveLength(4); // the blank line is skipped
    expect(rows[0]).toMatchObject({
      date: '2025-12-05',
      amount: 20000,
      rawPayee: 'Transfer from HSBC',
      accountName: 'Natwest',
      sourceName: 'HSBC',
    });
    expect(rows[1]).toMatchObject({ rawPayee: 'CO OP EALING', payeeName: 'Co-op', note: 'milk', time: '19:41', amount: -365 });
  });

  it('matches account names despite case, short names and typos', () => {
    expect(matchAccount('hsbc', accounts)).toBe('hsbc');
    expect(matchAccount('Natwest', accounts)).toBe('natwest');
    expect(matchAccount('Narwest', accounts)).toBe('natwest');
    expect(matchAccount('Lloyd', accounts)).toBe('lloyds');
    expect(matchAccount('Lloyds Credit Card', accounts)).toBe('lloyds');
    expect(matchAccount('Attijari', accounts)).toBeUndefined();
  });

  it("takes a transfer's other account from Source, else Destination", () => {
    const of = (n: string) => matchAccount(n, accounts);
    expect(otherAccountName({ accountName: 'Natwest', sourceName: 'HSBC' }, of)).toBe('HSBC');
    expect(otherAccountName({ accountName: 'HSBC', sourceName: 'HSBC', destinationName: 'Natwest' }, of)).toBe('Natwest');
    expect(otherAccountName({ accountName: 'HSBC', sourceName: 'Narwest' }, of)).toBe('Narwest');
    expect(otherAccountName({ accountName: 'HSBC' }, of)).toBeUndefined();
  });

  it('pairs the two sides of a transfer found in the file', () => {
    const pairs = pairTransfers([
      { accountId: 'natwest', transferAccountId: 'hsbc', date: '2025-12-05', amount: 20000 },
      { accountId: 'hsbc', date: '2025-12-05', amount: -365 },
      { accountId: 'hsbc', transferAccountId: 'natwest', date: '2025-12-05', amount: -20000 },
      { accountId: 'hsbc', transferAccountId: 'revolut', date: '2025-12-05', amount: -20000 },
    ]);
    expect([...pairs.entries()].sort()).toEqual([
      [0, 2],
      [2, 0],
    ]);
  });

  it('links pairs, matches transactions already there, adds missing sides, and undoes it all', async () => {
    await db.accounts.bulkPut(accounts);
    // Already in Revolut, not yet linked: the top-up made from HSBC.
    await db.transactions.add({
      id: 'old',
      accountId: 'revolut',
      date: '2025-12-08',
      amount: 982,
      payee: 'Top up',
      categoryId: 'other-income',
      createdAt: 1,
    });
    const row = (accountId: string, date: string, amount: number, payee: string, transferAccountId?: string) => ({
      accountId,
      date,
      amount,
      rawPayee: payee,
      payee,
      categoryId: transferAccountId ? TRANSFER_CATEGORY_ID : 'groceries',
      transferAccountId,
    });
    const batch = await importTransactions('hsbc', 'mizan.csv', [
      row('natwest', '2025-12-05', 20000, 'Transfer from HSBC', 'hsbc'),
      row('hsbc', '2025-12-05', -20000, 'Transfer to Natwest', 'natwest'),
      row('hsbc', '2025-12-08', -982, 'Transfer to Revolut', 'revolut'),
      row('hsbc', '2025-12-09', 10000, 'Transfer from Natwest', 'natwest'),
      { ...row('hsbc', '2025-12-05', -365, 'CO OP EALING'), payee: 'Co-op', time: '19:41', note: 'milk' },
    ]);
    expect(batch.accountIds?.sort()).toEqual(['hsbc', 'natwest']);

    const all = await db.transactions.toArray();
    expect(all).toHaveLength(7); // five rows, the existing Revolut top-up, and NatWest's side of the 9 December transfer
    const linkedTo = (id: string) => all.filter((x) => x.transferId === all.find((y) => y.id === id)!.transferId).length;
    const find = (accountId: string, date: string, amount: number) =>
      all.find((x) => x.accountId === accountId && x.date === date && x.amount === amount)!;
    expect(find('natwest', '2025-12-05', 20000).transferId).toBe(find('hsbc', '2025-12-05', -20000).transferId);
    expect(find('revolut', '2025-12-08', 982)).toMatchObject({ id: 'old', categoryId: TRANSFER_CATEGORY_ID, payee: 'Transfer from HSBC' });
    expect(linkedTo('old')).toBe(2);
    expect(find('natwest', '2025-12-09', -10000)).toMatchObject({ payee: 'Transfer to HSBC', importBatchId: batch.id });
    expect(find('hsbc', '2025-12-05', -365)).toMatchObject({ payee: 'Co-op', time: '19:41', note: 'milk' });
    expect(find('hsbc', '2025-12-05', -365).transferId).toBeUndefined();

    expect(await undoImport(batch.id)).toBe(6);
    const left = await db.transactions.toArray();
    expect(left.map((x) => [x.id, x.transferId])).toEqual([['old', undefined]]); // kept, no longer linked
  });
});
