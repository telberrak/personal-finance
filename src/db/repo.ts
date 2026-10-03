/**
 * The only module that writes to the database. Screens read through useFinanceData() and
 * write through these functions, so validation, undo and rules live in one place.
 */
import { t } from '../i18n';
import { today, type ISODate } from '../lib/dates';
import { newId } from '../lib/id';
import { fingerprint } from '../lib/importer';
import type { Pence } from '../lib/money';
import { payeeKey } from '../lib/payees';
import { hashPin, isValidPin } from '../lib/pin';
import { db, transferCategory } from './db';
import { defaultCategories, seedDemoData } from './seed';
import {
  DEFAULT_SETTINGS,
  OTHER_EXPENSE_ID,
  OTHER_INCOME_ID,
  TRANSFER_CATEGORY_ID,
  type Account,
  type Category,
  type Goal,
  type ImportBatch,
  type Recurring,
  type Rule,
  type Settings,
  type Transaction,
} from './types';

export class ValidationError extends Error {
  name = 'ValidationError';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALL_TABLES = () => [
  db.accounts,
  db.categories,
  db.transactions,
  db.recurring,
  db.budgets,
  db.settings,
  db.rules,
  db.payeeAliases,
  db.importBatches,
  db.goals,
];

/** Throws a ValidationError with the translated message for `key` (under errors.* in the locale files). */
function check(condition: unknown, key: string, params?: Record<string, unknown>): asserts condition {
  if (!condition) throw new ValidationError(t(key, params));
}

const isPence = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

// ---------------------------------------------------------------- setup

/** Clears everything and creates a single account from the first-run form. */
export async function completeOnboarding(input: {
  accountName: string;
  balance: Pence;
  payday: number;
  monthlySavings: Pence;
}): Promise<void> {
  check(input.accountName.trim(), 'errors.accountNameMissing');
  check(isPence(input.balance), 'errors.balanceNotAmount');
  await db.transaction('rw', ALL_TABLES(), async () => {
    await Promise.all(ALL_TABLES().map((t) => t.clear()));
    await db.accounts.put({
      id: newId(),
      name: input.accountName.trim(),
      type: 'current',
      openingBalance: input.balance,
      includeInSafeToSpend: true,
    });
    await db.categories.bulkPut([...defaultCategories(), transferCategory()]);
    await db.settings.put({ ...DEFAULT_SETTINGS, payday: input.payday, monthlySavings: input.monthlySavings, onboarded: true });
  });
}

export async function startWithDemoData(): Promise<void> {
  await seedDemoData();
}

/** Replaces everything with fresh demo data, keeping theme and lock settings. */
export async function resetDemoData(): Promise<void> {
  const keep = await db.settings.get('app');
  await startWithDemoData();
  if (keep) await db.settings.update('app', { theme: keep.theme, pinHash: keep.pinHash, pinSalt: keep.pinSalt });
}

/** Removes all money data but keeps settings, categories and an empty account, so the app stays usable. */
export async function eraseAllData(): Promise<void> {
  await db.transaction('rw', ALL_TABLES(), async () => {
    await Promise.all([
      db.accounts.clear(),
      db.transactions.clear(),
      db.recurring.clear(),
      db.budgets.clear(),
      db.rules.clear(),
      db.payeeAliases.clear(),
      db.importBatches.clear(),
      db.goals.clear(),
    ]);
    await db.accounts.put({ id: newId(), name: t('accounts.defaultName'), type: 'current', openingBalance: 0, includeInSafeToSpend: true });
    if ((await db.categories.count()) === 0) await db.categories.bulkPut([...defaultCategories(), transferCategory()]);
  });
}

// ---------------------------------------------------------------- transactions

export type NewTransaction = Omit<Transaction, 'id'>;

function validateTransaction(t: NewTransaction): void {
  check(isPence(t.amount) && t.amount !== 0, 'errors.amountNonZero');
  check(ISO_DATE.test(t.date), 'errors.invalidDateValue', { date: t.date });
  check(t.payee.trim(), 'errors.payeeRequired');
  check(t.accountId, 'errors.accountRequired');
  check(t.categoryId, 'errors.categoryRequired');
}

export async function addTransaction(input: NewTransaction): Promise<string> {
  const t = { ...input, payee: input.payee.trim(), note: input.note?.trim() || undefined, createdAt: Date.now() };
  validateTransaction(t);
  const id = newId();
  await db.transactions.add({ ...t, id });
  return id;
}

/** Fields every piece of a split shares; editing one piece's copy updates them all. */
const SHARED_SPLIT_FIELDS = ['payee', 'date', 'time', 'accountId'] as const;

export async function updateTransaction(id: string, patch: Partial<NewTransaction>): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const current = await db.transactions.get(id);
    check(current, 'errors.transactionNotFound');
    check(!current.splitId || patch.amount === undefined || patch.amount === current.amount, 'errors.splitAmountLocked');
    const next = { ...current, ...patch, updatedAt: Date.now() };
    if (patch.payee !== undefined) next.payee = patch.payee.trim();
    if (patch.note !== undefined) next.note = patch.note.trim() || undefined;
    validateTransaction(next);
    await db.transactions.put(next);
    if (current.splitId) {
      const shared = Object.fromEntries(SHARED_SPLIT_FIELDS.filter((k) => k in patch).map((k) => [k, next[k]]));
      if (Object.keys(shared).length) {
        await db.transactions.filter((t) => t.splitId === current.splitId && t.id !== id).modify(shared);
      }
    }
  });
}

