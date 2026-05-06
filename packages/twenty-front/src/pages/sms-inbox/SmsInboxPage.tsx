import { styled } from '@linaria/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconMessage, IconSearch, IconSend, IconX } from 'twenty-ui/display';
import {
  AnimatedPlaceholder,
  AnimatedPlaceholderEmptyContainer,
  AnimatedPlaceholderEmptySubTitle,
  AnimatedPlaceholderEmptyTextContainer,
  AnimatedPlaceholderEmptyTitle,
  EMPTY_PLACEHOLDER_TRANSITION_PROPS,
  Section,
} from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { ActivityList } from '@/activities/components/ActivityList';
import { markSmsAsRead } from '@/sms/hooks/useUnreadSmsCount';
import { PageBody } from '@/ui/layout/page/components/PageBody';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';

type SmsRecord = {
  id: string;
  from: string | { phone_number?: string } | null;
  to:
    | string
    | { phone_number?: string }
    | Array<{ phone_number?: string }>
    | null;
  text: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  status: string;
};

type SmsThread = {
  counterpartyDigits: string;
  counterpartyDisplay: string;
  lastMessage: SmsRecord;
  messages: SmsRecord[];
};

const POLL_INTERVAL_MS = 5000;

const StyledLayout = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-direction: row;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 0;
`;

const StyledList = styled.div`
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow: auto;
  padding: ${themeCssVariables.spacing[6]} ${themeCssVariables.spacing[6]}
    ${themeCssVariables.spacing[2]};
`;

const StyledDetailColumn = styled.div`
  background: ${themeCssVariables.background.primary};
  border-left: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex: 0 0 480px;
  flex-direction: column;
  height: 100%;
  min-width: 0;
`;

const StyledTitleRow = styled.div`
  align-items: baseline;
  display: flex;
  font-size: ${themeCssVariables.font.size.xl};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  gap: ${themeCssVariables.spacing[2]};
  margin-bottom: ${themeCssVariables.spacing[3]};
`;

const StyledCount = styled.span`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.regular};
`;

const StyledControlsRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  margin-bottom: ${themeCssVariables.spacing[3]};
`;

const StyledSearchWrapper = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex: 1;
  gap: ${themeCssVariables.spacing[2]};
  height: 32px;
  max-width: 480px;
  padding: 0 ${themeCssVariables.spacing[2]};

  &:focus-within {
    border-color: ${themeCssVariables.border.color.medium};
  }
`;

const StyledSearchInput = styled.input`
  background: transparent;
  border: none;
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-size: ${themeCssVariables.font.size.sm};
  outline: none;
  padding: 0;

  &::placeholder {
    color: ${themeCssVariables.font.color.tertiary};
  }
`;

const StyledClearButton = styled.button`
  align-items: center;
  background: transparent;
  border: none;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  padding: 0;

  &:hover {
    color: ${themeCssVariables.font.color.primary};
  }
`;

const StyledThreadRow = styled.div<{ isSelected: boolean }>`
  background: ${({ isSelected }) =>
    isSelected
      ? themeCssVariables.background.transparent.lighter
      : 'transparent'};
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};

  &:hover {
    background: ${themeCssVariables.background.transparent.lighter};
  }
`;

const StyledThreadHeader = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledThreadName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledThreadTime = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  flex-shrink: 0;
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledThreadPreview = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledDetailHeader = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-shrink: 0;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

const StyledDetailHeaderText = styled.div`
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledCloseButton = styled.button`
  background: transparent;
  border: none;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  padding: ${themeCssVariables.spacing[1]};

  &:hover {
    color: ${themeCssVariables.font.color.primary};
  }
`;

const StyledMessages = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledBubbleWrapper = styled.div<{ isOutbound: boolean }>`
  align-items: ${({ isOutbound }) => (isOutbound ? 'flex-end' : 'flex-start')};
  display: flex;
  flex-direction: column;
`;

