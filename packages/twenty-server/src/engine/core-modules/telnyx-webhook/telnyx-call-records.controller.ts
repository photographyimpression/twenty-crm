import {
  Controller,
  Get,
  Logger,
  Param,
  UseGuards,
} from '@nestjs/common';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

import { TelnyxWebhookService } from './telnyx-webhook.service';

@Controller('telnyx/call-records')
export class TelnyxCallRecordsController {
  protected readonly logger = new Logger(TelnyxCallRecordsController.name);

  constructor(
    private readonly telnyxWebhookService: TelnyxWebhookService,
  ) {}

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
}
