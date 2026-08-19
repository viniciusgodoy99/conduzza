# BRIEF DE TELAS PARA O CLAUDE DESIGN
### Conduzza Clínicas: SaaS de atendimento com IA para clínicas médicas e de estética
Versão 1.1 (auditada, paleta validada em contraste) | 14 telas

> **INSTRUÇÃO DE USO:** este arquivo é autocontido. Cole do bloco "TESE" até o fim no Claude Design. Se for gerar em partes, cole sempre as seções 1 a 5 (tese, glossário, contexto, design system e estrutura global) junto com a tela que quiser desenhar. Elas são o contrato visual.

---

## TESE DO DESIGN

**A tela precisa fazer uma recepcionista de 22 anos, no primeiro dia de trabalho, resolver a fila da noite anterior em 10 minutos sem ninguém explicar nada.** Densidade de informação é boa. Complexidade de decisão é ruim. Toda escolha visual deste documento serve a isso, e nada mais.

---

## 1. GLOSSÁRIO DE TERMOS DE DESIGN USADOS AQUI

| Termo | Significado |
|---|---|
| **Rail** | Barra de navegação vertical fixa à esquerda, com os itens de menu |
| **Bento** | Arranjo de cards modulares de tamanhos diferentes, com um card herói maior que os demais |
| **Drawer** | Painel que desliza pela lateral sobre o conteúdo, sem trocar de página |
| **Skeleton** | Esqueleto cinza com a forma do conteúdo real, mostrado enquanto carrega |
| **Takeover** | Ação de o atendente humano assumir uma conversa que a IA estava conduzindo |
| **Chip** | Etiqueta pequena e arredondada com ícone e texto, usada para status e filtro |
| **Tabular (número)** | Variante da fonte em que todo dígito tem a mesma largura, para os números alinharem em coluna |
| **Superfície** | Nível de profundidade da interface. Fundo, painel, card, popover e modal são superfícies diferentes |
| **Breakpoint** | Largura de tela em que o layout muda de comportamento |
| **Hold** | Reserva temporária de um horário na agenda enquanto o paciente decide |
| **Handoff** | Passagem do atendimento da IA para o humano. Na interface, chamar sempre de "Assumir" |
| **Tenant** | Cada clínica dentro do sistema. Na interface, chamar sempre de "clínica" |

---

## 2. CONTEXTO DO PRODUTO

**O que é:** SaaS web que coloca uma recepcionista de IA no WhatsApp da clínica. Ela responde 24 horas, informa preço e convênio, agenda, remarca, cancela, confirma consulta e reoferta horário cancelado. O software também guarda leads, pacientes, agenda e mostra de qual campanha cada paciente veio.

**Quem usa, e essa é a decisão de design mais importante:**

| Persona | Uso | Nível técnico | Onde |
|---|---|---|---|
| **Recepcionista** (usuária principal, 80% do tempo de tela) | O dia inteiro, todo dia | Baixo. Sem treinamento longo, alta rotatividade | Desktop, **1366x768** na maioria das clínicas, sala clara |
| Gestor da clínica | Minutos por dia, olha números | Médio | Desktop e celular |
| Agência (Conduzza) | Configura o agente, olha relatório | Alto | Desktop |

**Plataforma:** aplicação web, **desktop-first**, com quebra funcional definida na Seção 6.

**White-label:** o produto é revendido com marcas diferentes. Logo, cor primária, nome do produto e nomenclatura ("profissional" pode virar "advogado") são configuráveis. **Nada de logo, cor ou nome fixo no layout.**

---

## 3. DESIGN SYSTEM

### 3.1 Princípio

Escuro por padrão, claro obrigatório, alternável por chave. Painel sóbrio, denso, sem enfeite. **Nada de gradiente decorativo, vidro fosco, sombra colorida ou ilustração 3D.** É ferramenta de trabalho, não landing page.

### 3.2 Paleta, tema escuro

Todos os valores abaixo foram calculados contra WCAG 2.2 e a razão de contraste está anotada. A base não é preto puro, conforme Material 3.

```
SUPERFÍCIES
Fundo da aplicação      #0F1113
Superfície 1 (painel)   #16191C
Superfície 2 (card)     #1D2126
Superfície 3 (popover)  #242930
Superfície 4 (modal)    #2B3138

BORDAS
Divisor decorativo      #262B31   (não precisa de contraste, é decorativo)
Borda de campo e de
controle interativo     #5E6773   (3,30:1 contra o fundo, atende ao mínimo de 3:1)

TEXTO
Primário                #ECEFF3   (16,2:1 contra o fundo. Nunca branco puro)
Secundário              #9BA5B2   (5,26:1 contra a Superfície 4, o pior caso)
Terciário               #949DA9   (4,79:1 contra a Superfície 4, o pior caso)
```

### 3.3 Paleta, tema claro

```
SUPERFÍCIES
Fundo da aplicação      #EEF0F4
Superfície 1 (painel)   #FFFFFF
Superfície 2 (card)     #FFFFFF com borda #DDE1E8
Superfície 3 (popover)  #FFFFFF com borda #D2D8E0 e sombra sutil
Superfície 4 (modal)    #FFFFFF com borda #D2D8E0

BORDAS
Divisor decorativo      #E2E6EC
Borda de campo e de
controle interativo     #8A929E   (3,39:1 contra branco)

TEXTO
Primário                #14181D   (16,8:1 contra branco)
Secundário              #5A6472   (6,44:1)
Terciário               #6E7787   (4,72:1)
```

