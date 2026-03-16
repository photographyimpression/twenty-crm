import { FieldContext } from '@/object-record/record-field/ui/contexts/FieldContext';
import { useIsFieldInputOnly } from '@/object-record/record-field/ui/hooks/useIsFieldInputOnly';
import { useRecordTableBodyContextOrThrow } from '@/object-record/record-table/contexts/RecordTableBodyContext';
import { useOpenRecordTableCellFromCell } from '@/object-record/record-table/record-table-cell/hooks/useOpenRecordTableCellFromCell';
import { useContext, type ReactNode } from 'react';
import { RecordTableCellDisplayContainer } from './RecordTableCellDisplayContainer';

export const RecordTableCellDisplayMode = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { recordId, isRecordFieldReadOnly: isReadOnly } =
    useContext(FieldContext);

  const { onCommandMenuDropdownOpened } = useRecordTableBodyContextOrThrow();

  const { openTableCell } = useOpenRecordTableCellFromCell();

  const isFieldInputOnly = useIsFieldInputOnly();

  const handleCommandMenuDropdown = (event: React.MouseEvent) => {
    onCommandMenuDropdownOpened(event, recordId);
  };

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();

    // Skip opening the cell if the click originated from an interactive
    // element like a phone number link or button.
    const target = event.target as HTMLElement;
    let current: HTMLElement | null = target;
    while (current && current !== event.currentTarget) {
      if (current.tagName === 'A' || current.tagName === 'BUTTON') {
        return;
      }
      current = current.parentElement;
    }

    if (!isFieldInputOnly && !isReadOnly) {
      openTableCell();
    }
  };

  return (
    <RecordTableCellDisplayContainer
      onContextMenu={handleCommandMenuDropdown}
      onClick={handleClick}
    >
      {children}
    </RecordTableCellDisplayContainer>
  );
};
