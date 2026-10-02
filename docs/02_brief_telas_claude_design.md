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

**Moeda compacta no cartão de métrica (desde 02/10/2026):** só de 10 mil para cima, com no máximo 1 casa e nunca "k" ("R$ 12,5 mil", "R$ 284 mil", "R$ 1,2 mi"); abaixo de 10 mil o valor vai cheio ("R$ 9.850,00"). O leitor de tela e a exportação recebem sempre o valor cheio. Os percentuais das métricas da Fase 3 (Início, Confirmações, indicadores da lista de Pacientes, Lista de espera e Resultados, inclusive o CSV) têm 1 casa ("64,2%"); a taxa de comparecimento da ficha do paciente continua inteira ("33%").

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

**Valores em reais só para Admin e Gestor (decisão do dono em 02/10/2026, Fase 3 das métricas).** Dentro de Relatórios (Resultados) e da Lista de espera, quem tem "ver" não vê dinheiro: faturamento estimado, custo por lead, receita das consultas recuperadas, receita associada da Lista de espera, valor das conversões devolvidas à Meta e custo de mensagens só têm número para Admin e Gestor. Para Recepção, Profissional e Leitura, o cartão ou a linha que é só o valor (faturamento, custo por lead, receita associada da espera, custo de mensagens) fica **visível e desabilitado**, escrito "Sem acesso", com a dica "Só administrador e gestor veem valores em reais."; nas frases que citam um valor (receita das recuperadas, valor das conversões já enviadas), o valor simplesmente não aparece; e a exportação sai sem essas linhas. Esconder na tela não basta: o faturamento, a receita das recuperadas e a receita da Lista de espera saem **nulos do banco** para os outros papéis. O valor das conversões devolvidas à Meta, em 02/10/2026, ainda só é escondido na tela (a leitura das conversões não recorta por papel): ponto aberto para o dono, registrado no backlog. O objetivo de conversão de Resultados segue a mesma divisão: Admin e Gestor definem, os demais só leem.

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
- **Áudio recebido:** player mais transcrição automática em texto secundário, colapsada em 2 linhas com "ver mais". O áudio toca até o fim a qualquer hora em que a pessoa der o play, mesmo com a conversa aberta há horas ou depois de pausar (desde 02/10/2026: antes, um link de 5 minutos vencia e o áudio parava em uns 2 segundos). O áudio só é baixado quando a pessoa toca; a duração aparece a partir do primeiro toque.
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

> **Mudança (decisão do dono em 02/10/2026, Fase 3 das métricas):** o topo segue o protótipo do design system, com cinco cartões no cartão de métrica único. "Pendentes" vira **"Aguardando"**, com o "Cobrar" dentro e em botão secundário; o lime da tela passa a ser o cartão **Confirmadas**; **"Recuperadas" sai desta tela** e vai para Resultados (aba Comercial). O desenho anterior do topo fica no fim desta tela como histórico.

**Topo, cinco cartões numa faixa** (2 colunas a partir de 640px, 3 a partir de 1024px e 5 a partir de 1280px, para o "Cobrar todas as N" caber):

| Cartão | Ícone e cor | O que conta | Rodapé |
|---|---|---|---|
| Agendadas | `calendar-days`, neutro | todas as consultas que começam no dia, em qualquer situação | nenhum |
| **Confirmadas** (o lime da tela) | nenhum (cartão em destaque não tem ícone) | o predicado único de Confirmada (abaixo) | "87,2% do total"; sem consulta no dia, nada |
| Aguardando | `clock`, âmbar (é o status) | Agendado ou Aguardando confirmação | o botão "Cobrar" |
| Canceladas | `circle-x`, alerta | canceladas pelo paciente ou pela clínica | "5,5% do total" |
| Não enviadas | `mail-warning`, âmbar (o mesmo do chip "Não enviada") | o predicado de Não enviada (abaixo) | o motivo |

