// LOCAL-PATCH: AI contact briefing panel (board card 2026-08-25 — "Can I have
// like the Claude right panel that is in Chrome… summaries of my contact that
// I have open… so I don't have to read it all through").
//
// A ✨ AI button on every PERSON page opens a right-hand drawer that briefs
// you on the contact: who they are, what they want, where it stands, next
// move. The record's own data (person fields + recent timeline) is assembled
// client-side and POSTed to the CRM server's /ai/contact-summary endpoint,
// which streams a summary from the box's own Ollama models — nothing leaves
// the server, no external API keys.
//
// Deliberately self-contained like StatusStrip: inline lucide-path SVG, no app
// atoms beyond the data hooks, Linaria styling. Re-apply on Twenty upgrades.

import { styled } from '@linaria/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { useTimelineActivities } from '@/activities/timeline-activities/hooks/useTimelineActivities';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { CoreObjectNameSingular } from 'twenty-shared/types';

type Flavor = 'fast' | 'balanced' | 'deep';

const FLAVOR_LABELS: Record<Flavor, string> = {
  fast: '⚡ Fast',
  balanced: '⚖️ Balanced',
  deep: '🧠 Deep',
};

// Matches the SMS page's server resolution: same origin in prod.
const getServerUrl = (): string => {
  const fromEnv = (
    import.meta as unknown as { env?: { REACT_APP_SERVER_BASE_URL?: string } }
  ).env?.REACT_APP_SERVER_BASE_URL;

  return fromEnv || window.location.origin;
};

// --- inline lucide-path sparkles icon ----------------------------------------

const IconSparkles = ({ size = 16 }: { size?: number }) => (
  <svg
    aria-hidden="true"
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width={size}
  >
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </svg>
);

const IconX = ({ size = 14 }: { size?: number }) => (
  <svg
    aria-hidden="true"
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width={size}
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

// --- styled bits ---------------------------------------------------------------

const StyledAiButton = styled.button`
  align-items: center;
  background: transparent;
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.color.violet};
  cursor: pointer;
  display: flex;
  font-size: 12px;
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: 4px;
  padding: ${themeCssVariables.spacing[2]};

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

const StyledDrawerOverlay = styled.div`
  background: ${themeCssVariables.background.overlayPrimary};
  inset: 0;
  position: fixed;
  z-index: 1100;
`;

const StyledDrawer = styled.div`
  background: ${themeCssVariables.background.primary};
  border-left: 1px solid ${themeCssVariables.border.color.medium};
  bottom: 0;
  box-shadow: ${themeCssVariables.boxShadow.strong};
  display: flex;
  flex-direction: column;
  font-size: 13px;
  max-width: 440px;
  position: fixed;
  right: 0;
  top: 0;
  width: 92vw;
  z-index: 1101;
`;

const StyledDrawerHeader = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  font-weight: ${themeCssVariables.font.weight.semiBold};
  gap: 8px;
  justify-content: space-between;
  padding: 12px 14px;
`;

const StyledDrawerClose = styled.button`
  background: none;
  border: none;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  padding: 4px;

  &:hover {
    color: ${themeCssVariables.font.color.primary};
  }
`;

const StyledFlavorRow = styled.div`
  display: flex;
  gap: 6px;
  padding: 12px 14px 0;
`;

const StyledFlavorButton = styled.button<{ isActive: boolean }>`
  background: ${({ isActive }) =>
    isActive ? themeCssVariables.color.violet : 'transparent'};
  border: 1px solid
    ${({ isActive }) =>
      isActive
        ? themeCssVariables.color.violet
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.grayScale.gray1
      : themeCssVariables.font.color.secondary};
  cursor: pointer;
  flex: 1;
  font-family: ${themeCssVariables.font.family};
  font-size: 12px;
  font-weight: ${themeCssVariables.font.weight.medium};
  padding: 7px 0;
`;

const StyledSummaryArea = styled.div`
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  line-height: 1.55;
  margin: 12px 14px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
`;

const StyledEmpty = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
  padding: 20px;
  text-align: center;
`;

const StyledRunButton = styled.button`
  background: ${themeCssVariables.color.violet};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.grayScale.gray1};
  cursor: pointer;
  font-family: ${themeCssVariables.font.family};
  font-size: 13px;
  font-weight: ${themeCssVariables.font.weight.medium};
  margin: 0 14px 14px;
  padding: 9px 0;

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`;

const StyledError = styled.div`
  color: ${themeCssVariables.color.red};
  font-size: 12px;
  margin: 8px 14px 0;
