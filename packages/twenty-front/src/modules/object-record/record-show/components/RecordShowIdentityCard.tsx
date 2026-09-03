// LOCAL-PATCH: Salesmate-style identity card for the record page's left rail.
// Replaces the stock centered avatar + "Added 3 months ago" block, which gave
// the whole page away without telling you anything actionable about the person.
// Layout mirrors Salesmate's contact header: type chip, avatar beside the name,
// "Job Title · Company", the meta rows, socials, then the round action bar.
import { allowRequestsToTwentyIconsState } from '@/client-config/states/allowRequestsToTwentyIcons';
import { useOpenCreateActivityDrawer } from '@/activities/hooks/useOpenCreateActivityDrawer';
import { useCallContext } from '@/calls/contexts/CallProvider';
import { getPrimaryPhoneE164 } from '@/calls/utils/getPrimaryPhoneE164';
import { useLabelIdentifierFieldMetadataItem } from '@/object-metadata/hooks/useLabelIdentifierFieldMetadataItem';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { type ObjectMetadataItem } from '@/object-metadata/types/ObjectMetadataItem';
import { useIsRecordFieldReadOnly } from '@/object-record/read-only/hooks/useIsRecordFieldReadOnly';
import { FieldContext } from '@/object-record/record-field/ui/contexts/FieldContext';
import { LightCopyIconButton } from '@/object-record/record-field/ui/components/LightCopyIconButton';
import { usePersonAvatarUpload } from '@/object-record/record-show/hooks/usePersonAvatarUpload';
import { useRecordShowContainerActions } from '@/object-record/record-show/hooks/useRecordShowContainerActions';
import { useRecordShowContainerData } from '@/object-record/record-show/hooks/useRecordShowContainerData';
import { recordStoreFamilyState } from '@/object-record/record-store/states/recordStoreFamilyState';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { recordStoreIdentifierFamilySelector } from '@/object-record/record-store/states/selectors/recordStoreIdentifierFamilySelector';
import { RecordTitleCell } from '@/object-record/record-title-cell/components/RecordTitleCell';
import { RecordTitleCellContainerType } from '@/object-record/record-title-cell/types/RecordTitleCellContainerType';
import { useSmsContext } from '@/sms/contexts/SmsProvider';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { useAtomFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { type ChangeEvent, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';
import { Tag } from 'twenty-ui/components';
import {
  Avatar,
  IconBrandLinkedin,
  IconBrandX,
  IconCalendarEvent,
  IconCheckbox,
  IconMail,
  IconMap,
  IconMessage,
  IconNotes,
  IconPhone,
  IconUser,
  IconWorld,
  type IconComponent,
} from 'twenty-ui/display';
import { type ThemeColor } from 'twenty-ui/theme';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { FieldMetadataType } from '~/generated-metadata/graphql';

const StyledCard = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledChipRow = styled.div`
  display: flex;
`;

const StyledIdentityRow = styled.div`
  align-items: flex-start;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
`;

const StyledAvatarWrapper = styled.div<{ isAvatarEditable: boolean }>`
  cursor: ${({ isAvatarEditable }) =>
    isAvatarEditable ? 'pointer' : 'default'};
  flex-shrink: 0;
  padding-top: ${themeCssVariables.spacing[1]};
`;

const StyledFileInput = styled.input`
  display: none;
`;

const StyledNameBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  min-width: 0;
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  font-size: ${themeCssVariables.font.size.xl};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledSubtitle = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledCompanyLink = styled(Link)`
  color: ${themeCssVariables.font.color.secondary};
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const StyledMetaList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledMetaRow = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

const StyledMetaIcon = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.light};
  display: flex;
  flex-shrink: 0;
`;

const StyledMetaValue = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledSocialRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledSocialLink = styled.a`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  justify-content: center;

  &:hover {
    color: ${themeCssVariables.font.color.primary};
  }
`;

const StyledActionRow = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
  padding-top: ${themeCssVariables.spacing[3]};
`;

// Salesmate's action bar is a row of circular outlined buttons. Disabled ones
// stay visible but muted so the row does not reflow between contacts.
const StyledActionButton = styled.button<{ isDisabled: boolean }>`
  align-items: center;
  background: transparent;
  border: 1px solid
    ${({ isDisabled }) =>
      isDisabled
        ? themeCssVariables.border.color.light
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.rounded};
  color: ${({ isDisabled }) =>
    isDisabled
      ? themeCssVariables.font.color.extraLight
      : themeCssVariables.font.color.secondary};
  cursor: ${({ isDisabled }) => (isDisabled ? 'default' : 'pointer')};
  display: flex;
  height: 32px;
  justify-content: center;
  padding: 0;
  width: 32px;

  &:hover {
    background: ${({ isDisabled }) =>
      isDisabled
        ? 'transparent'
        : themeCssVariables.background.transparent.light};
  }
`;

type IdentityAction = {
  key: string;
  Icon: IconComponent;
  label: string;
  onClick?: () => void;
};

type RecordShowIdentityCardProps = {
  objectNameSingular: string;
  objectRecordId: string;
  isInSidePanel: boolean;
};

// Narrows the loosely typed ObjectRecord bag down to a usable string.
const asNonEmptyString = (value: unknown): string | null =>
  isNonEmptyString(value) ? value : null;

// Resolves a SELECT field's stored value to the option's label and colour.
// Returns null when the field is absent, empty, or not a SELECT on this
// workspace — the chip is then simply not rendered.
const getSelectOptionChip = (
  objectMetadataItem: ObjectMetadataItem,
  fieldName: string,
  record: ObjectRecord | null | undefined,
): { label: string; color: ThemeColor } | null => {
  const storedValue = asNonEmptyString(record?.[fieldName]);

  if (!isDefined(storedValue)) {
    return null;
  }

  const option = objectMetadataItem.fields
    .find((field) => field.name === fieldName)
    ?.options?.find((fieldOption) => fieldOption.value === storedValue);

  if (!isDefined(option)) {
    return null;
  }

  return { label: option.label, color: option.color };
};

type LinksValue = {
  primaryLinkUrl?: string | null;
  primaryLinkLabel?: string | null;
} | null;

export const RecordShowIdentityCard = ({
  objectNameSingular,
  objectRecordId,
  isInSidePanel,
}: RecordShowIdentityCardProps) => {
  const { recordLoading, isPrefetchLoading } = useRecordShowContainerData({
    objectRecordId,
  });

  const recordStore = useAtomFamilyStateValue(
    recordStoreFamilyState,
    objectRecordId,
  );

  const allowRequestsToTwentyIcons = useAtomStateValue(
    allowRequestsToTwentyIconsState,
  );

  const recordIdentifier = useAtomFamilySelectorValue(
    recordStoreIdentifierFamilySelector,
    {
      recordId: objectRecordId,
      allowRequestsToTwentyIcons,
    },
  );

  const { useUpdateOneObjectRecordMutation } = useRecordShowContainerActions({
    objectNameSingular,
  });

  const { onUploadPicture } = usePersonAvatarUpload(objectRecordId);

  const { objectMetadataItem } = useObjectMetadataItem({ objectNameSingular });

  const { labelIdentifierFieldMetadataItem } =
    useLabelIdentifierFieldMetadataItem({ objectNameSingular });

  const isTitleReadOnly = useIsRecordFieldReadOnly({
    recordId: objectRecordId,
    fieldMetadataId: labelIdentifierFieldMetadataItem?.id ?? '',
    objectMetadataId: objectMetadataItem.id,
  });

  const openCreateNote = useOpenCreateActivityDrawer({
    activityObjectNameSingular: CoreObjectNameSingular.Note,
  });
  const openCreateTask = useOpenCreateActivityDrawer({
    activityObjectNameSingular: CoreObjectNameSingular.Task,
  });

  const { dial } = useCallContext();
  const { openComposer } = useSmsContext();

  const inputFileRef = useRef<HTMLInputElement>(null);

  const isPerson = objectNameSingular === CoreObjectNameSingular.Person;
  const isAvatarEditable = isDefined(onUploadPicture) && isPerson;

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (isDefined(event.target.files)) {
      onUploadPicture?.(event.target.files[0]);
    }
  };

  if (isPrefetchLoading || recordLoading) {
    return null;
  }

  const jobTitle = asNonEmptyString(recordStore?.jobTitle);
  const city = asNonEmptyString(recordStore?.city);

  const company = recordStore?.company as
    | { id?: string; name?: string | null }
    | null
    | undefined;
  const companyId = asNonEmptyString(company?.id);
  const companyName = asNonEmptyString(company?.name);

  // Contact Type is what the book is segmented on; Sequence is the fallback for
  // people who have only ever been enrolled. Both are SELECTs, so the record
  // holds the raw option value ("PRE_PHONE_EMAIL") — the human label and the
  // chip colour have to come from the field metadata.
  const typeChip =
    getSelectOptionChip(objectMetadataItem, 'contactType', recordStore) ??
    getSelectOptionChip(objectMetadataItem, 'sequenceTag', recordStore);

  const createdBy = recordStore?.createdBy as
    | { name?: string | null }
    | undefined;
  const createdByName = asNonEmptyString(createdBy?.name);

  const primaryEmail = asNonEmptyString(recordStore?.emails?.primaryEmail);
  const primaryPhone = getPrimaryPhoneE164(recordStore?.phones);

  const linkedinUrl = (recordStore?.linkedinLink as LinksValue)?.primaryLinkUrl;
  const xUrl = (recordStore?.xLink as LinksValue)?.primaryLinkUrl;
  const domainName = (recordStore?.domainName as LinksValue)?.primaryLinkUrl;

  const socialLinks = [
    {
      key: 'linkedin',
      url: asNonEmptyString(linkedinUrl),
      Icon: IconBrandLinkedin,
    },
    { key: 'x', url: asNonEmptyString(xUrl), Icon: IconBrandX },
    { key: 'website', url: asNonEmptyString(domainName), Icon: IconWorld },
  ].filter(
    (
      socialLink,
    ): socialLink is { key: string; url: string; Icon: IconComponent } =>
      isDefined(socialLink.url),
  );

  const targetableObject = {
    id: objectRecordId,
    targetObjectNameSingular: objectNameSingular,
  };

  const actions: IdentityAction[] = [
    {
      key: 'note',
      Icon: IconNotes,
      label: t`Add note`,
      onClick: () => openCreateNote({ targetableObjects: [targetableObject] }),
    },
    {
      key: 'email',
      Icon: IconMail,
      label: t`Send email`,
      onClick: primaryEmail
        ? () => window.open(`mailto:${primaryEmail}`, '_self')
        : undefined,
    },
    {
      key: 'call',
      Icon: IconPhone,
      label: t`Call`,
      onClick: primaryPhone ? () => dial(primaryPhone) : undefined,
    },
    {
      key: 'sms',
      Icon: IconMessage,
      label: t`Text`,
      onClick: primaryPhone ? () => openComposer(primaryPhone) : undefined,
    },
    {
      key: 'task',
      Icon: IconCheckbox,
      label: t`Add task`,
      onClick: () => openCreateTask({ targetableObjects: [targetableObject] }),
    },
    {
      key: 'meeting',
      Icon: IconCalendarEvent,
      label: t`Book a meeting`,
      onClick: () =>
        window.open(
          'https://cal.impressionphotography.ca/moshe/30min',
          '_blank',
        ),
    },
  ];

  const visibleActions = isPerson
    ? actions
    : actions.filter(
        (action) => action.key === 'note' || action.key === 'task',
      );

  return (
    <StyledCard>
      {isDefined(typeChip) && (
        <StyledChipRow>
          <Tag
            color={typeChip.color}
            text={typeChip.label}
            weight="medium"
            preventShrink
          />
        </StyledChipRow>
      )}

      <StyledIdentityRow>
        <StyledAvatarWrapper isAvatarEditable={isAvatarEditable}>
          <Avatar
            avatarUrl={recordIdentifier?.avatarUrl ?? ''}
            onClick={
              isAvatarEditable
                ? () => inputFileRef.current?.click?.()
                : undefined
            }
            size="xl"
            placeholderColorSeed={objectRecordId}
            placeholder={recordIdentifier?.name ?? ''}
            type={recordIdentifier?.avatarType ?? 'rounded'}
          />
          <StyledFileInput
            ref={inputFileRef}
            onChange={onFileChange}
            type="file"
          />
        </StyledAvatarWrapper>

        <StyledNameBlock>
          <StyledTitle>
            <FieldContext.Provider
              value={{
                recordId: objectRecordId,
                isLabelIdentifier: false,
                fieldDefinition: {
                  type:
                    labelIdentifierFieldMetadataItem?.type ||
                    FieldMetadataType.TEXT,
                  iconName: '',
                  fieldMetadataId: labelIdentifierFieldMetadataItem?.id ?? '',
                  label: labelIdentifierFieldMetadataItem?.label || '',
                  metadata: {
                    fieldName: labelIdentifierFieldMetadataItem?.name || '',
                    objectMetadataNameSingular: objectNameSingular,
                  },
                  defaultValue: labelIdentifierFieldMetadataItem?.defaultValue,
                },
                useUpdateRecord: useUpdateOneObjectRecordMutation,
                isCentered: false,
                isDisplayModeFixHeight: true,
                isRecordFieldReadOnly: isTitleReadOnly,
              }}
            >
              <RecordTitleCell
                sizeVariant="md"
                containerType={RecordTitleCellContainerType.ShowPage}
              />
            </FieldContext.Provider>
          </StyledTitle>

          {(jobTitle || companyName) && (
            <StyledSubtitle>
              {jobTitle}
              {jobTitle && companyName ? ' · ' : ''}
              {companyName &&
                (isDefined(companyId) ? (
                  <StyledCompanyLink to={`/object/company/${companyId}`}>
                    {companyName}
                  </StyledCompanyLink>
                ) : (
                  companyName
                ))}
            </StyledSubtitle>
          )}
        </StyledNameBlock>
      </StyledIdentityRow>

      {(createdByName || city || primaryEmail || primaryPhone) && (
        <StyledMetaList>
          {primaryEmail && (
            <StyledMetaRow title={primaryEmail}>
              <StyledMetaIcon>
                <IconMail size={14} />
              </StyledMetaIcon>
              <StyledMetaValue>{primaryEmail}</StyledMetaValue>
              {/* LOCAL-PATCH (board card 2026-09-02): one-click copy next to
                  the email — "so I can copy it and send her an email from my
                  desktop app". Same for the phone below. */}
              <LightCopyIconButton copyText={primaryEmail} />
            </StyledMetaRow>
          )}
          {primaryPhone && (
            <StyledMetaRow title={primaryPhone}>
              <StyledMetaIcon>
                <IconPhone size={14} />
              </StyledMetaIcon>
              <StyledMetaValue>{primaryPhone}</StyledMetaValue>
              <LightCopyIconButton copyText={primaryPhone} />
            </StyledMetaRow>
          )}
          {createdByName && (
            <StyledMetaRow>
              <StyledMetaIcon>
                <IconUser size={14} />
              </StyledMetaIcon>
              <StyledMetaValue>{createdByName}</StyledMetaValue>
            </StyledMetaRow>
          )}
          {city && (
            <StyledMetaRow>
              <StyledMetaIcon>
                <IconMap size={14} />
              </StyledMetaIcon>
              <StyledMetaValue>{city}</StyledMetaValue>
            </StyledMetaRow>
          )}
        </StyledMetaList>
      )}

      {socialLinks.length > 0 && (
        <StyledSocialRow>
          {socialLinks.map(({ key, url, Icon }) => (
            <StyledSocialLink
              key={key}
              href={url}
              target="_blank"
              rel="noreferrer"
              title={key}
            >
              <Icon size={16} />
            </StyledSocialLink>
          ))}
        </StyledSocialRow>
      )}

      {!isInSidePanel && (
        <StyledActionRow>
          {visibleActions.map(({ key, Icon, label, onClick }) => (
            <StyledActionButton
              key={key}
              type="button"
              title={label}
              aria-label={label}
              isDisabled={!isDefined(onClick)}
              disabled={!isDefined(onClick)}
              onClick={onClick}
            >
              <Icon size={16} />
            </StyledActionButton>
          ))}
        </StyledActionRow>
      )}
    </StyledCard>
  );
};
