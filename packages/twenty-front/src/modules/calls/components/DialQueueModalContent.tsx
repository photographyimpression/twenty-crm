/* eslint-disable lingui/no-unlocalized-strings */
// Impression fork: power-dialer queue for selected people (GHL-style).
// Opened from the bulk-selection command menu ("Call queue"): lists the
// selected records, dials each through the in-CRM WebRTC dialer one by one,
// and advances as the user finishes each call.
import { styled } from '@linaria/react';
import { useEffect, useRef, useState } from 'react';
import { useCallContext } from '@/calls/contexts/CallProvider';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { Button, IconButton } from 'twenty-ui/input';
import { IconPhone, IconX } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

type DialQueueEntry = {
  phone: string;
  label: string;
  recordId: string;
};

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
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.sm};
  padding: 0 ${themeCssVariables.spacing[4]} ${themeCssVariables.spacing[2]};
`;

const StyledList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  max-height: 320px;
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[4]};
`;

const StyledRow = styled.div<{ isActive?: boolean }>`
  align-items: center;
  border-radius: ${themeCssVariables.border.radius.sm};
  border: 1px solid
    ${({ isActive }) =>
      isActive
        ? themeCssVariables.color.blue
        : themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledLabel = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledMeta = styled.div`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledFooter = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

type RowStatus = 'waiting' | 'calling' | 'done' | 'no-phone';

// Records -> dial queue entries. People without a phone number are kept in
// the list as "No phone" so the user sees why they are skipped.
export const buildDialQueueEntries = (
  records: ObjectRecord[],
): DialQueueEntry[] =>
  records.map((record) => {
    const name = (record.name ?? {}) as { firstName?: string; lastName?: string };
    const phones = (record.phones ?? {}) as {
      primaryPhoneNumber?: string;
      primaryPhoneCallingCode?: string;
    };
    let phone = '';
    if (phones.primaryPhoneNumber) {
      const callingCode = phones.primaryPhoneCallingCode ?? '';
      phone = callingCode
        ? `${callingCode}${phones.primaryPhoneNumber}`
        : phones.primaryPhoneNumber.replace(/\D/g, '').length === 10
          ? `+1${phones.primaryPhoneNumber.replace(/\D/g, '')}`
          : phones.primaryPhoneNumber;
    }

    return {
      recordId: record.id,
      label:
        `${name.firstName ?? ''} ${name.lastName ?? ''}`.trim() || 'Unnamed',
      phone,
    };
  });

export const DialQueueModalContent = ({
  records,
  onClose,
}: {
  records: ObjectRecord[];
  onClose: () => void;
}) => {
  const { dial, inCall } = useCallContext();
  const entries = buildDialQueueEntries(records);
  const [statuses, setStatuses] = useState<RowStatus[]>(
    entries.map((entry) => (entry.phone ? 'waiting' : 'no-phone')),
  );
  const [current, setCurrent] = useState<number | null>(null);
  // Marks the transition user-side: we dial, the widget manages the call,
  // when it ends we re-enable "Call next".
  const wasInCallRef = useRef(false);

  useEffect(() => {
    if (inCall) {
      wasInCallRef.current = true;
      return;
    }
    if (wasInCallRef.current && current !== null) {
      wasInCallRef.current = false;
      setStatuses((prev) =>
        prev.map((status, index) => (index === current ? 'done' : status)),
      );
    }
  }, [inCall, current]);

  const call = (index: number) => {
    const entry = entries[index];

    if (!entry?.phone) return;
    setCurrent(index);
    setStatuses((prev) =>
      prev.map((status, i) => (i === index ? 'calling' : status)),
    );
    dial(entry.phone);
  };

  const nextIndex = (from: number) =>
    entries.findIndex(
      (entry, index) => index > from && entry.phone && statuses[index] === 'waiting',
    );

  const callNext = () => {
    const index = current === null ? -1 : current;
    const next = nextIndex(index);

    if (next === -1) {
      onClose();

      return;
    }
    call(next);
  };

  const remaining = statuses.filter((status) => status === 'waiting').length;
  const allSettled = current !== null && remaining === 0;

  return (
    <>
      <StyledHeader>
        <StyledTitle>Call queue ({entries.length})</StyledTitle>
        <IconButton Icon={IconX} onClick={onClose} size="small" />
      </StyledHeader>
      <StyledSubtitle>
        {allSettled
          ? 'Queue finished 🎉'
          : 'Each call opens in the dialer at the bottom right — hang up there, then come back and call the next one.'}
      </StyledSubtitle>
      <StyledList>
        {entries.map((entry, index) => (
          <StyledRow key={entry.recordId} isActive={index === current}>
            <StyledLabel>{entry.label}</StyledLabel>
            <StyledMeta>
              {statuses[index] === 'calling'
                ? '📞 calling…'
                : statuses[index] === 'done'
                  ? '✓ called'
                  : entry.phone || 'No phone'}
            </StyledMeta>
          </StyledRow>
        ))}
      </StyledList>
      <StyledFooter>
        {current === null ? (
          <Button
            Icon={IconPhone}
            title="Start calling"
            variant="primary"
            accent="blue"
            justify="center"
            disabled={remaining === 0}
            onClick={() => callNext()}
          />
        ) : (
          <Button
            Icon={IconPhone}
            title={allSettled ? 'Done' : inCall ? 'In call…' : 'Call next'}
            variant="primary"
            accent="blue"
            justify="center"
            disabled={inCall || remaining === 0}
            onClick={() => callNext()}
          />
        )}
        <Button
          title="Close"
          variant="secondary"
          justify="center"
          onClick={onClose}
        />
      </StyledFooter>
    </>
  );
};
