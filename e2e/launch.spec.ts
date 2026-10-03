import { expect, test } from './fixtures';

test('help, privacy policy and terms read in the chosen language', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible();
  await expect(page.getByText(/end-to-end encrypted/).first()).toBeVisible();
  await page.goto('/terms?locale=fr');
  await expect(page.getByRole('heading', { name: 'Conditions d’utilisation', level: 1 })).toBeVisible();
  await page.goto('/privacy?locale=ar');
  await expect(page.getByRole('heading', { name: 'سياسة الخصوصية', level: 1 })).toBeVisible();
});

test('about: version, service status, what’s new, feedback and usage counts', async ({ page }) => {
  await page.goto('/settings/about');
  await expect(page.getByText(/^Version \d+\.\d+\.\d+$/)).toBeVisible();
  await expect(page.getByText('Sync service: working.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /P13|P12/ }).first()).toBeVisible();
  await page.getByLabel('Message').fill('The calendar is great.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Thank you, your message was sent.')).toBeVisible();
  const toggle = page.getByLabel(/Share anonymous usage counts/);
  await toggle.click();
  await expect(toggle).toBeChecked();
});

test('a first-run tour follows setting up your own account', async ({ browser, baseURL }) => {
  const page = await (await browser.newContext({ baseURL, serviceWorkers: 'block' })).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up my account' }).click();
  await page.getByLabel('Current balance').fill('800');
  await page.getByRole('button', { name: /^Start/ }).click();
  const tour = page.getByRole('dialog', { name: 'Safe to spend' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Add as you go' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Safe to spend')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Safe to spend' })).toHaveCount(0);
  await page.context().close();
});
