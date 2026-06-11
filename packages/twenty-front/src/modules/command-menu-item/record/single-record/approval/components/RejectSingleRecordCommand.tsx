import { Command } from '@/command-menu-item/display/components/Command';
import { useSetApprovalStatusSingleRecord } from '@/command-menu-item/record/single-record/approval/hooks/useSetApprovalStatusSingleRecord';

export const RejectSingleRecordCommand = () => {
  const { setApprovalStatus } = useSetApprovalStatusSingleRecord('REJECTED');

  return <Command onClick={setApprovalStatus} />;
};
