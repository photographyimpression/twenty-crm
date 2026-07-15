import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

import {
  addEmailImageSrcFilterHook,
  EMAIL_HTML_ALLOWED_ATTR,
  EMAIL_HTML_ALLOWED_TAGS,
  HTML_BODY_SENTINEL,
  isRawHtmlBody,
  stripHtmlBodySentinel,
} from 'src/engine/core-modules/tool/tools/email-tool/utils/raw-html-body.util';

describe('isRawHtmlBody', () => {
  it('should detect the explicit sentinel', () => {
    expect(isRawHtmlBody(`${HTML_BODY_SENTINEL}\n<table><tr><td>hi</td></tr></table>`)).toBe(true);
    expect(isRawHtmlBody(`  \n${HTML_BODY_SENTINEL}<div>x</div>`)).toBe(true);
  });

  it('should detect unambiguous leading document/table markup', () => {
    expect(isRawHtmlBody('<!DOCTYPE html><html><body>x</body></html>')).toBe(true);
    expect(isRawHtmlBody('<html lang="en"><body>x</body></html>')).toBe(true);
    expect(isRawHtmlBody('<table role="presentation"><tr><td>x</td></tr></table>')).toBe(true);
    expect(isRawHtmlBody('  <TABLE><tr><td>case-insensitive</td></tr></TABLE>')).toBe(true);
  });

  it('should NOT misfire on plain text containing angle brackets', () => {
    expect(isRawHtmlBody('Hi Melissa, your quote is ready. Prices < 100$ apply.')).toBe(false);
    expect(isRawHtmlBody('a < b and b > c')).toBe(false);
    expect(isRawHtmlBody('Use <b>bold</b> sparingly')).toBe(false);
  });

  it('should NOT fire on tiptap JSON bodies', () => {
    expect(
      isRawHtmlBody(
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
      ),
    ).toBe(false);
  });

  it('should NOT fire on empty bodies', () => {
    expect(isRawHtmlBody('')).toBe(false);
    expect(isRawHtmlBody('   ')).toBe(false);
  });
});

describe('addEmailImageSrcFilterHook (own-host images only)', () => {
  const sanitizeWithHook = (html: string): string => {
    const purify = DOMPurify(new JSDOM('').window);

    addEmailImageSrcFilterHook(purify);

    return purify.sanitize(html, {
      ALLOWED_TAGS: EMAIL_HTML_ALLOWED_TAGS,
      ALLOWED_ATTR: EMAIL_HTML_ALLOWED_ATTR,
    });
  };

  it('should keep images hosted on our own domain', () => {
    const out = sanitizeWithHook(
      '<img src="https://crm.impressionphotography.ca/sig-images/product.jpg" alt="logo" width="120" />',
    );

    expect(out).toContain('crm.impressionphotography.ca/sig-images/product.jpg');
    expect(out).toContain('<img');
  });

  it('should remove third-party images entirely (tracking pixels)', () => {
    const out = sanitizeWithHook(
      '<p>hi</p><img src="https://evil.com/pixel.gif" alt="pixel" />',
    );

    expect(out).not.toContain('evil.com');
    expect(out).not.toContain('<img');
    expect(out).toContain('<p>hi</p>');
  });

  it('should remove data: URI images', () => {
    const out = sanitizeWithHook(
      '<img src="data:image/png;base64,AAAA" alt="inline" />',
    );

    expect(out).not.toContain('<img');
  });

  it('should remove images with no src and not touch other tags', () => {
    const out = sanitizeWithHook(
      '<table><tbody><tr><td><img alt="empty" /><a href="https://x.com">x</a></td></tr></tbody></table>',
    );

    expect(out).not.toContain('<img');
    expect(out).toContain('<table');
    expect(out).toContain('<a href="https://x.com"');
  });

  it('should not fool the prefix check with a lookalike domain', () => {
    const out = sanitizeWithHook(
      '<img src="https://crm.impressionphotography.ca.evil.com/x.gif" />',
    );

    expect(out).not.toContain('<img');
  });
});

describe('stripHtmlBodySentinel', () => {
  it('should strip the sentinel and leading whitespace', () => {
    expect(stripHtmlBodySentinel(`${HTML_BODY_SENTINEL}\n<table></table>`)).toBe('<table></table>');
  });

  it('should leave sentinel-less bodies untouched', () => {
    const body = '<!DOCTYPE html><html><body>x</body></html>';

    expect(stripHtmlBodySentinel(body)).toBe(body);
  });
});
