import { Field, GraphQLISODateTime, InputType } from '@nestjs/graphql';

import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType()
export class CreateOutlookCalendarEventInput {
  @Field(() => UUIDScalarType)
  personId: string;

  @Field(() => String)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @Field(() => GraphQLISODateTime)
  startsAt: Date;

  @Field(() => GraphQLISODateTime)
  endsAt: Date;

  @Field(() => Boolean, { defaultValue: false })
  isTeamsMeeting: boolean;
}
