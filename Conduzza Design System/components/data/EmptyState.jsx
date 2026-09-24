import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Zero-state block. Quiet, never apologetic, always offers the next action. */
export function EmptyState({ icon = 'inbox', title, description, action, compact = false, style, ...rest }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: compact ? 8 : 12, padding: compact ? '28px 20px' : '56px 24px', textAlign: 'center', ...style,
    }} {...rest}>
      <span style={{ display: 'grid', placeItems: 'center', width: compact ? 38 : 52, height: compact ? 38 : 52, borderRadius: 'var(--radius-lg)', background: 'var(--cz-lime-050)' }}>
        <Icon name={icon} size={compact ? 18 : 24} color="var(--cz-lime-700)" />
      </span>
      <h3 style={{ fontSize: compact ? 14 : 16, letterSpacing: '-0.01em' }}>{title}</h3>
      {description && <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: '44ch' }}>{description}</p>}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}
