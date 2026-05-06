import { Injectable } from '@nestjs/common';

import { ConnectedAccountProvider } from 'twenty-shared/types';

import { OAuth2ClientManagerService } from 'src/modules/connected-account/oauth2-client-manager/services/oauth2-client-manager.service';
import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { type MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageChannelWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel.workspace-entity';

@Injectable()
export class EmailReplyService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly oAuth2ClientManagerService: OAuth2ClientManagerService,
  ) {}

  public async replyToThread({
    threadId,
    body,
    workspaceId,
    workspaceMemberId,
  }: {
    threadId: string;
    body: string;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<{ ok: boolean }> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageWorkspaceEntity>(
            workspaceId,
            'message',
          );

        const lastMessage = await messageRepository
          .createQueryBuilder('message')
          .where('message.messageThreadId = :threadId', { threadId })
          .orderBy('message.receivedAt', 'DESC')
          .getOne();

        if (!lastMessage) {
          throw new Error('No messages in thread');
        }

        const associationRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageChannelMessageAssociationWorkspaceEntity>(
            workspaceId,
            'messageChannelMessageAssociation',
          );

        const associations = await associationRepository
          .createQueryBuilder('mcma')
          .leftJoinAndSelect('mcma.messageChannel', 'messageChannel')
          .leftJoinAndSelect(
            'messageChannel.connectedAccount',
            'connectedAccount',
          )
          .where('mcma.messageId = :messageId', { messageId: lastMessage.id })
          .getMany();

        const ownAssociation = associations.find(
          (a) =>
            a.messageChannel?.connectedAccount?.accountOwnerId ===
            workspaceMemberId,
        );

        const association = ownAssociation ?? associations[0];

        if (!association) {
          throw new Error('No channel association found for thread');
        }

        const messageChannel = association.messageChannel as
          | MessageChannelWorkspaceEntity
          | undefined;
        const connectedAccount = messageChannel?.connectedAccount as
          | ConnectedAccountWorkspaceEntity
          | undefined;

        if (!messageChannel || !connectedAccount) {
          throw new Error('Connected account not found for thread');
        }

        const externalMessageId = association.messageExternalId;

        if (!externalMessageId) {
          throw new Error('Message has no external ID');
        }

        switch (connectedAccount.provider) {
          case ConnectedAccountProvider.MICROSOFT: {
            const client =
              await this.oAuth2ClientManagerService.getMicrosoftOAuth2Client(
                connectedAccount,
              );

            await client
              .api(`/me/messages/${externalMessageId}/reply`)
              .post({ comment: body });

            return { ok: true };
          }
          default:
            throw new Error(
              `Reply not yet supported for provider ${connectedAccount.provider}`,
            );
        }
      },
      authContext,
    );
  }
}