**Nota honesta sobre separação de card no tema claro:** card branco sobre fundo #EEF0F4 dá 1,14:1 de contraste. Isso é normal em interfaces claras (Linear, Notion) e a WCAG não exige contraste em borda de contêiner não interativo. A separação vem da borda de 1px, não da diferença de luminosidade. **Não tente resolver isso escurecendo o card.**

### 3.4 Cores semânticas (validadas)

| Papel | Escuro | Contra Superfície 2 | Claro | Contra branco | Significado |
|---|---|---|---|---|---|
| Primária (marca, IA) | `#5B9CFF` | 5,89:1 | `#2563EB` | 5,17:1 | Ação principal, IA, seleção |
| Sucesso | `#3FD68C` | 8,64:1 | `#15803D` | 5,01:1 | Confirmado, compareceu |
| Atenção | `#F5B14C` | 8,70:1 | `#B45309` | 5,02:1 | Pendente, aguardando |
| Alerta | `#FF6369` | 5,61:1 | `#DC2626` | 4,83:1 | Faltou, cancelado, atrasado |
| Neutro | `#9BA5B2` | 5,73:1 | `#5A6472` | 6,44:1 | Agendado, sem status |
| Destaque | `#E5C07B` | 9,80:1 | `#8A5A00` | 5,60:1 | VIP, alta prioridade |

A cor primária tem cota. **Se a tela tiver mais de 3 elementos na cor primária, está errada.** Proporção 60/30/10, acento só na ação principal, no item de menu ativo e na marcação da IA.

### 3.5 Regra de status (obrigatória)

**Todo estado é comunicado por três camadas simultâneas: forma do ícone, rótulo em texto e cor.** Nunca o mesmo ícone em cores diferentes. Motivo: 8% dos homens têm alguma deficiência de percepção de cor, e a recepção trabalha em monitor sem calibração.

Chip padrão: altura 24px, raio 6px, ícone 14px à esquerda, rótulo 12px semibold, fundo com 12% de opacidade da cor semântica, texto na cor cheia.

**Status de agendamento, os 10 que precisam existir:**

| Estado | Ícone (Lucide) | Rótulo no chip | Cor |
|---|---|---|---|
| Agendado | `calendar` | Agendado | Neutro |
| Aguardando confirmação | `clock` | Aguardando | Atenção |
| Confirmado pelo paciente | `message-circle-check` | Confirmado por WhatsApp | Sucesso |
| Confirmado pela recepção | `user-check` | Confirmado pela recepção | Sucesso |
| Aguardando na recepção | `armchair` | Na recepção | Primária |
| Em atendimento | `stethoscope` | Em atendimento | Primária |
| Compareceu | `check-check` | Compareceu | Sucesso |
| Cancelado pelo paciente | `x-circle` | Cancelado pelo paciente | Alerta |
| Cancelado pela clínica | `building-2` com risco | Cancelado pela clínica | Alerta |
| Faltou | `triangle-alert` | Faltou | Alerta |

**Status de conversa:**

| Estado | Ícone | Rótulo | Cor |
|---|---|---|---|
| IA atendendo | `sparkles` | IA | Primária |
| Aguardando humano | `hand` | Aguardando você | Atenção |
| Em atendimento | avatar do usuário | nome do atendente | Neutro |
| Resolvida | `check-circle` | Resolvida | Sucesso |

**Biblioteca de ícones: Lucide, traço de 1,5px, tamanho base 16px.** Não misturar bibliotecas. Ícone de item de menu ativo é a versão preenchida quando existir, senão traço de 2px.

### 3.6 Tipografia

Duas fontes no máximo. **Inter** para interface. **JetBrains Mono** apenas para números tabulares em tabela e valores monetários.

```
Display (número herói)     36px / 700 / -0.02em / tabular
Título de página           22px / 600
Título de card             15px / 600
Corpo                      14px / 400 / 1.5
Rótulo e metadado          12px / 500
Micro (timestamp)          11px / 500 / uppercase / 0.04em
```

**Atenção:** nada em 11px ou 12px se qualifica como "texto grande" pela WCAG (o piso é 24px, ou 18,5px em negrito). Portanto **todo texto de chip e de metadado precisa dos 4,5:1 completos**, e é por isso que as cores da Seção 3.4 foram calculadas assim.

Números sempre tabulares e alinhados à direita em tabela.

### 3.7 Formatos brasileiros

```
Data curta      14/08/26          Data longa    14 de agosto de 2026
Data relativa   hoje, ontem, há 2 dias
Hora            14:30 (24h, sempre)
Data e hora     14/08 às 14:30
Moeda           R$ 4.752,00       Compacto      R$ 4,7 mil
Telefone        (85) 99999-9999
Percentual      69,1%             Duração       40 min · 1h20
Nome de mês em tabela: abreviado em 3 letras, minúsculo (jan, fev, mar)
```

### 3.8 Grid, espaçamento, alvos

