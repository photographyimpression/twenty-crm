# Impression CRM — Roadmap & Idea Parking Lot

Living list of things we've discussed but haven't built yet. The in-app
version lives in the Daily Command Center (`/command-center/`, "Roadmap" tab)
and is editable from there. This file is the developer-facing mirror.

_Last updated: 2026-06-10_

This mirrors the in-app changelog (Command Center → Roadmap tab). Categories:
🔧 fix ready · 🐞 open bug · ✨ wanted feature · 🔄 in progress · ⏳ blocked on you.

## 🔧 Fix ready (deploying this session)
- **People Name filter** — multi-word names (e.g. "Melissa de Repentigny") returned
  ALL rows because the FULL_NAME filter OR-ed each token across both subfields and
  the common token "de" matched everyone. Fixed: per-token OR-groups AND-ed together
  (`generateTokenGroupedILikeFiltersForCompositeFields`). Prod proof: buggy=1129,
  fixed=1. Committed; pending deploy + GUI re-verify of the multi-word case.

## 🐞 Open bugs (from full GUI audit 2026-06-10 — all minor/cosmetic)
- twenty-icons.com favicon 404s spam the browser console on list views.
- ⌘K command palette doesn't open on the SMS/Inbox custom pages (works elsewhere).
- SMS sidebar badge count disagrees with conversation count (unread vs total, unlabeled).
- Browser tab title stays "Twenty" on Inbox/SMS pages instead of the page name.
- 4 pre-existing TS errors in `resolveRelativeDate*.ts` (ship today; cleanup).
- Vestigial "CD deploy main" workflow fails on every push (false red X; safe to delete).
- Post-send reconcile briefly dates next touch from enrollment (self-heals < 5 min).

## ✨ Wanted features (not yet built)
- Rebrand from "Twenty" to the user's own name (awaiting the name).
- Command Center single sign-on (skip the separate login).
- **[priority]** Decouple AI opener from Pre-Phone enrollment + harden fallback.
- Multi-from sender / warming-domain rotation.
- Click-to-dial via Telnyx WebRTC inside the Command Center.
- Inline Approve/Reject buttons in the native Approvals table.
- Kanban view for approvals (Pending/Approved/Sent/Rejected).
- "This Week" preview of upcoming touches.
- Cascade scheduling refinements (timezone, business-days-only).

## 🔄 In progress (this session)
- Reply-detection auto-pause; Command Center dashboard; undo-on-send;
  true email preview with signature; keyboard shortcuts + mobile pass.

## ⏳ Blocked on you (needs your action)
- **Cal.com**: add DNS A record `cal` → 15.204.91.183 at IONOS, then certbot.
- **Elementor pricing-form → CRM webhook**: install a webhook plugin in WP-admin on
  productphotographymontreal.ca (IONOS-hosted, no API access from here).
- **Connect warming mailboxes** in Settings → Accounts to enable multi-from sending.

## Shipped
- ✅ Pre-Phone 12-email sequence (tag a Person → 12 approvals created)
- ✅ Niche-aware signature auto-attached on send
- ✅ AI-personalized opener (Ollama relay) on Touches 4-6
- ✅ Cal.com self-hosted booking link in Touches 4-9 (pending DNS)
- ✅ Fixed the broken "Execute Approved Touch" workflow (now actually sends)
- ✅ Date-gated approval views: "🔥 Due Today" + "📅 Upcoming"
- ✅ Cascade scheduler (only the next pending touch per lead is dated)
- ✅ Daily Command Center: triage send-and-next, calls, roadmap
- ✅ Post-Quote Follow-Up sequence (2026-06-10): 7 approval-gated emails for
  quoted-but-undecided leads (day 2→5→9→14→21→30→42, breakup last). Tag a
  Person with "Post-Quote Follow-Up" → 7 PENDING approvals; every send needs
  explicit approval; editable first. First real enrollee: Yair Meyers.
- ✅ Multi-sequence Command Center (2026-06-10): per-sequence cadence via
  approval.sequenceKey, sequence badge + correct "Touch N of X" on cards,
  one-active-sequence rule (graduating a lead auto-rejects stale pendings
  from the old sequence — verified in the graduation E2E test).
- ✅ Placeholder send-guard (2026-06-10): server refuses (HTTP 422) to send
  any email still containing an unfilled [PLACEHOLDER]; UI jumps straight
  into the editor. Protects the Pre-Phone touches with [PORTFOLIO_LINK] etc.

## Minor known quirk (documented, self-healing)
- Right after "Send", the immediate reconcile may briefly date the next touch
  from enrollment instead of completion (the send workflow hasn't flipped the
  approval to COMPLETED yet). The next reconcile (page load / 5-min timer)
  corrects it — verified. Fix idea: delay the post-send reconcile ~10s or
  re-run it on a timer once.

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

## INCIDENT 2026-06-10: Ollama models wiped → Pre-Phone enrollment hard-failed
- All local Ollama models (incl. `llama3.2:3b`) vanished from the OVH box —
  likely collateral from a disk cleanup (disk went 96% → 73%). The Pre-Phone
  workflow's AI-opener HTTP step then failed with "model not found", and the
  ENTIRE enrollment run failed — zero approvals created. Caught during
  Post-Quote testing; only a test contact was affected (no real leads; the
  only failed run on record is the test).
- **Worse finding:** the step has `continueOnFailure: true` and Twenty's
  engine did NOT honor it for the HTTP failure — the documented "falls back
  to undefined" behavior is wrong. The AI step is a hard single point of
  failure for Pre-Phone enrollment.
- Mitigation applied: `ollama pull llama3.2:3b` restored; enrollment
  re-verified. Post-Quote sequence has no AI step → never affected.
- **Priority fix (was nice-to-have, now important):** decouple AI opener
  generation from enrollment — create approvals instantly, fill openers in
  the background (Command Center backend can do it; touches 4-6 aren't due
  for 7+ days). Also: pin/monitor the Ollama model (health check that flags
  a missing model before it bites).

## Known limitations / AI personalization (found during 2026-05-26 GUI testing)
- **Ollama is slow on this box (no GPU).** The AI-opener step runs llama3.2:3b
  on CPU, competing with the Windows VM (qemu) for cores. A num_predict-80 call
  timed out at 60s in isolation; in the workflow it completed but made lead
  *enrollment* take ~2 min. Mitigation applied: dropped the AI step's
  num_predict 80 → 40 (full sentence, ~half the generation time). The opener
  still resolves correctly; enrollment is just not instant.
  - Real fixes (roadmap): (a) **decouple AI from enrollment** — create the 12
    approvals instantly and have the Command Center backend generate openers
    for Touches 4-6 lazily/in background (they aren't due for 7-14 days anyway);
    (b) give Ollama a GPU; (c) pre-warm the model with `keep_alive`.
- **Harden the opener fallback.** If the AI step ever times out, the template
  `{{aiStep.response}}` renders the literal word "undefined" in Touches 4-6.
  It completed fine in testing, but it should degrade to an empty string.
- NOTE: the canonical workflow builder (`scripts/setup-pre-phone-sequence.mjs`)
  lives on the PR #27 branch. The num_predict=40 change was applied directly to
  prod; fold it into that script when PR #27 merges.

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
