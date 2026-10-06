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

**Todo estado é comunicado por três camadas simultâneas: forma do ícone, rótulo em texto e cor.** Nunca o mesmo ícone em cores diferentes. Motivo: 8% dos homens têm alguma deficiência de percepção de cor, e a recepção trabalha em monitor sem calibração. **Exceção autorizada pelo dono em 06/10/2026:** o tique de entrega da bolha enviada (Tela 1, "Tiques de entrega"), em que "Lida" é o mesmo par de tiques de "Entregue" em azul, como no WhatsApp; o texto vai na dica e no leitor de tela (`docs/06`, C46).

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

**Atividades no menu (escopo acrescentado em 02/10/2026, decisão do dono):** item próprio, logo depois de Leads, com o ícone `list-checks`, a mesma permissão de Leads e Pacientes e **sem contador nesta versão** (o contador de atividades fica para depois). Leva à Tela 15.

**Barra superior, da direita para a esquerda:** avatar com menu, sino, chave de tema, busca global, seletor de unidade (só aparece se a clínica tiver mais de uma).

---

## 5. MATRIZ DE PERMISSÃO (o designer precisa disso para desenhar os estados desabilitados)

| Módulo | Admin | Gestor | Recepção | Profissional | Leitura |
|---|---|---|---|---|---|
| Atendimento | tudo | tudo | tudo | só as próprias conversas | ver |
| Agenda | tudo | tudo | tudo | só a própria agenda | ver |
| Leads e Pacientes | tudo | tudo | tudo | ver | ver |
| Atividades (02/10/2026) | tudo | tudo | tudo | ver | ver |
| Confirmações e Lista de espera | tudo | tudo | tudo | ver | ver |
| Relatórios | tudo | tudo | ver | só os próprios | ver |
| Agente de IA | tudo | tudo | ver | nada | nada |
| Automações | tudo | tudo | ver | nada | nada |
| Cadastros | tudo | tudo | ver | ver | ver |
| Configurações e Assinatura | tudo | ver | nada | nada | nada |

**Regra visual:** ação sem permissão fica **visível e desabilitada**, com dica explicando por quê. Esconder confunde mais do que desabilitar. Módulo inteiro sem permissão some do rail.

**O que entrou em 02/10/2026 (escopo acrescentado):**
- **Atividades** segue a linha de Leads e Pacientes, no banco e na tela: Admin, Gestor e Recepção criam, editam, concluem, adiam e cancelam qualquer atividade da clínica (inclusive as criadas por automação); Profissional e Leitura veem a lista, a seção do drawer, do painel da conversa e da ficha, com "Nova atividade", o botão de concluir e, no menu da linha, Editar, Adiar, Reabrir e Cancelar atividade visíveis e desabilitados, com a dica (Abrir conversa e Abrir ficha continuam liberados, porque só levam a outra tela).
- **Mensagens padrão:** o cadastro (aba de Configurações) é de Admin e Gestor; Recepção, Profissional e Leitura não alteram. O **uso** no compositor é de quem pode responder a conversa (a linha de Atendimento): para quem só acompanha, o botão "Mensagens padrão" da barra fica desabilitado com a dica. Na lista vazia, "Cadastrar em Configurações" é link para Admin e Gestor e fica desabilitado com a dica "Somente administradores e gestores cadastram mensagens padrão." para os outros.
- **Automações de fluxo** (aba de Configurações): Admin e Gestor criam, editam, ligam, desligam e excluem (o gestor gerencia, como na divergência de 25/08/2026 registrada no backlog); sem permissão, tudo fica visível e desabilitado com a dica de Configurações ("Somente administradores e gestores alteram as configurações"); "Somente administradores e gestores mudam as automações de fluxo." é a mensagem mostrada quando o banco recusa a escrita (42501). Na prática, em 02/10/2026 nenhum papel vê esse estado desabilitado: Recepção, Profissional e Leitura não veem a aba, porque Configurações não aparece para eles (a página redireciona para o Início).

**O que entrou em 03/10/2026 (Fase 4 das métricas, investimento da Meta; construída e publicada em 03/10/2026):**
- **Leitura do investimento** (cartão "Investimento nos anúncios", aba Anúncios da Meta de Configurações): Admin e Gestor salvam e removem o token de leitura, testam a leitura e pedem "Atualizar agora", como já gerenciavam a conta de anúncios e o token da API de conversões (a mesma divergência consciente da célula Configurações/Gestor que a de 25/08/2026 registrada no backlog). A guarda vive nas Server Actions (papel conferido antes de qualquer gravação) e no banco: a situação da leitura e o gasto não têm escrita pela sessão, e o token só é lido pelo servidor. Sem permissão, os quatro botões ficam visíveis e desabilitados com a dica de Configurações. Na prática nenhum outro papel vê a aba, porque Configurações não aparece para eles.
- **Resultados:** a tabela Campanhas e o detalhe por campanha mostram as mesmas contagens de leads para todo papel. As colunas Investimento e Custo por lead só existem para Admin e Gestor (regra de valores em reais, abaixo).

**O que entrou em 04/10/2026 (F1 do Google, rastreio do site; construída, publicação pendente; Tela 12, aba Anúncios do Google):**
- **Rastreio do site:** Admin e Gestor ligam, desligam e geram a chave nova, como já gerenciam a aba Anúncios da Meta (a mesma divergência consciente da célula Configurações/Gestor de 25/08/2026). A guarda vive na Server Action e no banco: a policy de `rastreio_do_site` exige administrador ou gestor ativo que escreve, a sessão só grava `ativo` (e, ao criar a linha, a clínica), e a troca da chave é uma função que confere o mesmo papel. A situação do rastreio (só totais) também é só de Admin e Gestor. Os cliques (`clique_do_site`, com o gclid) não são lidos por papel nenhum pela sessão: só o sistema.
- Sem permissão, o interruptor e "Gerar nova chave" ficam visíveis e desabilitados com a dica de Configurações; "Copiar a linha" continua liberado quando a linha existe, porque só copia. Na prática nenhum outro papel vê a aba, porque Configurações não aparece para eles.
- **Origem do lead:** o número da campanha do Google no contato é lido por todo membro ativo (a mesma RLS do contato) e aparece no bloco Origem para todo papel, só leitura (Tela 1).

**O que entrou em 06/10/2026 (mensagem agendada na conversa; construída, publicação pendente; Tela 1):**
- **Agendar** segue a linha de Atendimento: quem pode responder agenda, e só na conversa que está em atendimento com ela (o profissional, nas próprias conversas). **Editar, excluir e dispensar** valem para quem escreve e vê a agendada, não só para quem agendou (decisão do dono: quem edita passa a assinar). **Enviar agora** é de quem escreve e está com a conversa daquele número. Leitura vê a lista com todas as ações visíveis e desabilitadas, com a dica "Seu perfil acompanha o atendimento, sem responder.". A guarda vive no banco (policy com `user_can_write` e gatilho) e nas Server Actions.
- **Cancelar as agendadas de quem perde a escrita** (Configurações > Equipe): Admin e Gestor, ao tirar o acesso ou trocar alguém para Somente leitura.

**Valores em reais só para Admin e Gestor (decisão do dono em 02/10/2026, Fase 3 das métricas).** Dentro de Relatórios (Resultados) e da Lista de espera, quem tem "ver" não vê dinheiro: faturamento estimado, investimento em anúncio e custo por lead (com valor desde a Fase 4, 03/10/2026), receita das consultas recuperadas, receita associada da Lista de espera, valor das conversões devolvidas à Meta e custo de mensagens só têm número para Admin e Gestor. Para Recepção, Profissional e Leitura, o cartão ou a linha que é só o valor (faturamento, custo por lead, receita associada da espera, custo de mensagens) fica **visível e desabilitado**, escrito "Sem acesso", com a dica "Só administrador e gestor veem valores em reais."; nas frases que citam um valor (receita das recuperadas, valor das conversões já enviadas), o valor simplesmente não aparece; e a exportação sai sem essas linhas. Na tabela Campanhas de Resultados (desde 03/10/2026), as colunas Investimento e Custo por lead não existem para os outros papéis, e o subtítulo da tabela diz "Investimento e custo por lead: só administrador e gestor.". Esconder na tela não basta: o faturamento, o investimento e o custo por lead, a receita das recuperadas e a receita da Lista de espera saem **nulos do banco** para os outros papéis (o gasto lido da Meta só é legível por Admin e Gestor, pela RLS). O valor das conversões devolvidas à Meta, em 02/10/2026, ainda só é escondido na tela (a leitura das conversões não recorta por papel): ponto aberto para o dono, registrado no backlog. O objetivo de conversão de Resultados segue a mesma divisão: Admin e Gestor definem, os demais só leem.

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
- **Fluxo de mensagens.** Recebidas à esquerda em Superfície 2. Enviadas à direita. **Mensagem da IA com borda esquerda de 2px na cor primária e selo `✦ IA` de 11px acima da bolha.** Mensagem de humano mostra o nome de quem enviou. **Mensagem enviada direto pelo WhatsApp do número conectado** (celular, WhatsApp Web ou outro aparelho; 05/10/2026) fica à direita com a pele de mensagem enviada e, no lugar do nome, a linha "Pelo WhatsApp" com o ícone `smartphone` (o sistema não sabe quem digitou; o leitor de tela ouve "Enviada direto pelo WhatsApp da clínica, fora do sistema"); a citação dela e a gaveta do lead dizem "Pelo WhatsApp". Nota interna com fundo âmbar a 8%, ícone de cadeado e rótulo "Nota interna, o paciente não vê".
- **Tiques de entrega (pedido do dono em 06/10/2026; construído, publicação pendente):** como no WhatsApp, a bolha enviada pela clínica (atendente, IA, mensagem automática, "Pelo WhatsApp" e a que saiu de uma agendada) mostra, logo depois da hora, dentro da bolha: **um tique** (`check`) enviada; **dois tiques** (`check-check`) entregue; **dois tiques azuis** lida; e, enquanto sai, o ícone de envio (`send-horizontal`, menor), "Enviando". O tique enviado e o entregue ficam na cor de apoio da bolha (a mesma da hora); o azul de lida é o token `--tique-lido` (`#2b7bd0` no claro, `#53bdeb` no escuro, com 3:1 sobre as duas peles de saída). O texto ("Enviada", "Entregue", "Lida", "Enviando") vai na dica ao passar o mouse e no leitor de tela, logo depois da hora. **Lida** só aparece quando o paciente deixa a confirmação de leitura ligada no WhatsApp; senão a mensagem fica em entregue, como no próprio WhatsApp. O dado é a situação de entrega da mensagem, que o aviso de atualização do WhatsApp muda (entregue vira dois tiques, lida vira dois tiques azuis). **Sem tique:** mensagem do paciente, nota interna, evento do sistema, mensagem apagada e a que falhou (essa continua com "Não foi entregue" abaixo da bolha). O azul de lida é exceção autorizada pelo dono à regra "nunca o mesmo ícone em cores diferentes" (3.5).
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

