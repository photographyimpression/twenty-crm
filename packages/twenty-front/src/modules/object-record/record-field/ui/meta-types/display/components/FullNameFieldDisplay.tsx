import { isNonEmptyString } from '@sniptt/guards';
import { styled } from '@linaria/react';

import { allowRequestsToTwentyIconsState } from '@/client-config/states/allowRequestsToTwentyIcons';
import { useFullNameFieldDisplay } from '@/object-record/record-field/ui/meta-types/hooks/useFullNameFieldDisplay';
import { recordStoreIdentifierFamilySelector } from '@/object-record/record-store/states/selectors/recordStoreIdentifierFamilySelector';
import { TextDisplay } from '@/ui/field/display/components/TextDisplay';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { Avatar } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

// LOCAL-PATCH: salesmate-style list polish — the name column shows a colored
// initial avatar before the name (photos win when the record has one).
const StyledNameRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

export const FullNameFieldDisplay = () => {
  const { fieldValue, recordId, isLabelIdentifier } = useFullNameFieldDisplay();

  const content = [fieldValue?.firstName, fieldValue?.lastName]
    .filter(isNonEmptyString)
    .join(' ');

  const allowRequestsToTwentyIcons = useAtomStateValue(
    allowRequestsToTwentyIconsState,
  );

  const recordIdentifier = useAtomFamilySelectorValue(
    recordStoreIdentifierFamilySelector,
    {
      recordId,
      allowRequestsToTwentyIcons,
    },
  );

  if (isLabelIdentifier) {
    return (
      <StyledNameRow>
        <Avatar
          avatarUrl={recordIdentifier?.avatarUrl}
          placeholder={content || '-'}
          placeholderColorSeed={recordId}
          size="lg"
          type="rounded"
        />
        <TextDisplay text={content} />
      </StyledNameRow>
    );
  }

  return <TextDisplay text={content} />;
};
