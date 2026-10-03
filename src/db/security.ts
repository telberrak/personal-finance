/**
 * App lock and encryption at rest.
 *
 * A random 256-bit data key encrypts every record (see encryption.ts). The data key itself is
 * only stored wrapped: once by a key derived from the PIN (PBKDF2), and once per passkey by a key
 * derived from the passkey's PRF output. Unlocking unwraps it into memory; locking forgets it.
 */
import { useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { isValidPin, verifyPin } from '../lib/pin';
import {
  currentKey,
  fromB64,
  fromUtf8,
  keyFromBytes,
  keyFromSecret,
  LockedError,
  PBKDF2_ITERATIONS,
  randomBytes,
  seal,
  securityMode,
  setLocked,
  setUnlocked,
  subscribeSecurity,
  toB64,
  unseal,
  utf8,
} from './crypto';
import { db } from './db';
import type { KeyEntry, Settings } from './types';

export { LockedError };

export class SecurityError extends Error {
  name = 'SecurityError';
}

const PIN_AAD = utf8('ledger-dek:pin');
const PASSKEY_AAD = utf8('ledger-dek:passkey');

/** 'off', 'locked' or 'unlocked'; components re-render when it changes. */
export const useSecurityMode = () => useSyncExternalStore(subscribeSecurity, securityMode);

// Other tabs reload when encryption is turned on or off here, so none keeps writing in the old mode.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ledger-security') : undefined;
if (channel) channel.onmessage = () => window.location.reload();

/** Works out whether the data is encrypted. Call once before the app renders. */
export async function initSecurity(): Promise<void> {
  await db.open();
  if (await db.keyring.get('pin')) return setLocked(true);
  // A PIN set before encryption existed: lock now, encrypt on the next unlock.
  const settings = await db.settings.get('app');
  setLocked(!!settings?.pinHash);
}

export const lockNow = () => {
  if (securityMode() === 'unlocked') setLocked(true);
};

// ---------------------------------------------------------------- PIN

async function pinEntry(pin: string, dataKey: Uint8Array): Promise<KeyEntry> {
  const salt = randomBytes(16);
  const kek = await keyFromSecret(pin, salt);
  return {
    id: 'pin',
    kind: 'pin',
    salt: toB64(salt),
    iterations: PBKDF2_ITERATIONS,
    wrapped: toB64(seal(dataKey, kek, PIN_AAD)),
    createdAt: Date.now(),
  };
}

/** Returns false for a wrong PIN. */
export async function unlockWithPin(pin: string): Promise<boolean> {
  const entry = await db.keyring.get('pin');
  if (entry) {
    const kek = await keyFromSecret(pin, fromB64(entry.salt), entry.iterations);
    try {
      setUnlocked(unseal(fromB64(entry.wrapped), kek, PIN_AAD));
      return true;
    } catch {
      return false;
    }
  }
  const settings = await db.settings.get('app');
  if (!settings?.pinHash || !settings.pinSalt) return true;
  if (!(await verifyPin(pin, settings.pinHash, settings.pinSalt))) return false;
  setLocked(false);
  await enableEncryption(pin);
  return true;
}

/**
 * Rewrites every record in one transaction, switching mode between reading and writing: rows
 * are read in the old form and written in the new one. The legacy PIN hash is dropped.
 */
async function rewriteAll(switchMode: () => void, undo: () => void, keyring: (table: typeof db.keyring) => Promise<unknown>) {
  const tables = db.tables.filter((tb) => tb.name !== 'keyring');
  try {
    await db.transaction('rw', [...tables, db.keyring], async () => {
      const rows = await Promise.all(tables.map((tb) => tb.toArray()));
      switchMode();
      await Promise.all(
        tables.map((tb, i) =>
          tb.bulkPut(tb.name === 'settings' ? rows[i].map(({ pinHash: _h, pinSalt: _s, ...rest }: Settings) => rest) : rows[i]),
        ),
      );
      await keyring(db.keyring);
    });
  } catch (err) {
    undo();
    throw err;
  }
  channel?.postMessage('changed');
}

/** Sets the PIN and encrypts everything with a new data key. */
export async function enableEncryption(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new SecurityError(t('errors.pinDigits'));
  if (securityMode() !== 'off') throw new SecurityError(t('security.alreadyOn'));
  const dataKey = randomBytes(32);
  const entry = await pinEntry(pin, dataKey);
  await rewriteAll(
    () => setUnlocked(dataKey),
    () => setLocked(false),
    (keyring) => keyring.put(entry),
  );
}

/** Replaces the PIN. The data key stays the same, so nothing needs re-encrypting. */
export async function changePin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new SecurityError(t('errors.pinDigits'));
  const dataKey = currentKey();
  if (!dataKey) throw new LockedError();
  await db.keyring.put(await pinEntry(pin, dataKey));
}

/** Decrypts everything and forgets the PIN and passkeys. */
export async function disableEncryption(): Promise<void> {
  const dataKey = currentKey();
  if (!dataKey) throw new LockedError();
  const copy = dataKey.slice();
  await rewriteAll(
    () => setLocked(false),
    () => setUnlocked(copy),
    (keyring) => keyring.clear(),
  );
  // The native app also keeps the key in the system keychain: remove it there too.
  const native = await import('../native/native');
  if (native.isNative()) await native.disableNativeBiometric();
}

