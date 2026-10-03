// @vitest-environment node
// The real sync server runs in-process (PGlite in memory); fetch('/api/…') is routed to it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.ts';
import { openPglite, type Sql } from '../../server/db.ts';
import { db } from '../db/db';
import { addTransaction, deleteTransaction, updateSettings } from '../db/repo';
import { seedDemoData } from '../db/seed';
import { resetDb } from '../test/utils';
import { deleteAccount, joinWithRecoveryKey, requestCode, signOut, verifyCode } from './account';
import { resetSyncEngine, syncNow } from './engine';
import { enableEncryption } from '../db/security';
import { api } from './client';
import { newRecoveryKey, parseRecoveryKey, syncKeys, WrongRecoveryKey } from './keys';

let sql: Sql;
const codes = new Map<string, string>();

beforeAll(async () => {
  sql = await openPglite();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await sql.close();
});
beforeEach(async () => {
  await sql.query('TRUNCATE users, email_codes, challenges CASCADE');
  // A fresh app per test, so sign-in rate limits start again.
  const app = createApp({
    sql,
    mailer: { sendCode: async (email, code) => void codes.set(email, code) },
    config: { rpID: 'localhost', rpName: 'Ledger', origins: ['http://localhost'] },
  });
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => app.request(input, init));
  await resetDb();
  resetSyncEngine();
});

async function signIn(email = 'sam@example.com') {
  await requestCode(email);
  return verifyCode(email, codes.get(email)!);
}

/** Starts this test's "other device": a fresh database signed in to the same account. */
async function secondDevice(recoveryKey: string) {
  await resetDb();
  resetSyncEngine();
  expect(await signIn()).toEqual({ kind: 'needsKey' });
  await joinWithRecoveryKey(recoveryKey);
}

describe('recovery keys', () => {
  it('round-trips and tolerates spacing, case and misread letters', () => {
    const key = newRecoveryKey();
    expect(key).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(parseRecoveryKey(key.toLowerCase().replace(/-/g, ' '))).toEqual(parseRecoveryKey(key));
    expect(parseRecoveryKey('too short')).toBeNull();
  });
});

describe('sync', () => {
  it('uploads only ciphertext and restores everything on another device', async () => {
    await seedDemoData('2026-10-14');
    const count = await db.transactions.count();
    const first = await signIn();
    expect(first.kind).toBe('created');
    await syncNow();
    expect(await db.outbox.count()).toBe(0);

    const stored = JSON.stringify(await sql.query('SELECT rkey, blob FROM records'));
    expect(stored).not.toMatch(/Tesco|transactions|accounts|current|groceries|2026-10/);

    await secondDevice(first.kind === 'created' ? first.recoveryKey : '');
    expect(await db.transactions.count()).toBe(count);
    expect((await db.settings.get('app'))?.onboarded).toBe(true);
  });

  it('a wrong recovery key changes nothing', async () => {
    await seedDemoData('2026-10-14');
    await signIn();
    await syncNow();
    await resetDb();
    await addTransaction({ accountId: 'x', date: '2026-10-01', amount: -100, payee: 'Kept', categoryId: 'other' });
    await signIn();
    await expect(joinWithRecoveryKey(newRecoveryKey())).rejects.toBeInstanceOf(WrongRecoveryKey);
    expect((await db.transactions.toArray()).map((t) => t.payee)).toEqual(['Kept']);
  });

  it('sends edits and deletions both ways; unpushed local changes win', async () => {
    await seedDemoData('2026-10-14');
    const first = await signIn();
    const recoveryKey = first.kind === 'created' ? first.recoveryKey : '';
    await syncNow();

    // Device B adds a coffee and deletes the first transaction.
    await secondDevice(recoveryKey);
    const coffee = await addTransaction({ accountId: 'current', date: '2026-10-14', amount: -320, payee: 'Coffee', categoryId: 'eating' });
    const victim = (await db.transactions.orderBy('date').first())!;
    await deleteTransaction(victim.id);
    await updateSettings({ payday: 3, theme: 'dark' });
    await syncNow();

    // Device A (fresh again) gets both changes, but not B's theme, which is per device.
    await resetDb();
    resetSyncEngine();
    await signIn();
    await updateSettings({ theme: 'light' });
    await joinWithRecoveryKey(recoveryKey);
    expect(await db.transactions.get(coffee)).toMatchObject({ payee: 'Coffee' });
    expect(await db.transactions.get(victim.id)).toBeUndefined();
    expect(await db.settings.get('app')).toMatchObject({ payday: 3, theme: 'light' });

    // An edit made here before pulling is kept, and then pushed.
    await db.transactions.update(coffee, { payee: 'Flat white' });
    await syncNow();
    expect((await db.transactions.get(coffee))?.payee).toBe('Flat white');
    expect(await db.outbox.count()).toBe(0);
  });

  it('signing out keeps local data; deleting the account removes it from the server', async () => {
    await seedDemoData('2026-10-14');
    await signIn();
    await syncNow();
    await signOut();
    expect(await db.syncState.count()).toBe(0);
    expect(await db.transactions.count()).toBeGreaterThan(0);

    await signIn();
    await deleteAccount();
    expect(await sql.query('SELECT 1 FROM records')).toHaveLength(0);
    expect(await sql.query('SELECT 1 FROM users')).toHaveLength(0);
  });

  it('a change waiting to be pushed is not overwritten by another device’s older edit', async () => {
    await seedDemoData('2026-10-14');
    await signIn();
    await syncNow();
    const tx = (await db.transactions.toCollection().first())!;
    // Another device pushes its version of the same transaction…
    const state = (await db.syncState.get('sync'))!;
    const keys = await syncKeys(state.syncKey!);
    const theirs = { ...tx, payee: 'Theirs' };
    await api('/sync/push', {
      body: { changes: [{ rkey: await keys.rkey('transactions', tx.id), blob: keys.seal({ t: 'transactions', k: tx.id, v: theirs }) }] },
      token: state.token,
    });
    // …while this device edits it offline.
    await db.transactions.update(tx.id, { payee: 'Mine' });
    await syncNow();
    expect((await db.transactions.get(tx.id))?.payee).toBe('Mine');
    // Mine was pushed last, so it is now the account's version.
    const [row] = await sql.query<{ blob: string }>('SELECT blob FROM records WHERE rkey = $1', [await keys.rkey('transactions', tx.id)]);
    expect(keys.open(row.blob).v).toMatchObject({ payee: 'Mine' });
  });

  it('works with encryption at rest on', async () => {
    await seedDemoData('2026-10-14');
    await enableEncryption('2468');
    const first = await signIn();
    await syncNow();
    expect(await db.outbox.count()).toBe(0);
    expect(JSON.stringify(await sql.query('SELECT blob FROM records'))).not.toContain('Tesco');
    await secondDevice(first.kind === 'created' ? first.recoveryKey : '');
    expect((await db.transactions.toArray()).some((t) => t.payee.includes('Tesco'))).toBe(true);
  });
});
