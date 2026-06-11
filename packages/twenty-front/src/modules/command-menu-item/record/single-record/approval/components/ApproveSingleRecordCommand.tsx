import { Command } from '@/command-menu-item/display/components/Command';
import { useSetApprovalStatusSingleRecord } from '@/command-menu-item/record/single-record/approval/hooks/useSetApprovalStatusSingleRecord';

export const ApproveSingleRecordCommand = () => {
  const { setApprovalStatus } = useSetApprovalStatusSingleRecord('APPROVED');

  return <Command onClick={setApprovalStatus} />;
};
