// Mock data for the Conduzza Chat UI kit. Nothing here is real patient data.
const CLINIC = { name: 'Clínica Vitta', unit: 'Unidade Centro', user: 'Rafaela Souza', role: 'Atendimento' };

const NAV = [
  { id: 'inicio', label: 'Início', icon: 'house' },
  { id: 'atendimento', label: 'Atendimento', icon: 'messages-square', count: 12 },
  { id: 'leads', label: 'Leads', icon: 'user-plus', count: 38 },
  { id: 'agenda', label: 'Agenda', icon: 'calendar-days' },
  { id: 'pacientes', label: 'Pacientes', icon: 'users' },
  { section: 'Operação do dia' },
  { id: 'confirmacoes', label: 'Confirmações', icon: 'calendar-check', count: 19 },
  { id: 'espera', label: 'Lista de espera', icon: 'clock', count: 7 },
  { id: 'resultados', label: 'Resultados', icon: 'chart-column' },
  { section: 'Inteligência' },
  { id: 'ia', label: 'Agente de IA', icon: 'sparkles' },
  { id: 'automacoes', label: 'Automações', icon: 'workflow' },
  { section: 'Administração' },
  { id: 'cadastro', label: 'Cadastro', icon: 'folder-cog' },
  { id: 'config', label: 'Configurações', icon: 'settings' },
];

const TAGS = {
  primeira: { label: 'Primeira consulta', color: '#b2e54f' },
  remarcacao: { label: 'Remarcação', color: '#d9962a' },
  convenio: { label: 'Convênio', color: '#4785b5' },
  meta: { label: 'Meta Ads', color: '#0866ff' },
  indicacao: { label: 'Indicação', color: '#2f9e5b' },
  urgente: { label: 'Urgente', color: '#d4553d' },
};

const CONVERSAS = [
  { id: 'c1', name: 'Mariana Alves', phone: '(11) 98812-4409', preview: 'Consigo remarcar pra quinta?', time: '14:28', unread: 2, tags: [TAGS.remarcacao], assignee: 'Rafaela', stage: 'Em atendimento' },
  { id: 'c2', name: 'Paulo Nogueira', phone: '(11) 99714-2280', preview: 'Horários disponíveis: 10:30, 15:00', time: '13:02', unread: 0, aiHandled: true, tags: [TAGS.primeira], stage: 'Agente de IA' },
  { id: 'c3', name: 'Tatiane Moraes', phone: '(21) 98130-7755', preview: 'Bom dia! Qual o valor da harmonização?', time: '11:47', unread: 1, tags: [TAGS.meta], stage: 'Novo' },
  { id: 'c4', name: 'Camila Fontes', phone: '(11) 97455-1120', preview: 'Obrigada! Até quinta então 😊', time: '10:15', unread: 0, tags: [TAGS.convenio], assignee: 'Diego', stage: 'Resolvido' },
  { id: 'c5', name: 'Bruno Tavares', phone: '(11) 99631-8842', preview: 'Vocês atendem Unimed?', time: 'ontem', unread: 0, tags: [TAGS.convenio], assignee: 'Rafaela', stage: 'Em atendimento' },
  { id: 'c6', name: 'Renata Lopes', phone: '(11) 98120-3377', preview: 'Agente: enviei o endereço da unidade.', time: 'ontem', unread: 0, aiHandled: true, stage: 'Agente de IA' },
  { id: 'c7', name: 'Sofia Duarte', phone: '(11) 99002-4418', preview: 'Preciso cancelar, surgiu um imprevisto.', time: 'ontem', unread: 0, tags: [TAGS.urgente], stage: 'Novo' },
  { id: 'c8', name: 'Eduardo Prado', phone: '(11) 98771-6603', preview: 'Confirmado, obrigado!', time: 'seg', unread: 0, stage: 'Resolvido' },
];

