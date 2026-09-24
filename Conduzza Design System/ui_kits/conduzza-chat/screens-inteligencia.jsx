const DSc = window.ConduzzaDesignSystem_cea3ac;
const { Card, Badge, Button, IconButton, Icon, Avatar, SegmentedControl, SearchField, Select, Input, Textarea, Switch, Checkbox, DataTable, ProgressBar, StatCard, BarChart, DonutChart, EmptyState, PageHeader, Tabs, Banner, Tag, Dropdown } = DSc;

/* ── Resultados ─────────────────────────────────────────────────── */
function ScreenResultados() {
  const [scope, setScope] = React.useState('geral');
  return (
    <div className="cz-scroll" style={{ padding: 'var(--page-gutter)', display: 'grid', gap: 16, maxWidth: 'var(--content-max)', overflowY: 'auto', alignContent: 'start' }}>
      <PageHeader eyebrow="1 – 22 DE SETEMBRO DE 2026" title="Resultados" description="Marketing, comercial, follow-up, confirmação e agente de IA em um só lugar."
        actions={<><Select size="sm" options={['Este mês', 'Últimos 30 dias', 'Últimos 90 dias']} block={false} wrapStyle={{ width: 160 }} /><Button variant="secondary" icon="download">Exportar PDF</Button></>} />
      <SegmentedControl value={scope} onChange={setScope} options={[{ value: 'geral', label: 'Visão geral' }, { value: 'marketing', label: 'Marketing' }, { value: 'comercial', label: 'Comercial' }, { value: 'ia', label: 'Agente de IA' }]} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12 }}>
        <StatCard label="Leads recebidos" value="486" delta="+18,2%" deltaDirection="up" icon="user-plus" />
        <StatCard label="Consultas agendadas" value="312" delta="+9,4%" deltaDirection="up" icon="calendar-check" />
        <StatCard label="Taxa de conversão" value="64,2" unit="%" accent footnote="Meta: 60%" />
        <StatCard label="Custo por lead" value="R$ 18,40" delta="-6,1%" deltaDirection="down" icon="wallet" />
        <StatCard label="Faturamento estimado" value="R$ 284k" delta="+12,8%" deltaDirection="up" icon="trending-up" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 16 }}>
        <Card header="Leads x consultas agendadas" actions={<Badge tone="lime" size="sm">Setembro</Badge>} padding={16}>
          <BarChart height={168} data={[{ label: '01', value: 14 }, { label: '04', value: 22 }, { label: '07', value: 19 }, { label: '10', value: 28 }, { label: '13', value: 24 }, { label: '16', value: 31 }, { label: '19', value: 27 }, { label: '22', value: 34, highlight: true }]} />
        </Card>
        <Card header="Origem dos leads" padding={16}>
          <DonutChart size={124} thickness={16} centerValue="486" centerLabel="leads" segments={[
            { label: 'Meta Ads', value: 214, color: 'var(--cz-lime-400)' },
            { label: 'Google', value: 128, color: 'var(--cz-ink-900)' },
            { label: 'Indicação', value: 96, color: 'var(--cz-lime-700)' },
            { label: 'Orgânico', value: 48, color: 'var(--cz-ink-300)' },
          ]} />
        </Card>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16 }}>
        <Card header="Funil comercial" padding={16}>
          <div style={{ display: 'grid', gap: 12 }}>
            <ProgressBar label="Leads" caption="486" value={486} max={486} tone="ink" />
            <ProgressBar label="Qualificados" caption="392" value={392} max={486} />
            <ProgressBar label="Orçamento enviado" caption="341" value={341} max={486} tone="warning" />
            <ProgressBar label="Agendados" caption="312" value={312} max={486} tone="success" />
            <ProgressBar label="Compareceram" caption="284" value={284} max={486} tone="success" />
          </div>
        </Card>
        <Card header="Confirmação de consulta" padding={16}>
          <div style={{ display: 'grid', gap: 12 }}>
            <ProgressBar label="Taxa de confirmação" caption="87,2%" value={87} />
            <ProgressBar label="Taxa de comparecimento" caption="91,0%" value={91} tone="success" />
            <ProgressBar label="Faltas (no-show)" caption="9,0%" value={9} tone="danger" />
            <ProgressBar label="Remarcações" caption="6,4%" value={6.4} tone="warning" />
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-hairline)', fontSize: 12, color: 'var(--text-muted)' }}>A confirmação automática reduziu as faltas em <strong style={{ color: 'var(--cz-lime-700)' }}>38%</strong> desde março.</div>
        </Card>
        <Card header="Agente de IA" padding={16}>
          <div style={{ display: 'grid', gap: 12 }}>
            <ProgressBar label="Conversas resolvidas sem humano" caption="64%" value={64} />
            <ProgressBar label="Transferidas para a equipe" caption="31%" value={31} tone="warning" />
            <ProgressBar label="Escalonadas por insatisfação" caption="5%" value={5} tone="danger" />
          </div>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><div className="cz-eyebrow">1ª resposta</div><div className="cz-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-strong)' }}>8s</div></div>
            <div><div className="cz-eyebrow">Satisfação</div><div className="cz-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-strong)' }}>4,7</div></div>
          </div>
        </Card>
      </div>
      <Card header="Campanhas Meta Ads" actions={<Button size="sm" variant="ghost" iconRight="arrow-up-right">Abrir no Gerenciador</Button>} padding={0}>
        <DataTable dense rows={[
          { id: 'm1', camp: 'Check-up 2026 — Cardiologia', inv: 'R$ 3.420', leads: '186', cpl: 'R$ 18,39', agend: '112', conv: '60,2%' },
          { id: 'm2', camp: 'Harmonização facial — Setembro', inv: 'R$ 2.880', leads: '142', cpl: 'R$ 20,28', agend: '78', conv: '54,9%' },
          { id: 'm3', camp: 'Dermatologia — Remarketing', inv: 'R$ 1.260', leads: '98', cpl: 'R$ 12,86', agend: '71', conv: '72,4%' },
          { id: 'm4', camp: 'Ginecologia — Prevenção', inv: 'R$ 1.380', leads: '60', cpl: 'R$ 23,00', agend: '51', conv: '85,0%' },
        ]} columns={[
          { key: 'camp', header: 'Campanha', strong: true },
          { key: 'inv', header: 'Investimento', numeric: true, align: 'right' },
          { key: 'leads', header: 'Leads', numeric: true, align: 'right' },
          { key: 'cpl', header: 'Custo por lead', numeric: true, align: 'right', muted: true },
          { key: 'agend', header: 'Agendados', numeric: true, align: 'right' },
          { key: 'conv', header: 'Conversão', numeric: true, align: 'right', strong: true },
        ]} />
      </Card>
    </div>
  );
}

