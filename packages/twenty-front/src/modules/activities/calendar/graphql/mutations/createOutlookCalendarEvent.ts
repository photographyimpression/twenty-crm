import { gql } from '@apollo/client';

export const CREATE_OUTLOOK_CALENDAR_EVENT = gql`
  mutation CreateOutlookCalendarEvent(
    $input: CreateOutlookCalendarEventInput!
  ) {
    createOutlookCalendarEvent(input: $input) {
      eventId
      joinUrl
      webLink
    }
  }
`;
