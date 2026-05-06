import { Injectable, Logger } from '@nestjs/common';

import * as fs from 'fs';
import * as path from 'path';

import { EmailSenderService } from 'src/engine/core-modules/email/email-sender.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { NoteWorkspaceEntity } from 'src/modules/note/standard-objects/note.workspace-entity';
import { NoteTargetWorkspaceEntity } from 'src/modules/note/standard-objects/note-target.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

type TelnyxPayload = {
  call_control_id?: string;
  call_leg_id?: string;
  call_session_id?: string;
  connection_id?: string;
  from?: string;
  to?: string;
  direction?: string;
  state?: string;
  start_time?: string;
  end_time?: string;
  duration_millis?: number;
  recording_urls?: {
    mp3?: string;
    wav?: string;
  };
  public_recording_urls?: {
    mp3?: string;
    wav?: string;
  };
  channels?: string;
  // SMS fields
  text?: string;
  media?: Array<{ url: string; content_type: string }>;
  type?: string;
};

type TelnyxWebhookBody = {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    payload?: TelnyxPayload;
    record_type?: string;
  };
  meta?: {
    attempt?: number;
    delivered_to?: string;
  };
};

type CallRecord = {
  callSessionId: string;
  from: string;
  to: string;
  direction: string;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  recordingUrl: string | null;
  transcription: string | null;
  status: string;
};

type SmsRecord = {
  id: string;
  from: string;
  to: string;
  text: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  status: string;
};

const MAX_CALL_RECORDS = 1000;
const MAX_SMS_RECORDS = 5000;
const STALE_RECORD_HOURS = 72;
const MAX_TRANSCRIPTION_RETRIES = 2;

@Injectable()
export class TelnyxWebhookService {
  private readonly logger = new Logger(TelnyxWebhookService.name);
  private readonly callRecords = new Map<string, CallRecord>();
  private readonly smsRecords: SmsRecord[] = [];
  private readonly processedEvents = new Set<string>();
  private readonly dataDir: string;

