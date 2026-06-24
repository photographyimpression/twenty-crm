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
  // Accept either the CC's own form-login session OR a valid CRM tokenPair
  // cookie (single sign-on). Checking the cheap cc_session first avoids the
  // HMAC work on the CRM token for already-CC-authed requests.
  if (verifySession(parseCookies(req)[COOKIE_NAME])) return true;
  if (verifyCrmTokenPairCookie(req)) return true;
  return false;
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

// ---------------------------------------------------------------------------
// Single sign-on with the CRM (read-only verification of the CRM's own cookie)
//
// The Command Center is served at crm.impressionphotography.ca/command-center/
// — the SAME origin as the CRM — so it can read the CRM's cookies. The CRM
// stores a `tokenPair` cookie (js-cookie URL-encodes a JSON blob:
//   { accessOrWorkspaceAgnosticToken: { token, expiresAt }, ... } )
// whose `token` is an HS256 JWT signed by the server with the per-workspace
// derived secret:  sha256(APP_SECRET + workspaceId + "ACCESS")  (hex digest).
// (See jwt-wrapper.service.ts generateAppSecret.) If Moshe is logged into the
// CRM, we accept that JWT here so he isn't prompted for a second login. The
// existing cc_session form-login stays as a fallback.
//
// SECURITY: the JWT secret is NEVER hardcoded in the repo. APP_SECRET is read
// at startup from the CC_APP_SECRET env var or /opt/twenty/.env. If neither is
// available the SSO path is simply disabled (cc_session still works).
// ---------------------------------------------------------------------------

// Read a single KEY=value line out of an env file (handles optional quotes).
function readEnvValueFromFile(filePath, key) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const re = new RegExp(`^${key}=(.*)$`, 'm');
    const m = raw.match(re);
    if (!m) return null;
    let v = m[1].trim();
    // Strip a single layer of matching surrounding quotes.
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v || null;
  } catch (_e) {
    return null;
  }
}

const TWENTY_ENV_PATH = process.env.CC_TWENTY_ENV_PATH || '/opt/twenty/.env';

// APP_SECRET: env var first, then the Twenty .env on disk. Never logged.
const APP_SECRET =
  process.env.CC_APP_SECRET ||
  readEnvValueFromFile(TWENTY_ENV_PATH, 'APP_SECRET') ||
  null;

// Decode a JWT/base64url payload without verifying — used only to read the
// workspaceId out of the existing API token at startup. Returns null on any
// malformation.
function decodeJwtPayloadUnsafe(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const json = Buffer.from(
      part.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    return JSON.parse(json);
  } catch (_e) {
    return null;
  }
}

// workspaceId: env var first, else read from the API token's payload (the CC's
// own admin token is scoped to exactly this workspace).
const WORKSPACE_ID =
  process.env.CC_WORKSPACE_ID ||
  (decodeJwtPayloadUnsafe(API_TOKEN) || {}).workspaceId ||
  null;

// The per-workspace derived secret the CRM uses to sign ACCESS tokens.
// sha256(APP_SECRET + workspaceId + "ACCESS") as a hex string.
function derivedAccessSecret() {
  if (!APP_SECRET || !WORKSPACE_ID) return null;
  return crypto
    .createHash('sha256')
    .update(`${APP_SECRET}${WORKSPACE_ID}ACCESS`)
    .digest('hex');
}
const CRM_ACCESS_SECRET = derivedAccessSecret();
const SSO_ENABLED = !!CRM_ACCESS_SECRET;

// Verify an HS256 JWT against `secret`, checking signature + exp. Returns the
// decoded payload on success, null otherwise. Self-contained (no jsonwebtoken
// dependency) so it works against the CC's minimal node_modules.
function verifyHs256Jwt(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header;
  try {
    header = JSON.parse(
      Buffer.from(headerB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    );
  } catch (_e) {
    return null;
  }
  if (!header || header.alg !== 'HS256') return null;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = decodeJwtPayloadUnsafe(token);
  if (!payload) return null;
  // exp is in SECONDS (standard JWT). Reject if expired.
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    return null;
  }
  return payload;
}

