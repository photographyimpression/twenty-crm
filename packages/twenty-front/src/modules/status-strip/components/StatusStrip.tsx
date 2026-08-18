// LOCAL-PATCH: status strip (update loop)
//
// Local fork-only patch (not for upstream). Four-icon status strip mounted in
// the record-index top bar (ViewBar), mirroring the Feedback Board's header
// lights (tools/feedback-board). It talks to the board's PUBLIC browser
// endpoints only — token-in-URL via REACT_APP_FEEDBACK_BOARD_URL — and never
// sends the BOARD_SECRET (that stays server-only).
//
//   RED     message-square-plus — opens the quick-request popup (POSTs to the
//                                 board's public submit endpoint). Never pulses.
//   AMBER   circle-help         — lit while cards sit in 'discussion' waiting
//                                 for the owner's decision; hover lists titles.
//   GREEN   hammer (dim ~55%)   — lit on 'inbox'/'tobuild' cards; hover lists
//                                 them urgent-first (⚡).
//   GREEN   arrow-down-to-line  — solid + pulsing ONLY when /crm-version.json
//                                 advertises a newer build than this page.
//                                 Click reloads to apply when pulsing, opens
//                                 the board changelog otherwise.
//
// Version comparison: prefers the build-time-injected REACT_APP_GIT_SHA
// (export it when building — see scripts/deploy-status-strip.md). Without it,
// falls back to the FIRST /crm-version.json observed this page-load, kept in a
// module-level variable (in-memory ONLY, so a reload re-baselines and the
// arrow never sticks). Limitation of the fallback: a version published BEFORE
// the page loaded is invisible — the baseline is whatever was live at load.
//
// Deliberately self-contained: no app atoms/hooks, inline lucide-path SVGs,
// Linaria styling like the rest of the top bar. Update detection intentionally
// avoids localStorage/sessionStorage (they survive location.reload() — the
// very action this strip performs — and would leave the arrow stuck pulsing).

import { styled } from '@linaria/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const FEEDBACK_BOARD_URL = (
  import.meta.env.REACT_APP_FEEDBACK_BOARD_URL || ''
).replace(/\/+$/, '');

// Static version file served by nginx from /opt/crm-version.json (see
// scripts/deploy-status-strip.md). Same origin as the app, so no CORS.
const CRM_VERSION_URL = '/crm-version.json';

// Baked at build time by the deploy flow: REACT_APP_GIT_SHA=<git sha/tag>.
// Vite statically replaces REACT_APP_* vars, so this costs nothing at runtime.
const BUILD_VERSION: string | null = import.meta.env.REACT_APP_GIT_SHA || null;

const POLL_INTERVAL_MS = 60_000;

// Fallback baseline: first version seen this page-load. Module-level so it
// survives ViewBar remounts but dies on reload (see header comment).
let firstSeenVersionThisPageLoad: string | null = null;

type BoardCard = {
  id: string;
  title: string;
  column: string;
  urgent?: boolean;
  createdAt?: string;
};

type CrmVersion = {
  version: string;
  notes: string;
  builtAt: string;
};

type PopoverKey = 'discussion' | 'queue' | 'update';

// --- inline lucide-path icons (message-square-plus, circle-help, hammer,
// arrow-down-to-line) — no icon-library dependency, stroke = currentColor ----

const IconMessageSquarePlus = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 10h8" />
    <path d="M12 6v8" />
  </svg>
);

const IconCircleHelp = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

const IconHammer = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" />
    <path d="m18 15 4-4" />
    <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
  </svg>
);

const IconArrowDownToLine = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <path d="M12 17V3" />
    <path d="m6 11 6 6 6-6" />
    <path d="M19 21H5" />
  </svg>
);

// --- styled bits (Linaria, sized like StyledHeaderDropdownButton) ------------

const StyledStrip = styled.div`
  align-items: center;
  display: flex;
  flex-direction: row;
  gap: 2px;
`;

// Wrapper per icon: position:relative anchor for the hover popover. The
// popover must be a SIBLING of the button (a div/button inside a button is
// invalid HTML and breaks click handling).
const StyledIconWrap = styled.div`
  display: flex;
  position: relative;
`;

const StyledIconButton = styled.button`
  align-items: center;
  background: transparent;
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  cursor: pointer;
  display: flex;
  padding: ${themeCssVariables.spacing[1]};

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

// Pulsing wrapper for the update arrow — the ONLY element that ever animates.
const StyledPulse = styled.span`
  align-items: center;
  animation: localpatch-status-strip-pulse 1.5s ease-in-out infinite;
  display: flex;

  @keyframes localpatch-status-strip-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
