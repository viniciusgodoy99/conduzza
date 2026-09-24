import React from 'react';

/** Conic-gradient ring for share-of-total figures. CSS only. */
export function DonutChart({ segments = [], size = 132, thickness = 16, centerLabel, centerValue, style, ...rest }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0;
  const stops = segments.map((s) => {
    const from = (acc / total) * 100; acc += s.value;
    return `${s.color} ${from}% ${(acc / total) * 100}%`;
  }).join(',');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', ...style }} {...rest}>
      <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: `conic-gradient(${stops})`, mask: `radial-gradient(circle, transparent ${size / 2 - thickness}px, #000 ${size / 2 - thickness + 1}px)`, WebkitMask: `radial-gradient(circle, transparent ${size / 2 - thickness}px, #000 ${size / 2 - thickness + 1}px)` }} />
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div className="cz-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-strong)' }}>{centerValue}</div>
            {centerLabel && <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{centerLabel}</div>}
          </div>
        </div>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        {segments.map((s) => (
          <li key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flex: '0 0 auto' }} />
            <span style={{ color: 'var(--text-body)' }}>{s.label}</span>
            <span className="cz-num" style={{ marginLeft: 'auto', color: 'var(--text-muted)', paddingLeft: 12 }}>{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