- **Confirmada é um predicado só**, o mesmo no banco (`consulta_foi_confirmada`), no cartão, no filtro e no Início: a consulta em "Confirmado por WhatsApp" ou "Confirmado pela recepção", ou a que tem o canal de confirmação gravado e já passou para Na recepção, Em atendimento, Compareceu ou Faltou. Quem confirmou e chegou continua contando; a remarcada que voltou para Agendado e a cancelada não contam.
- **Não enviada** é a consulta que ainda aguarda confirmação, sem pedido de remarcação, cujo **último** toque foi pulado por falha no envio, WhatsApp desconectado, fila até a hora da consulta, número removido, falta de autorização, fora do horário de envio ou limite de gasto atingido. Pulo esperado (condição de parada, consulta remarcada, pedido de remarcação, toque atrasado) não conta.
- **Rodapé de Não enviadas:** "Motivo: X" quando todas têm o mesmo motivo, "Mais comum: X" quando um motivo lidera e "Motivos variados" no empate (o empate não escolhe um lado); sem nenhuma, sem rodapé. Na falha de envio o motivo vem do código gravado no toque ("Servidor do WhatsApp fora do ar", "WhatsApp recusou a mensagem", "WhatsApp restringiu o número"); sem código conhecido, "Falha no envio". O chip da linha diz o mesmo motivo ("falhou no envio: servidor do WhatsApp fora do ar"), para a recepção achar na lista o que o cartão aponta. O chip "Não enviada" (`mail-warning`, âmbar) usa o mesmo critério de motivo do cartão; no pulo esperado (condição de parada, consulta remarcada, pedido de remarcação, toque atrasado) o chip diz **"Dispensada"** (`mail-minus`, neutro), com o motivo na linha de apoio. O cartão conta só quem ainda aguarda confirmação: uma consulta já confirmada ou cancelada cujo último toque falhou mostra o chip "Não enviada" e não entra no número.
- **Cobrar** fica dentro do cartão Aguardando, em contorno: "Cobrar a pendente", "Cobrar todas as N" ou "Cobrar pendentes", e "Enviando..." durante o envio. Visível e desabilitado com dica quando falta permissão ou quando nada pode ser cobrado ("Nenhuma consulta aguardando confirmação neste dia", ou a dica de que as pendentes estão sem autorização ou com a confirmação automática desligada).
- **Filtro** sobre a lista do dia: Todas, Confirmadas, Aguardando, Canceladas, Não enviadas. Cada filtro usa o mesmo predicado do cartão de mesmo nome, então o número do filtro é sempre o do cartão.
- Erro na leitura dos toques não vira "nenhum toque": a tela mostra o erro, e Não enviadas nunca cai para zero por falha.

**Corpo: lista agrupada por profissional**, ordenada por horário, linhas de 56px:

`[14:30] [avatar] [Maria Silva] [Consulta dermato] [Unimed] [chip de status] [ações]`

- Ações: **Cobrar agora** (só em pendentes), **Ligar** (`tel:`), **Confirmar manualmente**, **Abrir conversa**.
- O chip mostra a autoria: "Confirmado por WhatsApp" com ícone `message-circle-check`, ou "Confirmado pela recepção" com ícone `user-check`. **Duas coisas diferentes precisam parecer diferentes.**
- Paciente com histórico de falta ganha ícone `triangle-alert` antes do nome, com dica "2 faltas anteriores".
- Seletor de data no topo, padrão em amanhã.
- Aba secundária **"Faltas de hoje"** com a régua pós falta: quem faltou, se já recebeu contato, botão Remarcar.

**Histórico: o topo até 01/10/2026.** Bento com o card de Pendentes como herói (largura dupla, com "Cobrar todos" em botão primário), Confirmadas, Canceladas e Recuperadas (horários preenchidos pela lista de espera, com a receita):

```
┌──────────────────────────┬────────────┬────────────┬────────────┐
│  PENDENTES               │ CONFIRMADAS│ CANCELADAS │ RECUPERADAS│
│  ⏱                       │ ✓          │ ✕          │ ↻          │
│  14                      │ 38         │ 3          │ 2          │
│  de 55 consultas amanhã  │ 69,1%      │ 5,5%       │ R$ 400,00  │
│  [Cobrar todos os 14]    │            │            │ da espera  │
└──────────────────────────┴────────────┴────────────┴────────────┘
```

---

### TELA 3. AGENDA `PRIORIDADE MÁXIMA`

**Barra de filtros, e a ordem importa:**

`[◄ 14/08/26 ►] [Unidade] [Especialidade] [Convênio] [Procedimento] [Profissional] ··· [Dia|Semana] [Bloquear horário] [+ Novo agendamento]`

**Nome do profissional é o ÚLTIMO filtro.** A recepção pergunta "quem está livre para dermato pela Unimed", não "abra a agenda do Dr. Fulano". Esse detalhe separa a agenda boa da ruim.

**Visão Dia (padrão):** uma coluna por profissional, mínimo de 180px, rolagem horizontal conforme a Seção 6. Cabeçalho fixo com foto de 32px, nome, especialidade e contador "8 de 12 horários".

