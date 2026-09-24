import * as React from 'react';

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Keyboard hint chip on the right, e.g. "⌘K". */
  shortcut?: string;
  size?: 'sm' | 'md';
}

export function SearchField(props: SearchFieldProps): JSX.Element;
