# Deploying to AWS EC2

Mizan runs on one EC2 instance in London that you manage: Caddy (HTTPS for all your domains), PostgreSQL, and the Mizan container, started with Docker Compose ([`deploy/ec2`](../deploy/ec2)). The same instance can host your other sites and projects.

How deploys work: every push to `main` runs the checks in GitHub Actions ([`ci.yml`](../.github/workflows/ci.yml)): lint, unit tests, end-to-end tests, and the whole server stack (Caddy, PostgreSQL, Mizan) started and checked over HTTPS. Only if all pass, the image is built for ARM and x86 and published to GitHub's container registry, and the `deploy` job connects over SSH, starts the new version and waits until it is healthy. If it is not, the previous version is started again.

## Costs (London, checked October 2026)

| Item                                         | Per month        |
| -------------------------------------------- | ---------------- |
| t4g.small (2 vCPU Graviton, 2 GB), on demand | about $13.70     |
| 30 GB gp3 disk                               | about $2.80      |
| Public IPv4 (Elastic IP)                     | about $3.65      |
| Daily snapshots, 7 kept (incremental)        | about $1–2       |
| **Total**                                    | **about $21–22** |

A one-year Compute Savings Plan or reserved instance takes roughly 30–40% off the instance. Data out: 100 GB a month free across your account, then about $0.09/GB.

## 1. Launch the instance

EC2 → Launch instance, region **eu-west-2 (London)**:

| Setting          | Value                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AMI              | **Ubuntu Server, latest LTS, 64-bit (Arm)**                                                                                                                                           |
| Instance type    | **t4g.small**                                                                                                                                                                         |
| Key pair         | Your own (for you to log in)                                                                                                                                                          |
| Security group   | `mizan-web`: TCP **22** from anywhere (GitHub deploys come from changing addresses; password login is disabled), TCP **80** and **443** and UDP **443** from anywhere (IPv4 and IPv6) |
| Storage          | **30 GB gp3**, encrypted                                                                                                                                                              |
| Advanced details | Metadata: **IMDSv2 only**; **termination protection** on; optionally an IAM instance profile for S3 backups (section 6)                                                               |

Then:

1. **Elastic IP:** allocate one and associate it with the instance, so the address survives stops and replacements.
2. **Snapshots:** EC2 → Lifecycle Manager → create an EBS snapshot policy for the instance's volume: daily, keep 7.

## 2. Set up the server

From the repository on your PC (replace the IP):

```bash
scp -r deploy/ec2 ubuntu@203.0.113.10:
```

```bash
ssh ubuntu@203.0.113.10 'sudo bash ec2/setup.sh'
```

[`setup.sh`](../deploy/ec2/setup.sh) installs Docker, the AWS CLI, automatic security updates (with a reboot at 04:00 UTC when needed), a 2 GB swap file, key-only SSH, a `deploy` user for GitHub Actions, `/srv/mizan`, `mizan-config`, and nightly database backups. It is safe to run again.

## 3. Settings: AWS Parameter Store

Every setting and secret lives in **AWS Systems Manager Parameter Store**, under `/mizan/`, as a SecureString (encrypted with KMS): `/mizan/RESEND_API_KEY` becomes the setting `RESEND_API_KEY`. Nothing is edited on the server: each deploy runs [`config.sh`](../deploy/ec2/config.sh) (`mizan-config`), which reads `/mizan/*` with the instance's IAM role and writes `/srv/mizan/.env` (readable only by `deploy`). Every read and change is logged in CloudTrail, and Parameter Store keeps each value's history.

### Give the instance read access

1. IAM → Policies → Create policy → JSON: paste [`iam-policy.json`](../deploy/ec2/iam-policy.json) (read `/mizan/*` and decrypt it through SSM only). Name it `mizan-read-settings`.
2. IAM → Roles → Create role → AWS service, **EC2** → attach `mizan-read-settings` → name it `mizan-server`.
3. EC2 → the instance → Actions → Security → **Modify IAM role** → `mizan-server`.

For S3 backups, add `s3:PutObject` on your backup bucket to the same role.

### The settings

