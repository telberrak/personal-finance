import { addDays, daysBetween, shiftMonth, startOfMonth, today, type ISODate } from '../lib/dates';
import { newId } from '../lib/id';
import { occurrencesBetween } from '../lib/recurring';
import { db, TRANSFER_CATEGORY } from './db';
import {
  DEFAULT_SETTINGS,
  OTHER_EXPENSE_ID,
  OTHER_INCOME_ID,
  TRANSFER_CATEGORY_ID,
  type Account,
  type Budget,
  type Category,
  type Recurring,
  type Transaction,
} from './types';

/** Small deterministic PRNG so the demo data looks the same on every install. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Starting categories for every new install. */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'groceries', name: 'Groceries', color: 'groceries', kind: 'expense', order: 1 },
  { id: 'eating', name: 'Eating out', color: 'eating', kind: 'expense', order: 2 },
  { id: 'transport', name: 'Transport', color: 'transport', kind: 'expense', order: 3 },
  { id: 'shopping', name: 'Shopping', color: 'shopping', kind: 'expense', order: 4 },
  { id: 'fun', name: 'Entertainment', color: 'fun', kind: 'expense', order: 5 },
  { id: 'bills', name: 'Bills', color: 'bills', kind: 'expense', order: 6 },
  { id: 'salary', name: 'Salary', color: 'income', kind: 'income', order: 7 },
  { id: 'refund', name: 'Refunds', color: 'income', kind: 'income', order: 8 },
  { id: OTHER_EXPENSE_ID, name: 'Other', color: 'fun', kind: 'expense', order: 9 },
  { id: OTHER_INCOME_ID, name: 'Other income', color: 'income', kind: 'income', order: 10 },
];

const BUDGETS: Budget[] = [
  { id: 'b-groceries', categoryId: 'groceries', monthlyLimit: 30000 },
  { id: 'b-eating', categoryId: 'eating', monthlyLimit: 12000 },
  { id: 'b-transport', categoryId: 'transport', monthlyLimit: 10000 },
  { id: 'b-shopping', categoryId: 'shopping', monthlyLimit: 15000 },
  { id: 'b-fun', categoryId: 'fun', monthlyLimit: 8000 },
];

/** [payee, min £, max £, chance per day] */
const MERCHANTS: Record<string, [string, number, number, number][]> = {
  groceries: [
    ['Tesco Express', 4, 28, 0.35],
    ["Sainsbury's", 25, 70, 0.12],
    ['Lidl', 15, 45, 0.08],
  ],
  eating: [
    ['Pret A Manger', 4, 9, 0.25],
    ['Greggs', 2, 6, 0.12],
    ['Wagamama', 18, 38, 0.04],
  ],
  transport: [
    ['TfL Travel', 2.8, 8.5, 0.45],
    ['Trainline', 12, 45, 0.03],
  ],
  shopping: [
    ['Amazon', 8, 45, 0.08],
    ['Boots', 5, 22, 0.06],
    ['ASOS', 20, 60, 0.03],
  ],
  fun: [
    ['Vue Cinema', 9, 22, 0.05],
    ['Steam', 6, 30, 0.03],
  ],
};

