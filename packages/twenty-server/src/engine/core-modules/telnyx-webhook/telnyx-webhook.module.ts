import { Module } from '@nestjs/common';

import { TelnyxCallRecordsController } from './telnyx-call-records.controller';
import { TelnyxWebhookController } from './telnyx-webhook.controller';
import { TelnyxWebhookService } from './telnyx-webhook.service';

@Module({
  controllers: [TelnyxWebhookController, TelnyxCallRecordsController],
  providers: [TelnyxWebhookService],
  exports: [TelnyxWebhookService],
})
export class TelnyxWebhookModule {}
