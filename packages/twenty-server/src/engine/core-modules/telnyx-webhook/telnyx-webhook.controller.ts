import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';

import { type Response } from 'express';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

import { TelnyxWebhookService } from './telnyx-webhook.service';

// Inbound call routing
// Sequential ring: try SIP (WebRTC dialer in CRM) first, fall back to owner cell.
// Both are env-overridable so they can be changed without a redeploy.
const OWNER_PHONE_NUMBER = process.env['OWNER_PHONE_NUMBER'] || '+15148947978';
const SIP_RING_USERNAME =
  process.env['TELNYX_SIP_RING_USERNAME'] || 'usermoshe40552';
const SIP_RING_URI = `sip:${SIP_RING_USERNAME}@sip.telnyx.com`;
const SIP_RING_TIMEOUT_SECS = parseInt(
  process.env['TELNYX_SIP_RING_TIMEOUT_SECS'] || '15',
  10,
);

type TelnyxWebhookBody = {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    payload?: Record<string, unknown>;
    record_type?: string;
  };
  meta?: {
    attempt?: number;
    delivered_to?: string;
  };
};

// Telnyx echoes whatever base64 client_state we set on a previous action
// back to us in subsequent events for that call. We use it to tag legs by
// stage (inbound_answered, sip_ring, cell_ring) so handlers don't trip on
// outbound calls (WebRTC dialing) that share the same webhook URL.
const decodeClientStateStage = (
  clientStateB64: string | undefined,
): string | undefined => {
  if (!clientStateB64) return undefined;

  try {
    const decoded = JSON.parse(
      Buffer.from(clientStateB64, 'base64').toString('utf-8'),
    );

    return decoded?.stage;
  } catch {
    return undefined;
  }
};

@Controller('telnyx')
export class TelnyxWebhookController {
  protected readonly logger = new Logger(TelnyxWebhookController.name);

  constructor(private readonly telnyxWebhookService: TelnyxWebhookService) {}

