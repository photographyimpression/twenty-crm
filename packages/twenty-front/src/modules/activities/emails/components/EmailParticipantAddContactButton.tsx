import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { capitalize } from 'twenty-shared/utils';
import { IconUserPlus } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type EmailThreadMessageParticipant } from '@/activities/emails/types/EmailThreadMessageParticipant';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';

type EmailParticipantAddContactButtonProps = {
  participant: EmailThreadMessageParticipant;
};

const StyledButton = styled.button`
  align-items: center;
  background: transparent;
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  display: inline-flex;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[1]};
  height: 22px;
  margin-left: ${themeCssVariables.spacing[2]};
  padding: 0 ${themeCssVariables.spacing[2]};

  &:hover:not(:disabled) {
    background: ${themeCssVariables.background.transparent.lighter};
    color: ${themeCssVariables.font.color.primary};
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const splitName = (
  handle: string,
  displayName: string,
): { firstName: string; lastName: string } => {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);

  if (parts.length > 0) {
    return {
      firstName: capitalize(parts[0]),
      lastName: capitalize(parts.slice(1).join(' ')),
    };
  }

  const local = handle.split('@')[0] ?? '';
  const localParts = local.split(/[._-]+/).filter(Boolean);

  return {
    firstName: capitalize(localParts[0] ?? ''),
    lastName: capitalize(localParts[1] ?? ''),
  };
};

export const EmailParticipantAddContactButton = ({
  participant,
}: EmailParticipantAddContactButtonProps) => {
  const [isCreated, setIsCreated] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  const { createOneRecord } = useCreateOneRecord({
    objectNameSingular: CoreObjectNameSingular.Person,
  });

  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();

    if (isCreating || isCreated) {
      return;
    }

    setIsCreating(true);

    try {
      const { firstName, lastName } = splitName(
        participant.handle,
        participant.displayName,
      );

      await createOneRecord({
        name: { firstName, lastName },
        emails: {
          primaryEmail: participant.handle.toLowerCase(),
          additionalEmails: null,
        },
      });

      setIsCreated(true);
      enqueueSuccessSnackBar({
        message: t`Contact added`,
      });
    } catch {
      enqueueErrorSnackBar({
        message: t`Failed to add contact`,
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <StyledButton
      type="button"
      onClick={handleClick}
      disabled={isCreating || isCreated}
      title={isCreated ? t`Contact added` : t`Add as contact`}
    >
      <IconUserPlus size={14} />
      {isCreated ? t`Added` : t`Add Contact`}
    </StyledButton>
  );
};
