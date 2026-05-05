import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useMemo } from 'react';

import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { EmailLoader } from '@/activities/emails/components/EmailLoader';
import { EmailThreadHeader } from '@/activities/emails/components/EmailThreadHeader';
import { EmailThreadMessage } from '@/activities/emails/components/EmailThreadMessage';
import { useInboxThread } from '@/activities/emails/hooks/useInboxThread';

import { ConnectedAccountProvider } from 'twenty-shared/types';
import { assertUnreachable, isDefined } from 'twenty-shared/utils';
import { IconArrowBackUp, IconX } from 'twenty-ui/display';
import { Button, LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const ALLOWED_REPLY_PROVIDERS = [
  ConnectedAccountProvider.GOOGLE,
  ConnectedAccountProvider.MICROSOFT,
  ConnectedAccountProvider.IMAP_SMTP_CALDAV,
];

const StyledWrapper = styled.div`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  width: 100%;
`;

const StyledTopBar = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  box-sizing: border-box;
  display: flex;
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

const StyledTopBarTitle = styled.div`
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledScroll = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
`;

const StyledFooter = styled.div`
  background: ${themeCssVariables.background.secondary};
  border-top: 1px solid ${themeCssVariables.border.color.light};
  box-sizing: border-box;
  display: flex;
  justify-content: flex-end;
  padding: ${themeCssVariables.spacing[2]};
`;

type InboxThreadPanelProps = {
  threadId: string;
  onClose: () => void;
};

export const InboxThreadPanel = ({
  threadId,
  onClose,
}: InboxThreadPanelProps) => {
  const {
    thread,
    messages,
    fetchMoreMessages,
    threadLoading,
    messageThreadExternalId,
    connectedAccountHandle,
    messageChannelLoading,
    connectedAccountProvider,
    lastMessageExternalId,
    connectedAccountConnectionParameters,
  } = useInboxThread(threadId);

  const messagesCount = messages.length;
  const is5OrMore = messagesCount >= 5;
  const firstMessages = messages.slice(0, is5OrMore ? 2 : messagesCount - 1);
  const lastMessage = messages[messagesCount - 1];
  const subject = messages[0]?.subject;

  const canReply = useMemo(() => {
    return (
      connectedAccountHandle &&
      connectedAccountProvider &&
      ALLOWED_REPLY_PROVIDERS.includes(connectedAccountProvider) &&
      (connectedAccountProvider !== ConnectedAccountProvider.IMAP_SMTP_CALDAV ||
        isDefined(connectedAccountConnectionParameters?.SMTP)) &&
      isDefined(lastMessage) &&
      messageThreadExternalId != null
    );
  }, [
    connectedAccountConnectionParameters,
    connectedAccountHandle,
    connectedAccountProvider,
    lastMessage,
    messageThreadExternalId,
  ]);

  const handleReplyClick = () => {
    if (!isDefined(canReply)) return;
    let url: string;
    switch (connectedAccountProvider) {
      case ConnectedAccountProvider.MICROSOFT:
        url = `https://outlook.office.com/mail/deeplink?ItemID=${lastMessageExternalId}`;
        window.open(url, '_blank');
        break;
      case ConnectedAccountProvider.GOOGLE:
        url = `https://mail.google.com/mail/?authuser=${connectedAccountHandle}#all/${messageThreadExternalId}`;
        window.open(url, '_blank');
        break;
      case ConnectedAccountProvider.IMAP_SMTP_CALDAV:
        throw new Error('Account provider not supported');
      case null:
        throw new Error('Account provider not provided');
      default:
        assertUnreachable(connectedAccountProvider);
    }
  };

  return (
    <StyledWrapper>
      <StyledTopBar>
        <StyledTopBarTitle>{t`Email Thread`}</StyledTopBarTitle>
        <LightIconButton Icon={IconX} size="small" accent="tertiary" onClick={onClose} />
      </StyledTopBar>
      <StyledScroll>
        {(!thread || messages.length === 0) && threadLoading && (
          <EmailLoader loadingText={t`Loading thread`} />
        )}
        {thread && messages.length > 0 && (
          <>
            <EmailThreadHeader
              subject={subject}
              lastMessageSentAt={lastMessage.receivedAt}
            />
            {firstMessages.map((message) => (
              <EmailThreadMessage
                key={message.id}
                sender={message.sender}
                participants={message.messageParticipants}
                body={message.text}
                sentAt={message.receivedAt}
              />
            ))}
            {lastMessage && (
              <EmailThreadMessage
                key={lastMessage.id}
                sender={lastMessage.sender}
                participants={lastMessage.messageParticipants}
                body={lastMessage.text}
                sentAt={lastMessage.receivedAt}
                isExpanded
              />
            )}
            <CustomResolverFetchMoreLoader
              loading={threadLoading}
              onLastRowVisible={fetchMoreMessages}
            />
          </>
        )}
      </StyledScroll>
      {isDefined(canReply) && !messageChannelLoading && (
        <StyledFooter>
          <Button
            size="small"
            onClick={handleReplyClick}
            title={t`Reply`}
            Icon={IconArrowBackUp}
            disabled={!isDefined(canReply)}
          />
        </StyledFooter>
      )}
    </StyledWrapper>
  );
};
