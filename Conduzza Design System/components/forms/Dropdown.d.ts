import * as React from 'react';

export interface DropdownItem {
  label?: string;
  value?: string;
  icon?: string;
  shortcut?: string;
  checked?: boolean;
  danger?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

export interface DropdownProps {
  /** Usually a <Button> or <IconButton>. */
  trigger: React.ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  width?: number;
  onSelect?: (value: string) => void;
  style?: React.CSSProperties;
}

export function Dropdown(props: DropdownProps): JSX.Element;
