import { MessageParticipantRole } from 'twenty-shared/types';
import { type SelectQueryBuilder } from 'typeorm';

import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { type MessageWithParticipants } from 'src/modules/messaging/message-import-manager/types/message';
import { filterOutNonContactMessages } from 'src/modules/messaging/message-import-manager/utils/filter-out-non-contact-messages.util';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

const buildMessage = (
  externalId: string,
  participants: { role: MessageParticipantRole; handle: string }[],
): MessageWithParticipants => ({
  externalId,
  subject: `Subject ${externalId}`,
  receivedAt: new Date('2026-05-04T12:00:00.000Z'),
  text: 'body',
  headerMessageId: `<${externalId}@test>`,
  messageThreadExternalId: `thread-${externalId}`,
  direction: MessageDirection.INCOMING,
  participants: participants.map((p) => ({
    role: p.role,
    handle: p.handle,
    displayName: p.handle,
  })),
  attachments: [],
});

type FakePerson = Pick<PersonWorkspaceEntity, 'id' | 'emails'>;

const mockPersonRepository = (people: FakePerson[]) => {
  const queryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    withDeleted: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(people),
  } as unknown as SelectQueryBuilder<PersonWorkspaceEntity>;

  return {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
  };
};

describe('filterOutNonContactMessages', () => {
  const selfHandle = 'me@company.com';

  it('returns empty when given no messages', async () => {
    const personRepository = mockPersonRepository([]);

    const result = await filterOutNonContactMessages({
      messages: [],
      selfHandles: [selfHandle],
      personRepository,
    });

    expect(result).toEqual([]);
  });

  it('keeps messages whose non-self participant matches a Person primary email', async () => {
    const messages = [
      buildMessage('contact-msg', [
        { role: MessageParticipantRole.FROM, handle: 'lead@external.com' },
        { role: MessageParticipantRole.TO, handle: selfHandle },
      ]),
      buildMessage('stranger-msg', [
        { role: MessageParticipantRole.FROM, handle: 'random@external.com' },
        { role: MessageParticipantRole.TO, handle: selfHandle },
      ]),
    ];

    const personRepository = mockPersonRepository([
      {
        id: 'person-1',
        emails: { primaryEmail: 'lead@external.com', additionalEmails: [] },
      },
    ]);

    const result = await filterOutNonContactMessages({
      messages,
      selfHandles: [selfHandle],
      personRepository,
    });

    expect(result).toHaveLength(1);
    expect(result[0].externalId).toBe('contact-msg');
  });

  it('matches additional emails on Person', async () => {
    const messages = [
      buildMessage('alt-email-msg', [
        { role: MessageParticipantRole.FROM, handle: 'alt@personal.com' },
        { role: MessageParticipantRole.TO, handle: selfHandle },
      ]),
    ];

    const personRepository = mockPersonRepository([
      {
        id: 'person-1',
        emails: {
          primaryEmail: 'work@company.com',
          additionalEmails: ['alt@personal.com'],
        },
      },
    ]);

    const result = await filterOutNonContactMessages({
      messages,
      selfHandles: [selfHandle],
      personRepository,
    });

    expect(result).toHaveLength(1);
  });

  it('is case-insensitive', async () => {
    const messages = [
      buildMessage('mixed-case-msg', [
        { role: MessageParticipantRole.FROM, handle: 'Lead@External.com' },
        { role: MessageParticipantRole.TO, handle: 'ME@company.com' },
      ]),
    ];

    const personRepository = mockPersonRepository([
      {
        id: 'person-1',
        emails: { primaryEmail: 'lead@external.com', additionalEmails: [] },
      },
    ]);

    const result = await filterOutNonContactMessages({
      messages,
      selfHandles: [selfHandle],
      personRepository,
    });

    expect(result).toHaveLength(1);
  });

  it('treats handle aliases as self (does not match against Person)', async () => {
    const messages = [
      buildMessage('alias-only-msg', [
        { role: MessageParticipantRole.FROM, handle: selfHandle },
        { role: MessageParticipantRole.TO, handle: 'alias@company.com' },
      ]),
    ];

    // Even if the alias somehow exists as a Person, alias-only messages
    // should be dropped — we want at least one external contact participant.
    const personRepository = mockPersonRepository([
      {
        id: 'person-self',
        emails: {
          primaryEmail: 'alias@company.com',
          additionalEmails: [],
        },
      },
    ]);

    const result = await filterOutNonContactMessages({
      messages,
      selfHandles: [selfHandle, 'alias@company.com'],
      personRepository,
    });

    expect(result).toEqual([]);
  });

  it('drops messages with only self participants', async () => {
    const messages = [
      buildMessage('self-only-msg', [
        { role: MessageParticipantRole.FROM, handle: selfHandle },
        { role: MessageParticipantRole.TO, handle: selfHandle },
      ]),
    ];

    const personRepository = mockPersonRepository([]);

    const result = await filterOutNonContactMessages({
      messages,
      selfHandles: [selfHandle],
      personRepository,
    });

    expect(result).toEqual([]);
  });

  it('drops messages where no participant matches any Person', async () => {
    const messages = [
      buildMessage('newsletter-msg', [
        { role: MessageParticipantRole.FROM, handle: 'noreply@news.com' },
        { role: MessageParticipantRole.TO, handle: selfHandle },
      ]),
      buildMessage('another-junk', [
        { role: MessageParticipantRole.FROM, handle: 'spam@bad.com' },
        { role: MessageParticipantRole.TO, handle: selfHandle },
      ]),
    ];

    const personRepository = mockPersonRepository([
      {
        id: 'person-1',
        emails: { primaryEmail: 'unrelated@example.com', additionalEmails: [] },
      },
    ]);

    const result = await filterOutNonContactMessages({
      messages,
      selfHandles: [selfHandle],
      personRepository,
    });

    expect(result).toEqual([]);
  });

  it('keeps a thread message when any participant (TO/CC/BCC) is a contact', async () => {
    const messages = [
      buildMessage('outbound-to-contact', [
        { role: MessageParticipantRole.FROM, handle: selfHandle },
        { role: MessageParticipantRole.TO, handle: 'lead@external.com' },
        { role: MessageParticipantRole.CC, handle: 'random@external.com' },
      ]),
    ];

    const personRepository = mockPersonRepository([
      {
        id: 'person-1',
        emails: { primaryEmail: 'lead@external.com', additionalEmails: [] },
      },
    ]);

    const result = await filterOutNonContactMessages({
      messages,
      selfHandles: [selfHandle],
      personRepository,
    });

    expect(result).toHaveLength(1);
    expect(result[0].externalId).toBe('outbound-to-contact');
  });
});