// Pull the CRM access JWT out of the `tokenPair` cookie and verify it with the
// derived secret. The cookie value is JSON: parseCookies already URL-decoded it.
function verifyCrmTokenPairCookie(req) {
  if (!SSO_ENABLED) return null;
  const raw = parseCookies(req).tokenPair;
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return null;
  }
  const token =
    parsed &&
    parsed.accessOrWorkspaceAgnosticToken &&
    parsed.accessOrWorkspaceAgnosticToken.token;
  if (!token) return null;
  const payload = verifyHs256Jwt(token, CRM_ACCESS_SECRET);
  if (!payload) return null;
  // Belt-and-suspenders: only accept tokens scoped to OUR workspace.
  if (payload.workspaceId && payload.workspaceId !== WORKSPACE_ID) return null;
  return payload;
}

// Cascade GAP days keyed by sequence, then by the touch number being
// scheduled. Touch 1's gap is measured from enrollment (Pre-Phone: due
// immediately; Post-Quote: day 2 — following up minutes after "I'll think
// about it" reads desperate). Approvals without a sequenceKey are legacy
// Pre-Phone rows.
const DEFAULT_SEQUENCE = 'PRE_PHONE_EMAIL';

// ---------------------------------------------------------------------------
// Lazy AI-opener generation (Part 2 of the Ollama-decoupling work)
//
// The Pre-Phone workflow used to call Ollama mid-enrollment to write a
// personalized opener for touches 4-6. Twenty's engine does NOT honour
// continueOnFailure on HTTP_REQUEST steps, so a wiped/slow model killed the
// whole enrollment and created ZERO approvals (2026-06-10 incident). The
// workflow no longer touches Ollama at all — enrollment is pure CREATE_RECORD.
//
// Instead we generate the opener here, lazily and best-effort, during
// reconcile(): for each PENDING Pre-Phone touch 4/5/6 whose body is still the
// plain template (no opener yet), we ask the relay for a 1-sentence opener and
// splice it in right after the "Hi <first>," greeting. If Ollama is down or
// slow we skip gracefully and try again next reconcile. This pass NEVER throws
// out of reconcile.
// ---------------------------------------------------------------------------

const OLLAMA_RELAY_URL =
  process.env.CC_OLLAMA_RELAY_URL ||
  'https://crm.impressionphotography.ca/ollama-relay/api/generate';
const OLLAMA_MODEL = process.env.CC_OLLAMA_MODEL || 'llama3.2:3b';
const OLLAMA_TIMEOUT_MS = Number(process.env.CC_OLLAMA_TIMEOUT_MS || 25000);
// Relay bearer token: env first, then the on-disk relay-token file (same one
// the OVH host keeps at /root/.ollama-relay-token), then the local copy that
// ships next to the app. Read once at startup; never logged.
const OLLAMA_RELAY_TOKEN =
  process.env.CC_OLLAMA_RELAY_TOKEN ||
  readSecretFile('/root/.ollama-relay-token') ||
  readSecretFile(path.join(__dirname, '.ollama-relay-token')) ||
  '';

