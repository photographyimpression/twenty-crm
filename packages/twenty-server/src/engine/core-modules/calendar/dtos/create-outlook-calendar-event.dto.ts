import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('CreateOutlookCalendarEventResult')
export class CreateOutlookCalendarEventResultDTO {
  @Field(() => String)
  eventId: string;

  @Field(() => String, { nullable: true })
  joinUrl?: string;

  @Field(() => String, { nullable: true })
  webLink?: string;
}
