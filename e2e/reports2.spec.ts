import { expect, test } from './fixtures';

test('the calendar shows each day and its details', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  const cells = page.getByRole('gridcell');
  expect((await cells.count()) % 7).toBe(0);
  await expect(page.getByRole('gridcell', { selected: true })).toHaveCount(1);
  // A future day with a bill shows it in the details.
  const billDay = page.getByRole('gridcell', { name: /bill/ }).last();
  await billDay.click();
  await expect(
    page
      .getByRole('region', { name: 'Day details' })
      .getByText(/Due|Paid/)
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page).toHaveURL(/month=/);
});

test('reports: custom range, comparison, trends, year in review and tax', async ({ page }) => {
  await page.goto('/reports');
  await page.getByRole('radio', { name: 'Custom' }).click();
  await expect(page.getByLabel('From')).toBeVisible();
  await page.getByLabel(/Compare with/).check();
  await expect(page.getByRole('columnheader', { name: 'Before' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Category trends' })).toBeVisible();

  await page.getByRole('link', { name: 'Year in review' }).click();
  await expect(page.getByRole('heading', { name: /in review/, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();

  // Mark an income for tax and find it in the tax helper.
  await page.goto('/add?kind=income');
  await page.getByLabel('Amount', { exact: true }).fill('250');
  await page.getByLabel('From', { exact: true }).fill('Freelance client');
  await page.getByLabel('Tax').selectOption({ label: 'Self-employment income' });
  await page.getByRole('button', { name: /^Save/ }).click();
  await page.goto('/tax');
  await expect(page.getByText('Freelance client')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^mizan-tax-\d{4}–\d{2}\.csv$/);
});
