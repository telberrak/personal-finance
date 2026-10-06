#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu LTS EC2 instance for Mizan (safe to run again). From your PC:
#   scp -r deploy/ec2 ubuntu@<ip>:
#   ssh ubuntu@<ip> 'sudo MIZAN_DOMAIN=mizan.example.com bash ec2/setup.sh'
# Installs Docker, automatic security updates, a swap file, a "deploy" user for GitHub Actions,
# /srv/mizan with its settings, and nightly database backups. See docs/DEPLOY.md.
set -euo pipefail

: "${MIZAN_DOMAIN:?Set MIZAN_DOMAIN, e.g. sudo MIZAN_DOMAIN=mizan.example.com bash ec2/setup.sh}"
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

echo "== Packages and Docker"
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install docker.io docker-compose-v2 unattended-upgrades curl
systemctl enable --now docker
snap list aws-cli >/dev/null 2>&1 || snap install aws-cli --classic # for optional S3 backups

echo "== Automatic security updates (reboots at 04:00 UTC when needed)"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat >/etc/apt/apt.conf.d/52mizan-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF

echo "== Swap (2 GB safety margin)"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

echo "== SSH: keys only"
cat >/etc/ssh/sshd_config.d/60-mizan.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
systemctl reload ssh

echo "== Deploy user (GitHub Actions logs in as this user)"
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

echo "== /srv/mizan"
install -d -o deploy -g deploy /srv/mizan /srv/mizan/sites /srv/mizan/sites.d
install -m 644 -o deploy -g deploy "$here/compose.yml" "$here/Caddyfile" /srv/mizan/
if [ ! -f /srv/mizan/sites.d/README.caddy ]; then
  cat >/srv/mizan/sites.d/README.caddy <<'EOF'
# One file per site, e.g. /srv/mizan/sites.d/tarikelberrak.caddy:
#
# tarikelberrak.com, www.tarikelberrak.com {
# 	root * /srv/sites/tarikelberrak
# 	encode zstd gzip
# 	file_server
# }
#
# Put the site's files in /srv/mizan/sites/tarikelberrak, then reload Caddy:
#   cd /srv/mizan && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
EOF
  chown deploy:deploy /srv/mizan/sites.d/README.caddy
fi
if [ ! -f /srv/mizan/.env ]; then
  (
    umask 077
    cat >/srv/mizan/.env <<EOF
# Mizan settings. Restart after changes: cd /srv/mizan && docker compose up -d
MIZAN_DOMAIN=$MIZAN_DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
# Set by each deploy:
MIZAN_TAG=latest
# Email (sign-in codes, news). A verified sender, then either an SMTP server or Resend.
# Without either, codes only appear in: docker compose logs mizan
MAIL_FROM=
# Any SMTP server (Amazon SES, Brevo, Postmark, Mailgun…). Port 587 uses STARTTLS; 465 uses TLS.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
# Or Resend's API (used when SMTP_HOST is empty; also needed for Resend Broadcasts below).
RESEND_API_KEY=
# Optional: the Resend segment that news subscribers join (for Broadcasts).
RESEND_SEGMENT_ID=
# Optional: copy nightly backups to this S3 bucket (the instance role needs s3:PutObject on it).
BACKUP_S3_BUCKET=
EOF
  )
  chown deploy:deploy /srv/mizan/.env
fi

echo "== Nightly database backups (03:30 UTC, kept 14 days)"
install -m 755 "$here/backup.sh" /usr/local/bin/mizan-backup
cat >/etc/cron.d/mizan-backup <<'EOF'
30 3 * * * root /usr/local/bin/mizan-backup >>/var/log/mizan-backup.log 2>&1
EOF

cat <<EOF

Done. Next:
  1. Add GitHub's deploy key to /home/deploy/.ssh/authorized_keys (docs/DEPLOY.md, step 4).
  2. Fill in RESEND_API_KEY and MAIL_FROM in /srv/mizan/.env.
  3. Point $MIZAN_DOMAIN at this server, then deploy from GitHub.
EOF
