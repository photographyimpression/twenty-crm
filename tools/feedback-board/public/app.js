// Feedback Board frontend — vanilla JS, no framework.
//
// Layout modeled on Moshe's Zrizes "Requests & bugs" board (his reference
// screenshot): numbered columns with subtitles, an always-visible request
// form in column 1, pale-yellow review cards with a green Approve + outline
// Counter, icon-only delete, and compact one-line Delivered rows that expand
// on click.
//
// The API lives under the same mount path this page is served from, so
// relative URLs work (nginx strips the /board-<TOKEN>/ prefix upstream).

const COLUMNS = [
  { key: 'inbox', num: '1', label: 'Requests', sub: 'Drop what you want or a bug here' },
  { key: 'discussion', num: '2', label: 'Discussion', sub: 'Claude has a question or a better idea — approve or counter' },
  { key: 'tobuild', num: '3', label: 'To Build', sub: 'Agreed — on Claude’s list' },
  { key: 'delivered', num: '4', label: 'Delivered', sub: 'Shipped (you get an email)' },
];

const root = document.getElementById('root');
const toastEl = document.getElementById('toast');

let cards = [];
// Images pasted or picked for the inline request form.
let pendingFiles = [];
let selectedType = 'feature';
// Delivered rows the user has expanded (survive re-renders).
const openRows = new Set();
// Per-card pending comment screenshots: cardId -> [{file, url}]. Pasting while
// a comment box is focused attaches here instead of the request form.
const cmtDrafts = {};

// --- helpers ---------------------------------------------------------------

function api(path, opts) {
  return fetch('api' + path, opts).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'request failed');
    return data;
  });
}

