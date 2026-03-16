import styled from '@emotion/styled';
import React, { useCallback, useEffect, useRef, useState } from 'react';

type SmsRecord = {
  id: string;
  from: string;
  to: string;
  text: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  status: string;
};

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 9998;
`;

const WidgetContainer = styled.div`
  position: fixed;
  bottom: 24px;
  right: 24px;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  width: 380px;
  height: 520px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  font-family: inherit;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  background: #1a73e8;
  color: white;
`;

const HeaderTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
`;

const HeaderSubtitle = styled.div`
  font-size: 12px;
  opacity: 0.85;
  margin-top: 2px;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: white;
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  opacity: 0.8;

  &:hover {
    opacity: 1;
  }
`;

const MessagesContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f8f9fa;
`;

const MessageBubble = styled.div<{ isOutbound: boolean }>`
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.4;
  word-break: break-word;
  align-self: ${(props) => (props.isOutbound ? 'flex-end' : 'flex-start')};
  background: ${(props) => (props.isOutbound ? '#1a73e8' : '#ffffff')};
  color: ${(props) => (props.isOutbound ? '#ffffff' : '#333333')};
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
`;

const MessageTime = styled.div<{ isOutbound: boolean }>`
  font-size: 11px;
  margin-top: 4px;
  opacity: 0.6;
  text-align: ${(props) => (props.isOutbound ? 'right' : 'left')};
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
  text-align: center;
  padding: 24px;
`;

const InputContainer = styled.div`
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e5e7eb;
  background: #ffffff;
`;

const TextInput = styled.textarea`
  flex: 1;
  border: 1px solid #d1d5db;
  border-radius: 20px;
  padding: 10px 16px;
  font-size: 14px;
  resize: none;
  min-height: 40px;
  max-height: 100px;
  font-family: inherit;
  outline: none;

  &:focus {
    border-color: #1a73e8;
  }

  &::placeholder {
    color: #9ca3af;
  }
`;

const SendButton = styled.button`
  background: #1a73e8;
  color: white;
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 18px;

  &:hover {
    background: #1557b0;
  }

  &:disabled {
    background: #d1d5db;
    cursor: not-allowed;
  }
`;

const StatusBar = styled.div`
  padding: 4px 16px;
  font-size: 11px;
  color: #999;
  text-align: center;
  background: #f8f9fa;
`;

type SmsChatWidgetProps = {
  contactNumber: string;
  contactName?: string;
  onClose: () => void;
};

const formatTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-CA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const SmsChatWidget: React.FC<SmsChatWidgetProps> = ({
  contactNumber,
  contactName,
  onClose,
}) => {
  const [messages, setMessages] = useState<SmsRecord[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const serverUrl =
    import.meta.env.REACT_APP_SERVER_BASE_URL ||
    window.location.origin;

  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch(
        `${serverUrl}/api/telnyx/sms-records?contact=${encodeURIComponent(contactNumber)}`,
      );

      if (response.ok) {
        const result = await response.json();

        setMessages(result.data || []);
      }
    } catch {
      // Silently retry on next poll
    }
  }, [contactNumber, serverUrl]);

  // Load messages on mount and poll every 5 seconds
  useEffect(() => {
    fetchMessages();

    const interval = setInterval(fetchMessages, 5000);

    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    const text = inputText.trim();

    if (!text || sending) {
      return;
    }

    setSending(true);
    setStatusText('Sending...');

    try {
      const response = await fetch(`${serverUrl}/api/telnyx/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: contactNumber, text }),
      });

      if (response.ok) {
        setInputText('');
        setStatusText('Sent');

        // Immediately add the message to the local list
        setMessages((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            from: '',
            to: contactNumber,
            text,
            direction: 'outbound',
            timestamp: new Date().toISOString(),
            status: 'sent',
          },
        ]);

        // Clear status after a moment
        setTimeout(() => setStatusText(''), 2000);
      } else {
        const errorBody = await response.json();

        setStatusText(`Failed: ${errorBody.error || 'Unknown error'}`);
      }
    } catch (error) {
      setStatusText('Failed to send. Check connection.');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <Overlay onClick={onClose} />
      <WidgetContainer>
        <Header>
          <div>
            <HeaderTitle>
              {contactName || contactNumber}
            </HeaderTitle>
            {contactName && (
              <HeaderSubtitle>{contactNumber}</HeaderSubtitle>
            )}
          </div>
          <CloseButton onClick={onClose}>×</CloseButton>
        </Header>

        <MessagesContainer>
          {messages.length === 0 ? (
            <EmptyState>
              No messages yet.
              <br />
              Send a message to start the conversation.
            </EmptyState>
          ) : (
            messages.map((msg) => (
              <div key={msg.id}>
                <MessageBubble isOutbound={msg.direction === 'outbound'}>
                  {msg.text}
                </MessageBubble>
                <MessageTime isOutbound={msg.direction === 'outbound'}>
                  {formatTime(msg.timestamp)}
                </MessageTime>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </MessagesContainer>

        {statusText && <StatusBar>{statusText}</StatusBar>}

        <InputContainer>
          <TextInput
            ref={inputRef}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
          />
          <SendButton
            onClick={handleSend}
            disabled={!inputText.trim() || sending}
          >
            ↑
          </SendButton>
        </InputContainer>
      </WidgetContainer>
    </>
  );
};
