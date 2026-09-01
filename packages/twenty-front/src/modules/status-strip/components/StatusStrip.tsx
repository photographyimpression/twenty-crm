// LOCAL-PATCH: status strip (update loop)
//
// Local fork-only patch (not for upstream). Four-icon status strip mounted at
// the END of PageHeader's action row (top-right of EVERY page — Command
// Center included), mirroring the Feedback Board's header lights
// (tools/feedback-board) and the Zrizes app's sidebar strip, icon order
// included: RED first (leftmost), update arrow last. It talks to the board's
// PUBLIC browser endpoints only — token-in-URL via REACT_APP_FEEDBACK_BOARD_URL
// — and never sends the BOARD_SECRET (that stays server-only).
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
// The popup matches the Zrizes QuickRequestDialog: ✨Feature/🐞Bug toggle
// (bug = a single "What's wrong?" box), goal/idea, paste screenshots anywhere
// (downscaled client-side, sent as multipart), ⚡ urgent, and the two-click
// "Build everything waiting — now" trigger (POST /api/build-now).
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
// The urgent + bcc-style preferences below are the exception: they never
// influence the update arrow, and surviving a reload is what the user wants.

import { styled } from '@linaria/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { usePushFocusItemToFocusStack } from '@/ui/utilities/focus/hooks/usePushFocusItemToFocusStack';
import { useRemoveFocusItemFromFocusStackById } from '@/ui/utilities/focus/hooks/useRemoveFocusItemFromFocusStackById';
import { FocusComponentType } from '@/ui/utilities/focus/types/FocusComponentType';

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

type RequestType = 'feature' | 'bug';

type Attachment = { id: string; file: File; previewUrl: string };

// --- inline lucide-path icons (message-square-plus, circle-help, hammer,
// arrow-down-to-line, sparkles, bug, zap, hammer-mini, x) — no icon-library
// dependency, stroke = currentColor -------------------------------------------

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

const IconXSmall = ({ size = 10 }: { size?: number }) => (
  <svg
    aria-hidden="true"
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2.5"
    viewBox="0 0 24 24"
    width={size}
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const IconZap = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="12"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="12"
  >
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
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

// --- quick-request popup ------------------------------------------------------

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
  max-height: 85vh;
  overflow-y: auto;
  padding: 16px;
  width: 380px;
`;

const StyledPopupHeader = styled.div`
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  margin: 0 0 10px;
`;

const StyledPopupTitle = styled.p`
  font-size: 14px;
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin: 0;
`;

const StyledPopupClose = styled.button`
  background: none;
  border: none;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  padding: 2px;

  &:hover {
    color: ${themeCssVariables.font.color.primary};
  }
`;

const StyledToggle = styled.div`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  margin-bottom: 10px;
  padding: ${themeCssVariables.spacing[1]};
`;

const StyledToggleButton = styled.button<{ isActive: boolean }>`
  background: ${({ isActive }) =>
    isActive ? themeCssVariables.color.blue : 'transparent'};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.grayScale.gray1
      : themeCssVariables.font.color.secondary};
  cursor: pointer;
  flex: 1;
  font-family: ${themeCssVariables.font.family};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledPopupLabel = styled.label`
  color: ${themeCssVariables.font.color.tertiary};
  display: block;
  font-size: 11px;
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin: 0 0 4px;
`;

const StyledPopupTextarea = styled.textarea`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: 13px;
  min-height: 56px;
  padding: 8px;
  resize: vertical;
  width: 100%;

  &:focus {
    outline: 1px solid ${themeCssVariables.color.blue};
  }
`;

const StyledThumbs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
  margin-top: 8px;
`;

const StyledThumb = styled.div`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  cursor: zoom-in;
  height: 48px;
  overflow: hidden;
  position: relative;
  width: 48px;
`;

const StyledThumbImage = styled.img`
  height: 100%;
  object-fit: cover;
  width: 100%;
`;

const StyledThumbRemove = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.transparent.strong};
  border: none;
  border-radius: 50%;
  color: ${themeCssVariables.grayScale.gray1};
  cursor: pointer;
  display: flex;
  height: 16px;
  justify-content: center;
  padding: 0;
  position: absolute;
  right: 2px;
  top: 2px;
  width: 16px;
`;

const StyledUrgentLabel = styled.label<{ isChecked: boolean }>`
  align-items: center;
  background: ${({ isChecked }) =>
    isChecked ? `${themeCssVariables.color.amber}1a` : 'transparent'};
  border: 1px solid
    ${({ isChecked }) =>
      isChecked
        ? themeCssVariables.color.amber
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  color: ${({ isChecked }) =>
    isChecked
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.secondary};
  cursor: pointer;
  display: flex;
  font-size: 12px;
  gap: 6px;
  margin: 10px 0 0;
  padding: 6px 10px;
  width: 100%;
`;

