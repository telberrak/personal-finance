#!/usr/bin/env bash
# Writes /srv/mizan/.env from AWS Systems Manager Parameter Store: every parameter under /mizan/
# becomes a setting (/mizan/RESEND_API_KEY → RESEND_API_KEY). Parameter Store is the only place
# to change settings; this file is replaced on every deploy, so never edit it by hand.
#
# Installed by setup.sh as /usr/local/bin/mizan-config and run by each deploy (and the "Apply
# settings" workflow) as the deploy user, with the instance's IAM role (read-only on /mizan/*).
#
# Safety: it stops without changing anything if MIZAN_DOMAIN or POSTGRES_PASSWORD is missing, or
# if POSTGRES_PASSWORD differs from the one in use (the database keeps the password it was created
# with). To change the password on purpose, see docs/DEPLOY.md ("Changing the database password").
set -euo pipefail

prefix="${MIZAN_SSM_PATH:-/mizan/}"
env_file="${MIZAN_ENV_FILE:-/srv/mizan/.env}"
aws="${AWS_CLI:-/snap/bin/aws}"

# The instance's region, from its metadata service (IMDSv2), unless AWS_REGION is set.
region="${AWS_REGION:-}"
if [ -z "$region" ]; then
  imds_token="$(curl -sf -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')"
  region="$(curl -sf -H "X-aws-ec2-metadata-token: $imds_token" http://169.254.169.254/latest/meta-data/placement/region)"
fi

# While moving to Parameter Store: without access (no IAM role yet) or without any /mizan/ settings,
# an existing .env is kept as it is, with a warning (shown as an annotation in GitHub Actions).
keep_current() {
  echo "::warning::mizan-config: $1 Keeping the current $env_file. See docs/DEPLOY.md, section 3."
  exit 0
}
errors="$(mktemp)"
trap 'rm -f "$errors"' EXIT
if ! params="$("$aws" ssm get-parameters-by-path --region "$region" --path "$prefix" --recursive --with-decryption --output json 2>"$errors")"; then
  reason="$(tr '\n' ' ' <"$errors")"
  [ -f "$env_file" ] && keep_current "Parameter Store could not be read (does the instance have its IAM role?): $reason"
  echo "mizan-config: Parameter Store could not be read: $reason" >&2
  exit 1
fi
if [ -f "$env_file" ] && ! grep -q '"Name"' <<<"$params"; then
  keep_current "Parameter Store has no settings under $prefix yet."
fi

render='
import json, os, re, sys, tempfile

env_file, prefix = sys.argv[1], sys.argv[2]
settings = {p["Name"][len(prefix):]: p["Value"] for p in json.load(sys.stdin)["Parameters"]}

bad = [name for name in settings if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name)]
if bad:
    sys.exit("mizan-config: parameter names must look like VARIABLE_NAMES: " + ", ".join(prefix + b for b in bad))
for required in ("MIZAN_DOMAIN", "POSTGRES_PASSWORD"):
    if not settings.get(required):
        sys.exit(f"mizan-config: {prefix}{required} is missing in Parameter Store. Nothing was changed.")

SQ = chr(39)  # a single quote; this program sits inside a single-quoted shell string
BS = chr(92)  # a backslash

def unquote(value):
    if len(value) >= 2 and value[0] == value[-1] == SQ:
        return value[1:-1]
    if len(value) >= 2 and value[0] == value[-1] == "\"":
        out, chars = "", iter(value[1:-1])
        for ch in chars:
            if ch == BS:
                nxt = next(chars, "")
                out += "\n" if nxt == "n" else nxt
            else:
                out += ch
        return out
    return value

current = {}
if os.path.exists(env_file):
    for line in open(env_file, encoding="utf-8"):
        line = line.rstrip("\n")
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            current[key] = unquote(value)

running = current.get("POSTGRES_PASSWORD")
if running and running != settings["POSTGRES_PASSWORD"] and os.environ.get("MIZAN_ALLOW_PASSWORD_CHANGE") != "1":
    sys.exit("mizan-config: POSTGRES_PASSWORD in Parameter Store differs from the one the database uses. Nothing was changed. "
             "To change it, follow \"Changing the database password\" in docs/DEPLOY.md.")

# The version running is managed by the deploy, not Parameter Store.
settings["MIZAN_TAG"] = current.get("MIZAN_TAG") or settings.get("MIZAN_TAG") or "latest"

# Single quotes are taken literally by Docker Compose (no $ expansion). Double quotes, with
# backslash escapes, only for the rare value containing a single quote or a line break.
def quote(value):
    if SQ not in value and "\n" not in value:
        return SQ + value + SQ
    escaped = "".join(BS + ch if ch in (BS, "\"", "$") else ch for ch in value).replace("\n", BS + "n")
    return "\"" + escaped + "\""

lines = [f"# Written by mizan-config from AWS Parameter Store ({prefix}*). Do not edit: it is replaced on every deploy."]
lines += [f"{key}={quote(value)}" for key, value in sorted(settings.items())]
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(env_file) or ".", prefix=".env.")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    os.fchmod(f.fileno(), 0o600)
    f.write("\n".join(lines) + "\n")
os.replace(tmp, env_file)
print(f"mizan-config: {len(settings) - 1} settings from {prefix} written to {env_file} (values not shown)")
'
python3 -c "$render" "$env_file" "$prefix" <<<"$params"