- Grid de 8pt. Espaçamentos: 4, 8, 12, 16, 24, 32, 48.
- Raio: 8px em card, 6px em campo e botão, 12px em modal, 999px em chip e avatar.
- Alvo de toque mínimo de 40x40px na prática (24x24px é só o piso legal).
- Largura máxima de conteúdo de leitura: 720px. Tabela e agenda usam a largura inteira.

### 3.9 Elevação e foco

Elevação é **tonal**, não sombra, no tema escuro. Cinco níveis contando o fundo: Fundo, Superfície 1, 2, 3 e 4. No tema claro, use borda de 1px mais sombra muito sutil só em popover e modal.

Anel de foco: 2px, cor primária, offset de 2px, com no mínimo 3:1 contra o fundo e contra o elemento. Visível em navegação por teclado sempre.

---

## 4. ESTRUTURA GLOBAL

```
┌──────────┬─────────────────────────────────────────────────────────┐
│ RAIL     │  BARRA SUPERIOR (56px)                                   │
│ 240px    │  Título · seletor de unidade · busca · tema · sino · você│
│          ├─────────────────────────────────────────────────────────┤
│ [MARCA]  │                                                          │
│          │                                                          │
│ OPERAÇÃO │                                                          │
│ Início   │                                                          │
│ Atendim. │                   ÁREA DE CONTEÚDO                       │
│ Agenda   │                                                          │
│ Leads    │                                                          │
│ Pacientes│                                                          │
│ Confirm. │                                                          │
│ Espera   │                                                          │
│ Relatór. │                                                          │
│ ──────── │                                                          │
│ AJUSTES  │                                                          │
│ Agente   │                                                          │
│ Automaç. │                                                          │
│ Cadastros│                                                          │
│ Config.  │                                                          │
│          │                                                          │
│ [usuário]│                                                          │
└──────────┴─────────────────────────────────────────────────────────┘
```

**Marca:** espaço de 160x32px no rail expandido. **No rail colapsado (64px), usar a versão ícone de 32x32px.** As duas versões são obrigatórias no white-label.

**Rail:** dois grupos separados por divisor e por rótulo em micro tipografia. Item ativo com barra de 3px na cor primária à esquerda, fundo Superfície 2 e ícone preenchido. Item inativo com ícone em traço e texto secundário.

**Badges de contagem:** em Atendimento (conversas aguardando humano) e em Confirmações (pendentes de amanhã). Na cor de alerta se houver item vencido.

**Barra superior, da direita para a esquerda:** avatar com menu, sino, chave de tema, busca global, seletor de unidade (só aparece se a clínica tiver mais de uma).

---

## 5. MATRIZ DE PERMISSÃO (o designer precisa disso para desenhar os estados desabilitados)

| Módulo | Admin | Gestor | Recepção | Profissional | Leitura |
|---|---|---|---|---|---|
| Atendimento | tudo | tudo | tudo | só as próprias conversas | ver |
| Agenda | tudo | tudo | tudo | só a própria agenda | ver |
| Leads e Pacientes | tudo | tudo | tudo | ver | ver |
| Confirmações e Lista de espera | tudo | tudo | tudo | ver | ver |
| Relatórios | tudo | tudo | ver | só os próprios | ver |
| Agente de IA | tudo | tudo | ver | nada | nada |
| Automações | tudo | tudo | ver | nada | nada |
| Cadastros | tudo | tudo | ver | ver | ver |
| Configurações e Assinatura | tudo | ver | nada | nada | nada |

**Regra visual:** ação sem permissão fica **visível e desabilitada**, com dica explicando por quê. Esconder confunde mais do que desabilitar. Módulo inteiro sem permissão some do rail.

---

## 6. RESPONSIVIDADE (breakpoints numéricos)

| Largura | Comportamento |
|---|---|
| **≥ 1600px** | Layout completo. Inbox com as 4 colunas abertas. Agenda mostra até 7 profissionais |
| **1366 a 1599px** (a mais comum na recepção) | **Rail colapsa automaticamente para 64px.** No Inbox, o painel de contexto colapsa por padrão e abre como sobreposição de 360px. Agenda mostra 4 colunas antes de rolar horizontalmente |
| **1024 a 1365px** | Rail em 64px. Inbox vira duas colunas: lista **ou** conversa, com botão de voltar. Agenda mostra 3 colunas |
| **768 a 1023px** (tablet) | Rail vira gaveta acionada por botão. Kanban vira lista. Agenda só em visão de dia com 2 colunas |
| **< 768px** (celular) | Só Início e Atendimento são suportados de verdade. Uma coluna. Lista de conversas em tela cheia, conversa em tela cheia, contexto em drawer de baixo para cima. As demais telas mostram aviso "melhor no computador" com acesso somente leitura |

---

## 7. AS 14 TELAS

Ordem de prioridade. As 4 primeiras são o produto.

---

### TELA 1. ATENDIMENTO (Inbox) `PRIORIDADE MÁXIMA`

Quatro regiões.

