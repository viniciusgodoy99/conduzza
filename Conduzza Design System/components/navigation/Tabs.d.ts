import * as React from 'react';

export interface TabItem { value: string; label: string; icon?: string; count?: number }

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  items: Array<string | TabItem>;
  value?: string;
  onChange?: (next: string) => void;
}

export function Tabs(props: TabsProps): JSX.Element;
