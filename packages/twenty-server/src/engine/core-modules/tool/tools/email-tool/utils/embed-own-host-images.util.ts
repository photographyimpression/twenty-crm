import { randomBytes } from 'crypto';

import { type MessageAttachment } from 'src/modules/messaging/message-import-manager/types/message';

import { EMAIL_IMAGE_ALLOWED_SRC_PREFIX } from 'src/engine/core-modules/tool/tools/email-tool/utils/raw-html-body.util';

// Outlook/Exchange blocks (and in Moshe's tenant, strips) remote-linked
// images, so a campaign logo referenced by URL renders blank. Fix: fetch our
// own-host images at send time, attach them to the message, and rewrite the
// src to cid:<contentId> — an embedded image renders everywhere with no
// "download pictures" prompt.
//
// Only own-host images are embedded (the sanitizer has already removed every
// other origin). Failures degrade gracefully: the img keeps its original URL
// rather than breaking the send.
const MAX_INLINE_IMAGES = 5;
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;

const filenameFromUrl = (url: string): string => {
  try {
    const name = new URL(url).pathname.split('/').pop();

    return name && name.length > 0 ? name : 'image';
  } catch {
    return 'image';
  }
};

type EmbedResult = { html: string; attachments: MessageAttachment[] };

export const embedOwnHostImagesAsCid = async ({
  html,
  jsdomWindow,
  logger,
}: {
  html: string;
  // A JSDOM window whose document can parse the sanitized fragment.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jsdomWindow: any;
  logger?: { warn: (message: string) => void };
}): Promise<EmbedResult> => {
  const document = jsdomWindow.document;
  const container = document.createElement('div');

  container.innerHTML = html;

  const images: HTMLImageElement[] = Array.from(
    container.querySelectorAll('img'),
  );

  if (images.length === 0) {
    return { html, attachments: [] };
  }

  const attachments: MessageAttachment[] = [];
  const contentIdByUrl = new Map<string, string>();

  for (const image of images) {
    const source = image.getAttribute('src') || '';

    if (!source.startsWith(EMAIL_IMAGE_ALLOWED_SRC_PREFIX)) {
      continue;
    }

    // Same image used twice (e.g. header + footer logo) → one attachment.
    const alreadyEmbedded = contentIdByUrl.get(source);

    if (alreadyEmbedded) {
      image.setAttribute('src', `cid:${alreadyEmbedded}`);
      continue;
    }

    if (attachments.length >= MAX_INLINE_IMAGES) {
      continue;
    }

    try {
      const response = await fetch(source, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger?.warn(
          `Inline image fetch failed (${response.status}) for ${source} — leaving as remote link`,
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
        logger?.warn(
          `Inline image too large (${buffer.length} bytes) for ${source} — leaving as remote link`,
        );
        continue;
      }

      const contentId = `img-${randomBytes(8).toString('hex')}`;

      attachments.push({
        filename: filenameFromUrl(source),
        content: buffer,
        contentType:
          response.headers.get('content-type')?.split(';')[0] || 'image/png',
        contentId,
        isInline: true,
      });
      contentIdByUrl.set(source, contentId);
      image.setAttribute('src', `cid:${contentId}`);
    } catch (error) {
      logger?.warn(
        `Inline image error for ${source}: ${
          error instanceof Error ? error.message : String(error)
        } — leaving as remote link`,
      );
    }
  }

  return { html: container.innerHTML, attachments };
};
