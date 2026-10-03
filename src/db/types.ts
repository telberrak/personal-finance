import type { ISODate } from '../lib/dates';
import type { Pence } from '../lib/money';
import type { Frequency } from '../lib/recurring';
import type { SavedSearch } from '../lib/search';

export type AccountType = 'current' | 'savings' | 'cash' | 'credit' | 'loan' | 'mortgage' | 'investment' | 'pension' | 'property';

/** Display order: everyday accounts first, then savings, debts and other assets. */
export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'current',
  'cash',
  'savings',
  'credit',
  'loan',
  'mortgage',
  'investment',
  'pension',
  'property',
];

/** Money owed: balances are negative. */
export const LIABILITY_TYPES: AccountType[] = ['credit', 'loan', 'mortgage'];
/** Valued by hand (Update value) rather than by transactions alone. */
export const VALUED_TYPES: AccountType[] = ['investment', 'pension', 'property'];

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  openingBalance: Pence;
  /** Counted in "safe to spend". Defaults to true for current and cash accounts. */
  includeInSafeToSpend: boolean;
  archived?: boolean;
  /** Annual percentage rate (credit cards, loans, mortgages), e.g. 22.9. */
  apr?: number;
  /** Credit cards: limit, statement and due days of the month, minimum payment. */
  credit?: { limit?: Pence; statementDay?: number; dueDay?: number; minPayment?: Pence };
  /** Loans and mortgages: the contractual monthly payment. */
  monthlyPayment?: Pence;
  /** Investments, pensions and property: the value on a date. The latest sets the balance. */
  valuations?: { date: ISODate; value: Pence }[];
  /** Shared with a household (P11): its transactions and bills are shared too. */
  spaceId?: string;
  /** Sync user id of whoever shared it; only they can stop sharing it. */
  ownerId?: string;
}

/** Keys into the category palette in tokens.css (--cat-<color>). */
export type CategoryColor = 'groceries' | 'eating' | 'transport' | 'bills' | 'shopping' | 'fun' | 'income';
export const CATEGORY_COLORS: CategoryColor[] = ['groceries', 'eating', 'transport', 'bills', 'shopping', 'fun', 'income'];

export interface Category {
  id: string;
  name: string;
  color: CategoryColor;
  kind: 'expense' | 'income' | 'transfer';
  /** Display order in lists and pickers. */
  order: number;
  archived?: boolean;
  /** Built-in categories (Transfers) that cannot be edited or picked by hand. */
  system?: boolean;
}

export const TRANSFER_CATEGORY_ID = 'transfer';
/** Fallbacks for imported rows that no rule or history can categorise. */
export const OTHER_EXPENSE_ID = 'other';
export const OTHER_INCOME_ID = 'other-income';

export interface Transaction {
  id: string;
  accountId: string;
  date: ISODate;
  /** 'HH:MM', when known. */
  time?: string;
  /** Negative for money out, positive for money in. */
  amount: Pence;
  payee: string;
  categoryId: string;
  note?: string;
  /** Set when this transaction is a payment of a recurring bill. */
  recurringId?: string;
  /** Both halves of a transfer between accounts share this id. Transfers are not spending or income. */
  transferId?: string;
  /** The pieces of one payment split across categories share this id; splitIndex orders them. */
  splitId?: string;
  splitIndex?: number;
  /** The bank's original description, kept when the payee was cleaned up on import. */
  rawPayee?: string;
  importBatchId?: string;
  /** account|date|amount|payee key used to skip duplicates on import. */
  fingerprint?: string;
  /** The bank's id for a transaction from a bank connection (P5). */
  externalId?: string;
  /** Your own labels across categories, e.g. "Holiday 2027" or "Work expense". */
  tags?: string[];
  /** Tax heading id (see lib/tax), for the tax helper. */
  tax?: string;
  /** Purchases: last day to return it, and when the warranty ends (reminders before both). */
  returnBy?: ISODate;
  warrantyUntil?: ISODate;
  /** Household the transaction is shared with (set from its account). */
  spaceId?: string;
  createdAt?: number;
  updatedAt?: number;
}

