import { type Logger } from '@nestjs/common';

import { type ObjectLiteral } from 'typeorm';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// Per-niche signatures behave like Outlook signatures: if a signature exists
// for the recipient's niche, it gets attached to every outbound email
// automatically. Two opt-outs are supported, mirroring how a power user would
// expect to take control:
//   - {{signature}}    -> insert the niche signature exactly where the marker
//                         is in the body (instead of auto-appending). Useful
//                         when you want the signature mid-body.
//   - {{nosignature}}  -> strip the marker and send no signature.
// Reply detection: if the body contains a quoted thread (blockquote, gmail_quote,
// Outlook reply markers), the signature is inserted ABOVE the quote rather than
// after it, so it doesn't end up buried at the bottom of the conversation.

const SIGNATURE_PLACEHOLDER_REGEX = /\{\{\s*signature\s*\}\}/gi;
const NOSIGNATURE_MARKER_REGEX = /\{\{\s*nosignature\s*\}\}/gi;

export const hasSignaturePlaceholder = (
  value: string | null | undefined,
): boolean => {
  if (typeof value !== 'string') return false;
  return /\{\{\s*signature\s*\}\}/i.test(value);
};

export const hasNoSignatureMarker = (
  value: string | null | undefined,
): boolean => {
  if (typeof value !== 'string') return false;
  return /\{\{\s*nosignature\s*\}\}/i.test(value);
};

export const replaceSignaturePlaceholder = (
  source: string,
  replacement: string,
): string => source.replace(SIGNATURE_PLACEHOLDER_REGEX, replacement);

export const stripNoSignatureMarker = (source: string): string =>
  source.replace(NOSIGNATURE_MARKER_REGEX, '');

export const stripSignatureHtml = (html: string): string =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Heuristic reply-quote detection. We check several common markers and pick
// the earliest one — that's where the quoted thread starts, so the signature
// goes right before it. Returns null if no reply quote is detected.
const QUOTE_MARKERS: RegExp[] = [
  /<blockquote\b/i,
  /<div[^>]*class="[^"]*gmail_quote[^"]*"/i,
  /<div[^>]*id="appendonsend"/i,
  /<div[^>]*id="divRplyFwdMsg"/i,
  /<div[^>]*id="OLK_SRC_BODY_SECTION"/i,
  /<div[^>]*class="[^"]*OutlookMessageHeader[^"]*"/i,
  /<div[^>]*class="[^"]*WordSection1[^"]*"/i,
  /<hr[^>]*id="stopSpelling"/i,
];

const findQuoteInsertionPoint = (html: string): number | null => {
  let earliest = -1;

  for (const re of QUOTE_MARKERS) {
    const m = re.exec(html);

    if (m && (earliest === -1 || m.index < earliest)) {
      earliest = m.index;
    }
  }

  return earliest === -1 ? null : earliest;
};

type GetSignatureParams = {
  primaryRecipientEmail: string | undefined;
  workspaceId: string;
  globalWorkspaceOrmManager: GlobalWorkspaceOrmManager;
  logger: Logger;
};

// Returns the signatureHtml for the matching EmailSignature row, or '' if any
// of these are unmet: no recipient, recipient is not a CRM Person, Person has
// no `niche` set, or no EmailSignature row matches that niche. Errors are
// swallowed and logged so a lookup failure cannot break email sending.
export const getSignatureForRecipient = async ({
  primaryRecipientEmail,
  workspaceId,
  globalWorkspaceOrmManager,
  logger,
}: GetSignatureParams): Promise<string> => {
  if (!primaryRecipientEmail) return '';

  try {
    const authContext = buildSystemAuthContext(workspaceId);

    return await globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const personRepository =
          await globalWorkspaceOrmManager.getRepository<ObjectLiteral>(
            workspaceId,
            'person',
            { shouldBypassPermissionChecks: true },
          );

        const lower = primaryRecipientEmail.toLowerCase();

        // `niche` is added dynamically via the metadata API, so we read it via raw select.
        const personRow = await personRepository
          .createQueryBuilder('person')
          .select('person.niche', 'niche')
          .where('LOWER(person.emailsPrimaryEmail) = :email', { email: lower })
          .limit(1)
          .getRawOne<{ niche: string | null }>();

        const niche = personRow?.niche ?? null;

        if (!niche) return '';

        const sigRepository =
          await globalWorkspaceOrmManager.getRepository<ObjectLiteral>(
            workspaceId,
            'emailSignature',
            { shouldBypassPermissionChecks: true },
          );

        const sigRow = await sigRepository
          .createQueryBuilder('sig')
          .select('sig.signatureHtml', 'signatureHtml')
          .where('sig.niche = :niche', { niche })
          .limit(1)
          .getRawOne<{ signatureHtml: string | null }>();

        return sigRow?.signatureHtml ?? '';
      },
      authContext,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    logger.warn(
      `Signature lookup failed for ${primaryRecipientEmail}: ${message}. Falling back to empty signature.`,
    );

    return '';
  }
};

