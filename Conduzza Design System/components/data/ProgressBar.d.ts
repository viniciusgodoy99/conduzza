import * as React from 'react';

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  tone?: 'lime' | 'ink' | 'success' | 'warning' | 'danger';
  label?: string;
  /** Right-aligned figure, e.g. "128 / 147". */
  caption?: string;
  size?: 'sm' | 'md';
}

export function ProgressBar(props: ProgressBarProps): JSX.Element;