const THREAD = [
  { from: 'in', time: '14:22', text: 'Oi! Bom dia 😊' },
  { from: 'ai', author: 'Agente Conduzza', time: '14:22', status: 'read', text: 'Bom dia, Mariana! Aqui é o atendimento da Clínica Vitta. Como posso ajudar?' },
  { from: 'in', time: '14:26', text: 'Consigo remarcar minha consulta de amanhã pra quinta?' },
  { from: 'ai', author: 'Agente Conduzza', time: '14:27', status: 'read', text: 'Claro. Na quinta-feira (24/09) a Dra. Helena tem 10:30 e 15:00. Qual horário prefere?' },
  { from: 'in', time: '14:28', text: 'Pode ser 10:30. Segue o pedido de exame que o convênio pediu.', attachment: { name: 'pedido-exame.pdf', icon: 'file-text' } },
  { from: 'note', time: '14:28', text: 'Agente transferiu: paciente anexou documento — revisar antes de confirmar.' },
  { from: 'out', author: 'Rafaela', time: '14:30', status: 'read', text: 'Oi Mariana! Recebi o pedido. Remarquei para quinta, 24/09, às 10:30 com a Dra. Helena.' },
  { from: 'out', author: 'Rafaela', time: '14:30', status: 'sent', text: 'Chegue 15 minutos antes e traga documento com foto e a carteirinha do convênio.' },
];

const LEAD_STAGES = [
  { id: 'novo', label: 'Novo contato', tone: 'var(--cz-ink-400)' },
  { id: 'qualificando', label: 'Qualificando', tone: 'var(--cz-info-500)' },
  { id: 'orcamento', label: 'Orçamento enviado', tone: 'var(--cz-warning-500)' },
  { id: 'agendando', label: 'Agendando', tone: 'var(--cz-lime-500)' },
  { id: 'perdido', label: 'Perdido', tone: 'var(--cz-danger-500)' },
];

const LEADS = [
  { id: 'l1', stage: 'novo', name: 'Tatiane Moraes', phone: '(21) 98130-7755', meta: 'Interesse: Harmonização facial', tags: [TAGS.meta], owner: 'Rafaela', value: 'R$ 1.200', waiting: '2h' },
  { id: 'l2', stage: 'novo', name: 'Juliana Reis', phone: '(11) 99845-2210', meta: 'Veio do anúncio "Check-up 2026"', tags: [TAGS.meta], waiting: '5h' },
  { id: 'l3', stage: 'qualificando', name: 'Marcos Antunes', phone: '(11) 98221-9034', meta: 'Quer saber se atende Bradesco Saúde', tags: [TAGS.convenio], owner: 'Diego', waiting: '1d' },
  { id: 'l4', stage: 'qualificando', name: 'Letícia Barros', phone: '(11) 99310-7788', meta: 'Indicação da paciente Camila Fontes', tags: [TAGS.indicacao], owner: 'Rafaela', waiting: '1d 3h' },
  { id: 'l5', stage: 'orcamento', name: 'Bruno Tavares', phone: '(11) 99714-2280', meta: 'Sem resposta há 3 dias', urgent: true, owner: 'Rafaela', value: 'R$ 2.800', waiting: '3d' },
  { id: 'l6', stage: 'orcamento', name: 'Aline Castro', phone: '(11) 98004-1155', meta: 'Pediu parcelamento em 6x', owner: 'Diego', value: 'R$ 3.400', waiting: '2d' },
  { id: 'l7', stage: 'agendando', name: 'Felipe Dourado', phone: '(11) 97788-6621', meta: 'Escolhendo entre quinta e sexta', tags: [TAGS.primeira], owner: 'Rafaela', value: 'R$ 890', waiting: '4h' },
  { id: 'l8', stage: 'agendando', name: 'Priscila Nunes', phone: '(11) 99120-4477', meta: 'Aguardando autorização do convênio', tags: [TAGS.convenio], owner: 'Diego', value: 'R$ 640', waiting: '6h' },
  { id: 'l9', stage: 'perdido', name: 'Henrique Salles', phone: '(11) 98890-3312', meta: 'Achou o valor alto — reativar em 60 dias', waiting: '12d' },
];