// In-flight real-lead sequences that must NOT be retro-edited by the lazy
// opener pass. These leads were enrolled before the Ollama decoupling and have
// hand-reviewed bodies; rewriting them now would change copy already vetted for
// a live recipient. New enrollments (incl. future real leads and test leads)
// are unaffected and still get openers. Override/extend via CC_OPENER_SKIP_EMAILS
// (comma-separated). The feature stays fully functional for everyone else.
const OPENER_SKIP_EMAILS = new Set(
  (process.env.CC_OPENER_SKIP_EMAILS ||
    'txdoorcompany@gmail.com,4cornerstzitzit@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

// Touches that get a personalized opener, with the var-independent prefix of
// the PLAIN-template first sentence (the text immediately after the greeting).
// If the post-greeting text still starts with this prefix, no opener has been
// spliced in yet. This detection is self-healing and needs no external state.
const PRE_PHONE_OPENER_TOUCHES = {
  4: 'While we figure out a time to chat',
  5: 'Quick story — last quarter we shot',
  6: "Fresh from this week's shoot",
};

const SEQUENCE_GAPS = {
  PRE_PHONE_EMAIL: { 1: 0, 2: 1, 3: 2, 4: 4, 5: 3, 6: 4, 7: 4, 8: 4, 9: 6, 10: 7, 11: 10, 12: 15 },
  POST_QUOTE_FOLLOWUP: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9, 7: 12 },
  // One-week cash push: touch 1 due immediately, touch 2 a few days later
  // (the Thursday "deadline" nudge before the Friday cutoff).
  CASH_FLOW_CAMPAIGN: { 1: 0, 2: 3 },
};
const SEQUENCE_TOTALS = { PRE_PHONE_EMAIL: 12, POST_QUOTE_FOLLOWUP: 7, CASH_FLOW_CAMPAIGN: 2 };
// Sequences whose first-touch dates are managed externally (a drip stagger),
// so the cascade must not recompute/collapse them back to enrollment day.
const FIXED_SCHEDULE_SEQUENCES = new Set(['CASH_FLOW_CAMPAIGN']);

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
  productType actionType approvalStatus scheduledDate sequenceKey
  sendFromAccountId bccEmail createdAt updatedAt
`;

// Connected-account id -> from-address, so the triage card can show which
// mailbox a send goes out from (campaign = marketing, else default Outlook).
const ACCOUNT_HANDLES = {
  '382ab8d9-46e4-4471-81fb-f5723681191c': 'moshe@ph.impressionphotograph1.ca',
  'fd6150df-d8c7-4980-a656-d9ec181133d3': 'moshe@impressionphotography.ca',
};
const DEFAULT_FROM_EMAIL =
  process.env.CC_DEFAULT_FROM_EMAIL || 'moshe@impressionphotography.ca';
function resolveFromEmail(sendFromAccountId) {
  return ACCOUNT_HANDLES[sendFromAccountId] || DEFAULT_FROM_EMAIL;
}

async function fetchAllApprovals() {
  // Paginate through ALL approvals — a single 200 page silently dropped records
  // once a bulk campaign pushed the total past 200 (the cascade + queue went
  // blind to the newest approvals). Cursor-paginate, hard-capped for safety.
  const all = [];
  let after = null;
  for (let page = 0; page < 100; page++) {
    const data = await gql(
      `query($after: String) {
        approvals(first: 200, orderBy: { createdAt: AscNullsLast }, after: $after) {
          edges { node { ${APPROVAL_FIELDS} } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after },
    );
    all.push(...data.approvals.edges.map((e) => e.node));
    if (!data.approvals.pageInfo?.hasNextPage) break;
    after = data.approvals.pageInfo.endCursor;
  }
  return all;
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

// Moshe's calendar timezone. "Due today" and weekend-shift decisions are made
// against THIS zone, not UTC, so a touch scheduled for the evening (Toronto)
// doesn't read as "tomorrow" because UTC already rolled over.
const SCHEDULE_TZ = process.env.CC_SCHEDULE_TZ || 'America/Toronto';

// Return the civil Y/M/D, time, and weekday of an instant as seen in
// SCHEDULE_TZ. Uses Intl so DST is handled correctly without bundling a tz
// library.
const TZ_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  weekday: 'short',
});
function tzParts(dateLike) {
  const parts = TZ_PARTS_FORMATTER.formatToParts(new Date(dateLike));
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  // Intl can emit '24' for midnight hour in some engines; normalize to 0.
  const hour = Number(out.hour) % 24;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: out.weekday, // 'Mon'..'Sun'
  };
}

// Offset (ms) that SCHEDULE_TZ is ahead of UTC at the given instant
// (local = utc + offset). Computed by treating the zone's civil wall-clock as
// if it were UTC and differencing against the real instant. DST-correct.
function tzOffsetMs(dateLike) {
  const ms = new Date(dateLike).getTime();
  const p = tzParts(ms);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // asUTC is the wall-clock read as UTC; subtract the true instant (floored to
  // the second to match the formatter's resolution) to get the offset.
  return asUTC - Math.floor(ms / 1000) * 1000;
}

// The UTC instant corresponding to local-midnight (00:00 in SCHEDULE_TZ) of the
// civil day that `dateLike` falls on. This is the timezone-aware analogue of the
// old startOfDayUTC: two instants on the same Toronto calendar day map to the
// same value, so day-precision comparisons match Moshe's calendar.
function startOfDayTZ(dateLike) {
  const { year, month, day } = tzParts(dateLike);
  // Probe the offset at local noon (well clear of DST transition hours), then
  // back out the UTC instant of that civil day's local-midnight.
  const noonUTCguess = Date.UTC(year, month - 1, day, 12, 0, 0);
  const offsetMs = tzOffsetMs(noonUTCguess); // local - utc, ~ at local noon
  // local-midnight(UTC) = Date.UTC(civil midnight) - offset
  return Date.UTC(year, month - 1, day) - offsetMs;
}

