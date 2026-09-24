import React from 'react';

const SIZES = { xs: 24, sm: 30, md: 36, lg: 44, xl: 56 };
const PALETTE = ['#b2e54f', '#7fb320', '#4785b5', '#d9962a', '#2f9e5b', '#8b9a92'];

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Contact avatar. Falls back to initials on a deterministic brand-palette tint. */
export function Avatar({ name = '', src, size = 'md', status, square = false, style, ...rest }) {
  const d = SIZES[size] || SIZES.md;
  const seed = String(name).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const tint = PALETTE[seed % PALETTE.length];
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flex: '0 0 auto', ...style }} {...rest}>
      <span style={{
        width: d, height: d, borderRadius: square ? 'var(--radius-md)' : '50%',
        background: src ? `center/cover url(${src})` : `color-mix(in oklab, ${tint} 26%, var(--cz-paper-050))`,
        color: 'var(--cz-ink-900)', display: 'grid', placeItems: 'center', overflow: 'hidden',
        fontSize: Math.round(d * 0.36), fontWeight: 'var(--fw-bold)', letterSpacing: '-0.02em',
        boxShadow: 'inset 0 0 0 1px var(--border-hairline)',
      }}>{src ? '' : initials(name)}</span>
      {status && (
        <span style={{
          position: 'absolute', right: -1, bottom: -1, width: Math.max(8, d * 0.28), height: Math.max(8, d * 0.28),
          borderRadius: '50%', border: '2px solid var(--surface)',
          background: status === 'online' ? 'var(--cz-success-500)' : status === 'busy' ? 'var(--cz-warning-500)' : 'var(--cz-ink-300)',
        }} />
      )}
    </span>
  );
}