- **Mensagens padrão com "/" (spec 1.11, construído em 02/10/2026).** As respostas rápidas se chamam "Mensagens padrão" na tela. Valem só na aba Responder (não na Nota interna) e só para quem pode escrever na conversa.
  - **Abrir:** digitar "/" no começo do texto ou depois de espaço ou quebra de linha, com o cursor no fim do trecho. Não abre em URL, data, "e/ou" nem "//", e fecha ao digitar espaço. A detecção é pelo valor do campo, então funciona no teclado do celular. O botão **"Mensagens padrão"** da barra (ícone `square-slash`, no lugar do `zap`; dica "Digite / para usar uma mensagem padrão") abre a mesma lista com todas as ativas, para quem usa toque ou leitor de tela, e insere no ponto do cursor. A lista aberta pelo botão fecha quando o foco sai do formulário, depois do envio e na troca entre Responder e Nota interna: voltar ao campo, clicar em Responder numa bolha ou clicar em Enviar não a reabre, e o Enter seguinte volta a enviar.
  - **Lista:** painel acima do campo, com o cabeçalho "Mensagens padrão" e "Enter escolhe, Esc fecha"; cada item mostra o título, o "/atalho" e o começo do texto já com os campos trocados. Filtra pelo atalho e pelo título, sem diferenciar acento, e mostra no máximo 8.
  - **Teclado com a lista aberta:** setas navegam (da última volta à primeira); Enter, Ctrl+Enter e Cmd+Enter **escolhem e nunca enviam**; Tab escolhe; Shift+Enter fecha a lista e quebra a linha; Esc fecha **só a lista** (a citação, se houver, continua) e ela fica fechada até o termo mudar.
  - **Escolher:** a mensagem entra no campo já com `{{nome}}` (o nome do contato da conversa) e `{{clinica}}` (o nome da clínica) trocados, **editável**, com o cursor no fim. **Nunca envia sozinha.** Se o texto passar de 4096 caracteres, aparece o erro e nada é cortado. Contato sem nome: a lista avisa "Contato sem nome: o nome sai do texto.".
  - **Estados da lista:** "Carregando as mensagens padrão..."; erro "Não foi possível carregar as mensagens padrão." com "Tentar de novo"; "Nenhuma mensagem padrão cadastrada." com "Cadastrar em Configurações" (link para Admin e Gestor, desabilitado com a dica para os outros); "Nenhuma mensagem com esse atalho.". O leitor de tela ouve a contagem ("3 mensagens. Use as setas e Enter.") ou o estado.

- **Mensagem agendada (pedido do dono em 06/10/2026; construída, publicação pendente; spec 1.11, nota "Mensagem agendada").** Quem está com a conversa escreve uma mensagem para sair **sozinha** numa data e hora, até 1 ano à frente, pelo número da conversa e em seu nome. É a exceção decidida pelo dono a "nunca envia sozinha": o texto foi escrito por uma pessoa, que escolheu a hora.
  - **Botão no compositor:** ícone `clock-plus` de 40px, logo depois de "Mensagens padrão" e antes dos anexos, com o nome e a dica "Agendar mensagem". Só na aba Responder e só com a conversa em atendimento com quem vê; some junto com a barra quando a resposta está bloqueada pela autorização ou pelo número (os avisos que já existem explicam). Leitura: desabilitado, "Seu perfil acompanha o atendimento, sem responder."; erro ao ler a lista das agendadas: desabilitado, "Confira as mensagens agendadas antes de agendar outra.". Na conversa resolvida, o aviso do compositor passa a dizer "Para responder ou agendar uma mensagem, use Reabrir e responder, no topo da conversa.".
  - **Diálogo "Agendar mensagem"** (520px, como o de atividade). Descrição "Sai sozinha na data e hora escolhidas, em seu nome, pelo WhatsApp da clínica." (com mais de um número ativo, "Sai sozinha na data e hora escolhidas, em seu nome, pelo número {nome}." com o marcador da cor). Campo **"Mensagem"** já com o texto do compositor e o contador "{n} de 4096" (conta como o envio: um emoji conta 2, para o Enviar agora nunca recusar o que o agendamento aceitou). Grupo **"Quando"**: os atalhos "Amanhã", "Em 7 dias", "Em 30 dias", "Em 3 meses" e "Em 6 meses" (marcam o escolhido com o check; só mudam a data; os meses contam do dia civil da clínica e prendem no fim do mês, 31/01 mais 1 mês dá 28/02), **"Data"** (de hoje a hoje mais 12 meses) e **"Hora"** (obrigatória); data e hora começam vazias. Com as duas válidas, a prévia "Sai {quarta}, {06/01/2027}, às {09:00}, horário da clínica (pode levar alguns minutos).". Avisos quando cabem: "A mensagem agendada sai sem a citação." e "Só o texto é agendado. O arquivo anexado continua aqui para enviar agora.". Botões "Voltar" e "Agendar" ("Agendando...", com o check, nunca o relógio). Enter quebra linha; Ctrl+Enter ou Cmd+Enter agenda. **Enquanto "Agendando...", o diálogo não fecha** (Esc, clique fora e o X não fazem nada): a resposta precisa de onde aparecer (revisão de 06/10/2026; antes, fechado no meio, a recusa sumia sem aviso).
  - **Erros do diálogo** (ele não fecha, e o texto continua): "Escreva a mensagem.", "A mensagem tem {n} caracteres e o limite é 4096. Encurte antes de agendar.", "Escolha a data.", "Escolha a hora.", "Essa hora já passou. Escolha outra.", "Escolha uma data até {dd/MM/aaaa}. Mais de 1 ano à frente não dá para agendar.", "Este contato não autorizou receber mensagens. Registre a autorização na ficha antes de agendar.", "Já existe uma mensagem igual agendada para essa hora.", "Este contato já tem muitas mensagens agendadas. Exclua uma antes de agendar outra." (teto de 10 por contato), "Assuma a conversa antes de agendar." e "Não foi possível agendar. O texto continua aqui.". **Só depois do ok** o campo do compositor esvazia (a citação pendurada sai junto), com o aviso "Mensagem agendada para {06/01/2027} às {09:00}.".
  - **Diálogo "Editar mensagem agendada":** o mesmo, já preenchido no fuso da clínica, com a descrição "Mude o texto, a data ou a hora. A mensagem continua marcada." (quando quem edita não é quem assina hoje: "Mude o texto, a data ou a hora. A mensagem continua marcada e passa a sair em seu nome."), botões "Voltar" e "Salvar" ("Salvando...", e o diálogo também não fecha enquanto salva), o aviso "Esta mensagem sai em instantes. Se ela começar a sair antes de você salvar, a mudança não vale." a menos de 2 minutos da hora e, se ela começou a sair, "Esta mensagem já começou a sair e a mudança não foi salva. Confira a conversa." (o diálogo não fecha e a lista recarrega).
  - **Lista acima do campo** (seção "Mensagens agendadas"): aparece em **toda** conversa do contato (aberta, resolvida, com a IA, de colega e de número removido), com as agendadas de todos os números dele. Vazia: nada, sem caixa. Carregando: nada nos primeiros 300 ms, depois uma linha de esqueleto de 40px ("Carregando as mensagens agendadas" para o leitor de tela). Erro: "Não foi possível carregar as mensagens agendadas." com "Tentar de novo". Com 1 item, a linha inteira; com 2 ou mais, o resumo "{n} mensagens agendadas. A próxima sai {amanhã às 09:00}." com "Ver todas" ou "Ocultar". A lista ocupa **sempre** no máximo 40% da altura da tela, com rolagem própria (fechada, com 1 item ou aberta: um item de texto longo nunca espreme o fio; revisão de 06/10/2026). Ficam sempre à vista, mesmo com a lista fechada: os itens em Não enviada, Envio não confirmado e Esperando o número reconectar, e o item que ainda vai sair com o aviso "{Contato} escreveu depois..." (o aviso não pode ficar atrás do "Ver todas").
  - **Situação de cada item, em 3 camadas:** **Agendada** (`clock-fading`, neutro), **Na fila para sair** (`send-horizontal`, neutro; vale também para a agendada cuja hora passou e ainda não saiu), **Esperando o número reconectar** (`wifi-off`, alerta), **Enviada** (`circle-check`, sucesso; fica 24 horas na lista), **Não enviada** (`octagon-alert`, alerta) e **Envio não confirmado** (`circle-alert`, atenção). Excluída e dispensada saem da lista.
  - **Linha de quando e de quem:** em Agendada, "Sai hoje às 15:30", "Sai amanhã às 09:00", "Sai em 08/10 às 11:00" ou "Sai em 06/01/2027 às 09:00" (o ano só fora do ano corrente da clínica; o leitor de tela ouve "Sai na quarta, 6 de janeiro de 2027, às 09:00"). Depois, "Agendada por {Ana | você}" ou "Agendada por {Ana}, editada por {Bruno}"; quem assina e saiu da equipe (ou virou Somente leitura) ganha "(sem acesso)". Com mais de um número ativo, "pelo número {nome}" com o marcador da cor. O texto aparece em até 2 linhas, com "Ver tudo" quando corta.
  - **Linha do estado:** Na fila, "Marcada para {hoje às 11:00}. Pode levar alguns minutos."; atrasada esperando a manhã (o mesmo chip da fila), "Atrasou e vai sair às 08:00, para não chegar de madrugada."; Esperando o número, "Marcada para {hoje às 11:00}. Se o número {nome} não reconectar até {hoje às 21:00}, a mensagem não sai." (o "até" é o **prazo efetivo**: 12 horas depois da hora marcada, ou as 21:00 antes disso quando dali em diante ela cairia de madrugada; marcada para 14:00, o limite é hoje às 21:00, e não 02:00); Enviada, "Enviada hoje às 09:02", com "Ver na conversa"; Não enviada, "Não enviada: {motivo}." e "Uma atividade foi criada para {Ana | você} conferir." ("Uma atividade foi criada para a equipe conferir." quando quem assina saiu da equipe); Envio não confirmado, "A mensagem pode ter chegado ao paciente. Confira a conversa antes de mandar de novo.".
  - **Motivos** (o código nunca aparece): "{Contato} não autoriza receber mensagens", "o número {nome} foi removido da clínica", "o número {nome} ficou desconectado por mais de 12 horas", "o envio atrasou mais de 12 horas", "o envio atrasou e cairia de madrugada" (a atrasada cujas 08:00 seguintes passam das 12 horas), "o número ficou ocupado com outros envios por tempo demais" e, para qualquer outro, "erro do sistema no envio". Com a tarefa encerrada de vez, vale o motivo final dela, e não o de uma tentativa antiga.
  - **Avisos do item** (`circle-alert`, atenção): "{Contato} escreveu depois que esta mensagem foi agendada. Confira se ela ainda faz sentido." (antes do envio, quando o paciente escreveu no mesmo número depois de a mensagem ser agendada ou editada; ela **não** se cancela sozinha, e o item fica sempre à vista) e, em Agendada, "O número {nome} está desconectado. Se não reconectar até {hoje às 21:00}, a mensagem não sai." (o mesmo prazo efetivo da linha de Esperando o número).
  - **Ações do item** (40px; o nome acessível leva a data, como "Editar a mensagem agendada para 08/10 às 11:00"; sem permissão, visíveis e desabilitadas com a dica):
    - **Editar** (`pencil`), em Agendada. Na fila: desabilitado, "Esta mensagem já está na fila para sair e não dá mais para mudar. Você ainda pode excluir.".
    - **Enviar agora** (`send`), em Agendada, para quem está com a conversa: confirmação "Enviar agora para {Contato}?", "A mensagem marcada para {quando} sai agora, em seu nome." (com mais de um número, "... em seu nome, pelo número {nome}."), botões "Enviar agora" ("Enviando...") e "Manter agendada". Sai como resposta digitada (o termo da jornada anda). Desabilitado: resolvida, "Para enviar agora, use Reabrir e responder, no topo da conversa."; aguardando, "Para enviar agora, assuma a conversa."; com colega, "{Nome} está atendendo. Para enviar agora, use Assumir do colega, no topo da conversa."; com a IA, "A IA está atendendo. Para enviar agora, assuma a conversa."; conversa aberta de outro número, "Esta mensagem sai pelo número {nome}. Para enviar agora, abra a conversa desse número."; **número da agendada desconectado**, "O número {nome} está desconectado. A mensagem continua agendada e espera a reconexão." (revisão de 06/10/2026: enviar agora a tiraria da agenda e o envio seria recusado; parada, ela espera a reconexão sozinha; o servidor confere de novo antes de tirar). Na fila, a ação some. Texto acima do limite: a confirmação mostra "A mensagem tem {n} caracteres e o limite é 4096. Encurte antes de enviar." e nada sai da agenda. **Depois que a mensagem sai da agenda, três desfechos** (revisão de 06/10/2026):
      - **Saiu:** o item sai da lista e a bolha aparece no fio ("A mensagem agendada saiu." para o leitor de tela).
      - **Com certeza não saiu:** o texto volta para o campo, com o aviso "A mensagem não saiu e não está mais agendada. O texto voltou para o campo." (com uma resposta já escrita, entra no fim; com a nota interna vazia, volta para Responder). Quando o campo não pode receber (nota interna escrita, ou a tela já está em outra conversa), o aviso fica aberto, diz de qual contato era a mensagem e oferece **"Copiar a mensagem"**: "A mensagem para {Contato} não saiu e não está mais agendada." com "Há outro texto no campo. Copie a mensagem e cole na resposta ao paciente." (mesma conversa) ou "Copie a mensagem e cole na resposta para {Contato}." (outra conversa).
      - **Pode ter chegado** (envio sem confirmação): o texto **não** volta para o campo, porque mandar de novo poderia duplicar. O aviso de atenção "Não deu para confirmar se a mensagem chegou ao paciente. Confira a conversa antes de mandar de novo." fica 20 segundos com **"Copiar a mensagem"** (o texto só vai para a área de transferência por gesto da pessoa, depois de conferir), e o fio e a lista recarregam para mostrar o que de fato aconteceu.
      - **Sem resposta do servidor** (a rede caiu): a lista relê antes de decidir. Se a agendada continua marcada, "Não foi possível falar com o servidor. A mensagem continua agendada."; se ela seguiu outro caminho (na fila, enviada), "Não foi possível falar com o servidor. Confira a lista e a conversa antes de tentar de novo."; se ela saiu da lista (ou a releitura também falhou), o texto do item volta para o campo com o aviso de atenção "Não foi possível confirmar o envio. Confira a conversa antes de mandar de novo." (sem campo livre: "Não foi possível confirmar o envio da mensagem para {Contato}." com "Copiar a mensagem" e o pedido de conferir a conversa antes).
    - **Excluir** (`trash-2`), em Agendada, Na fila e Esperando o número: confirmação "Excluir esta mensagem agendada?", "Ela não vai ser enviada para {Contato}. Não dá para desfazer.", botões "Excluir mensagem" ("Excluindo...") e "Manter". Se ela já começou a sair: "Esta mensagem já começou a sair e não dá mais para excluir. Confira a conversa.".
    - **Não enviada:** "Agendar de novo" (abre o diálogo com o texto; exige a conversa com quem vê, senão a dica "Para agendar de novo, assuma a conversa."; na conversa de um **número removido**, desabilitado com "O número {nome} foi removido. Para agendar de novo, use a conversa de outro número.", porque assumir essa conversa não levaria a lugar nenhum; depois do ok, a antiga sai da lista) e "Dispensar". **Envio não confirmado:** só "Entendi, esconder".
    - **Excluir na fila depois de uma falha:** a que voltou para a fila depois de uma falha que com certeza não enviou (e ia tentar de novo) pode ser excluída, e não sai mais; só a que pode ter chegado recusa com "Esta mensagem já começou a sair...".
  - **Acessibilidade:** uma região de anúncio sempre montada diz "Mensagem agendada.", "Mensagem agendada excluída.", "A mensagem agendada saiu." e "A mensagem agendada não saiu.". Depois de excluir, dispensar ou enviar agora, o foco vai para o próximo item, para o título da seção ou, com a lista vazia, para a caixa de escrever.
  - **Quando sai:** pelo envio automático, no número da conversa (nunca troca de número), em nome de quem assina (quem editou por último, senão quem agendou). Não derruba o "Aguardando você" de uma pergunta do paciente que chegou nesse meio tempo. Depois de sair, a conversa sem atendente fica com quem assina, se ainda tem acesso com escrita (nunca tira de colega nem da IA); senão, fica Sem atendente. A atrasada (mais de 15 minutos depois da hora marcada, por exemplo porque o número caiu e voltou) não chega entre 21:00 e 08:00 da clínica: espera as 08:00, se elas caírem até 12 horas depois da hora marcada, inclusive (a das 20:00 espera as 08:00 e sai); senão não sai ("o envio atrasou e cairia de madrugada"). A marcada pela pessoa para dentro dessa faixa (22:00, por exemplo) sai na hora. Autorização revogada (também para a que já estava na fila, e reautorizar não a revive), número removido ou mais de 12 horas de atraso: não sai, e nasce uma atividade para quem assina conferir.
  - **Bolha:** a linha de autor tem o relógio `clock-fading` de 12px, neutro: "{Ana} · Mensagem agendada", ou "{Bruno} · Mensagem agendada (criada por {Ana})" quando outra pessoa editou; o leitor de tela ouve "Mensagem agendada por {Ana}, enviada sozinha na hora marcada." (com edição, "Mensagem agendada por {Ana}, editada por {Bruno}, enviada sozinha na hora marcada."). A marca vem de uma leitura à parte do fio: se ela falhar, a bolha fica como resposta comum e o fio nunca deixa de carregar. A bolha que acabou de sair ganha a marca logo depois do evento da mensagem.
  - **Ao vivo (revisão de 06/10/2026):** a agendada não passa pelo tempo real (ele entregaria o texto a toda aba aberta). A lista relê pela sessão a cada mensagem ou mudança de conversa daquele contato, a cada 30 segundos com a conversa aberta e a aba à vista, quando a janela volta ao foco e depois de cada ação; por isso a agendada criada ou editada por outra pessoa pode levar até 30 segundos para aparecer. A leitura vai para a trilha de auditoria.
  - **Canal oficial:** nada por enquanto; no futuro, atrás de `isOfficialChannel`, vira "agendar modelo aprovado".

