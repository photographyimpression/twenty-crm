import { type ObjectMetadataItem } from '@/object-metadata/types/ObjectMetadataItem';
import { hasObjectMetadataItemFieldCreatedBy } from '@/object-metadata/utils/hasObjectMetadataItemFieldCreatedBy';
import { hasObjectMetadataItemPositionField } from '@/object-metadata/utils/hasObjectMetadataItemPositionField';
import { type FieldActorForInputValue } from '@/object-record/record-field/ui/types/FieldMetadata';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';

export const computeOptimisticCreateRecordBaseRecordInput = (
  objectMetadataItem: ObjectMetadataItem,
) => {
  const baseRecordInput: Partial<ObjectRecord> = {};

  if (hasObjectMetadataItemFieldCreatedBy(objectMetadataItem)) {
    baseRecordInput.createdBy = {
      source: 'MANUAL',
      context: {},
    } satisfies FieldActorForInputValue;
  }

  if (hasObjectMetadataItemPositionField(objectMetadataItem)) {
    baseRecordInput.position = Number.NEGATIVE_INFINITY;
  }

  // The server stamps createdAt; mirror it optimistically so "Created X ago"
  // labels render the instant a new record's panel opens, not after the
  // mutation response lands.
  if (
    objectMetadataItem.fields.some(
      (field) => field.name === 'createdAt' && field.isSystem,
    )
  ) {
    baseRecordInput.createdAt = new Date().toISOString();
  }

  return baseRecordInput;
};
