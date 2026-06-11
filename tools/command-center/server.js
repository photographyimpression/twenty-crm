// Daily Command Center backend.
// Holds the Twenty CRM admin API token server-side and proxies a small set of
// curated operations to the GraphQL API. The browser never sees the token.
//
// Endpoints (all under the app's mount path, e.g. /command-center/):
//   GET  /api/queue        -> due approvals + counts + paused leads (runs reconcile first)
//   POST /api/approval/:id/send   -> set APPROVED (workflow sends the email)
//   POST /api/approval/:id/skip   -> set REJECTED
//   POST /api/approval/:id/edit   -> update subject/body
//   GET  /api/approval/:id/preview -> subject/body + niche signature + fullPreviewHtml
//   GET  /api/calls        -> tasks due today (with phone if reachable)
//   POST /api/task/:id/done       -> set task status DONE
//   GET  /api/replies      -> leads detected as having replied (sequence auto-paused)
//   POST /api/resume       -> {email, sequenceKey} clear a pause so the sequence resumes
//   GET  /api/dashboard    -> per-sequence + overall metrics for the home cards
//   GET  /api/workflow-health -> active workflows whose published version has broken steps
//   GET  /api/roadmap      -> list of future ideas
//   POST /api/roadmap      -> append an idea
//   POST /api/reconcile    -> force-run the cascade scheduler (+ reply-check)
//   GET  /api/health       -> liveness + CRM reachability

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4242;
const GRAPHQL_URL =
  process.env.TWENTY_GRAPHQL_URL || 'https://crm.impressionphotography.ca/graphql';
const ROADMAP_PATH = process.env.ROADMAP_PATH || path.join(__dirname, 'roadmap.json');
// Reply-detection pause store (see reply-detection section below). Live runtime
// state — the repo keeps a seed copy but this file is the source of truth on the
// server and is gitignored like roadmap.json.
const PAUSED_STATE_PATH =
  process.env.PAUSED_STATE_PATH || path.join(__dirname, 'paused-state.json');

// The user's own mailbox (the connected Outlook account). A "reply" is an
// inbound message whose FROM participant is the LEAD — never the user. We keep
// this handy to defensively ignore the user's own address.
const USER_EMAIL = (process.env.CC_USER_EMAIL || 'moshe@impressionphotography.ca').toLowerCase();

// ---------------------------------------------------------------------------
// Auth (form login + signed-cookie session)
//
// Replaces nginx HTTP Basic Auth. A real HTML login form is what makes Chrome's
// password manager offer to save + autofill (Basic Auth popups don't get saved
// reliably). Session is a stateless HMAC-signed cookie, valid 60 days, so the
// user effectively never re-types once Chrome remembers it.
// ---------------------------------------------------------------------------

function readSecretFile(p) {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch (_e) {
    return null;
  }
}

const AUTH_RAW = readSecretFile(path.join(__dirname, '.auth')) || '';
const AUTH_USER =
  process.env.CC_USERNAME || AUTH_RAW.split(':')[0] || 'moshe';
const AUTH_PASS =
  process.env.CC_PASSWORD || AUTH_RAW.split(':').slice(1).join(':') || '';
// Persisted secret keeps sessions valid across restarts. Ephemeral fallback
// (random) means a restart logs everyone out — acceptable but not ideal.
const SESSION_SECRET =
  process.env.CC_SESSION_SECRET ||
  readSecretFile(path.join(__dirname, '.session-secret')) ||
  crypto.randomBytes(48).toString('hex');
// Public mount path (browser-visible), used for cookie scope + redirects.
const COOKIE_PATH = process.env.CC_COOKIE_PATH || '/command-center/';
const COOKIE_NAME = 'cc_session';
const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signSession(username, expMs) {
  const payload = b64url(JSON.stringify({ u: username, exp: expMs }));
  const sig = b64url(
    crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest()
  );
  return `${payload}.${sig}`;
}

function verifySession(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [payload, sig] = token.split('.');
  const expected = b64url(
    crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    );
  } catch (_e) {
    return null;
  }
  if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
  return data;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  });
  return out;
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isAuthed(req) {
  return !!verifySession(parseCookies(req)[COOKIE_NAME]);
}

// Dry-run send guard. When ON, POST /api/approval/:id/send records the intended
// send but does NOT set APPROVED and does NOT trigger the real Outlook/Telnyx
// send. This exists because an automated test once clicked Send on a live
// customer card. Any automated GUI testing MUST enable this (and use throwaway
// contacts). Toggle without restart by creating/removing the .dry-run file, or
// via the CC_DRY_RUN=1 env var. OFF by default so real approvals work normally.
function isDryRun() {
  if (process.env.CC_DRY_RUN === '1') return true;
  try {
    return fs.existsSync(path.join(__dirname, '.dry-run'));
  } catch (_e) {
    return false;
  }
}

// Token is read from a file (chmod 600) or an env var. Never logged, never
// sent to the client.
function loadToken() {
  if (process.env.TWENTY_API_TOKEN) return process.env.TWENTY_API_TOKEN.trim();
  const tokenFile = process.env.TWENTY_TOKEN_FILE || path.join(__dirname, '.token');
  return fs.readFileSync(tokenFile, 'utf8').trim();
}

const API_TOKEN = loadToken();

// Cascade GAP days keyed by sequence, then by the touch number being
// scheduled. Touch 1's gap is measured from enrollment (Pre-Phone: due
// immediately; Post-Quote: day 2 — following up minutes after "I'll think
// about it" reads desperate). Approvals without a sequenceKey are legacy
// Pre-Phone rows.
const DEFAULT_SEQUENCE = 'PRE_PHONE_EMAIL';
const SEQUENCE_GAPS = {
  PRE_PHONE_EMAIL: { 1: 0, 2: 1, 3: 2, 4: 4, 5: 3, 6: 4, 7: 4, 8: 4, 9: 6, 10: 7, 11: 10, 12: 15 },
  POST_QUOTE_FOLLOWUP: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9, 7: 12 },
};
const SEQUENCE_TOTALS = { PRE_PHONE_EMAIL: 12, POST_QUOTE_FOLLOWUP: 7 };

