// Feedback Board frontend — vanilla JS, no framework.
//
// The API lives under the same mount path this page is served from, so we build
// relative URLs (the nginx prefix, e.g. /board-<TOKEN>/, is stripped upstream
// so the app itself sees /api and /uploads at the root — relative paths just work).

const COLUMNS = [
  { key: 'inbox', label: 'Inbox', icon: '📥' },
  { key: 'discussion', label: 'Discussion', icon: '💬' },
  { key: 'tobuild', label: 'To Build', icon: '🛠️' },
  { key: 'delivered', label: 'Delivered', icon: '✅' },
];

const root = document.getElementById('root');
const toastEl = document.getElementById('toast');

let cards = [];

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
    // Newest first by deliveredAt (fallback updatedAt).
    list.sort((a, b) => new Date(b.deliveredAt || b.updatedAt || 0) - new Date(a.deliveredAt || a.updatedAt || 0));
  } else {
    list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }
  return list;
}

// --- rendering -------------------------------------------------------------

function shotsHtml(card) {
  if (!card.screenshots || !card.screenshots.length) return '';
  return '<div class="shots">' +
    card.screenshots.map((f) => '<img src="uploads/' + esc(f) + '" alt="screenshot" data-shot="uploads/' + esc(f) + '" />').join('') +
    '</div>';
}

function threadHtml(card) {
  const comments = Array.isArray(card.comments) ? card.comments : [];
  if (!comments.length) return '';
  return '<div class="thread">' + comments.map((c) =>
    '<div class="cmt ' + (c.author === 'claude' ? 'claude' : 'moshe') + '">' +
      '<span class="who">' + esc(c.author) + '</span>' +
      '<span class="when">' + fmtDate(c.at) + '</span><br/>' +
      esc(c.text) +
    '</div>'
  ).join('') + '</div>';
}

function cardHtml(card) {
  const col = card.column || 'inbox';
  const typePill = card.type === 'bug'
    ? '<span class="pill pill-bug">Bug</span>'
    : '<span class="pill pill-feature">Feature</span>';

  let fields = '';
  if (card.goal) fields += '<div class="kcard-field"><span class="lbl">Goal</span>' + esc(card.goal) + '</div>';
  if (card.idea) fields += '<div class="kcard-field"><span class="lbl">Idea</span>' + esc(card.idea) + '</div>';

  let claudeNote = '';
  if (col === 'discussion' && card.claudeNote) {
    claudeNote = '<div class="claude-note"><span class="lbl">🤖 Claude proposes</span>' + esc(card.claudeNote) + '</div>';
  }

  let deliveredNote = '';
  if (col === 'delivered' && card.deliveredNote) {
    deliveredNote = '<div class="delivered-note"><span class="lbl">Delivered</span>' + esc(card.deliveredNote) + '</div>';
  }

  // Per-column action buttons.
  let actions = '';
  if (col === 'inbox') {
    actions =
      '<button class="btn btn-accent btn-sm" data-act="move" data-to="discussion" data-id="' + card.id + '">→ Send to review</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="move" data-to="tobuild" data-id="' + card.id + '">→ To Build</button>' +
      '<button class="btn btn-red btn-sm" data-act="delete" data-id="' + card.id + '">Delete</button>';
  } else if (col === 'discussion') {
    actions =
      '<button class="btn btn-green btn-sm" data-act="approve" data-id="' + card.id + '">✓ Approve → To Build</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="counter" data-id="' + card.id + '">↩ Counter → Inbox</button>';
  } else if (col === 'tobuild') {
    actions =
      '<button class="btn btn-ghost btn-sm" data-act="move" data-to="discussion" data-id="' + card.id + '">← Discussion</button>' +
      '<button class="btn btn-green btn-sm" data-act="deliver" data-id="' + card.id + '">✓ Mark delivered</button>';
  } else if (col === 'delivered') {
    actions =
      '<button class="btn btn-ghost btn-sm" data-act="move" data-to="tobuild" data-id="' + card.id + '">↺ Reopen</button>' +
      '<button class="btn btn-red btn-sm" data-act="delete" data-id="' + card.id + '">Delete</button>';
  }

  // Comment thread + add box — available on inbox/discussion/tobuild.
  let commentBox = '';
  if (col !== 'delivered') {
    commentBox =
      threadHtml(card) +
      '<div class="cmt-add">' +
        '<input type="text" placeholder="Add a comment…" data-cmt-input="' + card.id + '" />' +
        '<button class="btn btn-ghost btn-sm" data-act="comment" data-id="' + card.id + '">Add</button>' +
      '</div>';
  } else {
    commentBox = threadHtml(card);
  }

  const deliveredMeta = col === 'delivered' && card.deliveredAt
    ? 'Delivered ' + fmtDate(card.deliveredAt)
    : 'Created ' + fmtDate(card.createdAt);

  return '<div class="kcard" data-card="' + card.id + '">' +
    '<div class="kcard-top">' + typePill + '</div>' +
    '<div class="kcard-title">' + esc(card.title) + '</div>' +
    fields +
    claudeNote +
    deliveredNote +
    shotsHtml(card) +
    commentBox +
    '<div class="kcard-actions">' + actions + '</div>' +
    '<div class="kcard-meta">' + deliveredMeta + '</div>' +
  '</div>';
}

function render() {
  root.innerHTML = COLUMNS.map((c) => {
    const list = cardsFor(c.key);
    const body = list.length
      ? list.map(cardHtml).join('')
      : '<div class="col-empty">No cards</div>';
    return '<section class="col col-accent-' + c.key + '">' +
      '<div class="col-head">' +
        '<div class="col-title">' + c.icon + ' ' + c.label + ' <span class="count">' + list.length + '</span></div>' +
      '</div>' +
      body +
    '</section>';
  }).join('');
}