function toast(msg, isErr) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('err', !!isErr);
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function fmtDay(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// --- data ------------------------------------------------------------------

async function load() {
  try {
    const data = await api('/cards');
    cards = Array.isArray(data.cards) ? data.cards : [];
    render();
  } catch (e) {
    root.innerHTML = '<div class="state">Failed to load board: ' + esc(e.message) + '</div>';
  }
}

function cardsFor(col) {
  const list = cards.filter((c) => (c.column || 'inbox') === col);
  if (col === 'delivered') {
    list.sort((a, b) => new Date(b.deliveredAt || b.updatedAt || 0) - new Date(a.deliveredAt || a.updatedAt || 0));
  } else {
    list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }
  return list;
}

// --- rendering -------------------------------------------------------------

function pillHtml(card) {
  const urgent =
    card.urgent && (card.column || 'inbox') !== 'delivered'
      ? '<span class="pill pill-urgent">⚡ Urgent</span>'
      : '';
  return (card.type === 'bug'
    ? '<span class="pill pill-bug">🐞 Bug</span>'
    : '<span class="pill pill-feature">✨ Feature</span>') + urgent;
}

function shotsHtml(card) {
  if (!card.screenshots || !card.screenshots.length) return '';
  return '<div class="shots">' +
    card.screenshots.map((f) => '<img src="uploads/' + esc(f) + '" alt="screenshot" data-shot="uploads/' + esc(f) + '" />').join('') +
    '</div>';
}

function threadHtml(card) {
  const comments = Array.isArray(card.comments) ? card.comments : [];
  if (!comments.length) return '';
  return '<div class="thread">' + comments.map((c) => {
    const shots = Array.isArray(c.screenshots) && c.screenshots.length
      ? '<div class="shots">' + c.screenshots.map((f) =>
          '<img src="uploads/' + esc(f) + '" alt="screenshot" data-shot="uploads/' + esc(f) + '" />').join('') +
        '</div>'
      : '';
    return '<div class="cmt ' + (c.author === 'claude' ? 'claude' : 'moshe') + '">' +
      '<span class="who">' + esc(c.author) + '</span>' +
      '<span class="when">' + fmtDate(c.at) + '</span><br/>' +
      esc(c.text) +
      shots +
    '</div>';
  }).join('') + '</div>';
}

function commentBoxHtml(card) {
  return threadHtml(card) +
    '<div class="shots" data-cmt-shots="' + card.id + '"></div>' +
    '<div class="cmt-add">' +
      '<input type="text" placeholder="Add a comment… (paste a screenshot here too)" data-cmt-input="' + card.id + '" />' +
      '<button class="btn btn-sm" data-act="comment" data-id="' + card.id + '">Add</button>' +
    '</div>';
}

// Draft-screenshot chips under a card's comment box (kept across re-renders).
function renderCmtDrafts() {
  document.querySelectorAll('[data-cmt-shots]').forEach((box) => {
    const id = box.getAttribute('data-cmt-shots');
    const draft = cmtDrafts[id] || [];
    box.innerHTML = draft.map((f, i) =>
      '<span class="shot-thumb"><img src="' + f.url + '" alt="screenshot" />' +
      '<button type="button" class="shot-remove" data-cmt-shot-remove="' + id + ':' + i + '" aria-label="Remove">×</button></span>'
    ).join('');
  });
}

// The form only asks a bug for "what's wrong", so don't label that text "Goal"
// when the card is read back.
function goalLabel(card) {
  return card.type === 'bug' ? 'What’s wrong' : 'Goal';
}

function cardHtml(card) {
  const col = card.column || 'inbox';

  let fields = '';
  if (card.goal) fields += '<div class="kcard-field"><span class="lbl">' + goalLabel(card) + '</span>' + esc(card.goal) + '</div>';
  if (card.idea) fields += '<div class="kcard-field"><span class="lbl">Idea</span>' + esc(card.idea) + '</div>';

  let claudeNote = '';
  if (col === 'discussion' && card.claudeNote) {
    claudeNote = '<div class="claude-note"><span class="lbl">💬 Claude’s suggestion</span>' + esc(card.claudeNote) + '</div>';
  }

  // Top row: pill + (trash icon where delete makes sense).
  const trash = (col === 'inbox' || col === 'discussion')
    ? '<button class="icon-btn" title="Delete card" data-act="delete" data-id="' + card.id + '">🗑</button>'
    : '';

  let actions = '';
  if (col === 'inbox') {
    actions =
      '<button class="btn btn-sm" data-act="move" data-to="discussion" data-id="' + card.id + '">→ Review</button>' +
      '<button class="btn btn-sm" data-act="move" data-to="tobuild" data-id="' + card.id + '">→ To Build</button>';
  } else if (col === 'discussion') {
    actions =
      '<button class="btn btn-green btn-sm" data-act="approve" data-id="' + card.id + '">👍 Approve → build</button>' +
      '<button class="btn btn-sm" data-act="counter" data-id="' + card.id + '">💬 Counter</button>';
  } else if (col === 'tobuild') {
    actions =
      '<button class="btn btn-green btn-sm" data-act="deliver" data-id="' + card.id + '">✓ Mark delivered</button>' +
      '<button class="btn btn-sm" data-act="move" data-to="discussion" data-id="' + card.id + '">← Discussion</button>';
  }

  return '<div class="kcard' + (col === 'discussion' ? ' review' : '') + '" data-card="' + card.id + '">' +
    '<div class="kcard-top">' + pillHtml(card) + '<span class="spacer"></span>' + trash + '</div>' +
    '<div class="kcard-title">' + esc(card.title) + '</div>' +
    fields +
    claudeNote +
    shotsHtml(card) +
    commentBoxHtml(card) +
    '<div class="kcard-actions">' + actions + '</div>' +
    '<div class="kcard-meta">Created ' + fmtDate(card.createdAt) + '</div>' +
  '</div>';
}

// Delivered: compact one-line row, click to expand full detail.
function deliveredRowHtml(card) {
  const open = openRows.has(card.id) ? ' open' : '';
  let detail = '';
  if (card.goal) detail += '<div class="kcard-field"><span class="lbl">' + goalLabel(card) + '</span>' + esc(card.goal) + '</div>';
  if (card.idea) detail += '<div class="kcard-field"><span class="lbl">Idea</span>' + esc(card.idea) + '</div>';
  if (card.deliveredNote) {
    detail += '<div class="delivered-note"><span class="lbl">What shipped</span>' + esc(card.deliveredNote) + '</div>';
  }
  detail += threadHtml(card);
  detail +=
    '<div class="kcard-actions">' +
      '<button class="btn btn-sm" data-act="move" data-to="tobuild" data-id="' + card.id + '">↺ Reopen</button>' +
      '<button class="icon-btn" title="Delete card" data-act="delete" data-id="' + card.id + '">🗑</button>' +
    '</div>';

  return '<div class="drow' + open + '" data-drow="' + card.id + '">' +
    '<div class="drow-line">' + pillHtml(card) +
      '<span class="drow-title">' + esc(card.title) + '</span>' +
      '<span class="drow-date">shipped ' + esc(fmtDay(card.deliveredAt || card.updatedAt)) + '</span>' +
    '</div>' +
    '<div class="drow-detail">' + detail + '</div>' +
  '</div>';
}

function inlineFormHtml() {
  return '<div class="inline-form" id="inlineForm">' +
    '<div class="field type-toggle" id="typeToggle">' +
      '<button type="button" data-type="feature" class="' + (selectedType === 'feature' ? 'active' : '') + '">✨ Feature</button>' +
      '<button type="button" data-type="bug" class="' + (selectedType === 'bug' ? 'active' : '') + '">🐞 Bug</button>' +
    '</div>' +
    // Field labels/visibility adapt to the type: a bug just needs "what's
    // wrong", not a goal + idea (Moshe: "a bug we just tell you the issue").
    '<div class="field" id="goalField">' +
      '<label id="goalLabel">Goal — what you want to achieve <span class="opt">(optional)</span></label>' +
      '<textarea id="goalInput" placeholder="e.g. clients should confirm their shoot time themselves"></textarea>' +
    '</div>' +
    '<div class="field" id="ideaField">' +
      '<label>Idea — how it could work <span class="opt">(optional)</span></label>' +
      '<textarea id="ideaInput" placeholder="e.g. a link in the reminder email…"></textarea>' +
    '</div>' +
    '<label class="urgent-toggle"><input type="checkbox" id="urgentInput" /><span>⚡ Urgent — build this now</span></label>' +
    '<div class="bn-row" data-bn-row></div>' +
    '<div class="shots" id="shotPreview"></div>' +
    '<input type="file" id="fileInput" accept="image/*" multiple hidden />' +
    '<button class="btn btn-primary" id="addRequestBtn" style="width:100%;justify-content:center">🚀 Add request</button>' +
    '<div class="form-err" id="formErr"></div>' +
    '<div class="form-hint">Paste screenshots anywhere on this page — they attach when you add it.</div>' +
  '</div>';
}

function render() {
  root.innerHTML = COLUMNS.map((c) => {
    const list = cardsFor(c.key);
    let body;
    if (c.key === 'delivered') {
      body = list.length ? list.map(deliveredRowHtml).join('') : '<div class="col-empty">Nothing shipped yet.</div>';
    } else {
      body = list.length ? list.map(cardHtml).join('') : '<div class="col-empty">Nothing here.</div>';
    }
    const form = c.key === 'inbox' ? inlineFormHtml() : '';
    return '<section class="col">' +
      '<div class="col-head">' +
        '<div class="col-title-row">' +
          '<div class="col-title"><span class="num">' + c.num + ' ·</span> ' + c.label + '</div>' +
          '<div class="col-count">' + list.length + '</div>' +
        '</div>' +
        '<div class="col-sub">' + c.sub + '</div>' +
      '</div>' +
      form +
      body +
    '</section>';
  }).join('');
  wireInlineForm();
  renderShotPreview();
  renderCmtDrafts();
  updateStatusLights();
}

// --- inline request form -----------------------------------------------------

function renderShotPreview() {
  const shotPreview = document.getElementById('shotPreview');
  if (!shotPreview) return;
  shotPreview.innerHTML = pendingFiles.map((f, i) =>
    '<span class="shot-thumb"><img src="' + f.url + '" alt="screenshot" />' +
    '<button type="button" class="shot-remove" data-shot-remove="' + i + '" aria-label="Remove">×</button></span>'
  ).join('');
}

function addPendingFiles(fileList) {
  for (const file of fileList) {
    if (file && file.type && file.type.startsWith('image/')) {
      pendingFiles.push({ file, url: URL.createObjectURL(file) });
    }
  }
  renderShotPreview();
}

function clearPendingFiles() {
  pendingFiles.forEach((f) => URL.revokeObjectURL(f.url));
  pendingFiles = [];
  renderShotPreview();
}

async function submitInlineForm() {
  const formErr = document.getElementById('formErr');
  const goal = document.getElementById('goalInput').value.trim();
  // Idea is hidden for bugs — drop anything typed before switching type, so a
  // bug card never carries a stale "how it could work" back to the board.
  const idea = selectedType === 'bug' ? '' : document.getElementById('ideaInput').value.trim();
  formErr.textContent = '';

  if (!goal && !idea && pendingFiles.length === 0) {
    formErr.textContent = selectedType === 'bug'
      ? 'Say what’s wrong, or paste a screenshot.'
      : 'Add something — a goal, an idea, or paste a screenshot.';
    return;
  }

  // No title field: the server derives the card title from the goal/idea.
  const fd = new FormData();
  fd.append('type', selectedType);
  fd.append('goal', goal);
  fd.append('idea', idea);
  fd.append('urgent', document.getElementById('urgentInput').checked ? 'true' : 'false');
  pendingFiles.forEach((f) => fd.append('screenshots', f.file));

  const btn = document.getElementById('addRequestBtn');
  btn.disabled = true;
  try {
    await api('/cards', { method: 'POST', body: fd });
    clearPendingFiles();
    document.getElementById('urgentInput').checked = false;
    toast('Added to Requests');
    await load();
  } catch (err) {
    formErr.textContent = err.message || 'Failed to create card.';
    btn.disabled = false;
  }
}

// A bug just needs "what's wrong"; a feature keeps goal + idea. Swap the
// labels and hide the Idea field when Bug is selected.
function applyTypeToForm() {
  const goalLabel = document.getElementById('goalLabel');
  const ideaField = document.getElementById('ideaField');
  const goalInput = document.getElementById('goalInput');
  if (!goalLabel || !ideaField || !goalInput) return;
  if (selectedType === 'bug') {
    goalLabel.innerHTML = 'What’s the bug? What happened?';
    goalInput.placeholder = 'e.g. I replied to an SMS email but the client got no text';
    ideaField.style.display = 'none';
  } else {
    goalLabel.innerHTML = 'Goal — what you want to achieve <span class="opt">(optional)</span>';
    goalInput.placeholder = 'e.g. clients should confirm their shoot time themselves';
    ideaField.style.display = '';
  }
}

function wireInlineForm() {
  const toggle = document.getElementById('typeToggle');
  if (!toggle) return;
  applyTypeToForm();
  renderBuildNowRow();
  toggle.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]');
    if (!b) return;
    selectedType = b.getAttribute('data-type');
    toggle.querySelectorAll('button').forEach((x) =>
      x.classList.toggle('active', x.getAttribute('data-type') === selectedType));
    applyTypeToForm();
  });
  document.getElementById('addRequestBtn').addEventListener('click', submitInlineForm);
  const shotPreview = document.getElementById('shotPreview');
  shotPreview.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shot-remove]');
    if (!btn) return;
    e.stopPropagation();
    const removed = pendingFiles.splice(Number(btn.getAttribute('data-shot-remove')), 1)[0];
    if (removed) URL.revokeObjectURL(removed.url);
    renderShotPreview();
  });
}

