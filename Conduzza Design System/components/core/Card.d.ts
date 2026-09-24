import * as React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** Inner padding in px. 16 default, 20 for feature panels, 0 for tables. */
  padding?: number;
  tone?: 'default' | 'sunken' | 'accent' | 'inverse';
  /** Adds hover lift + pointer; use for cards that navigate. */
  interactive?: boolean;
  /** Title row; renders a divided header band. */
  header?: React.ReactNode;
  /** Right-aligned controls inside the header band. */
  actions?: React.ReactNode;
}

export function Card(props: CardProps): JSX.Element;
