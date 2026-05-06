import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailModule } from 'src/engine/core-modules/email/email.module';
import { MessageQueueModule } from 'src/engine/core-modules/message-queue/message-queue.module';
import { TimelineMessagingModule } from 'src/engine/core-modules/messaging/timeline-messaging.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { TwentyORMModule } from 'src/engine/twenty-orm/twenty-orm.module';

import {
  TelnyxCallRecordsController,
  TelnyxSmsRecordsController,
} from './telnyx-call-records.controller';
import { TelnyxWebhookController } from './telnyx-webhook.controller';
import { TelnyxWebhookService } from './telnyx-webhook.service';

@Module({
  imports: [
    EmailModule.forRoot(),
    TwentyORMModule,
    TimelineMessagingModule,
    TypeOrmModule.forFeature([WorkspaceEntity]),
    MessageQueueModule,
  ],
  controllers: [
    TelnyxWebhookController,
    TelnyxCallRecordsController,
    TelnyxSmsRecordsController,
  ],
  providers: [TelnyxWebhookService],
  exports: [TelnyxWebhookService],
})
export class TelnyxWebhookModule {}
