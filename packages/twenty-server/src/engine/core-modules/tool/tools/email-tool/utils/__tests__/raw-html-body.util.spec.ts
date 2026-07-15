import {
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

describe('stripHtmlBodySentinel', () => {
  it('should strip the sentinel and leading whitespace', () => {
    expect(stripHtmlBodySentinel(`${HTML_BODY_SENTINEL}\n<table></table>`)).toBe('<table></table>');
  });

  it('should leave sentinel-less bodies untouched', () => {
    const body = '<!DOCTYPE html><html><body>x</body></html>';

    expect(stripHtmlBodySentinel(body)).toBe(body);
  });
});
