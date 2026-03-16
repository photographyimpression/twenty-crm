import { useCallback, useEffect, useRef, useState } from 'react';

type TranscriptEntry = {
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
};

type SpeechRecognitionEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionErrorEvent = {
  error: string;
  message?: string;
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const MAX_TRANSCRIPT_ENTRIES = 500;
const RESTART_DELAY_MS = 300;
const MAX_RESTART_ATTEMPTS = 10;

export const useCallTranscription = (isActive: boolean) => {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartAttemptsRef = useRef(0);
  const isActiveRef = useRef(isActive);

  // Keep ref in sync to avoid stale closures
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const startTranscription = useCallback(() => {
    const SpeechRecognitionApi =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionApi) {
      setIsSupported(false);

      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }

    const recognition = new SpeechRecognitionApi();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();

        if (result.isFinal) {
          setTranscript((prev) => {
            const updated = [
              ...prev,
              {
                speaker: 'You',
                text,
                timestamp: Date.now(),
                isFinal: true,
              },
            ];

            // Prevent unbounded growth for long calls
            if (updated.length > MAX_TRANSCRIPT_ENTRIES) {
              return updated.slice(-MAX_TRANSCRIPT_ENTRIES);
            }

            return updated;
          });
          setInterimText('');
        } else {
          interim += text;
        }
      }

      if (interim) {
        setInterimText(interim);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      if (event.error === 'not-allowed') {
        // Microphone permission denied
        setIsTranscribing(false);
        setIsSupported(false);

        return;
      }

      if (event.error === 'network') {
        // Network error — will auto-restart via onend
        return;
      }

      // eslint-disable-next-line no-console
      console.error('Speech recognition error:', event.error);
    };

    recognition.onend = () => {
      // Auto-restart if still active, with attempt limiting
      if (isActiveRef.current) {
        restartAttemptsRef.current += 1;

        if (restartAttemptsRef.current > MAX_RESTART_ATTEMPTS) {
          setIsTranscribing(false);

          return;
        }

        restartTimeoutRef.current = setTimeout(() => {
          if (isActiveRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
              // Reset counter on successful restart
              restartAttemptsRef.current = 0;
            } catch {
              // ignore - may already be started
            }
          }
        }, RESTART_DELAY_MS);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsTranscribing(true);
    } catch {
      // ignore
    }
  }, [isActive]);

  const stopTranscription = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    setIsTranscribing(false);
    setInterimText('');
    restartAttemptsRef.current = 0;
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
    setInterimText('');
  }, []);

  const getFullTranscript = useCallback((): string => {
    return transcript
      .filter((entry) => entry.isFinal)
      .map((entry) => `[${entry.speaker}] ${entry.text}`)
      .join('\n');
  }, [transcript]);

  // Auto-start/stop based on call active state
  useEffect(() => {
    if (isActive) {
      startTranscription();
    } else {
      stopTranscription();
    }

    return () => {
      stopTranscription();
    };
  }, [isActive, startTranscription, stopTranscription]);

  return {
    transcript,
    interimText,
    isTranscribing,
    isSupported,
    startTranscription,
    stopTranscription,
    clearTranscript,
    getFullTranscript,
  };
};
