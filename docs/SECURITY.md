# Security and threat model

Mizan keeps all data on your device, in the browser's IndexedDB. Sync between devices is optional; when it is on, the server stores only ciphertext (see [Sync](#sync)). This document says what is protected, against whom, and where the limits are.

## What is protected

| Asset                                                | Where it lives                   | Protection                                                          |
| ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| Transactions, accounts, bills, budgets, goals, rules | IndexedDB on the device          | Encrypted with AES-256-GCM once a PIN is set                        |
| Settings                                             | IndexedDB                        | Encrypted, except the few the lock screen needs (see below)         |
| The data key                                         | Memory only, while unlocked      | Stored only wrapped by the PIN key or by a passkey                  |
| Backup files                                         | Wherever you save them           | Optional password encryption (AES-256-GCM, PBKDF2)                  |
| The app code                                         | Hosting, then the service worker | HTTPS, strict Content-Security-Policy, no third-party code or fonts |

## How encryption works

- **Data key.** Setting a PIN creates a random 256-bit data key. Every record is encrypted with it using AES-256-GCM (`@noble/ciphers`, audited), with a fresh random 96-bit IV per write. The table name is the additional authenticated data, so a record cannot be moved to another table without detection.
- **Key wrapping.** The data key is stored only wrapped (encrypted):
  - by a key derived from the PIN with PBKDF2-SHA-256, 310,000 iterations and a random salt;
  - by each passkey, using a key derived (HKDF) from the passkey's WebAuthn PRF output. The PRF output never leaves the authenticator without your fingerprint, face or device PIN.
- **Changing the PIN** re-wraps the data key; the data is not re-encrypted. **Turning the lock off** decrypts everything and deletes the wrapped keys.
- **Where it happens.** A Dexie middleware (`src/db/encryption.ts`) sits directly above IndexedDB. Everything above it, including the app code, sees plain objects; everything below it is ciphertext. Encryption is synchronous so IndexedDB transactions stay open.
- **Locking** removes the data key from memory and unmounts every screen. Mizan locks:
  - when it is reloaded or reopened;
  - after the chosen time in the background (or as soon as it is hidden, with "Immediately");
  - after the same time without taps or key presses (at least one minute);
  - when you press **Lock now**.

## What stays readable on the device

To keep queries fast, some fields are stored unencrypted next to each record's ciphertext:

- record IDs (random) and the indexed fields: transaction **dates**, account, category, bill, transfer and import-batch IDs, category order, rule priority, import times;
- in settings: `onboarded`, `theme`, `language`, `currency`, `lockAfterMinutes`, `hideAmounts`, which the lock screen needs;
- the keyring: wrapped keys, salts, iteration counts, passkey credential IDs and when they were added.

Someone with the raw database can therefore see **how many** transactions there are and **on which dates**, but not payees, amounts, notes, account names or balances. Indexes on payee data (import fingerprints, payee aliases) were removed in schema v3 for this reason.

## Threats

| Threat                                                                                              | Protected?             | Notes                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Someone picks up your unlocked phone or computer later                                              | Yes                    | Auto-lock on inactivity and in the background                                                                                                                                                                                        |
| Someone looking over your shoulder                                                                  | Partly                 | **Hide amounts** shows `£•••` instead of every amount                                                                                                                                                                                |
| A copy of the browser profile or disk (stolen laptop, backup of the profile, malware reading files) | Yes, mostly            | Data is ciphertext. With a 4-digit PIN an attacker can try all 10,000 PINs offline in hours; a 6–8 digit PIN or a passkey makes this much harder. This is the main reason to use a passkey                                           |
| A leaked backup file                                                                                | If a password was set  | Unprotected backups are plain JSON. Choose a long password                                                                                                                                                                           |
| Malicious script injected into the page (XSS, compromised CDN)                                      | Mitigated              | No third-party scripts, styles or fonts; strict CSP (`script-src 'self' 'wasm-unsafe-eval'` (WebAssembly for on-device receipt reading; JavaScript `eval` stays blocked)); React escapes output; user data is never rendered as HTML |
| Clickjacking                                                                                        | Yes                    | `frame-ancestors 'none'` and `X-Frame-Options: DENY`                                                                                                                                                                                 |
| Network attacker                                                                                    | Yes                    | HTTPS with HSTS; no data is sent anywhere                                                                                                                                                                                            |
| Malware running in your unlocked browser session, or a malicious browser extension                  | **No**                 | While unlocked the key is in memory and the page can read everything. Use a device you trust                                                                                                                                         |
| A compromised build or dependency (supply chain)                                                    | Partly                 | Lockfile, `npm audit` in CI, few runtime dependencies. A malicious update served by the host would run with full access                                                                                                              |
| Forgotten PIN                                                                                       | By design, no recovery | Without the PIN or a passkey the data cannot be decrypted. Clear the site's data and restore a backup                                                                                                                                |

