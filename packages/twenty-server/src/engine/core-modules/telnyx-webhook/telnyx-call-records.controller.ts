import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

import { TelnyxWebhookService } from './telnyx-webhook.service';

@Controller('telnyx/call-records')
export class TelnyxCallRecordsController {
  protected readonly logger = new Logger(TelnyxCallRecordsController.name);

  constructor(private readonly telnyxWebhookService: TelnyxWebhookService) {}

  @Get()
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async getCallRecords() {
    return {
      data: this.telnyxWebhookService.getCallRecords(),
    };
  }

  @Get(':sessionId')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async getCallRecord(@Param('sessionId') sessionId: string) {
    const record = this.telnyxWebhookService.getCallRecord(sessionId);

    if (!record) {
      return { data: null, error: 'Call record not found' };
    }

    return { data: record };
  }

  // The in-CRM dialer's live (mic-side) transcript, posted when the call
  // ends so it can be saved onto the person's timeline note. peerPhone is the
  // number the dialer called — used to match the call record when the WebRTC
  // session id doesn't equal the voice-webhook's session key.
  @Post('transcript')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async saveLiveTranscript(
    @Body()
    body: {
      sessionId?: string;
      transcript?: string;
      peerPhone?: string;
    },
  ) {
    if (!body?.sessionId) {
      return { data: null, error: 'sessionId is required' };
    }

    await this.telnyxWebhookService.saveLiveTranscript(
      body.sessionId,
      body.transcript ?? null,
      body.peerPhone ?? null,
    );

    return { data: 'ok' };
  }
}

@Controller('telnyx/sms-records')
export class TelnyxSmsRecordsController {
  protected readonly logger = new Logger(TelnyxSmsRecordsController.name);

  constructor(private readonly telnyxWebhookService: TelnyxWebhookService) {}

  @Get()
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async getSmsRecords(@Query('contact') contact?: string) {
    return {
      data: this.telnyxWebhookService.getSmsRecords(contact),
    };
  }
}
