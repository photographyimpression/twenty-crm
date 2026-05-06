import React, { useMemo, useState } from 'react';

import { EmailComposerWidget } from '@/email/components/EmailComposerWidget';
import { type FieldEmailsValue } from '@/object-record/record-field/ui/types/FieldMetadata';
import { ExpandableList } from '@/ui/layout/expandable-list/components/ExpandableList';
import { styled } from '@linaria/react';
import { isDefined } from 'twenty-shared/utils';
import { RoundedLink } from 'twenty-ui/navigation';

type EmailsDisplayProps = {
  value?: FieldEmailsValue;
  isFocused?: boolean;
  onEmailClick?: (email: string, event: React.MouseEvent<HTMLElement>) => void;
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

const StyledEmailRow = styled.div`
  align-items: center;
  display: flex;
  gap: 2px;
`;

const StyledComposeButton = styled.button`
  align-items: center;
  background: none;
  border: none;
  border-radius: 4px;
  color: #666;
  cursor: pointer;
  display: flex;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;

  &:hover {
    background: #f0f0f0;
    color: #1a73e8;
  }
`;

export const EmailsDisplay = ({
  value,
  isFocused,
  onEmailClick,
}: EmailsDisplayProps) => {
  const [composerTarget, setComposerTarget] = useState<string | null>(null);

  const emails = useMemo(
    () =>
      [
        value?.primaryEmail ? value.primaryEmail : null,
        ...(value?.additionalEmails ?? []),
      ].filter(isDefined),
    [value?.primaryEmail, value?.additionalEmails],
  );

  const renderEmail = (email: string, index: number) => (
    <StyledEmailRow key={index}>
      <RoundedLink
        label={email}
        href={`mailto:${email}`}
        onClick={(event) => onEmailClick?.(email, event)}
      />
      <StyledComposeButton
        type="button"
        title="Compose email"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setComposerTarget(email);
        }}
      >
        ✉️
      </StyledComposeButton>
    </StyledEmailRow>
  );

  return (
    <>
      {isFocused ? (
        <ExpandableList isChipCountDisplayed>
          {emails.map(renderEmail)}
        </ExpandableList>
      ) : (
        <StyledContainer>{emails.map(renderEmail)}</StyledContainer>
      )}
      {composerTarget && (
        <EmailComposerWidget
          toEmail={composerTarget}
          onClose={() => setComposerTarget(null)}
        />
      )}
    </>
  );
};
