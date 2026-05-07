import { type Logger } from '@nestjs/common';

import { type ObjectLiteral } from 'typeorm';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

const SIGNATURE_PLACEHOLDER_REGEX = /\{\{\s*signature\s*\}\}/gi;

export const hasSignaturePlaceholder = (
  value: string | null | undefined,
): boolean => {
  if (typeof value !== 'string') return false;
  // Use a fresh regex literal to avoid /g lastIndex state issues.
  return /\{\{\s*signature\s*\}\}/i.test(value);
};

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

export const replaceSignaturePlaceholder = (
  source: string,
  replacement: string,
): string => source.replace(SIGNATURE_PLACEHOLDER_REGEX, replacement);

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
};

// Replaces {{signature}} in body with the EmailSignature row matching the
// primary recipient's `niche`. Backward compatible: if the body has no
// placeholder, no lookup happens and the body is returned unchanged.
export const resolveSignaturePlaceholder = async ({
  html,
  plainText,
  primaryRecipientEmail,
  workspaceId,
  globalWorkspaceOrmManager,
  logger,
}: ResolveSignatureParams): Promise<ResolveSignatureResult> => {
  if (!hasSignaturePlaceholder(html)) {
    return { html, plainText };
  }

  const signatureHtml = await getSignatureForRecipient({
    primaryRecipientEmail,
    workspaceId,
    globalWorkspaceOrmManager,
    logger,
  });

  const replacementText = signatureHtml
    ? stripSignatureHtml(signatureHtml)
    : '';

  return {
    html: replaceSignaturePlaceholder(html, signatureHtml),
    plainText: replaceSignaturePlaceholder(plainText ?? '', replacementText),
  };
};