| Parameter (under `/mizan/`)                                           | Required  | Meaning                                                                  |
| --------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| `MIZAN_DOMAIN`                                                        | yes       | The app's domain, e.g. `mizan.example.com`                               |
| `POSTGRES_PASSWORD`                                                   | yes       | The database password. Never change it here alone (see below)            |
| `MAIL_FROM`                                                           | for email | A sender on your verified domain, e.g. `Mizan <mizan@mail.example.com>`  |
| `RESEND_API_KEY`                                                      | for email | Resend's API key (used when `SMTP_HOST` is not set; also for Broadcasts) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | for email | Any SMTP server instead of Resend (see below)                            |
| `RESEND_SEGMENT_ID`                                                   | no        | The Resend segment news subscribers join                                 |
| `SUPPORT_EMAIL`, `OPERATOR_NAME`                                      | no        | Shown in the app's help and legal pages                                  |
| `BACKUP_S3_BUCKET`                                                    | no        | Copy nightly backups to this S3 bucket                                   |
| `GOCARDLESS_SECRET_ID`, `GOCARDLESS_SECRET_KEY`                       | no        | Open Banking                                                             |

Add or change one (from your PC, AWS CLI signed in, or in the console under Systems Manager → Parameter Store):

```bash
aws ssm put-parameter --region eu-west-2 --type SecureString --overwrite --name /mizan/SUPPORT_EMAIL --value "help@example.com"
```

Then apply it: GitHub → **Actions → Apply settings → Run workflow** (or the next deploy). It rewrites `.env` from Parameter Store and restarts Mizan with the same version; if Mizan is unhealthy with the new settings, the previous ones are put back.

`mizan-config` stops without changing anything if `MIZAN_DOMAIN` or `POSTGRES_PASSWORD` is missing, or if `POSTGRES_PASSWORD` differs from the one in use. While you move to Parameter Store, a server that already has a `.env` keeps it (with a warning in the GitHub run) until the instance has its role and `/mizan/` has settings; from then on, Parameter Store wins.

### Moving an existing server's settings

Once, from the repository on your PC (AWS CLI signed in to the account, region eu-west-2):

```bash
ssh -i mizan.pem ubuntu@203.0.113.10 "sudo cat /srv/mizan/.env" | bash deploy/ec2/import-env.sh
```

It stores every non-empty setting (including the generated `POSTGRES_PASSWORD`) as `/mizan/<NAME>` and prints the names, never the values. Then add `SUPPORT_EMAIL` and `OPERATOR_NAME` if you had them in GitHub, and remove the old GitHub variables (`MIZAN_DOMAIN`, `SUPPORT_EMAIL`, `OPERATOR_NAME`).

### Email providers

Mizan sends email through **any SMTP server** or through **Resend's API**. Verify your sending domain with the provider first (it shows DNS records to add). The log shows which one is used: `docker compose logs mizan | grep "sending with"`.

- **Resend:** set `RESEND_API_KEY` and `MAIL_FROM`.
- **SMTP** (used instead of Resend when `SMTP_HOST` is set): `SMTP_HOST`, `SMTP_PORT` (`587` with STARTTLS, the default and required, or `465` with TLS; `SMTP_SECURE=true` forces TLS), `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM`.
  - **Amazon SES (London):** `email-smtp.eu-west-2.amazonaws.com`, port 587, SMTP credentials from SES → SMTP settings (not your AWS access keys). New SES accounts start in the sandbox: request production access before inviting people.
  - **Brevo:** `smtp-relay.brevo.com`, port 587, your Brevo login and SMTP key.
  - **Postmark:** `smtp.postmarkapp.com`, port 587, the server API token as both user and password.
  - **Mailgun (EU):** `smtp.eu.mailgun.org`, port 587, the domain's SMTP login and password.

Check each provider's current settings page: these are the usual values.

### Changing the database password

PostgreSQL keeps the password it was created with, so change it inside the database first, then in Parameter Store, then apply:

```bash
ssh -i mizan.pem ubuntu@203.0.113.10 "cd /srv/mizan && sudo -u deploy docker compose exec -T postgres psql -U mizan -d mizan -c \"ALTER USER mizan PASSWORD 'the-new-password'\""
```

```bash
aws ssm put-parameter --region eu-west-2 --type SecureString --overwrite --name /mizan/POSTGRES_PASSWORD --value "the-new-password"
```

Then on the server run `cd /srv/mizan && MIZAN_ALLOW_PASSWORD_CHANGE=1 bash ./config.sh && docker compose up -d` (the one time `mizan-config` accepts a different password). Use a long random value, e.g. `openssl rand -hex 24`.

## 4. Let GitHub deploy