function seqOf(approval) {
  return approval.sequenceKey || DEFAULT_SEQUENCE;
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'REJECTED']);

// Niche → signature mapping. The real send path (email-composer.service.ts ->
// resolve-signature-placeholder.util.ts) resolves the signature from the
// RECIPIENT PERSON's `niche` field, matched against EmailSignature.niche. So
// the preview's primary source of truth is Person.niche. The approval's
// `productType` is only a fallback when the recipient isn't a CRM Person or has
// no niche set. The five niche values (PRODUCT, CLOTHING, JEWEL, AMAZON, PPM)
// map 1:1 to the EmailSignature rows; productType currently uses the same
// vocabulary, so the fallback is an identity match. PRODUCT is the catch-all
// default (matches the "Standard / Product" signature) when nothing else fits.
const KNOWN_NICHES = new Set(['PRODUCT', 'CLOTHING', 'JEWEL', 'AMAZON', 'PPM']);
const DEFAULT_NICHE = 'PRODUCT';

function normalizeNiche(value) {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return KNOWN_NICHES.has(upper) ? upper : null;
}

// ---------------------------------------------------------------------------
// GraphQL helper
// ---------------------------------------------------------------------------

async function gql(query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const json = await res.json();
  if (json.errors) {
    const message = json.errors.map((e) => e.message).join('; ');
    throw new Error(`GraphQL error: ${message}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Approval queries / mutations
// ---------------------------------------------------------------------------

const APPROVAL_FIELDS = `
  id touchNumber emailSubject emailBody recipientEmail leadName companyName
  productType actionType approvalStatus scheduledDate sequenceKey createdAt updatedAt
`;

async function fetchAllApprovals() {
  // Small dataset (tens of records); a single page of 200 is plenty.
  const data = await gql(
    `query {
      approvals(first: 200, orderBy: { createdAt: AscNullsLast }) {
        edges { node { ${APPROVAL_FIELDS} } }
      }
    }`
  );
  return data.approvals.edges.map((e) => e.node);
}

async function updateApproval(id, patch) {
  const data = await gql(
    `mutation Upd($id: UUID!, $data: ApprovalUpdateInput!) {
      updateApproval(id: $id, data: $data) { ${APPROVAL_FIELDS} }
    }`,
    { id, data: patch }
  );
  return data.updateApproval;
}

// ---------------------------------------------------------------------------
// Cascade scheduler
//
// For each lead (keyed by recipientEmail), find the highest COMPLETED touch and
// when it completed. The single lowest-numbered PENDING touch gets a date of
// (lastCompletedAt | earliest-createdAt-for-lead) + GAP[nextTouch] days. Every
// other pending touch for that lead is forced back to null so the user only
// ever sees one email per lead. Idempotent: only writes when the value differs.
// ---------------------------------------------------------------------------

function startOfDayUTC(dateLike) {
  const d = new Date(dateLike);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function addDaysISO(baseMs, days) {
  return new Date(baseMs + days * 86400000).toISOString();
}

// `pausedSet` is a Set of `${lowerEmail}|${sequenceKey}` keys for leads whose
// sequence is paused because they replied. For a paused lead+sequence we leave
// every pending touch's scheduledDate at null so it never enters the due queue,
// and we do NOT compute a next date — that's exactly what "pause" means. We
// still null out any stray dated touch so a previously-scheduled touch can't
// keep firing after the reply.
function computeScheduleWrites(approvals, pausedSet) {
  const paused = pausedSet || new Set();
  const byLead = new Map();
  for (const a of approvals) {
    const key = a.recipientEmail || `__no_email__${a.id}`;
    if (!byLead.has(key)) byLead.set(key, []);
    byLead.get(key).push(a);
  }

  const dateWrites = [];
  const rejections = [];
  for (const [, group] of byLead) {
    const pendingAll = group.filter((a) => a.approvalStatus === 'PENDING');
    if (pendingAll.length === 0) continue;

    // One active sequence per lead: the sequence of the newest pending
    // approval wins (= the most recent enrollment). Pending touches left over
    // from an older sequence are auto-rejected so the lead never receives
    // interleaved emails from two playbooks.
    const newestPending = pendingAll.reduce((acc, a) =>
      new Date(a.createdAt) > new Date(acc.createdAt) ? a : acc
    );
    const activeSeq = seqOf(newestPending);
    for (const stale of pendingAll) {
      if (seqOf(stale) !== activeSeq) {
        rejections.push({ id: stale.id, sequence: seqOf(stale) });
      }
    }

    const seqGroup = group.filter((a) => seqOf(a) === activeSeq);

    // Paused (lead replied): force all pending touches to null and skip
    // scheduling. Reconcile must not fight the pause by re-dating touch N.
    const leadEmail = (newestPending.recipientEmail || '').toLowerCase();
    if (leadEmail && paused.has(`${leadEmail}|${activeSeq}`)) {
      for (const p of seqGroup) {
        if (p.approvalStatus === 'PENDING' && p.scheduledDate !== null) {
          dateWrites.push({ id: p.id, scheduledDate: null });
        }
      }
      continue;
    }

    const completed = seqGroup.filter((a) => a.approvalStatus === 'COMPLETED');
    const pending = seqGroup
      .filter((a) => a.approvalStatus === 'PENDING')
      .sort((x, y) => x.touchNumber - y.touchNumber);

    if (pending.length === 0) continue;

    // Baseline = when this sequence's last touch completed, else the
    // sequence's earliest approval createdAt (enrollment time).
    let baselineMs;
    if (completed.length > 0) {
      const lastCompleted = completed.reduce((acc, a) =>
        a.touchNumber > acc.touchNumber ? a : acc
      );
      baselineMs = startOfDayUTC(lastCompleted.updatedAt);
    } else {
      const earliestCreated = seqGroup.reduce((acc, a) =>
        new Date(a.createdAt) < new Date(acc.createdAt) ? a : acc
      );
      baselineMs = startOfDayUTC(earliestCreated.createdAt);
    }

    const gaps = SEQUENCE_GAPS[activeSeq] || SEQUENCE_GAPS[DEFAULT_SEQUENCE];
    const next = pending[0];
    const gap = gaps[next.touchNumber] ?? 0;
    const desiredISO = addDaysISO(baselineMs, gap);

    // The immediate next pending touch gets a date.
    if (!datesEqual(next.scheduledDate, desiredISO)) {
      dateWrites.push({ id: next.id, scheduledDate: desiredISO });
    }
    // All later pending touches must be null.
    for (const later of pending.slice(1)) {
      if (later.scheduledDate !== null) {
        dateWrites.push({ id: later.id, scheduledDate: null });
      }
    }
  }
  return { dateWrites, rejections };
}

function datesEqual(existing, desiredISO) {
  if (!existing) return false;
  // Compare to day precision so we don't churn on sub-second drift.
  return startOfDayUTC(existing) === startOfDayUTC(desiredISO);
}

// ---------------------------------------------------------------------------
// Reply-detection auto-pause  (headline feature)
//
// Mechanism (and why):
//   approvalStatus has no PAUSED value (PENDING/APPROVED/COMPLETED/REJECTED)
//   and we must NOT reject a replied lead's touches (the user may want to
//   resume). So a pause is expressed two ways that the existing reconcile
//   already respects:
//     1. The lead+sequence is recorded in paused-state.json (the source of
//        truth). computeScheduleWrites() skips paused leads, and the queue
//        filter excludes them.
//     2. As a belt-and-suspenders, the paused lead's pending touches are
//        forced to scheduledDate=null (done by reconcile via computeScheduleWrites)
//        so even a stale client can't surface them.
//   Resuming = delete the paused-state entry; the next reconcile re-dates the
//   sequence's next touch normally.
//
// "Replied" = a message whose FROM participant handle equals the lead's email
// (case-insensitive) with direction INCOMING, received AFTER the baseline
// (latest COMPLETED touch's send time, else enrollment = earliest approval
// createdAt for that sequence). FROM-handle is the reliable signal: Twenty's
// thread sync also stores the user's own sent copies as INCOMING, but those
// have FROM=the user, so matching FROM=lead unambiguously means the lead wrote.
// ---------------------------------------------------------------------------

// Persisted store. Shape:
//   {
//     paused:  [ { email, sequenceKey, leadName, repliedAt, snippet, pausedAt } ],
//     resumed: [ { email, sequenceKey, resumedThrough } ]
//   }
// Keyed logically by lower(email)|sequenceKey. `resumed` is a per-lead "already
// handled up to this reply timestamp" watermark: after the user clicks Resume,
// the reply that triggered the pause no longer re-pauses the sequence — only a
// NEWER inbound reply (receivedAt > resumedThrough) pauses it again. Without
// this watermark, Resume would appear to do nothing because the still-present
// reply would re-trigger on the very next detection cycle.
function readState() {
  try {
    const raw = fs.readFileSync(PAUSED_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { paused: parsed, resumed: [] };
    return {
      paused: Array.isArray(parsed.paused) ? parsed.paused : [],
      resumed: Array.isArray(parsed.resumed) ? parsed.resumed : [],
    };
  } catch (_e) {
    return { paused: [], resumed: [] };
  }
}

function writeState(state) {
  fs.writeFileSync(
    PAUSED_STATE_PATH,
    JSON.stringify({ paused: state.paused || [], resumed: state.resumed || [] }, null, 2)
  );
}

// Back-compat thin wrappers — most callers only care about the paused list.
function readPausedState() {
  return readState().paused;
}

function writePausedState(paused) {
  const state = readState();
  state.paused = paused;
  writeState(state);
}

function pausedKey(email, sequenceKey) {
  return `${(email || '').toLowerCase()}|${sequenceKey}`;
}

function pausedSetFromState(paused) {
  return new Set(paused.map((p) => pausedKey(p.email, p.sequenceKey)));
}

// Map of pausedKey -> resumedThrough ISO string.
function resumedWatermarks(state) {
  const map = new Map();
  for (const r of (state.resumed || [])) {
    map.set(pausedKey(r.email, r.sequenceKey), r.resumedThrough);
  }
  return map;
}

// Returns the most recent inbound message the lead SENT (FROM=lead), or null.
// Resilient: on any GraphQL failure returns null so the caller treats the lead
// as "no reply" rather than breaking the queue.
async function fetchLatestInboundFromLead(email) {
  if (!email) return null;
  try {
    const data = await gql(
      `query Replies($handle: String!) {
        messageParticipants(
          first: 50
          filter: { role: { eq: FROM }, handle: { eq: $handle } }
        ) {
          edges { node { handle message { id direction subject text receivedAt } } }
        }
      }`,
      { handle: email }
    );
    const edges =
      (data && data.messageParticipants && data.messageParticipants.edges) || [];
    let latest = null;
    for (const e of edges) {
      const m = e.node && e.node.message;
      if (!m || m.direction !== 'INCOMING' || !m.receivedAt) continue;
      // Defensive: never count the user's own address as a lead reply.
      if ((e.node.handle || '').toLowerCase() === USER_EMAIL) continue;
      if (!latest || new Date(m.receivedAt) > new Date(latest.receivedAt)) {
        latest = m;
      }
    }
    return latest;
  } catch (e) {
    console.error(`[replies] message lookup failed for ${email}: ${e.message}`);
    return null;
  }
}

// For each lead with PENDING approvals, compute the active sequence + baseline
// (mirrors computeScheduleWrites), then check for an inbound reply after the
// baseline. Returns { pausedNow: [entry...], detected: [entry...] } where
// `detected` is every lead currently in a replied state (for /api/replies) and
// `pausedNow` is the subset that was newly added this run.
async function detectReplies(approvals, existingState) {
  const state = existingState || readState();
  const existing = state.paused || [];
  const existingSet = pausedSetFromState(existing);
  const resumed = resumedWatermarks(state);

  // Group pending approvals by lead → active sequence + baseline.
  const byLead = new Map();
  for (const a of approvals) {
    const key = a.recipientEmail || `__no_email__${a.id}`;
    if (!byLead.has(key)) byLead.set(key, []);
    byLead.get(key).push(a);
  }

  const detected = [...existing]; // start from what's already paused
  const detectedKeys = new Set(existingSet);
  const pausedNow = [];

  for (const [, group] of byLead) {
    const pendingAll = group.filter((a) => a.approvalStatus === 'PENDING');
    if (pendingAll.length === 0) continue;

    const newestPending = pendingAll.reduce((acc, a) =>
      new Date(a.createdAt) > new Date(acc.createdAt) ? a : acc
    );
    const activeSeq = seqOf(newestPending);
    const email = (newestPending.recipientEmail || '').toLowerCase();
    if (!email) continue;

    const key = pausedKey(email, activeSeq);
    if (detectedKeys.has(key)) continue; // already paused — nothing to do

    const seqGroup = group.filter((a) => seqOf(a) === activeSeq);
    const completed = seqGroup.filter((a) => a.approvalStatus === 'COMPLETED');
    let baselineMs;
    if (completed.length > 0) {
      const lastCompleted = completed.reduce((acc, a) =>
        a.touchNumber > acc.touchNumber ? a : acc
      );
      baselineMs = new Date(lastCompleted.updatedAt).getTime();
    } else {
      const earliest = seqGroup.reduce((acc, a) =>
        new Date(a.createdAt) < new Date(acc.createdAt) ? a : acc
      );
      baselineMs = new Date(earliest.createdAt).getTime();
    }

    // A Resume sets a watermark — replies up to that point are "already
    // handled" and don't re-pause. Effective baseline is the later of the
    // touch baseline and the resume watermark.
    const resumedThrough = resumed.get(key);
    if (resumedThrough) {
      baselineMs = Math.max(baselineMs, new Date(resumedThrough).getTime());
    }

    const latest = await fetchLatestInboundFromLead(email);
    if (!latest) continue;
    if (new Date(latest.receivedAt).getTime() <= baselineMs) continue;

    const snippet = (latest.text || latest.subject || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const entry = {
      email,
      sequenceKey: activeSeq,
      leadName: newestPending.leadName || null,
      repliedAt: latest.receivedAt,
      snippet,
      pausedAt: new Date().toISOString(),
    };
    detected.push(entry);
    detectedKeys.add(key);
    pausedNow.push(entry);
    console.log(
      `[replies] pausing ${activeSeq} for ${email} — replied ${latest.receivedAt} (baseline ${new Date(baselineMs).toISOString()})`
    );
  }

  if (pausedNow.length > 0) writePausedState(detected);
  return { detected, pausedNow };
}

let reconcileInFlight = null;

async function reconcile() {
  // Coalesce concurrent reconciles (page-load + timer) into one run.
  if (reconcileInFlight) return reconcileInFlight;
  reconcileInFlight = (async () => {
    const approvals = await fetchAllApprovals();

    // Reply check first so newly-replied leads are paused before we schedule.
    // Fully isolated: any failure here must not break scheduling/queue.
    let replyResult = { detected: readPausedState(), pausedNow: [] };
    try {
      replyResult = await detectReplies(approvals);
    } catch (e) {
      console.error('[replies] detection failed (continuing):', e.message);
    }
    const pausedSet = pausedSetFromState(replyResult.detected);

    const { dateWrites, rejections } = computeScheduleWrites(approvals, pausedSet);
    for (const r of rejections) {
      console.log(`[reconcile] auto-rejecting stale ${r.sequence} approval ${r.id} (superseded by newer sequence)`);
      await updateApproval(r.id, { approvalStatus: 'REJECTED' });
    }
    for (const w of dateWrites) {
      await updateApproval(w.id, { scheduledDate: w.scheduledDate });
    }
    return {
      written: dateWrites.length,
      rejected: rejections.length,
      total: approvals.length,
      paused: pausedSet.size,
      newlyPaused: replyResult.pausedNow.length,
    };
  })();
  try {
    return await reconcileInFlight;
  } finally {
    reconcileInFlight = null;
  }
}

// ---------------------------------------------------------------------------
// Signatures + final-email preview
//
// Mirrors the real send path (email-composer.service.ts): the signature is
// chosen by the RECIPIENT PERSON's `niche`, matched to an EmailSignature row.
// We replicate that here so the user sees exactly what goes out. If the
// recipient isn't a CRM person / has no niche, we fall back to the approval's
// productType, then to PRODUCT (the "Standard / Product" catch-all).
// ---------------------------------------------------------------------------

// Cache the niche→signatureHtml map briefly; signatures change rarely and this
// avoids a query per preview. 5-minute TTL.
let signatureCache = { at: 0, byNiche: null };
const SIGNATURE_CACHE_TTL_MS = 5 * 60 * 1000;

async function getSignaturesByNiche() {
  if (signatureCache.byNiche && Date.now() - signatureCache.at < SIGNATURE_CACHE_TTL_MS) {
    return signatureCache.byNiche;
  }
  const data = await gql(
    `query {
      emailSignatures(first: 50) {
        edges { node { id name niche signatureHtml } }
      }
    }`
  );
  const byNiche = {};
  for (const e of (data.emailSignatures.edges || [])) {
    const n = e.node;
    if (n.niche) byNiche[n.niche] = { id: n.id, name: n.name, signatureHtml: n.signatureHtml || '' };
  }
  signatureCache = { at: Date.now(), byNiche };
  return byNiche;
}

// Look up the recipient person's niche by email (matches the real send path's
// person.niche lookup). Returns null if not a known person / no niche.
async function fetchPersonNiche(email) {
  if (!email) return null;
  try {
    const data = await gql(
      `query PersonNiche($email: String!) {
        people(first: 1, filter: { emails: { primaryEmail: { ilike: $email } } }) {
          edges { node { id niche name { firstName lastName } } }
        }
      }`,
      { email }
    );
    const node = (((data.people || {}).edges || [])[0] || {}).node;
    return node ? normalizeNiche(node.niche) : null;
  } catch (e) {
    console.error(`[preview] person niche lookup failed for ${email}: ${e.message}`);
    return null;
  }
}

// The real composer appends the signature to the rendered HTML body. Approvals
// store emailBody as text/markup; we wrap it minimally so the preview renders
// as the recipient will see it (body, blank line, then signature HTML).
function buildFullPreviewHtml(emailBody, signatureHtml) {
  const bodyHtml = textBodyToHtml(emailBody || '');
  if (!signatureHtml) return bodyHtml;
  return `${bodyHtml}<br><br>${signatureHtml}`;
}

// Minimal text→HTML: if the body already looks like HTML, pass through;
// otherwise escape and convert newlines to <br>. The real path renders
// react-email markup; for a preview this is a faithful-enough approximation
// and never injects unescaped user text into markup.
function textBodyToHtml(body) {
  const looksHtml = /<[a-z][\s\S]*>/i.test(body);
  if (looksHtml) return body;
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\r\n|\r|\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// Workflow-validity lint
//
// Read-only health check over ACTIVE workflows' published versions. Flags the
// class of silent-failure bug that once let "Execute Approved Touch" no-op:
//   - any step with valid === false
//   - SEND_EMAIL with empty recipients.to
//   - UPDATE_RECORD that is a no-op (empty objectRecordId AND empty fieldsToUpdate)
//   - empty/missing steps array on an active workflow
// Note: an empty connectedAccountId on SEND_EMAIL is intentional (falls back to
// the first connected account), so it is NOT flagged.
// ---------------------------------------------------------------------------

function stepProblems(step) {
  const problems = [];
  const type = step && step.type;
  const input = (step && step.settings && step.settings.input) || {};

  if (step && step.valid === false) {
    problems.push(`step "${step.name || type || step.id}" is marked valid:false`);
  }

  if (type === 'SEND_EMAIL') {
    const to = ((input.recipients || {}).to || '').toString().trim();
    if (!to) problems.push(`SEND_EMAIL step "${step.name || step.id}" has empty recipients.to`);
  }

  if (type === 'UPDATE_RECORD') {
    const recordId = (input.objectRecordId || '').toString().trim();
    const fields = Array.isArray(input.fieldsToUpdate) ? input.fieldsToUpdate : [];
    if (!recordId && fields.length === 0) {
      problems.push(
        `UPDATE_RECORD step "${step.name || step.id}" is a no-op (empty objectRecordId and no fieldsToUpdate)`
      );
    }
  }

  return problems;
}

async function computeWorkflowHealth() {
  const data = await gql(
    `query {
      workflows(first: 100) {
        edges { node {
          id name statuses lastPublishedVersionId
          versions(first: 50) { edges { node { id status steps } } }
        } }
      }
    }`
  );

  const results = [];
  for (const e of (data.workflows.edges || [])) {
    const wf = e.node;
    const isActive = Array.isArray(wf.statuses) && wf.statuses.includes('ACTIVE');
    if (!isActive) continue;

    // The published version is the one whose id == lastPublishedVersionId;
    // fall back to any ACTIVE-status version.
    const versions = (wf.versions.edges || []).map((v) => v.node);
    const published =
      versions.find((v) => v.id === wf.lastPublishedVersionId) ||
      versions.find((v) => v.status === 'ACTIVE') ||
      null;

    const problems = [];
    if (!published) {
      problems.push('no published version found for an ACTIVE workflow');
    } else {
      const steps = Array.isArray(published.steps) ? published.steps : [];
      if (steps.length === 0) {
        problems.push('published version has no steps');
      }
      for (const step of steps) {
        for (const p of stepProblems(step)) problems.push(p);
      }
    }

    if (problems.length > 0) {
      results.push({
        workflowName: wf.name,
        workflowId: wf.id,
        versionStatus: published ? published.status : null,
        publishedVersionId: published ? published.id : null,
        problems,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Dashboard metrics
// ---------------------------------------------------------------------------

async function computeDashboard() {
  const approvals = await fetchAllApprovals();
  const pausedList = readPausedState();
  const pausedSet = pausedSetFromState(pausedList);
  const endOfTodayMs = startOfDayUTC(new Date()) + 86400000 - 1;

  const SEQUENCES = ['PRE_PHONE_EMAIL', 'POST_QUOTE_FOLLOWUP'];
  const perSequence = {};
  for (const seq of SEQUENCES) {
    perSequence[seq] = {
      enrolled: 0, // distinct leads with >= 1 PENDING (not paused)
      emailsSent: 0, // COMPLETED touches
      dueToday: 0, // PENDING + scheduled <= today + not paused
      pausedReplied: 0, // distinct leads paused due to reply
      total: SEQUENCE_TOTALS[seq] || null,
    };
  }

  const enrolledLeads = { PRE_PHONE_EMAIL: new Set(), POST_QUOTE_FOLLOWUP: new Set() };
  for (const a of approvals) {
    const seq = seqOf(a);
    if (!perSequence[seq]) continue;
    const email = (a.recipientEmail || '').toLowerCase();
    const isPaused = email && pausedSet.has(pausedKey(email, seq));

    if (a.approvalStatus === 'COMPLETED') perSequence[seq].emailsSent += 1;
    if (a.approvalStatus === 'PENDING' && !isPaused) {
      if (email) enrolledLeads[seq].add(email);
      if (a.scheduledDate && new Date(a.scheduledDate).getTime() <= endOfTodayMs) {
        perSequence[seq].dueToday += 1;
      }
    }
  }
  for (const seq of SEQUENCES) {
    perSequence[seq].enrolled = enrolledLeads[seq].size;
    perSequence[seq].pausedReplied = pausedList.filter((p) => p.sequenceKey === seq).length;
  }

  // Overall counts. People/companies via totalCount (cheap). Opportunities sum
  // amounts (micros) if the field exists; tasks/calls due today.
  const overall = {
    totalPeople: 0,
    totalCompanies: 0,
    opportunities: { count: 0, totalAmountMicros: 0, totalAmount: 0, currencyCode: null },
    tasksDueToday: 0,
    callsDueToday: 0,
    repliesPaused: pausedList.length,
  };

  try {
    const counts = await gql(
      `query {
        people(first: 0) { totalCount }
        companies(first: 0) { totalCount }
      }`
    );
    overall.totalPeople = counts.people.totalCount;
    overall.totalCompanies = counts.companies.totalCount;
  } catch (e) {
    console.error('[dashboard] people/companies count failed:', e.message);
  }

  try {
    // Opportunities amount is a currency composite { amountMicros, currencyCode }.
    const opp = await gql(
      `query {
        opportunities(first: 200) {
          totalCount
          edges { node { amount { amountMicros currencyCode } } }
        }
      }`
    );
    overall.opportunities.count = opp.opportunities.totalCount;
    let micros = 0;
    let currency = null;
    for (const e of (opp.opportunities.edges || [])) {
      const amt = e.node && e.node.amount;
      if (amt && typeof amt.amountMicros === 'number') micros += amt.amountMicros;
      else if (amt && amt.amountMicros) micros += Number(amt.amountMicros) || 0;
      if (amt && amt.currencyCode && !currency) currency = amt.currencyCode;
    }
    overall.opportunities.totalAmountMicros = micros;
    overall.opportunities.totalAmount = Math.round(micros / 1000000);
    overall.opportunities.currencyCode = currency;
  } catch (e) {
    console.error('[dashboard] opportunities query failed:', e.message);
  }

  try {
    const tasks = await gql(
      `query {
        tasks(first: 200, orderBy: { dueAt: AscNullsLast }) {
          edges { node { id status dueAt title } }
        }
      }`
    );
    const nodes = (tasks.tasks.edges || []).map((e) => e.node).filter((t) => t.status !== 'DONE' && t.dueAt && new Date(t.dueAt).getTime() <= endOfTodayMs);
    overall.tasksDueToday = nodes.length;
    // "Calls" = tasks due today whose title hints at a call. The /api/calls
    // route uses the same due-task set; we approximate the call subset here.
    overall.callsDueToday = nodes.filter((t) => /call|phone|dial|ring/i.test(t.title || '')).length;
  } catch (e) {
    console.error('[dashboard] tasks query failed:', e.message);
  }

  return {
    generatedAt: new Date().toISOString(),
    sequences: perSequence,
    overall,
  };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' })); // login form posts

// Behind nginx; trust the proxy for correct protocol/IP.
app.set('trust proxy', true);

// ---- Auth routes (no session required) -------------------------------------

// Login page — a real HTML form so Chrome offers to save + autofill.
app.get('/login', (req, res) => {
  if (isAuthed(req)) return res.redirect(COOKIE_PATH);
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login submit. On success: set the session cookie + redirect to the app
// (a successful navigation away from the login page is what triggers Chrome's
// "Save password?" prompt). On failure: back to the login form with ?e=1.
app.post('/login', (req, res) => {
  const u = (req.body.username || '').toString();
  const p = (req.body.password || '').toString();
  const ok =
    AUTH_PASS.length > 0 &&
    constantTimeEqual(u, AUTH_USER) &&
    constantTimeEqual(p, AUTH_PASS);
  if (!ok) {
    return res.redirect(COOKIE_PATH + 'login?e=1');
  }
  const token = signSession(AUTH_USER, Date.now() + SESSION_TTL_MS);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: SESSION_TTL_MS,
  });
  res.redirect(COOKIE_PATH);
});

app.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: COOKIE_PATH });
  res.redirect(COOKIE_PATH + 'login');
});

const api = express.Router();

api.get('/health', async (_req, res) => {
  let crmOk = false;
  try {
    await gql('query { approvals(first: 1) { totalCount } }');
    crmOk = true;
  } catch (_e) {
    crmOk = false;
  }
  res.json({ ok: true, crmReachable: crmOk, port: PORT });
});

api.get('/queue', async (_req, res) => {
  try {
    // Reconcile first so scheduledDate reflects reality, then read the queue.
    let reconcileResult = null;
    try {
      reconcileResult = await reconcile();
    } catch (e) {
      reconcileResult = { error: e.message };
    }

    const approvals = await fetchAllApprovals();
    const endOfTodayMs = startOfDayUTC(new Date()) + 86400000 - 1;

    // Exclude leads whose sequence is paused (they replied). The UI gets them
    // separately in `paused` so it can show "paused — lead replied".
    const pausedList = readPausedState();
    const pausedSet = pausedSetFromState(pausedList);

    const due = approvals
      .filter(
        (a) =>
          a.approvalStatus === 'PENDING' &&
          a.scheduledDate &&
          new Date(a.scheduledDate).getTime() <= endOfTodayMs &&
          !pausedSet.has(pausedKey(a.recipientEmail, seqOf(a)))
      )
      .sort((x, y) => {
        const dx = new Date(x.scheduledDate).getTime();
        const dy = new Date(y.scheduledDate).getTime();
        if (dx !== dy) return dx - dy;
        return x.touchNumber - y.touchNumber;
      })
      .map((a) => ({
        ...a,
        sequenceKey: seqOf(a),
        sequenceTotal: SEQUENCE_TOTALS[seqOf(a)] || SEQUENCE_TOTALS[DEFAULT_SEQUENCE],
      }));

    // `paused` mirrors the paused-state entries (email, sequenceKey, leadName,
    // repliedAt, snippet, pausedAt) so the UI can render a "Replied / paused"
    // section with a Resume button (POST /api/resume {email, sequenceKey}).
    res.json({ due, count: due.length, paused: pausedList, reconcile: reconcileResult });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Anything like [PORTFOLIO_LINK] / [BEFORE_AFTER_LINK] left in a template is
// an unfilled placeholder — block the send until the user edits it out.
const PLACEHOLDER_RE = /\[[A-Z0-9_]{2,}\]/;

api.post('/approval/:id/send', async (req, res) => {
  try {
    // Guard: refuse to send an email that still contains an unresolved
    // [PLACEHOLDER]. Fetch the current record server-side so the check can't
    // be bypassed by a stale client.
    const all = await fetchAllApprovals();
    const current = all.find((a) => a.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Approval not found' });
    const placeholderHit = `${current.emailSubject || ''}\n${current.emailBody || ''}`.match(PLACEHOLDER_RE);
    if (placeholderHit) {
      return res.status(422).json({
        error: `This email still contains ${placeholderHit[0]} — hit Edit and replace it before sending.`,
        placeholder: placeholderHit[0],
      });
    }

    // Dry-run guard: never let an automated test fire a real send.
    if (isDryRun()) {
      return res.json({
        ok: true,
        dryRun: true,
        message: 'DRY RUN — approval NOT set, no email sent',
        wouldSend: {
          id: current.id,
          to: current.recipientEmail,
          subject: current.emailSubject,
          touchNumber: current.touchNumber,
          sequenceKey: current.sequenceKey,
        },
      });
    }

    // "Send" = set APPROVED; the Twenty workflow does the actual send + flips
    // to COMPLETED.
    const updated = await updateApproval(req.params.id, { approvalStatus: 'APPROVED' });
    // Re-date the next touch for this lead right away.
    try {
      await reconcile();
    } catch (_e) {
      /* non-fatal */
    }
    res.json({ ok: true, approval: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

api.post('/approval/:id/skip', async (req, res) => {
  try {
    const updated = await updateApproval(req.params.id, { approvalStatus: 'REJECTED' });
    try {
      await reconcile();
    } catch (_e) {
      /* non-fatal */
    }
    res.json({ ok: true, approval: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

api.post('/approval/:id/edit', async (req, res) => {
  try {
    const patch = {};
    if (typeof req.body.emailSubject === 'string') patch.emailSubject = req.body.emailSubject;
    if (typeof req.body.emailBody === 'string') patch.emailBody = req.body.emailBody;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const updated = await updateApproval(req.params.id, patch);
    res.json({ ok: true, approval: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

api.post('/reconcile', async (_req, res) => {
  try {
    const result = await reconcile();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Final-email preview (body + niche signature) ---------------------------
//
// GET /api/approval/:id/preview
// Response: {
//   subject, body,                         // raw approval fields
//   niche, nicheSource,                    // resolved niche + 'person'|'productType'|'default'
//   signatureName, signatureHtml,          // the signature that will be appended
//   fullPreviewHtml                        // body rendered + signature, as it will go out
// }
api.get('/approval/:id/preview', async (req, res) => {
  try {
    const all = await fetchAllApprovals();
    const approval = all.find((a) => a.id === req.params.id);
    if (!approval) return res.status(404).json({ error: 'Approval not found' });

    // Resolve niche the way the real send does: recipient person's niche first,
    // then the approval's productType, then PRODUCT.
    const personNiche = await fetchPersonNiche(approval.recipientEmail);
    const productNiche = normalizeNiche(approval.productType);
    let niche = personNiche;
    let nicheSource = 'person';
    if (!niche) {
      niche = productNiche;
      nicheSource = productNiche ? 'productType' : 'default';
    }
    if (!niche) niche = DEFAULT_NICHE;

    const byNiche = await getSignaturesByNiche();
    let sig = byNiche[niche] || null;
    // If the resolved niche has no signature row, fall back to PRODUCT so the
    // preview still shows the catch-all the recipient would actually get.
    if (!sig && niche !== DEFAULT_NICHE) {
      sig = byNiche[DEFAULT_NICHE] || null;
      if (sig) nicheSource += '->default-sig';
    }

    const signatureHtml = sig ? sig.signatureHtml : '';
    res.json({
      id: approval.id,
      subject: approval.emailSubject || '',
      body: approval.emailBody || '',
      recipientEmail: approval.recipientEmail || null,
      niche,
      nicheSource,
      signatureName: sig ? sig.name : null,
      signatureHtml,
      fullPreviewHtml: buildFullPreviewHtml(approval.emailBody, signatureHtml),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Reply detection: list + resume -----------------------------------------
//
// GET /api/replies -> { replies: [ { leadName, email, sequenceKey, repliedAt,
//   snippet, pausedAt } ] }. Runs a fresh detection pass so the list is current.
api.get('/replies', async (_req, res) => {
  try {
    let detected = readPausedState();
    try {
      const approvals = await fetchAllApprovals();
      const result = await detectReplies(approvals);
      detected = result.detected;
    } catch (e) {
      // Detection failure: serve the persisted state rather than erroring.
      console.error('[replies] route detection failed (serving stored):', e.message);
    }
    const replies = detected.map((p) => ({
      leadName: p.leadName || null,
      email: p.email,
      sequenceKey: p.sequenceKey,
      repliedAt: p.repliedAt,
      snippet: p.snippet || '',
      pausedAt: p.pausedAt,
    }));
    res.json({ replies, count: replies.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/resume { email, sequenceKey } -> clears the pause; next reconcile
// re-dates the sequence's next touch normally.
api.post('/resume', async (req, res) => {
  try {
    const email = (req.body.email || '').toString().trim().toLowerCase();
    const sequenceKey = (req.body.sequenceKey || '').toString().trim();
    if (!email || !sequenceKey) {
      return res.status(400).json({ error: 'email and sequenceKey are required' });
    }
    const state = readState();
    const key = pausedKey(email, sequenceKey);
    const pausedEntry = state.paused.find((p) => pausedKey(p.email, p.sequenceKey) === key);
    if (!pausedEntry) {
      return res.status(404).json({ error: 'No matching paused lead found', email, sequenceKey });
    }

    // Remove the pause, and set a resume watermark = the reply we just cleared
    // (fallback: now). The already-seen reply will no longer re-pause; only a
    // NEWER inbound reply does. This is what makes Resume actually resume.
    state.paused = state.paused.filter((p) => pausedKey(p.email, p.sequenceKey) !== key);
    const resumedThrough = pausedEntry.repliedAt || new Date().toISOString();
    state.resumed = (state.resumed || []).filter(
      (r) => pausedKey(r.email, r.sequenceKey) !== key
    );
    state.resumed.push({ email, sequenceKey, resumedThrough });
    writeState(state);

    // Re-date the resumed lead's next touch right away.
    try {
      await reconcile();
    } catch (_e) {
      /* non-fatal */
    }
    res.json({ ok: true, resumed: { email, sequenceKey, resumedThrough }, paused: state.paused });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Dashboard metrics ------------------------------------------------------
// GET /api/dashboard -> { generatedAt, sequences: { <SEQ>: { enrolled,
//   emailsSent, dueToday, pausedReplied, total } }, overall: { totalPeople,
//   totalCompanies, opportunities: { count, totalAmount, totalAmountMicros,
//   currencyCode }, tasksDueToday, callsDueToday, repliesPaused } }
api.get('/dashboard', async (_req, res) => {
  try {
    const dashboard = await computeDashboard();
    res.json(dashboard);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Workflow-validity lint -------------------------------------------------
// GET /api/workflow-health -> { problems: [ { workflowName, workflowId,
//   versionStatus, publishedVersionId, problems: [string] } ], healthy: bool }
api.get('/workflow-health', async (_req, res) => {
  try {
    const problems = await computeWorkflowHealth();
    res.json({ problems, count: problems.length, healthy: problems.length === 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Calls due today --------------------------------------------------------

api.get('/calls', async (_req, res) => {
  try {
    const data = await gql(
      `query {
        tasks(first: 100, orderBy: { dueAt: AscNullsLast }) {
          edges { node {
            id title status dueAt
            taskTargets { edges { node {
              targetPerson {
                name { firstName lastName }
                phones { primaryPhoneNumber primaryPhoneCallingCode }
                emails { primaryEmail }
              }
            } } }
          } }
        }
      }`
    );

    const endOfTodayMs = startOfDayUTC(new Date()) + 86400000 - 1;
    const calls = data.tasks.edges
      .map((e) => e.node)
      .filter((t) => t.status !== 'DONE' && t.dueAt && new Date(t.dueAt).getTime() <= endOfTodayMs)
      .map((t) => {
        const target = (t.taskTargets.edges[0] || {}).node;
        const person = target && target.targetPerson;
        let phone = null;
        let displayName = null;
        if (person) {
          if (person.name) {
            displayName = [person.name.firstName, person.name.lastName]
              .filter(Boolean)
              .join(' ')
              .trim();
          }
          if (person.phones && person.phones.primaryPhoneNumber) {
            const cc = person.phones.primaryPhoneCallingCode || '';
            phone = `${cc}${person.phones.primaryPhoneNumber}`.trim();
          }
        }
        return {
          id: t.id,
          title: t.title,
          dueAt: t.dueAt,
          personName: displayName || null,
          phone,
        };
      })
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    res.json({ calls, count: calls.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

api.post('/task/:id/done', async (req, res) => {
  try {
    const data = await gql(
      `mutation Done($id: UUID!) {
        updateTask(id: $id, data: { status: DONE }) { id status }
      }`,
      { id: req.params.id }
    );
    res.json({ ok: true, task: data.updateTask });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Roadmap store ----------------------------------------------------------

const SEED_ROADMAP = [
  'Cascade scheduling refinements (timezone handling, business-days-only)',
  'Multi-from sender / warming-domain rotation (needs extra Outlook mailboxes connected)',
  'Auto-pause sequence when a lead replies (needs Microsoft Graph webhook)',
  'Cal.com DNS + calendar OAuth (cal.impressionphotography.ca A record at IONOS, then certbot)',
  'Elementor pricing-form -> CRM webhook (PPM site is on IONOS, needs WP plugin)',
  'Click-to-dial via Telnyx WebRTC inside command center',
  "Inline Approve/Reject buttons directly in Twenty's Approvals table",
  'Kanban view for approvals (Pending/Approved/Sent/Rejected)',
  '"This Week" preview of upcoming touches (projected dates)',
];

function readRoadmap() {
  try {
    const raw = fs.readFileSync(ROADMAP_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    return [];
  } catch (_e) {
    // Seed on first run.
    const seeded = SEED_ROADMAP.map((text, i) => ({
      id: `seed-${i + 1}`,
      text,
      done: false,
      createdAt: new Date().toISOString(),
    }));
    writeRoadmap(seeded);
    return seeded;
  }
}

function writeRoadmap(items) {
  fs.writeFileSync(ROADMAP_PATH, JSON.stringify(items, null, 2));
}

api.get('/roadmap', (_req, res) => {
  res.json({ items: readRoadmap() });
});

api.post('/roadmap', (req, res) => {
  const text = (req.body.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'Empty idea' });
  const items = readRoadmap();
  const item = {
    id: `idea-${Date.now()}`,
    text,
    done: false,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  writeRoadmap(items);
  res.json({ ok: true, item, items });
});

// API guard: everything under /api needs a valid session, except /health.
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'auth required' });
});
app.use('/api', api);

// Page guard: unauthenticated browser hits get bounced to the login form
// (so the SPA never loads without a session).
app.use((req, res, next) => {
  if (isAuthed(req)) return next();
  if (req.path === '/login' || req.path.startsWith('/login')) return next();
  return res.redirect(COOKIE_PATH + 'login');
});

// Static frontend.
app.use('/', express.static(path.join(__dirname, 'public')));

// Periodic reconcile every 5 minutes.
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  reconcile().catch((e) => console.error('[reconcile] failed:', e.message));
}, RECONCILE_INTERVAL_MS);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Command Center backend listening on 127.0.0.1:${PORT}`);
  // Kick an initial reconcile + roadmap seed on boot.
  reconcile()
    .then((r) => console.log('[reconcile] startup:', JSON.stringify(r)))
    .catch((e) => console.error('[reconcile] startup failed:', e.message));
  readRoadmap();
});