// --- build everything waiting — now ------------------------------------------
//
// Secondary action under the urgent checkbox (inline intake form + the
// quick-request popup): raises the board's buildNow flag so the autonomous
// builder picks up the whole queue immediately instead of waiting for its next
// run (it clears the flag itself once the run starts). Two-tap inline confirm;
// one delegated handler serves both forms, and armed-state lives here so it
// survives the inline form re-rendering.

const BN_IDLE =
  '<button type="button" class="btn bn-trigger" data-bn="arm">🔨 Build everything waiting — now</button>';
const BN_CONFIRM =
  '<span class="bn-q">Build <b>everything</b> waiting, now?</span>' +
  '<button type="button" class="btn btn-sm btn-green" data-bn="go">Yes — build</button>' +
  '<button type="button" class="btn btn-sm" data-bn="cancel">Cancel</button>';
let bnArmed = false;
let bnBusy = false;

function renderBuildNowRow() {
  document.querySelectorAll('[data-bn-row]').forEach((row) => {
    row.innerHTML = bnArmed ? BN_CONFIRM : BN_IDLE;
  });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bn]');
  if (!b || bnBusy) return;
  const act = b.getAttribute('data-bn');
  if (act === 'arm') {
    bnArmed = true;
    renderBuildNowRow();
  } else if (act === 'cancel') {
    bnArmed = false;
    renderBuildNowRow();
  } else if (act === 'go') {
    bnBusy = true;
    b.disabled = true;
    api('/build-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ set: true }),
    })
      .then(() => {
        bnArmed = false;
        toast('Queued — the builder will start within ~15 min.');
      })
      .catch((err) => {
        b.disabled = false;
        toast(err.message || 'Failed to trigger the build.', true);
      })
      .finally(() => {
        bnBusy = false;
        renderBuildNowRow();
      });
  }
});
renderBuildNowRow();

