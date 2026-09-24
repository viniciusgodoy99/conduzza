import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Dropdown trigger + menu used for filters, row actions and status pickers. */
export function Dropdown({ trigger, items = [], align = 'left', width = 200, onSelect, style }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 6px)', [align]: 0, zIndex: 40, width,
          background: 'var(--surface)', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-pop)', padding: 5,
          animation: 'cz-pop var(--dur-fast) var(--ease-out)',
        }}>
          {items.map((it, i) => it.divider ? (
            <div key={`d${i}`} style={{ height: 1, background: 'var(--border-hairline)', margin: '5px 0' }} />
          ) : (
            <button key={it.value || it.label} type="button" role="menuitem"
              onClick={() => { setOpen(false); onSelect && onSelect(it.value || it.label); it.onClick && it.onClick(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 9px',
                border: 'none', borderRadius: 'var(--radius-xs)', background: 'transparent',
                color: it.danger ? 'var(--cz-danger-700)' : 'var(--text-body)',
                fontSize: 13, fontWeight: 'var(--fw-medium)', textAlign: 'left', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = it.danger ? 'var(--cz-danger-050)' : 'var(--cz-ink-050)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {it.icon && <Icon name={it.icon} size={15} />}
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.shortcut && <span className="cz-num" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{it.shortcut}</span>}
              {it.checked && <Icon name="check" size={14} color="var(--cz-lime-700)" />}
            </button>
          ))}
          <style>{'@keyframes cz-pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}'}</style>
        </div>
      )}
    </span>
  );
}
