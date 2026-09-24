import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** The persistent left rail. Dark ground, lime marks the current page. */
export function SidebarNav({ items = [], active, onNavigate, collapsed = false, brand, footer, style, ...rest }) {
  return (
    <nav className="cz-dark cz-scroll" style={{
      width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)',
      flex: '0 0 auto', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--cz-ink-900)', borderRight: '1px solid rgba(251,252,232,.07)',
      transition: 'width var(--dur-base) var(--ease-standard)', overflow: 'hidden', ...style,
    }} {...rest}>
      {brand && <div style={{ padding: collapsed ? '16px 12px' : '16px 18px', flex: '0 0 auto' }}>{brand}</div>}
      <div className="cz-scroll" style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '4px 8px' : '4px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((it) => it.section ? (
          <div key={it.section} className="cz-eyebrow" style={{ padding: collapsed ? '14px 0 6px' : '16px 8px 6px', color: 'rgba(251,252,232,.32)', opacity: collapsed ? 0 : 1, height: collapsed ? 12 : undefined }}>{it.section}</div>
        ) : (
          <button key={it.id} type="button" onClick={() => onNavigate && onNavigate(it.id)} title={collapsed ? it.label : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 11, width: '100%',
              padding: collapsed ? '9px 0' : '9px 10px', justifyContent: collapsed ? 'center' : 'flex-start',
              border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              background: it.id === active ? 'rgba(178,229,79,.14)' : 'transparent',
              color: it.id === active ? 'var(--cz-lime-400)' : 'rgba(251,252,232,.62)',
              fontSize: 13.5, fontWeight: it.id === active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
              textAlign: 'left', transition: 'var(--transition-control)', position: 'relative',
            }}
            onMouseEnter={(e) => { if (it.id !== active) { e.currentTarget.style.background = 'rgba(251,252,232,.05)'; e.currentTarget.style.color = 'var(--cz-cream-050)'; } }}
            onMouseLeave={(e) => { if (it.id !== active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(251,252,232,.62)'; } }}
          >
            <Icon name={it.icon} size={17} />
            {!collapsed && <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>}
            {!collapsed && it.count != null && (
              <span className="cz-num" style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-pill)', background: it.id === active ? 'var(--cz-lime-400)' : 'rgba(251,252,232,.10)', color: it.id === active ? 'var(--cz-ink-900)' : 'rgba(251,252,232,.72)' }}>{it.count}</span>
            )}
          </button>
        ))}
      </div>
      {footer && <div style={{ flex: '0 0 auto', padding: collapsed ? 8 : 12, borderTop: '1px solid rgba(251,252,232,.07)' }}>{footer}</div>}
    </nav>
  );
}
