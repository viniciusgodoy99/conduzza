import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Two-to-four mutually exclusive views. Sunken track, white selected pill. */
export function SegmentedControl({ options = [], value, onChange, size = 'md', block = false, style, ...rest }) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const h = size === 'sm' ? 28 : 34;
  return (
    <div role="tablist" style={{
      display: block ? 'flex' : 'inline-flex', width: block ? '100%' : undefined,
      padding: 3, gap: 2, background: 'var(--surface-sunken)',
      borderRadius: 'var(--radius-control)', ...style,
    }} {...rest}>
      {items.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange && onChange(o.value)}
            style={{
              flex: block ? 1 : undefined, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              height: h, padding: '0 12px', border: 'none', borderRadius: 7,
              background: on ? 'var(--surface)' : 'transparent',
              boxShadow: on ? 'var(--shadow-xs)' : 'none',
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              fontSize: size === 'sm' ? 12 : 13, fontWeight: 'var(--fw-semibold)',
              cursor: 'pointer', transition: 'var(--transition-control)', whiteSpace: 'nowrap',
            }}>
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
            {o.count != null && <span className="cz-num" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
