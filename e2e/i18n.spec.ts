import { expect, test } from './fixtures';

/**
 * Pseudo-locales catch text that bypasses translation (it shows up without the ⟦…⟧ marks) and
 * layouts that break with longer text or right-to-left direction.
 */
const SCREENS = [
  '/',
  '/activity',
  '/bills',
  '/budgets',
  '/reports',
  '/goals',
  '/import',
  '/add',
  '/bills/new',
  '/settings',
  '/settings/accounts',
];

// Elements whose text is the user's data (payees, category and account names) or formatted values.
const DATA = [
  '.item-title',
  '.item-meta',
  '.row-link',
  '.chip--cat',
  'option',
  'select',
  'input',
  'textarea',
  '.tile',
  '.num',
  '.amount',
  '.hero-amount',
  '.value-lg',
  '.value-md',
  '.month-label',
  'figure',
  '.legend',
  '.rank',
  '.brand',
  '[translate="no"]',
].join(', ');

for (const path of SCREENS) {
  test(`every visible text on ${path} is translated`, async ({ page }, info) => {
    test.skip(info.project.name.endsWith('-dark'), 'one theme is enough');
    await page.goto(path + '?locale=en-XA');
    await page.locator('main').first().waitFor();
    await page.waitForTimeout(300);
    const untranslated = await page.evaluate((dataSelector) => {
      const months = new Set<string>();
      for (let m = 0; m < 12; m++) {
        const d = new Date(2026, m, 1);
        for (const month of ['long', 'short'] as const) months.add(d.toLocaleString('en-GB', { month }));
      }
      for (let i = 0; i < 7; i++) {
        const d = new Date(2026, 9, 4 + i);
        for (const weekday of ['long', 'short'] as const) months.add(d.toLocaleString('en-GB', { weekday }));
      }
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest(dataSelector) || el.closest('[hidden], script, style')) continue;
        if (!el.checkVisibility?.()) continue;
        const text = (n.textContent ?? '').trim();
        if (!/[A-Za-z]{3}/.test(text) || text.includes('⟦') || text.includes('⟧')) continue;
        // Dates are formatted, not translated.
        const words = text.split(/[\s,·]+/).filter((w) => /[A-Za-z]{3}/.test(w));
        if (words.every((w) => months.has(w))) continue;
        // Inside a translated string that was split around an element.
        if (el.closest('*')?.textContent?.includes('⟦') && el.textContent?.trim() !== text) continue;
        out.push(`${el.tagName.toLowerCase()}.${el.className}: "${text}"`);
      }
      return out;
    }, DATA);
    expect(untranslated).toEqual([]);
  });
}

test('right-to-left layout mirrors without breaking', async ({ page }, info) => {
  test.skip(info.project.name.endsWith('-dark'), 'one theme is enough');
  const desktop = info.project.name.startsWith('desktop');
  for (const path of SCREENS) {
    await page.goto(path + '?locale=ar-XB');
    await page.locator('main').first().waitFor();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways in RTL`).toBeLessThanOrEqual(0);
  }
  if (desktop) {
    await page.goto('/?locale=ar-XB');
    const sidebar = await page.locator('.sidebar').boundingBox();
    const main = await page.locator('main').boundingBox();
    expect(sidebar!.x, 'sidebar sits on the right in RTL').toBeGreaterThan(main!.x);
  }
});

test('language and currency settings change how amounts look', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Currency').selectOption('EUR');
  // Saved to the database first; wait for it before reloading.
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
  await page.goto('/');
  await expect(page.getByLabel('Safe to spend')).toContainText('€');
  await expect(page.getByLabel('Safe to spend')).not.toContainText('£');
});
