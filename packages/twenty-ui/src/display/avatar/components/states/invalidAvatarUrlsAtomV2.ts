import { atom } from 'jotai';

// Avatar/company-favicon image URLs that have already failed to load (e.g. a
// twenty-icons.com favicon for a domain the service doesn't have, which 404s).
// Once a URL is in here the Avatar renders its placeholder instead of issuing
// another <img> request, so a missing favicon produces at most one browser
// 404 per session rather than one per row / per re-render.
//
// We seed the set from sessionStorage so the de-dup also survives a hard page
// reload within the same browser session. All storage access is guarded — a
// disabled or full sessionStorage must never break avatar rendering.

export const INVALID_AVATAR_URLS_STORAGE_KEY = 'invalidAvatarUrls';

const readPersistedInvalidAvatarUrls = (): string[] => {
  try {
    const raw = window.sessionStorage.getItem(INVALID_AVATAR_URLS_STORAGE_KEY);

    if (raw === null) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    ) {
      return parsed;
    }

    return [];
  } catch {
    return [];
  }
};

export const persistInvalidAvatarUrls = (urls: string[]): void => {
  try {
    window.sessionStorage.setItem(
      INVALID_AVATAR_URLS_STORAGE_KEY,
      JSON.stringify(urls),
    );
  } catch {
    // sessionStorage may be unavailable (private mode / quota) — de-dup still
    // works in-memory for the current page, so failing to persist is harmless.
  }
};

export const invalidAvatarUrlsAtomV2 = atom<string[]>(
  readPersistedInvalidAvatarUrls(),
);
invalidAvatarUrlsAtomV2.debugLabel = 'invalidAvatarUrlsAtomV2';