`;

const StyledPopover = styled.div`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-shadow: ${themeCssVariables.boxShadow.strong};
  color: ${themeCssVariables.font.color.primary};
  font-size: 12px;
  font-weight: ${themeCssVariables.font.weight.regular};
  max-width: 320px;
  min-width: 240px;
  padding: 10px 12px;
  position: absolute;
  right: 0;
  text-align: left;
  top: calc(100% + 6px);
  white-space: normal;
  z-index: 1000;
`;

const StyledPopoverTitle = styled.p`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: 11px;
  font-weight: ${themeCssVariables.font.weight.semiBold};
  letter-spacing: 0.3px;
  margin: 0 0 6px;
  text-transform: uppercase;
`;

const StyledPopoverList = styled.ul`
  list-style: none;
  margin: 0;
  max-height: 220px;
  overflow-y: auto;
  padding: 0;
`;

const StyledPopoverListItem = styled.li`
  align-items: baseline;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  gap: 6px;
  line-height: 1.35;
  padding: 3px 0;
`;

const StyledMore = styled.p`
  color: ${themeCssVariables.font.color.tertiary};
  margin: 4px 0 0;
`;

const StyledPopoverLink = styled.button`
  background: none;
  border: none;
  color: ${themeCssVariables.color.blue};
  cursor: pointer;
  font-size: 12px;
  margin-top: 8px;
  padding: 0;
  text-align: left;

  &:hover {
    text-decoration: underline;
  }
`;

const StyledOverlay = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.overlayPrimary};
  display: flex;
  inset: 0;
  justify-content: center;
  position: fixed;
  z-index: 1001;
`;

const StyledPopupCard = styled.div`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-shadow: ${themeCssVariables.boxShadow.superHeavy};
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex-direction: column;
  font-size: 13px;
  padding: 16px;
  width: 360px;
`;

const StyledPopupTitle = styled.p`
  font-size: 14px;
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin: 0 0 10px;
`;

const StyledPopupTextarea = styled.textarea`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: 13px;
  min-height: 72px;
  padding: 8px;
  resize: vertical;

  &:focus {
    outline: 1px solid ${themeCssVariables.color.blue};
  }
`;

const StyledUrgentLabel = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  display: flex;
  font-size: 12px;
  gap: 6px;
  margin: 10px 0 0;
`;

const StyledPopupError = styled.p`
  color: ${themeCssVariables.color.red};
  font-size: 12px;
  margin: 8px 0 0;
  min-height: 14px;
`;

const StyledSubmitButton = styled.button`
  background: ${themeCssVariables.color.blue};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  font-size: 13px;
  font-weight: ${themeCssVariables.font.weight.medium};
  margin-top: 10px;
  padding: 8px 0;

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`;

const StyledPopupHint = styled.p`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: 11px;
  margin: 8px 0 0;
