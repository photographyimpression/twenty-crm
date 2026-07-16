import { type SendMessageInput } from 'src/modules/messaging/message-outbound-manager/types/send-message-input.type';

export const toMailComposerOptions = (
  from: string,
  sendMessageInput: SendMessageInput,
) => {
  return {
    from,
    to: sendMessageInput.to,
    cc: sendMessageInput.cc,
    bcc: sendMessageInput.bcc,
    subject: sendMessageInput.subject,
    text: sendMessageInput.body,
    html: sendMessageInput.html,
    ...(sendMessageInput.attachments && sendMessageInput.attachments.length > 0
      ? {
          attachments: sendMessageInput.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content,
            contentType: attachment.contentType,
            // Inline images (campaign logos): nodemailer emits Content-ID +
            // Content-Disposition: inline when `cid` is set, which is what
            // makes <img src="cid:..."> resolve in the received mail.
            ...(attachment.contentId
              ? {
                  cid: attachment.contentId,
                  contentDisposition: 'inline' as const,
                }
              : {}),
          })),
        }
      : {}),
  };
};
