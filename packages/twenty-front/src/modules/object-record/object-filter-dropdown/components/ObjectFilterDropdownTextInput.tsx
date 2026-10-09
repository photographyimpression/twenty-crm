import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useState,
} from 'react';

import { useApplyObjectFilterDropdownFilterValue } from '@/object-record/object-filter-dropdown/hooks/useApplyObjectFilterDropdownFilterValue';
import { useObjectFilterDropdownFilterValue } from '@/object-record/object-filter-dropdown/hooks/useObjectFilterDropdownFilterValue';
import { fieldMetadataItemUsedInDropdownComponentSelector } from '@/object-record/object-filter-dropdown/states/fieldMetadataItemUsedInDropdownComponentSelector';
import { DropdownMenuInput } from '@/ui/layout/dropdown/components/DropdownMenuInput';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { useAtomComponentSelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentSelectorValue';

type ObjectFilterDropdownTextInputProps = {
  filterDropdownId: string;
};

export const ObjectFilterDropdownTextInput = ({
  filterDropdownId,
}: ObjectFilterDropdownTextInputProps) => {
  const fieldMetadataItemUsedInDropdown = useAtomComponentSelectorValue(
    fieldMetadataItemUsedInDropdownComponentSelector,
  );

  const { objectFilterDropdownFilterValue } =
    useObjectFilterDropdownFilterValue();

  const { applyObjectFilterDropdownFilterValue } =
    useApplyObjectFilterDropdownFilterValue();

  const { closeDropdown } = useCloseDropdown();

  const [hasFocused, setHasFocused] = useState(false);

  const handleInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (Boolean(node) && !hasFocused) {
        node?.focus();
        node?.select();
        setHasFocused(true);
      }
    },
    [hasFocused],
  );

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;

    applyObjectFilterDropdownFilterValue(newValue);
  };

  // LOCAL-PATCH (board card 2026-10-07): Enter must submit the value AND
  // close the filter box. The hotkey-based onEnter path depends on the
  // focus-stack state and could silently no-op; a direct keydown handler on
  // the input always runs.
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();

      applyObjectFilterDropdownFilterValue(
        objectFilterDropdownFilterValue ?? '',
      );
      closeDropdown(filterDropdownId);
    }
  };

  return (
    <DropdownMenuItemsContainer>
      <DropdownMenuInput
        instanceId={filterDropdownId}
        ref={handleInputRef}
        value={objectFilterDropdownFilterValue ?? ''}
        autoFocus
        type="text"
        placeholder={fieldMetadataItemUsedInDropdown?.label}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onEnter={() => {
          closeDropdown(filterDropdownId);
        }}
      />
    </DropdownMenuItemsContainer>
  );
};
