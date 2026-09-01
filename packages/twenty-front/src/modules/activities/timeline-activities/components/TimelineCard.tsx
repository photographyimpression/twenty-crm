import { styled } from '@linaria/react';
import { useMemo, useState } from 'react';

import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { SkeletonLoader } from '@/activities/components/SkeletonLoader';
import { EventList } from '@/activities/timeline-activities/components/EventList';
// LOCAL-PATCH: Salesmate-style unified timeline — filter pills + Upcoming block.
import {
  TimelineFilterPills,
  type TimelineFilter,
} from '@/activities/timeline-activities/components/TimelineFilterPills';
import { TimelineInlineNoteEditor } from '@/activities/timeline-activities/components/TimelineInlineNoteEditor';
import { TimelineUpcomingSection } from '@/activities/timeline-activities/components/TimelineUpcomingSection';
import { useTimelineActivities } from '@/activities/timeline-activities/hooks/useTimelineActivities';
import {
  TIMELINE_EVENT_CATEGORIES,
  getTimelineEventCategory,
  type TimelineEventCategory,
} from '@/activities/timeline-activities/utils/getTimelineEventCategory';
import { useOpenCreateActivityDrawer } from '@/activities/hooks/useOpenCreateActivityDrawer';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { useTargetRecord } from '@/ui/layout/contexts/useTargetRecord';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { t } from '@lingui/core/macro';
import { IconPlus } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import {
  AnimatedPlaceholder,
  AnimatedPlaceholderEmptyContainer,
  AnimatedPlaceholderEmptySubTitle,
  AnimatedPlaceholderEmptyTextContainer,
  AnimatedPlaceholderEmptyTitle,
  EMPTY_PLACEHOLDER_TRANSITION_PROPS,
} from 'twenty-ui/layout';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';

const StyledMainContainer = styled.div`
  align-items: flex-start;
  align-self: stretch;
  border-top: none;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};

  justify-content: center;
  overflow: auto;
  padding-left: ${themeCssVariables.spacing[6]};
  padding-right: ${themeCssVariables.spacing[6]};
  padding-top: ${themeCssVariables.spacing[6]};

  @media (max-width: ${MOBILE_VIEWPORT}px) {
    border-top: 1px solid ${themeCssVariables.border.color.medium};
    padding-right: ${themeCssVariables.spacing[1]};
    padding-left: ${themeCssVariables.spacing[1]};
  }
`;

const StyledSidePanelPlaceholderWrapper = styled.div`
  > * {
    height: auto;
    padding-top: ${themeCssVariables.spacing[8]};
  }
`;

const StyledToolbar = styled.div`
  align-items: flex-start;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  width: 100%;
`;

// Lets the pill row wrap inside itself instead of pushing the button onto a
// line of its own.
const StyledToolbarPills = styled.div`
  flex: 1 1 0;
  min-width: 0;
`;