const StyledUrgentZap = styled.span<{ isChecked: boolean }>`
  align-items: center;
  color: ${({ isChecked }) =>
    isChecked
      ? themeCssVariables.color.amber
      : themeCssVariables.font.color.tertiary};
  display: flex;
`;

const StyledBuildNow = styled.button`
  background: none;
  border: none;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  font-size: 11px;
  font-weight: ${themeCssVariables.font.weight.medium};
  margin: 8px 0 0;
  padding: 0;
  text-align: left;

  &:hover {
    color: ${themeCssVariables.color.blue};
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
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
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  font-size: 13px;
  font-weight: ${themeCssVariables.font.weight.medium};
  margin-top: 10px;
  padding: 8px 0;
  width: 100%;

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`;

const StyledPopupFooter = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: 11px;
  justify-content: space-between;
  margin: 8px 0 0;
`;

const StyledBoardLink = styled.a`
  align-items: center;
  color: ${themeCssVariables.color.blue};
  display: inline-flex;
  gap: 3px;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const StyledZoomOverlay = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.overlayPrimary};
  cursor: zoom-out;
  display: flex;
  inset: 0;
  justify-content: center;
  position: fixed;
  z-index: 1002;
`;

const StyledZoomImage = styled.img`
  border-radius: ${themeCssVariables.border.radius.md};
  box-shadow: ${themeCssVariables.boxShadow.superHeavy};
  max-height: 90vh;
  max-width: 90vw;
  object-fit: contain;
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

