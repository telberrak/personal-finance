# Ledger — implementation plan

How to get from the current scaffold to the full app. Each phase ends with something usable, so you can stop after any phase and still have a working app.

Sizes are rough effort for one developer: **S** ≈ under a day, **M** ≈ 1–3 days, **L** ≈ a week or more.

---

## Where we are (v0.1 scaffold)

| Area           | State                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Stack          | React 19 + TypeScript, Vite, React Router, Dexie (IndexedDB), PWA plugin, Vitest                        |
| Screens        | Home, Activity, Bills, Budgets, Add transaction, Settings. Light and dark themes from the design canvas |
| Logic (tested) | Money in pence, dates, recurring schedules, bill-payment matching, safe-to-spend, budget progress       |
| Data           | Demo data seeded on first launch. Accounts, categories, budgets and bills can't be edited in the UI     |
| Missing        | Edit/delete, data management, import, reports, backups, git/CI                                          |

Design reference: the "Personal Finance App Design" canvas (light and dark boards).

---

## Phase 0 — Foundations

Do these before adding features, so every later change is safe to make.

| #    | Task                                                                                                                          | Size | Notes                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| 0.1  | `git init`, first commit, push to GitHub                                                                                      | S    |                                                                                           |
| 0.2  | CI: GitHub Actions runs `typecheck`, `test` and `build` on every push                                                         | S    |                                                                                           |
| 0.3  | ESLint (typescript-eslint, react-hooks, jsx-a11y) and Prettier                                                                | S    | jsx-a11y keeps the accessibility from the design                                          |
| 0.4  | Component tests: Testing Library + `fake-indexeddb`                                                                           | S    | So screens can be tested against a real Dexie DB                                          |
| 0.5  | End-to-end tests: Playwright at the 390×844 phone size, light and dark                                                        | M    | Smoke flows: add expense, see it in Activity, budget updates                              |
| 0.6  | Deploy previews over HTTPS (Netlify, Vercel or Cloudflare Pages)                                                              | S    | Needed to install the PWA on a real phone. Add an SPA fallback so `/bills` etc. resolve   |
| 0.7  | App icons: 180 px `apple-touch-icon` and 192/512 PNG plus a maskable icon                                                     | S    | iOS ignores SVG icons                                                                     |
| 0.8  | Error boundary with a "something went wrong" screen and the error logged                                                      | S    |                                                                                           |
| 0.9  | DB migration policy: from now on, schema changes only through new `db.version(n)` steps with `.upgrade()`                     | S    | v1 has never been released, so it can still change                                        |
| 0.10 | Shared UI pieces: `Sheet` (bottom sheet/modal), `Toast` (with Undo), `ConfirmDialog`, `FormField`, `MoneyInput`, `EmptyState` | M    | Every Phase 1 screen needs these                                                          |
| 0.11 | Write layer: `src/db/repo.ts` with typed functions (`addTransaction`, `updateRecurring`…)                                     | S    | Screens stop calling `db.*` directly, which makes rules, undo and validation easier later |

**Done when:** CI is green, the app is live on an HTTPS URL, and it installs on your phone.

---

## Phase 1 — Complete MVP: manage your own money

Goal: you can stop using the demo data and run your real finances in the app.

### 1.1 Onboarding — S/M

- On first launch, choose **Start fresh** or **Explore with demo data** instead of seeding automatically.
- Start fresh asks for your current account name and balance, your payday and your monthly savings, then offers to add your first bills.
- Replace `seedIfEmpty` with an `onboarded` flag in settings.

### 1.2 Edit and delete transactions — M

- Tap a transaction row to open `/transactions/:id`, which reuses the Add form (refactor it into a `TransactionForm`).
- Delete shows an Undo toast instead of a confirm box.
- Optional: swipe a row left to delete.

### 1.3 Accounts — M

- Settings → Accounts: add, rename, archive; each account has a type and an opening balance.
- Each account shows its own balance, and Activity can be filtered by account.
- **Transfers** between accounts: two linked transactions (`transferId`). They are excluded from spending and income totals.
- Safe to spend counts only current and cash accounts by default, with a per-account "include" toggle.

