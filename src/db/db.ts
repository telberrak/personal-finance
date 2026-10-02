import Dexie, { type EntityTable } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, type Account, type Budget, type Category, type FinanceData, type Recurring, type Settings, type Transaction } from './types';

class FinanceDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  recurring!: EntityTable<Recurring, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor() {
    super('ledger');
    this.version(1).stores({
      accounts: 'id',
      categories: 'id, order',
      transactions: 'id, date, accountId, categoryId, recurringId',
      recurring: 'id',
      budgets: 'id, categoryId',
      settings: 'id',
    });
  }
}

export const db = new FinanceDB();

/**
 * Everything the screens need, kept live: any write to the database re-renders its users.
 * A personal ledger is small enough to load whole; add range queries if that stops being true.
 * Returns undefined while the first read is in flight.
 */
export function useFinanceData(): FinanceData | undefined {
  return useLiveQuery(async () => {
    const [accounts, categories, transactions, recurring, budgets, settings] = await Promise.all([
      db.accounts.toArray(),
      db.categories.orderBy('order').toArray(),
      db.transactions.orderBy('date').reverse().toArray(),
      db.recurring.toArray(),
      db.budgets.toArray(),
      db.settings.get('app'),
    ]);
    return { accounts, categories, transactions, recurring, budgets, settings: settings ?? DEFAULT_SETTINGS };
  });
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  const current = (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
  await db.settings.put({ ...current, ...patch });
}
