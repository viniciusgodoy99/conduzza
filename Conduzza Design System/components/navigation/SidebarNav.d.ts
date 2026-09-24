import * as React from 'react';

export interface SidebarItem {
  id?: string;
  label?: string;
  /** Lucide icon name. */
  icon?: string;
  /** Unread/pending count pill on the right. */
  count?: number;
  /** Renders an uppercase group heading instead of a link. */
  section?: string;
}

/**
 * The product's left navigation rail.
 */
export interface SidebarNavProps extends React.HTMLAttributes<HTMLElement> {
  items: SidebarItem[];
  /** id of the current page. */
  active?: string;
  onNavigate?: (id: string) => void;
  collapsed?: boolean;
  /** Logo lockup slot at the top. */
  brand?: React.ReactNode;
  /** User/account block pinned to the bottom. */
  footer?: React.ReactNode;
}

export function SidebarNav(props: SidebarNavProps): JSX.Element;
