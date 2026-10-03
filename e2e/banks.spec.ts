import { expect, test } from './fixtures';

test('connect the sandbox bank and bring its transactions in', async ({ page }, testInfo) => {
  const email = `banks-${testInfo.project.name}-${Date.now()}@example.test`;
  await page.goto('/settings/banks');
  await expect(page.getByText(/Bank connections need sync/)).toBeVisible();

  await page.goto('/settings/sync');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  const { code } = (await (await page.request.get(`/api/dev/last-code?email=${encodeURIComponent(email)}`)).json()) as { code: string };
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'I have saved it' }).click();

  await page.goto('/settings/banks');
  await page.getByRole('button', { name: 'Connect a bank' }).click();
  await page.getByRole('dialog', { name: 'Choose your bank' }).getByRole('button', { name: 'Mizan Sandbox Bank' }).click();
  await expect(page.getByText(/Mizan Sandbox Bank is connected/)).toBeVisible();
  await page.getByLabel(/Sandbox current account/).selectOption({ label: 'Current account' });
  await page.getByRole('button', { name: 'Get new transactions' }).click();
  await expect(page.getByText(/\d+ new transactions added/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Your bank says/)).toBeVisible();
  await page.getByRole('button', { name: 'Match the bank' }).click();
  await expect(page.getByText(/Your bank says/)).toHaveCount(0);
});