**Coluna 4, contexto (320px, colapsável):**

Blocos com título em micro tipografia maiúscula: Identificação · **Origem** (canal, campanha, data, método de captura; regras abaixo) · Dados (convênio, etapa, procedimento de interesse, **estado do opt-in com botão de descadastrar**) · **Próxima consulta** (card com chip de status, ou botão Agendar em destaque se vazio) · **Saldo de pacote** (quando houver) · Histórico · **Ações** (Agendar, Adicionar à lista de espera, Marcar como perdido, Ver ficha).

**Bloco Origem (origem real do anúncio, 04/10/2026; publicado em 04/10/2026; spec 10.1):** linhas Canal, Campanha, Conjunto, Método e Primeiro contato, só leitura para todo papel; no painel, linha sem valor some (no drawer e na ficha, o Canal vazio diz "Não informado"). As mesmas regras valem na lista, no drawer de Leads e na ficha do paciente (regras puras em `lib/domain/leads-ui.ts`).
- **Canal** junta canal, origem e plataforma numa frase: "Tráfego pago, Meta (Instagram)", ou "Tráfego pago, Meta" quando o canal do WhatsApp não informou a plataforma. Origem igual ao canal não se repete. (Antes desta frente, o painel mostrava o código cru do canal.) O lead do clique rastreado no site (anúncio do Google, spec 10.13; construído em 04/10/2026, publicação pendente) aparece como "Tráfego pago, Google", sem regra nova.
- **Campanha:** a campanha digitada ou importada vem primeiro; depois, para o lead do clique no site, "Campanha do Google {número}" (o nome só chega com a conexão com o Google Ads), ou "Campanha do Google não informada" quando o clique veio sem o número; senão, para o lead de anúncio, o nome que a Meta informou para o anúncio do lead, buscado pelo id ("Campanha {id}" quando a Meta não deu nome); sem essa informação ainda, "Campanha da Meta ainda não identificada"; clique de anúncio sem id do anúncio, "Campanha da Meta não informada". Quem não veio de anúncio nem tem campanha: "Sem campanha" no drawer e na ficha; no painel a linha some e, na lista, a célula fica vazia.
- **Conjunto** (só no lead de anúncio da Meta): o nome do conjunto; senão "Conjunto {id}"; sem nada da Meta, "Conjunto não informado pela Meta"; sem a informação ainda, "Conjunto ainda não identificado"; clique de anúncio sem id do anúncio, "Conjunto não informado". O grupo de anúncios do Google fica guardado no contato e não aparece na tela.
- **Método:** "Anúncio de clique para WhatsApp", "Clique no site", "Link com código", "Mensagem padrão do anúncio", "Palavra-chave na primeira mensagem", "Cadastro manual" ou "Importação de planilha".
- Os textos de pendência ficam em tom secundário; o nome real, em texto normal. **Carregando** a campanha: esqueleto com "Carregando a campanha" para leitor de tela. **Erro** só na leitura da campanha: "Não foi possível carregar a campanha", com "Tentar de novo" no painel e no drawer (na ficha, "Atualize a página para tentar de novo."). Nunca aparecem como "Sem campanha".
- Sem origem e sem campanha, o bloco diz "Origem ainda não identificada. Ela é capturada sozinha quando o contato chega por anúncio de clique para WhatsApp, link com código, mensagem padrão do anúncio ou palavra-chave."
- O cartão do Kanban e o cabeçalho do drawer continuam mostrando só o canal (regra dos 5 elementos do cartão), e o filtro de Origem compara só o canal: "Tráfego pago" passa a trazer os leads de anúncio.

**Atividades no painel (o "criar lembrete" da spec 1.9, 02/10/2026):** seção "Atividades" logo depois de "Etapa da jornada", com até 3 pendentes do contato (chip de situação, prazo e responsável), "E mais N pendentes em Ver todas", **"Nova atividade"** (o mesmo diálogo da Tela 15; a atividade criada aqui guarda a conversa) e **"Ver todas"** (abre a Tela 15 só com este contato). Concluir pelo botão da linha, com "Desfazer" no aviso. Carregando, erro só na seção com "Tentar de novo", e vazio. A leitura vai para a trilha de auditoria.

**Termo da jornada escrito pela clínica (02/10/2026):** quando a etapa aceita termo da clínica (Tela 12, Jornada), o texto enviado pelo Atendimento (e a legenda do arquivo enviado por ele) e o que a equipe escreve no celular conectado também andam o lead, sem nada mudar no compositor. Cada mensagem do celular anda o lead uma vez só: a reentrega da mesma mensagem pelo provedor não move de novo. Mensagens da IA e da régua de follow-up não andam o lead por termo da clínica.

**Cor do número (06/10/2026, pedido do dono; desenho no `docs/07`, Telas):** com mais de um número ativo, cada conversa diz de qual número da clínica ela é, com a cor escolhida em Configurações > WhatsApp. Logo abaixo do cabeçalho, uma **faixa larga** "Conversa pelo número {nome}", com o telefone do número e, quando ele cai, o chip de conexão (o cabeçalho volta a ser só do paciente). Ao lado de Responder e Nota interna, "Respondendo pelo número {nome}" com o marcador da cor (some na nota interna e quando o número está fora do ar, onde fala o aviso de desconectado). O cartão da lista ganha o filete da cor no selo do número, e os chips do filtro "Número" ganham o marcador da cor; a escolha do filtro fica guardada no navegador de cada pessoa. Número removido aparece neutro, com "(removido da clínica)". **Configurações > WhatsApp:** o cartão mostra o marcador ao lado do nome e o chip "Cor {nome da cor}"; "Adicionar número" tem o campo **Cor**, que já vem com a primeira cor livre, e a prévia "Fica assim no Atendimento:"; o menu do cartão ganha **"Trocar cor"** (administrador e gestor; sem permissão, desabilitado com a dica), que avisa "Esta cor já é de {número}. Dá para usar, mas uma cor diferente evita confundir as conversas."; o diálogo de conectar mostra o marcador ao lado de "Conectar {nome}".

