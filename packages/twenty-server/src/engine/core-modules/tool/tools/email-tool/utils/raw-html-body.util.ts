// Raw-HTML email bodies (designed campaigns — tables, inline styles, buttons).
//
// Detection prefers an explicit sentinel over tag-sniffing: authors prepend
// <!--email:html--> as the first line of the body. As a fallback we accept
// bodies that unambiguously START with document/table markup (<!DOCTYPE,
// <html, <table) — starts-with checks cannot misfire on plain text that
// merely contains a '<' somewhere.
export const HTML_BODY_SENTINEL = '<!--email:html-->';

export const isRawHtmlBody = (body: string): boolean => {
  const trimmed = body.trimStart();
  const lowered = trimmed.toLowerCase();

  return (
    lowered.startsWith(HTML_BODY_SENTINEL) ||
    lowered.startsWith('<!doctype') ||
    lowered.startsWith('<html') ||
    lowered.startsWith('<table')
  );
};

export const stripHtmlBodySentinel = (body: string): string => {
  const trimmed = body.trimStart();

  if (trimmed.toLowerCase().startsWith(HTML_BODY_SENTINEL)) {
    return trimmed.slice(HTML_BODY_SENTINEL.length).trimStart();
  }

  return body;
};

// DOMPurify allowlist for email-layout HTML. Passing ALLOWED_TAGS/ALLOWED_ATTR
// replaces DOMPurify's defaults, so scripts, iframes, styles-as-tags, event
// handlers (onclick etc.) and remote stylesheets are all stripped — only the
// listed layout tags and presentational attributes survive.
export const EMAIL_HTML_ALLOWED_TAGS = [
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'div',
  'span',
  'p',
  'a',
  'img',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'br',
  'hr',
];

// Images in raw-HTML campaign bodies may only load from our own host — this
// keeps our logos/product shots while stripping third-party tracking pixels
// and data: URIs. Host-root (not /sig-images/ only) because campaign images
// also live under /images/... (e.g. the BSD logo).
export const EMAIL_IMAGE_ALLOWED_SRC_PREFIX =
  'https://crm.impressionphotography.ca/';

// DOMPurify hook: remove any <img> whose src is not on our host. Registered
// on the per-compose purify instance right before sanitizing a raw-HTML body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const addEmailImageSrcFilterHook = (purify: any): void => {
  purify.addHook('uponSanitizeElement', (node: Element) => {
    if (node.tagName !== 'IMG') {
      return;
    }

    const src = node.getAttribute && node.getAttribute('src');

    if (!src || !src.startsWith(EMAIL_IMAGE_ALLOWED_SRC_PREFIX)) {
      node.remove();
    }
  });
};

export const EMAIL_HTML_ALLOWED_ATTR = [
  'style',
  'href',
  'src',
  'alt',
  'width',
  'height',
  'align',
  'valign',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'role',
  'target',
  'rel',
];
