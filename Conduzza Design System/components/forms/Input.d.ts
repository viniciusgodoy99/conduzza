import * as React from 'react';

/**
 * Text input.
 */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  /** Helper line under the field. */
  hint?: string;
  /** Error message; replaces the hint and turns the border red. */
  error?: string;
  /** Leading Lucide icon name. */
  icon?: string;
  /** Trailing static text, e.g. "min", "R$". */
  suffix?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  wrapStyle?: React.CSSProperties;
}

export function Input(props: InputProps): JSX.Element;
