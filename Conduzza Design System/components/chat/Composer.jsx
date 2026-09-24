import React from 'react';
import { IconButton } from '../core/IconButton.jsx';
import { Icon } from '../core/Icon.jsx';

/** Message composer: quick replies row, textarea, attachment tools, send. */
export function Composer({ value = '', onChange, onSend, placeholder = 'Escreva uma mensagem…', quickReplies = [], aiSuggestion, disabled = false, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div style={{ flex: '0 0 auto', padding: 12, background: 'var(--surface)', borderTop: '1px solid var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: 9, ...style }} {...rest}>
      {aiSuggestion && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', borderRadius: 'var(--radius-sm)', background: 'var(--cz-lime-050)' }}>
          <Icon name="sparkles" size={14} color="var(--cz-lime-700)" />
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--cz-lime-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{aiSuggestion}</span>
          <button type="button" onClick={() => onChange && onChange(aiSuggestion)} style={{ border: 'none', background: 'transparent', color: 'var(--cz-lime-800)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Usar</button>
        </div>
      )}
      {quickReplies.length > 0 && (
        <div className="cz-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {quickReplies.map((q) => (
            <button key={q} type="button" onClick={() => onChange && onChange(q)}
              style={{ flex: '0 0 auto', height: 26, padding: '0 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-subtle)', background: 'var(--surface)', color: 'var(--text-body)', fontSize: 12, fontWeight: 'var(--fw-medium)', cursor: 'pointer', whiteSpace: 'nowrap' }}>{q}</button>
          ))}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8, padding: 8,
        background: 'var(--cz-paper-050)', borderRadius: 'var(--radius-lg)',
        border: `1px solid ${focus ? 'var(--cz-lime-500)' : 'var(--border-subtle)'}`,
        transition: 'var(--transition-control)',
      }}>
        <textarea
          rows={1} value={value} disabled={disabled} placeholder={placeholder}
          onChange={(e) => onChange && onChange(e.target.value)}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend && onSend(); } }}
          style={{ flex: 1, minWidth: 0, resize: 'none', maxHeight: 120, border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, lineHeight: 1.5, padding: '5px 4px', color: 'var(--text-strong)' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton icon="paperclip" label="Anexar arquivo" size="sm" />
          <IconButton icon="image" label="Enviar imagem" size="sm" />
          <IconButton icon="mic" label="Gravar áudio" size="sm" />
          <IconButton icon="send" label="Enviar" size="md" round variant="primary" onClick={onSend} style={{ marginLeft: 4 }} />
        </div>
      </div>
    </div>
  );
}
