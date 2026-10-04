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
  // Feedback is limited to 5 messages an hour per address; every run (and retry) gets its own.
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1` });
  await page.goto('/settings/about');
  await expect(page.getByText(/^Version \d+\.\d+\.\d+$/)).toBeVisible();
  await expect(page.getByText('Sync service: working.')).toBeVisible();
  // What's new: the latest changelog entries, headed by their version.
  await expect(page.getByRole('heading', { name: /^\d+\.\d+\.\d+ — / }).first()).toBeVisible();
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
  await expect(page.getByRole('region', { name: 'Safe to spend' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Safe to spend' })).toHaveCount(0);
  await page.context().close();
});
