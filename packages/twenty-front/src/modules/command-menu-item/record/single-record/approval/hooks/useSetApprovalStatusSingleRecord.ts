import { useSelectedRecordIdOrThrow } from '@/command-menu-item/record/single-record/hooks/useSelectedRecordIdOrThrow';
import { useContextStoreObjectMetadataItemOrThrow } from '@/context-store/hooks/useContextStoreObjectMetadataItemOrThrow';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useCallback } from 'react';

// Sets the approvalStatus SELECT field on the currently selected Approval
// record using the standard updateOne mutation, so the user can triage from
// the record table without opening the row.
export const useSetApprovalStatusSingleRecord = (
  approvalStatus: 'APPROVED' | 'REJECTED',
) => {
  const recordId = useSelectedRecordIdOrThrow();
  const { objectMetadataItem } = useContextStoreObjectMetadataItemOrThrow();
  const { updateOneRecord } = useUpdateOneRecord();

  const setApprovalStatus = useCallback(() => {
    updateOneRecord({
      objectNameSingular: objectMetadataItem.nameSingular,
      idToUpdate: recordId,
      updateOneRecordInput: { approvalStatus },
    });
  }, [
    updateOneRecord,
    objectMetadataItem.nameSingular,
    recordId,
    approvalStatus,
  ]);

  return { setApprovalStatus };
};
