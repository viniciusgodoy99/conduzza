import React from 'react';

/** Section header inside a page: title, supporting line, right-aligned actions. */
export function PageHeader({ title, description, eyebrow, actions, children, style, ...rest }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 16, ...style }} {...rest}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {eyebrow && <span className="cz-eyebrow">{eyebrow}</span>}
        <h2 style={{ fontSize: 'var(--text-h1)', letterSpacing: 'var(--ls-h1)' }}>{title}</h2>
        {description && <p style={{ fontSize: 13.5, color: 'var(--text-muted)', maxWidth: '62ch' }}>{description}</p>}
        {children}
      </div>
      {actions && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div>}
    </div>
  );
}
