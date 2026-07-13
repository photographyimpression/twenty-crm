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
  return card.type === 'bug'
    ? '<span class="pill pill-bug">🐞 Bug</span>'
    : '<span class="pill pill-feature">✨ Feature</span>';
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

function cardHtml(card) {
  const col = card.column || 'inbox';

  let fields = '';
  if (card.goal) fields += '<div class="kcard-field"><span class="lbl">Goal</span>' + esc(card.goal) + '</div>';
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
  if (card.goal) detail += '<div class="kcard-field"><span class="lbl">Goal</span>' + esc(card.goal) + '</div>';
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
    '<div class="field">' +
      '<label>Goal — what you want to achieve <span class="opt">(optional)</span></label>' +
      '<textarea id="goalInput" placeholder="e.g. clients should confirm their shoot time themselves"></textarea>' +
    '</div>' +
    '<div class="field">' +
      '<label>Idea — how it could work <span class="opt">(optional)</span></label>' +
      '<textarea id="ideaInput" placeholder="e.g. a link in the reminder email…"></textarea>' +
    '</div>' +
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
  const idea = document.getElementById('ideaInput').value.trim();
  formErr.textContent = '';

  if (!goal && !idea && pendingFiles.length === 0) {
    formErr.textContent = 'Add something — a goal, an idea, or paste a screenshot.';
    return;
  }

  // No title field: the server derives the card title from the goal/idea.
  const fd = new FormData();
  fd.append('type', selectedType);
  fd.append('goal', goal);
  fd.append('idea', idea);
  pendingFiles.forEach((f) => fd.append('screenshots', f.file));

  const btn = document.getElementById('addRequestBtn');
  btn.disabled = true;
  try {
    await api('/cards', { method: 'POST', body: fd });
    clearPendingFiles();
    toast('Added to Requests');
    await load();
  } catch (err) {
    formErr.textContent = err.message || 'Failed to create card.';
    btn.disabled = false;
  }
}

function wireInlineForm() {
  const toggle = document.getElementById('typeToggle');
  if (!toggle) return;
  toggle.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]');
    if (!b) return;
    selectedType = b.getAttribute('data-type');
    toggle.querySelectorAll('button').forEach((x) =>
      x.classList.toggle('active', x.getAttribute('data-type') === selectedType));
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

// Paste screenshots anywhere on the page. If a comment box is focused, the
// image attaches to THAT comment; otherwise it goes to the request form.
document.addEventListener('paste', (e) => {
  const images = Array.from(e.clipboardData ? e.clipboardData.items : [])
    .filter((it) => it.type && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (!images.length) return;
  e.preventDefault();
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

load();
