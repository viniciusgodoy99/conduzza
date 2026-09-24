const DSb = window.ConduzzaDesignSystem_cea3ac;
const { Card, Badge, Button, IconButton, Icon, Avatar, SegmentedControl, SearchField, Select, Input, DataTable, ProgressBar, StatCard, EmptyState, PageHeader, AppointmentCard, Dropdown, Banner, Tag } = DSb;

const HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00'];
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/* ── Agenda ─────────────────────────────────────────────────────── */
function ScreenAgenda() {
  const [range, setRange] = React.useState('dia');
  const top = (t) => ((toMin(t) - 480) / 60) * 64;
  return (
    <div style={{ padding: 'var(--page-gutter)', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 }}>
      <PageHeader eyebrow="TERÇA, 22 DE SETEMBRO DE 2026" title="Agenda" description="Todos os profissionais da Unidade Centro."
        actions={<><SegmentedControl value={range} onChange={setRange} options={[{ value: 'dia', label: 'Dia' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mês' }]} /><Select size="sm" options={['Todas as unidades', 'Unidade Centro', 'Unidade Sul']} block={false} wrapStyle={{ width: 180 }} /><Button variant="primary" icon="plus">Nova consulta</Button></>} />
      <Card padding={0} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `62px repeat(${PROFISSIONAIS.length},minmax(0,1fr))`, borderBottom: '1px solid var(--border-subtle)', background: 'var(--cz-paper-050)' }}>
          <div />
          {PROFISSIONAIS.map((p) => (
            <div key={p.id} style={{ padding: '10px 12px', borderLeft: '1px solid var(--border-hairline)', display: 'flex', alignItems: 'center', gap: 9 }}>
              <Avatar name={p.nome} size="sm" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{p.esp} · {p.sala}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="cz-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `62px repeat(${PROFISSIONAIS.length},minmax(0,1fr))`, position: 'relative', minHeight: HOURS.length * 64 }}>
            <div>
              {HOURS.map((h) => (
                <div key={h} className="cz-num" style={{ height: 64, padding: '4px 10px', fontSize: 10.5, color: 'var(--text-faint)', textAlign: 'right', borderTop: '1px solid var(--border-hairline)' }}>{h}</div>
              ))}
            </div>
            {PROFISSIONAIS.map((p) => (
              <div key={p.id} style={{ position: 'relative', borderLeft: '1px solid var(--border-hairline)' }}>
                {HOURS.map((h) => <div key={h} style={{ height: 64, borderTop: '1px solid var(--border-hairline)' }} />)}
                {(AGENDA[p.id] || []).map((a, i) => (
                  <AppointmentCard key={i} {...a} professional={p.sala}
                    style={{ position: 'absolute', left: 5, right: 5, top: top(a.start) + 2, height: ((toMin(a.end) - toMin(a.start)) / 60) * 64 - 4, minHeight: 26 }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ── Pacientes ──────────────────────────────────────────────────── */
function ScreenPacientes() {
  const [sel, setSel] = React.useState([]);
  return (
    <div style={{ padding: 'var(--page-gutter)', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 }}>
      <PageHeader title="Pacientes" description="Contatos que já realizaram pelo menos uma consulta."
        actions={<><SearchField size="sm" placeholder="Buscar por nome, CPF ou telefone" style={{ width: 260 }} /><Button variant="secondary" icon="download">Exportar</Button><Button variant="primary" icon="user-plus">Novo paciente</Button></>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
        <StatCard label="Pacientes ativos" value="1.248" icon="users" delta="+34" deltaDirection="up" />
        <StatCard label="Novos no mês" value="86" icon="user-plus" />
        <StatCard label="Retorno em 90 dias" value="41" unit="%" icon="repeat" />
        <StatCard label="Sem contato há 6 meses" value="212" icon="user-x" footnote="Elegíveis para reativação" />
      </div>
      <Card padding={0} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <DataTable selectable selected={sel} onSelect={(id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])} rows={PACIENTES} columns={[
          { key: 'nome', header: 'Paciente', strong: true, render: (r) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={r.nome} size="xs" />{r.nome}</span> },
          { key: 'tel', header: 'WhatsApp', numeric: true, muted: true },
          { key: 'nasc', header: 'Nascimento', numeric: true, muted: true },
          { key: 'convenio', header: 'Convênio' },
          { key: 'prof', header: 'Profissional', muted: true },
          { key: 'ultima', header: 'Última', numeric: true, align: 'right', muted: true },
          { key: 'proxima', header: 'Próxima', numeric: true, align: 'right' },
          { key: 'status', header: 'Status', render: (r) => <Badge size="sm" dot tone={r.status === 'ativo' ? 'success' : r.status === 'pendente' ? 'warning' : 'neutral'}>{r.status}</Badge> },
        ]} />
      </Card>
    </div>
  );
}

/* ── Confirmações ───────────────────────────────────────────────── */
const CONF_TONE = { confirmado: 'success', aguardando: 'warning', cancelado: 'danger', falhou: 'danger' };
function ScreenConfirmacoes() {
  const [f, setF] = React.useState('todos');
  const rows = f === 'todos' ? CONFIRMACOES : CONFIRMACOES.filter((r) => r.status === f);
  return (
    <div style={{ padding: 'var(--page-gutter)', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 }}>
      <PageHeader eyebrow="HOJE · 22 DE SETEMBRO" title="Confirmações" description="Disparo automático às 09:00 do dia anterior. Respostas entram direto no Atendimento."
        actions={<><Button variant="secondary" icon="rotate-cw">Reenviar pendentes</Button><Button variant="primary" icon="send">Disparar agora</Button></>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12 }}>
        <StatCard label="Agendadas" value="147" icon="calendar-days" />
        <StatCard label="Confirmadas" value="128" accent footnote="87,2%" />
        <StatCard label="Aguardando" value="12" icon="clock" />
        <StatCard label="Canceladas" value="6" icon="calendar-x" />
        <StatCard label="Falha no envio" value="1" icon="triangle-alert" footnote="Número inválido" />
      </div>
      <Banner tone="lime" title="19 pacientes ainda não responderam" action={<Button size="sm" variant="ghost">Enviar 2º lembrete</Button>}>O segundo lembrete costuma converter 6 em cada 10 pendentes.</Banner>
      <Card padding={0} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--border-hairline)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SegmentedControl size="sm" value={f} onChange={setF} options={[{ value: 'todos', label: 'Todas', count: CONFIRMACOES.length }, { value: 'confirmado', label: 'Confirmadas' }, { value: 'aguardando', label: 'Aguardando' }, { value: 'cancelado', label: 'Canceladas' }, { value: 'falhou', label: 'Falhas' }]} />
          <SearchField size="sm" placeholder="Buscar paciente" style={{ width: 220, marginLeft: 'auto' }} />
        </div>
        <div className="cz-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <DataTable rows={rows} empty="Nenhuma confirmação neste filtro." columns={[
            { key: 'hora', header: 'Horário', numeric: true, strong: true },
            { key: 'paciente', header: 'Paciente', strong: true, render: (r) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={r.paciente} size="xs" />{r.paciente}</span> },
            { key: 'prof', header: 'Profissional', muted: true },
            { key: 'proc', header: 'Procedimento', muted: true },
            { key: 'canal', header: 'Canal', render: (r) => <Badge size="sm" tone={r.canal === 'WhatsApp' ? 'success' : 'neutral'}>{r.canal}</Badge> },
            { key: 'enviado', header: 'Enviado', numeric: true, muted: true },
            { key: 'status', header: 'Status', render: (r) => <Badge size="sm" dot tone={CONF_TONE[r.status]}>{r.status}</Badge> },
            { key: 'acoes', header: '', align: 'right', render: () => <Dropdown align="right" trigger={<IconButton icon="ellipsis" label="Ações" size="sm" />} items={[{ label: 'Abrir conversa', icon: 'messages-square' }, { label: 'Reenviar lembrete', icon: 'rotate-cw' }, { label: 'Confirmar manualmente', icon: 'check' }, { divider: true }, { label: 'Cancelar consulta', icon: 'x', danger: true }]} /> },
          ]} />
        </div>
      </Card>
    </div>
  );
}

/* ── Lista de espera ────────────────────────────────────────────── */
const PRIO = { alta: ['danger', 'Alta'], media: ['warning', 'Média'], baixa: ['neutral', 'Baixa'] };
function ScreenEspera() {
  return (
    <div style={{ padding: 'var(--page-gutter)', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 }}>
      <PageHeader title="Lista de espera" description="Pacientes sem horário adequado. Quando um cancelamento acontece, a automação oferece a vaga na ordem de prioridade."
        actions={<><Button variant="secondary" icon="settings-2">Regras de encaixe</Button><Button variant="primary" icon="plus">Adicionar paciente</Button></>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)', gap: 16, flex: 1, minHeight: 0, alignItems: 'start' }}>
        <Card padding={0}>
          <DataTable rows={ESPERA} columns={[
            { key: 'paciente', header: 'Paciente', strong: true, render: (r) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={r.paciente} size="xs" />{r.paciente}</span> },
            { key: 'tel', header: 'WhatsApp', numeric: true, muted: true },
            { key: 'prof', header: 'Profissional', muted: true },
            { key: 'pref', header: 'Preferência', muted: true },
            { key: 'desde', header: 'Na lista desde', numeric: true, align: 'right', muted: true },
            { key: 'prio', header: 'Prioridade', render: (r) => <Badge size="sm" dot tone={PRIO[r.prio][0]}>{PRIO[r.prio][1]}</Badge> },
            { key: 'acao', header: '', align: 'right', render: () => <Button size="sm" variant="soft" icon="zap">Oferecer vaga</Button> },
          ]} />
        </Card>
        <div style={{ display: 'grid', gap: 14 }}>
          <Card header="Vagas abertas hoje" padding={14}>
            <div style={{ display: 'grid', gap: 8 }}>
              {[['09:00', 'Dr. Caio Prado', 'Cancelamento'], ['14:30', 'Dra. Helena Reis', 'Falta confirmada']].map(([h, p, m]) => (
                <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 'var(--radius-sm)', background: 'var(--cz-lime-050)' }}>
                  <span className="cz-num" style={{ fontSize: 14, fontWeight: 600, color: 'var(--cz-lime-800)' }}>{h}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-body)' }}>{p}<br /><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m}</span></span>
                  <Button size="sm" variant="primary">Preencher</Button>
                </div>
              ))}
            </div>
          </Card>
          <Card header="Desempenho da lista" padding={16}>
            <div style={{ display: 'grid', gap: 12 }}>
              <ProgressBar label="Vagas preenchidas no mês" caption="24 / 31" value={24} max={31} />
              <ProgressBar label="Aceite na 1ª oferta" caption="68%" value={68} tone="success" />
              <ProgressBar label="Tempo médio até o encaixe" caption="2h 40" value={40} tone="warning" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenAgenda, ScreenPacientes, ScreenConfirmacoes, ScreenEspera });