export const TimelineCard = () => {
  const targetRecord = useTargetRecord();
  const { isInSidePanel } = useLayoutRenderingContext();
  const { timelineActivities, loading, fetchMoreRecords } =
    useTimelineActivities(targetRecord);
  const { objectMetadataItems } = useObjectMetadataItems();

  const [activeFilter, setActiveFilter] = useState<TimelineFilter>('all');

  // LOCAL-PATCH: inline (center-column) note composer. On the record page,
  // "Add note" opens the editor right in the timeline — Salesmate style, no
  // side panel. Inside the side panel there IS no center column, so the old
  // drawer behavior stays there (board card 2026-08-30).
  const [inlineNoteId, setInlineNoteId] = useState<string | null>(null);
  const [creatingInlineNote, setCreatingInlineNote] = useState(false);

  const openCreateActivity = useOpenCreateActivityDrawer({
    activityObjectNameSingular: CoreObjectNameSingular.Note,
    openInSidePanel: true,
  });

  const openInlineNote = useOpenCreateActivityDrawer({
    activityObjectNameSingular: CoreObjectNameSingular.Note,
    openInSidePanel: false,
  });

  const openNoteComposer = async () => {
    setCreatingInlineNote(true);
    try {
      const activity = await openInlineNote({
        targetableObjects: [targetRecord],
      });
      setInlineNoteId(activity?.id ?? null);
    } finally {
      setCreatingInlineNote(false);
    }
  };

  const linkedObjectNameSingularById = useMemo(
    () =>
      Object.fromEntries(
        objectMetadataItems.map((objectMetadataItem) => [
          objectMetadataItem.id,
          objectMetadataItem.nameSingular,
        ]),
      ),
    [objectMetadataItems],
  );

  const categoryByEventId = useMemo(
    () =>
      new Map(
        timelineActivities.map((event) => [
          event.id,
          getTimelineEventCategory({ event, linkedObjectNameSingularById }),
        ]),
      ),
    [timelineActivities, linkedObjectNameSingularById],
  );

  const countsByCategory = useMemo(() => {
    const counts = Object.fromEntries(
      TIMELINE_EVENT_CATEGORIES.map((category) => [category, 0]),
    ) as Record<TimelineEventCategory, number>;

    for (const category of categoryByEventId.values()) {
      counts[category] += 1;
    }

    return counts;
  }, [categoryByEventId]);

  const filteredActivities = useMemo(
    () =>
      activeFilter === 'all'
        ? timelineActivities
        : timelineActivities.filter(
            (event) => categoryByEventId.get(event.id) === activeFilter,
          ),
    [activeFilter, timelineActivities, categoryByEventId],
  );

  const openAddNote = () => {
    if (!isInSidePanel) {
      void openNoteComposer();
      return;
    }
    openCreateActivity({
      targetableObjects: [targetRecord],
    });
  };

  const isTimelineActivitiesEmpty = timelineActivities.length === 0;

  if (loading === true) {
    return <SkeletonLoader withSubSections />;
  }

  if (isTimelineActivitiesEmpty) {
    const placeholderContent = (
      <AnimatedPlaceholderEmptyContainer
        // oxlint-disable-next-line react/jsx-props-no-spreading
        {...EMPTY_PLACEHOLDER_TRANSITION_PROPS}
      >
        <AnimatedPlaceholder type="emptyTimeline" />
        <AnimatedPlaceholderEmptyTextContainer>
          <AnimatedPlaceholderEmptyTitle>
            {t`No activity yet`}
          </AnimatedPlaceholderEmptyTitle>
          <AnimatedPlaceholderEmptySubTitle>
            {t`There is no activity associated with this record.`}
          </AnimatedPlaceholderEmptySubTitle>
        </AnimatedPlaceholderEmptyTextContainer>
        <Button
          Icon={IconPlus}
          title={t`Add note`}
          variant="secondary"
          onClick={openAddNote}
        />
      </AnimatedPlaceholderEmptyContainer>
    );

    return isInSidePanel ? (
      <StyledSidePanelPlaceholderWrapper>
        {placeholderContent}
      </StyledSidePanelPlaceholderWrapper>
    ) : (
      placeholderContent
    );
  }

  return (
    <StyledMainContainer>
      {!isInSidePanel && (
        <TimelineUpcomingSection targetableObject={targetRecord} />
      )}
      <StyledToolbar>
        <StyledToolbarPills>
          <TimelineFilterPills
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            countsByCategory={countsByCategory}
            totalCount={timelineActivities.length}
          />
        </StyledToolbarPills>
        <Button
          Icon={IconPlus}
          title={t`Add note`}
          variant="secondary"
          size="small"
          onClick={openAddNote}
          disabled={creatingInlineNote}
        />
      </StyledToolbar>
      {!isInSidePanel && inlineNoteId && (
        <TimelineInlineNoteEditor
          noteId={inlineNoteId}
          onClose={() => setInlineNoteId(null)}
        />
      )}
      <EventList
        targetableObject={targetRecord}
        title={t`All`}
        events={filteredActivities}
      />
      <CustomResolverFetchMoreLoader
        loading={loading}
        onLastRowVisible={fetchMoreRecords}
      />
    </StyledMainContainer>
  );
};
