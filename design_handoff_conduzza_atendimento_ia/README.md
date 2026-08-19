# Handoff: Conduzza — Atendimento com IA para clínicas

## Overview
Plataforma SaaS que a Conduzza opera para clínicas médicas/odontológicas: WhatsApp multi-atendente com uma atendente de IA ("Sofia") que responde, triagem, agenda e confirma; funil de leads; agenda por profissional; base de pacientes; painel de origem de lead; e a tela de configuração do agente. Inclui a landing page pública que antecede o login.

O produto resolve três dores declaradas no site da Conduzza: lead que chega fora do horário e não é respondido, processo comercial manual, e falta de clareza sobre qual canal de marketing virou consulta de verdade. A tese de produto é **IA discreta**: a IA trabalha na fila como se fosse um atendente, e o humano assume com um clique — nunca há dúvida sobre quem está falando com o paciente.

## About the Design Files
Os arquivos deste pacote são **referências de design feitas em HTML** — protótipos que mostram aparência e comportamento pretendidos, **não código de produção para copiar**. O HTML usa um runtime de prototipagem próprio (tags `<x-dc>`, `<sc-if>`, atributos `{{ hole }}`) que **não existe no mundo real** e não deve ser reproduzido.

**Não existe codebase de partida.** A pasta de código anexada ao projeto de design estava vazia, então não há padrão estabelecido a seguir: escolha o stack apropriado e implemente ali. Sugestão para este produto — Next.js (App Router) + TypeScript + Tailwind, com WebSocket para o tempo real do inbox; se o time já tem preferência, ela ganha.

A tarefa é **recriar estes designs** nesse ambiente. Concretamente:

- Todo estilo no protótipo está **inline** por exigência da ferramenta de prototipagem. **Não replique isso.** Traduza para o sistema de estilo do projeto (CSS Modules, Tailwind, styled-components) usando os tokens da seção *Design Tokens*.
- `<sc-if value="{{ isInbox }}">` é renderização condicional → vira rota (`/atendimento`, `/leads`, `/agenda`, `/pacientes`, `/resultados`, `/agente`) ou estado de navegação.
- `<sc-for>` é iteração → `.map()`.
- Os dados são fixos no protótipo (nomes de pacientes, horários, métricas). Todos precisam vir de API.

