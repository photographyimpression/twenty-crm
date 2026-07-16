import { type MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';

export type Message = Omit<
  MessageWorkspaceEntity,
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'messageChannelMessageAssociations'
  | 'messageParticipants'
  | 'messageThread'
  | 'messageThreadId'
  | 'messageFolders'
  | 'id'
> & {
  attachments: {
    filename: string;
  }[];
  externalId: string;
  messageThreadExternalId: string;
  direction: MessageDirection;
  messageFolderIds?: string[];
  messageFolderExternalIds?: string[];
  labelIds?: string[];
};

export type MessageAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  // Inline (embedded) images: set both to reference the attachment from the
  // HTML body as <img src="cid:contentId">. Outlook blocks remote-linked
  // images, so campaign logos are embedded this way instead of linked.
  contentId?: string;
  isInline?: boolean;
};

export type MessageParticipant = Omit<
  MessageParticipantWorkspaceEntity,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'personId'
  | 'workspaceMemberId'
  | 'person'
  | 'workspaceMember'
  | 'message'
  | 'messageId'
>;

export type MessageWithParticipants = Message & {
  participants: MessageParticipant[];
};
