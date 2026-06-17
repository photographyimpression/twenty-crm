import { isDefined } from 'twenty-shared/utils';
import { type SelectQueryBuilder } from 'typeorm';

import { addPersonEmailFiltersToQueryBuilder } from 'src/modules/match-participant/utils/add-person-email-filters-to-query-builder';
import { type MessageWithParticipants } from 'src/modules/messaging/message-import-manager/types/message';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

// Structural type so the helper accepts both the upstream TypeORM Repository
// and Twenty's WorkspaceRepository, which extends Repository but has stricter
// overrides that confuse direct assignment.
type PersonRepositoryLike = {
  createQueryBuilder: (
    alias: string,
  ) => SelectQueryBuilder<PersonWorkspaceEntity>;
};

// Keep only messages where at least one non-self participant matches an
// existing CRM Person (primary or additional email). Drops the rest before
// persistence so the workspace DB stays scoped to relationship-relevant mail.
// Self handles (the connected account + aliases) are excluded so that
// outbound mail still requires the *other* side to be a known contact.
export const filterOutNonContactMessages = async ({
  messages,
  selfHandles,
  personRepository,
}: {
  messages: MessageWithParticipants[];
  selfHandles: string[];
  personRepository: PersonRepositoryLike;
}): Promise<MessageWithParticipants[]> => {
  if (messages.length === 0) {
    return [];
  }

  const normalizedSelfHandles = new Set(
    selfHandles
      .map((handle) => handle.trim().toLowerCase())
      .filter((handle) => handle.length > 0),
  );

  const candidateHandles = new Set<string>();

  for (const message of messages) {
    for (const participant of message.participants ?? []) {
      const handle = participant.handle?.trim().toLowerCase();

      if (
        isDefined(handle) &&
        handle.length > 0 &&
        !normalizedSelfHandles.has(handle)
      ) {
        candidateHandles.add(handle);
      }
    }
  }

  if (candidateHandles.size === 0) {
    return [];
  }

  const queryBuilder = addPersonEmailFiltersToQueryBuilder({
    queryBuilder: personRepository.createQueryBuilder('person'),
    emails: [...candidateHandles],
  });

  const matchingPeople = await queryBuilder.getMany();

  const matchedHandles = new Set<string>();

  for (const person of matchingPeople) {
    const primaryEmail = person.emails?.primaryEmail?.trim().toLowerCase();

    if (isDefined(primaryEmail) && primaryEmail.length > 0) {
      matchedHandles.add(primaryEmail);
    }

    for (const additionalEmail of person.emails?.additionalEmails ?? []) {
      const normalized = additionalEmail?.trim().toLowerCase();

      if (isDefined(normalized) && normalized.length > 0) {
        matchedHandles.add(normalized);
      }
    }
  }

  if (matchedHandles.size === 0) {
    return [];
  }

  return messages.filter((message) =>
    (message.participants ?? []).some((participant) => {
      const handle = participant.handle?.trim().toLowerCase();

      return (
        isDefined(handle) &&
        handle.length > 0 &&
        !normalizedSelfHandles.has(handle) &&
        matchedHandles.has(handle)
      );
    }),
  );
};
