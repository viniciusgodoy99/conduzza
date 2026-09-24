import * as React from 'react';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Uppercase eyebrow, e.g. "CONSULTAS CONFIRMADAS". */
  label: string;
  /** The figure itself — already formatted (pt-BR: 1.248, 62,4%). */
  value: string | number;
  /** Trailing unit or qualifier, e.g. "hoje", "%". */
  unit?: string;
  /** Period-over-period change, e.g. "+12,4%". */
  delta?: string;
  deltaDirection?: 'up' | 'down';
  icon?: string;
  /** Lime fill — at most one per row of tiles. */
  accent?: boolean;
  footnote?: string;
}

export function StatCard(props: StatCardProps): JSX.Element;
