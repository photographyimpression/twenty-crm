import { styled } from '@linaria/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { IconMail } from 'twenty-ui/display';
import {
  AnimatedPlaceholder,
  AnimatedPlaceholderEmptyContainer,
  AnimatedPlaceholderEmptySubTitle,
  AnimatedPlaceholderEmptyTextContainer,
  AnimatedPlaceholderEmptyTitle,
  EMPTY_PLACEHOLDER_TRANSITION_PROPS,
  Section,
} from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { ActivityList } from '@/activities/components/ActivityList';
import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { SkeletonLoader } from '@/activities/components/SkeletonLoader';
import { EmailThreadPreview } from '@/activities/emails/components/EmailThreadPreview';
import { useTimelineThreadsForCurrentWorkspaceMember } from '@/activities/emails/hooks/useTimelineThreadsForCurrentWorkspaceMember';
import { MainContainerLayoutWithSidePanel } from '@/object-record/components/MainContainerLayoutWithSidePanel';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { type TimelineThread } from '~/generated/graphql';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[6]};
  height: 100%;
  overflow: auto;
  padding: ${themeCssVariables.spacing[6]} ${themeCssVariables.spacing[6]}
    ${themeCssVariables.spacing[2]};
`;

const StyledTitleRow = styled.div`
  align-items: baseline;
  display: flex;
  font-size: ${themeCssVariables.font.size.xl};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledCount = styled.span`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.regular};
`;

export const InboxPage = () => {
  const { t } = useLingui();

  const { data, firstQueryLoading, isFetchingMore, fetchMoreRecords } =
    useTimelineThreadsForCurrentWorkspaceMember();

  const totalNumberOfThreads = data?.totalNumberOfThreads ?? 0;
  const timelineThreads = data?.timelineThreads ?? [];
  const hasMore = timelineThreads.length < totalNumberOfThreads;

  const handleLastRowVisible = async () => {
    if (hasMore) {
      await fetchMoreRecords();
    }
  };

  return (
    <PageContainer>
      <PageHeader title={t`Inbox`} Icon={IconMail} />
      <MainContainerLayoutWithSidePanel>
        <StyledContainer>
          <Section>
            <StyledTitleRow>
              <Trans>Inbox</Trans>
              <StyledCount>{totalNumberOfThreads}</StyledCount>
            </StyledTitleRow>
            {firstQueryLoading && <SkeletonLoader />}
            {!firstQueryLoading && timelineThreads.length === 0 && (
              <AnimatedPlaceholderEmptyContainer
                // oxlint-disable-next-line react/jsx-props-no-spreading
                {...EMPTY_PLACEHOLDER_TRANSITION_PROPS}
              >
                <AnimatedPlaceholder type="emptyInbox" />
                <AnimatedPlaceholderEmptyTextContainer>
                  <AnimatedPlaceholderEmptyTitle>
                    <Trans>No emails yet</Trans>
                  </AnimatedPlaceholderEmptyTitle>
                  <AnimatedPlaceholderEmptySubTitle>
                    <Trans>
                      Connect an email account in Settings to start syncing your
                      inbox.
                    </Trans>
                  </AnimatedPlaceholderEmptySubTitle>
                </AnimatedPlaceholderEmptyTextContainer>
              </AnimatedPlaceholderEmptyContainer>
            )}
            {!firstQueryLoading && timelineThreads.length > 0 && (
              <ActivityList>
                {timelineThreads.map((thread: TimelineThread) => (
                  <EmailThreadPreview key={thread.id} thread={thread} />
                ))}
              </ActivityList>
            )}
            <CustomResolverFetchMoreLoader
              loading={isFetchingMore}
              onLastRowVisible={handleLastRowVisible}
            />
          </Section>
        </StyledContainer>
      </MainContainerLayoutWithSidePanel>
    </PageContainer>
  );
};
