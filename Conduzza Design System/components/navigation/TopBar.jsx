import React from 'react';

/** App top bar: page title on the left, global tools on the right. */
export function TopBar({ title, subtitle, breadcrumb, children, style, ...rest }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 16, flex: '0 0 auto',
      height: 'var(--topbar-h)', padding: '0 var(--page-gutter)',
      background: 'var(--surface)', borderBottom: '1px solid var(--border-hairline)', ...style,
    }} {...rest}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {breadcrumb && <span className="cz-eyebrow">{breadcrumb}</span>}
        <h1 style={{ fontSize: 'var(--text-h2)', letterSpacing: 'var(--ls-h2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
        {subtitle && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</span>}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>{children}</div>
    </header>
  );
}
