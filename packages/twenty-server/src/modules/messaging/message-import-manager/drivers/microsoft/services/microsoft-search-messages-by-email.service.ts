import { Injectable, Logger } from '@nestjs/common';

import { OAuth2ClientManagerService } from 'src/modules/connected-account/oauth2-client-manager/services/oauth2-client-manager.service';
import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';

// Microsoft Graph caps $search responses at 1000 items per query and requires
// ConsistencyLevel: eventual. We scope the search to specific folders so the
// caller can restrict to inbox/sent and avoid sucking in archived clutter
// that would never be visible in the CRM Inbox UI anyway.
const MAX_RESULTS_PER_FOLDER = 999;

@Injectable()
export class MicrosoftSearchMessagesByEmailService {
  private readonly logger = new Logger(
    MicrosoftSearchMessagesByEmailService.name,
  );

  constructor(
    private readonly oAuth2ClientManagerService: OAuth2ClientManagerService,
  ) {}

  public async searchMessageIds({
    connectedAccount,
    email,
    folderExternalIds,
  }: {
    connectedAccount: Pick<
      ConnectedAccountWorkspaceEntity,
      'provider' | 'accessToken' | 'id'
    >;
    email: string;
    folderExternalIds: string[];
  }): Promise<string[]> {
    if (folderExternalIds.length === 0) {
      return [];
    }

    const microsoftClient =
      await this.oAuth2ClientManagerService.getMicrosoftOAuth2Client(
        connectedAccount,
      );

    const sanitizedEmail = email.replace(/"/g, '').trim();

    if (sanitizedEmail.length === 0) {
      return [];
    }

    const ids = new Set<string>();

    for (const folderExternalId of folderExternalIds) {
      try {
        const response = await microsoftClient
          .api(`/me/mailFolders/${folderExternalId}/messages`)
          .version('beta')
          .headers({
            ConsistencyLevel: 'eventual',
            Prefer: `odata.maxpagesize=${MAX_RESULTS_PER_FOLDER}, IdType="ImmutableId"`,
          })
          .query({
            $search: `"${sanitizedEmail}"`,
            $select: 'id',
            $top: MAX_RESULTS_PER_FOLDER,
          })
          .get();

        const value = (response?.value ?? []) as { id?: string }[];

        for (const item of value) {
          if (typeof item.id === 'string' && item.id.length > 0) {
            ids.add(item.id);
          }
        }

        this.logger.log(
          `Account ${connectedAccount.id} folder ${folderExternalId} - found ${value.length} messages mentioning ${sanitizedEmail}`,
        );
      } catch (error) {
        // Don't fail the whole backfill if one folder errors out — log and
        // continue. Most common cause is a folder the user can't read.
        this.logger.warn(
          `Account ${connectedAccount.id} folder ${folderExternalId} - search failed: ${error?.message ?? error}`,
        );
      }
    }

    return [...ids];
  }
}
