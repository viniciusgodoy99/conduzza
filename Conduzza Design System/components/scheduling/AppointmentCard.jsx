import React from 'react';
import { Icon } from '../core/Icon.jsx';

const STATUS = {
  confirmado: { bar: 'var(--cz-success-500)', bg: 'var(--cz-success-050)', fg: 'var(--cz-success-700)', label: 'Confirmado', icon: 'check' },
  aguardando: { bar: 'var(--cz-warning-500)', bg: 'var(--cz-warning-050)', fg: 'var(--cz-warning-700)', label: 'Aguardando', icon: 'clock' },
  cancelado:  { bar: 'var(--cz-danger-500)', bg: 'var(--cz-danger-050)', fg: 'var(--cz-danger-700)', label: 'Cancelado', icon: 'x' },
  encaixe:    { bar: 'var(--cz-lime-500)', bg: 'var(--cz-lime-050)', fg: 'var(--cz-lime-800)', label: 'Encaixe', icon: 'zap' },
  bloqueio:   { bar: 'var(--cz-ink-400)', bg: 'var(--cz-ink-050)', fg: 'var(--cz-ink-600)', label: 'Bloqueio', icon: 'ban' },
};

/** A booking on the Agenda grid. Left status bar, patient, procedure, time. */
export function AppointmentCard({ patient, procedure, start, end, status = 'aguardando', professional, room, compact = false, onClick, style, ...rest }) {
  const s = STATUS[status] || STATUS.aguardando;
  const [hover, setHover] = React.useState(false);
  return (
    <article onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 0, overflow: 'hidden', cursor: 'pointer',
        background: s.bg, borderRadius: 'var(--radius-sm)',
        boxShadow: hover ? 'var(--shadow-sm)' : 'none',
        transition: 'box-shadow var(--dur-fast) var(--ease-standard)', ...style,
      }} {...rest}>
      <span style={{ width: 3, flex: '0 0 auto', background: s.bar }} />
      <div style={{ flex: 1, minWidth: 0, padding: compact ? '4px 7px' : '7px 9px', display: 'flex', flexDirection: 'column', gap: compact ? 1 : 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="cz-num" style={{ fontSize: 10.5, color: s.fg, fontWeight: 600 }}>{start}{end ? `–${end}` : ''}</span>
          <Icon name={s.icon} size={10} color={s.fg} />
        </div>
        <span style={{ fontSize: compact ? 11.5 : 12.5, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{patient}</span>
        {!compact && procedure && <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{procedure}</span>}
        {!compact && (professional || room) && (
          <span style={{ fontSize: 10.5, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[professional, room].filter(Boolean).join(' · ')}</span>
        )}
      </div>
    </article>
  );
}
