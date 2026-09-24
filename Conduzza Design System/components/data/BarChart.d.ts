import * as React from 'react';

export interface BarDatum { label: string; value: number; /** Paints this bar ink instead of lime — use for "today" or the selected period. */ highlight?: boolean }

export interface BarChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data: BarDatum[];
  /** Plot height in px, excluding the axis labels. */
  height?: number;
  tone?: 'lime' | 'ink';
  valueFormat?: (v: number) => string;
}

export function BarChart(props: BarChartProps): JSX.Element;