// Paste screenshots anywhere on the page. If the quick-request popup is open
// the image attaches THERE; if a comment box is focused, to THAT comment;
// otherwise it goes to the inline request form.
document.addEventListener('paste', (e) => {
  const images = Array.from(e.clipboardData ? e.clipboardData.items : [])
    .filter((it) => it.type && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (!images.length) return;
  e.preventDefault();
  if (qrOpen) {
    images.forEach((file) => qrFiles.push({ file, url: URL.createObjectURL(file) }));
    renderQrShots();
    return;
  }
  const active = document.activeElement;
  if (active && active.matches && active.matches('[data-cmt-input]')) {
    const id = active.getAttribute('data-cmt-input');
    if (!cmtDrafts[id]) cmtDrafts[id] = [];
    images.forEach((file) => cmtDrafts[id].push({ file, url: URL.createObjectURL(file) }));
    renderCmtDrafts();
  } else {
    addPendingFiles(images);
  }
});

// Remove a pending comment screenshot chip.
root.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cmt-shot-remove]');
  if (!btn) return;
  e.stopPropagation();
  const [id, idx] = btn.getAttribute('data-cmt-shot-remove').split(':');
  const removed = (cmtDrafts[id] || []).splice(Number(idx), 1)[0];
  if (removed) URL.revokeObjectURL(removed.url);
  renderCmtDrafts();
});

