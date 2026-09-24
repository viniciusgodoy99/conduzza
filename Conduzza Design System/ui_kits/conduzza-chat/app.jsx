const DSapp = window.ConduzzaDesignSystem_cea3ac;
const { SidebarNav, TopBar, SearchField, IconButton, Avatar, Badge, Toast, Button, Icon } = DSapp;

const TITLES = {
  inicio: ['Início', 'Painel do dia'],
  atendimento: ['Atendimento', 'Conversas de WhatsApp'],
  leads: ['Leads', 'Contatos que ainda não viraram pacientes'],
  agenda: ['Agenda', 'Todos os profissionais'],
  pacientes: ['Pacientes', 'Base de contatos atendidos'],
  confirmacoes: ['Confirmações', 'Consultas de hoje'],
  espera: ['Lista de espera', 'Encaixes e cancelamentos'],
  resultados: ['Resultados', 'Marketing, comercial e IA'],
  ia: ['Agente de IA', 'Configuração do atendimento automático'],
  automacoes: ['Automações', 'Fluxos pré-definidos'],
  cadastro: ['Cadastro', 'Profissionais, procedimentos e unidades'],
  config: ['Configurações', 'Usuários, conexões e estrutura'],
};

const SCREENS = {
  inicio: (go) => <ScreenInicio go={go} />,
  atendimento: () => <ScreenAtendimento />,
  leads: () => <ScreenLeads />,
  agenda: () => <ScreenAgenda />,
  pacientes: () => <ScreenPacientes />,
  confirmacoes: () => <ScreenConfirmacoes />,
  espera: () => <ScreenEspera />,
  resultados: () => <ScreenResultados />,
  ia: () => <ScreenIA />,
  automacoes: () => <ScreenAutomacoes />,
  cadastro: () => <ScreenCadastro />,
  config: () => <ScreenConfig />,
};

function App() {
  const [page, setPage] = React.useState('inicio');
  const [collapsed, setCollapsed] = React.useState(false);
  const [toast, setToast] = React.useState(false);
  const go = (id) => { setPage(id); };
  const [title, sub] = TITLES[page] || TITLES.inicio;
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--canvas)' }}>
      <SidebarNav collapsed={collapsed} items={NAV} active={page} onNavigate={go}
        brand={collapsed
          ? <img src="../../assets/symbol-lime.png" alt="Conduzza" style={{ width: 26, height: 26, margin: '0 auto' }} />
          : <img src="../../assets/logo-lockup-on-dark.png" alt="Conduzza" style={{ height: 20, width: 'auto' }} />}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Avatar name={CLINIC.user} size="sm" status="online" />
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--cz-cream-050)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{CLINIC.user}</div>
                <div style={{ fontSize: 10.5, color: 'var(--cz-ink-400)' }}>{CLINIC.role}</div>
              </div>
            )}
            {!collapsed && <IconButton icon="log-out" label="Sair" size="sm" style={{ color: 'rgba(251,252,232,.45)' }} />}
          </div>
        } />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar title={title} breadcrumb={`${CLINIC.name.toUpperCase()} · ${CLINIC.unit.toUpperCase()}`}>
          <IconButton icon={collapsed ? 'panel-left-open' : 'panel-left-close'} label="Recolher menu" onClick={() => setCollapsed((c) => !c)} />
          <SearchField shortcut="⌘K" placeholder="Buscar conversas, pacientes, telefones…" style={{ width: 300 }} />
          <Badge tone="success" dot size="sm">WhatsApp on-line</Badge>
          <IconButton icon="bell" label="Notificações" badge={3} onClick={() => setToast(true)} />
          <IconButton icon="circle-help" label="Ajuda" />
          <Avatar name={CLINIC.user} size="sm" />
        </TopBar>
        <main className="cz-scroll" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="cz-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}>
            {(SCREENS[page] || SCREENS.inicio)(go)}
          </div>
        </main>
      </div>
      {toast && (
        <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 200 }}>
          <Toast title="3 novas mensagens" description="Tatiane Moraes, Sofia Duarte e mais 1." onDismiss={() => setToast(false)}
            action={<Button size="sm" variant="ghost" style={{ color: 'var(--cz-lime-400)' }} onClick={() => { setToast(false); go('atendimento'); }}>Abrir</Button>} />
        </div>
      )}
    </div>
  );
}

// Babel executes external text/babel files as they resolve, not in document
// order — so wait until every screen and the mock data have registered.
const DEPS = ['NAV', 'CLINIC', 'ScreenInicio', 'ScreenAtendimento', 'ScreenLeads', 'ScreenAgenda', 'ScreenPacientes', 'ScreenConfirmacoes', 'ScreenEspera', 'ScreenResultados', 'ScreenIA', 'ScreenAutomacoes', 'ScreenCadastro', 'ScreenConfig'];
function boot() {
  if (DEPS.some((d) => !window[d])) { requestAnimationFrame(boot); return; }
  if (!window.__czRoot) window.__czRoot = ReactDOM.createRoot(document.getElementById('root'));
  window.__czRoot.render(<App />);
}
boot();