```
┌────┬──────────────────┬───────────────────────────────┬──────────────────┐
│Rail│ LISTA 340px      │  CONVERSA (fluido)            │ CONTEXTO 320px   │
│    │                  │                               │ (colapsável)     │
│    │ [Minhas 4][Sem   │  ┌ Cabeçalho 64px ──────────┐ │                  │
│    │ atend. 12][IA 8] │  │ Maria Silva  · Lead      │ │  [avatar 64px]   │
│    │ [Resolvidas][⋯]  │  │ (85) 99999-9999          │ │  Maria Silva     │
│    │                  │  │ [chip ✦ IA]              │ │  [chip Lead]     │
│    │ [buscar]         │  │ [Assumir] [Resolver] [⋯] │ │                  │
│    │ ◦Não lidas ◦Esc. │  └──────────────────────────┘ │  ORIGEM          │
│    │                  │                               │  Google Ads      │
│    │ ┌──────────────┐ │   ┌ recebida ┐                │  Camp. Botox     │
│    │ │● Maria S. 2m │ │   └──────────┘                │  14/08 às 21:47  │
│    │ │ ✦ IA         │ │                               │                  │
│    │ │ "Quero saber"│ │        ┌ enviada pela IA ───┐ │  DADOS           │
│    │ │ [Ads][Botox] │ │        │ ✦ IA · 21:48       │ │  Convênio: part. │
│    │ └──────────────┘ │        └────────────────────┘ │  Etapa: Novo     │
│    │ ┌──────────────┐ │                               │  Opt-in: ativo   │
│    │ │ João P.  12m │ │  ┌ COMPOSITOR ──────────────┐ │                  │
│    │ │ 👤 Ana       │ │  │ ⚠ A IA está atendendo    │ │  PRÓXIMA CONSULTA│
│    │ └──────────────┘ │  │   esta conversa[Assumir] │ │  [vazio][Agendar]│
│    │                  │  │ [campo desabilitado]     │ │                  │
│    │                  │  │ 😊 📎 🎤 ⚡🔒  ⏱23h47 [→]│ │  HISTÓRICO       │
│    │                  │  └──────────────────────────┘ │  [linha do tempo]│
└────┴──────────────────┴───────────────────────────────┴──────────────────┘
```

**Coluna 2, lista (340px):**

1. **Abas de posse com contador:** `Minhas` · `Sem atendente` · `IA atendendo` · `Resolvidas` · `Todas`. Aba ativa com sublinhado de 2px na cor primária.
2. **Busca** com placeholder "Buscar por nome ou telefone".
3. **Chips de filtro rápido** com rolagem horizontal: Não lidas, Escaladas, Hoje, Sem opt-in, por etiqueta. Chip ativo preenchido.
4. **Cartões de conversa de 76px**, contendo:
   - Avatar circular de 40px com iniciais, cor derivada do nome.
   - Nome em 14px semibold.
   - **Linha de posse, sempre presente:** chip `✦ IA` na cor primária, ou avatar de 16px mais o nome do atendente. Nunca deixar sem posse.
   - Prévia da última mensagem, 12px, uma linha com reticências.
   - Horário relativo no canto superior direito.
   - Ponto de não lida de 8px na cor primária.
   - Até 2 etiquetas em chips de 18px.
   - Selecionado: fundo Superfície 2 e barra de 3px na cor primária à esquerda.

**Coluna 3, conversa:**

- **Cabeçalho fixo (64px):** nome, telefone, chip de tipo (Lead ou Paciente), chip de posse. À direita: **Assumir** (primário) ou **Devolver para a IA**, **Resolver**, e menu de três pontos com Etiquetar, Transferir, Bloquear, Ver ficha.
- **Fluxo de mensagens.** Recebidas à esquerda em Superfície 2. Enviadas à direita. **Mensagem da IA com borda esquerda de 2px na cor primária e selo `✦ IA` de 11px acima da bolha.** Mensagem de humano mostra o nome de quem enviou. Nota interna com fundo âmbar a 8%, ícone de cadeado e rótulo "Nota interna, o paciente não vê".
- **Cartão de evento do sistema** entre mensagens, centralizado, 12px, fundo Superfície 2: "Ana assumiu a conversa", "Consulta agendada para 20/08 às 14:30", "A IA escalou: paciente descreveu sintoma".
- **Bloqueio de conformidade** aparece como cartão de alerta: "Mensagem bloqueada antes do envio: continha orientação clínica. Escalado para atendimento humano." Com link "Ver o que a IA ia responder".
- **Indicador "IA digitando"** com três pontos animados.
- **Áudio recebido:** player mais transcrição automática em texto secundário, colapsada em 2 linhas com "ver mais".
- Separadores de data centralizados.

- **Compositor, três estados:**
  1. **IA atendendo:** faixa âmbar acima do campo com "A IA está atendendo esta conversa" e botão **Assumir**. Campo desabilitado.
  2. **Humano no controle, dentro da janela:** campo livre. **Contador no canto inferior direito: `⏱ 23h47 restantes`.** Âmbar abaixo de 4h, alerta abaixo de 1h.
  3. **Janela expirada:** o campo some e vira um bloco: "Fora da janela de 24 horas. Só é possível enviar um modelo aprovado." com botão **Escolher modelo**. Isso é regra da Meta e precisa ser visível o tempo todo, não escondido em erro.
