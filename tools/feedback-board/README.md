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

## Files

- `server.js` — Express backend (port **4243**).
- `package.json` — deps: `express`, `multer`.
- `feedback-board.service` — systemd unit.
- `public/index.html`, `public/app.js` — dark-theme vanilla-JS frontend.
- `board.json` — seed empty board (live store is gitignored on the server).
- `.gitignore` — ignores `node_modules/`, live `board.json`, `uploads/`.

## Deploy (OVH server)

```bash
# 1. Copy the app to /opt/feedback-board (excluding node_modules).
# 2. On the server:
cd /opt/feedback-board && npm install --omit=dev
cp feedback-board.service /etc/systemd/system/feedback-board.service
systemctl daemon-reload && systemctl enable --now feedback-board

# 3. Add the nginx location under crm.impressionphotography.ca.conf:
#    location /board-<TOKEN>/ { rewrite ^/board-<TOKEN>/(.*)$ /$1 break; proxy_pass http://127.0.0.1:4243; ... }
nginx -t && systemctl reload nginx
```

Service listens on `127.0.0.1:4243` (command-center owns 4242).
