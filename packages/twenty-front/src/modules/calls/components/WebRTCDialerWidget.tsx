import styled from '@emotion/styled';
import React from 'react';
import { useCallContext } from '../contexts/CallProvider';

const WidgetContainer = styled.div`
  position: fixed;
  bottom: 24px;
  right: 24px;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  padding: 16px;
  width: 320px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: inherit;
`;

const StatusText = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #333;
`;

const NumberText = styled.div`
  font-size: 18px;
  color: #666;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
`;

const ActionButton = styled.button<{ variant?: 'danger' | 'primary' | 'success' }>`
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  background-color: ${(props) => {
    if (props.variant === 'danger') return '#ef4444';
    if (props.variant === 'success') return '#22c55e';
    return '#3b82f6';
  }};
  color: white;
  flex: 1;

  &:hover {
    opacity: 0.9;
  }
`;

export const WebRTCDialerWidget: React.FC = () => {
  const {
    isRinging,
    isIncoming,
    inCall,
    activeNumber,
    hangup,
    answer,
    clearError,
    error,
  } = useCallContext();

  if (!isRinging && !inCall && !error) {
    return null;
  }

  const statusLabel = error
    ? 'Error'
    : isRinging && isIncoming
      ? 'Incoming Call'
      : isRinging
        ? 'Ringing...'
        : 'In Call';

  return (
    <WidgetContainer>
      <StatusText>{statusLabel}</StatusText>

      {activeNumber && <NumberText>{activeNumber}</NumberText>}
      {error && (
        <NumberText style={{ color: '#ef4444', fontSize: '14px' }}>
          {error}
        </NumberText>
      )}

      <ButtonRow>
        {isRinging && isIncoming && (
          <ActionButton variant="success" onClick={answer}>
            Answer
          </ActionButton>
        )}
        <ActionButton
          variant="danger"
          onClick={error ? clearError : hangup}
        >
          {error ? 'Close' : 'End Call'}
        </ActionButton>
      </ButtonRow>
    </WidgetContainer>
  );
};