- Barra de ferramentas: emoji, anexo, áudio, respostas rápidas (`zap`), nota interna (`lock`).

**Coluna 4, contexto (320px, colapsável):**

Blocos com título em micro tipografia maiúscula: Identificação · **Origem** (canal, campanha, data, método de captura) · Dados (convênio, etapa, procedimento de interesse, **estado do opt-in com botão de descadastrar**) · **Próxima consulta** (card com chip de status, ou botão Agendar em destaque se vazio) · **Saldo de pacote** (quando houver) · Histórico · **Ações** (Agendar, Adicionar à lista de espera, Marcar como perdido, Ver ficha).

**Estados obrigatórios:** nenhuma conversa selecionada, aba vazia, busca sem resultado, e **WhatsApp desconectado** (faixa vermelha fixa no topo de todas as telas, com botão Reconectar, impossível de ignorar).

---

### TELA 2. CONFIRMAÇÕES DO DIA `PRIORIDADE MÁXIMA`

Primeira tela que a recepcionista abre de manhã. **A mais simples do sistema.**

**Topo, bento com o card de Pendentes como herói (largura dupla):**

```
┌──────────────────────────┬────────────┬────────────┬────────────┐
│  PENDENTES               │ CONFIRMADAS│ CANCELADAS │ RECUPERADAS│
│  ⏱                       │ ✓          │ ✕          │ ↻          │
│  14                      │ 38         │ 3          │ 2          │
│  de 55 consultas amanhã  │ 69,1%      │ 5,5%       │ R$ 400,00  │
│  [Cobrar todos os 14]    │            │            │ da espera  │
└──────────────────────────┴────────────┴────────────┴────────────┘
```

**Corpo: lista agrupada por profissional**, ordenada por horário, linhas de 56px:

`[14:30] [avatar] [Maria Silva] [Consulta dermato] [Unimed] [chip de status] [ações]`

- Ações: **Cobrar agora** (só em pendentes), **Ligar** (`tel:`), **Confirmar manualmente**, **Abrir conversa**.
- O chip mostra a autoria: "Confirmado por WhatsApp" com ícone `message-circle-check`, ou "Confirmado pela recepção" com ícone `user-check`. **Duas coisas diferentes precisam parecer diferentes.**
- Paciente com histórico de falta ganha ícone `triangle-alert` antes do nome, com dica "2 faltas anteriores".
- Seletor de data no topo, padrão em amanhã.
- Aba secundária **"Faltas de hoje"** com a régua pós falta: quem faltou, se já recebeu contato, botão Remarcar.

---

### TELA 3. AGENDA `PRIORIDADE MÁXIMA`

**Barra de filtros, e a ordem importa:**

`[◄ 14/08/26 ►] [Unidade] [Especialidade] [Convênio] [Procedimento] [Profissional] ··· [Dia|Semana] [+ Novo agendamento]`

**Nome do profissional é o ÚLTIMO filtro.** A recepção pergunta "quem está livre para dermato pela Unimed", não "abra a agenda do Dr. Fulano". Esse detalhe separa a agenda boa da ruim.

**Visão Dia (padrão):** uma coluna por profissional, mínimo de 180px, rolagem horizontal conforme a Seção 6. Cabeçalho fixo com foto de 32px, nome, especialidade e contador "8 de 12 horários".

- Eixo de horas fixo à esquerda, faixa de 15 minutos, linha reforçada a cada hora.
- **Linha do horário atual** em vermelho fino atravessando as colunas.
- **Bloco de agendamento:** altura proporcional à duração, borda esquerda de 4px na cor do status, nome em 13px semibold, procedimento em 11px, ícone de status no canto. Bloco de menos de 30 minutos mostra só o nome.
- **Bloqueio:** hachura diagonal a 45 graus mais rótulo do motivo. Nunca só cor.
- **Encaixe:** borda tracejada, deslocamento de 8px.
- **Reserva temporária (hold):** bloco semitransparente com contador regressivo e rótulo "Reservado pela IA, 8 min". Estado novo e essencial: sem ele, IA e recepção marcam duas pessoas no mesmo horário.
- Arrastar e soltar para remarcar, com modal perguntando se deve avisar o paciente.
- Clique em espaço vazio abre o modal já preenchido com profissional e horário.
- Menu de três pontos no topo: Imprimir agenda do dia, Exportar, **Ver histórico de alterações**.

**Visão Semana:** um profissional, 7 colunas de dia.

**Modal de novo agendamento (uma tela só, nada de assistente de várias etapas, é a ação mais repetida do dia):**
1. Buscar paciente por nome ou telefone, ou criar novo ali mesmo.
2. **Unidade** (só aparece se houver mais de uma).
3. Convênio.
4. Procedimento (a lista filtra pelo convênio).
5. Profissional (só quem faz aquele procedimento naquele convênio, com preço e duração ao lado do nome).
6. Data e horário, com **3 primeiros horários livres em botões grandes** mais "escolher outro".
7. **Aviso de recurso** quando o procedimento exige sala ou equipamento ocupado.
8. Observação.
9. Chave "Enviar confirmação automática", ligada por padrão.

---

### TELA 4. LEADS `PRIORIDADE ALTA`

**Toggle Lista e Kanban preservando o filtro.**

