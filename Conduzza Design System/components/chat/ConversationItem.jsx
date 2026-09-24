import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { Icon } from '../core/Icon.jsx';

/** One row of the Atendimento inbox list. */
export function ConversationItem({ name, preview, time, unread = 0, active = false, tags = [], channel = 'whatsapp', assignee, aiHandled = false, onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 10, width: '100%', padding: '11px 14px', border: 'none',
        borderLeft: `2px solid ${active ? 'var(--cz-lime-400)' : 'transparent'}`,
        borderBottom: '1px solid var(--border-hairline)', textAlign: 'left', cursor: 'pointer',
        background: active ? 'var(--cz-lime-050)' : hover ? 'var(--cz-paper-050)' : 'var(--surface)',
        transition: 'background-color var(--dur-fast) var(--ease-standard)', ...style,
      }} {...rest}>
      <span style={{ position: 'relative', flex: '0 0 auto' }}>
        <Avatar name={name} size="md" />
        <span style={{ position: 'absolute', right: -2, bottom: -2, width: 14, height: 14, borderRadius: '50%', display: 'grid', placeItems: 'center', background: channel === 'whatsapp' ? 'var(--cz-whatsapp)' : 'var(--cz-meta)', border: '2px solid var(--surface)' }}>
          <Icon name={channel === 'whatsapp' ? 'message-circle' : 'at-sign'} size={7} color="#fff" />
        </span>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span className="cz-num" style={{ fontSize: 10.5, color: 'var(--text-faint)', flex: '0 0 auto' }}>{time}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {aiHandled && <Icon name="sparkles" size={12} color="var(--cz-lime-700)" />}
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</span>
          {unread > 0 && <span className="cz-num" style={{ flex: '0 0 auto', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 'var(--radius-pill)', background: 'var(--cz-lime-400)', color: 'var(--cz-ink-900)', fontSize: 10.5, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{unread}</span>}
        </span>
        {(tags.length > 0 || assignee) && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 1 }}>
            {tags.map((t) => (
              <span key={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 17, padding: '0 6px', borderRadius: 4, background: 'var(--surface-sunken)', fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 'var(--fw-medium)' }}>
                <span style={{ width: 5, height: 5, borderRadius: 1.5, background: t.color }} />{t.label}
              </span>
            ))}
            {assignee && <span style={{ fontSize: 10.5, color: 'var(--text-faint)', marginLeft: 'auto' }}>{assignee}</span>}
          </span>
        )}
      </span>
    </button>
  );
}