export type PaymentMethod = 'direct-debit' | 'standing-order' | 'card';

export interface Recurring {
  id: string;
  name: string;
  /** Positive amount of each payment. */
  amount: Pence;
  /** Amount before the latest change, to flag price rises. */
  previousAmount?: Pence;
  amountChangedOn?: ISODate;
  priceAlertDismissed?: boolean;
  frequency: Frequency;
  startDate: ISODate;
  /** Last possible payment date, for cancelled or fixed-term payments. */
  endDate?: ISODate;
  method: PaymentMethod;
  accountId: string;
  categoryId: string;
  /** False when paused. */
  active: boolean;
  /** Free trial: the first payment is taken on this date unless cancelled. */
  trialEndsOn?: ISODate;
  /** Household the bill is shared with (set from its account). */
  spaceId?: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  monthlyLimit: Pence;
}

export type RuleMatch = 'contains' | 'startsWith' | 'exact';

/** Auto-categorisation: the first matching rule (lowest priority number) sets the category. */
export interface Rule {
  id: string;
  match: RuleMatch;
  /** Compared case-insensitively against the cleaned payee. */
  pattern: string;
  categoryId: string;
  priority: number;
}

/** Rename a payee everywhere it appears in future imports: "TESCO STORES 3297" → "Tesco". */
export interface PayeeAlias {
  id: string;
  /** Normalised key of the original payee (see payeeKey). */
  from: string;
  to: string;
}

export interface ImportBatch {
  id: string;
  accountId: string;
  fileName: string;
  importedAt: number;
  rowCount: number;
}

export interface Goal {
  id: string;
  name: string;
  target: Pence;
  saved: Pence;
  deadline?: ISODate;
  createdAt: number;
}

export type ThemePreference = 'system' | 'light' | 'dark';
export type BudgetPeriod = 'month' | 'payday';

export interface Settings {
  id: 'app';
  /** False until the first-run setup is finished. */
  onboarded: boolean;
  /** Day of the month salary arrives. */
  payday: number;
  /** Set aside each pay cycle; excluded from "safe to spend". */
  monthlySavings: Pence;
  theme: ThemePreference;
  /** Interface language code (see LANGUAGES in src/i18n). */
  language: string;
  /** ISO 4217 code used to display amounts. Changing it does not convert anything. */
  currency: string;
  /** Calendar months, or payday to the day before the next payday. */
  budgetPeriod: BudgetPeriod;
  /** Carry unspent (or overspent) budget into the next period. */
  budgetRollover: boolean;
  /** Warn when the forecast balance drops below this. */
  lowBalanceThreshold: Pence;
  lastBackupAt?: number;
  /** Legacy (before encryption): PBKDF2 hash of the app-lock PIN. Replaced by the keyring on the next unlock. */
  pinHash?: string;
  pinSalt?: string;
  /** Privacy mode: amounts show as £•••. */
  hideAmounts?: boolean;
  /** This device's notification choices. */
  notifications?: NotificationSettings;
  /** Searches saved on the Search page (synced). */
  savedSearches?: SavedSearch[];
  /** Country whose tax year and headings the tax helper uses (ISO code). Default GB. */
  taxCountry?: string;
  /** Lock again after this many minutes in the background. */
  lockAfterMinutes: number;
  /** Payees whose "add as bill?" suggestion was dismissed (payee keys). */
  dismissedSuggestions?: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  onboarded: false,
  payday: 25,
  monthlySavings: 20000,
  theme: 'system',
  language: 'en',
  currency: 'GBP',
  budgetPeriod: 'month',
  budgetRollover: false,
  lowBalanceThreshold: 10000,
  lockAfterMinutes: 5,
};

export interface FinanceData {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  recurring: Recurring[];
  budgets: Budget[];
  rules: Rule[];
  aliases: PayeeAlias[];
  importBatches: ImportBatch[];
  goals: Goal[];
  bankConnections: BankConnection[];
  people: Person[];
  ious: Iou[];
  settings: Settings;
}