**Kanban:** colunas Novo, Em contato, Aguardando resposta, Agendou, **Compareceu**, Perdido. Cabeçalho com nome, **contagem em cinza** e menu.

**Cartão com exatamente 5 elementos, nem um a mais:**
1. Nome, 14px semibold
2. Telefone, 12px secundário
3. Badge de origem
4. **Badge de tempo desde o último contato**, com ícone, rótulo e cor: verde até 4h, âmbar de 4h a 24h, vermelho acima de 24h
5. Avatar de 20px do responsável, canto inferior direito

Campo vazio some, nunca mostra rótulo sem valor. Arrastar entre colunas. Soltar em Perdido abre modal obrigatório de motivo. **Ordenação padrão dentro da coluna: por próxima ação.**

**Lista:** tabela densa, linhas de 44px, colunas Nome, Telefone, Origem, Campanha, Etapa, Responsável, Último contato, Entrou em, **Opt-in**. Seleção múltipla com barra de ações em massa flutuando na base.

**Drawer de detalhe (480px)** ao clicar: dados, origem, conversa resumida, botões Abrir conversa, Agendar, Marcar perdido.

**Modal de importação por planilha:** upload, mapeamento de colunas, pré-visualização, e um **passo obrigatório de declaração de consentimento** ("de onde veio a autorização desses contatos?") com opções e campo de observação. Sem esse passo, o botão de importar fica desabilitado. Aviso em caixa: "Disparar mensagem para quem não autorizou derruba a nota do seu número no WhatsApp e pode travar os envios da clínica inteira."

---

### TELA 5. INÍCIO (Dashboard) `PRIORIDADE ALTA`

Bento, um ponto focal só, leitura em F.

**Linha 1, faixa de 4 indicadores** (número em 36px tabular, rótulo em cima, variação contra o período anterior embaixo com seta e cor):
`Leads no período` · `Agendamentos` · `Comparecimentos` · `Taxa de lead para comparecimento`

**Linha 2:**
- **Card herói, largura dupla: "Consultas recuperadas".** Número grande, valor em reais abaixo, e uma linha explicando a composição ("18 confirmações que evitaram falta, 4 horários reofertados, 2 remarcações após falta"). **É o card que justifica a mensalidade e precisa ser o maior elemento depois dos indicadores.**
- Card "Desempenho da IA": conversas atendidas, percentual resolvido sem humano com barra de progresso, tempo médio de primeira resposta, escalonamentos.

**Linha 3:**
- **Funil horizontal** de 3 etapas com a taxa de conversão escrita entre as setas.
- **Origem dos leads em barras horizontais** ordenadas por volume, rótulo à esquerda, número à direita da barra. **Proibido pizza, rosca, barra empilhada, medidor, treemap e 3D.**

**Linha 4:**
- Card "Custo de mensagens": gasto do mês, teto configurado, barra que fica âmbar em 80% e alerta em 95%.
- Card "Próximas ações": pendências de confirmação, leads sem resposta há mais de 24h, conversas aguardando humano. Cada item é link para a tela correspondente.

---

### TELA 6. AGENTE DE IA `PRIORIDADE ALTA`

Duas colunas: configuração à esquerda (60%), **simulador ao vivo à direita (40%, fixo na rolagem)**.

**Abas da esquerda:**

**Persona:** nome do atendente virtual, foto opcional, tom de voz em 3 cartões selecionáveis (Formal, Cordial, Próximo, **cada um com uma frase de exemplo real escrita dentro**), usar emoji, saudação, encerramento.

**Habilidades:** lista de chaves com título e uma linha de descrição. Habilidade que exige configuração mostra link "Configurar" e selo de aviso se incompleta. Responder dúvidas fica travada em ligada.

**Conhecimento:** perguntas e respostas editáveis mais upload de documento. Caixa informativa no topo: "Preços, profissionais, procedimentos e convênios vêm automaticamente do Cadastro. Não repita aqui."

**Regras e Limites:** horário de operação em grade por dia da semana com três modos, regras de escalonamento, e o **bloco de Conformidade**:

> Caixa âmbar com ícone de cadeado e chaves **desabilitadas em posição ligada**: "Estas travas são obrigatórias e não podem ser desligadas: o agente não faz triagem de sintoma, não indica tratamento ou medicamento, não promete resultado, e não faz oferta casada. Base: Resoluções CFM 2.314/2022 e 2.336/2023." Isso protege a clínica e é argumento de venda, então precisa ser visível, não escondido.

**Versões:** histórico com data, autor, resumo e botão Restaurar.

**Coluna direita, simulador:** conversa de teste em tempo real, botão **Reiniciar**, seletor de cenário ("Paciente perguntando preço", "Paciente querendo agendar", "Paciente descrevendo sintoma", "Paciente irritado"), e abaixo de cada resposta um painel colapsável **"Por que a IA respondeu isso"** com a habilidade usada e o que consultou. Rodapé fixo: **Publicar alterações**, com indicador "3 alterações não publicadas".

---

### TELA 7. AUTOMAÇÕES

Abas: **Confirmação** · **Follow-up de leads** · **Pós falta** · **Lista de espera**.

**Confirmação:** editor em linha do tempo horizontal.

