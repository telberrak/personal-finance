/**
 * Advanced search over transactions: text, dates, amounts, accounts, categories, tags and
 * direction. Filters are plain data, so they can be saved and shared between devices.
 */
import type { Transaction } from '../db/types';
import type { ISODate } from './dates';
import type { Pence } from './money';
import { payeeKey } from './payees';

/** Advanced search: text, dates, amounts, category, account, tag and direction. Empty fields are ignored. */
export interface SearchFilters {
  text?: string;
  from?: ISODate;
  to?: ISODate;
  /** Amount range of the absolute value, in pence. */
  min?: Pence;
  max?: Pence;
  accountId?: string;
  categoryId?: string;
  tag?: string;
  direction?: 'in' | 'out';
}

/** A named search, kept in settings. */
export interface SavedSearch {
  id: string;
  name: string;
  filters: SearchFilters;
}

/** Transactions matching every filter. */
export function searchTransactions(transactions: Transaction[], f: SearchFilters): Transaction[] {
  const words = payeeKey(f.text ?? '')
    .split(' ')
    .filter(Boolean);
  const tag = f.tag?.toLowerCase();
  return transactions.filter((t) => {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    const size = Math.abs(t.amount);
    if (f.min !== undefined && size < f.min) return false;
    if (f.max !== undefined && size > f.max) return false;
    if (f.accountId && t.accountId !== f.accountId) return false;
    if (f.categoryId && t.categoryId !== f.categoryId) return false;
    if (f.direction === 'in' && t.amount < 0) return false;
    if (f.direction === 'out' && t.amount > 0) return false;
    if (tag && !t.tags?.some((x) => x.toLowerCase() === tag)) return false;
    if (words.length) {
      const haystack = ` ${payeeKey([t.payee, t.rawPayee, t.note, ...(t.tags ?? [])].filter(Boolean).join(' '))} `;
      if (!words.every((w) => haystack.includes(w))) return false;
    }
    return true;
  });
}

/** Every tag used, most used first. */
export function allTags(transactions: Transaction[]): string[] {
  const counts = new Map<string, number>();
  for (const t of transactions) for (const tag of t.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/** Whether any filter is set. */
export const hasFilters = (f: SearchFilters) => Object.values(f).some((v) => v !== undefined && v !== '');
