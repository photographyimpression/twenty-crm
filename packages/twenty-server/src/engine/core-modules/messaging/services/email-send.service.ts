import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { ConnectedAccountProvider } from 'twenty-shared/types';

import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import { OAuth2ClientManagerService } from 'src/modules/connected-account/oauth2-client-manager/services/oauth2-client-manager.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { resolveSignaturePlaceholder } from 'src/engine/core-modules/tool/tools/email-tool/utils/resolve-signature-placeholder.util';
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

          // Auto-attach the recipient's niche signature (if any). The
          // composer body comes in as plain text; we promote to HTML only
          // when a signature is actually attached, otherwise we keep plain
          // text so the message looks natural in the recipient's client.
          const {
            html: htmlWithSignature,
            plainText: plainWithSignature,
            signatureAttached,
          } = await resolveSignaturePlaceholder({
            html: plainTextToHtml(body),
            plainText: body,
            primaryRecipientEmail: to,
            workspaceId,
            globalWorkspaceOrmManager: this.globalWorkspaceOrmManager,
            logger: this.logger,
          });

          const messageBody: { contentType: 'Text' | 'HTML'; content: string } =
            signatureAttached
              ? { contentType: 'HTML', content: htmlWithSignature }
              : { contentType: 'Text', content: plainWithSignature };

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
  //
  // `replyTo` sets a single Reply-To address (used by the SMS bridge to
  // route Outlook replies back through Postfix + Telnyx).
  // `headers` adds custom RFC 822 headers — Microsoft Graph only accepts
  // headers prefixed with `x-` or `X-`, so callers needing Message-ID /
  // In-Reply-To / References should pass them via `headers` with `X-`
  // prefixes (we emit duplicates as standard headers via the SMTP
  // fallback path). NB: Graph does NOT let you override Message-ID; it
  // generates its own per-send. Threading is preserved through
  // In-Reply-To/References, which Outlook honors for thread grouping.
  public async sendViaAnyMicrosoftAccount({
    to,
    subject,
    bodyText,
    bodyHtml,
    replyTo,
    headers,
  }: {
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    replyTo?: string;
    headers?: Record<string, string>;
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

          // Microsoft Graph rejects internetMessageHeaders that don't
          // start with `x-` (case-insensitive). Drop anything else with
          // a log line so the caller knows.
          const internetMessageHeaders = headers
            ? Object.entries(headers)
                .filter(([name]) => {
                  if (/^x-/i.test(name)) return true;
                  this.logger.warn(
                    `Graph drops non-X header "${name}" — use SMTP for it`,
                  );

                  return false;
                })
                .map(([name, value]) => ({ name, value }))
            : undefined;

          const message: Record<string, unknown> = {
            subject,
            body: bodyHtml
              ? { contentType: 'HTML', content: bodyHtml }
              : { contentType: 'Text', content: bodyText },
            toRecipients: [{ emailAddress: { address: to } }],
          };

          if (replyTo) {
            message.replyTo = [{ emailAddress: { address: replyTo } }];
          }

          if (internetMessageHeaders && internetMessageHeaders.length > 0) {
            message.internetMessageHeaders = internetMessageHeaders;
          }

          await client.api('/me/sendMail').post({
            message,
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