**Ordem da lista (06/10/2026, pedido do dono):** como no WhatsApp, a conversa com a mensagem mais recente, enviada ou recebida, fica no topo, e a hora do cartão é a dessa mensagem, com o rótulo acessível "Última mensagem às {hora}" (ou "em {dd/MM}"). Mandar uma resposta (pelo sistema ou pelo celular conectado) sobe a conversa; nota interna e evento não sobem. O prefixo da prévia ("Você:", "Clínica:", "IA:") diz quem escreveu. A espera de "Há mais de 24h" continua contada da última fala do paciente.

**Nota interna de automação (02/10/2026):** a automação de fluxo pode deixar uma nota interna na conversa mais recente do lead (nenhuma pessoa é autora). A bolha tem a pele de nota e a linha de autor "Automação · Nota interna, o paciente não vê", com o cadeado e o tom âmbar das notas (ícone, texto e cor). A mensagem automática ao paciente (régua, confirmação) continua sem linha de autor. Pendência: quem responde citando essa nota vê a citação assinada "Sistema" (registrada no backlog).

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

**Combinação que saiu enquanto a Agenda estava aberta (02/10/2026, convênio pelo médico, Tela 8):** o catálogo da Agenda fica alguns minutos em cache, e outra tela pode tirar o convênio do profissional ou do procedimento nesse meio. O servidor recusa a consulta **nova** nessa combinação com "Este profissional não atende mais este procedimento por este convênio. A lista já foi atualizada: escolha de novo.", a mensagem fica à vista e as listas do modal se atualizam sozinhas (a escolha que ficou inválida é limpa). A remarcação com o mesmo profissional mantém a combinação da consulta já marcada.

---

### TELA 4. LEADS `PRIORIDADE ALTA`

**Toggle Lista e Kanban preservando o filtro.**

**Kanban:** colunas Novo, Em contato, Aguardando resposta, Agendou, **Compareceu**, Perdido. Cabeçalho com nome, **contagem em cinza** e menu.

**Descrição da etapa no cabeçalho da coluna (02/10/2026):** quando a etapa tem descrição (Tela 12, Jornada), ela aparece logo abaixo do nome da coluna, em texto secundário pequeno, em **até 2 linhas**. O texto inteiro aparece na dica, que abre no hover e no foco do teclado (a descrição recebe foco), e entra no `aria-describedby` da coluna; o nome acessível da coluna continua "{etapa}, {n} leads". Quando **alguma** etapa tem descrição, todas as colunas reservam a mesma altura, para os cartões começarem alinhados; sem nenhuma descrição, nada muda. O esqueleto da lista reserva a mesma altura quando a jornada já é conhecida; o esqueleto do carregamento da rota ainda não conhece a jornada e não reserva essa altura (com descrição, os cartões descem um pouco quando a lista chega). **A descrição nunca entra no cartão.**

**Cartão com exatamente 5 elementos, nem um a mais:**
1. Nome, 14px semibold
2. Telefone, 12px secundário
3. Badge de origem
4. **Badge de tempo desde o último contato**, com ícone, rótulo e cor: verde até 4h, âmbar de 4h a 24h, vermelho acima de 24h
5. Avatar de 20px do responsável, canto inferior direito

Campo vazio some, nunca mostra rótulo sem valor. Arrastar entre colunas. Soltar em Perdido abre modal obrigatório de motivo. **Ordenação padrão dentro da coluna: por próxima ação.**

**Lista:** tabela densa, linhas de 44px, colunas Nome, Telefone, Origem, Campanha, Etapa, Responsável, Último contato, Entrou em, **Opt-in**. Seleção múltipla com barra de ações em massa flutuando na base. Desde a origem real do anúncio (publicada em 04/10/2026), a coluna Origem mostra a frase completa ("Tráfego pago, Meta (Instagram)", ou "Tráfego pago, Google" no lead do clique no site, publicação pendente) e a coluna Campanha a campanha resolvida pelas regras do bloco Origem (Tela 1); as duas cortam com reticências e guardam o texto inteiro na dica do cursor. A campanha da Meta é lida junto com a lista; se essa leitura falhar, só os leads de anúncio mostram "Não foi possível carregar a campanha" e a lista continua.

**Drawer de detalhe (480px)** ao clicar: dados, origem, conversa resumida, botões Abrir conversa, Agendar, Marcar perdido. A seção **"Origem"** fica entre "Dados" e "Atividades", com Canal, Campanha, Conjunto e Método (regras do bloco Origem da Tela 1); a Campanha saiu da seção Dados. Nada ali é editável, para nenhum papel. "Tentar de novo" aparece só quando o detalhe carregou e a leitura da campanha falhou.

**Atividades no drawer (02/10/2026):** seção "Atividades" entre "Origem" e "Conversa", igual à do painel da conversa (Tela 1): até 3 pendentes, "E mais N pendentes em Ver todas", "Nova atividade" e "Ver todas". As atividades vêm no mesmo carregamento do drawer, com a trilha de leitura; se a leitura delas falhar, só a seção mostra o erro com "Tentar de novo". O rodapé não ganha botão. **Nada de atividade no cartão do Kanban** (regra dos 5 elementos).

**Ação em massa "Mudar etapa" (02/10/2026):** o popover ganhou a linha "Mover também pode disparar as automações de fluxo da etapa de destino, para cada lead." e o diálogo de confirmação, "Se {etapa} tiver automação de fluxo ligada, ela também roda para cada lead movido.", ao lado do aviso que já existia sobre a régua da etapa.

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
- À esquerda, **Próximas ações** (pendências de confirmação, leads sem resposta há mais de 24h, conversas aguardando humano e, desde 02/10/2026, as duas linhas de atividades descritas abaixo; cada item é link para a tela já filtrada) e, embaixo, **"Consultas por dia, últimos 7 dias"**: 7 barras deitadas, uma por dia, de seis dias atrás até hoje sem pular dia (domingo com zero aparece), com "Hoje" escrito no rótulo e a barra de hoje em destaque; os outros dias ficam neutros. A contagem é a mesma de "Consultas hoje", então a barra de hoje bate com o cartão. Coluna vertical é proibida (C12 do `docs/06`).
- À direita, **Funil de leads**: uma barra por etapa da jornada da clínica, na ordem dela, com quantos contatos estão em cada etapa **agora** (o mesmo número do Kanban de Leads, não a coorte do período). "Perdido" fica neutro, as outras etapas em destaque. Botão de ícone "Abrir Leads" no cabeçalho.

**Estados:** cada bloco carrega sozinho. Se um falha, só ele mostra o erro (nunca zero) e um aviso no topo, "Alguns números não carregaram", oferece "Tentar de novo"; o resto da tela continua. Vazios: "Nenhuma consulta nos últimos 7 dias" e "Nenhum lead na jornada ainda".

**Profissional:** continua com a visão própria (a agenda dele nos últimos 30 dias) e "Suas próximas ações". Os números da clínica não chegam a ele: o banco devolve nulo. As duas linhas de atividades também aparecem para ele.

**Linhas de atividades em Próximas ações (02/10/2026):** **"Suas atividades atrasadas"** (`clock-alert`, alerta, link para a Tela 15 com o filtro de atrasadas) e **"Suas atividades para hoje"** (`list-checks`, neutro, filtro de para hoje), contando só as atividades de quem está usando. Têm leitura própria, que chega depois do resto do cartão (duas linhas de esqueleto enquanto isso) e falha sozinha: "Não foi possível contar suas atividades." com "Tentar de novo", sem derrubar o cartão nem o Início. O "hoje" é o dia no fuso da clínica, e a atrasada nunca conta também como de hoje.

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
- quem faz (vários profissionais) e, para cada um, os convênios aceitos ("Particular" sempre disponível); desde 02/10/2026 os convênios de cada profissional são os que **cobrem o procedimento e que ele atende** no cadastro dele, já marcados (ver "Convênio pelo médico", abaixo);
- preço e duração do procedimento valem como padrão; a exceção por profissional ou convênio (preço próprio, "Coberto" ou duração própria) é feita ali mesmo;
- a chave "IA pode agendar" é a do procedimento, e o vínculo segue essa chave (uma fonte só);
- vínculo que já tem consulta não é apagado, é desativado.

**Convênio pelo médico (decisão do dono em 02/10/2026; spec 3.4 e 3.5).** A clínica cadastra todos os convênios na aba Convênios; o profissional diz quais atende; o procedimento diz quais o cobrem; e o convênio do profissional entra sozinho só onde ele faz o procedimento e o convênio cobre. As duas listas de marcar são iguais (grupo com legenda e ajuda, uma linha de 40px por convênio com "Nome · Plano", o convênio desativado só quando já estava marcado, sempre no fim e com a situação "Inativo", e duas colunas a partir de 5 convênios, em tela de 640px ou mais).

*Modal do Profissional, seção "Convênios que atende"* (logo depois de Especialidades):
- Ajuda: "O Particular vale sempre e não precisa ser marcado. O convênio marcado aqui entra sozinho nos procedimentos que este profissional faz e que o convênio cobre." O Particular não tem caixa.
- Sem convênio ativo na clínica, só o texto "Nenhum convênio ativo. Cadastre ou reative um na aba Convênios para marcar quais este profissional atende.", sem atalho (trocar de aba fecharia o modal).
- Convênio que já estava numa combinação ativa dele sem estar no cadastro vem marcado, com a nota "Marcado porque já está em uso em um procedimento deste profissional."
- Na edição, quando o Salvar vai de fato mandar a lista, a prévia "Ao salvar" diz o que acontece, uma frase por convênio: "Unimed entra em 3 procedimentos: Consulta, Retorno e Ultrassom.", "Unimed fica no cadastro e ainda não entra em nenhum procedimento deste profissional.", "Bradesco Saúde sai de 2 procedimentos: A e B.", "Bradesco Saúde sai do cadastro, sem mudar nenhum procedimento." e, quando for o caso, quem deixa de fazer (abaixo). Profissional novo não tem prévia, porque ainda não faz nenhum procedimento.
- **Aviso antes de gravar**, no lugar do Salvar (o rodapé fica só com Cancelar, que fecha sem gravar; mexer nos convênios tira o aviso e devolve o Salvar): com consulta futura nas combinações que saem, "Há N consultas marcadas com este profissional pelos convênios desmarcados. Remarque ou cancele, se for o caso." (no singular, "pelo convênio desmarcado"), a primeira consulta, "Esta ação não desmarca nada: as consultas continuam valendo e os lembretes continuam saindo para os pacientes.", "Abrir a Agenda" e **"Tirar o convênio mesmo assim"**; sem consulta, mas com procedimento que ele deixa de fazer, só a frase "Este profissional deixa de fazer 1 procedimento, porque só atendia nele pelo convênio desmarcado: Retorno. Para voltar, inclua o profissional em Quem faz, no cadastro do procedimento." e o botão (com as duas coisas, quem deixa de fazer vai como complemento). Nada é gravado antes da confirmação.
- Depois de salvar, o toast "Profissional atualizado" (ou "Profissional criado") traz o resumo do que o banco fez de verdade, não o da prévia. Quando o Salvar grava só uma parte (o profissional novo foi criado, mas os convênios não; ou os convênios foram gravados, mas os dados do profissional não), o modal continua aberto e o erro diz o que aconteceu, inclusive com a jornada ("A jornada foi salva." ou "A jornada também não foi salva."), e termina em "Clique em Salvar de novo." (ou "Confira os convênios e clique em Salvar de novo."); se os convênios foram gravados, sai também o toast "Convênios salvos" com o resumo, e o próximo Salvar não manda a lista de novo.
- Quem só vê (Ver detalhes) vê a mesma lista desabilitada, com a dica do papel; sem convênio, "Atende só Particular. A clínica não tem convênio ativo."

