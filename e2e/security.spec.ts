import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function setPin(page: Page, pin = '2468') {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Set PIN' }).click();
  const sheet = page.getByRole('dialog', { name: 'Set a PIN' });
  await sheet.getByLabel('New PIN').fill(pin);
  await sheet.getByLabel('Repeat').fill(pin);
  await sheet.getByRole('button', { name: 'Save PIN' }).click();
  await expect(page.getByText('App lock is on')).toBeVisible();
}

/** Every record as stored in IndexedDB, read without the app (and so without the key). */
const rawStore = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('ledger');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction([...db.objectStoreNames]);
          const out: unknown[] = [];
          for (const name of db.objectStoreNames) {
            const req = tx.objectStore(name).getAll();
            req.onsuccess = () => out.push(req.result);
          }
          tx.oncomplete = () => {
            db.close();
            resolve(JSON.stringify(out));
          };
        };
      }),
  );

test('the app runs under a strict content security policy', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const response = await page.goto('/');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['x-frame-options']).toBe('DENY');
  await expect(page.getByRole('region', { name: 'Safe to spend' })).toBeVisible();
  for (const path of ['/activity', '/bills', '/reports', '/settings']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
  }
  expect(await page.evaluate(() => document.fonts.check('16px "Geist Variable"'))).toBe(true);
  expect(violations).toEqual([]);
});

test('setting a PIN encrypts the data on the device', async ({ page }) => {
  expect(await rawStore(page)).toContain('Tesco');
  await setPin(page);
  const stored = await rawStore(page);
  expect(stored).not.toContain('Tesco');
  expect(stored).not.toContain('Current account');

  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByRole('heading', { name: 'Mizan is locked' })).toBeVisible();
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.getByRole('button', { name: 'Turn off app lock' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByText('App lock turned off')).toBeVisible();
  expect(await rawStore(page)).toContain('Tesco');
});

test('locks after the chosen time without activity', async ({ page }) => {
  await page.clock.install();
  await setPin(page);
  await page.getByLabel('Lock after').selectOption('1');
  await expect(page.getByLabel('Lock after')).toHaveValue('1'); // saved before the clock moves on
  await page.clock.runFor(70_000);
  await expect(page.getByRole('heading', { name: 'Mizan is locked' })).toBeVisible();
});

test('hide amounts masks every amount', async ({ page }) => {
  await page.goto('/settings');
  // Saved to the database first, so the box ticks a moment after the click.
  await page.getByLabel(/Hide amounts/).click();
  await expect(page.getByLabel(/Hide amounts/)).toBeChecked();
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Safe to spend' });
  await expect(hero).toContainText('£•••');
  expect(await hero.textContent()).not.toMatch(/£\d/);
  await expect(page.getByText(/a day until payday/)).not.toContainText(/£\d/);
});

test('encrypted backups need their password to restore', async ({ page }, testInfo) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const sheet = page.getByRole('dialog', { name: 'Download backup' });
  await sheet.getByLabel('Password').fill('correct horse');
  await sheet.getByLabel('Repeat').fill('correct horse');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Download encrypted backup' }).click(),
  ]);
  const file = testInfo.outputPath('backup.json');
  await download.saveAs(file);
  const text = await readFile(file, 'utf-8');
  expect(text).toContain('ledger-backup-encrypted');
  expect(text).not.toContain('Tesco');

  await page.getByLabel('Backup file').setInputFiles(file);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();
  const open = page.getByRole('dialog', { name: 'Encrypted backup' });
  await open.getByLabel('Password').fill('wrong password');
  await open.getByRole('button', { name: 'Restore' }).click();
  await expect(open.getByRole('alert')).toContainText('not right');
  await open.getByLabel('Password').fill('correct horse');
  await open.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/Backup restored: \d+ transactions/)).toBeVisible();
});

test('a passkey can unlock the app', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });
  await setPin(page);
  await page.getByRole('button', { name: /Unlock with fingerprint/ }).click();
  await expect(page.getByText('Passkey added')).toBeVisible();

  await page.getByRole('button', { name: 'Lock now' }).click();
  await page.getByRole('button', { name: 'Unlock with a passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

// Regression: filtered updates (bulk edit, rename payee, apply rule) go through a wrapped cursor
// when data is encrypted; real browsers reject native cursor getters on a wrong `this`.
test('bulk edits work with encryption on', async ({ page }) => {
  await setPin(page);
  await page.goto('/search'); // a reload: the app starts locked
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByLabel('Text').fill('tesco');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('Select all shown').check();
  await page.getByLabel('Move to category').selectOption({ label: 'Shopping' });
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(/^[1-9]\d* transactions? moved to Shopping/)).toBeVisible();
});