```
Agendou ──● 72h antes ──● 24h antes ──● 3h antes ── Consulta
           │              │             │
        [modelo]       [modelo]      [modelo]
        [editar]       [editar]      [editar]
```

Cada ponto abre painel com modelo de mensagem e **pré-visualização em balão de WhatsApp, com os botões Confirmar, Remarcar e Cancelar renderizados**.

Abaixo:
- **Exceções por procedimento.** Texto de apoio: "Procedimentos com preparo, como colonoscopia, têm no-show muito maior e pedem mais toques."
- **Régua reforçada para paciente com histórico de falta** (chave mais número de faltas que dispara).
- **Estimativa de custo:** "Esta régua envia cerca de 1.320 mensagens por mês, considerando 440 consultas e 3 toques. Custo estimado: [valor]. Mensagens respondidas dentro de 24 horas não são cobradas."

**Follow-up:** mesma lógica, gatilho por etapa do funil. Cada passo permite **mensagem fixa** ou **deixar a IA escrever**, em dois cartões de escolha. Janela de envio permitida (hora de início e fim, chave por dia da semana). **Bloco de contatos sem opt-in que serão pulados, com contagem.**

**Pós falta:** régua em D+0 e D+2 com oferta de remarcação.

---

### TELA 8. CADASTROS

Abas: Profissionais · Procedimentos · Convênios · **Vínculos** · Pacotes · Recursos · Unidades · Bloqueios.

**A aba Vínculos é a mais importante e a mais difícil.** Matriz de três pontas com preço e duração próprios. Solução: **acordeão agrupado por profissional.**

```
▼ Dr. João Pereira · CRM 12345 · Endocrinologia, Nutrologia      [+ Adicionar]
  ┌────────────────────┬──────────────┬─────────────────┬──────────┬──────┐
  │ PROCEDIMENTO       │ CONVÊNIO     │ PREÇO           │ DURAÇÃO  │ IA   │
  ├────────────────────┼──────────────┼─────────────────┼──────────┼──────┤
  │ Consulta endócrino │ Particular   │ R$ 400,00       │ 40 min   │ [on] │
  │ Consulta endócrino │ Unimed       │ Coberto         │ 40 min   │ [on] │
  │ Consulta endócrino │ Bradesco     │ Coberto         │ 40 min   │ [on] │
  │ Consulta nutrologia│ Particular   │ R$ 500,00       │ 60 min   │ [off]│
  └────────────────────┴──────────────┴─────────────────┴──────────┴──────┘

▶ Dra. Ana Costa · CRM 67890 · Dermatologia
```

- **"Coberto" é rótulo, não zero.** Campo vazio, valor zero e cobertura de convênio são três coisas diferentes e precisam parecer diferentes. Zero de verdade aparece como `R$ 0,00`.
- Coluna **IA** é a chave "o agente pode agendar isso sozinho". Desligada, mostra dica "Só a recepção agenda".
- Botão **Duplicar para outro profissional**.
- Campo de conselho de classe é **livre**, não dropdown fechado: precisa aceitar CRM, CRO, CREFITO, CRBM, CRN e "sem conselho" (esteticista).
- Estado vazio com botão grande **Importar de planilha**.

**Aba Pacotes:** procedimento, quantidade de sessões, preço do pacote, validade. Listagem mostra quantos pacientes têm saldo ativo.

**Aba Recursos:** sala, cabine ou equipamento, com unidade e procedimentos que dependem dele.

---

### TELA 9. PACIENTES E FICHA

**Lista:** tabela com Nome, Telefone, Convênio, Última consulta, Próxima, Comparecimento (percentual com barra fina), Saldo de pacote, Etiquetas. Filtros: com falta, inativos, com pacote ativo, por convênio, por profissional.

**Ficha:** cabeçalho com avatar, nome, telefone, convênio, chips de etiqueta (Risco de falta em alerta, Inativo em neutro, VIP em destaque).

Três cards de indicador: Total de consultas · Faltas · Taxa de comparecimento.

Duas colunas: à esquerda **linha do tempo de agendamentos** (data, profissional, procedimento, valor, chip de status); à direita dados cadastrais, **saldo de pacote com barra de sessões**, **estado do consentimento** (origem, data, botão de descadastrar), origem preservada desde o lead, e botões Abrir conversa, Agendar, Adicionar à lista de espera.

---

### TELA 10. LISTA DE ESPERA

Lista agrupada por profissional e procedimento. Cada item: nome, telefone, procedimento, preferência de turno e dias, data de entrada, prioridade.

**Painel superior:** horários recuperados no mês, receita associada, tempo médio até preencher um cancelamento.

**Quando um cancelamento dispara reoferta:** faixa no topo mostrando "Reoferta em andamento: 20/08 às 14:30, enviado para 5 pessoas, 22 min restantes" com botão Cancelar reoferta e a lista de quem recebeu.

Arrastar para reordenar prioridade. Botão Adicionar manualmente.

---

### TELA 11. RELATÓRIOS

Filtro de período com comparação contra o anterior. Abas: Origem · Agendamentos · IA · Confirmação · Custos.

Cada aba: faixa de indicadores, um gráfico principal (barras horizontais ou linha com marcadores, nunca outro tipo) e tabela com **dimensão primária trocável por dropdown**. Exportar em CSV e PDF no topo direito.

