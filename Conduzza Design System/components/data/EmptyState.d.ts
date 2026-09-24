import * as React from 'react';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: string;
  title: string;
  description?: string;
  /** Usually a single <Button>. */
  action?: React.ReactNode;
  /** Smaller variant for empty columns and panels. */
  compact?: boolean;
}

export function EmptyState(props: EmptyStateProps): JSX.Element;