// Backwards-compatible name kept so existing call sites read naturally. Now
// timezone-aware (Toronto) rather than UTC.
function startOfDayUTC(dateLike) {
  return startOfDayTZ(dateLike);
}

// Mon..Fri = business day. Saturday/Sunday are not.
function isWeekendTZ(dateLike) {
  const wd = tzParts(dateLike).weekday;
  return wd === 'Sat' || wd === 'Sun';
}

// If an instant lands on a Sat/Sun (Toronto calendar), push it forward to the
// following Monday's local-midnight. Idempotent for weekday inputs (returns the
// same day's local-midnight). Operates at day precision — the cascade only
// cares about the calendar day a touch is due.
function shiftWeekendToMondayMs(baseMs) {
  let ms = startOfDayTZ(baseMs);
  // Advance one civil day at a time until we land on a weekday. At most 2 hops.
  let guard = 0;
  while (isWeekendTZ(ms) && guard < 4) {
    ms = startOfDayTZ(ms + 36 * 3600 * 1000); // +36h clears DST + lands next day
    guard += 1;
  }
  return ms;
}

function addDaysISO(baseMs, days) {
  // Add whole days at the civil-day level (DST-safe), then push weekends to
  // Monday so sends only ever land on a business day.
  const startMs = startOfDayTZ(baseMs);
  const targetMs = startOfDayTZ(startMs + days * 86400000 + 12 * 3600000);
  return new Date(shiftWeekendToMondayMs(targetMs)).toISOString();
}

