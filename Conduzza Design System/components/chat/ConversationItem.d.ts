import * as React from 'react';

export interface ConversationTag { label: string; color: string }

export interface ConversationItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  name: string;
  /** Last message, truncated to one line. */
  preview?: string;
  /** "14:32" or "ontem". */
  time?: string;
  unread?: number;
  active?: boolean;
  tags?: ConversationTag[];
  channel?: 'whatsapp' | 'instagram' | 'meta';
  /** Attendant currently holding the conversation. */
  assignee?: string;
  /** Shows the lime sparkle — the AI agent is answering this thread. */
  aiHandled?: boolean;
}

export function ConversationItem(props: ConversationItemProps): JSX.Element;