`;

// --- context assembly -----------------------------------------------------------

const field = (record: unknown, key: string): string => {
  const value = (record as Record<string, unknown> | null)?.[key];

  return typeof value === 'string' && value.trim() ? value.trim() : '';
};

// The most briefing-relevant person fields, in reading order. Custom fields
// are read defensively — a missing field just drops its line.
const buildPersonContext = (person: Record<string, unknown>): string => {
  const lines: string[] = [];
  const name = [field(person, 'name.firstName'), field(person, 'name.lastName')]
    .filter(Boolean)
    .join(' ');

  if (name) lines.push(`Name: ${name}`);

  const company = field(person, 'company.name') || field(person, 'company');

  if (company) lines.push(`Company: ${company}`);

  const email = field(person, 'emails.primaryEmail') || field(person, 'email');

  if (email) lines.push(`Email: ${email}`);

  const phone = [field(person, 'phones.primaryPhoneCallingCode'), field(person, 'phones.primaryPhoneNumber')]
    .filter(Boolean)
    .join(' ');

  if (phone) lines.push(`Phone: ${phone}`);

  const simpleFields: [string, string][] = [
    ['contactType', 'Contact type'],
    ['niche', 'Niche'],
    ['sequenceTag', 'Sequence'],
    ['jobTitle', 'Job title'],
    ['city', 'City'],
    ['ghlPhotoshootRequest', 'Photoshoot request'],
    ['ghlProjectBackground', 'Project background'],
    ['ghlBudgetRange', 'Budget range'],
    ['ghlCallOutcome', 'Call outcome'],
    ['ghlCallSummary', 'Call summary'],
    ['ghlAiSummary', 'Previous AI summary'],
    ['ghlTags', 'Tags'],
    ['ghlUrgencyFlag', 'Urgency'],
  ];

  for (const [key, label] of simpleFields) {
    const value = field(person, key);

    if (value) lines.push(`${label}: ${value}`);
  }

  const createdAt = field(person, 'createdAt');

  if (createdAt) lines.push(`In CRM since: ${createdAt.slice(0, 10)}`);

  return lines.join('\n');
};

const MAX_TIMELINE_ITEMS = 40;

const buildTimelineContext = (activities: TimelineActivity[]): string =>
  activities
    .slice(0, MAX_TIMELINE_ITEMS)
    .map((activity) => {
      const date = activity.createdAt?.slice(0, 10) ?? '';
      const title = activity.linkedRecordCachedName ?? '';
      const kind = activity.name ?? '';

      return `- ${date} ${kind} ${title}`.trim();
    })
    .join('\n');

// --- the button + drawer ---------------------------------------------------------

export const AiSummarySidePanel = ({
  personId,
}: {
  personId: string | undefined;
}) => {
  const [open, setOpen] = useState(false);
  const [flavor, setFlavor] = useState<Flavor>('fast');
  const [summary, setSummary] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const runTokenRef = useRef(0);

  // Load the person + their timeline unconditionally (cheap, cached by Apollo
  // — the record page already fetched both); the AI call only happens on run.
  const { records: people } = useFindManyRecords({
    objectNameSingular: CoreObjectNameSingular.Person,
    filter: { id: { eq: personId ?? '' } },
    skip: !personId,
    fetchPolicy: 'cache-first',
  });

  const { timelineActivities } = useTimelineActivities({
    id: personId ?? '',
    targetObjectNameSingular: CoreObjectNameSingular.Person,
  });

  const person = people[0] as Record<string, unknown> | undefined;

  const context = useMemo(
    () =>
      [
        person ? buildPersonContext(person) : '',
        timelineActivities?.length
          ? `Recent activity (newest first):\n${buildTimelineContext(timelineActivities)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    [person, timelineActivities],
  );

  const run = useCallback(
    async (selectedFlavor: Flavor) => {
      if (!context.trim()) {
        setError('Nothing to summarize yet on this record.');
        return;
      }
      const token = ++runTokenRef.current;
      setRunning(true);
      setError('');
      setSummary('');
      try {
        const response = await fetch(
          `${getServerUrl()}/ai/contact-summary`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context, flavor: selectedFlavor }),
          },
        );

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;

          throw new Error(data?.error || `Request failed (${response.status})`);
        }
        if (!response.body) {
          throw new Error('No response stream');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = '';

        for (;;) {
          const { done, value } = await reader.read();

          if (done) break;

          text += decoder.decode(value, { stream: true });

          if (runTokenRef.current === token) {
            setSummary(text);
          }
        }
      } catch (err) {
        if (runTokenRef.current === token) {
          setError((err as Error).message || 'The summary failed.');
        }
      } finally {
        if (runTokenRef.current === token) {
          setRunning(false);
        }
      }
    },
    [context],
  );

  // First open of a contact auto-runs the briefing — the whole point is
  // "open the panel, read the brief".
  useEffect(() => {
    if (open && !running && !summary && !error) {
      void run(flavor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const onFlavorChange = (nextFlavor: Flavor) => {
    setFlavor(nextFlavor);
    setSummary('');
    setError('');
    void run(nextFlavor);
  };

  return (
    <>
      <StyledAiButton
        onClick={() => setOpen(true)}
        title="AI briefing for this contact"
      >
        <IconSparkles />
        AI
      </StyledAiButton>
      {open ? (
        <>
          <StyledDrawerOverlay onClick={() => setOpen(false)} />
          <StyledDrawer>
            <StyledDrawerHeader>
              <span
                style={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '6px',
                }}
              >
                <IconSparkles />
                AI briefing
              </span>
              <StyledDrawerClose
                aria-label="Close"
                onClick={() => setOpen(false)}
                type="button"
              >
                <IconX />
              </StyledDrawerClose>
            </StyledDrawerHeader>
            <StyledFlavorRow>
              {(Object.keys(FLAVOR_LABELS) as Flavor[]).map((key) => (
                <StyledFlavorButton
                  isActive={key === flavor}
                  key={key}
                  onClick={() => onFlavorChange(key)}
                  type="button"
                >
                  {FLAVOR_LABELS[key]}
                </StyledFlavorButton>
              ))}
            </StyledFlavorRow>
            <StyledError>{error}</StyledError>
            <StyledSummaryArea>
              {summary ? (
                summary
              ) : running ? (
                <StyledEmpty>
                  <IconSparkles size={22} />
                  Reading this contact&apos;s history… (the studio&apos;s own
                  AI, it takes a moment)
                </StyledEmpty>
              ) : (
                <StyledEmpty>Run a briefing for this contact.</StyledEmpty>
              )}
            </StyledSummaryArea>
            <StyledRunButton
              disabled={running || !context.trim()}
              onClick={() => void run(flavor)}
              type="button"
            >
              {running ? 'Thinking…' : summary ? 'Regenerate' : 'Summarize'}
            </StyledRunButton>
          </StyledDrawer>
        </>
      ) : null}
    </>
  );
};
