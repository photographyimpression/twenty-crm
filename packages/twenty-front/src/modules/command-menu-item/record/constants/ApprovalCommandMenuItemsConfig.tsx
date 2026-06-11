import { ApproveSingleRecordCommand } from '@/command-menu-item/record/single-record/approval/components/ApproveSingleRecordCommand';
import { RejectSingleRecordCommand } from '@/command-menu-item/record/single-record/approval/components/RejectSingleRecordCommand';
import { ApprovalSingleRecordCommandKeys } from '@/command-menu-item/record/single-record/approval/types/ApprovalSingleRecordCommandKeys';
import { DEFAULT_RECORD_COMMAND_MENU_ITEMS_CONFIG } from '@/command-menu-item/record/constants/DefaultRecordCommandMenuItemsConfig';
import { type CommandMenuItemConfig } from '@/command-menu-item/types/CommandMenuItemConfig';
import { CommandMenuItemScope } from '@/command-menu-item/types/CommandMenuItemScope';
import { CommandMenuItemType } from '@/command-menu-item/types/CommandMenuItemType';
import { CommandMenuItemViewType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { IconCheck, IconX } from 'twenty-ui/display';

// Plain-string labels (not the msg`` macro): "Approve"/"Reject" aren't in the
// compiled Lingui catalog, so the macro renders the hash message id ("1t/NnN")
// in production instead of the text. getCommandMenuItemLabel returns a string
// label verbatim. This is a single-locale fork; literal labels are intended.
/* eslint-disable lingui/no-unlocalized-strings */

// Approval is a custom object whose approvalStatus SELECT field drives the
// email triage queue. These two record-selection commands let the user
// approve or reject a row straight from the table, without opening it.
export const APPROVAL_COMMAND_MENU_ITEMS_CONFIG: Record<
  string,
  CommandMenuItemConfig
> = {
  ...DEFAULT_RECORD_COMMAND_MENU_ITEMS_CONFIG,
  [ApprovalSingleRecordCommandKeys.APPROVE]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: ApprovalSingleRecordCommandKeys.APPROVE,
    label: 'Approve',
    shortLabel: 'Approve',
    position: -2,
    isPinned: true,
    isPrimaryCTA: true,
    Icon: IconCheck,
    accent: 'default',
    shouldBeRegistered: ({ selectedRecord, objectPermissions }) =>
      isDefined(selectedRecord) &&
      !selectedRecord.isRemote &&
      !isDefined(selectedRecord.deletedAt) &&
      objectPermissions.canUpdateObjectRecords &&
      selectedRecord.approvalStatus !== 'APPROVED',
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
    ],
    component: <ApproveSingleRecordCommand />,
  },
  [ApprovalSingleRecordCommandKeys.REJECT]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: ApprovalSingleRecordCommandKeys.REJECT,
    label: 'Reject',
    shortLabel: 'Reject',
    position: -1,
    isPinned: true,
    Icon: IconX,
    accent: 'danger',
    shouldBeRegistered: ({ selectedRecord, objectPermissions }) =>
      isDefined(selectedRecord) &&
      !selectedRecord.isRemote &&
      !isDefined(selectedRecord.deletedAt) &&
      objectPermissions.canUpdateObjectRecords &&
      selectedRecord.approvalStatus !== 'REJECTED',
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
    ],
    component: <RejectSingleRecordCommand />,
  },
};
