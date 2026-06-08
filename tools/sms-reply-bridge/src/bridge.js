#!/usr/bin/env node
// SMS reply bridge — Postfix pipe target.
//
// Postfix invokes us per-message with the full RFC822 message on stdin.
// We parse, validate that the sender is authorized, extract the reply
// text (stripping quoted history and signatures), decode the recipient
// phone number from the plus-addressed token, then POST to Telnyx.
//
// Exit codes (Postfix understands these per master(5)):
//   0 — message accepted, SMS sent (or dry-run logged)
//   65 (EX_DATAERR) — malformed input, will be bounced
//   77 (EX_NOPERM) — sender not authorized, will be bounced
//   75 (EX_TEMPFAIL) — transient error, Postfix will retry
//
// All decisions are appended to AUDIT_LOG_PATH as JSON lines so we
// have a forensic trail of every reply attempt.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { simpleParser } = require('mailparser');

// Load .env without depending on `dotenv` so we have zero non-mailparser
// runtime deps. Simple `KEY=VALUE` lines, `#` comments, trims quotes.
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, '..', '.env'));

const CONFIG = {
  telnyxApiKey: process.env.TELNYX_API_KEY || '',
  telnyxFromNumber: process.env.TELNYX_FROM_NUMBER || '+15142702784',
  telnyxMessagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID || '',
  twentyApiUrl: process.env.TWENTY_API_URL || '',
  twentyApiToken: process.env.TWENTY_API_TOKEN || '',
  tokenSecret:
    process.env.SMS_REPLY_TOKEN_SECRET || process.env.TELNYX_API_KEY || '',
  allowedSender: (process.env.ALLOWED_SENDER || 'moshe@impressionphotography.ca')
    .trim()
    .toLowerCase(),
  dryRun: /^true$/i.test(process.env.TELNYX_DRY_RUN || ''),
  skipAuthHeaderCheck: /^true$/i.test(process.env.SKIP_AUTH_HEADER_CHECK || ''),
  auditLogPath: process.env.AUDIT_LOG_PATH || '/var/log/sms-reply-bridge.log',
};

const EXIT = {
  OK: 0,
  DATAERR: 65,
  NOPERM: 77,
  TEMPFAIL: 75,
};

function audit(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    fs.appendFileSync(CONFIG.auditLogPath, line + '\n');
  } catch (error) {
    // Audit log is best-effort. If it fails (permissions, full disk)
    // we still let the reply attempt complete — losing one log line
    // is better than losing a real customer reply.
    process.stderr.write(
      `bridge: failed to write audit log: ${error.message}\n`,
    );
  }
  process.stderr.write(`bridge: ${line}\n`);
}

// Read the entire RFC822 message from stdin.
async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

// Decode the base64url plus-addressing token into the destination phone
// number. Verifies the HMAC tag (defense-in-depth — the sender auth
// check below is the primary guard).
function decodeReplyToken(token) {
  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return { ok: false, error: 'token-not-base64url' };
  }
  const dot = decoded.lastIndexOf('.');
  if (dot === -1) return { ok: false, error: 'token-missing-tag' };
  const digits = decoded.slice(0, dot);
  const tag = decoded.slice(dot + 1);
  if (!/^[0-9]{6,15}$/.test(digits)) {
    return { ok: false, error: 'token-bad-digits' };
  }
  if (!CONFIG.tokenSecret) {
    // Without a secret we can't verify the tag; in that mode we accept
    // any well-formed digits string (matches the CRM-side fallback so
    // bootstrap doesn't require a perfectly-aligned secret).
    return { ok: true, phone: '+' + digits };
  }
  const expected = crypto
    .createHmac('sha256', CONFIG.tokenSecret)
    .update(digits)
    .digest('base64url')
    .slice(0, 8);
  // constant-time compare — short string but still proper hygiene
  if (
    expected.length !== tag.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(tag))
  ) {
    return { ok: false, error: 'token-tag-mismatch' };
  }
  return { ok: true, phone: '+' + digits };
}

// Pull the plus-extended local part from a recipient address. Postfix
// passes the original envelope recipient via the `${recipient}` macro
// (we expose it as $ORIGINAL_RECIPIENT in master.cf). Falls back to the
// To: header if the env var is missing.
function extractTokenFromRecipient(parsed) {
  const candidates = [];
  if (process.env.ORIGINAL_RECIPIENT) {
    candidates.push(process.env.ORIGINAL_RECIPIENT);
  }
  // Headers may have multiple To/Delivered-To/X-Original-To entries.
  for (const headerName of [
    'delivered-to',
    'x-original-to',
    'to',
  ]) {
    const raw = parsed.headers.get(headerName);
    if (!raw) continue;
    if (typeof raw === 'string') {
      candidates.push(raw);
    } else if (raw.value && Array.isArray(raw.value)) {
      for (const v of raw.value) {
        if (v.address) candidates.push(v.address);
      }
    } else if (raw.text) {
      candidates.push(raw.text);
    }
  }
  for (const candidate of candidates) {
    // Match sms-reply+TOKEN@productphotographymontreal.ca (or any host —
    // the host is enforced by the mail server's accept list).
    const match = /sms-reply\+([A-Za-z0-9_-]+)@/i.exec(candidate);
    if (match) return { token: match[1], rawRecipient: candidate };
  }
  return null;
}

