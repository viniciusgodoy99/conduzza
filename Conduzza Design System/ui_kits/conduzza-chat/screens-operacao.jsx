const DS = window.ConduzzaDesignSystem_cea3ac;
const { StatCard, Card, Badge, Tag, Button, IconButton, Icon, Avatar, SegmentedControl, SearchField, Select, Dropdown, DataTable, ProgressBar, BarChart, DonutChart, EmptyState, ChatBubble, ConversationItem, Composer, KanbanCard, Banner, PageHeader, Tabs } = DS;

/* ── Início ─────────────────────────────────────────────────────── */
function ScreenInicio({ go }) {
  return (
    <div style={{ padding: 'var(--page-gutter)', display: 'grid', gap: 16, maxWidth: 'var(--content-max)' }}>
      <PageHeader eyebrow="TERÇA, 22 DE SETEMBRO" title={`Bom dia, ${CLINIC.user.split(' ')[0]}`} description="19 confirmações ainda sem resposta e 12 conversas aguardando atendimento humano."
        actions={<><Button variant="secondary" icon="download">Exportar dia</Button><Button variant="primary" icon="send" onClick={() => go('confirmacoes')}>Disparar lembretes</Button></>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
        <StatCard label="Consultas hoje" value="147" icon="calendar-days" footnote="3 unidades" />
        <StatCard label="Confirmadas" value="128" accent delta="+12,4%" deltaDirection="up" footnote="87,2% do total" />
        <StatCard label="Aguardando" value="19" icon="clock" footnote="Último disparo 09:02" />
        <StatCard label="Resolvidas pela IA" value="64" unit="%" icon="sparkles" delta="+8,1%" deltaDirection="up" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Banner tone="warning" title="1 número de WhatsApp precisa de atenção" action={<Button size="sm" variant="ghost" onClick={() => go('config')}>Ver conexões</Button>}>
            A linha da Unidade Sul está com a sessão expirando em 2 dias.
          </Banner>
          <Card header="Conversas aguardando você" actions={<Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => go('atendimento')}>Abrir atendimento</Button>} padding={0}>
            {CONVERSAS.slice(0, 4).map((c) => (
              <ConversationItem key={c.id} {...c} onClick={() => go('atendimento')} />
            ))}
          </Card>
          <Card header="Consultas por dia · últimos 7 dias" padding={16}>
            <BarChart height={140} data={[{ label: 'Qua', value: 118 }, { label: 'Qui', value: 132 }, { label: 'Sex', value: 141 }, { label: 'Sáb', value: 64 }, { label: 'Seg', value: 136 }, { label: 'Ter', value: 147, highlight: true }]} />
          </Card>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card header="Agenda de hoje" actions={<IconButton icon="arrow-up-right" label="Abrir agenda" onClick={() => go('agenda')} />} padding={14}>
            <div style={{ display: 'grid', gap: 7 }}>
              {AGENDA.p1.slice(0, 4).map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="cz-num" style={{ fontSize: 11.5, color: 'var(--text-faint)', width: 38 }}>{a.start}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.patient}</span>
                  <Badge size="sm" tone={a.status === 'confirmado' ? 'success' : a.status === 'encaixe' ? 'lime' : a.status === 'bloqueio' ? 'neutral' : 'warning'} dot>{a.status}</Badge>
                </div>
              ))}
            </div>
          </Card>
          <Card header="Funil de leads" actions={<IconButton icon="arrow-up-right" label="Abrir leads" onClick={() => go('leads')} />} padding={16}>
            <div style={{ display: 'grid', gap: 12 }}>
              <ProgressBar label="Novo contato" caption="38" value={38} max={38} tone="ink" />
              <ProgressBar label="Qualificando" caption="24" value={24} max={38} />
              <ProgressBar label="Orçamento enviado" caption="15" value={15} max={38} tone="warning" />
              <ProgressBar label="Agendando" caption="9" value={9} max={38} tone="success" />
            </div>
          </Card>
          <Card tone="inverse" padding={16}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon name="sparkles" size={16} color="var(--cz-lime-400)" />
              <span className="cz-eyebrow" style={{ color: 'rgba(251,252,232,.5)' }}>Agente de IA</span>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--cz-cream-050)', lineHeight: 1.5 }}>O agente respondeu 94 conversas hoje e transferiu 12 para a equipe. Tempo médio de primeira resposta: <span className="cz-num">8s</span>.</p>
            <div style={{ marginTop: 12 }}><Button variant="primary" size="sm" iconRight="arrow-right" onClick={() => go('ia')}>Revisar agente</Button></div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ── Atendimento ────────────────────────────────────────────────── */
