import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { addHours, format } from 'date-fns';
import { useState } from 'react';

import {
  useCreateOutlookCalendarEvent,
  type CreateOutlookCalendarEventInput,
} from '@/activities/calendar/hooks/useCreateOutlookCalendarEvent';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { H1Title, H1TitleFontColor } from 'twenty-ui/display';
import { Button, Toggle } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export const CREATE_CALENDAR_EVENT_MODAL_ID = 'create-calendar-event-modal';

type CreateCalendarEventModalProps = {
  personId: string;
  onCreated?: () => void;
};

const StyledForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  margin-top: ${themeCssVariables.spacing[4]};
`;

const StyledFieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledFieldRow = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[3]};

  > * {
    flex: 1;
    min-width: 0;
  }
`;

const StyledLabel = styled.label`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledNativeInput = styled.input`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  padding: ${themeCssVariables.spacing[2]};
  width: 100%;

  &:focus {
    border-color: ${themeCssVariables.border.color.strong};
    outline: none;
  }
`;

const StyledTextarea = styled.textarea`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  min-height: 96px;
  padding: ${themeCssVariables.spacing[2]};
  resize: vertical;
  width: 100%;

  &:focus {
    border-color: ${themeCssVariables.border.color.strong};
    outline: none;
  }
`;

const StyledToggleRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  justify-content: space-between;
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
  margin-top: ${themeCssVariables.spacing[4]};
`;

const toLocalInputValue = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm");

const getDefaultStart = () => {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return addHours(now, 1);
};

export const CreateCalendarEventModal = ({
  personId,
  onCreated,
}: CreateCalendarEventModalProps) => {
  const { t } = useLingui();
  const { closeModal } = useModal();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const { createOutlookCalendarEvent, loading } =
    useCreateOutlookCalendarEvent();

  const [title, setTitle] = useState('Strategy call');
  const [startsAt, setStartsAt] = useState(() =>
    toLocalInputValue(getDefaultStart()),
  );
  const [endsAt, setEndsAt] = useState(() =>
    toLocalInputValue(addHours(getDefaultStart(), 1)),
  );
  const [description, setDescription] = useState('');
  const [isTeamsMeeting, setIsTeamsMeeting] = useState(true);

  const handleClose = () => {
    closeModal(CREATE_CALENDAR_EVENT_MODAL_ID);
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();

    if (!title.trim()) {
      enqueueErrorSnackBar({ message: t`Title is required` });
      return;
    }

    const input: CreateOutlookCalendarEventInput = {
      personId,
      title: title.trim(),
      description: description.trim() || undefined,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      isTeamsMeeting,
    };

    try {
      const result = await createOutlookCalendarEvent(input);
      enqueueSuccessSnackBar({
        message: result.joinUrl
          ? t`Event created — Teams link sent to attendee.`
          : t`Event created — invite sent to attendee.`,
      });
      onCreated?.();
      handleClose();
    } catch (error) {
      enqueueErrorSnackBar({
        message:
          error instanceof Error
            ? error.message
            : t`Failed to create calendar event.`,
      });
    }
  };

  return (
    <ModalStatefulWrapper
      modalInstanceId={CREATE_CALENDAR_EVENT_MODAL_ID}
      onClose={handleClose}
      isClosable
      padding="large"
      overlay="dark"
      renderInDocumentBody
      smallBorderRadius
      autoHeight
    >
      <H1Title title={t`New event`} fontColor={H1TitleFontColor.Primary} />
      <StyledForm onSubmit={handleSubmit}>
        <StyledFieldGroup>
          <StyledLabel htmlFor="calendar-event-title">{t`Title`}</StyledLabel>
          <SettingsTextInput
            instanceId="calendar-event-title"
            value={title}
            onChange={setTitle}
            placeholder={t`Strategy call`}
            fullWidth
            autoFocusOnMount
            disableHotkeys
          />
        </StyledFieldGroup>

        <StyledFieldRow>
          <StyledFieldGroup>
            <StyledLabel htmlFor="calendar-event-start">{t`Starts at`}</StyledLabel>
            <StyledNativeInput
              id="calendar-event-start"
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </StyledFieldGroup>
          <StyledFieldGroup>
            <StyledLabel htmlFor="calendar-event-end">{t`Ends at`}</StyledLabel>
            <StyledNativeInput
              id="calendar-event-end"
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </StyledFieldGroup>
        </StyledFieldRow>

        <StyledFieldGroup>
          <StyledLabel htmlFor="calendar-event-description">{t`Description`}</StyledLabel>
          <StyledTextarea
            id="calendar-event-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t`Agenda, Zoom link, or notes for the attendee…`}
          />
        </StyledFieldGroup>

        <StyledToggleRow>
          <StyledLabel>{t`Add Teams meeting`}</StyledLabel>
          <Toggle value={isTeamsMeeting} onChange={setIsTeamsMeeting} />
        </StyledToggleRow>

        <StyledActions>
          <Button
            variant="secondary"
            title={t`Cancel`}
            onClick={handleClose}
            disabled={loading}
          />
          <Button
            variant="primary"
            accent="blue"
            title={loading ? t`Creating…` : t`Create event`}
            onClick={() => handleSubmit()}
            disabled={loading}
          />
        </StyledActions>
      </StyledForm>
    </ModalStatefulWrapper>
  );
};
