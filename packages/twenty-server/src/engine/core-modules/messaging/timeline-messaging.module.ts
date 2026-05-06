import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailReplyService } from 'src/engine/core-modules/messaging/services/email-reply.service';
import { EmailSendService } from 'src/engine/core-modules/messaging/services/email-send.service';
import { GetMessagesService } from 'src/engine/core-modules/messaging/services/get-messages.service';
import { TimelineMessagingService } from 'src/engine/core-modules/messaging/services/timeline-messaging.service';
import { TimelineMessagingResolver } from 'src/engine/core-modules/messaging/timeline-messaging.resolver';
import { UserModule } from 'src/engine/core-modules/user/user.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';
import { ConnectedAccountModule } from 'src/modules/connected-account/connected-account.module';
import { OAuth2ClientManagerModule } from 'src/modules/connected-account/oauth2-client-manager/oauth2-client-manager.module';
import { FeatureFlagModule } from 'src/engine/core-modules/feature-flag/feature-flag.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceEntity]),
    WorkspaceDataSourceModule,
    UserModule,
    ConnectedAccountModule,
    OAuth2ClientManagerModule,
    FeatureFlagModule,
    PermissionsModule,
  ],
  exports: [EmailSendService],
  providers: [
    TimelineMessagingResolver,
    TimelineMessagingService,
    GetMessagesService,
    EmailReplyService,
    EmailSendService,
  ],
})
export class TimelineMessagingModule {}
