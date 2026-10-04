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

## Deploy (DigitalOcean, London)

Production runs on [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform) in London (`lon`), so data stays in the UK. One container ([`Dockerfile`](../Dockerfile)) builds the web app and runs the API, which also serves the app (`WEB_DIR=dist`, [`server/web.ts`](../server/web.ts)). App and API share one origin, so the Content-Security-Policy stays `connect-src 'self'` and no CORS is needed. The specs are in [`.do/app.yaml`](../.do/app.yaml) (production) and [`.do/app.staging.yaml`](../.do/app.staging.yaml) (optional staging).

### Costs (checked October 2026; see digitalocean.com/pricing)

| Item                                | Plan                            | Per month     |
| ----------------------------------- | ------------------------------- | ------------- |
| App (web app and API)               | Shared 1 vCPU, 512 MB           | $5            |
| Database                            | Managed PostgreSQL, 1 GB, 10 GB | $15.15        |
| **Production total**                |                                 | **about $20** |
| Staging (optional)                  | $5 container + $7 dev database  | $12           |
| Static sites (e.g. a personal site) | First 3 free, then $3 each      | $0            |

The database cluster can hold databases for other projects too, at no extra cost until it needs a bigger plan. Upgrade the app to `apps-s-1vcpu-1gb-fixed` ($10) if memory alerts fire.

### One-time setup

1. In the DigitalOcean dashboard, create a **PostgreSQL** database cluster named `mizan-db` in **London (LON1)**, Basic plan, 1 GB ($15.15).
2. Install [`doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/), run `doctl auth init`, and give DigitalOcean access to the GitHub repository (Apps → Create → GitHub). Then:

   ```bash
   doctl apps create --spec .do/app.yaml
   ```

3. In the app's settings, set the encrypted variables: `RESEND_API_KEY`, `MAIL_FROM` (a verified sender, e.g. `Mizan <login@mizan.app>`), and optionally `VAPID_*` (`npx web-push generate-vapid-keys`; otherwise keys are created once and kept in the database), `VITE_SUPPORT_EMAIL` and `VITE_OPERATOR_NAME`.
4. Add your domain under Settings → Domains. `RP_ID` and `APP_ORIGINS` follow the app's primary domain automatically (`${APP_DOMAIN}`, `${APP_URL}`). Passkeys are tied to the domain, so choose it before inviting users.
5. Every push to `main` now deploys. Check `https://<domain>/api/health`.

Staging: create a `staging` branch, then `doctl apps create --spec .do/app.staging.yaml`. Push to `staging` to test, then merge into `main`.

The database connection is TLS, verified against the cluster's CA certificate (`DATABASE_CA_CERT`, bound from `${db.CA_CERT}`). Rate limits use the client address from DigitalOcean's `do-connecting-ip` header.

### Other hosts

The container runs anywhere Docker does (Render, Fly.io, a VPS) with `DATABASE_URL` set. To host only the web app on a static host instead, use [`netlify.toml`](../netlify.toml) or [`vercel.json`](../vercel.json) and forward `/api/*` to the API.

## Operations

- **Health and uptime:** `GET /api/health` returns `{ ok, version, environment }` after a database round trip. App Platform checks it every 30 seconds; point an external uptime monitor (e.g. UptimeRobot, Better Stack) at it too.
- **Logs:** the server logs the method, route and error message only. Never log request bodies, email addresses or tokens. Records are ciphertext anyway, but metadata still matters.
- **Error reporting:** to add Sentry, call `Sentry.init` in `server/main.ts` with `sendDefaultPii: false` and a `beforeSend` that drops request data. Do not add Sentry to the web app without updating the CSP and the privacy notice.
- **Releases:** bump `version` in `package.json`, add an entry to [CHANGELOG.md](../CHANGELOG.md), tag `vX.Y.Z`, deploy staging, then production.
- **Backups:** DigitalOcean managed databases keep daily backups with point-in-time recovery (7 days). Backups contain only ciphertext and account metadata.
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
