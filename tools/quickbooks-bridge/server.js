// LOCAL-TOOL: QuickBooks bridge for the studio Mac (board request 2026-09-11).
//
// The CRM's "Add to QuickBooks" button (person page right rail) opens a small
// popup served by this helper. The helper drives the user's REAL Safari
// session — the one that stays logged into QuickBooks — through AppleScript
// "do JavaScript" (Safari Settings → Developer → "Allow JavaScript from Apple
// Events" and "Allow remote automation" are already enabled on this Mac).
//
// Flow per request: open a dedicated Safari tab on the QBO Customers list,
// click "New customer", fill the slide-in form by field label (First/Last
// name, Company, display name, Email, Phone, Notes), click Save, then report
// the outcome. The tab is intentionally left open after saving so Moshe can
// eyeball the created customer.
//
// Run: always-on via LaunchAgent (see deploy-local.sh), port 8788 on
// 127.0.0.1 only. Zero npm dependencies.

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number.parseInt(process.env.QB_BRIDGE_PORT || '8788', 10);
const HOST = '127.0.0.1';
const QBO_CUSTOMERS_URL = 'https://qbo.intuit.com/app/customers#crm-bridge';
const TAB_MARKER = 'crm-bridge';
// Browsers attach an Origin/Referer on cross-site requests; only the CRM and
// the bridge's own status popup may drive automation. No header (curl,
// address bar, same-origin fetch) is treated as local use.
const ALLOWED_SITES = [
  'https://crm.impressionphotography.ca',
  'http://127.0.0.1',
  'http://localhost',
];

const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'quickbooks-bridge-'));

// ---------------------------------------------------------------------------
// AppleScript plumbing

const RUN_JS_SCPT = path.join(WORK_DIR, 'run-js.scpt');
fs.writeFileSync(
  RUN_JS_SCPT,
  `on run
  set jsFile to (system attribute "QB_JS_FILE")
  set js to read POSIX file jsFile
  tell application "Safari"
    set tb to missing value
    repeat with w in windows
      repeat with t in tabs of w
        try
          if (URL of t) contains "#${TAB_MARKER}" then
            set tb to contents of t
            exit repeat
          end if
        end try
      end repeat
      if tb is not missing value then exit repeat
    end repeat
    if tb is missing value then
      -- QuickBooks' router strips the #crm-bridge hash on in-app
      -- navigation, so fall back to the tracked tab identity written by
      -- open-tab. NEVER probe other tabs with do JavaScript — pages can be
      -- busy and block the event indefinitely.
      try
        set wid to (system attribute "QB_WINID") as integer
        set tidx to (system attribute "QB_TABIDX") as integer
        if tidx > 0 then
          repeat with w in windows
            if (id of w) is wid then
              if tidx is less than or equal to (count of tabs of w) then
                set cand to tab tidx of w
                if (URL of cand) begins with "https://qbo.intuit.com" then set tb to cand
              end if
              exit repeat
            end if
          end repeat
        end if
      end try
    end if
    if tb is missing value then return "<<QB_NO_TAB>>"
    try
      return do JavaScript js in tb
    on error
      return "<<QB_JS_ERR>>"
    end try
  end tell
end run
`,
);

const OPEN_TAB_SCPT = path.join(WORK_DIR, 'open-tab.scpt');
fs.writeFileSync(
  OPEN_TAB_SCPT,
  `on run
  set theURL to (system attribute "QB_URL")
  set stateFile to (system attribute "QB_STATE")
  tell application "Safari"
    set tb to missing value
    set wt to missing value
    -- 1) the tracked bridge tab from a previous run
    try
      if (system attribute "QB_WINID") is not "" then
        set wid to (system attribute "QB_WINID") as integer
        set tidx to (system attribute "QB_TABIDX") as integer
        if tidx > 0 then
          repeat with w in windows
            if (id of w) is wid then
              if tidx is less than or equal to (count of tabs of w) then
                set cand to tab tidx of w
                if (URL of cand) begins with "https://qbo.intuit.com" then
                  set tb to cand
                  set wt to contents of w
                end if
              end if
              exit repeat
            end if
          end repeat
        end if
      end if
    end try
    -- 2) a tab still carrying the #crm-bridge hash
    if tb is missing value then
      repeat with w in windows
        repeat with t in tabs of w
          try
            if (URL of t) contains "#${TAB_MARKER}" then
              set tb to contents of t
              set wt to contents of w
              exit repeat
            end if
          end try
        end repeat
        if tb is not missing value then exit repeat
      end repeat
    end if
    -- 3) nothing reusable: create a fresh bridge tab
    if tb is missing value then
      set wtarget to missing value
      repeat with w in windows
        if (count of tabs of w) > 0 then
          set wtarget to contents of w
          exit repeat
        end if
      end repeat
      if wtarget is missing value then
        set tb to make new document with properties {URL:theURL}
        set wt to window 1
      else
        set tb to make new tab with properties {URL:theURL} at end of tabs of wtarget
        set wt to wtarget
      end if
    else
      set URL of tb to theURL
    end if
    -- QuickBooks only renders forms in the ACTIVE tab; switch within the
    -- window but never activate Safari itself — whatever Moshe is working
    -- on stays frontmost.
    try
      set current tab of wt to tb
    end try
    -- Remember which tab is ours as (window id, tab index): QuickBooks
    -- strips the URL hash after in-app navigation, and probing window.name
    -- on unknown tabs can hang on busy pages.
    set tIdxOut to 0
    try
      repeat with i from 1 to count of tabs of wt
        if (tab i of wt) is tb then
          set tIdxOut to i
          exit repeat
        end if
      end repeat
    end try
    set wIdOut to id of wt
    do shell script "echo " & (wIdOut as string) & " " & (tIdxOut as string) & " > " & quoted form of stateFile
    return "OK"
  end tell
end run
`,
);

