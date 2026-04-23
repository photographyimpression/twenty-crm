import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { CREATE_OUTLOOK_CALENDAR_EVENT } from '@/activities/calendar/graphql/mutations/createOutlookCalendarEvent';
import { useMutation } from '@apollo/client';

export type CreateOutlookCalendarEventInput = {
  personId: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  isTeamsMeeting: boolean;
};

export type CreateOutlookCalendarEventResult = {
  eventId: string;
  joinUrl?: string | null;
  webLink?: string | null;
};

type MutationData = {
  createOutlookCalendarEvent: CreateOutlookCalendarEventResult;
};

type MutationVariables = {
  input: CreateOutlookCalendarEventInput;
};

export const useCreateOutlookCalendarEvent = () => {
  const apolloCoreClient = useApolloCoreClient();

  const [mutate, { loading }] = useMutation<MutationData, MutationVariables>(
    CREATE_OUTLOOK_CALENDAR_EVENT,
    { client: apolloCoreClient },
  );

  const createOutlookCalendarEvent = async (
    input: CreateOutlookCalendarEventInput,
  ): Promise<CreateOutlookCalendarEventResult> => {
    const result = await mutate({ variables: { input } });

    if (!result.data?.createOutlookCalendarEvent) {
      throw new Error('Failed to create calendar event');
    }

    return result.data.createOutlookCalendarEvent;
  };

  return { createOutlookCalendarEvent, loading };
};
