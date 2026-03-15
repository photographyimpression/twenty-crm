import { Module } from '@nestjs/common';

import { TelnyxWebhookController } from 'src/engine/core-modules/telnyx-webhook/telnyx-webhook.controller';
import { TwentyConfigModule } from 'src/engine/core-modules/twenty-config/twenty-config.module';

@Module({
  imports: [TwentyConfigModule],
  controllers: [TelnyxWebhookController],
})
export class TelnyxWebhookModule {}
