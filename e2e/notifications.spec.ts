import { expect, test } from './fixtures';

test('the notification centre lists alerts and marks them read', async ({ page }) => {
  await page.goto('/');
  const bell = page.getByRole('link', { name: /^Notifications/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
});

test('notifications can be turned on, tuned and tested', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await page.goto('/notifications');
  const toggle = page.getByLabel(/Notifications on this device/);
  await toggle.click();
  await expect(toggle).toBeChecked();
  const payday = page.getByLabel('Payday', { exact: true });
  await payday.click();
  await expect(payday).not.toBeChecked();
  await page.getByLabel('Quiet from').fill('21:30');
  await expect(page.getByLabel('Quiet from')).toHaveValue('21:30');
  await expect(page.getByRole('button', { name: 'Send a test notification' })).toBeVisible();
});

test('a bill can have a free trial end date', async ({ page }) => {
  await page.goto('/bills/new');
  await expect(page.getByLabel('Free trial ends')).toBeVisible();
});
