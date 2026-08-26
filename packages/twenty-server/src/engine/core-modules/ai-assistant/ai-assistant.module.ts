import { Module } from '@nestjs/common';

import { AiAssistantController } from './ai-assistant.controller';

// LOCAL-PATCH: AI contact-summary panel (see the controller header comment).
@Module({
  imports: [],
  controllers: [AiAssistantController],
  providers: [],
})
export class AiAssistantModule {}
