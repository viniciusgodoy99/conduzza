import * as React from 'react';

export interface TopBarProps extends React.HTMLAttributes<HTMLElement> {
  title: React.ReactNode;
  subtitle?: string;
  /** Uppercase context line above the title, e.g. "CLÍNICA VITTA · UNIDADE CENTRO". */
  breadcrumb?: string;
  /** Right-aligned tools: search, notifications, avatar. */
  children?: React.ReactNode;
}

export function TopBar(props: TopBarProps): JSX.Element;
