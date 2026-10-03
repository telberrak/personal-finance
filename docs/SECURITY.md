# Security and threat model

Ledger keeps all data on your device, in the browser's IndexedDB. There is no server and no account, so nothing is sent anywhere. This document says what is protected, against whom, and where the limits are.

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
- **Locking** removes the data key from memory and unmounts every screen. Ledger locks:
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

| Threat                                                                                              | Protected?             | Notes                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Someone picks up your unlocked phone or computer later                                              | Yes                    | Auto-lock on inactivity and in the background                                                                                                                                              |
| Someone looking over your shoulder                                                                  | Partly                 | **Hide amounts** shows `£•••` instead of every amount                                                                                                                                      |
| A copy of the browser profile or disk (stolen laptop, backup of the profile, malware reading files) | Yes, mostly            | Data is ciphertext. With a 4-digit PIN an attacker can try all 10,000 PINs offline in hours; a 6–8 digit PIN or a passkey makes this much harder. This is the main reason to use a passkey |
| A leaked backup file                                                                                | If a password was set  | Unprotected backups are plain JSON. Choose a long password                                                                                                                                 |
| Malicious script injected into the page (XSS, compromised CDN)                                      | Mitigated              | No third-party scripts, styles or fonts; strict CSP (`script-src 'self'`); React escapes output; user data is never rendered as HTML                                                       |
| Clickjacking                                                                                        | Yes                    | `frame-ancestors 'none'` and `X-Frame-Options: DENY`                                                                                                                                       |
| Network attacker                                                                                    | Yes                    | HTTPS with HSTS; no data is sent anywhere                                                                                                                                                  |
| Malware running in your unlocked browser session, or a malicious browser extension                  | **No**                 | While unlocked the key is in memory and the page can read everything. Use a device you trust                                                                                               |
| A compromised build or dependency (supply chain)                                                    | Partly                 | Lockfile, `npm audit` in CI, few runtime dependencies. A malicious update served by the host would run with full access                                                                    |
| Forgotten PIN                                                                                       | By design, no recovery | Without the PIN or a passkey the data cannot be decrypted. Clear the site's data and restore a backup                                                                                      |

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
