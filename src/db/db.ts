import Dexie, { type EntityTable } from 'dexie';
import { t } from '../i18n';
import { useLiveQuery } from 'dexie-react-hooks';
import { encryptionMiddleware } from './encryption';
import { outboxMiddleware } from './outbox';
import {
  ACCOUNT_TYPE_ORDER,
  DEFAULT_SETTINGS,
  TRANSFER_CATEGORY_ID,
  type Account,
  type Budget,
  type Category,
  type FinanceData,
  type Goal,
  type BankConnection,
  type ImportBatch,
  type KeyEntry,
  type Notice,
  type OutboxEntry,
  type SyncState,
  type PayeeAlias,
  type Recurring,
  type Rule,
  type Settings,
  type Transaction,
} from './types';

/** Built-in category for transfers; its name is created in the current language. */
export const transferCategory = (): Category => ({
  id: TRANSFER_CATEGORY_ID,
  name: t('categories.transfer'),
  color: 'fun',
  kind: 'transfer',
  order: 1000,
  system: true,
});

export class FinanceDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  recurring!: EntityTable<Recurring, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  rules!: EntityTable<Rule, 'id'>;
  payeeAliases!: EntityTable<PayeeAlias, 'id'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  keyring!: EntityTable<KeyEntry, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'id'>;
  syncState!: EntityTable<SyncState, 'id'>;
  notices!: EntityTable<Notice, 'id'>;
  bankConnections!: EntityTable<BankConnection, 'id'>;

  constructor(name = 'ledger') {
    super(name);
    // Migration policy: never edit a released version. To change the schema, add
    // this.version(n + 1).stores({...}).upgrade(tx => ...) below the last one, and add a
    // migration test in db.test.ts that opens a database written at version n.
    // Upgrades run before unlocking, so they can change the schema but cannot read or write the
    // contents of encrypted records (see docs/SECURITY.md).
    this.version(1).stores({
      accounts: 'id',
      categories: 'id, order',
      transactions: 'id, date, accountId, categoryId, recurringId',
      recurring: 'id',
      budgets: 'id, categoryId',
      settings: 'id',
    });

    // v2: accounts/transfers, rules, payee aliases, imports, goals, and new settings.
    this.version(2)
      .stores({
        transactions: 'id, date, accountId, categoryId, recurringId, transferId, importBatchId, fingerprint',
        rules: 'id, priority',
        payeeAliases: 'id, &from',
        importBatches: 'id, importedAt',
        goals: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('accounts')
          .toCollection()
          .modify((a: Account) => {
            a.includeInSafeToSpend ??= a.type === 'current' || a.type === 'cash';
          });
        await tx.table('categories').put(transferCategory());
        const hadData = (await tx.table('accounts').count()) > 0;
        const old = await tx.table('settings').get('app');
        if (old) {
          // Anyone upgrading has already been using the app, so skip first-run setup.
          await tx.table('settings').put({ ...DEFAULT_SETTINGS, ...old, onboarded: old.onboarded ?? hadData });
        }
      });

    // v3: encryption at rest. Indexed fields are stored readable, so indexes on payee-derived
    // values (import fingerprints, payee aliases) are dropped; the keyring holds the wrapped data key.
    this.version(3).stores({
      transactions: 'id, date, accountId, categoryId, recurringId, transferId, importBatchId',
      payeeAliases: 'id',
      keyring: 'id',
    });

    // v4: sync. The outbox lists records changed since the last push; syncState holds the
    // session and sync key (encrypted at rest like everything else).
    this.version(4).stores({ outbox: 'id', syncState: 'id' });
    // v5: notifications already shown or read on this device.
    this.version(5).stores({ notices: 'id' });
    // v6: Open Banking connections (synced).
    this.version(6).stores({ bankConnections: 'id' });

    this.use(encryptionMiddleware);
    this.use(outboxMiddleware);
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
    const [accounts, categories, transactions, recurring, budgets, rules, aliases, importBatches, goals, bankConnections, settings] =
      await Promise.all([
        db.accounts.toArray(),
        db.categories.orderBy('order').toArray(),
        db.transactions.orderBy('date').reverse().toArray(),
        db.recurring.toArray(),
        db.budgets.toArray(),
        db.rules.orderBy('priority').toArray(),
        db.payeeAliases.toArray(),
        db.importBatches.orderBy('importedAt').reverse().toArray(),
        db.goals.toArray(),
        db.bankConnections.toArray(),
        db.settings.get('app'),
      ]);
    return {
      // Everyday accounts first, so they are the default wherever an account is picked.
      accounts: accounts.sort(
        (a, b) => ACCOUNT_TYPE_ORDER.indexOf(a.type) - ACCOUNT_TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name),
      ),
      categories,
      transactions,
      recurring,
      budgets,
      rules,
      aliases,
      importBatches,
      goals,
      bankConnections,
      settings: { ...DEFAULT_SETTINGS, ...settings },
    };
  });
}
