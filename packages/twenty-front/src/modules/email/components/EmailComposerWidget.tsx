import { gql, useMutation } from '@apollo/client';
import styled from '@emotion/styled';
import React, { useEffect, useRef, useState } from 'react';

const SEND_NEW_EMAIL = gql`
  mutation SendNewEmail($to: String!, $subject: String!, $body: String!) {
    sendNewEmail(to: $to, subject: $subject, body: $body)
  }
`;

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
  width: 480px;
  max-height: 600px;
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

const Body = styled.form`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 8px;
  padding: 14px 16px 12px;
  overflow: hidden;
`;

const FieldLabel = styled.div`
  color: #5f6368;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.3px;
  text-transform: uppercase;
`;

const TextField = styled.input`
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-family: inherit;
  font-size: 14px;
  outline: none;
  padding: 8px 10px;

  &:focus {
    border-color: #1a73e8;
  }
`;

const TextArea = styled.textarea`
  border: 1px solid #d1d5db;
  border-radius: 6px;
  flex: 1;
  font-family: inherit;
  font-size: 14px;
  min-height: 200px;
  outline: none;
  padding: 10px;
  resize: vertical;

  &:focus {
    border-color: #1a73e8;
  }
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px 14px;
`;

const SendButton = styled.button`
  background: #1a73e8;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  padding: 8px 18px;

  &:hover {
    background: #1557b0;
  }

  &:disabled {
    background: #d1d5db;
    cursor: not-allowed;
  }
`;

const StatusText = styled.div<{ isError: boolean }>`
  color: ${(props) => (props.isError ? '#d93025' : '#5f6368')};
  flex: 1;
  font-size: 12px;
`;

type EmailComposerWidgetProps = {
  toEmail: string;
  contactName?: string;
  onClose: () => void;
};

export const EmailComposerWidget: React.FC<EmailComposerWidgetProps> = ({
  toEmail,
  contactName,
  onClose,
}) => {
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [statusText, setStatusText] = useState('');
  const [isError, setIsError] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);

  const [sendNewEmail, { loading }] = useMutation(SEND_NEW_EMAIL);

  useEffect(() => {
    subjectRef.current?.focus();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!subject.trim() || !bodyText.trim() || loading) return;

    setStatusText('Sending…');
    setIsError(false);

    try {
      const result = await sendNewEmail({
        variables: {
          to: toEmail,
          subject: subject.trim(),
          body: bodyText,
        },
      });

      if (result.data?.sendNewEmail) {
        setStatusText('Sent');
        setTimeout(onClose, 800);
      } else {
        setStatusText('Failed to send. Make sure your Microsoft account is connected in Settings.');
        setIsError(true);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      setStatusText(`Failed: ${message}`);
      setIsError(true);
    }
  };

  return (
    <>
      <Overlay onClick={onClose} />
      <WidgetContainer>
        <Header>
          <div>
            <HeaderTitle>New email{contactName ? ` to ${contactName}` : ''}</HeaderTitle>
            <HeaderSubtitle>{toEmail}</HeaderSubtitle>
          </div>
          <CloseButton onClick={onClose}>×</CloseButton>
        </Header>
        <Body onSubmit={handleSubmit}>
          <FieldLabel>Subject</FieldLabel>
          <TextField
            ref={subjectRef}
            type="text"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
          />
          <FieldLabel>Message</FieldLabel>
          <TextArea
            value={bodyText}
            onChange={(event) => setBodyText(event.target.value)}
            placeholder="Write your message…"
          />
          <Footer>
            <StatusText isError={isError}>{statusText}</StatusText>
            <SendButton
              type="submit"
              disabled={loading || !subject.trim() || !bodyText.trim()}
            >
              {loading ? 'Sending…' : 'Send'}
            </SendButton>
          </Footer>
        </Body>
      </WidgetContainer>
    </>
  );
};
