export type NoteActivityType = 'email' | 'sms' | 'call' | 'aiSummary' | 'note';

export type NoteActivityClassification = {
  activityType: NoteActivityType;
  direction: string | null;
  subject: string | null;
  duration: string | null;
  displaySummary: string;
};

export const classifyNoteActivity = (
  title: string | null | undefined,
): NoteActivityClassification => {
  const fallback: NoteActivityClassification = {
    activityType: 'note',
    direction: null,
    subject: null,
    duration: null,
    displaySummary: title || 'Untitled',
  };

  if (!title) return fallback;

  if (title.startsWith('[Email]')) {
    const rest = title.replace('[Email]', '').trim();
    const directionMatch = rest.match(/^(Sent|Received)/i);
    const direction = directionMatch ? directionMatch[1] : null;

    let subject: string | null = null;
    const subjectMatch = rest.match(/^(?:Sent|Received)\s*-\s*(.+?)(?:\s*\([\d/]+\))?$/);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
    }

    const displaySummary = subject
      ? `Email ${direction || ''} — ${subject}`.trim()
      : `Email ${direction || ''}`.trim();

    return {
      activityType: 'email',
      direction,
      subject,
      duration: null,
      displaySummary,
    };
  }

  if (title.startsWith('[SMS]')) {
    const rest = title.replace('[SMS]', '').trim();
    const directionMatch = rest.match(/^(Sent|Received)/i);
    const direction = directionMatch ? directionMatch[1] : null;

    return {
      activityType: 'sms',
      direction,
      subject: null,
      duration: null,
      displaySummary: `SMS ${direction || ''}`.trim(),
    };
  }

  if (title.startsWith('[Call]')) {
    const rest = title.replace('[Call]', '').trim();
    const directionMatch = rest.match(/^(Incoming|Outgoing|Outbound)/i);
    const direction = directionMatch ? directionMatch[1] : null;

    const durationMatch = rest.match(/\((\d+m\s*\d*s?)\)/i);
    const duration = durationMatch ? durationMatch[1] : null;

    let displaySummary = direction ? `${direction} Call` : 'Call';
    if (duration) displaySummary += ` (${duration})`;

    return {
      activityType: 'call',
      direction,
      subject: null,
      duration,
      displaySummary,
    };
  }

  if (
    title === 'AI History Summary' ||
    title.startsWith('AI History Summary')
  ) {
    return {
      activityType: 'aiSummary',
      direction: null,
      subject: null,
      duration: null,
      displaySummary: 'AI History Summary',
    };
  }

  return fallback;
};
