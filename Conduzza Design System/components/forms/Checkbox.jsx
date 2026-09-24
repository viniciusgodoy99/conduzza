import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Checkbox with the lime fill. Also does the indeterminate table-header state. */
export function Checkbox({ checked = false, indeterminate = false, label, description, disabled = false, onChange, style, ...rest }) {
  const on = checked || indeterminate;
  return (
    <label style={{ display: 'inline-flex', alignItems: description ? 'flex-start' : 'center', gap: 9, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, ...style }} {...rest}>
      <span
        role="checkbox" aria-checked={indeterminate ? 'mixed' : checked} tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && onChange && onChange(!checked)}
        onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange && onChange(!checked); } }}
        style={{
          width: 17, height: 17, flex: '0 0 auto', marginTop: description ? 2 : 0,
          borderRadius: 5, display: 'grid', placeItems: 'center',
          background: on ? 'var(--cz-lime-400)' : 'var(--surface)',
          border: `1px solid ${on ? 'var(--cz-lime-500)' : 'var(--border-strong)'}`,
          transition: 'var(--transition-control)',
        }}
      >
        {on && <Icon name={indeterminate ? 'minus' : 'check'} size={12} color="var(--cz-ink-900)" />}
      </span>
      {(label || description) && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {label && <span style={{ fontSize: 13, color: 'var(--text-body)', fontWeight: 'var(--fw-medium)' }}>{label}</span>}
          {description && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{description}</span>}
        </span>
      )}
    </label>
  );
}
