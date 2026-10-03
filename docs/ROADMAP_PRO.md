# Ledger — roadmap to a professional app

What comes after the current app (Phases 0–4 of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)), ordered by importance.
Each phase lists its dependencies, so independent work can go ahead while decisions are pending.

Sizes are rough effort for one developer: **S** ≈ under a day, **M** ≈ 1–3 days, **L** ≈ a week, **XL** ≈ several weeks.

**Language policy:** the app stays English while it is built, but from phase P1 onwards every screen is written so that French and Arabic (right to left) can be added by translating files, not by rewriting screens. See [Multi-language rules](#multi-language-rules).

---

## Overview

| #   | Phase                                            | Why it matters                                         | Needs a server? | Size |
| --- | ------------------------------------------------ | ------------------------------------------------------ | --------------- | ---- |
| P1  | Multi-language foundation (English only)         | Every later screen would otherwise need rewriting      | No              | L    |
| P2  | Security hardening                               | Trust: this is financial data                          | No              | M    |
| P3  | Backend foundation: account, encrypted sync, ops | Unlocks P4, P5, P10 and P11                            | **Yes**         | XL   |
| P4  | Notifications and reminders                      | The app tells you before money problems happen         | Yes (push)      | L    |
| P5  | Open Banking (automatic transactions)            | Removes manual entry and CSV imports, the biggest gap  | Yes + regulated | XL   |
| P6  | Debts, credit cards and net worth                | The full financial picture, not just spending          | No              | L    |
| P7  | Smarter categorisation, tags and search          | Less tidying up, better answers                        | No              | L    |
| P8  | Cash-flow calendar and deeper reports            | Planning ahead; year-end and tax views                 | No              | L    |
| P9  | Receipts and attachments                         | Proof of purchase, warranties, expenses                | No (OCR: maybe) | M    |
| P10 | Native apps (App Store, Google Play)             | Reliable notifications, biometrics, widgets, discovery | Uses P3         | L    |
| P11 | Shared finances                                  | Couples, households, splitting with friends            | Yes (P3)        | L    |
| P12 | French and Arabic release, multi-currency        | Opens the app to new users and regions                 | No              | L    |
| P13 | Launch readiness                                 | Legal, brand, onboarding, support                      | Partly          | M    |

**Recommended order of work:**

- **Now:** P1 and P2 are done; both needed no decisions.
- **Then:** P6 → P7 → P8 → P9, while you decide on P3 (cost, hosting, regulation).
- **After the P3 decision:** P3 → P4 → P5, then P10, P11, P12 and P13.

---

## P1 — Multi-language foundation (English only) — L

**Status (3 October 2026): done.** It covers:

- i18next with 655 English strings and a key-check test;
- locale and currency settings, with formatting through `Intl`;
- amount parsing for comma decimals and Arabic-Indic digits;
- right-to-left CSS with mirrored icons and isolated amounts, plus an Arabic font fallback;
- `en-XA` and `ar-XB` pseudo-locales with Playwright checks;
- a lint rule that blocks hard-coded text.

How to add a language: [TRANSLATING.md](TRANSLATING.md).

Goal: the app looks exactly the same in English, but nothing in the code assumes English, left-to-right, pounds or UK dates.

| #    | Task                                                                                                                                                                                                                                                           | Size |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1.1  | Add **react-i18next** (ICU-style plurals through `Intl.PluralRules`, which handles Arabic's six plural forms). English strings live in `src/locales/en/*.json` by area (common, home, bills…)                                                                  | M    |
| 1.2  | Move every user-visible string in screens, toasts, dialogs, `aria-label`s and validation errors into translation keys. The repo layer returns error **codes**; screens translate them                                                                          | L    |
| 1.3  | Lint rule that forbids raw text in JSX (`eslint-plugin-i18next` or `react/jsx-no-literals`), so no new hard-coded strings slip in                                                                                                                              | S    |
| 1.4  | **Locale** and **currency** become two separate settings. All money and date formatting goes through one `useFormat()` hook using `Intl` with the chosen locale. No `'en-GB'` or `'GBP'` literals outside it                                                   | M    |
| 1.5  | Input parsing that accepts `12,50`, `1 234,56`, `١٢٫٥٠` (Arabic-Indic digits) and `12.50`                                                                                                                                                                      | S    |
| 1.6  | **RTL-ready CSS:** logical properties (`margin-inline-start`, `padding-inline`, `inset-inline`, `text-align: start`). `dir` and `lang` set on `<html>` from the locale. Direction-specific icons (back/forward chevrons, arrows, the transfer ⇄) mirror in RTL | M    |
| 1.7  | Fonts: keep Geist for Latin scripts and add an Arabic fallback (IBM Plex Sans Arabic or Noto Sans Arabic) to the font stack                                                                                                                                    | S    |
| 1.8  | Default categories and demo data come from translation keys at creation time. Names you type yourself are never translated                                                                                                                                     | S    |
| 1.9  | **Pseudo-locale** (`en-XA`: accented, about 40% longer text) plus an RTL pseudo-locale for testing. A Playwright run in each finds clipped text and layout that breaks right to left                                                                           | M    |
| 1.10 | Language picker in Settings, showing English only until translations ship (P12)                                                                                                                                                                                | S    |

**Done when:** English output is unchanged, the pseudo-locales show no hard-coded text, RTL pseudo-locale screenshots look mirrored and correct, and lint blocks raw strings.

## P2 — Security hardening — M

**Status (3 October 2026): done.** It covers:

- AES-256-GCM encryption at rest through a Dexie middleware, with the data key wrapped by the PIN (PBKDF2) and by passkeys (WebAuthn PRF); existing data and old PINs migrate on the next unlock; schema v3 drops the indexes on payee data;
- passkey unlock, shown only where the browser supports it, tested with a virtual authenticator;
- a strict CSP and security headers for `vite preview`, Netlify and Vercel, with the fonts bundled;
- auto-lock on inactivity, "Lock now", and a "hide amounts" privacy mode;
- password-encrypted backups;
- `npm audit` in CI and a threat model: [SECURITY.md](SECURITY.md).

| #   | Task                                                                                                                                                                       | Size |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 2.1 | **Encryption at rest:** data in IndexedDB is encrypted with AES-GCM using a key derived from the PIN or passkey. Includes migrating existing data in and out of encryption | L    |
| 2.2 | **Passkey / biometric unlock** (WebAuthn: Face ID, Touch ID, Windows Hello) as an alternative to the PIN                                                                   | M    |
| 2.3 | Security headers on the host: strict Content-Security-Policy, HSTS, `frame-ancestors 'none'`. Self-host the fonts so no third-party requests are needed                    | S    |
| 2.4 | Auto-lock on inactivity (not just in the background); optional "hide balances" privacy mode                                                                                | S    |
| 2.5 | Encrypted backups (password-protected backup files)                                                                                                                        | S    |
| 2.6 | Dependency audit in CI, and a written threat model                                                                                                                         | S    |

## P3 — Backend foundation — XL (decision needed: hosting, cost, data location)

**Status (3 October 2026): done.** Decision: our own TypeScript API (Hono, Postgres; PGlite locally), deployed to Fly.io in London. It covers:

- sign-in with an emailed code or a passkey, sessions per device;
- end-to-end encrypted sync (sync key in a vault opened by the recovery key, HMAC record keys, outbox-based change tracking, per-record last-writer-wins that never overwrites unpushed local changes);
- device list with remote sign-out, account deletion, recovery key;
- Dockerfile, staging and production Fly configs, health checks, privacy-safe logging, CHANGELOG and versions. Error reporting (Sentry) is documented but not enabled: it needs an account.

See [SERVER.md](SERVER.md).

| #   | Task                                                                                                                                                                                             | Size |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 3.1 | Choose the stack. Options: Supabase (Postgres, auth, edge functions), a small Node/TypeScript API on Fly.io or Render, or Dexie Cloud. UK/EU data location for GDPR                              | M    |
| 3.2 | Accounts: email magic link plus passkeys. No passwords if possible                                                                                                                               | M    |
| 3.3 | **End-to-end encrypted sync:** the server stores only encrypted change records, keys stay on your devices, conflicts resolve per record (last writer wins plus a merge for splits and transfers) | XL   |
| 3.4 | Device management: list devices, sign out remotely, recovery key                                                                                                                                 | M    |
| 3.5 | Ops: staging and production environments, privacy-safe error reporting (Sentry with scrubbing; no amounts or payees), uptime checks, versioned releases and a changelog                          | M    |

## P4 — Notifications and reminders — L (after P3)

**Status (3 October 2026): done.** Alerts are computed on the device (`src/lib/alerts.ts`). The centre and local notifications work without an account; Web Push needs sync, and the server only stores each reminder's time and a generic sentence. Native push comes with P10.

**Status (3 October 2026): done.** Alerts are computed on the device (`src/lib/alerts.ts`). The centre and local notifications work without an account; Web Push needs sync, and the server only stores each reminder's time and a generic sentence. Native push comes with P10.

- Web Push (and native push after P10).
- **Alerts:**
  - bill due tomorrow;
  - payday arrived;
  - budget at 80% and 100%;
  - forecast balance below your threshold;
  - unusual payment (much larger than usual for that payee);
  - free trial ending;
  - subscription renewing in 7 days.
- Quiet hours and a setting per alert type.
- Delivery: the server schedules from encrypted reminder metadata (due dates and labels only, never balances), or local scheduling in the native app.

## P5 — Open Banking — XL (after P3; regulated)

**Status (3 October 2026): done in code.** GoCardless Bank Account Data adapter and a sandbox bank; connect, map, automatic import, balance matching, 90-day re-consent reminders. Going live needs a provider account and terms, and a privacy-notice review: see [OPEN_BANKING.md](OPEN_BANKING.md).

- **Provider:** an AISP such as TrueLayer, Yapily or GoCardless Bank Account Data. Check coverage of UK, French and Moroccan/Middle-East banks if those markets matter, plus pricing and terms.
- **Regulation:** operate as the provider's agent, or register with the FCA (and EU equivalents).
- **Sync flow:** connect a bank, then transactions sync in the background and go through the existing import pipeline (clean-up, rules, duplicate check, bill matching). Re-consent every 90 days, with reminders.
- **Balances:** reconcile against the bank's reported balance, and offer to fix the opening balance when they differ.

## P6 — Debts, credit cards and net worth — L

**Status (3 October 2026): done.** Account types and fields, valuations, Net worth page with history, amortisation and payoff dates, avalanche/snowball planner with extra-payment what-ifs, card-due reminders.

- **Credit cards:** statement date, due date, minimum payment and interest rate. "Pay in full" reminders, and card balances kept out of safe to spend.
- **Loans and mortgages:** amortisation schedule, payoff date, and extra-payment what-ifs.
- **Assets:** savings, investments, pension and property, with manual values and a value history.
- **Net worth:** a chart over time and a breakdown of assets and liabilities.
- **Debt payoff planner:** snowball versus avalanche.

## P7 — Smarter categorisation, tags and search — L

**Status (3 October 2026): done.** Merchant directory (UK; FR/AR regions to add with P12), on-device learning, tags, Search page with saved searches and bulk edit. Logos are brand-coloured monograms: shipping real logos needs trademark permission.

- **Merchant directory:** clean names and logos for common UK (later FR/AR-region) merchants, stored locally and sent with the app.
- **Learning:** suggest a category from your own corrections (a lightweight on-device model built from payee tokens).
- **Tags** across categories, e.g. "Holiday 2027" or "Work expense".
- **Advanced search:** date range, amount range, account, category, tag, text. Saved searches.
- **Bulk edit:** select several transactions, then recategorise, tag or delete.

## P8 — Cash-flow calendar and deeper reports — L

**Status (3 October 2026): done.** Calendar, custom ranges and comparisons, trends and averages, Year in review with a print stylesheet (PDF through the browser), tax helper with per-country tax years and headings (UK, France; Morocco and Gulf states to add with P12).

- **Calendar:** a month view with bills, paydays and the forecast balance for each day; tap a day to see its details.
- **Custom date ranges:**
  - compare periods;
  - category trends over 12 months;
  - average spending per category.
- **Year in review** and a printable **PDF report**.
- **Tax helper:** mark income and expenses for self-assessment, with a year summary. Rules differ by country, so these must be per locale.

## P9 — Receipts and attachments — M

**Status (3 October 2026): done.** Attachments (encrypted, synced), on-device OCR with no cloud service, return-by and warranty reminders. A cloud OCR option was not added: on-device reading covers printed receipts, and avoids sending images anywhere.

- Attach photos or PDFs to a transaction, stored encrypted (synced after P3).
- Warranty and return-by reminders on purchases.
- Optional OCR of amount, date and merchant: on-device (Tesseract.js) first, a cloud service only with consent.

## P10 — Native apps — L (after P3)

**Status (3 October 2026): done in code.** Capacitor projects, biometric unlock via the keychain, local-notification reminders, notification deep links, PWA share target. Store submission needs your Apple and Google developer accounts and a Mac for iOS builds; widgets and a native share extension need native code. See [NATIVE.md](NATIVE.md).

- Capacitor shell around the same code.
- Native push, biometrics, a secure keychain for keys, home-screen widgets ("safe to spend"), and share-to-app for receipts.
- App Store and Google Play listings, privacy labels and review process.

## P11 — Shared finances — L (after P3)

- **Household space:** shared accounts, bills and budgets with a partner; each person keeps private accounts.
- **Splitting with friends:** who owes whom, settle-up records and payment links.

## P12 — French and Arabic release, multi-currency — L

- Professional translation of `fr` and `ar` (financial terms reviewed by native speakers), plus a glossary.
- **RTL quality pass:**
  - every screen at phone and desktop size;
  - charts and timelines read right to left where natural;
  - numbers and amounts keep the correct direction inside RTL text, using `<bdi>` and Unicode isolates.
- **Locale defaults:** date order, first day of the week (Saturday or Sunday in parts of the Arab world, Monday in France), number formats, and an Arabic-Indic or Latin digits option.
- **Multi-currency:**
  - a currency per account;
  - a home currency for totals;
  - exchange rates (cached daily, manual override);
  - travel spending.
- **CSV import presets** for French banks (`;` delimiters, comma decimals, `dd/mm/yyyy`) and common banks in Arabic-speaking markets.
- Tests: Playwright runs in `fr` and `ar` added to CI.

## P13 — Launch readiness — M

- Final name, logo and a marketing site.
- Privacy policy, terms, cookie-free analytics (opt-in), and UK GDPR / EU GDPR notices in all three languages.
- First-run tour, empty states, in-app help and feedback, and a status page.
- Beta programme, support email, a public changelog and versioning.

---

## Multi-language rules

These apply to all work from P1 on, including features built in English.

1. **No raw text in the UI.** Every string goes through `t('area.key')`, including `aria-label`s, toasts, confirm dialogs, CSV templates and validation errors. Lint enforces this.
2. **Whole sentences, with variables.** `t('bills.wentUp', { name, amount })`, never `name + ' went up by ' + amount`, because word order changes between languages.
3. **Plurals through ICU / i18next plural keys** (`_one`, `_other`, plus Arabic's `_zero`, `_two`, `_few`, `_many`). Never `n === 1 ? '' : 's'`.
4. **Formatting only through `useFormat()`:** money, dates, relative dates ("in 3 days"), percentages and numbers. No hand-made date strings.
5. **Logical CSS only:** `inline-start` / `inline-end`, never `left` / `right` for layout. Icons that point a direction get a `mirror-rtl` class.
6. **Data is language-neutral:** stored values are ids, ISO dates and pence. Only display text is translated. Names you type stay as typed.
7. **Leave room:** French text is typically 15–30% longer than English. Avoid fixed widths on text, and let buttons wrap or truncate with a tooltip.
8. **Test it:** the pseudo-locale and RTL pseudo-locale e2e runs must pass before merging.
