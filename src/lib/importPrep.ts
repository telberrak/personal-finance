/**
 * Turns raw statement rows (from a CSV file or a bank connection) into rows ready to import:
 * tidy payee, category from rules and history, bill match, and duplicate check.
 */
import { OTHER_EXPENSE_ID, OTHER_INCOME_ID, type FinanceData } from '../db/types';
import type { ISODate } from './dates';
import { markDuplicates } from './importer';
import { findBillMatch, paidOccurrenceKeys } from './matching';
import type { Pence } from './money';
import { findMerchant } from './merchants';
import { applyAlias, normalisePayee } from './payees';
import { suggestCategory } from './rules';

/** A row from a CSV file or a bank, before categories and duplicates are worked out. */
export interface RawRow {
  date: ISODate;
  amount: Pence;
  rawPayee: string;
  /** The bank's own id, when known: rows already imported with it are duplicates. */
  externalId?: string;
}

/** A row with its suggested category, matched bill and whether it is already in Mizan. */
export interface PreparedRow extends RawRow {
  payee: string;
  categoryId: string;
  recurringId?: string;
  billName?: string;
  duplicate: boolean;
}

/** Prepares rows for import the same way for CSV files and bank connections. */
export function prepareRows<T extends RawRow>(data: FinanceData, accountId: string, rows: T[]): (T & PreparedRow)[] {
  const known = new Set(data.transactions.filter((t) => t.externalId && t.accountId === accountId).map((t) => t.externalId));
  const withDupes = markDuplicates(rows, data.transactions, accountId);
  const expense = new Set(data.categories.filter((c) => c.kind === 'expense' && !c.system && !c.archived).map((c) => c.id));
  const income = new Set(data.categories.filter((c) => c.kind === 'income' && !c.archived).map((c) => c.id));
  const taken = paidOccurrenceKeys(data.recurring, data.transactions);

  return withDupes.map((r) => {
    // Your renames win (of the exact bank description, then of the tidied one); then the merchant
    // directory's clean name; then the tidied description.
    const aliasedRaw = applyAlias(r.rawPayee, data.aliases);
    const tidy = normalisePayee(r.rawPayee);
    const renamed = aliasedRaw !== r.rawPayee ? aliasedRaw : applyAlias(tidy, data.aliases);
    const payee = renamed !== tidy ? renamed : (findMerchant(r.rawPayee)?.name ?? tidy);
    const duplicate = (r.externalId !== undefined && known.has(r.externalId)) || r.duplicate;
    const allowed = r.amount < 0 ? expense : income;
    let categoryId = suggestCategory(payee, data.rules, data.transactions, allowed) ?? (r.amount < 0 ? OTHER_EXPENSE_ID : OTHER_INCOME_ID);
    let recurringId: string | undefined;
    let billName: string | undefined;
    if (!duplicate) {
      const match = findBillMatch({ date: r.date, amount: r.amount, payee }, data.recurring, taken);
      if (match) {
        taken.add(`${match.rule.id}|${match.occurrence}`);
        recurringId = match.rule.id;
        billName = match.rule.name;
        categoryId = match.rule.categoryId;
      }
    }
    return { ...r, payee, categoryId, recurringId, billName, duplicate };
  });
}