const osa = (script, env = {}, timeoutMs = 45000) =>
  new Promise((resolve) => {
    execFile(
      '/usr/bin/osascript',
      [script],
      {
        env: { ...process.env, ...env },
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: (stdout || '').trim(),
          stderr: (stderr || error?.message || '').trim(),
        });
      },
    );
  });

const writeJs = (body) => {
  const file = path.join(
    WORK_DIR,
    `js-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.js`,
  );
  fs.writeFileSync(file, `(function(){ try { ${body}\n} catch (e) { return JSON.stringify({qbErr: String(e && e.message || e)}); } })()`);
  return file;
};

const TAB_STATE_FILE = path.join(WORK_DIR, 'tab-state.txt');

const readTabState = () => {
  try {
    const [winId, tabIdx] = fs
      .readFileSync(TAB_STATE_FILE, 'utf8')
      .trim()
      .split(/\s+/);
    return { winId: winId || '', tabIdx: tabIdx || '' };
  } catch {
    return { winId: '', tabIdx: '' };
  }
};

const openBridgeTab = (targetUrl) => {
  const state = readTabState();
  return osa(OPEN_TAB_SCPT, {
    QB_URL: targetUrl,
    QB_STATE: TAB_STATE_FILE,
    QB_WINID: state.winId,
    QB_TABIDX: state.tabIdx,
  });
};

const runJs = async (body) => {
  const state = readTabState();
  const result = await osa(
    RUN_JS_SCPT,
    {
      QB_JS_FILE: writeJs(body),
      QB_WINID: state.winId,
      QB_TABIDX: state.tabIdx,
    },
    12000,
  );
  if (!result.ok) {
    throw new Error(`Safari AppleScript failed: ${result.stderr.slice(0, 300)}`);
  }
  if (result.stdout === '<<QB_NO_TAB>>') {
    throw new Error('Bridge tab is gone (Safari tab was closed mid-flow)');
  }
  if (result.stdout === '<<QB_JS_ERR>>') {
    throw new Error('Page JavaScript failed (tab still loading?)');
  }
  return result.stdout;
};

