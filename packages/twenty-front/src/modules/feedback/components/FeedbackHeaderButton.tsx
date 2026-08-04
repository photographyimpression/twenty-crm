// Impression fork: the "leave feedback" entry point — a small icon at the
// top-right of every page, rendered as the last item in PageHeader's action row.
// One click opens the in-app "Quick request" popup (FeedbackRequestModal).
// Icon is a light bulb (Moshe's ask) = "I have an idea". IconBulb was NOT in the
// twenty-ui display barrel; it is re-exported there now. Importing it straight
// from AllIcons.ts instead breaks the Rollup build.
//
// History worth keeping: this started as a position:fixed bubble. Bottom-right
// covered the table footer and record content ("too disturbing location"), and
// a fixed top-right bubble overlaps the header's own buttons (New record, ⌘K,
// side-panel toggle). Living inside the header's flex row is what makes
// "upper right" actually safe — the layout keeps it clear of everything.
import { IconBulb } from 'twenty-ui/display';
import { IconButton } from 'twenty-ui/input';

import { isFeedbackRequestModalOpenState } from '@/feedback/states/isFeedbackRequestModalOpenState';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';

export const FeedbackHeaderButton = () => {
  const setIsFeedbackRequestModalOpen = useSetAtomState(
    isFeedbackRequestModalOpenState,
  );

  return (
    <IconButton
      Icon={IconBulb}
      size="medium"
      variant="secondary"
      // eslint-disable-next-line lingui/no-unlocalized-strings
      ariaLabel="Leave feedback"
      onClick={() => setIsFeedbackRequestModalOpen(true)}
    />
  );
};
