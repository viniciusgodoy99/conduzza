import * as React from 'react';

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'success' | 'danger' | 'info' | 'warning';
  title: string;
  description?: string;
  /** Usually a single undo affordance. */
  action?: React.ReactNode;
  onDismiss?: () => void;
}

export function Toast(props: ToastProps): JSX.Element;
