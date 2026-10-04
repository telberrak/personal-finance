# Deploying to DigitalOcean

A checklist for the first production deploy. Everything in the repository is ready; these steps need your accounts. About 30 minutes. Costs and architecture: [SERVER.md](SERVER.md#deploy-digitalocean-london).

How it works: every push to `main` runs the checks in GitHub Actions ([`ci.yml`](../.github/workflows/ci.yml)): lint, unit tests, end-to-end tests, and the production Docker image started against a real Postgres. Only if all pass, the `deploy` job applies [`.do/app.yaml`](../.do/app.yaml) to DigitalOcean (creating the app the first time) and waits until it is live.

## 1. DigitalOcean account and database

1. Create an account at [digitalocean.com](https://www.digitalocean.com) and add a payment method.
2. **Databases → Create database cluster:** PostgreSQL (latest version), datacenter **London (LON1)**, Basic, 1 GB RAM / 10 GB disk ($15.15 a month), name **`mizan-db`**.
3. When it is ready, open **Users & Databases** and add a user **`mizan`** and a database **`mizan`**. (Other projects get their own user and database in the same cluster.)

## 2. Connect GitHub

1. In DigitalOcean, **Apps → Create App → GitHub**, and install the DigitalOcean GitHub app with access to `telberrak/personal-finance`. Then leave the wizard: GitHub Actions creates the app.
2. **API → Tokens → Generate new token**, named `github-deploy`, with read and write scope. Copy it.

## 3. Email for sign-in codes

1. Create an account at [resend.com](https://resend.com) and verify the domain you send from (DNS records it shows you).
2. Create an API key with sending access.

## 4. GitHub settings

In the repository: **Settings → Secrets and variables → Actions**.

| Kind     | Name                        | Value                                                             |
| -------- | --------------------------- | ----------------------------------------------------------------- |
| Secret   | `DIGITALOCEAN_ACCESS_TOKEN` | The token from step 2                                             |
| Secret   | `RESEND_API_KEY`            | The key from step 3                                               |
| Variable | `MAIL_FROM`                 | A sender on the verified domain, e.g. `Mizan <login@your.domain>` |
| Variable | `SUPPORT_EMAIL`             | Shown in help, privacy policy and terms                           |
| Variable | `OPERATOR_NAME`             | Your name or company, as it should appear in the legal texts      |
| Variable | `DO_DEPLOY`                 | `true`: turns the deploy job on                                   |

## 5. First deploy

Push to `main`, or re-run the latest CI run (**Actions → CI → Re-run all jobs**). The `deploy` job prints the build and deploy logs and the live address (`https://mizan-xxxxx.ondigitalocean.app`). Check `<address>/api/health` shows `"ok":true`, then open the app and sign in to sync.

## 6. Your domain

Passkeys are tied to the domain, so set it before inviting people.

1. Add the domain to [`.do/app.yaml`](../.do/app.yaml) (ask Claude, or uncomment the `domains` block) and push. DigitalOcean shows the DNS record to create (a CNAME to the app).
2. Once the certificate is issued, the app is served on the domain. `RP_ID` and `APP_ORIGINS` follow it automatically.

Do not add the domain only in the DigitalOcean dashboard: each deploy applies `.do/app.yaml` and would remove it.

## Afterwards

- **Uptime:** point a free monitor (UptimeRobot, Better Stack) at `/api/health`. DigitalOcean emails you about failed deploys and high CPU or memory.
- **Backups:** the managed database keeps daily backups with point-in-time recovery for 7 days.
- **Staging (optional, $12 a month):** create a `staging` branch and an app from [`.do/app.staging.yaml`](../.do/app.staging.yaml) (Apps → Create → from app spec). Pushes to `staging` deploy there.
- **Native apps:** set `VITE_API_ORIGIN` to the live address when building them (see [NATIVE.md](NATIVE.md)).
