import * as React from 'react';

export interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Lucide icon name in kebab-case, e.g. "message-circle", "calendar-check". */
  name?: string;
  /** Rendered square size in px. 14 inline, 18 default, 20 nav, 24 feature. */
  size?: number;
  /** Any CSS colour; defaults to currentColor. */
  color?: string;
  /** Accessible label. Omit for decorative icons. */
  title?: string;
}

/** The only icon primitive. Lucide, 2px stroke, inlined as SVG so it inherits colour. */
export function Icon(props: IconProps): JSX.Element;
