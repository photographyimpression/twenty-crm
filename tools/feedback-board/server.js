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

const PORT = process.env.PORT || 4243;
const DATA_DIR = process.env.FB_DATA_DIR || __dirname;
const BOARD_PATH = process.env.FB_BOARD_PATH || path.join(DATA_DIR, 'board.json');
const UPLOAD_DIR = process.env.FB_UPLOAD_DIR || path.join(DATA_DIR, 'uploads');

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
// Validation: title required + at least one of goal / idea / screenshot.
api.post('/cards', upload.array('screenshots', 8), (req, res) => {
  const files = req.files || [];
  const cleanupUploads = () => deleteScreenshots(files.map((f) => f.filename));

  const type = VALID_TYPES.includes(req.body.type) ? req.body.type : 'feature';
  const title = (req.body.title || '').trim();
  const goal = (req.body.goal || '').trim();
  const idea = (req.body.idea || '').trim();

  if (!title) {
    cleanupUploads();
    return res.status(400).json({ error: 'title is required' });
  }
  if (!goal && !idea && files.length === 0) {
    cleanupUploads();
    return res
      .status(400)
      .json({ error: 'provide at least one of: goal, idea, or a screenshot' });
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
    card.deliveredAt = nowIso();
    if (typeof req.body.deliveredNote === 'string' && req.body.deliveredNote.trim()) {
      card.deliveredNote = req.body.deliveredNote.trim();
    }
  }

  writeBoard(cards);
  res.json({ ok: true, card });
});

// Append a comment. author is "moshe" or "claude".
api.post('/cards/:id/comment', (req, res) => {
  const author = req.body && req.body.author === 'claude' ? 'claude' : 'moshe';
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  const cards = readBoard();
  const card = findCard(cards, req.params.id);
  if (!card) return res.status(404).json({ error: 'card not found' });

  if (!Array.isArray(card.comments)) card.comments = [];
  card.comments.push({ author, text, at: nowIso() });
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

// Delete a card + its screenshots.
api.delete('/cards/:id', (req, res) => {
  const cards = readBoard();
  const idx = cards.findIndex((c) => c && c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'card not found' });
  deleteScreenshots(cards[idx].screenshots);
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
