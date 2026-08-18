#!/usr/bin/env bash
# LOCAL-PATCH: status strip (update loop)
#
# Writes /opt/crm-version.json — the build stamp nginx serves at
# https://crm.impressionphotography.ca/crm-version.json (see
# scripts/nginx-crm-version.conf) — so the CRM frontend's StatusStrip green
# arrow can tell "a newer build than this page is now running" and pulse.
#
# The CI deploy (.github/workflows/deploy.yml) writes the same file inline
# right after `docker compose up -d`; this script is the manual/one-off path
# (run it on the OVH box after any manual `docker compose pull && up -d`).
#
# Usage (on the OVH box, as root):
#   scripts/publish-crm-version.sh [sha] [notes]
#
#   sha   deployed git sha/tag. Default: the org.opencontainers.image.revision
#         label baked into ghcr.io/photographyimpression/twenty-crm:latest by
#         CI (docker inspect), which is the exact commit the image was built
#         from — the same value passed as REACT_APP_GIT_SHA at build time, so
#         the arrow's comparison is apples-to-apples.
#   notes one-line summary shown in the arrow's hover popover.
#
# The frontend must be built with the matching REACT_APP_GIT_SHA build-arg
# (deploy.yml does this). The strip falls back to an in-memory baseline when
# it wasn't — see packages/twenty-front/src/modules/status-strip/.

set -euo pipefail

OUT_FILE="${CRM_VERSION_OUT:-/opt/crm-version.json}"
IMAGE="${CRM_VERSION_IMAGE:-ghcr.io/photographyimpression/twenty-crm:latest}"

sha="${1:-}"
notes="${2:-}"

if [[ -z "$sha" ]]; then
  sha="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE" 2>/dev/null || true)"
fi
if [[ -z "$sha" || "$sha" == "<no value>" || "$sha" == "none" ]]; then
  # Unlabelled image (local build) — a timestamped marker still lets
  # already-open tabs see that *something* new was deployed.
  sha="unknown-$(date -u +%Y%m%d%H%M%S)"
fi
if [[ -z "$notes" ]]; then
  notes="deployed $(date -u +'%Y-%m-%d %H:%M UTC')"
fi

# Minimal JSON string escaping (backslash + double quote).
json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf '{\n  "version": "%s",\n  "notes": "%s",\n  "builtAt": "%s"\n}\n' \
  "$(json_escape "$sha")" \
  "$(json_escape "$notes")" \
  "$built_at" > "${OUT_FILE}.tmp"
mv "${OUT_FILE}.tmp" "$OUT_FILE"

echo "wrote $OUT_FILE:"
cat "$OUT_FILE"
