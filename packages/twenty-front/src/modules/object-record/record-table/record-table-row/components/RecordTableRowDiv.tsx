import { TABLE_Z_INDEX } from '@/object-record/record-table/constants/TableZIndex';
import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledTr = styled.div<{
  isDragging: boolean;
  isFirstRowOfGroup?: boolean;
  isScrolledVertically?: boolean;
}>`
  --z-index-for-normal-cells: ${({
    isFirstRowOfGroup,
    isScrolledVertically,
  }) =>
    isFirstRowOfGroup === true
      ? isScrolledVertically
        ? TABLE_Z_INDEX.activeRows.firstRow.normal.scrolledVertically
        : TABLE_Z_INDEX.activeRows.firstRow.normal.noVerticalScroll
      : isScrolledVertically
        ? TABLE_Z_INDEX.activeRows.afterFirstRow.normal.scrolledVertically
        : TABLE_Z_INDEX.activeRows.afterFirstRow.normal.noVerticalScroll};

  --z-index-for-sticky-cells: ${({
    isFirstRowOfGroup,
    isScrolledVertically,
  }) =>
    isFirstRowOfGroup === true
      ? isScrolledVertically
        ? TABLE_Z_INDEX.activeRows.firstRow.sticky.scrolledVertically
        : TABLE_Z_INDEX.activeRows.firstRow.sticky.noVerticalScroll
      : isScrolledVertically
        ? TABLE_Z_INDEX.activeRows.afterFirstRow.sticky.scrolledVertically
        : TABLE_Z_INDEX.activeRows.afterFirstRow.sticky.noVerticalScroll};

  border-top: ${({ isDragging }) =>
    isDragging ? `1px solid ${themeCssVariables.border.color.medium}` : 'none'};

  display: flex;
  flex-direction: row;

  /* LOCAL-PATCH: salesmate-style list polish — soft full-row hover highlight.
     The focused/active row keeps its own stronger treatment below. Sticky
     cells need the color set on themselves or they stay transparent above
     the row background while horizontally scrolled. */
  &:not([data-focused='true']):not([data-active='true']):hover {
    background-color: ${themeCssVariables.background.secondary};

    div.table-cell:nth-of-type(1),
    div.table-cell:nth-of-type(2) {
      background-color: ${themeCssVariables.background.secondary};
    }
  }

  &[data-focused='true'],
  &[data-active='true'] {
    div.table-cell,
    div.table-cell-0-0 {
      &:not(:first-of-type) {
        background-color: ${themeCssVariables.background.tertiary};
        border-bottom: 1px solid ${themeCssVariables.border.color.medium};
        border-color: ${themeCssVariables.border.color.medium};
      }
      &:nth-of-type(2) {
        border-left: 1px solid ${themeCssVariables.border.color.medium};

        margin-left: -1px;

        div {
          margin-left: -1px;
        }
      }
      &:last-of-type {
        border-radius: 0 ${themeCssVariables.border.radius.sm}
          ${themeCssVariables.border.radius.sm} 0;
        border-right: 1px solid ${themeCssVariables.border.color.medium};
      }
    }
  }
`;

export const RecordTableRowDiv = StyledTr;
