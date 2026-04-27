#!/usr/bin/env node
// Lead Discovery webhook server — runs on OVH at localhost:4500.
// POST /run starts a full discovery cycle (4 parallel workers + website email pass).
// GET /status returns last-run summary.
//
// Full cycle:
//   1. Clear old worker state files (so workers retry previously-failed companies)
//   2. Build 4 CSV shards from companies with no domain & no person
//   3. Launch 4 parallel discover-and-harvest workers (domain guessing + Brave Search)
//   4. Wait for workers to finish (max 5h timeout)
//   5. Run website email scraper on companies that now have a domain but no person
//   6. Post summary note to CRM
//
// Designed to be called by a Twenty workflow HTTP_REQUEST action (manual trigger)
// and fires automatically via cron every 6h.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const PORT = 4500;
const STATE_FILE = '/tmp/scraper/lead-discovery-state.json';
const WORKERS = 4;
const SHARD_BUILDER = '/tmp/scraper/build-shards.sh';
const LAUNCH_SCRIPT = '/tmp/scraper/launch-workers.sh';
const TOKEN_FILE = '/tmp/scraper/token.txt';
const SCRAPER_DIR = '/tmp/scraper';
const LOG_DIR = '/tmp/scrape-logs';
const CRM_URL = 'https://crm.impressionphotography.ca';

// Worker state files — cleared at the start of each cycle so workers retry all companies
const WORKER_STATE_FILES = [
  `${LOG_DIR}/worker-0.state`,
  `${LOG_DIR}/worker-1.state`,
  `${LOG_DIR}/worker-2.state`,
  `${LOG_DIR}/worker-3.state`,
  `${LOG_DIR}/discover-and-harvest.state`,
];

// In-memory; mirrored to STATE_FILE on every change.
let state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
  : {
      lastRunAt: null,
      lastRunDurationSec: null,
      lastRunPersonsCreated: 0,
      lastRunWebsiteEmailsCreated: 0,
      totalRuns: 0,
      currentlyRunning: false,
      currentRunStartAt: null,
      currentPhase: null,
    };

const persist = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const personsCount = async () => {
  const result = await new Promise((resolve, reject) => {
    const p = spawn('docker', [
      'exec', 'twenty-db-1', 'psql', '-U', 'twenty', '-d', 'default', '-A', '-t', '-c',
      "SELECT count(*) FROM workspace_arem42qbur9jiys0e9bx25k0f.person WHERE \"leadSource\" = 'WEBSITE_SCRAPE';",
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`exit ${code}`))));
  });
  return parseInt(result, 10) || 0;
};

const updateCrmNote = async (note) => {
  const token = readFileSync(TOKEN_FILE, 'utf-8').trim();
  const url = 'http://localhost:3000/graphql';
  const targetCompanyName = '🤖 Lead Discovery System';
  const findQuery = `query { companies(filter: { name: { eq: "${targetCompanyName}" } }, first: 1) { edges { node { id } } } }`;
  const findRes = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: findQuery }),
  });
  const findJson = await findRes.json();
  const companyId = findJson?.data?.companies?.edges?.[0]?.node?.id;
  if (!companyId) {
    console.warn('[webhook] Lead Discovery System Company not found in CRM');
    return;
  }
  const createNoteRes = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'mutation Create($data: NoteCreateInput!) { createNote(data: $data) { id } }',
      variables: { data: { title: note.title, bodyV2: { markdown: note.body } } },
    }),
  });
  const noteJson = await createNoteRes.json();
  const noteId = noteJson?.data?.createNote?.id;
  if (!noteId) {
    console.warn('[webhook] createNote failed:', JSON.stringify(noteJson));
    return;
  }
  await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'mutation Link($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }',
      variables: { data: { noteId, targetCompanyId: companyId } },
    }),
  });
};

