import * as React from 'react';

export interface SegmentOption { value: string; label: string; icon?: string; count?: number }

export interface SegmentedControlProps {
  options: Array<string | SegmentOption>;
  value?: string;
  onChange?: (next: string) => void;
  size?: 'sm' | 'md';
  block?: boolean;
  style?: React.CSSProperties;
}

export function SegmentedControl(props: SegmentedControlProps): JSX.Element;
