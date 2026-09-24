import * as React from 'react';

export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}

export function Switch(props: SwitchProps): JSX.Element;
