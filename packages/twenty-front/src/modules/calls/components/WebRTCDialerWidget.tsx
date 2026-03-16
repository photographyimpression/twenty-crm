import styled from '@emotion/styled';
import React, { useEffect, useState } from 'react';

import { useCallContext } from '../contexts/CallProvider';
import { useCallTranscription } from '../hooks/useCallTranscription';

const WidgetContainer = styled.div`
  position: fixed;
  bottom: 24px;
  right: 24px;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  padding: 16px;
  width: 360px;
  max-height: 500px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: inherit;
`;

const StatusRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const StatusText = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #333;
`;

const TimerText = styled.div`
  font-size: 13px;
  color: #999;
  font-variant-numeric: tabular-nums;
`;

const NumberText = styled.div`
  font-size: 18px;
  color: #666;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 4px;
`;

const ActionButton = styled.button<{ variant?: 'danger' | 'primary' }>`
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  background-color: ${(props) =>
    props.variant === 'danger' ? '#ef4444' : '#22c55e'};
  color: white;
  flex: 1;

  &:hover {
    opacity: 0.9;
  }
`;

const TranscriptContainer = styled.div`
  max-height: 200px;
  overflow-y: auto;
  border-top: 1px solid #eee;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const TranscriptHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const TranscriptIndicator = styled.div<{ active: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: ${(props) => (props.active ? '#22c55e' : '#999')};
`;

const PulseDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #22c55e;
  animation: pulse 1.5s ease-in-out infinite;

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
`;

const TranscriptEntry = styled.div`
  font-size: 13px;
  color: #444;
  line-height: 1.4;
`;

const SpeakerLabel = styled.span`
  font-weight: 600;
  color: #1a73e8;
  margin-right: 4px;
`;

const InterimText = styled.span`
  color: #999;
  font-style: italic;
`;

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const WebRTCDialerWidget: React.FC = () => {
  const {
    isRinging,
    isIncoming,
    inCall,
    activeNumber,
    callStartTime,
    hangup,
    answer,
    clearError,
    error,
  } = useCallContext();

  const { transcript, interimText, isTranscribing } =
    useCallTranscription(inCall);

  const [elapsed, setElapsed] = useState(0);

  // Call timer
  useEffect(() => {
    if (!inCall || !callStartTime) {
      setElapsed(0);

      return;
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - callStartTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [inCall, callStartTime]);

  if (!isRinging && !inCall && !error) {
    return null;
  }

  const handleClose = () => {
    if (error) {
      clearError();
    } else {
      hangup();
    }
  };

  return (
    <WidgetContainer>
      <StatusRow>
        <StatusText>
          {error
            ? 'Error'
            : isRinging && isIncoming
              ? 'Incoming Call...'
              : isRinging
                ? 'Ringing...'
                : 'In Call'}
        </StatusText>
        {inCall && callStartTime && (
          <TimerText>{formatDuration(elapsed)}</TimerText>
        )}
      </StatusRow>

      {activeNumber && <NumberText>{activeNumber}</NumberText>}
      {error && (
        <NumberText style={{ color: '#ef4444', fontSize: '14px' }}>
          {error}
        </NumberText>
      )}

      <ButtonRow>
        {isRinging && isIncoming && (
          <ActionButton onClick={answer}>Answer</ActionButton>
        )}
        <ActionButton variant="danger" onClick={handleClose}>
          {error ? 'Close' : 'End Call'}
        </ActionButton>
      </ButtonRow>

      {inCall && (
        <>
          <TranscriptHeader>
            <span>Live Transcript</span>
            <TranscriptIndicator active={isTranscribing}>
              {isTranscribing && <PulseDot />}
              {isTranscribing ? 'Listening' : 'Unavailable'}
            </TranscriptIndicator>
          </TranscriptHeader>
          <TranscriptContainer>
            {transcript.map((entry, index) => (
              <TranscriptEntry key={index}>
                <SpeakerLabel>{entry.speaker}:</SpeakerLabel>
                {entry.text}
              </TranscriptEntry>
            ))}
            {interimText && (
              <TranscriptEntry>
                <SpeakerLabel>You:</SpeakerLabel>
                <InterimText>{interimText}</InterimText>
              </TranscriptEntry>
            )}
            {transcript.length === 0 && !interimText && isTranscribing && (
              <TranscriptEntry style={{ color: '#999', fontStyle: 'italic' }}>
                Waiting for speech...
              </TranscriptEntry>
            )}
          </TranscriptContainer>
        </>
      )}
    </WidgetContainer>
  );
};