## Sync

Sync is end-to-end encrypted. The account has a random 256-bit **sync key**, separate from each device's data key:

- **On the server** it exists only in the vault envelope, encrypted (AES-256-GCM) with a key derived (HKDF) from the **recovery key**: 160 random bits shown once when sync is set up and kept on your devices.
- **Records** are encrypted with a key derived from the sync key, with fresh IVs. The server stores each one under an HMAC-SHA-256 of its table and id, so it cannot tell which table a record belongs to, link it to an id, or read any field.
- **New devices** need both a sign-in (emailed code or passkey) and the recovery key. A sign-in alone gives access to ciphertext only.
- **Sessions** are random 256-bit tokens, stored on the server as SHA-256 hashes, and can be revoked from any device. Sign-in codes are hashed, expire after 10 minutes and allow 5 tries; sign-ins are rate-limited.

What the server can see: your email address, when each device last synced, how many records you have and how often they change, and record sizes. Lost recovery key: sign in on a device that still syncs and show it in Settings → Sync and devices. If no device has it, synced data cannot be recovered, by design.

**Households** (P11) have their own random 256-bit key. It is created on the device and given to others only inside the invite link's `#fragment`, which browsers never send to servers; the server keeps member lists and ciphertext only. Each person's devices keep household keys in their own synced vault. A household stream can only write accounts, transactions and bills marked as belonging to that household, never private records. Anyone holding a valid, unused invite link can join, so share it privately; links work once and expire after a week.

**Push reminders** (P4): a device that turns on notifications uploads its upcoming reminders as a time and a generic sentence such as "A bill is due tomorrow", never names, amounts or balances. Details are only shown by the app itself.

**Bank connections** (P5) are the one exception to end-to-end encryption: transactions from a connected bank pass through the server (in memory, never stored) and the provider on their way to the device. See [OPEN_BANKING.md](OPEN_BANKING.md).

Details and deployment: [SERVER.md](SERVER.md).

## Hosting headers

`security-headers.ts` defines the headers. They are used by `vite preview`, so the end-to-end tests run under them, and copied into `netlify.toml` and `vercel.json`. A unit test fails if the copies drift.

- `Content-Security-Policy`: `default-src 'self'`, `script-src 'self'`, `style-src 'self'` plus inline `style` attributes, `img-src 'self' data: blob:`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`;
- `Strict-Transport-Security` (hosting only), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`;
- `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, and a `Permissions-Policy` that turns off the camera, microphone, location, payment and USB.

## Rules for contributors

- All reads and writes go through Dexie, so they pass the encryption middleware. Never open IndexedDB directly in app code.
- Do not add an index on a field that holds personal data (payees, notes, amounts, names). Indexed fields are stored in the clear.
- Schema upgrades run before unlocking. They can change indexes and tables, but cannot read or change the contents of encrypted records. A data migration on encrypted records must run after unlock.
- Add nothing that loads from another origin. The CSP will block it, and the test in `e2e/security.spec.ts` will fail.
- Keep secrets out of logs, URLs and error messages.

## Reporting a problem

Please open a private security advisory on the GitHub repository rather than a public issue.
