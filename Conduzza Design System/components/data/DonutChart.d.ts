import * as React from 'react';

export interface DonutSegment { label: string; value: number; /** Any CSS colour — pull from the brand ramp. */ color: string }

export interface DonutChartProps extends React.HTMLAttributes<HTMLDivElement> {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerValue?: React.ReactNode;
  centerLabel?: string;
}

export function DonutChart(props: DonutChartProps): JSX.Element;
