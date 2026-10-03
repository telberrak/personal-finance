# Ledger

A personal finance app for everyday money: daily spending, direct debits and bills, and monthly budgets.
It is a mobile-first progressive web app (PWA). It runs in any browser and can be installed on a phone's home screen.
All data stays on the device, in IndexedDB.

It has two layouts from one codebase, chosen by window width:

- **Phone and tablet (under 1024 px):** bottom tab bar, single column, lists.
- **Desktop (1024 px and wider):** a web page with a sidebar, multi-column dashboard, and tables for transactions and bills.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173. On first launch the app fills itself with demo data. Use **Settings → Erase all data** to start clean.

### On your phone

```bash
npm run dev:phone
```

Open the `Network:` URL it prints (for example `http://192.168.1.20:5173`) on a phone connected to the same Wi-Fi.
Phones only allow installing a PWA from HTTPS, so the dev server over plain HTTP is for trying the app out.
To install it on your home screen, deploy it (below), open the HTTPS URL on your phone, then use
_Share → Add to Home Screen_ (iOS) or _Install app_ (Android).

## Deploying

The app is static files, so any HTTPS host works. Config for two is included:

- **Netlify:** import the GitHub repo; `netlify.toml` sets the build, SPA fallback and caching headers.
- **Vercel:** import the GitHub repo; `vercel.json` does the same.

Every pull request then gets its own preview URL from the host.

## Scripts

| Script              | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`       | Development server with hot reload                                           |
| `npm run dev:phone` | Same, reachable from other devices on your network                           |
| `npm test`          | Unit and component tests (Vitest, jsdom, fake-indexeddb)                     |
| `npm run test:e2e`  | End-to-end tests at phone size, light and dark (Playwright)                  |
| `npm run lint`      | ESLint, including accessibility rules                                        |
| `npm run format`    | Format with Prettier                                                         |
| `npm run typecheck` | TypeScript check for the app and the Node-side config                        |
| `npm run build`     | Type-check and build the installable app into `dist/`                        |
| `npm run serve`     | Build and serve the production app on port 4173, reachable from your network |
| `npm run preview`   | Serve the production build locally                                           |
| `npm run check`     | Everything CI runs except e2e: lint, format, types, tests, build             |
| `npm run icons`     | Re-render the PNG app icons from `public/icon*.svg`                          |

End-to-end tests run at phone (390×844) and desktop (1440×900) sizes in light and dark, on port 4174. They use the installed Microsoft Edge locally, so no browser download is needed. CI installs Chromium.
GitHub Actions (`.github/workflows/ci.yml`) runs the checks and the end-to-end tests on every push and pull request.

## How it is organised

```
src/
  lib/          Pure logic, unit-tested: money (integer pence), dates, recurring schedules, selectors
  db/           Dexie (IndexedDB) schema and types, live-query hook, repo.ts (all writes), demo seed
  components/   Bottom navigation, icons, list rows, theme hook, error boundary
  components/ui Toast (with Undo), confirm dialog and sheet (native <dialog>), form fields, money input
  pages/        Home, Activity, Bills, Budgets, Add transaction, Settings
  styles/       tokens.css (light/dark design tokens), app.css (mobile-first components)
```

- **Money** is stored as integer pence (`-2340` = −£23.40): negative for money out, positive for money in.
- **Dates** are local calendar days (`YYYY-MM-DD`), so they never shift with time zones or clock changes.
- **Bills** are recurring rules (weekly, monthly or yearly). An occurrence counts as paid when a transaction linked to it (`recurringId`) lands within 3 days of the due date.
- **Safe to spend** = balance − unpaid bills due before the next payday − savings set aside.
- **Writes** go through `src/db/repo.ts`, which validates input. Screens never call `db.*` to write.
- **Schema changes** are added as new Dexie versions with an upgrade step; released versions are never edited.
- **Theme** follows the system by default. Settings can force light or dark, which sets `data-theme` on `<html>`.

## Features

- **Home:** safe to spend until payday, spending this month, upcoming bills, and alerts for overdue bills, a low forecast balance and backups.
- **Activity:** search, filters (spending, income, bills, transfers) and an account filter. Tap any transaction to edit or delete it (with Undo), or split it across several categories.
- **Add:** expenses, income and transfers between your accounts. The category is suggested from rules and your history.
- **Bills:** direct debits, standing orders and subscriptions. Add, edit, pause or delete them, mark them as paid, see price rises, and get suggestions for regular payments that aren't set up yet.
- **Budgets:** monthly or payday-to-payday budgets, optional carry-over, and an edit mode for limits.
- **Reports:** spending by category, six months of income against spending, top payees and a 45-day balance forecast.
- **Goals:** savings targets with deadlines and the monthly amount needed.
- **Import:** CSV statements (Monzo, Starling, Barclays, Lloyds/Halifax, Nationwide and NatWest are recognised automatically), with payee clean-up, duplicate detection, bill matching and one-tap undo.
- **Settings:**
  - accounts (with an "everyday" flag for safe to spend), categories, rules and payee names;
  - theme, payday, savings and the low-balance warning;
  - PIN lock;
  - backup, restore and CSV export.

## Roadmap

The full phased plan is in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). What comes next — the roadmap to a professional, multi-language (English, French, Arabic) app — is in [docs/ROADMAP_PRO.md](docs/ROADMAP_PRO.md). Phases 0 to 4 are built. Phase 5 (multi-device sync, Open Banking, push notifications) needs a backend and is optional.