1. Create a key just for deploys, on your PC:

   ```bash
   ssh-keygen -t ed25519 -N "" -C github-deploy -f mizan-deploy
   ```

2. Add `mizan-deploy.pub` to the server's `/home/deploy/.ssh/authorized_keys`.
3. Record the server's host key, so GitHub can check it is talking to your server:

   ```bash
   ssh-keyscan -t ed25519 203.0.113.10
   ```

4. In GitHub: **Settings → Secrets and variables → Actions**.

| Kind     | Name              | Value                                            |
| -------- | ----------------- | ------------------------------------------------ |
| Secret   | `EC2_HOST`        | The Elastic IP                                   |
| Secret   | `EC2_SSH_KEY`     | The contents of `mizan-deploy` (the private key) |
| Secret   | `EC2_KNOWN_HOSTS` | The `ssh-keyscan` output                         |
| Variable | `EC2_DEPLOY`      | `true`: turns the deploy job on                  |

Then delete `mizan-deploy` from your PC (keep it only in GitHub).

## 5. Domain and first deploy

1. At your DNS provider, add an **A record** for the domain pointing at the Elastic IP (and an **AAAA** record if the instance has IPv6).
2. Push to `main`, or re-run the latest CI run. When the deploy job finishes, open `https://<domain>`: Caddy has fetched the HTTPS certificate.

Passkeys are tied to the domain, so choose Mizan's final domain before inviting people.

## News by email

People can ask for news on the website, in **Settings → News by email**, or when turning on sync (always opt-in). The server keeps them in the `subscribers` table with their consent (where, when, the wording, the language), confirms new addresses by email (double opt-in), and adds one-click unsubscribe links and headers. See [`server/subscribers.ts`](../server/subscribers.ts).

To send news:

- **Resend Broadcasts (recommended):** in Resend, create a segment (Audience → Segments), store its id as `/mizan/RESEND_SEGMENT_ID` in Parameter Store, and run **Apply settings**. Confirmed subscribers are added as contacts in that segment, and unsubscribes are mirrored. Write and send Broadcasts to the segment from the Resend dashboard; Resend adds its own unsubscribe link to each one.
- **Any other tool:** export a CSV of confirmed subscribers with their consent record, then delete the file once imported:

  ```bash
  cd /srv/mizan && docker compose exec -T mizan node server/export-subscribers.ts > subscribers.csv
  ```

People who unsubscribe through a Resend Broadcast are unsubscribed in Resend; keep using Broadcasts (or re-export) so they are never emailed again.

## Other sites and domains

Each site is one file in `/srv/mizan/sites.d` (see the `README.caddy` there) with its files in `/srv/mizan/sites/<name>`, plus DNS records pointing at the Elastic IP. Reload Caddy afterwards:

```bash
cd /srv/mizan && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Projects with their own server can join the same Compose network and PostgreSQL (one database and user each).

## 6. Backups and restore

- **Every night (03:30 UTC):** a compressed dump of every database in `/var/backups/mizan`, kept 14 days. Log: `/var/log/mizan-backup.log`.
- **Off the server (recommended):** create a private S3 bucket in eu-west-2 (block public access on, default encryption on, a lifecycle rule deleting objects after 30 days), allow `s3:PutObject` on it in the instance role (`mizan-server`), and store the bucket name as `/mizan/BACKUP_S3_BUCKET`.
- **Daily EBS snapshots** (section 1) cover the whole disk.

Restore a dump. This replaces Mizan's current data, so stop the app first:

```bash
cd /srv/mizan
docker compose stop mizan
docker compose exec -T postgres psql -U mizan -d postgres -c 'DROP DATABASE mizan'
gunzip -c /var/backups/mizan/postgres-<date>.sql.gz | docker compose exec -T postgres psql -U mizan -d postgres
docker compose start mizan
```

The dump recreates the database; messages that the `mizan` role already exists are expected.

Backups hold encrypted sync records and account details (email addresses), never readable financial data.

## Day to day

- Status: `cd /srv/mizan && docker compose ps`; logs: `docker compose logs -f mizan`.
- Health: `https://<domain>/api/health`. Point a free uptime monitor (UptimeRobot, Better Stack) at it, and add a CloudWatch alarm on the instance's status checks.
- Roll back: set `MIZAN_TAG` in `.env` to an earlier commit, then `docker compose up -d`.
- Hardening later: replace SSH deploys with AWS Systems Manager Run Command and GitHub's OIDC role, and close port 22.
