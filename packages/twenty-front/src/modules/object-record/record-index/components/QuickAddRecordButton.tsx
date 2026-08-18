/* eslint-disable lingui/no-unlocalized-strings */
// Impression fork: "+ Add person" button in the index header that opens a small
// pop-up form. Replaces reaching for the add row at the BOTTOM of the list —
// on a 17k-row People view that meant scrolling forever. Fill in first/last
// name (when the object uses a full-name label), email, phone and tag.
import { styled } from '@linaria/react';
import { useCallback, useMemo, useState } from 'react';
import { IconPlus, IconX } from 'twenty-ui/display';
import { Button, IconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { FieldMetadataType } from '~/generated-metadata/graphql';

import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { getLabelIdentifierFieldMetadataItem } from '@/object-metadata/utils/getLabelIdentifierFieldMetadataItem';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useRecordIndexContextOrThrow } from '@/object-record/record-index/contexts/RecordIndexContext';
import { isRecordTableCreateDisabled } from '@/object-record/record-table/utils/isRecordTableCreateDisabled';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { AppPath } from 'twenty-shared/types';
import { getAppPath } from 'twenty-shared/utils';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';

const QUICK_ADD_MODAL_ID = 'quick-add-record-modal';

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

const StyledContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[4]}
    ${themeCssVariables.spacing[4]};
`;

const StyledField = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledNameRow = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};

  > ${StyledField} {
    flex: 1;
  }
`;

const StyledLabel = styled.div`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledInput = styled.input`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-family: ${themeCssVariables.font.family};
  font-size: ${themeCssVariables.font.size.md};
  padding: ${themeCssVariables.spacing[2]};

  &:focus {
    border-color: ${themeCssVariables.color.blue};
    outline: none;
  }