- Eixo de horas fixo à esquerda, faixa de 15 minutos, linha reforçada a cada hora.
- **Linha do horário atual** em vermelho fino atravessando as colunas.
- **Bloco de agendamento:** altura proporcional à duração, borda esquerda de 4px na cor do status, nome em 13px semibold, procedimento em 11px, ícone de status no canto. Bloco de menos de 30 minutos mostra só o nome.
- **Bloqueio:** hachura diagonal a 45 graus mais rótulo do motivo. Nunca só cor. Desde 29/09/2026 (decisão do dono, ver Tela 8) o bloqueio é criado e removido aqui, na Agenda, por três caminhos:
  - **"Bloquear horário" na barra**, botão secundário (contorno, ícone `ban`) ao lado de "Novo agendamento". Abre o diálogo "Bloquear horário": profissionais (vários de uma vez, já marcado o do filtro ou da semana), início e fim (data e hora no fuso da clínica, ou "Dia inteiro" com primeiro e último dia), motivo e "Impedir encaixe neste período" (marcado por padrão). Com consultas já marcadas no período, o diálogo avisa quantas são e qual a primeira, e só cria com confirmação explícita ("Criar o bloqueio mesmo assim"): o bloqueio não desmarca nada. Com a barra estreita, o rótulo recolhe e fica o ícone, com o mesmo nome acessível e a dica.
  - **"Bloquear este horário" no modal aberto pelo clique num horário vazio.** O clique no vão continua abrindo o modal de novo agendamento, que é o fluxo principal e não pode ficar mais lento; dentro dele, a ação secundária "Bloquear este horário" (contorno, à esquerda do rodapé, longe do "Marcar consulta") fecha o modal e abre o mesmo diálogo com o profissional da coluna e o horário clicado já preenchidos. Ela só aparece no modal aberto pelo vão, não no "Novo agendamento" da barra.
  - **Remoção pela faixa hachurada.** A faixa é um botão: o clique (ou Enter) abre um balão com motivo, profissional, período, o chip "Impede encaixe" ou "Permite encaixe" (ícone, rótulo e cor) e "Remover bloqueio", que pede confirmação. Clicar dentro da faixa não abre "Nova consulta"; o encaixe sobre um bloqueio que permite encaixe sai por "Novo agendamento". Bloqueio coberto por uma consulta (a faixa fica embaixo do bloco) também se remove pelo **menu da consulta**, na seção "Horário bloqueado", com o mesmo "Remover bloqueio" (02/10/2026).
  - **A grade se estende para mostrar o bloqueio** que fica inteiro fora do horário de atendimento (como já faz com as consultas): todo bloqueio do dia tem faixa à vista e onde clicar (02/10/2026).
  - **Consulta comum sobre bloqueio é recusada** pelo servidor, com "Este horário está bloqueado na agenda do profissional. Escolha outro horário."; o encaixe segue o "Impedir encaixe" do bloqueio (02/10/2026).
  - Só administrador e gestor criam e removem bloqueio (a mesma regra da RLS). Para os outros papéis, as três ações ficam visíveis e desabilitadas, com a dica "Somente administradores e gestores bloqueiam horários" (ou "removem bloqueios").
- **Encaixe:** borda tracejada, deslocamento de 8px.
- **Reserva temporária (hold):** bloco semitransparente com contador regressivo e rótulo "Reservado pela IA, 8 min". Estado novo e essencial: sem ele, IA e recepção marcam duas pessoas no mesmo horário.
- Arrastar e soltar para remarcar, com modal perguntando se deve avisar o paciente.
- Clique em espaço vazio abre o modal já preenchido com profissional e horário (com a ação secundária "Bloquear este horário", ver Bloqueio acima).
- Menu de três pontos no topo: Imprimir agenda do dia, Exportar, **Ver histórico de alterações**.

**Visão Semana:** um profissional, 7 colunas de dia.

**Modal de novo agendamento (uma tela só, nada de assistente de várias etapas, é a ação mais repetida do dia):**
1. Buscar paciente por nome ou telefone, ou criar novo ali mesmo.
2. **Unidade** (só aparece se houver mais de uma).
3. Convênio.
4. Procedimento (a lista filtra pelo convênio).
5. Profissional (só quem faz aquele procedimento naquele convênio, com preço e duração ao lado do nome).
6. Data e horário, com **3 primeiros horários livres em botões grandes** mais "escolher outro".
7. **Aviso de recurso** quando o procedimento exige sala ou equipamento ocupado (desde 29/09/2026 os recursos não têm tela; o aviso vale para o que já estava gravado no banco, ver Tela 8).
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

> **Mudança (decisão do dono em 02/10/2026, Fase 3 das métricas):** o Início passa a mostrar **o dia**, como no protótipo do design system, e não mais os últimos 30 dias. O herói "Consultas recuperadas" vai para Resultados (aba Comercial); Origem dos leads, Mensagens, o funil de coorte de 30 dias e o desempenho da IA por período saem do Início e ficam em Resultados. **Próximas ações continua** (este brief exige). O desenho anterior fica no fim desta tela como histórico.

Bento, um ponto focal só, leitura em F.

**Cabeçalho:** a data no fuso da clínica como eyebrow, a saudação e a frase com as pendências reais (C26 do `docs/06`), e o atalho "Ver em Resultados". O checklist de primeiros passos aparece acima do painel enquanto houver passo pendente.

**Linha 1, quatro cartões do dia** (cartão de métrica único, número de 34px; a variação compara com o **mesmo dia da semana passada**, sabendo que o dia de hoje ainda está em andamento e o da semana passada já fechou):
1. **Consultas hoje** (`calendar-days`, neutro): todas as consultas que começam hoje, em qualquer situação. Rodapé "N unidades" só quando o dia tem consulta em 2 ou mais unidades. Com variação.
2. **Confirmadas** (o lime da tela, sem ícone): o predicado único de Confirmada (Tela 2). Rodapé "87,1% do total" e variação.
3. **Aguardando** (`clock`, âmbar): Agendado ou Aguardando confirmação. Rodapé "Último disparo HH:mm" (o último toque da régua de confirmação enviado hoje, incluindo o "Cobrar agora", no fuso da clínica) ou "Nenhum disparo hoje".
4. **Resolvidas pela IA** (`sparkles`, cor da IA): "Ainda não medido", com a dica de que o número chega com o agente de IA.

