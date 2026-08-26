import { classifyNoteActivity } from '@/activities/timeline-activities/utils/classifyNoteActivity';

describe('classifyNoteActivity', () => {
  describe('bracket convention', () => {
    it('should classify a sent email and keep its subject', () => {
      const result = classifyNoteActivity(
        '[Email] Sent - Your pricing request',
      );

      expect(result.activityType).toBe('email');
      expect(result.direction).toBe('Sent');
      expect(result.subject).toBe('Your pricing request');
    });

    it('should classify an SMS with a direction', () => {
      const result = classifyNoteActivity('[SMS] Sent - quote follow up');

      expect(result.activityType).toBe('sms');
      expect(result.direction).toBe('Sent');
    });

    it('should classify an SMS logged with only a date', () => {
      expect(classifyNoteActivity('[SMS] (11/3/2025)').activityType).toBe(
        'sms',
      );
    });

    it('should classify a call and keep its duration', () => {
      const result = classifyNoteActivity('[Call] Outgoing (3m 20s)');

      expect(result.activityType).toBe('call');
      expect(result.direction).toBe('Outgoing');
      expect(result.duration).toBe('3m 20s');
    });
  });

  describe('emoji convention', () => {
    it('should classify an outbound phone call', () => {
      const result = classifyNoteActivity('📤 Phone Call');

      expect(result.activityType).toBe('call');
      expect(result.direction).toBe('Outgoing');
      expect(result.displaySummary).toBe('Outgoing Call');
    });

    it('should classify an inbound phone call', () => {
      const result = classifyNoteActivity('📥 Phone Call');

      expect(result.activityType).toBe('call');
      expect(result.direction).toBe('Incoming');
    });

    it('should keep the duration on an emoji phone call', () => {
      const result = classifyNoteActivity('📤 Phone Call (2m 05s)');

      expect(result.activityType).toBe('call');
      expect(result.duration).toBe('2m 05s');
      expect(result.displaySummary).toBe('Outgoing Call (2m 05s)');
    });

    it('should classify a received SMS', () => {
      const result = classifyNoteActivity('📥 SMS Received (8/12/2026)');

      expect(result.activityType).toBe('sms');
      expect(result.direction).toBe('Received');
    });

    it('should classify a sent SMS', () => {
      const result = classifyNoteActivity('📤 SMS Sent');

      expect(result.activityType).toBe('sms');
      expect(result.direction).toBe('Sent');
    });
  });

  describe('channel messages', () => {
    it.each([
      ['[Facebook] (7/14/2025)', 'Facebook'],
      ['[Instagram] Sent (8/1/2026)', 'Instagram'],
      ['[Google Message] Sent (7/7/2026)', 'Google Message'],
      ['[Review] Sent (1/2/2026)', 'Review'],
    ])('should classify %s as a message', (title) => {
      expect(classifyNoteActivity(title).activityType).toBe('message');
    });

    it('should prefer the more specific Facebook Ad channel', () => {
      const result = classifyNoteActivity('[Facebook Ad] Received (3/1/2026)');

      expect(result.activityType).toBe('message');
      expect(result.displaySummary).toBe('Facebook Ad Received');
    });
  });

  describe('everything else', () => {
    it('should classify an AI history summary', () => {
      expect(classifyNoteActivity('AI History Summary').activityType).toBe(
        'aiSummary',
      );
    });

    it('should fall back to a note and keep the title as the summary', () => {
      const result = classifyNoteActivity('Prep notes before the shoot');

      expect(result.activityType).toBe('note');
      expect(result.displaySummary).toBe('Prep notes before the shoot');
    });

    it('should fall back to a note for an unrecognised emoji title', () => {
      expect(classifyNoteActivity('🎉 Booked the studio').activityType).toBe(
        'note',
      );
    });

    it.each([null, undefined, ''])(
      'should fall back to Untitled for %s',
      (title) => {
        const result = classifyNoteActivity(title);

        expect(result.activityType).toBe('note');
        expect(result.displaySummary).toBe('Untitled');
      },
    );
  });
});
