import React from 'react';
import { Icon } from '../core/Icon.jsx';

const TONES = {
  info:    { bg: 'var(--cz-info-050)', fg: 'var(--cz-info-700)', icon: 'info' },
  success: { bg: 'var(--cz-success-050)', fg: 'var(--cz-success-700)', icon: 'circle-check' },
  warning: { bg: 'var(--cz-warning-050)', fg: 'var(--cz-warning-700)', icon: 'triangle-alert' },
  danger:  { bg: 'var(--cz-danger-050)', fg: 'var(--cz-danger-700)', icon: 'octagon-alert' },
  lime:    { bg: 'var(--cz-lime-050)', fg: 'var(--cz-lime-800)', icon: 'sparkles' },
};

/** Inline, persistent message bound to a region of the page. */
export function Banner({ tone = 'info', title, children, action, onDismiss, icon, style, ...rest }) {
  const t = TONES[tone] || TONES.info;
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 14px',
      background: t.bg, borderRadius: 'var(--radius-md)', color: t.fg, ...style,
    }} {...rest}>
      <Icon name={icon || t.icon} size={17} style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {title && <strong style={{ fontSize: 13.5, fontWeight: 'var(--fw-bold)' }}>{title}</strong>}
        {children && <span style={{ fontSize: 13, opacity: 0.92 }}>{children}</span>}
      </div>
      {action}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dispensar" style={{ border: 'none', background: 'transparent', color: 'inherit', opacity: 0.6, cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center', width: 20, height: 20 }}>
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
