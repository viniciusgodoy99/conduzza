import * as React from 'react';

export interface SelectOption { value: string; label: string }

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  /** Strings or {value,label} pairs. */
  options?: Array<string | SelectOption>;
  size?: 'sm' | 'md';
  block?: boolean;
  wrapStyle?: React.CSSProperties;
}

export function Select(props: SelectProps): JSX.Element;
