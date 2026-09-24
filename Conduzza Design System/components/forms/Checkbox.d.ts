import * as React from 'react';

export interface CheckboxProps {
  checked?: boolean;
  /** Mixed state for "select all" table headers. */
  indeterminate?: boolean;
  label?: string;
  /** Second line under the label, for settings rows. */
  description?: string;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  style?: React.CSSProperties;
}

export function Checkbox(props: CheckboxProps): JSX.Element;
