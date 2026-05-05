import { useCallback, useEffect, useState } from 'react';

import { fetchAllThreadMessagesOperationSignatureFactory } from '@/activities/emails/graphql/operation-signatures/factories/fetchAllThreadMessagesOperationSignatureFactory';
import { type EmailThread } from '@/activities/emails/types/EmailThread';
import { type EmailThreadMessage } from '@/activities/emails/types/EmailThreadMessage';
import { type EmailThreadMessageParticipant } from '@/activities/emails/types/EmailThreadMessageParticipant';
import { type EmailThreadMessageWithSender } from '@/activities/emails/types/EmailThreadMessageWithSender';
import { type MessageChannelMessageAssociation } from '@/activities/emails/types/MessageChannelMessageAssociation';

import { type MessageChannel } from '@/accounts/types/MessageChannel';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useUpsertRecordsInStore } from '@/object-record/record-store/hooks/useUpsertRecordsInStore';
import {
  CoreObjectNameSingular,
  MessageParticipantRole,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

export const useInboxThread = (threadId: string | null) => {
  const { upsertRecordsInStore } = useUpsertRecordsInStore();
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);
  const [lastMessageChannelId, setLastMessageChannelId] = useState<
    string | null
  >(null);
  const [isMessagesFetchComplete, setIsMessagesFetchComplete] = useState(false);

  const { record: thread } = useFindOneRecord<EmailThread>({
    objectNameSingular: CoreObjectNameSingular.MessageThread,
    objectRecordId: threadId ?? '',
    recordGqlFields: { id: true },
    onCompleted: (record) => {
      upsertRecordsInStore({ partialRecords: [record] });
    },
  });

  const messagesSignature = fetchAllThreadMessagesOperationSignatureFactory({
    messageThreadId: threadId,
  });

  const {
    records: messages,
    loading: messagesLoading,
    fetchMoreRecords,
    hasNextPage,
  } = useFindManyRecords<EmailThreadMessage>({
    limit: messagesSignature.variables.limit,
    filter: messagesSignature.variables.filter,
    objectNameSingular: messagesSignature.objectNameSingular,
    orderBy: messagesSignature.variables.orderBy,
    recordGqlFields: messagesSignature.fields,
    skip: !threadId,
  });

  const fetchMoreMessages = useCallback(() => {
    if (!messagesLoading && hasNextPage) {
      fetchMoreRecords();
    } else if (!hasNextPage) {
      setIsMessagesFetchComplete(true);
    }
  }, [fetchMoreRecords, messagesLoading, hasNextPage]);

  useEffect(() => {
    if (messages.length > 0 && isMessagesFetchComplete) {
      setLastMessageId(messages[messages.length - 1].id);
    }
  }, [messages, isMessagesFetchComplete]);

  const { records: messageSenders } =
    useFindManyRecords<EmailThreadMessageParticipant>({
      filter: {
        messageId: { in: messages.map(({ id }) => id) },
        role: { eq: MessageParticipantRole.FROM },
      },
      objectNameSingular: CoreObjectNameSingular.MessageParticipant,
      recordGqlFields: {
        id: true,
        role: true,
        displayName: true,
        messageId: true,
        handle: true,
        person: true,
        workspaceMember: true,
      },
      skip: messages.length === 0,
    });

  const { records: associationData } =
    useFindManyRecords<MessageChannelMessageAssociation>({
      filter: { messageId: { eq: lastMessageId ?? '' } },
      objectNameSingular:
        CoreObjectNameSingular.MessageChannelMessageAssociation,
      recordGqlFields: {
        id: true,
        messageId: true,
        messageChannelId: true,
        messageThreadExternalId: true,
        messageExternalId: true,
      },
      skip: !lastMessageId || !isMessagesFetchComplete,
    });

  useEffect(() => {
    if (associationData.length > 0) {
      setLastMessageChannelId(associationData[0].messageChannelId);
    }
  }, [associationData]);

  const { records: channelData, loading: messageChannelLoading } =
    useFindManyRecords<MessageChannel>({
      filter: { id: { eq: lastMessageChannelId ?? '' } },
      objectNameSingular: CoreObjectNameSingular.MessageChannel,
      recordGqlFields: {
        id: true,
        handle: true,
        connectedAccount: {
          id: true,
          provider: true,
          connectionParameters: true,
        },
      },
      skip: !lastMessageChannelId,
    });

  const messageThreadExternalId =
    associationData.length > 0 ? associationData[0].messageThreadExternalId : null;
  const lastMessageExternalId =
    associationData.length > 0 ? associationData[0].messageExternalId : null;
  const connectedAccountHandle =
    channelData.length > 0 ? channelData[0].handle : null;
  const connectedAccount =
    channelData.length > 0 ? channelData[0]?.connectedAccount : null;

  const messagesWithSender: EmailThreadMessageWithSender[] = messages
    .map((message) => {
      const sender = messageSenders.find((s) => s.messageId === message.id);
      if (!sender) return null;
      return { ...message, sender };
    })
    .filter(isDefined);

  return {
    thread,
    messages: messagesWithSender,
    messageThreadExternalId,
    connectedAccountHandle,
    connectedAccountProvider: connectedAccount?.provider ?? null,
    connectedAccountConnectionParameters: connectedAccount?.connectionParameters,
    threadLoading: messagesLoading,
    messageChannelLoading,
    lastMessageExternalId,
    fetchMoreMessages,
  };
};
