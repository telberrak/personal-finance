#!/usr/bin/env bash
# Nightly PostgreSQL backup: every database, compressed, kept 14 days in /var/backups/mizan, and
# copied to S3 when BACKUP_S3_BUCKET is set (Parameter Store /mizan/BACKUP_S3_BUCKET). Installed by setup.sh as
# /usr/local/bin/mizan-backup. Restore: see docs/DEPLOY.md.
set -euo pipefail

dir=/var/backups/mizan
install -d -m 700 "$dir"
file="$dir/postgres-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

docker compose --project-directory /srv/mizan exec -T postgres pg_dumpall -U mizan | gzip >"$file.part"
mv "$file.part" "$file"
chmod 600 "$file"
find "$dir" -name 'postgres-*.sql.gz' -mtime +14 -delete

# Values in .env are quoted by mizan-config.
bucket="$(sed -n 's/^BACKUP_S3_BUCKET=//p' /srv/mizan/.env | tr -d "'\"")"
if [ -n "$bucket" ]; then
  /snap/bin/aws s3 cp "$file" "s3://$bucket/postgres/$(basename "$file")" --only-show-errors
fi
echo "$(date -u +%FT%TZ) backed up to $file"