// Verify SPF=pass AND DKIM=pass in the Authentication-Results header
// (Postfix prepends a fresh one when a Microsoft account relays to us).
// Without it we have no proof the From header wasn't spoofed.
function checkAuthHeaders(parsed) {
  if (CONFIG.skipAuthHeaderCheck) return { ok: true, skipped: true };
  const headers = parsed.headers.get('authentication-results');
  // mailparser may return a string OR an array depending on duplication.
  const raws = Array.isArray(headers)
    ? headers
    : headers
      ? [headers]
      : [];
  const joined = raws.map(String).join(' ; ').toLowerCase();
  if (!joined) return { ok: false, error: 'no-authentication-results' };
  const spfPass = /\bspf\s*=\s*pass\b/.test(joined);
  const dkimPass = /\bdkim\s*=\s*pass\b/.test(joined);
  if (!spfPass) return { ok: false, error: 'spf-not-pass' };
  if (!dkimPass) return { ok: false, error: 'dkim-not-pass' };
  return { ok: true };
}

// Extract the From address as a lowercase email. mailparser puts it on
// parsed.from.value[0].address.
function extractFromAddress(parsed) {
  if (parsed.from && parsed.from.value && parsed.from.value.length > 0) {
    return (parsed.from.value[0].address || '').toLowerCase().trim();
  }
  return '';
}

// Strip the quoted-history block from a reply. Conventions we handle:
//   - "On <date>, <name> wrote:" attribution line
//   - Lines starting with ">"
//   - The "—" + metadata block we emit in the SMS notification body
//   - Outlook's "From: ... Sent: ... To: ..." header block
//   - Signature delimiter "-- "
//   - Common signature blocks ("Forwarded by Twenty CRM", "Reply to this email")
function extractReplyText(parsed) {
  // Prefer the text part. mailparser falls back to converting HTML for
  // us if there's no plain text.
  let body = (parsed.text || '').replace(/\r\n/g, '\n');

  // Drop everything from the first occurrence of the "On ..., wrote:"
  // attribution line — Outlook variants include "Le ..., a écrit:".
  const onWroteRe = /^(?:On |Le )[^\n]{0,200}(?:wrote|a écrit):\s*$/m;
  const onWroteMatch = onWroteRe.exec(body);
  if (onWroteMatch) {
    body = body.slice(0, onWroteMatch.index);
  }

  // Drop everything from the first Outlook-style header block
  // ("From: ... \nSent: ... \nTo: ...") which Outlook injects at the
  // top of quoted history when reply-on-top.
  const outlookBlockRe = /\n[ \t]*From:[ \t][^\n]+\n[ \t]*Sent:[ \t][^\n]+/i;
  const outlookBlockMatch = outlookBlockRe.exec(body);
  if (outlookBlockMatch) {
    body = body.slice(0, outlookBlockMatch.index);
  }

  // Drop our own SMS notification footer if Outlook quoted it.
  const ourFooterRe = /\n[ \t]*—[ \t]*\n[ \t]*From:[ \t][^\n]+/;
  const ourFooterMatch = ourFooterRe.exec(body);
  if (ourFooterMatch) {
    body = body.slice(0, ourFooterMatch.index);
  }

  // Drop "Reply to this email to send an SMS back" line if quoted
  body = body.replace(/^\s*Reply to this email[^\n]*$/gim, '');

  // Drop the standard signature delimiter and everything after it.
  const sigDelim = /\n-- \n[\s\S]*$/;
  body = body.replace(sigDelim, '\n');

  // Drop lines beginning with ">"
  body = body
    .split('\n')
    .filter((line) => !/^>/.test(line.trim()))
    .join('\n');

  // Collapse runs of empty trailing lines, trim.
  return body.replace(/\s+$/g, '').trim();
}

async function callTelnyx({ to, text }) {
  if (CONFIG.dryRun) {
    return { ok: true, dryRun: true, telnyxMessageId: 'dry-run' };
  }
  if (!CONFIG.telnyxApiKey) {
    return { ok: false, error: 'no-telnyx-api-key' };
  }
  const body = {
    from: CONFIG.telnyxFromNumber,
    to,
    text,
  };
  if (CONFIG.telnyxMessagingProfileId) {
    body.messaging_profile_id = CONFIG.telnyxMessagingProfileId;
  }
  let response;
  try {
    response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, error: `telnyx-fetch-failed: ${error.message}` };
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    return {
      ok: false,
      error: `telnyx-http-${response.status}`,
      detail: errText,
    };
  }
  const data = await response.json().catch(() => ({}));
  return {
    ok: true,
    telnyxMessageId: data && data.data && data.data.id ? data.data.id : null,
  };
}

