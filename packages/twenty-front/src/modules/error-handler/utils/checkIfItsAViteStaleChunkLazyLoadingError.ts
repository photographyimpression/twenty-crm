// A redeploy replaces the content-hashed chunks, so a tab left open across one
// asks for a filename that no longer exists and the lazy route throws. We
// recover by reloading the shell — but only if we recognise the error, and the
// engines word it differently.
//
// Verified against prod on 2026-08-31: Chrome reports a deleted chunk as
// "Failed to fetch dynamically imported module", even though our server does
// not 404 it (the SPA catch-all answers unknown paths with index.html, so the
// response is 200 text/html and Chrome folds the MIME rejection into that same
// message). Firefox and Safari word it their own way, and a classic-script
// MIME rejection surfaces differently again — none of which the original
// single-string check matched.
const STALE_CHUNK_ERROR_MESSAGES = [
  // Chrome / Edge
  'failed to fetch dynamically imported module',
  // Firefox
  'error loading dynamically imported module',
  // Safari
  'importing a module script failed',
  // MIME rejections, when the engine surfaces them directly
  'failed to load module script',
  'was blocked because of a disallowed mime type',
];

export const checkIfItsAViteStaleChunkLazyLoadingError = (error: Error) => {
  const message = error.message.toLowerCase();

  return STALE_CHUNK_ERROR_MESSAGES.some((staleChunkErrorMessage) =>
    message.includes(staleChunkErrorMessage),
  );
};