const PROFISSIONAIS = [
  { id: 'p1', nome: 'Dra. Helena Reis', esp: 'Dermatologia', sala: 'Sala 2' },
  { id: 'p2', nome: 'Dr. Caio Prado', esp: 'Cardiologia', sala: 'Sala 4' },
  { id: 'p3', nome: 'Dra. Lívia Monteiro', esp: 'Ginecologia', sala: 'Sala 1' },
];

const AGENDA = {
  p1: [
    { start: '08:00', end: '08:30', patient: 'Mariana Alves', procedure: 'Retorno', status: 'confirmado' },
    { start: '08:30', end: '09:00', patient: 'Paulo Nogueira', procedure: 'Primeira consulta', status: 'confirmado' },
    { start: '09:00', end: '09:15', patient: 'Encaixe — Lia Rocha', status: 'encaixe', compact: true },
    { start: '09:30', end: '10:00', patient: 'Camila Fontes', procedure: 'Avaliação', status: 'aguardando' },
    { start: '10:30', end: '11:00', patient: 'Eduardo Prado', procedure: 'Retorno', status: 'confirmado' },
    { start: '11:00', end: '12:00', patient: 'Almoço', status: 'bloqueio', compact: true },
  ],
  p2: [
    { start: '08:00', end: '09:00', patient: 'Tatiane Moraes', procedure: 'Ecocardiograma', status: 'confirmado' },
    { start: '09:00', end: '09:30', patient: 'Bruno Tavares', procedure: 'Retorno', status: 'cancelado' },
    { start: '10:00', end: '10:30', patient: 'Marcos Antunes', procedure: 'Primeira consulta', status: 'aguardando' },
    { start: '11:00', end: '11:30', patient: 'Aline Castro', procedure: 'MAPA 24h', status: 'confirmado' },
  ],
  p3: [
    { start: '08:15', end: '08:45', patient: 'Renata Lopes', procedure: 'Preventivo', status: 'confirmado' },
    { start: '08:45', end: '09:15', patient: 'Sofia Duarte', procedure: 'Primeira consulta', status: 'aguardando' },
    { start: '09:30', end: '10:00', patient: 'Letícia Barros', procedure: 'Retorno', status: 'confirmado' },
    { start: '10:30', end: '11:00', patient: 'Priscila Nunes', procedure: 'Ultrassom', status: 'confirmado' },
  ],
};

const PACIENTES = [
  { id: 'pa1', nome: 'Mariana Alves', tel: '(11) 98812-4409', nasc: '14/03/1991', convenio: 'Amil', prof: 'Dra. Helena Reis', ultima: '12/09/2026', proxima: '24/09/2026', status: 'ativo' },
  { id: 'pa2', nome: 'Paulo Nogueira', tel: '(11) 99714-2280', nasc: '02/11/1978', convenio: 'Particular', prof: 'Dr. Caio Prado', ultima: '04/09/2026', proxima: '—', status: 'ativo' },
  { id: 'pa3', nome: 'Camila Fontes', tel: '(11) 97455-1120', nasc: '27/06/1985', convenio: 'Bradesco Saúde', prof: 'Dra. Helena Reis', ultima: '28/08/2026', proxima: '30/09/2026', status: 'ativo' },
  { id: 'pa4', nome: 'Eduardo Prado', tel: '(11) 98771-6603', nasc: '19/01/1966', convenio: 'Unimed', prof: 'Dr. Caio Prado', ultima: '15/08/2026', proxima: '—', status: 'inativo' },
  { id: 'pa5', nome: 'Renata Lopes', tel: '(11) 98120-3377', nasc: '08/09/1994', convenio: 'Particular', prof: 'Dra. Lívia Monteiro', ultima: '22/09/2026', proxima: '22/10/2026', status: 'ativo' },
  { id: 'pa6', nome: 'Sofia Duarte', tel: '(11) 99002-4418', nasc: '30/04/1999', convenio: 'SulAmérica', prof: 'Dra. Lívia Monteiro', ultima: '09/09/2026', proxima: '—', status: 'pendente' },
];

