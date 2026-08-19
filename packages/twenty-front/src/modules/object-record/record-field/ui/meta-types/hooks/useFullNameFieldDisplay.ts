import { useContext } from 'react';

import { type FieldFullNameValue } from '@/object-record/record-field/ui/types/FieldMetadata';

import { useRecordFieldValue } from '@/object-record/record-store/hooks/useRecordFieldValue';
import { FieldContext } from '@/object-record/record-field/ui/contexts/FieldContext';

export const useFullNameFieldDisplay = () => {
  const { recordId, fieldDefinition, isLabelIdentifier } =
    useContext(FieldContext);

  const fieldName = fieldDefinition.metadata.fieldName;

  const fieldValue = useRecordFieldValue<FieldFullNameValue | undefined>(
    recordId,
    fieldName,
    fieldDefinition,
  );

  return {
    fieldDefinition,
    fieldValue,
    recordId,
    isLabelIdentifier: isLabelIdentifier ?? false,
  };
};
