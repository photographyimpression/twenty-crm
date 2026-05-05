import { styled } from '@linaria/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { IconMail, IconSearch, IconSend, IconX } from 'twenty-ui/display';
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
import {
  type InboxFolder,
  useTimelineThreadsForCurrentWorkspaceMember,
} from '@/activities/emails/hooks/useTimelineThreadsForCurrentWorkspaceMember';
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
  margin-bottom: ${themeCssVariables.spacing[3]};
`;

const StyledCount = styled.span`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.regular};
`;

const StyledControlsRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  margin-bottom: ${themeCssVariables.spacing[3]};
`;

const StyledTabs = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  gap: 2px;
  padding: 3px;
`;

const StyledTab = styled.button<{ isActive: boolean }>`
  align-items: center;
  background: ${({ isActive }) =>
    isActive ? themeCssVariables.background.primary : 'transparent'};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.secondary};
  cursor: pointer;
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[1]};
  height: 26px;
  padding: 0 ${themeCssVariables.spacing[2]};

  &:hover {
    color: ${themeCssVariables.font.color.primary};
  }
`;

const StyledSearchWrapper = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex: 1;
  gap: ${themeCssVariables.spacing[2]};
  height: 32px;
  max-width: 480px;
  padding: 0 ${themeCssVariables.spacing[2]};

  &:focus-within {
    border-color: ${themeCssVariables.border.color.medium};
  }
`;

const StyledSearchInput = styled.input`
  background: transparent;
  border: none;
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-size: ${themeCssVariables.font.size.sm};
  outline: none;
  padding: 0;

  &::placeholder {
    color: ${themeCssVariables.font.color.tertiary};
  }
`;

const StyledClearButton = styled.button`
  align-items: center;
  background: transparent;
  border: none;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  padding: 0;

  &:hover {
    color: ${themeCssVariables.font.color.primary};
  }
`;

const StyledRowWrapper = styled.div<{ isSelected: boolean }>`
  background: ${({ isSelected }) =>
    isSelected
      ? themeCssVariables.background.transparent.lighter
      : 'transparent'};
  cursor: pointer;
`;

const useDebouncedValue = <T,>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);

    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
};

export const InboxPage = () => {
  const { t } = useLingui();
  const [folder, setFolder] = useState<InboxFolder>('inbox');
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  // When we change tab/search, the selected thread may not be in the new
  // result set; clear it so the right-pane doesn't show a stale email.
  useEffect(() => {
    setSelectedThreadId(null);
  }, [folder, debouncedSearch]);

  const { data, firstQueryLoading, isFetchingMore, fetchMoreRecords } =
    useTimelineThreadsForCurrentWorkspaceMember({
      folder,
      search: debouncedSearch,
    });

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
                {folder === 'inbox' ? <Trans>Inbox</Trans> : <Trans>Sent</Trans>}
                <StyledCount>{totalNumberOfThreads}</StyledCount>
              </StyledTitleRow>
              <StyledControlsRow>
                <StyledTabs role="tablist">
                  <StyledTab
                    type="button"
                    role="tab"
                    aria-selected={folder === 'inbox'}
                    isActive={folder === 'inbox'}
                    onClick={() => setFolder('inbox')}
                  >
                    <IconMail size={14} />
                    <Trans>Inbox</Trans>
                  </StyledTab>
                  <StyledTab
                    type="button"
                    role="tab"
                    aria-selected={folder === 'sent'}
                    isActive={folder === 'sent'}
                    onClick={() => setFolder('sent')}
                  >
                    <IconSend size={14} />
                    <Trans>Sent</Trans>
                  </StyledTab>
                </StyledTabs>
                <StyledSearchWrapper>
                  <IconSearch
                    size={14}
                    color={themeCssVariables.font.color.tertiary}
                  />
                  <StyledSearchInput
                    type="text"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder={t`Search by subject, name, or email…`}
                    aria-label={t`Search emails`}
                  />
                  {searchInput.length > 0 && (
                    <StyledClearButton
                      type="button"
                      onClick={() => setSearchInput('')}
                      aria-label={t`Clear search`}
                    >
                      <IconX size={14} />
                    </StyledClearButton>
                  )}
                </StyledSearchWrapper>
              </StyledControlsRow>
              {firstQueryLoading && <SkeletonLoader />}
              {!firstQueryLoading && timelineThreads.length === 0 && (
                <AnimatedPlaceholderEmptyContainer
                  // oxlint-disable-next-line react/jsx-props-no-spreading
                  {...EMPTY_PLACEHOLDER_TRANSITION_PROPS}
                >
                  <AnimatedPlaceholder type="emptyInbox" />
                  <AnimatedPlaceholderEmptyTextContainer>
                    <AnimatedPlaceholderEmptyTitle>
                      {debouncedSearch.length > 0 ? (
                        <Trans>No matching emails</Trans>
                      ) : folder === 'sent' ? (
                        <Trans>No sent emails yet</Trans>
                      ) : (
                        <Trans>No emails yet</Trans>
                      )}
                    </AnimatedPlaceholderEmptyTitle>
                    <AnimatedPlaceholderEmptySubTitle>
                      {debouncedSearch.length > 0 ? (
                        <Trans>Try a different keyword.</Trans>
                      ) : (
                        <Trans>
                          Connect an email account in Settings to start syncing
                          your inbox.
                        </Trans>
                      )}
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
