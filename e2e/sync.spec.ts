import type { Browser, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Signs in on the Sync page with the emailed code (read from the e2e API's development helper). */
async function signIn(page: Page, email: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByLabel('Code')).toBeVisible();
  const res = await page.request.get(`/api/dev/last-code?email=${encodeURIComponent(email)}`);
  const { code } = (await res.json()) as { code: string };
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function newDevice(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  return context.newPage();
}

test('two devices stay in sync, end-to-end encrypted', async ({ page, browser, baseURL }, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.test`;

  // Device A: demo data, turn on sync, note the recovery key.
  await page.goto('/settings/sync');
  await signIn(page, email);
  const keySheet = page.getByRole('dialog', { name: 'Save your recovery key' });
  const recoveryKey = (await keySheet.locator('.recovery-key').textContent())!.trim();
  expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  await keySheet.getByRole('button', { name: 'I have saved it' }).click();
  await expect(page.getByText(/Up to date/)).toBeVisible({ timeout: 15_000 });

  // Device B: a fresh browser joins from the Welcome screen.
  const b = await newDevice(browser, baseURL!);
  await b.goto('/');
  await b.getByRole('button', { name: /Sign in to sync/ }).click();
  await signIn(b, email);
  await b.getByLabel('Recovery key', { exact: true }).fill(recoveryKey.toLowerCase());
  await b.getByRole('button', { name: 'Start syncing' }).click();
  await b.getByRole('alertdialog').getByRole('button', { name: 'Replace' }).click();
  await expect(b.getByRole('region', { name: 'Safe to spend' })).toBeVisible({ timeout: 15_000 });

  // B adds an expense; A sees it after syncing.
  await b.goto('/add');
  await b.getByLabel('Amount', { exact: true }).fill('4.20');
  await b.getByLabel('Payee').fill('Sync test café');
  await b.getByRole('button', { name: 'Save expense' }).click();
  await expect(b.getByText('Expense saved')).toBeVisible();
  await b.goto('/settings/sync');
  await b.getByRole('button', { name: 'Sync now' }).click();
  await expect(b.getByText(/Up to date/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/Up to date/)).toBeVisible({ timeout: 15_000 });
  await page.goto('/activity');
  await expect(page.getByText('Sync test café')).toBeVisible();

  // A sees both devices.
  await page.goto('/settings/sync');
  await expect(page.getByText('This device', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(1);
  await b.context().close();
});
