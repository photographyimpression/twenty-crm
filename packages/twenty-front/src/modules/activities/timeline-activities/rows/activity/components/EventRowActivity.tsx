import { styled } from '@linaria/react';
import { useState } from 'react';

import { EventCard } from '@/activities/timeline-activities/rows/components/EventCard';
import { EventCardToggleButton } from '@/activities/timeline-activities/rows/components/EventCardToggleButton';
import {
  type EventRowDynamicComponentProps,
} from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent';
import { EventCardNotePreview } from '@/activities/timeline-activities/rows/activity/components/EventCardNotePreview';
import { classifyNoteActivity } from '@/activities/timeline-activities/utils/classifyNoteActivity';
import { isTimelineActivityWithLinkedRecord } from '@/activities/timeline-activities/types/TimelineActivity';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { type CoreObjectNameSingular } from 'twenty-shared/types';
import { useGetRecordFromCache } from '@/object-record/cache/hooks/useGetRecordFromCache';
import { isNonEmptyString } from '@sniptt/guards';
import {
  IconMail,
  IconMessage,
  IconNotes,
  IconPhone,
  IconSparkles,
  OverflowingTextWithTooltip,
} from 'twenty-ui/display';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';

type EventRowActivityProps = EventRowDynamicComponentProps;

const StyledLinkedActivity = styled.span`
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  &:hover {
    text-decoration: underline;
  }
`;

const StyledRowContainer = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  justify-content: space-between;
`;

const StyledEventRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  width: 100%;
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  overflow: hidden;
`;

const StyledItemTitleDate = styled.div`
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    display: none;
  }
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  padding: 0 ${themeCssVariables.spacing[1]};
  white-space: nowrap;
`;

const StyledTypeIcon = styled.div<{ activityType: string }>`
  align-items: center;
  color: ${({ activityType }) => {
    switch (activityType) {
      case 'email':
        return themeCssVariables.color.blue;
      case 'sms':
        return themeCssVariables.color.green;
      case 'call':
        return themeCssVariables.color.orange;
      case 'aiSummary':
        return themeCssVariables.color.purple;
      default:
        return themeCssVariables.font.color.tertiary;
    }
  }};
  display: flex;
  flex-shrink: 0;
`;

export const StyledEventRowItemText = styled.span`
  color: ${themeCssVariables.font.color.primary};
`;

const ACTIVITY_TYPE_ICONS = {
  email: IconMail,
  sms: IconMessage,
  call: IconPhone,
  aiSummary: IconSparkles,
  note: IconNotes,
} as const;

export const EventRowActivity = ({
  event,
  objectNameSingular,
  createdAt,
}: EventRowActivityProps & { objectNameSingular: CoreObjectNameSingular }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!isTimelineActivityWithLinkedRecord(event)) {
    throw new Error('Could not find linked record id for event');
  }

  const getActivityFromCache = useGetRecordFromCache({
    objectNameSingular,
    recordGqlFields: {
      id: true,
      title: true,
      bodyV2: true,
    },
  });

  const activityInStore = getActivityFromCache(event.linkedRecordId);

  const computeActivityTitle = () => {
    if (isNonEmptyString(activityInStore?.title)) {
      return activityInStore?.title;
    }

    if (isNonEmptyString(event.linkedRecordCachedName)) {
      return event.linkedRecordCachedName;
    }

    return 'Untitled';
  };

  const activityTitle = computeActivityTitle();
  const classification = classifyNoteActivity(activityTitle);
  const TypeIcon = ACTIVITY_TYPE_ICONS[classification.activityType];

  const bodyContent = activityInStore?.bodyV2?.markdown || null;

  const { openRecordInSidePanel } = useOpenRecordInSidePanel();

  return (
    <StyledEventRow>
      <StyledRowContainer>
        <StyledRow>
          <StyledTypeIcon activityType={classification.activityType}>
            <TypeIcon size={16} />
          </StyledTypeIcon>
          <StyledLinkedActivity
            onClick={() =>
              openRecordInSidePanel({
                recordId: event.linkedRecordId,
                objectNameSingular,
              })
            }
          >
            <OverflowingTextWithTooltip
              text={classification.displaySummary}
            />
          </StyledLinkedActivity>
          <EventCardToggleButton isOpen={isOpen} setIsOpen={setIsOpen} />
        </StyledRow>
        <StyledItemTitleDate>{createdAt}</StyledItemTitleDate>
      </StyledRowContainer>
      <EventCard isOpen={isOpen}>
        <EventCardNotePreview
          noteId={event.linkedRecordId}
          objectNameSingular={objectNameSingular}
          classification={classification}
          bodyContent={bodyContent}
        />
      </EventCard>
    </StyledEventRow>
  );
};
