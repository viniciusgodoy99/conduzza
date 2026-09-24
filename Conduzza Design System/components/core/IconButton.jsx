import React from 'react';
import { Icon } from './Icon.jsx';

const SIZES = { sm: 28, md: 34, lg: 40 };
const GLYPH = { sm: 15, md: 17, lg: 19 };

const VARIANTS = {
  primary:   { bg: 'var(--cz-lime-400)', fg: 'var(--cz-ink-900)', bd: 'transparent', hover: 'var(--cz-lime-500)' },
  solid:     { bg: 'var(--cz-ink-900)', fg: 'var(--cz-cream-050)', bd: 'transparent', hover: 'var(--cz-ink-800)' },
  secondary: { bg: 'var(--surface)', fg: 'var(--text-body)', bd: 'var(--border-subtle)', hover: 'var(--cz-paper-100)' },
  ghost:     { bg: 'transparent', fg: 'var(--text-muted)', bd: 'transparent', hover: 'var(--cz-ink-050)' },
  soft:      { bg: 'var(--cz-lime-050)', fg: 'var(--cz-lime-800)', bd: 'transparent', hover: 'var(--cz-lime-100)' },
  danger:    { bg: 'transparent', fg: 'var(--cz-danger-500)', bd: 'transparent', hover: 'var(--cz-danger-050)' },
};

/** Icon-only button. Same visual family as Button, square footprint. */
export function IconButton({ icon, label, variant = 'ghost', size = 'md', round = false, active = false, disabled = false, badge, style, onClick, ...rest }) {
  const d = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.ghost;
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  return (
    <button
      type="button" aria-label={label} title={label} disabled={disabled} onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)} onMouseUp={() => setPress(false)}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: d, height: d, flex: '0 0 auto',
        borderRadius: round ? 'var(--radius-pill)' : 'var(--radius-sm)',
        border: `1px solid ${v.bd}`, background: (hover && !disabled) || active ? v.hover : v.bg,
        color: active ? 'var(--text-strong)' : v.fg, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1, transform: press && !disabled ? 'scale(.94)' : 'none',
        transition: 'var(--transition-control)', ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={GLYPH[size] || 17} />
      {badge != null && (
        <span className="cz-num" style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 'var(--radius-pill)', background: 'var(--cz-lime-400)', color: 'var(--cz-ink-900)', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', border: '2px solid var(--surface)' }}>{badge}</span>
      )}
    </button>
  );
}
