import { Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import { MessageChannelSyncStatusService } from 'src/modules/messaging/common/services/message-channel-sync-status.service';
import { type MessageChannelWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel.workspace-entity';
import { MicrosoftSearchMessagesByEmailService } from 'src/modules/messaging/message-import-manager/drivers/microsoft/services/microsoft-search-messages-by-email.service';

export type MessagingBackfillForContactJobData = {
  workspaceId: string;
  email: string;
};

@Processor(MessageQueue.messagingQueue)
export class MessagingBackfillForContactJob {
  private readonly logger = new Logger(MessagingBackfillForContactJob.name);

  constructor(
    @InjectCacheStorage(CacheStorageNamespace.ModuleMessaging)
    private readonly cacheStorage: CacheStorageService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly microsoftSearchMessagesByEmailService: MicrosoftSearchMessagesByEmailService,
    private readonly messageChannelSyncStatusService: MessageChannelSyncStatusService,
  ) {}

  @Process(MessagingBackfillForContactJob.name)
  async handle(data: MessagingBackfillForContactJobData): Promise<void> {
    const { workspaceId, email } = data;
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail.length === 0) {
      return;
    }

    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const connectedAccountRepository =
        await this.globalWorkspaceOrmManager.getRepository<ConnectedAccountWorkspaceEntity>(
          workspaceId,
          'connectedAccount',
        );
      const messageChannelRepository =
        await this.globalWorkspaceOrmManager.getRepository<MessageChannelWorkspaceEntity>(
          workspaceId,
          'messageChannel',
        );

      const connectedAccounts = await connectedAccountRepository.find({});

      for (const connectedAccount of connectedAccounts) {
        // Gmail/IMAP backfill not implemented yet; skip silently so the
        // listener stays harmless on workspaces that mix providers.
        if (connectedAccount.provider !== 'microsoft') {
          continue;
        }

        const channels = await messageChannelRepository.find({
          where: { connectedAccountId: connectedAccount.id },
          relations: ['messageFolders'],
        });

        for (const channel of channels) {
          const folderExternalIds = (channel.messageFolders ?? [])
            .filter((folder) => folder.isSynced)
            .map((folder) => folder.externalId)
            .filter(
              (externalId): externalId is string =>
                isDefined(externalId) && externalId.length > 0,
            );

          if (folderExternalIds.length === 0) {
            continue;
          }

          const messageIds =
            await this.microsoftSearchMessagesByEmailService.searchMessageIds({
              connectedAccount,
              email: normalizedEmail,
              folderExternalIds,
            });

          if (messageIds.length === 0) {
            this.logger.log(
              `Workspace ${workspaceId} channel ${channel.id} - no Graph results for ${normalizedEmail}`,
            );
            continue;
          }

          await this.cacheStorage.setAdd(
            `messages-to-import:${workspaceId}:${channel.id}`,
            messageIds,
          );

          await this.messageChannelSyncStatusService.markAsMessagesImportPending(
            [channel.id],
            workspaceId,
          );

          this.logger.log(
            `Workspace ${workspaceId} channel ${channel.id} - queued ${messageIds.length} message(s) for backfill of ${normalizedEmail}`,
          );
        }
      }
    }, authContext);
  }
}
