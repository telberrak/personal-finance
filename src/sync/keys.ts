/**
 * Sync cryptography. The account has one random 256-bit sync key, shared by its devices and
 * never sent to the server unencrypted:
 *
 * - the server keeps it only in the vault envelope, encrypted with a key derived from the
 *   recovery key (160 random bits, shown to you once and kept on your devices);
 * - each record is encrypted with a key derived from it (AES-256-GCM);
 * - each record's server key is an HMAC of its table and id, so the server cannot link
 *   records to tables or ids.
 */
import { fromB64, fromUtf8, keyFromBytes, randomBytes, seal, toB64, unseal, utf8 } from '../db/crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_BYTES = 20;
// Labels keep the app's original name: they are part of the encryption, and changing them would
// make existing vaults and records unreadable.
const VAULT_AAD = utf8('ledger-vault');
const RECORD_AAD = utf8('ledger-sync-record');

/** The recovery key entered does not open this account's vault. */
export class WrongRecoveryKey extends Error {
  name = 'WrongRecoveryKey';
}

// ------------------------------------------------------------------ recovery key

/** "7K3M-…", 8 groups of 4 characters (Crockford base32: no I, L, O or U). */
export function newRecoveryKey(): string {
  return formatRecoveryKey(randomBytes(RECOVERY_BYTES));
}

function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Accepts any case, spaces or dashes, and the usual misreadings (O→0, I/L→1). Null if malformed. */
export function parseRecoveryKey(text: string): Uint8Array | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 32 || /[^0-9A-HJKMNP-TV-Z]/.test(clean)) return null;
  const out = new Uint8Array(RECOVERY_BYTES);
  let bits = 0;
  let value = 0;
  let i = 0;
  for (const ch of clean) {
    value = (value << 5) | CROCKFORD.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}

// ------------------------------------------------------------------ vault envelope

interface Envelope {
  v: 1;
  data: string;
}

/** Encrypts the sync key with a key derived from the recovery key, for the server-side vault. */
export async function wrapSyncKey(syncKey: Uint8Array, recoveryKey: string): Promise<string> {
  const kek = await keyFromBytes(parseRecoveryKey(recoveryKey)!, 'ledger-recovery');
  const envelope: Envelope = { v: 1, data: toB64(seal(syncKey, kek, VAULT_AAD)) };
  return JSON.stringify(envelope);
}

/** Opens the vault with the recovery key. Throws WrongRecoveryKey if it does not fit. */
export async function unwrapSyncKey(envelope: string, recoveryKey: string): Promise<Uint8Array> {
  const bytes = parseRecoveryKey(recoveryKey);
  if (!bytes) throw new WrongRecoveryKey();
  try {
    const parsed = JSON.parse(envelope) as Envelope;
    return unseal(fromB64(parsed.data), await keyFromBytes(bytes, 'ledger-recovery'), VAULT_AAD);
  } catch {
    throw new WrongRecoveryKey();
  }
}

// ------------------------------------------------------------------ records

/** What travels inside a record's ciphertext. `v` null: the record was deleted. */
export interface SyncedRecord {
  t: string;
  k: string;
  v: Record<string, unknown> | null;
}

/** Seals and opens synced records, and derives their opaque record keys. */
export interface SyncKeys {
  rkey(table: string, key: string): Promise<string>;
  seal(record: SyncedRecord): string;
  open(blob: string): SyncedRecord;
}

const b64url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The keys for one stream (your own or a household's), derived from its base key. */
export async function syncKeys(syncKeyB64: string): Promise<SyncKeys> {
  const syncKey = fromB64(syncKeyB64);
  const dataKey = await keyFromBytes(syncKey, 'ledger-sync-data');
  const hmac = await crypto.subtle.importKey(
    'raw',
    (await keyFromBytes(syncKey, 'ledger-sync-rkey')) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return {
    rkey: async (table, key) => b64url(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, utf8(`${table}/${key}`) as BufferSource))),
    seal: (record) => toB64(seal(utf8(JSON.stringify(record)), dataKey, RECORD_AAD)),
    open: (blob) => JSON.parse(fromUtf8(unseal(fromB64(blob), dataKey, RECORD_AAD))) as SyncedRecord,
  };
}