**Linha 2, duas colunas:**
- À esquerda, **Próximas ações** (pendências de confirmação, leads sem resposta há mais de 24h, conversas aguardando humano; cada item é link para a tela já filtrada) e, embaixo, **"Consultas por dia, últimos 7 dias"**: 7 barras deitadas, uma por dia, de seis dias atrás até hoje sem pular dia (domingo com zero aparece), com "Hoje" escrito no rótulo e a barra de hoje em destaque; os outros dias ficam neutros. A contagem é a mesma de "Consultas hoje", então a barra de hoje bate com o cartão. Coluna vertical é proibida (C12 do `docs/06`).
- À direita, **Funil de leads**: uma barra por etapa da jornada da clínica, na ordem dela, com quantos contatos estão em cada etapa **agora** (o mesmo número do Kanban de Leads, não a coorte do período). "Perdido" fica neutro, as outras etapas em destaque. Botão de ícone "Abrir Leads" no cabeçalho.

**Estados:** cada bloco carrega sozinho. Se um falha, só ele mostra o erro (nunca zero) e um aviso no topo, "Alguns números não carregaram", oferece "Tentar de novo"; o resto da tela continua. Vazios: "Nenhuma consulta nos últimos 7 dias" e "Nenhum lead na jornada ainda".

**Profissional:** continua com a visão própria (a agenda dele nos últimos 30 dias) e "Suas próximas ações". Os números da clínica não chegam a ele: o banco devolve nulo.

**Histórico: o desenho até 01/10/2026** (últimos 30 dias contra os 30 anteriores):
- Faixa de 4 indicadores: `Leads no período` · `Agendamentos` · `Comparecimentos` · `Taxa de lead para comparecimento`.
- Card herói "Consultas recuperadas", com o valor em reais e a composição, e card "Desempenho da IA".
- Funil horizontal de 3 etapas e Origem dos leads em barras horizontais.
- Card "Custo de mensagens" (gasto contra teto) e card "Próximas ações".

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
- **Réguas vinculadas** (decisão do dono em 29/09/2026; até 28/09 era "Exceções por procedimento"). Uma régua pode ser vinculada a **um médico, a uma especialidade ou a um procedimento**, um vínculo só por régua. Sem vínculo, é a **régua geral**.
  - "Nova régua vinculada" (contorno) abre o diálogo com **"Vincular a: Médico, Especialidade ou Procedimento"** e a escolha do cadastro. A especialidade vem da lista das especialidades que os profissionais ativos já têm (sem digitar texto livre). O que já tem régua própria não aparece na lista, e a lista vazia diz por quê. A régua nasce desligada, com as mensagens copiadas da geral, para a clínica ajustar e ligar.
  - Texto de apoio: "Procedimentos com preparo, como colonoscopia, têm falta muito maior e pedem mais toques. Um médico ou uma especialidade também podem pedir outra conversa." E a regra escrita na tela: "A régua mais específica vence: procedimento, depois médico, depois especialidade. Sem vínculo, vale a geral."
  - **Precedência:** procedimento, depois médico, depois especialidade, depois a geral. Régua desligada não conta: a consulta cai para a próxima que vale para ela. No mesmo nível, a reforçada vence a comum para quem tem histórico de falta. Profissional com duas especialidades que têm régua: vale a régua criada primeiro. Se a régua que vale para a consulta muda no meio da sequência (troca de médico, régua mais específica ligada depois), os toques pendentes da antiga não saem.
  - Cada régua vinculada é um cartão com cabeçalho de acordeão: nome, etiqueta do vínculo com ícone e tipo ("Médico", "Especialidade", "Procedimento"; a reforçada, "Histórico de falta"), situação em 3 camadas ("Ligada" ou "Desligada") e "Excluir", que pergunta antes e avisa que o histórico de envios dela some. Régua que enviou há menos de 30 minutos não se exclui ("Esta régua enviou mensagens há pouco. Desligue agora e exclua daqui a 30 minutos."), para o paciente não receber o mesmo toque de novo pela régua que passa a valer. Dentro, o mesmo editor da régua geral.
  - Vale para as abas **Confirmação** e **Pós falta**, com o mesmo bloco. Follow-up não tem régua vinculada.
- **Régua reforçada para paciente com histórico de falta** (chave mais número de faltas que dispara).
- **Estimativa de custo:** "Esta régua envia cerca de 1.320 mensagens por mês, considerando 440 consultas e 3 toques. Custo estimado: [valor]. Mensagens respondidas dentro de 24 horas não são cobradas."

**Follow-up:** mesma lógica, gatilho por etapa do funil. Cada passo permite **mensagem fixa** ou **deixar a IA escrever**, em dois cartões de escolha. Janela de envio permitida (hora de início e fim, chave por dia da semana). **Bloco de contatos sem opt-in que serão pulados, com contagem.**

**Pós falta:** régua em D+0 e D+2 com oferta de remarcação. Desde 29/09/2026 tem também as **réguas vinculadas** (médico, especialidade ou procedimento), com a mesma precedência e o mesmo bloco da Confirmação.

