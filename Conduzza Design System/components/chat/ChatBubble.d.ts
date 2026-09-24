import * as React from 'react';

/**
 * A single message in the Atendimento thread.
 */
export interface ChatBubbleProps extends React.HTMLAttributes<HTMLDivElement> {
  /** in = patient (white, left), out = attendant (lime, right), ai = agente de IA (inky, right). */
  from?: 'in' | 'out' | 'ai';
  /** Small name line above the bubble — attendant or AI agent. */
  author?: string;
  /** "14:32" — always 24h, pt-BR. */
  time?: string;
  /** Delivery state, outbound only. */
  status?: 'pending' | 'sent' | 'read';
  /** File/audio chip rendered above the text. */
  attachment?: { name: string; icon?: string };
  /** Internal note — amber, never sent to the patient. */
  note?: boolean;
}

export function ChatBubble(props: ChatBubbleProps): JSX.Element;
