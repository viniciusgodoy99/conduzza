import * as React from 'react';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Full name — drives the initials and the deterministic tint. */
  name?: string;
  /** Photo URL; when present the initials are hidden. */
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Presence dot for attendants. */
  status?: 'online' | 'busy' | 'offline';
  /** Squircle instead of circle — used for clinic/unit avatars. */
  square?: boolean;
}

export function Avatar(props: AvatarProps): JSX.Element;
