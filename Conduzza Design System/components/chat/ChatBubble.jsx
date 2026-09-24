import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** A single WhatsApp message. Inbound is white, outbound is lime, AI is inky. */
export function ChatBubble({ from = 'in', author, time, status, children, attachment, note = false, style, ...rest }) {
  const out = from !== 'in';
  const skins = {
    in:    { bg: 'var(--surface)', fg: 'var(--text-body)', bd: 'var(--border-hairline)' },
    out:   { bg: 'var(--cz-lime-100)', fg: 'var(--cz-ink-900)', bd: 'transparent' },
    ai:    { bg: 'var(--cz-ink-900)', fg: 'var(--cz-cream-050)', bd: 'transparent' },
    note:  { bg: 'var(--cz-warning-050)', fg: 'var(--cz-warning-700)', bd: 'rgba(217,150,42,.2)' },
  };
  const s = skins[note ? 'note' : from] || skins.in;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: out ? 'flex-end' : 'flex-start', gap: 3, ...style }} {...rest}>
      {author && <span style={{ fontSize: 10.5, color: 'var(--text-faint)', padding: '0 4px', fontWeight: 'var(--fw-semibold)' }}>{author}</span>}
      <div style={{
        maxWidth: '68%', minWidth: 96, padding: '9px 12px 7px',
        background: s.bg, color: s.fg, border: `1px solid ${s.bd}`,
        borderRadius: 'var(--radius-bubble)',
        borderBottomRightRadius: out ? 6 : undefined, borderBottomLeftRadius: out ? undefined : 6,
        boxShadow: 'var(--shadow-xs)', fontSize: 13.5, lineHeight: 1.5,
      }}>
        {attachment && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: out ? 'rgba(5,24,19,.06)' : 'var(--surface-sunken)' }}>
            <Icon name={attachment.icon || 'paperclip'} size={16} />
            <span style={{ fontSize: 12.5, fontWeight: 'var(--fw-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.name}</span>
          </div>
        )}
        <span style={{ whiteSpace: 'pre-wrap' }}>{children}</span>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3, opacity: 0.55 }}>
          {time && <span className="cz-num" style={{ fontSize: 10 }}>{time}</span>}
          {out && status && <Icon name={status === 'read' ? 'check-check' : status === 'sent' ? 'check' : 'clock'} size={12} color={status === 'read' ? 'var(--cz-lime-700)' : undefined} />}
        </span>
      </div>
    </div>
  );
}
