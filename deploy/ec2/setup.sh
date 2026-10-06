#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu LTS EC2 instance for Mizan (safe to run again). From your PC:
#   scp -r deploy/ec2 ubuntu@<ip>:
#   ssh ubuntu@<ip> 'sudo bash ec2/setup.sh'
# Installs Docker, the AWS CLI, automatic security updates, a swap file, a "deploy" user for GitHub
# Actions, /srv/mizan, mizan-config (settings from AWS Parameter Store) and nightly database backups.
# Settings are never edited here: they live in Parameter Store under /mizan/. See docs/DEPLOY.md.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

echo "== Packages and Docker"
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install docker.io docker-compose-v2 unattended-upgrades curl
systemctl enable --now docker
snap list aws-cli >/dev/null 2>&1 || snap install aws-cli --classic # settings (Parameter Store) and S3 backups

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
echo "== Settings from AWS Parameter Store (/mizan/*)"
# Each deploy runs mizan-config to write /srv/mizan/.env; never edit that file by hand.
install -m 755 "$here/config.sh" /usr/local/bin/mizan-config

echo "== Nightly database backups (03:30 UTC, kept 14 days)"
install -m 755 "$here/backup.sh" /usr/local/bin/mizan-backup
cat >/etc/cron.d/mizan-backup <<'EOF'
30 3 * * * root /usr/local/bin/mizan-backup >>/var/log/mizan-backup.log 2>&1
EOF

cat <<EOF

Done. Next (docs/DEPLOY.md):
  1. Attach the IAM role that can read /mizan/* (deploy/ec2/iam-policy.json) to this instance.
  2. Put the settings in Parameter Store under /mizan/ (at least MIZAN_DOMAIN and POSTGRES_PASSWORD).
  3. Add GitHub's deploy key to /home/deploy/.ssh/authorized_keys, then deploy from GitHub.
EOF