### 1.4 Categories — S/M

- Settings → Categories: add, rename, recolour (from the design palette), reorder, archive.
- Archiving moves the category's transactions to a category you pick; categories are never hard-deleted.

### 1.5 Bills and direct debits — M/L

- Add or edit a recurring payment: name, amount, frequency, first date, method (direct debit, standing order or card), account, category, optional end date.
- Changing the amount records `previousAmount` and `amountChangedOn`, which drive the price-rise alert. The alert can be dismissed.
- **Mark as paid** on an upcoming bill creates the linked transaction, prefilled.
- Overdue state: due date has passed, no payment matched and the 3-day window is over. Show it as a warning row and on Home.
- Pause or cancel a bill (cancelling keeps its history).

### 1.6 Budgets — S/M

- Budgets → Edit: set or clear a monthly limit per category, with inline editing on each row.
- A total limit for categories without their own budget is optional.

### Schema v2 (one migration for the whole phase)

```
Account      + archived?: boolean, includeInSafeToSpend: boolean
Category     + archived?: boolean
Transaction  + transferId?: string, createdAt: number, updatedAt: number
Recurring    + endDate?: ISODate, amountChangedOn?: ISODate, priceAlertDismissed?: boolean
Settings     + onboarded: boolean
```

**Done when:** a new user can set up accounts, bills and budgets, record a month of spending, and fix any mistake, without demo data.

---

## Phase 2 — Getting data in faster

Typing every payment by hand is the main reason people give up on finance apps, so this phase matters most for keeping you using it.

### 2.1 CSV statement import — L

- Import flow: pick a file, choose the bank (or map columns manually), preview, confirm.
- Presets for common UK bank exports (Monzo, Starling, Barclays, HSBC, Lloyds, Nationwide, Santander). Generic mapper: date column plus date format, amount (or separate in/out columns), description.
- **Duplicate detection:** fingerprint of account + date + amount + normalised payee. Rows that already exist are shown and skipped.
- Each import gets a batch id and can be undone in one tap.
- Parse in a Web Worker so large files don't freeze the screen.
- Unit-test every preset against sample files.

### 2.2 Payee clean-up — S

- Normalise raw descriptions (`TESCO STORES 3297 LONDON` → `Tesco`). Keep the original as `rawPayee`.
- A user-editable alias table: when you rename a payee once, future rows from that payee are renamed too.

### 2.3 Categorisation rules — M

- `Rule { match: contains | startsWith | regex on payee, optional amount range, categoryId, priority }`.
- Applied on import and on manual entry; the existing "remember last category per payee" stays as a fallback.
- When you change a transaction's category, offer: "Always categorise _Pret_ as Eating out?"

### 2.4 Bill matching and subscription detection — M

- Imported rows link to a bill automatically when the payee is similar, the amount is close and the date is within the window. Unclear cases go to a "Confirm match" list.
- Detection: the same payee paid at a monthly (or weekly/yearly) rhythm three or more times shows a "Add as bill?" suggestion.
- A matched payment with a new amount triggers the price-change alert automatically.

### Schema v3

```
Transaction  + rawPayee?: string, importBatchId?: string, fingerprint?: string (indexed)
Rule         new table
PayeeAlias   new table
ImportBatch  new table (id, accountId, fileName, importedAt, rowCount)
```

**Done when:** a month's bank statement goes in within two minutes with no duplicates, and most rows come in categorised and matched to bills.

---

## Phase 3 — Insight

### 3.1 Reports screen — M/L