const StyledBubble = styled.div<{ isOutbound: boolean }>`
  background: ${({ isOutbound }) =>
    isOutbound
      ? themeCssVariables.color.blue
      : themeCssVariables.background.tertiary};
  border-radius: 16px;
  color: ${({ isOutbound }) =>
    isOutbound
      ? themeCssVariables.font.color.inverted
      : themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  line-height: 1.4;
  max-width: 80%;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  white-space: pre-wrap;
  word-break: break-word;
`;

const StyledBubbleTime = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  margin-top: 2px;
`;

const StyledComposer = styled.form`
  align-items: center;
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-shrink: 0;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledComposerInput = styled.textarea`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  max-height: 120px;
  min-height: 40px;
  outline: none;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  resize: none;

  &:focus {
    border-color: ${themeCssVariables.border.color.medium};
  }
`;

const StyledSendButton = styled.button`
  align-items: center;
  background: ${themeCssVariables.color.blue};
  border: none;
  border-radius: 50%;
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  display: flex;
  flex-shrink: 0;
  height: 36px;
  justify-content: center;
  width: 36px;

  &:disabled {
    background: ${themeCssVariables.background.transparent.medium};
    cursor: not-allowed;
  }
`;

const StyledStatus = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  flex-shrink: 0;
  font-size: ${themeCssVariables.font.size.xs};
  padding: 0 ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[1]};
  text-align: center;
