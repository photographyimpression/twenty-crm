import { gql } from '@apollo/client';

import { timelineThreadWithTotalFragment } from '@/activities/emails/graphql/queries/fragments/timelineThreadWithTotalFragment';

export const getTimelineThreadsFromCurrentWorkspaceMember = gql`
  query GetTimelineThreadsFromCurrentWorkspaceMember(
    $page: Int!
    $pageSize: Int!
    $folder: String
    $search: String
  ) {
    getTimelineThreadsFromCurrentWorkspaceMember(
      page: $page
      pageSize: $pageSize
      folder: $folder
      search: $search
    ) {
      ...TimelineThreadsWithTotalFragment
    }
  }
  ${timelineThreadWithTotalFragment}
`;
