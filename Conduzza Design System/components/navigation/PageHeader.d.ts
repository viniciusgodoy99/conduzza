import * as React from 'react';

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: React.ReactNode;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}

export function PageHeader(props: PageHeaderProps): JSX.Element;
