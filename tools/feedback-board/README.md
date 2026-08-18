# Feedback Board

A private, no-login 4-column Kanban board. **Moshe** files feature requests and
bug reports in the browser; **Claude** (the AI assistant) triages, builds, and
delivers them. The board is Claude's actual work queue — it is editable by BOTH
the webpage AND Claude directly on the filesystem.

Modeled on the sibling `command-center` app (Node/Express, systemd, nginx
location, dark-theme vanilla-JS frontend). Runs standalone on the OVH server.

## Access

Served at an unguessable URL, **no login** (protected only by the URL — it holds
feature ideas, no money and no destructive actions):

```
https://crm.impressionphotography.ca/board-<TOKEN>/
```

The nginx location strips the `/board-<TOKEN>/` prefix upstream, so the app sees
`/api` and `/uploads` at its own root.

## The four columns

1. **Inbox** — Moshe drafts cards. Fields: `type` (feature|bug), `title`
   (required), `goal` (optional), `idea` (optional), `screenshots` (optional,
   multiple image uploads). Validation: title required **plus** at least one of
   goal / idea / screenshot. Per-card "→ Send to review" + a top-level
   "Send all to review" button.
2. **Discussion** — where **Claude** parks a card when it has a better idea.
   Claude's counter-proposal shows prominently (`claudeNote`). Moshe can
   **Approve** (→ To Build) or **Counter** (adds his comment, → back to Inbox).
   Per-card comment thread.
3. **To Build** — Claude's agreed work queue.
4. **Delivered** — the changelog, newest first. On entering Delivered the card's
   screenshot files are **deleted from disk** to save space, but the card is kept
   with `deliveredAt` + a `deliveredNote`.

Cards move via buttons.

## Data model

ONE JSON file: `/opt/feedback-board/board.json` — an **array of card objects**.
Screenshots live in `/opt/feedback-board/uploads/`.

The server reads `board.json` **fresh on every `GET /api/cards`** (no in-memory
cache), so when Claude edits the file directly the webpage reflects it on the
next load. Writes use temp-file + atomic rename to avoid corruption.

### Card shape

```jsonc
{
  "id": "a1b2c3d4e5f6a7b8",        // random hex, server-assigned
  "type": "feature",                // "feature" | "bug"
  "title": "Short summary",         // required
  "goal": "What Moshe wants",       // optional
  "idea": "How he thinks to do it", // optional
  "column": "inbox",                // "inbox" | "discussion" | "tobuild" | "delivered"
  "urgent": false,                  // "Urgent — build this now" flag (old cards: absent = false)
  "urgedAt": null,                  // ISO string when flagged urgent
  "screenshots": ["ab12….png"],     // filenames in uploads/ (emptied on Delivered)
  "comments": [                     // thread, oldest first
    { "author": "moshe", "text": "…", "at": "2026-07-01T12:00:00.000Z" },
    { "author": "claude", "text": "…", "at": "2026-07-01T12:05:00.000Z" }
  ],
  "claudeNote": "",                 // Claude's counter-proposal (shown in Discussion)
  "deliveredNote": "",              // what shipped (shown in Delivered)
  "createdAt": "2026-07-01T12:00:00.000Z",
  "updatedAt": "2026-07-01T12:05:00.000Z",
  "deliveredAt": null               // ISO string once delivered
}
```

### How Claude uses the board as a queue

- **Pick up work**: read cards where `column == "tobuild"`.
- **Propose a change instead**: set the card's `claudeNote`, set
  `column = "discussion"`, bump `updatedAt`. Moshe then Approves or Counters.
- **Deliver**: set `column = "delivered"`, `deliveredAt` = now, fill
  `deliveredNote`. (When Moshe delivers via the UI the server also deletes the
  screenshot files; if Claude sets `delivered` by hand-editing the file, delete
  the files from `uploads/` too, or just leave them — the UI delete path handles
  it.)
- Always edit `board.json` with a read-modify-write of the whole array, then
  write atomically. The next page GET reflects the change.

## API

| Method | Path | Body | Effect |
| --- | --- | --- | --- |
| GET | `/api/cards` | — | full board (fresh from disk) |
| POST | `/api/cards` | multipart: `type,title,goal,idea,screenshots[]` | create card in Inbox |
| POST | `/api/cards/:id/move` | `{ column, deliveredNote? }` | move; into `delivered` deletes screenshots + stamps `deliveredAt` |
| POST | `/api/cards/:id/comment` | `{ author, text }` | append comment |
| POST | `/api/cards/:id/approve` | — | Discussion → To Build |
| POST | `/api/cards/:id/counter` | `{ text }` | add moshe comment, → Inbox |
| DELETE | `/api/cards/:id` | — | delete card + its screenshots |
| GET | `/api/health` | — | liveness + card count |
| GET | `/api/version` | — | `{sha, builtAt, recentlyDelivered[10]}` — deploy stamp (env `GIT_SHA`/`BUILD_AT`, else `version.json` written by `deploy.sh`) + last 10 delivered titles. Feeds the header's green traffic light. |

