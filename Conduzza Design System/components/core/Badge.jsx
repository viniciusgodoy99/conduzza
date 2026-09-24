import React from 'react';
import { Icon } from './Icon.jsx';

const TONES = {
  neutral: { bg: 'var(--cz-ink-050)', fg: 'var(--cz-ink-700)', dot: 'var(--cz-ink-400)' },
  lime:    { bg: 'var(--cz-lime-050)', fg: 'var(--cz-lime-800)', dot: 'var(--cz-lime-500)' },
  success: { bg: 'var(--cz-success-050)', fg: 'var(--cz-success-700)', dot: 'var(--cz-success-500)' },
  warning: { bg: 'var(--cz-warning-050)', fg: 'var(--cz-warning-700)', dot: 'var(--cz-warning-500)' },
  danger:  { bg: 'var(--cz-danger-050)', fg: 'var(--cz-danger-700)', dot: 'var(--cz-danger-500)' },
  info:    { bg: 'var(--cz-info-050)', fg: 'var(--cz-info-700)', dot: 'var(--cz-info-500)' },
  inverse: { bg: 'var(--cz-ink-900)', fg: 'var(--cz-cream-050)', dot: 'var(--cz-lime-400)' },
};

/** Status pill. Carries state, never an action. */
export function Badge({ tone = 'neutral', children, dot = false, icon, size = 'md', style, ...rest }) {
  const t = TONES[tone] || TONES.neutral;
  const sm = size === 'sm';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: sm ? 4 : 6,
      height: sm ? 20 : 24, padding: `0 ${sm ? 7 : 9}px`,
      borderRadius: 'var(--radius-pill)', background: t.bg, color: t.fg,
      fontSize: sm ? 11 : 12, fontWeight: 'var(--fw-semibold)',
      letterSpacing: '-0.005em', whiteSpace: 'nowrap', ...style,
    }} {...rest}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot, flex: '0 0 auto' }} />}
      {icon && <Icon name={icon} size={sm ? 11 : 13} />}
      {children}
    </span>
  );
}