/**
 * A copy of the data key, wrapped (encrypted) by a key derived from the PIN or from a passkey.
 * Stored unencrypted: it is useless without the PIN or passkey.
 */
export interface KeyEntry {
  /** 'pin', or 'passkey:<credential id>'. */
  id: string;
  kind: 'pin' | 'passkey' | 'native';
  /** base64: PBKDF2 salt for a PIN, PRF input for a passkey. */
  salt: string;
  iterations?: number;
  /** base64(iv ‖ AES-GCM(data key)). */
  wrapped: string;
  /** base64url credential id (passkeys). */
  credentialId?: string;
  createdAt: number;
}

/** A record changed on this device and not yet sent to the sync server. */
export interface OutboxEntry {
  /** `${table}/${key}` */
  id: string;
  table: string;
  key: string;
  /** When it changed (ms); a push only clears entries that did not change again meanwhile. */
  at: number;
}

/** This device's sync account. One row, id 'sync'. */
export interface SyncState {
  id: 'sync';
  token: string;
  userId: string;
  email: string;
  deviceId: string;
  /** base64 sync key, from the account's vault. Absent until this device has the recovery key. */
  syncKey?: string;
  /** Shown again in Settings so it can be written down later. */
  recoveryKey?: string;
  /** Highest server sequence number applied here. */
  cursor: number;
  /** The same, for each household stream. */
  spaceCursors?: Record<string, number>;
  lastSyncAt?: number;
}

export interface NotificationSettings {
  enabled: boolean;
  /** Alert types switched off (see ALERT_TYPES in lib/alerts). */
  off: string[];
  /** Quiet hours, "HH:MM" local time; notifications wait until the end. Equal times: no quiet hours. */
  quietStart: string;
  quietEnd: string;
}

/** What this device has done with an alert. Device-local, never synced. */
export interface Notice {
  id: string;
  seenAt?: number;
  notifiedAt?: number;
}

/** A bank connected through Open Banking (P5). Synced, so every device knows the mapping. */
export interface BankConnection {
  /** The server's link id. */
  id: string;
  institutionName: string;
  status: 'pending' | 'linked' | 'expired' | 'failed';
  /** ISO timestamp: consent must be renewed before this (usually 90 days). */
  expiresAt: string;
  accounts: BankConnectionAccount[];
}

export interface BankConnectionAccount {
  bankAccountId: string;
  name: string;
  mask: string | null;
  /** The Ledger account its transactions go into; undefined when not imported. */
  accountId?: string;
  lastSyncedAt?: number;
  /** The balance the bank last reported, to compare with Ledger's. */
  bankBalance?: number | null;
}

/** A receipt photo or document attached to a transaction. Encrypted at rest and synced like the rest. */
export interface Attachment {
  id: string;
  transactionId: string;
  name: string;
  /** MIME type: image/jpeg, image/png, image/webp or application/pdf. */
  type: string;
  /** Bytes, after compression. */
  size: number;
  /** base64 (no data: prefix). */
  data: string;
  createdAt: number;
}

/** A household you belong to, with its encryption key. Synced (end-to-end encrypted) to your devices. */
export interface SpaceKey {
  /** The server's space id. */
  id: string;
  name: string;
  /** base64 household key. */
  key: string;
  joinedAt: number;
}

/** Someone you split costs with. */
export interface Person {
  id: string;
  name: string;
  /** Payment link, e.g. https://monzo.me/alex or https://paypal.me/alex. */
  payLink?: string;
  archived?: boolean;
}

/** Money between you and a person: positive, they owe you; negative, you owe them. */
export interface Iou {
  id: string;
  personId: string;
  date: ISODate;
  amount: Pence;
  note?: string;
  /** The expense it came from, if any. */
  transactionId?: string;
  /** A payment that settles up (rather than a new debt). */
  settlement?: boolean;
}
