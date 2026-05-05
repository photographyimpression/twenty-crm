import { styled } from '@linaria/react';
import { Trans } from '@lingui/react/macro';

import { InteractiveParticipantChip } from '@/activities/emails/components/InteractiveParticipantChip';
import { type EmailThreadMessageParticipant } from '@/activities/emails/types/EmailThreadMessageParticipant';
import { themeCssVariables } from 'twenty-ui/theme-constants';

type EmailThreadMessageReceiversProps = {
  receivers: EmailThreadMessageParticipant[];
};

const StyledThreadMessageReceivers = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex-wrap: wrap;
  font-size: ${themeCssVariables.font.size.xs};
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[0]}
    ${themeCssVariables.spacing[0]} ${themeCssVariables.spacing[1]};
`;

const StyledLabel = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  margin-right: ${themeCssVariables.spacing[1]};
`;

export const EmailThreadMessageReceivers = ({
  receivers,
}: EmailThreadMessageReceiversProps) => {
  return (
    <StyledThreadMessageReceivers>
      <StyledLabel>
        <Trans>to:</Trans>
      </StyledLabel>
      {receivers.map((receiver) => (
        <InteractiveParticipantChip
          key={`${receiver.id}-${receiver.handle}`}
          participant={receiver}
        />
      ))}
    </StyledThreadMessageReceivers>
  );
};
