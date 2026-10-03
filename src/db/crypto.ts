/**
 * Encryption primitives and the in-memory key state.
 *
 * Records are sealed with AES-256-GCM using @noble/ciphers. It is synchronous, which matters:
 * IndexedDB transactions close if they wait on WebCrypto's async calls, and Dexie cursors need
 * values synchronously. Key derivation (PBKDF2, HKDF) uses WebCrypto and only happens at unlock.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';

export { randomBytes };

/** Data cannot be read or written until the app is unlocked. */
export class LockedError extends Error {
  name = 'LockedError';
  constructor() {
    super('Mizan is locked.');
  }
}

/** 'off': no encryption; 'locked': encrypted, key not in memory; 'unlocked': key in memory. */
export type SecurityMode = 'off' | 'locked' | 'unlocked';

let mode: SecurityMode = 'off';
let dataKey: Uint8Array | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

export const securityMode = (): SecurityMode => mode;
export const currentKey = (): Uint8Array | null => dataKey;

export function subscribeSecurity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setUnlocked(key: Uint8Array): void {
  dataKey = key;
  mode = 'unlocked';
  notify();
}

/** Forgets the key. With `encrypted` false the store is plain again (encryption turned off). */
export function setLocked(encrypted = true): void {
  if (dataKey) dataKey.fill(0);
  dataKey = null;
  mode = encrypted ? 'locked' : 'off';
  notify();
}

// ------------------------------------------------------------------ bytes

const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s: string) => enc.encode(s);
export const fromUtf8 = (b: Uint8Array) => dec.decode(b);

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ------------------------------------------------------------------ AES-GCM

const IV_BYTES = 12;

/** iv ‖ ciphertext ‖ tag. `aad` binds the ciphertext to its context (e.g. the table name). */
export function seal(plaintext: Uint8Array, key: Uint8Array, aad?: Uint8Array): Uint8Array {
  const iv = randomBytes(IV_BYTES);
  const ct = gcm(key, iv, aad).encrypt(plaintext);
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}

/** Throws if the key is wrong or the data was changed. */
export function unseal(sealed: Uint8Array, key: Uint8Array, aad?: Uint8Array): Uint8Array {
  return gcm(key, sealed.subarray(0, IV_BYTES), aad).decrypt(sealed.subarray(IV_BYTES));
}

// ------------------------------------------------------------------ key derivation

export const PBKDF2_ITERATIONS = 310_000;

/** A 256-bit key from a PIN or password. */
export async function keyFromSecret(secret: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', utf8(secret) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, 256);
  return new Uint8Array(bits);
}

/** A 256-bit key from high-entropy bytes (a passkey's PRF output). */
export async function keyFromBytes(bytes: Uint8Array, info: string): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', bytes as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32) as BufferSource, info: utf8(info) as BufferSource },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export const cryptoAvailable = () => typeof crypto !== 'undefined' && !!crypto.subtle;
