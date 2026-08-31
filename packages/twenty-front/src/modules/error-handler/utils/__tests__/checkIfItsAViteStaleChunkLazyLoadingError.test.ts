import { checkIfItsAViteStaleChunkLazyLoadingError } from '@/error-handler/utils/checkIfItsAViteStaleChunkLazyLoadingError';

describe('checkIfItsAViteStaleChunkLazyLoadingError', () => {
  it('should return true when the chunk request failed outright', () => {
    const error = new Error(
      'Failed to fetch dynamically imported module: /some/module.js',
    );

    const result = checkIfItsAViteStaleChunkLazyLoadingError(error);

    expect(result).toBe(true);
  });

  // The shape our own server produces: the SPA catch-all answers a deleted
  // chunk with index.html, so the browser rejects it on MIME grounds.
  it('should return true when the server answered the chunk with HTML', () => {
    const error = new Error(
      'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.',
    );

    const result = checkIfItsAViteStaleChunkLazyLoadingError(error);

    expect(result).toBe(true);
  });

  it('should return true for the Firefox variants', () => {
    expect(
      checkIfItsAViteStaleChunkLazyLoadingError(
        new Error('error loading dynamically imported module'),
      ),
    ).toBe(true);

    expect(
      checkIfItsAViteStaleChunkLazyLoadingError(
        new Error(
          'Loading module from "https://app/assets/Page-abc.js" was blocked because of a disallowed MIME type ("text/html").',
        ),
      ),
    ).toBe(true);
  });

  it('should return true for the Safari variant', () => {
    const error = new Error('Importing a module script failed.');

    const result = checkIfItsAViteStaleChunkLazyLoadingError(error);

    expect(result).toBe(true);
  });

  it('should return false when error message is unrelated to chunk loading', () => {
    const error = new Error('Some other error message');

    const result = checkIfItsAViteStaleChunkLazyLoadingError(error);

    expect(result).toBe(false);
  });
});
