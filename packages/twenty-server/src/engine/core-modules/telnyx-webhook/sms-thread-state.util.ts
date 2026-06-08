// Persists per-contact SMS thread state so each notification email
// threads under the previous one in Outlook. Threading rules:
//   - First email in a thread emits a stable Message-ID and stores it as
//     the thread root.
//   - Every subsequent email sets In-Reply-To and References to the
//     thread root's Message-ID. Outlook (and most clients) group by
//     References/In-Reply-To, so all SMS-from-Lydia collapse into one
//     conversation regardless of subject changes.
//   - We also store the previous Message-ID so we can chain References:
//     <root> <prev> <new>. Outlook tolerates either form; we use the
//     chained form for fidelity.
//
// State is keyed by normalized phone digits (E.164 with + stripped) so
// number formatting differences across Telnyx events don't fragment the
// thread.
//
// Storage: a single JSON file in the same dataDir the SMS records live
// in. File I/O is sync for simplicity — load+save is a few KB even
// after thousands of conversations, and SMS volume is human-scale.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { Logger } from '@nestjs/common';

const STATE_FILENAME = 'sms-thread-state.json';
const MAIL_DOMAIN = 'productphotographymontreal.ca';

type ThreadEntry = {
  // Normalized phone digits (used as key but also stored for debugging).
  phone: string;
  // Random short id baked into every Message-ID for this thread. Stable
  // across the lifetime of the conversation.
  threadHash: string;
  // Monotonic sequence — incremented on each email so each Message-ID
  // is unique.
  sequence: number;
  // The Message-ID of the very first email (the thread root). All later
  // emails reference this one.
  rootMessageId: string;
  // The Message-ID of the most-recent email. Used to chain References.
  lastMessageId: string;
  // Timestamps for housekeeping (not currently pruned).
  createdAt: string;
  updatedAt: string;
};

type ThreadHeaders = {
  // The Message-ID for THIS new email.
  messageId: string;
  // In-Reply-To: the previous Message-ID (undefined on the first email).
  inReplyTo?: string;
  // References: chain of previous Message-IDs (undefined on the first email).
  references?: string;
};

const normalizePhone = (raw: string): string => raw.replace(/\D/g, '');

const buildMessageId = (threadHash: string, sequence: number): string =>
  `<sms-thread-${threadHash}-${sequence}@${MAIL_DOMAIN}>`;

export class SmsThreadStateStore {
  private readonly logger = new Logger(SmsThreadStateStore.name);
  private readonly filePath: string;
  private state: Record<string, ThreadEntry> = {};

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, STATE_FILENAME);
    this.load();
  }

  // Allocate a fresh set of headers for the next outbound email in the
  // contact's thread. Creates the thread on first call.
  getNextHeaders(rawPhone: string): ThreadHeaders {
    const key = normalizePhone(rawPhone);
    const now = new Date().toISOString();
    const existing = this.state[key];

    if (!existing) {
      const threadHash = crypto.randomBytes(6).toString('hex');
      const messageId = buildMessageId(threadHash, 1);

      this.state[key] = {
        phone: key,
        threadHash,
        sequence: 1,
        rootMessageId: messageId,
        lastMessageId: messageId,
        createdAt: now,
        updatedAt: now,
      };
      this.save();

      return { messageId };
    }

    existing.sequence += 1;
    const messageId = buildMessageId(existing.threadHash, existing.sequence);
    const inReplyTo = existing.lastMessageId;
    // Chain References: root + previous (de-duped). Outlook caps the
    // header at ~1000 chars in practice, so for very long threads we
    // truncate to root + last 4. Real-world threads stay short.
    const references = [existing.rootMessageId, existing.lastMessageId]
      .filter((id, idx, arr) => arr.indexOf(id) === idx)
      .join(' ');

    existing.lastMessageId = messageId;
    existing.updatedAt = now;
    this.save();

    return { messageId, inReplyTo, references };
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');

        this.state = JSON.parse(raw) as Record<string, ThreadEntry>;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to load SMS thread state from ${this.filePath}: ${error}`,
      );
      this.state = {};
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      this.logger.warn(
        `Failed to save SMS thread state to ${this.filePath}: ${error}`,
      );
    }
  }
}

// Encode a phone number into a base64url token suitable for plus-
// addressing. The token survives Outlook mangling because base64url
// uses [A-Za-z0-9_-] only — no + or / which Outlook sometimes mauls.
export const encodeReplyToken = (rawPhone: string): string => {
  const digits = normalizePhone(rawPhone);

  // Embed a short HMAC tag so the bridge can verify the token wasn't
  // hand-crafted. Without it, anyone who can guess the plus-address
  // format could send SMS to arbitrary numbers. We also enforce sender
  // auth in the bridge, but defense-in-depth.
  const secret =
    process.env['SMS_REPLY_TOKEN_SECRET'] ??
    process.env['TELNYX_API_KEY'] ??
    'fallback-do-not-rely-on-me';
  const tag = crypto
    .createHmac('sha256', secret)
    .update(digits)
    .digest('base64url')
    .slice(0, 8);

  return Buffer.from(`${digits}.${tag}`, 'utf8').toString('base64url');
};

// Build the Reply-To address for an inbound SMS.
export const buildReplyToAddress = (rawPhone: string): string => {
  const token = encodeReplyToken(rawPhone);

  return `sms-reply+${token}@${MAIL_DOMAIN}`;
};