  // Generate a JWT token for WebRTC browser calling
  @Get('webrtc-token')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async getWebrtcToken(@Res() res: Response) {
    const telnyxApiKey = process.env['TELNYX_API_KEY'];
    const credentialId = process.env['TELNYX_CREDENTIAL_ID'];

    if (!telnyxApiKey || !credentialId) {
      this.logger.warn(
        'WebRTC token: TELNYX_API_KEY or TELNYX_CREDENTIAL_ID not set',
      );
      res.json({ token: null });

      return;
    }

    try {
      // Generate a JWT token from the Telnyx telephony credential
      const tokenResponse = await fetch(
        `https://api.telnyx.com/v2/telephony_credentials/${credentialId}/token`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${telnyxApiKey}`,
          },
        },
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();

        this.logger.error(`Failed to generate WebRTC token: ${errorText}`);
        res.json({ token: null });

        return;
      }

      const token = await tokenResponse.text();

      this.logger.log('Generated WebRTC JWT token');
      res.json({ token });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`WebRTC token error: ${errorMessage}`);
      res.json({ token: null });
    }
  }

  // Voice webhook handles Call Control events from Telnyx credential connection
  @Post('voice')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async handleVoiceWebhook(
    @Body() body: TelnyxWebhookBody,
    @Res() res: Response,
  ) {
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload as Record<string, unknown>;

    this.logger.log(`Telnyx voice webhook: ${eventType}`);

    // Always respond 200 quickly to avoid webhook retries
    res.status(200).json({ status: 'ok' });

    const callControlId = payload?.call_control_id as string | undefined;
    const direction = payload?.direction as string | undefined;
    const telnyxApiKey = process.env['TELNYX_API_KEY'];

    // For inbound calls, answer IMMEDIATELY (before DB work) so the caller's
    // carrier doesn't hang up waiting for media. Telnyx now generates a
    // ringback tone server-side, but we still want answer-time minimal.
    // We pass a client_state tag so when call.answered fires later we can
    // tell *we* answered this leg (vs a Telnyx-internal answer for outbound
    // WebRTC calls that share this webhook).
    if (
      eventType === 'call.initiated' &&
      direction === 'incoming' &&
      callControlId &&
      telnyxApiKey
    ) {
      // Fire-and-forget answer — don't await the round-trip
      void fetch(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${telnyxApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_state: Buffer.from(
              JSON.stringify({ stage: 'inbound_answered' }),
            ).toString('base64'),
          }),
        },
      )
        .then((r) => {
          if (!r.ok) {
            r.text().then((t) =>
              this.logger.warn(
                `Answer API returned ${r.status}: ${t} for ${callControlId}`,
              ),
            );
          } else {
            this.logger.log(`Answered inbound call ${callControlId}`);
          }
        })
        .catch((err) => this.logger.error(`Failed to answer call: ${err}`));

      // Track the event in the DB asynchronously — don't block the answer.
      this.telnyxWebhookService
        .handleVoiceEvent(body)
        .catch((err) =>
          this.logger.error(
            `Error tracking call.initiated: ${err instanceof Error ? err.message : err}`,
          ),
        );

      return;
    }

    // For all other events, track in DB synchronously (preserves ordering for
    // call records / timeline writes that depend on call.initiated arriving first)
    try {
      await this.telnyxWebhookService.handleVoiceEvent(body);
    } catch (error) {
      const serviceError =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Error tracking call event ${eventType}: ${serviceError}`,
      );
    }

    // Diagnostic: surface hangup details so we can debug carrier-side drops
    if (eventType === 'call.hangup') {
      const hangupCause = payload?.hangup_cause as string | undefined;
      const hangupSource = payload?.hangup_source as string | undefined;

      this.logger.log(
        `Hangup detail — cause: ${hangupCause ?? 'unknown'}, source: ${hangupSource ?? 'unknown'}`,
      );
    }

    // After inbound call is answered, ring the CRM WebRTC dialer first (SIP
    // credential). If nobody picks up there in SIP_RING_TIMEOUT_SECS,
    // transfer.failed fires and we fall back to the owner cell below.
    // We identify "our" inbound legs by the client_state tag we set on
    // answer — the `direction` field on call.answered events is not always
    // populated reliably across Telnyx connection types.
    const answeredStage = decodeClientStateStage(
      payload?.client_state as string | undefined,
    );

    if (
      eventType === 'call.answered' &&
      answeredStage === 'inbound_answered' &&
      callControlId &&
      telnyxApiKey
    ) {
      try {
        const transferResp = await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${telnyxApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: SIP_RING_URI,
              timeout_secs: SIP_RING_TIMEOUT_SECS,
              // Mark this leg so when the SIP transfer fails we know to fall
              // back to cell — Telnyx echoes client_state in subsequent events.
              client_state: Buffer.from(
                JSON.stringify({ stage: 'sip_ring' }),
              ).toString('base64'),
            }),
          },
        );

