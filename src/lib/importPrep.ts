/**
 * Turns raw statement rows (from a CSV file or a bank connection) into rows ready to import:
 * tidy payee, category from rules and history, bill match, and duplicate check.
 */
import { OTHER_EXPENSE_ID, OTHER_INCOME_ID, TRANSFER_CATEGORY_ID, type Account, type FinanceData } from '../db/types';
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
  /** A category named in the file: used when it matches one of yours. */
  categoryName?: string;
  /** A tidy payee named in the file: used as it is. */
  payeeName?: string;
}

/** A row with its suggested category, matched bill and whether it is already in Mizan. */
export interface PreparedRow extends RawRow {
  payee: string;
  categoryId: string;
  recurringId?: string;
  billName?: string;
  duplicate: boolean;
  /** The file named the Transfers category: the row is a transfer with another of your accounts. */
  transfer?: boolean;
  /** The file named a category that does not exist in Mizan (the suggested one is used instead). */
  unknownCategory?: string;
}

/** Category and account names compared without case, accents or extra spaces. */
export const nameKey = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

/** Prepares rows for import the same way for CSV files and bank connections. */
export function prepareRows<T extends RawRow>(data: FinanceData, accountId: string, rows: T[]): (T & PreparedRow)[] {
  const known = new Set(data.transactions.filter((t) => t.externalId && t.accountId === accountId).map((t) => t.externalId));
  const withDupes = markDuplicates(rows, data.transactions, accountId);
  const expense = new Set(data.categories.filter((c) => c.kind === 'expense' && !c.system && !c.archived).map((c) => c.id));
  const income = new Set(data.categories.filter((c) => c.kind === 'income' && !c.archived).map((c) => c.id));
  const taken = paidOccurrenceKeys(data.recurring, data.transactions);
  const byName = new Map(data.categories.filter((c) => !c.archived).map((c) => [nameKey(c.name), c]));
  // Transfers already in the account, by day and amount: their wording may differ from the file's.
  const transfersHere = new Map<string, number>();
  for (const x of data.transactions) {
    if (x.accountId !== accountId || !x.transferId) continue;
    transfersHere.set(`${x.date}|${x.amount}`, (transfersHere.get(`${x.date}|${x.amount}`) ?? 0) + 1);
  }

  return withDupes.map((r) => {
    // Your renames win (of the exact bank description, then of the tidied one); then the merchant
    // directory's clean name; then the tidied description.
    const aliasedRaw = applyAlias(r.rawPayee, data.aliases);
    const tidy = normalisePayee(r.rawPayee);
    const renamed = aliasedRaw !== r.rawPayee ? aliasedRaw : applyAlias(tidy, data.aliases);
    const payee = r.payeeName || (renamed !== tidy ? renamed : (findMerchant(r.rawPayee)?.name ?? tidy));
    let duplicate = (r.externalId !== undefined && known.has(r.externalId)) || r.duplicate;
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
    // A category named in the file wins over suggestions and bills; Transfers makes it a transfer.
    let transfer: boolean | undefined;
    let unknownCategory: string | undefined;
    if (r.categoryName) {
      const named = byName.get(nameKey(r.categoryName));
      if (named?.id === TRANSFER_CATEGORY_ID) {
        transfer = true;
        const key = `${r.date}|${r.amount}`;
        const n = transfersHere.get(key) ?? 0;
        if (!duplicate && n > 0) duplicate = true;
        if (n > 0) transfersHere.set(key, n - 1);
        categoryId = TRANSFER_CATEGORY_ID;
        recurringId = undefined;
        billName = undefined;
      } else if (named) categoryId = named.id;
      else unknownCategory = r.categoryName;
    }
    return { ...r, payee, categoryId, recurringId, billName, duplicate, transfer, unknownCategory };
  });
}

/** Edits needed to turn one name into another (to forgive typos such as "Narwest"). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The account a name in a file means: the same name; else the only account whose name starts with it
 * (or it with theirs, "Lloyd" for "Lloyd Credit Card"); else the only one a typo or two away.
 */
export function matchAccount(name: string, accounts: Account[]): string | undefined {
  const key = nameKey(name);
  if (!key) return undefined;
  const open = accounts.filter((a) => !a.archived);
  const only = (list: Account[]) => (list.length === 1 ? list[0].id : undefined);
  return (
    open.find((a) => nameKey(a.name) === key)?.id ??
    only(open.filter((a) => nameKey(a.name).startsWith(key) || key.startsWith(nameKey(a.name)))) ??
    only(open.filter((a) => distance(nameKey(a.name), key) <= Math.min(2, Math.floor(key.length / 4))))
  );
}

/** The other account of a transfer row: the source when it is not this account, else the destination. */
export function otherAccountName(
  row: { accountName?: string; sourceName?: string; destinationName?: string },
  accountOf: (name: string) => string | undefined,
): string | undefined {
  const own = row.accountName ? accountOf(row.accountName) : undefined;
  for (const name of [row.sourceName, row.destinationName]) {
    if (name && (own === undefined || accountOf(name) !== own)) return name;
  }
  return undefined;
}

/** A transfer row about to be saved: its account, the other account, date and amount. */
export interface TransferSide {
  accountId: string;
  transferAccountId?: string;
  date: ISODate;
  amount: Pence;
}

/**
 * Pairs transfer rows that are the two sides of one transfer: in each other's account, on the same day,
 * for opposite amounts. Returns each paired row's partner (by index); unpaired rows get their other side
 * made for them.
 */
export function pairTransfers(rows: TransferSide[]): Map<number, number> {
  const partner = new Map<number, number>();
  const waiting = new Map<string, number[]>();
  const key = (from: string, to: string, date: ISODate, amount: Pence) => `${from}|${to}|${date}|${amount}`;
  rows.forEach((r, i) => {
    if (!r.transferAccountId) return;
    const match = waiting.get(key(r.transferAccountId, r.accountId, r.date, -r.amount));
    const j = match?.shift();
    if (j !== undefined) {
      partner.set(i, j);
      partner.set(j, i);
      return;
    }
    const mine = key(r.accountId, r.transferAccountId, r.date, r.amount);
    waiting.set(mine, [...(waiting.get(mine) ?? []), i]);
  });
  return partner;
}
