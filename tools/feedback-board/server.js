// Feedback Board backend.
//
// A private, no-login 4-column Kanban board. Moshe (the user) files feature
// requests + bug reports in the browser; Claude (the AI assistant) triages,
// builds, and delivers them. The board IS Claude's work queue: it lives as a
// single JSON file on disk that BOTH the webpage AND Claude edit directly.
//
// Access control is the unguessable mount path only (see nginx). No auth: the
// board holds feature ideas, no money and no destructive actions.
//
// Columns: inbox -> discussion -> tobuild -> delivered
//   inbox      : Moshe drafts cards here.
//   discussion : Claude parks a card here with a counter-proposal (claudeNote).
//   tobuild    : agreed work queue.
//   delivered  : changelog. On entry we DELETE the card's screenshot files from
//                disk to save space, keeping the card + deliveredAt + note.
//
// Endpoints (all under the app's mount path, e.g. /board-<TOKEN>/):
//   GET    /api/cards                     -> full board (read FRESH from disk)
//   POST   /api/cards                     -> create card (multipart, screenshots)
//   POST   /api/cards/:id/move {column}   -> move a card between columns
//   POST   /api/cards/:id/comment {author,text}
//   POST   /api/cards/:id/approve         -> discussion -> tobuild
//   POST   /api/cards/:id/counter {text}  -> add moshe comment, -> back to inbox
//   DELETE /api/cards/:id                 -> delete card (+ its screenshots)
//   GET    /api/health                    -> liveness

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');

const PORT = process.env.PORT || 4243;
const DATA_DIR = process.env.FB_DATA_DIR || __dirname;
const BOARD_PATH = process.env.FB_BOARD_PATH || path.join(DATA_DIR, 'board.json');
const UPLOAD_DIR = process.env.FB_UPLOAD_DIR || path.join(DATA_DIR, 'uploads');

// ---------------------------------------------------------------------------
// Email-on-delivery — notify Moshe when a card is delivered (like his other
// app). Enabled only when the SMTP env vars are set (server-only EnvironmentFile,
// never committed). Reuses the OVH mailserver + the Cal.com sender identity
// (impressionjewelry.ca's SPF/DKIM authorize this IP, so it reaches Gmail;
// note @impressionphotography.ca is blocked by Microsoft, so send to Gmail).
// ---------------------------------------------------------------------------
const MAIL = {
  host: process.env.FB_SMTP_HOST,
  port: Number(process.env.FB_SMTP_PORT || 587),
  user: process.env.FB_SMTP_USER,
  pass: process.env.FB_SMTP_PASS,
  from: process.env.FB_MAIL_FROM || process.env.FB_SMTP_USER,
  to: process.env.FB_MAIL_TO,
  boardUrl: process.env.FB_BOARD_URL || '',
};
const MAIL_ENABLED = Boolean(MAIL.host && MAIL.user && MAIL.pass && MAIL.to);
let mailTransporter = null;
function getMailTransporter() {
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: MAIL.host,
      port: MAIL.port,
      secure: false, // STARTTLS on 587
      auth: { user: MAIL.user, pass: MAIL.pass },
      tls: { rejectUnauthorized: false }, // tolerate the box's self-signed cert
    });
  }
  return mailTransporter;
}

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Fire-and-forget: never blocks or fails the HTTP response.
function sendDeliveredEmail(card) {
  if (!MAIL_ENABLED) return;
  const title = card.title || 'Your request';
  const textParts = ['Delivered ✅', '', title, ''];
  if (card.goal) textParts.push('Goal: ' + card.goal);
  if (card.idea) textParts.push('Idea: ' + card.idea);
  if (card.deliveredNote) textParts.push('', 'What shipped:', card.deliveredNote);
  if (MAIL.boardUrl) textParts.push('', 'Board: ' + MAIL.boardUrl);

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;color:#111">' +
    '<p style="font-size:12px;letter-spacing:.4px;color:#16a34a;font-weight:700;margin:0 0 6px">DELIVERED ✅</p>' +
    '<h2 style="margin:0 0 12px;font-size:18px">' + htmlEscape(title) + '</h2>' +
    (card.goal ? '<p style="margin:6px 0;color:#333"><b>Goal:</b> ' + htmlEscape(card.goal) + '</p>' : '') +
    (card.idea ? '<p style="margin:6px 0;color:#333"><b>Idea:</b> ' + htmlEscape(card.idea) + '</p>' : '') +
    (card.deliveredNote
      ? '<div style="margin:12px 0;padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#14532d"><b>What shipped:</b><br/>' +
        htmlEscape(card.deliveredNote) + '</div>'
      : '') +
    (MAIL.boardUrl
      ? '<p style="margin:16px 0 0"><a href="' + MAIL.boardUrl + '" style="color:#3b82f6;text-decoration:none">Open the Feedback Board →</a></p>'
      : '') +
    '</div>';

  getMailTransporter()
    .sendMail({
      from: MAIL.from,
      to: MAIL.to,
      subject: '✅ Delivered: ' + title,
      text: textParts.join('\n'),
      html,
    })
    .then((info) => console.log('[mail] delivered-email sent:', info.messageId, '->', MAIL.to))
    .catch((err) => console.error('[mail] delivered-email failed:', err.message));
}

