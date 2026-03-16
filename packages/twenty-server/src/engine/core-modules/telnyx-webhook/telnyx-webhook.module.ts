import { Module } from '@nestjs/common';

import { EmailModule } from 'src/engine/core-modules/email/email.module';
import { TwentyORMModule } from 'src/engine/twenty-orm/twenty-orm.module';

import {
  TelnyxCallRecordsController,
  TelnyxSmsRecordsController,
} from './telnyx-call-records.controller';
import { TelnyxWebhookController } from './telnyx-webhook.controller';
import { TelnyxWebhookService } from './telnyx-webhook.service';

@Module({
  imports: [EmailModule.forRoot(), TwentyORMModule],
  controllers: [
    TelnyxWebhookController,
    TelnyxCallRecordsController,
    TelnyxSmsRecordsController,
  ],
  providers: [TelnyxWebhookService],
  exports: [TelnyxWebhookService],
})
export class TelnyxWebhookModule {}
