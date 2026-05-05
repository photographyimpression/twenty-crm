import { useMutation } from '@apollo/client';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useMemo, useState } from 'react';

import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { EmailLoader } from '@/activities/emails/components/EmailLoader';
import { EmailThreadHeader } from '@/activities/emails/components/EmailThreadHeader';
import { EmailThreadMessage } from '@/activities/emails/components/EmailThreadMessage';
import { REPLY_TO_EMAIL_THREAD } from '@/activities/emails/graphql/mutations/replyToEmailThread';
import { useInboxThread } from '@/activities/emails/hooks/useInboxThread';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';

import { ConnectedAccountProvider } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { IconArrowBackUp, IconSend, IconX } from 'twenty-ui/display';
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

const StyledComposeArea = styled.div`
  background: ${themeCssVariables.background.primary};
  border-top: 1px solid ${themeCssVariables.border.color.light};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledTextarea = styled.textarea`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  min-height: 120px;
  padding: ${themeCssVariables.spacing[2]};
  resize: vertical;
  width: 100%;

  &:focus {
    border-color: ${themeCssVariables.border.color.medium};
    outline: none;
  }
`;

const StyledComposeRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
`;

type InboxThreadPanelProps = {
  threadId: string;
  onClose: () => void;
};

export const InboxThreadPanel = ({
  threadId,
  onClose,
}: InboxThreadPanelProps) => {
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const [isComposing, setIsComposing] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [isSending, setIsSending] = useState(false);

  const [replyMutation] = useMutation(REPLY_TO_EMAIL_THREAD, {
    client: apolloCoreClient,
  });

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

  const canReplyInApp =
    canReply && connectedAccountProvider === ConnectedAccountProvider.MICROSOFT;

  const handleReplyClick = () => {
    if (canReplyInApp) {
      setIsComposing(true);
      return;
    }
    if (connectedAccountProvider === ConnectedAccountProvider.GOOGLE) {
      window.open(
        `https://mail.google.com/mail/?authuser=${connectedAccountHandle}#all/${messageThreadExternalId}`,
        '_blank',
      );
    } else if (connectedAccountProvider === ConnectedAccountProvider.MICROSOFT) {
      window.open(
        `https://outlook.office.com/mail/deeplink?ItemID=${lastMessageExternalId}`,
        '_blank',
      );
    }
  };

  const handleSend = async () => {
    if (!replyBody.trim() || isSending) return;
    setIsSending(true);
    try {
      const result = await replyMutation({
        variables: { threadId, body: replyBody },
      });
      if (result.data?.replyToEmailThread) {
        enqueueSuccessSnackBar({ message: t`Reply sent` });
        setReplyBody('');
        setIsComposing(false);
      } else {
        enqueueErrorSnackBar({ message: t`Failed to send reply` });
      }
    } catch (error) {
      enqueueErrorSnackBar({
        message: (error as Error).message ?? t`Failed to send reply`,
      });
    } finally {
      setIsSending(false);
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
      {isDefined(canReply) && !messageChannelLoading && !isComposing && (
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
      {isComposing && (
        <StyledComposeArea>
          <StyledTextarea
            placeholder={t`Type your reply…`}
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            autoFocus
            disabled={isSending}
          />
          <StyledComposeRow>
            <Button
              size="small"
              variant="secondary"
              accent="default"
              onClick={() => {
                setIsComposing(false);
                setReplyBody('');
              }}
              title={t`Cancel`}
              disabled={isSending}
            />
            <Button
              size="small"
              onClick={handleSend}
              title={isSending ? t`Sending…` : t`Send`}
              Icon={IconSend}
              disabled={!replyBody.trim() || isSending}
            />
          </StyledComposeRow>
        </StyledComposeArea>
      )}
    </StyledWrapper>
  );
};
