import { styled } from '@linaria/react';

import { ParticipantChip } from '@/activities/components/ParticipantChip';
import { EmailParticipantAddContactButton } from '@/activities/emails/components/EmailParticipantAddContactButton';
import { type EmailThreadMessageParticipant } from '@/activities/emails/types/EmailThreadMessageParticipant';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { isDefined } from 'twenty-shared/utils';
import { AppTooltip, TooltipPosition } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { dateLocaleState } from '~/localization/states/dateLocaleState';
import {
  beautifyPastDateRelativeToNow,
  formatToHumanReadableDate,
} from '~/utils/date-utils';

const StyledEmailThreadMessageSender = styled.div`
  display: flex;
  justify-content: space-between;
`;

const StyledSenderLeft = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

const StyledThreadMessageSentAt = styled.div`
  align-items: flex-end;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
`;

type EmailThreadMessageSenderProps = {
  sender: EmailThreadMessageParticipant;
  sentAt: string;
};

export const EmailThreadMessageSender = ({
  sender,
  sentAt,
}: EmailThreadMessageSenderProps) => {
  const { localeCatalog } = useAtomStateValue(dateLocaleState);
  const tooltipId = `date-tooltip-${sentAt.replace(/[^a-zA-Z0-9]/g, '-')}`;

  const senderHasNoLinkedRecord =
    !isDefined(sender.person) && !isDefined(sender.workspaceMember);

  return (
    <StyledEmailThreadMessageSender>
      <StyledSenderLeft>
        <ParticipantChip participant={sender} variant="bold" />
        {senderHasNoLinkedRecord && (
          <EmailParticipantAddContactButton participant={sender} />
        )}
      </StyledSenderLeft>
      <StyledThreadMessageSentAt id={tooltipId}>
        {beautifyPastDateRelativeToNow(sentAt, localeCatalog)}
      </StyledThreadMessageSentAt>
      <AppTooltip
        anchorSelect={`#${tooltipId}`}
        content={formatToHumanReadableDate(sentAt)}
        place={TooltipPosition.Top}
      />
    </StyledEmailThreadMessageSender>
  );
};