**Situação no cartão de cada aba (chip de 3 estados, desde 29/09/2026):** o cartão seletor da aba diz a verdade sobre o conjunto de réguas daquele tipo, não só sobre a geral. **"Ligada"** quando a régua geral está ligada; **"Ligada nas vinculadas"** quando a geral está desligada e alguma régua da lista de vinculadas daquele tipo (inclusive a reforçada) está ligada, com ícone e cor próprios (`circle-dot`, informativo), porque "Ligada" diria que todos recebem e "Desligada" diria que ninguém recebe; **"Desligada"** quando nenhuma está ligada. Sempre ícone, rótulo e cor. A nota soma a geral e as vinculadas do tipo: "{n} enviadas em 24 h" e, no estado do meio, "Geral desligada, N de M vinculadas ligadas, {n} enviadas em 24 h". Sem régua geral criada, continua "Não configurada".

---

### TELA 8. CADASTROS

> **Mudança (decisão do dono em 29/09/2026):** Cadastros fica com cinco abas, todo cadastro abre em **modal central**, o vínculo passa a ser feito **dentro do Procedimento**, o bloqueio de horário vira **ação da Agenda** e os recursos saem da tela. O desenho anterior (oito abas, Vínculos em acordeão por profissional) fica no fim desta tela como histórico.

Abas: Profissionais · Procedimentos · Convênios · Pacotes · Unidades. A aba vive na URL. Link antigo não quebra: `?aba=vinculos` abre Procedimentos; `?aba=recursos` e `?aba=bloqueios` abrem a aba padrão (Profissionais).

**Todo cadastro abre em modal central** (criar, editar ou ver detalhes), nunca em painel lateral: 520px, ou 640px quando o formulário tem tabela dentro (jornada do profissional, quem faz o procedimento). Cabeçalho com título e descrição, corpo que rola por dentro (o modal vai até 86% da altura da tela), aviso e erro fixos logo acima do rodapé, rodapé fixo com Cancelar e Salvar. Esc e o X fecham. Quem só vê abre o mesmo modal em modo leitura, sem Salvar.

**O vínculo é a parte mais importante e a mais difícil, e agora mora no Procedimento.** A matriz de três pontas (profissional x procedimento x convênio, com preço e duração próprios) é feita no modal do procedimento, na seção "Quem faz e convênios":
- quem faz (vários profissionais) e convênios aceitos (vários; "Particular" sempre disponível);
- preço e duração do procedimento valem como padrão; a exceção por profissional ou convênio (preço próprio, "Coberto" ou duração própria) é feita ali mesmo;
- a chave "IA pode agendar" é a do procedimento, e o vínculo segue essa chave (uma fonte só);
- vínculo que já tem consulta não é apagado, é desativado.

No modal de agendamento (Tela 3), quando a clínica ainda não definiu quem faz nenhum procedimento, o aviso manda para Cadastros > Procedimentos.

**Bloqueio de horário é ação da Agenda** (Tela 3), com o mesmo aviso de consultas já marcadas no período. **Recursos saem da tela:** sala, cabine ou equipamento continuam no banco, com a trava contra uso duplo, mas sem aba e sem campo no procedimento.

Regras que continuam valendo, onde quer que o vínculo seja editado:

- **"Coberto" é rótulo, não zero.** Campo vazio, valor zero e cobertura de convênio são três coisas diferentes e precisam parecer diferentes. Zero de verdade aparece como `R$ 0,00`.
- Com a chave da IA desligada, o procedimento aparece como "Só recepção" (ícone, rótulo e cor).
- Campo de conselho de classe é **livre**, não dropdown fechado: precisa aceitar CRM, CRO, CREFITO, CRBM, CRN e "sem conselho" (esteticista).
- Estado vazio com botão grande **Importar de planilha**.

**Aba Pacotes (pacote com vários procedimentos, decisão do dono em 29/09/2026):** o modal (640px, porque tem lista dentro) pede **Nome do pacote**, a seção **"Procedimentos do pacote"** (adicionar procedimento ativo pelo campo que fica sempre vazio, pronto para o próximo; sessões de cada um, de 1 a 200; remover; o mesmo procedimento entra uma vez só e sai das opções quando já está na lista; cada linha mostra o preço base por sessão e quanto as sessões dariam avulsas), o **"Preço avulso"** calculado ao vivo (soma de sessões x preço base, em mono; com procedimento sem preço base a soma é dada como incompleta e o desconto não aparece), o **"Preço do pacote"** editável e, quando os dois existem, o **desconto em porcentagem** ("14,3% de desconto: R$ 1.000,00 a menos que o avulso"; mais caro que o avulso aparece como acréscimo). Validade (dias, em branco = sem validade, vale para o pacote inteiro) e "Pacote à venda" como antes. **Pacote já vendido:** os procedimentos e as sessões ficam visíveis e desabilitados, com a dica "Pacote já vendido: os procedimentos e as sessões não mudam; crie um pacote novo."; nome, preço, validade e "à venda" continuam editáveis. A tabela tem **Pacote** (nome), **Procedimentos** ("Botox 2x + Facelift 1x"), **Preço avulso** ("Falta preço base" quando incompleto), **Preço do pacote** (com o desconto embaixo), Validade, Pacientes com saldo, Situação e ações (editar, desativar, remover só o nunca vendido).

