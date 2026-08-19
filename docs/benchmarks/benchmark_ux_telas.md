# Benchmark de UX/UI para SaaS de Atendimento com IA para Clínicas
## Padrões de tela concretos para briefing de design

Data: 14 de agosto de 2026
Escopo: 5 blocos (Inbox WhatsApp multi-atendente, CRM/Kanban de leads, Agenda clínica, Dashboard de origem de lead, Dark mode e acessibilidade)
Método: leitura de documentação oficial de produto, help centers e especificações de design. Toda afirmação tem URL de fonte.

---

## BLOCO 1. Inbox de atendimento WhatsApp multi-atendente

### 1.1 A anatomia canônica: 4 regiões, da esquerda para a direita

O padrão dominante do mercado é uma tela de 4 regiões fixas. Chatwoot é o exemplo mais bem documentado e serve de esqueleto de referência.

Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics

**Região 1. Barra de navegação vertical (rail de ícones), largura fixa estreita**
Contém apenas ícones de seções macro do produto: Inbox, Conversas, Captain (IA), Contatos, Relatórios, Campanhas, Central de Ajuda e Configurações. Não contém dados de conversa. Serve para trocar de página, não para filtrar.
Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics

**Região 2. Lista de conversas (coluna média-esquerda), rolável**
No topo desta coluna ficam os controles de recorte, nesta ordem:
1. Abas de posse: "Mine" (minhas), "Unassigned" (sem atendente) e "All" (todas).
2. Filtros de status: Open, Pending, Snoozed, Resolved.
3. Visões adicionais: "Mentions" (onde alguém te marcou) e "Unattended" (atribuídas mas sem primeira resposta).
4. Filtros rápidos: caixas de entrada (canais), etiquetas, times e pastas salvas.
5. Busca que cobre conversas, mensagens, contatos e artigos.
Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics

**Região 3. Painel de conversa (centro)**
Histórico de mensagens com o cliente mais o compositor. O compositor tem abas de modo: "Reply", "Private Note" e "Email". A nota privada é um modo do mesmo campo, não uma tela separada.
Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics

**Região 4. Painel de contexto (direita), colapsável**
Dados do contato, histórico, conversas anteriores, atributos customizados, ações da conversa (atribuir, etiquetar, rotear para time, mudar status) e apps embutidos. A documentação afirma explicitamente que o painel direito pode ser colapsado para foco na leitura em telas menores.
Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics

O mesmo esqueleto de 3 a 4 colunas aparece em:
- respond.io: painel lateral (seleção de caixa e filtros), lista de conversas e sidebar vertical à direita com abas de Contato, Atividades, Anexos e integrações. Filtros do inbox padrão: "All", "Mine" e "Unassigned". Fonte: https://respond.io/help/inbox/inbox-overview
- Missive: sidebar de navegação, lista de conversas e conversa mais sidebar contextual à direita, com modos Fixed, Auto e Floating para o painel direito. Fonte: https://missiveapp.com/docs/get-started/missive-interface
- Umbler Talk: conversas ativas na coluna da esquerda, chat aberto no centro-direita, com painéis de controle. Fonte: https://help.umbler.com/hc/pt-br/articles/360060681832-O-que-%C3%A9-o-Umbler-Talk
- Digisac: abas principais "Chats", "Fila" e "Contatos", que separam e organizam os atendimentos por estágio e necessidade. Fonte: https://digisac.gitbook.io/manual-digisac-2-0/chat-de-atendimento

### 1.2 Onde exatamente mostrar atribuição de atendente

Três padrões coexistem, e o mais legível combina os três.

**Padrão A. Abas de posse na lista.** Chatwoot separa "Mine", "Unassigned" e "All" como abas de primeiro nível, e respond.io usa os mesmos três recortes.
Fontes: https://www.chatwoot.com/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics e https://respond.io/help/inbox/inbox-overview

**Padrão B. Campo "assignee" no cabeçalho da conversa.** Missive coloca a atribuição em um dropdown no cabeçalho, e permite atribuir a si mesmo, a colegas ou a times.
Fonte: https://missiveapp.com/docs/get-started/missive-interface

**Padrão C. Painel de identificação do atendimento.** O Digisac exibe em um painel dedicado três dados fixos: conexão vinculada ao contato, departamento onde o chamado está ocorrendo e usuário responsável pelo atendimento. Este é o padrão mais adequado para clínicas com recepção e vários canais, porque responde "de qual número veio" e "quem está com isso" sem clique.
Fonte: https://digisac.gitbook.io/manual-digisac-2-0/chat-de-atendimento/area-do-atendimento

Definição de assignee para o glossário do produto: pessoa do time a quem a conversa é atribuída e que assume a responsabilidade por respondê-la.
Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677141565-chatwoot-glossary

### 1.3 Tags e etiquetas

Chatwoot define label como "um adesivo digital para suas conversas, usado para categorizá-las", criado no nível da conta e reutilizável em toda a operação.
Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677141565-chatwoot-glossary

Consequência de design: etiquetas são um vocabulário controlado global, não texto livre por conversa. Para clínica, isso vira uma lista fechada do tipo "primeira consulta", "retorno", "convênio", "particular", "orçamento enviado", "no-show".

Umbler Talk também organiza conversas por etiquetas aplicáveis a partir do painel de conversas.
Fonte: https://help.umbler.com/hc/pt-br/articles/360060681832-O-que-%C3%A9-o-Umbler-Talk

Missive posiciona etiquetas visíveis na própria linha da lista de conversas, e não apenas dentro da conversa aberta.
Fonte: https://missiveapp.com/docs/get-started/missive-interface

### 1.4 Status de conversa: o modelo de 4 estados

Chatwoot documenta os quatro estados com definições operacionais precisas, e este é o modelo a copiar:
- Open: conversa pronta para ser assumida por um atendente.
- Pending: conversa ainda não pronta para um atendente assumir, tipicamente quando um assistente de IA ou bot ainda está atendendo o cliente.
- Resolved: conversa pronta para ser concluída.
- Snoozed: conversa em espera por um período ou aguardando resposta do cliente.
Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677141565-chatwoot-glossary

Conceitos irmãos que valem replicar, com as definições oficiais:
- Inbox: instância de um canal, por exemplo um número de WhatsApp.
- Teams: grupo de agentes que trata um certo tipo de conversa.
- Custom attributes: fatos customizados sobre a conversa ou o contato.
- Folders: agrupamento de conversas por filtro, salvo como visão customizada.
- Canned responses: respostas prontas disparadas por atalho.
- SLA: política de tempo alvo de resposta e resolução, opcionalmente alinhada ao horário comercial.
Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677141565-chatwoot-glossary

