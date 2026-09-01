// LOCAL-PATCH: Salesmate-style inline note composer (board card 2026-08-30:
// "Isn't it simpler to enter a client note directly in the center column,
// why do I need the right column preview"). Creates the note through the same
// path as the old flow (useOpenCreateActivityDrawer with openInSidePanel:
// false) but renders the SAME rich-text editor the side panel uses, directly
// in the timeline's center column. Autosaves as you type; Done closes it.
// Closing an EMPTY composer deletes the throwaway note so accidental clicks
// never litter the timeline.
import { ActivityRichTextEditor } from '@/activities/components/ActivityRichTextEditor';
import { useDeleteOneRecord } from '@/object-record/hooks/useDeleteOneRecord';
import { recordStoreFamilyState } from '@/object-record/record-store/states/recordStoreFamilyState';
import { styled } from '@linaria/react';
import { useStore } from 'jotai';
import { t } from '@lingui/core/macro';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { IconX } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledInlineNoteCard = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const StyledInlineNoteHeader = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  margin-bottom: ${themeCssVariables.spacing[2]};
`;

// A blocknote doc with no text — either the field is still unset, or it holds
// only empty paragraph blocks.
const isEmptyBlocknote = (blocknote: string | null | undefined) => {
  if (!blocknote) return true;
  try {
    const blocks = JSON.parse(blocknote);
    if (!Array.isArray(blocks) || blocks.length === 0) return true;
    return blocks.every(
      (block: { content?: unknown[] }) =>
        !block.content || block.content.length === 0,
    );
  } catch {
    return false;
  }
};

export const TimelineInlineNoteEditor = ({
  noteId,
  onClose,
}: {
  noteId: string;
  onClose: () => void;
}) => {
  const store = useStore();
  const { deleteOneRecord } = useDeleteOneRecord({
    objectNameSingular: CoreObjectNameSingular.Note,
  });

  const handleClose = async () => {
    // An accidental open that never got text shouldn't leave an empty note
    // on the timeline — delete the throwaway record.
    const note = store.get(recordStoreFamilyState.atomFamily(noteId)) as
      | { bodyV2?: { blocknote?: string | null } | null }
      | undefined;
    if (!note || isEmptyBlocknote(note.bodyV2?.blocknote)) {
      try {
        await deleteOneRecord(noteId);
      } catch {
        // If the delete fails (permissions, cache race) just close — an empty
        // note is the same behavior the old side-panel flow produced.
      }
    }
    onClose();
  };

  return (
    <StyledInlineNoteCard data-testid="inline-note-composer">
      <StyledInlineNoteHeader>
        <span>{t`New note — saves as you type`}</span>
        <Button
          Icon={IconX}
          size="small"
          variant="secondary"
          title={t`Done`}
          onClick={handleClose}
        />
      </StyledInlineNoteHeader>
      <ActivityRichTextEditor
        activityId={noteId}
        activityObjectNameSingular={CoreObjectNameSingular.Note}
      />
    </StyledInlineNoteCard>
  );
};