  constructor(
    private readonly emailSenderService: EmailSenderService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {
    // Persist to the .local-storage volume so records survive container
    // rebuilds. Override with TWENTY_CALL_RECORDINGS_DIR if needed.
    this.dataDir =
      process.env.TWENTY_CALL_RECORDINGS_DIR ??
      path.join(process.cwd(), '.local-storage', 'twenty-call-recordings');

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // One-time migration: copy any records from the legacy $HOME location
    // (which Docker rebuilds wiped) so existing data isn't lost on upgrade.
    const legacyDir = path.join(
      process.env.HOME ?? '/tmp',
      '.twenty-call-recordings',
    );

    if (legacyDir !== this.dataDir && fs.existsSync(legacyDir)) {
      for (const file of ['call-records.json', 'sms-records.json']) {
        const legacyFile = path.join(legacyDir, file);
        const targetFile = path.join(this.dataDir, file);

        if (fs.existsSync(legacyFile) && !fs.existsSync(targetFile)) {
          fs.copyFileSync(legacyFile, targetFile);
        }
      }
    }

    this.loadCallRecords();
    this.loadSmsRecords();
    this.cleanupStaleRecords();
  }

  async handleVoiceEvent(body: TelnyxWebhookBody): Promise<void> {
    const eventType = body?.data?.event_type;
    const eventId = body?.data?.id;
    const payload = body?.data?.payload;

    if (!eventType || !payload) {
      this.logger.warn('Missing event_type or payload in voice webhook');

      return;
    }

    // Idempotency: skip duplicate webhook deliveries
    if (eventId && this.processedEvents.has(eventId)) {
      this.logger.log(`Skipping duplicate event: ${eventId}`);

      return;
    }

    if (eventId) {
      this.processedEvents.add(eventId);

      // Prevent unbounded growth of processed events set
      if (this.processedEvents.size > 5000) {
        const toDelete = Array.from(this.processedEvents).slice(0, 2500);

        for (const id of toDelete) {
          this.processedEvents.delete(id);
        }
      }
    }

    const sessionId = payload.call_session_id || payload.call_control_id || '';

    switch (eventType) {
      case 'call.initiated': {
        const record: CallRecord = {
          callSessionId: sessionId,
          from: this.extractPhoneNumber(payload.from),
          to: this.extractPhoneNumber(payload.to),
          direction: payload.direction || 'unknown',
          startTime: payload.start_time || new Date().toISOString(),
          endTime: null,
          durationMs: null,
          recordingUrl: null,
          transcription: null,
          status: 'initiated',
        };

        this.callRecords.set(sessionId, record);
        this.saveCallRecords();
        this.logger.log(
          `Call initiated: ${record.from} -> ${record.to} (${record.direction})`,
        );
        break;
      }

      case 'call.answered': {
        const record = this.callRecords.get(sessionId);

        if (record) {
          record.status = 'answered';
          this.saveCallRecords();
        }
        this.logger.log(`Call answered: ${sessionId}`);
        break;
      }

      case 'call.hangup':
      case 'call.machine.detection.ended': {
        const record = this.callRecords.get(sessionId);

        if (record) {
          record.status = 'ended';
          record.endTime = payload.end_time || new Date().toISOString();

          if (payload.duration_millis) {
            record.durationMs = payload.duration_millis;
          } else if (record.startTime) {
            record.durationMs =
              new Date(record.endTime).getTime() -
              new Date(record.startTime).getTime();
          }
          this.saveCallRecords();

          // Log call to person's timeline (async, don't block webhook)
          this.logCallToTimeline(record).catch((err) =>
            this.logger.error(`Failed to log call to timeline: ${err}`),
          );
        }
        this.logger.log(`Call ended: ${sessionId}`);
        break;
      }

      case 'call.recording.saved': {
        await this.handleRecordingSaved(sessionId, payload);
        break;
      }

      default:
        this.logger.log(`Unhandled voice event: ${eventType}`);
    }
  }

  async handleRecordingEvent(body: TelnyxWebhookBody): Promise<void> {
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    if (!eventType || !payload) {
      return;
    }

    const sessionId = payload.call_session_id || payload.call_control_id || '';

    if (eventType === 'call.recording.saved') {
      await this.handleRecordingSaved(sessionId, payload);
    }
  }

  // Extract phone number string from Telnyx payload field
  // Telnyx sends from/to as objects: {carrier, phone_number} or arrays of objects
  private extractPhoneNumber(field: any): string {
    if (!field) return '';
    if (typeof field === 'string') return field;
    if (Array.isArray(field)) {
      return field[0]?.phone_number || '';
    }
    if (typeof field === 'object' && field.phone_number) {
      return field.phone_number;
    }

    return String(field);
  }

  async handleSmsEvent(body: TelnyxWebhookBody): Promise<void> {
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    if (!eventType || !payload) {
      return;
    }

    const fromNumber = this.extractPhoneNumber(payload.from);
    const toNumber = this.extractPhoneNumber(payload.to);

    this.logger.log(
      `SMS event: ${eventType} from ${fromNumber} to ${toNumber}`,
    );

    if (eventType === 'message.received') {
      this.logger.log(`Incoming SMS from ${fromNumber}: ${payload.text}`);

      const smsRecord: SmsRecord = {
        id: body?.data?.id || `sms-${Date.now()}`,
        from: fromNumber,
        to: toNumber,
        text: payload.text || '',
        direction: 'inbound',
        timestamp: body?.data?.occurred_at || new Date().toISOString(),
        status: 'received',
      };

      // Store the inbound SMS with normalized phone numbers
      this.storeSmsRecord(smsRecord);

      // Log to person's timeline (async, don't block webhook)
      this.logSmsToTimeline(smsRecord).catch((err) =>
        this.logger.error(`Failed to log SMS to timeline: ${err}`),
      );

      // Forward SMS to email
      await this.forwardSmsToEmail(fromNumber, toNumber, payload.text || '');

      // AI auto-reply
      await this.sendAutoReply(fromNumber, payload.text || '');
    }

    // Track outbound SMS delivery status
    if (eventType === 'message.sent' || eventType === 'message.finalized') {
      this.logger.log(`Outbound SMS status: ${eventType} to ${toNumber}`);
    }
  }

  // Store an outbound SMS record (called from the controller)
  storeOutboundSms(to: string, text: string): void {
    const smsRecord: SmsRecord = {
      id: `sms-out-${Date.now()}`,
      from: process.env['TELNYX_FROM_NUMBER'] || '+15142702784',
      to,
      text,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    this.storeSmsRecord(smsRecord);

    // Log to person's timeline (async)
    this.logSmsToTimeline(smsRecord).catch((err) =>
      this.logger.error(`Failed to log outbound SMS to timeline: ${err}`),
    );
  }

  getSmsRecords(contactNumber?: string): SmsRecord[] {
    if (contactNumber) {
      const normalized = contactNumber.replace(/\D/g, '');

      return this.smsRecords.filter((sms) => {
        const fromStr =
          typeof sms.from === 'object' && sms.from !== null
            ? (sms.from as any).phone_number || ''
            : String(sms.from || '');
        const toStr =
          typeof sms.to === 'object' && sms.to !== null
            ? Array.isArray(sms.to)
              ? (sms.to[0] as any)?.phone_number || ''
              : (sms.to as any).phone_number || ''
            : String(sms.to || '');
        const fromNorm = fromStr.replace(/\D/g, '');
        const toNorm = toStr.replace(/\D/g, '');

        return fromNorm.endsWith(normalized) || toNorm.endsWith(normalized);
      });
    }

    return [...this.smsRecords];
  }

  async handleRecordingSaved(
    sessionId: string,
    payload: TelnyxPayload,
  ): Promise<void> {
    const recordingUrl =
      payload.public_recording_urls?.mp3 ||
      payload.recording_urls?.mp3 ||
      payload.public_recording_urls?.wav ||
      payload.recording_urls?.wav ||
      null;

    const record = this.callRecords.get(sessionId);

    if (record) {
      record.recordingUrl = recordingUrl;
      record.status = 'recorded';
      this.saveCallRecords();
    } else {
      const newRecord: CallRecord = {
        callSessionId: sessionId,
        from: payload.from || '',
        to: payload.to || '',
        direction: 'unknown',
        startTime: payload.start_time || new Date().toISOString(),
        endTime: payload.end_time || null,
        durationMs: payload.duration_millis || null,
        recordingUrl,
        transcription: null,
        status: 'recorded',
      };

      this.callRecords.set(sessionId, newRecord);
      this.saveCallRecords();
    }

    this.logger.log(
      `Recording saved for session ${sessionId}: ${recordingUrl}`,
    );

    // Transcribe the recording
    if (recordingUrl) {
      await this.transcribeRecording(sessionId, recordingUrl);
    }
  }

  async transcribeRecording(
    sessionId: string,
    recordingUrl: string,
    attempt = 0,
  ): Promise<void> {
    const telnyxApiKey = process.env.TELNYX_API_KEY;

    if (!telnyxApiKey) {
      this.logger.warn('TELNYX_API_KEY not set, skipping transcription');

      return;
    }

    // Validate recording URL
    if (!recordingUrl.startsWith('http')) {
      this.logger.warn(`Invalid recording URL: ${recordingUrl}`);

      return;
    }

    try {
      // Use Telnyx Speech-to-Text API
      const response = await fetch('https://api.telnyx.com/v2/ai/transcribe', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_url: recordingUrl,
          language: 'en',
        }),
      });

      if (response.ok) {
        const result = (await response.json()) as {
          data?: { text?: string };
        };
        const transcript = result?.data?.text || '';

        if (!transcript || transcript.trim().length === 0) {
          this.logger.log(
            `Empty transcript for session ${sessionId} (call may have been too short)`,
          );

          const record = this.callRecords.get(sessionId);

          if (record) {
            record.transcription = '(No speech detected)';
            record.status = 'transcribed';
            this.saveCallRecords();
          }

          return;
        }

        const record = this.callRecords.get(sessionId);

        if (record) {
          record.transcription = transcript;
          record.status = 'transcribed';
          this.saveCallRecords();
        }

        this.logger.log(
          `Transcription completed for session ${sessionId}: ${transcript.substring(0, 100)}...`,
        );
      } else {
        const errorText = await response.text();

        this.logger.warn(
          `Telnyx transcription failed (${response.status}): ${errorText}`,
        );

        // Retry with backoff
        if (attempt < MAX_TRANSCRIPTION_RETRIES) {
          const delay = (attempt + 1) * 2000;

          this.logger.log(
            `Retrying transcription in ${delay}ms (attempt ${attempt + 1})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          await this.transcribeRecording(sessionId, recordingUrl, attempt + 1);

          return;
        }

        // Fallback: try Deepgram if available
        await this.transcribeWithDeepgram(sessionId, recordingUrl);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Transcription error: ${errorMessage}`);

      // Retry on transient errors
      if (attempt < MAX_TRANSCRIPTION_RETRIES) {
        const delay = (attempt + 1) * 2000;

        await new Promise((resolve) => setTimeout(resolve, delay));
        await this.transcribeRecording(sessionId, recordingUrl, attempt + 1);

        return;
      }

      // Fallback: try Deepgram if available
      await this.transcribeWithDeepgram(sessionId, recordingUrl);
    }
  }

  async transcribeWithDeepgram(
    sessionId: string,
    recordingUrl: string,
  ): Promise<void> {
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

    if (!deepgramApiKey) {
      this.logger.warn(
        'DEEPGRAM_API_KEY not set, skipping Deepgram fallback transcription',
      );

      return;
    }

    try {
      const response = await fetch(
        'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true',
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${deepgramApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: recordingUrl }),
        },
      );

      if (response.ok) {
        const result = (await response.json()) as {
          results?: {
            channels?: Array<{
              alternatives?: Array<{
                paragraphs?: {
                  paragraphs?: Array<{
                    sentences?: Array<{
                      text?: string;
                    }>;
                    speaker?: number;
                  }>;
                };
                transcript?: string;
              }>;
            }>;
          };
        };

        // Build diarized transcript
        const channels = result?.results?.channels || [];
        let transcript = '';

        for (const channel of channels) {
          const alternatives = channel.alternatives || [];

          for (const alt of alternatives) {
            if (alt.paragraphs?.paragraphs) {
              for (const para of alt.paragraphs.paragraphs) {
                const speaker = `Speaker ${(para.speaker ?? 0) + 1}`;
                const sentences = (para.sentences || [])
                  .map((s) => s.text)
                  .join(' ');

                transcript += `${speaker}: ${sentences}\n`;
              }
            } else if (alt.transcript) {
              transcript += alt.transcript;
            }
          }
        }

        const record = this.callRecords.get(sessionId);

        if (record && transcript) {
          record.transcription = transcript;
          record.status = 'transcribed';
          this.saveCallRecords();
        }

        this.logger.log(
          `Deepgram transcription completed for session ${sessionId}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Deepgram transcription error: ${errorMessage}`);
    }
  }