/* ── Agente de IA ───────────────────────────────────────────────── */
function ScreenIA() {
  const [on, setOn] = React.useState(true);
  const [tab, setTab] = React.useState('comportamento');
  return (
    <div className="cz-scroll" style={{ padding: 'var(--page-gutter)', display: 'grid', gap: 16, maxWidth: 1080, overflowY: 'auto', alignContent: 'start' }}>
      <PageHeader eyebrow="INTELIGÊNCIA" title="Agente de IA" description="O agente atende primeiro, qualifica, agenda e transfere para a equipe quando precisa."
        actions={<><Button variant="secondary" icon="play">Testar conversa</Button><Button variant="primary" icon="check">Publicar alterações</Button></>} />
      <Card padding={16}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 42, height: 42, borderRadius: 'var(--radius-md)', background: 'var(--cz-ink-900)' }}><Icon name="sparkles" size={20} color="var(--cz-lime-400)" /></span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 15, fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)' }}>Agente Conduzza · Clínica Vitta</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Ativo em 3 linhas de WhatsApp · última publicação há 2 dias</div>
          </div>
          <Badge tone={on ? 'success' : 'neutral'} dot>{on ? 'Ativo' : 'Pausado'}</Badge>
          <Switch checked={on} onChange={setOn} />
        </div>
      </Card>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'comportamento', label: 'Comportamento' }, { value: 'conhecimento', label: 'Base de conhecimento', count: 24 }, { value: 'transferencia', label: 'Regras de transferência' }, { value: 'historico', label: 'Conversas revisadas', count: 94 }]} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card header="Identidade e tom" padding={16}>
            <div style={{ display: 'grid', gap: 12 }}>
              <Input label="Nome exibido" defaultValue="Atendimento Clínica Vitta" />
              <Select label="Tom de voz" options={['Cordial e objetivo', 'Formal', 'Próximo e informal']} />
              <Textarea label="Instruções do agente" rows={5} counter={2000} defaultValue={'Você atende pacientes da Clínica Vitta pelo WhatsApp.\nSempre confirme nome completo e convênio antes de agendar.\nNunca dê orientação médica — ofereça agendamento.\nSe o paciente demonstrar urgência, transfira imediatamente.'} />
            </div>
          </Card>
          <Card header="O que o agente pode fazer" padding={16}>
            <div style={{ display: 'grid', gap: 12 }}>
              {[['Consultar horários disponíveis', 'Lê a Agenda em tempo real', true], ['Agendar e remarcar consultas', 'Cria o registro e dispara a confirmação', true], ['Informar valores e convênios', 'Usa a tabela do Cadastro', true], ['Enviar documentos e endereço', 'Anexos da base de conhecimento', true], ['Cancelar consultas', 'Sempre transfere para a equipe', false]].map(([t, d, v]) => (
                <Switch key={t} checked={v} onChange={() => {}} label={t} description={d} />
              ))}
            </div>
          </Card>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card header="Prévia da conversa" padding={14} tone="sunken">
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ alignSelf: 'flex-start', maxWidth: '82%', padding: '9px 12px', borderRadius: 'var(--radius-bubble)', borderBottomLeftRadius: 6, background: 'var(--surface)', border: '1px solid var(--border-hairline)', fontSize: 13 }}>Oi, vocês atendem Unimed?</div>
              <div className="cz-dark" style={{ alignSelf: 'flex-end', maxWidth: '82%', padding: '9px 12px', borderRadius: 'var(--radius-bubble)', borderBottomRightRadius: 6, background: 'var(--cz-ink-900)', color: 'var(--cz-cream-050)', fontSize: 13 }}>Atendemos sim! Para Unimed temos Dermatologia e Cardiologia. Quer que eu veja os horários desta semana?</div>
            </div>
          </Card>
          <Card header="Desempenho · 30 dias" padding={16}>
            <div style={{ display: 'grid', gap: 12 }}>
              <ProgressBar label="Resolvidas sem humano" caption="64%" value={64} />
              <ProgressBar label="Agendamentos feitos pela IA" caption="188" value={188} max={312} tone="success" />
              <ProgressBar label="Escalonadas por insatisfação" caption="5%" value={5} tone="danger" />
            </div>
          </Card>
          <Banner tone="lime" title="Sugestão do agente">3 perguntas recorrentes sem resposta na base: estacionamento, horário de sábado e reembolso.</Banner>
        </div>
      </div>
    </div>
  );
}

