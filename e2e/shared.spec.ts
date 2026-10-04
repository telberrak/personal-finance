import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function signIn(page: Page, email: string) {
  await page.goto('/settings/sync');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  const { code } = (await (await page.request.get(`/api/dev/last-code?email=${encodeURIComponent(email)}`)).json()) as { code: string };
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'I have saved it' }).click();
}

test('split an expense with a friend, request and settle up', async ({ page }) => {
  await page.goto('/friends');
  await page.getByRole('button', { name: 'Add a friend' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Add a friend' });
  await sheet.getByLabel('Name').fill('Jamie');
  await sheet.getByLabel('Payment link').fill('https://monzo.me/jamie');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden(); // saved before leaving the page
  await expect(page.getByText('Jamie').first()).toBeVisible();

  await page.goto('/add');
  await page.getByLabel('Amount', { exact: true }).fill('30');
  await page.getByLabel('Payee').fill('Pizza night');
  await page.getByRole('button', { name: 'Jamie' }).click();
  await expect(page.getByText('1 friend owes you £15.00.')).toBeVisible();
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('Expense saved')).toBeVisible();

  await page.goto('/friends');
  await expect(page.getByText('Owes you £15.00')).toBeVisible();
  await page.getByRole('button', { name: /Jamie/ }).click();
  await expect(page.getByRole('link', { name: 'Request £15.00' })).toHaveAttribute('href', 'https://monzo.me/jamie/15.00');
  await page.getByRole('button', { name: 'Settle up' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Settle up' }).click();
  await expect(page.getByText('Settled up').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('All settled')).toBeVisible();
});

test('a household shares chosen accounts between two people', async ({ page, browser, baseURL }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop-light'), 'Two signed-in browsers: one project is enough');
  const run = Date.now();
  await signIn(page, `alex-${run}@example.test`);
  await page.goto('/settings/household');
  await page.getByRole('button', { name: 'Create a household' }).click();
  await page.getByLabel('Current account').click(); // saved first, then ticked
  await expect(page.getByLabel('Current account')).toBeChecked();
  await page.getByRole('button', { name: 'Invite someone' }).click();
  const link = (await page.locator('.recovery-key', { hasText: '/join#' }).textContent())!.trim();
  // A household budget, set from the household's tab on Budgets.
  await page.goto('/budgets');
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect(page.getByText(/count only spending on shared accounts/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Groceries').fill('420');
  await page.getByLabel('Groceries').press('Enter');
  await expect(page.getByText('Groceries: £420.00 a month')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(/of £420\.00/)).toBeVisible();
  await page.goto('/settings/sync');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/Up to date/)).toBeVisible({ timeout: 15_000 });

  // Sam: a new browser, starts with their own setup, then joins.
  const sam = await (await browser.newContext({ baseURL, serviceWorkers: 'block' })).newPage();
  await sam.goto('/');
  await sam.getByRole('button', { name: 'Set up my account' }).click();
  await sam.getByLabel('Current balance').fill('500');
  await sam.getByLabel('Name').fill('Sam’s bank');
  await sam.getByRole('button', { name: /^Start/ }).click();
  await signIn(sam, `sam-${run}@example.test`);
  await sam.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await sam.getByRole('button', { name: 'Join household' }).click();
  await expect(sam.getByText(/You joined/)).toBeVisible({ timeout: 15_000 });
  await expect(sam.getByText('Shared by someone else')).toBeVisible();
  await sam.goto('/activity');
  await expect(sam.getByText('Tesco').first()).toBeVisible({ timeout: 15_000 });
  await sam.goto('/budgets');
  await sam.getByRole('tab', { name: 'Home' }).click();
  await expect(sam.getByText(/of £420\.00/)).toBeVisible({ timeout: 15_000 });
  await sam.context().close();
});
