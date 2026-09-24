import * as React from 'react';

export interface ComposerProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  onChange?: (next: string) => void;
  onSend?: () => void;
  placeholder?: string;
  /** Saved snippets ("respostas rápidas") shown as a scrollable chip row. */
  quickReplies?: string[];
  /** Draft proposed by the agente de IA; clicking "Usar" drops it into the field. */
  aiSuggestion?: string;
  disabled?: boolean;
}

export function Composer(props: ComposerProps): JSX.Element;
