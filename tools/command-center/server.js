// Daily Command Center backend.
// Holds the Twenty CRM admin API token server-side and proxies a small set of
// curated operations to the GraphQL API. The browser never sees the token.
//
// Endpoints (all under the app's mount path, e.g. /command-center/):
//   GET  /api/queue        -> due approvals + counts (runs reconcile first)
//   POST /api/approval/:id/send   -> set APPROVED (workflow sends the email)
//   POST /api/approval/:id/skip   -> set REJECTED
//   POST /api/approval/:id/edit   -> update subject/body
//   GET  /api/calls        -> tasks due today (with phone if reachable)
//   POST /api/task/:id/done       -> set task status DONE
//   GET  /api/roadmap      -> list of future ideas
//   POST /api/roadmap      -> append an idea
//   POST /api/reconcile    -> force-run the cascade scheduler
//   GET  /api/health       -> liveness + CRM reachability

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4242;
const GRAPHQL_URL =
  process.env.TWENTY_GRAPHQL_URL || 'https://crm.impressionphotography.ca/graphql';
const ROADMAP_PATH = process.env.ROADMAP_PATH || path.join(__dirname, 'roadmap.json');

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

// Token is read from a file (chmod 600) or an env var. Never logged, never
// sent to the client.
function loadToken() {
  if (process.env.TWENTY_API_TOKEN) return process.env.TWENTY_API_TOKEN.trim();
  const tokenFile = process.env.TWENTY_TOKEN_FILE || path.join(__dirname, '.token');
  return fs.readFileSync(tokenFile, 'utf8').trim();
}

const API_TOKEN = loadToken();

// Cascade GAP days keyed by the touch number being scheduled. Touch 1 has gap 0
// (due immediately once nothing has been sent).
const GAP = {
  1: 0,
  2: 1,
  3: 2,
  4: 4,
  5: 3,
  6: 4,
  7: 4,
  8: 4,
  9: 6,
  10: 7,
  11: 10,
  12: 15,
};

const TERMINAL_STATUSES = new Set(['COMPLETED', 'REJECTED']);

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
  productType actionType approvalStatus scheduledDate createdAt updatedAt
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

function computeScheduleWrites(approvals) {
  const byLead = new Map();
  for (const a of approvals) {
    const key = a.recipientEmail || `__no_email__${a.id}`;
    if (!byLead.has(key)) byLead.set(key, []);
    byLead.get(key).push(a);
  }

  const writes = [];
  for (const [, group] of byLead) {
    const completed = group.filter((a) => a.approvalStatus === 'COMPLETED');
    const pending = group
      .filter((a) => a.approvalStatus === 'PENDING')
      .sort((x, y) => x.touchNumber - y.touchNumber);

    if (pending.length === 0) continue;

    // Baseline = when the last touch completed, else the lead's earliest
    // approval createdAt (so a brand-new lead's Touch 1 is due immediately).
    let baselineMs;
    if (completed.length > 0) {
      const lastCompleted = completed.reduce((acc, a) =>
        a.touchNumber > acc.touchNumber ? a : acc
      );
      baselineMs = startOfDayUTC(lastCompleted.updatedAt);
    } else {
      const earliestCreated = group.reduce((acc, a) =>
        new Date(a.createdAt) < new Date(acc.createdAt) ? a : acc
      );
      baselineMs = startOfDayUTC(earliestCreated.createdAt);
    }

    const next = pending[0];
    const gap = GAP[next.touchNumber] ?? 0;
    const desiredISO = addDaysISO(baselineMs, gap);

    // The immediate next pending touch gets a date.
    if (!datesEqual(next.scheduledDate, desiredISO)) {
      writes.push({ id: next.id, scheduledDate: desiredISO });
    }
    // All later pending touches must be null.
    for (const later of pending.slice(1)) {
      if (later.scheduledDate !== null) {
        writes.push({ id: later.id, scheduledDate: null });
      }
    }
  }
  return writes;
}

function datesEqual(existing, desiredISO) {
  if (!existing) return false;
  // Compare to day precision so we don't churn on sub-second drift.
  return startOfDayUTC(existing) === startOfDayUTC(desiredISO);
}

let reconcileInFlight = null;

async function reconcile() {
  // Coalesce concurrent reconciles (page-load + timer) into one run.
  if (reconcileInFlight) return reconcileInFlight;
  reconcileInFlight = (async () => {
    const approvals = await fetchAllApprovals();
    const writes = computeScheduleWrites(approvals);
    for (const w of writes) {
      await updateApproval(w.id, { scheduledDate: w.scheduledDate });
    }
    return { written: writes.length, total: approvals.length };
  })();
  try {
    return await reconcileInFlight;
  } finally {
    reconcileInFlight = null;
  }
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

    const due = approvals
      .filter(
        (a) =>
          a.approvalStatus === 'PENDING' &&
          a.scheduledDate &&
          new Date(a.scheduledDate).getTime() <= endOfTodayMs
      )
      .sort((x, y) => {
        const dx = new Date(x.scheduledDate).getTime();
        const dy = new Date(y.scheduledDate).getTime();
        if (dx !== dy) return dx - dy;
        return x.touchNumber - y.touchNumber;
      });

    res.json({ due, count: due.length, reconcile: reconcileResult });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

api.post('/approval/:id/send', async (req, res) => {
  try {
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