`;

const StyledFooter = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

// The CRM rejects a phone it can't parse, which would fail the whole save, and
// people type phones however they like. Normalize to E.164, or drop it.
const toE164 = (phone: string): string => {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+') && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return '';
};

export const QuickAddRecordButton = () => {
  const { objectNameSingular } = useRecordIndexContextOrThrow();
  const { objectMetadataItem } = useObjectMetadataItem({ objectNameSingular });
  const objectPermissions = useObjectPermissionsForObject(
    objectMetadataItem.id,
  );
  const { openModal, closeModal } = useModal();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const { createOneRecord } = useCreateOneRecord({
    objectNameSingular,
    shouldMatchRootQueryFilter: true,
  });

  const [isOpen, setIsOpen] = useState(false);
  const [firstNameValue, setFirstNameValue] = useState('');
  const [lastNameValue, setLastNameValue] = useState('');
  const [nameValue, setNameValue] = useState('');
  const [emailValue, setEmailValue] = useState('');
  const [phoneValue, setPhoneValue] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const labelIdentifier =
    getLabelIdentifierFieldMetadataItem(objectMetadataItem);
  const isFullNameLabel = labelIdentifier?.type === FieldMetadataType.FULL_NAME;
  const hasField = useCallback(
    (name: string) =>
      objectMetadataItem.fields.some(
        (field) => field.name === name && field.isActive !== false,
      ),
    [objectMetadataItem],
  );
  const showEmail = useMemo(() => hasField('emails'), [hasField]);
  const showPhone = useMemo(() => hasField('phones'), [hasField]);
  // "Tag" is the GHL-imported free-text tag field on People (comma-separated).
  const showTag = useMemo(() => hasField('ghlTags'), [hasField]);

  const isFullNameBlank =
    isFullNameLabel &&
    firstNameValue.trim() === '' &&
    lastNameValue.trim() === '';
  const isNameBlank = isFullNameLabel
    ? isFullNameBlank
    : nameValue.trim() === '';
  const displayName = isFullNameLabel
    ? `${firstNameValue.trim()} ${lastNameValue.trim()}`.trim()
    : nameValue.trim();

  const canQuickAdd =
    objectPermissions.canUpdateObjectRecords &&
    !isRecordTableCreateDisabled(objectNameSingular) &&
    (labelIdentifier?.type === FieldMetadataType.FULL_NAME ||
      labelIdentifier?.type === FieldMetadataType.TEXT);

  const handleOpen = () => {
    setIsOpen(true);
    openModal(QUICK_ADD_MODAL_ID);
  };

  const handleClose = useCallback(() => {
    setFirstNameValue('');
    setLastNameValue('');
    setNameValue('');
    setEmailValue('');
    setPhoneValue('');
    setTagValue('');
    setIsSaving(false);
    closeModal(QUICK_ADD_MODAL_ID);
    setIsOpen(false);
  }, [closeModal]);

  const save = async (shouldKeepOpen: boolean) => {
    if (isNameBlank || isSaving) {
      return;
    }
    setIsSaving(true);

    const fieldName = labelIdentifier?.name;
    const titleValue = isFullNameLabel
      ? {
          firstName: firstNameValue.trim(),
          lastName: lastNameValue.trim(),
        }
      : nameValue.trim();
    const normalizedPhone = toE164(phoneValue);

    try {
      const createdRecord = await createOneRecord({
        ...(fieldName !== undefined && { [fieldName]: titleValue }),
        ...(showEmail &&
          emailValue.trim() !== '' && {
            emails: { primaryEmail: emailValue.trim() },
          }),
        ...(showPhone &&
          normalizedPhone !== '' && {
            phones: { primaryPhoneNumber: normalizedPhone },
          }),
        ...(showTag && tagValue.trim() !== '' && { ghlTags: tagValue.trim() }),
      });

      // Adding deliberately keeps you on the list, so the confirmation carries
      // the one click through to the record just created.
      enqueueSuccessSnackBar({
        // eslint-disable-next-line lingui/no-unlocalized-strings
        message: `Added ${displayName}`,
        options: {
          // eslint-disable-next-line lingui/no-unlocalized-strings
          actionText: 'Open',
          actionTo: getAppPath(AppPath.RecordShowPage, {
            objectNameSingular,
            objectRecordId: createdRecord.id,
          }),
        },
      });

      if (shouldKeepOpen) {
        // "Save and add another": clear the form but stay put so a batch of
        // contacts can be entered without reopening the pop-up each time.
        setFirstNameValue('');
        setLastNameValue('');
        setNameValue('');
        setEmailValue('');
        setPhoneValue('');
        setTagValue('');
        setIsSaving(false);
      } else {
        handleClose();
      }
    } catch (error) {
      enqueueErrorSnackBar({
        message: `Couldn't add "${displayName}" — ${
          error instanceof Error ? error.message : 'please try again.'
        }`,
      });
      setIsSaving(false);
    }
  };

  if (!canQuickAdd) {
    return null;
  }

  const singular = objectMetadataItem.labelSingular.toLowerCase();

  return (
    <>
      <Button
        Icon={IconPlus}
        title={`Add ${singular}`}
        size="small"
        variant="secondary"
        onClick={handleOpen}
      />
      {isOpen && (
        <ModalStatefulWrapper
          modalInstanceId={QUICK_ADD_MODAL_ID}
          size="small"
          padding="none"
          isClosable
          onClose={handleClose}
          renderInDocumentBody
        >
          <StyledHeader>
            <StyledTitle>{`New ${singular}`}</StyledTitle>
            <IconButton Icon={IconX} onClick={handleClose} size="small" />
          </StyledHeader>
          <StyledContent>
            {isFullNameLabel ? (
              <StyledNameRow>
                <StyledField>
                  <StyledLabel>First name</StyledLabel>
                  <StyledInput
                    autoFocus
                    value={firstNameValue}
                    placeholder="Sarah"
                    onChange={(event) => setFirstNameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void save(false);
                      }
                    }}
                  />
                </StyledField>
                <StyledField>
                  <StyledLabel>Last name</StyledLabel>
                  <StyledInput
                    value={lastNameValue}
                    placeholder="Cohen"
                    onChange={(event) => setLastNameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void save(false);
                      }
                    }}
                  />
                </StyledField>
              </StyledNameRow>
            ) : (
              <StyledField>
                <StyledLabel>Name</StyledLabel>
                <StyledInput
                  autoFocus
                  value={nameValue}
                  placeholder="Sarah Cohen"
                  onChange={(event) => setNameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void save(false);
                    }
                  }}
                />
              </StyledField>
            )}

            {showEmail && (
              <StyledField>
                <StyledLabel>Email</StyledLabel>
                <StyledInput
                  type="email"
                  value={emailValue}
                  placeholder="sarah@example.com"
                  onChange={(event) => setEmailValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void save(false);
                    }
                  }}
                />
              </StyledField>
            )}

            {showPhone && (
              <StyledField>
                <StyledLabel>Phone</StyledLabel>
                <StyledInput
                  value={phoneValue}
                  placeholder="(514) 555-0199"
                  onChange={(event) => setPhoneValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void save(false);
                    }
                  }}
                />
              </StyledField>
            )}

            {showTag && (
              <StyledField>
                <StyledLabel>Tag</StyledLabel>
                <StyledInput
                  value={tagValue}
                  placeholder="e.g. usagehas"
                  onChange={(event) => setTagValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void save(false);
                    }
                  }}
                />
              </StyledField>
            )}
          </StyledContent>
          <StyledFooter>
            <Button
              title="Save"
              variant="primary"
              accent="blue"
              justify="center"
              disabled={isNameBlank || isSaving}
              onClick={() => void save(false)}
            />
            <Button
              title="Save and add another"
              variant="secondary"
              justify="center"
              disabled={isNameBlank || isSaving}
              onClick={() => void save(true)}
            />
          </StyledFooter>
        </ModalStatefulWrapper>
      )}
    </>
  );
};
