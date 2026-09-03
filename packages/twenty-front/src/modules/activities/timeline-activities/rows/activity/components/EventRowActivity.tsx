import { styled } from '@linaria/react';
import { useState } from 'react';

import { EventCard } from '@/activities/timeline-activities/rows/components/EventCard';
import { EventCardToggleButton } from '@/activities/timeline-activities/rows/components/EventCardToggleButton';
import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent';
import { EventCardNotePreview } from '@/activities/timeline-activities/rows/activity/components/EventCardNotePreview';
import { classifyNoteActivity } from '@/activities/timeline-activities/utils/classifyNoteActivity';
import { isTimelineActivityWithLinkedRecord } from '@/activities/timeline-activities/types/TimelineActivity';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { type CoreObjectNameSingular } from 'twenty-shared/types';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
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
      case 'message':
        return themeCssVariables.color.turquoise;
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
  message: IconMessage,
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

  // LOCAL-PATCH (board cards 2026-09-02): the note body used to come from the
  // Apollo cache only — when the cache held the note without bodyV2, expanding
  // the row showed no body at all ("why do I need to open the editor to see
  // the transcript?"). Fetch it instead (Apollo's default cache-first policy:
  // cache hit when present, one query per note otherwise).
  const { record: activityInStore } = useFindOneRecord({
    objectNameSingular,
    objectRecordId: event.linkedRecordId,
    recordGqlFields: {
      id: true,
      title: true,
      bodyV2: { markdown: true },
    },
  });

  // LOCAL-PATCH (board card 2026-09-02): imported notes carry code-like junk
  // titles ("NF5ZG") that read as a glitch. Treat a short no-space mixed-case
  // alphanumeric title as junk and fall back to the body's first words.
  const isJunkTitle = (title: string | null | undefined) =>
    !!title && /^[A-Za-z0-9]{3,10}$/.test(title.trim());

  const bodyExcerpt = (() => {
    const markdown = activityInStore?.bodyV2?.markdown || '';

    return markdown
      .replace(/\s+/g, ' ')
      .replace(/^[^A-Za-z0-9📝📞📥📤⏳]+/, '')
      .trim()
      .slice(0, 60);
  })();

  const computeActivityTitle = () => {
    if (
      isNonEmptyString(activityInStore?.title) &&
      !isJunkTitle(activityInStore?.title)
    ) {
      return activityInStore?.title;
    }

    if (
      isNonEmptyString(event.linkedRecordCachedName) &&
      !isJunkTitle(event.linkedRecordCachedName)
    ) {
      // Junk title on the record AND on the cached name — the body's first
      // words say more than "Untitled".
      if (bodyExcerpt) {
        return bodyExcerpt;
      }

      return event.linkedRecordCachedName;
    }

    if (bodyExcerpt) {
      return bodyExcerpt;
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
            <OverflowingTextWithTooltip text={classification.displaySummary} />
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