// --- actions ---------------------------------------------------------------

async function doMove(id, to) {
  await api('/cards/' + id + '/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column: to }),
  });
  toast('Moved to ' + to);
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
  const text = prompt('Your counter-comment (sends the card back to Inbox):');
  if (!text || !text.trim()) return;
  await api('/cards/' + id + '/counter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.trim() }),
  });
  toast('Countered → Inbox');
  await load();
}

async function doComment(id) {
  const input = document.querySelector('[data-cmt-input="' + id + '"]');
  const text = input && input.value.trim();
  if (!text) return;
  await api('/cards/' + id + '/comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: 'moshe', text }),
  });
  await load();
}

async function doDelete(id) {
  if (!confirm('Delete this card permanently?')) return;
  await api('/cards/' + id, { method: 'DELETE' });
  toast('Deleted');
  await load();
}

async function sendAllToReview() {
  const inbox = cardsFor('inbox');
  if (!inbox.length) { toast('Inbox is empty'); return; }
  if (!confirm('Send all ' + inbox.length + ' Inbox card(s) to Discussion?')) return;
  for (const c of inbox) {
    await api('/cards/' + c.id + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column: 'discussion' }),
    });
  }
  toast('Sent ' + inbox.length + ' to review');
  await load();
}

// Event delegation for all card buttons.
root.addEventListener('click', (e) => {
  const shot = e.target.closest('[data-shot]');
  if (shot) { openLightbox(shot.getAttribute('data-shot')); return; }

  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  const act = btn.getAttribute('data-act');
  btn.disabled = true;
  const done = () => { btn.disabled = false; };
  const fail = (err) => { btn.disabled = false; toast(err.message || 'failed', true); };

  if (act === 'move') doMove(id, btn.getAttribute('data-to')).catch(fail).finally(done);
  else if (act === 'deliver') doDeliver(id).catch(fail).finally(done);
  else if (act === 'approve') doApprove(id).catch(fail).finally(done);
  else if (act === 'counter') doCounter(id).catch(fail).finally(done);
  else if (act === 'comment') doComment(id).catch(fail).finally(done);
  else if (act === 'delete') doDelete(id).catch(fail).finally(done);
});

// Enter-to-submit in a comment input.
root.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-cmt-input]')) {
    e.preventDefault();
    doComment(e.target.getAttribute('data-cmt-input')).catch((err) => toast(err.message, true));
  }
});

document.getElementById('sendAllBtn').addEventListener('click', () => {
  sendAllToReview().catch((e) => toast(e.message, true));
});

// --- lightbox --------------------------------------------------------------

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
function openLightbox(src) { lightboxImg.src = src; lightbox.classList.add('show'); }
lightbox.addEventListener('click', () => lightbox.classList.remove('show'));

// --- new-card modal --------------------------------------------------------

const backdrop = document.getElementById('modalBackdrop');
const form = document.getElementById('cardForm');
const formErr = document.getElementById('formErr');
const fileInput = document.getElementById('fileInput');
const shotPreview = document.getElementById('shotPreview');
let selectedType = 'feature';
// Images from paste + the file picker, unified so pasting alone is enough.
let pendingFiles = [];

function renderShotPreview() {
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

function openModal() {
  form.reset();
  formErr.textContent = '';
  selectedType = 'feature';
  syncTypeToggle();
  clearPendingFiles();
  backdrop.classList.add('show');
  form.goal.focus();
}
function closeModal() { backdrop.classList.remove('show'); }

function syncTypeToggle() {
  document.querySelectorAll('#typeToggle button').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-type') === selectedType);
  });
}

document.getElementById('newCardBtn').addEventListener('click', openModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
document.getElementById('typeToggle').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-type]');
  if (!b) return;
  selectedType = b.getAttribute('data-type');
  syncTypeToggle();
});

// File picker → pending files (clear the native input so it isn't double-counted).
fileInput.addEventListener('change', () => {
  addPendingFiles(fileInput.files);
  fileInput.value = '';
});

// Remove a pending thumbnail.
shotPreview.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-shot-remove]');
  if (!btn) return;
  const removed = pendingFiles.splice(Number(btn.getAttribute('data-shot-remove')), 1)[0];
  if (removed) URL.revokeObjectURL(removed.url);
  renderShotPreview();
});

// Paste screenshots anywhere while the modal is open (images only; text paste untouched).
document.addEventListener('paste', (e) => {
  if (!backdrop.classList.contains('show')) return;
  const images = Array.from(e.clipboardData ? e.clipboardData.items : [])
    .filter((it) => it.type && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (images.length) { e.preventDefault(); addPendingFiles(images); }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formErr.textContent = '';

  const goal = form.goal.value.trim();
  const idea = form.idea.value.trim();

  if (!goal && !idea && pendingFiles.length === 0) {
    formErr.textContent = 'Add something — a goal, an idea, or a screenshot.';
    return;
  }

  // No title field: the server derives the card title from the goal/idea.
  const fd = new FormData();
  fd.append('type', selectedType);
  fd.append('goal', goal);
  fd.append('idea', idea);
  pendingFiles.forEach((f) => fd.append('screenshots', f.file));

  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  try {
    await api('/cards', { method: 'POST', body: fd });
    clearPendingFiles();
    closeModal();
    toast('Card added to Inbox');
    await load();
  } catch (err) {
    formErr.textContent = err.message || 'Failed to create card.';
  } finally {
    submitBtn.disabled = false;
  }
});

// Refresh when the tab regains focus (picks up Claude's direct board.json edits).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});

load();