// Pasted screenshots can be huge retina PNGs; shrink to max 1400px JPEG before
// upload (same policy as the Zrizes app) so multipart bodies stay small. GIFs
// pass through untouched — canvas re-encode would kill the animation.
const downscaleImage = (file: File): Promise<File> =>
  new Promise((resolve, reject) => {
    if (file.type === 'image/gif') {
      resolve(file);
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1400;
      let { width, height } = image;
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('no canvas context'));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('encode failed'));
            return;
          }
          resolve(new File([blob], 'screenshot.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.82,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read image'));
    };
    image.src = url;
  });

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
  const [requestType, setRequestType] = useState<RequestType>('feature');
  const [goal, setGoal] = useState('');
  const [idea, setIdea] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [requestUrgent, setRequestUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  // "Build everything waiting — now": armed → "Sure?" (auto-disarm 5s) → fires.
  const [buildArmed, setBuildArmed] = useState(false);
  const [buildPending, setBuildPending] = useState(false);
  const [buildDone, setBuildDone] = useState(false);
  const [buildError, setBuildError] = useState('');
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

  const addAttachmentFiles = useCallback(async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    for (const image of images.slice(0, 8)) {
      try {
        const prepared = await downscaleImage(image);
        setAttachments((current) =>
          current.length >= 8
            ? current
            : [
                ...current,
                {
                  id: `${image.name}-${image.size}-${image.lastModified}-${current.length}`,
                  file: prepared,
                  previewUrl: URL.createObjectURL(prepared),
                },
              ],
        );
      } catch {
        setSubmitError('Could not read a pasted screenshot.');
      }
    }
  }, []);

  // "Paste screenshots anywhere in this popup" — a document-level listener
  // (only while open) catches image pastes regardless of which field has focus.
  // Text pastes into the textareas are untouched: we only act on image items.
  useEffect(() => {
    if (!popupOpen) {
      return;
    }
    const handlePaste = (event: ClipboardEvent) => {
      const imageFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (imageFiles.length > 0) {
        event.preventDefault();
        void addAttachmentFiles(imageFiles);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [popupOpen, addAttachmentFiles]);

  // Claim keyboard focus while the popup is open (board card 2026-08-30: with
  // a client Note open in the side panel, every keystroke typed into this
  // popup was intercepted by the note editor's catch-all side-panel hotkey and
  // landed IN THE NOTE instead of the request box). The app's hotkey system
  // routes keys to whatever sits on top of the focus stack — this popup never
  // pushed itself on, so the side panel kept winning. Push a focus item while
  // open, pop it on close; typing then flows to the browser-focused textarea.
  const QUICK_REQUEST_FOCUS_ID = 'status-strip-quick-request-popup';
  const { pushFocusItemToFocusStack } = usePushFocusItemToFocusStack();
  const { removeFocusItemFromFocusStackById } =
    useRemoveFocusItemFromFocusStackById();
  useEffect(() => {
    if (!popupOpen) {
      return;
    }
    pushFocusItemToFocusStack({
      focusId: QUICK_REQUEST_FOCUS_ID,
      component: {
        type: FocusComponentType.DIALOG,
        instanceId: QUICK_REQUEST_FOCUS_ID,
      },
    });
    return () => {
      removeFocusItemFromFocusStackById({
        focusId: QUICK_REQUEST_FOCUS_ID,
      });
    };
  }, [
    popupOpen,
    pushFocusItemToFocusStack,
    removeFocusItemFromFocusStackById,
  ]);

  // Closing the popup KEEPS the draft — text, pasted screenshots, type and
  // urgent all survive, so the flow Moshe asked for works: open the popup,
  // paste a screenshot, close it, go take ANOTHER screenshot, come back —
  // the first one (and any typed text) is still there. Same behavior as his
  // other apps. Only a successful submit clears the draft (resetDraft).
  const closePopup = useCallback(() => {
    setPopupOpen(false);
    setZoomUrl(null);
    setBuildArmed(false);
    setBuildError('');
  }, []);

  const resetDraft = useCallback(() => {
    attachments.forEach((attachment) =>
      URL.revokeObjectURL(attachment.previewUrl),
    );
    setRequestType('feature');
    setGoal('');
    setIdea('');
    setAttachments([]);
    setRequestUrgent(false);
    setSubmitError('');
    setSubmitting(false);
    setJustSubmitted(false);
  }, [attachments]);

  // Escape closes the zoom first, then the popup. Auto-disarm the
  // build-now confirm when its 5s window lapses.
  useEffect(() => {
    if (!popupOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (zoomUrl) {
        setZoomUrl(null);
        return;
      }
      closePopup();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [popupOpen, zoomUrl, closePopup]);

  useEffect(() => {
    if (!buildArmed) return;
    const timer = window.setTimeout(() => setBuildArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [buildArmed]);

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

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const match = current.find((attachment) => attachment.id === id);
      if (match) {
        URL.revokeObjectURL(match.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== id);
    });
  };

  const canSubmit =
    !submitting &&
    (goal.trim().length > 0 ||
      idea.trim().length > 0 ||
      attachments.length > 0);

  const submitRequest = async () => {
    const trimmedGoal = goal.trim();
    const trimmedIdea = idea.trim();
    if (submitting) {
      return;
    }
    if (!trimmedGoal && !trimmedIdea && attachments.length === 0) {
      setSubmitError('Say what you want first.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      // Public token-in-URL endpoint — multipart like the board's own popup.
      // No auth header is ever attached.
      const formData = new FormData();
      formData.append('type', requestType);
      if (trimmedGoal) {
        formData.append('goal', trimmedGoal);
      }
      if (trimmedIdea) {
        formData.append('idea', trimmedIdea);
      }
      formData.append('urgent', requestUrgent ? 'true' : 'false');
      attachments.forEach((attachment) =>
        formData.append('screenshots', attachment.file, attachment.file.name),
      );
      const response = await fetch(`${FEEDBACK_BOARD_URL}/api/cards`, {
        body: formData,
        method: 'POST',
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || 'Failed to create card.');
      }
      setJustSubmitted(true);
      refreshCards();
      // Auto-close after showing the confirmation, then clear the draft so
      // the next request starts fresh. If the strip unmounted in the
      // meantime, these set-states are harmless no-ops (React 18).
      setTimeout(() => {
        closePopup();
        resetDraft();
      }, 1400);
    } catch (error) {
      setSubmitError((error as Error).message || 'Failed to create card.');
    } finally {
      setSubmitting(false);
    }
  };

  // Two-click "Build everything waiting — now": raises the board's build-now
  // flag; the build agent clears it when it picks the queue up.
  const triggerBuildNow = async () => {
    if (buildPending) return;
    if (!buildArmed) {
      setBuildArmed(true); // disarm timer armed in the effect above
      return;
    }
    setBuildArmed(false);
    setBuildPending(true);
    setBuildError('');
    try {
      const response = await fetch(`${FEEDBACK_BOARD_URL}/api/build-now`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || 'Failed to trigger build.');
      }
      setBuildDone(true);
      setTimeout(() => setBuildDone(false), 4000);
    } catch (error) {
      setBuildError((error as Error).message || 'Failed to trigger build.');
    } finally {
      setBuildPending(false);
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
      {/* RED — quick request. Never pulses; always ready. FIRST, like the
          other apps' strips. */}
      <StyledIconWrap>
        <StyledIconButton
          onClick={() => {
            setSubmitError('');
            setPopupOpen(true);
          }}
          style={{ color: themeCssVariables.color.red }}
          title="Request a feature / report a bug"
        >
          <IconMessageSquarePlus />
        </StyledIconButton>
      </StyledIconWrap>

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

      {popupOpen ? (
        <StyledOverlay
          onClick={(event) => {
            if (event.target === event.currentTarget) closePopup();
          }}
        >
          <StyledPopupCard>
            {justSubmitted ? (
              <>
                <StyledPopupTitle>Added ✅</StyledPopupTitle>
                <StyledPopupFooter>
                  Your request is on the board — closing…
                </StyledPopupFooter>
              </>
            ) : (
              <>
                <StyledPopupHeader>
                  <StyledPopupTitle>Quick request</StyledPopupTitle>
                  <StyledPopupClose
                    aria-label="Close"
                    onClick={closePopup}
                    type="button"
                  >
                    <IconXSmall size={14} />
                  </StyledPopupClose>
                </StyledPopupHeader>

                <StyledToggle>
                  <StyledToggleButton
                    isActive={requestType === 'feature'}
                    onClick={() => setRequestType('feature')}
                    type="button"
                  >
                    ✨ Feature
                  </StyledToggleButton>
                  <StyledToggleButton
                    isActive={requestType === 'bug'}
                    onClick={() => setRequestType('bug')}
                    type="button"
                  >
                    🐞 Bug
                  </StyledToggleButton>
                </StyledToggle>

                {requestType === 'bug' ? (
                  // A bug report is just "what's wrong" — no goal/idea framing.
                  <>
                    <StyledPopupLabel>What&apos;s wrong?</StyledPopupLabel>
                    <StyledPopupTextarea
                      autoFocus
                      onChange={(event) => setGoal(event.target.value)}
                      placeholder="Describe what's not working…"
                      value={goal}
                    />
                  </>
                ) : (
                  <>
                    <StyledPopupLabel>
                      Goal — what you want to achieve (optional)
                    </StyledPopupLabel>
                    <StyledPopupTextarea
                      autoFocus
                      onChange={(event) => setGoal(event.target.value)}
                      placeholder="The outcome you're after…"
                      value={goal}
                    />
                    <StyledPopupLabel style={{ marginTop: 8 }}>
                      Idea — how it could work (optional)
                    </StyledPopupLabel>
                    <StyledPopupTextarea
                      onChange={(event) => setIdea(event.target.value)}
                      placeholder="Your rough approach…"
                      value={idea}
                    />
                  </>
                )}

                {attachments.length > 0 && (
                  <StyledThumbs>
                    {attachments.map((attachment) => (
                      <StyledThumb
                        key={attachment.id}
                        onClick={() => setZoomUrl(attachment.previewUrl)}
                      >
                        <StyledThumbImage
                          alt="screenshot"
                          src={attachment.previewUrl}
                        />
                        <StyledThumbRemove
                          onClick={(event) => {
                            event.stopPropagation();
                            removeAttachment(attachment.id);
                          }}
                          type="button"
                        >
                          <IconXSmall />
                        </StyledThumbRemove>
                      </StyledThumb>
                    ))}
                  </StyledThumbs>
                )}

                <StyledUrgentLabel isChecked={requestUrgent}>
                  <input
                    checked={requestUrgent}
                    onChange={(event) => setRequestUrgent(event.target.checked)}
                    type="checkbox"
                  />
                  <StyledUrgentZap isChecked={requestUrgent}>
                    <IconZap />
                  </StyledUrgentZap>
                  <span>Urgent — build this now</span>
                </StyledUrgentLabel>

                <StyledBuildNow
                  disabled={buildPending}
                  onClick={triggerBuildNow}
                  type="button"
                >
                  {buildDone
                    ? '✅ Queued — the builder will pick it up.'
                    : buildPending
                      ? 'Queuing…'
                      : buildArmed
                        ? '⚠ Sure? Build everything waiting now'
                        : '🔨 Build everything waiting — now'}
                </StyledBuildNow>
                {buildError ? (
                  <StyledPopupError>{buildError}</StyledPopupError>
                ) : null}

                <StyledPopupError>{submitError}</StyledPopupError>
                <StyledSubmitButton
                  disabled={!canSubmit}
                  onClick={submitRequest}
                  type="button"
                >
                  {submitting ? 'Adding…' : 'Add request'}
                </StyledSubmitButton>
                <StyledPopupFooter>
                  <span>
                    Paste screenshots anywhere · your draft is kept if you close
                    this
                  </span>
                  <StyledBoardLink
                    href={`${FEEDBACK_BOARD_URL}/`}
                    onClick={(event) => event.stopPropagation()}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Open the full board ↗
                  </StyledBoardLink>
                </StyledPopupFooter>
              </>
            )}
          </StyledPopupCard>
        </StyledOverlay>
      ) : null}

      {zoomUrl ? (
        <StyledZoomOverlay onClick={() => setZoomUrl(null)}>
          <StyledZoomImage
            alt="screenshot full size"
            onClick={(event) => event.stopPropagation()}
            src={zoomUrl}
          />
        </StyledZoomOverlay>
      ) : null}
    </StyledStrip>
  );
};