## Fidelity
**Alta fidelidade (hifi).** Cores, tipografia, espaçamentos, raios, estados e microcópia estão finalizados e devem ser seguidos ao pixel. A identidade foi derivada do site conduzza.com.br (Poppins, fundo quase-branco, cartões brancos de canto bem arredondado, seções pretas, verde-limão #A8D318 como único acento) e do logo oficial fornecido pelo cliente.

Duas coisas continuam sendo placeholder e precisam de dado real antes de ir para produção:
- Os números da landing (**14 estados, 02 anos, +R$ 100M**) — o site anima a partir de zero e não expõe os valores finais.
- Todas as métricas de dashboard e de performance da IA (18 s, 63%, +24%, 412 leads etc.).

---

## Screens / Views

O shell do protótipo é uma moldura de **1440×900** com `border-radius: 14px`, centralizada num fundo `--shell`. **Essa moldura é um artifício de apresentação** — em produção a aplicação é full-viewport. O layout interno de 1440px de largura é o alvo de desktop.

### 0. Landing page (pública)
- **Rota sugerida:** `/`
- **Propósito:** converter gestor de clínica em reunião de diagnóstico.
- **Tipografia:** **Poppins** em toda a landing (o app usa Inter Tight — ver *Design Tokens*).
- **Tema:** clara por padrão (como o site); há um alternador para escura. Em produção, provavelmente só a clara é necessária.
- **Layout:** coluna única com rolagem, padding lateral de 20px, seções separadas por 20px.

Estrutura, de cima para baixo:
1. **Nav** — `padding: 16px 20px`, sticky, fundo `--l-bg`. Logo à esquerda (132px de largura; **arquivo preto no tema claro, branco no escuro**), links "Método BPM / Sobre / Serviços / Blog" em 13.5px, botão secundário pill (`height: 56px; border-radius: 28px; background: --l-bg2`) e CTA pill limão (`height: 56px; border-radius: 28px; background: --lime; color: --limeInk; font-weight: 600`).
2. **Hero centralizado** — kicker leve em 30px `font-weight: 300` ("Destrave o crescimento da sua clínica"), headline em **64px / weight 600 / letter-spacing -.035em** ("Atendimento" em `--l-ink` + "por IA" em `--lime`), parágrafo 15.5px `line-height: 1.65` com largura máxima de 620px, selo de check + "Metodologia validada por dezenas de clínicas", e um bloco pill "Comece agora" (`height: 78px; border-radius: 39px; background: --l-bg2`) com botão branco dentro.
3. **Seção preta do método BPM** — fundo `--l-bg3`, cantos 32px. Três cartões escuros, cada um com um filete limão de 4px no topo com `box-shadow: 0 0 26px 6px rgba(168,211,24,.55)` (o efeito de brilho é do site), círculo de 40px com a letra B/P/M em outline limão, título 19px weight 600, corpo 13px `line-height: 1.6`, e chips de 27px. Abaixo, régua divisória e três números em 46px weight 700 limão (14 / 02 / +R$ 100M).
4. **Quatro cartões de dor** — cartões brancos (`--l-card`), raio 20px, padding 22px, ícone em círculo limão de 34px, título 14.5px weight 600, corpo 12.5px.
5. **Bloco de produto** — texto à esquerda (título, parágrafo 14px, três linhas de check, CTA pill limão de 50px) + mock escuro do inbox à direita com 600px de largura e raio 20px.
6. **FAQ** — pergunta 14.5px weight 600 + resposta 13px `line-height: 1.6`, separadas por `--l-line`, chevron à direita.
7. **CTA final** — bloco `background: --lime`, raio 32px, padding 42px 48px, título 32px weight 600 em `#10160A`, botão preto.
8. **Footer** — logo em 96px com `opacity: .65`, endereço e telefone reais da Conduzza (Tirol Office · R. Jaguarari, 2281 · Natal/RN · 84 99104 0914), copyright.

### 1. Login / seleção de clínica
- **Rota:** `/entrar`
- **Propósito:** autenticar e, para quem tem acesso a várias operações, escolher a clínica (multi-tenant).
- **Layout:** split. Painel esquerdo de 44% com gradiente escuro, logo branco, headline em 30px e três números de prova. Painel direito centralizado com formulário de 380px.
- **Dois passos:** (a) credenciais — e-mail e senha, campos de 44px, raio 9px, CTA de 46px; (b) seleção de clínica — três cartões de 13px de padding, raio 11px, o ativo com `border-color: --acc`; cada um mostra avatar de 38px com iniciais, nome, papel e pendência ("Recepção · 7 conversas aguardando"). Botão "Voltar" retorna ao passo (a).
- **Comportamento:** clicar em qualquer clínica entra no app em `/atendimento`.

### 2. Atendimento (inbox) — tela principal
- **Rota:** `/atendimento`
- **Propósito:** a recepcionista trabalha o dia inteiro aqui. Otimizada para pressa: alvo mínimo de 28px, densidade alta, estado sempre visível.
- **Layout:** 4 colunas — sidebar 236px (global) · lista de conversas 322px · thread flexível · painel de contexto 320px.
- **Lista de conversas:**
  - Segmentador de posse no topo: "Minhas 4 / Sem atendente 3 / Todas 28" (`height: 30px`, raio 6px, ativo com `background: --s5`).
  - Chips de status: "IA atendendo 5" (violeta), "Aberta 6" (azul), "Aguardando 2" (âmbar), "Resolvida" (verde) — `height: 28px; border-radius: 14px`.
  - Cada linha: ponto de não-lida de 7px, avatar de 38px, nome 13.5px (weight 600 se não lida, 500 se lida), prévia 12.5px truncada, timestamp 11px em IBM Plex Mono, chip de estado 22px, e avatar do responsável 22px (violeta com faísca = IA; cinza com iniciais = humano).
  - Linha selecionada: `background: --s4` + `border-left: 3px solid --acc`.
- **Thread:** header de 64px (avatar, nome, canal, seletores de Responsável e Status), mensagens em bolhas de 74% de largura máxima (paciente à esquerda com `border-radius: 4px 14px 14px 14px`; IA/atendente à direita com `14px 4px 14px 14px`), indicador "Sofia (IA) está digitando…" com três pontos animados.
- **Bolha da IA:** fundo `--aiBg`, borda `--aiLine`, e **rótulo textual "Sofia" + selo "IA"** — nunca só cor, por acessibilidade.
- **Compositor:** callout de uma linha ("Sofia (IA) está respondendo este atendimento" + botão "Assumir conversa"), abas Responder/Nota interna, área de 76px. A **nota interna muda o fundo para âmbar** (`--amBg`/`--amLine`) — sinal físico de que o paciente não vê.
- **Painel de contexto:** Paciente (telefone, convênio, cadastro), Agendamento atual (cartão com status, data, profissional, botões Remarcar/Abrir ficha), Origem do lead (canal, campanha, primeiro contato), Etiquetas, Histórico com timeline pontilhada.

### 3. Leads (Kanban)
- **Rota:** `/leads`
- **Propósito:** ver o funil e o que está parado.
- **Layout:** 5 colunas de largura igual — Novo 9 · Em contato 12 · Agendado 7 · Compareceu 5 · Perdido 3. Cada coluna: cabeçalho com quadradinho de 8px colorido + nome + contagem em mono; corpo `background: --s2`, raio 12px, padding 10px, gap 10px.
- **Cartão de lead:** `background: --s3`, raio 10px, padding 11px. Nome 13px weight 600, telefone 12px em mono, chip de canal, **chip de SLA colorido por urgência** (verde ≤1h, âmbar ≤24h, vermelho com ícone de alerta >24h), avatar do responsável.
- **Cartão em foco:** `background: --s4` + `border-color: --grLine` + `box-shadow: 0 0 0 3px --grSoft`.
- **Toolbar:** seletor de funil, alternador Kanban/Lista, "Ordenado por próxima ação", "Filtros · 2", CTA "+ Novo lead".
- **A implementar:** drag-and-drop entre colunas, com modal de confirmação quando mover para Agendado ou Perdido (motivo obrigatório).

### 4. Agenda (dia por profissional)
- **Rota:** `/agenda`
- **Propósito:** a recepção vê o dia inteiro da clínica e aprova encaixes.
- **Layout:** eixo de horas de 62px à esquerda (08:00–15:00, **96px por hora**), 4 colunas de profissional de largura igual, e painel lateral de 264px.
- **Cabeçalho de coluna:** 62px de altura, avatar 32px, nome 12.5px, "Especialidade · N hoje".
- **Grade:** `repeating-linear-gradient` de 96px marcando as horas. Eventos posicionados com `position: absolute; top: <minutos/60*96>px`, `left/right: 6px`, raio 9px, **borda esquerda de 3px na cor do status**.
- **Seis estados de evento:** Agendado (azul), Confirmado (verde), Na recepção (âmbar), Faltou (vermelho), Concluído (neutro), **Encaixe da IA** (violeta, aguarda aprovação). Bloqueio é um bloco hachurado (`repeating-linear-gradient` 135°) com borda tracejada.
- **Cada evento** traz ícone + rótulo em maiúsculas + hora em mono + nome do paciente + linha de contexto ("Confirmado pelo paciente via IA").
- **Painel lateral:** "Pendente de você" com o encaixe sugerido pela IA e botões Aprovar/Recusar, lista de espera com 4 pacientes, e legenda completa dos estados.
- **Faltando:** visões Semana e Equipamentos (o alternador existe, sem conteúdo).

### 5. Pacientes
- **Rota:** `/pacientes`
- **Propósito:** base de pacientes com busca, filtros de situação e ficha.
- **Layout:** busca + filtros no topo (situações: sem retorno, faltou, aniversariantes), tabela principal, e ficha lateral com linha do tempo do paciente.

### 6. Resultados (origem de lead)
- **Rota:** `/resultados`
- **Propósito:** o gestor descobre qual canal traz paciente que comparece.
- **Layout:** 4 KPIs no topo, depois barras horizontais (520px fixos) + tabela de detalhe (flexível).
- **KPIs:** Leads recebidos 412 (▲18%), Agendamentos 247 (▲24%), Comparecimentos 193 (▲11%), Lead→comparecimento 46,8% (▼2,1 p.p.). Número em **34px weight 600**, delta verde ou vermelho.
- **Barras:** 8 canais ordenados por volume, rótulo alinhado à direita em 118px, trilha de 20px raio 4px, preenchimento `--acc`, valor em mono.
- **Tabela:** Canal · Leads · Agend. · Compar. · Conv. · CPA. Números em IBM Plex Mono. Conversão fora da faixa recebe cor (64,4% verde, 25,0% vermelho).
- **Insight no rodapé:** faixa violeta com leitura da IA.
- **Atribuição:** "último clique" — precisa ser configurável.

### 7. Agente de IA
- **Rota:** `/agente`
- **Propósito:** o gestor define como Sofia se comporta, sem depender da Conduzza.
- **Layout:** duas colunas de conteúdo + painel de prévia de 336px.
- **Blocos:** Identidade (nome, tom de voz em 3 opções), **Quando passar para humano** (4 toggles: convênio, desconto/preço, paciente pede atendente, divulgar que é IA), Horário de atuação, Base de conhecimento (arquivos com data), Nunca fazer (chips vermelhos).
- **Toggle:** trilha 42×24px raio 12px, knob de 18px, `transition: margin-left .15s ease`.
- **Prévia reativa:** a bolha de exemplo **muda de texto** conforme o toggle "Divulgar que é IA na 1ª mensagem". Ligado: "Oi! Aqui é a Sofia, assistente virtual da Clínica Vida…". Desligado: "Oi! Vou te ajudar a agendar a dermato…". Isso é intencional — é o valor da tela.
- **Stats de 30 dias:** 1.284 conversas, 63% resolvidas sem humano, 18 s de 1ª resposta, 474 escalonamentos.

---

## Interactions & Behavior

**Navegação**
- Sidebar vertical de 236px, fundo `#0C110F` **fixo nos dois temas** (é onde o logo branco funciona). Itens de 42px, raio 10px; ativo com `background: rgba(168,211,24,.14)`, texto `#D8F07E` e `box-shadow: inset 3px 0 0 #A8D318`.
- Grupos nomeados: "Operação" (Atendimento, Leads, Agenda, Pacientes) e "Inteligência" (Resultados, Agente de IA, Configurações). Rótulo de grupo em 10px, `letter-spacing: .12em`, maiúsculas.
- Badge de não-lidas no Atendimento: `background: #EF7E70`, texto `#1a0805`, altura 20px.
- Seletor de clínica no topo da sidebar (52px) e cartão de usuário no rodapé com botão de sair.
- Status ao vivo "Sofia está atendendo · 5 conversas agora" com ponto pulsante (`animation: blink 1.8s infinite`).

**Handoff IA → humano** (o comportamento central do produto)
- Estado `taken: boolean` por conversa. Enquanto `false`: campo Responsável mostra "Sofia · IA" com chip violeta, Status = "IA atendendo", e o compositor mostra o callout com "Assumir conversa".
- Ao assumir: aparece faixa verde de 8px de padding ("Você assumiu · IA pausada nesta conversa" + "Devolver para a IA"), Responsável passa a "Marina (você)" com chip cinza, Status vira "Aberta", e o callout desaparece.
- **Regra de negócio:** a IA não volta a responder na conversa até ser reatribuída explicitamente. Sem devolução automática por timeout.
- Escalonamento automático dispara pelas condições configuradas em `/agente` (convênio, preço, pedido explícito).

**Tema**
- `data-theme="dark|light"` no elemento raiz troca todos os tokens. O app abre no **claro**; a landing tem alternador próprio via `data-landing="light|dark"`.
- Não são temas independentes por tela: em produção deve ser preferência do usuário persistida (localStorage + coluna no perfil).

**Animações**
- `@keyframes blink` — três pontos do "está digitando" com `animation: blink 1.2s infinite` e delays de .2s/.4s; ponto de status da sidebar em 1.8s.
- Toggles com `transition: margin-left .15s ease`.
- Nada mais é animado. Ao implementar, mantenha as transições curtas (≤200ms): a tela é de uso intensivo.

**Estados ainda não desenhados (precisam ser criados na implementação)**
- Vazio: nenhuma conversa, funil vazio, dia sem agendamento, busca sem resultado.
- Carregando: skeleton da lista de conversas e da grade da agenda.
- Erro: falha de envio de mensagem (com retry), WhatsApp desconectado (crítico — precisa de banner global), falha ao salvar config do agente.
- Offline e reconexão.
- Mensagem longa, nome longo, anexo, áudio, imagem.

**Responsivo**
- Só desktop 1440px foi desenhado. A recepção usa desktop, mas o gestor abre Resultados no celular — o dashboard precisa de um layout mobile. Sugestão: sidebar vira bottom-nav abaixo de 900px; inbox vira navegação em duas etapas (lista → thread).

---

## State Management

Estado local do protótipo (a implementação vai precisar de bem mais):

| Estado | Valores | Papel |
|---|---|---|
| `screen` | landing · login · inbox · crm · agenda · pac · dash · config | vira roteamento |
| `theme` | dark · light | preferência do usuário, persistir |
| `landingTheme` | light · dark | só a landing |
| `step` | creds · pick | passo do login |
| `own` | mine · none · all | filtro de posse da lista |
| `taken` | boolean | quem controla a conversa selecionada |
| `mode` | reply · note | aba do compositor |
| `conv`/`preco`/`humano`/`disc` | boolean | regras de escalonamento do agente |

**Dados que precisam vir de API:** conversas + mensagens (tempo real via WebSocket — a lista precisa atualizar sem refresh), contatos/pacientes, leads e estágios, agendamentos e bloqueios, profissionais e disponibilidade, métricas agregadas por canal, configuração do agente, usuários e permissões, tenant atual.

**Pontos sensíveis de tempo real:** posse de conversa (dois atendentes não podem assumir a mesma), badge de não-lidas, indicador de digitação, e o encaixe pendente da IA na agenda.

---

## Design Tokens

### Fontes
- **App:** `'Inter Tight', system-ui, sans-serif` — pesos 400/500/600/700.
- **Landing:** `'Poppins', system-ui, sans-serif` — pesos 300/400/500/600/700 (é a fonte do site da Conduzza).
- **Números, telefones, horas, IDs:** `'IBM Plex Mono', monospace` — pesos 400/500. Uso deliberado: alinha colunas e evita erro de leitura de telefone.
- Import: `https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap`

### Escala de tipo (px)
10 · 10.5 · 11 · 11.5 · 12 · 12.5 · 13 · 13.5 · 14 · 14.5 · 15 · 15.5 · 16 · 17 · 19 · 22 · 28 · 30 · 32 · 34 · 44 · 46 · 56 · 64
Corpo do app: 12.5–13.5px. Rótulo de seção: 10.5px weight 600 `letter-spacing: .08em` maiúsculas. `line-height`: 1.45 em bolhas, 1.55–1.65 em parágrafos, 1.0–1.15 em números grandes.

### Espaçamento
Gap/padding em passos de 2px: 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · 11 · 12 · 14 · 16 · 18 · 20 · 22 · 24 · 28 · 32 · 40 · 44 · 48

### Raio
5 · 6 · 7 · 8 · 9 · 10 · 11 · 12 · 13 (pill pequeno) · 14 · 16 · 20 · 25/28/29/39 (pills da landing) · 32 · 50%

### Alturas de controle
Chip 19/21/22/24/26/27/28 · botão pequeno 28/30/32 · botão padrão 34/36 · campo 44 · botão grande 46/50/52 · pill da landing 56/58 · header 52/62/64/74

### Sombras
- Moldura do app: `0 24px 60px var(--shadow)`
- Mock escuro na landing clara: `0 24px 60px rgba(0,0,0,.22)`
- Filete limão do BPM: `0 0 26px 6px rgba(168,211,24,.55)`
- Foco de cartão no Kanban: `0 0 0 3px var(--grSoft)`
- Item ativo da sidebar: `inset 3px 0 0 #A8D318`

### Tokens do app — tema escuro (`:root`)
```css
--shell:#0b0b0b; --bg:#121212; --s1:#161616; --s2:#181818; --s3:#1f1f1f;
--s4:#242424; --s5:#2e2e2e; --s6:#3a3a3a; --av:#332f2e;
--t1:rgba(255,255,255,.92); --t2:rgba(255,255,255,.66);
--t3:rgba(255,255,255,.55); --t4:rgba(255,255,255,.42);
--line1:rgba(255,255,255,.08); --line2:rgba(255,255,255,.13); --line3:rgba(255,255,255,.24);
--shadow:rgba(0,0,0,.55);
--acc:#A8D318; --accHover:#c2e84a; --onAcc:#10160a;
--grT:#8AE3C2; --grBg:#1c2d26; --grLine:rgba(63,211,163,.5); --grSoft:rgba(63,211,163,.16);
--blue:#6EA8FE; --blueT:#A8C9FF; --blueBg:#1f2a33; --blueLine:rgba(110,168,254,.5);
--am:#E8B44C; --amT:#F0CE84; --amBg:#33291c; --amLine:rgba(232,180,76,.5); --amSoft:rgba(232,180,76,.16);
--rd:#EF7E70; --rdT:#FFAEA3; --rdBg:#33231f; --rdLine:rgba(239,126,112,.55); --rdSoft:rgba(239,126,112,.16); --onRd:#1a0805;
--ai:#9B8CF7; --aiT:#C6BCFF; --aiBg:#262433; --aiLine:rgba(155,140,247,.45); --aiSoft:rgba(155,140,247,.2);
```

### Tokens do app — tema claro (`[data-theme="light"]`)
```css
--shell:#EDEDEA; --bg:#FBFBFA; --s1:#FFFFFF; --s2:#FFFFFF; --s3:#F4F5F2;
--s4:#EDEEEA; --s5:#E3E5DF; --s6:#D6D9D2; --av:#E8EAE4;
--t1:#111311; --t2:#565C55; --t3:#767C74; --t4:#949A92;
--line1:rgba(0,0,0,.06); --line2:rgba(0,0,0,.11); --line3:rgba(0,0,0,.24);
--shadow:rgba(0,0,0,.14);
--acc:#6E8F05; --accHover:#5a7504; --onAcc:#FFFFFF;
--grT:#0B7A59; --grBg:#E8F6F0; --grLine:rgba(14,155,114,.45); --grSoft:rgba(14,155,114,.12);
--blue:#2F6FD0; --blueT:#20539F; --blueBg:#EBF2FC; --blueLine:rgba(47,111,208,.45);
--am:#B77800; --amT:#8A5A00; --amBg:#FCF3E1; --amLine:rgba(183,120,0,.45); --amSoft:rgba(183,120,0,.12);
--rd:#C63F2C; --rdT:#A93524; --rdBg:#FCEDEA; --rdLine:rgba(198,63,44,.45); --rdSoft:rgba(198,63,44,.12); --onRd:#FFFFFF;
--ai:#6B49DE; --aiT:#5133BE; --aiBg:#F1EDFE; --aiLine:rgba(107,73,222,.4); --aiSoft:rgba(107,73,222,.12);
```

**Importante sobre o acento:** no escuro o acento é o limão da marca `#A8D318`; no claro ele **precisa** escurecer para `#6E8F05` — limão sobre branco não passa contraste em texto e em botão pequeno. Não use `#A8D318` como cor de texto sobre fundo claro; use `--limeText: #5F7C06`. `#A8D318` como **fundo** de bloco grande com texto `#10160A` está correto (é o padrão do site).

### Tokens da landing (`[data-landing]`)
```css
/* claro (padrão, igual ao site) */
--l-bg:#F3F3F1; --l-card:#FFFFFF; --l-bg2:#EDEDEA; --l-bg3:#0A0C0A;
--l-ink:#111311; --l-ink2:#5A605A; --l-ink3:#8A908A;
--l-line:rgba(0,0,0,.07); --l-line2:rgba(0,0,0,.14); --l-chip:#F2F3EF;
--lime:#A8D318; --limeText:#5F7C06; --limeInk:#10160A;

/* escuro */
--l-bg:#0A0C0A; --l-card:#111412; --l-bg2:#111412; --l-bg3:#060806;
--l-ink:#F7F7F4; --l-ink2:rgba(255,255,255,.68); --l-ink3:rgba(255,255,255,.45);
--l-line:rgba(255,255,255,.09); --l-line2:rgba(255,255,255,.18); --l-chip:rgba(255,255,255,.05);
--lime:#A8D318; --limeText:#BCE43C; --limeInk:#10160A;
```

### Semântica de cor (não improvisar)
| Significado | Token | Onde aparece |
|---|---|---|
| Ação primária / marca | `--acc` limão | CTA, item ativo, seleção |
| IA / automático | `--ai` violeta | bolha da IA, chip "IA atendendo", encaixe sugerido, insight |
| Agendado / informativo | `--blue` | status de agendamento, "Sem atendente" |
| Confirmado / sucesso | `--grT` verde-água | confirmado, resolvido, SLA em dia |
| Aguardando / atenção | `--am` âmbar | aguardando paciente, na recepção, **nota interna** |
| Falta / erro / urgente | `--rd` vermelho | faltou, SLA estourado, badge de não-lidas, "nunca fazer" |

O violeta é reservado para IA — **nunca** use para outra coisa; é o que torna a presença da IA legível de relance.

### Acessibilidade
- Texto secundário está em 60–66% de opacidade para bater ~4.5:1 no escuro. **Não baixe.**
- Estado nunca é comunicado só por cor: todo chip e todo evento de agenda tem ícone + rótulo textual.
- Alvos de toque: mínimo praticado é 28px em ação secundária densa e 34–44px em ação primária. Em qualquer versão touch, subir para 44px.
- Faltando e obrigatório: anéis de `:focus-visible` (o protótipo não os declara), navegação por teclado no inbox (setas na lista, atalho para assumir conversa), `aria-live` para mensagem nova, e labels reais nos campos.

---

## Assets
| Arquivo | Origem | Uso |
|---|---|---|
| `conduzza-logo-branca.webp` | fornecido pelo cliente (oficial), 1024×158 | sidebar, painel escuro do login, landing escura |
| `conduzza-logo-preta.png` | **derivado** — gerado escurecendo os pixels claros do logo oficial e preservando o verde-limão | nav e footer da landing clara |

**Peça o logo preto oficial ao cliente.** A versão preta deste pacote foi gerada por manipulação de pixel e serve como stand-in — pode ter borda imperfeita em zoom alto. Peça também SVG de ambos: o app usa o logo em 96–150px, onde raster de 1024px de largura desperdiça banda e não escala em telas de alta densidade.

**Ícones:** todos são SVG inline de 24×24 desenhados à mão no protótipo, com `stroke-width` 2–3 e `stroke="currentColor"`. Não são de nenhuma biblioteca. **Substitua por uma biblioteca de ícones real** (Lucide é o par mais próximo do estilo) e mantenha o traço em 2px. Ícones usados: whatsapp/chat, kanban, calendário, gráfico de barras, faísca (IA), pessoa, engrenagem, busca, chevrons, check, relógio, alerta, X, clipe, olho, sair, mais.

**Sem imagens de foto.** Se a landing for receber foto de clínica ou retrato de médico, precisa de nova rodada de design — o layout atual não reserva espaço para isso.

---

## Files

| Arquivo | Conteúdo |
|---|---|
| `Conduzza Atendimento IA v2.dc.html` | **referência principal** — as 8 telas (landing, login, inbox, leads, agenda, pacientes, resultados, agente), dois temas, todos os estados interativos |
| `Conduzza Atendimento IA.dc.html` | v1, só escura, sem landing/login/pacientes. Histórico — implemente a partir da v2 |
| `conduzza-logo-branca.webp` | logo oficial |
| `conduzza-logo-preta.png` | logo derivado para fundo claro |
| `support.js` | runtime do protótipo. **Não porte** |

**Para navegar os protótipos:** abra o arquivo v2 no navegador. Ele começa na landing; qualquer botão leva ao login; o login entra no app. Dentro do app, use a sidebar. Os controles que realmente funcionam: alternador de tema, "Assumir conversa" / "Devolver para a IA", abas Responder/Nota interna, filtros de posse da lista, os quatro toggles do agente (com prévia reativa) e os dois passos do login.

---

## Ordem sugerida de implementação
1. **Shell + tokens + tema.** Sidebar, header, roteamento, os dois temas. Tudo depende disso.
2. **Inbox.** É o produto. Comece pela lista e pela thread com dados reais; deixe posse/handoff para o passo 3.
3. **Handoff IA↔humano** com tempo real. Aqui está o risco técnico (concorrência de posse) e o valor do produto.
4. **Agenda.** Segunda tela mais usada; a matemática de posicionamento é a parte trabalhosa.
5. **Leads** com drag-and-drop.
6. **Pacientes.**
7. **Resultados.** Depende de agregação no backend; pode ir em paralelo.
8. **Agente de IA.** Última — é configuração, usada raramente.

## Decisões em aberto para o cliente
- Números reais da landing (14 estados / 02 anos / +R$ 100M são placeholder).
- Visões Semana e Equipamentos da agenda; visão Lista do Kanban.
- Regra de atribuição do dashboard (hoje "último clique").
- Papéis e permissões: recepcionista vs. gestor vs. equipe Conduzza multi-tenant veem exatamente as mesmas telas no protótipo. Precisa de matriz de permissão.
- LGPD: o toggle de divulgação de IA existe, mas retenção de conversa, consentimento e exportação/exclusão de dados de paciente não foram desenhados.
- Quatro explorações de variação nunca foram feitas (layout do inbox, sinalização do handoff, cartão de lead, grade da agenda) — se o time de produto quiser comparar direções antes de codar, elas ainda não existem.
