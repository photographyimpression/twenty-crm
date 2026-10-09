// One-off repair for timeline notes created by the Telnyx webhook between
// the upstream RICH_TEXT_V2 migration (~2026-09-03) and the 2026-10-07 fix:
// the webhook wrote a ProseMirror doc into the bodyV2 composite, which
// silently stored NULL bodies — so call/SMS notes showed no transcript and
// no message text on the timeline.
//
// Rebuilds each affected note's bodyV2Markdown from the persisted
// call-records.json / sms-records.json stores, mirroring the exact body
// format of telnyx-webhook.service.ts (callNoteBody / logSmsToTimeline).
//
// Run INSIDE the twenty-server container (has `pg` + the records volume):
//   docker exec twenty-server-1 node /path/to/backfill-call-note-bodies.mjs
// Or from the repo's scripts dir copied in. Idempotent: only touches notes
// whose bodyV2Markdown IS NULL.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const dataDir =
  process.env.TWENTY_CALL_RECORDINGS_DIR ||
  path.join(process.cwd(), '.local-storage', 'twenty-call-recordings');

const crmBaseUrl = (
  process.env.FRONTEND_URL ||
  process.env.SERVER_URL ||
  'https://crm.impressionphotography.ca'
).replace(/\/+$/, '');

const readJson = (file) => {
  const full = path.join(dataDir, file);
  return fs.existsSync(full)
    ? JSON.parse(fs.readFileSync(full, 'utf-8'))
    : null;
};

const callRecords = readJson('call-records.json') ?? [];
const smsRecords = readJson('sms-records.json') ?? [];

const durationStr = (ms) => {
  const totalSec = ms ? Math.round(ms / 1000) : 0;
  return totalSec > 0
    ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
    : 'N/A';
};

const callNoteBody = (record) => {
  let body = `Direction: ${record.direction}\nDuration: ${durationStr(record.durationMs)}\n`;
  body += `From: ${record.from}\nTo: ${record.to}\n`;
  body += `Time: ${new Date(record.startTime).toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
  })}`;

  if (record.recordingUrl) {
    body += `\n\n🎙️ Recording: ${record.recordingUrl}`;
  }

  if (record.transcription) {
    body += `\n\n📝 Transcription:\n${record.transcription}`;
  } else if (record.liveTranscript) {
    body += `\n\n📝 Transcription (live, your side):\n${record.liveTranscript}`;
  } else {
    body += `\n\n⏳ Transcription: preparing — the transcript appears here automatically as soon as it's ready.`;
  }

  return body;
};

const smsNoteBody = (record) => {
  const inbound = record.direction === 'inbound';
  const contactPhone = inbound ? record.from : record.to;
  const time = new Date(record.timestamp).toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
  });

  let body =
    `${inbound ? 'From' : 'To'}: ${contactPhone}\n` +
    `Time: ${time}\n\n${record.text}`;

  const withLocalFile = (record.media ?? []).filter((item) => item.localFile);

  if (withLocalFile.length > 0) {
    const links = withLocalFile
      .map((item) => `${crmBaseUrl}/telnyx/sms-media/${item.localFile}`)
      .join('\n');
    body += `\n\n📷 Photo${withLocalFile.length > 1 ? 's' : ''}:\n${links}`;
  }

  return body;
};

const digits = (phone) => {
  if (!phone) return '';
  if (typeof phone === 'object') {
    return digits(Array.isArray(phone) ? phone[0] : phone.phone_number);
  }
  return String(phone).replace(/\D/g, '');
};

const client = new Client({ connectionString: process.env.PG_DATABASE_URL });
await client.connect();

// Find the (single-workspace) schema that owns the note table.
const schemaResult = await client.query(
  `select table_schema from information_schema.tables
   where table_name = 'note' and table_type = 'BASE TABLE' limit 1`,
);
const schema = schemaResult.rows[0]?.table_schema;

if (!schema) {
  console.error('Could not find the note table schema — aborting.');
  await client.end();
  process.exit(1);
}

// ── Call notes: exact note ids are stored on the records ──────────────────
let callFixed = 0;
let callMissing = 0;

for (const [, record] of callRecords) {
  if (!record.timelineNoteId) continue;

  const existing = await client.query(
    `select "bodyV2Markdown" from ${schema}.note where id = $1`,
    [record.timelineNoteId],
  );

  if (existing.rowCount === 0) {
    callMissing++;
    continue;
  }

  if (existing.rows[0].bodyV2Markdown != null) continue;

  await client.query(
    `update ${schema}.note set "bodyV2Markdown" = $1 where id = $2`,
    [callNoteBody(record), record.timelineNoteId],
  );
  callFixed++;
}

// ── SMS notes: no ids stored — match by direction + creation time ─────────
// The webhook creates the note a second or two after the sms timestamp, so a
// ±15s window that contains exactly ONE sms record of the right direction is
// an unambiguous match. Anything ambiguous is left alone and reported.
const smsNotes = await client.query(
  `select id, title, "createdAt" from ${schema}.note
   where title in ('📥 SMS Received', '📤 SMS Sent')
     and "bodyV2Markdown" is null
   order by "createdAt" asc`,
);

let smsFixed = 0;
let smsAmbiguous = 0;

for (const note of smsNotes.rows) {
  const inbound = note.title === '📥 SMS Received';
  const noteAt = new Date(note.createdAt).getTime();
  const windowRecords = smsRecords.filter((record) => {
    if (record.direction !== (inbound ? 'inbound' : 'outbound')) return false;
    const at = new Date(record.timestamp).getTime();
    return Math.abs(at - noteAt) <= 15_000;
  });

  if (windowRecords.length !== 1) {
    smsAmbiguous++;
    continue;
  }

  await client.query(
    `update ${schema}.note set "bodyV2Markdown" = $1 where id = $2`,
    [smsNoteBody(windowRecords[0]), note.id],
  );
  smsFixed++;
}

console.log(
  `Backfill done: ${callFixed} call notes fixed (${callMissing} note ids no longer exist), ` +
    `${smsFixed} SMS notes fixed, ${smsAmbiguous} SMS notes skipped (ambiguous match).`,
);

await client.end();
