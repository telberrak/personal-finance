import { addDays, daysBetween, shiftMonth, startOfMonth, today, type ISODate } from '../lib/dates';
import { newId } from '../lib/id';
import { occurrencesBetween } from '../lib/recurring';
import { db } from './db';
import { DEFAULT_SETTINGS, type Account, type Budget, type Category, type Recurring, type Transaction } from './types';

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

const CATEGORIES: Category[] = [
  { id: 'groceries', name: 'Groceries', color: 'groceries', kind: 'expense', order: 1 },
  { id: 'eating', name: 'Eating out', color: 'eating', kind: 'expense', order: 2 },
  { id: 'transport', name: 'Transport', color: 'transport', kind: 'expense', order: 3 },
  { id: 'shopping', name: 'Shopping', color: 'shopping', kind: 'expense', order: 4 },
  { id: 'fun', name: 'Entertainment', color: 'fun', kind: 'expense', order: 5 },
  { id: 'bills', name: 'Bills', color: 'bills', kind: 'expense', order: 6 },
  { id: 'salary', name: 'Salary', color: 'income', kind: 'income', order: 7 },
  { id: 'refund', name: 'Refunds', color: 'income', kind: 'income', order: 8 },
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

/** Fills the database with demo data on first launch only (settings are written on first launch). */
export async function seedIfEmpty(): Promise<void> {
  if (await db.settings.get('app')) return;
  await seedDemoData();
}

export async function seedDemoData(ref: ISODate = today()): Promise<void> {
  const rand = mulberry32(42);
  const account: Account = { id: 'current', name: 'Current account', type: 'current', openingBalance: 185000 };
  const from = startOfMonth(shiftMonth(ref, -1));
  const yearAgo = shiftMonth(ref, -12);

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
    startDate: yearAgo.slice(0, 8) + String(day).padStart(2, '0'),
    accountId: account.id,
    categoryId: 'bills',
    active: true,
  }));

  const transactions: Transaction[] = [];
  const add = (t: Omit<Transaction, 'id' | 'accountId'>) => transactions.push({ ...t, id: newId(), accountId: account.id });

  // Bill payments already taken.
  for (const rule of recurring) {
    for (const date of occurrencesBetween(rule, from, ref)) {
      if (date < ref) add({ date, amount: -rule.amount, payee: rule.name, categoryId: 'bills', recurringId: rule.id });
    }
  }

  // Salary on the 25th of each month in range.
  for (const date of occurrencesBetween({ startDate: yearAgo.slice(0, 8) + '25', frequency: 'monthly' }, from, ref)) {
    add({ date, time: '06:00', amount: 245000, payee: 'Salary', categoryId: 'salary' });
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

  await db.transaction('rw', [db.accounts, db.categories, db.transactions, db.recurring, db.budgets, db.settings], async () => {
    await db.accounts.put(account);
    await db.categories.bulkPut(CATEGORIES);
    await db.budgets.bulkPut(BUDGETS);
    await db.recurring.bulkPut(recurring);
    await db.transactions.bulkPut(transactions);
    if (!(await db.settings.get('app'))) await db.settings.put(DEFAULT_SETTINGS);
  });
}

/** Removes all money data but keeps settings, the categories and an empty current account, so the app stays usable. */
export async function eraseAllData(): Promise<void> {
  await db.transaction('rw', [db.accounts, db.categories, db.transactions, db.recurring, db.budgets], async () => {
    await Promise.all([db.accounts.clear(), db.transactions.clear(), db.recurring.clear(), db.budgets.clear()]);
    await db.accounts.put({ id: 'current', name: 'Current account', type: 'current', openingBalance: 0 });
    await db.categories.bulkPut(CATEGORIES);
  });
}

/** Replaces everything with fresh demo data. */
export async function resetDemoData(): Promise<void> {
  await eraseAllData();
  await db.categories.clear();
  await db.accounts.clear();
  await seedDemoData();
}
