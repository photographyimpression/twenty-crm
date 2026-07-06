import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

// Impression fork: drives the in-app "Quick request" popup. The sidebar
// Feedback item flips this to true; FeedbackRequestModal reads it.
export const isFeedbackRequestModalOpenState = createAtomState<boolean>({
  key: 'feedback/isFeedbackRequestModalOpenState',
  defaultValue: false,
});
