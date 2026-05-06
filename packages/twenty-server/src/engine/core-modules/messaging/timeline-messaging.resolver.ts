import { UseGuards } from '@nestjs/common';
import { Args, ArgsType, Field, Int, Mutation, Query } from '@nestjs/graphql';

import { Max } from 'class-validator';
import { PermissionFlagType } from 'twenty-shared/constants';

import { CoreResolver } from 'src/engine/api/graphql/graphql-config/decorators/core-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { TIMELINE_THREADS_MAX_PAGE_SIZE } from 'src/engine/core-modules/messaging/constants/messaging.constants';
import { DismissReconnectAccountBannerInput } from 'src/engine/core-modules/messaging/dtos/dismiss-reconnect-account-banner.input';
import { TimelineThreadsWithTotalDTO } from 'src/engine/core-modules/messaging/dtos/timeline-threads-with-total.dto';
import { EmailReplyService } from 'src/engine/core-modules/messaging/services/email-reply.service';
import { EmailSendService } from 'src/engine/core-modules/messaging/services/email-send.service';
import { GetMessagesService } from 'src/engine/core-modules/messaging/services/get-messages.service';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { AccountsToReconnectService } from 'src/modules/connected-account/services/accounts-to-reconnect.service';

@ArgsType()
class GetTimelineThreadsFromPersonIdArgs {
  @Field(() => UUIDScalarType)
  personId: string;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  @Max(TIMELINE_THREADS_MAX_PAGE_SIZE)
  pageSize: number;
}

@ArgsType()
class GetTimelineThreadsFromCompanyIdArgs {
  @Field(() => UUIDScalarType)
  companyId: string;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  @Max(TIMELINE_THREADS_MAX_PAGE_SIZE)
  pageSize: number;
}

@ArgsType()
class GetTimelineThreadsFromOpportunityIdArgs {
  @Field(() => UUIDScalarType)
  opportunityId: string;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  @Max(TIMELINE_THREADS_MAX_PAGE_SIZE)
  pageSize: number;
}

@ArgsType()
class GetTimelineThreadsForCurrentWorkspaceMemberArgs {
  @Field(() => Int)
  page: number;

  @Field(() => Int)
  @Max(TIMELINE_THREADS_MAX_PAGE_SIZE)
  pageSize: number;

  @Field(() => String, { nullable: true })
  folder?: 'inbox' | 'sent' | null;

  @Field(() => String, { nullable: true })
  search?: string | null;
}

@ArgsType()
class ReplyToEmailThreadArgs {
  @Field(() => UUIDScalarType)
  threadId: string;

  @Field()
  body: string;
}

@ArgsType()
class SendNewEmailArgs {
  @Field()
  to: string;

  @Field()
  subject: string;

  @Field()
  body: string;
}

@UseGuards(WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
@CoreResolver(() => TimelineThreadsWithTotalDTO)
export class TimelineMessagingResolver {
  constructor(
    private readonly getMessagesFromPersonIdsService: GetMessagesService,
    private readonly userService: UserService,
    private readonly accountsToReconnectService: AccountsToReconnectService,
    private readonly emailReplyService: EmailReplyService,
    private readonly emailSendService: EmailSendService,
  ) {}

  @Query(() => TimelineThreadsWithTotalDTO)
  async getTimelineThreadsFromPersonId(
    @AuthUser() user: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args() { personId, page, pageSize }: GetTimelineThreadsFromPersonIdArgs,
  ) {
    const workspaceMember = await this.userService.loadWorkspaceMember(
      user,
      workspace,
    );

    if (!workspaceMember) {
      return;
    }

    const timelineThreads =
      await this.getMessagesFromPersonIdsService.getMessagesFromPersonIds(
        workspaceMember.id,
        [personId],
        workspace.id,
        page,
        pageSize,
      );

    return timelineThreads;
  }

  @Query(() => TimelineThreadsWithTotalDTO)
  async getTimelineThreadsFromCompanyId(
    @AuthUser() user: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args() { companyId, page, pageSize }: GetTimelineThreadsFromCompanyIdArgs,
  ) {
    const workspaceMember = await this.userService.loadWorkspaceMember(
      user,
      workspace,
    );

    if (!workspaceMember) {
      return;
    }

    const timelineThreads =
      await this.getMessagesFromPersonIdsService.getMessagesFromCompanyId(
        workspaceMember.id,
        companyId,
        workspace.id,
        page,
        pageSize,
      );

    return timelineThreads;
  }

  @Query(() => TimelineThreadsWithTotalDTO)
  async getTimelineThreadsFromOpportunityId(
    @AuthUser() user: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args()
    { opportunityId, page, pageSize }: GetTimelineThreadsFromOpportunityIdArgs,
  ) {
    const workspaceMember = await this.userService.loadWorkspaceMember(
      user,
      workspace,
    );

    if (!workspaceMember) {
      return;
    }

    const timelineThreads =
      await this.getMessagesFromPersonIdsService.getMessagesFromOpportunityId(
        workspaceMember.id,
        opportunityId,
        workspace.id,
        page,
        pageSize,
      );

    return timelineThreads;
  }

  @Query(() => TimelineThreadsWithTotalDTO)
  async getTimelineThreadsFromCurrentWorkspaceMember(
    @AuthUser() user: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args()
    {
      page,
      pageSize,
      folder,
      search,
    }: GetTimelineThreadsForCurrentWorkspaceMemberArgs,
  ) {
    const workspaceMember = await this.userService.loadWorkspaceMember(
      user,
      workspace,
    );

    if (!workspaceMember) {
      return;
    }

    const normalizedFolder: 'inbox' | 'sent' =
      folder === 'sent' ? 'sent' : 'inbox';

    const timelineThreads =
      await this.getMessagesFromPersonIdsService.getMessagesForCurrentWorkspaceMember(
        workspaceMember.id,
        workspace.id,
        page,
        pageSize,
        normalizedFolder,
        search,
      );

    return timelineThreads;
  }

  @Mutation(() => Boolean)
  async replyToEmailThread(
    @AuthUser() user: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args() { threadId, body }: ReplyToEmailThreadArgs,
  ): Promise<boolean> {
    const workspaceMember = await this.userService.loadWorkspaceMember(
      user,
      workspace,
    );

    if (!workspaceMember) {
      return false;
    }

    const result = await this.emailReplyService.replyToThread({
      threadId,
      body,
      workspaceId: workspace.id,
      workspaceMemberId: workspaceMember.id,
    });

    return result.ok;
  }

  @Mutation(() => Boolean)
  async sendNewEmail(
    @AuthUser() user: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args() { to, subject, body }: SendNewEmailArgs,
  ): Promise<boolean> {
    const workspaceMember = await this.userService.loadWorkspaceMember(
      user,
      workspace,
    );

    if (!workspaceMember) {
      return false;
    }

    const result = await this.emailSendService.sendNewEmail({
      to,
      subject,
      body,
      workspaceId: workspace.id,
      workspaceMemberId: workspaceMember.id,
    });

    return result.ok;
  }

  @UseGuards(SettingsPermissionGuard(PermissionFlagType.CONNECTED_ACCOUNTS))
  @Mutation(() => Boolean)
  async dismissReconnectAccountBanner(
    @AuthUser() user: AuthContextUser,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args() { connectedAccountId }: DismissReconnectAccountBannerInput,
  ): Promise<boolean> {
    await this.accountsToReconnectService.removeAccountToReconnect(
      user.id,
      workspace.id,
      connectedAccountId,
    );

    return true;
  }
}
