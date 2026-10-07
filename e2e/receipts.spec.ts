import { expect, test } from './fixtures';

/** A receipt drawn in the browser, as a PNG. */
async function receiptImage(page: import('@playwright/test').Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 420;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.font = '32px monospace';
    ['TESCO STORES', 'MILK          1.15', 'BREAD         1.40', 'TOTAL        12.50', '14/10/2025'].forEach((line, i) =>
      g.fillText(line, 30, 60 + i * 70),
    );
    return c.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test('attach a receipt photo to an expense', async ({ page }) => {
  await page.goto('/add');
  const image = await receiptImage(page);
  await page.getByLabel('Add photo or PDF').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('button', { name: /^Open receipt/ })).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('12.50');
  // A payee the demo data never uses, so the row found is this one.
  await page.getByLabel('Payee').fill('Receipt Test Shop');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('Expense saved')).toBeVisible();
  await page.goto('/activity');
  await page
    .getByRole('link', { name: /^Receipt Test Shop/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /^Open receipt/ })).toBeVisible();
});

test('read a receipt on the device to fill in the expense', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'Text recognition is slow; one browser is enough');
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/add');
  await page.getByLabel('Add photo or PDF').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: await receiptImage(page) });
  await page.getByRole('button', { name: 'Read receipt' }).click();
  await expect(page.getByText('Filled in from the receipt. Check the details.')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.50');
  await expect(page.getByLabel('Payee')).toHaveValue('Tesco');
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
});