// --- card actions ------------------------------------------------------------

async function doMove(id, to) {
  await api('/cards/' + id + '/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column: to }),
  });
  toast('Moved');
  await load();
}

async function doDeliver(id) {
  const note = prompt('Delivered note (optional) — what shipped?') || '';
  await api('/cards/' + id + '/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column: 'delivered', deliveredNote: note }),
  });
  toast('Delivered ✅');
  await load();
}

async function doApprove(id) {
  await api('/cards/' + id + '/approve', { method: 'POST' });
  toast('Approved → To Build');
  await load();
}

async function doCounter(id) {
  const text = prompt('Your counter-comment (sends the card back to Requests):');
  if (!text || !text.trim()) return;
  await api('/cards/' + id + '/counter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.trim() }),
  });
  toast('Countered → Requests');
  await load();
}

async function doComment(id) {
  const input = document.querySelector('[data-cmt-input="' + id + '"]');
  const text = (input && input.value.trim()) || '';
  const draft = cmtDrafts[id] || [];
  if (!text && draft.length === 0) return;
  if (draft.length > 0) {
    // Multipart when screenshots are attached.
    const fd = new FormData();
    fd.append('author', 'moshe');
    fd.append('text', text);
    draft.forEach((f) => fd.append('screenshots', f.file));
    await api('/cards/' + id + '/comment', { method: 'POST', body: fd });
    draft.forEach((f) => URL.revokeObjectURL(f.url));
    delete cmtDrafts[id];
  } else {
    await api('/cards/' + id + '/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: 'moshe', text }),
    });
  }
  await load();
}

async function doDelete(id) {
  if (!confirm('Delete this card permanently?')) return;
  await api('/cards/' + id, { method: 'DELETE' });
  openRows.delete(id);
  toast('Deleted');
  await load();
}