### Machine API (for an autonomous build agent)

Guarded by the `BOARD_SECRET` env var on the systemd service (this tool has no
other admin token — the browser endpoints stay URL-secret-only). Send it as
`Authorization: Bearer <BOARD_SECRET>` or `x-board-secret: <BOARD_SECRET>`
(constant-time compared). With no `BOARD_SECRET` set these return `503`.

| Method | Path | Body | Effect |
| --- | --- | --- | --- |
| GET | `/api/board` | — | `{items, counts:{pending,urgent}, recentlyDelivered[10]}` — every **non-delivered** card, urgent first, then oldest first. Items carry `id,title,status,column,type,urgent,urgedAt,createdAt,updatedAt,goal,idea,claudeNote,comments[]` (`status` is a friendly label of `column`; screenshots are just a count). |
| POST | `/api/board` | `{id, status}` | claim/move a card between non-delivered columns (`inbox`/`discussion`/`tobuild`). |
| POST | `/api/board/deliver` | `{id, note}` | deliver through the SAME path as a UI move: screenshot cleanup, `deliveredAt`, note defaulting, and the "✅ Delivered" email all fire. |

```bash
curl -H "Authorization: Bearer $BOARD_SECRET" https://crm.impressionphotography.ca/board-<TOKEN>/api/board
```

## Files

- `server.js` — Express backend (port **4243**).
- `package.json` — deps: `express`, `multer`.
- `feedback-board.service` — systemd unit.
- `public/index.html`, `public/app.js` — dark-theme vanilla-JS frontend.
- `board.json` — seed empty board (live store is gitignored on the server).
- `deploy.sh` — one-command deploy (see below).
- `.gitignore` — ignores `node_modules/`, live `board.json`, `uploads/`, `version.json`.

## Header status strip

Four icons, top-right (modeled on the Zrizes app's update loop; only the
download arrow ever pulses):

- **Red** (message-plus) — opens the quick-request popup (type, goal, idea,
  ⚡ urgent, paste screenshots).
- **Amber** (question circle) — lit while cards sit in **Discussion** waiting
  for YOUR decision; hover lists them, link scrolls to the board.
- **Green hammer** (semi-transparent) — the build queue: Requests + To Build
  cards; hover lists them urgent-first (⚡). Dim on purpose — "on the list",
  not actionable.
- **Green ↓** (solid download arrow) — pulses ONLY when the running service is
  a newer build than the loaded page; hover = recent deliveries, click =
  reload. Polls `/api/version` every 60s; the baseline sha is the first
  successful poll of the page lifetime, kept in memory (NOT sessionStorage —
  it survives reload and would leave the arrow stuck pulsing).

## Deploy (OVH server)

```bash
./deploy.sh    # from tools/feedback-board
```

That's the whole deploy: it refuses to run on a dirty tree, bakes
`version.json` (git short sha + UTC build time), scps the app files to
`/opt/feedback-board` (never touching `board.json`/`uploads/`), and restarts
the `feedback-board` service. `/api/version` serves the stamp — env
`GIT_SHA`/`BUILD_AT` win when set, otherwise the scp'd `version.json` (chosen
over a baked `Environment=` line in the unit because it needs no
`daemon-reload` and keeps the repo's unit file pristine).

First-time setup on the server:

```bash
cd /opt/feedback-board && npm install --omit=dev
cp feedback-board.service /etc/systemd/system/feedback-board.service
systemctl daemon-reload && systemctl enable --now feedback-board

# Machine API secret (server-side only, never committed):
#   add `Environment=BOARD_SECRET=<random hex>` to the installed unit (or an
#   EnvironmentFile), then `systemctl daemon-reload && systemctl restart feedback-board`.

# nginx location under crm.impressionphotography.ca.conf:
#    location /board-<TOKEN>/ { rewrite ^/board-<TOKEN>/(.*)$ /$1 break; proxy_pass http://127.0.0.1:4243; ... }
nginx -t && systemctl reload nginx
```

Service listens on `127.0.0.1:4243` (command-center owns 4242).