*Modal do Procedimento, seção "Convênios que cobrem este procedimento"* (logo acima de "Quem faz e convênios"):
- Ajuda: "Quem faz este procedimento e atende o convênio no cadastro do profissional recebe o convênio já marcado, em Quem faz e convênios." Sem convênio para oferecer, "Nenhum convênio ativo. Cadastre ou reative um na aba Convênios para marcar quais cobrem este procedimento.", sem atalho.
- Convênio que já estava numa combinação ativa do procedimento sem estar marcado como cobertura vem marcado, com a nota "Marcado porque já está em uso em Quem faz e convênios."
- Frases ao vivo: "Nenhum convênio marcado: este procedimento é só Particular." e, ao desmarcar um convênio que estava marcado na abertura, "Ao tirar Unimed, Dr. João e Dra. Ana deixam de atender por este convênio neste procedimento."
- Marcar um convênio deixa o convênio marcado para quem faz e o atende; desmarcar o tira de todos; desmarcar e marcar de novo no mesmo modal, sem salvar, volta ao que estava na abertura (a exceção não se perde).
- Em "Quem faz e convênios", cada profissional mostra o Particular (sempre, e desmarcável) e os convênios que cobrem e que ele atende, já marcados; desmarcar ali é a exceção daquele procedimento. Convênio marcado que ele não atende no cadastro aparece com "Fora do cadastro do profissional"; o convênio ativo que cobre e que ele não atende não aparece para marcar, e o cartão explica: "Dr. João não atende Bradesco no cadastro do profissional. Para incluir, marque em Convênios que atende, na aba Profissionais." "Adicionar quem faz" já traz a interseção marcada. A ajuda da seção passa a: "Cada profissional mostra os convênios que cobrem este procedimento e que ele atende no cadastro dele, já marcados. Desmarcar aqui vale só para este procedimento. Preço e duração vêm do procedimento: Particular pelo preço base e convênio como Coberto. Personalize só o que for diferente. A chave "IA pode agendar" vale para todos."
- **Aviso antes de salvar** (antes, era um aviso depois de gravar): quando o Salvar tira uma combinação com consulta futura (remover alguém, desmarcar uma exceção ou tirar uma cobertura), "Há N consultas marcadas em combinações de quem faz e convênio que saem deste procedimento. Remarque ou cancele, se for o caso.", com "Abrir a Agenda" e **"Salvar mesmo assim"**, no lugar do Salvar. Nada é gravado antes; depois, o toast diz quantas combinações saíram da agenda ("1 combinação de quem faz e convênio saiu da agenda.").
- Na edição, quem faz e os convênios são gravados antes dos dados do procedimento; se a segunda parte falhar, o erro diz "Quem faz e os convênios foram salvos, mas os dados do procedimento não.", o motivo e "Clique em Salvar de novo." Por isso o nome em branco é recusado na tela ("Informe o nome do procedimento.") antes de qualquer gravação.
- Quem só vê vê "Convênios que cobrem este procedimento" em texto, com os ativos ou "Nenhum convênio cobre: este procedimento é só Particular." (e "Convênios inativos não aparecem aqui, porque a Agenda não os oferece." quando algum fica de fora).

*Nos dois modais:*
- **Aba desatualizada:** se o cadastro mudou enquanto a pessoa editava (outra aba, outra pessoa), o Salvar é recusado com "O cadastro mudou enquanto você editava. Feche, abra de novo e salve." e os dados da tela se recarregam.
- Convênio desativado não pode ser marcado ("Um convênio desativado não pode ser marcado.").
- **Foco quando o aviso entra no lugar do Salvar:** o foco vai para o aviso (fora da ordem do Tab); o Tab seguinte cai em "Abrir a Agenda", quando há consulta, e o outro no botão de confirmar. Nada confirma sozinho. Se a confirmação termina em erro, o foco volta ao botão de confirmar ou ao Salvar.
- Sem coluna nova nas tabelas (C25 do `docs/06`).

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

Duas colunas: à esquerda **linha do tempo de agendamentos** (data, profissional, procedimento, valor, chip de status); à direita dados cadastrais, **saldo de pacote com barra de sessões**, **estado do consentimento** (origem, data, botão de descadastrar), origem preservada desde o lead (desde 04/10/2026, publicada: Canal, Campanha, Conjunto, Método e "Chegou em", com as regras do bloco Origem da Tela 1, inclusive as do lead do clique no site), e botões Abrir conversa, Agendar, Adicionar à lista de espera.

**Cartão Atividades na ficha (02/10/2026):** no topo da coluna da direita, com **todas** as pendentes do paciente e as **últimas 5 concluídas** ("Concluídas recentemente"), "Nova atividade" e "Ver todas" (Tela 15 só com este paciente). Carregado junto com a ficha, com a trilha de leitura própria; se a leitura das atividades falhar, só o cartão mostra o erro. Depois de cada ação a ficha recarrega.

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
- Cinco cartões: **Leads recebidos** e **Consultas agendadas** (agendamentos criados no período), os dois com variação contra o período anterior; **Taxa de conversão** (o lime da aba): dos leads que chegaram no período, quantos já agendaram (coorte), com 1 casa, sem variação (a coorte anterior teve mais tempo para maturar), "Sem leads no período" quando não há lead, rodapé "Objetivo: X%" que some sem objetivo e o botão "Definir objetivo" ou "Alterar objetivo"; **Custo por lead** (investimento lido da Meta, desde a Fase 4 das métricas; abaixo); **Faturamento estimado** (abaixo).
- Blocos: **Leads x consultas agendadas** (linha com marcadores, duas séries, um ponto por dia civil da clínica); **Origem dos leads** em barras com percentual; **Funil comercial** (coorte: Chegaram, Agendaram, Compareceram); **Confirmação de consulta** (as taxas com o par bruto escrito, as recuperadas e a linha de base contra a taxa medida, sem frase de causa, com "Ver detalhes em Comercial"); **Agente de IA** (as métricas do agente em "Ainda não medido" e a primeira resposta da equipe); **Campanhas** (abaixo).

**Faturamento estimado:** soma do preço das consultas **com comparecimento** no período. Preço do vínculo; sem ele, o preço base do procedimento; "Coberto" pelo convênio sem valor não soma e é contado à parte, assim como a consulta sem preço nenhum; preço zero é gratuito de verdade e entra. "Estimado" porque o preço vem do cadastro atual. Na Visão geral em formato compacto ("R$ 284 mil", o leitor de tela ouve o valor cheio), com variação e o rodapé do que ficou fora da soma ("Fora da soma: 2 consultas de convênio sem valor"); em Comercial com o valor cheio e todas as contagens. Sem comparecimento: "Nenhum comparecimento"; só com convênio sem valor ou sem preço: "Sem preço para somar" (nunca `R$ 0,00`).

**Investimento, custo por lead e Campanhas (Fase 4 das métricas, construída e publicada em 03/10/2026; spec 10.12).** O investimento vem da leitura da conta de anúncios da Meta da clínica (Tela 12, Anúncios da Meta). O lead entra pela chegada no período e é ligado à campanha só por identificador (o anúncio de onde veio, ou o id da campanha), nunca por nome. Cartão, tabela, detalhe por campanha e exportação usam a mesma leitura do banco, então os números batem entre si.

- **Custo por lead** (Visão geral e Marketing; administrador e gestor): investimento total da conta de anúncios no período dividido pelos leads de anúncio do período (os que chegaram com o clique do anúncio ou com o id do anúncio ou da campanha; o divisor é decisão pendente do dono, backlog D2). Valor cheio abaixo de R$ 10 mil e compacto acima; rodapé "R$ X em N leads de anúncio" e "Atualizado em dd/MM às HH:mm" (fuso da clínica); variação contra o período anterior só quando os dois períodos foram medidos por inteiro, e cair é bom. Estados, nesta ordem:
  - sem conta de anúncios ou sem a leitura ligada: "Ainda não medido", dica "Ligue a leitura do investimento em Configurações, aba Anúncios da Meta.";
  - conta em outra moeda: "Conta em outra moeda", rodapé "A conta de anúncios não usa real, e o valor não é convertido.";
  - antes da primeira leitura: "Ainda não medido", dica "A primeira leitura do investimento ainda não terminou." (com a leitura com problema, "A leitura do investimento está com problema. Veja o motivo em Configurações, aba Anúncios da Meta.");
  - período que começa antes do primeiro dia lido: "Ainda não medido", dica "O investimento é lido a partir de dd/MM/aaaa." (nunca um número parcial, que sairia baixo demais);
  - leitura parada mais de 2 dias antes do fim do período (ou de hoje): "Ainda não medido", dica "O investimento foi lido até dd/MM/aaaa." e, com problema, a frase do problema;
  - nenhum investimento no período: "Sem investimento no período";
  - nenhum lead de anúncio: "Nenhum lead de anúncio", rodapé "R$ X investidos no período";
  - com valor e conta de anúncios num fuso de outro horário: uma linha a mais no rodapé, "Os dias do investimento seguem o fuso da conta de anúncios, diferente do fuso da clínica.";
  - carregando e erro (com "Tentar de novo") próprios; o erro aparece só no cartão e em Campanhas, sem derrubar a tela;
  - Recepção e Leitura: "Sem acesso".
- **Campanhas** (Visão geral e Marketing): administrador e gestor veem as colunas **Campanha, Investimento, Leads, Custo por lead, Agendados e Conversão**; os outros papéis veem Campanha, Leads, Agendados e Conversão (as colunas em reais não existem na tela) com o subtítulo "Investimento e custo por lead: só administrador e gestor.". Como fica:
  - uma por campanha da Meta com lead no período, com o nome mais recente que a Meta informou ("Campanha {id}" quando não há nome; desde 04/10/2026, o nome vindo da consulta do anúncio pelo id, sem gasto lido, só vale quando nenhum anúncio da campanha teve entrega lida); para a gestão, também a campanha da Meta que teve investimento e nenhum lead;
  - a campanha da clínica fora da Meta (nome digitado ou importado) conta leads e mostra "Fora da Meta" nas duas colunas em reais;
  - "Sem leads" no custo da campanha sem lead e "Não medido" quando o período não foi lido por inteiro (nunca R$ 0,00);
  - ordem: campanhas da Meta primeiro, depois maior investimento e mais leads;
  - embaixo, as linhas de conferência: "Investimento sem lead casado: R$ X em N campanhas" (só a gestão, com o período lido por inteiro), "Leads sem campanha: N de M" e, quando houver, "Leads de anúncio sem campanha reconhecida: K";
  - o subtítulo da gestão diz "Investimento atualizado em dd/MM às HH:mm." ou por que não há medida;
  - com a última leitura com problema e algo já lido, o aviso "A última leitura do investimento teve problema. Veja o motivo em Configurações, aba Anúncios da Meta.";
  - vazios: "Nenhum lead no período" e, com leads mas nenhum com campanha, "Nenhum lead com campanha no período" ("Os leads deste período chegaram sem campanha reconhecida. A contagem está logo abaixo."); erro: "Não foi possível carregar as campanhas." com "Tentar de novo".
