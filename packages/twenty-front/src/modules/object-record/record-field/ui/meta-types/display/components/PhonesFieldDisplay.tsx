import { useCallContext } from '@/calls/contexts/CallProvider';
import { useFieldFocus } from '@/object-record/record-field/ui/hooks/useFieldFocus';
import { usePhonesFieldDisplay } from '@/object-record/record-field/ui/meta-types/hooks/usePhonesFieldDisplay';
import { PhonesDisplay } from '@/ui/field/display/components/PhonesDisplay';
import { useLingui } from '@lingui/react/macro';
import React from 'react';
import { FieldMetadataSettingsOnClickAction } from 'twenty-shared/types';
import { useCopyToClipboard } from '~/hooks/useCopyToClipboard';

export const PhonesFieldDisplay = () => {
  const { fieldValue, fieldDefinition } = usePhonesFieldDisplay();
  const { copyToClipboard } = useCopyToClipboard();
  const { isFocused } = useFieldFocus();
  const { dial } = useCallContext();

  const { t } = useLingui();

  const onClickAction = fieldDefinition.metadata.settings?.clickAction;

  const handleClick = async (
    phoneNumber: string,
    event: React.MouseEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (onClickAction === FieldMetadataSettingsOnClickAction.COPY) {
      copyToClipboard(phoneNumber, t`Phone number copied to clipboard`);
    } else {
      dial(phoneNumber);
    }
  };

  return (
    <PhonesDisplay
      value={fieldValue}
      isFocused={isFocused}
      onPhoneNumberClick={handleClick}
    />
  );
};
