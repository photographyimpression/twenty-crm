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

export const useCallTranscription = (isActive: boolean) => {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startTranscription = useCallback(() => {
    const SpeechRecognitionApi =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionApi) {
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
          setTranscript((prev) => [
            ...prev,
            {
              speaker: 'You',
              text,
              timestamp: Date.now(),
              isFinal: true,
            },
          ]);
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
      // eslint-disable-next-line no-console
      console.error('Speech recognition error:', event.error);
    };

    recognition.onend = () => {
      // Auto-restart if still active
      if (isActive) {
        restartTimeoutRef.current = setTimeout(() => {
          if (isActive && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {
              // ignore - may already be started
            }
          }
        }, 100);
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
    startTranscription,
    stopTranscription,
    clearTranscript,
    getFullTranscript,
  };
};
