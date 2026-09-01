# Impression CRM — Roadmap & Idea Parking Lot

Living list of things we've discussed but haven't built yet. The in-app
version lives in the Daily Command Center (`/command-center/`, "Roadmap" tab)
and is editable from there. This file is the developer-facing mirror.

_Last updated: 2026-09-01_

This mirrors the in-app changelog (Command Center → Roadmap tab). Categories:
🔧 fix ready · 🐞 open bug · ✨ wanted feature · 🔄 in progress · ⏳ blocked on you.

---

## ✅ Delivered 2026-09-01 (roadmap board cleared — everything buildable is built)

The in-app board had 3 open items; 1 was built + delivered, 2 are genuinely
blocked on Moshe (see below). Same day, the whole Feedback Board queue
(14 cards) was built + delivered — see the board's Delivered column for the
"what shipped" notes (emails were sent per card).

- **Multi-from sender** (`cl-11`) — From picker on the triage card (both
  connected mailboxes, server-validated against live `connectedAccounts`),
  per-send override stamped into the approval; recipient-keyed rotation pool
  (`CC_SENDER_POOL`) already in place for when warming mailboxes are connected.
  Roadmap items are now checked off through `POST /api/roadmap/:id/done`
  (new delivery path — the Roadmap tab has ✓ Done buttons).

## ⏳ Blocked on you (Moshe) — the only things left on the board

- **Connect warming mailboxes** (`cl-24`) — Settings → Accounts. The From
  picker + rotation are live; each connected mailbox appears automatically.
- **Elementor pricing-form → CRM webhook, WP side** (`cl-23`) — the CRM-side
  webhook is deployed and working (form → lead → sequence); the PPM site is on
  IONOS and needs the WP plugin installed with your admin access (or an
  app-password).
- **"merge these"** (Feedback Board, discussion) — still waiting on your
  answer: merge WHAT? (Two duplicate people? Two views? Two boards?)
- DIGI Brooks was deliberately NOT enrolled in any sequence (lead-gen vendor,
  not a client). Say the word if you want them in one anyway.

## Shipped (recent highlights)

- ✅ Command Center light theme — matches the CRM (white, #3E63DD, #30A46C);
  the CC reads as a page OF the app in the /command embed.
- ✅ Send-after-send fixed — the busy flag leaked after every successful
  Send/Skip, freezing the next card's buttons until a page refresh.
- ✅ "↻ Refresh contact info" — re-merges every pending touch of a lead with
  their CURRENT CRM name/company (rename a client, hit refresh, send).
- ✅ Copy-email + search-in-Inbox buttons on the triage card's To line
  (`/inbox?search=` deep-link).
- ✅ Family numbers (514 894 7978, 438 763 7978) — no auto-reply, no email
  forward, no workflow; texts still land on the CRM timeline. "ATT Avi"
  routing unaffected.
- ✅ Call keep-alive — the 10-min WebRTC token refresh defers while a call is
  live (it used to hang up mid-call from our end); runs right after hangup.
- ✅ Quick-request popup claims keyboard focus — no more typing into an open
  client Note.
- ✅ People nav always lands on a real list view (fields-widget views are no
  longer pickable, rememberable, or honored as last-visited).
- ✅ Center-column note composer (Salesmate style) + inline note expansion.
- ✅ Enrollment ops: Vanja Pupavac + MK Solutions → Post-Quote (7 touches);
  RISHA → Pre-Phone (12 touches). All approval-gated.

## Shipped (earlier)

- ✅ Pre-Phone 12-email sequence (tag a Person → 12 approvals created)
- ✅ Niche-aware signature auto-attached on send
- ✅ AI-personalized opener (Ollama relay) on Touches 4-6
- ✅ Cal.com self-hosted booking link in Touches 4-9 (pending DNS)
- ✅ Fixed the broken "Execute Approved Touch" workflow (now actually sends)
- ✅ Date-gated approval views: "🔥 Due Today" + "📅 Upcoming"
- ✅ Cascade scheduler (only the next pending touch per lead is dated)
- ✅ Daily Command Center: triage send-and-next, calls, roadmap
- ✅ Post-Quote Follow-Up sequence: 7 approval-gated emails for
  quoted-but-undecided leads (day 2→5→9→14→21→30→42, breakup last).
- ✅ Multi-sequence Command Center: per-sequence cadence, sequence badge,
  one-active-sequence rule (graduating a lead auto-rejects stale pendings).
- ✅ Placeholder send-guard: server refuses (HTTP 422) to send any email
  still containing an unfilled [PLACEHOLDER].

## Infrastructure / user-action items

- [ ] **Cal.com DNS**: add A record `cal` → 15.204.91.183 at IONOS, then
      `certbot --nginx -d cal.impressionphotography.ca`. Until then the booking
      link in emails 4-9 won't resolve.
- [ ] **Cal.com calendar OAuth**: log in once, connect Google/Outlook calendar
      so bookings reflect real availability. Creds in `/root/.cal-com-admin-creds`.
- [ ] **OVH disk at ~94%.** The 121GB Windows VM at `/opt/win-vm` dominates;
      archive or move it. Redis was choking on disk pressure (band-aided with
      `stop-writes-on-bgsave-error=no`).
