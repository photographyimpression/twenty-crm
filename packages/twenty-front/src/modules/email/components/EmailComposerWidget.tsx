import { gql, useMutation } from '@apollo/client';
import { styled } from '@linaria/react';
import React, { useEffect, useRef, useState } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const SEND_NEW_EMAIL = gql`
  mutation SendNewEmail($to: String!, $subject: String!, $body: String!) {
    sendNewEmail(to: $to, subject: $subject, body: $body)
  }
`;

const StyledOverlay = styled.div`
  background: ${themeCssVariables.background.transparent.medium};
  bottom: 0;
  left: 0;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 9998;
`;

const StyledWidgetContainer = styled.div`
  background-color: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  bottom: 24px;
  box-shadow: 0 8px 32px ${themeCssVariables.background.transparent.light};
  display: flex;
  flex-direction: column;
  font-family: inherit;
  max-height: 600px;
  overflow: hidden;
  position: fixed;
  right: 24px;
  width: 480px;
  z-index: 9999;
`;

const StyledHeader = styled.div`
  align-items: center;
  background: ${themeCssVariables.color.blue};
  color: ${themeCssVariables.font.color.inverted};
  display: flex;
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

const StyledHeaderTitle = styled.div`
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledHeaderSubtitle = styled.div`
  font-size: ${themeCssVariables.font.size.sm};
  margin-top: 2px;
  opacity: 0.85;
`;

const StyledCloseButton = styled.button`
  background: none;
  border: none;
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  opacity: 0.8;
  padding: ${themeCssVariables.spacing[1]};

  &:hover {
    opacity: 1;
  }
`;

const StyledBody = styled.form`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  overflow: hidden;
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]}
    ${themeCssVariables.spacing[2]};
`;

const StyledFieldLabel = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  letter-spacing: 0.3px;
  text-transform: uppercase;
`;

const StyledTextField = styled.input`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  outline: none;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};

  &:focus {
    border-color: ${themeCssVariables.border.color.medium};
  }
`;

const StyledTextArea = styled.textarea`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  min-height: 200px;
  outline: none;
  padding: ${themeCssVariables.spacing[3]};
  resize: vertical;

  &:focus {
    border-color: ${themeCssVariables.border.color.medium};
  }
`;

const StyledFooter = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[4]}
    ${themeCssVariables.spacing[3]};
`;

const StyledSendButton = styled.button`
  background: ${themeCssVariables.color.blue};
  border: none;
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[5]};

  &:disabled {
    background: ${themeCssVariables.background.transparent.medium};
    cursor: not-allowed;
  }
`;

const StyledStatusText = styled.div<{ isError: boolean }>`
  color: ${({ isError }) =>
    isError
      ? themeCssVariables.color.red
      : themeCssVariables.font.color.secondary};
  flex: 1;
  font-size: ${themeCssVariables.font.size.xs};
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
        setStatusText(
          'Failed to send. Make sure your Microsoft account is connected in Settings.',
        );
        setIsError(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      setStatusText(`Failed: ${message}`);
      setIsError(true);
    }
  };

  return (
    <>
      <StyledOverlay onClick={onClose} />
      <StyledWidgetContainer>
        <StyledHeader>
          <div>
            <StyledHeaderTitle>
              New email{contactName ? ` to ${contactName}` : ''}
            </StyledHeaderTitle>
            <StyledHeaderSubtitle>{toEmail}</StyledHeaderSubtitle>
          </div>
          <StyledCloseButton onClick={onClose}>×</StyledCloseButton>
        </StyledHeader>
        <StyledBody onSubmit={handleSubmit}>
          <StyledFieldLabel>Subject</StyledFieldLabel>
          <StyledTextField
            ref={subjectRef}
            type="text"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
          />
          <StyledFieldLabel>Message</StyledFieldLabel>
          <StyledTextArea
            value={bodyText}
            onChange={(event) => setBodyText(event.target.value)}
            placeholder="Write your message…"
          />
          <StyledFooter>
            <StyledStatusText isError={isError}>{statusText}</StyledStatusText>
            <StyledSendButton
              type="submit"
              disabled={loading || !subject.trim() || !bodyText.trim()}
            >
              {loading ? 'Sending…' : 'Send'}
            </StyledSendButton>
          </StyledFooter>
        </StyledBody>
      </StyledWidgetContainer>
    </>
  );
};
