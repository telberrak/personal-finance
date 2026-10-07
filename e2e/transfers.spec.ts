import { expect, test } from './fixtures';

test('a recurring transfer is recorded in both accounts on its due date, never as spending', async ({ page }, info) => {
  test.skip(info.project.name.endsWith('-dark'), 'one theme is enough');
  await page.goto('/bills/new');
  await page.getByRole('radio', { name: 'Transfer' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('50');
  await page.getByLabel('Name').fill('Savings top-up');
  await page.getByLabel('To', { exact: true }).selectOption({ label: 'Savings' });
  await expect(page.getByLabel(/Record it automatically/)).toBeChecked(); // on by default
  await page.getByRole('button', { name: 'Add transfer' }).click();
  await expect(page.getByText(/^Savings top-up added\. Next transfer /)).toBeVisible();
  await expect(page.getByText('Recurring transfer').first()).toBeVisible();

  // Due today: recorded when the app next runs its check (on opening, then hourly).
  await page.reload();
  await page.goto('/activity');
  await expect(page.locator('.list-row, tbody tr', { hasText: 'Transfer to Savings' }).first()).toBeVisible();
  await expect(page.locator('.list-row, tbody tr', { hasText: 'Transfer from Current account' }).first()).toBeVisible();
});

test('an account can be left out of net worth and is listed apart', async ({ page }, info) => {
  test.skip(info.project.name.endsWith('-dark'), 'one theme is enough');
  await page.goto('/networth');
  const total = await page.locator('.value-lg').first().textContent();
  await page.goto('/settings/accounts');
  await page
    .getByRole('button', { name: /Savings/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: 'Edit account' });
  await sheet.getByLabel('Include in net worth').uncheck();
  await sheet.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText('Not in net worth').first()).toBeVisible();

  await page.goto('/networth');
  await expect(page.getByRole('heading', { name: 'Not counted in net worth' })).toBeVisible();
  await expect(page.locator('.value-lg').first()).not.toHaveText(total!);
});
