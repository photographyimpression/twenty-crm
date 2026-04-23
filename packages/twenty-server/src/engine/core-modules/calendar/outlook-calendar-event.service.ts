import { Injectable } from '@nestjs/common';

import { ConnectedAccountProvider } from 'twenty-shared/types';

import { type CreateOutlookCalendarEventResultDTO } from 'src/engine/core-modules/calendar/dtos/create-outlook-calendar-event.dto';
import { type CreateOutlookCalendarEventInput } from 'src/engine/core-modules/calendar/dtos/create-outlook-calendar-event.input';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { MicrosoftCalendarCreateEventService } from 'src/modules/calendar/calendar-event-import-manager/drivers/microsoft-calendar/services/microsoft-calendar-create-event.service';
import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

@Injectable()
export class OutlookCalendarEventService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly microsoftCalendarCreateEventService: MicrosoftCalendarCreateEventService,
  ) {}

  async createEventForPerson({
    workspaceId,
    workspaceMemberId,
    input,
  }: {
    workspaceId: string;
    workspaceMemberId: string;
    input: CreateOutlookCalendarEventInput;
  }): Promise<CreateOutlookCalendarEventResultDTO> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const connectedAccountRepository =
          await this.globalWorkspaceOrmManager.getRepository<ConnectedAccountWorkspaceEntity>(
            workspaceId,
            'connectedAccount',
          );

        const connectedAccount = await connectedAccountRepository.findOne({
          where: {
            accountOwnerId: workspaceMemberId,
            provider: ConnectedAccountProvider.MICROSOFT,
          },
        });

        if (!connectedAccount) {
          throw new Error(
            'No connected Outlook account found. Connect Outlook in Settings → Accounts before scheduling events.',
          );
        }

        const personRepository =
          await this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
            workspaceId,
            'person',
          );

        const person = await personRepository.findOne({
          where: { id: input.personId },
        });

        if (!person) {
          throw new Error(`Person ${input.personId} not found`);
        }

        const attendeeEmail = person.emails?.primaryEmail;

        if (!attendeeEmail) {
          throw new Error(
            'This contact has no primary email — add one before scheduling a calendar event.',
          );
        }

        const attendeeName = [person.name?.firstName, person.name?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();

        const startsAt = new Date(input.startsAt);
        const endsAt = new Date(input.endsAt);

        if (endsAt <= startsAt) {
          throw new Error('Event end time must be after start time.');
        }

        return this.microsoftCalendarCreateEventService.createCalendarEvent(
          connectedAccount,
          {
            title: input.title,
            description: input.description,
            startsAt,
            endsAt,
            attendees: [
              {
                email: attendeeEmail,
                name: attendeeName || attendeeEmail,
              },
            ],
            isTeamsMeeting: input.isTeamsMeeting,
          },
        );
      },
      authContext,
    );
  }
}