**Histórico: o desenho até 28/09/2026.** Abas: Profissionais · Procedimentos · Convênios · **Vínculos** · Pacotes · Recursos · Unidades · Bloqueios, com painel lateral de cadastro.

**A aba Vínculos era a mais importante e a mais difícil.** Matriz de três pontas com preço e duração próprios. Solução de então: **acordeão agrupado por profissional.**

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

No desenho de então, a coluna **IA** era a chave "o agente pode agendar isso sozinho" por vínculo, havia o botão **Duplicar para outro profissional**, a **aba Recursos** listava sala, cabine ou equipamento com unidade e procedimentos que dependem dele, e a **aba Bloqueios** criava bloqueio em lote para vários profissionais.

---

### TELA 9. PACIENTES E FICHA

**Lista:** tabela com Nome, Telefone, Convênio, Última consulta, Próxima, Comparecimento (percentual com barra fina), Saldo de pacote, Etiquetas. Filtros: com falta, inativos, com pacote ativo, por convênio, por profissional.

**Indicadores da lista (decisões do dono em 29/09 e 02/10/2026, Fase 3 das métricas):** quatro cartões acima da tabela, contados no banco para a clínica inteira (não o recorte dos filtros). Não são botões: o filtro "Com pacote" continua sendo o único controle com esse nome.
1. **"{Pacientes} ativos"** (`users`): quem compareceu nos últimos 12 meses. Variação **em pessoas** contra 30 dias atrás ("+34"), escondida quando 30 dias atrás o número era zero. Rodapé "Atendidos nos últimos 12 meses", ou "Contando desde dd/mm/aaaa" enquanto o sistema tem menos de 12 meses de atendimentos.
2. **Novos no mês** (`user-round-plus`): quem tem a primeira consulta não cancelada no mês civil da clínica, passada ou futura. Rodapé "Primeira {consulta} em {mês}".
3. **Retorno em 90 dias** (`repeat-2`): dos comparecimentos de 12 meses atrás até 90 dias atrás (janela que já pode ser medida), o percentual com outra consulta marcada ou atendida em outro dia, até 90 dias depois; falta não conta como retorno. Percentual com 1 casa e rodapé "De N {consultas}". Sem base: "Ainda não medido" com a dica e "Primeira medida em dd/mm/aaaa", nunca 0%.
4. **"Sem {consulta} há 6 meses"** (`calendar-off`): último comparecimento há mais de 6 meses e nada marcado daqui para a frente. Rodapé "Atendidos há mais de 6 meses, nada marcado". Com menos de 6 meses de atendimentos no sistema: "Ainda não medido" e "Começa a contar em dd/mm/aaaa". A etiqueta Inativo (90 dias sem consulta) não mudou e tem outro ícone, porque é outra conta.
- Os rótulos usam o termo da clínica (white-label). O profissional vê os números da própria agenda, e os rodapés das contagens terminam em ", na sua agenda".
- Carregando e erro em cada cartão, com "Tentar de novo"; erro nunca vira zero.

**Ficha:** cabeçalho com avatar, nome, telefone, convênio, chips de etiqueta (Risco de falta em alerta, Inativo em neutro, VIP em destaque).

Três cards de indicador: Total de consultas (atendidas mais faltas) · Faltas · Taxa de comparecimento. Desde 02/10/2026 no cartão de métrica único; sem consulta atendida nem falta, a taxa diz "Ainda não medido" com a dica, nunca 0%.

Duas colunas: à esquerda **linha do tempo de agendamentos** (data, profissional, procedimento, valor, chip de status); à direita dados cadastrais, **saldo de pacote com barra de sessões**, **estado do consentimento** (origem, data, botão de descadastrar), origem preservada desde o lead, e botões Abrir conversa, Agendar, Adicionar à lista de espera.

**Saldo de pacote (pacote com vários procedimentos, desde 29/09/2026):** **um cartão por venda**, com o nome do pacote, as sessões restantes da venda, a validade ("Vale até", ou "Venceu em" com ícone, rótulo e cor de alerta) e **uma barra por procedimento** ("Botox, 1 de 2 usadas"; a barra diz o procedimento para quem ouve). Ações do cartão: **Ajustar saldo** (um campo de sessões usadas por procedimento, a validade da venda e um motivo só) e **Cancelar venda** (só administrador e gestor, e só enquanto nenhuma consulta descontou da venda; fora disso, visível e desabilitado com a dica). **Vender pacote** escolhe o pacote pelo nome, com o que ele inclui na própria opção ("Harmonização (Botox 2x + Facelift 1x)"), e mostra preço, validade e os procedimentos; "Pacote em andamento, comprado antes do sistema" acrescenta o campo "Já usadas" em cada procedimento (de 0 até as sessões dele, com ao menos 1 sessão sobrando no pacote) e a data de início. Na **Agenda**, o diálogo do Compareceu diz de onde sai a sessão: "Desconta 1 sessão de Botox do pacote Harmonização (2 de 3 usadas)." e o que sobra daquele procedimento.