// Page reads are best-effort: while the tab is still loading the script may
// not run at all, and callers poll until they get real JSON.
const runJsJson = async (body) => {
  try {
    return JSON.parse(await runJs(body));
  } catch {
    return null;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// QBO's ids are generated per render, so every field is located through its
// <label>. This snippet is shared by the probe/fill/save steps.
const LABEL_FINDER = `
  function norm(s){ return (s||'').replace(/\\s+/g,' ').replace(/\\*/g,'').trim(); }
  function findInput(labelText){
    var labs = Array.prototype.slice.call(document.querySelectorAll('label'));
    for (var i=0;i<labs.length;i++){
      if (norm(labs[i].textContent) === labelText){
        var f = labs[i].getAttribute('for');
        var el = f ? document.getElementById(f) : labs[i].querySelector('input,textarea');
        if (el) return el;
      }
    }
    return null;
  }
  function setVal(labelText, value){
    var el = findInput(labelText);
    if (!el) return 'MISSING';
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('blur', {bubbles:true}));
    return 'OK';
  }`;

// ---------------------------------------------------------------------------
// The QuickBooks flow. Serialized: one run at a time (one bridge tab anyway).

let queue = Promise.resolve();

const addToQuickBooks = async (contact) => {
  const startedAt = Date.now();
  const outOfBudget = () => Date.now() - startedAt > 150000;
  const opened = await openBridgeTab(QBO_CUSTOMERS_URL);
  if (!opened.ok || opened.stdout !== 'OK') {
    return {
      status: 'error',
      message: `Could not open a Safari tab (${opened.stderr.slice(0, 200) || 'Safari did not respond'})`,
    };
  }

  // 1) Wait for the customers list (and for the session to be logged in).
  let page;
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    page = await runJsJson(
      `${LABEL_FINDER}
      var hasNew = Array.prototype.some.call(document.querySelectorAll('button'), function(e){
        return (e.textContent||'').trim().replace(/\\s+/g,' ') === 'New customer';
      });
      return JSON.stringify({href: location.href, ready: document.readyState, hasNew: hasNew});`,
    );
    if (!page) {
      if (i === 29) {
        return { status: 'error', message: 'The QuickBooks tab never finished loading.' };
      }
      continue;
    }
    if (page.href.includes('accounts.intuit.com')) {
      return {
        status: 'not-logged-in',
        message:
          'QuickBooks needs a login — the Safari session has expired. Log into QuickBooks in Safari, then press the button again.',
      };
    }
    if (page.hasNew) break;
    if (i === 29) {
      return {
        status: 'error',
        message: `The QuickBooks Customers page never finished loading (ended at ${page.href.slice(0, 120)}).`,
      };
    }
  }

  // 2) Open the "New customer" slide-in. React attaches handlers a beat
  // after the button renders, and QBO also keeps hidden template clones in
  // the DOM — so: grace-wait, click only VISIBLE "New customer" buttons,
  // then re-check and re-click until the form is actually up.
  await sleep(2000);
  let formUp = false;
  for (let attempt = 0; attempt < 4 && !formUp; attempt++) {
    const clickResult = await runJs(`
      ${LABEL_FINDER}
      if (findInput('Customer display name')) return 'ALREADY';
      var b = null;
      Array.prototype.forEach.call(document.querySelectorAll('button'), function(e){
        var t = (e.textContent||'').trim().replace(/\\s+/g,' ');
        var visible = e.offsetParent !== null || e.getClientRects().length > 0;
        if (t === 'New customer' && visible) b = e;
      });
      if (!b) return 'NOTFOUND';
      b.click();
      return 'CLICKED';`);
    for (let wait = 0; wait < 6 && !formUp; wait++) {
      await sleep(1300);
      const probe = await runJsJson(
        `${LABEL_FINDER}
        return JSON.stringify({formUp: !!findInput('Customer display name')});`,
      );
      formUp = Boolean(probe?.formUp);
    }
    if (!formUp && clickResult === 'NOTFOUND' && attempt === 3) {
      return {
        status: 'error',
        message: 'Could not find a visible "New customer" button on the Customers page.',
      };
    }
  }
  if (!formUp) {
    return { status: 'error', message: 'The New customer form never opened.' };
  }

  // 4) Fill what the CRM knows.
  const fills = [];
  const addFill = (label, value) => {
    if (value) fills.push(`out[${JSON.stringify(label)}] = setVal(${JSON.stringify(label)}, ${JSON.stringify(value)});`);
  };
  const today = new Date().toISOString().slice(0, 10);
  addFill('First name', contact.first);
  addFill('Last name', contact.last);
  addFill('Company name', contact.company);
  addFill('Customer display name', contact.name);
  addFill('Email', contact.email);
  addFill('Phone number', contact.phone);
  addFill('Notes', `Added from Impression CRM on ${today}`);
  const fillResult = await runJsJson(
    `${LABEL_FINDER}
    var out = {};
    ${fills.join('\n') || 'out["(nothing)"] = "no fields"'}
    return JSON.stringify(out);`,
  );

  // 5) Save.
  const saved = await runJs(`
    var btns = Array.prototype.filter.call(document.querySelectorAll('button'), function(e){
      return (e.textContent||'').trim() === 'Save' && !e.disabled;
    });
    if (!btns.length) return 'NO_SAVE';
    btns[btns.length-1].click();
    return 'CLICKED';`);
  if (saved !== 'CLICKED') {
    return {
      status: 'error',
      message: 'The form was filled but the Save button was not clickable — check the Safari tab.',
      detail: fillResult,
    };
  }

  // 6) Watch the outcome: saved (panel closes) vs duplicate-name error.
  for (let i = 0; i < 26; i++) {
    await sleep(1200);
    const state = await runJsJson(
      `${LABEL_FINDER}
      var errBits = [];
      Array.prototype.forEach.call(document.querySelectorAll('[role="alert"], [class*="error" i]'), function(e){
        var t = (e.textContent||'').trim();
        if (t && t.length < 200) errBits.push(t);
      });
      return JSON.stringify({
        href: location.href,
        formGone: !findInput('Customer display name'),
        errs: errBits.slice(0,4)
      });`,
    );
    if (!state) {
      if (outOfBudget()) break;
      continue;
    }
    if (outOfBudget()) break;
    const errText = (state.errs || []).join(' ');
    if (/already (exists|in use|using)|duplicate/i.test(errText)) {
      return {
        status: 'duplicate',
        message: `"${contact.name}" looks like it already exists in QuickBooks — nothing new was created.`,
      };
    }
    const landed =
      state.href.includes('/app/customerdetail') ||
      (state.formGone && state.href.includes('/app/customers'));
    if (landed) {
      const nameId = (state.href.match(/nameId=(\d+)/) || [])[1] || null;
      return {
        status: 'saved',
        message: `${contact.name} saved in QuickBooks. The Safari tab is open if you want a quick look.`,
        nameId,
        detail: fillResult,
      };
    }
  }

  return {
    status: 'unknown',
    message:
      'Clicked Save but could not confirm the result within 30s — please check the Safari tab.',
    detail: fillResult,
  };
};

// "Open in QuickBooks" / "Create invoice": deep-link the bridge tab to the
// customer page or a prefilled invoice form. The invoice form only mounts in
// an ACTIVE tab, so open-tab.scpt makes the bridge tab current first.
const openOrInvoice = async (mode, nameId, name) => {
  const target =
    mode === 'invoice'
      ? `https://qbo.intuit.com/app/invoice?nameId=${nameId}`
      : `https://qbo.intuit.com/app/customerdetail?nameId=${nameId}`;
  const opened = await openBridgeTab(target);
  if (!opened.ok || opened.stdout !== 'OK') {
    return {
      status: 'error',
      message: `Could not open a Safari tab (${opened.stderr.slice(0, 200) || 'Safari did not respond'})`,
    };
  }
  if (mode === 'open') {
    return {
      status: 'opened',
      message: `Opening ${name || 'the customer'} in QuickBooks.`,
      nameId,
    };
  }
  // Do NOT probe the invoice page: while it mounts, do JavaScript can block
  // for minutes. The ?nameId= prefill is applied by QuickBooks itself when
  // the form loads in the active tab (verified live), so wait a beat for the
  // navigation to settle and report ready.
  await sleep(5000);
  return {
    status: 'invoice-ready',
    message: `Invoice started for ${name || 'this customer'} — add the lines and Save in Safari.`,
    nameId,
  };
};

const enqueueAdd = (contact) =>
  new Promise((resolve) => {
    queue = queue.then(async () => {
      try {
        resolve(await addToQuickBooks(contact));
      } catch (error) {
        resolve({ status: 'error', message: String(error.message || error) });
      }
    });
  });

const enqueueAction = (mode, nameId, name) =>
  new Promise((resolve) => {
    queue = queue.then(async () => {
      try {
        resolve(await openOrInvoice(mode, nameId, name));
      } catch (error) {
        resolve({ status: 'error', message: String(error.message || error) });
      }
    });
  });

// ---------------------------------------------------------------------------
// HTTP: /quickbooks (status popup) and /run (the automation), 127.0.0.1 only.

const readContact = (query) => {
  const get = (key, max = 120) =>
    (query.get(key) || '')
      .replace(/[\u0000-\u001f]/g, '')
      .slice(0, max)
      .trim();
  const name = get('name') || [get('first'), get('last')].filter(Boolean).join(' ').trim();
  if (!name) return null;
  return {
    name,
    first: get('first'),
    last: get('last'),
    company: get('company'),
    email: get('email', 160),
    phone: get('phone', 30),
  };
};

const isAllowed = (req) => {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const site = origin || referer;
  if (!site) return true;
  return ALLOWED_SITES.some((allowed) => site.startsWith(allowed));
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The CRM passes its own origin as ?o=… so the popup can postMessage the
// result back; the opener then stores the QuickBooks customer id on the
// person. Anything malformed falls back to the CRM origin.
const readOrigin = (query) =>
  /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(query.get('o') || '')
    ? query.get('o')
    : 'https://crm.impressionphotography.ca';

const page = ({ heading, running, runUrl, origin, closeMs }) => `<!doctype html>
<html><head><meta charset="utf-8"><title>QuickBooks</title>
<style>
  body { font: 14px -apple-system, "SF Pro Text", sans-serif; margin: 0; padding: 20px;
         color: #1a1a1a; background: #fafafa; text-align: center; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 14px; }
  #msg { font-size: 13px; line-height: 1.45; color: #444; white-space: pre-line; }
  .spin { display: inline-block; width: 22px; height: 22px; margin-bottom: 12px;
          border: 3px solid #d9d9d9; border-top-color: #2ca01c; border-radius: 50%;
          animation: r 0.8s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  .ok #st { color: #2ca01c; font-size: 26px; }
  .info #st { color: #2b6cb0; font-size: 26px; }
  .bad #st { color: #d52b1e; font-size: 26px; }
  #st { font-size: 26px; margin-bottom: 6px; }
</style></head>
<body>
  <div id="st" class="spin"></div>
  <h1>${escapeHtml(heading)}</h1>
  <div id="msg">${escapeHtml(running)}</div>
  <script>
    var OK = ['saved', 'opened', 'invoice-ready'];
    fetch(${JSON.stringify(runUrl)})
      .then((r) => r.json())
      .then((res) => {
        var ok = OK.indexOf(res.status) !== -1;
        document.querySelector('#st').className = '';
        document.body.className = ok ? 'ok' : res.status === 'duplicate' ? 'info' : 'bad';
        document.querySelector('#st').textContent = ok ? '✓' : res.status === 'duplicate' ? 'ℹ' : '✕';
        document.querySelector('h1').textContent = 'QuickBooks';
        document.querySelector('#msg').textContent = res.message || res.status;
        try {
          if (window.opener) window.opener.postMessage(
            { source: 'crm-quickbooks-bridge', status: res.status, nameId: res.nameId || null },
            ${JSON.stringify(origin)}
          );
        } catch (e) {}
        if (ok) setTimeout(() => window.close(), ${closeMs});
      })
      .catch(() => {
        document.body.className = 'bad';
        document.querySelector('#st').className = '';
        document.querySelector('#st').textContent = '✕';
        document.querySelector('#msg').textContent =
          'The bridge could not be reached — is it running? (launchctl kickstart -k gui/$USER/ca.impressionphotography.quickbooks-bridge)';
      });
  </script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'quickbooks-bridge' }));
    return;
  }
  if (!isAllowed(req)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden');
    return;
  }
  const sendHtml = (html) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  };

  if (url.pathname === '/quickbooks') {
    const contact = readContact(url.searchParams);
    if (!contact) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('missing name');
      return;
    }
    sendHtml(
      page({
        heading: `Adding ${contact.name} to QuickBooks…`,
        running: 'Driving Safari — this usually takes 15–30 seconds.',
        runUrl: `/run${url.search}`,
        origin: readOrigin(url.searchParams),
        closeMs: 4500,
      }),
    );
    return;
  }
  if (url.pathname === '/open' || url.pathname === '/invoice') {
    const nameId = (url.searchParams.get('nameId') || '').replace(/\D/g, '');
    const name = (url.searchParams.get('name') || '').slice(0, 120);
    if (!nameId) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('missing nameId');
      return;
    }
    const mode = url.pathname === '/invoice' ? 'invoice' : 'open';
    sendHtml(
      page({
        heading:
          mode === 'invoice'
            ? `Starting an invoice for ${name || 'this customer'}…`
            : `Opening ${name || 'this customer'} in QuickBooks…`,
        running:
          mode === 'invoice'
            ? 'Opening Safari with the customer already selected.'
            : 'Opening Safari.',
        runUrl: `/run?mode=${mode}&nameId=${nameId}`,
        origin: readOrigin(url.searchParams),
        closeMs: mode === 'invoice' ? 5000 : 900,
      }),
    );
    return;
  }
  if (url.pathname === '/run' && req.method === 'GET') {
    const mode = url.searchParams.get('mode') || 'add';
    if (mode === 'open' || mode === 'invoice') {
      const nameId = (url.searchParams.get('nameId') || '').replace(/\D/g, '');
      const name = (url.searchParams.get('name') || '').slice(0, 120);
      if (!nameId) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'missing nameId' }));
        return;
      }
      enqueueAction(mode, nameId, name).then((result) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      return;
    }
    const contact = readContact(url.searchParams);
    if (!contact) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'missing name' }));
      return;
    }
    enqueueAdd(contact).then((result) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`quickbooks-bridge listening on http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
  console.error('bridge failed to start:', error.message);
  process.exit(1);
});
