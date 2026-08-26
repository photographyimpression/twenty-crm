// LOCAL-PATCH: buckets a timeline event into the Salesmate filter-pill
// categories. Salesmate puts one unified timeline behind
// All / Activities / Deals / Notes / Emails / Texts / Calls / Files / Updates
// pills instead of splitting them across tabs.
import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { classifyNoteActivity } from '@/activities/timeline-activities/utils/classifyNoteActivity';
import { isDefined } from 'twenty-shared/utils';

export const TIMELINE_EVENT_CATEGORIES = [
  'activities',
  'deals',
  'notes',
  'emails',
  'texts',
  'calls',
  'files',
  'updates',
] as const;

export type TimelineEventCategory = (typeof TIMELINE_EVENT_CATEGORIES)[number];

export const getTimelineEventCategory = ({
  event,
  linkedObjectNameSingularById,
}: {
  event: TimelineActivity;
  linkedObjectNameSingularById: Record<string, string>;
}): TimelineEventCategory => {
  const linkedObjectNameSingular = isDefined(event.linkedObjectMetadataId)
    ? linkedObjectNameSingularById[event.linkedObjectMetadataId]
    : undefined;

  // Calls, texts and logged emails all land as notes with a "[Call] "/"[SMS] "/
  // "[Email] " prefix — the same convention EventIconDynamicComponent reads.
  if (linkedObjectNameSingular === 'note') {
    const { activityType } = classifyNoteActivity(event.linkedRecordCachedName);

    switch (activityType) {
      case 'email':
        return 'emails';
      case 'call':
        return 'calls';
      case 'sms':
        return 'texts';
      default:
        return 'notes';
    }
  }

  switch (linkedObjectNameSingular) {
    case 'message':
      return 'emails';
    case 'task':
    case 'calendarEvent':
      return 'activities';
    case 'opportunity':
      return 'deals';
    case 'attachment':
      return 'files';
    default:
      return 'updates';
  }
};