/** The transaction and anything paired with it: both halves of a transfer, or every piece of a split. */
async function linkedGroup(t: Transaction): Promise<Transaction[]> {
  if (t.transferId) return db.transactions.where('transferId').equals(t.transferId).toArray();
  if (t.splitId) {
    const pieces = await db.transactions.filter((x) => x.splitId === t.splitId).toArray();
    return pieces.sort((a, b) => (a.splitIndex ?? 0) - (b.splitIndex ?? 0));
  }
  return [t];
}

export interface SplitPart {
  categoryId: string;
  /** Positive amount of this piece; the sign follows the original payment. */
  amount: Pence;
  note?: string;
}

/**
 * Divides a payment across categories (or re-divides an existing split). Each piece is an
 * ordinary transaction, so budgets and reports need no special handling. Returns an undo function.
 */
export async function splitTransaction(id: string, parts: SplitPart[]): Promise<() => Promise<void>> {
  return db.transaction('rw', db.transactions, db.categories, async () => {
    const t = await db.transactions.get(id);
    check(t, 'errors.transactionNotFound');
    check(!t.transferId, 'errors.transferNoSplit');
    const group = await linkedGroup(t);
    const total = group.reduce((s, x) => s + x.amount, 0);
    const sign = total < 0 ? -1 : 1;
    check(parts.length >= 2, 'errors.splitTwoParts');
    check(
      parts.every((p) => isPence(p.amount) && p.amount > 0),
      'errors.splitPartAmount',
    );
    check(parts.reduce((s, p) => s + p.amount, 0) === Math.abs(total), 'errors.splitTotal');
    const kind = sign < 0 ? 'expense' : 'income';
    for (const p of parts) {
      const cat = await db.categories.get(p.categoryId);
      check(cat && cat.kind === kind, kind === 'expense' ? 'errors.pickSpendingCategories' : 'errors.pickIncomeCategories');
    }

    const first = group[0];
    const splitId = first.splitId ?? newId();
    const pieces: Transaction[] = parts.map((p, i) => ({
      id: group[i]?.id ?? newId(),
      accountId: first.accountId,
      date: first.date,
      time: first.time,
      payee: first.payee,
      rawPayee: first.rawPayee,
      importBatchId: first.importBatchId,
      createdAt: first.createdAt,
      updatedAt: Date.now(),
      amount: sign * p.amount,
      categoryId: p.categoryId,
      note: p.note?.trim() || undefined,
      splitId,
      splitIndex: i,
      // The bank row and bill link stay with the first piece, so imports still spot the duplicate.
      fingerprint: i === 0 ? first.fingerprint : undefined,
      recurringId: i === 0 ? first.recurringId : undefined,
    }));
    await db.transactions.bulkDelete(group.map((x) => x.id));
    await db.transactions.bulkPut(pieces);
    return async () => {
      await db.transactions.bulkDelete(pieces.map((x) => x.id));
      await db.transactions.bulkPut(group);
    };
  });
}

