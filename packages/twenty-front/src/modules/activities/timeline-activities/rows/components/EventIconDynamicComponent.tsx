import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { classifyNoteActivity } from '@/activities/timeline-activities/utils/classifyNoteActivity';
import { type ObjectMetadataItem } from '@/object-metadata/types/ObjectMetadataItem';
import {
  IconCirclePlus,
  IconEditCircle,
  IconMail,
  IconMessage,
  IconNotes,
  IconPhone,
  IconRestore,
  IconSparkles,
  IconTrash,
  useIcons,
} from 'twenty-ui/display';

const NOTE_TYPE_ICONS = {
  email: IconMail,
  sms: IconMessage,
  call: IconPhone,
  aiSummary: IconSparkles,
  note: IconNotes,
} as const;

export const EventIconDynamicComponent = ({
  event,
  linkedObjectMetadataItem,
}: {
  event: TimelineActivity;
  linkedObjectMetadataItem: ObjectMetadataItem | null;
}) => {
  const { getIcon } = useIcons();
  const [eventLinkedObject, eventAction] = event.name.split('.');

  // For linked notes, show type-specific icons based on title
  if (
    linkedObjectMetadataItem?.nameSingular === 'note' &&
    (eventLinkedObject === 'linked-note' || eventAction === 'linked')
  ) {
    const classification = classifyNoteActivity(
      event.linkedRecordCachedName,
    );
    const NoteIcon = NOTE_TYPE_ICONS[classification.activityType];
    return <NoteIcon />;
  }

  if (eventAction === 'created') {
    return <IconCirclePlus />;
  }
  if (eventAction === 'updated') {
    return <IconEditCircle />;
  }
  if (eventAction === 'deleted') {
    return <IconTrash />;
  }
  if (eventAction === 'restored') {
    return <IconRestore />;
  }

  const IconComponent = getIcon(linkedObjectMetadataItem?.icon);

  return <IconComponent />;
};
