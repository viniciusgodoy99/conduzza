import React from 'react';
import { Icon } from '../core/Icon.jsx';

const ICONS = { success: 'circle-check', danger: 'octagon-alert', info: 'info', warning: 'triangle-alert' };

/** Transient confirmation, bottom-right. Dark ground so it reads over any page. */
export function Toast({ tone = 'success', title, description, action, onDismiss, style, ...rest }) {
  return (
    <div role="status" className="cz-dark" style={{
      display: 'flex', alignItems: 'flex-start', gap: 11, minWidth: 280, maxWidth: 400,
      padding: '12px 14px', background: 'var(--cz-ink-900)', borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-pop)', color: 'var(--cz-cream-050)',
      animation: 'cz-toast var(--dur-slow) var(--ease-out)', ...style,
    }} {...rest}>
      <Icon name={ICONS[tone] || ICONS.info} size={17} color={tone === 'danger' ? '#f2a08c' : 'var(--cz-lime-400)'} style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <strong style={{ fontSize: 13.5, fontWeight: 'var(--fw-bold)' }}>{title}</strong>
        {description && <span style={{ fontSize: 12.5, color: 'rgba(251,252,232,.66)' }}>{description}</span>}
      </div>
      {action}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Fechar" style={{ border: 'none', background: 'transparent', color: 'rgba(251,252,232,.5)', cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center', width: 20, height: 20 }}>
          <Icon name="x" size={14} />
        </button>
      )}
      <style>{'@keyframes cz-toast{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}'}</style>
    </div>
  );
}
