import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Each test gets a fresh browser context, so IndexedDB starts empty and demo data is seeded. */

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page should not scroll sideways on a phone').toBeLessThanOrEqual(0);
}

test('home shows safe to spend and the tab bar works', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Safe to spend')).toBeVisible();
  await expectNoHorizontalScroll(page);

  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const [tab, heading] of [
    ['Activity', 'Activity'],
    ['Bills', 'Bills'],
    ['Budgets', 'Budgets'],
  ] as const) {
    await nav.getByRole('link', { name: tab }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test('adding an expense shows it in Activity and can be undone', async ({ page }) => {
  await page.goto('/activity');
  await page.getByRole('link', { name: 'Add transaction' }).click();

  await page.getByLabel('Amount', { exact: true }).fill('7.25');
  await page.getByLabel('Payee').fill('Corner Café');
  await page.getByRole('radio', { name: 'Eating out' }).click();
  await page.getByRole('button', { name: 'Save expense' }).click();

  await expect(page.getByText('Expense saved')).toBeVisible();
  await expect(page).toHaveURL(/\/activity$/);
  // A list row on the phone, a table row on desktop.
  const row = page.locator('.list-row, tbody tr', { hasText: 'Corner Café' });
  await expect(row).toContainText('−£7.25');
  await expect(row).toContainText('Eating out');

  // Undo removes it again.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row).toHaveCount(0);
});

test('theme follows the system and can be overridden in Settings', async ({ page }, info) => {
  await page.goto('/settings');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const systemIsDark = info.project.name.endsWith('-dark');
  expect(await bg()).toBe(systemIsDark ? 'rgb(13, 15, 18)' : 'rgb(244, 245, 242)');

  await page.getByRole('radio', { name: systemIsDark ? 'Light' : 'Dark' }).click();
  await expect.poll(bg).toBe(systemIsDark ? 'rgb(244, 245, 242)' : 'rgb(13, 15, 18)');

  // The choice is saved on the device.
  await page.reload();
  await expect.poll(bg).toBe(systemIsDark ? 'rgb(244, 245, 242)' : 'rgb(13, 15, 18)');
});

test('erasing data asks first and leaves an empty, usable app', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Erase all data' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Erase all data?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Erase' }).click();
  await expect(page.getByText('All data erased')).toBeVisible();

  await page.goto('/activity');
  await expect(page.getByText('No transactions this month yet.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Nothing due in the next month.')).toBeVisible();
});
