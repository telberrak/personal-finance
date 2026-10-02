# Ledger

A personal finance app for everyday money: daily spending, direct debits and bills, and monthly budgets.
It is a mobile-first progressive web app (PWA). It runs in any browser and can be installed on a phone's home screen.
All data stays on the device, in IndexedDB.

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
To install it on your home screen, deploy `dist/` to any HTTPS static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages).
Then use *Share → Add to Home Screen* (iOS) or *Install app* (Android).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run dev:phone` | Same, reachable from other devices on your network |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type-check and build the installable app into `dist/` |
| `npm run preview` | Serve the production build locally |

## How it is organised

```
src/
  lib/          Pure logic, unit-tested: money (integer pence), dates, recurring schedules, selectors
  db/           Dexie (IndexedDB) schema, types, live-query hook, demo seed
  components/   Bottom navigation, icons, list rows, theme hook
  pages/        Home, Activity, Bills, Budgets, Add transaction, Settings
  styles/       tokens.css (light/dark design tokens), app.css (mobile-first components)
```

- **Money** is stored as integer pence (`-2340` = −£23.40): negative for money out, positive for money in.
- **Dates** are local calendar days (`YYYY-MM-DD`), so they never shift with time zones or clock changes.
- **Bills** are recurring rules (weekly, monthly or yearly). An occurrence counts as paid when a transaction linked to it (`recurringId`) lands within 3 days of the due date.
- **Safe to spend** = balance − unpaid bills due before the next payday − savings set aside.
- **Theme** follows the system by default. Settings can force light or dark, which sets `data-theme` on `<html>`.

## Roadmap

The full phased plan is in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Highlights:

- [ ] Manage accounts, categories, budgets and recurring payments in the UI (seeded only for now)
- [ ] Edit and delete transactions
- [ ] CSV statement import with auto-categorisation rules
- [ ] Match imported payments to bills automatically and detect new subscriptions
- [ ] Bill reminders (notifications)
- [ ] Reports: spending by category and over time
- [ ] Savings goals
- [ ] Export and backup (JSON/CSV)
- [ ] Open Banking sync (TrueLayer / GoCardless) — needs a backend
