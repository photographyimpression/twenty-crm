import { TelnyxRTC } from '@telnyx/webrtc';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export type CallContextType = {
  isRegistered: boolean;
  isRinging: boolean;
  isIncoming: boolean;
  inCall: boolean;
  activeNumber: string | null;
  callSessionId: string | null;
  callStartTime: number | null;
  dial: (number: string) => void;
  hangup: () => void;
  answer: () => void;
  clearError: () => void;
  error: string | null;
};

const CallContext = createContext<CallContextType | undefined>(undefined);

// ID of the hidden <audio> element used by TelnyxRTC to play remote audio.
// MUST match the id of the <audio> element rendered by this provider — without
// `client.remoteElement` pointing at a real element, the SDK creates the call
// but never attaches the remote MediaStream to a sink, so the user hears
// silence even though Telnyx reports the call as answered + bridged.
const REMOTE_AUDIO_ELEMENT_ID = 'telnyx-remote-audio';

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const [activeCall, setActiveCall] = useState<any>(null);

  const [isRegistered, setIsRegistered] = useState(false);
  const [isRinging, setIsRinging] = useState(false);
  const [isIncoming, setIsIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [activeNumber, setActiveNumber] = useState<string | null>(null);
  const [callSessionId, setCallSessionId] = useState<string | null>(null);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // True while a call is ringing or live. The token-refresh timer must NEVER
  // tear the WebRTC client down in this state — disconnecting the client hangs
  // up the call from OUR end mid-sentence (board card 2026-08-30: "we need to
  // make sure calls are not disconnected from my end"). Kept in a ref so the
  // interval callback sees the live value without re-subscribing.
  const callBusyRef = useRef(false);
  // Set when the 10-min refresh fired during a call; the refresh then runs as
  // soon as the call ends (see the inCall/isRinging effect below).
  const pendingRefreshRef = useRef(false);
  const refreshingRef = useRef(false);

  // Shared wiring for EVERY TelnyxRTC client (initial + every token refresh):
  // audio sink + ready/error/notification handlers. One definition so a
  // refreshed client behaves exactly like the first one.
  const attachClientListeners = useCallback((client: TelnyxRTC) => {
    // Tell TelnyxRTC which DOM element to use for remote audio playback.
    // Must be set before `client.connect()` so the SDK wires the
    // RTCPeerConnection's remote track to this <audio> sink on the first
    // call. Without this the call connects but no sound plays.
    (client as unknown as { remoteElement: string }).remoteElement =
      REMOTE_AUDIO_ELEMENT_ID;

    client.on('telnyx.ready', () => {
      console.log('TelnyxRTC: connected and ready');
      setIsRegistered(true);
      setError(null);
    });

    client.on('telnyx.error', (err: any) => {
      console.error('TelnyxRTC error:', err);
      setError(err?.message ?? 'Telnyx connection error');
      setIsRegistered(false);
    });

    client.on('telnyx.notification', (notification: any) => {
      if (notification.type !== 'callUpdate') return;

      const call = notification.call;
      console.log('TelnyxRTC call state:', call.state, call);
      switch (call.state) {
        case 'ringing':
          callBusyRef.current = true;
          setActiveCall(call);
          setIsRinging(true);
          setIsIncoming(call.direction === 'inbound');
          setActiveNumber(call.remoteCallerNumber ?? null);
          setCallSessionId(call.telnyxCallControlId ?? call.id ?? null);
          break;
        case 'active':
          callBusyRef.current = true;
          setIsRinging(false);
          setInCall(true);
          setCallStartTime(Date.now());
          break;
        case 'done':
        case 'hangup':
        case 'destroy':
          callBusyRef.current = false;
          setIsRinging(false);
          setInCall(false);
          setIsIncoming(false);
          setActiveCall(null);
          setActiveNumber(null);
          setCallSessionId(null);
          setCallStartTime(null);
          break;
      }
    });
  }, []);

  // Swap in a fresh client on a fresh JWT. Callers must ensure no call is
  // live (callBusyRef) before invoking.
  const doTokenRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const tokenResponse = await fetch('/telnyx/webrtc-token');
      const tokenData = (await tokenResponse.json()) as {
        token?: string;
      };

      if (tokenData?.token) {
        console.log('TelnyxRTC: refreshing JWT token');
        const oldClient = clientRef.current;
        const newClient = new TelnyxRTC({ login_token: tokenData.token });
        attachClientListeners(newClient);

        // Detach the old client's listeners so its late events can't clobber
        // the new client's state, then retire it.
        if (oldClient) {
          oldClient.off('telnyx.ready');
          oldClient.off('telnyx.error');
          oldClient.off('telnyx.notification');
          oldClient.disconnect();
        }

        newClient.connect();
        clientRef.current = newClient;
      }
    } catch {
      console.warn('TelnyxRTC: token refresh failed, will retry');
    } finally {
      refreshingRef.current = false;
    }
  }, [attachClientListeners]);

  useEffect(() => {
    let cancelled = false;

    const initTelnyx = async () => {
      let client: TelnyxRTC;

      try {
        // Try fetching a JWT token from the backend (recommended by Telnyx)
        const tokenResponse = await fetch('/telnyx/webrtc-token');
        const tokenData = (await tokenResponse.json()) as {
          token?: string;
        };

        if (tokenData?.token) {
          console.log('TelnyxRTC: using JWT login_token auth');
          client = new TelnyxRTC({ login_token: tokenData.token });
        } else {
          // Fallback to credential auth
          console.log('TelnyxRTC: falling back to credential auth');
          const sipUsername =
            import.meta.env.REACT_APP_TELNYX_SIP_USERNAME || 'usermoshe40552';
          const sipPassword =
            import.meta.env.REACT_APP_TELNYX_SIP_PASSWORD || 'CrmWebRTC2026x';
          client = new TelnyxRTC({
            login: sipUsername,
            password: sipPassword,
          });
        }
      } catch {
        // If token fetch fails, fallback to credential auth
        console.log('TelnyxRTC: token fetch failed, using credential auth');
        const sipUsername =
          import.meta.env.REACT_APP_TELNYX_SIP_USERNAME || 'usermoshe40552';
        const sipPassword =
          import.meta.env.REACT_APP_TELNYX_SIP_PASSWORD || 'CrmWebRTC2026x';
        client = new TelnyxRTC({
          login: sipUsername,
          password: sipPassword,
        });
      }

      if (cancelled) return;

      attachClientListeners(client);
      client.connect();
      clientRef.current = client;
    };

    initTelnyx();

    // Refresh the JWT periodically (tokens expire after ~1 hour) — but a
    // live call always wins: swapping clients mid-call hangs up the phone on
    // the customer. When a call blocks the refresh, it runs right after the
    // call ends instead.
    const tokenRefreshInterval = setInterval(
      () => {
        if (callBusyRef.current) {
          pendingRefreshRef.current = true;
          console.log(
            'TelnyxRTC: token refresh deferred — call in progress',
          );
          return;
        }
        doTokenRefresh();
      },
      10 * 60 * 1000,
    );

    return () => {
      cancelled = true;
      clearInterval(tokenRefreshInterval);

      if (clientRef.current) {
        clientRef.current.off('telnyx.ready');
        clientRef.current.off('telnyx.error');
        clientRef.current.off('telnyx.notification');
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [attachClientListeners, doTokenRefresh]);

  // A refresh was postponed because a call was live — run it now that the
  // line is free, before the (possibly stale-token) client drops on its own.
  useEffect(() => {
    if (!inCall && !isRinging && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      doTokenRefresh();
    }
  }, [inCall, isRinging, doTokenRefresh]);

  const dial = useCallback(
    (number: string) => {
      if (!clientRef.current || !isRegistered) {
        setError('Not connected to Telnyx');
        return;
      }

      const fromNumber =
        import.meta.env.REACT_APP_TELNYX_FROM_NUMBER || '+15142702784';
      const cleanNumber = number.replace(/[^\d+]/g, '');

      const call = clientRef.current.newCall({
        destinationNumber: cleanNumber,
        callerNumber: fromNumber,
        // Without `audio: true` the SDK won't request mic permission, so the
        // remote side hears silence. Combined with the audio sink set on the
        // client, this gives full two-way audio.
        audio: true,
      });

      setActiveCall(call);
      setActiveNumber(number);
      setIsRinging(true);
      setIsIncoming(false);
      callBusyRef.current = true;
      setCallSessionId(
        (call as unknown as { telnyxCallControlId?: string })
          ?.telnyxCallControlId ??
          call?.id ??
          null,
      );
      setError(null);
    },
    [isRegistered],
  );

  const hangup = useCallback(() => {
    if (activeCall) {
      activeCall.hangup();
      setActiveCall(null);
      setInCall(false);
      setIsRinging(false);
      setIsIncoming(false);
      setActiveNumber(null);
      setCallSessionId(null);
      setCallStartTime(null);
      callBusyRef.current = false;
    }
  }, [activeCall]);

  const answer = useCallback(() => {
    if (activeCall && isIncoming) {
      activeCall.answer();
    }
  }, [activeCall, isIncoming]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <CallContext.Provider
      value={{
        isRegistered,
        isRinging,
        isIncoming,
        inCall,
        activeNumber,
        callSessionId,
        callStartTime,
        dial,
        hangup,
        answer,
        clearError,
        error,
      }}
    >
      {/*
        Hidden audio sink for TelnyxRTC remote playback. autoPlay is required
        so the stream starts playing as soon as the SDK attaches it — without
        it Chrome's autoplay policy keeps it muted. Kept outside the dialer
        widget so the element survives even when the widget isn't mounted.
      */}
      <audio id={REMOTE_AUDIO_ELEMENT_ID} autoPlay style={{ display: 'none' }} />
      {children}
    </CallContext.Provider>
  );
};

export const useCallContext = () => {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error('useCallContext must be used within a CallProvider');
  }
  return context;
};
