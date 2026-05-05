import { type TimelineThreadParticipantDTO } from 'src/engine/core-modules/messaging/dtos/timeline-thread-participant.dto';
import { formatThreadParticipant } from 'src/engine/core-modules/messaging/utils/format-thread-participant.util';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';

const EMPTY_PARTICIPANT: TimelineThreadParticipantDTO = {
  personId: null,
  workspaceMemberId: null,
  firstName: '',
  lastName: '',
  displayName: '',
  avatarUrl: '',
  handle: '',
};

export const extractParticipantSummary = (
  // The caller now controls roles via the SQL query, and may legitimately
  // pass an empty list (e.g. Sent thread where the only FROM was the user
  // themselves and we excluded them). Tolerate undefined and []
  // gracefully.
  messageParticipants: MessageParticipantWorkspaceEntity[] | undefined,
): {
  firstParticipant: TimelineThreadParticipantDTO;
  lastTwoParticipants: TimelineThreadParticipantDTO[];
  participantCount: number;
} => {
  const activeMessageParticipants = messageParticipants ?? [];

  if (activeMessageParticipants.length === 0) {
    return {
      firstParticipant: EMPTY_PARTICIPANT,
      lastTwoParticipants: [],
      participantCount: 0,
    };
  }

  const firstParticipant = formatThreadParticipant(
    activeMessageParticipants[0],
  );

  const activeMessageParticipantsWithoutFirstParticipant =
    activeMessageParticipants.filter(
      (threadParticipant) =>
        threadParticipant.handle !== firstParticipant.handle,
    );

  const lastTwoParticipants: TimelineThreadParticipantDTO[] = [];

  const lastParticipant =
    activeMessageParticipantsWithoutFirstParticipant.slice(-1)[0];

  if (lastParticipant) {
    lastTwoParticipants.push(formatThreadParticipant(lastParticipant));

    const activeMessageParticipantsWithoutFirstAndLastParticipants =
      activeMessageParticipantsWithoutFirstParticipant.filter(
        (threadParticipant) =>
          threadParticipant.handle !== lastParticipant.handle,
      );

    if (activeMessageParticipantsWithoutFirstAndLastParticipants.length > 0) {
      lastTwoParticipants.push(
        formatThreadParticipant(
          activeMessageParticipantsWithoutFirstAndLastParticipants.slice(-1)[0],
        ),
      );
    }
  }

  return {
    firstParticipant,
    lastTwoParticipants,
    participantCount: activeMessageParticipants.length,
  };
};