`;

const useDebouncedValue = <T,>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);

    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
};

const extractPhoneString = (
  val: SmsRecord['from'] | SmsRecord['to'],
): string => {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return extractPhoneString(val[0] ?? null);
  if (typeof val === 'object' && 'phone_number' in val) {
    return val.phone_number ?? '';
  }
  return '';
};

const normalizeDigits = (phone: string): string => phone.replace(/\D/g, '');

const formatPhoneDisplay = (phone: string): string => {
  const digits = normalizeDigits(phone);

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return phone || digits;
};

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

  if (now.getTime() - date.getTime() < oneWeekMs) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatBubbleTime = (timestamp: string): string => {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const groupBySmsThreads = (records: SmsRecord[]): SmsThread[] => {
  const map = new Map<string, SmsThread>();

  for (const record of records) {
    const counterpartyRaw =
      record.direction === 'inbound'
        ? extractPhoneString(record.from)
        : extractPhoneString(record.to);
    const digits = normalizeDigits(counterpartyRaw);

    if (digits.length === 0) continue;

    const existing = map.get(digits);

    if (existing) {
      existing.messages.push(record);

      if (
        new Date(record.timestamp).getTime() >
        new Date(existing.lastMessage.timestamp).getTime()
      ) {
        existing.lastMessage = record;
      }
    } else {
      map.set(digits, {
        counterpartyDigits: digits,
        counterpartyDisplay: formatPhoneDisplay(counterpartyRaw),
        lastMessage: record,
        messages: [record],
      });
    }
  }

  for (const thread of map.values()) {
    thread.messages.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  return [...map.values()].sort(
    (a, b) =>
      new Date(b.lastMessage.timestamp).getTime() -
      new Date(a.lastMessage.timestamp).getTime(),
  );
};

const filterThreads = (threads: SmsThread[], search: string): SmsThread[] => {
  if (search.trim().length === 0) {
    return threads;
  }

  const needle = search.trim().toLowerCase();
  const needleDigits = normalizeDigits(needle);

  return threads.filter((thread) => {
    if (
      needleDigits.length > 0 &&
      thread.counterpartyDigits.includes(needleDigits)
    ) {
      return true;
    }

    if (thread.counterpartyDisplay.toLowerCase().includes(needle)) {
      return true;
    }

    return thread.messages.some((message) =>
      message.text?.toLowerCase().includes(needle),
    );
  });
};

const getServerUrl = (): string => {
  const fromEnv = (
    import.meta as unknown as { env?: { REACT_APP_SERVER_BASE_URL?: string } }
  ).env?.REACT_APP_SERVER_BASE_URL;

  return fromEnv || window.location.origin;
};

export const SmsInboxPage = () => {
  const { t } = useLingui();
  const [records, setRecords] = useState<SmsRecord[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 200);
  const [selectedDigits, setSelectedDigits] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const serverUrl = getServerUrl();

  const fetchRecords = useCallback(async () => {
    try {
      const response = await fetch(`${serverUrl}/telnyx/sms-records`);

      if (!response.ok) return;

      const result = (await response.json()) as { data?: SmsRecord[] };

      setRecords(Array.isArray(result.data) ? result.data : []);
    } catch {
      // Silently retry on next poll
    }
  }, [serverUrl]);

  useEffect(() => {
    // Mark all SMS as read whenever the user opens this page so the
    // unread badge in the side nav resets.
    markSmsAsRead();
    void fetchRecords();
    const id = setInterval(() => void fetchRecords(), POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [fetchRecords]);

  const threads = useMemo(() => groupBySmsThreads(records), [records]);
  const visibleThreads = useMemo(
    () => filterThreads(threads, debouncedSearch),
    [threads, debouncedSearch],
  );

  const selectedThread = useMemo(
    () =>
      selectedDigits
        ? (threads.find((t) => t.counterpartyDigits === selectedDigits) ?? null)
        : null,
    [selectedDigits, threads],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedThread?.messages.length]);

  const handleSelectThread = (digits: string) => {
    setSelectedDigits(digits);
    setComposerText('');
    setStatusText('');
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = composerText.trim();

    if (!text || !selectedThread || sending) return;

    setSending(true);
    setStatusText(t`Sending…`);

    try {
      const recipient =
        extractPhoneString(
          selectedThread.lastMessage.direction === 'inbound'
            ? selectedThread.lastMessage.from
            : selectedThread.lastMessage.to,
        ) || `+${selectedThread.counterpartyDigits}`;

      // Reply from the SAME Telnyx number that received the contact's
      // last inbound message. Walk recent → old to find the most
      // recent inbound and use its `to`. Fall back to the most recent
      // outbound's `from`. Either way Telnyx threads correctly.
      const ourNumber = (() => {
        for (let i = selectedThread.messages.length - 1; i >= 0; i -= 1) {
          const message = selectedThread.messages[i];

          if (message.direction === 'inbound') {
            const fromTo = extractPhoneString(message.to);

            if (fromTo) return fromTo;
          } else {
            const fromOut = extractPhoneString(message.from);

            if (fromOut) return fromOut;
          }
        }

        return undefined;
      })();

      const response = await fetch(`${serverUrl}/telnyx/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, text, from: ourNumber }),
      });

      if (response.ok) {
        setComposerText('');
        setStatusText(t`Sent`);

        // Optimistic append; the next poll will reconcile
        const optimistic: SmsRecord = {
          id: `local-${Date.now()}`,
          from: '',
          to: recipient,
          text,
          direction: 'outbound',
          timestamp: new Date().toISOString(),
          status: 'sent',
        };

        setRecords((prev) => [...prev, optimistic]);
        setTimeout(() => setStatusText(''), 1500);
      } else {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        setStatusText(t`Failed: ${errorBody.error ?? 'Unknown error'}`);
      }
    } catch {
      setStatusText(t`Failed to send. Check your connection.`);
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend(event as unknown as React.FormEvent);
    }
  };

  return (
    <PageContainer>
      <PageHeader title={t`SMS`} Icon={IconMessage} />
      <PageBody>
        <StyledLayout>
          <StyledList>
            <Section>
              <StyledTitleRow>
                <Trans>Conversations</Trans>
                <StyledCount>{visibleThreads.length}</StyledCount>
              </StyledTitleRow>
              <StyledControlsRow>
                <StyledSearchWrapper>
                  <IconSearch
                    size={14}
                    color={themeCssVariables.font.color.tertiary}
                  />
                  <StyledSearchInput
                    type="text"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder={t`Search by number or message…`}
                    aria-label={t`Search SMS`}
                  />
                  {searchInput.length > 0 && (
                    <StyledClearButton
                      type="button"
                      onClick={() => setSearchInput('')}
                      aria-label={t`Clear search`}
                    >
                      <IconX size={14} />
                    </StyledClearButton>
                  )}
                </StyledSearchWrapper>
              </StyledControlsRow>
              {visibleThreads.length === 0 && (
                <AnimatedPlaceholderEmptyContainer
                  // oxlint-disable-next-line react/jsx-props-no-spreading
                  {...EMPTY_PLACEHOLDER_TRANSITION_PROPS}
                >
                  <AnimatedPlaceholder type="emptyInbox" />
                  <AnimatedPlaceholderEmptyTextContainer>
                    <AnimatedPlaceholderEmptyTitle>
                      {debouncedSearch.length > 0 ? (
                        <Trans>No matching conversations</Trans>
                      ) : (
                        <Trans>No SMS messages yet</Trans>
                      )}
                    </AnimatedPlaceholderEmptyTitle>
                    <AnimatedPlaceholderEmptySubTitle>
                      {debouncedSearch.length > 0 ? (
                        <Trans>Try a different keyword.</Trans>
                      ) : (
                        <Trans>
                          Inbound SMS messages will appear here automatically.
                        </Trans>
                      )}
                    </AnimatedPlaceholderEmptySubTitle>
                  </AnimatedPlaceholderEmptyTextContainer>
                </AnimatedPlaceholderEmptyContainer>
              )}
              {visibleThreads.length > 0 && (
                <ActivityList>
                  {visibleThreads.map((thread) => (
                    <StyledThreadRow
                      key={thread.counterpartyDigits}
                      isSelected={selectedDigits === thread.counterpartyDigits}
                      onClick={() =>
                        handleSelectThread(thread.counterpartyDigits)
                      }
                    >
                      <StyledThreadHeader>
                        <StyledThreadName>
                          {thread.counterpartyDisplay}
                        </StyledThreadName>
                        <StyledThreadTime>
                          {formatTimestamp(thread.lastMessage.timestamp)}
                        </StyledThreadTime>
                      </StyledThreadHeader>
                      <StyledThreadPreview>
                        {thread.lastMessage.direction === 'outbound'
                          ? `${t`You`}: ${thread.lastMessage.text}`
                          : thread.lastMessage.text}
                      </StyledThreadPreview>
                    </StyledThreadRow>
                  ))}
                </ActivityList>
              )}
            </Section>
          </StyledList>
          {selectedThread && (
            <StyledDetailColumn>
              <StyledDetailHeader>
                <StyledDetailHeaderText>
                  {selectedThread.counterpartyDisplay}
                </StyledDetailHeaderText>
                <StyledCloseButton
                  type="button"
                  aria-label={t`Close conversation`}
                  onClick={() => setSelectedDigits(null)}
                >
                  <IconX size={16} />
                </StyledCloseButton>
              </StyledDetailHeader>
              <StyledMessages>
                {selectedThread.messages.map((msg) => (
                  <StyledBubbleWrapper
                    key={msg.id}
                    isOutbound={msg.direction === 'outbound'}
                  >
                    <StyledBubble isOutbound={msg.direction === 'outbound'}>
                      {msg.text}
                    </StyledBubble>
                    <StyledBubbleTime>
                      {formatBubbleTime(msg.timestamp)}
                    </StyledBubbleTime>
                  </StyledBubbleWrapper>
                ))}
                <div ref={messagesEndRef} />
              </StyledMessages>
              {statusText && <StyledStatus>{statusText}</StyledStatus>}
              <StyledComposer onSubmit={handleSend}>
                <StyledComposerInput
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={t`Type a reply… (Enter to send, Shift+Enter for newline)`}
                  rows={1}
                />
                <StyledSendButton
                  type="submit"
                  aria-label={t`Send SMS`}
                  disabled={sending || composerText.trim().length === 0}
                >
                  <IconSend size={16} />
                </StyledSendButton>
              </StyledComposer>
            </StyledDetailColumn>
          )}
        </StyledLayout>
      </PageBody>
    </PageContainer>
  );
};
