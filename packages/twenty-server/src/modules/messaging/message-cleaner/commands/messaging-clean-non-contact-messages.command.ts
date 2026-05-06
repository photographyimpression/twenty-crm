import { Logger } from '@nestjs/common';

import { Command, CommandRunner, Option } from 'nest-commander';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { addPersonEmailFiltersToQueryBuilder } from 'src/modules/match-participant/utils/add-person-email-filters-to-query-builder';
import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import { type MessageChannelWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { MessagingMessageCleanerService } from 'src/modules/messaging/message-cleaner/services/messaging-message-cleaner.service';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

type Options = {
  workspaceId: string;
  dryRun?: boolean;
};

const BATCH_SIZE = 500;

@Command({
  name: 'messaging:clean-non-contact-messages',
  description:
    'Delete messages whose participants do not match any CRM Person. Use --dry-run to preview.',
})
export class MessagingCleanNonContactMessagesCommand extends CommandRunner {
  private readonly logger = new Logger(
    MessagingCleanNonContactMessagesCommand.name,
  );

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly messageCleanerService: MessagingMessageCleanerService,
  ) {
    super();
  }

  async run(_passedParam: string[], options: Options): Promise<void> {
    const { workspaceId, dryRun = false } = options;
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const messageRepository =
        await this.globalWorkspaceOrmManager.getRepository<MessageWorkspaceEntity>(
          workspaceId,
          'message',
        );
      const messageParticipantRepository =
        await this.globalWorkspaceOrmManager.getRepository<MessageParticipantWorkspaceEntity>(
          workspaceId,
          'messageParticipant',
        );
      const personRepository =
        await this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
          workspaceId,
          'person',
          { shouldBypassPermissionChecks: true },
        );
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
      const messageChannels = await messageChannelRepository.find({});

      const selfHandles = new Set<string>();

      for (const account of connectedAccounts) {
        if (isDefined(account.handle)) {
          selfHandles.add(account.handle.toLowerCase());
        }
        for (const alias of account.handleAliases?.split(',') ?? []) {
          if (alias.trim().length > 0) {
            selfHandles.add(alias.trim().toLowerCase());
          }
        }
      }

      for (const channel of messageChannels) {
        if (isDefined(channel.handle)) {
          selfHandles.add(channel.handle.toLowerCase());
        }
      }

      this.logger.log(
        `Self handles excluded from contact match: ${[...selfHandles].join(', ') || '(none)'}`,
      );

      const totalMessages = await messageRepository.count({});

      this.logger.log(
        `Scanning ${totalMessages} messages in workspace ${workspaceId}${dryRun ? ' (dry run)' : ''}`,
      );

      let scanned = 0;
      let toDeleteCount = 0;
      const messageIdsToDelete: string[] = [];

      while (scanned < totalMessages) {
        const messages = await messageRepository.find({
          select: ['id'],
          order: { id: 'ASC' },
          skip: scanned,
          take: BATCH_SIZE,
        });

        if (messages.length === 0) {
          break;
        }

        const messageIds = messages.map(({ id }) => id);
        const participants = await messageParticipantRepository.find({
          where: { messageId: In(messageIds) },
        });

        const candidateHandles = new Set<string>();

        for (const participant of participants) {
          const handle = participant.handle?.trim().toLowerCase();

          if (
            isDefined(handle) &&
            handle.length > 0 &&
            !selfHandles.has(handle)
          ) {
            candidateHandles.add(handle);
          }
        }

        const matchedHandles = new Set<string>();

        if (candidateHandles.size > 0) {
          const queryBuilder = addPersonEmailFiltersToQueryBuilder({
            queryBuilder: personRepository.createQueryBuilder('person'),
            emails: [...candidateHandles],
          });

          const matchingPeople = await queryBuilder.getMany();

          for (const person of matchingPeople) {
            const primary = person.emails?.primaryEmail?.trim().toLowerCase();

            if (isDefined(primary) && primary.length > 0) {
              matchedHandles.add(primary);
            }
            for (const additional of person.emails?.additionalEmails ?? []) {
              const normalized = additional?.trim().toLowerCase();

              if (isDefined(normalized) && normalized.length > 0) {
                matchedHandles.add(normalized);
              }
            }
          }
        }

        const messageHasContact = new Map<string, boolean>(
          messageIds.map((id) => [id, false]),
        );

        for (const participant of participants) {
          const handle = participant.handle?.trim().toLowerCase();

          if (
            isDefined(handle) &&
            handle.length > 0 &&
            !selfHandles.has(handle) &&
            matchedHandles.has(handle)
          ) {
            messageHasContact.set(participant.messageId, true);
          }
        }

        const droppedInBatch: string[] = [];

        for (const [messageId, hasContact] of messageHasContact.entries()) {
          if (!hasContact) {
            droppedInBatch.push(messageId);
          }
        }

        toDeleteCount += droppedInBatch.length;
        messageIdsToDelete.push(...droppedInBatch);
        scanned += messages.length;

        this.logger.log(
          `Scanned ${scanned}/${totalMessages} — flagged ${toDeleteCount} for deletion`,
        );
      }

      if (toDeleteCount === 0) {
        this.logger.log('No non-contact messages found.');

        return;
      }

      if (dryRun) {
        this.logger.log(
          `Dry run: would delete ${toDeleteCount} messages. Re-run without --dry-run to apply.`,
        );

        return;
      }

      const deletionChunks: string[][] = [];

      for (let i = 0; i < messageIdsToDelete.length; i += BATCH_SIZE) {
        deletionChunks.push(messageIdsToDelete.slice(i, i + BATCH_SIZE));
      }

      let deleted = 0;

      for (const chunk of deletionChunks) {
        await messageRepository.delete(chunk);
        deleted += chunk.length;
        this.logger.log(`Deleted ${deleted}/${toDeleteCount} messages`);
      }

      await this.messageCleanerService.cleanOrphanMessagesAndThreads(
        workspaceId,
      );

      this.logger.log(
        `Done. Deleted ${deleted} non-contact messages and cleaned orphan threads.`,
      );
    }, authContext);
  }

  @Option({
    flags: '-w, --workspace-id <workspace_id>',
    description: 'Workspace ID',
    required: true,
  })
  parseWorkspaceId(value: string): string {
    return value;
  }

  @Option({
    flags: '--dry-run',
    description: 'Report counts without deleting',
    required: false,
  })
  parseDryRun(): boolean {
    return true;
  }
}