type ResolveSignatureParams = GetSignatureParams & {
  html: string;
  plainText: string;
};

type ResolveSignatureResult = {
  html: string;
  plainText: string;
  // True when a signature was actually inserted into the body (auto-append
  // or {{signature}} replacement landed). False when no signature applied —
  // recipient unknown, niche unset, no matching row, or {{nosignature}} used.
  // Callers (e.g. the in-app composer) use this to decide whether to upgrade
  // a plain-text body to HTML.
  signatureAttached: boolean;
};

// Attach the recipient's niche signature to the email body. Auto-appends by
// default; respects {{signature}} (inline insertion), {{nosignature}} (skip),
// and inserts above any detected reply quote.
export const resolveSignaturePlaceholder = async ({
  html,
  plainText,
  primaryRecipientEmail,
  workspaceId,
  globalWorkspaceOrmManager,
  logger,
}: ResolveSignatureParams): Promise<ResolveSignatureResult> => {
  const safePlainText = plainText ?? '';

  // 1) {{nosignature}} wins — strip the marker, attach nothing.
  if (hasNoSignatureMarker(html) || hasNoSignatureMarker(safePlainText)) {
    return {
      html: stripNoSignatureMarker(html),
      plainText: stripNoSignatureMarker(safePlainText),
      signatureAttached: false,
    };
  }

  // 2) Look up the signature for the recipient. Empty string means "no
  //    signature available" (unknown recipient, no niche, no matching row).
  const signatureHtml = await getSignatureForRecipient({
    primaryRecipientEmail,
    workspaceId,
    globalWorkspaceOrmManager,
    logger,
  });

  if (!signatureHtml) {
    // Nothing to attach. If the body had a {{signature}} marker we still
    // strip it so it doesn't appear literally in the sent message.
    return {
      html: replaceSignaturePlaceholder(html, ''),
      plainText: replaceSignaturePlaceholder(safePlainText, ''),
      signatureAttached: false,
    };
  }

  const signatureText = stripSignatureHtml(signatureHtml);

  // 3) {{signature}} → explicit inline insertion (power-user override).
  if (hasSignaturePlaceholder(html)) {
    return {
      html: replaceSignaturePlaceholder(html, signatureHtml),
      plainText: replaceSignaturePlaceholder(safePlainText, signatureText),
      signatureAttached: true,
    };
  }

  // 4) Reply-aware: insert ABOVE the quoted thread, not after it.
  const insertIdx = findQuoteInsertionPoint(html);

  if (insertIdx !== null) {
    return {
      html:
        html.slice(0, insertIdx) + signatureHtml + '\n' + html.slice(insertIdx),
      plainText: appendSignaturePlainText(safePlainText, signatureText),
      signatureAttached: true,
    };
  }

  // 5) Default: append at the end.
  return {
    html: html + signatureHtml,
    plainText: appendSignaturePlainText(safePlainText, signatureText),
    signatureAttached: true,
  };
};

const appendSignaturePlainText = (body: string, signature: string): string => {
  if (!signature) return body;
  if (!body) return signature;

  // Two newlines between body and signature for readability.
  return body.endsWith('\n')
    ? `${body}\n${signature}`
    : `${body}\n\n${signature}`;
};
