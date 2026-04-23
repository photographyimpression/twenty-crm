import { Module } from '@nestjs/common';

import { OutlookCalendarEventService } from 'src/engine/core-modules/calendar/outlook-calendar-event.service';
import { TimelineCalendarEventResolver } from 'src/engine/core-modules/calendar/timeline-calendar-event.resolver';
import { TimelineCalendarEventService } from 'src/engine/core-modules/calendar/timeline-calendar-event.service';
import { UserModule } from 'src/engine/core-modules/user/user.module';
import { MicrosoftCalendarDriverModule } from 'src/modules/calendar/calendar-event-import-manager/drivers/microsoft-calendar/microsoft-calendar-driver.module';

@Module({
  imports: [UserModule, MicrosoftCalendarDriverModule],
  exports: [],
  providers: [
    TimelineCalendarEventResolver,
    TimelineCalendarEventService,
    OutlookCalendarEventService,
  ],
})
export class TimelineCalendarEventModule {}