// Event delegation for all card buttons + delivered-row expansion.
root.addEventListener('click', (e) => {
  const shot = e.target.closest('[data-shot]');
  if (shot) { openLightbox(shot.getAttribute('data-shot')); return; }

  const btn = e.target.closest('[data-act]');
  if (btn) {
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-id');
    btn.disabled = true;
    const done = () => { btn.disabled = false; };
    const fail = (err) => { btn.disabled = false; toast(err.message || 'failed', true); };

    if (act === 'move') doMove(id, btn.getAttribute('data-to')).catch(fail).finally(done);
    else if (act === 'deliver') doDeliver(id).catch(fail).finally(done);
    else if (act === 'approve') doApprove(id).catch(fail).finally(done);
    else if (act === 'counter') doCounter(id).catch(fail).finally(done);
    else if (act === 'comment') doComment(id).catch(fail).finally(done);
    else if (act === 'delete') doDelete(id).catch(fail).finally(done);
    return;
  }

  // Expand/collapse a delivered row (ignore clicks inside inputs/details).
  const drow = e.target.closest('[data-drow]');
  if (drow && !e.target.closest('.drow-detail')) {
    const id = drow.getAttribute('data-drow');
    if (openRows.has(id)) openRows.delete(id); else openRows.add(id);
    drow.classList.toggle('open');
  }
});

// Enter-to-submit in a comment input.
root.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-cmt-input]')) {
    e.preventDefault();
    doComment(e.target.getAttribute('data-cmt-input')).catch((err) => toast(err.message, true));
  }
});

// --- lightbox --------------------------------------------------------------

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
function openLightbox(src) { lightboxImg.src = src; lightbox.classList.add('show'); }
lightbox.addEventListener('click', () => lightbox.classList.remove('show'));

// Refresh when the tab regains focus (picks up Claude's direct board edits).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});

// --- traffic lights ---------------------------------------------------------
//
// The header strip (like the Zrizes app): RED opens the quick-request popup,
// AMBER ? lights while cards sit in Discussion waiting on YOUR decision,
// GREEN hammer (dim) shows the build queue (Requests + To Build, urgent ⚡
// first on hover), GREEN ↓ (solid) pulses ONLY when the running service is a
// newer build than the loaded page (hover = recent deliveries, click =
// reload). Idle lights stay slate; nothing else pulses.

const COLUMN_LABEL = { inbox: 'Requested', discussion: 'Discussion', tobuild: 'To Build' };

// AMBER — the Discussion column: the only cards the build loop deliberately
// skips, i.e. exactly the ones worth a persistent light.
function updateDecisionLight() {
  const btn = document.getElementById('lightDecision');
  const pop = document.getElementById('popDecision');
  if (!btn || !pop) return;
  const items = cards.filter((c) => (c.column || 'inbox') === 'discussion');
  const n = items.length;
  btn.classList.toggle('lit', n > 0);
  btn.title = n
    ? n + ' card' + (n === 1 ? '' : 's') + ' waiting for your decision'
    : 'Nothing needs your decision';

  let html = '<p class="pop-title">Waiting for your call (' + n + ')</p>';
  if (!n) {
    html += '<p class="pop-empty">Nothing needs a decision right now.</p>';
  } else {
    html += '<ul class="pop-list">' + items.slice(0, 9).map((c) =>
      '<li><span class="t"><span class="tt">' + esc(c.title) + '</span></span></li>'
    ).join('') + '</ul>';
    if (n > 9) html += '<p class="pop-more">+' + (n - 9) + ' more…</p>';
  }
  html += '<button class="pop-link" id="popOpenBoard" type="button">Answer on the board →</button>';
  pop.innerHTML = html;
}

// GREEN hammer (dim) — the build queue: everything accepted/requested that is
// NOT in Discussion (those wait on the owner) and not delivered yet.
function updateQueueLight() {
  const btn = document.getElementById('lightQueue');
  const pop = document.getElementById('popQueue');
  if (!btn || !pop) return;
  const items = cards
    .filter((c) => {
      const col = c.column || 'inbox';
      return col === 'inbox' || col === 'tobuild';
    })
    .sort((a, b) => {
      if (!!b.urgent !== !!a.urgent) return b.urgent ? 1 : -1; // urgent first
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0); // FIFO
    });
  const n = items.length;
  const urgent = items.filter((c) => c.urgent).length;
  btn.classList.toggle('lit', n > 0);
  btn.title = n
    ? (urgent ? urgent + ' urgent · ' : '') + n + ' queued for the next build'
    : 'Nothing queued';

  let html = '<p class="pop-title">Queued for the next build (' + n + ')</p>';
  if (!n) {
    html += '<p class="pop-empty">Nothing queued — drop a request any time (red icon).</p>';
  } else {
    html += '<ul class="pop-list">' + items.slice(0, 9).map((c) =>
      '<li>' + (c.urgent ? '<span class="zap">⚡</span>' : '') +
      '<span class="t"><span class="tt">' + esc(c.title) + '</span>' +
      '<span class="st">' + esc(COLUMN_LABEL[c.column || 'inbox'] || c.column) + '</span></span></li>'
    ).join('') + '</ul>';
    if (n > 9) html += '<p class="pop-more">+' + (n - 9) + ' more…</p>';
  }
  html += '<button class="pop-link" id="popOpenQueue" type="button">Open the board →</button>';
  pop.innerHTML = html;
}

