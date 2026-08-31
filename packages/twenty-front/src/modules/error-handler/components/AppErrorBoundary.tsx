import { AppErrorBoundaryEffect } from '@/error-handler/components/internal/AppErrorBoundaryEffect';
import { checkIfItsAViteStaleChunkLazyLoadingError } from '@/error-handler/utils/checkIfItsAViteStaleChunkLazyLoadingError';
import { type ErrorInfo, type ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { type CustomError, isDefined } from 'twenty-shared/utils';

type AppErrorBoundaryProps = {
  children: ReactNode;
  FallbackComponent: React.ComponentType<FallbackProps>;
  resetOnLocationChange?: boolean;
};

const hasErrorCode = (
  error: Error | CustomError,
): error is CustomError & { code: string } => {
  return 'code' in error && isDefined(error.code);
};

const STALE_CHUNK_RELOAD_KEY = 'staleChunkReloadedAt';
// A real recovery reloads once and works. A loop reloads again immediately,
// so rate-limit rather than allow-once: a tab left open across several deploys
// must still recover each time, which a one-shot flag would break.
const STALE_CHUNK_RELOAD_COOLDOWN_MS = 10_000;

// sessionStorage, so the guard is per tab and clears when the tab closes.
// Storage can throw (private mode); treat that as "safe to reload" — the worst
// case is the previous, unguarded behaviour.
const hasJustReloadedForStaleChunk = () => {
  try {
    const reloadedAt = Number(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY));

    return (
      Number.isFinite(reloadedAt) &&
      reloadedAt > 0 &&
      Date.now() - reloadedAt < STALE_CHUNK_RELOAD_COOLDOWN_MS
    );
  } catch {
    return false;
  }
};

const markReloadedForStaleChunk = () => {
  try {
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // no-op: a tab that cannot remember simply behaves as it did before
  }
};

export const AppErrorBoundary = ({
  children,
  FallbackComponent,
  resetOnLocationChange = true,
}: AppErrorBoundaryProps) => {
  const handleError = async (error: Error | CustomError, info: ErrorInfo) => {
    try {
      const { captureException } = await import('@sentry/react');
      captureException(error, (scope) => {
        scope.setExtras({ info });

        const fingerprint = hasErrorCode(error) ? error.code : error.message;
        scope.setFingerprint([fingerprint]);
        error.name = error.message;
        return scope;
      });
    } catch (sentryError) {
      // oxlint-disable-next-line no-console
      console.error('Failed to capture exception with Sentry:', sentryError);
    }

    const isViteStaleChunkLazyLoadingError =
      checkIfItsAViteStaleChunkLazyLoadingError(error);

    // The reload fetches a fresh index.html and the chunk hashes it names,
    // which is the whole fix. Guard it: if a deploy is genuinely broken the
    // chunk stays unloadable, and an unguarded reload would put the tab in an
    // endless refresh loop. One attempt per cooldown, then let the fallback
    // render so the user sees something they can act on.
    if (isViteStaleChunkLazyLoadingError && !hasJustReloadedForStaleChunk()) {
      markReloadedForStaleChunk();
      window.location.reload();
    }
  };

  const handleReset = () => {
    window.location.reload();
  };

  return (
    <ErrorBoundary
      FallbackComponent={({ error, resetErrorBoundary }) => (
        <>
          {resetOnLocationChange && (
            <AppErrorBoundaryEffect resetErrorBoundary={resetErrorBoundary} />
          )}
          <FallbackComponent
            error={error}
            resetErrorBoundary={resetErrorBoundary}
          />
        </>
      )}
      onError={handleError}
      onReset={handleReset}
    >
      {children}
    </ErrorBoundary>
  );
};
