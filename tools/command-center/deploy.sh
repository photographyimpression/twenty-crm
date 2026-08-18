#!/usr/bin/env bash
#
# Deploy the Daily Command Center to the OVH box: bake a version stamp, scp the
# app files, restart the systemd service. One command, repeatable.
#
# HOW THE SHA REACHES THE RUNNING SERVICE (documented decision):
#   This script writes version.json NEXT TO THE APP (/opt/command-center/version.json)
#   and GET /api/version serves {sha, builtAt} from it (alongside the existing
#   deployedAt of the CRM container). GIT_SHA/BUILD_AT env vars win when set,
#   but version.json is the default channel — cleanest for systemd: no unit-file
#   mutation, no `systemctl daemon-reload`, the repo's .service file stays
#   pristine. The header's green traffic light compares this sha against the
#   loaded page.
#
# Live data + secrets are NEVER touched: roadmap.json, paused-state.json,
# .token, .auth, .session-secret stay as they are on the server.
#
# Usage:  ./deploy.sh           (from tools/command-center, clean committed tree)
#         CC_SERVER=user@host ./deploy.sh   (override target)
set -euo pipefail
cd "$(dirname "$0")"

SERVER="${CC_SERVER:-root@15.204.91.183}"
DEST="${CC_DEST:-/opt/command-center}"
SERVICE=command-center

# The baked sha must name a real commit — refuse to deploy dirty sources.
if [ -n "$(git status --porcelain -- .)" ]; then
  echo "ERROR: uncommitted changes under tools/command-center — commit + push first." >&2
  exit 1
fi

SHA="$(git rev-parse --short HEAD)"
BUILD_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{\n  "sha": "%s",\n  "builtAt": "%s"\n}\n' "$SHA" "$BUILD_AT" > version.json
echo "Baked version.json: sha=$SHA builtAt=$BUILD_AT"

scp server.js offer-campaign.js package.json version.json "$SERVER:$DEST/"
scp public/app.js public/index.html public/login.html "$SERVER:$DEST/public/"
scp templates/*.html "$SERVER:$DEST/templates/"
ssh "$SERVER" "systemctl restart $SERVICE && systemctl is-active $SERVICE"

echo "Deployed: $SERVICE now runs $SHA (built $BUILD_AT)."
