# Status Strip — deploy & ops notes

**LOCAL-PATCH: status strip (update loop)** — everything on this page is
fork-local (upstream twenty has none of it). Touched files all carry the
`LOCAL-PATCH: status strip (update loop)` marker; on an upstream merge,
resolve those hunks deliberately.

## What it is

A four-icon strip at the END of `PageHeader`'s action row (top-right of EVERY
page — Command Center included; it replaced the old feedback bulb button and
the separate record-index mounting), mirroring the Feedback Board's own header
lights and the Zrizes app's strip, icon order included:

| Icon | Lit state | Meaning | Action |
| --- | --- | --- | --- |
| RED `message-square-plus` | always red | quick request | opens the Quick-request popup (✨Feature/🐞Bug toggle, goal/idea, paste screenshots, ⚡ urgent, "Build everything waiting — now") that POSTs to the board's public submit endpoint. **Never pulses.** |
| AMBER `circle-help` | amber while any card is in `discussion` | cards waiting for the owner's decision | hover lists titles; link opens the board |
| GREEN `hammer` (~55% opacity) | dim green while `inbox`/`tobuild` cards exist | build queue | hover lists them urgent-first (⚡) |
| GREEN `arrow-down-to-line` | solid green, pulsing ONLY when a newer build is live | update ready | click = **reload to apply**; when up-to-date, click opens the board changelog |

Code: `packages/twenty-front/src/modules/status-strip/components/StatusStrip.tsx`
(mounted once in `packages/twenty-front/src/modules/ui/layout/page/components/PageHeader.tsx`).

## How it talks to the board — token-in-URL ONLY

The strip uses the board's **public browser endpoints** under
`https://crm.impressionphotography.ca/board-<TOKEN>/` (unguessable mount path
is the board's only access control, by design — see `tools/feedback-board/README.md`):

- `GET  /board-<TOKEN>/api/cards` — full board (drives amber + hammer lights)
- `POST /board-<TOKEN>/api/cards` — create a card in Inbox (the red popup;
  multipart `type=feature|bug`, `goal`, `idea`, `urgent=true|false`,
  `screenshots` files — pasted images are downscaled client-side to
  max 1400px JPEG)
- `POST /board-<TOKEN>/api/build-now` — the popup's two-click "Build
  everything waiting — now" trigger (owner action, URL-secret gated like the
  other browser endpoints; the build agent reads + clears the flag)

The URL is baked into the frontend at build time via
`REACT_APP_FEEDBACK_BOARD_URL`. The **BOARD_SECRET is never involved** — it
stays server-side on the `feedback-board` systemd service (machine API only).

**Value (private repo, documented here on purpose — it is URL-auth, not a
credential):**

```
REACT_APP_FEEDBACK_BOARD_URL=https://crm.impressionphotography.ca/board-480d724fe05b0c3f74bc75dff25f9301
```

The same value is in the local gitignored `packages/twenty-front/.env` for dev,
in `.env.example` as a `<TOKEN>` placeholder, and in `.github/workflows/deploy.yml`
as the build-arg the production image is built with.

## The green arrow's version comparison

The strip polls same-origin `GET /crm-version.json` (no-store) every 60s and on
tab focus, and compares `version` against:

1. **`REACT_APP_GIT_SHA`** baked at build time (deploy.yml passes
   `${{ github.sha }}`) — the honest comparison; pulses when they differ.
2. If that wasn't baked: **in-memory fallback** — the first `/crm-version.json`
   seen this page-load becomes the baseline (module-level variable, never
   localStorage: storage survives `location.reload()` — the very action the
   arrow performs — and would leave it stuck pulsing). **Limitation:** a
   version published *before* the page loaded is invisible; the baseline is
   whatever was live at load.

`/crm-version.json` shape (written by the publish script / CI):

```json
{ "version": "<git sha>", "notes": "<one line>", "builtAt": "<UTC ISO>" }
```

## Deploy

### Normal deploys (nothing extra to do)

The existing flow (per `CRM/ROADMAP.md` conventions: merge/push to `main` →
CI Docker build → OVH) already wires the strip:

1. `.github/workflows/deploy.yml` builds the image with
   `REACT_APP_FEEDBACK_BOARD_URL` + `REACT_APP_GIT_SHA=${{ github.sha }}`
   build-args (the `twenty-front` build stage in
   `packages/twenty-docker/twenty/Dockerfile` turns them into Vite env).
2. After `docker compose up -d`, the same workflow stamps
   `/opt/crm-version.json` with the deployed sha.

So: **push to `main` and wait for the `Build and Deploy Custom Twenty CRM`
workflow (~12 min build).** Verify:

```bash
# on the OVH box
docker compose -f /opt/twenty/docker-compose.yml ps   # fresh image, healthy
curl -s https://crm.impressionphotography.ca/crm-version.json
# then hard-reload the CRM — the strip sits at the far right of the page
# header on every page (red request icon first)
```

### One-time server setup (nginx location for the version file)

1. Copy the snippet into the CRM vhost — add the `location = /crm-version.json`
   block (from `scripts/nginx-crm-version.conf`) inside the main `server {}`
   of `/etc/nginx/sites-enabled/crm.impressionphotography.ca.conf`:

   ```bash
   # on the OVH box
   cp /path/to/repo/scripts/nginx-crm-version.conf /opt/crm-version.conf.snippet
   # edit /etc/nginx/sites-enabled/crm.impressionphotography.ca.conf and paste
   # the location block inside the server { } section (see the snippet file)
   nginx -t && systemctl reload nginx
   ```

2. Prime the stamp (optional — CI will write it on the next deploy):

   ```bash
   bash scripts/publish-crm-version.sh    # sha auto-read from the running image label
   ```

### Manual / emergency frontend deploys

If you ever ship the frontend without the CI workflow (not the convention,
but if you must), remember to re-stamp the version AFTER the new container is
up, or open tabs won't notice:

```bash
cd /opt/twenty && docker compose pull && docker compose up -d
bash scripts/publish-crm-version.sh "" "manual deploy: <what changed>"
```

## Local dev

```bash
# packages/twenty-front/.env (gitignored)
REACT_APP_FEEDBACK_BOARD_URL=https://crm.impressionphotography.ca/board-480d724fe05b0c3f74bc75dff25f9301
```

Without it the strip renders nothing (safe no-op). `/crm-version.json` won't
exist on localhost → the arrow stays slate with "Version info unavailable" —
expected outside the box.

## Merge-with-upstream notes

- Every touched file starts with (or marks its hunks with)
  `LOCAL-PATCH: status strip (update loop)` — grep for it after any upstream
  merge and re-apply deliberately.
- Files touched: `src/modules/status-strip/components/StatusStrip.tsx` (new),
  `src/modules/ui/layout/page/components/PageHeader.tsx` (strip mounts at the
  end of the action row; the old `src/modules/feedback/` bulb-button + modal
  were removed — superseded by the strip's popup), `packages/twenty-front/.env.example`,
  `packages/twenty-docker/twenty/Dockerfile`, `.github/workflows/deploy.yml`,
  `scripts/publish-crm-version.sh`, `scripts/nginx-crm-version.conf`, this doc.
- The strip is one self-contained component (no app state, no new deps,
  inline lucide-path SVGs, Linaria styling) — it should survive upstream
  churn as long as `PageHeader`'s action container exists.
