import { type RecordField } from '@/object-record/record-field/types/RecordField';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { useToggleDropdown } from '@/ui/layout/dropdown/hooks/useToggleDropdown';
import { useToggleScrollWrapper } from '@/ui/utilities/scroll/hooks/useToggleScrollWrapper';
import { type MouseEvent, useCallback } from 'react';
import { RecordTableColumnHead } from './RecordTableColumnHead';
import { RecordTableColumnHeadDropdownMenu } from './RecordTableColumnHeadDropdownMenu';

type RecordTableColumnHeadWithDropdownProps = {
  recordField: RecordField;
  objectMetadataId: string;
};

export const RecordTableColumnHeadWithDropdown = ({
  objectMetadataId,
  recordField,
}: RecordTableColumnHeadWithDropdownProps) => {
  const { toggleScrollXWrapper, toggleScrollYWrapper } =
    useToggleScrollWrapper();

  const dropdownId = recordField.fieldMetadataItemId + '-header';

  const { toggleDropdown } = useToggleDropdown();

  const handleDropdownOpen = useCallback(() => {
    toggleScrollXWrapper(false);
    toggleScrollYWrapper(false);
  }, [toggleScrollXWrapper, toggleScrollYWrapper]);

  const handleDropdownClose = useCallback(() => {
    toggleScrollXWrapper(true);
    toggleScrollYWrapper(true);
  }, [toggleScrollXWrapper, toggleScrollYWrapper]);

  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      toggleDropdown({
        dropdownComponentInstanceIdFromProps: dropdownId,
      });
    },
    [toggleDropdown, dropdownId],
  );

  return (
    <div onContextMenu={handleContextMenu}>
      <Dropdown
        onOpen={handleDropdownOpen}
        onClose={handleDropdownClose}
        dropdownId={dropdownId}
        clickableComponent={<RecordTableColumnHead recordField={recordField} />}
        dropdownComponents={
          <RecordTableColumnHeadDropdownMenu
            recordField={recordField}
            objectMetadataId={objectMetadataId}
          />
        }
        dropdownOffset={{ x: -1 }}
        dropdownPlacement="bottom-start"
      />
    </div>
  );
};
