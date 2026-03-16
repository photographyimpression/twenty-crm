import { t } from '@lingui/core/macro';
import React, { useMemo, useState } from 'react';

import { type FieldPhonesValue } from '@/object-record/record-field/ui/types/FieldMetadata';
import { SmsChatWidget } from '@/sms/components/SmsChatWidget';
import { ExpandableList } from '@/ui/layout/expandable-list/components/ExpandableList';

import { useCallContext } from '@/calls/contexts/CallProvider';
import { styled } from '@linaria/react';
import { parsePhoneNumber } from 'libphonenumber-js';
import { isDefined } from 'twenty-shared/utils';
import { RoundedLink } from 'twenty-ui/navigation';
import { logError } from '~/utils/logError';

type PhonesDisplayProps = {
  value?: FieldPhonesValue;
  isFocused?: boolean;
  onPhoneNumberClick?: (
    phoneNumber: string,
    event: React.MouseEvent<HTMLElement>,
  ) => void;
};

const StyledContainer = styled.div`
  align-items: center;
  display: flex;
  gap: 4px;
  justify-content: flex-start;

  max-width: 100%;

  overflow: hidden;

  width: 100%;
`;

const StyledPhoneActions = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
`;

const StyledSmsButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 14px;
  color: #666;
  border-radius: 4px;
  line-height: 1;
  display: flex;
  align-items: center;

  &:hover {
    background: #f0f0f0;
    color: #1a73e8;
  }
`;

export const PhonesDisplay = ({
  value,
  isFocused,
  onPhoneNumberClick,
}: PhonesDisplayProps) => {
  const { dial } = useCallContext();
  const [smsTarget, setSmsTarget] = useState<string | null>(null);

  const phones = useMemo(
    () =>
      [
        value?.primaryPhoneNumber
          ? {
              number: value.primaryPhoneNumber,
              callingCode:
                value.primaryPhoneCallingCode ||
                value.primaryPhoneCountryCode ||
                '',
            }
          : null,
        ...parseAdditionalPhones(value?.additionalPhones),
      ]
        .filter(isDefined)
        .map(({ number, callingCode }) => {
          return {
            number,
            callingCode,
          };
        }),
    [
      value?.primaryPhoneNumber,
      value?.primaryPhoneCallingCode,
      value?.primaryPhoneCountryCode,
      value?.additionalPhones,
    ],
  );
  const parsePhoneNumberOrReturnInvalidValue = (number: string) => {
    try {
      return { parsedPhone: parsePhoneNumber(number) };
    } catch {
      return { invalidPhone: number };
    }
  };

  const renderPhoneItem = (
    number: string,
    callingCode: string,
    index: number,
  ) => {
    const { parsedPhone, invalidPhone } =
      parsePhoneNumberOrReturnInvalidValue(callingCode + number);
    const fullNumber = callingCode + number;

    return (
      <StyledPhoneActions key={index}>
        <RoundedLink
          href="#"
          label={
            parsedPhone ? parsedPhone.formatInternational() : invalidPhone
          }
          onClick={(event) => {
            if (onPhoneNumberClick) {
              onPhoneNumberClick(fullNumber, event);
            } else {
              event.preventDefault();
              event.stopPropagation();
              dial(fullNumber);
            }
          }}
        />
        <StyledSmsButton
          title="Send SMS"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const e164 = parsedPhone
              ? parsedPhone.format('E.164')
              : fullNumber;

            setSmsTarget(e164);
          }}
        >
          💬
        </StyledSmsButton>
      </StyledPhoneActions>
    );
  };

  return (
    <>
      {isFocused ? (
        <ExpandableList isChipCountDisplayed>
          {phones.map(({ number, callingCode }, index) =>
            renderPhoneItem(number, callingCode, index),
          )}
        </ExpandableList>
      ) : (
        <StyledContainer>
          {phones.map(({ number, callingCode }, index) =>
            renderPhoneItem(number, callingCode, index),
          )}
        </StyledContainer>
      )}
      {smsTarget && (
        <SmsChatWidget
          contactNumber={smsTarget}
          onClose={() => setSmsTarget(null)}
        />
      )}
    </>
  );
};

const parseAdditionalPhones = (additionalPhones?: any) => {
  if (!additionalPhones) {
    return [];
  }

  if (typeof additionalPhones === 'object') {
    return additionalPhones;
  }

  if (typeof additionalPhones === 'string') {
    try {
      return JSON.parse(additionalPhones);
    } catch (error) {
      logError(t`Error parsing additional phones: ${error}`);
    }
  }

  return [];
};