  getCallRecords(): CallRecord[] {
    return Array.from(this.callRecords.values()).sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );
  }

  getCallRecord(sessionId: string): CallRecord | undefined {
    return this.callRecords.get(sessionId);
  }

  private async forwardSmsToEmail(
    from: string,
    to: string,
    text: string,
  ): Promise<void> {
    const forwardEmail =
      process.env['SMS_FORWARD_EMAIL'] || 'moshe@impressionphotography.ca';

    try {
      await this.emailSenderService.send({
        from:
          process.env['EMAIL_FROM_ADDRESS'] || 'crm@impressionphotography.ca',
        to: forwardEmail,
        subject: `SMS from ${from}`,
        text: `New SMS received:\n\nFrom: ${from}\nTo: ${to}\nTime: ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}\n\nMessage:\n${text}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h3 style="color: #333; border-bottom: 2px solid #1a73e8; padding-bottom: 8px;">
              New SMS Received
            </h3>
            <table style="margin: 16px 0;">
              <tr><td style="padding: 4px 12px 4px 0; font-weight: bold; color: #666;">From:</td><td>${from}</td></tr>
              <tr><td style="padding: 4px 12px 4px 0; font-weight: bold; color: #666;">To:</td><td>${to}</td></tr>
              <tr><td style="padding: 4px 12px 4px 0; font-weight: bold; color: #666;">Time:</td><td>${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}</td></tr>
            </table>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin-top: 12px;">
              <p style="margin: 0; font-size: 16px; line-height: 1.5;">${text}</p>
            </div>
            <p style="color: #999; font-size: 12px; margin-top: 16px;">
              Forwarded by Twenty CRM Telephony System
            </p>
          </div>
        `,
      });

      this.logger.log(`SMS forwarded to ${forwardEmail}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to forward SMS to email: ${errorMessage}`);
    }
  }

  private async sendAutoReply(
    from: string,
    incomingText: string,
  ): Promise<void> {
    const telnyxApiKey = process.env['TELNYX_API_KEY'];
    const fromNumber = process.env['TELNYX_FROM_NUMBER'] || '+15142702784';
    const messagingProfileId = process.env['TELNYX_MESSAGING_PROFILE_ID'];

    if (!telnyxApiKey || !messagingProfileId) {
      this.logger.warn(
        'Missing TELNYX_API_KEY or TELNYX_MESSAGING_PROFILE_ID for auto-reply',
      );

      return;
    }

    // Generate AI reply if Gemini key is available (free tier)
    const geminiKey = process.env['GEMINI_API_KEY'];
    let autoReplyText: string;

    if (geminiKey) {
      autoReplyText = await this.generateAiReply(geminiKey, incomingText);
    } else {
      autoReplyText =
        'Thank you for contacting Impression Photography! ' +
        'We have received your message and will get back to you shortly. ' +
        'For immediate assistance, please call us at +1 (514) 894-7978.';
    }

    try {
      const response = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromNumber,
          to: from,
          text: autoReplyText,
          messaging_profile_id: messagingProfileId,
        }),
      });

      if (response.ok) {
        this.logger.log(`Auto-reply sent to ${from}`);

        // Store the outbound auto-reply
        this.storeSmsRecord({
          id: `sms-auto-${Date.now()}`,
          from: fromNumber,
          to: from,
          text: autoReplyText,
          direction: 'outbound',
          timestamp: new Date().toISOString(),
          status: 'sent',
        });
      } else {
        const errorText = await response.text();

        this.logger.error(
          `Auto-reply failed (${response.status}): ${errorText}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Auto-reply error: ${errorMessage}`);
    }
  }

  private async generateAiReply(
    apiKey: string,
    incomingText: string,
  ): Promise<string> {
    const systemPrompt =
      'You are the SMS auto-responder for Impression Photography, ' +
      'a professional photography studio in Montreal specializing in ' +
      'product photography, portrait photography, and event photography. ' +
      'Keep replies brief (under 160 characters if possible, max 300 chars). ' +
      'Be friendly and professional. If the message is about booking, ' +
      'mention they can call +1 (514) 894-7978. Never make up prices or availability. ' +
      'If unsure, say a team member will follow up shortly.';

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [
              {
                parts: [
                  {
                    text: `Customer sent this SMS: "${incomingText}"\n\nWrite a brief, helpful auto-reply.`,
                  },
                ],
              },
            ],
            generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
          }),
        },
      );

      if (response.ok) {
        const result = (await response.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const aiText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (aiText) {
          this.logger.log(
            `AI generated auto-reply (Gemini): ${aiText.substring(0, 50)}...`,
          );

          return aiText;
        }
      } else {
        const errorText = await response.text();

        this.logger.warn(`AI auto-reply generation failed: ${errorText}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`AI auto-reply error: ${errorMessage}`);
    }

    // Fallback to static reply
    return (
      'Thank you for contacting Impression Photography! ' +
      'We have received your message and will get back to you shortly. ' +
      'For immediate assistance, please call us at +1 (514) 894-7978.'
    );
  }

  private storeSmsRecord(record: SmsRecord): void {
    this.smsRecords.push(record);

    // Enforce max records limit
    if (this.smsRecords.length > MAX_SMS_RECORDS) {
      this.smsRecords.splice(0, this.smsRecords.length - MAX_SMS_RECORDS);
    }

    this.saveSmsRecords();
  }

  private saveCallRecords(): void {
    try {
      const filePath = path.join(this.dataDir, 'call-records.json');
      const records = Array.from(this.callRecords.entries());

      fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to save call records: ${errorMessage}`);
    }
  }

  private loadCallRecords(): void {
    try {
      const filePath = path.join(this.dataDir, 'call-records.json');

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const records: [string, CallRecord][] = JSON.parse(data);

        for (const [key, value] of records) {
          this.callRecords.set(key, value);
        }
        this.logger.log(`Loaded ${this.callRecords.size} call records`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to load call records: ${errorMessage}`);
    }
  }

  private saveSmsRecords(): void {
    try {
      const filePath = path.join(this.dataDir, 'sms-records.json');

      fs.writeFileSync(filePath, JSON.stringify(this.smsRecords, null, 2));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to save SMS records: ${errorMessage}`);
    }
  }

  private loadSmsRecords(): void {
    try {
      const filePath = path.join(this.dataDir, 'sms-records.json');

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const records: SmsRecord[] = JSON.parse(data);

        this.smsRecords.push(...records);
        this.logger.log(`Loaded ${this.smsRecords.length} SMS records`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to load SMS records: ${errorMessage}`);
    }
  }

  private cleanupStaleRecords(): void {
    const cutoff = Date.now() - STALE_RECORD_HOURS * 60 * 60 * 1000;
    let removed = 0;

    for (const [key, record] of this.callRecords.entries()) {
      const recordTime = new Date(record.startTime).getTime();

      if (recordTime < cutoff && !record.transcription) {
        this.callRecords.delete(key);
        removed++;
      }
    }

    // Also enforce max records limit
    if (this.callRecords.size > MAX_CALL_RECORDS) {
      const sorted = Array.from(this.callRecords.entries()).sort(
        ([, a], [, b]) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );

      const toRemove = sorted.slice(
        0,
        this.callRecords.size - MAX_CALL_RECORDS,
      );

      for (const [key] of toRemove) {
        this.callRecords.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.log(`Cleaned up ${removed} stale call records`);
      this.saveCallRecords();
    }
  }

  // ── Timeline Integration ──────────────────────────────────────────

  private async getWorkspaceId(): Promise<string | null> {
    // Single-workspace deployment: use env or hardcoded ID
    return (
      process.env['WORKSPACE_ID'] || 'b5c558d8-6529-4565-969e-d23265fa4a8f'
    );
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/[\s\-()]/g, '');
  }

  async findPersonByPhone(phoneNumber: string): Promise<string | null> {
    const workspaceId = await this.getWorkspaceId();

    if (!workspaceId) return null;

    try {
      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          PersonWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      // Strip all non-digit characters for comparison
      const digitsOnly = phoneNumber.replace(/\D/g, '');

      // Phones composite type stores:
      // primaryPhoneNumber (local digits, e.g., "5148947978")
      // primaryPhoneCallingCode (e.g., "+1")
      // additionalPhones: [{number, countryCode, callingCode}]
      const people = await personRepository.find();

      for (const person of people) {
        const phones = person.phones as {
          primaryPhoneNumber?: string;
          primaryPhoneCallingCode?: string;
          additionalPhones?: Array<{
            number?: string;
            callingCode?: string;
          }> | null;
        } | null;

        if (!phones) continue;

        // Build full primary phone: callingCode + number
        const primaryDigits = (phones.primaryPhoneNumber || '').replace(
          /\D/g,
          '',
        );
        const callingCode = (phones.primaryPhoneCallingCode || '').replace(
          /\D/g,
          '',
        );
        const fullPrimary = callingCode + primaryDigits;

        if (
          primaryDigits &&
          (digitsOnly === fullPrimary ||
            digitsOnly.endsWith(primaryDigits) ||
            fullPrimary.endsWith(digitsOnly))
        ) {
          return person.id;
        }

        // Check additional phones
        const additional = phones.additionalPhones || [];

        for (const extra of additional) {
          const extraDigits = (extra.number || '').replace(/\D/g, '');
          const extraCalling = (extra.callingCode || '').replace(/\D/g, '');
          const fullExtra = extraCalling + extraDigits;

          if (
            extraDigits &&
            (digitsOnly === fullExtra ||
              digitsOnly.endsWith(extraDigits) ||
              fullExtra.endsWith(digitsOnly))
          ) {
            return person.id;
          }
        }
      }

      return null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to find person by phone ${phoneNumber}: ${errorMessage}`,
      );

      return null;
    }
  }

  async createTimelineNote(
    personId: string,
    title: string,
    body: string,
  ): Promise<string | null> {
    const workspaceId = await this.getWorkspaceId();

    if (!workspaceId) return null;

    try {
      const noteRepository = await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        NoteWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );

      const noteTargetRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          NoteTargetWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      // Create the note with rich text body
      const noteInsert = await noteRepository.insert({
        title,
        bodyV2: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: body }],
            },
          ],
        },
        position: 0,
      } as any);

      const noteId = noteInsert.identifiers[0]?.id;

      if (!noteId) {
        this.logger.error('Failed to create note: no ID returned');

        return null;
      }

      // Link the note to the person
      await noteTargetRepository.insert({
        noteId,
        targetPersonId: personId,
      } as any);

      this.logger.log(
        `Created timeline note "${title}" for person ${personId}`,
      );

      return noteId;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to create timeline note: ${errorMessage}`);

      return null;
    }
  }

  // Create a timeline entry for a completed call
  async logCallToTimeline(record: CallRecord): Promise<void> {
    const isIncoming =
      record.direction === 'incoming' || record.direction === 'inbound';
    const contactPhone = isIncoming ? record.from : record.to;

    if (!contactPhone) return;

    const personId = await this.findPersonByPhone(contactPhone);

    if (!personId) {
      this.logger.log(
        `No person found for phone ${contactPhone}, skipping timeline`,
      );

      return;
    }

    const durationSec = record.durationMs
      ? Math.round(record.durationMs / 1000)
      : 0;
    const durationStr =
      durationSec > 0
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : 'N/A';

    const directionIcon = isIncoming ? '📥' : '📤';
    const title = `${directionIcon} Phone Call (${durationStr})`;

    let body = `Direction: ${record.direction}\nDuration: ${durationStr}\n`;
    body += `From: ${record.from}\nTo: ${record.to}\n`;
    body += `Time: ${new Date(record.startTime).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}`;

    if (record.recordingUrl) {
      body += `\n\n🎙️ Recording: ${record.recordingUrl}`;
    }

    if (record.transcription) {
      body += `\n\n📝 Transcription:\n${record.transcription}`;
    }

    await this.createTimelineNote(personId, title, body);
  }

  // Create a timeline entry for an SMS
  async logSmsToTimeline(smsRecord: SmsRecord): Promise<void> {
    const contactPhone =
      smsRecord.direction === 'inbound' ? smsRecord.from : smsRecord.to;

    if (!contactPhone) return;

    const personId = await this.findPersonByPhone(contactPhone);

    if (!personId) {
      this.logger.log(
        `No person found for phone ${contactPhone}, skipping SMS timeline`,
      );

      return;
    }

    const directionIcon = smsRecord.direction === 'inbound' ? '📥' : '📤';
    const title = `${directionIcon} SMS ${smsRecord.direction === 'inbound' ? 'Received' : 'Sent'}`;
    const time = new Date(smsRecord.timestamp).toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
    });

    const body = `${smsRecord.direction === 'inbound' ? 'From' : 'To'}: ${contactPhone}\nTime: ${time}\n\n${smsRecord.text}`;

    await this.createTimelineNote(personId, title, body);
  }
}