/** Turns a split back into one transaction in the first piece's category. Returns an undo function. */
export async function mergeSplit(id: string): Promise<() => Promise<void>> {
  return db.transaction('rw', db.transactions, async () => {
    const t = await db.transactions.get(id);
    check(t?.splitId, 'errors.notSplit');
    const group = await linkedGroup(t);
    const { splitId: _s, splitIndex: _i, ...first } = group[0];
    const merged: Transaction = { ...first, amount: group.reduce((s, x) => s + x.amount, 0), updatedAt: Date.now() };
    await db.transactions.bulkDelete(group.map((x) => x.id));
    await db.transactions.put(merged);
    return async () => {
      await db.transactions.delete(merged.id);
      await db.transactions.bulkPut(group);
    };
  });
}

/** Deletes a transaction (with its transfer half or split pieces) and returns a function that puts it back. */
export async function deleteTransaction(id: string): Promise<() => Promise<void>> {
  const existing = await db.transactions.get(id);
  if (!existing) return async () => {};
  const removed = await linkedGroup(existing);
  await db.transactions.bulkDelete(removed.map((t) => t.id));
  return async () => {
    await db.transactions.bulkPut(removed);
  };
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: Pence;
  date: ISODate;
  note?: string;
}

async function transferPair(input: TransferInput, transferId: string, ids?: [string, string]): Promise<[Transaction, Transaction]> {
  check(isPence(input.amount) && input.amount > 0, 'errors.amountPositive');
  check(input.fromAccountId && input.toAccountId && input.fromAccountId !== input.toAccountId, 'errors.transferSameAccount');
  check(ISO_DATE.test(input.date), 'errors.invalidDate');
  const [from, to] = await Promise.all([db.accounts.get(input.fromAccountId), db.accounts.get(input.toAccountId)]);
  check(from && to, 'errors.accountNotFound');
  const base = { date: input.date, categoryId: TRANSFER_CATEGORY_ID, transferId, note: input.note?.trim() || undefined };
  return [
    { ...base, id: ids?.[0] ?? newId(), accountId: from.id, amount: -input.amount, payee: t('transactions.transferTo', { name: to.name }) },
    {
      ...base,
      id: ids?.[1] ?? newId(),
      accountId: to.id,
      amount: input.amount,
      payee: t('transactions.transferFrom', { name: from.name }),
    },
  ];
}

/** Moves money between two of your accounts: two linked transactions that are not spending or income. */
export async function addTransfer(input: TransferInput): Promise<string> {
  const transferId = newId();
  const pair = await transferPair(input, transferId);
  await db.transactions.bulkAdd(pair.map((t) => ({ ...t, createdAt: Date.now() })));
  return pair[0].id;
}

export async function updateTransfer(transferId: string, input: TransferInput): Promise<void> {
  await db.transaction('rw', db.transactions, db.accounts, async () => {
    const existing = await db.transactions.where('transferId').equals(transferId).sortBy('amount');
    check(existing.length === 2, 'errors.transferNotFound');
    const pair = await transferPair(input, transferId, [existing[0].id, existing[1].id]);
    await db.transactions.bulkPut(pair.map((t) => ({ ...t, updatedAt: Date.now() })));
  });
}

// ---------------------------------------------------------------- accounts

export type AccountInput = Omit<Account, 'id'> & { id?: string };

export async function saveAccount(input: AccountInput): Promise<string> {
  check(input.name.trim(), 'errors.accountNameRequired');
  check(isPence(input.openingBalance), 'errors.openingNotAmount');
  const id = input.id ?? newId();
  await db.accounts.put({ ...input, id, name: input.name.trim() });
  return id;
}