const VALID_COLUMNS = ['inbox', 'discussion', 'tobuild', 'delivered'];
const VALID_TYPES = ['feature', 'bug'];

// ---------------------------------------------------------------------------
// Board store — ONE JSON file, read FRESH on every GET so Claude's direct edits
// to board.json show up on the next page load. Writes are temp-file + atomic
// rename to avoid corrupting the file if two writes race.
// ---------------------------------------------------------------------------

function readBoard() {
  try {
    const raw = fs.readFileSync(BOARD_PATH, 'utf8');
    const cards = JSON.parse(raw);
    return Array.isArray(cards) ? cards : [];
  } catch (_e) {
    // Missing or corrupt file -> empty board. Never throw on read.
    return [];
  }
}

function writeBoard(cards) {
  const tmp = BOARD_PATH + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(cards, null, 2));
  fs.renameSync(tmp, BOARD_PATH); // atomic on the same filesystem
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function findCard(cards, id) {
  return cards.find((c) => c && c.id === id);
}

// Delete a card's screenshot files from the upload dir. Best-effort: a missing
// file is fine (idempotent). Guards against path traversal by only ever joining
// the bare basename onto UPLOAD_DIR.
function deleteScreenshots(filenames) {
  (filenames || []).forEach((name) => {
    if (typeof name !== 'string' || !name) return;
    const safe = path.basename(name);
    const full = path.join(UPLOAD_DIR, safe);
    try {
      fs.unlinkSync(full);
    } catch (_e) {
      /* already gone — ignore */
    }
  });
}

// ---------------------------------------------------------------------------
// Uploads (multer) — images only, random filenames, size-capped, no traversal.
// ---------------------------------------------------------------------------

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Random name + normalized original extension. Never trust the client name.
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) ext = '.png';
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 8 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) && ALLOWED_EXT.has(ext)) {
      return cb(null, true);
    }
    return cb(new Error('Only image uploads are allowed (png/jpg/gif/webp).'));
  },
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// Behind nginx; trust the proxy for correct protocol/IP.
app.set('trust proxy', true);

const api = express.Router();

// Liveness.
api.get('/health', (req, res) => {
  res.json({ ok: true, cards: readBoard().length, at: nowIso() });
});

// Full board — read FRESH from disk every time.
api.get('/cards', (req, res) => {
  res.json({ cards: readBoard() });
});

// Create a card. Multipart so screenshots can ride along.
// A card needs SOMETHING to describe it: an explicit title, a goal, an idea,
// or a screenshot. The in-app Quick-request popup (like the Zrizes app) omits
// the title field, so when title is blank we derive one from goal/idea/type.
api.post('/cards', upload.array('screenshots', 8), (req, res) => {
  const files = req.files || [];
  const cleanupUploads = () => deleteScreenshots(files.map((f) => f.filename));

  const type = VALID_TYPES.includes(req.body.type) ? req.body.type : 'feature';
  let title = (req.body.title || '').trim();
  const goal = (req.body.goal || '').trim();
  const idea = (req.body.idea || '').trim();

  if (!title && !goal && !idea && files.length === 0) {
    cleanupUploads();
    return res.status(400).json({
      error: 'provide at least one of: title, goal, idea, or a screenshot',
    });
  }
  if (!title) {
    const firstLine = (goal || idea || '').split('\n')[0].trim();
    title = firstLine
      ? firstLine.length > 80
        ? firstLine.slice(0, 79) + '…'
        : firstLine
      : type === 'bug'
        ? 'Bug report'
        : 'Feature request';
  }

  const cards = readBoard();
  const at = nowIso();
  const card = {
    id: newId(),
    type,
    title,
    goal,
    idea,
    column: 'inbox',
    screenshots: files.map((f) => f.filename),
    comments: [],
    claudeNote: '',
    deliveredNote: '',
    createdAt: at,
    updatedAt: at,
    deliveredAt: null,
  };
  cards.push(card);
  writeBoard(cards);
  res.json({ ok: true, card });
});

