import * as React from 'react';

/**
 * A booking block on the Agenda grid.
 */
export interface AppointmentCardProps extends React.HTMLAttributes<HTMLElement> {
  patient: string;
  procedure?: string;
  /** 24h start time, e.g. "09:30". */
  start: string;
  end?: string;
  status?: 'confirmado' | 'aguardando' | 'cancelado' | 'encaixe' | 'bloqueio';
  professional?: string;
  /** Consulting room / unit, e.g. "Sala 2". */
  room?: string;
  /** Drops the secondary lines — use for 15-minute slots. */
  compact?: boolean;
}

export function AppointmentCard(props: AppointmentCardProps): JSX.Element;
