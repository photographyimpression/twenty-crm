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
          client = new TelnyxRTC({
            login_token: tokenData.token,
          });
        } else {
          // Fallback to credential auth
          console.log('TelnyxRTC: falling back to credential auth');
          const sipUsername =
            import.meta.env.REACT_APP_TELNYX_SIP_USERNAME ||
            'usermoshe40552';
          const sipPassword =
            import.meta.env.REACT_APP_TELNYX_SIP_PASSWORD ||
            'CrmWebRTC2026x';
          client = new TelnyxRTC({
            login: sipUsername,
            password: sipPassword,
          });
        }
      } catch {
        // If token fetch fails, fallback to credential auth
        console.log(
          'TelnyxRTC: token fetch failed, using credential auth',
        );
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
            setActiveCall(call);
            setIsRinging(true);
            setIsIncoming(call.direction === 'inbound');
            setActiveNumber(call.remoteCallerNumber ?? null);
            setCallSessionId(
              call.telnyxCallControlId ?? call.id ?? null,
            );
            break;
          case 'active':
            setIsRinging(false);
            setInCall(true);
            setCallStartTime(Date.now());
            break;
          case 'done':
          case 'hangup':
          case 'destroy':
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

      client.connect();
      clientRef.current = client;
    };

    initTelnyx();

    // Refresh JWT token every 10 minutes (tokens expire after ~1 hour)
    const tokenRefreshInterval = setInterval(
      async () => {
        try {
          const tokenResponse = await fetch('/telnyx/webrtc-token');
          const tokenData = (await tokenResponse.json()) as {
            token?: string;
          };

          if (tokenData?.token && clientRef.current) {
            console.log('TelnyxRTC: refreshing JWT token');
            clientRef.current.disconnect();
            const newClient = new TelnyxRTC({
              login_token: tokenData.token,
            });

            newClient.on('telnyx.ready', () => {
              console.log('TelnyxRTC: reconnected after token refresh');
              setIsRegistered(true);
              setError(null);
            });

            newClient.on('telnyx.error', (err: any) => {
              console.error('TelnyxRTC error after refresh:', err);
              setError(err?.message ?? 'Telnyx connection error');
              setIsRegistered(false);
            });

            newClient.on('telnyx.notification', (notification: any) => {
              if (notification.type !== 'callUpdate') return;

              const call = notification.call;
              console.log('TelnyxRTC call state:', call.state, call);
              switch (call.state) {
                case 'ringing':
                  setActiveCall(call);
                  setIsRinging(true);
                  setIsIncoming(call.direction === 'inbound');
                  setActiveNumber(call.remoteCallerNumber ?? null);
                  setCallSessionId(
                    call.telnyxCallControlId ?? call.id ?? null,
                  );
                  break;
                case 'active':
                  setIsRinging(false);
                  setInCall(true);
                  setCallStartTime(Date.now());
                  break;
                case 'done':
                case 'hangup':
                case 'destroy':
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

            newClient.connect();
            clientRef.current = newClient;
          }
        } catch {
          console.warn('TelnyxRTC: token refresh failed, will retry');
        }
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
  }, []);

  const dial = useCallback(
    (number: string) => {
      if (!clientRef.current || !isRegistered) {
        setError('Not connected to Telnyx');
        return;
      }

      const fromNumber =
        import.meta.env.REACT_APP_TELNYX_FROM_NUMBER || '+19344700764';
      const cleanNumber = number.replace(/[^\d+]/g, '');

      const call = clientRef.current.newCall({
        destinationNumber: cleanNumber,
        callerNumber: fromNumber,
      });

      setActiveCall(call);
      setActiveNumber(number);
      setIsRinging(true);
      setIsIncoming(false);
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