        if (!transferResp.ok) {
          const errBody = await transferResp.text();

          this.logger.warn(
            `SIP transfer failed (${transferResp.status}): ${errBody} — falling back to cell`,
          );
          await this.transferToCell(callControlId, telnyxApiKey);
        } else {
          this.logger.log(
            `Ringing CRM dialer (${SIP_RING_URI}) for ${SIP_RING_TIMEOUT_SECS}s`,
          );
        }
      } catch (error) {
        this.logger.error(`Failed to ring SIP: ${error}`);
        await this.transferToCell(callControlId, telnyxApiKey);
      }

      return;
    }

    // SIP ring timed out / SIP client offline → transfer to owner cell.
    // Telnyx fires `call.transfer.failed` with the original transfer's metadata.
    if (eventType === 'call.transfer.failed' && callControlId && telnyxApiKey) {
      const stage = decodeClientStateStage(
        payload?.client_state as string | undefined,
      );

      if (stage === 'sip_ring') {
        this.logger.log(
          `CRM dialer did not answer — transferring to cell ${OWNER_PHONE_NUMBER}`,
        );
        await this.transferToCell(callControlId, telnyxApiKey);
      } else {
        this.logger.warn(
          `Transfer failed at unknown stage (${stage}) — letting call drop`,
        );
      }

      return;
    }

    // All other events already handled by handleVoiceEvent above
    this.logger.log(`Voice event ${eventType} processed`);
  }

  // Fallback: transfer the call to the owner cell. Used when SIP ringing
  // fails (CRM not open) or times out (nobody picked up in 15s).
  private async transferToCell(
    callControlId: string,
    telnyxApiKey: string,
  ): Promise<void> {
    try {
      await fetch(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${telnyxApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: OWNER_PHONE_NUMBER,
            client_state: Buffer.from(
              JSON.stringify({ stage: 'cell_ring' }),
            ).toString('base64'),
          }),
        },
      );
      this.logger.log(`Transferred call to cell ${OWNER_PHONE_NUMBER}`);
    } catch (error) {
      this.logger.error(`Failed to transfer to cell: ${error}`);
    }
  }

  // SMS webhook handles inbound messages (forwarding + AI auto-reply)
  @Post('sms')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async handleSmsWebhook(
    @Body() body: TelnyxWebhookBody,
    @Res() res: Response,
  ) {
    const eventType = body?.data?.event_type;

    this.logger.log(`Telnyx SMS webhook: ${eventType}`);

    try {
      await this.telnyxWebhookService.handleSmsEvent(body);
      res.status(200).json({ status: 'ok' }).end();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Telnyx SMS webhook error: ${errorMessage}`);
      res.status(200).json({ status: 'error', message: errorMessage }).end();
    }
  }

  // Outbound SMS send endpoint — called from the CRM frontend
  @Post('sms/send')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async sendOutboundSms(
    @Body() body: { to: string; text: string },
    @Res() res: Response,
  ): Promise<void> {
    const { to, text } = body;

    if (!to || !text) {
      res.status(400).json({ error: 'to and text are required' });

      return;
    }

    const telnyxApiKey = process.env['TELNYX_API_KEY'];
    const telnyxFromNumber = process.env['TELNYX_FROM_NUMBER'];
    const messagingProfileId = process.env['TELNYX_MESSAGING_PROFILE_ID'];

    if (!telnyxApiKey || !telnyxFromNumber) {
      res
        .status(503)
        .json({ error: 'Telnyx credentials not configured on server' });

      return;
    }

    const messageBody: Record<string, string> = {
      from: telnyxFromNumber,
      to,
      text,
    };

    if (messagingProfileId) {
      messageBody['messaging_profile_id'] = messagingProfileId;
    }

    try {
      const response = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();

        this.logger.error(
          `Telnyx outbound SMS failed: ${response.status} ${errorBody}`,
        );
        res.status(502).json({ error: `Telnyx error: ${errorBody}` });

        return;
      }

      this.logger.log(`Outbound SMS sent to ${to}`);
      this.telnyxWebhookService.storeOutboundSms(to, text);
      res.json({ sent: true });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Outbound SMS error: ${errorMessage}`);
      res.status(500).json({ error: errorMessage });
    }
  }

  // Recording status webhook
  @Post('recording-status')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async handleRecordingStatus(
    @Body() body: TelnyxWebhookBody,
    @Res() res: Response,
  ) {
    const eventType = body?.data?.event_type;

    this.logger.log(`Telnyx recording webhook: ${eventType}`);

    try {
      await this.telnyxWebhookService.handleRecordingEvent(body);
      res.status(200).json({ status: 'ok' }).end();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Telnyx recording webhook error: ${errorMessage}`);
      res.status(200).json({ status: 'error', message: errorMessage }).end();
    }
  }
}
