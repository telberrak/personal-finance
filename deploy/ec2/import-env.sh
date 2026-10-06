#!/usr/bin/env bash
# One-time move of settings into AWS Parameter Store, from a file of KEY=VALUE lines (such as the
# server's current /srv/mizan/.env). Run on your PC, with the AWS CLI signed in to the account:
#
#   ssh -i mizan.pem ubuntu@<ip> "sudo cat /srv/mizan/.env" | bash deploy/ec2/import-env.sh
#
# Every non-empty value becomes a SecureString /mizan/KEY (overwriting any existing one).
# MIZAN_TAG is skipped: the deploy manages it. Values are never printed.
set -euo pipefail

region="${AWS_REGION:-eu-west-2}"
prefix="${MIZAN_SSM_PATH:-/mizan/}"
count=0

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  # Values written by mizan-config are quoted: single quotes literally, double quotes with escapes.
  sq="'"
  if [[ ${#value} -ge 2 && "${value:0:1}" == "$sq" && "${value: -1}" == "$sq" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ ${#value} -ge 2 && "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
    value="${value:1:${#value}-2}"
    # Undo the backslash escapes: \n is a line break, and \x is x (for \\, \" and \$).
    value="$(printf '%s' "$value" | sed -e 's/\\n/\n/g' -e 's/\\\(.\)/\1/g')"
  fi
  [[ "$key" == "MIZAN_TAG" || -z "$value" ]] && continue
  if [[ ! "$key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
    echo "skipped $key (not a setting name)" >&2
    continue
  fi
  aws ssm put-parameter --region "$region" --name "$prefix$key" --type SecureString --value "$value" --overwrite >/dev/null
  echo "  $prefix$key"
  count=$((count + 1))
done

echo "$count settings stored in Parameter Store ($region)."
