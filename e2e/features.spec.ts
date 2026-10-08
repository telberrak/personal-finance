import { test as plain, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

const pad = (n: number) => String(n).padStart(2, '0');
const ukDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

// The flows are the same at every size and theme; run them once per layout.
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name.endsWith('-dark'), 'covered by the light run');
});

plain('first run: setting up your own account', async ({ page }, info) => {
  plain.skip(info.project.name.endsWith('-dark'), 'covered by the light run');
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up my account' }).click();
  await page.getByLabel('Current balance', { exact: true }).fill('1000');
  await page.getByLabel('Name').fill('Monzo');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('dialog', { name: 'Safe to spend' }).getByRole('button', { name: 'Skip' }).click(); // first-run tour
  await expect(page.getByRole('region', { name: 'Safe to spend' })).toContainText('£1,000');
  await expect(page.locator('.hero-amount')).toHaveClass(/hero-amount--pos/); // positive: shown in green
  await expect(page.getByText('Nothing due in the next month.')).toBeVisible();
});

test('importing an older statement opens Activity on its month', async ({ page }) => {
  const csv = ['Date,Description,Amount', '03/02/2025,OLD BOOKSHOP,-12.00', '10/03/2025,LATE BAKERY,-4.50'].join('\n');
  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Import 2 transactions' }).click();
  await expect(page).toHaveURL(/\/activity\?month=2025-03-01$/);
  await expect(page.locator('.list-row, tbody tr', { hasText: /late bakery/i })).toHaveCount(1);
});

test('importing a CSV skips duplicates, matches bills and can be undone', async ({ page }) => {
  const now = new Date();
  const lastMonth18 = new Date(now.getFullYear(), now.getMonth() - 1, 18);
  const csv = [
    'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency',
    `tx_1,${ukDate(lastMonth18)},06:00:00,Direct Debit,Octopus Energy,,Bills,-86.00,GBP`,
    `tx_2,${ukDate(now)},08:15:00,Card payment,CORNER COFFEE 4471,,Eating out,-3.20,GBP`,
  ].join('\n');

  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles({ name: 'monzo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('Recognised: Monzo')).toBeVisible();
  await expect(page.getByText('1 to import · 1 already in Mizan')).toBeVisible();
  await expect(page.getByText('Corner Coffee', { exact: true })).toBeVisible(); // cleaned-up payee

  await page.getByRole('button', { name: 'Import 1 transaction' }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByText('Imported 1 transaction')).toBeVisible();
  await expect(page.locator('.list-row, tbody tr', { hasText: 'Corner Coffee' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.list-row, tbody tr', { hasText: 'Corner Coffee' })).toHaveCount(0);
});

test('a suggested regular payment can be added as a bill', async ({ page }) => {
  await page.goto('/bills');
  const suggestions = page.getByRole('region', { name: 'Suggested bills' });
  await expect(suggestions).toContainText('Disney Plus');
  await suggestions.getByRole('link', { name: 'Add as bill' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Disney Plus');
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('7.99');
  await page.getByRole('button', { name: 'Add bill' }).click();
  await expect(page.getByText(/^Disney Plus added\. Next payment /)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Suggested bills' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByRole('link', { name: 'Disney Plus' })).toBeVisible();
});

/** A local date `days` from today, as the date inputs expect it. */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function addBill(page: Page, name: string, amount: string, due: string) {
  await page.goto('/bills/new');
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Next due').fill(due);
  await page.getByRole('button', { name: 'Add bill' }).click();
  await expect(page.getByText(new RegExp(`^${name} added\\. Next payment `))).toBeVisible();
}

test('a new bill shows as coming up, even when it is due next month, and in Activity', async ({ page }) => {
  // Due in 25 days: often next month, which the Upcoming list used to leave out.
  await addBill(page, 'Gym membership', '30', inDays(25));
  await expect(page.getByRole('link', { name: 'Gym membership' }).first()).toBeVisible();

  // Due in 3 days: listed above the transactions in Activity, without changing its totals.
  await addBill(page, 'Window cleaner', '15', inDays(3));
  await page.goto('/activity');
  const comingUp = page.getByRole('region', { name: 'Coming up' });
  await expect(comingUp.getByRole('link', { name: /Window cleaner/ })).toBeVisible();
  await expect(comingUp.getByRole('link', { name: /Gym membership/ })).toHaveCount(0); // more than a week away
});

test('reports, goals and backup', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Where the money went' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Forecast balance/ })).toBeVisible();

  await page.goto('/goals');
  await page.getByRole('button', { name: 'New goal' }).click();
  const sheet = page.getByRole('dialog', { name: 'New goal' });
  await sheet.getByLabel('Name').fill('New laptop');
  await sheet.getByLabel('Target').fill('1200');
  await sheet.getByRole('button', { name: 'Save' }).click();
  const card = page.locator('article', { hasText: 'New laptop' });
  await card.getByRole('button', { name: 'Add money' }).click();
  await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('100');
  await page.getByRole('dialog').getByRole('button', { name: /^Add/ }).click();
  await expect(card).toContainText('£100.00');

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const backup = page.getByRole('dialog', { name: 'Download backup' });
  const [download] = await Promise.all([page.waitForEvent('download'), backup.getByRole('button', { name: 'Download backup' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^mizan-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText('Last backup: today.')).toBeVisible();
});

test('app lock asks for the PIN after reopening', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Set PIN' }).click();
  const sheet = page.getByRole('dialog', { name: 'Set a PIN' });
  await sheet.getByLabel('New PIN').fill('2468');
  await sheet.getByLabel('Repeat').fill('2468');
  await sheet.getByRole('button', { name: 'Save PIN' }).click();
  await expect(page.getByText('App lock is on')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mizan is locked' })).toBeVisible();
  await page.getByLabel('PIN').fill('1111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('not right');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
