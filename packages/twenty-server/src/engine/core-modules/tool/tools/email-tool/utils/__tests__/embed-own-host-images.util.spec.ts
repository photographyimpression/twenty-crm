import { JSDOM } from 'jsdom';

import { embedOwnHostImagesAsCid } from 'src/engine/core-modules/tool/tools/email-tool/utils/embed-own-host-images.util';

const OWN = 'https://crm.impressionphotography.ca/sig-images/product.jpg';

const makeWindow = () => new JSDOM('').window;

const mockFetchOk = () =>
  jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    headers: { get: () => 'image/jpeg' },
  });

describe('embedOwnHostImagesAsCid', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should attach an own-host image and rewrite its src to cid:', async () => {
    global.fetch = mockFetchOk() as unknown as typeof fetch;

    const { html, attachments } = await embedOwnHostImagesAsCid({
      html: `<table><tbody><tr><td><img src="${OWN}" alt="logo" /></td></tr></tbody></table>`,
      jsdomWindow: makeWindow(),
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0].isInline).toBe(true);
    expect(attachments[0].filename).toBe('product.jpg');
    expect(attachments[0].contentType).toBe('image/jpeg');
    expect(html).toContain(`cid:${attachments[0].contentId}`);
    expect(html).not.toContain(OWN);
    // Surrounding layout is preserved.
    expect(html).toContain('<table>');
  });

  it('should reuse a single attachment when the same image appears twice', async () => {
    global.fetch = mockFetchOk() as unknown as typeof fetch;

    const { html, attachments } = await embedOwnHostImagesAsCid({
      html: `<div><img src="${OWN}" /><img src="${OWN}" /></div>`,
      jsdomWindow: makeWindow(),
    });

    expect(attachments).toHaveLength(1);
    expect(html.match(/cid:/g)).toHaveLength(2);
  });

  it('should leave the remote URL in place when the fetch fails (never break the send)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    const warn = jest.fn();

    const { html, attachments } = await embedOwnHostImagesAsCid({
      html: `<img src="${OWN}" />`,
      jsdomWindow: makeWindow(),
      logger: { warn },
    });

    expect(attachments).toHaveLength(0);
    expect(html).toContain(OWN);
    expect(warn).toHaveBeenCalled();
  });

  it('should leave the remote URL in place when the fetch throws', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;

    const { html, attachments } = await embedOwnHostImagesAsCid({
      html: `<img src="${OWN}" />`,
      jsdomWindow: makeWindow(),
      logger: { warn: jest.fn() },
    });

    expect(attachments).toHaveLength(0);
    expect(html).toContain(OWN);
  });

  it('should ignore foreign images entirely (never fetch them)', async () => {
    const fetchMock = mockFetchOk();

    global.fetch = fetchMock as unknown as typeof fetch;

    const { attachments } = await embedOwnHostImagesAsCid({
      html: '<img src="https://evil.com/pixel.gif" />',
      jsdomWindow: makeWindow(),
    });

    expect(attachments).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should skip oversized images', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array(3 * 1024 * 1024).buffer,
      headers: { get: () => 'image/png' },
    }) as unknown as typeof fetch;

    const { html, attachments } = await embedOwnHostImagesAsCid({
      html: `<img src="${OWN}" />`,
      jsdomWindow: makeWindow(),
      logger: { warn: jest.fn() },
    });

    expect(attachments).toHaveLength(0);
    expect(html).toContain(OWN);
  });

  it('should be a no-op for bodies with no images', async () => {
    const fetchMock = mockFetchOk();

    global.fetch = fetchMock as unknown as typeof fetch;

    const body = '<p>plain campaign copy</p>';
    const { html, attachments } = await embedOwnHostImagesAsCid({
      html: body,
      jsdomWindow: makeWindow(),
    });

    expect(attachments).toHaveLength(0);
    expect(html).toBe(body);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
