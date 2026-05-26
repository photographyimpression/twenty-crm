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

  // ---- helpers -------------------------------------------------------------

  function el(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
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

  async function apiGet(pathName) {
    const res = await fetch(`${API}${pathName}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }

  async function apiPost(pathName, body) {
    const res = await fetch(`${API}${pathName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
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
    });
  });

  // ---- TRIAGE --------------------------------------------------------------

  function renderTriage() {
    const mount = el('triageMount');
    const counter = el('counter');
    const remaining = queue.length - cursor;
    el('triageBadge').textContent = Math.max(remaining, 0);

    if (queue.length === 0) {
      counter.textContent = '';
      mount.innerHTML =
        '<div class="state"><div class="big">🎉</div><h2>Inbox zero</h2>' +
        '<p>Nothing to approve right now. Nicely done.</p>' +
        '<p style="margin-top:14px;"><button class="refresh" id="reloadTri">↻ Check again</button></p></div>';
      el('reloadTri').addEventListener('click', loadQueue);
      return;
    }

    if (cursor >= queue.length) {
      counter.textContent = '';
      mount.innerHTML =
        '<div class="state"><div class="big">✅</div><h2>All caught up</h2>' +
        '<p>You cleared today\'s queue.</p>' +
        '<p style="margin-top:14px;"><button class="refresh" id="reloadTri">↻ Check for more</button></p></div>';
      el('reloadTri').addEventListener('click', loadQueue);
      return;
    }

    const a = queue[cursor];
    counter.innerHTML = `<b>${remaining}</b> left today`;

    if (editing) {
      mount.innerHTML = `
        <div class="card">
          <span class="pill">Touch ${esc(a.touchNumber)} of 12 · editing</span>
          <div class="lead-name">${esc(a.leadName) || 'Unknown lead'}</div>
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
          <span class="pill">Touch ${esc(a.touchNumber)} of 12</span>
          ${a.productType ? `<span class="pill">${esc(a.productType)}</span>` : ''}
          ${dueLabel ? `<span class="pill">due ${esc(dueLabel)}</span>` : ''}
        </div>
        <div class="lead-name">${esc(a.leadName) || 'Unknown lead'}</div>
        <div class="company">${esc(a.companyName) || ''}</div>
        <div class="recipient">To: <b>${esc(a.recipientEmail)}</b></div>
        <div class="subject">${esc(a.emailSubject) || '(no subject)'}</div>
        <div class="body">${esc(a.emailBody) || '(empty body)'}</div>
        <div class="actions">
          <button class="btn btn-send" id="sendBtn">Send ✓</button>
          <button class="btn btn-edit" id="editBtn">Edit</button>
          <button class="btn btn-skip" id="skipBtn">Skip</button>
        </div>
      </div>`;

    el('sendBtn').addEventListener('click', onSend);
    el('skipBtn').addEventListener('click', onSkip);
    el('editBtn').addEventListener('click', () => { editing = true; renderTriage(); });
  }

  function setBusy(state) {
    busy = state;
    document.querySelectorAll('#triageMount .btn').forEach((b) => (b.disabled = state));
  }

  function advance() {
    cursor += 1;
    editing = false;
    renderTriage();
  }

  async function onSend() {
    if (busy) return;
    const a = queue[cursor];
    setBusy(true);
    try {
      await apiPost(`/approval/${a.id}/send`, {});
      toast('Sent ✓');
      advance();
    } catch (e) {
      toast('Send failed: ' + e.message, true);
      setBusy(false);
    }
  }

  async function onSkip() {
    if (busy) return;
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
      cursor = 0;
      editing = false;
      busy = false;
      renderTriage();
    } catch (e) {
      el('triageMount').innerHTML =
        `<div class="state"><div class="big">⚠️</div><h2>Could not load</h2><p>${esc(e.message)}</p>` +
        '<p style="margin-top:14px;"><button class="refresh" id="reloadTri">↻ Retry</button></p></div>';
      el('reloadTri').addEventListener('click', loadQueue);
    }
  }

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
    } catch (e) {
      mount.innerHTML =
        `<div class="state"><div class="big">⚠️</div><p>${esc(e.message)}</p></div>`;
    }
  }

  function callRow(c) {
    const due = c.dueAt ? new Date(c.dueAt).toISOString().slice(0, 10) : '';
    let sub = '';
    if (c.personName) sub += esc(c.personName);
    if (c.phone) {
      const tel = c.phone.replace(/[^\d+]/g, '');
      sub += `${c.personName ? ' · ' : ''}<a href="tel:${esc(tel)}">${esc(c.phone)}</a>`;
    }
    if (due) sub += `${sub ? ' · ' : ''}due ${esc(due)}`;
    const callBtn = c.phone
      ? `<a class="btn call-btn" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">Call</a>`
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
    try {
      const data = await apiGet('/roadmap');
      const items = data.items || [];
      if (items.length === 0) {
        mount.innerHTML = '<div class="state"><p>No ideas yet. Add one above.</p></div>';
        return;
      }
      mount.innerHTML = items
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

  // ---- boot ----------------------------------------------------------------

  loadQueue();
  // Refresh the calls badge in the background so it's populated on first paint.
  apiGet('/calls')
    .then((d) => { el('callsBadge').textContent = (d.calls || []).length; })
    .catch(() => {});

  el('footerNote').textContent =
    'Send = approve (workflow emails via Outlook). Auto-reconciles every 5 min.';
})();