const CONFIRMACOES = [
  { id: 'cf1', hora: '08:00', paciente: 'Mariana Alves', prof: 'Dra. Helena Reis', proc: 'Retorno', canal: 'WhatsApp', status: 'confirmado', enviado: '09:02' },
  { id: 'cf2', hora: '08:30', paciente: 'Paulo Nogueira', prof: 'Dra. Helena Reis', proc: 'Primeira consulta', canal: 'WhatsApp', status: 'confirmado', enviado: '09:02' },
  { id: 'cf3', hora: '09:00', paciente: 'Marcos Antunes', prof: 'Dr. Caio Prado', proc: 'Primeira consulta', canal: 'WhatsApp', status: 'aguardando', enviado: '09:02' },
  { id: 'cf4', hora: '09:30', paciente: 'Camila Fontes', prof: 'Dra. Helena Reis', proc: 'Avaliação', canal: 'WhatsApp', status: 'aguardando', enviado: '09:02' },
  { id: 'cf5', hora: '10:00', paciente: 'Bruno Tavares', prof: 'Dr. Caio Prado', proc: 'Retorno', canal: 'WhatsApp', status: 'cancelado', enviado: '09:02' },
  { id: 'cf6', hora: '10:30', paciente: 'Eduardo Prado', prof: 'Dr. Caio Prado', proc: 'Retorno', canal: 'Ligação', status: 'confirmado', enviado: '09:14' },
  { id: 'cf7', hora: '11:00', paciente: 'Aline Castro', prof: 'Dr. Caio Prado', proc: 'MAPA 24h', canal: 'WhatsApp', status: 'confirmado', enviado: '09:02' },
  { id: 'cf8', hora: '11:30', paciente: 'Sofia Duarte', prof: 'Dra. Lívia Monteiro', proc: 'Primeira consulta', canal: 'WhatsApp', status: 'falhou', enviado: '09:02' },
];

const ESPERA = [
  { id: 'e1', paciente: 'Juliana Reis', tel: '(11) 99845-2210', prof: 'Dra. Helena Reis', pref: 'Manhã · seg a qua', desde: '18/09/2026', prio: 'alta' },
  { id: 'e2', paciente: 'Felipe Dourado', tel: '(11) 97788-6621', prof: 'Qualquer', pref: 'Tarde · qui ou sex', desde: '19/09/2026', prio: 'media' },
  { id: 'e3', paciente: 'Letícia Barros', tel: '(11) 99310-7788', prof: 'Dra. Lívia Monteiro', pref: 'Manhã · sábado', desde: '20/09/2026', prio: 'alta' },
  { id: 'e4', paciente: 'Marcos Antunes', tel: '(11) 98221-9034', prof: 'Dr. Caio Prado', pref: 'Qualquer horário', desde: '20/09/2026', prio: 'baixa' },
  { id: 'e5', paciente: 'Priscila Nunes', tel: '(11) 99120-4477', prof: 'Dra. Lívia Monteiro', pref: 'Tarde · seg a sex', desde: '21/09/2026', prio: 'media' },
];

const QUICK_REPLIES = ['Bom dia! 👋', 'Confirmar presença', 'Enviar endereço', 'Valores e convênios', 'Documentos necessários'];

Object.assign(window, { CLINIC, NAV, TAGS, CONVERSAS, THREAD, LEAD_STAGES, LEADS, PROFISSIONAIS, AGENDA, PACIENTES, CONFIRMACOES, ESPERA, QUICK_REPLIES });