/** Replaces the database contents with realistic demo data relative to `ref`. */
export async function seedDemoData(ref: ISODate = today()): Promise<void> {
  const rand = mulberry32(42);
  const current: Account = { id: 'current', name: 'Current account', type: 'current', openingBalance: 185000, includeInSafeToSpend: true };
  const savings: Account = { id: 'savings', name: 'Savings', type: 'savings', openingBalance: 320000, includeInSafeToSpend: false };
  const from = startOfMonth(shiftMonth(ref, -1));
  const yearAgo = shiftMonth(ref, -12);
  const dayOf = (d: number) => yearAgo.slice(0, 8) + String(d).padStart(2, '0');

  const recurring: Recurring[] = [
    { name: 'Rent', amount: 95000, day: 1, method: 'standing-order' as const },
    { name: 'PureGym', amount: 2499, day: 3, method: 'direct-debit' as const },
    { name: 'Spotify', amount: 1199, day: 13, method: 'direct-debit' as const },
    { name: 'Council Tax', amount: 14800, day: 15, method: 'direct-debit' as const },
    { name: 'Octopus Energy', amount: 8600, previousAmount: 7700, day: 18, method: 'direct-debit' as const },
    { name: 'Thames Water', amount: 3850, day: 20, method: 'direct-debit' as const },
    { name: 'Netflix', amount: 1099, day: 21, method: 'card' as const },
    { name: 'Vodafone', amount: 2200, day: 22, method: 'direct-debit' as const },
  ].map(({ day, ...r }) => ({
    ...r,
    id: newId(),
    frequency: 'monthly' as const,
    startDate: dayOf(day),
    accountId: current.id,
    categoryId: 'bills',
    active: true,
  }));

  const transactions: Transaction[] = [];
  const add = (t: Omit<Transaction, 'id' | 'accountId'> & { accountId?: string }) =>
    transactions.push({ accountId: current.id, ...t, id: newId() });

  // Bill payments already taken.
  for (const rule of recurring) {
    for (const date of occurrencesBetween(rule, from, ref)) {
      if (date < ref) add({ date, amount: -rule.amount, payee: rule.name, categoryId: 'bills', recurringId: rule.id });
    }
  }

  // Salary on the 25th, and £200 moved to savings the next day.
  for (const date of occurrencesBetween({ startDate: dayOf(25), frequency: 'monthly' }, from, ref)) {
    add({ date, time: '06:00', amount: 245000, payee: 'Salary', categoryId: 'salary' });
    const next = addDays(date, 1);
    if (next <= ref) {
      const transferId = newId();
      add({ date: next, time: '09:00', amount: -20000, payee: 'Transfer to Savings', categoryId: TRANSFER_CATEGORY_ID, transferId });
      add({
        accountId: savings.id,
        date: next,
        time: '09:00',
        amount: 20000,
        payee: 'Transfer from Current account',
        categoryId: TRANSFER_CATEGORY_ID,
        transferId,
      });
    }
  }

  // A subscription that is not set up as a bill yet, so "Add as bill?" has something to suggest.
  for (const date of occurrencesBetween({ startDate: dayOf(9), frequency: 'monthly' }, startOfMonth(shiftMonth(ref, -3)), ref)) {
    if (date < ref) add({ date, time: '04:12', amount: -799, payee: 'Disney Plus', categoryId: 'fun' });
  }

  // Everyday spending.
  const days = daysBetween(from, ref);
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    for (const [categoryId, merchants] of Object.entries(MERCHANTS)) {
      for (const [payee, min, max, chance] of merchants) {
        if (rand() > chance) continue;
        const pounds = min + rand() * (max - min);
        const hour = 7 + Math.floor(rand() * 14);
        const minute = Math.floor(rand() * 60);
        add({
          date,
          time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          amount: -Math.round(pounds * 100),
          payee,
          categoryId,
        });
      }
    }
  }
  add({ date: addDays(ref, -2), time: '10:12', amount: 4200, payee: 'ASOS', categoryId: 'refund', note: 'Returned jacket' });

  const tables = [db.accounts, db.categories, db.transactions, db.recurring, db.budgets, db.settings, db.goals];
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.filter((t) => t !== db.settings).map((t) => t.clear()));
    await db.accounts.bulkPut([current, savings]);
    await db.categories.bulkPut([...DEFAULT_CATEGORIES, TRANSFER_CATEGORY]);
    await db.budgets.bulkPut(BUDGETS);
    await db.recurring.bulkPut(recurring);
    await db.transactions.bulkPut(transactions);
    await db.goals.bulkPut([
      { id: 'goal-holiday', name: 'Summer holiday', target: 150000, saved: 62000, deadline: shiftMonth(ref, 8), createdAt: Date.now() },
      { id: 'goal-buffer', name: 'Emergency fund', target: 300000, saved: 258000, createdAt: Date.now() },
    ]);
    const existing = await db.settings.get('app');
    await db.settings.put({ ...DEFAULT_SETTINGS, ...existing, onboarded: true });
  });
}