Sinal visual de não lido: Digisac usa "indicadores visuais (bolinhas vermelhas em mensagens não lidas)" e permite marcar como não lida, caso em que exibe "uma bolinha vermelha sem número" como lembrete.
Fonte: https://digisac.gitbook.io/manual-digisac-2-0/chat-de-atendimento

respond.io usa um ponto azul na conversa que tem mensagem nova recebida, e um contador de conversas abertas por caixa de entrada.
Fonte: https://respond.io/help/inbox/inbox-overview

Missive codifica status pela cor de fundo da linha: azul para não lida, branco para lida e laranja para item adiado (snoozed) que voltou para acompanhamento. Também usa uma barra colorida na lateral da linha para distinguir conversa compartilhada de conversa privada.
Fonte: https://missiveapp.com/docs/get-started/missive-interface

### 1.5 O ponto central: como sinalizar IA respondendo versus humano assumiu (handoff)

Este é o requisito mais específico do produto e existem quatro mecanismos distintos observados. O briefing deve combinar os quatro.

**Mecanismo 1. O status "Pending" como estado de posse da IA.**
No Chatwoot, o bot cria a conversa com status "pending", o que permite triar antes de passar para um humano. Quando o bot decide escalar, ele usa a API de update para mudar o status para "open", tornando a conversa disponível para humanos. O caminho inverso também existe: o atendente humano pode devolver a conversa para a fila do bot mudando o status de volta para "pending".
Fonte: https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots

Implicação de design direta: "IA atendendo" e "aguardando humano" não devem ser um ícone solto. Devem ser um estado de primeira classe no mesmo seletor de status, com filtro próprio na lista.

**Mecanismo 2. A IA ocupa o campo de assignee, como se fosse uma pessoa.**
No respond.io, o AI Agent pode ser atribuído manualmente pelo dropdown de assignee ou automaticamente como assignee padrão ou via workflow. Quando atribuído, "a IA aparece no campo de assignee da conversa como qualquer agente humano", identificada pelo emoji e nome escolhidos.
Fonte: https://respond.io/help/ai-agents/getting-started-with-ai-agents

**Mecanismo 3. Indicador de digitação ao vivo enquanto a IA compõe.**
respond.io exibe um typing indicator para que tanto o contato quanto o time vejam que a IA está redigindo uma resposta.
Fonte: https://respond.io/help/ai-agents/getting-started-with-ai-agents

**Mecanismo 4. Botão explícito de "Takeover" dentro do compositor.**
Ainda no respond.io, quando a IA está engajada ativamente, aparece um callout dentro do compositor de mensagem. Clicar em "Takeover" para a IA de responder e reatribui a conversa ao humano que interveio. A documentação afirma: "Once you've taken over, the AI Agent will no longer respond to this conversation until it's reassigned to the AI again."
Fonte: https://respond.io/help/ai-agents/getting-started-with-ai-agents

Padrões complementares de rotulagem:
- Chatwoot Captain marca conversas com o rótulo "Resolved by Captain", distinguindo o que a IA concluiu sozinha do que exigiu humano.
Fonte: https://www.chatwoot.com/captain
- Intercom aplica um rótulo "AI Agent" após o nome do Fin nos cartões de mensagem, ligado por padrão para clientes existentes e desligado por padrão para novos. Também usa mensagem introdutória de divulgação: "Hi there, you're speaking with Fin AI Agent. I'm well trained and ready to assist you today, but you can ask for the team at any time." Em e-mail, usa rodapé "This answer was composed by [AI Agent name], [Workspace name]'s AI Agent", ligado por padrão. A documentação alerta que ao desligar o rótulo é preciso atualizar a mensagem introdutória para manter a divulgação de IA, por razões legais.
Fonte: https://www.intercom.com/help/en/articles/11712008-ai-agent-disclosure
- SleekFlow AgentFlow permite "controlar quando a IA participa das conversas" e "definir condições para quando o agente de IA deve entrar, sair ou passar para um humano". A documentação pública não detalha os elementos visuais.
Fonte: https://help.sleekflow.io/en_US/agentflow/agentflow-feature-overview
- Umbler Talk permite configurar gatilhos de transferência para "quando for necessário transferir para um humano", sem detalhar a apresentação em tela na documentação pública.
Fonte: https://help.umbler.com/hc/pt-br/articles/27691395224717-Como-funciona-os-Agentes-de-IA

### 1.6 Recomendação de tela para o Bloco 1 (reproduzível)

Layout em 4 colunas, 1280 px como largura de projeto:
- Coluna 1, rail de ícones, 64 px, apenas navegação de módulo.
- Coluna 2, lista de conversas, 320 a 360 px. Topo com 3 abas de posse (Minhas, Sem atendente, Todas), abaixo uma linha de chips de status (IA atendendo, Aberta, Aguardando, Resolvida), abaixo busca. Cada linha da lista: avatar, nome, prévia da última mensagem, horário à direita, e uma linha inferior com no máximo 2 etiquetas mais o avatar pequeno do responsável. Ponto colorido de não lido no canto esquerdo da linha.
- Coluna 3, conversa, flexível. Cabeçalho fixo com nome do paciente, canal de origem, seletor de responsável e seletor de status. Faixa persistente logo abaixo do cabeçalho quando a IA está no controle, contendo o texto de estado e o botão primário "Assumir conversa". Compositor com abas Responder e Nota interna.
- Coluna 4, contexto, 320 px, colapsável. Blocos empilhados: Paciente, Agendamento atual, Origem do lead, Etiquetas, Atributos, Histórico.

Regra de sinalização de IA, com três camadas simultâneas:
1. Estado de posse no seletor de status, com filtro dedicado na lista.
2. Bolha de mensagem da IA com avatar próprio, nome e rótulo textual "IA", nunca só cor.
3. Faixa no topo da conversa com botão "Assumir conversa", que muda assignee e trava a IA até reatribuição explícita.

---

## BLOCO 2. CRM/Kanban de leads simples

### 2.1 Kanban: a coluna é sempre um atributo de status

Attio define a regra estrutural mais clara: as colunas do kanban são definidas por atributos do tipo status. Ao criar a visão kanban, você "seleciona um atributo de status ou cria um. O status terá os estágios pelos quais seus cartões vão se mover em um processo, por exemplo Sales stage".
Fonte: https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views

