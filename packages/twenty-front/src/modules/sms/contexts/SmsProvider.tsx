import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react';

import { REACT_APP_SERVER_BASE_URL } from '~/config';

export type SmsContextType = {
  isOpen: boolean;
  recipientNumber: string | null;
  openComposer: (phoneNumber: string) => void;
  closeComposer: () => void;
  sendSms: (toNumber: string, text: string) => Promise<void>;
  isSending: boolean;
  sendError: string | null;
  clearError: () => void;
};

const SmsContext = createContext<SmsContextType | undefined>(undefined);

export const SmsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [recipientNumber, setRecipientNumber] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const openComposer = useCallback((phoneNumber: string) => {
    setRecipientNumber(phoneNumber);
    setIsOpen(true);
    setSendError(null);
  }, []);

  const closeComposer = useCallback(() => {
    setIsOpen(false);
    setRecipientNumber(null);
    setSendError(null);
  }, []);

  const clearError = useCallback(() => {
    setSendError(null);
  }, []);

  const sendSms = useCallback(async (toNumber: string, text: string) => {
    setIsSending(true);
    setSendError(null);

    try {
      const response = await fetch(
        `${REACT_APP_SERVER_BASE_URL}/api/telnyx/sms/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: toNumber, text }),
        },
      );

      if (!response.ok) {
        const body = await response.text();

        throw new Error(`Send failed: ${response.status} ${body}`);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send SMS');
    } finally {
      setIsSending(false);
    }
  }, []);

  return (
    <SmsContext.Provider
      value={{
        isOpen,
        recipientNumber,
        openComposer,
        closeComposer,
        sendSms,
        isSending,
        sendError,
        clearError,
      }}
    >
      {children}
    </SmsContext.Provider>
  );
};

export const useSmsContext = () => {
  const context = useContext(SmsContext);

  if (context === undefined) {
    throw new Error('useSmsContext must be used within a SmsProvider');
  }

  return context;
};
