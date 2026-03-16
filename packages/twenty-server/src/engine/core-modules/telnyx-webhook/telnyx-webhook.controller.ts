import {
  Body,
  Controller,
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

  constructor(
    private readonly telnyxWebhookService: TelnyxWebhookService,
  ) {}

  // Voice webhook handles both:
  // 1. Initial inbound call routing (returns TeXML for IVR + forwarding)
  // 2. Call lifecycle events (recording saved, hangup, etc.)
  @Post('voice')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async handleVoiceWebhook(
    @Body() body: TelnyxWebhookBody,
    @Res() res: Response,
  ) {
    const eventType = body?.data?.event_type;

    this.logger.log(`Telnyx voice webhook: ${eventType}`);

    // For call.initiated on inbound calls, respond with TeXML for IVR
    if (
      eventType === 'call.initiated' &&
      (body?.data?.payload as Record<string, unknown>)?.direction === 'incoming'
    ) {
      const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling Impression Photography. Please hold while we connect you.</Say>
  <Dial callerId="${OWNER_PHONE_NUMBER}">
    <Number>${OWNER_PHONE_NUMBER}</Number>
  </Dial>
  <Say voice="alice">We are sorry, no one is available to take your call. Please try again later.</Say>
</Response>`;

      res.set('Content-Type', 'text/xml');
      res.send(texml);

      return;
    }

    // For all other voice events, process asynchronously and return 200
    try {
      await this.telnyxWebhookService.handleVoiceEvent(body);
      res.status(200).json({ status: 'ok' }).end();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Telnyx voice webhook error: ${errorMessage}`);
      res.status(200).json({ status: 'error', message: errorMessage }).end();
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
