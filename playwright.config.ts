import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const isCI = !!process.env.CI;

/** Phone-sized Chromium. Locally it reuses the installed Edge so no browser download is needed. */
const phone = {
  ...devices['Pixel 7'],
  viewport: { width: 390, height: 844 },
  ...(isCI ? {} : { channel: 'msedge' }),
};

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
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
