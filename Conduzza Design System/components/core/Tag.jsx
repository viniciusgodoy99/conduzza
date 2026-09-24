import React from 'react';
import { Icon } from './Icon.jsx';

/** User-assigned label (etiqueta). Colour comes from the tag itself, not a tone scale. */
export function Tag({ color = '#b2e54f', children, onRemove, size = 'md', style, ...rest }) {
  const sm = size === 'sm';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: sm ? 5 : 6,
      height: sm ? 20 : 24, padding: `0 ${onRemove ? 4 : sm ? 8 : 10}px 0 ${sm ? 8 : 10}px`,
      borderRadius: 'var(--radius-xs)', background: 'var(--surface)',
      border: '1px solid var(--border-subtle)', color: 'var(--text-body)',
      fontSize: sm ? 11 : 12, fontWeight: 'var(--fw-medium)', whiteSpace: 'nowrap', ...style,
    }} {...rest}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flex: '0 0 auto' }} />
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remover etiqueta"
          style={{ display: 'grid', placeItems: 'center', width: 16, height: 16, border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', borderRadius: 4 }}>
          <Icon name="x" size={11} />
        </button>
      )}
    </span>
  );
}
