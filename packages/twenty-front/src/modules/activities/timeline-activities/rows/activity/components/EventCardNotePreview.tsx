import { styled } from '@linaria/react';

import { type NoteActivityClassification } from '@/activities/timeline-activities/utils/classifyNoteActivity';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { type CoreObjectNameSingular } from 'twenty-shared/types';
import { themeCssVariables } from 'twenty-ui/theme-constants';

type EventCardNotePreviewProps = {
  noteId: string;
  objectNameSingular: CoreObjectNameSingular;
  classification: NoteActivityClassification;
  bodyContent: string | null;
};

const StyledPreviewContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledTypeBadge = styled.span<{ activityType: string }>`
  background: ${({ activityType }) => {
    switch (activityType) {
      case 'email':
        return themeCssVariables.color.blue3;
      case 'sms':
        return themeCssVariables.color.green3;
      case 'call':
        return themeCssVariables.color.orange3;
      case 'aiSummary':
        return themeCssVariables.color.purple3;
      default:
        return themeCssVariables.color.gray3;
    }
  }};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ activityType }) => {
    switch (activityType) {
      case 'email':
        return themeCssVariables.color.blue;
      case 'sms':
        return themeCssVariables.color.green;
      case 'call':
        return themeCssVariables.color.orange;
      case 'aiSummary':
        return themeCssVariables.color.purple;
      default:
        return themeCssVariables.font.color.secondary;
    }
  }};
  display: inline-flex;
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  padding: 2px 8px;
  width: fit-content;
`;

const StyledDirectionBadge = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledBodyPreview = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  line-height: 1.5;
  max-height: 200px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
`;

const StyledViewDetails = styled.span`
  color: ${themeCssVariables.color.blue};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  &:hover {
    text-decoration: underline;
  }
`;

const StyledHeaderRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const TYPE_LABELS: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  call: 'Call',
  aiSummary: 'AI Summary',
  note: 'Note',
};

export const EventCardNotePreview = ({
  noteId,
  objectNameSingular,
  classification,
  bodyContent,
}: EventCardNotePreviewProps) => {
  const { openRecordInSidePanel } = useOpenRecordInSidePanel();

  const truncatedBody = bodyContent
    ? bodyContent.length > 300
      ? bodyContent.slice(0, 300) + '...'
      : bodyContent
    : null;

  return (
    <StyledPreviewContainer>
      <StyledHeaderRow>
        <StyledTypeBadge activityType={classification.activityType}>
          {TYPE_LABELS[classification.activityType]}
        </StyledTypeBadge>
        {classification.direction && (
          <StyledDirectionBadge>
            {classification.direction}
          </StyledDirectionBadge>
        )}
        {classification.duration && (
          <StyledDirectionBadge>
            {classification.duration}
          </StyledDirectionBadge>
        )}
      </StyledHeaderRow>

      {truncatedBody && (
        <StyledBodyPreview>{truncatedBody}</StyledBodyPreview>
      )}

      <StyledViewDetails
        onClick={() =>
          openRecordInSidePanel({
            recordId: noteId,
            objectNameSingular,
          })
        }
      >
        View full details
      </StyledViewDetails>
    </StyledPreviewContainer>
  );
};
