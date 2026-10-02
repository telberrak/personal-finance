import type { ISODate } from '../lib/dates';
import type { Pence } from '../lib/money';
import type { Frequency } from '../lib/recurring';

export type AccountType = 'current' | 'credit' | 'savings' | 'cash';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  openingBalance: Pence;
}

/** Keys into the category palette in tokens.css (--cat-<color>). */
export type CategoryColor = 'groceries' | 'eating' | 'transport' | 'bills' | 'shopping' | 'fun' | 'income';

export interface Category {
  id: string;
  name: string;
  color: CategoryColor;
  kind: 'expense' | 'income';
  /** Display order in lists and pickers. */
  order: number;
}

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
}

export type PaymentMethod = 'direct-debit' | 'standing-order' | 'card';

export interface Recurring {
  id: string;
  name: string;
  /** Positive amount of each payment. */
  amount: Pence;
  /** Amount before the latest change, to flag price rises. */
  previousAmount?: Pence;
  frequency: Frequency;
  startDate: ISODate;
  method: PaymentMethod;
  accountId: string;
  categoryId: string;
  active: boolean;
}

export interface Budget {
  id: string;
  categoryId: string;
  monthlyLimit: Pence;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  id: 'app';
  /** Day of the month salary arrives. */
  payday: number;
  /** Set aside each pay cycle; excluded from "safe to spend". */
  monthlySavings: Pence;
  theme: ThemePreference;
}

export const DEFAULT_SETTINGS: Settings = { id: 'app', payday: 25, monthlySavings: 20000, theme: 'system' };

export interface FinanceData {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  recurring: Recurring[];
  budgets: Budget[];
  settings: Settings;
}
