#!/usr/bin/env bash
#
# Deploy the Feedback Board to the OVH box: bake a version stamp, scp the app
# files, restart the systemd service. One command, repeatable.
#
# HOW THE SHA REACHES THE RUNNING SERVICE (documented decision):
#   This script writes version.json NEXT TO THE APP (/opt/feedback-board/version.json)
#   and GET /api/version serves {sha, builtAt} from it. GIT_SHA/BUILD_AT env vars
#   win when set, but version.json is the default channel — it is the cleanest
#   fit for systemd: no unit-file mutation, no `systemctl daemon-reload`, the
#   repo's .service file stays pristine, and the stamp survives unit reinstalls.
#   The header's green traffic light compares this sha against the loaded page.
#
# The board's live data (board.json, uploads/) is NEVER touched by a deploy.
# Secrets (BOARD_SECRET, SMTP) live in the server-side unit/EnvironmentFile —
# never in this repo.
#
# Usage:  ./deploy.sh          (from tools/feedback-board, clean committed tree)
#         FB_SERVER=user@host ./deploy.sh   (override target)
set -euo pipefail
cd "$(dirname "$0")"

SERVER="${FB_SERVER:-root@15.204.91.183}"
DEST="${FB_DEST:-/opt/feedback-board}"
SERVICE=feedback-board

# The baked sha must name a real commit — refuse to deploy dirty sources.
if [ -n "$(git status --porcelain -- .)" ]; then
  echo "ERROR: uncommitted changes under tools/feedback-board — commit + push first." >&2
  exit 1
fi

SHA="$(git rev-parse --short HEAD)"
BUILD_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{\n  "sha": "%s",\n  "builtAt": "%s"\n}\n' "$SHA" "$BUILD_AT" > version.json
echo "Baked version.json: sha=$SHA builtAt=$BUILD_AT"

scp server.js package.json version.json "$SERVER:$DEST/"
scp public/index.html public/app.js "$SERVER:$DEST/public/"
ssh "$SERVER" "systemctl restart $SERVICE && systemctl is-active $SERVICE"

echo "Deployed: $SERVICE now runs $SHA (built $BUILD_AT)."