const anyWorkerAlive = async () =>
  new Promise((resolve) => {
    // Check for both discover-and-harvest workers AND the website email scraper
    const ps = spawn('pgrep', ['-f', 'lead-scraping/(discover-and-harvest|scrape-website-emails)']);
    let out = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.on('close', () => resolve(out.trim().length > 0));
  });

// Wait for a pgrep pattern to return 0 matches, with a timeout.
const waitForProcesses = (pgrepPattern, maxMs) =>
  new Promise((resolve) => {
    const deadline = Date.now() + maxMs;
    const tick = setInterval(() => {
      const ps = spawn('pgrep', ['-f', pgrepPattern]);
      let out = '';
      ps.stdout.on('data', (d) => (out += d));
      ps.on('close', () => {
        if (out.trim().length === 0 || Date.now() >= deadline) {
          clearInterval(tick);
          resolve();
        }
      });
    }, 60000); // check every minute
  });

const runDiscovery = async () => {
  if (state.currentlyRunning) {
    return { ok: false, reason: 'already_running', startedAt: state.currentRunStartAt };
  }
  if (await anyWorkerAlive()) {
    console.log('[webhook] workers already running outside webhook control — refusing to start a new cycle');
    return { ok: false, reason: 'workers_already_running' };
  }

  state.currentlyRunning = true;
  state.currentRunStartAt = new Date().toISOString();
  state.currentPhase = 'starting';
  persist();

  const startCount = await personsCount();
  const startedAt = Date.now();
  console.log(`[webhook] Starting discovery cycle. Persons: ${startCount}`);

  try {
    // ── Phase 1: clear stale worker state files ──────────────────────────────
    // This ensures workers re-attempt companies that previously had no website,
    // in case those businesses have gone online since the last cycle.
    state.currentPhase = 'clearing_state';
    persist();
    for (const f of WORKER_STATE_FILES) {
      try { unlinkSync(f); } catch { /* file may not exist */ }
    }
    console.log('[webhook] Cleared worker state files — workers will retry all companies');

    // ── Phase 2: build CSV shards from DB ────────────────────────────────────
    state.currentPhase = 'building_shards';
    persist();
    await new Promise((resolve, reject) => {
      const sh = spawn('bash', [SHARD_BUILDER]);
      sh.stdout?.on('data', (d) => process.stdout.write(`[shard] ${d}`));
      sh.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`shard build exit ${code}`))));
    });

    // ── Phase 3: launch 4 discover-and-harvest workers ───────────────────────
    state.currentPhase = 'discover_workers';
    persist();
    await new Promise((resolve, reject) => {
      const sh = spawn('bash', [LAUNCH_SCRIPT]);
      sh.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`launch exit ${code}`))));
    });

    // Poll until all discover-and-harvest workers finish (max 5h)
    await waitForProcesses('node lead-scraping/discover-and-harvest', 5 * 60 * 60 * 1000);
    console.log('[webhook] discover-and-harvest workers finished');

    // ── Phase 4: website email scraper for companies with domain but no person ─
    // These are companies where the workers found a website but couldn't extract
    // emails, OR companies already scraped by YP/OSM with websites but no contacts.
    state.currentPhase = 'website_emails';
    persist();
    const countBeforeWebsite = await personsCount();

    const token = readFileSync(TOKEN_FILE, 'utf-8').trim();
    await new Promise((resolve) => {
      const child = spawn('node', [
        `${SCRAPER_DIR}/lead-scraping/scrape-website-emails.mjs`,
        '--url', CRM_URL,
        '--token', token,
      ], { cwd: SCRAPER_DIR });
      child.stdout?.on('data', (d) => process.stdout.write(`[website-emails] ${d}`));
      child.stderr?.on('data', (d) => process.stderr.write(`[website-emails] ${d}`));
      // Max 2h for this phase
      const timeout = setTimeout(() => { child.kill(); resolve(); }, 2 * 60 * 60 * 1000);
      child.on('close', () => { clearTimeout(timeout); resolve(); });
    });

    const countAfterWebsite = await personsCount();
    const websiteEmailsCreated = countAfterWebsite - countBeforeWebsite;
    console.log(`[webhook] website-emails pass: +${websiteEmailsCreated} persons`);

    // ── Phase 5: report results ───────────────────────────────────────────────
    const endCount = await personsCount();
    const durationSec = Math.round((Date.now() - startedAt) / 1000);
    const created = endCount - startCount;

    state.lastRunAt = new Date().toISOString();
    state.lastRunDurationSec = durationSec;
    state.lastRunPersonsCreated = created;
    state.lastRunWebsiteEmailsCreated = websiteEmailsCreated;
    state.totalRuns += 1;
    state.currentlyRunning = false;
    state.currentRunStartAt = null;
    state.currentPhase = null;
    persist();

    console.log(`[webhook] Cycle done. +${created} persons in ${Math.round(durationSec / 60)} min. Total: ${endCount}`);

    try {
      await updateCrmNote({
        title: `Lead Discovery — +${created} new contacts (${new Date().toLocaleString('en-CA', { timeZone: 'America/Montreal' })})`,
        body: [
          `## Run #${state.totalRuns} summary`,
          ``,
          `| Metric | Value |`,
          `|--------|-------|`,
          `| New contacts this run | **${created}** |`,
          `| From discover phase | ${created - websiteEmailsCreated} |`,
          `| From website-email phase | ${websiteEmailsCreated} |`,
          `| Total contacts (all time) | **${endCount}** |`,
          `| Duration | ${Math.round(durationSec / 60)} min |`,
          `| Parallel workers | ${WORKERS} |`,
          ``,
          `Next run: 6h auto-schedule, or trigger from **🤖 Find New Leads** workflow.`,
        ].join('\n'),
      });
    } catch (e) {
      console.warn('[webhook] CRM note failed:', e.message);
    }

    return { ok: true, created, websiteEmailsCreated, totalNow: endCount, durationSec };

  } catch (err) {
    console.error('[webhook] cycle error:', err.message);
    state.currentlyRunning = false;
    state.currentRunStartAt = null;
    state.currentPhase = `error: ${err.message.slice(0, 100)}`;
    persist();
    return { ok: false, reason: 'error', message: err.message };
  }
};

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/status') {
    const total = await personsCount().catch(() => null);
    res.end(JSON.stringify({ ...state, currentTotalPersons: total }, null, 2));
    return;
  }

  if (req.method === 'POST' && req.url === '/run') {
    if (state.currentlyRunning) {
      // Return 202 (not 409) so Twenty workflow shows "Completed" not "Failed"
      res.statusCode = 202;
      res.end(JSON.stringify({
        ok: true,
        status: 'already_running',
        phase: state.currentPhase,
        startedAt: state.currentRunStartAt,
        message: `Discovery already in progress (phase: ${state.currentPhase}). Check /status for live progress.`,
      }));
      return;
    }
    if (await anyWorkerAlive()) {
      // Workers running outside webhook control — still return 202 so workflow shows green
      res.statusCode = 202;
      res.end(JSON.stringify({
        ok: true,
        status: 'already_running',
        message: 'Discovery is already in progress. It will finish on its own — check /status.',
      }));
      return;
    }
    res.statusCode = 202;
    res.end(JSON.stringify({ ok: true, status: 'started', message: 'discovery cycle started — check /status for progress' }));
    runDiscovery().catch((e) => console.error('[webhook] runDiscovery threw', e));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not_found' }));
});

// Bind to 0.0.0.0 so twenty-server (in Docker) can reach us via host gateway 172.16.3.1:4500.
// UFW blocks external access to port 4500 — only internal Docker network can reach it.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[webhook] listening on 0.0.0.0:${PORT}`);
  console.log(`[webhook] state: runs=${state.totalRuns}, lastRun=${state.lastRunAt || 'never'}`);
});
