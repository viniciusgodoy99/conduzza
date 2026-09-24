import React from 'react';

/** Multi-line field for message templates, notes and AI prompts. */
export function Textarea({ label, hint, error, rows = 4, counter, value, block = true, style, wrapStyle, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const bd = error ? 'var(--cz-danger-500)' : focus ? 'var(--cz-lime-500)' : 'var(--border-subtle)';
  return (
    <label style={{ display: block ? 'flex' : 'inline-flex', flexDirection: 'column', gap: 6, width: block ? '100%' : undefined, ...wrapStyle }}>
      {label && <span style={{ fontSize: 'var(--text-label)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-body)' }}>{label}</span>}
      <textarea
        rows={rows} value={value}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          width: '100%', resize: 'vertical', padding: '10px 12px', background: 'var(--surface)',
          border: `1px solid ${bd}`, borderRadius: 'var(--radius-control)', outline: 'none',
          boxShadow: focus ? 'var(--focus-ring)' : 'var(--shadow-xs)', fontSize: 14,
          lineHeight: 'var(--lh-body-md)', color: 'var(--text-strong)',
          transition: 'var(--transition-control)', ...style,
        }}
        {...rest}
      />
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 'var(--text-caption)', color: error ? 'var(--cz-danger-700)' : 'var(--text-muted)' }}>
        <span>{error || hint}</span>
        {counter != null && <span className="cz-num">{String(value || '').length}/{counter}</span>}
      </span>
    </label>
  );
}