- O cartão divide o investimento **total** da conta (inclui post impulsionado e anúncio apagado); a coluna Investimento soma o que a Meta devolve por campanha. As duas somas podem diferir.
- **Detalhe da origem por campanha** (Marketing) usa as mesmas linhas da tabela, mais "Sem campanha".
- **Lead de anúncio no detalhe por canal e na Origem dos leads** (decisão D3 do dono, 04/10/2026; construída e publicada em 04/10/2026): o lead de anúncio com origem gravada (spec 10.1) conta em **Tráfego pago**, sem mudança no SQL de Resultados, porque a origem passa a estar no contato. Os contatos que já tinham chegado com o clique do anúncio foram corrigidos uma vez, quando a mudança foi aplicada no banco. O lead de anúncio sem origem gravada (clique numa publicação, ou id de anúncio sem o id do clique) continua em "Sem atribuição". Em Campanhas, o lead de anúncio sai de "Leads de anúncio sem campanha reconhecida" quando a campanha do anúncio é lida da Meta, pela leitura do investimento ou pela consulta do anúncio pelo id (as duas dependem da conta de anúncios e do token de leitura da Tela 12).
- **Lead do Google pelo clique no site** (F1 do Google, spec 10.13; construída em 04/10/2026, publicação pendente): **Resultados não muda na F1.** O lead conta em **Tráfego pago** na Origem dos leads e no detalhe por canal, como qualquer lead com origem gravada, e em Campanhas entra em "Leads sem campanha" (não é lead de anúncio da Meta, então não entra no divisor do Custo por lead nem em "Leads de anúncio sem campanha reconhecida"). O Google em Campanhas e o custo por lead separado por plataforma chegam com a F2 (backlog, entrada "Origem e campanha do Google Ads"), pendente das decisões do dono.
- **Exportação:** o custo por lead sai com o mesmo texto do cartão. Para a gestão entram também "Investimento no período", a contagem do divisor ("Leads de anúncio"), "Investimento lido a partir de", "Investimento lido até", "Investimento atualizado em" e, com o aviso de fuso aceso, "Fuso do investimento". A seção Campanhas sai com as colunas e as linhas de conferência da tela; para os outros papéis, sem as colunas em reais e com a nota. O Exportar das abas Visão geral e Marketing espera as campanhas carregarem.
- O "Atualizar agora" do investimento fica só em Configurações; Resultados mostra quando o investimento foi atualizado.

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

**Abas construídas em 02/10/2026** (a tarefa 5.3 do backlog segue aberta para as que faltam, como Marca, Limite de gastos, Privacidade e LGPD e Assinatura), cada uma na URL (`?aba=`), nesta ordem: Equipe e permissões · Clínica · WhatsApp · Jornada e conversões · **Automações de fluxo** (`fluxo`, nova) · Etiquetas de conversa · **Mensagens padrão** (`mensagens`, nova) · Anúncios da Meta. As duas novas têm contador e o próprio estado de erro (a falha de uma não derruba a tela). **Desde 04/10/2026** (F1 do Google, publicação pendente) há uma nona aba, **Anúncios do Google** (`google`), logo depois de Anúncios da Meta; o esqueleto do carregamento desenha as 9 abas.

**Jornada e conversões, o que mudou em 02/10/2026:** no formulário da etapa,
- **"Quem escreve o termo"** (lista com Paciente, Clínica e Qualquer um; padrão Paciente), dentro do bloco de termos-chave, com a ajuda "Paciente: a mensagem que chega dele. Clínica: o que a equipe envia pelo sistema ou pelo celular conectado. Qualquer um: os dois lados." A explicação dos termos muda conforme a escolha (por exemplo, "Quando a clínica escrever um destes termos para o paciente, pelo sistema ou pelo celular conectado, o contato anda sozinho para esta etapa (só para frente na jornada, nunca para a etapa de perda)."). Na linha recolhida, "3 termos escritos pela clínica".
- **"Descrição (aparece no Kanban)"**: texto opcional de até 140 caracteres, com contador "n/140", o exemplo "Por exemplo: pediu o valor e ainda não marcou a consulta" e a ajuda de que aparece abaixo do nome da coluna, em até duas linhas. Espaços e quebras de linha repetidos viram um espaço, e em branco é "sem descrição". Passou de 140: "A descrição da etapa cabe em até 140 caracteres.". Na linha recolhida, "No Kanban: {texto}".
- Excluir etapa com régua de follow-up passa a dizer "Esta etapa tem uma régua de follow-up. Exclua a régua em Automações antes de excluir a etapa."; etapa usada por automação de fluxo (como origem ou destino) é recusada pelo banco, e a tela mostra "Esta etapa é usada por uma automação de fluxo. Exclua a automação ou troque a etapa dela na aba Automações de fluxo antes de excluir a etapa." (o mesmo vale em Etiquetas de conversa: "Esta etiqueta é usada por uma automação de fluxo. Exclua a automação ou troque a etiqueta dela na aba Automações de fluxo antes de excluir a etiqueta.").

**Automações de fluxo (aba nova, logo depois de Jornada e conversões; spec Módulo 14):**
- Cartão **"Automações de fluxo da clínica"** com "Nova automação". Uma linha por regra: nome; situação **Ligada** ou **Desligada** em 3 camadas; "Quando:" e "Faz:" em português ("Ficou 48 h sem responder em Aguardando resposta", "Move para Perdido (Não respondeu)", "Etiqueta: Retorno", "Cria atividade: Ligar para o paciente, em 2 dias", "Nota interna"); quantas vezes rodou e a última vez, no fuso da clínica (busca depois de abrir a aba, com esqueleto). Na linha, o interruptor "Ligar {nome}" ou "Desligar {nome}", "Editar" e "Excluir". Vazio: "Nenhuma automação de fluxo ainda", com o exemplo "quem ficou 3 dias sem responder em Aguardando resposta vai para Perdido, ou quem entrou em Em contato ganha uma atividade de ligar.".
- **Ligar pede confirmação** ("Ligar {nome}?") com a prévia: "N leads já passaram do tempo e não serão afetados" nos gatilhos de tempo, "N leads já estão em {etapa} e não serão afetados: a automação vale para quem entrar daqui em diante" na entrada, "A automação vale a partir da próxima mensagem de cada lead" na mensagem, mais os importados que ficam de fora. Se ligar fecharia um ciclo com outra regra ligada, o botão fica desabilitado e o aviso mostra o caminho das etapas. **Desligar é direto.**
- **Criar e editar** num diálogo ("Nova automação de fluxo" ou "Editar {nome}", com "Quando o lead está numa etapa e algo acontece, a automação faz uma coisa por ele. Roda sozinha, em até 1 minuto."): nome; etapa; gatilho, cada um com a sua ajuda (em "Ficou um tempo sem responder na etapa", "O tempo conta da entrada na etapa ou da última mensagem do lead, o que for mais recente. Mensagem da clínica não zera o tempo."; em "Mandou mensagem estando na etapa", "As mensagens dos primeiros 2 minutos de um contato novo não contam: são a primeira fala dele, que costuma vir em várias mensagens. Se a mensagem tiver um termo da jornada, o termo vence."); o tempo em horas ou dias (de 1 hora a 90 dias), só nos gatilhos de tempo; a ação, com os campos dela: **etapa de destino** (sem Agendou, Compareceu e a própria etapa; para a etapa de perda, "Motivo da perda: Não respondeu (fixo). Quem tem consulta marcada fica onde está."; quando o destino envia conversão para a Meta, o aviso "{etapa} registra conversão para os anúncios da Meta: cada lead movido pela automação conta como conversão."), **etiqueta** do catálogo (com link para a aba Etiquetas quando o catálogo está vazio), **título e prazo da atividade**, ou **texto da nota interna** com contador; e a caixa de marcar "Ligada" (nasce desligada), com a descrição "Desmarcada, a automação fica guardada e não roda." (caixa de marcar, e não interruptor, porque só vale depois do Salvar; o interruptor da linha da lista liga e desliga na hora). A prévia aparece sempre que a regra passa a valer de novo (regra nova, ao ligar ou ao mudar gatilho, etapa ou tempo), e o ciclo bloqueia o Salvar de uma regra ligada, mostrando o caminho.
- Cartão **"Como as automações de fluxo funcionam"**: "Rodam sozinhas, em até 1 minuto depois do que aconteceu, e cada uma roda uma vez por entrada do lead na etapa.", com os avisos fixos (só leads; Agendou e Compareceu não são destino; mover para fora de uma etapa encerra o follow-up dela; cadeia até o 3º salto e no máximo 10 movimentos por lead em 24 horas; não é retroativa) e o aviso "A mensagem para o paciente ao entrar na etapa fica em Automações > Follow-up, com horário de envio e autorização para receber mensagens." com o botão **"Abrir o follow-up"**.
- Cartão **"Histórico"**: as últimas 50 execuções, com filtro "Todas as automações" ou uma só e o botão "Atualizar o histórico". Cada linha: situação em 3 camadas (Aguardando, Feita, Pulada, Falhou), o nome do lead, o nome da regra, o que fez naquela execução ("Moveu de {etapa} para {etapa}", "Etiquetou a conversa com {etiqueta} (em {etapa})" com o nome que a etiqueta tinha na hora, "Criou uma atividade (em {etapa})", "Deixou uma nota interna na conversa (em {etapa})"; editar a ação ou a etiqueta da regra depois não reescreve o que já aconteceu) ou o motivo da pulada em português ("Não fez nada: o lead já tinha mudado de etapa") ou o código do erro, e quando foi, no fuso da clínica. Carregando, erro com "Tentar de novo" e vazio ("Nenhuma execução ainda"). Nunca mostra conteúdo de mensagem; a leitura vai para a trilha de auditoria.
- **Excluir** pede confirmação ("Excluir {nome}?", "A automação para de rodar na hora.") e diz o que acontece: o histórico dela é apagado junto; as atividades e as notas que ela criou continuam; os leads que ela moveu ficam onde estão.

**Mensagens padrão (aba nova, logo depois de Etiquetas de conversa; spec 1.11):**
- Cartão **"Mensagens padrão da clínica"** com "Nova mensagem". Uma linha por mensagem: título, "/atalho", situação **Ativa** ou **Desativada** em 3 camadas, o começo do texto, "Editar" e as setas "Subir" e "Descer" (a ordem é a da lista do compositor). Vazio: "Nenhuma mensagem padrão ainda", com "Textos prontos, como o endereço da clínica ou a confirmação de um horário. No Atendimento, digite / na resposta ao paciente para usar um.".
- **Editor na própria linha**: "Título" (2 a 60, sem repetir na clínica); "Atalho" (acompanha o título até ser editado; letras minúsculas, números e sublinhado, até 30, sem repetir na clínica); "Texto" com contador "n/4096"; os campos `{{nome}}` e `{{clinica}}` para tocar e inserir, com o aviso de campo desconhecido ("O campo ... sai em branco"); o aviso informativo "Texto da clínica para o paciente." (não prometer resultado nem orientar sobre sintoma, remédio ou diagnóstico, regra do CFM para toda mensagem da clínica); a caixa de marcar "Ativa: aparece na lista do Atendimento", com a descrição "Desmarcada, sai da lista e continua guardada aqui." (caixa de marcar, e não interruptor, porque só vale depois do Salvar); Salvar, Cancelar e Excluir (com confirmação). Ao lado, **"Como o paciente vê"** no balão do WhatsApp, com um nome fictício, e a versão para contato sem nome.
- Atalho ou título repetido, e as outras recusas do banco, viram mensagem em português. Sem permissão, tudo visível e desabilitado com a dica.

