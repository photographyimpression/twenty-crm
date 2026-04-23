import { Module } from '@nestjs/common';

import { MicrosoftCalendarCreateEventService } from 'src/modules/calendar/calendar-event-import-manager/drivers/microsoft-calendar/services/microsoft-calendar-create-event.service';
import { MicrosoftCalendarGetEventsService } from 'src/modules/calendar/calendar-event-import-manager/drivers/microsoft-calendar/services/microsoft-calendar-get-events.service';
import { MicrosoftCalendarImportEventsService } from 'src/modules/calendar/calendar-event-import-manager/drivers/microsoft-calendar/services/microsoft-calendar-import-events.service';
import { OAuth2ClientManagerModule } from 'src/modules/connected-account/oauth2-client-manager/oauth2-client-manager.module';

@Module({
  imports: [OAuth2ClientManagerModule],
  providers: [
    MicrosoftCalendarGetEventsService,
    MicrosoftCalendarImportEventsService,
    MicrosoftCalendarCreateEventService,
  ],
  exports: [
    MicrosoftCalendarGetEventsService,
    MicrosoftCalendarImportEventsService,
    MicrosoftCalendarCreateEventService,
  ],
})
export class MicrosoftCalendarDriverModule {}
