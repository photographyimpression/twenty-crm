import { styled } from '@linaria/react';
import { useState } from 'react';

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
      case 'message':
        return themeCssVariables.color.turquoise3;
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
      case 'message':
        return themeCssVariables.color.turquoise;
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

const StyledViewDetailsRow = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[4]};
`;

const StyledHeaderRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

// LOCAL-PATCH (board card 2026-09-02): while a call's transcript is still
// being prepared, show a live "working" chip instead of silence.
const StyledPendingChip = styled.span`
  animation: pending-pulse 1.2s ease-in-out infinite;
  background: ${themeCssVariables.color.orange3};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.color.orange};
  display: inline-flex;
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  padding: 2px 8px;
  width: fit-content;

  @keyframes pending-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
`;

const TYPE_LABELS: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  call: 'Call',
  message: 'Message',
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

  // LOCAL-PATCH: long notes expand INLINE in the center column instead of
  // hopping to the right-column side panel (board card 2026-08-30: "why do I
  // need the right column preview"). The side panel stays one click away for
  // editing — "Open editor" below.
  const [expanded, setExpanded] = useState(false);

  const truncatedBody = bodyContent
    ? bodyContent.length > 300
      ? bodyContent.slice(0, 300) + '...'
      : bodyContent
    : null;
  const isTruncated = bodyContent !== null && bodyContent.length > 300;

  // The Telnyx call note writes this marker while the recording is being
  // transcribed and rewrites itself when the transcript lands.
  const isTranscriptionPending = !!bodyContent?.includes(
    '⏳ Transcription: preparing',
  );

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
          <StyledDirectionBadge>{classification.duration}</StyledDirectionBadge>
        )}
        {isTranscriptionPending && (
          <StyledPendingChip>⏳ Transcribing…</StyledPendingChip>
        )}
      </StyledHeaderRow>

      {bodyContent && (
        <StyledBodyPreview
          style={
            expanded ? { maxHeight: 'none', overflow: 'visible' } : undefined
          }
        >
          {expanded ? bodyContent : truncatedBody}
        </StyledBodyPreview>
      )}

      <StyledViewDetailsRow>
        {isTruncated && (
          <StyledViewDetails onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show less' : 'View full details'}
          </StyledViewDetails>
        )}
        <StyledViewDetails
          onClick={() =>
            openRecordInSidePanel({
              recordId: noteId,
              objectNameSingular,
            })
          }
        >
          Open editor
        </StyledViewDetails>
      </StyledViewDetailsRow>
    </StyledPreviewContainer>
  );
};
