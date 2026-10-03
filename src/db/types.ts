import type { ISODate } from '../lib/dates';
import type { Pence } from '../lib/money';
import type { Frequency } from '../lib/recurring';

export type AccountType = 'current' | 'credit' | 'savings' | 'cash';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  openingBalance: Pence;
  /** Counted in "safe to spend". Defaults to true for current and cash accounts. */
  includeInSafeToSpend: boolean;
  archived?: boolean;
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
  /** PBKDF2 hash of the app-lock PIN, base64. */
  pinHash?: string;
  pinSalt?: string;
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
  settings: Settings;
}
