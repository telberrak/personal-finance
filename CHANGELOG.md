# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); each roadmap phase (see [docs/ROADMAP_PRO.md](docs/ROADMAP_PRO.md)) is a minor release until 1.0.

## 0.15.1 — Hosting on DigitalOcean

- Production moves to DigitalOcean App Platform in London: one container serves the web app and the API on the same origin, with the same security headers. Specs in `.do/`, guide and costs in docs/SERVER.md.
- Database connections verify the server's TLS certificate when `DATABASE_CA_CERT` is set.
- The Fly.io configs are removed.

## 0.15.0 — P14: shared budgets and categories

- Household budgets: a tab per household on Budgets, shared with its members and counting only spending on shared accounts, with alerts at 80% and 100%.
- Custom categories used on shared transactions, bills and budgets are now shared with the household, so nobody sees "uncategorised" for them.

## 0.14.1 — Renamed to Mizan

- The app is now called **Mizan** (ميزان, "balance") in every language, on the website, in emails and in the native apps (new app id `app.mizan.money`).
- Full name for stores, the install prompt and the website: "Mizan: Safe to Spend" ("Mizan : reste à vivre", "Mizan: المتاح للإنفاق"), to stand apart from other apps called Mizan.
- Existing data, backups and synced vaults keep working: internal identifiers are unchanged.

## 0.14.0 — P13: launch readiness

- Help, privacy policy and terms in English, French and Arabic (legal texts are drafts for review).
- About page: version, sync service status, what's new, feedback form, and opt-in, cookie-free anonymous usage counts.
- A short first-run tour after setting up your own account.
- Static marketing site (`site/`) in three languages; launch guide (docs/LAUNCH.md), including the name and trademark question.

## 0.13.0 — P12: French, Arabic and multi-currency

- French and Arabic translations of every screen (first drafts for native-speaker review), with all Arabic plural forms; right-to-left layout; Latin or Arabic-Indic digits; first day of the week per language or chosen.
- Multi-currency: a currency per account, converted to your home currency for totals, budgets, reports and net worth; exchange rates from the European Central Bank (daily, via the sync server) or typed in; transfers between currencies; purchases paid in another currency.
- CSV import presets for BoursoBank, BNP Paribas, Société Générale, Crédit Agricole, Crédit Mutuel/CIC, La Banque Postale and Revolut; French column names recognised.
- Fixes: amounts keep their order inside Arabic text (left-to-right isolates); the low-balance alert showed its key instead of text.

## 0.12.0 — P11: shared finances

- Households: share chosen accounts (with their transactions and bills) with a partner through a one-use invite link; everything else stays private. End-to-end encrypted with a household key that travels only in the link's #fragment.
- Splitting with friends: friends with payment links, split an expense equally, balances, request money (Monzo.me, PayPal.me), copy a reminder, settle up.
- Sync engine: one stream per household alongside your own; a household can only change its own shared records.

## 0.11.0 — P10: native apps

- iOS and Android projects (Capacitor) around the same app; `npm run native:sync`.
- Face ID / fingerprint unlock with the data key in the system keychain (this device only).
- Reminders scheduled as local notifications on the device; notification taps open the right screen; Android back button.
- Share photos and PDFs from other apps into a new expense (installed web app).
- Sync API: CORS for the native apps' origins; `VITE_API_ORIGIN` for native builds. Guide: docs/NATIVE.md.

## 0.10.0 — P9: receipts and attachments

- Attach photos and PDFs to transactions; photos are resized and compressed on the device, stored encrypted and synced end-to-end encrypted.
- Read a receipt on the device (Tesseract, served by the app itself): fills in the amount, date and shop.
- Return-by and warranty dates on purchases, with reminders.
- Security: the CSP now allows `'wasm-unsafe-eval'` (WebAssembly only, not JavaScript eval).

## 0.9.0 — P8: cash-flow calendar and deeper reports

- Calendar: a month grid with bills, paydays and each day's balance (forecast ahead, up to three months), with day details.
- Reports: custom date ranges, comparison with the previous period, 12-month category trends with monthly averages.
- Year in review, printable or saved as PDF.
- Tax helper: mark transactions under UK self-assessment or French headings; totals per tax year (6 April in the UK), CSV export. Organises records; not tax advice.

## 0.8.0 — P7: smarter categorisation, tags and search

- Merchant directory of 130+ common UK merchants: clean names on import, likely categories, brand-coloured tiles.
- Categories learned on the device from your own history (naive Bayes over payee words) when no rule or exact match applies.
- Tags on transactions, shown in Activity and searchable.
- Search page: text, dates, amounts, account, category, tag and direction; saved searches; select many to recategorise, tag, untag or delete (with undo).
- Fix: filtered updates (rename payee, apply a rule to past transactions, bulk edit) silently changed nothing in real browsers since 0.3.0, because the encryption layer's cursor wrapper broke native cursor getters.

## 0.7.0 — P6: debts, credit cards and net worth

- New account types: loan, mortgage, investments, pension and property. Credit cards record limit, statement and due days, minimum payment and APR; loans and mortgages their APR and monthly payment.
- Net worth page: total, assets and debts, a 12-month chart, payoff dates, and dated valuations for investments, pensions and property.
- Debt payoff planner: avalanche or snowball, debt-free date, total interest, and what paying extra saves.
- "Pay in full" reminder three days before a card payment is due.

## 0.6.0 — P5: Open Banking

- Connect a bank (read-only) through an authorised provider; transactions come in automatically every few hours through the usual import pipeline, never twice.
- Map bank accounts to Mizan accounts, match the bank's balance, reconnect reminders before consent expires.
- Server: provider interface with GoCardless Bank Account Data and a sandbox bank. Transactions are never stored on the server.

## 0.5.0 — P4: notifications and reminders

- Alerts for bills due tomorrow, payday, budgets at 80% and 100%, a low forecast balance, unusual payments, free trials ending and yearly renewals.
- Notification centre (bell on Home), system notifications while open, and Web Push while closed for people who sync. Pushed reminders carry a time and generic text only.
- Per-type switches and quiet hours, per device. Bills can record when a free trial ends.

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