// Last instant (UTC ms) of the Toronto civil day that `dateLike` falls on:
// tomorrow's local-midnight minus 1ms. DST-exact (a 23h/25h civil day is
// measured correctly), unlike a fixed start+86400000-1 offset. Used to decide
// "due today" so an evening touch counts and tomorrow's never leaks in.
function endOfDayTZ(dateLike) {
  const startMs = startOfDayTZ(dateLike);
  // +36h is always inside the NEXT civil day regardless of DST; floor it.
  const nextDayStartMs = startOfDayTZ(startMs + 36 * 3600 * 1000);
  return nextDayStartMs - 1;
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

    // Drip campaigns (e.g. CASH_FLOW_CAMPAIGN) have their first touch's date
    // set EXTERNALLY — staggered across days so a daily slice goes out instead
    // of all at once (deliverability). Preserve that date; don't collapse it
    // back to "enrollment + gap". Later touches still cascade normally below.
    const isDripFirstTouch =
      FIXED_SCHEDULE_SEQUENCES.has(activeSeq) &&
      next.scheduledDate &&
      completed.length === 0;

    if (!isDripFirstTouch) {
      const gap = gaps[next.touchNumber] ?? 0;
      const desiredISO = addDaysISO(baselineMs, gap);
      // The immediate next pending touch gets a date.
      if (!datesEqual(next.scheduledDate, desiredISO)) {
        dateWrites.push({ id: next.id, scheduledDate: desiredISO });
      }
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

// Batch: fetch recent INCOMING messages ONCE and build handle -> latest reply.
// Replaces a per-lead query (which made one API call per pending lead and blew
// the 100-req/min limit once a campaign pushed active leads past ~100).
async function fetchRecentInboundMap() {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const map = new Map(); // handle(lowercased) -> { receivedAt, subject, text }
  let after = null;
  for (let page = 0; page < 15; page++) {
    let data;
    try {
      data = await gql(
        `query($after: String, $cutoff: DateTime) {
          messages(first: 200, orderBy: { receivedAt: DescNullsLast },
                   filter: { receivedAt: { gte: $cutoff } }, after: $after) {
            edges { node { direction subject text receivedAt
              messageParticipants { edges { node { handle role } } } } }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { after, cutoff },
      );
    } catch (e) {
      console.error(`[replies] batch inbound fetch failed: ${e.message}`);
      break;
    }
    const edges = data?.messages?.edges || [];
    for (const e of edges) {
      const m = e.node;
      if (!m || m.direction !== 'INCOMING' || !m.receivedAt) continue;
      const fromP = (m.messageParticipants?.edges || []).find(
        (p) => p.node?.role === 'FROM',
      );
      const handle = (fromP?.node?.handle || '').toLowerCase();
      if (!handle || handle === USER_EMAIL) continue;
      const prev = map.get(handle);
      if (!prev || new Date(m.receivedAt) > new Date(prev.receivedAt)) {
        map.set(handle, { receivedAt: m.receivedAt, subject: m.subject, text: m.text });
      }
    }
    if (!data?.messages?.pageInfo?.hasNextPage) break;
    after = data.messages.pageInfo.endCursor;
  }
  return map;
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

  // One batched fetch of recent inbound, reused for every lead (was per-lead).
  const inboundMap = await fetchRecentInboundMap();

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
    // Nothing sent to this lead yet → there is no campaign reply to detect.
    // (Also keeps brand-new bulk campaigns from being checked at all.)
    if (completed.length === 0) continue;
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

    const latest = inboundMap.get(email) || null;
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

// First word of the lead's name → the {{firstName}} the workflow rendered into
// the greeting. We match the greeting structurally instead (see below), so this
// is only a hint for the prompt.
function firstNameOf(approval) {
  const name = (approval.leadName || '').trim();
  if (!name) return null;
  return name.split(/\s+/)[0] || null;
}

// Split a Pre-Phone body into { greeting, rest } around the first blank line.
// Bodies look like "Hi <First>,\n\n<rest>". Returns null if it doesn't match.
function splitGreeting(body) {
  if (typeof body !== 'string') return null;
  const idx = body.indexOf('\n\n');
  if (idx < 0) return null;
  const greeting = body.slice(0, idx);
  if (!/^Hi\s+.+,\s*$/.test(greeting)) return null;
  return { greeting, rest: body.slice(idx + 2) };
}

// True when this approval still has the PLAIN template body (no opener spliced
// in yet) and therefore wants one. Detection: the text right after the greeting
// starts with the touch's known plain-template prefix.
function needsOpener(approval) {
  if (seqOf(approval) !== 'PRE_PHONE_EMAIL') return false;
  if (approval.approvalStatus !== 'PENDING') return false;
  // Never retro-edit a protected in-flight real lead's reviewed copy.
  if (OPENER_SKIP_EMAILS.has((approval.recipientEmail || '').toLowerCase())) return false;
  const prefix = PRE_PHONE_OPENER_TOUCHES[approval.touchNumber];
  if (!prefix) return false;
  const split = splitGreeting(approval.emailBody);
  if (!split) return false;
  return split.rest.startsWith(prefix);
}

// Ask the relay for a single-sentence personalized opener. Short timeout,
// returns null on any failure (down, slow, empty) so the caller skips cleanly.
async function generateOpener(firstName, companyName) {
  if (!OLLAMA_RELAY_TOKEN) {
    console.error('[opener] no relay token configured — skipping generation');
    return null;
  }
  const company = (companyName || '').trim();
  // Same prompt style as the retired workflow step: reference company + niche,
  // under 22 words, no greeting/quotes/sign-off.
  const prompt =
    `You are writing the opening sentence of a B2B sales email from a product ` +
    `photographer to ${firstName || 'a prospect'}${company ? ` at ${company}` : ''}. ` +
    `There is NO prior relationship — this is cold outreach. The sentence should ` +
    `naturally reference ${company || 'their company'} (their products, brand, or ` +
    `industry) and explain why ${company || 'they'} specifically would benefit from ` +
    `professional product photography. Under 22 words. Conversational tone. Do NOT ` +
    `pretend you've spoken before. Do NOT mention specific products you couldn't ` +
    `actually know about. No greeting, no quotes, no sign-off. Output ONLY the single ` +
    `sentence, nothing else.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(OLLAMA_RELAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OLLAMA_RELAY_TOKEN}`,
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { num_predict: 40, temperature: 0.7 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[opener] relay HTTP ${res.status} — skipping`);
      return null;
    }
    const json = await res.json();
    let text = (json && json.response ? String(json.response) : '').trim();
    // Tidy: collapse whitespace, strip wrapping quotes, take the first sentence.
    text = text.replace(/\s+/g, ' ').replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!text) return null;
    return text;
  } catch (e) {
    console.error(`[opener] generation failed (skipping): ${e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort pass invoked by reconcile(). Finds PENDING Pre-Phone touch 4/5/6
// approvals with a plain template body, generates an opener, and patches it in
// after the greeting. Idempotent (needsOpener() guards against re-doing) and
// fully isolated — it logs and continues on any per-row failure, and the caller
// wraps it so it can never break reconcile.
async function generatePendingOpeners(approvals) {
  const targets = (approvals || []).filter(needsOpener);
  let patched = 0;
  for (const a of targets) {
    try {
      const split = splitGreeting(a.emailBody);
      if (!split) continue; // body changed under us — skip
      const opener = await generateOpener(firstNameOf(a), a.companyName);
      if (!opener) continue; // Ollama down/slow — leave plain, retry next run
      // Splice: greeting, blank line, opener, blank line, original rest.
      const newBody = `${split.greeting}\n\n${opener}\n\n${split.rest}`;
      await updateApproval(a.id, { emailBody: newBody });
      patched += 1;
      console.log(
        `[opener] inserted opener for touch ${a.touchNumber} of ${a.recipientEmail}`
      );
    } catch (e) {
      console.error(`[opener] patch failed for approval ${a.id} (continuing): ${e.message}`);
    }
  }
  return patched;
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

    // Lazy, best-effort AI-opener fill for Pre-Phone touches 4-6. Fully
    // isolated: any failure here must never break scheduling/queue. Uses the
    // post-scheduling approvals snapshot (fine — needsOpener only reads body).
    let openersPatched = 0;
    try {
      openersPatched = await generatePendingOpeners(approvals);
    } catch (e) {
      console.error('[opener] pass failed (continuing):', e.message);
    }

    return {
      written: dateWrites.length,
      rejected: rejections.length,
      total: approvals.length,
      paused: pausedSet.size,
      newlyPaused: replyResult.pausedNow.length,
      openersPatched,
    };
  })();
  try {
    return await reconcileInFlight;
  } finally {
    reconcileInFlight = null;
  }
}

// Delay before the post-send "settle" reconcile. The Twenty workflow flips the
// just-approved touch PENDING->COMPLETED a few seconds after the email sends;
// ~12s gives it comfortable margin so the next touch dates from the real
// completion time instead of enrollment.
const POST_SEND_RECONCILE_DELAY_MS = Number(
  process.env.CC_POST_SEND_RECONCILE_DELAY_MS || 12000
);
// At most one pending delayed reconcile is queued at a time — a burst of sends
// collapses to a single follow-up run (reconcile() itself also coalesces).
let delayedReconcileTimer = null;
function scheduleDelayedReconcile() {
  if (delayedReconcileTimer) return;
  delayedReconcileTimer = setTimeout(() => {
    delayedReconcileTimer = null;
    reconcile().catch((e) =>
      console.error('[reconcile] post-send settle failed:', e.message)
    );
  }, POST_SEND_RECONCILE_DELAY_MS);
  // Don't keep the event loop alive solely for this timer.
  if (delayedReconcileTimer && typeof delayedReconcileTimer.unref === 'function') {
    delayedReconcileTimer.unref();
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
// class of silent-failure bug that once let "Execute Approved Touch" no-op.
// Detects REAL runtime defects only:
//   - SEND_EMAIL with empty recipients.to
//   - UPDATE_RECORD no-op (empty objectRecordId AND empty fieldsToUpdate)
//   - CREATE_RECORD/UPSERT_RECORD with empty objectName or empty objectRecord
//   - empty/missing steps array on an active workflow
//   - orphaned/unreachable steps (not reachable from the trigger) — this is
//     the real defect on the legacy 12-Touch sequence (Touches 3-12 dangle)
// Deliberately NOT flagged:
//   - step.valid === false: confirmed (workflow-executor.workspace-service.ts)
//     to be a builder-UI hint only; never consulted at runtime or activation.
//     Flagging it produced false positives (e.g. the perfectly-functional
//     "Quick Lead" workflow).
//   - empty connectedAccountId on SEND_EMAIL: intentional (falls back to the
//     first connected account).
// ---------------------------------------------------------------------------

function stepProblems(step) {
  const problems = [];
  const type = step && step.type;
  const input = (step && step.settings && step.settings.input) || {};

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

  if (type === 'CREATE_RECORD' || type === 'UPSERT_RECORD') {
    const objectName = (input.objectName || '').toString().trim();
    const record = input.objectRecord;
    const emptyRecord = !record || (typeof record === 'object' && Object.keys(record).length === 0);
    if (!objectName || emptyRecord) {
      problems.push(
        `${type} step "${step.name || step.id}" is incomplete (missing objectName or objectRecord)`
      );
    }
  }

  return problems;
}

// A step's successors are its top-level nextStepIds PLUS, for branching steps
// (IF_ELSE etc.), the nextStepIds nested inside settings.input.branches[].
// (IF_ELSE stores continuation per-branch, with a null top-level nextStepIds —
// missing this made every post-IF_ELSE step look orphaned.)
function successorsOf(step) {
  const out = [];
  if (Array.isArray(step.nextStepIds)) out.push(...step.nextStepIds.filter(Boolean));
  const branches = step && step.settings && step.settings.input && step.settings.input.branches;
  if (Array.isArray(branches)) {
    for (const b of branches) {
      if (Array.isArray(b.nextStepIds)) out.push(...b.nextStepIds.filter(Boolean));
    }
  }
  return out;
}

// Steps not reachable from the trigger never run. Roots = trigger.nextStepIds;
// walk successorsOf each step (branch-aware). Anything unvisited is orphaned.
function orphanedStepProblems(trigger, steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const roots = (trigger && Array.isArray(trigger.nextStepIds) ? trigger.nextStepIds : []).filter(Boolean);
  const visited = new Set();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id) || !byId.has(id)) continue;
    visited.add(id);
    queue.push(...successorsOf(byId.get(id)));
  }
  const problems = [];
  for (const s of steps) {
    if (!visited.has(s.id)) {
      problems.push(`step "${s.name || s.type || s.id}" is unreachable from the trigger (orphaned — will never run)`);
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
          versions(first: 50) { edges { node { id status steps trigger } } }
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
      if (steps.length > 0) {
        for (const p of orphanedStepProblems(published.trigger, steps)) problems.push(p);
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
  const endOfTodayMs = endOfDayTZ(new Date());

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

// ---- Public campaign click-tracker (NO auth) -------------------------------
// Email CTAs point at /go/:approvalId. We log the click (who + when) and 302 to
// the Stripe checkout. Kept dead-simple + synchronous so the redirect is
// instant — the board joins these clicks to approvals on read, not here.
const CLICKS_PATH =
  process.env.CC_CLICKS_PATH || path.join(__dirname, 'campaign-clicks.json');
// The Stripe Payment Link is public (it ships in the emails); store it in a
// file for configurability, env override wins.
const STRIPE_BUY_URL =
  process.env.CC_STRIPE_BUY_URL ||
  readSecretFile(path.join(__dirname, '.stripe-link')) ||
  'https://impressionphotography.ca';

function logCampaignClick(approvalId) {
  let clicks = {};
  try {
    clicks = JSON.parse(fs.readFileSync(CLICKS_PATH, 'utf8'));
  } catch (_e) {
    clicks = {};
  }
  const now = new Date().toISOString();
  if (!clicks[approvalId]) clicks[approvalId] = { firstClickedAt: now, count: 0 };
  clicks[approvalId].count += 1;
  clicks[approvalId].lastClickedAt = now;
  fs.writeFileSync(CLICKS_PATH, JSON.stringify(clicks, null, 2));
}

app.get('/go/:approvalId', (req, res) => {
  try {
    logCampaignClick(req.params.approvalId);
  } catch (_e) {
    /* never block the redirect on a logging failure */
  }
  return res.redirect(302, STRIPE_BUY_URL);
});

function readCampaignClicks() {
  try {
    return JSON.parse(fs.readFileSync(CLICKS_PATH, 'utf8'));
  } catch (_e) {
    return {};
  }
}

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
    const endOfTodayMs = endOfDayTZ(new Date());

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
        fromEmail: resolveFromEmail(a.sendFromAccountId),
        bcc: a.bccEmail || null,
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
    // The immediate reconcile above dates the NEXT touch from ENROLLMENT, not
    // from this send, because the Twenty workflow hasn't flipped this approval
    // PENDING->COMPLETED yet (it does so a few seconds later, after the email
    // actually goes out). Schedule a second reconcile shortly after so the next
    // touch gets re-dated from the real completion time. reconcile() coalesces
    // via reconcileInFlight and every write is idempotent (computeScheduleWrites
    // only writes when the value differs), so this never double-sends or churns.
    scheduleDelayedReconcile();
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

// ---- "This Week" look-ahead -------------------------------------------------
//
// GET /api/upcoming -> read-only preview of every lead's NEXT pending touch
// whose scheduledDate falls within the next 7 days (Toronto calendar),
// excluding paused (replied) leads. The cascade only ever dates one pending
// touch per lead, so this is effectively "one upcoming card per active lead".
// Sorted ascending by scheduledDate. Each item:
//   { id, leadName, companyName, sequenceKey, touchNumber, sequenceTotal,
//     emailSubject, scheduledDate, recipientEmail }
// Campaign board: for a given sequence (default CASH_FLOW_CAMPAIGN), each
// recipient's funnel status — sent (COMPLETED), clicked (from the click log),
// and the touch/subject. "Bought" comes later via a Stripe webhook.
api.get('/campaign-board', async (req, res) => {
  try {
    const seq = (req.query.sequence || 'CASH_FLOW_CAMPAIGN').toString();
    const approvals = await fetchAllApprovals();
    const clicks = readCampaignClicks();
    const rows = approvals
      .filter((a) => (a.sequenceKey || '') === seq)
      .map((a) => {
        const click = clicks[a.id];
        return {
          id: a.id,
          leadName: a.leadName,
          companyName: a.companyName,
          recipientEmail: a.recipientEmail,
          touchNumber: a.touchNumber,
          status: a.approvalStatus, // PENDING / APPROVED / COMPLETED / REJECTED
          sent: a.approvalStatus === 'COMPLETED',
          scheduledDate: a.scheduledDate,
          clicked: Boolean(click),
          clickedAt: click ? click.firstClickedAt : null,
          clickCount: click ? click.count : 0,
        };
      })
      .sort((x, y) => Number(y.clicked) - Number(x.clicked) || Number(y.sent) - Number(x.sent));
    const summary = {
      total: rows.length,
      sent: rows.filter((r) => r.sent).length,
      clicked: rows.filter((r) => r.clicked).length,
    };
    res.json({ sequence: seq, summary, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

api.get('/upcoming', async (_req, res) => {
  try {
    // Reconcile first so dates reflect reality (mirrors /queue), tolerate fail.
    try {
      await reconcile();
    } catch (_e) {
      /* non-fatal — serve whatever dates exist */
    }
    const approvals = await fetchAllApprovals();
    const pausedSet = pausedSetFromState(readPausedState());

    // Window: from the start of today through the end of the 7th day ahead,
    // all in Toronto civil time so "this week" matches Moshe's calendar.
    const startMs = startOfDayUTC(new Date());
    const windowEndMs = endOfDayTZ(new Date(startMs + 7 * 86400000));

    const upcoming = approvals
      .filter(
        (a) =>
          a.approvalStatus === 'PENDING' &&
          a.scheduledDate &&
          !pausedSet.has(pausedKey(a.recipientEmail, seqOf(a))) &&
          new Date(a.scheduledDate).getTime() >= startMs &&
          new Date(a.scheduledDate).getTime() <= windowEndMs
      )
      .sort((x, y) => {
        const dx = new Date(x.scheduledDate).getTime();
        const dy = new Date(y.scheduledDate).getTime();
        if (dx !== dy) return dx - dy;
        return x.touchNumber - y.touchNumber;
      })
      .map((a) => ({
        id: a.id,
        leadName: a.leadName || null,
        companyName: a.companyName || null,
        sequenceKey: seqOf(a),
        touchNumber: a.touchNumber,
        sequenceTotal: SEQUENCE_TOTALS[seqOf(a)] || SEQUENCE_TOTALS[DEFAULT_SEQUENCE],
        emailSubject: a.emailSubject || null,
        scheduledDate: a.scheduledDate,
        recipientEmail: a.recipientEmail || null,
      }));

    res.json({ upcoming, count: upcoming.length, windowDays: 7 });
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

    const endOfTodayMs = endOfDayTZ(new Date());
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
  // Report SSO status without leaking secrets (just whether it's wired up).
  console.log(
    `[sso] CRM single sign-on ${SSO_ENABLED ? 'ENABLED' : 'disabled'}` +
      (SSO_ENABLED ? ` (workspace ${WORKSPACE_ID})` : ' (APP_SECRET/workspaceId unavailable)')
  );
  console.log(`[schedule] cascade timezone: ${SCHEDULE_TZ}, business-days-only sends`);
  // Kick an initial reconcile + roadmap seed on boot.
  reconcile()
    .then((r) => console.log('[reconcile] startup:', JSON.stringify(r)))
    .catch((e) => console.error('[reconcile] startup failed:', e.message));
  readRoadmap();
});
