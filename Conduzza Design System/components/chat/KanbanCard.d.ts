import * as React from 'react';

export interface KanbanTag { label: string; color: string }

export interface KanbanCardProps extends React.HTMLAttributes<HTMLElement> {
  name: string;
  /** Formatted pt-BR phone, e.g. "(11) 98812-4409". */
  phone?: string;
  /** One-line context: procedure of interest, source, last touch. */
  meta?: string;
  tags?: KanbanTag[];
  /** Attendant who owns the lead. */
  owner?: string;
  /** Estimated ticket, e.g. "R$ 1.200". */
  value?: string;
  /** Time in the current stage, e.g. "2d 4h". */
  waiting?: string;
  /** Red hairline + flame — the lead is past its SLA. */
  urgent?: boolean;
}

export function KanbanCard(props: KanbanCardProps): JSX.Element;
