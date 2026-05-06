import { styled } from '@linaria/react';
import { useState } from 'react';

import { type EmailThreadMessage } from '@/activities/emails/types/EmailThreadMessage';
import { EventCard } from '@/activities/timeline-activities/rows/components/EventCard';
import { EventCardToggleButton } from '@/activities/timeline-activities/rows/components/EventCardToggleButton';
import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent';
import { EventCardMessage } from '@/activities/timeline-activities/rows/message/components/EventCardMessage';
import { isTimelineActivityWithLinkedRecord } from '@/activities/timeline-activities/types/TimelineActivity';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useOpenEmailThreadInSidePanel } from '@/side-panel/hooks/useOpenEmailThreadInSidePanel';
import { useLingui } from '@lingui/react/macro';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { FIELD_RESTRICTED_ADDITIONAL_PERMISSIONS_REQUIRED } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';
import { IconInbox, IconSend } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

type EventRowMessageProps = EventRowDynamicComponentProps;

type MessageWithDirection = EmailThreadMessage & {
  messageChannelMessageAssociations?: {
    id: string;
    direction: 'INCOMING' | 'OUTGOING';
  }[];
};

const StyledEventRowMessageContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  min-width: 0;
  width: 100%;
`;

const StyledRowContainer = styled.div`
  align-items: center;
  display: flex;
  flex-direction: row;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

const StyledClickableArea = styled.div`
  align-items: center;
  cursor: pointer;
  display: flex;
  flex: 1;
  flex-direction: row;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

const StyledDirectionIcon = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex-shrink: 0;
`;

const StyledSubject = styled.div`
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-weight: ${themeCssVariables.font.weight.medium};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledBodyExcerpt = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  margin-left: calc(
    ${themeCssVariables.spacing[4]} + ${themeCssVariables.spacing[2]}
  );
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledSubjectFallback = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  flex: 1;
  font-style: italic;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TRUNCATE_LIMIT = 140;

// Email bodies often contain HTML, quoted-reply lines, and ASCII separators
// (underscores, dashes) used as horizontal rules. Strip those for a clean excerpt.
const cleanBodyForExcerpt = (text: string): string =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join(' ')
    .replace(/[_=\-*~+]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const EventRowMessage = ({
  event,
  authorFullName,
}: EventRowMessageProps) => {
  const { t } = useLingui();
  const [, eventAction] = event.name.split('.');
  const [isOpen, setIsOpen] = useState(false);
  const { openEmailThreadInSidePanel } = useOpenEmailThreadInSidePanel();

  if (eventAction !== 'linked') {
    throw new Error('Invalid event action for message event type.');
  }

  const hasLinkedRecord = isTimelineActivityWithLinkedRecord(event);
  const messageId = hasLinkedRecord ? event.linkedRecordId : undefined;

  const { record: message } = useFindOneRecord<MessageWithDirection>({
    objectNameSingular: CoreObjectNameSingular.Message,
    objectRecordId: messageId,
    skip: !hasLinkedRecord,
    recordGqlFields: {
      id: true,
      subject: true,
      text: true,
      messageThreadId: true,
      messageChannelMessageAssociations: {
        id: true,
        direction: true,
      },
    },
  });

  const direction = message?.messageChannelMessageAssociations?.[0]?.direction;
  const DirectionIcon = direction === 'OUTGOING' ? IconSend : IconInbox;

  const subjectIsRestricted =
    message?.subject === FIELD_RESTRICTED_ADDITIONAL_PERMISSIONS_REQUIRED;
  const textIsRestricted =
    message?.text === FIELD_RESTRICTED_ADDITIONAL_PERMISSIONS_REQUIRED;

  const subjectText =
    isDefined(message?.subject) && !subjectIsRestricted
      ? message.subject
      : null;

  const cleanedBody =
    isDefined(message?.text) && !textIsRestricted && message.text.length > 0
      ? cleanBodyForExcerpt(message.text)
      : '';
  const bodyExcerpt =
    cleanedBody.length === 0 ? null : cleanedBody.slice(0, TRUNCATE_LIMIT);

  const handleRowClick = () => {
    if (isDefined(message?.messageThreadId) && !subjectIsRestricted) {
      openEmailThreadInSidePanel(message.messageThreadId);
      return;
    }
    setIsOpen((prev) => !prev);
  };

  return (
    <StyledEventRowMessageContainer>
      <StyledRowContainer>
        <StyledClickableArea onClick={handleRowClick}>
          <StyledDirectionIcon>
            <DirectionIcon size={14} />
          </StyledDirectionIcon>
          {isDefined(subjectText) ? (
            <StyledSubject>{subjectText}</StyledSubject>
          ) : (
            <StyledSubjectFallback>
              {subjectIsRestricted ? t`Subject not shared` : t`Email`}
            </StyledSubjectFallback>
          )}
        </StyledClickableArea>
        <EventCardToggleButton isOpen={isOpen} setIsOpen={setIsOpen} />
      </StyledRowContainer>
      {isDefined(bodyExcerpt) && (
        <StyledBodyExcerpt>{bodyExcerpt}</StyledBodyExcerpt>
      )}
      <EventCard isOpen={isOpen}>
        {hasLinkedRecord && (
          <EventCardMessage
            messageId={event.linkedRecordId}
            authorFullName={authorFullName}
          />
        )}
      </EventCard>
    </StyledEventRowMessageContainer>
  );
};
