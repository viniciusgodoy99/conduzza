import React from 'react';
import { Icon } from './Icon.jsx';

/** Headline metric tile used across Início and Resultados. */
export function StatCard({ label, value, unit, delta, deltaDirection, icon, accent = false, footnote, style, ...rest }) {
  const up = deltaDirection === 'up';
  const good = delta != null && (up ? 'var(--cz-success-700)' : 'var(--cz-danger-700)');
  return (
    <div style={{
      background: accent ? 'var(--cz-lime-400)' : 'var(--surface)',
      border: `1px solid ${accent ? 'transparent' : 'var(--border-hairline)'}`,
      borderRadius: 'var(--radius-card)', boxShadow: accent ? 'var(--shadow-accent)' : 'var(--shadow-sm)',
      padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, ...style,
    }} {...rest}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="cz-eyebrow" style={{ color: accent ? 'rgba(5,24,19,.62)' : 'var(--text-muted)' }}>{label}</span>
        {icon && <Icon name={icon} size={16} color={accent ? 'rgba(5,24,19,.55)' : 'var(--cz-ink-400)'} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span className="cz-num" style={{ fontSize: 'var(--text-metric-lg)', fontWeight: 600, color: accent ? 'var(--cz-ink-900)' : 'var(--text-strong)', lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: accent ? 'rgba(5,24,19,.6)' : 'var(--text-muted)', fontWeight: 600 }}>{unit}</span>}
        {delta != null && (
          <span className="cz-num" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 600, color: accent ? 'rgba(5,24,19,.7)' : good }}>
            <Icon name={up ? 'trending-up' : 'trending-down'} size={13} />{delta}
          </span>
        )}
      </div>
      {footnote && <span style={{ fontSize: 12, color: accent ? 'rgba(5,24,19,.62)' : 'var(--text-muted)' }}>{footnote}</span>}
    </div>
  );
}
