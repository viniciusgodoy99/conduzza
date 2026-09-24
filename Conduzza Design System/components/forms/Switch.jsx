import React from 'react';

/** On/off toggle. Every automation and permission row uses this. */
export function Switch({ checked = false, onChange, label, description, disabled = false, size = 'md', style, ...rest }) {
  const w = size === 'sm' ? 32 : 40, h = size === 'sm' ? 18 : 22, k = h - 6;
  return (
    <label style={{ display: 'inline-flex', alignItems: description ? 'flex-start' : 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, ...style }} {...rest}>
      <span
        role="switch" aria-checked={checked} tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && onChange && onChange(!checked)}
        onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange && onChange(!checked); } }}
        style={{
          position: 'relative', width: w, height: h, flex: '0 0 auto', marginTop: description ? 1 : 0,
          borderRadius: 'var(--radius-pill)', background: checked ? 'var(--cz-lime-400)' : 'var(--cz-ink-200)',
          transition: 'background-color var(--dur-base) var(--ease-standard)',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? w - k - 3 : 3, width: k, height: k,
          borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(5,24,19,.25)',
          transition: 'left var(--dur-base) var(--ease-out)',
        }} />
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