Notion generaliza: a board view agrupa páginas por uma propriedade, que pode ser status, responsável, prioridade e outras. Colunas exibem "um número em cinza" com a contagem de cartões ou outros cálculos (soma, média, intervalo de datas). Colunas vazias ou concluídas podem ser ocultadas pelo menu da coluna.
Fonte: https://www.notion.com/help/boards

Attio permite cálculos instantâneos sobre valores numéricos, via "+ Add calculation" no rodapé de cada estágio do kanban.
Fonte: https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views

Decisão para recepcionista: a contagem por coluna deve estar sempre visível no cabeçalho da coluna, e o rodapé de soma só deve existir se houver valor financeiro real por lead. Em clínica, contagem de pessoas é mais compreensível que soma de valor.

### 2.2 Cartão de lead: quantos campos cabem

Pipedrive é a referência quantitativa. Por padrão o cartão exibe: título do negócio, pessoa de contato e organização vinculadas, valor, etiqueta e dono do negócio. O título é campo obrigatório. Além dos padrões, é possível adicionar até 7 campos de negócio, pessoa ou organização. Campos de texto longo, múltipla escolha e intervalo de datas não são suportados no cartão. A customização do cartão é aplicada por usuário e por funil.
Fonte: https://support.pipedrive.com/en/article/deal-card-customization-sorting

Notion oferece três tamanhos de cartão (grande, médio e pequeno) via Layout, permite preview visual (capa, conteúdo, arquivos) e escolher quais propriedades aparecem no cartão e em que ordem.
Fonte: https://www.notion.com/help/boards

Attio permite adicionar atributos visíveis nos cartões, ligar ou desligar os rótulos dos atributos e esconder valores vazios.
Fonte: https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views

Regra de briefing: esconder valores vazios é o item mais subestimado. Cartões com campos em branco parecem quebrados para usuário leigo.

### 2.3 Ordenação e o sinal de "esse lead está parado"

Pipedrive ordena por padrão pela próxima atividade, com desempate por data de criação, e oferece 11 critérios de ordenação: baseado em atividade (padrão), título, valor, nome da pessoa, nome da organização, data prevista de fechamento, data de criação, atividades concluídas, atividades a fazer, quantidade de produtos e nome do dono. Há opção "Change order" para inverter a ordem.
Fonte: https://support.pipedrive.com/en/article/deal-card-customization-sorting e https://support.pipedrive.com/en/article/pipeline-view

A justificativa declarada é comportamental: a Pipedrive prioriza organização por atividade porque "usuários fecham em média 28% mais negócios com venda baseada em atividade".
Fonte: https://support.pipedrive.com/en/article/deal-card-customization-sorting

Trello dá o modelo de badge de prazo mais copiável do mercado, com cinco estados de cor no verso do cartão:
1. Cinza claro: vence em mais de 24 horas.
2. Amarelo: vence em menos de 24 horas.
3. Vermelho: acabou de vencer, permanece vermelho por 24 horas.
4. Rosa claro: vencido há mais de 24 horas.
5. Verde: prazo marcado como concluído.
Fonte: https://support.atlassian.com/trello/docs/adding-dates-to-cards/

Este é o padrão a adaptar para "lead sem contato há X horas" em uma clínica.

### 2.4 Kanban versus lista: quando cada um

Pipedrive pipeline view: colunas por estágio, cartões movidos por arrastar e soltar, sendo que arrastar também move o negócio para outro funil e para a opção "Delete". Um dropdown no topo troca de funil e permite reordenar. Ícone de atividade no cartão permite marcar atividade como concluída ou agendar nova sem abrir o registro. Fechamento marcado como "Won" ou "Lost".
Fonte: https://support.pipedrive.com/en/article/pipeline-view

Pipedrive list view: visão linear, colunas ajustáveis por ícone de engrenagem, filtro no canto superior direito, edição inline ao passar o mouse e clicar no ícone de lápis, botão "+" para adicionar item, atualização de dados sem recarregar a página, e hovercards com informação básica ao passar o mouse sobre pessoas, organizações ou negócios.
Fonte: https://support.pipedrive.com/en/article/list-view

Attio trata kanban e tabela como visualizações alternativas dos mesmos dados, trocáveis por um dropdown, compartilhando filtros, ordenação e configuração de atributos.
Fonte: https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views

Kommo organiza leads em funis acessíveis por "Pipelines, All leads". Ao criar um lead, preenche-se nome, tags, estágio do funil, responsável e valor. A barra de ferramentas de ações em massa permite "reatribuir usuário, adicionar tarefa, mudar de estágio, editar tags ou excluir", além de mesclar duplicados.
Fonte: https://support.kommo.com/docs/manage-leads-in-kommo

Attio permite selecionar múltiplos cartões no kanban e movê-los juntos de estágio segurando shift e arrastando.
Fonte: https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views

### 2.5 Recomendação de tela para o Bloco 2 (reproduzível)

- Um único funil visível por vez, com seletor no topo. Nunca mostrar dois funis simultâneos.
- Máximo de 5 colunas de estágio, com contagem no cabeçalho de cada coluna. Sugestão para clínica: Novo, Em contato, Agendado, Compareceu, Perdido.
- Cartão com exatamente 5 elementos e nada mais: nome do paciente, telefone, badge de origem, badge de tempo desde o último contato (escala de cor tipo Trello) e avatar do responsável. Esconder campos vazios.
- Toggle Kanban/Lista no mesmo cabeçalho, preservando o mesmo filtro ativo entre as duas visões.
- Edição inline na lista com ícone de lápis no hover, mais ações em massa por seleção de checkbox (reatribuir, mudar estágio, adicionar etiqueta).
- Ordenação padrão por "próxima ação" e não por data de criação.

---

## BLOCO 3. Agenda e agendamento clínico

### 3.1 As quatro visões de agenda que uma clínica precisa

Feegow documenta a taxonomia mais completa e diretamente aplicável:

- **Agenda Diária**: mostra "um único dia e de um único profissional". Contém seletor de profissional, grade de horários com livres e ocupados, campo de observações e seção de lista de espera. É a única visão com função de impressão e com "Alterações em massa" (reagendamento em lote).
- **Agenda Semanal**: exibe "todos os horários ao longo da semana" para um profissional. Não tem impressão nem edição em massa. Agendamentos cancelados aparecem no horário original mas o horário aparece como disponível acima.
- **Agenda Múltipla**: desenhada para "multiclínicas que possuem diversos profissionais, especialidades e unidades". Traz filtros que permitem à recepcionista buscar por especialidade, convênio e unidade sem saber o nome do profissional, exibindo todos os profissionais e equipamentos com horário compatível.
- **Agenda de Equipamentos Alocados**: organiza "os horários de utilização dos equipamentos", estruturada como a diária. Com múltiplos equipamentos, a visão múltipla exibe todos simultaneamente.
Fonte: https://ajuda.feegow.com/support/solutions/articles/67000146499-1-vis%C3%A3o-geral-das-agendas-di%C3%A1ria-semanal-m%C3%BAltipla-e-de-equipamentos