// ---------------------------------------------------------------- passkeys

type PrfOutputs = { enabled?: boolean; results?: { first?: BufferSource } };

const b64url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
const bytesOf = (b: BufferSource) => (b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
const prfOf = (cred: PublicKeyCredential) => (cred.getClientExtensionResults() as { prf?: PrfOutputs }).prf;

/**
 * Whether this browser can unlock with a passkey. The PRF extension is what turns a passkey
 * into a key; browsers that cannot say for sure are offered it and checked at set-up.
 */
export async function passkeysSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.isSecureContext || !window.PublicKeyCredential) return false;
  const pkc = window.PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> };
  try {
    const caps = await pkc.getClientCapabilities?.();
    if (caps && 'extension:prf' in caps) return caps['extension:prf'];
  } catch {
    // fall through
  }
  return true;
}

async function prfSecret(credentialIds: string[], salts: Map<string, Uint8Array>): Promise<{ id: string; secret: Uint8Array }> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      // No server checks this: the security comes from the PRF output, which needs the authenticator.
      challenge: randomBytes(32) as BufferSource,
      allowCredentials: credentialIds.map((id) => ({ type: 'public-key' as const, id: fromB64url(id) as BufferSource })),
      userVerification: 'required',
      extensions: {
        prf: { evalByCredential: Object.fromEntries(credentialIds.map((id) => [id, { first: salts.get(id)! as BufferSource }])) },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const first = assertion && prfOf(assertion)?.results?.first;
  if (!assertion || !first) throw new SecurityError(t('security.passkeyNoPrf'));
  return { id: b64url(new Uint8Array(assertion.rawId)), secret: bytesOf(first) };
}

/** Adds a passkey (fingerprint, face, device PIN or security key) that can unlock the app. */
export async function addPasskey(): Promise<void> {
  const dataKey = currentKey();
  if (!dataKey) throw new LockedError();
  const salt = randomBytes(32);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Mizan' },
      user: { id: randomBytes(16) as BufferSource, name: t('security.passkeyName'), displayName: t('security.passkeyName') },
      challenge: randomBytes(32) as BufferSource,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      extensions: { prf: { eval: { first: salt as BufferSource } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new SecurityError(t('security.passkeyCancelled'));
  const prf = prfOf(cred);
  if (!prf?.enabled && !prf?.results?.first) throw new SecurityError(t('security.passkeyNoPrf'));
  const id = b64url(new Uint8Array(cred.rawId));
  // Some authenticators only evaluate the PRF when signing in, which asks a second time.
  const secret = prf.results?.first ? bytesOf(prf.results.first) : (await prfSecret([id], new Map([[id, salt]]))).secret;
  const kek = await keyFromBytes(secret, 'ledger-dek');
  await db.keyring.put({
    id: `passkey:${id}`,
    kind: 'passkey',
    credentialId: id,
    salt: toB64(salt),
    wrapped: toB64(seal(dataKey, kek, PASSKEY_AAD)),
    createdAt: Date.now(),
  });
}

export async function unlockWithPasskey(): Promise<void> {
  const entries = (await db.keyring.toArray()).filter((e) => e.kind === 'passkey' && e.credentialId);
  if (!entries.length) throw new SecurityError(t('security.passkeyNone'));
  const salts = new Map(entries.map((e) => [e.credentialId!, fromB64(e.salt)]));
  const { id, secret } = await prfSecret([...salts.keys()], salts);
  const entry = entries.find((e) => e.credentialId === id);
  if (!entry) throw new SecurityError(t('security.passkeyUnknown'));
  try {
    setUnlocked(unseal(fromB64(entry.wrapped), await keyFromBytes(secret, 'ledger-dek'), PASSKEY_AAD));
  } catch {
    throw new SecurityError(t('security.passkeyUnknown'));
  }
}

export async function removePasskey(id: string): Promise<void> {
  await db.keyring.delete(id);
}

// ---------------------------------------------------------------- backups

const ENCRYPTED_BACKUP = 'ledger-backup-encrypted';
export const MIN_BACKUP_PASSWORD = 8;

interface EncryptedBackup {
  format: typeof ENCRYPTED_BACKUP;
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  data: string;
}

export async function encryptBackup(json: string, password: string): Promise<string> {
  if (password.length < MIN_BACKUP_PASSWORD) throw new SecurityError(t('security.passwordShort', { count: MIN_BACKUP_PASSWORD }));
  const salt = randomBytes(16);
  const key = await keyFromSecret(password, salt);
  const out: EncryptedBackup = {
    format: ENCRYPTED_BACKUP,
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    data: toB64(seal(utf8(json), key, utf8(ENCRYPTED_BACKUP))),
  };
  return JSON.stringify(out);
}

export function isEncryptedBackup(text: string): boolean {
  try {
    return JSON.parse(text)?.format === ENCRYPTED_BACKUP;
  } catch {
    return false;
  }
}

/** Throws a SecurityError for a wrong password or a damaged file. */
export async function decryptBackup(text: string, password: string): Promise<string> {
  const file = JSON.parse(text) as EncryptedBackup;
  const key = await keyFromSecret(password, fromB64(file.salt), file.iterations);
  try {
    return fromUtf8(unseal(fromB64(file.data), key, utf8(ENCRYPTED_BACKUP)));
  } catch {
    throw new SecurityError(t('security.wrongPassword'));
  }
}
