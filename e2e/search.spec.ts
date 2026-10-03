import { expect, test } from './fixtures';

test('tags, advanced search, saved searches and bulk edit', async ({ page }) => {
  // Tag a new expense.
  await page.goto('/add');
  await page.getByLabel('Amount', { exact: true }).fill('42');
  await page.getByLabel('Payee').fill('Grand Hotel');
  await page.getByLabel('Tags').fill('Holiday 2027, Work');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('Expense saved')).toBeVisible();
  await page.goto('/activity');
  await expect(page.locator('.tag--user', { hasText: 'Holiday 2027' }).first()).toBeVisible();

  // Search from Activity.
  await page.getByRole('link', { name: 'Search and edit' }).click();
  await page.getByLabel('Tags').selectOption('Holiday 2027');
  await expect(page.getByText(/^1 transaction · /)).toBeVisible();

  // Save it, clear, and bring it back.
  await page.getByRole('button', { name: 'Save this search' }).click();
  await page.getByRole('dialog', { name: 'Save this search' }).getByLabel('Name').fill('Holiday');
  await page.getByRole('dialog', { name: 'Save this search' }).getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('group', { name: 'Saved searches' }).getByRole('button', { name: 'Holiday', exact: true }).click();
  await expect(page.getByText(/^1 transaction · /)).toBeVisible();

  // Bulk: select, move, then delete and undo.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('Select all shown').check();
  await page.getByLabel('Move to category').selectOption({ label: 'Shopping' });
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('1 transaction moved to Shopping')).toBeVisible();
  await page.getByLabel(/^Select Grand Hotel/).check();
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No transactions match.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/^1 transaction · /)).toBeVisible();
});