// Log the outbound SMS into the CRM so the conversation thread in the
// SMS Inbox shows the reply Moshe sent from Outlook. Best-effort: a
// failure here does NOT abort the bridge — the SMS already went out.
async function logToCrm({ to, text, telnyxMessageId }) {
  if (!CONFIG.twentyApiUrl || !CONFIG.twentyApiToken) {
    return { skipped: true, reason: 'crm-creds-missing' };
  }
  const url = CONFIG.twentyApiUrl.replace(/\/$/, '') + '/telnyx/sms/log-outbound';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.twentyApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: CONFIG.telnyxFromNumber,
        to,
        text,
        telnyxMessageId,
        source: 'email-reply-bridge',
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, error: `crm-http-${response.status}`, detail };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `crm-fetch-failed: ${error.message}` };
  }
}

async function main() {
  let raw;
  try {
    raw = await readStdin();
  } catch (error) {
    audit({ stage: 'stdin', error: error.message });
    return EXIT.TEMPFAIL;
  }
  if (!raw || raw.length === 0) {
    audit({ stage: 'stdin', error: 'empty-input' });
    return EXIT.DATAERR;
  }

  let parsed;
  try {
    parsed = await simpleParser(raw);
  } catch (error) {
    audit({ stage: 'parse', error: error.message });
    return EXIT.DATAERR;
  }

  const fromAddress = extractFromAddress(parsed);
  const subject = (parsed.subject || '').slice(0, 200);

  // 1. Sender allow-list.
  if (fromAddress !== CONFIG.allowedSender) {
    audit({
      stage: 'auth',
      decision: 'reject',
      reason: 'from-not-allowed',
      from: fromAddress,
      subject,
    });
    return EXIT.NOPERM;
  }

  // 2. SPF + DKIM check.
  const authCheck = checkAuthHeaders(parsed);
  if (!authCheck.ok) {
    audit({
      stage: 'auth',
      decision: 'reject',
      reason: authCheck.error,
      from: fromAddress,
      subject,
    });
    return EXIT.NOPERM;
  }

  // 3. Decode recipient token.
  const recipientInfo = extractTokenFromRecipient(parsed);
  if (!recipientInfo) {
    audit({
      stage: 'decode',
      decision: 'reject',
      reason: 'no-token-in-recipient',
      from: fromAddress,
      subject,
    });
    return EXIT.DATAERR;
  }
  const decoded = decodeReplyToken(recipientInfo.token);
  if (!decoded.ok) {
    audit({
      stage: 'decode',
      decision: 'reject',
      reason: decoded.error,
      token: recipientInfo.token,
      rawRecipient: recipientInfo.rawRecipient,
    });
    return EXIT.DATAERR;
  }

  // 4. Extract reply text.
  const replyText = extractReplyText(parsed);
  if (!replyText) {
    audit({
      stage: 'extract',
      decision: 'reject',
      reason: 'empty-reply-after-strip',
      from: fromAddress,
      to: decoded.phone,
    });
    return EXIT.DATAERR;
  }
  if (replyText.length > 1600) {
    audit({
      stage: 'extract',
      decision: 'reject',
      reason: 'reply-too-long',
      length: replyText.length,
      to: decoded.phone,
    });
    return EXIT.DATAERR;
  }
  const segmentsWarning =
    replyText.length > 160 ? { warning: 'will-segment', length: replyText.length } : {};

  // 5. Send via Telnyx.
  const sendResult = await callTelnyx({ to: decoded.phone, text: replyText });
  if (!sendResult.ok) {
    audit({
      stage: 'telnyx',
      decision: 'fail',
      reason: sendResult.error,
      detail: sendResult.detail || null,
      to: decoded.phone,
      length: replyText.length,
    });
    return EXIT.TEMPFAIL;
  }

  // 6. Log to CRM (best-effort).
  const crmResult = await logToCrm({
    to: decoded.phone,
    text: replyText,
    telnyxMessageId: sendResult.telnyxMessageId,
  });

  audit({
    stage: 'done',
    decision: 'accept',
    from: fromAddress,
    to: decoded.phone,
    text: replyText,
    length: replyText.length,
    telnyxMessageId: sendResult.telnyxMessageId,
    dryRun: !!sendResult.dryRun,
    crmLog: crmResult,
    ...segmentsWarning,
  });

  return EXIT.OK;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    audit({ stage: 'main', error: error.message });
    process.exit(EXIT.TEMPFAIL);
  });
