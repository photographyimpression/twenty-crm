import { useQuery } from '@apollo/client';
import { useEffect, useState } from 'react';

import { TIMELINE_THREADS_DEFAULT_PAGE_SIZE } from '@/activities/emails/constants/Messaging';
import { getTimelineThreadsFromCurrentWorkspaceMember } from '@/activities/emails/graphql/queries/getTimelineThreadsFromCurrentWorkspaceMember';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { type TimelineThreadsWithTotal } from '~/generated/graphql';

const QUERY_NAME = 'getTimelineThreadsFromCurrentWorkspaceMember';
const RESULT_FIELD = 'timelineThreads';

export type InboxFolder = 'inbox' | 'sent';

type Options = {
  folder?: InboxFolder;
  search?: string;
  pageSize?: number;
};

export const useTimelineThreadsForCurrentWorkspaceMember = ({
  folder = 'inbox',
  search,
  pageSize = TIMELINE_THREADS_DEFAULT_PAGE_SIZE,
}: Options = {}) => {
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueErrorSnackBar } = useSnackBar();

  const [page, setPage] = useState({ pageNumber: 1, hasNextPage: true });
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const trimmedSearch = search?.trim() ?? '';
  const variables = {
    page: 1,
    pageSize,
    folder,
    search: trimmedSearch.length > 0 ? trimmedSearch : null,
  };

  const { data, loading, fetchMore } = useQuery<{
    [QUERY_NAME]: TimelineThreadsWithTotal;
  }>(getTimelineThreadsFromCurrentWorkspaceMember, {
    client: apolloCoreClient,
    variables,
    fetchPolicy: 'cache-and-network',
    onError: (error) => {
      enqueueErrorSnackBar({ apolloError: error });
    },
  });

  // Reset pagination state when filters change.
  useEffect(() => {
    setPage({ pageNumber: 1, hasNextPage: true });
  }, [folder, trimmedSearch]);

  const fetchMoreRecords = async () => {
    if (!page.hasNextPage || isFetchingMore || loading) {
      return;
    }

    setIsFetchingMore(true);

    await fetchMore({
      variables: { ...variables, page: page.pageNumber + 1 },
      updateQuery: (prev, { fetchMoreResult }) => {
        const incoming = fetchMoreResult?.[QUERY_NAME]?.[RESULT_FIELD] ?? [];

        if (incoming.length === 0) {
          setPage((p) => ({ ...p, hasNextPage: false }));

          return {
            [QUERY_NAME]: {
              ...prev?.[QUERY_NAME],
              [RESULT_FIELD]: prev?.[QUERY_NAME]?.[RESULT_FIELD] ?? [],
            },
          };
        }

        return {
          [QUERY_NAME]: {
            ...prev?.[QUERY_NAME],
            [RESULT_FIELD]: [
              ...(prev?.[QUERY_NAME]?.[RESULT_FIELD] ?? []),
              ...incoming,
            ],
          },
        };
      },
    });

    setPage((p) => ({ ...p, pageNumber: p.pageNumber + 1 }));
    setIsFetchingMore(false);
  };

  return {
    data: data?.[QUERY_NAME],
    firstQueryLoading: loading && page.pageNumber === 1,
    isFetchingMore,
    fetchMoreRecords,
  };
};
