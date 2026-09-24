import * as React from 'react';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Hex of the user-chosen etiqueta colour; rendered as a 7px square chip. */
  color?: string;
  size?: 'sm' | 'md';
  /** Renders a remove affordance when provided. */
  onRemove?: () => void;
}

export function Tag(props: TagProps): JSX.Element;
