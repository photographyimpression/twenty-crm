import { type KeyboardEvent } from 'react';

import { useApplyObjectFilterDropdownFilterValue } from '@/object-record/object-filter-dropdown/hooks/useApplyObjectFilterDropdownFilterValue';
import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { TextInput } from '@/ui/input/components/TextInput';
import { t } from '@lingui/core/macro';

type AdvancedFilterDropdownTextInputProps = {
  recordFilter: RecordFilter;
};

export const AdvancedFilterDropdownTextInput = ({
  recordFilter,
}: AdvancedFilterDropdownTextInputProps) => {
  const { applyObjectFilterDropdownFilterValue } =
    useApplyObjectFilterDropdownFilterValue();

  const handleChange = (newValue: string) => {
    applyObjectFilterDropdownFilterValue(newValue);
  };

  // LOCAL-PATCH (board card 2026-10-07): Enter submits the value (it applies
  // live while typing) and defocuses the input — the row's "done" gesture.
  // Stop propagation so letter keys don't trigger page hotkeys.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation();

    if (event.key === 'Enter') {
      event.preventDefault();
      applyObjectFilterDropdownFilterValue(recordFilter.value ?? '');
      event.currentTarget.blur();
    }
  };

  return (
    <TextInput
      value={recordFilter.value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={t`Enter value`}
      fullWidth
    />
  );
};
