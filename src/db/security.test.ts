import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/utils';
import { hashPin } from '../lib/pin';
import { LockedError, securityMode, seal, unseal, utf8, randomBytes } from './crypto';
import { db } from './db';
import { addTransaction, createBackup, renamePayee, restoreBackup, updateSettings, updateTransaction } from './repo';
import {
  changePin,
  decryptBackup,
  disableEncryption,
  enableEncryption,
  encryptBackup,
  initSecurity,
  isEncryptedBackup,
  lockNow,
  unlockWithPin,
} from './security';
import { seedDemoData } from './seed';

/** Rows exactly as stored in IndexedDB, bypassing Dexie and the encryption middleware. */
function raw(store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('ledger');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = open.result.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => {
        open.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    };
  });
}

beforeEach(async () => {
  await resetDb();
  await seedDemoData('2026-10-14');
});

describe('encryption at rest', () => {
  it('stores no readable payees, notes or amounts once a PIN is set', async () => {
    const before = JSON.stringify(await raw('transactions'));
    expect(before).toContain('Tesco');

    await enableEncryption('2468');
    expect(securityMode()).toBe('unlocked');
    const stored = JSON.stringify([
      ...(await raw('transactions')),
      ...(await raw('accounts')),
      ...(await raw('recurring')),
      ...(await raw('goals')),
    ]);
    expect(stored).not.toMatch(/Tesco|Netflix|Current account|payee|amount|openingBalance/);
    const [settings] = (await raw('settings')) as Record<string, unknown>[];
    expect(settings).toMatchObject({ id: 'app', onboarded: true, theme: 'system' });
    expect(settings.payday).toBeUndefined();

    // The app still sees plain data.
    expect((await db.transactions.toArray()).some((t) => t.payee.includes('Tesco'))).toBe(true);
    expect((await db.settings.get('app'))?.payday).toEqual(expect.any(Number));
  });

  it('keeps queries, updates and modify() working on encrypted data', async () => {
    await enableEncryption('2468');
    const id = await addTransaction({
      accountId: 'current',
      date: '2026-10-13',
      amount: -999,
      payee: 'Corner Shop',
      categoryId: 'groceries',
    });
    await updateTransaction(id, { note: 'milk' });
    expect(await db.transactions.get(id)).toMatchObject({ payee: 'Corner Shop', note: 'milk', amount: -999 });
    expect(await db.transactions.where('date').equals('2026-10-13').count()).toBeGreaterThan(0);
    expect(await renamePayee('Corner Shop', 'Corner')).toBe(1);
    expect((await db.transactions.get(id))?.payee).toBe('Corner');
    expect(JSON.stringify(await raw('transactions'))).not.toContain('Corner');
    await db.transactions.update(id, { amount: -1000 });
    expect((await db.transactions.get(id))?.amount).toBe(-1000);
  });

  it('locks: nothing can be read or written without the PIN', async () => {
    await enableEncryption('2468');
    lockNow();
    expect(securityMode()).toBe('locked');
    await expect(db.transactions.toArray()).rejects.toBeInstanceOf(LockedError);
    await expect(db.accounts.put({ id: 'x', name: 'X', type: 'cash', openingBalance: 0, includeInSafeToSpend: true })).rejects.toThrow();
    // The lock screen can still read its own settings.
    expect(await db.settings.get('app')).toMatchObject({ theme: 'system', language: 'en' });

    expect(await unlockWithPin('1111')).toBe(false);
    expect(securityMode()).toBe('locked');
    expect(await unlockWithPin('2468')).toBe(true);
    expect((await db.transactions.toArray()).length).toBeGreaterThan(10);
  });

  it('starts locked after a restart when encrypted', async () => {
    await enableEncryption('2468');
    db.close();
    await initSecurity();
    expect(securityMode()).toBe('locked');
  });

  it('changes the PIN without re-encrypting', async () => {
    await enableEncryption('2468');
    const before = JSON.stringify(await raw('transactions'));
    await changePin('13579');
    expect(JSON.stringify(await raw('transactions'))).toBe(before);
    lockNow();
    expect(await unlockWithPin('2468')).toBe(false);
    expect(await unlockWithPin('13579')).toBe(true);
  });

  it('turning the lock off decrypts everything', async () => {
    await enableEncryption('2468');
    await disableEncryption();
    expect(securityMode()).toBe('off');
    expect(JSON.stringify(await raw('transactions'))).toContain('Tesco');
    expect(JSON.stringify(await raw('transactions'))).not.toContain('"_e"');
    expect(await db.keyring.count()).toBe(0);
  });

  it('upgrades a PIN set before encryption existed', async () => {
    const { hash, salt } = await hashPin('2468');
    await updateSettings({ pinHash: hash, pinSalt: salt });
    db.close();
    await initSecurity();
    expect(securityMode()).toBe('locked');
    expect(await unlockWithPin('0000')).toBe(false);
    expect(await unlockWithPin('2468')).toBe(true);
    expect(await db.keyring.get('pin')).toBeDefined();
    expect(JSON.stringify(await raw('transactions'))).not.toContain('Tesco');
    expect(JSON.stringify(await raw('settings'))).not.toContain(hash);
  });

  it('binds ciphertext to its table, so records cannot be swapped between tables', () => {
    const key = randomBytes(32);
    const sealed = seal(utf8('{}'), key, utf8('accounts'));
    expect(() => unseal(sealed, key, utf8('transactions'))).toThrow();
    expect(() => unseal(sealed, randomBytes(32), utf8('accounts'))).toThrow();
  });

  it('backs up and restores while encrypted, keeping the lock', async () => {
    await enableEncryption('2468');
    const backup = await createBackup();
    expect(JSON.stringify(backup)).toContain('Tesco');
    await restoreBackup(JSON.stringify(backup));
    expect(await db.keyring.get('pin')).toBeDefined();
    expect(JSON.stringify(await raw('transactions'))).not.toContain('Tesco');
  });
});

describe('encrypted backups', () => {
  it('round-trips with the password and rejects a wrong one', async () => {
    const json = JSON.stringify(await createBackup());
    const file = await encryptBackup(json, 'correct horse');
    expect(isEncryptedBackup(file)).toBe(true);
    expect(isEncryptedBackup(json)).toBe(false);
    expect(file).not.toContain('Tesco');
    expect(await decryptBackup(file, 'correct horse')).toBe(json);
    await expect(decryptBackup(file, 'wrong horse')).rejects.toThrow('not right');
    await expect(encryptBackup(json, 'short')).rejects.toThrow('at least 8');
  });
});
