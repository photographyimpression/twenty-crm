type EmailAddress = string | string[];

export type SendMessageInput = {
  body: string;
  subject: string;
  to: EmailAddress;
  cc?: EmailAddress;
  bcc?: EmailAddress;
  html: string;
  attachments?: {
    filename: string;
    content: Buffer;
    contentType: string;
    // Inline (embedded) images referenced from `html` as <img src="cid:...">.
    // Used for campaign logos, which Outlook blocks when remote-linked.
    contentId?: string;
    isInline?: boolean;
  }[];
};
