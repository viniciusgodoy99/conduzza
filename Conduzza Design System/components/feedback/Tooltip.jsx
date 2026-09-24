import React from 'react';

/** Hover label on dense chrome. Dark capsule, 6px radius, no arrow. */
export function Tooltip({ label, side = 'top', children, style, ...rest }) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' },
    bottom: { top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' },
    left: { right: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' },
    right: { left: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' },
  }[side];
  return (
    <span style={{ position: 'relative', display: 'inline-flex', ...style }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} {...rest}>
      {children}
      {show && (
        <span role="tooltip" style={{
          position: 'absolute', ...pos, zIndex: 60, whiteSpace: 'nowrap', pointerEvents: 'none',
          padding: '5px 8px', borderRadius: 'var(--radius-xs)', background: 'var(--cz-ink-900)',
          color: 'var(--cz-cream-050)', fontSize: 11.5, fontWeight: 'var(--fw-medium)',
          boxShadow: 'var(--shadow-md)', animation: 'cz-fade var(--dur-fast) var(--ease-out)',
        }}>{label}</span>
      )}
      <style>{'@keyframes cz-fade{from{opacity:0}to{opacity:1}}'}</style>
    </span>
  );
}
