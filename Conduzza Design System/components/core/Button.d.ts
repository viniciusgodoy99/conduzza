import * as React from 'react';

/**
 * Primary action button.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = lime, the one committing action per screen. solid = inky, for dark surfaces and destructive-confirm. */
  variant?: 'primary' | 'solid' | 'secondary' | 'ghost' | 'soft' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Lucide icon name rendered before the label. */
  icon?: string;
  /** Lucide icon name rendered after the label (chevrons, arrows). */
  iconRight?: string;
  block?: boolean;
  loading?: boolean;
  /** Holds the hover styling — use for toggled toolbar buttons. */
  active?: boolean;
}

export function Button(props: ButtonProps): JSX.Element;