Ponto de UX crítico embutido nessa documentação: a Agenda Múltipla resolve o problema real da recepção, que é "encaixar o paciente com quem estiver livre", e não "abrir a agenda do Dr. Fulano". Filtro por especialidade e convênio vem antes de filtro por nome.

iClinic confirma o par mínimo de visões: formato dia, que "possibilita a visualização de todos os horários do dia selecionado", e formato semana, que "possibilita a visualização de todos os agendamentos da semana selecionada", ambos com setas de navegação para retroceder ou avançar. A lista de pacientes do dia aparece no lado esquerdo da página.
Fonte: https://suporte.iclinic.com.br/pt-br/visualizar-a-agenda

### 3.2 Múltiplos profissionais na mesma tela: a limitação a evitar

Google Calendar oferece Day, Week, Month, Year, Schedule e 4 days, além de visão customizada. Sobre a exibição lado a lado de calendários, a documentação afirma explicitamente: "The side-by-side calendars won't work for the week or month view in Google Calendar". Ou seja, colunas por pessoa existem apenas na visão de dia.
Fonte: https://support.google.com/calendar/answer/6110849?hl=en&co=GENIE.Platform%3DDesktop

Consequência de briefing: a visão "colunas por profissional" deve ser tratada como uma visão de dia dedicada. Tentar colunas por profissional dentro da semana gera uma grade ilegível. Feegow chega à mesma conclusão ao separar Semanal (um profissional, sete dias) de Múltipla (vários profissionais, um recorte).
Fonte: https://ajuda.feegow.com/support/solutions/articles/67000146499-1-vis%C3%A3o-geral-das-agendas-di%C3%A1ria-semanal-m%C3%BAltipla-e-de-equipamentos

### 3.3 Bloqueios de agenda

Feegow trata bloqueio como objeto próprio, não como agendamento fake. Regras documentadas:
- O bloqueio impede reservas no período e o horário deixa de ser selecionável na grade.
- Pode ser criado a partir de qualquer agenda individual (diária, semanal ou de equipamento) ou em lote, para vários profissionais, unidades e locais ao mesmo tempo.
- Pode ser vinculado a feriados.
- Fluxo de criação: selecionar um "horário livre na Agenda" e escolher "inserir bloqueio".
- Existe configuração "BLOQUEAR ENCAIXE EM HORÁRIOS BLOQUEADOS", que impede encaixes dentro de bloqueios.
- Exclusão por listagem de bloqueios ou clicando no horário bloqueado.
Fonte: https://ajuda.feegow.com/support/solutions/articles/67000667935-11-como-criar-e-excluir-um-bloqueio-na-agenda-

Doctoralia Pro descreve o bloqueio de horários indisponíveis, adição de consultas agendadas offline e "permissões especiais para sua equipe de recepção" como funções separadas da agenda.
Fonte: https://pro.doctoralia.com.br/produtos/funcionalidades/agendamento-online

### 3.4 Status de agendamento: o vocabulário real do mercado brasileiro

A documentação técnica do iClinic expõe a lista completa de status de agendamento, com códigos:

| Código | Status |
|---|---|
| sc | agendado |
| co | confirmado |
| wa | aguardando |
| re | reagendado |
| ca | cancelado |
| st | iniciada |
| cp | encerrada |
| na | não compareceu |
| po | confirmada pelo paciente |
| pa | cancelada pelo paciente |
| eo | confirmada por e-mail |
| ec | cancelada por e-mail |
| at | atendido pela agenda |
| dp | dilatando pupila |
| sg | agendado no Google |
| cg | cancelado no Google |

Fonte: https://docs.iclinic.com.br/schedulings.html

Leitura de design: o mercado distingue quem confirmou e por qual canal (confirmada pelo paciente, confirmada por e-mail). Isso importa porque em um SaaS com IA a confirmação virá por WhatsApp, e o status precisa carregar a autoria. Confirmado pela recepção e confirmado pelo paciente via IA não são o mesmo fato.

Doctoralia reforça o mesmo eixo: pacientes podem "confirmar, modificar ou cancelar online" via e-mail, WhatsApp, SMS ou app.
Fonte: https://pro.doctoralia.com.br/produtos/funcionalidades/agendamento-online

Calendly trata "no-show" como ação explícita sobre o convidado, não como status inferido: na página Meetings é possível cancelar, reagendar, adicionar notas, marcar convidados como no-show e exportar dados. A página mostra todas as reuniões em uma única timeline agrupada por data, com busca e filtros, e exibe eventos do Google e Outlook ao lado das reuniões do Calendly.
Fonte: https://calendly.com/help/how-to-manage-your-meetings

### 3.5 Múltiplos profissionais e roteamento automático

Cal.com mostra o padrão de UI para distribuir agendamentos entre profissionais:
- Lista de hosts com botão "Add Group" para organizar múltiplos grupos de rodízio, sendo que um participante de cada grupo entra em cada reserva.
- Distinção explícita entre "Fixed Hosts", que são "indivíduos que estão consistentemente presentes em toda reunião", e hosts de rodízio, que alternam.
- Quando os hosts não compartilham a mesma agenda, a interface apresenta "slots formados usando a união de todos os slots disponíveis para cada host de round robin".
- Configuração de prioridade (High, Medium, Low) e de peso percentual por host, com padrão de 100%. Um host com 200% recebe mais reservas que um com 100%.
- Reatribuição pela página Upcoming Bookings, em menu de três pontos com a opção "Reassign", e um toggle para esconder os dados do host nas notificações de reatribuição.
Fonte: https://cal.com/help/event-types/round-robin

### 3.6 Recomendação de tela para o Bloco 3 (reproduzível)

