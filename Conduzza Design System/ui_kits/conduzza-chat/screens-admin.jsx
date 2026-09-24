const DSd = window.ConduzzaDesignSystem_cea3ac;
const { Card, Badge, Button, IconButton, Icon, Avatar, SegmentedControl, SearchField, Select, Input, Switch, Checkbox, DataTable, StatCard, EmptyState, PageHeader, Tabs, Banner, Tag, Dropdown } = DSd;

/* ── Cadastro ───────────────────────────────────────────────────── */
const CAD_TABS = [
  { value: 'profissionais', label: 'Profissionais', count: 14 },
  { value: 'procedimentos', label: 'Procedimentos', count: 62 },
  { value: 'convenios', label: 'Planos de saúde', count: 9 },
  { value: 'horarios', label: 'Horários' },
  { value: 'unidades', label: 'Unidades', count: 3 },
];
const CAD_ROWS = {
  profissionais: {
    cols: [
      { key: 'nome', header: 'Profissional', strong: true, render: (r) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={r.nome} size="xs" />{r.nome}</span> },
      { key: 'esp', header: 'Especialidade' },
      { key: 'crm', header: 'CRM', numeric: true, muted: true },
      { key: 'unidade', header: 'Unidade', muted: true },
      { key: 'dur', header: 'Duração padrão', numeric: true, align: 'right', muted: true },
      { key: 'ativo', header: 'Status', render: (r) => <Badge size="sm" dot tone={r.ativo ? 'success' : 'neutral'}>{r.ativo ? 'Ativo' : 'Inativo'}</Badge> },
    ],
    rows: [
      { id: '1', nome: 'Dra. Helena Reis', esp: 'Dermatologia', crm: 'CRM/SP 118.402', unidade: 'Centro', dur: '30 min', ativo: true },
      { id: '2', nome: 'Dr. Caio Prado', esp: 'Cardiologia', crm: 'CRM/SP 96.771', unidade: 'Centro', dur: '40 min', ativo: true },
      { id: '3', nome: 'Dra. Lívia Monteiro', esp: 'Ginecologia', crm: 'CRM/SP 132.559', unidade: 'Centro · Sul', dur: '30 min', ativo: true },
      { id: '4', nome: 'Dr. Otávio Lins', esp: 'Ortopedia', crm: 'CRM/SP 104.318', unidade: 'Sul', dur: '30 min', ativo: false },
    ],
  },
  procedimentos: {
    cols: [
      { key: 'nome', header: 'Procedimento', strong: true },
      { key: 'esp', header: 'Especialidade', muted: true },
      { key: 'dur', header: 'Duração', numeric: true, align: 'right', muted: true },
      { key: 'valor', header: 'Particular', numeric: true, align: 'right' },
      { key: 'conv', header: 'Convênios', muted: true },
    ],
    rows: [
      { id: '1', nome: 'Consulta dermatológica', esp: 'Dermatologia', dur: '30 min', valor: 'R$ 380,00', conv: 'Amil, Bradesco, SulAmérica' },
      { id: '2', nome: 'Harmonização facial', esp: 'Dermatologia', dur: '60 min', valor: 'R$ 1.200,00', conv: 'Particular' },
      { id: '3', nome: 'Ecocardiograma', esp: 'Cardiologia', dur: '45 min', valor: 'R$ 540,00', conv: 'Amil, Unimed' },
      { id: '4', nome: 'MAPA 24h', esp: 'Cardiologia', dur: '20 min', valor: 'R$ 320,00', conv: 'Unimed' },
      { id: '5', nome: 'Preventivo', esp: 'Ginecologia', dur: '30 min', valor: 'R$ 290,00', conv: 'Todos' },
    ],
  },
  convenios: {
    cols: [
      { key: 'nome', header: 'Plano', strong: true },
      { key: 'reg', header: 'Registro ANS', numeric: true, muted: true },
      { key: 'prazo', header: 'Prazo de repasse', numeric: true, align: 'right', muted: true },
      { key: 'ativo', header: 'Status', render: (r) => <Badge size="sm" dot tone={r.ativo ? 'success' : 'warning'}>{r.ativo ? 'Ativo' : 'Em negociação'}</Badge> },
    ],
    rows: [
      { id: '1', nome: 'Amil', reg: '326.305', prazo: '45 dias', ativo: true },
      { id: '2', nome: 'Bradesco Saúde', reg: '005.711', prazo: '60 dias', ativo: true },
      { id: '3', nome: 'SulAmérica', reg: '006.246', prazo: '30 dias', ativo: true },
      { id: '4', nome: 'Unimed', reg: '339.679', prazo: '45 dias', ativo: true },
      { id: '5', nome: 'Porto Seguro', reg: '416.746', prazo: '—', ativo: false },
    ],
  },
  unidades: {
    cols: [
      { key: 'nome', header: 'Unidade', strong: true },
      { key: 'end', header: 'Endereço', muted: true, wrap: true },
      { key: 'salas', header: 'Salas', numeric: true, align: 'right' },
      { key: 'tel', header: 'WhatsApp', numeric: true, muted: true },
    ],
    rows: [
      { id: '1', nome: 'Unidade Centro', end: 'R. Augusta, 1.402 — Consolação, São Paulo', salas: '6', tel: '(11) 3255-8800' },
      { id: '2', nome: 'Unidade Sul', end: 'Av. Santo Amaro, 3.120 — Brooklin, São Paulo', salas: '4', tel: '(11) 3255-8801' },
      { id: '3', nome: 'Unidade Alphaville', end: 'Al. Rio Negro, 585 — Barueri', salas: '3', tel: '(11) 3255-8802' },
    ],
  },
};

