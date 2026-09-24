import React from 'react';

/** The universal surface: white, 16px radius, hairline border, low soft shadow. */
export function Card({ children, padding = 16, tone = 'default', interactive = false, header, actions, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const tones = {
    default: { bg: 'var(--surface)', bd: 'var(--border-hairline)' },
    sunken:  { bg: 'var(--surface-sunken)', bd: 'transparent' },
    accent:  { bg: 'var(--cz-lime-050)', bd: 'rgba(127,179,32,.22)' },
    inverse: { bg: 'var(--cz-ink-900)', bd: 'rgba(251,252,232,.10)' },
  };
  const t = tones[tone] || tones.default;
  return (
    <section
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={tone === 'inverse' ? 'cz-dark' : undefined}
      style={{
        background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 'var(--radius-card)',
        boxShadow: interactive && hover ? 'var(--shadow-md)' : tone === 'sunken' ? 'none' : 'var(--shadow-sm)',
        transform: interactive && hover ? 'translateY(-1px)' : 'none',
        transition: 'box-shadow var(--dur-base) var(--ease-standard),transform var(--dur-base) var(--ease-standard)',
        cursor: interactive ? 'pointer' : undefined, overflow: 'hidden', ...style,
      }}
      {...rest}
    >
      {(header || actions) && (
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: `14px ${padding}px`, borderBottom: '1px solid var(--border-hairline)' }}>
          <h3 style={{ fontSize: 'var(--text-h3)', fontWeight: 'var(--fw-bold)', letterSpacing: 'var(--ls-h3)' }}>{header}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{actions}</div>
        </header>
      )}
      <div style={{ padding }}>{children}</div>
    </section>
  );
}
