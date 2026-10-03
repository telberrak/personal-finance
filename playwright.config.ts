import { defineConfig, devices } from '@playwright/test';

// Not 4173: that is the port `npm run serve` uses, and a stale build there must never be tested.
const PORT = 4174;
/** The sync API for e2e: in memory, with development helpers (the last emailed code). */
const API_PORT = 8788;
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
  webServer: [
    {
      command: `node server/main.ts --dev`,
      url: `http://localhost:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), LEDGER_DATA_DIR: 'memory', APP_ORIGINS: `http://localhost:${PORT}` },
      // Always fresh: it starts in a second, and a leftover one would run old server code.
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      env: { LEDGER_API: `http://localhost:${API_PORT}` },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
