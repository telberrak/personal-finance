import { expect, test } from './fixtures';

test('net worth shows assets, debts and a payoff plan', async ({ page }) => {
  await page.goto('/networth');
  await expect(page.getByRole('heading', { name: 'Net worth', level: 1 })).toBeVisible();
  await expect(page.getByText('Credit card', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/22\.9% APR/)).toBeVisible();
  await expect(page.getByText(/Debt-free by/)).toBeVisible();

  // The demo card has both the highest rate and the smallest balance, so both strategies agree.
  await page.getByRole('radio', { name: 'Snowball' }).click();
  await expect(page.getByText(/Both strategies give the same result/)).toBeVisible();
  await page.getByLabel('What if I paid extra').fill('100');
  await expect(page.getByText(/Paying £100\.00 more a month/)).toBeVisible();

  // Pension value update.
  await page.getByRole('button', { name: 'Update value' }).click();
  const sheet = page.getByRole('dialog', { name: 'Update value' });
  await sheet.getByLabel('Value').fill('25000');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Value saved')).toBeVisible();
  await expect(page.getByText('£25,000.00')).toBeVisible();
});

test('credit card accounts record APR, due day and minimum payment', async ({ page }) => {
  await page.goto('/settings/accounts');
  await page
    .getByRole('button', { name: /Credit card/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: 'Edit account' });
  await expect(sheet.getByLabel('Interest rate (APR %)')).toHaveValue('22.9');
  await expect(sheet.getByLabel('Payment due day')).toHaveValue('28');
  await expect(sheet.getByLabel('Minimum payment')).toHaveValue('55.00');
});
