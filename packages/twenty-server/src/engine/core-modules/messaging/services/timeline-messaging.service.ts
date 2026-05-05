import { Injectable } from '@nestjs/common';

import { MessageParticipantRole } from 'twenty-shared/types';
import { In } from 'typeorm';

import { type TimelineThreadDTO } from 'src/engine/core-modules/messaging/dtos/timeline-thread.dto';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { MessageChannelVisibility } from 'src/modules/messaging/common/standard-objects/message-channel.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type MessageThreadWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-thread.workspace-entity';

@Injectable()
export class TimelineMessagingService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  public async getAndCountMessageThreads(
    personIds: string[],
    workspaceId: string,
    offset: number,
    pageSize: number,
  ): Promise<{
    messageThreads: Omit<
      TimelineThreadDTO,
      | 'firstParticipant'
      | 'lastTwoParticipants'
      | 'participantCount'
      | 'read'
      | 'visibility'
    >[];
    totalNumberOfThreads: number;
  }> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageThreadRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageThreadWorkspaceEntity>(
            workspaceId,
            'messageThread',
          );

        const totalNumberOfThreads = await messageThreadRepository
          .createQueryBuilder('messageThread')
          .innerJoin('messageThread.messages', 'messages')
          .innerJoin('messages.messageParticipants', 'messageParticipants')
          .where('messageParticipants.personId IN(:...personIds)', {
            personIds,
          })
          .groupBy('messageThread.id')
          .getCount();

        const threadIdsQuery = await messageThreadRepository
          .createQueryBuilder('messageThread')
          .select('messageThread.id', 'id')
          .addSelect('MAX(messages.receivedAt)', 'max_received_at')
          .innerJoin('messageThread.messages', 'messages')
          .innerJoin('messages.messageParticipants', 'messageParticipants')
          .where('messageParticipants.personId IN (:...personIds)', {
            personIds,
          })
          .groupBy('messageThread.id')
          .orderBy('max_received_at', 'DESC')
          .offset(offset)
          .limit(pageSize)
          .getRawMany();

        const messageThreadIds = threadIdsQuery.map((thread) => thread.id);

        const messageThreads = await messageThreadRepository.find({
          where: {
            id: In(messageThreadIds),
          },
          order: {
            messages: {
              receivedAt: 'DESC',
            },
          },
          relations: ['messages'],
        });

        return {
          messageThreads: messageThreads.map((messageThread) => {
            const lastMessage = messageThread.messages[0];
            const firstMessage =
              messageThread.messages[messageThread.messages.length - 1];

            return {
              id: messageThread.id,
              subject: firstMessage.subject ?? '',
              lastMessageBody: lastMessage.text ?? '',
              lastMessageReceivedAt: lastMessage.receivedAt ?? new Date(),
              numberOfMessagesInThread: messageThread.messages.length,
            };
          }),
          totalNumberOfThreads,
        };
      },
      authContext,
    );
  }

  public async getAndCountAllMessageThreadsForWorkspaceMember(
    workspaceMemberId: string,
    workspaceId: string,
    offset: number,
    pageSize: number,
    folder: 'inbox' | 'sent' = 'inbox',
    search?: string | null,
  ): Promise<{
    messageThreads: Omit<
      TimelineThreadDTO,
      | 'firstParticipant'
      | 'lastTwoParticipants'
      | 'participantCount'
      | 'read'
      | 'visibility'
    >[];
    totalNumberOfThreads: number;
  }> {
    const authContext = buildSystemAuthContext(workspaceId);

    // Map tab → folder name predicate. Sent folder is named "Sent Items"
    // in Microsoft, "Sent Mail" in Gmail; isSentFolder is the reliable flag.
    const folderPredicate =
      folder === 'sent'
        ? '"messageFolder"."isSentFolder" = TRUE'
        : 'LOWER("messageFolder"."name") = \'inbox\'';

    const trimmedSearch = search?.trim();
    const hasSearch = !!trimmedSearch;
    const searchPattern = `%${trimmedSearch ?? ''}%`;

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageThreadRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageThreadWorkspaceEntity>(
            workspaceId,
            'messageThread',
          );

        const buildBaseQuery = (alias = 'messageThread') => {
          const qb = messageThreadRepository
            .createQueryBuilder(alias)
            .innerJoin(`${alias}.messages`, 'messages')
            .innerJoin(
              'messages.messageChannelMessageAssociations',
              'messageChannelMessageAssociation',
            )
            .innerJoin(
              'messageChannelMessageAssociation.messageChannel',
              'messageChannel',
            )
            .innerJoin('messageChannel.connectedAccount', 'connectedAccount')
            .innerJoin(
              'messageChannelMessageAssociation.messageFolders',
              'mcmamf',
            )
            .innerJoin('mcmamf.messageFolder', 'messageFolder')
            .where('connectedAccount.accountOwnerId = :workspaceMemberId', {
              workspaceMemberId,
            })
            .andWhere(folderPredicate);

          if (hasSearch) {
            // Match against thread participants (sender/recipient handles &
            // displayNames) OR message text/subject. The LEFT JOIN may fan
            // out rows but we group by thread.id below so distinct counts
            // are preserved.
            qb.leftJoin(
              'messages.messageParticipants',
              'searchParticipants',
            ).andWhere(
              `(
                "messages"."subject" ILIKE :search
                OR "messages"."text" ILIKE :search
                OR "searchParticipants"."handle" ILIKE :search
                OR "searchParticipants"."displayName" ILIKE :search
              )`,
              { search: searchPattern },
            );
          }

          return qb;
        };

        const totalNumberOfThreads = await buildBaseQuery()
          .groupBy('messageThread.id')
          .getCount();

        const threadIdsQuery = await buildBaseQuery()
          .select('messageThread.id', 'id')
          .addSelect('MAX(messages.receivedAt)', 'max_received_at')
          .groupBy('messageThread.id')
          .orderBy('max_received_at', 'DESC')
          .offset(offset)
          .limit(pageSize)
          .getRawMany();

        const messageThreadIds = threadIdsQuery.map((thread) => thread.id);

        if (messageThreadIds.length === 0) {
          return { messageThreads: [], totalNumberOfThreads };
        }

        const messageThreads = await messageThreadRepository.find({
          where: {
            id: In(messageThreadIds),
          },
          order: {
            messages: {
              receivedAt: 'DESC',
            },
          },
          relations: ['messages'],
        });

        return {
          messageThreads: messageThreads.map((messageThread) => {
            const lastMessage = messageThread.messages[0];
            const firstMessage =
              messageThread.messages[messageThread.messages.length - 1];

            return {
              id: messageThread.id,
              subject: firstMessage.subject ?? '',
              lastMessageBody: lastMessage.text ?? '',
              lastMessageReceivedAt: lastMessage.receivedAt ?? new Date(),
              numberOfMessagesInThread: messageThread.messages.length,
            };
          }),
          totalNumberOfThreads,
        };
      },
      authContext,
    );
  }

  public async getThreadParticipantsByThreadId(
    messageThreadIds: string[],
    workspaceId: string,
    excludeWorkspaceMemberId?: string | null,
  ): Promise<{
    [key: string]: MessageParticipantWorkspaceEntity[];
  }> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageParticipantRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageParticipantWorkspaceEntity>(
            workspaceId,
            'messageParticipant',
          );

        const qb = messageParticipantRepository
          .createQueryBuilder()
          .select('messageParticipant')
          .addSelect('message.messageThreadId')
          .addSelect('message.receivedAt')
          .leftJoinAndSelect('messageParticipant.person', 'person')
          .leftJoinAndSelect(
            'messageParticipant.workspaceMember',
            'workspaceMember',
          )
          .leftJoin('messageParticipant.message', 'message')
          .where('message.messageThreadId = ANY(:messageThreadIds)', {
            messageThreadIds,
          })
          .andWhere('messageParticipant.role = :role', {
            role: MessageParticipantRole.FROM,
          });

        if (excludeWorkspaceMemberId) {
          qb.andWhere(
            '("messageParticipant"."workspaceMemberId" IS NULL OR "messageParticipant"."workspaceMemberId" != :excludeWorkspaceMemberId)',
            { excludeWorkspaceMemberId },
          );
        }

        const threadParticipants = await qb
          .orderBy('message.messageThreadId')
          .distinctOn(['message.messageThreadId', 'messageParticipant.handle'])
          .getMany();

        const orderedThreadParticipants = threadParticipants.sort(
          (a, b) =>
            (a.message.receivedAt ?? new Date()).getTime() -
            (b.message.receivedAt ?? new Date()).getTime(),
        );

        const threadParticipantsWithCompositeFields =
          orderedThreadParticipants.map((threadParticipant) => ({
            ...threadParticipant,
            person: {
              id: threadParticipant.person?.id,
              name: {
                //oxlint-disable-next-line
                //@ts-ignore
                firstName: threadParticipant.person?.nameFirstName,
                //oxlint-disable-next-line
                //@ts-ignore
                lastName: threadParticipant.person?.nameLastName,
              },
              avatarUrl: threadParticipant.person?.avatarUrl,
            },
            workspaceMember: {
              id: threadParticipant.workspaceMember?.id,
              name: {
                //oxlint-disable-next-line
                //@ts-ignore
                firstName: threadParticipant.workspaceMember?.nameFirstName,
                //oxlint-disable-next-line
                //@ts-ignore
                lastName: threadParticipant.workspaceMember?.nameLastName,
              },
              avatarUrl: threadParticipant.workspaceMember?.avatarUrl,
            },
          }));

        return threadParticipantsWithCompositeFields.reduce(
          (threadParticipantsAcc, threadParticipant) => {
            if (!threadParticipant.message.messageThreadId)
              return threadParticipantsAcc;

            if (
              // @ts-expect-error legacy noImplicitAny
              !threadParticipantsAcc[threadParticipant.message.messageThreadId]
            )
              // @ts-expect-error legacy noImplicitAny
              threadParticipantsAcc[threadParticipant.message.messageThreadId] =
                [];

            // @ts-expect-error legacy noImplicitAny
            threadParticipantsAcc[
              threadParticipant.message.messageThreadId
            ].push(threadParticipant);

            return threadParticipantsAcc;
          },
          {},
        );
      },
      authContext,
    );
  }

  public async getThreadVisibilityByThreadId(
    messageThreadIds: string[],
    workspaceMemberId: string,
    workspaceId: string,
  ): Promise<{
    [key: string]: MessageChannelVisibility;
  }> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageThreadRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageThreadWorkspaceEntity>(
            workspaceId,
            'messageThread',
          );

        const threadVisibility = await messageThreadRepository
          .createQueryBuilder()
          .select('messageThread.id', 'id')
          .addSelect('messageChannel.visibility', 'visibility')
          .addSelect('connectedAccount.accountOwnerId', 'accountOwnerId')
          .leftJoin('messageThread.messages', 'message')
          .leftJoin(
            'message.messageChannelMessageAssociations',
            'messageChannelMessageAssociation',
          )
          .leftJoin(
            'messageChannelMessageAssociation.messageChannel',
            'messageChannel',
          )
          .leftJoin('messageChannel.connectedAccount', 'connectedAccount')
          .where('messageThread.id = ANY(:messageThreadIds)', {
            messageThreadIds: messageThreadIds,
          })
          .getRawMany();

        const visibilityValues = Object.values(MessageChannelVisibility);

        const threadVisibilityByThreadId: {
          [key: string]: MessageChannelVisibility;
        } = threadVisibility.reduce((threadVisibilityAcc, threadVisibility) => {
          if (threadVisibility.accountOwnerId === workspaceMemberId) {
            threadVisibilityAcc[threadVisibility.id] =
              MessageChannelVisibility.SHARE_EVERYTHING;

            return threadVisibilityAcc;
          }

          threadVisibilityAcc[threadVisibility.id] =
            visibilityValues[
              Math.max(
                visibilityValues.indexOf(threadVisibility.visibility),
                visibilityValues.indexOf(
                  threadVisibilityAcc[threadVisibility.id] ??
                    MessageChannelVisibility.METADATA,
                ),
              )
            ];

          return threadVisibilityAcc;
        }, {});

        return threadVisibilityByThreadId;
      },
      authContext,
    );
  }
}
