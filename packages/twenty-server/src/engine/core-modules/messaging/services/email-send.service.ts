import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { ConnectedAccountProvider } from 'twenty-shared/types';

import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import { OAuth2ClientManagerService } from 'src/modules/connected-account/oauth2-client-manager/services/oauth2-client-manager.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  getSignatureForRecipient,
  hasSignaturePlaceholder,
  replaceSignaturePlaceholder,
  stripSignatureHtml,
} from 'src/engine/core-modules/tool/tools/email-tool/utils/resolve-signature-placeholder.util';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const plainTextToHtml = (text: string): string =>
  escapeHtml(text).replace(/\r?\n/g, '<br/>');

@Injectable()
export class EmailSendService {
  private readonly logger = new Logger(EmailSendService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly oAuth2ClientManagerService: OAuth2ClientManagerService,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
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

          // If the body uses {{signature}}, look up the recipient's niche
          // signature and send as HTML (so the formatting renders).
          // Otherwise, fall through to plain-text send unchanged.
          let messageBody: { contentType: 'Text' | 'HTML'; content: string } = {
            contentType: 'Text',
            content: body,
          };

          if (hasSignaturePlaceholder(body)) {
            const signatureHtml = await getSignatureForRecipient({
              primaryRecipientEmail: to,
              workspaceId,
              globalWorkspaceOrmManager: this.globalWorkspaceOrmManager,
              logger: this.logger,
            });
            const replacementText = signatureHtml
              ? stripSignatureHtml(signatureHtml)
              : '';

            if (signatureHtml) {
              const htmlBody = replaceSignaturePlaceholder(
                plainTextToHtml(body),
                signatureHtml,
              );

              messageBody = { contentType: 'HTML', content: htmlBody };
            } else {
              // No matching signature — strip the placeholder so it doesn't
              // appear literally in the sent message.
              messageBody = {
                contentType: 'Text',
                content: replaceSignaturePlaceholder(body, replacementText),
              };
            }
          }

          await client.api('/me/sendMail').post({
            message: {
              subject,
              body: messageBody,
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

  // Send via any active Microsoft account in any workspace. Used by the
  // Telnyx SMS-to-email forwarder, which has no user/workspace context
  // (the webhook is unauthenticated). For single-tenant deployments this
  // is the right behavior: the alert goes to the workspace's connected
  // mailbox no matter who is logged in.
  public async sendViaAnyMicrosoftAccount({
    to,
    subject,
    bodyText,
    bodyHtml,
  }: {
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const workspace = await this.workspaceRepository.findOne({ where: {} });

    if (!workspace) {
      return { ok: false, error: 'No workspace found' };
    }

    const authContext = buildSystemAuthContext(workspace.id);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const accountRepository =
          await this.globalWorkspaceOrmManager.getRepository<ConnectedAccountWorkspaceEntity>(
            workspace.id,
            'connectedAccount',
          );

        const account = await accountRepository
          .createQueryBuilder('account')
          .where('account.provider = :provider', {
            provider: ConnectedAccountProvider.MICROSOFT,
          })
          .getOne();

        if (!account) {
          return {
            ok: false,
            error: 'No Microsoft account connected in any workspace',
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
              body: bodyHtml
                ? { contentType: 'HTML', content: bodyHtml }
                : { contentType: 'Text', content: bodyText },
              toRecipients: [{ emailAddress: { address: to } }],
            },
            saveToSentItems: true,
          });

          this.logger.log(`Email (system) sent to ${to}`);

          return { ok: true };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';

          this.logger.error(
            `Failed to send (system) email to ${to}: ${message}`,
          );

          return { ok: false, error: message };
        }
      },
      authContext,
    );
  }
}