export async function setAccountArchived(id: string, archived: boolean): Promise<void> {
  if (archived) {
    const active = (await db.accounts.toArray()).filter((a) => !a.archived && a.id !== id);
    check(active.length > 0, 'errors.lastAccount');
  }
  await db.accounts.update(id, { archived });
}

// ---------------------------------------------------------------- categories

export type CategoryInput = Pick<Category, 'name' | 'color' | 'kind'> & { id?: string };

export async function saveCategory(input: CategoryInput): Promise<string> {
  check(input.name.trim(), 'errors.categoryNameRequired');
  check(input.kind !== 'transfer', 'errors.transfersBuiltIn');
  if (input.id) {
    const existing = await db.categories.get(input.id);
    check(existing && !existing.system, 'errors.categoryNotEditable');
    await db.categories.update(input.id, { name: input.name.trim(), color: input.color, kind: input.kind });
    return input.id;
  }
  const max = (await db.categories.toArray()).filter((c) => !c.system).reduce((m, c) => Math.max(m, c.order), 0);
  const id = newId();
  await db.categories.add({ id, name: input.name.trim(), color: input.color, kind: input.kind, order: max + 1 });
  return id;
}

/** Archives a category and moves its transactions, bills, rules and budget to `reassignTo`. */
export async function archiveCategory(id: string, reassignTo: string): Promise<void> {
  check(id !== reassignTo, 'errors.reassignSame');
  await db.transaction('rw', [db.categories, db.transactions, db.recurring, db.rules, db.budgets], async () => {
    const [cat, target] = await Promise.all([db.categories.get(id), db.categories.get(reassignTo)]);
    check(cat && !cat.system, 'errors.categoryNotArchivable');
    check(target && !target.archived && target.kind === cat.kind, 'errors.reassignKind');
    await db.transactions.where('categoryId').equals(id).modify({ categoryId: reassignTo });
    await db.recurring.filter((r) => r.categoryId === id).modify({ categoryId: reassignTo });
    await db.rules.filter((r) => r.categoryId === id).modify({ categoryId: reassignTo });
    await db.budgets.where('categoryId').equals(id).delete();
    await db.categories.update(id, { archived: true });
  });
}

export async function restoreCategory(id: string): Promise<void> {
  await db.categories.update(id, { archived: false });
}

/** Swaps a category with its neighbour in display order. */
export async function moveCategory(id: string, direction: -1 | 1): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const list = (await db.categories.orderBy('order').toArray()).filter((c) => !c.system && !c.archived);
    const i = list.findIndex((c) => c.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return;
    await db.categories.update(list[i].id, { order: list[j].order });
    await db.categories.update(list[j].id, { order: list[i].order });
  });
}

// ---------------------------------------------------------------- bills

export type RecurringInput = Omit<Recurring, 'id' | 'previousAmount' | 'amountChangedOn' | 'priceAlertDismissed'> & { id?: string };

export async function saveRecurring(input: RecurringInput): Promise<string> {
  check(input.name.trim(), 'errors.nameRequired');
  check(isPence(input.amount) && input.amount > 0, 'errors.amountPositive');
  check(ISO_DATE.test(input.startDate), 'errors.startDateRequired');
  check(!input.endDate || input.endDate >= input.startDate, 'errors.endBeforeStart');
  check(input.accountId && input.categoryId, 'errors.accountAndCategory');
  const id = input.id ?? newId();
  await db.transaction('rw', db.recurring, async () => {
    const existing = input.id ? await db.recurring.get(input.id) : undefined;
    const priceChange =
      existing && existing.amount !== input.amount
        ? { previousAmount: existing.amount, amountChangedOn: today(), priceAlertDismissed: false }
        : {
            previousAmount: existing?.previousAmount,
            amountChangedOn: existing?.amountChangedOn,
            priceAlertDismissed: existing?.priceAlertDismissed,
          };
    await db.recurring.put({ ...input, ...priceChange, id, name: input.name.trim() });
  });
  return id;
}

export async function setRecurringActive(id: string, active: boolean): Promise<void> {
  await db.recurring.update(id, { active });
}

