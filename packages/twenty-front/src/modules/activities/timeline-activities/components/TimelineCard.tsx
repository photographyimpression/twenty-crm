import { styled } from '@linaria/react';

import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { SkeletonLoader } from '@/activities/components/SkeletonLoader';
import { EventList } from '@/activities/timeline-activities/components/EventList';
import { useTimelineActivities } from '@/activities/timeline-activities/hooks/useTimelineActivities';
import { useOpenCreateActivityDrawer } from '@/activities/hooks/useOpenCreateActivityDrawer';
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

const StyledQuickActionsBar = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

export const TimelineCard = () => {
  const targetRecord = useTargetRecord();
  const { isInSidePanel } = useLayoutRenderingContext();
  const { timelineActivities, loading, fetchMoreRecords } =
    useTimelineActivities(targetRecord);

  const openCreateActivity = useOpenCreateActivityDrawer({
    activityObjectNameSingular: CoreObjectNameSingular.Note,
  });

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
          onClick={() =>
            openCreateActivity({
              targetableObjects: [targetRecord],
            })
          }
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
      <StyledQuickActionsBar>
        <Button
          Icon={IconPlus}
          title={t`Add note`}
          variant="secondary"
          size="small"
          onClick={() =>
            openCreateActivity({
              targetableObjects: [targetRecord],
            })
          }
        />
      </StyledQuickActionsBar>
      <EventList
        targetableObject={targetRecord}
        title={t`All`}
        events={timelineActivities ?? []}
      />
      <CustomResolverFetchMoreLoader
        loading={loading}
        onLastRowVisible={fetchMoreRecords}
      />
    </StyledMainContainer>
  );
};