**Anúncios da Meta, leitura do investimento (Fase 4 das métricas, construída e publicada em 03/10/2026; spec 10.12 e 11.14):**
- Texto da aba: "A conta de anúncios da clínica serve a duas coisas: ler quanto foi investido, para o custo por lead em Resultados, e devolver as conversões para a Meta medir o anúncio quando um contato chega numa etapa com evento configurado na Jornada."
- Cartão **"Conta de anúncios"**: o campo da conta ganha a ajuda "Só os números, com ou sem act_ na frente. Também vale colar o link do Gerenciador de Anúncios."; o que é salvo vira `act_` seguido dos números, e o campo passa a mostrar o valor gravado. Conta que não se reconhece: "Confira a conta de anúncios: são só números, com ou sem act_ na frente.".
- Cartão novo **"Investimento nos anúncios"**, na coluna da direita, acima de "Token da API de conversões". Usa a conta do cartão ao lado, sem repetir o campo.
  - **Situação** em 3 camadas: "Leitura não configurada" (falta conta ou token), "Ainda não testada", "Lendo o investimento", "Leitura com problema" e "Atualizando".
  - Campo **"Token de leitura de anúncios"** só de escrita, sem olho e sempre vazio, com o chip "Token salvo" ou "Sem token". Ajuda: pode ser o mesmo token da API de conversões, se ele tiver a permissão ads_read e acesso à conta; o recomendado é um token de usuário do sistema, só com ads_read e sem validade, gerado no Gerenciador de Negócios (é preciso um aplicativo da Meta no Gerenciador); por segurança, o token salvo nunca é mostrado.
  - **"Salvar token"** salva e testa em seguida (salva mesmo se o teste falhar; sem conta salva, guarda o token e diz "O token foi salvo. Salve a conta de anúncios para testar a leitura."). **"Testar leitura"** confere o token e a conta na hora. Desde 04/10/2026 (publicado), o teste que dá certo também pede, em segundo plano, a campanha e o conjunto dos anúncios de onde os leads vieram (spec 10.1 e 11.14); o resultado na tela não muda. **"Remover token"** pede confirmação na própria linha ("Remover o token de leitura? A leitura diária para, e o investimento já lido continua guardado."). No rodapé, **"Atualizar agora"**. Durante a ação: "Salvando...", "Testando...", "Pedindo..." e "Removendo...".
  - Teste que deu certo: "Leitura funcionando: conta {nome} ({act_...}), em {moeda}.", mais "Há investimento nos últimos 30 dias." ou "Nenhum investimento nos últimos 30 dias." e "A leitura do investimento começou e termina em alguns minutos.". Teste que falhou: o motivo em linguagem de recepcionista (token recusado, sem a permissão ads_read, conta não encontrada para o token, aplicativo que exige assinatura extra, Meta fora do ar, entre outros), nunca a mensagem da Meta.
  - Com problema gravado: "A leitura diária está parada." (a Meta recusou o token, a permissão ou a conta) ou "A última leitura teve problema.", com o motivo.
  - Com a leitura funcionando: "Conta lida: {nome} · {moeda}" e os avisos de conta em outra moeda (o Conduzza não converte), conta inativa e fuso com outro horário que o da clínica.
  - Rodapé "Atualizado em dd/MM às HH:mm" (fuso da clínica), ou "Ainda sem leitura do investimento.".
  - **"Atualizar agora"**: um pedido a cada 10 minutos ("O investimento foi atualizado há {n} minutos. Tente de novo daqui a pouco.", no singular "há 1 minuto"). Enquanto atualiza, o chip "Atualizando" gira e a tela se recarrega sozinha por até 2 minutos.
  - Botão sem condição fica visível e desabilitado, com a dica: "Salve a conta de anúncios e o token de leitura antes de testar." (Testar e Atualizar); "Cole o token de leitura para salvar." ou "O token parece incompleto. Cole o valor inteiro, sem espaços." (Salvar); "Não há token de leitura salvo." (Remover); leitura parada ou atualização já pedida (Atualizar); e a dica de permissão para quem não é administrador nem gestor.
  - O resultado de cada ação é anunciado ao leitor de tela por uma região sempre montada.
- **Sem selo "Conectada":** a situação vem do teste e da última leitura.
- A leitura roda sozinha todo dia de manhã (a partir das 06:00 no fuso da clínica), depois que o teste deu certo uma vez. Se a Meta recusa o token, a permissão ou a conta, ela para até o teste dar certo, um token novo ser salvo ou a conta mudar.
- Salvar e remover o token, testar a leitura e pedir atualização vão para a trilha de auditoria, sem o valor do token.

**Anúncios do Google, rastreio do site (F1 do Google, construída em 04/10/2026, publicação pendente; spec 10.13 e 11.15):**
- Texto da aba: "Quando o anúncio do Google leva ao site da clínica, o rastreio do site marca o clique no botão do WhatsApp, e o lead chega com a origem e a campanha do Google, sem cadastro manual. O investimento em cada campanha chega com a conexão com o Google, em breve." Se a leitura do rastreio falhar, a aba mostra só o erro dela, "Não foi possível carregar o rastreio do site", sem derrubar a tela.
- Cartão **"Rastreio do site"** (coluna larga), com a descrição "Quando o anúncio do Google leva ao site da clínica, a linha abaixo marca o clique no botão do WhatsApp. O lead chega com a origem Tráfego pago, Google e o número da campanha, sem cadastro manual."
  - **Situação** em 3 camadas, no canto do cartão: "Desligado" (neutro), "Esperando o primeiro clique" (atenção: ligado e nenhum clique com a chave atual), "Recebendo cliques" (sucesso: clique da chave atual nos últimos 7 dias) e "Sem cliques nos últimos 7 dias" (atenção, com o aviso "Nenhum clique chegou nos últimos 7 dias. Confira se a linha continua no site e se os anúncios do Google estão no ar.").
  - **Interruptor** com o rótulo "Rastrear os cliques do site" (desligado) ou "Rastreando os cliques do site" (ligado), "Salvando..." durante a gravação e o aviso "Rastreio do site ligado." ou "Rastreio do site desligado.". O primeiro ligar cria a chave.
  - **"Linha para colar no site":** a linha pronta, `<script src="https://<endereço do sistema>/rastreio/v1.js" data-chave="<chave>" referrerpolicy="no-referrer" async></script>`, montada só com endereço https (http só na máquina local); "Copiar a linha" (vira "Linha copiada"); "Chave em uso desde dd/mm/aaaa" no fuso da clínica. Sem linha ainda: "Ligue o rastreio para gerar a linha do site.". Com linha e sem endereço do sistema: "A linha aparece quando o endereço público do sistema estiver configurado." e o aviso "O endereço público do sistema não está configurado, então a linha do site ainda não pode ser montada. Fale com o suporte.". Endereço de teste (máquina local ou túnel): "Este endereço é de teste. Não cole esta linha no site de uma clínica de verdade.". Desligado com linha: a linha continua visível, com "Com o rastreio desligado, nenhum clique é registrado, mas a linha que está no site continua acrescentando o código à mensagem de quem vem de anúncio do Google. Para parar de vez, tire a linha do site.". Chave trocada depois do último clique: "Nenhum clique chegou com a chave atual. Se o site ainda tem a linha anterior, troque pela linha acima.".
  - **"Gerar nova chave"** pede confirmação na própria linha: "Gerar uma chave nova? A linha que está no site para de valer na hora e precisa ser trocada pela nova. Os cliques já recebidos continuam valendo.", com "Gerar a chave nova" (destrutivo) e "Cancelar"; durante a ação, "Gerando...". Depois: "Chave nova gerada. Troque a linha no site: a anterior parou de valer.". O foco segue o padrão do "Remover token" da Meta.
  - **"Situação"**, só totais: "Último clique recebido" (dd/MM/aaaa às HH:mm no fuso da clínica, ou "Nenhum clique recebido ainda"), "Cliques nos últimos 7 dias" e "Chegaram ao WhatsApp nos últimos 7 dias" (os cliques cujo código chegou numa mensagem), com a nota "Só totais. Quem clicou aparece no lead, quando a pessoa envia a mensagem com o código.". Se os totais não carregarem: "Não foi possível carregar a situação do rastreio. Recarregue a página." (nunca zero). A tela nunca mostra o gclid, o código nem quem clicou.
  - **"Como instalar no site"**, seis passos: ligar e copiar a linha; colar antes do fim da página (antes de `</body>`) em todas as páginas, ou numa tag de HTML personalizado do Gerenciador de Tags do Google disparada em todas as páginas; o botão do WhatsApp precisa ser um link wa.me seguido só dos números do telefone, sem o sinal de mais, ou um link api.whatsapp.com/send (o link curto do WhatsApp Business, os encurtadores e o botão que abre o WhatsApp de outro jeito não recebem o código); no Google Ads, a marcação automática ligada e o sufixo `cz_campanha={campaignid}&cz_grupo={adgroupid}` no "Sufixo de URL final" da conta (e da campanha que tem sufixo próprio), com "Copiar o sufixo" (vira "Sufixo copiado"); não mudar o endereço do anúncio, que continua sendo o site, e nunca pôr o endereço do Conduzza no anúncio; conferir abrindo o site com `?gclid=teste` e tocando no botão, sem enviar a mensagem de teste (o número de quem testa ficaria com a origem do Google para sempre). Embaixo: "Se a pessoa apagar o código antes de enviar, o lead chega sem origem, e a recepção pode preencher depois. O rastreio nunca grava uma origem errada.". Os nomes dos menus do Google Ads em português ainda precisam ser conferidos numa conta real.
  - Copiar que falha: "Não foi possível copiar. Selecione a linha e copie à mão." (ou "o sufixo"). Servidor que não responde: "O servidor não respondeu. Confira a conexão e tente de novo.". O resultado de cada ação é anunciado por uma região sempre montada.
  - Sem condição ou sem permissão, os controles ficam visíveis e desabilitados, com a dica: a dica de Configurações (interruptor e "Gerar nova chave" para quem não é administrador nem gestor); "Ligue o rastreio para gerar a linha do site." (Copiar sem linha); o aviso do endereço (Copiar sem endereço); "A chave nasce quando o rastreio é ligado pela primeira vez." (Gerar nova chave sem linha).
- Cartão **"Conectar com o Google (em breve)"** (coluna estreita): "Com a conta do Google Ads conectada, o Conduzza vai mostrar o nome de cada campanha e quanto foi investido nela, para o custo por lead do Google em Resultados." e "Enquanto isso, a origem e o número da campanha já chegam pelo rastreio do site.", com o botão "Conectar com o Google" sempre desabilitado e a dica "Em breve. A conexão com o Google Ads ainda está sendo preparada pela Conduzza." (F2 do backlog).
- Ligar, desligar e gerar chave nova vão para a trilha de auditoria, sem a chave.

