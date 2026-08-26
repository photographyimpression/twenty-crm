export type NoteActivityType =
  | 'email'
  | 'sms'
  | 'call'
  | 'message'
  | 'aiSummary'
  | 'note';

// Logged activity arrives under two conventions that grew up at different
// times: the older bracket form ("[Call] Outgoing (3m 20s)") and the newer
// emoji form ("📤 Phone Call", "📥 SMS Received"). On production the emoji form
// is now the common one for calls — classifying only the brackets left real
// calls sitting in the Notes bucket and made "Last call" read as never.
const LEADING_EMOJI = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+\s*/u;

// Two-way channel messages that are neither email, SMS, nor a phone call.
const CHANNEL_PREFIXES = [
  'Facebook Ad',
  'Facebook',
  'Instagram',
  'Google Message',
  'Google Business',
  'WhatsApp',
  'Review',
  'Custom',
  'Activity',
] as const;

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
    const subjectMatch = rest.match(
      /^(?:Sent|Received)\s*-\s*(.+?)(?:\s*\([\d/]+\))?$/,
    );
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

  // Emoji form. 📤 is outbound, 📥 is inbound; the words after it name the
  // channel ("Phone Call", "SMS Received", "SMS Sent").
  const hasLeadingEmoji = LEADING_EMOJI.test(title);
  const withoutEmoji = title.replace(LEADING_EMOJI, '').trim();

  if (hasLeadingEmoji) {
    const emojiDirection = title.startsWith('📥')
      ? 'Received'
      : title.startsWith('📤')
        ? 'Sent'
        : null;

    if (/^phone call/i.test(withoutEmoji)) {
      const durationMatch = withoutEmoji.match(/\((\d+m\s*\d*s?)\)/i);
      const duration = durationMatch ? durationMatch[1] : null;
      const callDirection =
        emojiDirection === 'Received'
          ? 'Incoming'
          : emojiDirection === 'Sent'
            ? 'Outgoing'
            : null;

      let displaySummary = callDirection ? `${callDirection} Call` : 'Call';
      if (duration) displaySummary += ` (${duration})`;

      return {
        activityType: 'call',
        direction: callDirection,
        subject: null,
        duration,
        displaySummary,
      };
    }

    if (/^sms/i.test(withoutEmoji)) {
      const wordDirection = withoutEmoji.match(/\b(Sent|Received)\b/i);
      const direction = wordDirection
        ? wordDirection[1]
        : (emojiDirection ?? null);

      return {
        activityType: 'sms',
        direction,
        subject: null,
        duration: null,
        displaySummary: `SMS ${direction ?? ''}`.trim(),
      };
    }
  }

  const channel = CHANNEL_PREFIXES.find((channelPrefix) =>
    withoutEmoji.startsWith(`[${channelPrefix}]`),
  );

  if (channel) {
    const rest = withoutEmoji.replace(`[${channel}]`, '').trim();
    const directionMatch = rest.match(/^(Sent|Received)/i);
    const direction = directionMatch ? directionMatch[1] : null;

    return {
      activityType: 'message',
      direction,
      subject: null,
      duration: null,
      displaySummary: `${channel} ${direction ?? ''}`.trim(),
    };
  }

  return fallback;
};
