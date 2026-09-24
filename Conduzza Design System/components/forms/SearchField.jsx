import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** The global/contextual search field. Pill-shaped, sunken, no shadow. */
export function SearchField({ placeholder = 'Buscar…', value, onChange, shortcut, size = 'md', style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <span style={{
      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
      height: size === 'sm' ? 'var(--control-h-sm)' : 'var(--control-h-md)',
      padding: '0 10px', borderRadius: 'var(--radius-pill)',
      background: focus ? 'var(--surface)' : 'var(--surface-sunken)',
      border: `1px solid ${focus ? 'var(--cz-lime-500)' : 'transparent'}`,
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      transition: 'var(--transition-control)', ...style,
    }}>
      <Icon name="search" size={15} color="var(--cz-ink-400)" />
      <input
        value={value} onChange={onChange} placeholder={placeholder}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text-strong)' }}
        {...rest}
      />
      {shortcut && (
        <kbd className="cz-num" style={{ fontSize: 10, padding: '2px 5px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-faint)' }}>{shortcut}</kbd>
      )}
    </span>
  );
}
