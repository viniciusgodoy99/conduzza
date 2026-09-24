import * as React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide icon name. */
  icon: string;
  /** Required accessible label; also used as the tooltip title. */
  label: string;
  variant?: 'primary' | 'solid' | 'secondary' | 'ghost' | 'soft' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Circular instead of squircle — used in the chat composer. */
  round?: boolean;
  active?: boolean;
  /** Small lime count bubble on the top-right corner. */
  badge?: number | string;
}

export function IconButton(props: IconButtonProps): JSX.Element;