/** Deletes a bill. Past payments stay as ordinary transactions. */
export async function deleteRecurring(id: string): Promise<void> {
  await db.transaction('rw', db.recurring, db.transactions, async () => {
    await db.transactions
      .where('recurringId')
      .equals(id)
      .modify((t) => {
        delete t.recurringId;
      });
    await db.recurring.delete(id);
  });
}

export async function dismissPriceAlert(id: string): Promise<void> {
  await db.recurring.update(id, { priceAlertDismissed: true });
}

/** Records a bill payment for a due date, linked to the bill. */
export async function markBillPaid(rule: Recurring, date: ISODate): Promise<string> {
  return addTransaction({
    accountId: rule.accountId,
    date: date > today() ? today() : date,
    amount: -rule.amount,
    payee: rule.name,
    categoryId: rule.categoryId,
    recurringId: rule.id,
  });
}

/** Links an existing payment to a bill (or unlinks it with undefined). */
export async function linkToBill(transactionId: string, recurringId: string | undefined): Promise<void> {
  await db.transactions.update(transactionId, { recurringId });
}

/** Hides an "add as bill?" suggestion for this payee. */
export async function dismissSuggestion(key: string): Promise<void> {
  const settings = (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
  await updateSettings({ dismissedSuggestions: [...new Set([...(settings.dismissedSuggestions ?? []), key])] });
}

// ---------------------------------------------------------------- budgets

/** Sets a category's monthly limit, or removes the budget with null. */
export async function setBudget(categoryId: string, limit: Pence | null): Promise<void> {
  await db.transaction('rw', db.budgets, async () => {
    const existing = await db.budgets.where('categoryId').equals(categoryId).first();
    if (limit === null || limit === 0) {
      if (existing) await db.budgets.delete(existing.id);
      return;
    }
    check(isPence(limit) && limit > 0, 'errors.budgetPositive');
    await db.budgets.put({ id: existing?.id ?? newId(), categoryId, monthlyLimit: limit });
  });
}

// ---------------------------------------------------------------- rules and payee names

export type RuleInput = Omit<Rule, 'id' | 'priority'> & { id?: string; priority?: number };

export async function saveRule(input: RuleInput): Promise<string> {
  check(input.pattern.trim(), 'errors.patternRequired');
  check(input.categoryId, 'errors.pickCategory');
  const id = input.id ?? newId();
  const priority = input.priority ?? ((await db.rules.orderBy('priority').last())?.priority ?? 0) + 1;
  await db.rules.put({ id, match: input.match, pattern: input.pattern.trim(), categoryId: input.categoryId, priority });
  return id;
}

export async function deleteRule(id: string): Promise<void> {
  await db.rules.delete(id);
}

/** Applies a rule's category to existing transactions it matches. Returns how many changed. */
export async function applyRuleToHistory(rule: Rule, matches: (payee: string) => boolean): Promise<number> {
  const cat = await db.categories.get(rule.categoryId);
  check(cat, 'errors.categoryNotFound');
  return db.transactions
    .filter(
      (t) => !t.transferId && matches(t.payee) && (cat.kind === 'income' ? t.amount > 0 : t.amount < 0) && t.categoryId !== rule.categoryId,
    )
    .modify({ categoryId: rule.categoryId });
}

/** Renames a payee everywhere, and remembers the name for future imports. Returns how many transactions changed. */
export async function renamePayee(from: string, to: string): Promise<number> {
  const key = payeeKey(from);
  check(key && to.trim(), 'errors.newNameRequired');
  return db.transaction('rw', db.payeeAliases, db.transactions, async () => {
    const existing = await db.payeeAliases.where('from').equals(key).first();
    await db.payeeAliases.put({ id: existing?.id ?? newId(), from: key, to: to.trim() });
    return db.transactions
      .filter((t) => payeeKey(t.payee) === key || (!!t.rawPayee && payeeKey(t.rawPayee) === key))
      .modify({ payee: to.trim() });
  });
}

export async function deleteAlias(id: string): Promise<void> {
  await db.payeeAliases.delete(id);
}

// ---------------------------------------------------------------- import

export interface ImportRow {
  date: ISODate;
  amount: Pence;
  rawPayee: string;
  payee: string;
  categoryId: string;
  recurringId?: string;
}

/** Saves an import in one go, tagged with a batch id so it can be undone. */
export async function importTransactions(accountId: string, fileName: string, rows: ImportRow[]): Promise<ImportBatch> {
  check(rows.length > 0, 'errors.nothingToImport');
  const batch: ImportBatch = { id: newId(), accountId, fileName, importedAt: Date.now(), rowCount: rows.length };
  // Older installs may not have the fallback categories yet.
  const fallbacks = defaultCategories().filter((c) => c.id === OTHER_EXPENSE_ID || c.id === OTHER_INCOME_ID);
  const now = Date.now();
  const transactions: Transaction[] = rows.map((r) => ({
    id: newId(),
    accountId,
    date: r.date,
    amount: r.amount,
    payee: r.payee.trim() || r.rawPayee,
    rawPayee: r.rawPayee,
    categoryId: r.categoryId,
    recurringId: r.recurringId,
    importBatchId: batch.id,
    fingerprint: fingerprint(accountId, r.date, r.amount, r.rawPayee),
    createdAt: now,
  }));
  transactions.forEach(validateTransaction);
  await db.transaction('rw', db.transactions, db.importBatches, db.categories, async () => {
    for (const c of fallbacks) if (!(await db.categories.get(c.id))) await db.categories.put(c);
    await db.importBatches.add(batch);
    await db.transactions.bulkAdd(transactions);
  });
  return batch;
}

export async function undoImport(batchId: string): Promise<number> {
  return db.transaction('rw', db.transactions, db.importBatches, async () => {
    const n = await db.transactions.where('importBatchId').equals(batchId).delete();
    await db.importBatches.delete(batchId);
    return n;
  });
}

// ---------------------------------------------------------------- goals

export type GoalInput = Pick<Goal, 'name' | 'target' | 'saved' | 'deadline'> & { id?: string };

export async function saveGoal(input: GoalInput): Promise<string> {
  check(input.name.trim(), 'errors.goalNameRequired');
  check(isPence(input.target) && input.target > 0, 'errors.targetPositive');
  check(isPence(input.saved) && input.saved >= 0, 'errors.savedNotNegative');
  check(!input.deadline || ISO_DATE.test(input.deadline), 'errors.invalidDate');
  const id = input.id ?? newId();
  const existing = input.id ? await db.goals.get(input.id) : undefined;
  await db.goals.put({ ...input, id, name: input.name.trim(), createdAt: existing?.createdAt ?? Date.now() });
  return id;
}

export async function addToGoal(id: string, amount: Pence): Promise<void> {
  check(isPence(amount) && amount !== 0, 'errors.amountRequired');
  await db.transaction('rw', db.goals, async () => {
    const goal = await db.goals.get(id);
    check(goal, 'errors.goalNotFound');
    await db.goals.update(id, { saved: Math.max(0, goal.saved + amount) });
  });
}

export async function deleteGoal(id: string): Promise<void> {
  await db.goals.delete(id);
}

// ---------------------------------------------------------------- settings

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  if (patch.payday !== undefined) check(Number.isInteger(patch.payday) && patch.payday >= 1 && patch.payday <= 31, 'errors.paydayRange');
  if (patch.monthlySavings !== undefined) check(isPence(patch.monthlySavings) && patch.monthlySavings >= 0, 'errors.savingsNotNegative');
  if (patch.lowBalanceThreshold !== undefined)
    check(isPence(patch.lowBalanceThreshold) && patch.lowBalanceThreshold >= 0, 'errors.thresholdNotNegative');
  await db.transaction('rw', db.settings, async () => {
    const current = (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
    await db.settings.put({ ...DEFAULT_SETTINGS, ...current, ...patch });
  });
}

export async function setPin(pin: string): Promise<void> {
  check(isValidPin(pin), 'errors.pinDigits');
  const { hash, salt } = await hashPin(pin);
  await updateSettings({ pinHash: hash, pinSalt: salt });
}

export async function clearPin(): Promise<void> {
  await db.settings.update('app', { pinHash: undefined, pinSalt: undefined });
}

// ---------------------------------------------------------------- backup

const BACKUP_FORMAT = 'ledger-backup';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 2;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

export async function createBackup(): Promise<Backup> {
  const [accounts, categories, transactions, recurring, budgets, rules, payeeAliases, importBatches, goals, settings] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.recurring.toArray(),
    db.budgets.toArray(),
    db.rules.toArray(),
    db.payeeAliases.toArray(),
    db.importBatches.toArray(),
    db.goals.toArray(),
    // The PIN is tied to this device and never leaves it.
    db.settings.toArray().then((all) => all.map(({ pinHash: _h, pinSalt: _s, ...rest }) => rest)),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: 2,
    exportedAt: new Date().toISOString(),
    data: { accounts, categories, transactions, recurring, budgets, rules, payeeAliases, importBatches, goals, settings },
  };
}