function ScreenAtendimento() {
  const [sel, setSel] = React.useState('c1');
  const [filter, setFilter] = React.useState('todos');
  const [draft, setDraft] = React.useState('');
  const [msgs, setMsgs] = React.useState(THREAD);
  const conv = CONVERSAS.find((c) => c.id === sel) || CONVERSAS[0];
  const list = filter === 'todos' ? CONVERSAS : filter === 'meus' ? CONVERSAS.filter((c) => c.assignee === 'Rafaela') : CONVERSAS.filter((c) => c.aiHandled);
  const send = () => { if (!draft.trim()) return; setMsgs((m) => [...m, { from: 'out', author: 'Rafaela', time: '14:3' + (m.length % 9), status: 'sent', text: draft }]); setDraft(''); };
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, minWidth: 1100, overflowX: 'auto' }}>
      <aside style={{ width: 'var(--inbox-list-w)', flex: '0 0 auto', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border-hairline)' }}>
        <div style={{ padding: 12, display: 'grid', gap: 9, borderBottom: '1px solid var(--border-hairline)' }}>
          <SearchField placeholder="Buscar conversa ou telefone" />
          <SegmentedControl block size="sm" value={filter} onChange={setFilter} options={[{ value: 'todos', label: 'Todas', count: CONVERSAS.length }, { value: 'meus', label: 'Meus' }, { value: 'ia', label: 'IA' }]} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Dropdown trigger={<Button size="sm" variant="ghost" icon="filter" iconRight="chevron-down">Etiquetas</Button>} items={Object.values(TAGS).map((t) => ({ label: t.label, checked: false }))} />
            <Dropdown trigger={<Button size="sm" variant="ghost" iconRight="chevron-down">Etapa</Button>} items={[{ label: 'Novo' }, { label: 'Em atendimento' }, { label: 'Agente de IA' }, { label: 'Resolvido' }]} />
          </div>
        </div>
        <div className="cz-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {list.map((c) => <ConversationItem key={c.id} {...c} active={c.id === sel} onClick={() => setSel(c.id)} />)}
        </div>
      </aside>

      <section style={{ flex: 1, minWidth: 420, display: 'flex', flexDirection: 'column', background: 'var(--cz-paper-050)' }}>
        <header style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border-hairline)' }}>
          <Avatar name={conv.name} size="md" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)' }}>{conv.name}</div>
            <div className="cz-num" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{conv.phone} · WhatsApp</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Badge tone="lime" icon="sparkles" size="sm">IA pausada</Badge>
            <IconButton icon="user-round-search" label="Ver paciente" variant="secondary" />
            <IconButton icon="arrow-right-left" label="Transferir" variant="secondary" />
            <IconButton icon="check-check" label="Resolver" variant="secondary" />
            <Dropdown align="right" trigger={<IconButton icon="ellipsis" label="Mais ações" variant="secondary" />} items={[{ label: 'Agendar consulta', icon: 'calendar-plus' }, { label: 'Adicionar etiqueta', icon: 'tag' }, { label: 'Exportar conversa', icon: 'download' }, { divider: true }, { label: 'Bloquear contato', icon: 'ban', danger: true }]} />
          </div>
        </header>
        <div className="cz-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-faint)', background: 'var(--surface)', padding: '3px 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-hairline)' }}>Hoje</div>
          {msgs.map((m, i) => <ChatBubble key={i} from={m.from === 'note' ? 'in' : m.from} note={m.from === 'note'} author={m.author} time={m.time} status={m.status} attachment={m.attachment}>{m.text}</ChatBubble>)}
        </div>
        <Composer value={draft} onChange={setDraft} onSend={send} aiSuggestion="Posso confirmar quinta (24/09) às 10:30 com a Dra. Helena?" quickReplies={QUICK_REPLIES} />
      </section>

      <aside className="cz-scroll" style={{ width: 'var(--context-panel-w)', flex: '0 0 auto', overflowY: 'auto', background: 'var(--surface)', borderLeft: '1px solid var(--border-hairline)', padding: 16, display: 'grid', gap: 16, alignContent: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <Avatar name={conv.name} size="xl" />
          <div><div style={{ fontSize: 15, fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)' }}>{conv.name}</div><div className="cz-num" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{conv.phone}</div></div>
          <div style={{ display: 'flex', gap: 6 }}><Button size="sm" variant="secondary" icon="calendar-plus">Agendar</Button><Button size="sm" variant="secondary" icon="file-text">Ficha</Button></div>
        </div>
        <div>
          <div className="cz-eyebrow" style={{ marginBottom: 8 }}>Etiquetas</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {(conv.tags || []).map((t) => <Tag key={t.label} color={t.color} size="sm" onRemove={() => {}}>{t.label}</Tag>)}
            <Button size="sm" variant="ghost" icon="plus">Etiqueta</Button>
          </div>
        </div>
        <div>
          <div className="cz-eyebrow" style={{ marginBottom: 8 }}>Dados do paciente</div>
          <dl style={{ margin: 0, display: 'grid', gap: 7 }}>
            {[['Convênio', 'Amil'], ['Profissional', 'Dra. Helena Reis'], ['Última consulta', '12/09/2026'], ['Próxima', '24/09/2026 · 10:30'], ['Origem', 'Indicação']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
                <dd className="cz-num" style={{ margin: 0, color: 'var(--text-body)', textAlign: 'right' }}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <div className="cz-eyebrow" style={{ marginBottom: 8 }}>Etapa da jornada</div>
          <Select size="sm" defaultValue="Em atendimento" options={['Novo', 'Em atendimento', 'Agente de IA', 'Agendado', 'Resolvido']} />
        </div>
        <div>
          <div className="cz-eyebrow" style={{ marginBottom: 8 }}>Nota interna</div>
          <div style={{ padding: 10, borderRadius: 'var(--radius-sm)', background: 'var(--cz-warning-050)', color: 'var(--cz-warning-700)', fontSize: 12.5, lineHeight: 1.5 }}>Prefere horários pela manhã. Sempre confirmar por WhatsApp.</div>
        </div>
      </aside>
    </div>
  );
}

/* ── Leads ──────────────────────────────────────────────────────── */
function ScreenLeads() {
  const [view, setView] = React.useState('kanban');
  return (
    <div style={{ padding: 'var(--page-gutter)', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 }}>
      <PageHeader title="Leads" description="Contatos que ainda não viraram pacientes."
        actions={<><SegmentedControl value={view} onChange={setView} options={[{ value: 'kanban', label: 'Kanban', icon: 'columns-3' }, { value: 'lista', label: 'Lista', icon: 'list' }]} /><Button variant="secondary" icon="filter">Filtros</Button><Button variant="primary" icon="plus">Novo lead</Button></>} />
      {view === 'kanban' ? (
        <div className="cz-scroll" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${LEAD_STAGES.length},minmax(228px,1fr))`, gap: 12, overflowX: 'auto', alignItems: 'start' }}>
          {LEAD_STAGES.map((st) => {
            const cards = LEADS.filter((l) => l.stage === st.id);
            return (
              <div key={st.id} style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0, background: 'var(--surface-sunken)', borderRadius: 'var(--radius-card)', padding: 10, maxHeight: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: st.tone }} />
                  <span style={{ fontSize: 12.5, fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)' }}>{st.label}</span>
                  <span className="cz-num" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{cards.length}</span>
                  <IconButton icon="plus" label="Adicionar lead" size="sm" style={{ marginLeft: 'auto' }} />
                </div>
                <div className="cz-scroll" style={{ display: 'grid', gap: 8, overflowY: 'auto', minHeight: 40 }}>
                  {cards.length ? cards.map((l) => <KanbanCard key={l.id} {...l} />) : <div style={{ padding: '18px 8px', textAlign: 'center', fontSize: 11.5, color: 'var(--text-faint)' }}>Nenhum lead aqui</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card padding={0} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <DataTable rows={LEADS} columns={[
            { key: 'name', header: 'Lead', strong: true, render: (r) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={r.name} size="xs" />{r.name}</span> },
            { key: 'phone', header: 'WhatsApp', numeric: true, muted: true },
            { key: 'meta', header: 'Contexto', muted: true, wrap: true },
            { key: 'stage', header: 'Etapa', render: (r) => { const st = LEAD_STAGES.find((s) => s.id === r.stage); return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: st.tone }} />{st.label}</span>; } },
            { key: 'owner', header: 'Responsável', muted: true },
            { key: 'value', header: 'Ticket', numeric: true, align: 'right' },
            { key: 'waiting', header: 'Parado há', numeric: true, align: 'right', muted: true },
          ]} />
        </Card>
      )}
    </div>
  );
}

Object.assign(window, { ScreenInicio, ScreenAtendimento, ScreenLeads });
