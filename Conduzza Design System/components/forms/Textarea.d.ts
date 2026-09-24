import * as React from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Max-length figure shown as "n/max" on the right of the hint row. */
  counter?: number;
  block?: boolean;
  wrapStyle?: React.CSSProperties;
}

export function Textarea(props: TextareaProps): JSX.Element;
