import React from 'react';
import { Icon } from '../core/Icon.jsx';

const H = { sm: 'var(--control-h-sm)', md: 'var(--control-h-md)', lg: 'var(--control-h-lg)' };

/** Text field with optional label, leading icon, suffix and error state. */
export function Input({ label, hint, error, icon, suffix, size = 'md', block = true, style, wrapStyle, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const bd = error ? 'var(--cz-danger-500)' : focus ? 'var(--cz-lime-500)' : 'var(--border-subtle)';
  return (
    <label style={{ display: block ? 'flex' : 'inline-flex', flexDirection: 'column', gap: 6, width: block ? '100%' : undefined, ...wrapStyle }}>
      {label && <span style={{ fontSize: 'var(--text-label)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-body)' }}>{label}</span>}
      <span style={{
        display: 'flex', alignItems: 'center', gap: 8, height: H[size] || H.md,
        padding: '0 12px', background: 'var(--surface)', border: `1px solid ${bd}`,
        borderRadius: 'var(--radius-control)',
        boxShadow: focus ? 'var(--focus-ring)' : 'var(--shadow-xs)',
        transition: 'var(--transition-control)',
      }}>
        {icon && <Icon name={icon} size={15} color="var(--cz-ink-400)" />}
        <input
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: size === 'sm' ? 13 : 14, color: 'var(--text-strong)', ...style }}
          {...rest}
        />
        {suffix && <span style={{ fontSize: 12, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{suffix}</span>}
      </span>
      {(hint || error) && <span style={{ fontSize: 'var(--text-caption)', color: error ? 'var(--cz-danger-700)' : 'var(--text-muted)' }}>{error || hint}</span>}
    </label>
  );
}
