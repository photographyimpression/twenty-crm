import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 30_000;
const STORAGE_KEY = 'sms-inbox-last-viewed-at';

type SmsRecord = {
  id: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
};

// Returns the number of inbound SMS records received after the user
// last opened /sms-inbox (tracked in localStorage). Polls every 30s.
export const useUnreadSmsCount = (): number => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const serverUrl =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (import.meta as any).env?.REACT_APP_SERVER_BASE_URL ||
      window.location.origin;

    const tick = async () => {
      try {
        const response = await fetch(`${serverUrl}/telnyx/sms-records`);

        if (!response.ok || cancelled) return;

        const result = (await response.json()) as { data?: SmsRecord[] };
        const records = result.data ?? [];
        const lastViewed = Number(
          window.localStorage.getItem(STORAGE_KEY) ?? '0',
        );
        const unread = records.filter((r) => {
          if (r.direction !== 'inbound') return false;
          const ts = Date.parse(r.timestamp);

          return Number.isFinite(ts) && ts > lastViewed;
        }).length;

        if (!cancelled) setCount(unread);
      } catch {
        // Silently retry on next poll
      }
    };

    void tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return count;
};

// Mark all SMS as read (called when /sms-inbox mounts)
export const markSmsAsRead = (): void => {
  window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
};
