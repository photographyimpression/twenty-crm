import { Injectable, Logger } from '@nestjs/common';

import * as fs from 'fs';
import * as path from 'path';

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

const MAX_CALL_RECORDS = 1000;
const STALE_RECORD_HOURS = 72;
const MAX_TRANSCRIPTION_RETRIES = 2;

@Injectable()
export class TelnyxWebhookService {
  private readonly logger = new Logger(TelnyxWebhookService.name);
  private readonly callRecords = new Map<string, CallRecord>();
  private readonly processedEvents = new Set<string>();
  private readonly dataDir: string;

  constructor() {
    this.dataDir = path.join(
      process.env.HOME || '/tmp',
      '.twenty-call-recordings',
    );

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.loadCallRecords();
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
          from: payload.from || '',
          to: payload.to || '',
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

  async handleSmsEvent(body: TelnyxWebhookBody): Promise<void> {
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    if (!eventType || !payload) {
      return;
    }

    this.logger.log(
      `SMS event: ${eventType} from ${payload.from} to ${payload.to}`,
    );

    if (eventType === 'message.received') {
      this.logger.log(`Incoming SMS from ${payload.from}: ${payload.text}`);

      // Forward SMS to email
      await this.forwardSmsToEmail(
        payload.from || '',
        payload.to || '',
        payload.text || '',
      );

      // AI auto-reply
      await this.sendAutoReply(payload.from || '', payload.text || '');
    }
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

    this.logger.log(`Recording saved for session ${sessionId}: ${recordingUrl}`);

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
      const response = await fetch(
        'https://api.telnyx.com/v2/ai/transcribe',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${telnyxApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            audio_url: recordingUrl,
            language: 'en',
          }),
        },
      );

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
      process.env.SMS_FORWARD_EMAIL || 'moshe@impressionphotography.ca';

    this.logger.log(
      `Would forward SMS from ${from} to ${forwardEmail}: ${text}`,
    );
    // Email forwarding implementation would go here
    // using the EmailModule already available in the server
  }

  private async sendAutoReply(from: string, incomingText: string): Promise<void> {
    const telnyxApiKey = process.env.TELNYX_API_KEY;
    const fromNumber = process.env.TELNYX_FROM_NUMBER || '+19344700764';
    const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID;

    if (!telnyxApiKey || !messagingProfileId) {
      this.logger.warn(
        'Missing TELNYX_API_KEY or TELNYX_MESSAGING_PROFILE_ID for auto-reply',
      );

      return;
    }

    const autoReplyText =
      'Thank you for contacting Impression Photography! ' +
      'We have received your message and will get back to you shortly. ' +
      'For immediate assistance, please call us at +1 (934) 470-0764.';

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
}
