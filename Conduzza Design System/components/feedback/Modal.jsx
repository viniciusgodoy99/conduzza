import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Centred dialog with scrim. Body scrolls; header and footer stay put. */
export function Modal({ open = true, title, description, children, footer, onClose, width = 480, style, ...rest }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center',
      background: 'var(--overlay-scrim)', backdropFilter: 'blur(3px)', padding: 24,
      animation: 'cz-fade var(--dur-base) var(--ease-out)',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: width, maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden', animation: 'cz-rise var(--dur-base) var(--ease-out)', ...style,
      }} {...rest}>
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 20px 14px' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h2 style={{ fontSize: 'var(--text-h2)', letterSpacing: 'var(--ls-h2)' }}>{title}</h2>
            {description && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{description}</p>}
          </div>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Fechar" style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <Icon name="x" size={17} />
            </button>
          )}
        </header>
        <div className="cz-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 20px 18px' }}>{children}</div>
        {footer && <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border-hairline)', background: 'var(--cz-paper-050)' }}>{footer}</footer>}
      </div>
      <style>{'@keyframes cz-fade{from{opacity:0}to{opacity:1}}@keyframes cz-rise{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}'}</style>
    </div>
  );
}
