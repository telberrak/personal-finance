# Sync server

The sync API in [`server/`](../server) holds accounts, sessions, passkeys and **encrypted** records. It never sees readable financial data or keys: see [SECURITY.md](SECURITY.md). Sync is optional; the app works fully without it.

## Run it locally

```bash
npm run server:dev
```

- Listens on http://localhost:8787. The app (`npm run dev` or `npm run serve`) reaches it at `/api` through Vite's proxy.
- Data is kept in PGlite (Postgres compiled to WebAssembly) in `.ledger-api-data/`. Stop the server with Ctrl+C: PGlite cannot reopen a folder after the process is killed. If that happens, the server moves the folder aside (`.ledger-api-data.broken-…`) and starts with a fresh one; delete old folders when you no longer need them. Production uses Postgres, which recovers normally.
- Without an email provider, sign-in codes are printed in the server log. `--dev` also serves the last code at `/api/dev/last-code?email=…` (used by the e2e tests). Never use `--dev` in production.

## Configuration

| Variable                                                         | Meaning                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                           | Default 8787                                                                                                       |
| `DATABASE_URL`                                                   | Postgres connection string. Without it, PGlite in `LEDGER_DATA_DIR`                                                |
| `LEDGER_DATA_DIR`                                                | PGlite folder (default `.ledger-api-data`), or `memory`                                                            |
| `RP_ID`                                                          | The app's host name, for passkeys, e.g. `mizan.example.com`                                                        |
| `APP_ORIGINS`                                                    | Comma-separated origins the app is served from, e.g. `https://mizan.example.com`                                   |
| `RESEND_API_KEY`, `MAIL_FROM`                                    | Send sign-in codes with [Resend](https://resend.com). `MAIL_FROM` must be verified                                 |
| `LEDGER_ENV`                                                     | `production` or `staging`; reported by `/api/health`                                                               |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`         | Web Push keys (`npx web-push generate-vapid-keys`). Without them, keys are generated once and kept in the database |
| `GOCARDLESS_SECRET_ID`, `GOCARDLESS_SECRET_KEY`, `BANKS_SANDBOX` | Open Banking, see [OPEN_BANKING.md](OPEN_BANKING.md)                                                               |

Migrations run automatically at start-up ([`server/db.ts`](../server/db.ts)). Never edit a released migration: add a new one.

## Deploy (AWS EC2, London)

Production runs on one EC2 instance in eu-west-2 (London) that you manage, so data stays in the UK. One container ([`Dockerfile`](../Dockerfile)) builds the web app and runs the API, which also serves the app (`WEB_DIR=dist`, [`server/web.ts`](../server/web.ts)): app and API share one origin, so the Content-Security-Policy stays `connect-src 'self'` and no CORS is needed. On the instance, Docker Compose ([`deploy/ec2/compose.yml`](../deploy/ec2/compose.yml)) runs it with PostgreSQL and Caddy, which provides HTTPS for Mizan and any other sites on the same server.

GitHub Actions deploys every push to `main` once all checks pass, and rolls back if the new version is not healthy. Setup, costs, backups and restore: [DEPLOY.md](DEPLOY.md).

Rate limits use the first `X-Forwarded-For` address, which Caddy sets to the visitor's real address ([`server/client-ip.ts`](../server/client-ip.ts)). Behind any other proxy, make sure it does the same.

The container runs anywhere Docker does (another cloud, a VPS, a managed container service) with `DATABASE_URL` set (and `DATABASE_CA_CERT` for a managed database with its own certificate authority). To host only the web app on a static host instead, use [`netlify.toml`](../netlify.toml) or [`vercel.json`](../vercel.json) and forward `/api/*` to the API.

## Operations

- **Health and uptime:** `GET /api/health` returns `{ ok, version, environment }` after a database round trip. Docker checks it every 30 seconds and the deploy waits for it; point an external uptime monitor (e.g. UptimeRobot, Better Stack) at it too.
- **Logs:** the server logs the method, route and error message only. Never log request bodies, email addresses or tokens. Records are ciphertext anyway, but metadata still matters.
- **Error reporting:** to add Sentry, call `Sentry.init` in `server/main.ts` with `sendDefaultPii: false` and a `beforeSend` that drops request data. Do not add Sentry to the web app without updating the CSP and the privacy notice.
- **Releases:** bump `version` in `package.json`, add an entry to [CHANGELOG.md](../CHANGELOG.md), tag `vX.Y.Z`, deploy staging, then production.
- **Backups:** nightly dumps on the server (optionally copied to S3) and daily EBS snapshots; see DEPLOY.md. Backups contain only ciphertext and account metadata.
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
| `GET /api/banks/…`, `POST/DELETE /api/banks/links`       | Bank connections (P5)                                            |

Types are shared with the app in [`shared/api.ts`](../shared/api.ts).
