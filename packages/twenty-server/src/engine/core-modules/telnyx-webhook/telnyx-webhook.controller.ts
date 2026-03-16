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

// Owner phone number to forward inbound calls to
const OWNER_PHONE_NUMBER = '+15148947978';

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

    // For inbound calls, answer + play IVR greeting + transfer to owner
    if (
      eventType === 'call.initiated' &&
      direction === 'incoming' &&
      callControlId &&
      telnyxApiKey
    ) {
      try {
        // Answer the call
        await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${telnyxApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          },
        );

        this.logger.log(`Answered inbound call ${callControlId}`);
      } catch (error) {
        this.logger.error(`Failed to answer call: ${error}`);
      }

      return;
    }

    // After inbound call is answered, play IVR greeting then transfer
    // Only play IVR for incoming calls — outbound calls should not get a greeting
    if (
      eventType === 'call.answered' &&
      direction === 'incoming' &&
      callControlId &&
      telnyxApiKey
    ) {
      try {
        // Play IVR greeting
        await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${telnyxApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              payload:
                'Thank you for calling Impression Photography. Please hold while we connect you.',
              voice: 'female',
              language: 'en-US',
            }),
          },
        );

        this.logger.log(`Playing IVR greeting on call ${callControlId}`);
      } catch (error) {
        this.logger.error(`Failed to play greeting: ${error}`);
      }

      return;
    }

    // After greeting finishes, transfer to owner's phone
    if (eventType === 'call.speak.ended' && callControlId && telnyxApiKey) {
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
            }),
          },
        );

        this.logger.log(`Transferring call to ${OWNER_PHONE_NUMBER}`);
      } catch (error) {
        this.logger.error(`Failed to transfer call: ${error}`);
      }

      return;
    }

    // Track all other call lifecycle events (recording, hangup, etc.)
    try {
      await this.telnyxWebhookService.handleVoiceEvent(body);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Telnyx voice webhook error: ${errorMessage}`);
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
