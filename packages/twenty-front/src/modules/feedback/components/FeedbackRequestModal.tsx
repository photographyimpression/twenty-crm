/* eslint-disable lingui/no-unlocalized-strings */
// Impression fork: in-app "Quick request" popup (modeled on the Zrizes app).
// Files a feature request / bug report straight into the private Feedback
// Board over its same-origin API — no navigating away. Screenshots can be
// pasted anywhere in the popup. Title is derived server-side from the goal.
import { styled } from '@linaria/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  IconExternalLink,
  IconPhoto,
  IconSend,
  IconX,
} from 'twenty-ui/display';
import { Button, IconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import {
  FEEDBACK_BOARD_BASE_PATH,
  FEEDBACK_BOARD_CARDS_ENDPOINT,
  FEEDBACK_REQUEST_MODAL_ID,
} from '@/feedback/constants/FeedbackBoard';
import { isFeedbackRequestModalOpenState } from '@/feedback/states/isFeedbackRequestModalOpenState';
import { TextArea } from '@/ui/input/components/TextArea';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';

type RequestType = 'feature' | 'bug';
type Attachment = { id: string; file: File; previewUrl: string };

const StyledHeader = styled.div`
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[4]} ${themeCssVariables.spacing[4]}
    ${themeCssVariables.spacing[2]};
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledSubtitle = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  margin-top: ${themeCssVariables.spacing[1]};
`;

const StyledContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  max-height: 60vh;
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[4]}
    ${themeCssVariables.spacing[4]};
`;

const StyledField = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledLabel = styled.div`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledToggle = styled.div`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[1]};
`;

const StyledToggleButton = styled.button<{ isActive: boolean }>`
  background: ${({ isActive }) =>
    isActive ? themeCssVariables.color.blue : 'transparent'};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.grayScale.gray1
      : themeCssVariables.font.color.secondary};
  cursor: pointer;
  flex: 1;
  font-family: ${themeCssVariables.font.family};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledThumbs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledThumb = styled.div`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  height: 56px;
  overflow: hidden;
  position: relative;
  width: 56px;
`;

const StyledThumbImage = styled.img`
  height: 100%;
  object-fit: cover;
  width: 100%;
`;

const StyledThumbRemove = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.transparent.strong};
  border: none;
  border-radius: 50%;
  color: ${themeCssVariables.grayScale.gray1};
  cursor: pointer;
  display: flex;
  height: 16px;
  justify-content: center;
  padding: 0;
  position: absolute;
  right: 2px;
  top: 2px;
  width: 16px;
`;

const StyledError = styled.div`
  color: ${themeCssVariables.font.color.danger};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledFooter = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

const StyledFooterHint = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledHintText = styled.span`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledBoardLink = styled.a`
  align-items: center;
  color: ${themeCssVariables.color.blue};
  display: inline-flex;
  font-size: ${themeCssVariables.font.size.xs};
  gap: ${themeCssVariables.spacing[1]};
  text-decoration: none;
`;

const StyledSuccess = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex-direction: column;
  font-size: ${themeCssVariables.font.size.md};
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[8]} ${themeCssVariables.spacing[4]};
  text-align: center;
`;

const StyledHiddenInput = styled.input`
  display: none;
