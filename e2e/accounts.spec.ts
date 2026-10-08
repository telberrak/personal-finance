import { expect, test } from './fixtures';

test('Accounts sits just below Home, lists every account with its value, and opens Edit account', async ({ page }, info) => {
  test.skip(info.project.name.endsWith('-dark'), 'one theme is enough');
  // Computer: the sidebar, right after Home. Phone: the first shortcut on Home.
  const desktop = info.project.name.startsWith('desktop');
  const nav = desktop ? page.locator('.side-nav') : page.getByRole('navigation', { name: 'More' });
  const links = (await nav.getByRole('link').allTextContents()).map((s) => s.trim());
  expect(links.indexOf('Accounts')).toBe(desktop ? links.indexOf('Home') + 1 : 0);
  await nav.getByRole('link', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible();
  await expect(page.getByText(/^Net worth /)).toBeVisible();

  // Grouped, each account with its value.
  for (const group of ['Everyday', 'Savings and investments', 'Debts'])
    await expect(page.getByRole('heading', { name: group })).toBeVisible();
  const current = page.getByRole('button', { name: /Current account/ }).first();
  await expect(current).toContainText('£');

  // A tap opens Edit account for that account.
  await current.click();
  const sheet = page.getByRole('dialog', { name: 'Edit account' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Name')).toHaveValue('Current account');

  // The old address still works.
  await page.goto('/settings/accounts');
  await expect(page).toHaveURL(/\/accounts$/);
});