`;

// --- helpers -----------------------------------------------------------------

const MAX_LISTED = 9;

const sortUrgentFirst = (cards: BoardCard[]) =>
  [...cards].sort((cardA, cardB) => {
    if (!!cardB.urgent !== !!cardA.urgent) return cardB.urgent ? 1 : -1;
    return (
      new Date(cardA.createdAt || 0).getTime() -
      new Date(cardB.createdAt || 0).getTime()
    );
  });

const openBoard = () => {
  window.open(`${FEEDBACK_BOARD_URL}/`, '_blank', 'noopener');
};

const PopoverList = ({ cards }: { cards: BoardCard[] }) => (
  <>
    <StyledPopoverList>
      {cards.slice(0, MAX_LISTED).map((card) => (
        <StyledPopoverListItem key={card.id}>
          {card.urgent ? <span>⚡</span> : null}
          <span>{card.title}</span>
        </StyledPopoverListItem>
      ))}
    </StyledPopoverList>
    {cards.length > MAX_LISTED ? (
      <StyledMore>+{cards.length - MAX_LISTED} more…</StyledMore>
    ) : null}
  </>
);

// --- the strip ----------------------------------------------------------------

export const StatusStrip = () => {
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [crmVersion, setCrmVersion] = useState<CrmVersion | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [requestText, setRequestText] = useState('');
  const [requestUrgent, setRequestUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [pinnedPopover, setPinnedPopover] = useState<PopoverKey | null>(null);
  const [hoveredPopover, setHoveredPopover] = useState<PopoverKey | null>(null);

  const refreshCards = useCallback(async () => {
    try {
      const response = await fetch(`${FEEDBACK_BOARD_URL}/api/cards`);
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data?.cards)) {
        setCards(data.cards as BoardCard[]);
      }
    } catch {
      // Board unreachable — keep the last known state until the next poll.
    }
  }, []);

  const refreshVersion = useCallback(async () => {
    try {
      const response = await fetch(CRM_VERSION_URL, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const version = typeof data?.version === 'string' ? data.version : null;
      if (!version) return;
      setCrmVersion(data as CrmVersion);
      if (BUILD_VERSION) {
        // Build-time-injected sha — the honest comparison.
        setUpdateReady(version !== BUILD_VERSION);
      } else {
        // Fallback baseline: first version seen this page-load, in memory only.
        if (firstSeenVersionThisPageLoad === null) {
          firstSeenVersionThisPageLoad = version;
        }
        setUpdateReady(version !== firstSeenVersionThisPageLoad);
      }
    } catch {
      // Version file unreachable — leave the light as-is.
    }
  }, []);

  // Poll both feeds every 60s + immediately when the tab regains focus.
  useEffect(() => {
    refreshCards();
    refreshVersion();
    const interval = setInterval(() => {
      refreshCards();
      refreshVersion();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        refreshCards();
        refreshVersion();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshCards, refreshVersion]);

  // Escape closes the quick-request popup.
  useEffect(() => {
    if (!popupOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopupOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [popupOpen]);

  const discussionCards = useMemo(
    () =>
      cards
        .filter((card) => card.column === 'discussion')
        .sort(
          (cardA, cardB) =>
            new Date(cardA.createdAt || 0).getTime() -
            new Date(cardB.createdAt || 0).getTime(),
        ),
    [cards],
  );

  const queueCards = useMemo(
    () =>
      sortUrgentFirst(
        cards.filter(
          (card) => card.column === 'inbox' || card.column === 'tobuild',
        ),
      ),
    [cards],
  );

  const submitRequest = async () => {
    const text = requestText.trim();
    if (!text || submitting) {
      setSubmitError(text ? '' : 'Say what you want first.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      // Public token-in-URL endpoint — multipart like the board's own popup.
      // No auth header is ever attached.
      const formData = new FormData();
      formData.append('type', 'feature');
      formData.append('goal', text);
      formData.append('urgent', requestUrgent ? 'true' : 'false');
      const response = await fetch(`${FEEDBACK_BOARD_URL}/api/cards`, {
        body: formData,
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to create card.');
      }
      setJustSubmitted(true);
      refreshCards();
      // Auto-close after showing the confirmation. If the strip unmounted in
      // the meantime, these set-states are harmless no-ops (React 18).
      setTimeout(() => {
        setPopupOpen(false);
        setRequestText('');
        setRequestUrgent(false);
        setJustSubmitted(false);
      }, 1400);
    } catch (error) {
      setSubmitError((error as Error).message || 'Failed to create card.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!FEEDBACK_BOARD_URL) {
    // Not configured (local dev / upstream) — render nothing.
    return null;
  }

  const popoverKey = hoveredPopover ?? pinnedPopover;

  const popoverFor = (key: PopoverKey, node: ReactNode) =>
    popoverKey === key ? <StyledPopover>{node}</StyledPopover> : null;

  // Update arrow: reload applies a ready update; otherwise the board's
  // Delivered column IS the changelog (release notes live there).
  const onArrowClick = () => {
    if (updateReady) {
      window.location.reload();
      return;
    }
    openBoard();
  };

  return (
    <StyledStrip>
      {/* AMBER — cards parked in discussion waiting for the owner's call */}
      <StyledIconWrap
        onMouseEnter={() => setHoveredPopover('discussion')}
        onMouseLeave={() => setHoveredPopover(null)}
      >
        <StyledIconButton
          onClick={() =>
            setPinnedPopover((current) =>
              current === 'discussion' ? null : 'discussion',
            )
          }
          style={{
            color: discussionCards.length
              ? themeCssVariables.color.amber
              : themeCssVariables.font.color.tertiary,
          }}
          title={
            discussionCards.length
              ? `${discussionCards.length} card(s) waiting for your decision`
              : 'Nothing needs your decision'
          }
        >
          <IconCircleHelp />
        </StyledIconButton>
        {popoverFor(
          'discussion',
          <>
            <StyledPopoverTitle>
              Waiting for your call ({discussionCards.length})
            </StyledPopoverTitle>
            {discussionCards.length ? (
              <PopoverList cards={discussionCards} />
            ) : (
              <StyledMore>Nothing needs a decision right now.</StyledMore>
            )}
            <StyledPopoverLink onClick={openBoard}>
              Answer on the board →
            </StyledPopoverLink>
          </>,
        )}
      </StyledIconWrap>

      {/* DIM GREEN — the build queue (requests + to-build), urgent first */}
      <StyledIconWrap
        onMouseEnter={() => setHoveredPopover('queue')}
        onMouseLeave={() => setHoveredPopover(null)}
      >
        <StyledIconButton
          onClick={() =>
            setPinnedPopover((current) =>
              current === 'queue' ? null : 'queue',
            )
          }
          style={{
            color: queueCards.length
              ? themeCssVariables.color.green
              : themeCssVariables.font.color.tertiary,
            // Dimmed on purpose: "on the list", not actionable.
            opacity: queueCards.length ? 0.55 : 1,
          }}
          title={
            queueCards.length
              ? `${queueCards.filter((card) => card.urgent).length} urgent · ${queueCards.length} queued for the next build`
              : 'Nothing queued'
          }
        >
          <IconHammer />
        </StyledIconButton>
        {popoverFor(
          'queue',
          <>
            <StyledPopoverTitle>
              Queued for the next build ({queueCards.length})
            </StyledPopoverTitle>
            {queueCards.length ? (
              <PopoverList cards={queueCards} />
            ) : (
              <StyledMore>
                Nothing queued — drop a request any time (red icon).
              </StyledMore>
            )}
            <StyledPopoverLink onClick={openBoard}>
              Open the board →
            </StyledPopoverLink>
          </>,
        )}
      </StyledIconWrap>

      {/* SOLID GREEN — update arrow; pulses ONLY when a newer build is live */}
      <StyledIconWrap
        onMouseEnter={() => setHoveredPopover('update')}
        onMouseLeave={() => setHoveredPopover(null)}
      >
        <StyledIconButton
          onClick={onArrowClick}
          style={{
            color: updateReady
              ? themeCssVariables.color.green
              : themeCssVariables.font.color.tertiary,
          }}
          title={
            updateReady
              ? 'Update ready — click to reload and apply'
              : crmVersion?.version
                ? `Up to date (${crmVersion.version})`
                : 'Version info unavailable'
          }
        >
          {updateReady ? (
            <StyledPulse>
              <IconArrowDownToLine />
            </StyledPulse>
          ) : (
            <IconArrowDownToLine />
          )}
        </StyledIconButton>
        {popoverFor(
          'update',
          updateReady ? (
            <>
              <StyledPopoverTitle>Update ready</StyledPopoverTitle>
              <StyledPopoverListItem>
                <span>
                  {crmVersion?.version}
                  {crmVersion?.builtAt ? ` — built ${crmVersion.builtAt}` : ''}
                </span>
              </StyledPopoverListItem>
              {crmVersion?.notes ? (
                <StyledMore>{crmVersion.notes}</StyledMore>
              ) : null}
              <StyledPopoverLink onClick={() => window.location.reload()}>
                Reload to apply
              </StyledPopoverLink>
              <StyledPopoverLink onClick={openBoard}>
                View changelog on the board →
              </StyledPopoverLink>
            </>
          ) : (
            <>
              <StyledPopoverTitle>CRM build</StyledPopoverTitle>
              <StyledMore>
                {crmVersion?.version
                  ? `✓ Up to date (${crmVersion.version})`
                  : 'Version info unavailable — is /crm-version.json being served?'}
              </StyledMore>
              <StyledPopoverLink onClick={openBoard}>
                View changelog on the board →
              </StyledPopoverLink>
            </>
          ),
        )}
      </StyledIconWrap>

      {/* RED — quick request. Never pulses; always ready. */}
      <StyledIconWrap>
        <StyledIconButton
          onClick={() => setPopupOpen(true)}
          style={{ color: themeCssVariables.color.red }}
          title="Quick request — send straight to the Feedback Board"
        >
          <IconMessageSquarePlus />
        </StyledIconButton>
      </StyledIconWrap>

      {popupOpen ? (
        <StyledOverlay
          onClick={(event) => {
            if (event.target === event.currentTarget) setPopupOpen(false);
          }}
        >
          <StyledPopupCard>
            {justSubmitted ? (
              <>
                <StyledPopupTitle>Added ✅</StyledPopupTitle>
                <StyledPopupHint>
                  Your request is on the board — closing…
                </StyledPopupHint>
              </>
            ) : (
              <>
                <StyledPopupTitle>✨ Quick request</StyledPopupTitle>
                <StyledPopupTextarea
                  autoFocus
                  onChange={(event) => setRequestText(event.target.value)}
                  placeholder="What do you want? The first line becomes the card title."
                  value={requestText}
                />
                <StyledUrgentLabel>
                  <input
                    checked={requestUrgent}
                    onChange={(event) =>
                      setRequestUrgent(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>⚡ Urgent — build this now</span>
                </StyledUrgentLabel>
                <StyledPopupError>{submitError}</StyledPopupError>
                <StyledSubmitButton
                  disabled={submitting}
                  onClick={submitRequest}
                >
                  {submitting ? 'Adding…' : 'Add request'}
                </StyledSubmitButton>
                <StyledPopupHint>
                  Goes straight to the Requests column of the Feedback Board.
                </StyledPopupHint>
              </>
            )}
          </StyledPopupCard>
        </StyledOverlay>
      ) : null}
    </StyledStrip>
  );
};
