import { gql } from '@apollo/client';

import { timelineThreadWithTotalFragment } from '@/activities/emails/graphql/queries/fragments/timelineThreadWithTotalFragment';

export const getTimelineThreadsFromCurrentWorkspaceMember = gql`
  query GetTimelineThreadsFromCurrentWorkspaceMember(
    $page: Int!
    $pageSize: Int!
  ) {
    getTimelineThreadsFromCurrentWorkspaceMember(
      page: $page
      pageSize: $pageSize
    ) {
      ...TimelineThreadsWithTotalFragment
    }
  }
  ${timelineThreadWithTotalFragment}
`;
