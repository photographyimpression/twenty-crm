import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties as objectRecordUpdateEventChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import {
  MessagingBackfillForContactJob,
  type MessagingBackfillForContactJobData,
} from 'src/modules/messaging/message-import-manager/jobs/messaging-backfill-for-contact.job';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

const collectEmails = (person: PersonWorkspaceEntity): string[] => {
  const emails: string[] = [];
  const primary = person.emails?.primaryEmail?.trim();

  if (isDefined(primary) && primary.length > 0) {
    emails.push(primary);
  }
  for (const additional of person.emails?.additionalEmails ?? []) {
    const normalized = additional?.trim();

    if (isDefined(normalized) && normalized.length > 0) {
      emails.push(normalized);
    }
  }

  return [...new Set(emails.map((email) => email.toLowerCase()))];
};

// On Person create or email change, scan the connected mailbox for messages
// involving that contact and queue them for import. The import filter then
// admits them because the Person now exists. This is what makes the
// "filter at import" approach safe: prospects that existed in the mailbox
// before they became contacts get pulled in retroactively.
@Injectable()
export class MessagingPersonCreatedBackfillListener {
  private readonly logger = new Logger(
    MessagingPersonCreatedBackfillListener.name,
  );

  constructor(
    @InjectMessageQueue(MessageQueue.messagingQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('person', DatabaseEventAction.CREATED)
  async handlePersonCreated(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<PersonWorkspaceEntity>
    >,
  ) {
    const enqueuedEmails = new Set<string>();

    for (const event of payload.events) {
      const emails = collectEmails(event.properties.after);

      for (const email of emails) {
        if (enqueuedEmails.has(email)) {
          continue;
        }
        enqueuedEmails.add(email);

        await this.messageQueueService.add<MessagingBackfillForContactJobData>(
          MessagingBackfillForContactJob.name,
          {
            workspaceId: payload.workspaceId,
            email,
          },
        );
      }
    }

    if (enqueuedEmails.size > 0) {
      this.logger.log(
        `Enqueued backfill for ${enqueuedEmails.size} contact email(s) in workspace ${payload.workspaceId}`,
      );
    }
  }

  @OnDatabaseBatchEvent('person', DatabaseEventAction.UPDATED)
  async handlePersonUpdated(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<PersonWorkspaceEntity>
    >,
  ) {
    const enqueuedEmails = new Set<string>();

    for (const event of payload.events) {
      const changedProperties = objectRecordUpdateEventChangedProperties(
        event.properties.before,
        event.properties.after,
      );

      if (!changedProperties.includes('emails')) {
        continue;
      }

      const beforeEmails = new Set(collectEmails(event.properties.before));
      const afterEmails = collectEmails(event.properties.after);

      for (const email of afterEmails) {
        if (beforeEmails.has(email) || enqueuedEmails.has(email)) {
          continue;
        }
        enqueuedEmails.add(email);

        await this.messageQueueService.add<MessagingBackfillForContactJobData>(
          MessagingBackfillForContactJob.name,
          {
            workspaceId: payload.workspaceId,
            email,
          },
        );
      }
    }

    if (enqueuedEmails.size > 0) {
      this.logger.log(
        `Enqueued backfill for ${enqueuedEmails.size} newly added contact email(s) in workspace ${payload.workspaceId}`,
      );
    }
  }
}
