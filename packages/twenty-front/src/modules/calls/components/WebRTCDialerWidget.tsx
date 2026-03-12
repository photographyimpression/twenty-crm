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

const ActionButton = styled.button<{ variant?: 'danger' | 'primary' }>`
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  background-color: ${(props) =>
    props.variant === 'danger' ? '#ef4444' : '#3b82f6'};
  color: white;
  flex: 1;

  &:hover {
    opacity: 0.9;
  }
`;

export const WebRTCDialerWidget: React.FC = () => {
  const { isRinging, inCall, activeNumber, hangup, error } = useCallContext();
  console.log('WebRTCDialerWidget state:', {
    isRinging,
    inCall,
    activeNumber,
    error,
  });
  if (!isRinging && !inCall && !error) {
    return null;
  }

  return (
    <WidgetContainer>
      <StatusText>
        {error ? 'Error' : isRinging ? 'Ringing...' : 'In Call'}
      </StatusText>

      {activeNumber && <NumberText>{activeNumber}</NumberText>}
      {error && (
        <NumberText style={{ color: '#ef4444', fontSize: '14px' }}>
          {error}
        </NumberText>
      )}

      <ButtonRow>
        <ActionButton variant="danger" onClick={hangup}>
          {error ? 'Close' : 'End Call'}
        </ActionButton>
      </ButtonRow>
    </WidgetContainer>
  );
};
