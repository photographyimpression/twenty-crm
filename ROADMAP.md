# Impression CRM — Roadmap & Idea Parking Lot

Living list of things we've discussed but haven't built yet. The in-app
version lives in the Daily Command Center (`/command-center/`, "Roadmap" tab)
and is editable from there. This file is the developer-facing mirror.

_Last updated: 2026-05-26_

## Shipped
- ✅ Pre-Phone 12-email sequence (tag a Person → 12 approvals created)
- ✅ Niche-aware signature auto-attached on send
- ✅ AI-personalized opener (Ollama relay) on Touches 4-6
- ✅ Cal.com self-hosted booking link in Touches 4-9 (pending DNS)
- ✅ Fixed the broken "Execute Approved Touch" workflow (now actually sends)
- ✅ Date-gated approval views: "🔥 Due Today" + "📅 Upcoming"
- ✅ Cascade scheduler (only the next pending touch per lead is dated)
- ✅ Daily Command Center: triage send-and-next, calls, roadmap

## Next up (high value)
- [ ] **Multi-from sender / warming-domain rotation.** Pick which mailbox an
      email sends from. Blocked on: connect ≥2 more Outlook mailboxes to Twenty
      (Settings → Accounts). Then add a From-picker to the triage UI + honor it
      in the SEND_EMAIL step.
- [ ] **Auto-pause sequence when a lead replies.** Needs Microsoft Graph webhook
      (user is on Exchange/Outlook, not Gmail). On reply detected → set that
      lead's remaining approvals to REJECTED/paused.
- [ ] **Click-to-dial via Telnyx WebRTC** inside the Command Center calls panel
      (dialer is already wired in the CRM; embed/launch it from the call card).

## Infrastructure / user-action items
- [ ] **Cal.com DNS**: add A record `cal` → 15.204.91.183 at IONOS, then
      `certbot --nginx -d cal.impressionphotography.ca`. Until then the booking
      link in emails 4-9 won't resolve.
- [ ] **Cal.com calendar OAuth**: log in once, connect Google/Outlook calendar
      so bookings reflect real availability. Creds in `/root/.cal-com-admin-creds`.
- [ ] **Elementor pricing-form → CRM webhook.** PPM site is on IONOS (external);
      easiest path is the free "Contact Form 7 to Webhook" plugin in WP-admin,
      POSTing to the 12-Touch webhook. (Detailed in PR #27.)
- [ ] **OVH disk at ~94%.** The 121GB Windows VM at `/opt/win-vm` dominates;
      archive or move it. Redis was choking on disk pressure (band-aided with
      `stop-writes-on-bgsave-error=no`).

## Scheduling refinements
- [ ] Timezone-correct date boundaries (America/Toronto) for "due today"
- [ ] Business-days-only cadence (skip weekends)
- [ ] "This Week" projected view (compute hypothetical future touch dates
      before the prior touch is sent)

## CRM UX
- [ ] Inline Approve/Reject buttons directly in Twenty's Approvals table
- [ ] Kanban view for approvals (Pending / Approved / Sent / Rejected)
- [ ] Link Approval records to the Person record (relation) instead of matching
      on `recipientEmail` (more robust lead grouping)
