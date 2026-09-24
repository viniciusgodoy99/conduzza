import React from 'react';

/** Vertical bar series — the only chart primitive in the kit. CSS only, no library. */
export function BarChart({ data = [], height = 160, tone = 'lime', valueFormat, style, ...rest }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fills = { lime: 'var(--cz-lime-400)', ink: 'var(--cz-ink-900)', duo: null };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }} {...rest}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height, padding: '0 2px', borderBottom: '1px solid var(--border-hairline)' }}>
        {data.map((d, i) => (
          <div key={d.label + i} title={`${d.label}: ${d.value}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 5, height: '100%' }}>
            <span className="cz-num" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{valueFormat ? valueFormat(d.value) : d.value}</span>
            <div style={{
              width: '100%', height: `${(d.value / max) * 100}%`, minHeight: 3,
              borderRadius: '6px 6px 2px 2px',
              background: d.highlight ? 'var(--cz-ink-900)' : (fills[tone] || fills.lime),
              transition: 'height var(--dur-slow) var(--ease-out)',
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '0 2px' }}>
        {data.map((d, i) => (
          <span key={d.label + i} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden' }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
