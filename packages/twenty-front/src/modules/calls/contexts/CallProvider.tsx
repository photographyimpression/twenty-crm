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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sipUsername =
      import.meta.env.REACT_APP_TELNYX_SIP_USERNAME || 'usermoshe40552';
    const sipPassword =
      import.meta.env.REACT_APP_TELNYX_SIP_PASSWORD || 'EZ9A.LnsW9ao';

    let client: TelnyxRTC;

    try {
      client = new TelnyxRTC({
        login: sipUsername,
        password: sipPassword,
      });
    } catch (err) {
      console.error('TelnyxRTC: failed to create client', err);
      setError('Failed to initialize Telnyx');
      return;
    }

    client.on('telnyx.ready', () => {
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
      switch (call.state) {
        case 'ringing':
          setActiveCall(call);
          setIsRinging(true);
          setIsIncoming(call.direction === 'inbound');
          setActiveNumber(call.remoteCallerNumber ?? null);
          break;
        case 'active':
          setIsRinging(false);
          setInCall(true);
          break;
        case 'done':
          setIsRinging(false);
          setInCall(false);
          setIsIncoming(false);
          setActiveCall(null);
          setActiveNumber(null);
          break;
      }
    });

    client.connect();
    clientRef.current = client;

    return () => {
      client.off('telnyx.ready');
      client.off('telnyx.error');
      client.off('telnyx.notification');
      client.disconnect();
      clientRef.current = null;
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
