import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

const SCREENS = [
  '/',
  '/activity',
  '/bills',
  '/bills/new',
  '/budgets',
  '/reports',
  '/goals',
  '/import',
  '/add',
  '/settings',
  '/settings/accounts',
  '/settings/categories',
  '/settings/rules',
  '/settings/sync',
  '/notifications',
];

for (const path of SCREENS) {
  test(`no accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.locator('main, form').first().waitFor();
    await page.waitForTimeout(300); // let charts and fonts settle
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1] ?? ''}`),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
}
