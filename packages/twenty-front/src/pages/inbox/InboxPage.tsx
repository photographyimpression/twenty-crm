import { styled } from '@linaria/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
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
import { InboxThreadPanel } from '@/activities/emails/components/InboxThreadPanel';
import { useTimelineThreadsForCurrentWorkspaceMember } from '@/activities/emails/hooks/useTimelineThreadsForCurrentWorkspaceMember';
import { PageBody } from '@/ui/layout/page/components/PageBody';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { type TimelineThread } from '~/generated/graphql';

const StyledLayout = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-direction: row;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 0;
`;

const StyledList = styled.div`
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow: auto;
  padding: ${themeCssVariables.spacing[6]} ${themeCssVariables.spacing[6]}
    ${themeCssVariables.spacing[2]};
`;

const StyledDetailColumn = styled.div`
  display: flex;
  flex: 0 0 480px;
  flex-direction: column;
  height: 100%;
  min-width: 0;
`;

const StyledTitleRow = styled.div`
  align-items: baseline;
  display: flex;
  font-size: ${themeCssVariables.font.size.xl};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  gap: ${themeCssVariables.spacing[2]};
  margin-bottom: ${themeCssVariables.spacing[4]};
`;

const StyledCount = styled.span`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.regular};
`;

const StyledRowWrapper = styled.div<{ isSelected: boolean }>`
  background: ${({ isSelected }) =>
    isSelected ? themeCssVariables.background.transparent.lighter : 'transparent'};
  cursor: pointer;
`;

export const InboxPage = () => {
  const { t } = useLingui();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

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

  const handleRowClickCapture =
    (threadId: string) => (event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      setSelectedThreadId(threadId);
    };

  return (
    <PageContainer>
      <PageHeader title={t`Inbox`} Icon={IconMail} />
      <PageBody>
        <StyledLayout>
          <StyledList>
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
                        Connect an email account in Settings to start syncing
                        your inbox.
                      </Trans>
                    </AnimatedPlaceholderEmptySubTitle>
                  </AnimatedPlaceholderEmptyTextContainer>
                </AnimatedPlaceholderEmptyContainer>
              )}
              {!firstQueryLoading && timelineThreads.length > 0 && (
                <ActivityList>
                  {timelineThreads.map((thread: TimelineThread) => (
                    <StyledRowWrapper
                      key={thread.id}
                      isSelected={selectedThreadId === thread.id}
                      onClickCapture={handleRowClickCapture(thread.id)}
                    >
                      <EmailThreadPreview thread={thread} />
                    </StyledRowWrapper>
                  ))}
                </ActivityList>
              )}
              <CustomResolverFetchMoreLoader
                loading={isFetchingMore}
                onLastRowVisible={handleLastRowVisible}
              />
            </Section>
          </StyledList>
          {selectedThreadId && (
            <StyledDetailColumn>
              <InboxThreadPanel
                key={selectedThreadId}
                threadId={selectedThreadId}
                onClose={() => setSelectedThreadId(null)}
              />
            </StyledDetailColumn>
          )}
        </StyledLayout>
      </PageBody>
    </PageContainer>
  );
};