- Visão padrão: Dia, com uma coluna por profissional. Eixo vertical de horas à esquerda, largura mínima de 180 px por coluna de profissional, cabeçalho fixo com foto, nome e contagem de agendamentos do dia.
- Filtros acima da grade, nesta ordem: unidade, especialidade, convênio, profissional. Nome do profissional é o último filtro, não o primeiro.
- Visão Semana: sempre de um único profissional. Nunca colunas por profissional na semana.
- Bloqueio como entidade visual distinta: preenchimento hachurado ou tramado mais rótulo textual do motivo, sem depender de cor. Criável por seleção de intervalo vazio na grade e replicável para vários profissionais de uma vez.
- Status do agendamento no card com três camadas: ícone, rótulo textual e cor. Conjunto sugerido de 6 estados: Agendado, Confirmado, Aguardando na recepção, Em atendimento, Concluído, Cancelado, mais o marcador separado de Faltou.
- Autoria da confirmação exibida no card ou no tooltip: "Confirmado pelo paciente via WhatsApp" versus "Confirmado pela recepção".
- Drag and drop: arrastar dentro da coluna muda horário, arrastar entre colunas muda profissional. Todo drop precisa de confirmação modal com resumo da mudança, porque mover consulta tem consequência de notificação ao paciente.
- Ação explícita de "Marcar falta" no menu do agendamento, seguindo o modelo de no-show do Calendly.

---

## BLOCO 4. Dashboard de origem de lead

### 4.1 O vocabulário de origem: canal, origem, mídia, campanha

GA4 define uma hierarquia de dimensões de aquisição. O relatório Traffic acquisition tem como dimensão primária padrão "Session default channel grouping", que exibe categorias baseadas em regra como "Direct", "Organic Search" e "Paid Social". As demais dimensões disponíveis são: Session campaign, Session medium, Session source, Session source/medium e Session source platform. Aceita dimensão secundária, por exemplo "Page path and screen class".
Fonte: https://support.google.com/analytics/answer/12923437?hl=en&co=GENIE.Platform%3DDesktop

Os grupos de canal padrão do GA4 são: Affiliates, AI Assistants, Audio, Cross-network, Direct, Display, Email, Mobile Push Notifications, Organic Search, Organic Shopping, Organic Social, Organic Video, Paid Other, Paid Search, Paid Shopping, Paid Social, Paid Video, Referral e SMS. A documentação registra que os grupos padrão não podem ser editados no Google Analytics, mas é possível criar grupos customizados.
Fonte: https://support.google.com/analytics/answer/9756891?hl=en

HubSpot usa uma taxonomia mais enxuta, e é a mais adequada de copiar para uma clínica: Organic Search, Paid Search, Email Marketing, Organic Social, Paid Social, Referrals, Other Campaigns, Direct Traffic, AI Referrals e Offline Sources. Definições relevantes: "Referrals" são sites externos que linkam para o seu site, "Other campaigns" são URLs de rastreamento criadas no HubSpot, e "Offline sources" são registros sem sessão digital rastreada.
Fonte: https://knowledge.hubspot.com/reports/understand-hubspots-traffic-sources-in-the-traffic-analytics-tool

O item "Offline sources" é o que faz esse modelo funcionar em clínica, porque indicação de paciente e placa na rua existem e precisam de um balde nomeado.

A aba Sources do HubSpot combina um gráfico e uma tabela de sessões, com drill-down para detalhes de palavras-chave, domínios de referência, campanhas e páginas específicas.
Fonte: https://knowledge.hubspot.com/reports/understand-hubspots-traffic-sources-in-the-traffic-analytics-tool

### 4.2 Métricas: o que GA4 mostra por padrão

Métricas padrão do relatório de aquisição de tráfego do GA4: Sessions, Engagement rate, Engaged sessions, Average engagement time per session, Event count e Events per session. Métricas adicionais disponíveis: Key events, Session key event rate e Total revenue.
Fonte: https://support.google.com/analytics/answer/12923437?hl=en&co=GENIE.Platform%3DDesktop

Crítica de aplicação: para clínica, quase nenhuma dessas serve como métrica de topo. "Engagement rate" e "Events per session" são métricas de site, não de negócio. O equivalente útil é a cadeia lead, agendamento, comparecimento.

### 4.3 Modelos de atribuição comparáveis lado a lado

Ruler Analytics permite selecionar até dois modelos de atribuição para comparar simultaneamente, a partir de um dropdown dentro de relatórios como Source Report ou Keyword Report. Os modelos disponíveis são seis: First Click, Last Click, Linear, Position-Based, Time Decay e Data-Driven, mais um modelo de atribuição de impressão baseado em machine learning. As métricas analisáveis incluem cliques, envios de formulário, gravações de chamada, receita gerada, retorno sobre investimento em anúncios e custo por aquisição. Os modelos selecionados são comparados lado a lado.
Fonte: https://www.ruleranalytics.com/blog/product/multi-touch-attribution-comparison/

Padrão de UI extraível: comparação de modelo é um seletor de no máximo dois, exibindo colunas espelhadas na mesma tabela. Não é um relatório separado por modelo.

### 4.4 Que gráficos funcionam e quais são ruído

A Nielsen Norman Group dá as regras mais diretas e verificáveis.

**Funciona:**
- Gráfico de barras para ranking e comparação entre categorias. "Bar charts are much easier for people to comprehend than other types of charts" e permitem perceber "rápida e precisamente as diferenças entre valores".
- Barras horizontais quando os rótulos são longos, "por exemplo nomes de funcionalidades ou descrições de tarefa", evitando rotacionar ou abreviar texto.
- Barras pareadas para duas séries, com a regra "coloque próximas as coisas que você quer comparar", agrupando pela comparação principal e não pela variável secundária.
- Gráfico de linha para tendência ao longo do tempo, com marcadores nos pontos onde os dados foram coletados.
- Dispersão para relação entre duas variáveis.
Fonte: https://www.nngroup.com/articles/choosing-chart-types/

**É ruído:**
- Pizza e barras empilhadas exigem que o usuário avalie ângulo, área ou volume, e são muito mais difíceis de processar. A pesquisa citada indica que barras empilhadas "estão entre os gráficos com as maiores taxas de erro".
Fonte: https://www.nngroup.com/articles/choosing-chart-types/
- Em dashboards especificamente, evitar para compreensão rápida: pizza e rosca (baseados em área), treemaps (dependentes de área, adequados só para exploração), medidores tipo gauge (baseados em ângulo e consumidores de espaço) e gráficos 3D (distorcem formas e comprometem a leitura).
Fonte: https://www.nngroup.com/articles/dashboards-preattentive/

