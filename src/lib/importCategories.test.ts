import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/utils';
import { db, transferCategory } from '../db/db';
import { importTransactions, undoImport } from '../db/repo';
import { defaultCategories } from '../db/seed';
import { DEFAULT_SETTINGS, TRANSFER_CATEGORY_ID, type FinanceData } from '../db/types';
import { guessMapping, mapRows } from './importer';
import { prepareRows } from './importPrep';

const csv = [
  ['Date', 'Description', 'Amount', 'Category'],
  ['09/02/2026', 'COSTA COFFEE 43010917 LONDON', '-3.50', 'eating  OUT'],
  ['07/06/2026', 'AMZNMktplace amazon.co.uk', '72.00', 'Shopping'],
  ['24/02/2026', 'PAYMENT RECEIVED - THANK YOU', '5.00', 'Transfers'],
  ['24/02/2026', 'Stripe prop firm', '-99.00', 'trading expenses'],
];

const data = (): FinanceData => ({
  accounts: [
    { id: 'card', name: 'Lloyds Credit Card', type: 'credit', openingBalance: 0, includeInSafeToSpend: false },
    { id: 'current', name: 'Current account', type: 'current', openingBalance: 100000, includeInSafeToSpend: true },
  ],
  categories: [...defaultCategories(), transferCategory()],
  transactions: [],
  recurring: [],
  budgets: [],
  rules: [],
  aliases: [],
  importBatches: [],
  goals: [],
  bankConnections: [],
  people: [],
  ious: [],
  settings: DEFAULT_SETTINGS,
});

describe('importing a file that names its categories', () => {
  beforeEach(resetDb);

  it('finds the Category column, matches names loosely, keeps refunds in their spending category, and flags unknown ones', () => {
    const mapping = guessMapping(csv);
    expect(mapping.category).toBe(3);
    const rows = mapRows(csv, mapping).filter((r) => !r.error) as Parameters<typeof prepareRows>[2];
    const prepared = prepareRows(data(), 'card', rows);
    expect(prepared.map((r) => [r.categoryId, r.transfer ?? false, r.unknownCategory])).toEqual([
      ['eating', false, undefined], // "eating  OUT" matches "Eating out"
      ['shopping', false, undefined], // a refund stays in Shopping, reducing what was spent
      [TRANSFER_CATEGORY_ID, true, undefined],
      ['other', false, 'trading expenses'], // not in Mizan: the suggestion is used and the name reported
    ]);
  });

  it('saves Transfers rows as linked transfers with the chosen account, undone together', async () => {
    await db.accounts.bulkPut(data().accounts);
    const batch = await importTransactions('card', 'lloyds.csv', [
      {
        date: '2026-02-24',
        amount: 500,
        rawPayee: 'PAYMENT RECEIVED - THANK YOU',
        payee: 'Payment',
        categoryId: TRANSFER_CATEGORY_ID,
        transferAccountId: 'current',
      },
      { date: '2026-02-09', amount: -350, rawPayee: 'COSTA', payee: 'Costa Coffee', categoryId: 'eating' },
    ]);
    const all = await db.transactions.toArray();
    const pair = all.filter((t) => t.transferId).sort((a, b) => a.amount - b.amount);
    expect(pair.map((t) => [t.accountId, t.amount, t.categoryId, t.payee])).toEqual([
      ['current', -500, TRANSFER_CATEGORY_ID, 'Transfer to Lloyds Credit Card'],
      ['card', 500, TRANSFER_CATEGORY_ID, 'Transfer from Current account'],
    ]);
    expect(all.find((t) => t.payee === 'Costa Coffee')?.transferId).toBeUndefined();

    expect(await undoImport(batch.id)).toBe(3); // both sides of the transfer, and the purchase
    expect(await db.transactions.count()).toBe(0);
  });
});