// Move a card to a column. Moving INTO delivered deletes screenshots + stamps
// deliveredAt; an optional note becomes deliveredNote.
api.post('/cards/:id/move', (req, res) => {
  const { column } = req.body || {};
  if (!VALID_COLUMNS.includes(column)) {
    return res.status(400).json({ error: 'invalid column' });
  }
  const cards = readBoard();
  const card = findCard(cards, req.params.id);
  if (!card) return res.status(404).json({ error: 'card not found' });

  const enteringDelivered = column === 'delivered' && card.column !== 'delivered';
  card.column = column;
  card.updatedAt = nowIso();

  if (enteringDelivered) {
    deleteScreenshots(card.screenshots);
    card.screenshots = [];
    // Comment screenshots are cleaned up on delivery too (same space-saving
    // rule as card screenshots).
    (card.comments || []).forEach((comment) => {
      if (Array.isArray(comment.screenshots) && comment.screenshots.length) {
        deleteScreenshots(comment.screenshots);
        delete comment.screenshots;
      }
    });
    card.deliveredAt = nowIso();
    if (typeof req.body.deliveredNote === 'string' && req.body.deliveredNote.trim()) {
      card.deliveredNote = req.body.deliveredNote.trim();
    }
    sendDeliveredEmail(card); // notify Moshe (no-op unless SMTP env is set)
  }

  writeBoard(cards);
  res.json({ ok: true, card });
});

// Append a comment. author is "moshe" or "claude". Accepts JSON (text-only,
// how Claude comments) OR multipart with pasted screenshot images — a comment
// needs text or at least one image.
api.post('/cards/:id/comment', upload.array('screenshots', 4), (req, res) => {
  const files = req.files || [];
  const author = req.body && req.body.author === 'claude' ? 'claude' : 'moshe';
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  if (!text && files.length === 0) {
    return res.status(400).json({ error: 'add text or a screenshot' });
  }

  const cards = readBoard();
  const card = findCard(cards, req.params.id);
  if (!card) {
    deleteScreenshots(files.map((f) => f.filename));
    return res.status(404).json({ error: 'card not found' });
  }

  if (!Array.isArray(card.comments)) card.comments = [];
  const comment = { author, text, at: nowIso() };
  if (files.length > 0) comment.screenshots = files.map((f) => f.filename);
  card.comments.push(comment);
  card.updatedAt = nowIso();
  writeBoard(cards);
  res.json({ ok: true, card });
});

// Approve a card in discussion -> move to tobuild.
api.post('/cards/:id/approve', (req, res) => {
  const cards = readBoard();
  const card = findCard(cards, req.params.id);
  if (!card) return res.status(404).json({ error: 'card not found' });
  card.column = 'tobuild';
  card.updatedAt = nowIso();
  writeBoard(cards);
  res.json({ ok: true, card });
});

// Counter a card in discussion -> add moshe's comment + send back to inbox.
api.post('/cards/:id/counter', (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  const cards = readBoard();
  const card = findCard(cards, req.params.id);
  if (!card) return res.status(404).json({ error: 'card not found' });

  if (!Array.isArray(card.comments)) card.comments = [];
  card.comments.push({ author: 'moshe', text, at: nowIso() });
  card.column = 'inbox';
  card.updatedAt = nowIso();
  writeBoard(cards);
  res.json({ ok: true, card });
});

// Delete a card + its screenshots (card-level and per-comment).
api.delete('/cards/:id', (req, res) => {
  const cards = readBoard();
  const idx = cards.findIndex((c) => c && c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'card not found' });
  deleteScreenshots(cards[idx].screenshots);
  (cards[idx].comments || []).forEach((comment) =>
    deleteScreenshots(comment.screenshots),
  );
  cards.splice(idx, 1);
  writeBoard(cards);
  res.json({ ok: true });
});

app.use('/api', api);

// Uploaded screenshots. Static, images only ever land here (no scripts execute
// from a static dir), and multer already sanitized filenames.
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => {
      // Defense in depth: never let the browser sniff these as anything but
      // what we say, and never render inline as HTML.
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

// Static frontend.
app.use('/', express.static(path.join(__dirname, 'public')));

// Multer / body errors -> JSON (so the SPA can show them).
app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: err.message || 'upload failed' });
  }
  return next();
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Feedback Board backend listening on 127.0.0.1:${PORT}`);
  console.log(`[store] board: ${BOARD_PATH}`);
  console.log(`[store] uploads: ${UPLOAD_DIR}`);
});
