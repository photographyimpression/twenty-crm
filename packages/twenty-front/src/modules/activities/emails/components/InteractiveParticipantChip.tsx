import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { capitalize, isDefined } from 'twenty-shared/utils';
import { Avatar, IconUserPlus } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { ParticipantChip } from '@/activities/components/ParticipantChip';
import { type EmailThreadMessageParticipant } from '@/activities/emails/types/EmailThreadMessageParticipant';
import { getDisplayNameFromParticipant } from '@/activities/emails/utils/getDisplayNameFromParticipant';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';

type Variant = 'default' | 'bold';

type InteractiveParticipantChipProps = {
  participant: EmailThreadMessageParticipant;
  variant?: Variant;
};

const StyledClickableChip = styled.button<{
  variant: Variant;
  added: boolean;
}>`
  align-items: center;
  background: transparent;
  border: 1px dashed
    ${({ added }) =>
      added
        ? themeCssVariables.border.color.light
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  cursor: ${({ added }) => (added ? 'default' : 'pointer')};
  display: inline-flex;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${({ variant }) =>
    variant === 'bold'
      ? themeCssVariables.font.weight.medium
      : themeCssVariables.font.weight.regular};
  gap: ${themeCssVariables.spacing[1]};
  height: 24px;
  padding: 0 ${themeCssVariables.spacing[1]};

  &:hover:not(:disabled) {
    background: ${themeCssVariables.background.transparent.lighter};
    border-color: ${themeCssVariables.border.color.strong};
  }
`;

const StyledIconWrap = styled.span`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: inline-flex;
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

// Renders a participant as either:
// - a record chip linking to the Person record (when one exists), or
// - a clickable "+ Add Contact" pill that creates the Person on click and
//   then morphs into the linked record chip.
//
// Recipients in the "to:" line and senders both use this so the user can
// add anyone in an email to their CRM in one click.
export const InteractiveParticipantChip = ({
  participant,
  variant = 'default',
}: InteractiveParticipantChipProps) => {
  const [isCreating, setIsCreating] = useState(false);
  const [createdPerson, setCreatedPerson] = useState<{
    id: string;
    name: { firstName: string; lastName: string };
    avatarUrl?: string;
  } | null>(null);
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  const { createOneRecord } = useCreateOneRecord({
    objectNameSingular: CoreObjectNameSingular.Person,
  });

  const linkedPerson = participant.person ?? createdPerson;
  const isLinked =
    isDefined(linkedPerson?.id) || isDefined(participant.workspaceMember?.id);

  if (isLinked) {
    // RecordChip itself navigates to /object/person/:id when clicked.
    const merged = createdPerson
      ? { ...participant, person: createdPerson }
      : participant;

    return <ParticipantChip participant={merged} variant={variant} />;
  }

  const displayName = getDisplayNameFromParticipant({
    participant,
    shouldUseFullName: true,
  });

  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();

    if (isCreating) {
      return;
    }

    setIsCreating(true);

    try {
      const { firstName, lastName } = splitName(
        participant.handle,
        participant.displayName,
      );

      const created = await createOneRecord({
        name: { firstName, lastName },
        emails: {
          primaryEmail: participant.handle.toLowerCase(),
          additionalEmails: null,
        },
      });

      if (created?.id) {
        setCreatedPerson({
          id: created.id,
          name: { firstName, lastName },
          avatarUrl: undefined,
        });
        enqueueSuccessSnackBar({ message: t`Contact added` });
      }
    } catch {
      enqueueErrorSnackBar({ message: t`Failed to add contact` });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <StyledClickableChip
      type="button"
      variant={variant}
      added={false}
      onClick={handleClick}
      disabled={isCreating}
      title={t`Click to add to CRM`}
    >
      <Avatar
        avatarUrl=""
        type="rounded"
        placeholder={displayName}
        size="sm"
      />
      <span>{displayName}</span>
      <StyledIconWrap>
        <IconUserPlus size={12} />
      </StyledIconWrap>
    </StyledClickableChip>
  );
};
