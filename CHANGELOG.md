# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); each roadmap phase (see [docs/ROADMAP_PRO.md](docs/ROADMAP_PRO.md)) is a minor release until 1.0.

## 0.22.0 — Importing files with categories

- Import reads a Category column: names are matched to your categories (ignoring capitals and spaces), refunds stay in their spending category, and names Mizan does not have are listed.
- Rows in the Transfers category become transfers with an account you choose (for example card payments from your current account); undoing the import removes both sides.

## 0.21.0 — Accounts section

- Accounts is now a main section, just below Home (on a phone, the first shortcut on Home): every account with its value, grouped as Everyday, Savings and investments, and Debts, with subtotals and your net worth. Tapping an account opens Edit account. The old Settings → Accounts address redirects there.
- Fixed: accounts in the home currency with value updates (pensions, investments) showed only their opening balance and transactions on the accounts list; they now show their latest value, as on Net worth.
- The net worth at the top of Accounts now leaves out accounts you chose not to count.

## 0.20.2 — Ready for the app stores

- A step-by-step guide to releasing on the App Store and Google Play, and to updates: docs/MOBILE_RELEASE.md.
- iOS: the app now explains camera and photo access (taking a receipt photo would otherwise close the app, and Apple rejects that).
- Android: a proper status-bar icon for reminders (the one configured did not exist).
- `npm run native:sync` sets the native version and build number from package.json.

## 0.20.1 — Safe to spend in green

- On Home, "safe to spend" shows in green when it is above zero (readable on the dark card in both themes).

## 0.20.0 — Recurring transfers, and net worth choices

- Recurring transfers: money you move between your own accounts on a schedule (savings, a Junior ISA). Add one from Bills → + → Transfer. Each due transfer can be recorded automatically in both accounts, or marked done by hand; it never counts as spending, and "safe to spend" sets it aside only when it leaves your everyday accounts.
- Every due transfer is recorded exactly once, even with sync on several devices, and one you delete is not recorded again. Earlier due dates are not filled in.
- Accounts can be left out of net worth (for money you hold for someone else, such as a child's Junior ISA); they are listed apart on Net worth, where their value can still be updated.
- Help updated in English, French and Arabic.

## 0.19.0 — Settings in AWS Parameter Store

- Every server setting and secret lives in AWS Systems Manager Parameter Store under /mizan/ (encrypted, audited in CloudTrail, versioned). Each deploy writes the server's .env from it with mizan-config; nothing is edited on the server any more.
- mizan-config stops if MIZAN_DOMAIN or POSTGRES_PASSWORD is missing, or if POSTGRES_PASSWORD differs from the one the database uses (with a documented way to change it).
- A new "Apply settings" workflow re-applies changed settings without a release, and puts the previous ones back if Mizan is unhealthy.
- The support address and operator name are read from the server at runtime (GET /api/config), so they change without a rebuild. GitHub now holds only how to reach the server.
- A one-time script moves an existing server's settings into Parameter Store; an IAM policy grants the instance read-only access to /mizan/*.
- Fixed: the deploy pulled the new image before switching to its tag.

## 0.18.1 — Email through any SMTP server

- Email (sign-in codes and news) can now go through any SMTP server, such as Amazon SES, Brevo, Postmark or Mailgun, by setting SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD. Resend still works, and is used when SMTP_HOST is empty.
- Port 587 requires STARTTLS, so mail is never sent in clear text; SMTP errors are logged without email addresses.

## 0.18.0 — News by email

- Ask for news on the website, in Settings → News by email, or with a box when turning on sync. The box is never ticked for you.
- Addresses typed on the website or in the app are confirmed by an emailed link (double opt-in); a sync account's address is already proven by its sign-in code.
- Every email has a one-click unsubscribe link and the List-Unsubscribe headers mail apps use; the link opens a page with a button, so link scanners cannot unsubscribe anyone.
- The server records consent (where, when, the exact wording, the language) apart from sync accounts, mirrors confirmed subscribers to Resend for Broadcasts (RESEND_SEGMENT_ID), and can export them as CSV. Deleting the sync account deletes the subscription too.
- Privacy policy and Help updated in English, French and Arabic.

## 0.17.1 — Documentation

- One document for the whole project: docs/PROJECT.md (architecture, data model, security, sync, server, build, tests, CI/CD, deployment, operations, configuration).
- Code comments: every exported function, component and type, and every screen, now says what it is for.

## 0.17.0 — Help

- A Help section, right after Friends (in the sidebar on a computer, on Home on a phone): 26 topics explaining each feature step by step with examples, from accounts and bills to households, sync and security, in English, French and Arabic.
- Search across help (ignoring case and accents), topics that open on a tap, and direct links to a topic such as /help#bills.
- When the sign-in email cannot be sent, the app says so ("We could not send the email") instead of "Something went wrong", and the server logs the email provider's reason (such as an unverified domain).

## 0.16.1 — Bills you add no longer seem to disappear

- Bills → Upcoming lists everything due in the next 30 days, including early next month, not only the current month. A new bill due next month used to show only under All.
- Adding a bill says when it is next due ("Gym membership added. Next payment 2 Nov.").
- Activity shows bills coming up in the next 7 days, and overdue ones, above the transactions. They join the activity once paid, and never change its totals.

## 0.16.0 — Hosting on AWS EC2

- Production runs on a self-managed EC2 instance in London: Docker Compose with Caddy (automatic HTTPS for Mizan and any other sites), PostgreSQL and the Mizan container (`deploy/ec2`).
- One-time server setup script (Docker, automatic security updates, swap, key-only SSH, deploy user) and nightly database backups, optionally copied to S3.
- GitHub Actions starts the whole stack and checks it over HTTPS, publishes the image for ARM and x86, deploys over SSH and rolls back if the new version is unhealthy. Guide: docs/DEPLOY.md.
- Rate limits trust only the address set by the proxy; the DigitalOcean configuration is removed.

## 0.15.1 — Hosting on DigitalOcean

- Production moves to DigitalOcean App Platform in London: one container serves the web app and the API on the same origin, with the same security headers. Specs in `.do/`, guide and costs in docs/SERVER.md.
- Database connections verify the server's TLS certificate when `DATABASE_CA_CERT` is set.
- The Fly.io configs are removed.
- Deploys go through GitHub Actions: the production Docker image is built and checked against Postgres, and the app is deployed to DigitalOcean only after every check passes. First-deploy checklist in docs/DEPLOY.md.

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
