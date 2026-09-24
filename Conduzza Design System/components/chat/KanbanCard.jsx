import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { Icon } from '../core/Icon.jsx';

/** Draggable card in the Leads board. Compact by design — four facts, no more. */
export function KanbanCard({ name, phone, meta, tags = [], owner, value, waiting, urgent = false, onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <article onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, padding: 11,
        background: 'var(--surface)', borderRadius: 'var(--radius-md)',
        border: `1px solid ${urgent ? 'rgba(212,85,61,.35)' : 'var(--border-hairline)'}`,
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-xs)',
        transform: hover ? 'translateY(-1px)' : 'none', cursor: 'grab',
        transition: 'box-shadow var(--dur-fast) var(--ease-standard),transform var(--dur-fast) var(--ease-standard)', ...style,
      }} {...rest}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar name={name} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          {phone && <div className="cz-num" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{phone}</div>}
        </div>
        {urgent && <Icon name="flame" size={14} color="var(--cz-danger-500)" />}
      </div>
      {meta && <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{meta}</p>}
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tags.map((t) => (
            <span key={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, padding: '0 6px', borderRadius: 4, background: 'var(--surface-sunken)', fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 'var(--fw-medium)' }}>
              <span style={{ width: 5, height: 5, borderRadius: 1.5, background: t.color }} />{t.label}
            </span>
          ))}
        </div>
      )}
      {(owner || value || waiting) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 7, borderTop: '1px solid var(--border-hairline)' }}>
          {owner && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{owner}</span>}
          {waiting && <span className="cz-num" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-faint)' }}><Icon name="clock" size={11} />{waiting}</span>}
          {value && <span className="cz-num" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--cz-lime-700)' }}>{value}</span>}
        </div>
      )}
    </article>
  );
}
