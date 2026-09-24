import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Underlined tabs for in-page sections (five or more views). */
export function Tabs({ items = [], value, onChange, style, ...rest }) {
  return (
    <div role="tablist" style={{ display: 'flex', alignItems: 'center', gap: 2, borderBottom: '1px solid var(--border-hairline)', overflowX: 'auto', ...style }} {...rest}>
      {items.map((o) => {
        const it = typeof o === 'string' ? { value: o, label: o } : o;
        const on = it.value === value;
        return (
          <button key={it.value} type="button" role="tab" aria-selected={on} onClick={() => onChange && onChange(it.value)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 12px 11px',
              border: 'none', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap',
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              fontSize: 13.5, fontWeight: on ? 'var(--fw-bold)' : 'var(--fw-medium)',
              boxShadow: on ? 'inset 0 -2px 0 var(--cz-lime-400)' : 'none',
              transition: 'var(--transition-control)',
            }}>
            {it.icon && <Icon name={it.icon} size={15} />}
            {it.label}
            {it.count != null && <span className="cz-num" style={{ fontSize: 11, padding: '1px 6px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