/* ── Automações ─────────────────────────────────────────────────── */
const AUTOS = [
  { id: 'a1', nome: 'Confirmação de consulta', icon: 'calendar-check', on: true, desc: 'Dispara 24h antes do horário marcado, às 09:00.', stat: '128 envios hoje · 87,2% de confirmação' },
  { id: 'a2', nome: 'Pós-falta', icon: 'user-x', on: true, desc: 'Mensagem 2h após a falta, oferecendo remarcação.', stat: '14 envios na semana · 6 remarcações' },
  { id: 'a3', nome: 'Follow-up de orçamento', icon: 'repeat', on: true, desc: 'Sequência em D+1, D+3 e D+7 para orçamentos sem resposta.', stat: '62 leads em sequência · 21% de resposta' },
  { id: 'a4', nome: 'Lista de espera', icon: 'zap', on: false, desc: 'Oferece a vaga cancelada por ordem de prioridade.', stat: 'Pausada desde 12/09' },
];
function ScreenAutomacoes() {
  const [sel, setSel] = React.useState('a1');
  const [states, setStates] = React.useState(Object.fromEntries(AUTOS.map((a) => [a.id, a.on])));
  const cur = AUTOS.find((a) => a.id === sel);
  return (
    <div style={{ padding: 'var(--page-gutter)', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 }}>
      <PageHeader title="Automações" description="Quatro fluxos pré-definidos. Ligue, ajuste o texto e o horário — o resto é da Conduzza."
        actions={<Button variant="secondary" icon="history">Histórico de envios</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 16, flex: 1, minHeight: 0, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 10 }}>
          {AUTOS.map((a) => (
            <Card key={a.id} interactive padding={14} onClick={() => setSel(a.id)} style={{ border: `1px solid ${a.id === sel ? 'var(--cz-lime-400)' : 'var(--border-hairline)'}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: states[a.id] ? 'var(--cz-lime-050)' : 'var(--cz-ink-050)', flex: '0 0 auto' }}>
                  <Icon name={a.icon} size={17} color={states[a.id] ? 'var(--cz-lime-700)' : 'var(--cz-ink-400)'} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)' }}>{a.nome}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{a.desc}</div>
                  <div className="cz-num" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>{a.stat}</div>
                </div>
                <Switch size="sm" checked={states[a.id]} onChange={(v) => setStates((s) => ({ ...s, [a.id]: v }))} />
              </div>
            </Card>
          ))}
        </div>
        <Card header={cur.nome} actions={<Badge tone={states[cur.id] ? 'success' : 'neutral'} dot size="sm">{states[cur.id] ? 'Ativa' : 'Pausada'}</Badge>} padding={16}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Select label="Quando disparar" options={['24h antes', '48h antes', '3h antes']} />
              <Input label="Horário do disparo" defaultValue="09:00" suffix="BRT" />
            </div>
            <Textarea label="Mensagem" rows={5} counter={320} defaultValue={'Olá, {primeiro_nome}! 👋\nConfirmando sua consulta com {profissional} em {data} às {hora}, na {unidade}.\n\nResponda 1 para confirmar ou 2 para remarcar.'} hint="Variáveis disponíveis: {primeiro_nome}, {profissional}, {data}, {hora}, {unidade}, {convenio}" />
            <div>
              <div className="cz-eyebrow" style={{ marginBottom: 8 }}>Aplicar a</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <Checkbox checked label="Todas as unidades" onChange={() => {}} />
                <Checkbox checked label="Consultas particulares e por convênio" onChange={() => {}} />
                <Checkbox label="Incluir procedimentos de retorno" onChange={() => {}} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
              <Button variant="ghost">Descartar</Button>
              <Button variant="primary" icon="check">Salvar automação</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenResultados, ScreenIA, ScreenAutomacoes });
