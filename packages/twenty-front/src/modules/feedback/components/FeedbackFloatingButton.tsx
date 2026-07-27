// Impression fork: a small always-visible "Feedback" bubble pinned to the
// bottom-right of the app, modeled on the Zrizes app. Replaces the buried
// "Feedback" row in the sidebar — one click opens the same Quick request popup
// (FeedbackRequestModal) without hunting through the nav. Re-apply on upgrades.
import { styled } from '@linaria/react';
import { IconSparkles } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { isFeedbackRequestModalOpenState } from '@/feedback/states/isFeedbackRequestModalOpenState';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';

const StyledFloatingButton = styled.button`
  align-items: center;
  background: ${themeCssVariables.color.blue};
  border: none;
  border-radius: 50%;
  bottom: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  color: ${themeCssVariables.grayScale.gray1};
  cursor: pointer;
  display: flex;
  height: 40px;
  justify-content: center;
  position: fixed;
  right: 24px;
  transition:
    transform 0.1s ease,
    filter 0.1s ease;
  width: 40px;
  z-index: 20;

  &:hover {
    filter: brightness(1.05);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

export const FeedbackFloatingButton = () => {
  const setIsFeedbackRequestModalOpen = useSetAtomState(
    isFeedbackRequestModalOpenState,
  );

  return (
    <StyledFloatingButton
      type="button"
      aria-label="Leave feedback"
      title="Leave feedback"
      onClick={() => setIsFeedbackRequestModalOpen(true)}
    >
      <IconSparkles size={20} />
    </StyledFloatingButton>
  );
};
