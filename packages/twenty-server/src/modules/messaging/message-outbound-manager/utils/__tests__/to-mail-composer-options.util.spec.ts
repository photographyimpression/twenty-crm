import { toMailComposerOptions } from 'src/modules/messaging/message-outbound-manager/utils/to-mail-composer-options.util';

const baseInput = {
  to: 'lead@example.com',
  subject: 'Campaign',
  body: 'plain',
  html: '<p>hi</p>',
};

describe('toMailComposerOptions', () => {
  it('should map an inline image to nodemailer cid + inline disposition', () => {
    const options = toMailComposerOptions('me@example.com', {
      ...baseInput,
      html: '<img src="cid:img-abc" />',
      attachments: [
        {
          filename: 'logo.png',
          content: Buffer.from('x'),
          contentType: 'image/png',
          contentId: 'img-abc',
          isInline: true,
        },
      ],
    });

    expect(options.attachments?.[0]).toMatchObject({
      filename: 'logo.png',
      contentType: 'image/png',
      cid: 'img-abc',
      contentDisposition: 'inline',
    });
  });

  it('should leave regular file attachments without cid (not inline)', () => {
    const options = toMailComposerOptions('me@example.com', {
      ...baseInput,
      attachments: [
        {
          filename: 'quote.pdf',
          content: Buffer.from('x'),
          contentType: 'application/pdf',
        },
      ],
    });

    expect(options.attachments?.[0]).not.toHaveProperty('cid');
    expect(options.attachments?.[0]).not.toHaveProperty('contentDisposition');
  });

  it('should omit attachments entirely when there are none', () => {
    const options = toMailComposerOptions('me@example.com', baseInput);

    expect(options).not.toHaveProperty('attachments');
  });
});
