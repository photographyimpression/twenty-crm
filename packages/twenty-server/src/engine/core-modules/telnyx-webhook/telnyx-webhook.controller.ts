import {
  Body,
  Controller,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';

import { type Response } from 'express';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

import { TelnyxWebhookService } from './telnyx-webhook.service';

type TelnyxCallPayload = {
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
  recording_urls?: {
    mp3?: string;
    wav?: string;
  };
};

type TelnyxRecordingPayload = {
  call_control_id?: string;
  call_leg_id?: string;
  call_session_id?: string;
  connection_id?: string;
  recording_urls?: {
    mp3?: string;
    wav?: string;
  };
  channels?: string;
  duration_millis?: number;
  from?: string;
  to?: string;
  start_time?: string;
  end_time?: string;
  public_recording_urls?: {
    mp3?: string;
    wav?: string;
  };
};

type TelnyxWebhookBody = {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    payload?: TelnyxCallPayload | TelnyxRecordingPayload;
    record_type?: string;
  };
  meta?: {
    attempt?: number;
    delivered_to?: string;
  };
};

@Controller()
export class TelnyxWebhookController {
  protected readonly logger = new Logger(TelnyxWebhookController.name);

  constructor(
    private readonly telnyxWebhookService: TelnyxWebhookService,
  ) {}

  @Post(['telnyx/voice'])
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async handleVoiceWebhook(
    @Body() body: TelnyxWebhookBody,
    @Res() res: Response,
  ) {
    const eventType = body?.data?.event_type;

    this.logger.log(`Telnyx voice webhook: ${eventType}`);

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

  @Post(['telnyx/sms'])
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

  @Post(['telnyx/recording-status'])
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
