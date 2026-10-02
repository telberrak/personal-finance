import { expect, test } from '@playwright/test';

/** The same app adapts to the screen: bottom tabs on a phone, a sidebar web layout on desktop. */

test('phone shows the bottom tab bar and lists', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('phone'), 'phone layout only');
  await page.goto('/activity');
  await expect(page.locator('nav.nav')).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.list-row').first()).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('desktop shows a sidebar, tables and a multi-column home', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'desktop layout only');
  await page.goto('/');
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).toBeVisible();
  await expect(page.locator('nav.nav')).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent transactions' })).toBeVisible();

  // Home is two columns: the bills column sits to the right of the safe-to-spend card.
  const hero = await page.getByLabel('Safe to spend').boundingBox();
  const bills = await page.getByRole('region', { name: 'Upcoming bills' }).boundingBox();
  expect(bills!.x).toBeGreaterThan(hero!.x + hero!.width);

  await sidebar.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByRole('columnheader', { name: 'Payee' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Amount' })).toBeVisible();

  await sidebar.getByRole('link', { name: 'Bills' }).click();
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByRole('columnheader', { name: 'Per year' })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('resizing switches between layouts without reloading', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-light', 'one run is enough');
  await page.goto('/bills');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('nav.nav')).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Bills' })).toBeVisible();
});