export async function markBackedUp(): Promise<void> {
  await updateSettings({ lastBackupAt: Date.now() });
}

/** Replaces all data with a backup file's contents. The app-lock PIN on this device is kept. */
export async function restoreBackup(json: string): Promise<{ transactions: number }> {
  let parsed: Backup;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ValidationError(t('errors.notBackup'));
  }
  check(parsed?.format === BACKUP_FORMAT && parsed.data && typeof parsed.data === 'object', 'errors.notBackup');
  check(parsed.version <= 2, 'errors.backupTooNew');
  const d = parsed.data;
  const arr = (k: string) => (Array.isArray(d[k]) ? d[k] : []) as never[];
  check(Array.isArray(d.accounts) && Array.isArray(d.transactions), 'errors.backupIncomplete');
  const keep = await db.settings.get('app');
  await db.transaction('rw', ALL_TABLES(), async () => {
    await Promise.all(ALL_TABLES().map((t) => t.clear()));
    await db.accounts.bulkPut(arr('accounts'));
    await db.categories.bulkPut(arr('categories'));
    if (!(await db.categories.get(TRANSFER_CATEGORY_ID))) await db.categories.put(transferCategory());
    await db.transactions.bulkPut(arr('transactions'));
    await db.recurring.bulkPut(arr('recurring'));
    await db.budgets.bulkPut(arr('budgets'));
    await db.rules.bulkPut(arr('rules'));
    await db.payeeAliases.bulkPut(arr('payeeAliases'));
    await db.importBatches.bulkPut(arr('importBatches'));
    await db.goals.bulkPut(arr('goals'));
    const restored = (arr('settings') as Partial<Settings>[])[0] ?? {};
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      ...restored,
      id: 'app',
      onboarded: true,
      pinHash: keep?.pinHash,
      pinSalt: keep?.pinSalt,
      lastBackupAt: Date.now(),
    });
  });
  return { transactions: arr('transactions').length };
}

/** Transactions as CSV for spreadsheets. */
export async function transactionsCsv(): Promise<string> {
  const [transactions, accounts, categories] = await Promise.all([
    db.transactions.orderBy('date').toArray(),
    db.accounts.toArray(),
    db.categories.toArray(),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['Date', 'Time', 'Account', 'Payee', 'Category', 'Amount', 'Note', 'Bank description'].join(',')];
  for (const t of transactions) {
    lines.push(
      [
        t.date,
        t.time ?? '',
        acc.get(t.accountId) ?? '',
        t.payee,
        cat.get(t.categoryId) ?? '',
        (t.amount / 100).toFixed(2),
        t.note ?? '',
        t.rawPayee ?? '',
      ]
        .map((v) => esc(String(v)))
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/** Days since the last backup, or undefined if never. */
export function daysSinceBackup(settings: Settings, now = Date.now()): number | undefined {
  return settings.lastBackupAt === undefined ? undefined : Math.floor((now - settings.lastBackupAt) / 86_400_000);
}

export const backupFileName = () => `ledger-backup-${today()}.json`;