**Regras de percepção a aplicar:**
- Comprimento e posição em 2D são os atributos ótimos para representar valores numéricos e permitem comparação precisa. Cor e forma funcionam melhor para agrupamento categórico, não para relação quantitativa.
- Cor deve ser reforço secundário: "Color can add visual weight to relationships, but should only be used to reinforce information that is already communicated in a different way", como proximidade ou forma. A justificativa citada é acessibilidade, considerando até 8% dos homens com deficiência de percepção de cor.
- Dashboards devem entregar informação "at-a-glance", exigindo processamento cognitivo mínimo, de modo que o usuário identifique respostas sem interação extensa.
Fonte: https://www.nngroup.com/articles/dashboards-preattentive/

### 4.5 Recomendação de tela para o Bloco 4 (reproduzível)

Estrutura em três faixas verticais, de cima para baixo:

1. **Faixa de KPI**, 4 tiles no máximo, cada um com número grande, rótulo e variação versus período anterior: Leads recebidos, Agendamentos criados, Comparecimentos, Taxa lead para comparecimento. Nada de gauge.
2. **Faixa de origem**, um único gráfico de barras horizontais ordenado por volume decrescente, uma barra por canal, com rótulo textual do canal à esquerda e valor numérico ao final da barra. Buckets sugeridos, adaptados do HubSpot: Busca orgânica, Busca paga, Social orgânico, Social pago, Indicação, Referência de site, Campanha rastreada, Direto e Offline. Sem pizza.
3. **Faixa de detalhe**, uma tabela com dimensão primária trocável por dropdown (canal, origem, mídia, campanha), replicando o padrão do GA4, com colunas fixas: Leads, Agendamentos, Comparecimentos, Taxa de conversão e Custo por agendamento quando houver custo.

Tendência ao longo do tempo, se necessária, entra como um gráfico de linha único com marcadores de ponto, com no máximo 4 séries. Comparação de modelos de atribuição, se existir, é um seletor de dois modelos gerando colunas espelhadas na tabela de detalhe, seguindo Ruler.

---

## BLOCO 5. Dark mode e acessibilidade

### 5.1 Não usar preto puro para superfícies de conteúdo

O Material Design estabelece o valor concreto: "a camada mais ao fundo da interface é tipicamente um cinza escuro com o valor hexadecimal #121212".
Fonte: https://codelabs.developers.google.com/codelabs/design-material-darktheme

A mesma fonte explica por que evitar branco puro sobre fundo escuro: cores muito claras "vibram visualmente contra fundos escuros" e "texto #FFFFFF puro contra fundo escuro pode prejudicar a legibilidade, porque a luz do texto parece sangrar ou borrar".
Fonte: https://codelabs.developers.google.com/codelabs/design-material-darktheme

