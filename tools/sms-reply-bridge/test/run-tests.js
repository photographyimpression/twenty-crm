#!/usr/bin/env node
// Smoke tests for the SMS reply bridge. Runs the bridge as a child
// process with synthetic RFC822 messages on stdin and asserts the
// audit log entry says what we expect.
//
// Pure node test, no jest. Run with `node test/run-tests.js`.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const BRIDGE = path.join(__dirname, '..', 'src', 'bridge.js');
const TOKEN_SECRET = 'test-secret-for-bridge-smoke';

function encodeToken(digits) {
  const tag = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(digits)
    .digest('base64url')
    .slice(0, 8);
  return Buffer.from(`${digits}.${tag}`, 'utf8').toString('base64url');
}

function tempLog() {
  return path.join(
    os.tmpdir(),
    `sms-bridge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
  );
}

function runBridge({ stdin, env }) {
  const logPath = tempLog();
  const result = spawnSync('node', [BRIDGE], {
    input: stdin,
    encoding: 'utf8',
    env: {
      ...process.env,
      TELNYX_DRY_RUN: 'true',
      SKIP_AUTH_HEADER_CHECK: 'false',
      SMS_REPLY_TOKEN_SECRET: TOKEN_SECRET,
      AUDIT_LOG_PATH: logPath,
      ALLOWED_SENDER: 'moshe@impressionphotography.ca',
      // Wipe the loader's view of these so the bridge starts clean.
      TELNYX_API_KEY: 'dummy',
      TELNYX_FROM_NUMBER: '+15142702784',
      TELNYX_MESSAGING_PROFILE_ID: 'dummy-profile',
      TWENTY_API_URL: '',
      TWENTY_API_TOKEN: '',
      ...env,
    },
  });
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const auditLines = log
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  try {
    fs.unlinkSync(logPath);
  } catch {}
  return { code: result.status, audit: auditLines, stderr: result.stderr };
}

function buildEmail({
  from = 'moshe@impressionphotography.ca',
  to,
  subject = 'Re: SMS from Lydia (+15555550101)',
  body = 'Hey, thanks!',
  authResults = 'mx.example.com; spf=pass smtp.mailfrom=impressionphotography.ca; dkim=pass header.d=impressionphotography.ca',
}) {
  const lines = [
    'Return-Path: <' + from + '>',
    'Authentication-Results: ' + authResults,
    'From: Moshe Lerner <' + from + '>',
    'To: ' + to,
    'Subject: ' + subject,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body,
  ];
  return lines.join('\r\n');
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('happy-path: valid reply gets accepted (dry-run)', () => {
  const phone = '15555550101';
  const token = encodeToken(phone);
  const email = buildEmail({
    to: `sms-reply+${token}@productphotographymontreal.ca`,
    body:
      'Sure, see you at 3pm.\n' +
      '\n' +
      '—\n' +
      'From: Lydia (+15555550101)\n' +
      'Received: 2026-06-08 12:00\n',
  });
  const { code, audit } = runBridge({ stdin: email });
  if (code !== 0) throw new Error(`expected code 0, got ${code}`);
  const last = audit[audit.length - 1];
  if (last.decision !== 'accept') {
    throw new Error('expected accept, got ' + JSON.stringify(last));
  }
  if (last.to !== '+' + phone) {
    throw new Error('wrong destination phone: ' + last.to);
  }
  if (last.text !== 'Sure, see you at 3pm.') {
    throw new Error('reply text not stripped: ' + JSON.stringify(last.text));
  }
  if (!last.dryRun) {
    throw new Error('expected dryRun=true');
  }
});

test('rejects wrong sender', () => {
  const token = encodeToken('15555550101');
  const email = buildEmail({
    from: 'attacker@evil.example',
    to: `sms-reply+${token}@productphotographymontreal.ca`,
    body: 'Send to your sister',
  });
  const { code, audit } = runBridge({ stdin: email });
  if (code !== 77) throw new Error(`expected NOPERM (77), got ${code}`);
  const last = audit[audit.length - 1];
  if (last.reason !== 'from-not-allowed') {
    throw new Error('wrong reject reason: ' + JSON.stringify(last));
  }
});

test('rejects when SPF fails', () => {
  const token = encodeToken('15555550101');
  const email = buildEmail({
    to: `sms-reply+${token}@productphotographymontreal.ca`,
    authResults:
      'mx.example.com; spf=fail smtp.mailfrom=impressionphotography.ca; dkim=pass header.d=impressionphotography.ca',
    body: 'hi',
  });
  const { code, audit } = runBridge({ stdin: email });
  if (code !== 77) throw new Error(`expected NOPERM (77), got ${code}`);
  const last = audit[audit.length - 1];
  if (last.reason !== 'spf-not-pass') {
    throw new Error('wrong reject reason: ' + JSON.stringify(last));
  }
});

test('rejects when DKIM fails', () => {
  const token = encodeToken('15555550101');
  const email = buildEmail({
    to: `sms-reply+${token}@productphotographymontreal.ca`,
    authResults:
      'mx.example.com; spf=pass smtp.mailfrom=impressionphotography.ca; dkim=fail header.d=impressionphotography.ca',
    body: 'hi',
  });
  const { code, audit } = runBridge({ stdin: email });
  if (code !== 77) throw new Error(`expected NOPERM (77), got ${code}`);
  const last = audit[audit.length - 1];
  if (last.reason !== 'dkim-not-pass') {
    throw new Error('wrong reject reason: ' + JSON.stringify(last));
  }
});

test('rejects when no Authentication-Results header', () => {
  const token = encodeToken('15555550101');
  const email = buildEmail({
    to: `sms-reply+${token}@productphotographymontreal.ca`,
    authResults: '',
    body: 'hi',
  });
  // strip out the auth-results line by hand
  const cleaned = email
    .split('\r\n')
    .filter((l) => !l.startsWith('Authentication-Results:'))
    .join('\r\n');
  const { code, audit } = runBridge({ stdin: cleaned });
  if (code !== 77) throw new Error(`expected NOPERM (77), got ${code}`);
  const last = audit[audit.length - 1];
  if (last.reason !== 'no-authentication-results') {
    throw new Error('wrong reject reason: ' + JSON.stringify(last));
  }
});

test('rejects forged token (bad HMAC tag)', () => {
  // hand-craft a token without the secret
  const bad = Buffer.from('15555550101.AAAAAAAA', 'utf8').toString('base64url');
  const email = buildEmail({
    to: `sms-reply+${bad}@productphotographymontreal.ca`,
    body: 'hi',
  });
  const { code, audit } = runBridge({ stdin: email });
  if (code !== 65) throw new Error(`expected DATAERR (65), got ${code}`);
  const last = audit[audit.length - 1];
  if (last.reason !== 'token-tag-mismatch') {
    throw new Error('wrong reject reason: ' + JSON.stringify(last));
  }
});

test('rejects empty reply after quote-strip', () => {
  const token = encodeToken('15555550101');
  const email = buildEmail({
    to: `sms-reply+${token}@productphotographymontreal.ca`,
    body:
      '\n' +
      'On Mon, Jun 8, 2026 at 12:00 PM, CRM <crm@impressionphotography.ca> wrote:\n' +
      '> Sure, see you at 3pm.\n' +
      '> —\n' +
      '> From: Lydia\n',
  });
  const { code, audit } = runBridge({ stdin: email });
  if (code !== 65) throw new Error(`expected DATAERR (65), got ${code}`);
  const last = audit[audit.length - 1];
  if (last.reason !== 'empty-reply-after-strip') {
    throw new Error('wrong reject reason: ' + JSON.stringify(last));
  }
});

test('rejects missing reply-token in recipient', () => {
  const email = buildEmail({
    to: 'hello@productphotographymontreal.ca',
    body: 'hi',
  });
  const { code, audit } = runBridge({ stdin: email });
  if (code !== 65) throw new Error(`expected DATAERR (65), got ${code}`);
  const last = audit[audit.length - 1];
  if (last.reason !== 'no-token-in-recipient') {
    throw new Error('wrong reject reason: ' + JSON.stringify(last));
  }
});

test('strips Outlook reply with leading quoted block', () => {
  const phone = '15555550101';
  const token = encodeToken(phone);
  const email = buildEmail({
    to: `sms-reply+${token}@productphotographymontreal.ca`,
    body:
      'Got it.\n' +
      '\n' +
      'On Mon, Jun 8, 2026 at 12:00 PM Twenty CRM <crm@impressionphotography.ca> wrote:\n' +
      '> Lydia: Are we still on for 3pm?\n' +
      '>\n' +
      '> —\n' +
      '> From: Lydia (+15555550101)\n',
  });
  const { code, audit } = runBridge({ stdin: email });
  if (code !== 0) throw new Error(`expected code 0, got ${code}`);
  const last = audit[audit.length - 1];
  if (last.text !== 'Got it.') {
    throw new Error('quoted block not stripped: ' + JSON.stringify(last.text));
  }
});

test('strips signature after "-- "', () => {
  const phone = '15555550101';
  const token = encodeToken(phone);
  const email = buildEmail({
    to: `sms-reply+${token}@productphotographymontreal.ca`,
    body: 'Confirmed.\n\n-- \nMoshe Lerner\nImpression Photography\n',
  });
  const { code, audit } = runBridge({ stdin: email });
  if (code !== 0) throw new Error(`expected code 0, got ${code}`);
  const last = audit[audit.length - 1];
  if (last.text !== 'Confirmed.') {
    throw new Error('signature not stripped: ' + JSON.stringify(last.text));
  }
});

(async () => {
  let pass = 0;
  let fail = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`PASS  ${t.name}`);
      pass++;
    } catch (error) {
      console.log(`FAIL  ${t.name}`);
      console.log('      ' + error.message);
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
