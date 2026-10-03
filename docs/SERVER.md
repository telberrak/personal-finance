# Sync server

The sync API in [`server/`](../server) holds accounts, sessions, passkeys and **encrypted** records. It never sees readable financial data or keys: see [SECURITY.md](SECURITY.md). Sync is optional; the app works fully without it.

## Run it locally

```bash
npm run server:dev
```

- Listens on http://localhost:8787. The app (`npm run dev` or `npm run serve`) reaches it at `/api` through Vite's proxy.
- Data is kept in PGlite (Postgres compiled to WebAssembly) in `.ledger-api-data/`. Stop the server with Ctrl+C: PGlite cannot recover a folder after the process is killed. If that happens, delete the folder.
- Without an email provider, sign-in codes are printed in the server log. `--dev` also serves the last code at `/api/dev/last-code?email=…` (used by the e2e tests). Never use `--dev` in production.

## Configuration

| Variable                                                 | Meaning                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                   | Default 8787                                                                                                       |
| `DATABASE_URL`                                           | Postgres connection string. Without it, PGlite in `LEDGER_DATA_DIR`                                                |
| `LEDGER_DATA_DIR`                                        | PGlite folder (default `.ledger-api-data`), or `memory`                                                            |
| `RP_ID`                                                  | The app's host name, for passkeys, e.g. `ledger.example.com`                                                       |
| `APP_ORIGINS`                                            | Comma-separated origins the app is served from, e.g. `https://ledger.example.com`                                  |
| `RESEND_API_KEY`, `MAIL_FROM`                            | Send sign-in codes with [Resend](https://resend.com). `MAIL_FROM` must be verified                                 |
| `LEDGER_ENV`                                             | `production` or `staging`; reported by `/api/health`                                                               |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push keys (`npx web-push generate-vapid-keys`). Without them, keys are generated once and kept in the database |

Migrations run automatically at start-up ([`server/db.ts`](../server/db.ts)). Never edit a released migration: add a new one.

## Deploy (Fly.io, London)

Two environments are configured: [`fly.production.toml`](../fly.production.toml) and [`fly.staging.toml`](../fly.staging.toml). Both run the [`Dockerfile`](../Dockerfile) in the `lhr` region so data stays in the UK.

1. Create the apps and a Postgres database (Fly Postgres, Neon or Supabase in London), then set secrets:

   ```bash
   fly apps create ledger-api
   fly secrets set -c fly.production.toml DATABASE_URL=postgres://… RP_ID=ledger.example.com APP_ORIGINS=https://ledger.example.com RESEND_API_KEY=… MAIL_FROM="Ledger <login@ledger.example.com>"
   ```

2. Deploy: `fly deploy -c fly.staging.toml`, check it, then `fly deploy -c fly.production.toml`.
3. Point the app at it. The app calls `/api` on its own origin, so the host must forward `/api/*` to the API:
   - **Netlify:** uncomment the `/api/*` redirect in [`netlify.toml`](../netlify.toml) and set the API host.
   - **Vercel:** add a rewrite before the single-page one: `{ "source": "/api/(.*)", "destination": "https://ledger-api.fly.dev/api/$1" }`.

   Serving the API from the same origin keeps the Content-Security-Policy at `connect-src 'self'` and avoids CORS.

## Operations

- **Health and uptime:** `GET /api/health` returns `{ ok, version, environment }` after a database round trip. Fly checks it every 30 seconds; point an external uptime monitor (e.g. UptimeRobot, Better Stack) at it too.
- **Logs:** the server logs the method, route and error message only. Never log request bodies, email addresses or tokens. Records are ciphertext anyway, but metadata still matters.
- **Error reporting:** to add Sentry, call `Sentry.init` in `server/main.ts` with `sendDefaultPii: false` and a `beforeSend` that drops request data. Do not add Sentry to the web app without updating the CSP and the privacy notice.
- **Releases:** bump `version` in `package.json`, add an entry to [CHANGELOG.md](../CHANGELOG.md), tag `vX.Y.Z`, deploy staging, then production.
- **Backups:** use the database provider's point-in-time recovery. Backups contain only ciphertext and account metadata.
- **Account deletion:** `DELETE /api/account` removes the user, sessions, passkeys, vault and records (`ON DELETE CASCADE`).

## API

| Method and path                                          | Purpose                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /api/auth/email/start`, `/verify`                  | Sign in with a 6-digit emailed code (10 minutes, 5 tries)        |
| `POST /api/auth/passkey/options`, `/verify`              | Sign in with a passkey                                           |
| `POST /api/passkeys/options`, `POST /api/passkeys`       | Add a sign-in passkey (signed in)                                |
| `GET /api/me`                                            | Account, devices, passkeys, whether a vault exists               |
| `DELETE /api/devices/:id`, `POST /api/auth/logout`       | Sign a device out                                                |
| `GET/PUT /api/vault`                                     | The sync key, encrypted with the recovery key                    |
| `POST /api/sync/push`, `GET /api/sync/pull?since=N`      | Encrypted records, ordered by a per-account sequence number      |
| `DELETE /api/account`                                    | Delete everything                                                |
| `GET /api/push/key`, `PUT/DELETE /api/push/subscription` | Web Push for this device                                         |
| `PUT /api/push/reminders`                                | Replace this device's upcoming reminders (time and generic text) |

Types are shared with the app in [`shared/api.ts`](../shared/api.ts).
