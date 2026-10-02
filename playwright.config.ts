import { defineConfig, devices } from '@playwright/test';

// Not 4173: that is the port `npm run serve` uses, and a stale build there must never be tested.
const PORT = 4174;
const isCI = !!process.env.CI;

/** Locally the tests reuse the installed Edge, so no browser download is needed. */
const channel = isCI ? {} : { channel: 'msedge' };

const phone = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, ...channel };
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...channel };

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // The service worker would cache between runs; tests always want the fresh build.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'phone-light', use: { ...phone, colorScheme: 'light' } },
    { name: 'phone-dark', use: { ...phone, colorScheme: 'dark' } },
    { name: 'desktop-light', use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...desktop, colorScheme: 'dark' } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