A Apple usa uma abordagem diferente e importante de conhecer: no iOS, o nível base, usado quando a view preenche a tela inteira de borda a borda, usa preto puro (#000000) no Dark Mode, e o nível elevado, usado quando conteúdo aparece em camada separada acima da base (modais, split view), usa tons de cinza mais claros. Nas palavras da sessão: "When the view fills the whole screen edge to edge, we call that the base level. And then when content appears in a separate layer above that, we call that the elevated level. So, in Dark Mode, the system-provided background colors have lighter values in the elevated level". Cores de primeiro plano (texto, ícones) não mudam entre os níveis, apenas os fundos.
Fonte: https://developer.apple.com/videos/play/wwdc2019/214/

Decisão para SaaS web em desktop: seguir Material e usar #121212 como base, não preto puro. O preto puro da Apple é justificado por telas OLED em uso móvel, e o produto aqui é uma tela de recepção usada por 8 horas seguidas.

A Apple explicita um risco relacionado: "muitos desenvolvedores usam cinza sobre preto para leitura em dark mode, o que pode reduzir a fadiga visual para visão padrão em cenários de pouca luz, mas essa variante de contraste reduzido pode ser mais difícil de ler para pessoas com baixa visão ou sensibilidade à luz".
Fonte: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/dark-interface-evaluation-criteria/

### 5.2 Elevação: superfícies tonais em vez de sombra

O Material 3 substituiu o overlay de elevação por cores de superfície tonais. A documentação oficial afirma: "Surface with elevation overlay has been replaced with tonal surface colors in Material's components".
Fonte: https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md

Os papéis de superfície e seus tons de base no esquema escuro, na notação neutralN onde N é o valor de tom:

| Papel | Tom no dark |
|---|---|
| colorSurfaceContainerLowest | neutral4 |
| colorSurface / colorSurfaceDim | neutral6 |
| colorSurfaceContainerLow | neutral10 |
| colorSurfaceContainer | neutral12 |
| colorSurfaceContainerHigh | neutral17 |
| colorSurfaceContainerHighest | neutral22 |
| colorSurfaceBright | neutral24 |

Papéis de conteúdo e contorno no dark:

| Papel | Tom no dark |
|---|---|
| colorOnSurface | neutral90 |
| colorOnSurfaceVariant | neutral80 |
| colorSurfaceVariant | neutral30 |
| colorOutline | neutral60 |
| colorOutlineVariant | neutral30 |

Fonte: https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md

Cada grupo de acento (Primary, Secondary, Tertiary) inclui a cor base, a variante "On", a variante Container e "On Container", além de versões fixed e fixed-dim. Erro segue o mesmo padrão: error, onError, errorContainer, onErrorContainer.
Fonte: https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md

Consequência prática: no dark mode a hierarquia visual é expressa por tom de superfície, não por sombra. Sombra praticamente desaparece sobre fundo escuro. Um menu flutuante sobre um card sobre o fundo deve usar três tons de superfície distintos e crescentes.

Complementarmente, o Material documenta níveis de ênfase de texto por opacidade: alta ênfase em 87%, média ênfase em 60% e desabilitado em 38%.
Fonte: https://codelabs.developers.google.com/codelabs/design-material-darktheme

### 5.3 Cores saturadas: dessaturar acentos no dark

O Material orienta escolher variantes mais claras e menos saturadas: "variantes mais claras são escolhidas para que seu sistema de cor permaneça expressivo e mantenha contraste apropriado sem causar fadiga visual. Cores mais saturadas tendem a vibrar visualmente contra fundos escuros".
Fonte: https://codelabs.developers.google.com/codelabs/design-material-darktheme

### 5.4 Contraste: os números obrigatórios

**Texto, WCAG 2.2 SC 1.4.3 Contrast (Minimum), nível AA:**
- Texto normal: no mínimo 4.5:1.
- Texto grande: no mínimo 3:1.
- Texto grande é definido como "pelo menos 18 pontos, ou 14 pontos em negrito, ou tamanho de fonte que produza tamanho equivalente para fontes chinesas, japonesas e coreanas". Considerando 1pt = 1.333px, isso equivale a aproximadamente 24px e 18.5px em negrito.
- Exceções: texto incidental (em componente inativo, decoração pura, texto invisível, ou parte de imagem com outro conteúdo visual significativo) e logotipos, que não têm requisito de contraste.
Fonte: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

**Elementos não textuais, WCAG 2.2 SC 1.4.11 Non-text Contrast, nível AA:**
- Requisito: contraste de no mínimo 3:1 contra cores adjacentes, para componentes de interface (e seus estados) e para objetos gráficos necessários à compreensão do conteúdo.
- O documento é explícito: "os índices de contraste 3:1 referenciados neste critério devem ser tratados como valores de limiar", sem arredondamento. 2.999:1 reprova.
- O que precisa dos 3:1: pistas visuais que identificam que um controle existe e como operá-lo, indicadores de estado (selecionado, com foco, marcado), indicadores de foco contra o fundo adjacente, bordas de checkbox e do próprio check, bordas de campos de formulário, setas de dropdown, linhas de gráfico contra o fundo, fatias e limites de visualização de dados, e ícones de status em dashboards.
- Não se aplica a componentes inativos (desabilitados), gráficos decorativos e gráficos com alternativa textual equivalente.
Fonte: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html

**Critério da Apple:** "um contraste mínimo de 4.5 para 1 entre o texto de primeiro plano e seu fundo", e para não texto, "atingir um contraste mínimo de 3:1 é comumente recomendado para contraste não textual", aplicável a controles interativos, representações não textuais de estado (por exemplo checkbox customizado marcado versus desmarcado) e ícones.
Fonte: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/

**Foco, WCAG 2.2 SC 2.4.13 Focus Appearance, nível AAA:**
- Área mínima: "pelo menos tão grande quanto a área de um perímetro de 2 pixels CSS de espessura" do componente sem foco. A abordagem mais simples é um outline sólido de 2px.
- Contraste: "contraste de no mínimo 3:1 entre os mesmos pixels nos estados com foco e sem foco". Trata-se de mudança de contraste, não de contraste com o adjacente.
- Exceção quando o indicador de foco é determinado pelo user agent e não pode ser ajustado pelo autor.
Fonte: https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html

**Tamanho de alvo, WCAG 2.2 SC 2.5.8 Target Size (Minimum), nível AA:**
- Requisito: "o tamanho do alvo para entradas de ponteiro é de pelo menos 24 por 24 pixels CSS".
- Exceção de espaçamento: alvos menores passam se, ao centrar um círculo imaginário de 24px de diâmetro no centro da caixa delimitadora do alvo, esse círculo não intersectar outros alvos nem os círculos de outros alvos subdimensionados.
- Outras exceções: alvos inline dentro de frases, alvo equivalente disponível em outro lugar da página, controles padrão não modificados do navegador, e casos em que o tamanho é essencial (pinos de mapa, formulários com layout exigido por lei).
Fonte: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

### 5.5 Cor nunca sozinha: status precisa de ícone e rótulo

O texto exato do WCAG 2.2 SC 1.4.1 Use of Color, nível A: "Color is not used as the only visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element".
Fonte: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html

Alternativas aceitáveis documentadas:
- Rótulo textual: "informação transmitida por diferenças de cor também está disponível em texto".
- Ícone acompanhando a cor, exemplificado por campos obrigatórios marcados com texto vermelho mais ícone.
- Números ou padrões junto com a cor.
- Padrões de preenchimento além da cor, ou distinção por contraste.

Nota crítica sobre contraste como substituto: quando cores diferem em matiz e luminosidade, um contraste de 3:1 ou maior pode servir como distinção visual adicional. Porém isso vale apenas quando a percepção de cor em si não é necessária. Distinguir se um contorno é verde (válido) ou vermelho (inválido) continua exigindo um indicador não cromático, independentemente do índice de contraste.
Fonte: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html

A NN/g chega à mesma regra pelo lado da visualização de dados: cor "deve ser usada apenas para reforçar informação que já é comunicada de outra forma".
Fonte: https://www.nngroup.com/articles/dashboards-preattentive/

### 5.6 Regras de implementação em dark mode

**Nunca hardcodar cor.** A Apple registra: "apps iOS tradicionalmente hardcodaram todas as suas cores. Você especifica o valor RGB de cada pedaço da sua UI. Agora que temos Dark Mode, quase todas essas cores precisam mudar". A recomendação é usar cores semânticas dinâmicas, deixando o framework resolver conforme a aparência atual.
Fonte: https://developer.apple.com/videos/play/wwdc2019/214/

A paleta semântica de referência da Apple, útil como modelo de tokens:
- Fundos hierárquicos: systemBackground, secondarySystemBackground, tertiarySystemBackground.
- Texto em quatro níveis: label, secondaryLabel, tertiaryLabel, quaternaryLabel.
- Outros: separator para divisores, systemGroupedBackground para tabelas agrupadas, e variantes semânticas de systemBlue, systemRed e systemGreen.
Fonte: https://developer.apple.com/videos/play/wwdc2019/214/

**Testar dark mode junto com contraste aumentado.** A Apple alerta: "um erro comum é suportar contraste suficiente na interface clara, mas esquecer de suportar contraste suficiente na interface escura. Considere testar seu app combinando o esquema de cor dark mode com a configuração de acessibilidade Increase Contrast". A mesma fonte recomenda testar com Bold Text, Increase Contrast e Reduce Transparency ativados, e em ambos os modos quando o app suporta Dark Mode.
Fontes: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/dark-interface-evaluation-criteria/ e https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/

**Cuidado com inversão de cor.** A Apple exemplifica: "se você depende da configuração Smart Invert, um botão vermelho de 'Delete' pode inverter para verde se você não considerar a inversão de cor".
Fonte: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/dark-interface-evaluation-criteria/

**Imagens e mídia também precisam de versão escura.** Imagens apenas claras (capturas de tela brancas, diagramas claros) e gráficos que assumem fundo claro reprovam. Deve-se fornecer versões dark das imagens.
Fonte: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/dark-interface-evaluation-criteria/

### 5.7 Recomendação de sistema para o Bloco 5 (reproduzível)

Escala de superfícies do dark theme, 5 níveis, do fundo para o topo:
1. Fundo da aplicação: #121212 (base do Material).
2. Painel de coluna (lista de conversas, sidebar): um degrau acima, equivalente a surfaceContainerLow.
3. Card ou linha selecionada: surfaceContainer.
4. Menu suspenso, popover: surfaceContainerHigh.
5. Modal e diálogo: surfaceContainerHighest.
Nenhum nível usa sombra como sinal primário de elevação. A separação é tonal.
Fontes: https://codelabs.developers.google.com/codelabs/design-material-darktheme e https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md

Texto:
- Primário: nunca #FFFFFF puro. Usar branco com opacidade de 87%.
- Secundário: 60%.
- Desabilitado: 38%.
- Verificar 4.5:1 para texto normal e 3:1 para texto grande contra a superfície onde ele efetivamente aparece, não contra o fundo da aplicação.
Fontes: https://codelabs.developers.google.com/codelabs/design-material-darktheme e https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

Cores de acento: usar variantes dessaturadas e mais claras. Limitar áreas grandes de cor saturada, usando cor como acento pontual.
Fonte: https://codelabs.developers.google.com/codelabs/design-material-darktheme

Componente de status (chip), especificação obrigatória de 3 partes:
1. Ícone de forma distinta por estado, nunca o mesmo ícone em cores diferentes.
2. Rótulo textual sempre visível, nunca só no tooltip.
3. Cor de fundo ou de borda como terceira camada.
Contraste do ícone e da borda: no mínimo 3:1 contra a superfície adjacente. Contraste do rótulo: no mínimo 4.5:1.
Fontes: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html, https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html e https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

Alvos clicáveis: mínimo de 24 por 24 pixels CSS, ou espaçamento suficiente para que círculos de 24px centrados em cada alvo não se toquem. Para uso de recepção com mouse e pressa, adotar 40px como alvo real e tratar 24px apenas como piso legal.
Fonte: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

Foco visível: outline sólido de 2px, com contraste de 3:1 entre o estado com foco e sem foco.
Fonte: https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html

Tokens semânticos, nunca hex direto no componente. Nomear por papel (surface, surfaceContainer, onSurface, outline, error, onError) e não por cor.
Fontes: https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md e https://developer.apple.com/videos/play/wwdc2019/214/

---

## Fontes consultadas

**Bloco 1**
- https://www.chatwoot.com/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics
- https://www.chatwoot.com/hc/user-guide/articles/1677141565-chatwoot-glossary
- https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots
- https://www.chatwoot.com/captain
- https://respond.io/help/inbox/inbox-overview
- https://respond.io/help/ai-agents/getting-started-with-ai-agents
- https://www.intercom.com/help/en/articles/11712008-ai-agent-disclosure
- https://missiveapp.com/docs/get-started/missive-interface
- https://digisac.gitbook.io/manual-digisac-2-0/chat-de-atendimento
- https://digisac.gitbook.io/manual-digisac-2-0/chat-de-atendimento/area-do-atendimento
- https://help.umbler.com/hc/pt-br/articles/360060681832-O-que-%C3%A9-o-Umbler-Talk
- https://help.umbler.com/hc/pt-br/articles/27691395224717-Como-funciona-os-Agentes-de-IA
- https://help.sleekflow.io/en_US/agentflow/agentflow-feature-overview

**Bloco 2**
- https://support.pipedrive.com/en/article/pipeline-view
- https://support.pipedrive.com/en/article/list-view
- https://support.pipedrive.com/en/article/deal-card-customization-sorting
- https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views
- https://www.notion.com/help/boards
- https://support.atlassian.com/trello/docs/adding-dates-to-cards/
- https://support.kommo.com/docs/manage-leads-in-kommo

**Bloco 3**
- https://ajuda.feegow.com/support/solutions/articles/67000146499-1-vis%C3%A3o-geral-das-agendas-di%C3%A1ria-semanal-m%C3%BAltipla-e-de-equipamentos
- https://ajuda.feegow.com/support/solutions/articles/67000667935-11-como-criar-e-excluir-um-bloqueio-na-agenda-
- https://suporte.iclinic.com.br/pt-br/visualizar-a-agenda
- https://docs.iclinic.com.br/schedulings.html
- https://support.google.com/calendar/answer/6110849?hl=en&co=GENIE.Platform%3DDesktop
- https://calendly.com/help/how-to-manage-your-meetings
- https://cal.com/help/event-types/round-robin
- https://pro.doctoralia.com.br/produtos/funcionalidades/agendamento-online

**Bloco 4**
- https://support.google.com/analytics/answer/12923437?hl=en&co=GENIE.Platform%3DDesktop
- https://support.google.com/analytics/answer/9756891?hl=en
- https://knowledge.hubspot.com/reports/understand-hubspots-traffic-sources-in-the-traffic-analytics-tool
- https://www.ruleranalytics.com/blog/product/multi-touch-attribution-comparison/
- https://www.nngroup.com/articles/choosing-chart-types/
- https://www.nngroup.com/articles/dashboards-preattentive/

**Bloco 5**
- https://codelabs.developers.google.com/codelabs/design-material-darktheme
- https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md
- https://developer.apple.com/videos/play/wwdc2019/214/
- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/
- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/dark-interface-evaluation-criteria/
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

## Lacunas de pesquisa registradas

Alguns itens do escopo não puderam ser confirmados em fonte primária e ficaram fora do relatório para não gerar afirmação sem URL:
- Kommo: a página de caixa de entrada unificada (https://www.kommo.com/whatsapp/unified-inbox-with-whatsapp/) e a documentação de funil não descrevem a anatomia visual da tela. O que existe está citado em 2.4.
- Front: o help center (https://help.front.com/en/articles/2194) cita Commenting, Mentioning, Assigning, Tags e Archiving por nome, mas não descreve a posição visual desses elementos. Missive foi usado como substituto documentado do mesmo padrão de 3 colunas.
- RD Station: a página "Como utilizar a Análise de Canais" (https://ajuda.rdstation.com/s/article/Como-utilizar-a-An%C3%A1lise-de-Canais) exige JavaScript e não retornou conteúdo.
- SleekFlow e Umbler Talk: a documentação pública descreve a lógica de handoff, mas não os elementos visuais que a sinalizam.
- Doctoralia Pro: a página de produto não descreve visões de calendário nem status na tela.
- m3.material.io e developer.apple.com/design: ambos exigem JavaScript. Os valores do Material 3 foram obtidos da documentação oficial no repositório material-components-android, e a orientação da Apple, das páginas de critérios do App Store Connect e da sessão WWDC19 214.