---

### TELA 10. LISTA DE ESPERA

Lista agrupada por profissional e procedimento. Cada item: nome, telefone, procedimento, preferência de turno e dias, data de entrada, prioridade.

**Painel "Desempenho da lista" (Fase 3 das métricas, 02/10/2026; o "no mês" vem do plano aprovado em 29/09, e o mês civil com a safra pela 1ª oferta foi assumido na recomendação do levantamento, a confirmar com o dono):** conta o **mês civil da clínica**, com o mês escrito no subtítulo ("Outubro de 2026"); a vaga entra no mês da sua primeira oferta. Barras só onde há denominador honesto, e só nos tons destaque e neutro.
- **Vagas preenchidas:** barra em destaque, preenchidas de resolvidas (preenchidas mais esgotadas), com a legenda "24 de 31". Rodapé "N em andamento, N canceladas" quando houver: ainda não terminaram, ou não dependeram do paciente. Sem vaga resolvida: "Nenhuma vaga resolvida ainda".
- **Aceite na 1ª oferta:** barra neutra com o percentual ("68,0%") e o rodapé "17 aceitas, 8 sem aceite". A base são as primeiras ofertas que o paciente resolveu (aceita ou vencida); a cancelada pela recepção não entra. Sem base: "Sem dados".
- **Tempo médio até o encaixe:** número, sem barra (não tem máximo), da primeira oferta ao aceite. Sem vaga preenchida: "Sem vaga preenchida".
- **Receita associada** (este brief exige): o preço das consultas marcadas pelas vagas preenchidas (preço do vínculo; sem ele, o preço base do procedimento; "Coberto" sem valor não soma). O que ficou fora da soma é contado à parte, como no faturamento: com parte das vagas sem valor, o valor leva o rodapé "Fora da soma: N de convênio sem valor, N sem preço cadastrado"; com nenhuma vaga com valor, "Sem preço para somar", nunca R$ 0,00. Só administrador e gestor veem o valor; para os outros papéis, "Sem acesso" visível e desabilitado com a dica "Só administrador e gestor veem valores em reais.", sem nenhum valor na página.
- Vazio: "Nenhuma vaga na reoferta neste mês". Carregando com esqueleto; erro com "Tentar de novo", nunca zero.

Até 01/10/2026 o painel mostrava horários recuperados, receita associada e tempo médio até preencher, nos últimos 30 dias.

**Quando um cancelamento dispara reoferta:** faixa no topo mostrando "Reoferta em andamento: 20/08 às 14:30, enviado para 5 pessoas, 22 min restantes" com botão Cancelar reoferta e a lista de quem recebeu.

Arrastar para reordenar prioridade. Botão Adicionar manualmente.

---

### TELA 11. RELATÓRIOS

> **Mudança (decisão do dono em 02/10/2026, Fase 3 das métricas):** quatro abas, como no protótipo do design system: **Visão geral · Marketing · Comercial · Agente de IA**. O conteúdo das cinco abas anteriores foi redistribuído nelas. No menu a tela se chama "Resultados".

Filtro de período com comparação contra o anterior (datas na URL, "comparado com os N dias anteriores"). Abas em controle segmentado, cada uma na URL (`?aba=geral`, `marketing`, `comercial`, `ia`); aba ausente ou desconhecida abre a Visão geral. **Link antigo não quebra:** `origem` abre Marketing, `agendamentos` e `confirmacao` abrem Comercial, `custos` abre Agente de IA. No celular as abas quebram linha em vez de rolar.

Cada aba: faixa de cartões, gráficos só em barras horizontais ou linha com marcadores (nunca outro tipo) e, onde há tabela, **dimensão primária trocável por dropdown**. Exportar em CSV e PDF no topo direito, por aba, em várias seções; nenhuma linha em reais sai para quem não pode ver valores.

**Visão geral:**
- Cinco cartões: **Leads recebidos** e **Consultas agendadas** (agendamentos criados no período), os dois com variação contra o período anterior; **Taxa de conversão** (o lime da aba): dos leads que chegaram no período, quantos já agendaram (coorte), com 1 casa, sem variação (a coorte anterior teve mais tempo para maturar), "Sem leads no período" quando não há lead, rodapé "Objetivo: X%" que some sem objetivo e o botão "Definir objetivo" ou "Alterar objetivo"; **Custo por lead**: "Ainda não medido" até a leitura do investimento na Meta (Fase 4 das métricas); **Faturamento estimado** (abaixo).
- Blocos: **Leads x consultas agendadas** (linha com marcadores, duas séries, um ponto por dia civil da clínica); **Origem dos leads** em barras com percentual; **Funil comercial** (coorte: Chegaram, Agendaram, Compareceram); **Confirmação de consulta** (as taxas com o par bruto escrito, as recuperadas e a linha de base contra a taxa medida, sem frase de causa, com "Ver detalhes em Comercial"); **Agente de IA** (as métricas do agente em "Ainda não medido" e a primeira resposta da equipe); **Campanhas** (leads, agendados e conversão; investimento e custo por lead chegam com a Fase 4).

