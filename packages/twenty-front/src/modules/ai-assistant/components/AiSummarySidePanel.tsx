// LOCAL-PATCH: AI contact briefing panel (board card 2026-08-25 — "Can I have
// like the Claude right panel that is in Chrome… summaries of my contact that
// I have open… so I don't have to read it all through").
//
// v2 (board card 2026-09-24 — "Take away this AI thing. It's just taking
// long… I'm just running it in Microsoft Edge and using the built-in
// Microsoft AI. It's much faster"): the drawer no longer calls the CRM
// server's Ollama endpoint — that model took a long time to even start
// thinking. It now runs on the BROWSER'S built-in AI (Edge/Chrome Prompt
// API: the LanguageModel global, falling back to the older window.ai
// languageModel), which starts immediately and never leaves the machine.
// When the browser has no built-in AI (Safari, Firefox…), the button is
// simply not rendered — "taken away", per the card.
//
// Deliberately self-contained like StatusStrip: inline lucide-path SVG, no app
// atoms beyond the data hooks, Linaria styling. Re-apply on Twenty upgrades.

import { styled } from '@linaria/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { useTimelineActivities } from '@/activities/timeline-activities/hooks/useTimelineActivities';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { CoreObjectNameSingular } from 'twenty-shared/types';

// --- browser built-in AI (Prompt API), typed locally -----------------------------

type PromptApiSession = {
  prompt: (input: string) => Promise<string>;
  destroy?: () => void;
};

type PromptApiModel = {
  // Current spec shape: async availability().
  availability?: () => Promise<
    'unavailable' | 'downloadable' | 'downloading' | 'available'
  >;
  // Legacy Edge shape: sync capabilities().available.
  capabilities?: () => { available?: 'readily' | 'after-download' | 'no' };
  create: (options?: {
    initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  }) => Promise<PromptApiSession>;
};

const getPromptApi = (): PromptApiModel | null => {
  const w = window as unknown as {
    LanguageModel?: PromptApiModel;
    ai?: { languageModel?: PromptApiModel };
  };

  return w.LanguageModel ?? w.ai?.languageModel ?? null;
};

// True only when a local model is ready to answer right away. Anything else
// (no API, model not downloaded) means the button stays hidden.
const isPromptApiReady = async (api: PromptApiModel): Promise<boolean> => {
  try {
    if (typeof api.availability === 'function') {
      return (await api.availability()) === 'available';
    }
    if (typeof api.capabilities === 'function') {
      return api.capabilities()?.available === 'readily';
    }
  } catch {
    return false;
  }

  return false;
};

const SYSTEM_PROMPT =
  'You are a briefing assistant for a photography studio CRM. Using only the ' +
  'record data provided, write a concise briefing about this contact: who ' +
  'they are, what they want, where things stand, and the suggested next ' +
  'move. Short and concrete — a few plain sentences or bullet lines, no preamble.';

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

const StyledDrawerSubheader = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: 11px;
  font-weight: ${themeCssVariables.font.weight.regular};
  white-space: nowrap;
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
  const [summary, setSummary] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  // The browser either has built-in AI ready (Edge/Chrome with the Prompt
  // API) or the whole button stays hidden — board card 2026-09-24: no slow
  // server round-trip, no waiting-for-Ollama spinner.
  const [aiReady, setAiReady] = useState(false);

  useEffect(() => {
    const api = getPromptApi();

    if (!api) return;

    let cancelled = false;

    void isPromptApiReady(api).then((ready) => {
      if (!cancelled) setAiReady(ready);
    });

    return () => {
      cancelled = true;
    };
  }, []);

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

  const run = useCallback(async () => {
    if (!context.trim()) {
      setError('Nothing to summarize yet on this record.');
      return;
    }
    const api = getPromptApi();

    if (!api) {
      setError("This browser has no built-in AI available.");
      return;
    }
    setRunning(true);
    setError('');
    setSummary('');
    try {
      const session = await api.create({
        initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      });
      const text = await session.prompt(context);
      session.destroy?.();

      setSummary(text.trim());
    } catch (err) {
      setError((err as Error).message || 'The summary failed.');
    } finally {
      setRunning(false);
    }
  }, [context]);

  // First open of a contact auto-runs the briefing — the whole point is
  // "open the panel, read the brief".
  useEffect(() => {
    if (open && !running && !summary && !error) {
      void run();
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

  if (!aiReady) return null;

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
                <StyledDrawerSubheader>
                  this browser&apos;s built-in AI
                </StyledDrawerSubheader>
              </span>
              <StyledDrawerClose
                aria-label="Close"
                onClick={() => setOpen(false)}
                type="button"
              >
                <IconX />
              </StyledDrawerClose>
            </StyledDrawerHeader>
            <StyledError>{error}</StyledError>
            <StyledSummaryArea>
              {summary ? (
                summary
              ) : running ? (
                <StyledEmpty>
                  <IconSparkles size={22} />
                  Thinking… (runs instantly, right on this machine)
                </StyledEmpty>
              ) : (
                <StyledEmpty>Run a briefing for this contact.</StyledEmpty>
              )}
            </StyledSummaryArea>
            <StyledRunButton
              disabled={running || !context.trim()}
              onClick={() => void run()}
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
