import * as React from 'react';

/**
 * Centred dialog.
 */
export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  title: React.ReactNode;
  description?: string;
  /** Right-aligned action row; put the single primary Button last. */
  footer?: React.ReactNode;
  onClose?: () => void;
  /** Max width in px. 420 confirm, 480 default, 640 forms, 820 record detail. */
  width?: number;
}

export function Modal(props: ModalProps): JSX.Element | null;
