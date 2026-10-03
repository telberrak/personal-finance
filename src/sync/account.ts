/**
 * Signing in to sync, setting up the vault, and managing devices and passkeys.
 *
 * First device: sign in → a sync key and recovery key are created → everything is pushed.
 * Another device: sign in → enter the recovery key → this device's data is replaced by the
 * account's.
 */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { Me, Session, Vault } from '../../shared/api.ts';
import { randomBytes, toB64 } from '../db/crypto';
import { db } from '../db/db';
import { isSynced } from '../db/outbox';
import { t } from '../i18n';
import { api, SyncApiError } from './client';
import { queueEverything, resetSyncEngine, syncNow } from './engine';
import { newRecoveryKey, unwrapSyncKey, wrapSyncKey } from './keys';

export type SignInResult = { kind: 'created'; recoveryKey: string } | { kind: 'needsKey' } | { kind: 'resumed' };

/** "Edge on Windows", for the device list. */
export function deviceName(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : t('sync.browser');
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : t('sync.thisDevice');
  return t('sync.deviceName', { browser, os });
}

const syncState = () => db.syncState.get('sync');
async function token(): Promise<string> {
  const s = await syncState();
  if (!s?.token) throw new SyncApiError(401, 'signed out');
  return s.token;
}

export async function requestCode(email: string): Promise<void> {
  await api('/auth/email/start', { body: { email } });
}

export async function verifyCode(email: string, code: string): Promise<SignInResult> {
  return afterSignIn(await api<Session>('/auth/email/verify', { body: { email, code, deviceName: deviceName() } }));
}

export async function signInWithPasskey(): Promise<SignInResult> {
  const { options, challengeId } = await api<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>(
    '/auth/passkey/options',
    { body: {} },
  );
  const response = await startAuthentication({ optionsJSON: options });
  return afterSignIn(await api<Session>('/auth/passkey/verify', { body: { challengeId, response, deviceName: deviceName() } }));
}

async function afterSignIn(session: Session): Promise<SignInResult> {
  const previous = await syncState();
  if (previous?.userId === session.user.id && previous.syncKey) {
    // Signed in again after being signed out remotely: carry on where this device left off.
    await db.syncState.update('sync', { token: session.token, deviceId: session.deviceId });
    void syncNow();
    return { kind: 'resumed' };
  }
  await db.syncState.put({
    id: 'sync',
    token: session.token,
    userId: session.user.id,
    email: session.user.email,
    deviceId: session.deviceId,
    cursor: 0,
  });
  const me = await api<Me>('/me', { token: session.token });
  if (me.hasVault) return { kind: 'needsKey' };
  return createVault(session.token);
}

/** First device on the account: new sync key and recovery key, then upload everything. */
async function createVault(sessionToken: string): Promise<SignInResult> {
  const syncKey = randomBytes(32);
  const recoveryKey = newRecoveryKey();
  try {
    await api('/vault', { method: 'PUT', body: { envelope: await wrapSyncKey(syncKey, recoveryKey) }, token: sessionToken });
  } catch (err) {
    if (err instanceof SyncApiError && err.status === 409) return { kind: 'needsKey' }; // another device was first
    throw err;
  }
  await db.syncState.update('sync', { syncKey: toB64(syncKey), recoveryKey });
  await queueEverything();
  void syncNow();
  return { kind: 'created', recoveryKey };
}

/** Joins the account's synced data. Throws WrongRecoveryKey. Replaces this device's data. */
export async function joinWithRecoveryKey(recoveryKey: string): Promise<void> {
  const { envelope } = await api<Vault>('/vault', { token: await token() });
  const syncKey = await unwrapSyncKey(envelope, recoveryKey);
  const tables = db.tables.filter((tb) => isSynced(tb.name));
  await db.transaction('rw', [...tables, db.outbox, db.syncState], async () => {
    // Settings stay until the account's arrive, so this device keeps its theme and lock.
    await Promise.all(tables.filter((tb) => tb.name !== 'settings').map((tb) => tb.clear()));
    await db.outbox.clear();
    await db.syncState.update('sync', { syncKey: toB64(syncKey), recoveryKey: recoveryKey.toUpperCase().trim(), cursor: 0 });
  });
  await syncNow();
}

/** Stops syncing on this device. The data stays here and on the server. */
export async function signOut(): Promise<void> {
  try {
    await api('/auth/logout', { body: {}, token: await token() });
  } catch {
    // Already signed out, or offline: forget the session here anyway.
  }
  await forgetAccount();
}

/** Deletes the account and all synced data on the server. Data on this device stays. */
export async function deleteAccount(): Promise<void> {
  await api('/account', { method: 'DELETE', token: await token() });
  await forgetAccount();
}

async function forgetAccount() {
  await db.transaction('rw', db.syncState, db.outbox, async () => {
    await db.syncState.clear();
    await db.outbox.clear();
  });
  resetSyncEngine();
}

export const getMe = async (): Promise<Me> => api<Me>('/me', { token: await token() });
export const signOutDevice = async (id: string) => api(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE', token: await token() });
export const removeAccountPasskey = async (id: string) =>
  api(`/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', token: await token() });

/** Adds a passkey for signing in to the sync account on other devices. */
export async function addAccountPasskey(): Promise<void> {
  const auth = await token();
  const { options, challengeId } = await api<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeId: string }>(
    '/passkeys/options',
    { body: {}, token: auth },
  );
  const response = await startRegistration({ optionsJSON: options });
  await api('/passkeys', { body: { challengeId, response }, token: auth });
}
