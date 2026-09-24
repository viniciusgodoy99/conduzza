import React from 'react';

/** Thin progress meter for funnel stages, goals and AI resolution rates. */
export function ProgressBar({ value = 0, max = 100, tone = 'lime', label, caption, size = 'md', style, ...rest }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fills = {
    lime: 'var(--cz-lime-400)', ink: 'var(--cz-ink-900)',
    success: 'var(--cz-success-500)', warning: 'var(--cz-warning-500)', danger: 'var(--cz-danger-500)',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', ...style }} {...rest}>
      {(label || caption) && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          {label && <span style={{ fontSize: 12.5, color: 'var(--text-body)', fontWeight: 'var(--fw-medium)' }}>{label}</span>}
          {caption && <span className="cz-num" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{caption}</span>}
        </div>
      )}
      <div style={{ height: size === 'sm' ? 4 : 7, borderRadius: 'var(--radius-pill)', background: 'var(--surface-sunken)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 'var(--radius-pill)', background: fills[tone] || fills.lime, transition: 'width var(--dur-slow) var(--ease-out)' }} />
      </div>
    </div>
  );
}