function updateStatusLights() {
  updateDecisionLight();
  updateQueueLight();
}

// GREEN ↓ — /api/version poll (every 60s + on tab focus). The baseline sha is
// the FIRST successful poll of this page lifetime, kept in an in-memory
// variable ONLY: sessionStorage/localStorage survive location.reload() (the
// very action this light performs) and would leave it stuck pulsing after the
// reload that applied the update. Any later poll that sees a different sha
// means the running service is newer than the loaded page.
let versionInfo = null;
let updateReady = false;
let baselineSha = null;

async function checkVersion() {
  try {
    const d = await api('/version');
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
  const btn = document.getElementById('lightUpdate');
  const pop = document.getElementById('popUpdate');
  if (!btn || !pop) return;
  btn.classList.toggle('lit', updateReady);
  btn.title = updateReady
    ? 'Update ready — click to reload and apply'
    : versionInfo && versionInfo.sha
      ? 'Up to date (' + versionInfo.sha + ')'
      : 'Version info unavailable';

  let html;
  if (updateReady) {
    html = '<p class="pop-title">Update ready</p>';
    const shipped = (versionInfo.recentlyDelivered || []).slice(0, 8);
    if (shipped.length) {
      html += '<p class="pop-empty" style="margin:0 0 6px">Recently shipped:</p>' +
        '<ul class="pop-list">' + shipped.map((s) =>
          '<li><span class="t"><span class="tt">' + esc(s.title) + '</span></span></li>').join('') + '</ul>';
    }
    html += '<button class="pop-reload" id="popReload" type="button">Reload to apply</button>';
  } else {
    html = '<p class="pop-uptodate">✓ You’re up to date' +
      (versionInfo && versionInfo.sha ? ' (' + esc(versionInfo.sha) + ')' : '') + '</p>';
  }
  pop.innerHTML = html;
}

function reloadForUpdate() {
  location.reload();
}

// Hover popovers (+ click-toggle for touch). Clicking elsewhere closes them.
function bindPopover(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const pop = wrap.querySelector('.pop');
  wrap.addEventListener('mouseenter', () => pop.classList.add('show'));
  wrap.addEventListener('mouseleave', () => pop.classList.remove('show'));
  wrap.querySelector('.light').addEventListener('click', (e) => {
    e.stopPropagation();
    pop.classList.toggle('show');
  });
}

document.addEventListener('click', (e) => {
  document.querySelectorAll('.pop.show').forEach((p) => {
    if (!e.target.closest('#' + p.parentElement.id)) p.classList.remove('show');
  });
});

// Popover links scroll to the board — the Discussion column for the amber
// "your call" list, the top of the board for the queue list.
function popLinkToBoard(popId, columnKey) {
  document.getElementById(popId).classList.remove('show');
  let target = null;
  const cols = document.querySelectorAll('#root .col');
  if (columnKey) {
    // Column order is fixed: inbox(0) discussion(1) tobuild(2) delivered(3).
    const order = ['inbox', 'discussion', 'tobuild', 'delivered'];
    target = cols[order.indexOf(columnKey)] || null;
  }
  (target || cols[0]).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('popDecision').addEventListener('click', (e) => {
  if (e.target.id === 'popOpenBoard') popLinkToBoard('popDecision', 'discussion');
});

document.getElementById('popQueue').addEventListener('click', (e) => {
  if (e.target.id === 'popOpenQueue') popLinkToBoard('popQueue', null);
});

document.getElementById('popUpdate').addEventListener('click', (e) => {
  if (e.target.id === 'popReload') reloadForUpdate();
});

document.getElementById('lightUpdate').addEventListener('click', () => {
  if (updateReady) reloadForUpdate();
});

setInterval(checkVersion, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkVersion();
});
checkVersion();

// --- quick-request popup (the red light) -------------------------------------

let qrOpen = false;
let qrType = 'feature';
let qrFiles = [];

function applyQrType() {
  const toggle = document.getElementById('qrTypeToggle');
  toggle.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', b.getAttribute('data-type') === qrType));
  document.getElementById('qrIdeaField').style.display = qrType === 'bug' ? 'none' : '';
  document.getElementById('qrGoalLabel').textContent = qrType === 'bug'
    ? 'What’s the bug? What happened?'
    : 'Goal — what you want to achieve';
  document.getElementById('qrTitle').textContent = qrType === 'bug' ? '🐞 Bug report' : '✨ Feature request';
  document.getElementById('qrGoal').placeholder = qrType === 'bug'
    ? 'e.g. I replied to an SMS email but the client got no text'
    : 'e.g. clients should confirm their shoot time themselves';
}

function renderQrShots() {
  const box = document.getElementById('qrShots');
  box.innerHTML = qrFiles.map((f, i) =>
    '<span class="shot-thumb"><img src="' + f.url + '" alt="screenshot" />' +
    '<button type="button" class="shot-remove" data-qr-shot-remove="' + i + '" aria-label="Remove">×</button></span>'
  ).join('');
}

function openQuickRequest() {
  qrOpen = true;
  document.getElementById('qrForm').style.display = '';
  document.getElementById('qrDone').style.display = 'none';
  document.getElementById('qrErr').textContent = '';
  document.getElementById('qrOverlay').classList.add('show');
  applyQrType();
  setTimeout(() => document.getElementById('qrGoal').focus(), 60);
}

function closeQuickRequest() {
  qrOpen = false;
  document.getElementById('qrOverlay').classList.remove('show');
}

async function submitQuickRequest() {
  const err = document.getElementById('qrErr');
  const goal = document.getElementById('qrGoal').value.trim();
  const idea = qrType === 'bug' ? '' : document.getElementById('qrIdea').value.trim();
  const urgent = document.getElementById('qrUrgent').checked;
  err.textContent = '';
  if (!goal && !idea && qrFiles.length === 0) {
    err.textContent = qrType === 'bug'
      ? 'Say what’s wrong, or paste a screenshot.'
      : 'Add something — a goal, an idea, or paste a screenshot.';
    return;
  }
  const fd = new FormData();
  fd.append('type', qrType);
  fd.append('goal', goal);
  fd.append('idea', idea);
  fd.append('urgent', urgent ? 'true' : 'false');
  qrFiles.forEach((f) => fd.append('screenshots', f.file));

  const btn = document.getElementById('qrSubmit');
  btn.disabled = true;
  try {
    await api('/cards', { method: 'POST', body: fd });
    qrFiles.forEach((f) => URL.revokeObjectURL(f.url));
    qrFiles = [];
    renderQrShots();
    document.getElementById('qrGoal').value = '';
    document.getElementById('qrIdea').value = '';
    document.getElementById('qrUrgent').checked = false;
    document.getElementById('qrForm').style.display = 'none';
    document.getElementById('qrDone').style.display = '';
    await load();
    setTimeout(closeQuickRequest, 1400);
  } catch (e) {
    err.textContent = e.message || 'Failed to create card.';
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('lightRequest').addEventListener('click', openQuickRequest);
document.getElementById('qrClose').addEventListener('click', closeQuickRequest);
document.getElementById('qrOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeQuickRequest();
});
document.getElementById('qrTypeToggle').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-type]');
  if (!b) return;
  qrType = b.getAttribute('data-type');
  applyQrType();
});
document.getElementById('qrSubmit').addEventListener('click', submitQuickRequest);
document.getElementById('qrShots').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-qr-shot-remove]');
  if (!btn) return;
  const removed = qrFiles.splice(Number(btn.getAttribute('data-qr-shot-remove')), 1)[0];
  if (removed) URL.revokeObjectURL(removed.url);
  renderQrShots();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && qrOpen) closeQuickRequest();
});

// Route pasted screenshots into the popup when it's open (the earlier paste
// handler handles the inline form + focused comment boxes).

bindPopover('decisionWrap');
bindPopover('queueWrap');
bindPopover('updateWrap');
updateStatusLights();

load();