function ScreenCadastro() {
  const [tab, setTab] = React.useState('profissionais');
  const cfg = CAD_ROWS[tab];
  return (
    <div style={{ padding: 'var(--page-gutter)', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 }}>
      <PageHeader eyebrow="ADMINISTRAÇÃO" title="Cadastro" description="A base que alimenta a agenda, o agente de IA e as automações."
        actions={<><SearchField size="sm" placeholder="Buscar no cadastro" style={{ width: 220 }} /><Button variant="primary" icon="plus">Novo registro</Button></>} />
      <Tabs value={tab} onChange={setTab} items={CAD_TABS} />
      {tab === 'horarios' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
          <Card header="Horário de funcionamento · Unidade Centro" padding={16}>
            <div style={{ display: 'grid', gap: 10 }}>
              {[['Segunda', '07:00', '19:00', true], ['Terça', '07:00', '19:00', true], ['Quarta', '07:00', '19:00', true], ['Quinta', '07:00', '19:00', true], ['Sexta', '07:00', '18:00', true], ['Sábado', '08:00', '12:00', true], ['Domingo', '—', '—', false]].map(([d, a, b, on]) => (
                <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Switch size="sm" checked={on} onChange={() => {}} />
                  <span style={{ width: 78, fontSize: 13, color: 'var(--text-body)' }}>{d}</span>
                  <Input size="sm" defaultValue={a} block={false} wrapStyle={{ width: 84 }} />
                  <span style={{ color: 'var(--text-faint)' }}>—</span>
                  <Input size="sm" defaultValue={b} block={false} wrapStyle={{ width: 84 }} />
                </div>
              ))}
            </div>
          </Card>
          <div style={{ display: 'grid', gap: 16 }}>
            <Card header="Intervalos e bloqueios" padding={16}>
              <div style={{ display: 'grid', gap: 10 }}>
                {[['Almoço', 'Seg a sex · 12:00 – 13:00'], ['Reunião clínica', 'Quarta · 18:00 – 19:00'], ['Feriado — 12/10', 'Dia inteiro']].map(([t, s]) => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)' }}>
                    <Icon name="ban" size={15} color="var(--cz-ink-400)" />
                    <span style={{ flex: 1, fontSize: 12.5 }}><strong style={{ color: 'var(--text-strong)' }}>{t}</strong><br /><span className="cz-num" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s}</span></span>
                    <IconButton icon="pencil" label="Editar" size="sm" />
                  </div>
                ))}
              </div>
            </Card>
            <Card header="Regras de encaixe" padding={16}>
              <div style={{ display: 'grid', gap: 10 }}>
                <Switch checked label="Permitir encaixe entre consultas" description="Máximo de 2 por período" onChange={() => {}} />
                <Switch checked label="Oferecer vaga à lista de espera" description="Automático em até 5 minutos após o cancelamento" onChange={() => {}} />
                <Switch label="Permitir agendamento no mesmo dia pela IA" onChange={() => {}} />
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <Card padding={0} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <DataTable rows={cfg.rows} columns={[...cfg.cols, { key: 'acoes', header: '', align: 'right', render: () => <Dropdown align="right" trigger={<IconButton icon="ellipsis" label="Ações" size="sm" />} items={[{ label: 'Editar', icon: 'pencil' }, { label: 'Duplicar', icon: 'copy' }, { divider: true }, { label: 'Excluir', icon: 'trash-2', danger: true }]} /> }]} />
        </Card>
      )}
    </div>
  );
}

