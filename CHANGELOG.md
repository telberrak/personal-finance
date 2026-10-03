# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); each roadmap phase (see [docs/ROADMAP_PRO.md](docs/ROADMAP_PRO.md)) is a minor release until 1.0.

## 0.4.0 — P3: accounts and end-to-end encrypted sync

- Optional sync between devices: sign in with an emailed code or a passkey; data is encrypted on the device with a sync key the server never sees.
- Recovery key to add devices; device list with remote sign-out; account deletion.
- Sync API (`server/`) with Postgres, Dockerfile and Fly.io configs for staging and production.

## 0.3.0 — P2: security hardening

- Encryption at rest with the PIN, passkey unlock, auto-lock, "hide amounts", encrypted backups.
- Strict Content-Security-Policy and security headers; fonts bundled.

## 0.2.0 — P1: multi-language foundation

- All text translatable, locale and currency settings, right-to-left support, pseudo-locales for testing.

## 0.1.0 — First version

- Spending, bills, budgets, reports, goals, CSV import, rules, backups and PIN lock, on phone and desktop.
