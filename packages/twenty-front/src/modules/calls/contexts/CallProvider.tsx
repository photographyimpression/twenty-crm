import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  Inviter,
  Registerer,
  SessionState,
  UserAgent,
  UserAgentOptions,
} from 'sip.js';

export type CallContextType = {
  isRegistered: boolean;
  isRinging: boolean;
  inCall: boolean;
  activeNumber: string | null;
  dial: (number: string) => void;
  hangup: () => void;
  clearError: () => void;
  error: string | null;
};

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [userAgent, setUserAgent] = useState<UserAgent | null>(null);
  const [activeSession, setActiveSession] = useState<Inviter | null>(null);

  const [isRegistered, setIsRegistered] = useState(false);
  const [isRinging, setIsRinging] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [activeNumber, setActiveNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Vite exposes env vars via import.meta.env (not process.env)
    const sipDomain =
      import.meta.env.VITE_PBX_DOMAIN || 'pbx.impressionphotography.ca';
    const sipWssUrl =
      import.meta.env.VITE_PBX_WSS_URL ||
      'wss://pbx.impressionphotography.ca:8089/ws';
    const sipUser = import.meta.env.VITE_PBX_USER || '100';
    const sipPassword =
      import.meta.env.VITE_PBX_PASSWORD ||
      '31dd94e3bfea496dac8e14f9a3a48faa';

    const uri = UserAgent.makeURI(`sip:${sipUser}@${sipDomain}`);
    if (!uri) return;

    const options: UserAgentOptions = {
      uri,
      transportOptions: {
        server: sipWssUrl,
      },
      authorizationUsername: sipUser,
      authorizationPassword: sipPassword,
    };

    const ua = new UserAgent(options);
    let registerer: Registerer | null = null;

    console.log('SIP UserAgent started', { sipUser, sipDomain, sipWssUrl });
    ua.start()
      .then(() => {
        // Register the extension with FreePBX so outbound calls work
        registerer = new Registerer(ua);
        return registerer.register();
      })
      .then(() => {
        setIsRegistered(true);
      })
      .catch((err) => {
        console.error('Failed to start or register UserAgent', err);
        setError('Failed to connect to PBX');
      });

    setUserAgent(ua);

    return () => {
      registerer?.unregister().finally(() => ua.stop());
    };
  }, []);

  const dial = useCallback(
    (number: string) => {
      if (!userAgent) return;

      const sipDomain =
        import.meta.env.VITE_PBX_DOMAIN || 'pbx.impressionphotography.ca';

      // Clean phone number (remove spaces, dashes, parens, etc.)
      const cleanNumber = number.replace(/[^\d+]/g, '');
      const targetUri = UserAgent.makeURI(`sip:${cleanNumber}@${sipDomain}`);

      if (!targetUri) {
        setError('Invalid phone number format');
        return;
      }

      const session = new Inviter(userAgent, targetUri, {
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      });

      session.stateChange.addListener((newState) => {
        switch (newState) {
          case SessionState.Establishing:
            setIsRinging(true);
            break;
          case SessionState.Established:
            setIsRinging(false);
            setInCall(true);
            break;
          case SessionState.Terminated:
            setIsRinging(false);
            setInCall(false);
            setActiveSession(null);
            setActiveNumber(null);
            break;
        }
      });

      console.log('Dialing number...', number);
      session
        .invite()
        .then(() => {
          console.log('Invite sent successfully');
          setActiveSession(session);
          setActiveNumber(number);
          setError(null);
        })
        .catch((err) => {
          console.error('Failed to invite', err);
          setError('Failed to place call');
        });
    },
    [userAgent],
  );

  const hangup = useCallback(() => {
    if (activeSession) {
      activeSession.dispose();
      setActiveSession(null);
      setInCall(false);
      setIsRinging(false);
      setActiveNumber(null);
    }
  }, [activeSession]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <CallContext.Provider
      value={{
        isRegistered,
        isRinging,
        inCall,
        activeNumber,
        dial,
        hangup,
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
