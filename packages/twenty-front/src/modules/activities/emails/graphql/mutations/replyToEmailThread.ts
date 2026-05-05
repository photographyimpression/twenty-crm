import { gql } from '@apollo/client';

export const REPLY_TO_EMAIL_THREAD = gql`
  mutation ReplyToEmailThread($threadId: UUID!, $body: String!) {
    replyToEmailThread(threadId: $threadId, body: $body)
  }
`;
