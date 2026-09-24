import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Native select wearing the Conduzza control shell. */
export function Select({ label, hint, error, options = [], size = 'md', block = true, style, wrapStyle, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const bd = error ? 'var(--cz-danger-500)' : focus ? 'var(--cz-lime-500)' : 'var(--border-subtle)';
  return (
    <label style={{ display: block ? 'flex' : 'inline-flex', flexDirection: 'column', gap: 6, width: block ? '100%' : undefined, ...wrapStyle }}>
      {label && <span style={{ fontSize: 'var(--text-label)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-body)' }}>{label}</span>}
      <span style={{
        position: 'relative', display: 'flex', alignItems: 'center',
        height: size === 'sm' ? 'var(--control-h-sm)' : 'var(--control-h-md)',
        background: 'var(--surface)', border: `1px solid ${bd}`, borderRadius: 'var(--radius-control)',
        boxShadow: focus ? 'var(--focus-ring)' : 'var(--shadow-xs)', transition: 'var(--transition-control)',
      }}>
        <select
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{ appearance: 'none', width: '100%', height: '100%', border: 'none', outline: 'none', background: 'transparent', padding: '0 32px 0 12px', fontSize: size === 'sm' ? 13 : 14, color: 'var(--text-strong)', cursor: 'pointer', ...style }}
          {...rest}
        >
          {options.map((o) => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o;
            return <option key={opt.value} value={opt.value}>{opt.label}</option>;
          })}
        </select>
        <Icon name="chevron-down" size={15} color="var(--cz-ink-400)" style={{ position: 'absolute', right: 10, pointerEvents: 'none' }} />
      </span>
      {(hint || error) && <span style={{ fontSize: 'var(--text-caption)', color: error ? 'var(--cz-danger-700)' : 'var(--text-muted)' }}>{error || hint}</span>}
    </label>
  );
}
