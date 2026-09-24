import * as React from 'react';

export interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'lime';
  title?: string;
  /** Overrides the tone's default Lucide icon. */
  icon?: string;
  /** Usually a small ghost Button. */
  action?: React.ReactNode;
  onDismiss?: () => void;
}

export function Banner(props: BannerProps): JSX.Element;