`;

export const FeedbackRequestModal = () => {
  const [isOpen, setIsOpen] = useAtomState(isFeedbackRequestModalOpenState);
  const { openModal, closeModal } = useModal();

  const [type, setType] = useState<RequestType>('feature');
  const [goal, setGoal] = useState('');
  const [idea, setIdea] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      openModal(FEEDBACK_REQUEST_MODAL_ID);
    }
  }, [isOpen, openModal]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const images = Array.from(files).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (images.length === 0) {
      return;
    }
    setAttachments((current) => [
      ...current,
      ...images.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }, []);

  // "Paste screenshots anywhere in this pop-up" — a document-level listener
  // (only while open) catches image pastes regardless of which field has focus.
  // Text pastes into the textareas are untouched: we only act on image items.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handlePaste = (event: ClipboardEvent) => {
      const imageFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (imageFiles.length > 0) {
        event.preventDefault();
        addFiles(imageFiles);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [isOpen, addFiles]);

  const resetAndClose = useCallback(() => {
    attachments.forEach((attachment) =>
      URL.revokeObjectURL(attachment.previewUrl),
    );
    setType('feature');
    setGoal('');
    setIdea('');
    setAttachments([]);
    setError(null);
    setIsSubmitting(false);
    setIsSubmitted(false);
    closeModal(FEEDBACK_REQUEST_MODAL_ID);
    setIsOpen(false);
  }, [attachments, closeModal, setIsOpen]);

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const match = current.find((attachment) => attachment.id === id);
      if (match) {
        URL.revokeObjectURL(match.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== id);
    });
  };

  const canSubmit =
    !isSubmitting &&
    (goal.trim().length > 0 ||
      idea.trim().length > 0 ||
      attachments.length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('type', type);
      if (goal.trim().length > 0) {
        formData.append('goal', goal.trim());
      }
      if (idea.trim().length > 0) {
        formData.append('idea', idea.trim());
      }
      attachments.forEach((attachment) =>
        formData.append('screenshots', attachment.file),
      );

      const response = await fetch(FEEDBACK_BOARD_CARDS_ENDPOINT, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? 'Could not send your request.');
      }
      setIsSubmitted(true);
      window.setTimeout(resetAndClose, 1300);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Could not send your request.',
      );
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {createPortal(
        <ModalStatefulWrapper
          modalInstanceId={FEEDBACK_REQUEST_MODAL_ID}
          size="medium"
          padding="none"
          isClosable
          onClose={resetAndClose}
          renderInDocumentBody
        >
          {isSubmitted ? (
            <StyledSuccess>
              <div>✅ Sent — it&apos;s in the Inbox.</div>
              <StyledHintText>
                Claude will pick it up from there.
              </StyledHintText>
            </StyledSuccess>
          ) : (
            <>
              <StyledHeader>
                <div>
                  <StyledTitle>Quick request</StyledTitle>
                  <StyledSubtitle>
                    Request a feature or report a bug. Add a goal, an idea, or a
                    screenshot — whatever you have.
                  </StyledSubtitle>
                </div>
                <IconButton Icon={IconX} onClick={resetAndClose} size="small" />
              </StyledHeader>

              <StyledContent>
                <StyledToggle>
                  <StyledToggleButton
                    type="button"
                    isActive={type === 'feature'}
                    onClick={() => setType('feature')}
                  >
                    ✨ Feature
                  </StyledToggleButton>
                  <StyledToggleButton
                    type="button"
                    isActive={type === 'bug'}
                    onClick={() => setType('bug')}
                  >
                    🐞 Bug
                  </StyledToggleButton>
                </StyledToggle>

                <StyledField>
                  <StyledLabel>
                    Goal — what you want to achieve (optional)
                  </StyledLabel>
                  <TextArea
                    textAreaId="feedback-goal"
                    value={goal}
                    onChange={setGoal}
                    placeholder="The outcome you're after…"
                    minRows={2}
                    maxRows={4}
                  />
                </StyledField>

                <StyledField>
                  <StyledLabel>Idea — how it could work (optional)</StyledLabel>
                  <TextArea
                    textAreaId="feedback-idea"
                    value={idea}
                    onChange={setIdea}
                    placeholder="Your rough approach…"
                    minRows={2}
                    maxRows={4}
                  />
                </StyledField>

                {attachments.length > 0 && (
                  <StyledThumbs>
                    {attachments.map((attachment) => (
                      <StyledThumb key={attachment.id}>
                        <StyledThumbImage
                          src={attachment.previewUrl}
                          alt="screenshot"
                        />
                        <StyledThumbRemove
                          type="button"
                          onClick={() => removeAttachment(attachment.id)}
                        >
                          <IconX size={10} />
                        </StyledThumbRemove>
                      </StyledThumb>
                    ))}
                  </StyledThumbs>
                )}

                <div>
                  <Button
                    title="Attach screenshot"
                    Icon={IconPhoto}
                    variant="secondary"
                    size="small"
                    onClick={() => fileInputRef.current?.click()}
                  />
                  <StyledHiddenInput
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      if (event.target.files) {
                        addFiles(event.target.files);
                      }
                      event.target.value = '';
                    }}
                  />
                </div>

                {error !== null && <StyledError>{error}</StyledError>}
              </StyledContent>

              <StyledFooter>
                <Button
                  title="Add request"
                  Icon={IconSend}
                  variant="primary"
                  accent="blue"
                  fullWidth
                  justify="center"
                  disabled={!canSubmit}
                  isLoading={isSubmitting}
                  onClick={handleSubmit}
                />
                <StyledFooterHint>
                  <StyledHintText>
                    Paste screenshots anywhere in this popup
                  </StyledHintText>
                  <StyledBoardLink
                    href={`${FEEDBACK_BOARD_BASE_PATH}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open the full board
                    <IconExternalLink size={12} />
                  </StyledBoardLink>
                </StyledFooterHint>
              </StyledFooter>
            </>
          )}
        </ModalStatefulWrapper>,
        document.body,
      )}
    </>
  );
};
