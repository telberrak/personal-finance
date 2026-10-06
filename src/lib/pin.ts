/**
 * Legacy app-lock PIN hashing (PBKDF2). Since P2 the PIN unwraps the encryption key instead
 * (src/db/security.ts); these checks remain to migrate a PIN set by an older version.
 * WebCrypto needs a secure origin (HTTPS or localhost), so the lock is unavailable over plain http on a LAN.
 */
const ITERATIONS = 210_000;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** PIN hashing needs WebCrypto (HTTPS or localhost). */
export const pinSupported = () => typeof crypto !== 'undefined' && !!crypto.subtle;

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    key,
    256,
  );
  return toB64(new Uint8Array(bits));
}

/** Hashes a new PIN with a random salt. */
export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await derive(pin, salt), salt: toB64(salt) };
}

/** Checks a PIN against its stored hash, in constant time. */
export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const candidate = await derive(pin, fromB64(salt));
  // Constant-time comparison.
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/** A PIN is 4 to 8 digits. */
export const isValidPin = (pin: string) => /^\d{4,8}$/.test(pin);