**Faturamento estimado:** soma do preço das consultas **com comparecimento** no período. Preço do vínculo; sem ele, o preço base do procedimento; "Coberto" pelo convênio sem valor não soma e é contado à parte, assim como a consulta sem preço nenhum; preço zero é gratuito de verdade e entra. "Estimado" porque o preço vem do cadastro atual. Na Visão geral em formato compacto ("R$ 284 mil", o leitor de tela ouve o valor cheio), com variação e o rodapé do que ficou fora da soma ("Fora da soma: 2 consultas de convênio sem valor"); em Comercial com o valor cheio e todas as contagens. Sem comparecimento: "Nenhum comparecimento"; só com convênio sem valor ou sem preço: "Sem preço para somar" (nunca `R$ 0,00`).

**Marketing:** cartões Leads recebidos, Com origem identificada (%), Lead para comparecimento (coorte) e Custo por lead; Origem dos leads; Campanhas; Detalhe da origem por canal ou campanha (dropdown); Conversões devolvidas à Meta (o valor em reais já enviado só para administrador e gestor).

**Comercial:** cartões Consultas agendadas (criadas no período), Comparecimentos, Faltas e Cancelamentos (em Faltas e Cancelamentos subir é ruim, e a cor da variação diz isso); o herói **Consultas recuperadas** (o lime da aba, que saiu do Início), com a receita associada só para administrador e gestor; Faturamento estimado detalhado; Funil comercial; **Confirmação completa**; Detalhe por profissional, procedimento ou situação.

**O comparativo antes e depois da linha de base continua obrigatório**, porque é o relatório que renova o contrato: mora na Confirmação completa, dentro de Comercial (taxas, "Contra a linha de base" com o registro só para administrador, e "Antes e depois da primeira mensagem de régua"). O link "Registrar a taxa de falta", no aviso "Antes de ligar, anote a taxa de falta" que aparece ao ligar a régua, abre Resultados na aba Comercial.

**Agente de IA:** atendimento humano em quatro cartões (Conversas iniciadas, Novas conversas respondidas, primeira resposta mediana e o tempo em que 90% foram respondidas); "Desempenho da recepcionista de IA" com seis métricas em "Ainda não medido" (Resolvidas sem humano, Transferidas para a equipe, Escalonadas por insatisfação, Primeira resposta da IA, Agendamentos feitos pela IA, Satisfação), sem número inventado; Mensagens no período (Enviadas, Recebidas, Notas internas) e Quem enviou. O cartão "Custo do período" só aparece com o canal oficial do WhatsApp, e mesmo assim sem acesso para quem não é administrador nem gestor.

**Objetivo de conversão:** um percentual por clínica, de 0,1 a 100 com uma casa, que administrador e gestor definem no diálogo "Objetivo de conversão" (campo "Objetivo (%)", Salvar, Remover objetivo, Cancelar); todo membro ativo vê o rodapé. Para os outros papéis o botão fica visível e desabilitado com a dica "Só administrador e gestor definem o objetivo de conversão.". Definir e remover vão para a trilha de auditoria.

**Profissional:** continua com a visão própria (a agenda dele, sem abas).

**Histórico: até 01/10/2026** as abas eram Origem · Agendamentos · IA · Confirmação · Custos, cada uma com faixa de indicadores, um gráfico principal e tabela com dimensão trocável, e a aba Confirmação trazia o comparativo contra a linha de base.

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

### TELAS DE ENTRADA (login, cadastro, convite e nova senha)

Fora das 14 telas. Registrado em 02/10/2026, a pedido do dono, para o campo de senha.

- **Olho no campo de senha** no login, no cadastro (os dois caminhos: criar a clínica e pedir entrada pelo código), no convite por e-mail e na redefinição de senha: botão de ícone dentro do campo, à direita, que mostra e oculta o que foi digitado ("Mostrar senha" e "Ocultar senha"). Não envia o formulário (no login, Enter continua entrando), fica logo depois do campo na ordem do Tab, e a senha volta a ficar oculta quando o formulário é enviado. Ícone neutro, sem cor de status.
- **"Repita a senha"** no cadastro, no convite e na redefinição: segundo campo, logo abaixo do primeiro ("Senha" no cadastro, "Nova senha" no convite e na redefinição), com o próprio olho ("Mostrar a senha repetida"). Senhas diferentes param no navegador, antes de qualquer envio, com a mensagem "As senhas não são iguais. Digite a mesma senha nos dois campos." (ícone, texto e cor de erro), que aparece ao sair do campo ou ao tentar enviar e some quando as senhas ficam iguais. O servidor confere de novo, porque o navegador nunca é garantia. Segundo campo vazio: o navegador pede o preenchimento, e o servidor responde "Repita a senha para confirmar.". A dica "Pelo menos 8 caracteres." continua no primeiro campo.
- O login tem só o olho, porque a senha já existe. O token de anúncios da Meta, em Configurações, **não** tem olho: é segredo colado, e o valor salvo nunca volta para a tela.

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
