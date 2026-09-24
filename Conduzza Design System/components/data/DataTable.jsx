import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Dense record table. Hairline rows, mono figures, no vertical rules. */
export function DataTable({ columns = [], rows = [], onRowClick, selectable = false, selected = [], onSelect, dense = false, empty, style, ...rest }) {
  const pad = dense ? '8px 12px' : '11px 14px';
  return (
    <div className="cz-scroll" style={{ overflowX: 'auto', ...style }} {...rest}>
      <table style={{ minWidth: '100%', fontSize: dense ? 12.5 : 13.5 }}>
        <thead>
          <tr>
            {selectable && <th style={{ width: 36, padding: pad, background: 'var(--cz-paper-050)', borderBottom: '1px solid var(--border-subtle)' }} />}
            {columns.map((c) => (
              <th key={c.key} style={{
                padding: pad, textAlign: c.align || 'left', whiteSpace: 'nowrap',
                background: 'var(--cz-paper-050)', borderBottom: '1px solid var(--border-subtle)',
                fontSize: 'var(--text-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase',
                fontWeight: 'var(--fw-bold)', color: 'var(--text-muted)', width: c.width,
                position: 'sticky', top: 0, zIndex: 1,
              }}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length + (selectable ? 1 : 0)} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{empty || 'Nenhum registro.'}</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.id || i}
              onClick={() => onRowClick && onRowClick(r)}
              style={{ cursor: onRowClick ? 'pointer' : undefined, transition: 'background-color var(--dur-fast) var(--ease-standard)', background: selected.includes(r.id) ? 'var(--cz-lime-050)' : 'transparent' }}
              onMouseEnter={(e) => { if (!selected.includes(r.id)) e.currentTarget.style.background = 'var(--cz-paper-050)'; }}
              onMouseLeave={(e) => { if (!selected.includes(r.id)) e.currentTarget.style.background = 'transparent'; }}
            >
              {selectable && (
                <td style={{ padding: pad, borderBottom: '1px solid var(--border-hairline)' }}>
                  <span onClick={(e) => { e.stopPropagation(); onSelect && onSelect(r.id); }} style={{ display: 'grid', placeItems: 'center', width: 17, height: 17, borderRadius: 5, cursor: 'pointer', background: selected.includes(r.id) ? 'var(--cz-lime-400)' : 'var(--surface)', border: `1px solid ${selected.includes(r.id) ? 'var(--cz-lime-500)' : 'var(--border-strong)'}` }}>
                    {selected.includes(r.id) && <Icon name="check" size={12} color="var(--cz-ink-900)" />}
                  </span>
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'cz-num' : undefined} style={{
                  padding: pad, textAlign: c.align || 'left', borderBottom: '1px solid var(--border-hairline)',
                  color: c.muted ? 'var(--text-muted)' : 'var(--text-body)',
                  fontWeight: c.strong ? 'var(--fw-semibold)' : 'var(--fw-regular)',
                  whiteSpace: c.wrap ? 'normal' : 'nowrap',
                }}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
