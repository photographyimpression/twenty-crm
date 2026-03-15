import styled from '@emotion/styled';
import React, { useState } from 'react';

import { useSmsContext } from '@/sms/contexts/SmsProvider';

const Overlay = styled.div`
  position: fixed;
  bottom: 24px;
  right: 24px;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  padding: 16px;
  width: 340px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: inherit;
`;

const Title = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #333;
`;

const Recipient = styled.div`
  font-size: 12px;
  color: #888;
`;

const TextArea = styled.textarea`
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  padding: 8px 10px;
  resize: vertical;
  min-height: 80px;
  width: 100%;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: #3b82f6;
  }
`;

const CharCount = styled.div<{ overLimit: boolean }>`
  font-size: 11px;
  color: ${(props) => (props.overLimit ? '#ef4444' : '#aaa')};
  text-align: right;
  margin-top: -8px;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`;

const Button = styled.button<{ variant?: 'primary' | 'ghost' }>`
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background-color: ${(props) =>
    props.variant === 'primary' ? '#3b82f6' : 'transparent'};
  color: ${(props) => (props.variant === 'primary' ? '#fff' : '#555')};

  &:hover {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ErrorText = styled.div`
  font-size: 12px;
  color: #ef4444;
`;

const SMS_CHAR_LIMIT = 160;

export const SmsSendWidget: React.FC = () => {
  const {
    isOpen,
    recipientNumber,
    closeComposer,
    sendSms,
    isSending,
    sendError,
  } = useSmsContext();

  const [text, setText] = useState('');

  if (!isOpen) {
    return null;
  }

  const handleSend = async () => {
    if (!recipientNumber || !text.trim()) return;

    await sendSms(recipientNumber, text.trim());
    setText('');
    closeComposer();
  };

  return (
    <Overlay>
      <Title>Send SMS</Title>
      {recipientNumber && <Recipient>To: {recipientNumber}</Recipient>}

      <TextArea
        placeholder="Type your message..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />

      <CharCount overLimit={text.length > SMS_CHAR_LIMIT}>
        {text.length}/{SMS_CHAR_LIMIT}
      </CharCount>

      {sendError && <ErrorText>{sendError}</ErrorText>}

      <ButtonRow>
        <Button onClick={closeComposer}>Cancel</Button>
        <Button
          variant="primary"
          onClick={handleSend}
          disabled={isSending || !text.trim()}
        >
          {isSending ? 'Sending...' : 'Send'}
        </Button>
      </ButtonRow>
    </Overlay>
  );
};
