import { Injectable, Logger } from '@nestjs/common';

import { ConnectedAccountProvider } from 'twenty-shared/types';

import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import { OAuth2ClientManagerService } from 'src/modules/connected-account/oauth2-client-manager/services/oauth2-client-manager.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

@Injectable()
export class EmailSendService {
  private readonly logger = new Logger(EmailSendService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly oAuth2ClientManagerService: OAuth2ClientManagerService,
  ) {}

  public async sendNewEmail({
    to,
    subject,
    body,
    workspaceId,
    workspaceMemberId,
  }: {
    to: string;
    subject: string;
    body: string;
    workspaceId: string;
    workspaceMemberId: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const accountRepository =
          await this.globalWorkspaceOrmManager.getRepository<ConnectedAccountWorkspaceEntity>(
            workspaceId,
            'connectedAccount',
          );

        const account = await accountRepository
          .createQueryBuilder('account')
          .where('account.accountOwnerId = :workspaceMemberId', {
            workspaceMemberId,
          })
          .andWhere('account.provider = :provider', {
            provider: ConnectedAccountProvider.MICROSOFT,
          })
          .getOne();

        if (!account) {
          return {
            ok: false,
            error:
              'No Microsoft account connected. Connect one in Settings → Integrations.',
          };
        }

        try {
          const client =
            await this.oAuth2ClientManagerService.getMicrosoftOAuth2Client(
              account,
            );

          await client.api('/me/sendMail').post({
            message: {
              subject,
              body: { contentType: 'Text', content: body },
              toRecipients: [{ emailAddress: { address: to } }],
            },
            saveToSentItems: true,
          });

          this.logger.log(`Email sent to ${to}`);

          return { ok: true };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';

          this.logger.error(`Failed to send email to ${to}: ${message}`);

          return { ok: false, error: message };
        }
      },
      authContext,
    );
  }
}