**Agente de IA (aba nova, Fase 3; decisão do dono em 05/10/2026; construída em 06/10/2026, publicação pendente):** a liberação controlada do assistente de IA, que antes só a equipe Conduzza fazia pelo banco.
- **Só existe na teste123 e na Conduzza Teste.** Em qualquer outra clínica a aba **não aparece** (exceção pedida pelo dono à regra "visível e desabilitado"): a página decide no servidor, nada da aba é lido nem enviado ao navegador, e `?aba=ia` cai em Equipe e permissões como aba desconhecida. Entra no fim da fileira, depois de Anúncios do Google; o esqueleto de carregamento continua com as 9 abas fixas.
- **Quem altera:** o administrador da clínica e o super admin. O gestor vê tudo desabilitado, com a dica "Somente o administrador da clínica altera o assistente de IA." (recepção, profissional e leitura não chegam a Configurações e o banco também não deixa esses papéis lerem a liberação). O banco recusa do mesmo jeito.
- Texto da aba: "Fase de teste controlado: o assistente de IA conversa só com os telefones da equipe cadastrados aqui, por um número da clínica. Os pacientes continuam sendo atendidos pela equipe, como hoje." Leitura que falha: só o erro da aba, "Não foi possível carregar o assistente de IA".
- Cartão **"Assistente de IA nesta clínica"**, com a situação em 3 camadas no canto: **Desligado** (neutro, `circle-pause`), **Só simulador** (informativo, `flask-conical`), **Conversando com a equipe** (sucesso, `circle-check`) e **Ligado, mas parado** (atenção, `hourglass`), este com o aviso "Por que o assistente ainda não responde" e os motivos em texto: "A equipe Conduzza ainda não ativou o assistente para esta clínica."; o interruptor geral está desligado; a clínica pausou o assistente; nenhum número escolhido; o número do assistente está desconectado; nenhum telefone da equipe ligado. Seletor segmentado **Desligado · Só simulador · Conversar com a equipe**. Ligar pede confirmação ("Ligar o assistente só no simulador?" ou "Ligar o assistente para conversar com a equipe?", com o número e quantos telefones e, enquanto alguma trava da equipe Conduzza ainda diz não, o aviso "Ele ainda não começa a responder" com as mesmas frases dos motivos: "A equipe Conduzza ainda não ativou o assistente para esta clínica." e o interruptor geral desligado); desligar é na hora. "Conversar com a equipe" fica desabilitado, com "Escolha o número e ligue ao menos um telefone da equipe antes." ao lado, até haver número escolhido e telefone ligado.
- Cartão **"Número do assistente"**: os números ativos da clínica, cada um com o telefone, a situação da conexão e, no escolhido, "Em uso pelo assistente". Um número por vez, garantido pelo banco: "Usar este número" troca o número (o anterior é desligado na mesma operação; se der erro, nada muda); "Parar de usar" tira. Número que não está conectado fica com "Usar este número" desabilitado e a dica "Conecte este número em WhatsApp antes."; o escolhido que cai mostra "Este número está desconectado. Conecte o número na aba WhatsApp para o assistente responder.". Sem números: vazio "Nenhum número de WhatsApp na clínica" com "Ir para WhatsApp".
- Cartão **"Telefones da equipe"**: o aviso "Só estes telefones conversam com o assistente. Os pacientes continuam com a equipe, como hoje."; o formulário "De quem é" (até 80) e "Telefone" ("(84) 99999-0000"; sem o código do país vale o 55 do Brasil; de outro país, com + e o código), com "Adicionar"; telefone que não serve: "Telefone inválido. Informe com DDD, por exemplo (84) 99999-0000. Número de outro país começa com + e o código do país."; telefone que já é de um contato da clínica (lead ou paciente, pelo número com e sem o nono dígito) não entra direto: aparece "Este telefone já é de um contato da clínica (Nome). Só confirme se for de alguém da equipe." (sem nome: "cadastro sem nome") e a caixa "Confirmo que este telefone é de alguém da equipe", e só grava com ela marcada (trocar o telefone desmarca; mostrar o nome vai para a trilha de auditoria como leitura do cadastro); a lista (ligados primeiro) com o nome, o telefone como a recepção disca e a situação **Conversa com o assistente** ou **Desligado**, e "Desligar" ou "Ligar de novo" (não há apagar nesta fase). Vazio: "Nenhum telefone da equipe ainda".
- Cartão **"Interruptor geral"** (todas as clínicas de uma vez), com a situação Ligado ou Desligado: para o super admin, "Ligar o interruptor geral" (com confirmação) ou "Desligar o interruptor geral" (na hora); para os demais, só o estado e "A equipe Conduzza liga e desliga.". Desligado, as conversas do assistente voltam para a equipe sem mensagem ao paciente.
- Cartão **"Teto de gasto"**, só leitura: "US$ 5,00 a cada 24 horas" (o valor gravado), ou, antes de ligar pela primeira vez, "O teto nasce quando o assistente é ligado pela primeira vez nesta clínica."; e "Ao chegar no teto, o assistente para de responder até o gasto mais antigo completar 24 horas. Só a equipe Conduzza muda o teto nesta fase."
- Uma ação por vez; o resultado é anunciado por um aviso flutuante (no sucesso e no erro) e, no erro, também por uma região sempre montada; botões de 40px; claro e escuro pelos tokens. Cada mudança vai para a trilha de auditoria pelo banco, sem telefone. Nos textos da aba, nada de "janela de 24 horas" (conceito do canal oficial) nem "no servidor".

**Mensagens agendadas em Equipe e WhatsApp (06/10/2026; construída, publicação pendente; Tela 1, "Mensagem agendada"):**
- **Equipe e permissões, "Tirar acesso":** o diálogo confere quantas mensagens agendadas a pessoa **assina** (quem editou por último, senão quem agendou) e ainda não saíram. Com alguma, diz "Esta pessoa assina {n} mensagens agendadas." (no singular, "Esta pessoa assina 1 mensagem agendada.") e oferece a caixa "Cancelar essas {n} mensagens agendadas" ("Cancelar essa mensagem agendada"), **desmarcada**, com a ajuda "Sem cancelar, elas saem em nome dela e a conversa fica Sem atendente." ("Sem cancelar, ela sai em nome dela e a conversa fica Sem atendente."). Enquanto confere, "Conferindo as mensagens agendadas desta pessoa." e o "Tirar acesso" desabilitado; se não conseguir conferir, o aviso "Não foi possível conferir se esta pessoa assina mensagens agendadas. Se assinar, elas saem em nome dela e a conversa fica Sem atendente." (e o acesso pode ser tirado assim mesmo). O botão de sair do diálogo passa a ser "Voltar" (dois "Cancelar" lado a lado confundiriam).
- **Equipe e permissões, trocar o papel para Somente leitura:** com nenhuma agendada, troca direto, como os outros papéis. Com alguma (ou sem conseguir conferir), abre o diálogo "Trocar {nome} para Somente leitura?", com a descrição do papel, a mesma contagem e a mesma caixa, e os botões "Voltar" e "Trocar para Somente leitura" ("Trocando...").
- Primeiro tira o acesso ou troca o papel; só depois, se a caixa estiver marcada, cancela as mensagens (o acesso volta com um clique; o cancelamento não volta). Avisos: "{n} mensagens agendadas canceladas" ("1 mensagem agendada cancelada"), ou "Não foi possível cancelar as mensagens agendadas desta pessoa. Tente de novo." (aí as mensagens seguem marcadas e saem em nome dela).
- **WhatsApp, remover número:** o diálogo de remover acrescenta, quando há agendadas que ainda iam sair por ele, "{n} mensagens agendadas deste número não vão sair." ("1 mensagem agendada deste número não vai sair."). Lendo ou com erro, o diálogo fica como antes, sem a frase. Ao remover, cada uma vira Não enviada, com a atividade para quem assina.

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

### TELA 15. ATIVIDADES (escopo acrescentado em 02/10/2026)

Fora das 14 telas originais (spec Módulo 15). Item "Atividades" no menu, logo depois de Leads. Mesma permissão de Leads e Pacientes (Seção 5).

**Cabeçalho:** título "Atividades" e a frase com as pendências reais ("Nada seu atrasado nem para hoje." em Minhas, "Nada atrasado nem para hoje." em Todas, ou as contagens), e **"Nova atividade"** (primário), com busca de paciente própria dentro do diálogo.

**Filtros, todos na URL** (digitar na busca não recarrega a página):
- **De quem:** controle segmentado Minhas (padrão) e Todas. Minhas mostra as atividades em que a pessoa é a responsável; atividade sem responsável só aparece em Todas.
- **Situação:** Todas as pendentes (padrão), Atrasadas, Para hoje, Próximas, Concluídas (30 dias).
- **Responsável** (só em Todas): todos, cada membro, ou "Sem responsável".
- **Busca:** "Paciente, telefone ou atividade" (sem diferenciar acento; pedaço do telefone vale).
- **Chip "Só de {contato}"**, quando a tela foi aberta pelo "Ver todas" do drawer, da conversa ou da ficha, com o X "Ver de todos os contatos".
- Links prontos: `/atividades?filtro=atrasadas` e `?filtro=hoje` (Início) e `?quem=todas&contato={id}` (Ver todas).

**Lista** em cartões por prazo: **Atrasadas**, **Hoje**, **Amanhã**, **Próximos 7 dias**, **Depois** e **Concluídas**. Cada linha: o botão de concluir de 40px ("Concluir: {o que fazer}"), o que fazer, os detalhes, o nome do paciente (link para a ficha), o prazo como a recepção fala ("Hoje, 14:00", "Amanhã", "Ontem", "01/12", com o ano quando muda), o chip de situação e o responsável ("Você", o nome, "Sem responsável", ou o nome com "(sem acesso)" quando a pessoa saiu da equipe). Atividade de automação diz "Criada por automação". Menu da linha: Editar, Adiar (para amanhã, daqui a 7 dias, daqui a 30 dias, mantendo a hora), Abrir conversa, Abrir ficha e Cancelar atividade; na concluída ou cancelada, Reabrir no lugar de Editar, Adiar e Cancelar. Todos os itens do menu são neutros, inclusive "Cancelar atividade" (ele usa o ícone da situação Cancelada, que é neutra, e cancelar não apaga nada).

**Situação em 3 camadas** (ícone, rótulo e cor): Pendente (`square`, neutro), Para hoje (`hourglass`, âmbar), Atrasada (`clock-alert`, alerta), Concluída (`circle-check`, sucesso) e Cancelada (`square-x`, neutro). Atrasada: com hora, a hora já passou; sem hora, o dia já passou. Para hoje: o dia é hoje e ainda não atrasou. O "hoje" é sempre o da clínica. Com hora, o dia acompanha o instante: se a clínica troca de fuso em Configurações > Clínica, a atividade passa a aparecer no dia e na hora do fuso novo; sem hora, o dia escolhido não muda.

**Concluir** muda a tela na hora e mostra o aviso "Atividade concluída" com **"Desfazer"**; cancelar também tem "Desfazer" ("Atividade cancelada"). Concluir de novo o que alguém já concluiu não dá erro.

**Diálogo "Nova atividade" / "Editar atividade"** (modal central de 520px, o mesmo da conversa, do drawer e da ficha): **"O que fazer"** (exemplo "Ex.: Ligar para lembrar do retorno"), **"Detalhes (opcional)"**, **"Para quando"** com os atalhos Amanhã, Em 7 dias e Em 30 dias mais a data, **"Hora (opcional)"** e **"Responsável"** (padrão você, os membros ativos, "Sem responsável"; o responsável que saiu aparece marcado "(sem acesso)"). Só a pendente se edita.

**Estados:** carregando com esqueleto; erro "Não foi possível carregar as atividades" ("Confira a conexão e tente de novo. Nada foi perdido.") com "Tentar de novo", nunca virando lista vazia; vazio inicial "Nenhuma atividade ainda" ("Crie pelo lead, pela conversa ou pela ficha do paciente, ou aqui mesmo. Ela aparece nesta lista com o prazo."); vazio por filtro com "Limpar filtros" e, em Minhas, "Ver as da equipe"; aviso quando a lista passa do limite carregado; aviso de "melhor no computador" no celular. Sem permissão (Profissional e Leitura): "Nova atividade", o concluir e os itens Editar, Adiar, Reabrir e Cancelar atividade do menu da linha visíveis e desabilitados, com a dica (no menu, escrita no próprio item); o menu abre, e Abrir conversa e Abrir ficha continuam liberados.

**Dado de paciente:** abrir a tela, o drawer, o painel da conversa e a ficha grava a leitura na trilha de auditoria; o texto nunca vai para log. Não há apagar: cancela-se.

---

### TELAS DE ENTRADA (login, cadastro, convite e nova senha)

Fora das 14 telas. Registrado em 02/10/2026, a pedido do dono, para o campo de senha.

- **Olho no campo de senha** no login, no cadastro (os dois caminhos: criar a clínica e pedir entrada pelo código), no convite por e-mail e na redefinição de senha: botão de ícone dentro do campo, à direita, que mostra e oculta o que foi digitado ("Mostrar senha" e "Ocultar senha"). Não envia o formulário (no login, Enter continua entrando), fica logo depois do campo na ordem do Tab, e a senha volta a ficar oculta quando o formulário é enviado. Ícone neutro, sem cor de status.
- **"Repita a senha"** no cadastro, no convite e na redefinição: segundo campo, logo abaixo do primeiro ("Senha" no cadastro, "Nova senha" no convite e na redefinição), com o próprio olho ("Mostrar a senha repetida"). Senhas diferentes param no navegador, antes de qualquer envio, com a mensagem "As senhas não são iguais. Digite a mesma senha nos dois campos." (ícone, texto e cor de erro), que aparece ao sair do campo ou ao tentar enviar e some quando as senhas ficam iguais. O servidor confere de novo, porque o navegador nunca é garantia. Segundo campo vazio: o navegador pede o preenchimento, e o servidor responde "Repita a senha para confirmar.". A dica "Pelo menos 8 caracteres." continua no primeiro campo.
- O login tem só o olho, porque a senha já existe. Os tokens da Meta, em Configurações (o da API de conversões e, desde 03/10/2026, o de leitura de anúncios), **não** têm olho: são segredo colado, e o valor salvo nunca volta para a tela.

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
