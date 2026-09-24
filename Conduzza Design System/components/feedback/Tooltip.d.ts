import * as React from 'react';

export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
}

export function Tooltip(props: TooltipProps): JSX.Element;
