import { Injectable } from '@nestjs/common';

import { parseMicrosoftCalendarError } from 'src/modules/calendar/calendar-event-import-manager/drivers/microsoft-calendar/utils/parse-microsoft-calendar-error.util';
import { OAuth2ClientManagerService } from 'src/modules/connected-account/oauth2-client-manager/services/oauth2-client-manager.service';
import { type ConnectedAccountWorkspaceEntity } from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';

export type MicrosoftCalendarCreateEventInput = {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  attendees: Array<{ email: string; name?: string }>;
  isTeamsMeeting?: boolean;
};

export type MicrosoftCalendarCreateEventResponse = {
  eventId: string;
  joinUrl?: string;
  webLink?: string;
};

@Injectable()
export class MicrosoftCalendarCreateEventService {
  constructor(
    private readonly oAuth2ClientManagerService: OAuth2ClientManagerService,
  ) {}

  public async createCalendarEvent(
    connectedAccount: Pick<
      ConnectedAccountWorkspaceEntity,
      'provider' | 'accessToken' | 'refreshToken' | 'id'
    >,
    input: MicrosoftCalendarCreateEventInput,
  ): Promise<MicrosoftCalendarCreateEventResponse> {
    try {
      const microsoftClient =
        await this.oAuth2ClientManagerService.getMicrosoftOAuth2Client(
          connectedAccount,
        );

      const body = this.composeEventPayload(input);

      const response = await microsoftClient.api('/me/events').post(body);

      return {
        eventId: response.id,
        joinUrl: response.onlineMeeting?.joinUrl,
        webLink: response.webLink,
      };
    } catch (error) {
      throw parseMicrosoftCalendarError(error);
    }
  }

  private composeEventPayload(
    input: MicrosoftCalendarCreateEventInput,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      subject: input.title,
      body: {
        contentType: 'HTML',
        content: input.description ?? '',
      },
      start: {
        dateTime: input.startsAt.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: input.endsAt.toISOString(),
        timeZone: 'UTC',
      },
      attendees: input.attendees.map((attendee) => ({
        emailAddress: {
          address: attendee.email,
          name: attendee.name ?? attendee.email,
        },
        type: 'required',
      })),
    };

    if (input.isTeamsMeeting) {
      payload.isOnlineMeeting = true;
      payload.onlineMeetingProvider = 'teamsForBusiness';
    }

    return payload;
  }
}
