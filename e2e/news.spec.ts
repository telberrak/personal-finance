import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The last email the test API "sent" to an address (dev mode keeps it). */
async function lastEmail(page: Page, email: string): Promise<{ subject: string; text: string; headers?: Record<string, string> }> {
  return (await page.request.get(`/api/dev/last-email?email=${encodeURIComponent(email)}`)).json();
}
/** A link from an email, as a path on the app's own origin. */
const pathOf = (text: string, path: string) => text.match(new RegExp(`https?://[^/\\s]+(${path}\\?token=[\\w-]+)`))![1];

const lightOnly = (project: string) => test.skip(project.endsWith('-dark'), 'one theme is enough');

test('news by email: subscribe from Settings, confirm by email, unsubscribe with one click', async ({ page }, info) => {
  lightOnly(info.project.name);
  const email = `news-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto('/settings');
  const news = page.locator('#news');
  await expect(news.getByText(/a few times a year/).first()).toBeVisible(); // the consent wording, shown before subscribing
  await news.getByLabel('Email').fill(email);
  await news.getByRole('button', { name: 'Subscribe' }).click();
  await expect(news.getByText('Check your inbox: we sent a link to confirm your address.')).toBeVisible();

  // Nothing is confirmed until the emailed link is opened.
  const confirmation = await lastEmail(page, email);
  expect(confirmation.subject).toBe('Confirm your Mizan updates');
  await page.goto(pathOf(confirmation.text, '/api/subscribe/confirm'));
  await expect(page.getByText('Thank you, your address is confirmed.')).toBeVisible();

  // The welcome email carries the unsubscribe link and headers; the link asks before unsubscribing.
  const welcome = await lastEmail(page, email);
  expect(welcome.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  await page.goto(pathOf(welcome.text, '/api/unsubscribe'));
  await expect(page.getByText('Stop getting news from Mizan by email?')).toBeVisible();
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByText('You are unsubscribed.')).toBeVisible();
});

test('news by email: the opt-in when turning on sync, then a switch in Settings', async ({ page }, info) => {
  lightOnly(info.project.name);
  const email = `optin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto('/settings/sync');
  await page.getByLabel('Email', { exact: true }).fill(email);
  const optIn = page.getByRole('checkbox', { name: /Email me news about Mizan/ });
  await expect(optIn).not.toBeChecked(); // never ticked for you
  await optIn.check();
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  const { code } = (await (await page.request.get(`/api/dev/last-code?email=${encodeURIComponent(email)}`)).json()) as { code: string };
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'I have saved it' }).click();

  await page.goto('/settings');
  const toggle = page.locator('#news').getByRole('checkbox');
  await expect(toggle).toBeChecked();
  await toggle.click(); // saved on the server first, so the box clears a moment later
  await expect(page.getByText('No more news emails.')).toBeVisible();
  await expect(toggle).not.toBeChecked();
});

test('the news page reads in the visitor’s language', async ({ page }, info) => {
  lightOnly(info.project.name);
  await page.goto('/updates?status=check-email&locale=fr');
  await expect(page.getByText('Presque terminé', { exact: false })).toBeVisible();
  await page.goto('/updates?status=confirmed&locale=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