**Aba Confirmação precisa conter o comparativo antes e depois da linha de base**, porque é o relatório que renova o contrato.

---

### TELA 12. CONFIGURAÇÕES

Abas: Clínica · **Marca** · Usuários e permissões · Modelos de mensagem · Limite de gastos · **Privacidade e LGPD** · Assinatura.

**Marca:** upload de logo em duas versões (horizontal 160x32 e ícone 32x32), cada uma para tema claro e escuro. Seletor de cor primária com **pré-visualização ao vivo do rail e do botão**. Nome do produto. Bloco de **nomenclatura** com campos para "profissional", "procedimento", "paciente", "consulta", e ao lado uma pré-visualização mostrando uma frase real mudando conforme digita.

**Limite de gastos:** teto mensal em reais, chave "pausar envios automáticos ao atingir o teto", alertas em 50%, 80% e 95%.

**Privacidade e LGPD:** texto do consentimento usado, retenção de conversa, botões de exportar e excluir dados de um titular, e **trilha de auditoria** (tabela: usuário, ação, paciente, data e hora, com filtro e exportação).

**Usuários e permissões:** tabela de usuários mais editor da matriz da Seção 5, com marcação por módulo e ação.

---

### TELA 13. CONEXÃO DO WHATSAPP (onboarding)

Assistente de 4 etapas com indicador de progresso: **Conectar número → Verificar a empresa na Meta → Criar modelos → Testar**.

Cartão único centralizado, máximo de 560px, uma ação principal por etapa. Ilustração mínima.

A etapa de verificação precisa explicar em linguagem simples por que ela importa: "Empresa verificada pode criar até 6.000 modelos de mensagem. Sem verificação, o limite é 250, e você vai bater nesse teto quando começar a criar réguas por procedimento."

Estado de erro explicando o que fazer, nunca o código do erro.

---

### TELA 14. ADMINISTRAÇÃO DO PRODUTO (visão do dono, não da clínica)

Tela só para o Administrador do produto, fora do contexto de uma clínica.

- Lista de clínicas (tenants): nome, plano, status da assinatura, status do WhatsApp, **quality rating do número**, conversas no mês, custo no mês, última atividade.
- Indicadores: clínicas ativas, MRR, churn, inadimplência, custo total de mensagens contra receita.
- Ações: entrar como a clínica (com registro na auditoria), suspender, reativar, mudar plano.
- **Alerta de quality rating baixo** em destaque, porque isso é incidente de produto e precisa aparecer antes de a clínica reclamar.

---

## 8. ESTADOS OBRIGATÓRIOS

Para cada tela, entregar também:

1. **Vazio inicial** (clínica recém-criada) com uma ação principal clara.
2. **Vazio por filtro** com botão Limpar filtros.
3. **Carregando:** skeleton com a forma do conteúdo real, nunca giratório no meio da tela.
4. **Erro genérico** com o que aconteceu e o que fazer.
5. **WhatsApp desconectado:** faixa vermelha fixa no topo de todas as telas com botão Reconectar.
6. **Teto de gasto atingido:** faixa âmbar fixa, "Envios automáticos pausados".
7. **Quality rating rebaixado pela Meta:** faixa âmbar com explicação em linguagem simples.
8. **Assinatura em atraso:** faixa neutra com prazo antes da suspensão.
9. **Sem permissão:** elemento visível e desabilitado, com dica.

---

## 9. O QUE NÃO FAZER

- Não usar preto puro no fundo escuro nem branco puro no texto sobre escuro.
- Não usar pizza, rosca, barra empilhada, medidor, treemap ou 3D.
- Não comunicar estado só por cor.
- Não usar sombra colorida, gradiente decorativo, vidro fosco ou ilustração 3D.
- Não usar mais de 2 famílias tipográficas nem misturar bibliotecas de ícone.
- Não criar assistente de várias etapas para agendar consulta.
- Não colocar logo, nome de marca ou cor fixa no layout.
- Não esconder a regra da janela de 24h dentro de mensagem de erro.
- Não usar travessão no texto de interface.
- Não usar linguagem técnica: "handoff" vira "Assumir", "tenant" vira "clínica", "opt-in" vira "autorização para receber mensagens". "Lead" pode ficar, o setor já usa.
- Não mostrar `R$ 0,00` quando o significado é "coberto pelo convênio".

---

## 10. ORDEM DE ENTREGA

| Onda | Telas | Por quê |
|---|---|---|
| 1 | 1 Atendimento, 2 Confirmações, 3 Agenda | São o produto. Se essas três não ficarem boas, o resto não importa |
| 2 | 5 Início, 4 Leads, 6 Agente de IA | Provam o resultado e vendem o software |
| 3 | 8 Cadastros, 7 Automações, 9 Pacientes, 10 Lista de espera | Sustentam a operação |
| 4 | 11 Relatórios, 12 Configurações, 13 Onboarding, 14 Administração | Suporte |

Entregar tema escuro e tema claro de cada tela, e os estados da Seção 8 pelo menos para a onda 1. Entregar também a versão em 1366px das telas 1 e 3, que é a largura real da recepção.
