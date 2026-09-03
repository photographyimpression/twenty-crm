# Impression CRM — Roadmap & Idea Parking Lot

Living list of things we've discussed but haven't built yet. The in-app
version lives in the Daily Command Center (`/command-center/`, "Roadmap" tab)
and is editable from there. This file is the developer-facing mirror.

_Last updated: 2026-09-03_

This mirrors the in-app changelog (Command Center → Roadmap tab). Categories:
🔧 fix ready · 🐞 open bug · ✨ wanted feature · 🔄 in progress · ⏳ blocked on you.

---

## ✅ Delivered 2026-09-03 (Feedback Board cleared — all 13 requests built)

- **Unenroll outcomes** — the triage card's Unenroll now asks why: 🏆 Won sets
  contact type to Customer (+ timeline note), 📕 Lost requires a reason
  (+ timeline note), or just end it.
- **AI panel on Gemini** — the right-side AI briefing streams from
  gemini-2.5-flash (free tier) in ~1-2s; Ollama stays as fallback. Root fix
  included forcing IPv4 egress — the box's IPv6 geolocates to France where
  the free tier is blocked (this also un-broke the AI SMS auto-reply).
- **Call recordings now actually transcribe** — Telnyx's /v2/ai/transcribe
  was never provisioned on this account (every attempt 404s, so recordings
  had never once transcribed). Recordings are downloaded via the Recordings
  API's signed URLs and transcribed by Gemini audio. Missing Sept-2
  transcripts were backfilled onto their timeline notes.
- **Live transcripts land** — the dialer's session-id mismatch (dropped
  transcripts) is fixed with phone-number matching + a hangup-race guard
  (no more duplicate empty call notes); the note shows a pulsing
  "⏳ Transcribing…" chip until the transcript arrives.
- **"Message not found" fixed** — message cleanup now deletes the orphaned
  timeline card with the email; leftovers render "Email no longer synced".
- **Calendar permission bug fixed** — creating any event from a person page
  (strategy call, Teams toggle) died with "Entity performing the request
  does not have permission": the Outlook event service queried the connected
  account without the system permission bypass. Verified end-to-end.
- **Timeline** — note bodies always render inline on expand; junk imported
  titles ("NF5ZG") fall back to the note's first words; Calls/Texts filter
  pills are always offered; new notes get AI-written 2-5 word titles
  (Gemini, heuristic fallback) instead of "Untitled".
- **Person page** — email + phone with one-click copy icons on the identity
  card.
- **Inbox** — standard email proportions (compact list, wide reading pane)
  and readable (non-pale) secondary text.
- **Triage card context strip** — lead phone + click-to-call + calls/texts/
  sequence summary on the card itself.

## ⏳ Blocked on you (Moshe) — the only things left

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
- Outlook: the "TEST — strategy-call fix verification (safe to delete)"
  calendar event from the 2026-09-03 verification can be deleted.

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
