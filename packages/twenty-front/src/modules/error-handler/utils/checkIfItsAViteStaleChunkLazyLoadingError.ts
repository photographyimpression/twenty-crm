// A redeploy replaces the content-hashed chunks, so a tab that has been open
// across one asks for a filename that no longer exists. Our server does NOT
// 404 that request — the SPA catch-all answers every unknown path with
// index.html, so the browser gets `200 text/html` where it expected a module
// and refuses it on MIME grounds. That produces a DIFFERENT message from the
// network-failure one, which is why the auto-reload below used to miss it and
// the page dead-ended on "Sorry, something went wrong" instead (2026-08-31).
//
// Match every shape the three engines produce for "this chunk is stale":
//   Chrome  fetch failed : Failed to fetch dynamically imported module: <url>
//   Chrome  served HTML  : Failed to load module script: Expected a JavaScript
//                          module script but the server responded with a MIME
//                          type of "text/html". …
//   Firefox fetch failed : error loading dynamically imported module
//   Firefox served HTML  : Loading module from "<url>" was blocked because of a
//                          disallowed MIME type ("text/html").
//   Safari               : Importing a module script failed.
const STALE_CHUNK_ERROR_MESSAGES = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'failed to load module script',
  'was blocked because of a disallowed mime type',
  'importing a module script failed',
];

export const checkIfItsAViteStaleChunkLazyLoadingError = (error: Error) => {
  const message = error.message.toLowerCase();

  return STALE_CHUNK_ERROR_MESSAGES.some((staleChunkErrorMessage) =>
    message.includes(staleChunkErrorMessage),
  );
};
