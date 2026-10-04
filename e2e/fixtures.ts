import { test as base, expect } from '@playwright/test';

/** Every test starts in a fresh browser at the Welcome screen; this picks the demo data first. */
export const test = base.extend<{ demo: void }>({
  demo: [
    async ({ page }, use) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Explore with demo data' }).click();
      await expect(page.getByRole('region', { name: 'Safe to spend' })).toBeVisible();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
