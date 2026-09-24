import React from 'react';
import { Icon } from './Icon.jsx';

const SIZES = {
  sm: { h: 'var(--control-h-sm)', px: 10, fs: 13, gap: 6, icon: 14 },
  md: { h: 'var(--control-h-md)', px: 14, fs: 14, gap: 7, icon: 16 },
  lg: { h: 'var(--control-h-lg)', px: 20, fs: 15, gap: 8, icon: 18 },
};

const VARIANTS = {
  primary:   { bg: 'var(--cz-lime-400)', fg: 'var(--cz-ink-900)', bd: 'transparent', hover: 'var(--cz-lime-500)', shadow: 'var(--shadow-xs)' },
  solid:     { bg: 'var(--cz-ink-900)',  fg: 'var(--cz-cream-050)', bd: 'transparent', hover: 'var(--cz-ink-800)', shadow: 'var(--shadow-xs)' },
  secondary: { bg: 'var(--surface)',     fg: 'var(--text-strong)', bd: 'var(--border-subtle)', hover: 'var(--cz-paper-100)', shadow: 'var(--shadow-xs)' },
  ghost:     { bg: 'transparent',        fg: 'var(--text-body)',   bd: 'transparent', hover: 'var(--cz-ink-050)', shadow: 'none' },
  soft:      { bg: 'var(--cz-lime-050)', fg: 'var(--cz-lime-800)', bd: 'transparent', hover: 'var(--cz-lime-100)', shadow: 'none' },
  danger:    { bg: 'var(--cz-danger-050)', fg: 'var(--cz-danger-700)', bd: 'transparent', hover: '#fbe0da', shadow: 'none' },
};

/** The one button. Lime = the single committing action on a screen. */
export function Button({
  variant = 'secondary', size = 'md', icon, iconRight, block = false,
  disabled = false, loading = false, active = false, children, style, onClick, ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.secondary;
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const off = disabled || loading;
  return (
    <button
      type="button" disabled={off} onClick={off ? undefined : onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)} onMouseUp={() => setPress(false)}
      style={{
        display: block ? 'flex' : 'inline-flex', width: block ? '100%' : undefined,
        alignItems: 'center', justifyContent: 'center', gap: s.gap,
        height: s.h, padding: `0 ${s.px}px`, borderRadius: 'var(--radius-control)',
        border: `1px solid ${v.bd}`, background: (hover && !off) || active ? v.hover : v.bg,
        color: v.fg, fontFamily: 'var(--font-sans)', fontSize: s.fs,
        fontWeight: 'var(--fw-semibold)', letterSpacing: '-0.005em',
        boxShadow: v.shadow, cursor: off ? 'not-allowed' : 'pointer',
        opacity: off ? 0.45 : 1, transform: press && !off ? 'scale(.975)' : 'none',
        transition: 'var(--transition-control)', whiteSpace: 'nowrap', ...style,
      }}
      {...rest}
    >
      {loading ? <Icon name="loader-circle" size={s.icon} style={{ animation: 'cz-spin 900ms linear infinite' }} />
               : icon ? <Icon name={icon} size={s.icon} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={s.icon} /> : null}
      <style>{'@keyframes cz-spin{to{transform:rotate(360deg)}}'}</style>
    </button>
  );
}