- New tab or a section on Home (decide when it's built; the bottom bar holds five items at most).
- Charts: spending by category (donut and ranked list), spending over the last 6–12 months (bars), income vs expenses with savings rate, top payees.
- Tapping a chart segment opens the matching Activity view.
- Charts are hand-drawn SVG using the design tokens; no chart library needed at this size.

### 3.2 Pay-cycle budgets — M

- Option to run budgets from payday to the day before the next payday instead of by calendar month.
- Safe to spend already works on the pay cycle, so this makes both screens use the same period.
- Optional rollover of unspent (or overspent) budget into the next period.

### 3.3 Savings goals — M

- A goal has a target, a deadline and an amount saved so far; the app shows the monthly amount needed.
- Contributions are transfers to a savings account, or manual amounts.
- The single "monthly savings" setting becomes the sum of goal contributions.

### 3.4 Cash-flow forecast — M

- Projects your balance day by day to the next payday and beyond, from scheduled bills plus your average daily spend.
- Warns when the projected balance drops below a threshold you set.

**Done when:** you can answer "where did my money go?" and "will I make it to payday?" from the app.

---

## Phase 4 — Reliability, privacy, polish

| #   | Task                                                                                                                           | Size | Notes                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 | Backup and restore: export everything as JSON, import a JSON backup, export transactions as CSV                                | M    | Local-only data can be lost if browser storage is cleared. Remind the user every 30 days and call `navigator.storage.persist()`                              |
| 4.2 | Bill reminders                                                                                                                 | M    | Show due-soon items in the app. Real notifications need a push server (Phase 5), because PWAs can't schedule local notifications reliably, especially on iOS |
| 4.3 | App lock: PIN or passkey (WebAuthn) when the app opens                                                                         | M    | Optionally encrypt data at rest with a PIN-derived key (WebCrypto AES-GCM). Trade-off: forgetting the PIN means losing the data                              |
| 4.4 | Performance: replace "load everything" with range queries in `useFinanceData`, and virtualise long lists                       | M    | Do it when Activity gets slow; aim for 10,000+ transactions                                                                                                  |
| 4.5 | Accessibility pass: screen readers (VoiceOver, TalkBack), 200% text size, reduced motion, Lighthouse a11y 100                  | M    |                                                                                                                                                              |
| 4.6 | Polish: pull-to-refresh-free gestures, haptics where supported, offline banner, update-available toast from the service worker | S/M  |                                                                                                                                                              |

**Done when:** the app is safe to rely on as your only finance tracker.

---

## Phase 5 — Optional: sync and bank connections

These need a backend, accounts and ongoing running costs. Decide whether they're worth it after using Phases 1–4.

| #   | Task                                                         | Size | Notes                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | Multi-device sync                                            | L    | Options: Dexie Cloud (least code), or Supabase/Postgres with a sync layer. Consider end-to-end encryption, because this is financial data                                                                                                    |
| 5.2 | Open Banking (automatic transactions)                        | L    | Through an aggregator such as TrueLayer, Yapily or GoCardless Bank Account Data (check current availability, pricing and terms). Needs a server to hold API secrets and periodic consent renewal. Rows flow into the Phase 2 import pipeline |
| 5.3 | Push notifications for bill reminders and low-balance alerts | M    | Web Push through the backend from 5.1                                                                                                                                                                                                        |
| 5.4 | Native shell (Capacitor)                                     | M    | Only if you need App Store distribution, biometrics or more reliable notifications than the PWA gives                                                                                                                                        |

---

## Recommended order and milestones

1. **Phase 0** — tooling, deploy, installable on your phone.
2. **v0.2** — 1.1 onboarding, 1.2 edit/delete, 1.5 bills management. You can start using it for real.
3. **v0.3** — 1.3 accounts and transfers, 1.4 categories, 1.6 budgets editing.
4. **v0.4** — 2.1 CSV import, 2.2 payee clean-up, 4.1 backups (do backups before you have months of data).
5. **v0.5** — 2.3 rules, 2.4 bill matching and detection.
6. **v0.6** — 3.1 reports, 3.2 pay-cycle budgets.
7. **v0.7** — 3.3 goals, 3.4 forecast, rest of Phase 4.
8. **v1.0** — then decide on Phase 5.

## Working rules for every feature

- Calculations live in `src/lib` as pure, unit-tested functions; screens only display results.
- Writes go through `src/db/repo.ts`; schema changes go through Dexie version upgrades with a migration test.
- Every new screen is designed for 390 px first, uses only the tokens in `tokens.css`, and is checked in light and dark mode.
- Keep 44 px minimum touch targets, labelled inputs, real buttons and links, and 4.5:1 text contrast.
- Each feature ships with unit tests, and the main flow gets a Playwright test at phone size.