/* ── Configurações ──────────────────────────────────────────────── */
const CFG_TABS = [
  { value: 'usuarios', label: 'Usuários', count: 8 },
  { value: 'permissoes', label: 'Permissões' },
  { value: 'whatsapp', label: 'WhatsApp', count: 3 },
  { value: 'jornada', label: 'Etapas da jornada' },
  { value: 'etiquetas', label: 'Etiquetas', count: 12 },
  { value: 'meta', label: 'Anúncios Meta' },
];
function ScreenConfig() {
  const [tab, setTab] = React.useState('whatsapp');
  return (
    <div className="cz-scroll" style={{ padding: 'var(--page-gutter)', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0, overflowY: 'auto' }}>
      <PageHeader eyebrow="ADMINISTRAÇÃO" title="Configurações" description="Acessos, conexões e a estrutura que o time usa todos os dias." />
      <Tabs value={tab} onChange={setTab} items={CFG_TABS} />

      {tab === 'whatsapp' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <Banner tone="warning" title="A sessão da Unidade Sul expira em 2 dias" action={<Button size="sm" variant="ghost">Reconectar agora</Button>}>Reconecte pelo QR Code para não interromper os disparos.</Banner>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
            {[['Unidade Centro', '(11) 3255-8800', 'conectado', '2.140 mensagens hoje'], ['Unidade Sul', '(11) 3255-8801', 'expirando', '812 mensagens hoje'], ['Unidade Alphaville', '(11) 3255-8802', 'conectado', '468 mensagens hoje']].map(([n, t, st, m]) => (
              <Card key={n} padding={16}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: 'rgba(37,211,102,.12)' }}><Icon name="message-circle" size={16} color="var(--cz-whatsapp)" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)' }}>{n}</div>
                    <div className="cz-num" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t}</div>
                  </div>
                </div>
                <Badge dot size="sm" tone={st === 'conectado' ? 'success' : 'warning'}>{st === 'conectado' ? 'Conectado' : 'Expirando'}</Badge>
                <div className="cz-num" style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 10 }}>{m}</div>
                <div style={{ marginTop: 12, display: 'flex', gap: 6 }}><Button size="sm" variant="secondary" icon="qr-code" block>Reconectar</Button></div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === 'usuarios' && (
        <Card padding={0}>
          <DataTable rows={[
            { id: '1', nome: 'Rafaela Souza', email: 'rafaela@clinicavitta.com.br', papel: 'Atendimento', unid: 'Centro', ult: 'agora' },
            { id: '2', nome: 'Diego Ramires', email: 'diego@clinicavitta.com.br', papel: 'Atendimento', unid: 'Centro · Sul', ult: 'há 12 min' },
            { id: '3', nome: 'Patrícia Lemos', email: 'patricia@clinicavitta.com.br', papel: 'Gestor', unid: 'Todas', ult: 'há 2 h' },
            { id: '4', nome: 'Marcelo Vieira', email: 'marcelo@clinicavitta.com.br', papel: 'Administrador', unid: 'Todas', ult: 'ontem' },
          ]} columns={[
            { key: 'nome', header: 'Usuário', strong: true, render: (r) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={r.nome} size="xs" />{r.nome}</span> },
            { key: 'email', header: 'E-mail', muted: true },
            { key: 'papel', header: 'Papel', render: (r) => <Badge size="sm" tone={r.papel === 'Administrador' ? 'inverse' : r.papel === 'Gestor' ? 'lime' : 'neutral'}>{r.papel}</Badge> },
            { key: 'unid', header: 'Unidades', muted: true },
            { key: 'ult', header: 'Último acesso', align: 'right', muted: true },
          ]} />
        </Card>
      )}

      {tab === 'permissoes' && (
        <Card padding={0}>
          <DataTable rows={[
            { id: '1', rec: 'Ver todas as conversas', at: false, ge: true, ad: true },
            { id: '2', rec: 'Transferir atendimento', at: true, ge: true, ad: true },
            { id: '3', rec: 'Editar agenda de outros profissionais', at: false, ge: true, ad: true },
            { id: '4', rec: 'Publicar alterações no agente de IA', at: false, ge: false, ad: true },
            { id: '5', rec: 'Ver Resultados financeiros', at: false, ge: true, ad: true },
            { id: '6', rec: 'Gerenciar usuários e conexões', at: false, ge: false, ad: true },
          ]} columns={[
            { key: 'rec', header: 'Permissão', strong: true, wrap: true },
            { key: 'at', header: 'Atendimento', align: 'center', render: (r) => <Checkbox checked={r.at} onChange={() => {}} /> },
            { key: 'ge', header: 'Gestor', align: 'center', render: (r) => <Checkbox checked={r.ge} onChange={() => {}} /> },
            { key: 'ad', header: 'Administrador', align: 'center', render: (r) => <Checkbox checked={r.ad} onChange={() => {}} /> },
          ]} />
        </Card>
      )}

      {tab === 'jornada' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
          <Card header="Etapas do atendimento" actions={<Button size="sm" variant="ghost" icon="plus">Etapa</Button>} padding={14}>
            <div style={{ display: 'grid', gap: 8 }}>
              {['Novo', 'Em atendimento', 'Agente de IA', 'Agendado', 'Resolvido'].map((s, i) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)' }}>
                  <Icon name="grip-vertical" size={14} color="var(--cz-ink-300)" />
                  <span className="cz-num" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text-body)' }}>{s}</span>
                  <IconButton icon="pencil" label="Renomear" size="sm" />
                </div>
              ))}
            </div>
          </Card>
          <Card header="Etapas do funil de leads" actions={<Button size="sm" variant="ghost" icon="plus">Etapa</Button>} padding={14}>
            <div style={{ display: 'grid', gap: 8 }}>
              {LEAD_STAGES.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)' }}>
                  <Icon name="grip-vertical" size={14} color="var(--cz-ink-300)" />
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.tone }} />
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text-body)' }}>{s.label}</span>
                  <IconButton icon="pencil" label="Renomear" size="sm" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'etiquetas' && (
        <Card header="Etiquetas da clínica" actions={<Button size="sm" variant="primary" icon="plus">Nova etiqueta</Button>} padding={16}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[...Object.values(TAGS), { label: 'Pós-operatório', color: '#4785b5' }, { label: 'Retorno', color: '#2f9e5b' }, { label: 'Exame pendente', color: '#d9962a' }, { label: 'VIP', color: '#051813' }, { label: 'Reativação', color: '#7fb320' }, { label: 'Sem contato', color: '#8b9a92' }].map((t) => (
              <Tag key={t.label} color={t.color} onRemove={() => {}}>{t.label}</Tag>
            ))}
          </div>
        </Card>
      )}

      {tab === 'meta' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
          <Card header="Conta de anúncios" padding={16}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: 'rgba(8,102,255,.10)' }}><Icon name="at-sign" size={17} color="var(--cz-meta)" /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)' }}>Clínica Vitta — Ads</div>
                <div className="cz-num" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>act_408177291</div>
              </div>
              <Badge tone="success" dot size="sm">Conectada</Badge>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <Switch checked label="Importar leads do Facebook Lead Ads" description="Novos leads entram direto no Kanban" onChange={() => {}} />
              <Switch checked label="Traquear origem da conversa" description="Grava campanha, conjunto e anúncio no contato" onChange={() => {}} />
              <Switch checked label="Enviar conversões para o Meta" description="Agendamento e comparecimento via Conversions API" onChange={() => {}} />
            </div>
          </Card>
          <Card header="Etiqueta automática por campanha" padding={16}>
            <div style={{ display: 'grid', gap: 10 }}>
              {[['Check-up 2026 — Cardiologia', 'Meta Ads'], ['Harmonização facial — Setembro', 'Meta Ads'], ['Dermatologia — Remarketing', 'Reativação']].map(([c, t]) => (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</span>
                  <Icon name="arrow-right" size={13} color="var(--cz-ink-300)" />
                  <Tag color={t === 'Meta Ads' ? '#0866ff' : '#7fb320'} size="sm">{t}</Tag>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ScreenCadastro, ScreenConfig });
