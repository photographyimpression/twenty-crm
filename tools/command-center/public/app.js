// Daily Command Center frontend. Vanilla JS, no build step.
// API is served relative to wherever this page is mounted (e.g. /command-center/),
// so all fetches use './api/...'.

(function () {
  'use strict';

  // Build an absolute API base from the current location. We deliberately avoid
  // a relative './api' string: if the page was opened with credentials embedded
  // in the URL (https://user:pass@host/...), the browser forbids fetch() to a
  // relative URL ("Request cannot be constructed from a URL that includes
  // credentials"). Reconstructing from origin + pathname drops any embedded
  // credentials and keeps the /command-center/ mount prefix.
  function apiBase() {
    const path = window.location.pathname.replace(/[^/]*$/, ''); // dir of current page
    return window.location.origin + path + 'api';
  }
  const API = apiBase();
  let queue = [];
  let cursor = 0;
  let editing = false;
  let busy = false;
  let paused = [];
  let previewing = false; // showing the rendered final-email preview for the current card
  // Undo-on-send grace window state. While active, the card is locked and a
  // countdown runs; the real /send only fires if it reaches 0 without an Undo.
  let graceTimer = null;
  let graceInterval = null;
  let graceApprovalId = null;

  // ---- helpers -------------------------------------------------------------

  function el(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Lead name -> clickable deep-link into the person's CRM profile. The CC is
  // embedded in an iframe inside the CRM, so target="_top" makes the whole app
  // navigate (the frame's sandbox allows top navigation on user clicks).
  // Without a resolved personId the name stays plain text.
  function leadLink(name, personId) {
    const label = esc(name || '—') || '—';
    if (!name || !personId) return label;
    return `<a class="lead-link" href="/object/person/${encodeURIComponent(personId)}" target="_top" rel="noopener">${label}</a>`;
  }

  // "BCC me" toggle for sequence sends. Default ON — Moshe wants to see what
  // the client sees, at least for the beginning. Sticky across sessions.
  function getBccMe() {
    try {
      return localStorage.getItem('ccBccMe') !== 'off';
    } catch (_e) {
      return true;
    }
  }
  function setBccMe(on) {
    try {
      localStorage.setItem('ccBccMe', on ? 'on' : 'off');
    } catch (_e) {
      /* private mode — toggle still works for this session */
    }
  }

  let toastTimer = null;
  function toast(message, isError) {
    const t = el('toast');
    t.textContent = message;
    t.className = 'toast show' + (isError ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.className = 'toast' + (isError ? ' err' : '');
    }, isError ? 4500 : 1800);
  }

  // If the session cookie expired, the server returns 401 — bounce to the login
  // form rather than throwing opaque errors.
  function redirectToLoginIfUnauthorized(res) {
    if (res.status === 401) {
      const dir = window.location.pathname.replace(/[^/]*$/, '');
      window.location.href = window.location.origin + dir + 'login';
      return true;
    }
    return false;
  }

  async function apiGet(pathName) {
    const res = await fetch(`${API}${pathName}`, { headers: { Accept: 'application/json' } });
    if (redirectToLoginIfUnauthorized(res)) return new Promise(() => {});
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }

  async function apiPost(pathName, body) {
    const res = await fetch(`${API}${pathName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (redirectToLoginIfUnauthorized(res)) return new Promise(() => {});
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  // ---- tab switching -------------------------------------------------------

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.getAttribute('data-view');
      el(`view-${view}`).classList.add('active');
      if (view === 'calls') loadCalls();
      if (view === 'roadmap') loadRoadmap();
      if (view === 'dashboard') loadDashboard();
      if (view === 'board') {
        loadBoard();
        loadTemplates();
        renderOfferPanel();
      }
      if (view === 'upcoming') loadUpcoming();
    });
  });

  function inTriageView() {
    const v = el('view-triage');
    return v && v.classList.contains('active');
  }

  // ---- TRIAGE --------------------------------------------------------------

  // Hide the shortcut hint unless there's an actionable card on screen.
  function setHint(show) {
    const h = el('shortcutHint');
    if (h) h.style.display = show ? 'block' : 'none';
  }

  function renderTriage() {
    renderPaused();
    const mount = el('triageMount');
    const counter = el('counter');
    const remaining = queue.length - cursor;
    el('triageBadge').textContent = Math.max(remaining, 0);

    if (queue.length === 0) {
      counter.textContent = '';
      setHint(false);
      mount.innerHTML =
        '<div class="state"><div class="big">🎉</div><h2>Inbox zero</h2>' +
        '<p>Nothing to approve right now. Nicely done.</p>' +
        '<p style="margin-top:14px;"><button class="refresh" id="reloadTri">↻ Check again</button></p></div>';
      el('reloadTri').addEventListener('click', loadQueue);
      return;
    }

    if (cursor >= queue.length) {
      counter.textContent = '';
      setHint(false);
      mount.innerHTML =
        '<div class="state"><div class="big">✅</div><h2>All caught up</h2>' +
        '<p>You cleared today\'s queue.</p>' +
        '<p style="margin-top:14px;"><button class="refresh" id="reloadTri">↻ Check for more</button></p></div>';
      el('reloadTri').addEventListener('click', loadQueue);
      return;
    }

    const a = queue[cursor];
    counter.innerHTML = `<b>${remaining}</b> left today`;
    setHint(true);

    // Final-email preview (rendered HTML incl. signature) replaces the card body.
    if (previewing) {
      renderPreview(a);
      return;
    }

    if (editing) {
      mount.innerHTML = `
        <div class="card">
          <span class="pill">${seqLabel(a)} · Touch ${esc(a.touchNumber)} of ${seqTotal(a)} · editing</span>
          <div class="lead-name">${leadLink(a.leadName || 'Unknown lead', a.personId)}</div>
          <div class="company">${esc(a.companyName) || ''}</div>
          <label class="recipient">Subject</label>
          <input class="edit-field" id="editSubject" value="${esc(a.emailSubject)}" />
          <label class="recipient">Body</label>
          <textarea class="edit-field" id="editBody">${esc(a.emailBody)}</textarea>
          <div class="actions">
            <button class="btn btn-secondary" id="saveBtn" style="flex:1;">Save changes</button>
            <button class="btn btn-skip" id="cancelEdit">Cancel</button>
          </div>
        </div>`;
      el('saveBtn').addEventListener('click', onSaveEdit);
      el('cancelEdit').addEventListener('click', () => { editing = false; renderTriage(); });
      return;
    }

    const due = a.scheduledDate ? new Date(a.scheduledDate) : null;
    const dueLabel = due ? due.toISOString().slice(0, 10) : '';
    mount.innerHTML = `
      <div class="card">
        <div class="meta-row">
          <span class="pill pill-seq">${seqLabel(a)}</span>
          <span class="pill">Touch ${esc(a.touchNumber)} of ${seqTotal(a)}</span>
          ${a.productType ? `<span class="pill">${esc(a.productType)}</span>` : ''}
          ${dueLabel ? `<span class="pill">due ${esc(dueLabel)}</span>` : ''}
        </div>
        <div class="lead-name">${leadLink(a.leadName || 'Unknown lead', a.personId)}</div>
        <div class="company">${esc(a.companyName) || ''}</div>
        <div class="recipient">To: <b>${esc(a.recipientEmail)}</b></div>
        <div class="from-line">From: <b>${esc(a.fromEmail || '')}</b></div>
        <label class="bcc-toggle" title="Send a copy to my email so I see exactly what the client sees">
          <input type="checkbox" id="bccMe" ${getBccMe() ? 'checked' : ''}>
          <span>BCC me — see exactly what the client sees</span>
        </label>
        <div class="subject">${esc(a.emailSubject) || '(no subject)'}</div>
        <div class="body">${esc(a.emailBody) || '(empty body)'}</div>
        <div class="card-tools">
          <button class="btn-preview" id="previewBtn">Preview final ✉</button>
        </div>
        <div class="actions">
          <button class="btn btn-send" id="sendBtn">Send ✓</button>
          <button class="btn btn-edit" id="editBtn">Edit</button>
          <button class="btn btn-skip" id="skipBtn">Skip</button>
        </div>
      </div>`;

    el('bccMe').addEventListener('change', (ev) => setBccMe(ev.target.checked));
    el('sendBtn').addEventListener('click', onSend);
    el('skipBtn').addEventListener('click', onSkip);
    el('editBtn').addEventListener('click', () => { editing = true; renderTriage(); });
    el('previewBtn').addEventListener('click', () => { previewing = true; renderTriage(); });
  }

  // ---- final-email preview (rendered, signature included) ------------------

  function renderPreview(a) {
    const mount = el('triageMount');
    mount.innerHTML = `
      <div class="card">
        <div class="meta-row">
          <span class="pill pill-seq">${seqLabel(a)}</span>
          <span class="pill">Touch ${esc(a.touchNumber)} of ${seqTotal(a)}</span>
          <span class="pill">final preview</span>
        </div>
        <div class="lead-name">${leadLink(a.leadName || 'Unknown lead', a.personId)}</div>
        <div class="recipient">To: <b>${esc(a.recipientEmail)}</b></div>
        <div class="from-line">From: <b>${esc(a.fromEmail || '')}</b></div>
        <div id="previewBody">
          <div class="state"><div class="spinner"></div><p>Building exact email…</p></div>
        </div>
        <div class="actions">
          <button class="btn btn-send" id="sendBtn">Send ✓</button>
          <button class="btn btn-edit" id="backBtn">← Back to card</button>
        </div>
      </div>`;
    el('sendBtn').addEventListener('click', onSend);
    el('backBtn').addEventListener('click', () => { previewing = false; renderTriage(); });

    // Fetch the exact final HTML (body + niche signature with its <img>).
    apiGet(`/approval/${a.id}/preview`)
      .then((p) => {
        // Guard against a late response after the user moved on.
        if (!previewing || queue[cursor] !== a) return;
        const box = el('previewBody');
        if (!box) return;
        const metaBits = [];
        if (p.signatureName) metaBits.push(`Signature: ${esc(p.signatureName)}`);
        if (p.niche) metaBits.push(`niche ${esc(p.niche)}`);
        const meta = metaBits.length ? `<div class="preview-meta">${metaBits.join(' · ')}</div>` : '';
        // fullPreviewHtml is the exact final email markup; render it directly.
        box.innerHTML =
          `<div class="preview-subject">${esc(p.subject) || '(no subject)'}</div>` +
          meta +
          `<div class="preview-frame">${p.fullPreviewHtml || ''}</div>`;
      })
      .catch((e) => {
        const box = el('previewBody');
        if (box) box.innerHTML = `<div class="state"><div class="big">⚠️</div><p>${esc(e.message)}</p></div>`;
      });
  }

  function setBusy(state) {
    busy = state;
    document.querySelectorAll('#triageMount .btn').forEach((b) => (b.disabled = state));
  }

  function advance() {
    cursor += 1;
    editing = false;
    previewing = false;
    renderTriage();
  }

  // Sequence display helpers. Server sends sequenceKey + sequenceTotal;
  // default to the original Pre-Phone sequence for legacy rows.
  const SEQ_LABELS = {
    PRE_PHONE_EMAIL: 'Pre-Phone',
    POST_QUOTE_FOLLOWUP: 'Post-Quote',
  };
  function seqLabel(a) {
    return esc(SEQ_LABELS[a.sequenceKey] || 'Pre-Phone');
  }
  function seqTotal(a) {
    return esc(a.sequenceTotal || 12);
  }

  // Matches unfilled template placeholders like [PORTFOLIO_LINK].
  const PLACEHOLDER_RE = /\[[A-Z0-9_]{2,}\]/;

  // Clicking Send does NOT fire the request. It opens a 5-second grace window
  // with a prominent Undo; only when the countdown reaches 0 do we POST /send.
  // This makes a misclick fully recoverable — nothing leaves until 0.
  function onSend() {
    if (busy || graceTimer) return;
    const a = queue[cursor];
    // Pre-check locally for a nicer flow: jump straight into Edit instead of
    // a failed request. The server enforces the same rule regardless.
    const hit = `${a.emailSubject || ''}\n${a.emailBody || ''}`.match(PLACEHOLDER_RE);
    if (hit) {
      toast(`Fill in ${hit[0]} before sending — opening editor`, true);
      previewing = false;
      editing = true;
      renderTriage();
      return;
    }
    startGrace(a);
  }

  const GRACE_SECONDS = 5;

  function startGrace(a) {
    graceApprovalId = a.id;
    // Lock every button on the card so nothing else can be triggered mid-grace.
    document.querySelectorAll('#triageMount .btn, #triageMount .btn-preview').forEach((b) => {
      if (b.id !== 'undoBtn') b.disabled = true;
    });
    const actions = document.querySelector('#triageMount .actions');
    if (actions) {
      const grace = document.createElement('div');
      grace.className = 'send-grace';
      grace.id = 'sendGrace';
      grace.innerHTML =
        `<div class="grace-text">Sending in <b id="graceNum">${GRACE_SECONDS}</b>…</div>` +
        '<button class="btn-undo" id="undoBtn">Undo</button>';
      actions.parentNode.insertBefore(grace, actions.nextSibling);
      el('undoBtn').addEventListener('click', cancelGrace);
    }
    let left = GRACE_SECONDS;
    graceInterval = setInterval(() => {
      left -= 1;
      const n = el('graceNum');
      if (n) n.textContent = String(Math.max(left, 0));
    }, 1000);
    graceTimer = setTimeout(commitSend, GRACE_SECONDS * 1000);
  }

  function clearGrace() {
    if (graceTimer) clearTimeout(graceTimer);
    if (graceInterval) clearInterval(graceInterval);
    graceTimer = null;
    graceInterval = null;
    graceApprovalId = null;
    const g = el('sendGrace');
    if (g) g.remove();
  }

  // Undo: cancel the timer, nothing was sent, restore the card untouched.
  function cancelGrace() {
    if (!graceTimer && !graceInterval) return;
    clearGrace();
    toast('Cancelled — nothing sent');
    renderTriage();
  }

  // Countdown reached 0: now actually approve/send and advance.
  async function commitSend() {
    const id = graceApprovalId;
    clearGrace();
    if (!id) return;
    setBusy(true);
    try {
      await apiPost(`/approval/${id}/send`, { bcc: getBccMe() });
      toast(`Sent ✓${getBccMe() ? ' — copy to your inbox' : ''}`);
      advance();
    } catch (e) {
      // Keep the existing 422-placeholder handling: show the toast + open editor.
      const msg = e.message || '';
      if (/\[[A-Z0-9_]{2,}\]/.test(msg) || /placeholder/i.test(msg)) {
        toast(msg, true);
        previewing = false;
        editing = true;
        busy = false;
        renderTriage();
        return;
      }
      toast('Send failed: ' + msg, true);
      setBusy(false);
    }
  }

  async function onSkip() {
    if (busy || graceTimer) return;
    const a = queue[cursor];
    setBusy(true);
    try {
      await apiPost(`/approval/${a.id}/skip`, {});
      toast('Skipped');
      advance();
    } catch (e) {
      toast('Skip failed: ' + e.message, true);
      setBusy(false);
    }
  }

  async function onSaveEdit() {
    if (busy) return;
    const a = queue[cursor];
    const emailSubject = el('editSubject').value;
    const emailBody = el('editBody').value;
    busy = true;
    el('saveBtn').disabled = true;
    try {
      const r = await apiPost(`/approval/${a.id}/edit`, { emailSubject, emailBody });
      a.emailSubject = r.approval.emailSubject;
      a.emailBody = r.approval.emailBody;
      editing = false;
      busy = false;
      toast('Saved');
      renderTriage();
    } catch (e) {
      toast('Save failed: ' + e.message, true);
      busy = false;
      el('saveBtn').disabled = false;
    }
  }

  async function loadQueue() {
    el('triageMount').innerHTML =
      '<div class="state"><div class="spinner"></div><p>Loading your queue…</p></div>';
    try {
      const data = await apiGet('/queue');
      queue = data.due || [];
      paused = data.paused || [];
      cursor = 0;
      editing = false;
      previewing = false;
      busy = false;
      clearGrace();
      renderTriage();
    } catch (e) {
      el('triageMount').innerHTML =
        `<div class="state"><div class="big">⚠️</div><h2>Could not load</h2><p>${esc(e.message)}</p>` +
        '<p style="margin-top:14px;"><button class="refresh" id="reloadTri">↻ Retry</button></p></div>';
      el('reloadTri').addEventListener('click', loadQueue);
    }
  }

  // ---- REPLIED / PAUSED ----------------------------------------------------
  // Visible payoff of auto-pause: leads who replied have their sequence paused.
  // Show them above the triage card with a Resume button.

  function renderPaused() {
    const mount = el('pausedMount');
    if (!mount) return;
    if (!paused || paused.length === 0) {
      mount.innerHTML = '';
      return;
    }
    const rows = paused.map((p) => {
      const when = p.repliedAt ? new Date(p.repliedAt).toLocaleString() : '';
      const snip = p.snippet ? esc(p.snippet) : '(no preview)';
      const name = esc(p.leadName) || esc(p.email) || 'Unknown lead';
      return `
        <div class="paused-row" data-pkey="${esc(p.email)}|${esc(p.sequenceKey)}">
          <div class="paused-main">
            <div class="paused-name">${name} <span style="color:var(--muted);font-weight:600;font-size:12px;">${esc(SEQ_LABELS[p.sequenceKey] || p.sequenceKey)}</span></div>
            <div class="paused-snip">“${snip}”</div>
            ${when ? `<div class="paused-when">replied ${esc(when)}</div>` : ''}
          </div>
          <button class="btn btn-resume" data-resume-email="${esc(p.email)}" data-resume-seq="${esc(p.sequenceKey)}">Resume</button>
        </div>`;
    }).join('');
    mount.innerHTML =
      `<div class="paused-banner">📥 ${paused.length} replied — sequence paused</div>` + rows;
    mount.querySelectorAll('[data-resume-email]').forEach((btn) => {
      btn.addEventListener('click', () =>
        onResume(btn.getAttribute('data-resume-email'), btn.getAttribute('data-resume-seq'), btn)
      );
    });
  }

  async function onResume(email, sequenceKey, btn) {
    if (btn) btn.disabled = true;
    try {
      await apiPost('/resume', { email, sequenceKey });
      toast('Resumed ✓');
      await loadQueue(); // refresh — the lead may re-enter the due queue
    } catch (e) {
      toast('Resume failed: ' + e.message, true);
      if (btn) btn.disabled = false;
    }
  }

  // ---- DASHBOARD -----------------------------------------------------------

  function money(n, currency) {
    if (n == null) return '—';
    const sym = currency === 'USD' ? '$' : currency === 'CAD' ? 'CA$' : (currency ? currency + ' ' : '$');
    return sym + Number(n).toLocaleString();
  }

  function statCard(num, label) {
    return `<div class="stat"><div class="stat-num">${esc(num)}</div><div class="stat-label">${esc(label)}</div></div>`;
  }

  async function loadDashboard() {
    const mount = el('dashboardMount');
    mount.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading dashboard…</p></div>';
    // Workflow health is a separate endpoint; fetch both, tolerate either failing.
    let dash = null;
    let health = null;
    try {
      dash = await apiGet('/dashboard');
    } catch (e) {
      mount.innerHTML = `<div class="state"><div class="big">⚠️</div><p>${esc(e.message)}</p></div>`;
      return;
    }
    try {
      health = await apiGet('/workflow-health');
    } catch (_e) {
      health = null; // non-fatal — just skip the health card
    }

    const o = dash.overall || {};
    const opp = o.opportunities || {};
    const overallCards =
      statCard(o.totalPeople ?? '—', 'People') +
      statCard(o.totalCompanies ?? '—', 'Companies') +
      statCard(money(opp.totalAmount, opp.currencyCode), `Opportunities (${opp.count ?? 0})`) +
      statCard(o.tasksDueToday ?? '—', 'Tasks due today') +
      statCard(o.callsDueToday ?? '—', 'Calls due today') +
      statCard(o.repliesPaused ?? 0, 'Replies paused');

    const seq = dash.sequences || {};
    function seqRow(key) {
      const s = seq[key] || {};
      return `
        <tr>
          <td class="seq-name">${esc(SEQ_LABELS[key] || key)}</td>
          <td>${esc(s.enrolled ?? 0)}</td>
          <td>${esc(s.emailsSent ?? 0)}</td>
          <td>${esc(s.dueToday ?? 0)}</td>
          <td>${esc(s.pausedReplied ?? 0)}</td>
        </tr>`;
    }
    const seqTable = `
      <div class="dash-table-wrap">
        <table class="dash-table">
          <thead><tr><th>Sequence</th><th>Enrolled</th><th>Sent</th><th>Due today</th><th>Paused</th></tr></thead>
          <tbody>${seqRow('PRE_PHONE_EMAIL')}${seqRow('POST_QUOTE_FOLLOWUP')}</tbody>
        </table>
      </div>`;

    let healthHtml = '';
    if (health) {
      if (health.healthy) {
        healthHtml =
          '<div class="health-card ok"><div class="health-head">✓ Workflows healthy</div>' +
          '<div style="color:var(--muted);font-size:13px;">All active workflows passed the validity check.</div></div>';
      } else {
        const wfs = (health.problems || []).map((w) => `
          <div class="health-wf">
            <div class="health-wf-name">${esc(w.workflowName)}${w.versionStatus ? ` <span style="color:var(--muted);font-weight:600;">(${esc(w.versionStatus)})</span>` : ''}</div>
            <ul>${(w.problems || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
          </div>`).join('');
        healthHtml =
          `<div class="health-card"><div class="health-head">⚠ ${health.count} workflow${health.count === 1 ? '' : 's'} need attention</div>${wfs}</div>`;
      }
    }

    mount.innerHTML =
      `<div class="dash-grid">${overallCards}</div>` +
      '<div class="section-title">By sequence</div>' +
      seqTable +
      healthHtml;
  }

  el('refreshDash').addEventListener('click', loadDashboard);

  // ---- CAMPAIGN BOARD ------------------------------------------------------
  async function loadBoard() {
    const mount = el('boardMount');
    mount.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading campaign…</p></div>';
    let data;
    try {
      data = await apiGet('/campaign-board');
    } catch (e) {
      mount.innerHTML = `<div class="state"><div class="big">⚠️</div><p>${esc(e.message)}</p></div>`;
      return;
    }
    const s = data.summary || {};
    const cards =
      statCard(s.total ?? 0, 'In campaign') +
      statCard(s.sent ?? 0, 'Sent') +
      statCard(s.clicked ?? 0, 'Clicked the buy link');
    const rows = (data.rows || [])
      .map(
        (r) => `
        <tr>
          <td>${leadLink(r.leadName, r.personId)}</td>
          <td>${esc(r.companyName || '')}</td>
          <td>${r.sent ? '✅' : '<span style="color:var(--muted)">—</span>'}</td>
          <td>${r.clicked ? `🔥 ${esc(r.clickCount)}` : '<span style="color:var(--muted)">—</span>'}</td>
          <td>${esc(r.status)}</td>
        </tr>`,
      )
      .join('');
    mount.innerHTML =
      `<div class="dash-grid">${cards}</div>` +
      '<div class="section-title">Recipients (clicked first)</div>' +
      `<div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Lead</th><th>Company</th><th>Sent</th><th>Clicked</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="color:var(--muted)">No campaign recipients yet.</td></tr>'}</tbody>
      </table></div>`;
  }

  el('refreshBoard').addEventListener('click', loadBoard);

  // ---- EMAIL TEMPLATE LIBRARY ----------------------------------------------
  // Pick a design, preview it with the merge tokens filled in, copy the HTML
  // (or the subject) straight into a campaign.
  const tplState = { list: [], activeId: null, rendered: null };

  async function loadTemplates() {
    const mount = el('templatesMount');
    let data;
    try {
      data = await apiGet('/templates');
    } catch (e) {
      mount.innerHTML = `<div class="state"><p>${esc(e.message)}</p></div>`;
      return;
    }
    tplState.list = data.templates || [];
    if (tplState.list.length === 0) {
      mount.innerHTML =
        '<div class="state"><p style="color:var(--muted)">No templates yet.</p></div>';
      return;
    }
    if (!tplState.list.some((t) => t.id === tplState.activeId)) {
      tplState.activeId = tplState.list[0].id;
    }
    renderTemplateShell();
    await renderTemplatePreview();
  }

  function renderTemplateShell() {
    const picker = tplState.list
      .map((t) => {
        const on = t.id === tplState.activeId;
        return `<button class="btn tpl-pick" data-id="${esc(t.id)}" style="background:${
          on ? 'var(--accent)' : 'var(--panel-2)'
        };border:1px solid ${
          on ? 'var(--accent)' : 'var(--border)'
        };color:#fff;font-size:14px;padding:9px 14px" title="${esc(
          t.description || '',
        )}">${esc(t.name)}</button>`;
      })
      .join('');

    el('templatesMount').innerHTML = `
      <div class="card">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${picker}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="flex:1;min-width:150px;font-size:12px;color:var(--muted)">First name
            <input class="edit-field" id="tplFirstName" value="there" style="margin-top:4px">
          </label>
          <label style="flex:2;min-width:220px;font-size:12px;color:var(--muted)">Button link ({{ctaUrl}})
            <input class="edit-field" id="tplCtaUrl" placeholder="https://…" style="margin-top:4px">
          </label>
        </div>
        <div id="tplDesc" style="font-size:13px;color:var(--muted);margin-bottom:6px"></div>
        <div style="font-size:13px;color:var(--muted)">Subject</div>
        <div id="tplSubject" class="preview-subject" style="margin-bottom:4px"></div>
        <iframe id="tplPreview" class="preview-frame" style="width:100%;height:52vh;border:0"
                sandbox="" title="Template preview"></iframe>
        <div class="actions" style="margin-top:10px">
          <button class="btn btn-edit" id="tplCopyHtml">Copy HTML</button>
          <button class="btn btn-edit" id="tplCopySubject">Copy subject</button>
          <span id="tplCopied" style="font-size:13px;color:var(--green);align-self:center"></span>
        </div>
      </div>`;

    el('templatesMount')
      .querySelectorAll('.tpl-pick')
      .forEach((b) =>
        b.addEventListener('click', () => {
          tplState.activeId = b.getAttribute('data-id');
          renderTemplateShell();
          renderTemplatePreview();
        }),
      );
    // Re-render on input so the preview always matches what you'd send.
    ['tplFirstName', 'tplCtaUrl'].forEach((id) =>
      el(id).addEventListener('input', debounceTemplatePreview),
    );
    el('tplCopyHtml').addEventListener('click', () =>
      copyTemplatePart(tplState.rendered && tplState.rendered.html, 'HTML copied'),
    );
    el('tplCopySubject').addEventListener('click', () =>
      copyTemplatePart(tplState.rendered && tplState.rendered.subject, 'Subject copied'),
    );
  }


  // ---- SEASONAL OFFER (enrol one client) -----------------------------------
  // The three emails are rendered server-side from the amount + bonus count you
  // type, so the preview here is byte-identical to what would actually be sent.
  const offerState = { touch: 1, rendered: null };

  function renderOfferPanel() {
    const mount = el('offerMount');
    if (!mount || mount.dataset.ready === '1') {
      if (mount && mount.dataset.ready === '1') refreshOfferPreview();
      return;
    }
    mount.dataset.ready = '1';
    mount.innerHTML = `
      <div class="card">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="flex:2;min-width:210px;font-size:12px;color:var(--muted)">Client email (must exist in the CRM)
            <input class="edit-field" id="offEmail" placeholder="client@company.com" style="margin-top:4px">
          </label>
          <label style="flex:1;min-width:130px;font-size:12px;color:var(--muted)">Prepaid card
            <input class="edit-field" id="offCard" value="$1,000" style="margin-top:4px">
          </label>
          <label style="flex:1;min-width:120px;font-size:12px;color:var(--muted)">Extra images
            <input class="edit-field" id="offExtra" value="10" inputmode="numeric" style="margin-top:4px">
          </label>
        </div>
        <div id="offMeta" style="font-size:13px;color:var(--muted);margin:10px 0 6px"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn btn-edit off-touch" data-touch="1">Touch 1 · day 0</button>
          <button class="btn btn-edit off-touch" data-touch="2">Touch 2 · day 2</button>
          <button class="btn btn-edit off-touch" data-touch="3">Touch 3 · final hours</button>
        </div>
        <div style="font-size:13px;color:var(--muted)">Subject</div>
        <div id="offSubject" class="preview-subject" style="margin-bottom:4px"></div>
        <iframe id="offPreview" class="preview-frame" style="width:100%;height:52vh;border:0"
                sandbox="" title="Offer preview"></iframe>
        <div class="actions" style="margin-top:10px">
          <button class="btn btn-send" id="offEnroll">Enrol this client</button>
          <span id="offMsg" style="font-size:13px;align-self:center"></span>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:8px">
          Creates 3 pending emails in Triage. Nothing sends until you approve each one.
        </div>
      </div>`;

    mount.querySelectorAll('.off-touch').forEach((b) =>
      b.addEventListener('click', () => {
        offerState.touch = Number(b.getAttribute('data-touch'));
        refreshOfferPreview();
      }),
    );
    ['offCard', 'offExtra'].forEach((id) =>
      el(id).addEventListener('input', debounceOfferPreview),
    );
    el('offEnroll').addEventListener('click', enrolOffer);
    refreshOfferPreview();
  }

  let offerTimer = null;
  function debounceOfferPreview() {
    clearTimeout(offerTimer);
    offerTimer = setTimeout(refreshOfferPreview, 250);
  }

  async function refreshOfferPreview() {
    const cardAmount = (el('offCard') || {}).value || '$1,000';
    const extraImages = (el('offExtra') || {}).value || '10';
    let data;
    try {
      data = await apiGet(
        `/offer/preview?cardAmount=${encodeURIComponent(cardAmount)}&extraImages=${encodeURIComponent(extraImages)}`,
      );
    } catch (e) {
      el('offMeta').textContent = e.message;
      return;
    }
    offerState.rendered = data;
    const touch = (data.touches || []).find((t) => t.touchNumber === offerState.touch);
    el('offMeta').innerHTML =
      `Reads as the <b>${esc(data.saleName)}</b> offer, ending <b>${esc(data.deadline)}</b> — the window starts the day you enrol, so it is never out of season.`;
    el('offSubject').textContent = touch ? touch.subject : '';
    const frame = el('offPreview');
    if (frame && touch) frame.srcdoc = touch.html;
    document.querySelectorAll('.off-touch').forEach((b) =>
      b.classList.toggle('active', Number(b.getAttribute('data-touch')) === offerState.touch),
    );
  }

  async function enrolOffer() {
    const msg = el('offMsg');
    const email = (el('offEmail').value || '').trim();
    if (!email) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Enter the client email first.';
      return;
    }
    msg.style.color = 'var(--muted)';
    msg.textContent = 'Enrolling…';
    try {
      const out = await apiPost('/offer/enroll', {
        email,
        cardAmount: (el('offCard').value || '').trim(),
        extraImages: (el('offExtra').value || '').trim(),
      });
      msg.style.color = 'var(--green)';
      msg.textContent = `✅ ${out.enrolled} enrolled — 3 emails waiting in Triage (ends ${out.deadline}).`;
      el('offEmail').value = '';
    } catch (e) {
      msg.style.color = 'var(--red)';
      msg.textContent = e.message;
    }
  }

  let tplPreviewTimer = null;
  function debounceTemplatePreview() {
    clearTimeout(tplPreviewTimer);
    tplPreviewTimer = setTimeout(renderTemplatePreview, 250);
  }

  async function renderTemplatePreview() {
    const firstName = (el('tplFirstName') || {}).value || 'there';
    const ctaUrl = (el('tplCtaUrl') || {}).value || '';
    const query = `?firstName=${encodeURIComponent(firstName)}${
      ctaUrl ? `&ctaUrl=${encodeURIComponent(ctaUrl)}` : ''
    }`;
    let data;
    try {
      data = await apiGet(`/templates/${encodeURIComponent(tplState.activeId)}${query}`);
    } catch (e) {
      el('tplSubject').textContent = e.message;
      return;
    }
    tplState.rendered = data;
    el('tplDesc').textContent = data.description || '';
    el('tplSubject').textContent = data.subject || '(no subject)';
    // srcdoc + sandbox="": renders the real email markup, runs nothing.
    el('tplPreview').srcdoc = data.html || '';
  }

  async function copyTemplatePart(text, okMessage) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      el('tplCopied').textContent = okMessage;
    } catch (_e) {
      el('tplCopied').textContent = 'Press Cmd+C to copy';
    }
    setTimeout(() => {
      el('tplCopied').textContent = '';
    }, 2000);
  }

  // ---- THIS WEEK (look-ahead) ----------------------------------------------
  // Read-only preview of upcoming touches grouped by day. Dates come back as
  // Toronto local-midnight ISO instants; we bucket + label them in the same
  // timezone so "Today/Tomorrow/weekday" matches the server's day boundaries
  // regardless of the viewer's browser timezone.

  const SCHEDULE_TZ = 'America/Toronto';
  const TZ_YMD = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const TZ_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: SCHEDULE_TZ, weekday: 'long' });
  const TZ_NICE = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TZ, month: 'short', day: 'numeric',
  });

  // Toronto-civil YYYY-MM-DD key for an instant (en-CA gives YYYY-MM-DD).
  function tzDayKey(dateLike) {
    return TZ_YMD.format(new Date(dateLike));
  }

  // Human label for a day key relative to today (Toronto): Today / Tomorrow /
  // weekday name.
  function dayLabel(dayKey) {
    const todayKey = tzDayKey(new Date());
    const tomorrowKey = tzDayKey(new Date(Date.now() + 86400000));
    if (dayKey === todayKey) return 'Today';
    if (dayKey === tomorrowKey) return 'Tomorrow';
    // Parse the key as a date for weekday formatting. Noon UTC keeps the civil
    // day stable across the small Toronto offset.
    const d = new Date(dayKey + 'T12:00:00Z');
    return TZ_WEEKDAY.format(d);
  }

  function weekRow(item) {
    const lead = leadLink(item.leadName || item.recipientEmail || 'Unknown lead', item.personId);
    const company = item.companyName ? ` <span class="week-company">· ${esc(item.companyName)}</span>` : '';
    const subject = item.emailSubject ? esc(item.emailSubject) : '(no subject)';
    const to = item.recipientEmail ? `To: ${esc(item.recipientEmail)}` : '';
    const from = item.fromEmail ? `<span class="week-from">From: ${esc(item.fromEmail)}</span>` : '';
    const seq = esc(SEQ_LABELS[item.sequenceKey] || item.sequenceKey || 'Pre-Phone');
    const pill = `${seq} · Touch ${esc(item.touchNumber)} of ${esc(item.sequenceTotal || 12)}`;
    const metaLine = to || from ? `<div class="week-to">${to}${from}</div>` : '';
    return `
      <div class="week-row">
        <div class="week-main">
          <div class="week-lead">${lead}${company}</div>
          <div class="week-subject">${subject}</div>
          ${metaLine}
        </div>
        <span class="week-pill">${pill}</span>
      </div>`;
  }

  async function loadUpcoming() {
    const mount = el('upcomingMount');
    mount.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading this week…</p></div>';
    try {
      const data = await apiGet('/upcoming');
      const items = data.upcoming || [];
      el('upcomingBadge').textContent = items.length;
      if (items.length === 0) {
        mount.innerHTML =
          '<div class="state"><div class="big">📅</div><h2>Nothing scheduled</h2>' +
          '<p>No touches are due in the next 7 days.</p></div>';
        return;
      }
      // Group by Toronto civil day, preserving the server's ascending order.
      const groups = [];
      const byKey = new Map();
      for (const it of items) {
        const key = tzDayKey(it.scheduledDate);
        if (!byKey.has(key)) {
          const g = { key, items: [] };
          byKey.set(key, g);
          groups.push(g);
        }
        byKey.get(key).items.push(it);
      }
      mount.innerHTML = groups.map((g) => {
        const niceDate = TZ_NICE.format(new Date(g.key + 'T12:00:00Z'));
        const rows = g.items.map(weekRow).join('');
        return `
          <div class="week-day-group">
            <div class="week-day-head">
              <span class="week-day-name">${esc(dayLabel(g.key))}</span>
              <span class="week-day-date">${esc(niceDate)}</span>
              <span class="week-day-count">${g.items.length}</span>
            </div>
            ${rows}
          </div>`;
      }).join('');
    } catch (e) {
      mount.innerHTML = `<div class="state"><div class="big">⚠️</div><p>${esc(e.message)}</p></div>`;
    }
  }

  el('refreshUpcoming').addEventListener('click', loadUpcoming);

  // ---- KEYBOARD SHORTCUTS --------------------------------------------------
  // Only in the triage view, and never while typing in a field. Enter/y = send,
  // e = edit, s = skip, u = undo (during the grace window).
  document.addEventListener('keydown', (ev) => {
    if (!inTriageView()) return;
    const t = ev.target;
    const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    // During the grace window only Undo is meaningful.
    if (graceTimer) {
      if (ev.key === 'u' || ev.key === 'U' || ev.key === 'Escape') {
        ev.preventDefault();
        cancelGrace();
      }
      return;
    }
    if (editing || previewing) return; // let Back/Cancel buttons handle those modes
    if (busy) return;
    if (cursor >= queue.length || queue.length === 0) return;

    const k = ev.key;
    if (k === 'Enter' || k === 'y' || k === 'Y') {
      ev.preventDefault();
      onSend();
    } else if (k === 'e' || k === 'E') {
      ev.preventDefault();
      editing = true;
      renderTriage();
    } else if (k === 's' || k === 'S') {
      ev.preventDefault();
      onSkip();
    }
  });

  // ---- CALLS ---------------------------------------------------------------

  async function loadCalls() {
    const mount = el('callsMount');
    mount.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading calls…</p></div>';
    try {
      const data = await apiGet('/calls');
      const calls = data.calls || [];
      el('callsBadge').textContent = calls.length;
      if (calls.length === 0) {
        mount.innerHTML =
          '<div class="state"><div class="big">📞</div><h2>No calls due</h2><p>Nothing on the call list for today.</p></div>';
        return;
      }
      mount.innerHTML = calls.map(callRow).join('');
      mount.querySelectorAll('[data-done]').forEach((btn) => {
        btn.addEventListener('click', () => markCallDone(btn.getAttribute('data-done'), btn));
      });
      mount.querySelectorAll('[data-dial]').forEach((btn) => {
        btn.addEventListener('click', () => dialLead(btn.getAttribute('data-dial'), btn));
      });
    } catch (e) {
      mount.innerHTML =
        `<div class="state"><div class="big">⚠️</div><p>${esc(e.message)}</p></div>`;
    }
  }

  function callRow(c) {
    const due = c.dueAt ? new Date(c.dueAt).toISOString().slice(0, 10) : '';
    let sub = '';
    if (c.personName) sub += leadLink(c.personName, c.personId);
    if (c.phone) {
      const tel = c.phone.replace(/[^\d+]/g, '');
      sub += `${c.personName ? ' · ' : ''}<a href="tel:${esc(tel)}">${esc(c.phone)}</a>`;
    }
    if (due) sub += `${sub ? ' · ' : ''}due ${esc(due)}`;
    // Click-to-dial: POST /api/call — the CRM rings Moshe's cell first, then
    // bridges the lead. tel: link on the number stays as a manual fallback.
    const callBtn = c.phone
      ? `<button class="btn call-btn" data-dial="${esc(c.phone.replace(/[^\d+]/g, ''))}">📞 Call</button>`
      : '';
    return `
      <div class="row" data-row="${esc(c.id)}">
        <div class="row-main">
          <div class="row-title">${esc(c.title) || '(untitled task)'}</div>
          <div class="row-sub">${sub || 'No contact linked'}</div>
        </div>
        <div class="row-actions">
          ${callBtn}
          <button class="btn done-btn" data-done="${esc(c.id)}">Done</button>
        </div>
      </div>`;
  }

  async function dialLead(phone, btn) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Calling…';
    try {
      await apiPost('/call', { phone });
      btn.textContent = '📱 Answer your cell';
      toast('Ringing your cell — answer and I’ll connect the lead.');
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 12000);
    } catch (e) {
      btn.textContent = original;
      btn.disabled = false;
      toast('Call failed: ' + e.message, true);
    }
  }

  async function markCallDone(id, btn) {
    btn.disabled = true;
    try {
      await apiPost(`/task/${id}/done`, {});
      const row = document.querySelector(`[data-row="${id}"]`);
      if (row) row.classList.add('done');
      toast('Marked done ✓');
      const badge = el('callsBadge');
      badge.textContent = Math.max(parseInt(badge.textContent, 10) - 1, 0);
    } catch (e) {
      toast('Failed: ' + e.message, true);
      btn.disabled = false;
    }
  }

  el('refreshCalls').addEventListener('click', loadCalls);

  // ---- ROADMAP -------------------------------------------------------------

  async function loadRoadmap() {
    const mount = el('roadmapMount');
    mount.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading roadmap…</p></div>';
    // Version banner: the app is always the latest deployed build (PWA — no
    // download); show WHEN that build went live so Moshe can confirm it.
    let versionLine = '';
    try {
      const v = await apiGet('/version');
      if (v.deployedAt) {
        const d = new Date(v.deployedAt);
        versionLine =
          '<div class="version-banner">✅ You\'re on the latest version — CRM last updated ' +
          esc(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) +
          ' ' + esc(d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) +
          ' (updates automatically on every deploy)</div>';
      }
    } catch (_e) { /* banner is optional */ }
    try {
      const data = await apiGet('/roadmap');
      const items = data.items || [];
      if (items.length === 0) {
        mount.innerHTML = versionLine + '<div class="state"><p>No ideas yet. Add one above.</p></div>';
        return;
      }
      mount.innerHTML = versionLine + items
        .map(
          (it) => `
        <div class="row">
          <div class="row-main"><div class="roadmap-item">💡 ${esc(it.text)}</div></div>
        </div>`
        )
        .join('');
    } catch (e) {
      mount.innerHTML = `<div class="state"><div class="big">⚠️</div><p>${esc(e.message)}</p></div>`;
    }
  }

  async function addIdea() {
    const input = el('ideaInput');
    const text = input.value.trim();
    if (!text) return;
    el('addIdea').disabled = true;
    try {
      await apiPost('/roadmap', { text });
      input.value = '';
      toast('Idea added');
      await loadRoadmap();
    } catch (e) {
      toast('Failed: ' + e.message, true);
    } finally {
      el('addIdea').disabled = false;
    }
  }

  el('addIdea').addEventListener('click', addIdea);
  el('ideaInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addIdea();
  });

  // ---- TRAFFIC LIGHTS --------------------------------------------------------
  //
  // The header strip (like the Zrizes app): RED opens the idea popup, AMBER ?
  // lights while approvals wait on YOUR decision (the triage queue), GREEN
  // hammer (dim) shows roadmap ideas queued for a future build, GREEN ↓
  // (solid) pulses ONLY when the running service is a newer build than the
  // loaded page (click = reload). Idle lights stay slate; nothing else pulses.

  // AMBER — the triage queue: approvals awaiting a Send/Skip decision. Fed by
  // the same loadQueue() that drives the Triage tab, so no extra API call.
  function updateDecisionLight() {
    const btn = el('lightDecision');
    const pop = el('popDecision');
    if (!btn || !pop) return;
    const items = (queue || []).filter((a) => a && !a.done);
    const n = items.length;
    btn.classList.toggle('lit', n > 0);
    btn.title = n
      ? `${n} approval${n === 1 ? '' : 's'} waiting for your decision`
      : 'Nothing needs your decision';

    let html = `<p class="pop-title">Waiting for your call (${n})</p>`;
    if (!n) {
      html += '<p class="pop-empty">Nothing needs a decision right now.</p>';
    } else {
      html += '<ul class="pop-list">' + items.slice(0, 9).map((a) =>
        `<li><span class="tt" title="${esc(a.leadName || '')}">${esc(a.leadName || 'Unknown lead')}</span></li>`).join('') + '</ul>';
      if (n > 9) html += `<p class="pop-more">+${n - 9} more…</p>`;
    }
    html += '<button class="pop-link" id="popOpenTriage" type="button">Open Triage →</button>';
    pop.innerHTML = html;
  }

  // GREEN hammer (dim) — roadmap ideas queued for a future build.
  let roadmapCache = null; // {items, at} — refreshed at most once a minute

  async function roadmapItems() {
    if (!roadmapCache || Date.now() - roadmapCache.at > 60_000) {
      const d = await apiGet('/roadmap');
      roadmapCache = { items: d.items || [], at: Date.now() };
    }
    return roadmapCache.items;
  }

  async function updateQueueLight() {
    const btn = el('lightQueue');
    const pop = el('popQueue');
    if (!btn || !pop) return;
    let items;
    try {
      items = (await roadmapItems()).filter((it) => !it.done);
    } catch (_e) {
      return; // roadmap unreachable — leave the light as-is
    }
    btn.classList.toggle('lit', items.length > 0);
    btn.title = items.length
      ? `${items.length} idea${items.length === 1 ? '' : 's'} queued on the roadmap`
      : 'Nothing queued';

    let html = `<p class="pop-title">Queued on the roadmap (${items.length})</p>`;
    if (!items.length) {
      html += '<p class="pop-empty">Nothing queued — suggest an idea (red icon).</p>';
    } else {
      html += '<ul class="pop-list">' + items.slice(0, 9).map((it) =>
        `<li><span class="tt" title="${esc(it.text)}">💡 ${esc(it.text)}</span></li>`).join('') + '</ul>';
      if (items.length > 9) html += `<p class="pop-more">+${items.length - 9} more…</p>`;
    }
    html += '<button class="pop-link" id="popOpenRoadmap" type="button">Open the Roadmap →</button>';
    pop.innerHTML = html;
  }

  // GREEN ↓ — /api/version poll (every 60s + on tab focus). The baseline sha
  // is the FIRST successful poll of this page lifetime, kept in an in-memory
  // variable ONLY: sessionStorage/localStorage survive location.reload() (the
  // very action this arrow performs) and would leave it stuck pulsing after
  // the reload that applied the update.
  let versionInfo = null;
  let updateReady = false;
  let baselineSha = null;

  async function checkVersion() {
    try {
      const d = await apiGet('/version');
      if (!d || typeof d !== 'object') return;
      versionInfo = d;
      updateReady = false;
      if (d.sha) {
        if (baselineSha === null) {
          baselineSha = d.sha; // this page's baseline — set once, in memory
        } else if (d.sha !== baselineSha) {
          updateReady = true;
        }
      }
      renderUpdateLight();
    } catch (_e) {
      /* version endpoint unreachable — leave the light as-is */
    }
  }

  function renderUpdateLight() {
    const btn = el('lightUpdate');
    const pop = el('popUpdate');
    if (!btn || !pop) return;
    btn.classList.toggle('lit', updateReady);
    btn.title = updateReady
      ? 'Update ready — click to reload and apply'
      : versionInfo && versionInfo.sha
        ? `Up to date (${versionInfo.sha})`
        : 'Version info unavailable';

    let html;
    if (updateReady) {
      html = '<p class="pop-title">Update ready</p>';
      if (versionInfo.builtAt) {
        const d = new Date(versionInfo.builtAt);
        html += `<p class="pop-empty">Built ${esc(d.toLocaleString())}</p>`;
      }
      html += '<button class="pop-reload" id="popReload" type="button">Reload to apply</button>';
    } else {
      html = '<p class="pop-uptodate">✓ You’re up to date' +
        (versionInfo && versionInfo.sha ? ` (${esc(versionInfo.sha)})` : '') + '</p>';
    }
    pop.innerHTML = html;
  }

  function reloadForUpdate() {
    window.location.reload();
  }

  function bindPopover(wrapId, onOpen) {
    const wrap = el(wrapId);
    if (!wrap) return;
    const pop = wrap.querySelector('.pop');
    wrap.addEventListener('mouseenter', () => {
      pop.classList.add('show');
      if (onOpen) onOpen();
    });
    wrap.addEventListener('mouseleave', () => pop.classList.remove('show'));
    wrap.querySelector('.light').addEventListener('click', (e) => {
      e.stopPropagation();
      pop.classList.toggle('show');
    });
  }

  document.addEventListener('click', (e) => {
    document.querySelectorAll('.pop.show').forEach((p) => {
      if (!e.target.closest(`#${p.parentElement.id}`)) p.classList.remove('show');
    });
  });

  el('popDecision').addEventListener('click', (e) => {
    if (e.target.id !== 'popOpenTriage') return;
    el('popDecision').classList.remove('show');
    const tab = document.querySelector('.tab[data-view="triage"]');
    if (tab) tab.click();
  });

  el('popQueue').addEventListener('click', (e) => {
    if (e.target.id !== 'popOpenRoadmap') return;
    el('popQueue').classList.remove('show');
    const tab = document.querySelector('.tab[data-view="roadmap"]');
    if (tab) tab.click();
  });

  el('popUpdate').addEventListener('click', (e) => {
    if (e.target.id === 'popReload') reloadForUpdate();
  });

  el('lightUpdate').addEventListener('click', () => {
    if (updateReady) reloadForUpdate();
  });

  // loadQueue() (boot + tab actions) re-renders the amber light along the way.
  const _renderTriageOrig = renderTriage;
  renderTriage = function (...args) {
    _renderTriageOrig.apply(this, args);
    updateDecisionLight();
  };

  bindPopover('decisionWrap');
  bindPopover('queueWrap', updateQueueLight);
  bindPopover('updateWrap');
  updateDecisionLight();
  updateQueueLight();
  setInterval(checkVersion, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkVersion();
  });
  checkVersion();

  // ---- IDEA POPUP (the red light) ---------------------------------------------

  let qrOpen = false;

  function openIdeaPopup() {
    qrOpen = true;
    el('qrForm').style.display = '';
    el('qrDone').style.display = 'none';
    el('qrOverlay').classList.add('show');
    setTimeout(() => el('qrText').focus(), 60);
  }

  function closeIdeaPopup() {
    qrOpen = false;
    el('qrOverlay').classList.remove('show');
  }

  async function submitIdea() {
    const text = el('qrText').value.trim();
    if (!text) return;
    el('qrSubmit').disabled = true;
    try {
      await apiPost('/roadmap', { text });
      roadmapCache = null; // pick the new item up on the next hover
      el('qrText').value = '';
      el('qrForm').style.display = 'none';
      el('qrDone').style.display = '';
      updateQueueLight();
      setTimeout(closeIdeaPopup, 1400);
    } catch (e) {
      toast('Failed: ' + e.message, true);
    } finally {
      el('qrSubmit').disabled = false;
    }
  }

  el('lightRequest').addEventListener('click', openIdeaPopup);
  el('qrClose').addEventListener('click', closeIdeaPopup);
  el('qrOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeIdeaPopup();
  });
  el('qrSubmit').addEventListener('click', submitIdea);
  el('qrText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitIdea();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && qrOpen) closeIdeaPopup();
  });

  // ---- boot ----------------------------------------------------------------

  loadQueue();
  // Refresh the calls badge in the background so it's populated on first paint.
  apiGet('/calls')
    .then((d) => { el('callsBadge').textContent = (d.calls || []).length; })
    .catch(() => {});
  // Same for the "This Week" badge so the upcoming count shows before opening it.
  apiGet('/upcoming')
    .then((d) => { el('upcomingBadge').textContent = (d.upcoming || []).length; })
    .catch(() => {});

  el('footerNote').textContent =
    'Send = approve (workflow emails via Outlook). Auto-reconciles every 5 min.';
})();
