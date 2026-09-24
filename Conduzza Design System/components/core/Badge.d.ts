import * as React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'lime' | 'success' | 'warning' | 'danger' | 'info' | 'inverse';
  size?: 'sm' | 'md';
  /** Leading status dot — use for live/connection states. */
  dot?: boolean;
  /** Lucide icon name rendered before the label. */
  icon?: string;
}

export function Badge(props: BadgeProps): JSX.Element;
