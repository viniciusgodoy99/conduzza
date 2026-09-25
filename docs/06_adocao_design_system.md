
# Especificação única de adoção do Conduzza Design System

Raiz do app: `/Users/viniciusrodrigues/Documents/github/conduzza`. Fonte visual: `Conduzza Design System/` (readme, `tokens/*`, `components/*`, `ui_kits/conduzza-chat/*`). Esta especificação consolida as 8 partes mapeadas (fundações, componentes, shell e Início, Atendimento, Leads e Pacientes, Agenda/Confirmações/Espera, Automações/Cadastros/Configurações, telas futuras e marca). Onde as partes discordavam, a decisão está registrada na seção 4.1 com o motivo. Nada aqui muda lógica, query, Server Action, texto de interface preso em e2e, role ou nome acessível, salvo onde está dito explicitamente.

Regra de leitura: o design system (DS) manda na APARÊNCIA. O brief `docs/02_brief_telas_claude_design.md` e o `CLAUDE.md` mandam em COMPORTAMENTO, CONTEÚDO e ACESSIBILIDADE. Toda divergência entre os dois está na lista de conflitos (C1 a C37), com um padrão provisório para o implementador seguir enquanto o dono não decide.

Todos os contrastes citados foram calculados com a fórmula WCAG 2.2, a mesma de `tests/unit/design/contrast.test.ts`.

---

## 1. Resumo em 5 linhas

1. A identidade passa do handoff (Inter Tight, IBM Plex Mono, lime #a8d318) para o DS: Manrope e JetBrains Mono, lime `#b2e54f` como preenchimento, rampa ink esverdeada, canvas papel quente `#f5f6ef`, cartões brancos de raio 16 com uma borda fina e uma sombra baixa, sidebar ink-900 de 248px e barra superior de 60px.
2. A troca é feita trocando VALORES em `app/globals.css` e mantendo os NOMES de token que o app já consome, mais um conjunto pequeno de tokens novos (`--primary-text`, `--primary-soft`, `--primary-edge`, `--focus`, `--surface-subtle`, `--inverse`, bolhas, gráfico); nada da pasta do DS é importado em runtime.
3. Onde o DS reprova AA ou regra do CLAUDE.md (texto muted ink-500, lime-700 como texto, bordas de campo a 12%, halo de foco, lime-400 como indicador, controles de 28 a 36px, ponto colorido como status, rosca, sombra lime, blur, travessões), o app desce um passo na mesma rampa ou mantém a regra, e o desvio fica documentado.
4. Os primitivos (`components/ui`) e compartilhados (`components/shared`) mudam primeiro; depois o shell; depois as telas em 9 lotes, cada tela tocada uma vez, sempre depois de a leva de lógica em andamento estar integrada.
5. Continuam intactos: os 10 status de consulta, as 3 camadas de status, a matriz de permissões com ação desabilitada e dica, os textos de interface, os papéis Radix e o comportamento das telas; o tema escuro passa a ser derivado das rampas do DS, porque o DS não tem um.

---

## 2. Conflitos para o dono decidir (resumo)

O detalhe de cada um (o que o DS diz, o que a regra diz, opções e recomendação) está no campo `conflitos`, na mesma ordem. A coluna "Enquanto isso" diz o que o implementador faz até a decisão.

| # | Tema | Recomendação | Enquanto isso | Bloqueia |
|---|---|---|---|---|
| C1 | Fonte da verdade visual e tipografia (CLAUDE.md §5 cita o handoff) | DS substitui o handoff em aparência; editar CLAUDE.md §5 e memória | Nada de código antes do OK explícito | Tudo |
| C2 | Tema escuro (DS não tem) | Derivar das rampas pela regra da seção 4.3 | Usar os valores da seção 4.3 | Etapa A |
| C3 | Contraste de texto (muted, faint, lime-700, opacidades) | Descer um passo na rampa | Seção 4.3 | Etapa A |
| C4 | Borda de controle 3:1 e barra de rolagem | `--input` = ink-500 | Seção 4.3 | Etapa A |
| C5 | Anel de foco | Contorno 2px `--focus` (lime-800) com offset 2px | Seção 4.5 | Etapa B |
| C6 | Indicadores em lime-400 (seleção, switch, checkbox, aba, barra) | `--primary-edge` (lime-700) no claro | Seção 4.3 | Etapa B |
| C7 | Alvo de toque 40px | 40px no padrão, visual menor com `hit-40` | Seção 4.5 | Etapa B |
| C8 | Status em 3 camadas contra ponto colorido | Ícone sempre, `dot` proibido | Regra da seção 4.6 | Etapa B |
| C9 | 5 status do DS contra 10 do brief; AppointmentCard | Manter os 10 | Manter os 10 | Nenhum |
| C10 | Traço de ícone 1,5 contra 2px | 2px, com codemod isolado | Manter 1,5 | Codemod |
| C11 | Cor da IA (violeta) | Família lime suave | Lime suave (seção 4.3) | Etapa A |
| C12 | Rosca, coluna vertical, ProgressBar com tom de status | Não portar | Não portar | Nenhum |
| C13 | Sombra lime (`--shadow-accent`) | Não importar | Não importar | Nenhum |
| C14 | Blur no fundo do modal | Sem blur | Sem blur | Nenhum |
| C15 | Travessão e meia-risca no kit | Nunca copiar texto do kit | Nunca copiar | Nenhum |
| C16 | White-label contra lime e logo fixos | Derivar tokens da cor da clínica | Seção 4.8 | Etapa A |
| C17 | Um lime por tela | Meta de revisão, teto do brief (3) | Seção 4.6 | Telas |
| C18 | Mesmo ícone em cores diferentes | Tabela de ícones reservados | Seção 4.6 | Telas |
| C19 | Hachura do bloqueio ("no patterns") | Manter a hachura | Manter | Nenhum |
| C20 | Navegação lateral: rail, contador, grupos | Regra do brief (64px até 1599) e 4 grupos | Adotar a recomendação | Etapa C |
| C21 | Itens da barra superior | Sem busca falsa, sem Ajuda, sino sem contador | Adotar a recomendação, sem selo WhatsApp | Etapa C |
| C22 | Faixas globais (WhatsApp, motor) | Faixa danger suave | Faixa suave | Etapa C |
| C23 | Tooltip curto contra dica de permissão | Visual do DS, frase inteira | Adotar | Etapa B |
| C24 | Chaves travadas da Conformidade | Opacidade cheia com cadeado | Só na Tela 6 futura | Nenhum |
| C25 | Escopo que o kit sugere e o brief não tem | Não construir; vira backlog | Não construir | Nenhum |
| C26 | Início: saudação e blocos do kit | Só saudação, data e frase com números reais | Manter título "Início" | Lote D1 parcial |
| C27 | Confirmações: faixa do lembrete e filtro | Faixa factual e filtro local, com OK | Não fazer | Nenhum |
| C28 | Pacientes: KPIs do kit | Não fazer; se quiser, estáticos | Não fazer | Nenhum |
| C29 | Atendimento: diferenças do kit | Ver item | Manter o app | Nenhum |
| C30 | Sintaxe `{x}` contra `{{x}}` e ponto de vista da prévia | Manter `{{x}}`; prévia do paciente | Adotar | Nenhum |
| C31 | Switch contra Checkbox em formulário com Salvar | Checkbox onde há Salvar | Adotar | Nenhum |
| C32 | Eyebrow de 10px contra micro de 11px | 10px só no eyebrow | Adotar | Nenhum |
| C33 | Seletor de dimensão em Resultados | Segmentado com OK | Manter Select | Nenhum |
| C34 | Marca em fundo claro | Pedir o lockup em tinta | Nenhum logo em fundo claro | Nenhum |
| C35 | Pasta do DS e imagens do Behance no git | Versionar o DS sem o Behance | Ignorar o Behance já | Etapa 0 |
| C36 | Login em fundo ink | Tela dividida | Adotar | Nenhum |
| C37 | Voz do sistema e nomes | Manter os nomes do app | Manter | Nenhum |

---

## 3. Ordem de implementação

Pré-condição geral: a leva de lógica que está em andamento (git status mostra dezenas de arquivos de tela modificados) precisa estar integrada e publicada antes da Etapa A. A troca de tokens muda o visual de todas as telas de uma vez e faria os e2e da leva de lógica falharem por motivo alheio. Cada etapa é um commit (ou PR) próprio.

### Etapa 0. Decisões e higiene do repositório (sem mudança visual)
- Dono confirma C1 (e, se quiser, C10). Com o OK, editar `CLAUDE.md` §5 ("Fonte da verdade visual") para apontar `Conduzza Design System/` a partir de 24/09/2026, mantendo "onde divergem em regra, vale o brief"; §2 linha de ícones só se C10 for aprovado; atualizar a memória do projeto (hoje diz "brief docs/02 vence o handoff").
- `.gitignore`: acrescentar, ANTES de qualquer `git add`:
  ```
  # referencia de terceiros (Behance), nunca versionar
  /Conduzza Design System/uploads/Behance_3_Projetos_Imagens/
  ```
- `eslint.config.mjs`, bloco `ignores`: acrescentar `"Conduzza Design System/**"` ao lado de `"design_handoff_conduzza_atendimento_ia/**"` (o `_ds_bundle.js` e `templates/*/support.js` reprovam o lint hoje).
- `tsconfig.json`, `exclude`: acrescentar `"Conduzza Design System"` e `"design_handoff_conduzza_atendimento_ia"`.
- Critério de pronto: `npm run lint` e `npm run typecheck` limpos; `git status` não lista nenhuma imagem do Behance.

### Etapa A. Fundações (um commit só)
Arquivos: `app/globals.css`, `app/layout.tsx`, `lib/utils/index.ts`, `lib/branding/brand-style.ts`, `lib/auth/active-clinic.ts` (linhas 137 e 154), `lib/design/status.ts` (só comentários), `tests/unit/design/contrast.test.ts`, `app/dev/tokens/tokens-view.tsx`, e a correção de `text-primary`/`border-primary`/`accent-primary`/`var(--primary)` usados como texto ou marca de dado (lista na seção 4.9), porque a primária vira lime-400 e esses usos cairiam para 1,48:1.
Conteúdo: seções 4.2 a 4.4 e 4.8.
Critério de pronto:
- `contrast.test.ts` com os pares novos (seção 6.2) verde nos dois temas.
- `tests/e2e/tokens.spec.ts` (axe em /dev/tokens) verde nos dois temas.
- typecheck, lint e build limpos.
- Conferência manual de /inicio, /atendimento, /agenda nos dois temas em 1366x768: nada ilegível, nenhum texto em lime-400 sobre claro.
- `white-label.spec.ts` verde (cor custom `#7c3aed` continua aplicada; clínica com `#A8D318` salvo cai no padrão novo).

### Etapa B. Primitivos e compartilhados
Arquivos `components/ui/*`: button, input, textarea, select, checkbox, switch, label, form, dialog, sheet, popover, dropdown-menu, tooltip, tabs, table, card, badge, skeleton, sonner, accordion.
Arquivos `components/shared/*`: status-chip, chip-de-etiqueta, empty-state, page-header, data-table, loading-skeleton, permission-hint, aviso-celular, theme-toggle, module-placeholder; novos `segmented-control.tsx`, `aviso.tsx`, `barra-de-progresso.tsx`.
Compartilhado de domínio: `components/atendimento/contact-avatar.tsx` (usado em Atendimento, Agenda, Confirmações, Leads, shell).
`lib/design/status.ts`: acrescentar os mapas novos da seção 4.6 (sem mexer nos existentes).
Conteúdo: seções 4.5 a 4.7.
Critério de pronto: /dev/tokens mostra cada primitivo em todos os estados (padrão, hover, foco por teclado, desabilitado, erro, selecionado) nos dois temas; axe verde; e2e completos verdes nos 4 viewports (os primitivos mudam altura de 32 para 40px, então conferir que nenhum e2e depende de posição); `no-em-dash.test.ts` verde.

### Etapa C. Shell
Arquivos: `components/shell/app-shell.tsx` (dividido em `rail.tsx`, `barra-superior.tsx`, `use-rail.ts`), `nav-badge.tsx`, `whatsapp-status.tsx`, `motor-banner.tsx`, `criar-clinica.tsx`, `app/(app)/layout.tsx`, `app/(app)/error.tsx`, `lib/navigation.ts`, `public/brand/*`, `app/icon.png`, `app/favicon.ico`, `app/apple-icon.png`, `tests/e2e/layout.spec.ts`. Exceção documentada: a troca de altura em `app/(app)/atendimento/page.tsx`, `atendimento/loading.tsx`, `agenda/page.tsx` e `agenda/loading.tsx` (só a classe de altura) entra aqui, porque sem ela as duas telas ganham rolagem dupla.
Conteúdo: seção 5.1.
Critério de pronto: `layout.spec.ts` atualizado (248px em 1600; 64px em 1366 e 1024; gaveta em 768) e verde; e2e de navegação verdes em 1366 com o rail recolhido; faixa de WhatsApp e motor conferidas nos dois temas; impressão de Resultados ainda sai completa.

### Etapa D. Telas (cada lote toca suas telas uma vez)
| Lote | Telas | Por que juntas | Critério extra |
|---|---|---|---|
| D1 | Início e Resultados | compartilham `cartao-kpi.tsx` e `barra-horizontal.tsx` | CSV de Resultados conferido; visão do profissional |
| D2 | Atendimento | 3 colunas, bolhas, compositor | `atendimento.spec`, `takeover-realtime.spec`; 1366, 1280, 1024, 390 |
| D3 | Leads e Pacientes | DataTable, drawer, ficha | `leads.spec`, `pacientes.spec`, `importacao.spec` |
| D4 | Agenda | grade | `agenda-grade.spec`, `agenda-status.spec`; teste de duas marcações simultâneas continua verde |
| D5 | Confirmações e Automações | compartilham `controles-da-regua.tsx`, `painel-regua.tsx`, `balao-whatsapp.tsx` | `confirmacoes.spec` |
| D6 | Lista de espera | fila com arrasto | arrasto conferido na mão |
| D7 | Cadastros | 8 abas | `cadastros.spec`, `layout.spec` |
| D8 | Configurações e onboarding do WhatsApp | compartilham `connect-client.tsx` | `configuracoes.spec`, `auth-permissions.spec` |
| D9 | Autenticação e e-mail | fora do shell | login dos e2e (`helpers.ts`) verde; e-mail testado por um cadastro real |

Critério de pronto de todo lote: estados vazio, carregando e erro no visual novo; tema claro e escuro conferidos; nenhum lime-400 como texto; no máximo um preenchimento lime-400 no corpo da tela (fora o item ativo da sidebar); nenhum `--cz-*` direto em componente; nenhum hex solto; `no-em-dash.test.ts` verde; typecheck, lint e build limpos.

### Etapa E (só se C10 for aprovado). Traço de ícone 2px
Codemod num commit isolado, com os outros agentes parados: remover os cerca de 300 `strokeWidth={1.5}` (o padrão do lucide já é 2) e trocar o traço de `components/shared/icons/building-slash.tsx` para 2. O item ativo da sidebar passa a se diferenciar por cor, fundo, barra e peso, não por traço.

---

## 4. Contrato canônico (vale para todas as telas)

### 4.1 Decisões de consolidação (onde as partes discordaram)

| # | Assunto | Opções das partes | Decisão | Por quê |
|---|---|---|---|---|
| D1 | Nomes de token | cada parte criou nomes (`--text-accent`, `--accent-text`, `--accent-strong`, `--primary-text`; `--accent-soft`, `--selection-bg`, `--selected`; `--ring-strong`, `--focus-color`) | manter os nomes que o app já usa e acrescentar só: `--primary-text`, `--primary-soft`, `--primary-soft-hover`, `--primary-edge`, `--focus`, `--text-strong`, `--surface-subtle`, `--border-heavy`, `--inverse*`, `--overlay*`, `--bubble-*`, `--chart-bar*`, `--alert-bg-hover`, `--on-alert` (já existe) e os de sidebar | prefixo `primary-` deixa claro que o white-label deriva esses tokens da cor da clínica; `--accent` já é do shadcn (superfície de hover), então `accent-*` confundiria |
| D2 | Primária | automações propôs `--primary` = lime-700 e `--lime-fill` separado | `--primary` = lime-400 (preenchimento) | Button, badge, brand-style e 65 botões já usam `bg-primary`; trocar o sentido quebraria o white-label |
| D3 | Texto terciário | ink-550 interpolado (fundações) contra ink-600 (demais) | ink-600 no claro para secundário e terciário; no escuro ink-300 e ink-400 | no claro só passos da rampa do DS; interpolação só onde a rampa não tem passo (escuro). A hierarquia no claro vem de tamanho e peso. ink-550 fica como opção em C3 |
| D4 | Borda de campo | ink-450 `#7b8b83` (3,58) contra ink-500 (4,42) | ink-500 nos dois temas | passo real da rampa, hex opaco (o teste lê), passa 3:1 também sobre o afundado (3,77) |
| D5 | Cor do foco | lime-700 (componentes, Atendimento) contra lime-800 (fundações) | lime-800 no claro, lime-400 no escuro | o brief pede 3:1 também contra o elemento: lime-700 contra um botão lime-400 dá 2,94 e reprova; lime-800 dá 4,88 |
| D6 | Superfícies | cada parte usou `surface-3`/`surface-4`/`muted`/`sunken` com sentidos diferentes | tabela 4.3: `surface-3` = ink-050 (hover, muted), `surface-4` = paper-200 (afundado: trilho, esqueleto, faixa de gráfico, etiqueta compacta), `surface-subtle` = paper-050 (cabeçalho de tabela, rodapé de modal e folha, hover de linha) | preserva o sentido atual de `surface-3` e `bg-muted` (37 usos) e dá nome ao paper-050 |
| D7 | Texto do corpo | foreground ink-900 com `--text-body` novo, contra foreground ink-800 com `--text-strong` novo | `--foreground` = ink-800 (corpo), `--text-strong` = ink-900 (títulos, números, nomes) aplicado em h1 a h6 pela base | `text-foreground` é quase sempre corpo; um token novo só para o forte |
| D8 | Fundo do chip de IA | lime-050 contra lime-100 | lime-100 (`--ai-bg`) | distingue o chip de IA da linha selecionada (lime-050) e do botão soft |
| D9 | Barra de gráfico | tinta (shell) contra lime-700 (futuras) contra lime-800 (fundações) | `--chart-bar` = lime-700 no claro, lime-400 no escuro; neutra `--chart-bar-muted` = ink-500 | mantém a cor da marca no dado e passa 3:1 (4,35 no branco, 3,71 no trilho) |
| D10 | Avatar | paleta via tokens de status contra paleta fixa do DS | paleta fixa do DS (lime-400, lime-600, info-500, warning-500, success-500, ink-400) misturada 26% sobre paper-050, iniciais ink-900, disco claro nos dois temas | cor de status não pode ser decoração; o DS define a paleta; o hash atual fica |
| D11 | Abas | `line` padrão; Confirmações como `line` (componentes) ou segmentada (Agenda) | Tabs com 3 variantes: `line` (padrão, 5 ou mais vistas), `segmented` (2 a 4 vistas), `cartoes` (Automações) | é a regra escrita no `Tabs.prompt.md` do DS; Confirmações (2 vistas) usa `segmented`, sempre com `role=tab` |
| D12 | Altura das telas cheias | `calc(100dvh - var(--topbar-h))` contra `h-full` | raiz do shell `h-dvh overflow-hidden`, `main` rola, telas cheias usam `h-full` | resolve também o bug atual da faixa de WhatsApp que empurra o compositor para fora |
| D13 | Painel de contexto do Atendimento | `min-[1360px]` contra `xl` | container query: `@container/inbox` e `@min-[1100px]/inbox:` | a largura útil depende do rail (64 ou 248px); 1100 = 336 + 320 + 444 de fio |
| D14 | Fundo do fio | paper-050 (Atendimento) contra canvas | `bg-background` (canvas) | sem token novo; bolha branca do paciente contrasta com o canvas |
| D15 | Bolha da IA no escuro | ink-800 com borda contra ink-900 com borda lime | ink-900 com borda `rgba(178,229,79,.40)` no escuro | no escuro a bolha do paciente é ink-800; a da IA precisa de outra pele |
| D16 | Cartão herói lime (Início) | variação em pílula branca (shell) contra só sem variação (futuras) contra texto a 75% | pílula branca com cor semântica; rótulo e nota em `text-primary-foreground` cheio | mantém as 3 camadas da variação e AA sem opacidade |
| D17 | Toast | tokens próprios contra classe `.cz-dark` | classe `cz-dark` no toast e ícone na cor `-text` da família | um mecanismo só (o do DS) e nada de lime em sucesso, info e aviso ao mesmo tempo |
| D18 | Nomes das variantes de Button | DS: primary, secondary, soft, ghost, danger, solid | app mantém os nomes: `default` = primary, `outline` = secondary do DS, `secondary` = soft do DS, `ghost`, `destructive` = danger do DS, `solid` novo, `link` | não mexe em 258 usos; tabela de tradução em 4.10 |
| D19 | Raios | nomes novos variados (`tile`, `tag`, `panel`, `popover`, `chip`) | escala do Tailwind remapeada para os raios do DS (sm 6, md 8, lg 10, xl 12, 2xl 16, 3xl 20, 4xl 28) e 4 apelidos: `rounded-control` 10, `rounded-card` 16, `rounded-bubble` 18, `rounded-modal` 20 | todo `rounded-*` passa a cair num raio do DS |
| D20 | Eyebrow | 10px (DS) contra 11px (Agenda, futuras) | 10px só no eyebrow (caixa alta, negrito, 0,14em); nenhum outro texto abaixo de 11px, exceto contador numérico dentro de pílula (10px negrito) | C32 |
| D21 | Ícone do StatusChip pequeno | 11px (DS) contra 12px | sm 12px, md 13px | forma legível é a camada que discrimina o status |
| D22 | Itens de menu | 32px no mouse e 40 no toque contra 40 sempre | `min-h-10` sempre | regra de 40px sem depender de `pointer-coarse` |
| D23 | Botão Enviar do compositor | h-9 (Atendimento) | `h-10` | alvo de 40px |
| D24 | Cartão de indicador compartilhado | criar `components/shared/cartao-indicador.tsx` contra manter | restilizar `components/relatorios/cartao-kpi.tsx` no lugar; os outros cartões (Confirmações, Pacientes, métricas da régua) seguem a mesma receita (4.7) | não é layout mover componente com lógica de polaridade enquanto outros agentes editam |
| D25 | Uso de `--cz-*` em componente | Agenda e Atendimento usaram `var(--cz-lime-050)` etc. | proibido; usar os aliases | o white-label e o tema escuro não alcançam a rampa crua |
| D26 | Ícones de Banner | warning com `TriangleAlert` (futuras) contra `CircleAlert` | tabela 4.6: `TriangleAlert` só para Faltou | C18 |
| D27 | Nomes de utilitários | `transition-control`, `hit-40`, `num`, `eyebrow` | `cz-transition`, `hit-40`, `cz-num`, `cz-eyebrow`, `cz-scroll` | prefixo evita colisão com utilitários funcionais do Tailwind e com o `tailwind-merge` |
| D28 | Tamanhos de fonte como token | `text-h1`, `text-eyebrow` etc. no `@theme` | não criar tamanhos no `@theme`; usar valores explícitos da escala 4.4 | o `cn` usa `twMerge` puro e trataria `text-h1` como cor, apagando `text-text-strong` |

### 4.2 Estratégia de tokens em `app/globals.css`
- Não importar `Conduzza Design System/styles.css` nem `tokens/*.css` (o `fonts.css` usa Google Fonts por `@import`; o `base.css` zera margens e põe `svg{display:block}`, o que desalinha ícones em linha).
- Logo depois dos `@import`: `@source not "../Conduzza Design System";` e `@source not "../design_handoff_conduzza_atendimento_ia";`.
- Um único bloco `:root { }` com os primitivos `--cz-*` E os semânticos claros, e um único bloco escuro com o seletor exatamente `.cz-dark,\n.dark {` (o teste casa a primeira ocorrência de `\.dark\s*\{`). Depois dele: `.cz-dark { color: var(--foreground); color-scheme: dark; }` e `.dark { color-scheme: dark; }`.
- Valores testados só em hex de 6 dígitos ou `rgba()`; nada de `color-mix`, `oklch`, `#rgb`, `transparent` nem `var(--x, fallback)` em token que o teste lê. Nenhum `}` dentro dos blocos.
- `@custom-variant dark (&:is(.dark *, .cz-dark, .cz-dark *));`
- `--cz-lime-500` é `#a2d93c` (o `tokens/colors.css` declara duas vezes; vale a segunda). A marca é `--cz-lime-400` `#b2e54f`.
- Cabeçalho de comentário do arquivo: "Tokens do Conduzza Design System (24/09/2026). Desvios AA registrados: texto secundário e terciário ink-600, lime como texto lime-800, borda de campo ink-500, foco lime-800, indicador lime-700, sidebar muted ink-400. Escuro derivado das rampas (o DS só tem o escopo .cz-dark)."

### 4.3 Tabela de tokens (claro | escuro)

Primitivos no `:root`, copiados do DS sem ajuste: rampa `--cz-lime-050..900`, `--cz-ink-050..950`, `--cz-paper-050/100/200/300`, `--cz-cream-050`, `--cz-success/warning/danger/info-050/500/700`, `--cz-whatsapp`, `--cz-meta`, `--cz-instagram`. Acrescentar `--cz-danger-100: #fbe0da` (hover do botão danger, que no DS está como hex solto). Passos derivados só para o escuro: `--cz-ink-850: #142620` (ink-900 com 6% de cream) e `--cz-ink-750: #273831` (ink-900 com 14% de cream).

| Token | Claro | Escuro | Uso e contraste |
|---|---|---|---|
| `--background` | paper-100 `#f5f6ef` | ink-950 `#03100c` | canvas |
| `--foreground` | ink-800 `#1b2c25` | ink-100 `#e6eae5` (opaco) | corpo; 14,65 no branco; 15,06 no ink-900 |
| `--text-strong` (novo) | ink-900 `#051813` | cream-050 `#fbfce8` | títulos, números, nomes |
| `--surface-1`, `--surface-2`, `--card` | `#ffffff` | ink-900 | cartão |
| `--surface-subtle` (novo) | paper-050 `#fbfcf7` | ink-850 `#142620` | cabeçalho de tabela, rodapé de modal e folha, hover de linha, casca do compositor |
| `--surface-3`, `--muted`, `--accent` | ink-050 `#f3f5f1` | ink-850 | hover de ghost e item de menu |
| `--surface-4`, `--secondary` | paper-200 `#eceee3` | ink-800 `#1b2c25` | afundado: trilho de segmentado, esqueleto, trilho de barra, coluna do kanban, etiqueta compacta |
| `--surface-5` | ink-100 | ink-750 `#273831` | pressionado |
| `--surface-6` | ink-200 | ink-700 | |
| `--popover` | `#ffffff` | ink-800 | menus |
| `--text-secondary`, `--muted-foreground` | ink-600 `#4f5f57` (6,76 branco; 5,56 surface-5) | ink-300 `#b2bdb7` (6,40 surface-5) | apoio, descrição, metadado |
| `--text-tertiary` | ink-600 | ink-400 `#8b9a92` (5,37 surface-3) | hora, legenda; no escuro só até surface-3 |
| `--primary` | lime-400 `#b2e54f` | lime-400 | só preenchimento, nunca texto |
| `--primary-hover` | lime-500 `#a2d93c` | lime-500 | |
| `--primary-foreground` | ink-900 (12,40) | ink-900 | |
| `--primary-soft` (novo) | lime-050 `#f4fbe3` | `#1a311a` (lime 12% sobre ink-900, opaco) | selecionado, botão soft, ladrilho do vazio |
| `--primary-soft-hover` (novo) | lime-100 `#e8f7c6` | `#21391d` | |
| `--primary-text` (novo) | lime-800 `#42600f` (7,21 branco; 6,78 no soft) | lime-400 (9,49 no soft) | lime como texto, link, ícone de destaque |
| `--primary-edge` (novo) | lime-700 `#5d8515` (4,35 branco; 4,09 no soft) | lime-400 | indicador não textual: borda de seleção, borda de checkbox e switch ligados, sublinhado da aba, anel de soltura |
| `--focus` (novo) | lime-800 (7,21 branco; 4,88 contra lime-400) | lime-400 (12,40 no card; 9,91 no popover) | contorno de foco |
| `--ring` | lime-400 | lime-400 | só o halo decorativo dos campos (`ring-ring/55`) |
| `--chart-bar` (novo) | lime-700 (3,71 no trilho) | lime-400 (9,91 no trilho) | barra de dado |
| `--chart-bar-muted` (novo) | ink-500 `#6b7c73` | ink-500 | barra neutra ("Sem atribuição") |
| `--border` | `rgba(5, 24, 19, 0.08)` | `rgba(251, 252, 232, 0.08)` | fio fino de cartão e linha |
| `--border-strong` | `rgba(5, 24, 19, 0.12)` | `rgba(251, 252, 232, 0.14)` | o `border-subtle` do DS: botão outline, menu, tag, cabeçalho de tabela |
| `--border-heavy` (novo) | `rgba(5, 24, 19, 0.22)` | `rgba(251, 252, 232, 0.28)` | o `border-strong` do DS, só decorativo (tracejado, hachura) |
| `--input` | ink-500 (4,42 branco; 4,06 canvas; 3,77 surface-4) | ink-500 (4,15 card; 3,32 popover) | borda de campo, checkbox, switch, select, busca |
| `--scrollbar-thumb` (novo) | ink-500 | ink-500 | barra de rolagem |
| `--inverse` / `--inverse-foreground` / `--inverse-hover` (novos) | ink-900 / cream-050 / ink-800 | cream-050 / ink-900 / paper-200 | botão `solid`, tooltip, filtro ligado |
| `--overlay` (novo) | `rgba(5, 24, 19, 0.42)` | `rgba(3, 16, 12, 0.72)` | fundo de modal e folha, sem blur |
| `--overlay-media` (novo) | `rgba(3, 16, 12, 0.88)` | igual | visor de foto |
| `--on-alert` | `#ffffff` | ink-900 | |
| `--destructive` | `var(--alert-text)` | `var(--alert-text)` | 7,12 claro; 8,51 escuro |
| `--destructive-foreground` | `var(--on-alert)` | igual | |
| `--alert-bg-hover` (novo) | danger-100 `#fbe0da` | `#37271d` | hover do botão danger |
| `--qr-surface` (novo) | `#ffffff` | `#ffffff` | fundo do QR code |
| `--bubble-out` / `-foreground` / `-meta` (novos) | lime-100 / ink-900 (16,2) / ink-600 (5,97) | `#21391d` / cream-050 / `rgba(251, 252, 232, 0.66)` | bolha da atendente |
| `--bubble-ai` / `-foreground` / `-meta` (novos) | ink-900 / cream-050 (17,6) / `rgba(251, 252, 232, 0.66)` (8,03) | igual | bolha da IA |
| `--bubble-ai-border` (novo) | `rgba(5, 24, 19, 0)` | `rgba(178, 229, 79, 0.40)` | separa a bolha da IA no escuro |
| `--elev-xs` | `0 1px 2px rgba(5,24,19,.05)` | `none` | |
| `--elev-sm` | `0 1px 2px rgba(5,24,19,.04), 0 2px 6px rgba(5,24,19,.04)` | `none` | cartão em repouso |
| `--elev-md` | `0 2px 4px rgba(5,24,19,.04), 0 8px 20px rgba(5,24,19,.06)` | `none` | hover de cartão |
| `--elev-lg` | `0 4px 8px rgba(5,24,19,.05), 0 18px 44px rgba(5,24,19,.09)` | `0 18px 44px rgba(0,0,0,.5)` | modal |
| `--elev-pop` | `0 12px 32px rgba(5,24,19,.14)` | `0 12px 32px rgba(0,0,0,.55)` | menu, toast |
| `--dur-instant/fast/base/slow/page` | `90ms / 140ms / 200ms / 320ms / 420ms` | igual | |
| `--radius` | `0.625rem` (manter) | | |

Famílias semânticas (marcador / texto de chip / fundo de chip):

| Família | Claro | Chip claro | Escuro | Chip escuro |
|---|---|---|---|---|
| success | success-500 / success-700 / success-050 | 5,68 | `#2f9e5b` / `#8bc89a` / `#0c2d1f` | 7,66 |
| warning | warning-500 / warning-700 / warning-050 | 4,58 | `#d9962a` / `#e8c480` / `#272c17` | 8,65 |
| alert | danger-500 / danger-700 / danger-050 | 6,31 | `#d4553d` / `#e6a08a` / `#26221a` | 7,37 |
| info | info-500 / info-700 / info-050 | 6,17 | `#4785b5` / `#98bbcc` / `#10292d` | 7,43 |
| neutral | ink-500 / ink-700 / ink-050 | 9,42 | ink-400 / ink-200 / ink-800 | 10,20 |
| ai (C11) | lime-700 / lime-800 / lime-100 | 6,37 | lime-400 / lime-300 / `#21391d` | 9,26 |

Regra do escuro (anotar em comentário): texto = 500 com 45% de cream; fundo = ink-900 com 16% da 500. Marcador é sempre redundante; quando a cor for a única codificação (preenchimento de barra), usar `--x-text`, nunca a 500 (warning-500 dá 2,52 no branco).

Sidebar (só no `:root`, fixa nos dois temas):

| Token | Valor | Contraste |
|---|---|---|
| `--sidebar` | ink-900 | |
| `--sidebar-foreground` | `rgba(251, 252, 232, 0.62)` | 7,22 |
| `--sidebar-muted` | ink-400 `#8b9a92` (opaco) | 6,22 (o cream .32 do DS dá 2,81) |
| `--sidebar-strong` (novo) | cream-050 | 17,6 |
| `--sidebar-border` | `rgba(251, 252, 232, 0.07)` | |
| `--sidebar-accent` / `-foreground` | `rgba(251, 252, 232, 0.05)` / cream-050 | |
| `--sidebar-active-bg` | `rgba(178, 229, 79, 0.14)` | |
| `--sidebar-active-text` / `-bar` / `--sidebar-primary` / `--sidebar-ring` | lime-400 | 9,01 sobre o ativo |
| `--sidebar-primary-foreground` | ink-900 | 12,40 |
| `--sidebar-badge` / `-text` | ink-800 / ink-200 (opacos) | 10,20 (o teste compõe rgba de fundo sobre `--background`, por isso opaco) |

### 4.4 `@theme inline`, tipografia, utilitários e base

Acrescentar ao `@theme inline` (manter tudo o que existe):
```css
--color-text-strong: var(--text-strong);
--color-surface-subtle: var(--surface-subtle);
--color-primary-hover: var(--primary-hover);
--color-primary-soft: var(--primary-soft);
--color-primary-soft-hover: var(--primary-soft-hover);
--color-primary-text: var(--primary-text);
--color-primary-edge: var(--primary-edge);
--color-focus: var(--focus);
--color-chart-bar: var(--chart-bar);
--color-chart-bar-muted: var(--chart-bar-muted);
--color-border-strong: var(--border-strong);
--color-border-heavy: var(--border-heavy);
--color-inverse: var(--inverse);
--color-inverse-foreground: var(--inverse-foreground);
--color-inverse-hover: var(--inverse-hover);
--color-on-alert: var(--on-alert);
--color-alert-bg-hover: var(--alert-bg-hover);
--color-bubble-out: var(--bubble-out);
--color-bubble-out-foreground: var(--bubble-out-foreground);
--color-bubble-ai: var(--bubble-ai);
--color-bubble-ai-foreground: var(--bubble-ai-foreground);
--color-success-text: var(--success-text); --color-success-bg: var(--success-bg);
--color-warning-text: var(--warning-text); --color-warning-bg: var(--warning-bg);
--color-alert-text: var(--alert-text);     --color-alert-bg: var(--alert-bg);
--color-info-text: var(--info-text);       --color-info-bg: var(--info-bg);
--color-ai-text: var(--ai-text);           --color-ai-bg: var(--ai-bg);
--color-neutral-text: var(--neutral-text); --color-neutral-bg: var(--neutral-bg);
--color-sidebar-muted: var(--sidebar-muted);
--color-sidebar-strong: var(--sidebar-strong);
--color-whatsapp: var(--cz-whatsapp); --color-meta: var(--cz-meta);
--radius-sm: 6px; --radius-md: 8px; --radius-lg: 10px; --radius-xl: 12px;
--radius-2xl: 16px; --radius-3xl: 20px; --radius-4xl: 28px;
--radius-control: 10px; --radius-card: 16px; --radius-bubble: 18px; --radius-modal: 20px;
--shadow-xs: var(--elev-xs); --shadow-sm: var(--elev-sm); --shadow-md: var(--elev-md);
--shadow-lg: var(--elev-lg); --shadow-pop: var(--elev-pop);
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in: cubic-bezier(0.6, 0, 1, 1);
--spacing-sidebar: 248px; --spacing-sidebar-collapsed: 64px; --spacing-topbar: 60px;
--spacing-inbox-list: 336px; --spacing-context-panel: 320px; --spacing-gutter: 24px;
--container-content: 1240px;
```
Isso gera `text-primary-text`, `bg-primary-soft`, `border-primary-edge`, `outline-focus`, `bg-surface-subtle`, `bg-inverse`, `rounded-card`, `shadow-pop`, `w-sidebar`, `h-topbar`, `w-inbox-list`, `w-context-panel`, `max-w-content`. Efeito colateral esperado: `text-alert-text`, `text-success-text` e `border-border-strong`, que hoje NÃO geram CSS, passam a gerar (mensagens de erro de login, convite e conexão ganham cor; 8 bordas passam a aparecer). Revisar esses pontos.

`lib/utils/index.ts`: trocar `twMerge` por `extendTailwindMerge({ extend: { theme: { radius: ["control", "card", "bubble", "modal"], shadow: ["pop"] } } })`. Sem isso, `cn("rounded-lg", "rounded-card")` mantém as duas classes.

`app/layout.tsx`:
```ts
import { JetBrains_Mono, Manrope } from "next/font/google";
// Tipografia do Conduzza Design System: Manrope na interface, JetBrains Mono em todo numero, hora, telefone e valor.
const manrope = Manrope({ variable: "--font-app-sans", subsets: ["latin"], display: "swap" });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-app-mono", subsets: ["latin"], display: "swap" });
// <html className={`${manrope.variable} ${jetbrainsMono.variable}`} ...>
```
Sem `weight` (as duas são variáveis e cobrem 200 a 800 e 100 a 800). Os nomes de variável não mudam, então o `@theme` de fonte fica igual. Os `font-mono` e `tabular-nums` existentes trocam de família sozinhos.

Escala tipográfica (valores explícitos, sem token de tamanho, D28):

| Papel | Classes |
|---|---|
| Título de página (h1) | `text-[24px] leading-[1.2] font-bold tracking-[-0.02em]` |
| Título de modal, folha, barra superior | `text-[19px] leading-[1.25] font-bold tracking-[-0.015em]` |
| Título de cartão (h2/h3) | `text-base leading-[1.3] font-bold tracking-[-0.01em]` |
| Corpo | `text-sm` (14) |
| Corpo denso (célula, linha de lista, item de nav) | `text-[13.5px]` ou `text-[13px]` |
| Rótulo de campo | `text-xs font-semibold` |
| Legenda, metadado | `text-[11px]` a `text-xs` |
| Eyebrow | `cz-eyebrow text-text-secondary` (10px) |
| KPI | `cz-num text-[34px] leading-none font-semibold` (herói 40, médio 24, pequeno 16) |

Utilitários (`@utility`):
```css
@utility cz-num { font-family: var(--font-app-mono), ui-monospace, monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
@utility cz-eyebrow { font-size: 10px; line-height: 1.2; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 700; }
@utility cz-scroll {
  scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent;
  &::-webkit-scrollbar { width: 8px; height: 8px; }
  &::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
}
@utility cz-transition { transition: background-color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), transform var(--dur-instant) var(--ease-standard); }
@utility hit-40 { position: relative; &::after { content: ""; position: absolute; top: 50%; left: 50%; width: max(100%, 40px); height: max(100%, 40px); transform: translate(-50%, -50%); } }
```
`cz-eyebrow` não define cor (a cor vem de uma classe `text-*` separada, para o `twMerge` não perder nenhuma das duas). `hit-40` não funciona dentro de ancestral com `overflow-hidden`: ali o controle precisa de 40px reais.

`@layer base` (substitui o atual):
```css
* { @apply border-border; }          /* sai o outline-ring/50 global */
html { @apply font-sans; }
body { @apply bg-background text-foreground; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
h1, h2, h3, h4, h5, h6 { color: var(--text-strong); text-wrap: balance; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
::selection { background: var(--cz-lime-200); color: var(--cz-ink-900); }
.dark ::selection, .cz-dark ::selection { background: rgba(178, 229, 79, 0.3); color: var(--cz-cream-050); }
```
Depois do bloco principal (o `:root` principal tem de vir antes deste):
```css
@media (prefers-reduced-motion: reduce) {
  :root { --dur-instant: 0ms; --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; --dur-page: 0ms; }
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
  .animate-spin { animation-duration: 900ms !important; animation-iteration-count: infinite !important; }
}
```
(0.01ms e não `animation: none`: o Presence do Radix espera `animationend` para desmontar.)

### 4.5 Primitivos (`components/ui`)

Foco, em todos os controles que não são campo: `focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus` (o `outline-solid` é obrigatório porque a base dos primitivos tem `outline-none`). Campos: `focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-ring/55` (a borda lime-800 é o indicador; o halo é enfeite do DS). Desabilitado: `disabled:opacity-45`, mantendo `disabled:pointer-events-none` onde já existe (sem ele a dica do `DisabledWithHint` não abre).

**button.tsx** (D18)
- base: `group/button relative inline-flex shrink-0 items-center justify-center gap-[7px] rounded-lg border border-transparent bg-clip-padding text-sm font-semibold tracking-[-0.005em] whitespace-nowrap select-none outline-none cz-transition` + foco padrão + `active:not-aria-[haspopup]:scale-[.975] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`. Sai `transition-all`, `translate-y-px` e o anel `ring-3 ring-ring/50`.
- `default` (primary do DS): `bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover`.
- `outline` (secondary do DS): `border-border-strong bg-card text-text-strong shadow-xs hover:bg-surface-3 aria-expanded:bg-surface-3`. Sai `dark:bg-input/30`.
- `secondary` (soft do DS): `bg-primary-soft text-primary-text hover:bg-primary-soft-hover`. Conferir os 3 usos atuais (`profissionais-tab.tsx:385` e `:529`, `foto-da-conversa.tsx:95` e `:102`): se lá era a intenção de "botão neutro", trocar por `outline`.
- `ghost`: `text-foreground hover:bg-surface-3 hover:text-text-strong aria-expanded:bg-surface-3`.
- `destructive` (danger do DS, suave): `bg-alert-bg text-alert-text hover:bg-alert-bg-hover` (6,31 e 5,69).
- `solid` (novo): `bg-inverse text-inverse-foreground shadow-xs hover:bg-inverse-hover`. Confirmação de diálogo destrutivo usa `destructive`; `solid` serve para ação secundária forte quando o lime já está na tela.
- `link`: `h-auto border-0 px-0 text-primary-text underline-offset-2 hover:underline`.
- tamanhos: `default` `h-10 px-3.5`; `sm` `h-[30px] gap-1.5 px-2.5 text-[13px] hit-40 [&_svg:not([class*='size-'])]:size-3.5`; `lg` `h-11 gap-2 px-5 text-[15px] [&_svg:not([class*='size-'])]:size-[18px]`; `xs` = `sm` (deprecado); `icon` `size-10 rounded-md active:not-aria-[haspopup]:scale-[.94] [&_svg:not([class*='size-'])]:size-[17px]`; `icon-sm` `size-7 rounded-md hit-40 active:not-aria-[haspopup]:scale-[.94] [&_svg:not([class*='size-'])]:size-[15px]`; `icon-lg` `size-11 rounded-md [&_svg:not([class*='size-'])]:size-[19px]`; `icon-xs` = `icon-sm`.
- Os 283 `h-10` e `size-10` explícitos ficam redundantes e podem sair depois; não é obrigatório.

**input.tsx, textarea.tsx, gatilho do select.tsx**
- Input: `h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base text-foreground shadow-xs cz-transition outline-none placeholder:text-text-tertiary` + foco de campo + `disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm [color-scheme:light] dark:[color-scheme:dark]`. Sai `dark:bg-input/30` e `disabled:bg-input/50`. Tipos `date`, `time`, `datetime-local` e `number`: acrescentar `cz-num` no chamador.
- Textarea: mesmas classes, `min-h-16 px-3 py-2.5 leading-[1.5] resize-y`.
- SelectTrigger: mesma casca, `h-10 justify-between gap-2 pr-2.5 pl-3 text-sm data-placeholder:text-text-tertiary data-[size=sm]:h-[30px] data-[size=sm]:text-[13px]`; chevron `size-[15px] text-text-secondary`. Manter Radix (o e2e usa `combobox` e `option`).

**checkbox.tsx**: `peer relative flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border border-input bg-card outline-none cz-transition after:absolute after:-inset-3` + foco padrão + `disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive data-checked:border-primary-edge data-checked:bg-primary data-checked:text-primary-foreground`; indicador `[&>svg]:size-3`; `data-[state=indeterminate]` mostra `Minus`. Sai `dark:bg-input/30`.

**switch.tsx** (C6)
- raiz: `peer group/switch relative inline-flex shrink-0 items-center rounded-full border outline-none transition-colors duration-(--dur-base) after:absolute after:-inset-x-1 after:-inset-y-[9px]` + foco padrão + `data-[size=default]:h-[22px] data-[size=default]:w-10 data-[size=sm]:h-[18px] data-[size=sm]:w-8 data-unchecked:border-input data-unchecked:bg-surface-4 data-checked:border-primary-edge data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-45`.
- polegar: `pointer-events-none block rounded-full translate-x-[2px] transition-transform duration-(--dur-base) ease-out group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[20px] group-data-[size=sm]/switch:data-checked:translate-x-[16px] data-unchecked:bg-text-secondary data-checked:bg-primary-foreground` (ink-600 desligado: 5,76 sobre o trilho; ink-900 ligado: 12,4).

**label.tsx**: `text-xs font-semibold text-foreground`. **form.tsx**: `FormItem` `gap-1.5`; `FormDescription` `text-[11px] text-text-tertiary`; `FormMessage` `text-[11px] font-medium text-alert-text`.

**dialog.tsx**
- Overlay: `fixed inset-0 isolate z-50 bg-(--overlay) duration-(--dur-base) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0`. Sai `bg-black/10` e `supports-backdrop-filter:backdrop-blur-xs` (C14).
- Content: `fixed top-1/2 left-1/2 z-50 grid max-h-[86vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-modal border border-border bg-card p-5 text-sm text-card-foreground shadow-lg outline-none duration-(--dur-base) ease-out sm:max-w-[480px] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.985] data-open:slide-in-from-bottom-2.5 data-closed:animate-out data-closed:fade-out-0`. Sai `ring-1 ring-foreground/10` e `zoom-in-95`.
- Header `flex flex-col gap-[3px] pr-10`; Title `text-[19px] leading-[1.25] font-bold tracking-[-0.015em]`; Description `text-[13px] text-text-secondary`; Footer `-mx-5 -mb-5 flex flex-col-reverse gap-2 border-t border-border bg-surface-subtle px-5 py-3.5 sm:flex-row sm:justify-end`.
- Fechar: `absolute top-3 right-3`, `Button variant="ghost" size="icon"` com `text-text-secondary`. O `sr-only` "Close" vira "Fechar janela" (não "Fechar": `importacao.spec.ts:97` busca o botão "Fechar" do rodapé por substring).
- Larguras pelo chamador: confirmação `sm:max-w-[420px]`, padrão 480, formulário `sm:max-w-[640px]`, ficha e importação `sm:max-w-[820px]`.

**sheet.tsx**: mesmo overlay sem blur; conteúdo `bg-card shadow-lg border-0 duration-(--dur-base) ease-out`, cantos internos `rounded-l-modal` (direita), `rounded-r-modal` (esquerda), `rounded-t-modal` (baixo); Header `gap-[3px] border-b border-border px-5 pt-[18px] pb-3.5`; Title 19px bold; Footer `border-t border-border bg-surface-subtle px-5 py-3.5 sm:flex-row sm:justify-end`; fechar `top-3 right-3 size-10`, "Close" vira "Fechar painel".

**popover.tsx, dropdown-menu.tsx, conteúdo do select.tsx**
- casca: `rounded-xl border border-border-strong bg-popover p-[5px] text-popover-foreground shadow-pop duration-(--dur-fast) data-open:animate-in data-open:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-closed:animate-out data-closed:fade-out-0`, `sideOffset={6}`. Sai `shadow-md ring-1 ring-foreground/10` e `zoom-in-95`. Dropdown: `min-w-[200px]` e sai o `w-(--radix-dropdown-menu-trigger-width)`. Popover com conteúdo livre: `w-72 p-3 gap-2.5`.
- item: `relative flex min-h-10 cursor-default items-center gap-[9px] rounded-sm px-[9px] text-[13px] font-medium text-foreground outline-hidden select-none focus:bg-accent focus:text-text-strong data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg:not([class*='size-'])]:size-[15px]`; destrutivo `data-[variant=destructive]:text-alert-text data-[variant=destructive]:focus:bg-alert-bg`; check à direita `size-3.5 text-primary-text`.
- Label `px-[9px] py-1.5 text-xs font-semibold text-text-strong` (sem caixa alta: leva o nome da pessoa); Separator `-mx-[5px] my-[5px] h-px bg-border`; Shortcut `ml-auto cz-num text-[10px] text-text-tertiary`.

**tooltip.tsx** (C23): `z-50 w-fit max-w-[280px] rounded-sm bg-inverse px-2 py-[5px] text-[11.5px] leading-[1.35] font-medium text-inverse-foreground shadow-md duration-(--dur-fast) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0`, `sideOffset={6}`, sem seta, quebra de linha permitida.

**tabs.tsx** (D11)
- `tabsListVariants.variant`: `line` (novo padrão) `h-auto w-full justify-start gap-0.5 overflow-x-auto rounded-none border-b border-border bg-transparent p-0`; `segmented` (o pill atual, reestilizado) `inline-flex h-10 gap-0.5 rounded-lg bg-surface-4 p-[3px]`; `cartoes` `grid h-auto w-full gap-3 bg-transparent p-0` (sem estilo de gatilho, para Automações).
- `TabsTrigger` na `line`: `relative inline-flex min-h-10 flex-none items-center gap-[7px] px-3 pt-2.5 pb-[11px] text-[13.5px] font-medium whitespace-nowrap text-text-secondary hover:text-text-strong` + foco com `focus-visible:-outline-offset-2` + `data-active:font-bold data-active:text-text-strong after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary-edge after:opacity-0 data-active:after:opacity-100`.
- na `segmented`: `h-[34px] rounded-[7px] px-3 text-[13px] font-medium text-text-secondary hit-40 data-active:bg-card data-active:font-bold data-active:text-text-strong data-active:shadow-xs` (o negrito é a pista que não é cor: branco sobre paper-200 dá 1,2:1).
- contagem dentro do gatilho: `ml-1.5 rounded-full bg-surface-4 px-1.5 py-px cz-num text-[11px] text-text-secondary`.
- chamadores tiram `className="h-auto flex-wrap justify-start"` e `min-h-9` (a lista rola na horizontal).

**table.tsx e data-table (compartilhado)**
- `Table` ganha `containerClassName`; o contêiner vira o ÚNICO contêiner de rolagem (`relative w-full overflow-auto`), para o cabeçalho grudar.
- `Table` `w-full caption-bottom text-[13.5px]`; `TableHeader` sem `[&_tr]:border-b`.
- `TableHead`: `sticky top-0 z-[1] h-auto border-b border-border-strong bg-surface-subtle px-3.5 py-[11px] text-left align-middle cz-eyebrow text-text-secondary whitespace-nowrap` (6,56:1).
- `TableRow`: `border-b border-border cz-transition hover:bg-surface-subtle data-[state=selected]:bg-primary-soft data-[state=selected]:shadow-[inset_2px_0_0_var(--primary-edge)]`.
- `TableCell`: `h-11 px-3.5 py-0 align-middle text-foreground` (linhas de 44px; `py-0` porque o botão ou link de 40px vai dentro).
- `DataTable`: invólucro `overflow-hidden rounded-card border border-border bg-card shadow-sm`; props novas `variant="bare"` (sem casca, quando já está dentro de Card), `stickyHeader` com `max-h-*` via `containerClassName`, `isRowSelected(row)` que marca `data-state=selected`, `dense` (`h-9 px-3 text-[12.5px]`); `meta.align: "right"` vale também no `th`; `meta.numeric` aplica `cz-num`; vazio renderiza o `EmptyState` dentro da mesma casca.

**card.tsx**: `Card` `group/card flex flex-col overflow-hidden rounded-card border border-border bg-card text-sm text-card-foreground shadow-sm` (sai `ring-1 ring-foreground/10`: uma borda e uma sombra, nunca duas pistas); prop `tone?: "default" | "sunken" | "accent"` (sunken `border-transparent bg-surface-4 shadow-none`; accent `border-primary-edge/25 bg-primary-soft`); prop `interactive` `cursor-pointer transition-[box-shadow,transform] duration-(--dur-base) hover:-translate-y-px hover:shadow-md motion-reduce:transform-none`; `CardHeader` `flex min-h-[52px] items-center justify-between gap-3 border-b border-border px-4 py-3.5`; `CardTitle` `text-base font-bold tracking-[-0.01em]`; `CardDescription` `text-[12.5px] text-text-secondary`; `CardContent` `p-4`; `CardFooter` `border-t border-border bg-surface-subtle px-4 py-3.5`. Cartões feitos à mão (`rounded-lg border bg-card p-4`, cerca de 48) viram `rounded-card border border-border bg-card p-4 shadow-sm` no lote de cada tela.

**badge.tsx** (só especialidade do profissional usa): aparência de Tag padrão, `inline-flex h-6 items-center gap-1.5 rounded-sm border border-border-strong bg-card px-2.5 text-xs font-medium text-foreground`; `default` com `bg-primary text-primary-foreground` sem `hover:bg-primary/80`.

**skeleton.tsx**: `rounded-sm bg-surface-4 motion-reduce:animate-none`.

**sonner.tsx** (D17): `style` com `--normal-bg: var(--cz-ink-900)`, `--normal-text: var(--cz-cream-050)`, `--normal-border: rgba(251, 252, 232, 0.07)`, `--border-radius: 12px`; `toastOptions.classNames`: `toast: "cn-toast cz-dark shadow-pop gap-[11px] px-3.5 py-3 font-sans"`, `title: "text-[13.5px] font-bold"`, `description: "text-[12.5px] text-text-secondary"`; ícones `size-[17px]`: sucesso `CircleCheck text-success-text`, info `Info text-info-text`, aviso `CircleAlert text-warning-text`, erro `OctagonAlert text-alert-text`, carregando `LoaderCircle animate-spin`. Posição e quantidade visível não mudam nesta passada (comportamento). As 109 chamadas `toast.*` não mudam.

**accordion.tsx**: trigger `py-3 text-[13.5px] font-semibold hover:no-underline hover:text-text-strong` + foco padrão, chevron `size-[15px] text-text-secondary`; item `border-b border-border`; conteúdo `pb-3 text-[13px] text-foreground`.

### 4.6 Compartilhados e mapas de status

**status-chip.tsx** (C8): prop `size?: "sm" | "md"` (padrão md). md `inline-flex h-6 items-center gap-1.5 rounded-full px-[9px] text-xs font-semibold tracking-[-0.005em] whitespace-nowrap`, ícone `size-[13px] shrink-0`; sm `h-5 gap-1 px-[7px] text-[11px]`, ícone `size-3` (D21). Cores continuam de `STATUS_TONE_VARS` (`tone.text` e `tone.bg`). Nunca o `dot` do Badge do DS.

**chip-de-etiqueta.tsx** (compartilhado com Atendimento, Configurações, Pacientes): etiqueta vira a Tag do DS (não parece mais status). Prop `tamanho?: "compacto" | "padrao"` (padrão `padrao`, para não mudar os chamadores atuais) e `aoRemover?`.
- `padrao`: `inline-flex h-6 max-w-full items-center gap-1.5 rounded-sm border border-border-strong bg-card px-2.5 text-xs font-medium text-foreground`; marcador `<span aria-hidden className="size-[7px] shrink-0 rounded-[2px]" style={{ background: STATUS_TONE_VARS[tom].marker }} />`.
- `compacto` (lista de conversas, kanban): `inline-flex h-[18px] max-w-full shrink-0 items-center gap-1 overflow-hidden rounded-[4px] bg-surface-4 px-1.5 text-[10.5px] font-medium text-foreground`; marcador `size-[5px] rounded-[1.5px]`. (Exceção documentada ao piso de 11px da D20: a etiqueta compacta usa 10,5px, com 13,5:1 de contraste.) Hmm, ver nota: se preferir o piso rígido, usar 11px.
- com remover: `pr-1` e botão `relative grid size-4 place-items-center rounded-[4px] text-text-secondary hover:bg-surface-3 hit-40` com `X size-[11px]` e `aria-label="Remover etiqueta {nome}"`.
- `truncate` e `title` continuam.

**contact-avatar.tsx** (D10): `TONES = ["var(--cz-lime-400)", "var(--cz-lime-600)", "var(--cz-info-500)", "var(--cz-warning-500)", "var(--cz-success-500)", "var(--cz-ink-400)"]` (exceção documentada à regra D25: constantes de marca do DS para decoração, nunca status); estilo `backgroundColor: color-mix(in oklab, ${tone} 26%, var(--cz-paper-050))`, `color: var(--cz-ink-900)` nos dois temas, `boxShadow: inset 0 0 0 1px var(--border)`, `fontSize: Math.round(size * 0.36)`, classes `flex shrink-0 items-center justify-center rounded-full font-bold tracking-[-0.02em]`. Iniciais: primeira e última palavra; sem nome, os 2 últimos dígitos do telefone (como hoje). O hash não muda. Tamanhos de uso: 24 (tabela, kanban), 30 (rodapé e menu da sidebar), 36 (lista e cabeçalho do Atendimento), 44 (drawer do lead), 56 (painel de contexto e ficha). Sem ponto de presença.

**empty-state.tsx**: contêiner `flex flex-col items-center justify-center gap-3 px-6 py-14 text-center` (sai `rounded-lg border border-dashed`); ladrilho `grid size-[52px] place-items-center rounded-card bg-primary-soft` com ícone `size-6 text-primary-text`; título `text-base font-bold tracking-[-0.01em]`; descrição `max-w-[44ch] text-[13px] text-text-secondary`; ações `mt-1 flex flex-wrap items-center justify-center gap-2` aceitando `variant`. Prop `compact` (`gap-2 px-5 py-7`, ladrilho `size-[38px]`, ícone `size-[18px]`, título `text-sm`). Prop `tom="erro"` (ladrilho `bg-alert-bg`, `OctagonAlert text-alert-text`). Onde o vazio estava solto na página, o chamador o põe dentro de um Card.

**page-header.tsx**: prop `eyebrow?: string` (`cz-eyebrow text-text-secondary`); `header` `flex flex-wrap items-end gap-4`; `h1` (continua h1) `text-[24px] leading-[1.2] font-bold tracking-[-0.02em]`; descrição `max-w-[62ch] text-[13.5px] text-text-secondary`; ações `ml-auto flex shrink-0 items-center gap-2`.

**permission-hint.tsx**: o `span tabIndex={0}` ganha `cursor-not-allowed` e aceita `className` (substitui `w-fit`, para botões de bloco usarem `w-full`). Comportamento igual.

**loading-skeleton.tsx**: `CardsSkeleton` com a casca `rounded-card border border-border bg-card p-4 shadow-sm`; `TableSkeleton` dentro de `rounded-card border`; `ListSkeleton` com avatar `size-9 rounded-full`.

**theme-toggle.tsx**: `Button variant="ghost" size="icon"`, ícone `size-[18px] text-text-secondary`. Rótulos "Mudar para tema escuro/claro" iguais (o e2e clica).

**aviso-celular.tsx**: vira `<Aviso tom="info" icone={MonitorSmartphone}>` com `md:hidden`, texto igual (corrige a classe `bg-surface`, que não existe).

**module-placeholder.tsx**: EmptyState novo dentro de Card.

**Novos compartilhados**
- `components/shared/segmented-control.tsx` (3 cópias hoje: `agenda/filter-bar.tsx`, `app/(app)/leads/leads-client.tsx`, `atendimento/composer.tsx`). API `{ options: {value, label, icon?, count?}[]; value; onChange; size?: "sm" | "md"; block?: boolean; ariaLabel: string }`. Semântica: `<div role="group" aria-label>` com `<button type="button" aria-pressed>` (NÃO `tablist`: o e2e clica `getByRole("button", { name: "Kanban" })`). Trilho `inline-flex h-10 gap-0.5 rounded-lg bg-surface-4 p-[3px]` (block: `flex w-full`, item `flex-1`); item `inline-flex h-[34px] items-center justify-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium whitespace-nowrap text-text-secondary cz-transition hit-40 hover:text-text-strong` + foco `focus-visible:outline-offset-1`; ligado `aria-pressed:bg-card aria-pressed:font-bold aria-pressed:text-text-strong aria-pressed:shadow-xs aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-input` (o anel dá 4,42:1; o estado não fica só na cor); sm: trilho `h-[34px]`, item `h-7 text-xs`; ícone `size-3.5`; contagem `cz-num text-[11px] text-text-secondary` sempre precedida de espaço literal (`{rotulo}{" "}<span>`), porque o e2e busca `/Todas 4/`.
- `components/shared/aviso.tsx` (Banner do DS). API `{ tom: "info" | "success" | "warning" | "alert" | "neutral" | "ia"; titulo?: string; icone?: LucideIcon; acao?: ReactNode; aoDispensar?: () => void; faixa?: boolean; role?: "status" | "alert" }`. Base `flex items-start gap-[11px] rounded-xl px-3.5 py-3 bg-{tom}-bg text-{tom}-text`; ícone `mt-px size-[17px] shrink-0`; título `text-[13.5px] font-bold`; corpo `text-[13px]` SEM a opacidade 0,92 do DS (warning cairia para 3,98:1); ação à direita; dispensar `relative grid size-5 place-items-center hit-40` com `aria-label="Dispensar"`; `faixa`: `rounded-none border-b border-{tom} px-4 py-2 md:px-6 min-h-12 items-center`. Ícone padrão por tom (tabela de ícones abaixo); `neutral` exige `icone`.
- `components/shared/barra-de-progresso.tsx` (4 barras à mão: `relatorios/barra-horizontal.tsx`, `inicio/painel.tsx`, `pacientes/comum.tsx` duas). API `{ valor, maximo, rotulo?, legenda?, tamanho?: "sm" | "md"; tom?: "destaque" | "neutro"; ariaLabel }`. Trilho `block h-[7px] overflow-hidden rounded-full bg-surface-4` (sm `h-1`); preenchimento `block h-full rounded-full transition-[width] duration-(--dur-slow) ease-out motion-reduce:transition-none` com `background: var(--chart-bar)` ou `var(--chart-bar-muted)`. Sem tons de status (C12). Mantém `role="img"`, `aria-label`, piso de largura só para valor maior que zero e o número escrito ao lado.

**`lib/design/status.ts`**: nenhuma mudança nos mapas existentes (10 status de consulta, 4 de conversa, etapas, recência). Comentários: "violeta é RESERVADO para IA" vira "lime suave (tom ai) é reservado para IA"; "handoff" vira "design system Conduzza". Mapas novos (um ícone, uma cor):

| Mapa | Chave: rótulo, tom, ícone |
|---|---|
| `RECORD_STATUS` | ativo: "Ativo", success, `CircleCheck`; inativo: "Inativo", neutral, `CirclePause` |
| `REGUA_STATUS` | ligada: rótulo da tela, success, `CircleCheck`; desligada: rótulo da tela, neutral, `CirclePause` |
| `WHATSAPP_CONNECTION_STATUS` | conectado: success, `CircleCheck`; conectando: info, `LoaderCircle` (`motion-safe:animate-spin`); aguardando_qr: warning, `QrCode`; desconectado: alert, `WifiOff` (rótulos do `connect-client` atual) |
| `ACCESS_LEVEL_STATUS` | tudo: success, `CircleCheck`; ver: neutral, `Eye`; proprio: warning, `UserRound`; nada: neutral, `CircleSlash` (texto de `ACCESS_LABELS` inalterado) |
| `IA_AGENDA_STATUS` | sim: "IA agenda", success, `Bot`; nao: "Só recepção", neutral, `ConciergeBell` |
| `CONVERSAO_STATUS` | ativa: success, `Send`; pausada: neutral, `CirclePause`; sem: neutral, `CircleDashed` |
| `TOKEN_META_STATUS` | salvo: "Token salvo", success, `KeyRound`; ausente: "Sem token", neutral, `CircleDashed` |
| `CONSENT_STATUS` | autorizado: "Autorizado a receber mensagens", success, `ShieldCheck`; revogado: "Pediu para não receber mensagens", alert, `ShieldX`; sem_autorizacao: "Sem autorização registrada", neutral, `ShieldOff` |

**Tabela de ícones reservados (C18)**: `TriangleAlert` só para Faltou (alert). `CircleAlert` = atenção (warning). `OctagonAlert` = erro ou falha (alert). `Info` = informação (info). `CircleCheck` = sucesso, ativo, feito (sempre success). `Clock` = Aguardando (warning); "enviando" usa `SendHorizonal`. `CircleX` = Cancelado pelo paciente; código não encontrado usa `OctagonAlert`. `ShieldAlert` = Risco de falta; bloqueio de conformidade usa `ShieldBan`. `Calendar` = Agendado; menu da Agenda usa `CalendarDays`. `Hourglass` = pendência (warning) e nav de Lista de espera (sem cor semântica). `CalendarX2` = só o pacote vencido da ficha, "Venceu em" (alert); o vazio da Agenda o usa como ilustração do EmptyState, que não é status. `Umbrella` = só "Coberto" pelo convênio nos Vínculos de Cadastros (info), porque a família Shield é da autorização para receber mensagens. `ZapOff` = só "Impede encaixe" do bloqueio em Cadastros (warning), par do `Zap` do encaixe (sempre neutral). Trocas decorrentes, cada uma no lote da sua tela: chip-do-toque `pulado` para `MailWarning` e `na_fila` para `Mail`; aviso de recurso do modal de agendamento e diálogo da régua para `CircleAlert`; erro de Confirmações para `OctagonAlert`; Recuperadas com tom fixo success; faixa-reoferta "recusou" para `ThumbsDown` neutral e "Cancelar reoferta" com `X`; métricas da espera tempo médio `TimerReset`; métricas da régua "Não saíram" para `SkipForward`; Pacientes KPI Faltas `CalendarMinus2`, "Vale até" `CalendarRange`; Início Próximas ações `CalendarClock` neutral, `Hand` warning, `AlarmClock` alert; checklist pendente `Hourglass` warning; faixa do WhatsApp `WifiOff`, do motor e `error.tsx` `OctagonAlert`; formulário de código "falha" `CircleAlert`.

### 4.7 Receitas repetidas (usar igual em todas as telas)
- **StatCard**: `grid min-w-0 content-start gap-2.5 rounded-card border border-border bg-card p-4 shadow-sm`; linha 1 `flex items-center justify-between gap-2` com rótulo `cz-eyebrow text-text-secondary` e ícone `size-4` (neutro `text-text-secondary`; se o cartão É um status, `tone.text`); valor `cz-num text-[34px] leading-none font-semibold text-text-strong` (médio 24); variação `flex items-center gap-1 text-xs font-semibold` com ícone `size-[13px]` e cor pela polaridade (`success-text`, `alert-text`, `neutral-text`); nota `text-xs text-text-secondary`. Dentro de outro cartão, sem borda e sem sombra: `rounded-xl bg-surface-4 p-3.5`.
- **Bloco afundado**: `rounded-xl bg-surface-4 p-3.5` (linha: `rounded-md bg-surface-4 px-3 py-2.5`), sem borda e sem sombra.
- **Selecionado** (linha de lista, linha de tabela, cartão de escolha): toda linha tem `border-l-2 border-l-transparent`; selecionada `bg-primary-soft border-l-primary-edge` (ou `shadow-[inset_2px_0_0_var(--primary-edge)]`), com `aria-selected`, `aria-current` ou `aria-pressed`.
- **Escolha em chip** (dias, turnos, horários): não selecionado `border border-input bg-card`; selecionado `border-primary-edge bg-primary-soft text-primary-text` com `<Check className="size-3.5" aria-hidden />` antes do rótulo. Nunca `bg-primary` cheio.
- **Hover de cartão clicável**: `hover:-translate-y-px hover:shadow-md cz-transition motion-reduce:transform-none`. Nunca por opacidade.
- **Linha de dado** (painel, ficha): `grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-2 text-[13px]`, rótulo `text-text-secondary`, valor `text-foreground`; datas e números com `cz-num`.
- **Campo vazio**: texto (`Sem preço`, `Sem marcação`, `Ainda não medido`) em `text-text-secondary`; nunca travessão nem `--`.

### 4.8 White-label (`lib/branding/brand-style.ts`, `lib/auth/active-clinic.ts`)
- `DEFAULT_PRIMARY` vira `new Set(["#a8d318", "#b2e54f"])` com `.has(primaryColor.toLowerCase())`: toda linha de `clinic_branding` tem o default `'#A8D318'` (`supabase/migrations/20260819130000_nucleo_acesso.sql:42`); sem isso toda clínica injeta o lime antigo por cima do novo.
- `lib/auth/active-clinic.ts:137` e `:154`: fallback `"#A8D318"` vira `"#B2E54F"`.
- Texto sobre cor clara: `"#051813"` no lugar de `"#10160a"`.
- Para cor custom, injetar também (derivados que mudam com o tema porque referenciam tokens definidos no `<html>`): `--primary-hover: color-mix(in oklab, X 90%, black)`, `--primary-soft: color-mix(in srgb, X 12%, var(--surface-1))`, `--primary-soft-hover: color-mix(in srgb, X 20%, var(--surface-1))`, `--primary-text: color-mix(in oklab, X 55%, var(--text-strong))`, `--primary-edge: color-mix(in oklab, X 70%, var(--text-strong))`, `--focus: var(--primary-text)`, `--chart-bar: var(--primary-edge)`, `--sidebar-primary-foreground: <foreground>`, `--sidebar-ring: X`. Contraste da cor custom continua sem garantia até o editor de marca (Tela 12), risco já registrado. A família de IA fica lime fixo (C11).

### 4.9 Usos atuais de `--primary` como texto ou marca (migrar na Etapa A)
- `text-primary` vira `text-primary-text`: `cadastro-form.tsx:71,86,109`, `espera/modal-adicionar.tsx:258,288`, `automacoes/balao-whatsapp.tsx:98` (ali vira `text-foreground`, ver 5.10), `automacoes/linha-do-tempo.tsx:45`, `shell/criar-clinica.tsx:30`, `leads/importacao/modal-importacao.tsx:169`, `confirmacoes/painel-regua.tsx:148`, `confirmacoes/controles-da-regua.tsx:270`, e os demais do `grep` (17 usos no total).
- `border-primary` (estado escolhido) vira `border-primary-edge`: `selecionar-clinica/page.tsx:47`, `cadastro-form.tsx:68,83`, `espera/fila.tsx:210`, `modal-importacao.tsx:169`, `passo-consentimento.tsx:70` (9 usos).
- `accent-primary` vira `accent-(--primary-edge)`: `leads/modal-motivo-perda.tsx:101`, `passo-consentimento.tsx:80`.
- `var(--primary)` como marca de dado vira `var(--chart-bar)`: `inicio/painel.tsx:234`, `relatorios/barra-horizontal.tsx:35`, `atendimento/media/player-de-audio.tsx:111`.
- `app/dev/supabase/page.tsx:24,28`: `text-alert` e `text-success` viram `text-alert-text` e `text-success-text`.
- `var(--brand)` não existe: `agenda/week-grid.tsx:236,244` e `atendimento/citacao.tsx:91` (tratados nos lotes D4 e D2).

### 4.10 Tradução dos nomes usados nas partes para o contrato

| Nome nas partes | Usar |
|---|---|
| `--text-muted`, `text-muted`, `--bubble-in-meta` | `text-text-secondary` |
| `--text-faint` | `text-text-tertiary` (nunca ink-400 no claro) |
| `--text-accent`, `--accent-text`, `--accent-strong`, `text-accent-strong` | `text-primary-text` |
| `--accent-soft`, `--selection-bg`, `--selected`, `bg-accent-soft`, `--cz-lime-050` | `bg-primary-soft` |
| `--selected-edge`, `--selection-edge`, `--quote-bar`, `border-primary` (sentido lime-700), `--cz-lime-700` | `primary-edge` |
| `--ring-strong`, `--focus-color`, `outline-(--ring)` | `outline-focus` / `border-focus` |
| `--border-control`, borda de campo | `border-input` |
| `--border-subtle` do DS | `border-border-strong` |
| `--border-strong` do DS | `border-border-heavy` |
| `--border-hairline` | `border-border` |
| `--surface-sunken`, `bg-sunken`, `bg-muted` (sentido paper-200), trilho | `bg-surface-4` |
| `--surface-header`, `--surface-subtle`, `bg-table-head`, `--row-hover`, `--composer-field-bg`, paper-050 | `bg-surface-subtle` |
| `--ghost-hover`, `--secondary-hover` | `bg-surface-3` |
| `--canvas`, `--thread-bg` | `bg-background` |
| `--surface`, `--surface-raised` (claro) | `bg-card` / `bg-popover` |
| `bg-lime`, `--lime-fill`; `text-on-lime` | `bg-primary`; `text-primary-foreground` |
| `bg-solid`, `--inverse`, `--chip-on-bg`/`-fg`, `bg-foreground text-background` (botão) | `bg-inverse text-inverse-foreground` |
| `--overlay-scrim` | `bg-(--overlay)` |
| `shadow-card`, `shadow-card-hover`, `shadow-modal` | `shadow-sm`, `shadow-md`, `shadow-lg` |
| `rounded-tile`, `rounded-tag`/`rounded-chip`, `rounded-panel`/`rounded-popover` | `rounded-md` (8), `rounded-sm` (6), `rounded-xl` (12) |
| `--bubble-in-*` | `bg-card border-border text-foreground`, meta `text-text-secondary` |
| `--bubble-note-*` | `bg-warning-bg text-warning-text border-(--warning)/20` |
| variante "secondary" do DS | `variant="outline"` |
| variante "soft" do DS | `variant="secondary"` |
| variante "danger" do DS | `variant="destructive"` |
| `--brand-ink`, `--brand-cream`, `--brand-lime` (auth) | `bg-sidebar`, `text-sidebar-strong`, `text-sidebar-active-text` |
| `num`, `eyebrow`, `transition-control`, `foco` | `cz-num`, `cz-eyebrow`, `cz-transition`, foco padrão (4.5) |
| `h-[calc(100dvh-var(--topbar-h))]`, `h-[calc(100dvh-3.5rem)]` | `h-full` (D12) |

---

## 5. Especificação por tela

### 5.1 Shell (Etapa C)

**Estrutura (`components/shell/app-shell.tsx`)**: raiz `flex h-dvh overflow-hidden bg-background text-foreground print:block print:h-auto print:overflow-visible`, com `data-rail={preferencia}` (`"auto" | "expanded" | "collapsed"`). `aside#menu-lateral`: `hidden h-full shrink-0 flex-col overflow-hidden border-r border-(--sidebar-border) bg-sidebar cz-scroll w-sidebar-collapsed rail-aberto:w-sidebar transition-[width] duration-(--dur-base) ease-standard motion-reduce:transition-none lg:flex print:hidden`. Coluna `flex min-w-0 flex-1 flex-col`: faixa (`shrink-0`), `BarraSuperior`, `main` `relative min-h-0 flex-1 overflow-y-auto overscroll-contain cz-scroll print:overflow-visible`. `useEffect` rola o `main` ao topo a cada `pathname`. Sai o `sticky top-0` do header. Dividir em `rail.tsx`, `barra-superior.tsx`, `use-rail.ts`.

Variante no `globals.css`:
```css
@custom-variant rail-aberto {
  &:where([data-rail="expanded"] *) { @slot; }
  @media (min-width: 1600px) { &:where([data-rail="auto"] *) { @slot; } }
}
```
`use-rail.ts`: `useSyncExternalStore` sobre `matchMedia("(min-width: 1600px)")`, snapshot do servidor = `preferencia === "expanded"`; `alternarRail()` grava `cz_rail=expanded|collapsed; path=/; max-age=31536000; samesite=lax` ou apaga quando igual ao automático. `app/(app)/layout.tsx` lê o cookie e passa ao `AppShell`.

**Rail (`rail.tsx`)**
- Marca: `flex h-topbar shrink-0 items-center justify-center rail-aberto:justify-start rail-aberto:px-[18px]`, sem borda. Expandido: `next/image` `MARCA_PADRAO.lockupFundoEscuro` `width={146} height={24} priority className="hidden h-6 w-auto rail-aberto:block"` com `alt={productName}`. Recolhido: `MARCA_PADRAO.simboloFundoEscuro` `28x28`, `rail-aberto:hidden`. Novo `lib/branding/marca-padrao.ts` com `nomeDoProduto`, `lockupFundoEscuro: "/brand/conduzza-lockup-on-dark.png"`, `simboloFundoEscuro: "/brand/conduzza-symbol-lime.png"`.
- `nav aria-label="Navegação principal"` (nome igual): `grid min-h-0 flex-1 content-start gap-0.5 overflow-x-hidden overflow-y-auto px-2 py-1 rail-aberto:px-3`. Pula grupo sem item visível para o papel. Rótulo de grupo expandido `hidden px-2 pt-4 pb-1.5 cz-eyebrow text-sidebar-muted rail-aberto:block`; recolhido, divisor `mx-auto my-2.5 h-px w-6 bg-(--sidebar-border) rail-aberto:hidden`.
- Item (`Link`): `relative flex h-10 items-center justify-center gap-[11px] rounded-md text-[13.5px] font-medium cz-transition rail-aberto:justify-start rail-aberto:px-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sidebar-ring)`; inativo `text-(--sidebar-foreground) hover:bg-(--sidebar-accent) hover:text-(--sidebar-accent-foreground)`; ativo (`aria-current="page"`, mesma regra de prefixo) `bg-(--sidebar-active-bg) text-(--sidebar-active-text) font-semibold` com barra `absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-(--sidebar-active-bar)` (2px do DS; hoje 3px). Ícone `size-[17px]`, `strokeWidth` 1,5 inativo e 2 ativo até C10. Rótulo `sr-only rail-aberto:not-sr-only rail-aberto:min-w-0 rail-aberto:flex-1 rail-aberto:truncate` (o nome acessível fica no recolhido). Recolhido: `Tooltip side="right" sideOffset={8}` com o rótulo.
- Rodapé `shrink-0 border-t border-(--sidebar-border) p-2 rail-aberto:p-3`: expandido `flex items-center gap-[9px]` com `ContactAvatar size={30}`, nome `truncate text-[12.5px] font-semibold text-sidebar-strong`, papel `truncate text-[11px] text-sidebar-muted`, botão Sair `size-10 rounded-md text-sidebar-muted hover:bg-(--sidebar-accent) hover:text-sidebar-strong` (`LogOut` 17px, `aria-label="Sair"`). Recolhido: só o avatar.
- Gaveta (abaixo de 1024): `SheetContent side="left" data-rail="expanded" showCloseButton={false} className="w-sidebar max-w-[85vw] gap-0 border-r border-(--sidebar-border) bg-sidebar p-0"`, com botão próprio "Fechar menu" `size-10` em `text-(--sidebar-foreground)` ao lado da marca.

**`lib/navigation.ts`** (C20, provisório = recomendação): `NavGroup = "principal" | "operacao_do_dia" | "inteligencia" | "administracao"`, rótulos `null`, "Operação do dia", "Inteligência", "Administração". Início, Atendimento, Leads, Agenda, Pacientes no principal; Confirmações, Lista de espera, Resultados na operação do dia; Agente de IA, Automações na inteligência; Cadastros, Configurações na administração. Ícones: Agenda `CalendarDays`, Leads `UserPlus`, Resultados `ChartColumn`, Cadastros `FolderCog` (rótulo "Cadastros"); os demais iguais. Acrescentar `itemDaRota(pathname)` (maior prefixo). Apagar o TODO(0.7).

**`nav-badge.tsx`**: props `{ count, ativo, vencido?, descricao }`. Zero ou nulo: nada; acima de 99: "99+". `<span className="sr-only">, {n} {descricao}</span>` e pílulas `aria-hidden`. Expandida `hidden ml-auto items-center rounded-full px-1.5 py-px cz-num text-[11px] leading-4 font-bold rail-aberto:inline-flex`; padrão `bg-(--sidebar-badge) text-(--sidebar-badge-text)`; ativo `bg-sidebar-primary text-sidebar-primary-foreground`. Recolhida `absolute top-1 right-1 h-4 min-w-4 rounded-full px-1 cz-num text-[10px] leading-4 font-bold ring-2 ring-sidebar rail-aberto:hidden`. Variante `vencido` (danger-050 com danger-700 e `AlarmClock` 11px) só depois de C20. Sai o coral fixo.

**Barra superior (`barra-superior.tsx`)**: `header` `flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6 print:hidden`.
- Esquerda: "Abrir menu" (nome igual) `Button variant="ghost" size="icon" className="lg:hidden"` com `Menu` 18px; a partir de 1024, recolher/expandir `hidden lg:inline-flex` com `PanelLeftClose`/`PanelLeftOpen`, `aria-label` "Recolher menu"/"Expandir menu", `aria-controls="menu-lateral"`, `aria-expanded`. Título `grid min-w-0 gap-px`: eyebrow com o nome da clínica `truncate cz-eyebrow text-text-secondary` (caixa alta só por CSS); título do módulo por `itemDaRota` em `<p>` (NÃO heading) `truncate text-[17px] md:text-[19px] leading-[1.25] font-bold tracking-[-0.015em] text-text-strong`.
- Direita `ml-auto flex items-center gap-2`: busca desabilitada com dica (como hoje, `hidden md:inline-flex`, ícone `Search` 18px); `ThemeToggle`; sino `Popover` ghost `size-10` `aria-label="Notificações"` sem contador, conteúdo "Nenhuma notificação por enquanto." em `text-[13px] text-text-secondary`; avatar com menu `size-10 rounded-full` com `ContactAvatar size={30}`, menu `w-60` com nome, "papel · clínica", "Trocar de clínica" (`ArrowLeftRight`, só com `canSwitchClinic`), separador, "Sair". Sem botão Ajuda (C21). Selo "WhatsApp conectado" fica para depois de C21 (exige mover o Realtime para um provider).

**Faixas (`whatsapp-status.tsx`, `motor-banner.tsx`)** (C22, provisório = suave): `<Aviso faixa tom="alert" role="alert">` com `flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--alert) bg-alert-bg px-4 py-2 text-alert-text md:px-6`; ícone WhatsApp `WifiOff`, motor `OctagonAlert`, `size-4`; texto `min-w-0 flex-1 text-[13.5px] font-semibold` alinhado à esquerda com o complemento `font-normal`. "Reconectar" continua `Link` para `/configuracoes?aba=whatsapp` com aparência `solid`: `inline-flex h-10 items-center rounded-lg bg-inverse px-3.5 text-[13px] font-semibold text-inverse-foreground`. "Verificar conexão" ghost `h-10` com `RefreshCw` 14px girando só enquanto verifica (`motion-reduce:animate-none`). Textos e lógica (polling, precedência motor sobre WhatsApp) iguais.

**Estados antes do shell (`app/(app)/layout.tsx`) e `criar-clinica.tsx`**: `main bg-background`; cartão `grid max-w-md justify-items-center gap-3 rounded-card border border-border bg-card p-8 text-center shadow-sm`; ladrilho `size-[52px] rounded-card bg-surface-4` com ícone 24px (`Hourglass text-warning-text` na pendência, `Building2 text-primary-text` na criação); título 19px bold; texto `text-[13.5px] text-text-secondary`; campo e botão `h-11`.

**`app/(app)/error.tsx`**: ladrilho `size-[52px] rounded-card bg-alert-bg` com `OctagonAlert` 24px `text-alert-text`; título `text-base font-bold`; texto `max-w-[44ch] text-[13px] text-text-secondary`; "Tentar de novo" `outline`. Texto e digest iguais.

**Altura das telas cheias (D12)**: em `app/(app)/atendimento/page.tsx`, `atendimento/loading.tsx`, `agenda/page.tsx`, `agenda/loading.tsx`, trocar `h-[calc(100dvh-3.5rem)]` por `h-full`.

**Marca**: copiar/gerar, com o script de `sharp` fora do repositório: `public/brand/conduzza-lockup-on-dark.png` (cópia fiel de `assets/logo-lockup-on-dark.png`), `public/brand/conduzza-symbol-lime.png` (`symbol-lime.png` com `trim()` e 128x128), `app/icon.png` (512, recorte 598,598 de 2804x2804 de `symbol-lime-on-dark.png`, cantos de 22%), `app/favicon.ico` (32px, substitui o do Next), `app/apple-icon.png` (180, quadro inteiro). Depois de trocar os dois usos (`app-shell.tsx:144`, `(auth)/layout.tsx:14`), apagar `public/brand/conduzza-logo-branca.webp`, `public/brand/.gitkeep` e `public/{file,globe,next,vercel,window}.svg`. `conduzza-logo-preta.png` só depois de C34. Proporção do lockup 6,086:1 (146x24, 170x28).

**Responsivo**: 1600 ou mais: rail 248 aberto; 1024 a 1599: rail 64 (brief), botão expande para 248 e guarda em cookie; 768 a 1023: gaveta; abaixo de 768: gaveta `min(248px, 85vw)`, título 17px, sem busca, gutter 16px.

**Testes**: `tests/e2e/layout.spec.ts` passa a esperar 248 em 1600, 64 em 1366 e 1024 (com o link "Atendimento" acessível por nome em "Navegação principal") e gaveta em 768. `contrast.test.ts`: `sidebar-strong` sobre `sidebar`, `sidebar-primary-foreground` sobre `sidebar-primary`.

### 5.2 Início (lote D1)
Arquivos: `app/(app)/inicio/page.tsx`, `inicio/loading.tsx`, `components/inicio/painel.tsx`, `components/inicio/checklist.tsx`, `components/relatorios/cartao-kpi.tsx`, `components/relatorios/barra-horizontal.tsx` (compartilhados com Resultados, mesmo lote).
- Contêiner (as duas ramificações): `grid w-full max-w-content content-start gap-4 p-4 md:p-6`.
- `PageHeader`: título "Início" e descrição atuais até C26. Com o OK: `eyebrow` = data no fuso da clínica (`format(new TZDate(new Date(), active.timezone), "EEEE, d 'de' MMMM", { locale: ptBR })`), `title` = "Bom dia/Boa tarde/Boa noite, {primeiro nome}" por `minutosLocais` (sem nome: "Início"), descrição montada de `proximasAcoes` já buscado ("3 confirmações pendentes para amanhã e 1 conversa aguardando você.", singular e plural corretos). Ação (não profissional): `Button variant="outline"` com `ChartColumn` e `Link href="/relatorios"` "Ver em Resultados".
- Grade do painel: `grid gap-4`; linha de período `text-xs font-medium text-text-secondary` "Últimos 30 dias, comparados com os 30 anteriores."; KPIs `grid grid-cols-2 gap-3 lg:grid-cols-4` com `CartaoKpi`; três linhas `grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]`: Herói "Consultas recuperadas" e Atendimento; Funil e Origem; Próximas ações e Mensagens.
- Moldura dos blocos: `Card` (4.5) com cabeçalho `h2` 16px bold.
- Atendimento: `<dl className="grid">` com linhas `flex items-baseline justify-between gap-2 border-b border-border py-2.5 text-[13px] last:border-0`, `dt text-text-secondary`, `dd cz-num font-semibold`. Linha da IA dentro do `DisabledWithHint` atual, `opacity-45`, valor "sem dados".
- Funil: 3 `BarraDeProgresso tom="destaque"` com rótulo `text-[12.5px] font-medium` e legenda `cz-num text-xs text-text-secondary` ("42 (38%)"); mantém `role="img"`, `aria-label` e piso.
- Origem: `BarraHorizontal` (5.9). Vazio "Nenhum lead chegou neste período."
- Próximas ações: corpo sem padding, `<ul>`; item `Link` `flex min-h-11 items-center gap-2.5 border-b border-border px-4 py-2 text-[13.5px] last:border-0 hover:bg-surface-subtle` + foco `-outline-offset-2`; ícones `CalendarClock text-text-secondary`, `Hand text-warning-text`, `AlarmClock text-alert-text`; valor `cz-num font-bold`; `ChevronRight` 16px `text-text-secondary`. Rótulos e destinos iguais.
- Mensagens: `grid grid-cols-2 gap-3`, rótulo `cz-eyebrow text-text-secondary`, valor `cz-num text-[24px] leading-none font-semibold`, nota `border-t border-border pt-3 text-xs text-text-secondary`.
- Herói (D16): `CartaoKpi heroi`: `bg-primary text-primary-foreground border-transparent p-5 gap-3 shadow-none`, rótulo e textos em `text-primary-foreground` cheio, valor `text-[40px]`, variação numa pílula `inline-flex h-6 items-center gap-1 rounded-full bg-card px-2` com a cor semântica. Único lime cheio da tela. Sem `--shadow-accent`.
- Checklist: um cartão só, cabeçalho `h2` "Primeiros passos" e `cz-num text-xs text-text-secondary` "{feitos} de {total} feitos"; `<ol className="divide-y divide-border">`, item `flex flex-wrap items-center gap-4 px-4 py-3.5`; ladrilho `size-10 rounded-xl bg-surface-4 text-foreground` com ícone 18px sempre neutro; chip "Feito" (`CircleCheck` success) ou "Pendente" (`Hourglass` warning) no StatusChip sm; ação `h-10`: primeiro pendente `solid`, demais `outline`. Correção de regra do CLAUDE.md: quem não pode configurar vê a ação desabilitada com `permissionHint(active.role, "configuracoes")` (tipo `PassoDoChecklist.acao` ganha `bloqueio?`).
- `loading.tsx`: mesma forma (cabeçalho, linha, 4 KPIs `h-[114px] rounded-card`, 3 linhas de 184, 220 e 176px).
- Não mudar: consultas e RPCs, período 30 contra 30, `pct()`, regras do delta, piso de barra, ramificação do profissional, rótulos das Próximas ações.

### 5.3 Atendimento (lote D2)
Arquivos: `app/(app)/atendimento/{page,inbox-client,loading}.tsx`, `components/atendimento/*` (conversation-list, conversation-card, thread, message-bubble, bolha-em-voo, citacao, composer, context-panel, etapa-do-contato, etiquetas-da-conversa, dialogo-apagar, media/*). Aplicar só depois de a leva de lógica fechar `message-bubble.tsx` e `lib/queries/conversations.ts`.

**Estrutura (`inbox-client.tsx`)**: raiz `@container/inbox flex h-full min-h-0`. Lista `flex w-full shrink-0 flex-col border-r border-border bg-card lg:w-inbox-list` (336px), visibilidade atual. Fio `min-w-0 flex-1 bg-background`. Contexto `hidden w-context-panel shrink-0 border-l border-border bg-card @min-[1100px]/inbox:block` (D13); o botão de contexto do cabeçalho usa `@min-[1100px]/inbox:hidden`. Abaixo disso, `Sheet` com lado calculado ao abrir (`matchMedia("(max-width: 767px)")` dá `bottom`, `max-h-[85dvh] rounded-t-modal`; senão `right`, `w-[360px]`). Props novas: `erroAoCarregar`, `aoRecarregar` (Thread) e `estadoDaAutorizacao` (ContextPanel), para os estados carregando e erro que hoje aparecem como "Sem autorização".

**Lista (`conversation-list.tsx`)**: raiz `flex h-full min-h-0 flex-col`; filtros `grid gap-[9px] border-b border-border p-3` na ordem busca, posse, situação, etiquetas.
- Busca (SearchField do DS com borda, C4): `label` `flex h-10 items-center gap-2 rounded-full border border-input bg-surface-4 px-3 cz-transition focus-within:border-focus focus-within:bg-card focus-within:ring-3 focus-within:ring-ring/55`, `Search` 15px `text-text-secondary`, `input` `h-full min-w-0 flex-1 bg-transparent text-[13px] text-text-strong outline-none placeholder:text-text-tertiary`. Placeholder e `aria-label` iguais.
- Posse: `SegmentedControl size="sm" block ariaLabel="Filtrar por responsável"` com contagem.
- Situação: grupo `role="group" aria-label="Filtrar por situação"` `flex flex-wrap gap-1.5 max-sm:flex-nowrap max-sm:overflow-x-auto`; chip `<button aria-pressed>` `hit-40 inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold` + foco; ícone de `CONVERSATION_STATUS` `size-3` (em_atendimento: círculo de iniciais "AT" `size-3.5`); desligado `border-border-strong bg-card` com `color: tone.text`; ligado `border-transparent bg-inverse text-inverse-foreground` (diferença de luminância, não de matiz). Rótulo `{label}{" "}<span className="cz-num">{n}</span>`. Resolvidas carregando: `LoaderCircle size-3 animate-spin` com `sr-only` "carregando". Erro das resolvidas (novo): `text-[11.5px] text-alert-text` "Não foi possível carregar as resolvidas." com link "Tentar de novo".
- Etiquetas: a fileira vira `Popover` com gatilho `Button variant="ghost" size="sm"` (`Tag` 14px, "Etiquetas", contador `bg-inverse text-inverse-foreground` quando houver marcadas, `ChevronDown`), `aria-label` "Filtrar por etiqueta" mais ", N marcadas". Itens `<button aria-pressed>` `flex min-h-10 w-full items-center gap-2 rounded-sm px-2 text-[13px] font-medium hover:bg-surface-3` com checkbox visual `aria-hidden`, marcador 7px e nome. Rodapé "Limpar etiquetas". Lógica (OU, poda) igual.
- Corpo `cz-scroll min-h-0 flex-1 overflow-y-auto`, cartões como filhos diretos. Vazio por filtro: `EmptyState compact` com "Limpar filtros" `outline sm`.

**Cartão (`conversation-card.tsx`)**: botão `grid w-full grid-cols-[auto_1fr] gap-2.5 border-b border-l-2 border-b-border px-3.5 py-[11px] text-left cz-transition` + foco; selecionado `border-l-primary-edge bg-primary-soft` (mantém `aria-current`); senão `border-l-transparent bg-card hover:bg-surface-subtle`. Sai a barra absoluta de 3px, o `rounded-lg` e o ponto vermelho de não lida. Avatar 36. Linha 1 `flex items-baseline gap-2`: nome `min-w-0 flex-1 truncate text-[13.5px] text-text-strong` (`font-bold` com não lidas, `font-semibold` sem); hora `shrink-0 cz-num text-[11px] text-text-tertiary`. Linha 2 `flex items-center gap-1.5`: prévia `min-w-0 flex-1 truncate text-[12.5px] text-text-secondary` (conteúdo "Paciente · Etapa", C29); não lidas `grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-[5px] cz-num text-[10.5px] font-bold text-primary-foreground` com `sr-only` " não lidas". Linha 3 `mt-px flex min-w-0 items-center gap-[5px] overflow-hidden`: `StatusChip size="sm"` (rótulos iguais), até 2 `ChipDeEtiqueta tamanho="compacto"` com `max-w-[92px]` e "+N" compacto sem marcador. Sai o círculo extra de `Sparkles`. Sem selo de canal.

**Cabeçalho do fio (`thread.tsx`)**: `flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4`; voltar `Button variant="ghost" size="icon" className="lg:hidden"` com `ArrowLeft` 18px; avatar 36; nome `truncate text-sm font-bold text-text-strong`; apoio `truncate cz-num text-[11.5px] text-text-secondary` com o telefone formatado por `formatarTelefone` e `<span className="font-sans"> · Paciente|Lead</span>`; direita `ml-auto flex items-center gap-1.5` com `StatusChip` md e o botão de contexto `outline size="icon"` `UserRoundSearch` `aria-label="Ver dados do contato"`. As ações Devolver e Resolver continuam no compositor (C29).

**Corpo do fio**: rolagem `cz-scroll min-h-0 flex-1 overflow-y-auto bg-background p-4`; interno `mx-auto flex max-w-3xl flex-col gap-2`. "Carregar mensagens anteriores" `ghost sm`. Separador de dia `self-center rounded-full border border-border bg-card px-2.5 py-[3px] text-[11px] font-medium text-text-secondary` (sai `uppercase`; rótulos "Hoje", "Ontem" ou "Terça, 22 de setembro"). Carregando: 5 esqueletos de bolha (`rounded-bubble` com o canto de 6px no lado do dono). Erro (novo): `Aviso tom="alert" titulo="Não foi possível carregar as mensagens."` "A conversa continua salva. Tente de novo em instantes." com `outline sm` "Tentar de novo". Fio vazio (novo): `py-8 text-center text-[12.5px] text-text-secondary` "Nenhuma mensagem nesta conversa ainda." Destaque da citada: `outline-2 outline-offset-4 outline-focus rounded-bubble`. Rodapé `shrink-0 border-t border-border bg-card`.

**Bolhas (`message-bubble.tsx`)**
- Linha `group flex scroll-mt-4 items-end gap-1` (`justify-start` paciente, `justify-end` demais); coluna nova `flex min-w-0 max-w-[85%] flex-col gap-[3px] sm:max-w-[68%]`.
- Linha de autor acima da bolha, fora dela, dentro do `#mensagem-{id}` (não existe para paciente): `flex items-center gap-1 px-1 text-[11px] font-semibold text-text-secondary`. IA: `Sparkles size-3 text-ai-text`, `{authorName ?? "Assistente"}` e `<span className="inline-flex h-4 items-center rounded-full bg-ai-bg px-1.5 text-[10px] font-bold text-ai-text">IA</span>` (o e2e depende do `span` "IA"). Nota: `text-warning-text` com `Lock size-3` e "{autor} · Nota interna, o paciente não vê" (texto exato). Nota fica à direita (C29).
- Bolha `grid min-w-24 gap-1 rounded-bubble border px-3 pt-[9px] pb-[7px] text-[13.5px] leading-[1.5] shadow-xs`; paciente `rounded-bl-[6px] border-border bg-card text-foreground`; atendente `rounded-br-[6px] border-transparent bg-bubble-out text-bubble-out-foreground`; IA `rounded-br-[6px] border-(--bubble-ai-border) bg-bubble-ai text-bubble-ai-foreground`; nota `rounded-br-[6px] border-(--warning)/20 bg-warning-bg text-warning-text`; apagada `border-dashed border-border-heavy bg-transparent shadow-none text-text-secondary`. Variável local `--bolha-meta` por pele: paciente `var(--text-secondary)`, atendente `var(--bubble-out-meta)`, IA `var(--bubble-ai-meta)`, nota `var(--warning-text)`.
- Hora `mt-[3px] flex items-center justify-end gap-1 cz-num text-[11px] text-(--bolha-meta)`, opacidade cheia (a 0,55 do DS dá 2,13 a 4,09).
- Falha de entrega: sai de dentro da bolha, linha abaixo na coluna `flex items-center gap-1 px-1 text-[11px] font-semibold text-alert-text` com `OctagonAlert size-3` e "Não foi entregue".
- Ações da bolha: gatilho `Button variant="ghost" size="icon"` com `Ellipsis`; "Apagar" item destrutivo.
- `SystemEventCard`: `inline-flex max-w-[80%] items-center gap-1.5 rounded-xl bg-surface-4 px-3 py-1 text-[11.5px] text-text-secondary`.
- `ComplianceBlockCard`: `<Aviso tom="alert" icone={ShieldBan} titulo="Resposta da IA bloqueada pela conformidade">` com motivo e `outline sm` "Ver o que a IA ia responder"; rascunho no diálogo `rounded-xl bg-surface-4 p-3 text-sm`. Textos iguais.
- Mídia: reservar 240x180 (`grid h-[180px] w-[240px] place-items-center rounded-xl bg-surface-4`) enquanto baixa; documento e áudio em ladrilho `flex items-center gap-2.5 rounded-md border border-border bg-card p-2.5`; `MidiaIndisponivel` no mesmo ladrilho com rótulo `text-warning-text` e `CloudOff`. Visor de foto `bg-(--overlay-media)` sem blur. Player: play `size-10 rounded-full bg-surface-4`, barra `accent-(--primary-edge)`, tempo `cz-num text-[11px] text-(--bolha-meta,var(--text-secondary))`.

**Citação (`citacao.tsx`)**: `grid w-full gap-0.5 rounded-md border-l-[3px] border-l-primary-edge bg-surface-4 py-1 pr-2 pl-2 text-left` (corrige o `var(--brand)`); na nota `border-l-(--warning-text)`; autor `text-[11px] font-semibold`; resumo `text-xs text-(--bolha-meta,var(--text-secondary))`.

**Envio em voo (`bolha-em-voo.tsx`)**: enviando = bolha da atendente tracejada `border-dashed border-border-heavy` com `SendHorizonal size-3` e "enviando"; nota tracejada em warning. Falhou: `grid gap-2 rounded-bubble rounded-br-[6px] border border-(--alert) bg-alert-bg px-3 py-2.5`, título `text-[11.5px] font-bold text-alert-text` com `OctagonAlert`, "Tentar de novo" `outline sm`, "Descartar" e "Entendi, esconder" `ghost sm`. Textos e regra do envio incerto iguais.

**Compositor (`composer.tsx`, `media/barra-de-anexo.tsx`)**
- Avisos de estado viram `Aviso`: resolvida success `CircleCheck` com `outline sm` "Reabrir e responder"; ia_atendendo `tom="ia"` `Sparkles` com `default sm` "Assumir conversa"; aguardando_humano warning `Hand` com `default sm` "Assumir conversa"; de outra pessoa neutral com as iniciais de quem atende (não `Hand`, que já é âmbar em outro lugar) e `default sm` "Assumir do colega". Textos exatos iguais.
- Ativo: raiz `grid gap-2 px-4 py-3` (nota: `bg-warning-bg`). Linha 1: `SegmentedControl size="sm" ariaLabel="Para quem vai o texto"` (Responder, Nota interna com `Lock`), à direita "Devolver para a IA" `ghost sm` e "Resolver" `outline sm`.
- Casca do campo `flex items-end gap-2 rounded-card border border-input bg-surface-subtle p-2 cz-transition focus-within:border-focus focus-within:ring-3 focus-within:ring-ring/55` (nota: `border-(--warning-text) bg-card`); textarea `field-sizing-content min-h-[52px] max-h-[120px] flex-1 resize-none border-0 bg-transparent px-1 py-[5px] text-[13.5px] leading-[1.5] outline-none placeholder:text-text-tertiary` (rótulos e placeholders iguais).
- Enviar: `Button` default `h-10` com `Send` e "Enviar" (D23, C29). Salvar nota: `variant="solid"` com `Lock` e "Salvar nota".
- Anexo: botões `ghost size="icon"` `Paperclip`/`Mic` 18px com Tooltip "Anexar arquivo" e "Gravar nota de voz"; gravando `inline-flex h-10 items-center gap-1.5 rounded-lg bg-alert-bg px-3 text-[13px] font-semibold text-alert-text` com `Square`, "Gravando" e `cz-num m:ss`; prévia `grid gap-2 rounded-xl border border-border-strong bg-card p-2.5 shadow-xs`; enviar arquivo `solid` (um lime só na tela). Arrastar e soltar: `outline-2 outline-dashed -outline-offset-4 outline-primary-edge` e aviso `rounded-xl border border-dashed border-primary-edge bg-primary-soft text-primary-text`.

**Painel de contexto (`context-panel.tsx`)**: raiz `cz-scroll flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4` (sem bordas entre seções); título de seção `cz-eyebrow text-text-secondary`. Ordem: (1) identidade centralizada, `ContactAvatar size={56}`, nome `text-[15px] font-bold`, telefone `cz-num text-xs text-text-secondary`, chip de tipo neutral sm (`UserRound` Paciente, `UserPlus` Lead), ações em bloco `outline` `w-full` "Marcar consulta" (`CalendarPlus`) e "Adicionar à lista de espera" (`Hourglass`), sem permissão via `DisabledWithHint className="w-full"`; (2) "Etiquetas"; (3) "Etapa da jornada" (`SelectTrigger h-10 w-full`, `aria-label="Etapa da jornada"`); (4) "Autorização de mensagens" em bloco `flex items-start gap-2.5 rounded-md px-2.5 py-2.5` no tom do `CONSENT_STATUS`, com esqueleto no carregando e bloco neutral "Não foi possível verificar a autorização." no erro; (5) "Origem" com Canal, Campanha e Primeiro contato; (6) "Agendamentos e histórico" com links `outline`. Etiquetas aplicadas: `ChipDeEtiqueta` com `aoRemover`; "Etiquetar" `ghost sm` com `Plus`.

**Diálogo de apagar**: `sm:max-w-[440px]`; opção `grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 rounded-xl border border-border-strong bg-card p-3 text-left hover:bg-surface-subtle` + foco; ícones `Trash2 text-alert-text` e `CircleSlash text-text-secondary`. Textos iguais.

**`loading.tsx`**: lista 336 com cabeçalho (busca `h-10 rounded-full`, posse `h-10 rounded-lg`, chips) e 8 linhas; fio com cabeçalho `h-16`, 5 bolhas e compositor `h-[60px] rounded-card`; contexto `hidden w-context-panel` visível pelo mesmo container query. Esqueleto `bg-surface-4`.

**Não mudar**: estado no InboxClient, `key` do Composer, Realtime, ordenação, regras de apagar, citar, Enter e Ctrl+Enter; textos lidos pelo e2e ("Todas N", "IA atendendo N", "Aguardando você N", "A IA está atendendo esta conversa.", "Outra pessoa está com esta conversa.", "Assumir conversa", "Resposta ao paciente", "Enviar", `span` "IA", "Nota interna, o paciente não vê", "Transcrição:", "ver mais", "Resposta da IA bloqueada pela conformidade", "Ver o que a IA ia responder", "Rascunho bloqueado", "... assumiu a conversa"); mídia em 240x180; rótulo "Assistente".

### 5.4 Leads (lote D3)
- `app/(app)/leads/page.tsx`: tira `PageHeader` e `AvisoCelular` (vão para o cliente, para as ações ficarem no slot direito).
- `leads-client.tsx`: raiz `flex flex-col gap-3.5 p-6`. `PageHeader title="Leads"` com descrição atual e ações na ordem: `SegmentedControl` Kanban/Lista (`Columns3`, `List`) dentro de `hidden lg:contents`, `BotaoProtegido variant="outline"` "Importar planilha" (`Upload`), `BotaoProtegido` default "Novo lead" (`Plus`, único lime). `AvisoCelular`. `FiltrosLeads` numa linha `flex flex-wrap items-center gap-2` fora de cartão. Erro com dado velho: `Aviso tom="warning"` com "Tentar de novo" ghost. Erro sem dado: Card com `EmptyState tom="erro"`. Carregando kanban: `jornada.length` colunas de esqueleto. Vazio inicial: `EmptyState` (`UsersRound`) com "Criar lead" e "Importar planilha" os dois `outline`. Vazio por filtro: `compact` com `SearchX` e "Limpar filtros".
- `filtros-leads.tsx`: `SelectTrigger h-10 min-w-[128px] max-w-[200px] text-[13px] shadow-xs`; datas `h-10 w-[150px] cz-num`; "Limpar filtros" ghost. `aria-label` e ordem iguais.
- `kanban-board.tsx`: `grid grid-flow-col auto-cols-[minmax(228px,1fr)] items-start gap-3 overflow-x-auto pb-2 cz-scroll`; board no fluxo da página.
- `kanban-coluna.tsx`: `section` `flex min-h-[320px] min-w-0 flex-col gap-[9px] rounded-card bg-surface-4 p-2.5` (sem borda); `isOver` `ring-2 ring-inset ring-primary-edge bg-primary-soft`; cabeçalho `flex h-7 items-center gap-[7px] px-1` com o ÍCONE da etapa `size-3.5` em `tone.text` (não o quadrado de 7px, C8), rótulo `text-[12.5px] font-bold`, contagem `cz-num text-xs text-text-secondary`; vazio `px-2 py-[18px] text-center text-xs text-text-secondary` "Nenhum lead nesta etapa" (texto exato), sem tracejado. `aria-label` igual. Sem botão "+" (C25).
- `lead-card.tsx`: botão `grid w-full gap-2 rounded-xl border border-border bg-card p-[11px] text-left shadow-xs transition-[box-shadow,transform] duration-(--dur-fast) hover:-translate-y-px hover:shadow-md` + foco; `cursor-grab` com permissão; arrastando `shadow-pop cursor-grabbing` (sai `opacity .85`). Conteúdo do brief (5 elementos): nome `truncate text-[13px] font-semibold text-text-strong`; telefone `truncate cz-num text-xs text-text-secondary`; linha `flex flex-wrap items-center gap-1` com origem em chip neutral sm, recência `StatusChip size="sm"` e responsável `ContactAvatar size={24}` com `ml-auto` e `title`. Sai o `absolute` e o `pr-6`. `aria-label="Abrir …"` igual.
- `lista-leads.tsx`: `DataTable` dentro de Card, `variant="bare" stickyHeader isRowSelected`, `containerClassName="max-h-[min(720px,calc(100dvh-16rem))]"`. Colunas do brief na ordem atual; seleção com checkbox (cabeçalho indeterminado); nome `flex h-10 items-center gap-2 font-semibold` com avatar 24; telefone `cz-num`; etapa `StatusChip sm`; "Entrou em" à direita `cz-num`; autorização com o ícone do `CONSENT_STATUS` 15px e o texto ("Autorizado", "Sem autorização").
- `barra-acoes-massa.tsx`: `fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-card border border-border-strong bg-card px-3 py-2 shadow-pop`; contador `cz-num` e divisor `h-6 w-px bg-border`; botões `outline h-10`, "Limpar seleção" ghost; popovers na casca do Dropdown; etiqueta removível do lead como Tag sem marcador (`h-7 rounded-sm border border-input`, `hit-40` no X). "Disparar régua" desabilitado com dica, igual.
- `drawer-lead.tsx`: `SheetContent` `flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]`; cabeçalho com avatar 44, título 19px, telefone `cz-num`, chips md; corpo rolando com seções de `cz-eyebrow` ("Dados", "Conversa"), linhas `grid grid-cols-[120px_1fr]`, mensagens `rounded-xl bg-surface-4 px-3 py-2` (autor em texto, sem cor de IA); rodapé `bg-surface-subtle` com "Abrir conversa" e "Agendar" `outline w-full` e "Marcar perdido" `destructive` (`UserRoundX`).
- `modal-motivo-perda.tsx` (420), `modal-novo-lead.tsx` (480), `importacao/*` (640): casca do Dialog; rádios `min-h-10`; "Marcar como perdido" e "Criar lead" primários; stepper com círculo `size-6 cz-num` (feito success com `Check`, atual `bg-primary`, futuro `border border-input`); dropzone `rounded-card border border-dashed border-input bg-surface-subtle` com ladrilho `bg-primary-soft`; opção de consentimento com o selecionado da receita 4.7; aviso `Aviso tom="warning"` mantendo `role="note"`; resumo mantendo `dl > div`; progresso `BarraDeProgresso`.
- Não mudar: arrasto com `PointerSensor` de 8px, rollback, Perdido pelo papel da etapa, ordenação, filtros na URL, lista forçada abaixo de 1024, auditoria, textos e ganchos do e2e.

### 5.5 Pacientes (lote D3)
- `pacientes/page.tsx`: wrapper `flex flex-col gap-3.5 p-6`; `PageHeader` sem ações (C25).
- `pacientes-client.tsx`: Card `flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm` com barra de filtros no topo `flex flex-wrap items-center gap-2 border-b border-border p-3` e corpo (aviso de erro, `TableSkeleton`, `EmptyState` sem borda com ação `outline` "Abrir a agenda", ou a lista). KPIs só com C28.
- `filtros-pacientes.tsx`: `ChaveFiltro` `inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold cz-transition`; desligada `border-border-strong bg-card text-text-secondary`; ligada `border-primary-edge bg-primary-soft text-text-strong` com `Check` 14px `aria-hidden`. `aria-pressed` e nomes iguais ("Com falta", "Inativos", "Com pacote").
- `lista-pacientes.tsx`: `variant="bare" stickyHeader`; nome `Link` `flex h-10 items-center gap-2 font-semibold` com avatar 24 (`prefetch={false}` e `aria-label` iguais); telefone, última e próxima consulta `cz-num` (datas à direita); saldo `cz-num` "3 sessões"; sinais automáticos `StatusChip sm`.
- `comum.tsx`: `SemDado` mostra o texto do campo vazio em `text-text-secondary` pela receita 4.7 ("Nenhuma ainda" na última consulta, "Ainda não medido" no comparecimento, "Nenhum" nos sinais), nunca hífen (ajuste do dono na revisão da leva 2); `BarraComparecimento` e `BarraSessoes` usam `BarraDeProgresso tom="neutro"` (`tamanho` sm na lista, md na ficha); `BlocoFicha` vira Card com cabeçalho (continua `section` + `h2`, o e2e procura); `LinhaDaFicha` pela receita 4.7.
- Ficha `pacientes/[id]/page.tsx`: `mx-auto flex w-full max-w-content flex-col gap-4 p-6`; voltar `ghost h-10 -ml-2.5` com `ArrowLeft`; ordem igual; duas colunas `grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]`.
- `cabecalho-paciente.tsx`: avatar 56; `h1` 24px bold (continua h1); meta `flex flex-wrap items-center gap-x-2 text-[13px] text-text-secondary` com telefone e carteirinha `cz-num`; chips md.
- `indicadores-paciente.tsx`: StatCard (4.7) em `grid gap-3 sm:grid-cols-3`; o ícone fica DENTRO do `span` do rótulo, e esse `span` é filho direto do cartão (o helper `cartao()` do e2e sobe um nível a partir do rótulo); ícones `CalendarCheck`, `CalendarMinus2`, `Percent` em `var(--neutral)`; sem lime (o lime da ficha é "Salvar cadastro").
- `linha-do-tempo.tsx`: continua `ol`/`li`; `li` `relative grid grid-cols-[12px_minmax(0,1fr)] gap-3 pb-4 last:pb-0`, marcador `size-2.5 rounded-full ring-[3px] ring-card` em `tone.marker`, conector `absolute top-5 -bottom-0 left-[5px] w-px bg-border-heavy`; data `cz-num text-[12.5px] text-text-secondary`, procedimento `text-sm font-semibold`, `StatusChip` md com os 10 status e preço `cz-num`.
- `dados-cadastrais.tsx`: campos 4.5, CPF/telefone/carteirinha `cz-num`; "Salvar cadastro" único primário.
- `pacotes-paciente.tsx`: "Vender pacote" `outline sm`; vencido `text-alert-text` com `CalendarX2`, válido `CalendarRange`; modal 420.
- `autorizacao-mensagens.tsx`: `Selo` vira `StatusChip` com `CONSENT_STATUS`; "Descadastrar" `destructive sm`; "Registrar (nova) autorização" `outline sm`; rótulos "Evidência (obrigatória)" e "Descadastrada em" iguais.
- `acoes-paciente.tsx`: `grid gap-2 [&>span]:w-full`, 3 botões `outline h-10 w-full`.

### 5.6 Agenda (lote D4)
- `agenda-client.tsx`: raiz `flex h-full min-h-0 flex-col gap-3.5 px-6 pt-4 pb-6`; `FilterBar`; linha `flex min-h-0 flex-1 gap-4` com a grade `min-w-0 flex-1 overflow-auto rounded-card border border-border bg-card shadow-sm cz-scroll` e o `PendingPanel`. Sem PageHeader (como hoje; o título está na barra superior). Vazios dentro do cartão da grade, textos iguais.
- `filter-bar.tsx`: `flex flex-wrap items-center gap-2` sobre o canvas (sai `border-b bg-surface-1`); anterior e seguinte `outline size="icon"`; data `outline h-10 cz-num text-[13px] font-semibold`; `SelectTrigger h-10 min-w-[120px] max-w-[180px] text-[13px]` na ordem atual; Dia/Semana com `SegmentedControl` (sem "Mês"); "Novo agendamento" default `h-10` (único lime); menu de três pontos `ghost size="icon"`.
- `day-grid.tsx`: `ALTURA_HORA_PX = 96` fica. Calha de 62px `bg-card border-r border-border`, rótulos no topo da hora (`top: i*ALTURA_HORA_PX + 4`, sem `-translate-y-1/2`) `absolute right-2.5 cz-num text-[11px] font-medium text-text-tertiary`. Cabeçalho da coluna `sticky top-0 z-10 flex h-[62px] items-center gap-2.5 border-b border-border-strong bg-surface-subtle px-3` com avatar 32, nome `text-[13px] font-bold`, linha 2 `text-[11px] text-text-secondary`. Linhas: hora `border-t border-border-strong`, :30 `border-border`, :15 e :45 `border-dashed border-border`, todas `pointer-events-none`. Bloqueio: `pointer-events-none absolute inset-x-0.5 z-[1] flex items-start overflow-hidden rounded-md border border-border-strong p-1` com `backgroundColor: var(--surface-4)` e `backgroundImage: repeating-linear-gradient(45deg, var(--border-heavy) 0 1px, transparent 1px 8px)` (C19), rótulo em chip sólido `rounded-sm bg-card px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary` com `Ban` 12px e o motivo. Hold da IA: `border border-dashed border-(--ai) bg-ai-bg`, sem `opacity-70`, `Sparkles` e texto `text-[11px] font-semibold text-ai-text` "Reservado pela IA, {n} min" num nó só. Linha de agora `border-t-2 border-(--alert)` com ponto de 8px; marcador novo na calha `rounded-full border border-(--alert) bg-alert-bg px-1.5 cz-num text-[11px] font-semibold text-alert-text` com a hora no fuso da clínica, `aria-hidden` e `pointer-events-none`. Nunca lime. Diálogo de remarcar por arrasto: switch em `rounded-xl border border-border`, erro `Aviso tom="alert"`, botões `h-10`.
- `appointment-block.tsx`: `absolute z-[3] flex overflow-hidden rounded-md text-left transition-shadow duration-(--dur-fast) hover:shadow-sm` + foco `outline-offset-1`; `style` `backgroundColor: tone.bg`, `borderLeft: 3px solid tone.marker`, `top + 1`, `height - 2` (mínimo 20); encaixe `border: 1px dashed tone.marker` com o deslocamento de 8px. Sem `translateY` no hover (colide com o dnd-kit). Três faixas: menos de 48px, uma linha (nome 13px semibold e ícone do status 14px no canto); 48 a 71px, três linhas de 14px (nome; "Procedimento · Convênio" 11px `text-text-secondary`; rótulo do status 11px semibold em `tone.text` com os sufixos atuais); 72px ou mais, acrescenta no topo `cz-num text-[11px] font-semibold` em `tone.text` "08:00 às 08:30" (nunca meia-risca). Encaixe: `Zap` 12px e " · Encaixe" na linha do rótulo. `aria-label`, nome sem repetição e `useDraggable` iguais.
- `week-grid.tsx`: 48px por hora e 07:00 a 19:00 ficam; rótulos 11px; cabeçalho do dia `h-[42px] border-b border-border-strong bg-surface-subtle text-xs font-semibold text-text-secondary`; hoje `bg-primary-soft text-primary-text shadow-[inset_0_-2px_0_var(--primary-edge)]` com " · hoje" em texto (corrige `var(--brand)`); erro do dia `rounded-md bg-alert-bg p-2 text-[11px] text-alert-text` com `OctagonAlert`.
- `appointment-menu.tsx`: casca do Dropdown `w-72`; cabeçalho nome `text-sm font-bold`, telefone e horário `cz-num`; rótulos de grupo `cz-eyebrow text-text-tertiary` (com `text-[11px]`? não: 10px do eyebrow); itens com ícone em `tone.text`. "Confirmar falta" `destructive`.
- `pending-panel.tsx`: `aside` (nome "Pendente de você") `hidden w-[264px] shrink-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm xl:flex`; cabeçalho `flex h-12 items-center border-b border-border px-4` com `h2` 16px bold; vazio `EmptyState compact` com ladrilho `bg-ai-bg` e `Sparkles text-ai-text`; item `rounded-xl border border-border p-3` com `StatusChip` "Encaixe da IA"; "Aprovar" `variant="secondary"` (soft) e "Recusar" `outline`, `h-10 flex-1`; legenda com ícones em `tone.text`.
- `agendamento-modal.tsx`: `sm:max-w-[640px]`; horários `h-11 min-w-24 cz-num text-base font-semibold`, não selecionado `outline`, selecionado pela receita "Escolha em chip" com `Check aria-hidden` (nome acessível continua `^\d{2}:\d{2}$`); aviso de recurso `Aviso tom="warning"` com `CircleAlert`; erro `Aviso tom="alert"`; "Marcar consulta" único primário.
- `status-history-sheet.tsx`, `agenda-actions-menu.tsx`: só tokens; linhas `min-h-10 border-b border-border`, hora `cz-num`. `print-day.tsx`: não mudar.
- `loading.tsx`: moldura nova.
- Não mudar: geometria (96/48 px, faixa de 15 min, coluna de 180px), lanes, sensor de 8px, clique no vão por `event.target === event.currentTarget` (todo elemento novo com `pointer-events-none`), cancelados fora da grade, ordem dos filtros, só Dia e Semana.

### 5.7 Confirmações (lote D5)
- `page.tsx`: `flex flex-col gap-3.5 p-6`; eyebrow opcional com a data.
- `confirmacoes-client.tsx`: abas `TabsList variant="segmented"` (2 vistas, D11), `role=tab` mantido, contagem de faltas na pílula; "Mensagens automáticas" `outline h-10` (nome único na página); navegação de dia com setas `outline size="icon"`, data `h-10 w-[168px] cz-num`, "Voltar para amanhã" ghost; erro total `EmptyState tom="erro"` (`OctagonAlert`); erro parcial `Aviso tom="alert"` com `outline` "Tentar de novo"; dia vazio `EmptyState` com `CalendarCheck`.
- `cartoes-do-dia.tsx`: grade igual (`sm:grid-cols-2 lg:grid-cols-5`, herói `sm:col-span-2`); receita StatCard com ícone num quadrado `size-7 rounded-md` em `tone.bg`/`tone.text`; rótulos no DOM exatamente "Pendentes", "Confirmadas", "Canceladas", "Recuperadas" (caixa alta só por CSS); herói Pendentes branco com valor 34px e "Cobrar todas as N" default `h-10` (único lime); demais 24px; Recuperadas com tom fixo success.
- `lista-confirmacoes.tsx`: um cartão; mantém `section > h2 + ul > li`; grade CSS `xl:grid-cols-[56px_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(176px,auto)_minmax(200px,auto)_auto]`; cabeçalho de colunas só no xl, `aria-hidden`, `sticky top-0 h-9 border-b border-border-strong bg-surface-subtle px-3.5 cz-eyebrow text-text-secondary`; grupo `h2` `border-b border-border bg-surface-subtle px-3.5 py-2 text-[13px] font-bold`; linha `min-h-14 border-b border-border px-3.5 py-2 hover:bg-surface-subtle`; hora `cz-num text-[13px] font-semibold`; "Cobrar agora" `outline h-10`. Filtro e busca só com C27.
- `chip-do-toque.tsx`: forma do StatusChip md; ícones `MailWarning` (pulado), `Mail` (na fila), `MailCheck`, `MailX`.
- `lista-faltas.tsx`: mesmo cartão; "Ligar" desabilitado com dica "Sem telefone cadastrado" quando não há telefone (hoje some); nota do rodapé `bg-surface-subtle`.
- `painel-regua.tsx` e `controles-da-regua.tsx`: ver 5.10 (mesmo lote).
- `loading.tsx`: 5 cartões e lista com cabeçalho de colunas.

### 5.8 Lista de espera (lote D6)
- `page.tsx`: `flex flex-col gap-3.5 p-6`; PageHeader igual.
- `espera-client.tsx`: barra `flex flex-wrap items-center justify-end gap-2` com "Configurar reoferta" `outline` e "Adicionar manualmente" default (único lime); corpo `grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]`, fila `order-2 xl:order-1`, lateral `order-1 grid gap-3.5 xl:order-2 xl:sticky xl:top-6` (abaixo de 1280 a lateral fica no topo, como o brief pede).
- `fila.tsx`: cartão; mantém `ol`/`li` e dnd-kit; colunas xl `grid-cols-[40px_44px_minmax(0,1.4fr)_144px_minmax(0,1fr)_104px_auto]` com cabeçalho `aria-hidden`; alça `ghost size="icon"`; posição "1º" `cz-num text-[13px] font-semibold text-text-secondary` (sem Alta/Média/Baixa, C25); telefone e data `cz-num`; subir e descer `ghost size="icon"`; Remover `ghost h-10 text-alert-text hover:bg-alert-bg`; soltar `ring-2 ring-inset ring-primary-edge`; vazio `EmptyState` com `ListOrdered`.
- `faixa-reoferta.tsx`: cartão `flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm` "Reoferta em andamento"; vaga `rounded-md bg-info-bg px-3 py-2.5` com `Send` e hora `cz-num text-info-text`; destinatários com `Hourglass` warning (aguardando) e `ThumbsDown` neutral (recusou), textos iguais; "Cancelar reoferta" `outline w-full` com `X`. Sem oferta: cartão com `EmptyState compact` "Nenhuma vaga em reoferta agora".
- `painel-metricas.tsx`: Card "Desempenho da lista" com 3 linhas de número (ícone, rótulo, valor `cz-num text-base font-semibold`), `TimerReset` no tempo médio, sem barra.
- `modal-adicionar.tsx`, `dialog-config.tsx`: casca do Dialog; chips de turno e dia pela receita "Escolha em chip".

### 5.9 Resultados (lote D1)
- `relatorios/page.tsx`: wrappers `mx-auto grid w-full max-w-content content-start gap-4 p-6` (mantém `print:hidden`); eyebrow opcional com o recorte ("ÚLTIMOS 30 DIAS" ou "26/08/26 A 24/09/26", nunca meia-risca).
- `relatorios-client.tsx`: datas `h-10 w-[152px] cz-num`; "Últimos 30 dias" ghost; Exportar `outline`; abas `TabsList` `line` (5 vistas); erro `Aviso tom="alert"`.
- `cartao-kpi.tsx`: receita StatCard; herói conforme D16 (só o Início usa); variação e texto de polaridade iguais; número em `cz-num`.
- `barra-horizontal.tsx`: grade `grid min-h-7 grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3`; rótulo `truncate text-[13px]`; trilho `h-2 overflow-hidden rounded-full bg-surface-4`; preenchimento `var(--chart-bar)` com destaque, `var(--chart-bar-muted)` sem; valor `cz-num text-[13px]`; prop opcional `total` que acrescenta " · 44,0%" (também no `aria-label`). Piso de 3% e `role="img"` iguais.
- Seções (`aba-origem`, `aba-agendamentos`, `aba-confirmacao`, `aba-ia`, `aba-custos`, `conversoes-meta-secao`): viram Card com cabeçalho (ícone 16px, `h2` 16px bold, metadado 13px) e corpo `grid gap-3 p-4` (`p-0` com tabela); ladrilhos internos pela receita de bloco afundado com números `cz-num`; na aba IA o `--` vira "Ainda não medido" com `opacity-45` e a dica atual.
- Seletor de dimensão: Select até C33.
- `loading.tsx`: mesmo wrapper, `rounded-card`.
- Não mudar: queries, chaves, `?aba=&de=&ate=`, CSV e impressão, polaridade, notas de honestidade, visão do profissional. Porcentagem com 1 casa só com OK (muda o CSV).

### 5.10 Automações (lote D5, com `controles-da-regua` e `painel-regua`)
- `page.tsx`: `mx-auto grid w-full max-w-content content-start gap-4 p-6`; eyebrow do grupo do rail ("Inteligência").
- `automacoes-client.tsx`: as pílulas viram 4 cartões seletores, ainda Radix Tabs (`role=tab`, setas, `?aba=` iguais) com `TabsList variant="cartoes"` `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`. `TabsTrigger` com `aria-label={rótulo}` e `aria-describedby` para a situação: `h-auto min-h-[88px] items-start justify-start gap-3 whitespace-normal rounded-card border border-border bg-card p-3.5 text-left shadow-sm transition-[box-shadow,transform,background-color] duration-(--dur-base) hover:-translate-y-px hover:shadow-md data-active:border-primary-edge data-active:bg-primary-soft motion-reduce:transform-none`; ladrilho `size-[34px] rounded-md` (ligada `bg-primary-soft text-primary-text`, senão `bg-surface-4 text-text-secondary`) com `CalendarCheck`, `CalendarX`, `Repeat`, `Hourglass`; nome `text-[13.5px] font-bold`; situação com `StatusChip sm` de `REGUA_STATUS` e `cz-num text-[11px] text-text-secondary` "{n} enviadas em 24 h" (dado já existente). Aba espera: cartão com `Hourglass` e "Abrir a Lista de espera" `outline`.
- `aba-regua.tsx`: prop `aninhada` (dentro de exceção ou follow-up, blocos sem borda separados por `border-t`); ordem: Card com `ControlesDaRegua`; Card "As mensagens da régua" (ação "Adicionar mensagem" `outline`) com `LinhaDoTempo`, barra do passo (`ghost` "Mudar o momento", `ghost` "Testar no WhatsApp da clínica", `destructive` "Excluir mensagem" com `ml-auto`, desabilitados com dica sem permissão) e `EditorDePasso`; Card "Últimos 30 dias" com `MetricasDaRegua`; estimativa em bloco afundado com `Coins`.
- `controles-da-regua.tsx` (compartilhado): faixa `flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-4 px-3.5 py-3` com `StatusChip` de `REGUA_STATUS` (rótulos exatos) e `Switch` md com `aria-label` igual; travado: switch desabilitado e dica no MESMO pai (o e2e foca o pai); prova de trabalho em `text-[12.5px] text-text-secondary` com números `cz-num font-semibold`; "Começa às"/"Termina às" `cz-num` em `grid grid-cols-2 gap-3 sm:max-w-[360px]`; dias pela receita "Escolha em chip" (`h-10 min-w-11`, nome longo no `aria-label`); "Salvar horário" `outline`; diálogo da primeira ativação 420 com `Aviso tom="warning"` e "Anotei, pode ligar" primário (textos exatos).
- `linha-do-tempo.tsx`: ponto `h-10 rounded-full border border-border-strong bg-card px-3.5 text-[12.5px] font-semibold shadow-xs hover:bg-surface-subtle`; selecionado (`aria-pressed`) `border-transparent bg-inverse text-inverse-foreground shadow-none`; sem texto: `MessageSquareDashed` 14px `text-warning-text` e "(sem texto)".
- `editor-de-passo.tsx`: `grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]`; textarea `min-h-[168px] text-sm` com contador `cz-num text-[11px]` "{n}/2000"; chips de campo `h-[30px] rounded-sm border border-border-strong bg-card px-2 cz-num text-[11.5px] shadow-xs hit-40` em `flex flex-wrap gap-x-1.5 gap-y-2.5`; anexo em bloco afundado; campo desconhecido `Aviso tom="warning"`; "Salvar texto" único primário.
- `balao-whatsapp.tsx` (C30): moldura `grid gap-2 rounded-card bg-surface-4 p-3.5`; bolha do paciente `max-w-[320px] justify-self-start rounded-bubble rounded-bl-[6px] border border-border bg-card px-3 pt-[9px] pb-[7px] text-[13.5px] leading-[1.5] shadow-xs`; botões Confirmar/Remarcar/Cancelar em fileiras `h-9 border-t border-border text-[13px] font-semibold text-foreground` com `Reply` 14px (sai o `text-primary`); hora `cz-num text-[11px] text-text-secondary` sem opacidade. `aria-label` igual.
- `metricas-da-regua.tsx`: 4 StatCards afundados `grid grid-cols-2 gap-3 sm:grid-cols-4`, valor `cz-num text-2xl`; "Não saíram" com `SkipForward`.
- `dialog-passo.tsx` (420), `excecoes.tsx`, `aba-followup.tsx`: cada régua em Card com cabeçalho de acordeão (`ChevronDown`, nome, recorte, `StatusChip sm` Ligada/Desligada, "Excluir" `destructive`); vazios `EmptyState compact`; modo "Mensagem fixa" como cartão selecionado (receita 4.7) e "Deixar a IA escrever" com `opacity-45` dentro do `DisabledWithHint` (dica atual, quebrando linha); sem autorização `Aviso tom="info"`.
- `painel-regua.tsx`: Sheet sem rodapé; alternância Confirmação/Depois da falta com `SegmentedControl` (continuam `button`); passos em bloco afundado; "Editar em Automações" `text-primary-text` com `ArrowUpRight`.
- `loading.tsx`: 4 cartões de 88px e editor.
- Não mudar: `?aba=`, ordem das abas, travas (janela obrigatória, linha de base, última mensagem não se exclui, IA desligada até o filtro CFM), toasts, textos do e2e.

### 5.11 Cadastros (lote D7)
- `page.tsx`: `mx-auto grid w-full max-w-content content-start gap-4 p-6`; `PageHeader` "Cadastros" (heading exato do `layout.spec`), eyebrow "Administração".
- `cadastros-client.tsx`: 8 abas `line` com contador `catalogo.*.length`; rótulos iguais.
- `comum.tsx`: `BotaoProtegido` sempre `h-10`, padrão primário (o "Novo X" é o único lime da aba), aceita `outline`, `ghost`, `destructive`; `chipAtivo` sai para `StatusChip sm` com `RECORD_STATUS` (apagar depois de migrar as 5 abas, conferindo `grep`).
- Abas com tabela (`profissionais`, `procedimentos`, `convenios`, `pacotes`, `recursos`, `unidades`, `bloqueios`): `DataTable`; editar `ghost size="icon"` `Pencil`; folhas com rodapé fixo (`bg-surface-subtle`, "Cancelar" ghost e "Salvar" primário) e erro como `Aviso tom="alert"` acima do rodapé; vazio `EmptyState` com ação `outline`. Nome do profissional com `ContactAvatar size={30}` e ponto da cor da agenda `absolute -right-px -bottom-px size-2.5 rounded-full border-2 border-card` (cor é dado da clínica, único inline aceito); especialidades em chip neutral sm até 3 e "+N"; conselho `cz-num`; preço e duração à direita `cz-num`, vazio "Sem preço fixo"; IA com `IA_AGENDA_STATUS`; bloqueios "14/08 às 14:30". Formulários com Salvar trocam Switch por Checkbox (C31). `COR_PADRAO = "#84cc16"` em `profissionais-tab.tsx` fica (é dado, cor de agenda), registrado como constante de domínio.
- `vinculos-tab.tsx`: um Card por profissional mantendo `AccordionItem` (`data-slot="accordion-item"`); gatilho com o texto contínuo "Dr. João Pereira · CRM 12345 · Endocrinologia, Nutrologia" (nome acessível exato, espaços preservados), contador fora do gatilho; "Adicionar" `outline` (texto exato); menu `Ellipsis`; tabela densa dentro; "Coberto" como `StatusChip sm` info `Umbrella` (o `ShieldCheck` é da autorização para receber mensagens, tabela de ícones reservados da seção 4.6); Switch sm da IA com `hit-40`; modo de preço como `SegmentedControl` de 3 com `aria-pressed` ("Coberto pelo convênio" exato).
- `loading.tsx`: 8 abas sublinhadas, botão e tabela.
- Não mudar: 8 abas, colunas do app (C25), textos dos diálogos, "Coberto" como rótulo, matriz em acordeão.

### 5.12 Configurações e onboarding do WhatsApp (lote D8)
- `page.tsx`: igual a Cadastros, eyebrow "Administração".
- `configuracoes-client.tsx`: 5 abas `line` com contadores (equipe ativa, com segundo contador warning de pendentes `aria-label="{n} aguardando liberação"`; jornada; etiquetas). Aba equipe em Cards, nesta ordem: pendentes; "Usuários e permissões" (título exato); "Convidar por e-mail"; "Código da clínica"; "O que cada papel pode fazer".
- `equipe-client.tsx` › `PendentesList`: Card com `Aviso tom="warning" icone={Hourglass}` no topo (`rounded-none`); linhas `ul.divide-y` com avatar 30, Select `h-10 w-44` `aria-label="Papel"`, "Liberar" `solid h-10` e "Recusar" `ghost h-10`.
- `CodigoAcesso`: Card com Switch md "Aceitar entrada por código" no cabeçalho; código `inline-flex h-11 items-center rounded-lg bg-surface-4 px-4 cz-num text-xl font-semibold tracking-[0.3em]`; "Copiar" e "Gerar novo" `outline h-10`.
- `invite-form.tsx`: `grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto]`, "Convidar por e-mail" primário (lime da aba), submit dentro do `form`; retorno com `OctagonAlert text-alert-text` ou `CircleCheck text-success-text` (passam a ter cor com a Etapa A).
- `lista-equipe.tsx`: continua `ul` (a matriz é a ÚNICA `table` da aba); linha com avatar, nome, "(você)", e-mail; sem acesso: `StatusChip sm` "Sem acesso" e `bg-surface-4` na linha no lugar do `opacity-70`; Select `aria-label="Papel de {nome}"` exato; "Tirar acesso"/"Reativar" `outline h-10`; confirmação 420 com `destructive`.
- `painel-papeis.tsx`: papéis em blocos afundados `grid gap-3 sm:grid-cols-2 lg:grid-cols-3`; matriz somente leitura (C25) com `StatusChip sm` de `ACCESS_LEVEL_STATUS` por célula, ícone `aria-hidden`, texto de `ACCESS_LABELS` igual, primeira coluna `sticky left-0 bg-card`; sai `COR_DO_ACESSO`.
- `jornada-tab.tsx`: Card "Etapas da jornada" com "Nova etapa" `outline`; etapa em linha afundada com índice `cz-num`, `StatusChip` da etapa, "sistema" neutral com `Lock`, conversão `CONVERSAO_STATUS`, subir/descer `ghost size="icon"`, "Editar" `ghost h-10`; aberta em `rounded-xl border border-border bg-card p-4 shadow-xs` com os switches da conversão como Checkbox (salvam com o formulário) e rodapé "Salvar" primário, "Cancelar" ghost, "Excluir" `destructive`.
- `etiquetas-tab.tsx`: Card "Etiquetas da clínica"; linhas com `ChipDeEtiqueta` padrão, uso `cz-num`, "Editar" ghost; edição inline em bloco afundado; "Excluir etiqueta" `destructive`.
- `meta-ads-tab.tsx`: `grid items-start gap-4 lg:grid-cols-2`; "Conta de anúncios" com ladrilho `bg-[color-mix(in_oklab,var(--cz-meta)_10%,transparent)]` e `Megaphone text-meta` decorativo, campos `cz-num`, "Salvar conta" primário, SEM selo "Conectada"; "Token da API de conversões" com `TOKEN_META_STATUS` e "Salvar token" `outline`; "Envio das conversões" com Select LGPD desabilitado com dica, Switch "Devolver conversões para a Meta" e Checkbox "Enviar também conversões sem identificador".
- `components/whatsapp/connect-client.tsx` (Configurações e onboarding): Card único; identidade com ladrilho `bg-[color-mix(in_oklab,var(--cz-whatsapp)_12%,transparent)]` e `MessageCircle text-whatsapp` decorativo; títulos exatos ("WhatsApp conectado", "Conectar o número da clínica"); conectado com "Número {telefone} · desde {dd/MM/yyyy}" em `cz-num` formatado com date-fns no fuso da clínica (hoje `toLocaleDateString` sem fuso, contra a regra 3.6); `StatusChip` de `WHATSAPP_CONNECTION_STATUS`; desconectado com "Situação atual:" e o chip NO MESMO elemento (texto combinado "Situação atual: Desconectado"); QR em bloco afundado com imagem `size-56 rounded-lg bg-(--qr-surface) p-3`; avisos com `Aviso` (warning, alert, info com `FlaskConical`); "Conectar WhatsApp" primário, "Verificar agora" `outline`, "Desconectar" `destructive`.
- Onboarding `app/(onboarding)/whatsapp/layout.tsx`: `main min-h-dvh bg-background`, contêiner `mx-auto grid w-full max-w-[560px] content-start gap-6 px-4 pt-10 pb-16`, voltar `ghost h-10 -ml-3` com `ArrowLeft`, sem logo; `page.tsx` `PageHeader` "Conexão do WhatsApp". O assistente de 4 etapas é do canal oficial (atrás de `isOfficialChannel`), não agora.

### 5.13 Autenticação e e-mail (lote D9)
- `app/(auth)/layout.tsx`: `flex min-h-dvh flex-col bg-background md:flex-row`; celular: faixa `h-14 bg-sidebar` com o lockup 146x24; a partir de 768: painel `hidden w-[44%] max-w-[640px] flex-col justify-between border-r border-(--sidebar-border) bg-sidebar p-10 md:flex` com lockup 170x28, slogan em `<p>` (não `h1`: hoje a página tem dois h1) `text-[32px] leading-[1.06] font-bold tracking-[-0.025em] text-sidebar-strong`, descrição `text-[15px] leading-[1.55] text-(--sidebar-foreground)`, rodapé `text-xs text-sidebar-muted` com `MARCA_PADRAO.nomeDoProduto`; `main` `flex flex-1 items-start justify-center px-4 py-8 md:items-center md:p-10` com cartão `w-full max-w-[400px] rounded-card border border-border bg-card p-6 shadow-sm md:p-8`.
- Formulários (`login-form.tsx`, `recover-form.tsx`, `components/password-form.tsx`): `form grid gap-5`; h1 24px bold; campos `h-11`; "Esqueci minha senha" na linha do rótulo da senha, FORA do `label`, `inline-flex min-h-10 items-center text-[13px] font-semibold text-primary-text`; avisos com `Aviso` (link expirado warning, erro alert `role="alert"`, sucesso success `role="status"`); botão `h-11 w-full text-[15px]` primário com `LoaderCircle` no carregando e os textos atuais; dica "Pelo menos 8 caracteres." no PasswordForm. Rótulos "E-mail", "Senha" e "Entrar" exatos; nada de botão "Mostrar senha".
- `cadastro-form.tsx`: opções `grid min-h-[88px] grid-cols-[40px_1fr_16px] items-center gap-3 rounded-card border border-border bg-card p-4 shadow-sm hover:shadow-md` + foco, ladrilho `size-10 rounded-xl bg-primary-soft` com ícone `text-primary-text`; confirmação com `MailCheck` e aviso de pendência `Aviso tom="warning" icone={Hourglass}`; campo de código `h-11 cz-num tracking-[0.2em] uppercase` com estados em 3 camadas (`LoaderCircle` neutro, `CircleCheck` success, `CircleAlert` warning, `OctagonAlert` alert).
- `selecionar-clinica/page.tsx`: botões `flex min-h-14 w-full items-center gap-3 rounded-card border border-border bg-card p-3 pr-4 shadow-sm hover:shadow-md` com iniciais `bg-primary-soft text-primary-text` e `ChevronRight`.
- `supabase/templates/confirmacao-de-cadastro.html`: hex permitido (e-mail não lê variável), com comentário de origem de cada hex; fundo `#f5f6ef`; faixa `bgcolor="#051813"` com a imagem `{{ .SiteURL }}/brand/email/conduzza-lockup-on-dark@2x.png` 146x24 e `alt` em `#fbfce8`; corpo branco, raio 16, borda `#e6eae5`; h1 24px `#051813`; parágrafo 15px `#4f5f57`; botão `#b2e54f` com texto `#051813`; URL em mono `#42600f`. Pilhas de fonte Manrope e JetBrains Mono com fallback. Colar no painel do Supabase e testar um cadastro real pelo Resend.

### 5.14 Telas futuras (desenhadas agora, ligadas quando existirem)
- **Agente de IA (Tela 6)**: estrutura do brief, aparência do DS. `mx-auto grid max-w-content gap-4 p-6`; corpo `grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]` com o simulador `lg:sticky`. Cabeçalho com eyebrow "Inteligência", Card de estado (ladrilho `bg-sidebar` com `Sparkles text-sidebar-active-text`, chip Ativo `CircleCheck` success ou Pausado `CirclePause` neutral, Switch). Abas `line`: Persona, Habilidades, Conhecimento, Regras e limites, Versões. Tom de voz em cartões de rádio (`Circle`/`CircleDot`, selecionado pela receita 4.7). Conformidade: `Aviso tom="warning" icone={Lock}` com as 4 travas em Switch ligado, `aria-disabled`, opacidade cheia (C24) e dica "Obrigatória, não pode ser desligada". Simulador com bolhas do Atendimento, "Por que a IA respondeu isso" em Accordion, resposta bloqueada como `Aviso tom="warning" icone={ShieldBan}`. Rodapé fixo com contador de alterações e "Publicar alterações" primário `h-11` (único lime). Sem prompt livre apresentado como proteção clínica, sem cartão de desempenho sem fonte.
- **Custo de mensagens (canal oficial)**: atrás de `isOfficialChannel`; barra de gasto contra teto com `--chart-bar` até 79%, "Perto do teto" `CircleAlert` warning de 80%, "Teto quase atingido" `OctagonAlert` alert de 95%; rótulo sempre escrito.
- **Faixas do brief §8**: `Aviso faixa` (teto e quality rating warning, assinatura neutral, WhatsApp alert).
- **Desempenho do Agente no Início**: cartão `.cz-dark` `rounded-card bg-sidebar p-4` com números de `ai_decision_log`, só quando o agente existir.
- **Administração do produto**: StatCards, DataTable, `Aviso tom="alert"` para quality rating baixo.

### 5.15 O que NÃO muda em nenhuma tela
- Nomes de token consumidos, a forma de `STATUS_TONE_VARS`, os 10 status (rótulos, ícones, tons), `BuildingSlash`.
- next-themes com `attribute="class"`, `defaultTheme="light"`, `enableSystem={false}`.
- Sidebar escura nos dois temas.
- `disabled:pointer-events-none` nos primitivos e `text-base md:text-sm` nos campos.
- Radix e seus papéis (`combobox`, `option`, `tab`, `switch`, `menuitem`, `dialog`) e todos os nomes acessíveis usados em e2e.
- `DisabledWithHint`, `BotaoProtegido`: ação sem permissão visível, desabilitada e com dica.
- Textos de interface (esta especificação não reescreve copy, salvo as linhas marcadas como novas: estados de erro e vazio que faltavam, "Fechar janela" e "Fechar painel" no sr-only, "Não foi entregue", "Ainda não medido").
- Nada do DS entra: `--shadow-accent`, `--shadow-inset-top`, a escala `--space-N`, o `<Icon>` por CDN, `_ds_bundle.js`, `_adherence.oxlintrc.json`, hex dos componentes do DS, strings do UI kit.

---

## 6. Riscos e como verificar

### 6.1 Riscos
1. **Troca global de uma vez.** A Etapa A muda todas as telas no mesmo commit. Fazer com a leva de lógica já integrada, rodar a suíte inteira e conferir os dois temas na mão (CLAUDE.md §6).
2. **Teste de contraste frágil.** `parseBlock` pega o primeiro `:root {` e o primeiro `\.dark\s*\{`, até o primeiro `}`; `resolveToken` só resolve `var(--x)` exato dentro do próprio bloco; `parseColor` só lê hex de 6 dígitos e `rgba()`; rgba de FUNDO é composto sobre `--background`. Consequências: o escuro precisa do merge `{ ...root, ...dark }`; o seletor tem de ser `.cz-dark,\n.dark {`; o `:root` do `prefers-reduced-motion` vem depois; badge da sidebar opaco; nada de `color-mix` nos tokens testados.
3. **Primária que vira preenchimento.** Qualquer `text-primary`, `border-primary`, `accent-primary` ou `var(--primary)` esquecido vira lime-400 sobre claro (1,48:1). Verificar com `grep -rn "text-primary\b\|border-primary\b\|accent-primary\|var(--primary)" app components` depois da Etapa A: só pode sobrar uso como preenchimento.
4. **Classes que passam a existir.** `text-alert-text`, `text-success-text` e `border-border-strong` hoje não geram CSS; passam a gerar. Revisar login, recuperação, convite, conexão, bolha do paciente e chips de filtro.
5. **`tailwind-merge`.** Sem o `extendTailwindMerge`, `rounded-card` e `shadow-pop` convivem com `rounded-lg` e `shadow-sm` e o resultado depende da ordem do CSS. `cz-eyebrow` não pode carregar cor.
6. **Altura dos primitivos.** Button e Input vão de 32 para 40px: barras densas crescem. Conferir Agenda e Atendimento em 1366x768 (altura útil de mensagens cai para cerca de 380px com a barra de 60 e o cabeçalho de 64).
7. **Fontes.** Manrope e JetBrains Mono são mais largas: nomes truncam antes nas colunas de 180px da Agenda, nos cartões de 228px do kanban, na `grid-cols-[9rem_1fr_3rem]` e nos chips `whitespace-nowrap`. A faixa de 48 a 71px do bloco da Agenda tem exatamente 46px úteis para 3 linhas de 14px. Conferir com dado real.
8. **Rail recolhido em 1366 e 1024.** Os rótulos viram `sr-only`; e2e que usem `getByText` no menu ou `toBeVisible` no rótulo falham; `getByRole("link", { name })` continua funcionando. `layout.spec` precisa mudar no mesmo commit.
9. **Duplicidade em e2e.** Título da barra superior tem de ser `<p>` (19 consultas `getByRole("heading")`); "Fechar" do Dialog renomeado para "Fechar janela" por causa de `importacao.spec.ts:97`; "Mensagens automáticas" tem de ser nome único em Confirmações; KPIs de Pacientes, se aprovados, não podem ser botões (colidiriam com "Com pacote").
10. **Semântica exigida pelo e2e.** SegmentedControl com `button` e `aria-pressed` (não `tab`); Select Radix; contagens com espaço literal antes do número; `section[aria-label^="Etapa,"]`; `dl > div`; `role="note"`; `data-slot="accordion-item"`; o rótulo do indicador de paciente e o valor no mesmo pai; matriz como única `table` da aba equipe; "Situação atual: Desconectado" no mesmo elemento.
11. **dnd-kit.** Nada de `translateY` no hover do bloco da Agenda; o cartão do kanban usa `hover:-translate-y-px`, que o `transform` inline do arrasto sobrescreve (conferir a animação); fila da espera continua `ol`/`li`.
12. **Clique no vão da grade.** Todo elemento novo dentro da coluna da Agenda (linha de agora, marcador, chip do bloqueio, hold) precisa de `pointer-events-none`.
13. **`hit-40`.** Não funciona dentro de `overflow-hidden` (linha 3 do cartão de conversa, células com overflow); pseudo-elementos vizinhos se sobrepõem se o vão for menor que a extensão. Conferir as fileiras de chips e o switch sm da célula de vínculo.
14. **White-label.** Com o `DEFAULT_PRIMARY` só com o valor novo, toda clínica com `#A8D318` injeta o lime antigo; `white-label.spec.ts` restaura `"#A8D318"` no `afterEach`. Os derivados de cor custom não têm garantia de contraste até o editor da Tela 12.
15. **Movimento reduzido.** `!important` global em 0,01ms: conferir que dialogs, sheets e toasts desmontam; o spinner é a única exceção.
16. **Travessão.** `no-em-dash.test.ts` só pega "—"; a meia-risca "–" dos exemplos do kit passaria. Nunca copiar texto do kit.
17. **Behance.** `git add -A` antes da regra do `.gitignore` leva 10MB de obra de terceiros para o histórico.
18. **Trabalho em paralelo.** Codemods (cartões à mão, `strokeWidth`, `h-10` redundante, `flex-wrap` das abas) conflitam com agentes editando telas; rodar só em janela sem outra edição.
19. **Mudanças de comportamento pequenas.** Checklist do Início passa a mostrar ação desabilitada com dica (regra do CLAUDE.md); "Ligar" da lista de faltas passa a aparecer desabilitado; toast escuro nos dois temas; modal mais escuro (`.42` contra `bg-black/10`); avatar de cada contato muda de cor uma vez.
20. **Defeitos existentes que a troca expõe.** `var(--brand)` inexistente em `week-grid.tsx` e `citacao.tsx`; consentimento carregando ou com erro aparece como "Sem autorização"; fio com erro aparece vazio; horas do Atendimento no fuso do navegador (CLAUDE.md 3.6; não é layout, registrar); busca por telefone formatado com hífen não acha (normalizar para dígitos se o telefone passar a aparecer formatado).

### 6.2 Verificação
- **Contraste (unidade)**: `tests/unit/design/contrast.test.ts` com `escuro: { ...parseBlock(css, ":root"), ...parseBlock(css, ".dark") }` e novos `it` nos dois temas: `text-strong` e `foreground` sobre `surface-5`; `text-secondary` sobre `surface-subtle` e sobre `primary-soft`; `primary-text` sobre `background`, `surface-2` e `primary-soft` (4,5); `focus` sobre `surface-2` (3,0) e, no claro, sobre `primary` (3,0); `primary-edge` sobre `surface-2` e sobre `primary-soft` (3,0); `input` sobre `background` e `surface-4` (3,0); `chart-bar` sobre `surface-4` (3,0); `inverse-foreground` sobre `inverse`; `bubble-out-foreground` e `bubble-out-meta` sobre `bubble-out`; `bubble-ai-foreground` e `bubble-ai-meta` sobre `bubble-ai`; `alert-text` sobre `alert-bg-hover`; sidebar: `sidebar-strong`, `sidebar-primary-foreground` sobre `sidebar-primary`. Trocar o comentário "violeta" do `TONES` (o tom `ai` continua na lista).
- **Contraste (renderizado)**: `tests/e2e/tokens.spec.ts` com `/dev/tokens` atualizado (`tokens-view.tsx`: rótulo "IA (lime suave, reservado)", espécimes 24/19/16/14/12/10px e `cz-num` 34px, todos os primitivos e compartilhados novos, `--primary-text`, `--primary-soft`, `--focus`). Recomendado (teste novo, pedir OK): o mesmo axe `color-contrast` em `/atendimento`, `/agenda`, `/leads` e `/confirmacoes` nos dois temas, porque hoje uma regressão de contraste numa tela passa em todos os testes.
- **Cópia**: `tests/unit/copy/no-em-dash.test.ts` verde em todo lote. Recomendado (pedir OK): estender para a meia-risca "–".
- **e2e**: suíte completa nos 4 viewports (1600, 1366, 1024, 768) ao fim das Etapas B e C e de cada lote; lista de ganchos frágeis no item 10 acima.
- **Manual por lote**: claro e escuro; 1600, 1366, 1024, 768 e 390px; teclado (foco visível em todo controle, contorno lime-800 no claro e lime-400 no escuro); `prefers-reduced-motion`; impressão de Resultados e da Agenda; papel `leitura` e `recepcao` vendo ações desabilitadas com dica.
- **Checagens de grep ao fim de cada lote**: nenhum `--cz-` em `components/` e `app/` fora de `globals.css`, `contact-avatar.tsx` e das telas de marca; nenhum `#[0-9a-f]{6}` em componente (exceto `COR_PADRAO` e o e-mail); nenhum `backdrop-blur`; nenhum `bg-primary` em chip de seleção.

---

## Anexo: conflitos em detalhe e decisões do dono (24/09/2026)

Decisões do dono: tons e tamanhos do DS ajustados para AA e alvo de 40px (C3 a C7, C32); traço de ícone 2px (C10); rail recolhido em 64px abaixo de 1600px (C20); do kit entram saudação no Início, filtro em Confirmações, ações no topo da conversa e indicadores em Pacientes (C26 a C29). Nos demais, vale a recomendação.

### C1. Fonte da verdade visual e tipografia
- **DS:** A pasta 'Conduzza Design System' define toda a aparência: Manrope (400 a 800) e JetBrains Mono, rampas lime/ink/paper, raios 6 a 28, sombras esverdeadas, sidebar ink-900 de 248px, barra de 60px. Manrope é substituição sinalizada da fonte real da marca.
- **Regra atual:** CLAUDE.md §5 (decisão de 19/08/2026): fonte da verdade visual é design_handoff_conduzza_atendimento_ia/ (Inter Tight e IBM Plex Mono). Brief 3.6: no máximo 2 famílias. A memória do projeto e o comentário de app/globals.css também citam o handoff. O pedido do usuário ('use ela como base') equivale a trocar a fonte, mas CLAUDE.md é arquivo do dono.
- **Opções:** (a) O dono confirma que o DS substitui o handoff em aparência; CLAUDE.md §5 e a memória são reescritos com a data de 24/09/2026, mantendo 'onde divergem em regra, vale o brief'. (b) Aplicar sem editar o CLAUDE.md (a próxima sessão trataria a troca como violação e reverteria). (c) Usar o DS só como referência.
- **Recomendação:** (a), com confirmação explícita por escrito antes de qualquer código. Continua em 2 famílias, como o brief pede. Sem essa decisão, nenhuma etapa começa.

### C2. Tema escuro
- **DS:** Não existe tema escuro de produto: só o escopo .cz-dark (sidebar, toast, Card inverse), com canvas ink-950, superfície ink-900 e elevada ink-800. As famílias semânticas só têm 050, 500 e 700 e os componentes usam rampa crua pensada para claro.
- **Regra atual:** CLAUDE.md §5 e §6: claro por padrão, escuro obrigatório e conferido em toda tarefa. Brief 3.9: elevação tonal no escuro. Brief 9: sem preto puro. contrast.test.ts e tokens.spec testam o escuro.
- **Opções:** (a) Derivar o escuro das rampas por regra fixa: canvas ink-950, card ink-900, popover ink-800, dois passos novos (ink-850 #142620 e ink-750 #273831), texto ink-100, secundário ink-300, terciário ink-400; famílias com texto = 500 + 45% cream e fundo = ink-900 + 16% da 500 (success #8bc89a/#0c2d1f, warning #e8c480/#272c17, alert #e6a08a/#26221a, info #98bbcc/#10292d, ai lime-300/#21391d); sombras none. (b) Pedir ao autor do DS um tema escuro oficial antes de migrar. (c) Manter o escuro neutro atual (#121212) com o acento novo, misturando identidades.
- **Recomendação:** (a) já, com os valores travados no contrast.test.ts, e (b) em paralelo. O dono aprova a lista de hex derivados, que não existem no DS. Se quiser mais distância do preto, o canvas vira ink-900 e os cartões ink-850.

### C3. Contraste de texto dos aliases do DS
- **DS:** --text-muted = ink-500 #6b7c73 (descrição, metadado, cabeçalho de tabela, prévia); --text-faint = ink-400 #8b9a92 (hora, telefone, legenda, contagem); lime como texto = lime-700 #5d8515 ('menor passo que passa 4,5:1 no branco'); texto com opacidade: eyebrow da sidebar cream .32, rótulo do StatCard lime em ink .62, hora da bolha a .55, corpo do Banner a .92.
- **Regra atual:** CLAUDE.md §5 e brief 3.6: 4,5:1 em todo texto, sem exceção para 10 a 12px. Medido: ink-500 dá 4,42 no branco, 4,06 no canvas e 3,77 no paper-200; ink-400 dá 2,94; lime-700 dá 4,35 (o readme está errado); sidebar .32 dá 2,81; StatCard .62 dá 4,45; hora .55 dá de 2,13 a 4,09; Banner warning a .92 dá 3,98. O teste exige secundário até a surface-5 e terciário até a surface-3.
- **Opções:** (a) Descer um passo na mesma rampa: secundário e terciário ink-600 #4f5f57 no claro (6,76), ink-300 e ink-400 no escuro; lime como texto lime-800 #42600f (7,21); ink-400 nunca como texto no claro; sidebar muted ink-400 (6,22); texto sobre lime em ink cheio; hora e Banner sem opacidade. (b) Igual a (a), mas criar um passo interpolado ink-550 #5d6e65 (5,44) para o terciário e manter dois níveis de cinza no claro. (c) Usar os valores do DS e aceitar a reprovação (quebra contrast.test.ts e o axe).
- **Recomendação:** (a). Só usa passos que existem na rampa e a hierarquia vem de tamanho e peso. Registrar como 'desvio AA' no globals.css, no padrão dos desvios que o arquivo já documenta. Se o dono sentir falta do segundo nível de cinza no claro, (b).

### C4. Borda de controle com 3:1 e barra de rolagem
- **DS:** Campo, select, textarea e compositor com border-subtle (ink 12%, 1,29:1); checkbox desmarcado com border-strong (22%, 1,62:1); trilho do switch desligado ink-200 (1,44:1); busca sem borda (1,08 a 1,17:1); polegar da barra de rolagem ink-200 (1,44:1). 'Hairlines, nunca linha cinza sólida.'
- **Regra atual:** CLAUDE.md §5: 3:1 em borda de controle. contrast.test.ts exige --input com 3:1 sobre o card. O app hoje usa #8a8f88 (3,30).
- **Opções:** (a) --input = ink-500 #6b7c73 nos dois temas (4,42 no branco, 4,06 no canvas, 3,77 no afundado; 4,15 no card escuro) para campo, select, checkbox, trilho do switch, busca e barra de rolagem; border-subtle do DS só em botão outline, menu e tag. (b) Borda mais leve interpolada #7b8b83 (3,58 no branco, 3,06 no afundado), fora da rampa. (c) Seguir o DS e reprovar.
- **Recomendação:** (a). O visual fica um pouco mais marcado que o do DS, usa passo real da rampa e o teste continua valendo.

### C5. Anel de foco
- **DS:** --focus-ring: halo de 3px rgba(178,229,79,.55) mais borda lime-500 no campo. Contra o branco o halo dá 1,25:1 e a borda 1,68:1.
- **Regra atual:** Brief 3.9: anel de 2px, offset de 2px, 3:1 contra o fundo e contra o elemento, sempre visível. lime-700 contra um botão lime-400 dá 2,94 e não passa contra o elemento.
- **Opções:** (a) Contorno sólido de 2px em --focus (lime-800 no claro: 7,21 no branco e 4,88 contra o botão lime; lime-400 no escuro: 12,4) com offset de 2px em todo controle; nos campos, borda --focus mais o halo do DS como enfeite. (b) Contorno lime-700 (4,35), que falha contra o botão lime. (c) Só o halo do DS.
- **Recomendação:** (a). Mantém a assinatura do DS nos campos e cumpre o brief em todo o resto. O offset é obrigatório no escuro, porque lime-400 encostado num botão lime-400 dá 1:1.

### C6. Indicadores de estado em lime-400
- **DS:** Selecionado = lime-050 com borda esquerda de 2px em lime-400 (1,39:1 sobre lime-050); checkbox marcado lime-400 com borda lime-500 (1,68); switch ligado lime-400 com polegar branco (1,48 entre os dois); sublinhado da aba ativa em lime-400; barras de gráfico e ProgressBar em lime-400 (1,26 sobre o trilho, 1,48 no branco).
- **Regra atual:** CLAUDE.md §5: estado nunca só por cor, e indicador não textual precisa de 3:1 (WCAG 1.4.11).
- **Opções:** (a) Token --primary-edge = lime-700 no claro (4,35 no branco, 4,09 no lime-050, 3,71 no trilho) e lime-400 no escuro, usado em borda de seleção, borda de checkbox e switch ligados, sublinhado da aba, anel de soltura e barra de gráfico (--chart-bar); polegar do switch ligado em ink-900 (12,4). (b) Aceitar o lime-400 e reforçar só com aria-selected (não resolve para quem vê). (c) Indicadores em ink-900.
- **Recomendação:** (a). Continua sendo lime, um passo mais escuro no claro, e a aba ativa também ganha negrito.

### C7. Alvo de toque de 40px
- **DS:** Controles com 30, 36 e 44px (Button sm e md); IconButton 28, 34 e 40; SegmentedControl 28 e 34; Switch sm 32x18; Checkbox 17px; item de menu com cerca de 32px; fechar do Modal 30px; remover etiqueta 16px; dispensar do Banner 20px; botão de enviar do compositor com 34px; botão Sair da sidebar com 28px.
- **Regra atual:** CLAUDE.md §5 e brief 3.8: alvo mínimo de 40x40px. O app já força h-10 em cerca de 280 lugares, mas os primitivos do shadcn têm padrão de 32px.
- **Opções:** (a) Botão padrão e ícone com 40px (h-10, size-10), lg com 44px, item de menu com min-h-10; controles pequenos mantêm o tamanho visual do DS (sm 30, icon-sm 28, segmento 34, checkbox 17, switch) com área de toque de 40px pelo utilitário hit-40 (pseudo-elemento). (b) Tamanhos do DS em ponteiro fino e 40px só em pointer:coarse. (c) Seguir o DS.
- **Recomendação:** (a). Diferença de 4px no botão padrão, densidade do DS preservada nos elementos pequenos. Os tokens de altura do DS não entram. Atenção: hit-40 não funciona dentro de overflow-hidden.

### C8. Status em 3 camadas contra ponto colorido
- **DS:** O Badge tem ícone opcional, mas o padrão documentado para status é o 'dot' (ponto de 6px) com rótulo; o UI kit usa dot em Confirmado, Ativo, Conectado, Pausada, Expirando e nos status da agenda do Início; a coluna do kanban e a célula 'Etapa' usam um quadrado de 7px; o Avatar mostra presença só por cor; o Toast pinta sucesso, info e aviso do mesmo lime e usa #f2a08c solto no erro.
- **Regra atual:** CLAUDE.md §5 e brief 3.5: todo status com ícone de forma distinta, rótulo e cor; nunca só cor; nunca o mesmo ícone em cores diferentes; só tokens, nada de hex solto.
- **Opções:** (a) StatusChip com o visual do Badge do DS e ícone obrigatório (o próprio Badge aceita ícone); prop dot proibida para status; etapa do funil com o ícone da etapa no lugar do quadrado; presença não é mostrada; toast com ícone na cor -text de cada família; mapas novos em lib/design/status.ts para Ativo/Inativo, régua, conexão do WhatsApp, nível de acesso, IA agenda, conversão, token e consentimento. (b) Aceitar ponto com rótulo (2 camadas).
- **Recomendação:** (a). O visual do DS se mantém e a regra também.

### C9. Vocabulário dos status de consulta e o AppointmentCard
- **DS:** 'Os status de confirmação são sempre exatamente: Confirmado, Aguardando, Cancelado, Faltou, Remarcado.' O AppointmentCard só aceita confirmado, aguardando, cancelado, encaixe e bloqueio, mostra o cancelado na grade e não escreve o rótulo do status.
- **Regra atual:** Brief 3.5, docs/04 e lib/design/status.ts: 10 status com autoria (Agendado, Aguardando, Confirmado por WhatsApp, Confirmado pela recepção, Na recepção, Em atendimento, Compareceu, Cancelado pelo paciente, Cancelado pela clínica, Faltou). Remarcado é evento, não status. Encaixe é atributo (is_overbooking) com tracejado e deslocamento de 8px; bloqueio é outra entidade com hachura; cancelado sai da grade para a reoferta. appointment-status.test.ts e os e2e travam os rótulos.
- **Opções:** (a) Manter os 10 status e os rótulos do brief com a pele do DS (tinta do status, barra de 3px, horário em mono, linha de rótulo mantida no bloco); as famílias do DS aparecem só como rótulo de contagem ou filtro (Confirmadas, Aguardando, Canceladas); encaixe como modificador com Zap e texto 'Encaixe', nunca lime; hold da IA e encaixe pendente no tom ai. (b) Reduzir aos 5 do DS (perde autoria, muda banco e e2e). (c) Criar o status 'remarcado' (migration e escopo novo).
- **Recomendação:** (a). É regra de conteúdo, então vale o brief. Pedir ao autor do DS que registre no readme que os 5 são famílias do fluxo de confirmação.

### C10. Traço dos ícones
- **DS:** Lucide com traço de 2px ('uma coleção mais fina leria como outra marca'), só contorno; tamanhos 11 a 13 em chip, 14 a 15 em cromo denso, 16 a 18 padrão, 20 na navegação (o SidebarNav usa 17), 24 em destaque. Não desenhar SVG à mão.
- **Regra atual:** CLAUDE.md §2 (tabela de stack, 'não trocar sem me perguntar'): Lucide com traço 1,5px. Brief 3.5: 1,5px, e 2px no item ativo do menu. O app tem cerca de 300 strokeWidth={1.5} e um SVG próprio (building-slash) exigido pelo brief.
- **Opções:** (a) Adotar 2px: codemod removendo strokeWidth={1.5} num commit isolado (o padrão do lucide já é 2), building-slash com traço 2, item ativo diferenciado por cor, fundo, barra e peso; atualizar CLAUDE.md §2. (b) Manter 1,5px, com 2px no ativo. (c) Regra CSS svg.lucide{stroke-width:2} sem codemod.
- **Recomendação:** (a) se o DS é a nova base, com o dono autorizando a mudança na tabela de stack. Até lá, (b). O building-slash fica como exceção registrada, porque o brief o exige.

### C11. Cor da IA
- **DS:** Não existe violeta: lime é a única cor saturada. O DS marca IA com sparkles em lime-700, Badge tone lime ('IA pausada') e bolha da IA em ink-900 com texto cream.
- **Regra atual:** Handoff e app: violeta reservado para IA (--ai #6b49de), usado em chip, bolha e hold da agenda. Brief 3.4: a primária serve à marca e à IA. contrast.test.ts itera o tom 'ai'.
- **Opções:** (a) Remapear --ai, --ai-text e --ai-bg para lime suave mantendo os nomes (claro lime-700/lime-800/lime-100, chip 6,37; escuro lime-400/lime-300/#21391d, 9,26); bolha da IA em ink-900 com cream. (b) Manter um violeta fora da paleta como exceção. (c) IA em pílula de tinta invertida.
- **Recomendação:** (a). Cuidados: o chip de IA quase perde o fundo sobre a linha selecionada (lime-100 contra lime-050), mas ícone e texto continuam legíveis; lime e o verde de sucesso ficam próximos e quem separa é ícone e rótulo. Com white-label de outra cor, a IA fica lime fixo: o dono decide se deve seguir a cor da clínica.

### C12. Gráficos proibidos no DS
- **DS:** DonutChart (rosca) para participação do total em Resultados; BarChart de colunas verticais como 'único primitivo de gráfico' (período destacado só pela cor); ProgressBar com tons success, warning e danger pintando etapas e metas; 'Desempenho da lista' com barras sem denominador real.
- **Regra atual:** CLAUDE.md §5 e brief §9: proibidos pizza, rosca, barra empilhada, medidor, treemap e 3D; só barra horizontal ou linha com marcadores; estado nunca só por cor; não inventar dado.
- **Opções:** (a) Nunca portar DonutChart nem BarChart; participação em barra horizontal com o percentual escrito; série no tempo, se um dia entrar, em linha com marcadores; barra de progresso só com tom destaque ou neutro; métricas sem denominador como número. (b) Portar como está.
- **Recomendação:** (a). O próprio readme chama BarChart e DonutChart de 'stand-ins' para simular Resultados.

### C13. Sombra colorida
- **DS:** --shadow-accent: 0 6px 18px rgba(127,179,32,.28), brilho lime sob o StatCard em lime. As demais sombras usam rgba(5,24,19,...), ink quase preto.
- **Regra atual:** CLAUDE.md §5 e brief 3.1/§9: proibida sombra colorida.
- **Opções:** (a) Importar xs, sm, md, lg e pop (ink a 4 a 14% não se percebe como cor) e não importar --shadow-accent; o bloco lime fica sem sombra. (b) Importar tudo. (c) Trocar tudo por preto neutro.
- **Recomendação:** (a).

### C14. Desfoque no fundo do modal
- **DS:** Fundo do modal rgba(5,24,19,.42) com blur(3px). 'Nunca vidro fosco em cartão.'
- **Regra atual:** CLAUDE.md §5 e brief §9: proibido vidro fosco. O dialog.tsx e o sheet.tsx já usam backdrop-blur-xs hoje.
- **Opções:** (a) Fundo só com cor, sem blur, em dialog, sheet e visor de foto. (b) Aceitar os 3px como exceção do fundo e registrar no CLAUDE.md. (c) Manter o blur atual.
- **Recomendação:** (a). Custa zero e remove a ambiguidade; a diferença visual é mínima.

### C15. Travessão e meia-risca nos textos do kit
- **DS:** O UI kit e os exemplos usam '—' e '–': 'Encaixe — Lia Rocha', 'Achou o valor alto — reativar em 60 dias', 'proxima: —', '1 – 22 DE SETEMBRO', horário '08:00–08:30' no AppointmentCard.
- **Regra atual:** CLAUDE.md §5: nenhum travessão em copy, placeholder ou erro. tests/unit/copy/no-em-dash.test.ts só procura '—'.
- **Opções:** (a) Nunca copiar texto do kit; horário como '08:00 às 08:30' ou '09:30 · 30 min'; período '1 a 22 de setembro'; vazio escrito por extenso ('Sem data', 'Ainda não medido'). (b) Copiar e corrigir depois. (c) Estender o teste para a meia-risca.
- **Recomendação:** (a) agora, e (c) como teste barato, com o aval do dono por ser mudança de teste.

### C16. White-label contra lime e logo fixos
- **DS:** Os componentes usam --cz-lime-* direto (checkbox, KanbanCard, EmptyState, paleta hex do Avatar) e o lockup da Conduzza é fixo na sidebar e no login.
- **Regra atual:** Brief §2 e §9: nada de logo, nome ou cor fixa no layout; a primária é configurável por clínica. brand-style.ts injeta --primary e os tokens de ativo da sidebar; white-label.spec.ts confere. Toda linha de clinic_branding tem o default '#A8D318'.
- **Opções:** (a) Todo acento passa por --primary, --primary-soft, --primary-text, --primary-edge e --focus; brandStyleFor deriva esses tokens da cor da clínica com color-mix referenciando tokens do tema (funciona no claro e no escuro); DEFAULT_PRIMARY aceita '#a8d318' e '#b2e54f'; logos vêm de clinic_branding.logo_*_dark com a marca Conduzza como reserva. (b) Lime e logo fixos da Conduzza para toda clínica.
- **Recomendação:** (a). A validação de contraste da cor custom continua pendente no editor de marca (Tela 12), risco já registrado. A exceção é a paleta decorativa do avatar, que fica com as constantes do DS.

### C17. Um lime por tela
- **DS:** 'O lime marca exatamente uma coisa por vista; se duas coisas estão em lime, uma está errada.' Mas o próprio DS põe lime no item ativo da navegação, no KPI, na bolha enviada, no contador de não lidas, na IA e no selecionado.
- **Regra atual:** Brief 3.4: até 3 elementos na cor primária (ação principal, item de menu ativo, marcação da IA). Hoje há cerca de 70 botões na variante primária, com vários arquivos tendo 2 ou 3 (cadastro-form, vinculos-tab, espera-client, editor-de-passo, dados-cadastrais, modal-importacao, bloqueios-tab, empty-state, controles-da-regua, pending-panel, agendamento-modal, composer, etiquetas-tab). Com a primária virando lime-400 vivo, isso pesa muito.
- **Opções:** (a) Regra operacional: no corpo da tela, no máximo um preenchimento lime-400 (a ação principal ou o KPI herói); o item ativo da sidebar não conta; lime suave (050/100 e texto lime-800) liberado para selecionado, IA, bolha enviada e botão soft; em cada lote, rebaixar o segundo primário para outline, soft ou solid. (b) Trocar o padrão do Button para outline (risco de a ação principal sumir). (c) Ignorar.
- **Recomendação:** (a), mantendo o padrão do Button como primário. O teto do brief (3) continua valendo; a regra do DS vira meta de revisão de cada tela.

### C18. Mesmo ícone em cores diferentes
- **DS:** O Banner warning usa triangle-alert por padrão, o StatCard 'Falha no envio' usa triangle-alert, o nav de Lista de espera usa clock, o Banner danger usa octagon-alert, e o Toast pinta três tipos de lime.
- **Regra atual:** Regra das 3 camadas: nunca o mesmo ícone em cores diferentes. Faltou é triangle-alert em alerta (brief 3.5). O app já viola: TriangleAlert âmbar no toque 'pulado', no aviso de recurso e no diálogo da régua; RotateCcw muda de cor em Recuperadas; Plug âmbar e verde no checklist; Hand e Timer neutros no Início e âmbar nos status; Calendar no menu e no status Agendado; Clock3 quase igual a Clock.
- **Opções:** (a) Tabela de ícones reservados: TriangleAlert só Faltou; CircleAlert = atenção (warning); OctagonAlert = erro (alert); Info = informação; CircleCheck = sucesso; ShieldBan para bloqueio de conformidade; SendHorizonal para 'enviando'; WifiOff para WhatsApp desconectado; e as trocas pontuais listadas na seção 4.6 da especificação. O Banner do app sobrescreve o ícone padrão do DS. (b) Trocar o ícone de Faltou, contrariando o brief.
- **Recomendação:** (a), aplicada no lote de cada tela.

### C19. Hachura do bloqueio na Agenda
- **DS:** 'No gradients, no textures, no patterns.'
- **Regra atual:** Brief Tela 3: 'Bloqueio: hachura diagonal a 45 graus mais rótulo do motivo. Nunca só cor.' É a camada de forma do bloqueio; o e2e descreve 'Bloqueio hachurado com rótulo'.
- **Opções:** (a) Manter a hachura só no bloqueio, com as linhas do DS (--border-heavy a cada 8px sobre --surface-4), ícone Ban e o motivo num chip sólido. (b) Tirar a hachura e usar ink-050 com Ban e rótulo, como o AppointmentCard do kit.
- **Recomendação:** (a): é padrão funcional de acessibilidade, não decoração.

### C20. Navegação lateral: rail, contador e grupos
- **DS:** Kit em 1440px abre a sidebar de 248px expandida e só recolhe pelo botão; o contador some quando recolhida; contador neutro (cream 10%) e lime no item ativo; 4 blocos (sem título, 'Operação do dia', 'Inteligência', 'Administração') com rótulo 'Cadastro' e ícone clock em Lista de espera.
- **Regra atual:** Brief §6: de 1366 a 1599 o rail recolhe automaticamente para 64px, de 1024 a 1365 também, abaixo de 1024 vira gaveta. Brief §4: contador obrigatório em Atendimento e Confirmações, em cor de alerta quando houver item vencido; dois grupos com rótulo. O app hoje fixa 236px, pinta o contador sempre de coral e tem 2 grupos (Operação, Inteligência). 'Cadastros' é o nome do brief; clock é o ícone do status Aguardando.
- **Opções:** (a) Brief na largura: 64px automático abaixo de 1600 com botão que expande para 248px e guarda a escolha em cookie; mini contador de 16px no canto do ícone quando recolhido; contador neutro por padrão, com variante de alerta (vermelho + AlarmClock) só quando o dono definir 'vencido' (sugestão para Atendimento: sem resposta há mais de 24h); 4 grupos do DS com o rótulo 'Cadastros' e Hourglass em Lista de espera. (b) Kit: 248px sempre. (c) Manter 2 grupos atuais só com o visual novo.
- **Recomendação:** (a). É regra de comportamento por largura (vence o brief) e 1366 é a largura real da recepção. Pedir ao dono a definição de 'vencido' para Atendimento e Confirmações. layout.spec.ts muda no mesmo commit.

### C21. Itens da barra superior
- **DS:** TopBar do kit: título renderizado como h1, eyebrow 'CLÍNICA · UNIDADE', campo de busca de 300px com ⌘K, selo 'WhatsApp on-line', sino com contador (3), botão Ajuda, avatar; sem chave de tema.
- **Regra atual:** Brief §4: avatar com menu, sino, chave de tema, busca global, seletor de unidade (só com mais de uma). Busca global, notificações e ajuda não estão no spec nem no backlog (CLAUDE.md §7); a sessão não tem unidade ativa; cada tela tem seu h1 no PageHeader e há 19 consultas getByRole('heading') no e2e.
- **Opções:** (a) Título do módulo como <p> (não heading) com eyebrow só com o nome da clínica; busca continua botão de ícone desabilitado com dica; sem Ajuda; sino sem contador; chave de tema mantida; selo 'WhatsApp conectado' só depois de mover o Realtime do WhatsApp para um provider único. (b) Campo de busca do DS desabilitado com 300px. (c) Implementar busca e ajuda (escopo novo).
- **Recomendação:** (a). Um campo de 300px desabilitado promete o que não existe e toma espaço em 1366. O selo é informação real e pode entrar depois, com o OK do dono.

### C22. Faixas globais de WhatsApp desconectado e motor parado
- **DS:** Cor chapada só na sidebar e em no máximo um bloco lime por tela; problema é um Banner danger (fundo danger-050, texto danger-700) com um botão de correção. Branco sobre danger-500 dá 4,06:1.
- **Regra atual:** Brief §8: faixa VERMELHA fixa no topo de todas as telas com botão Reconectar. Hoje é vermelho cheio com texto branco; o e2e confere 'WhatsApp desconectado' e o link 'Reconectar'.
- **Opções:** (a) Faixa fixa no topo da coluna de conteúdo, em todas as telas, com fundo danger-050, texto danger-700 (6,31), borda inferior danger-500, ícone WifiOff e Reconectar em botão sólido de tinta. (b) Faixa cheia em danger-700 com texto branco (7,12). (c) Banner dentro da página, como no kit.
- **Recomendação:** (a). Cumpre a regra (fixa, no topo, vermelha, com Reconectar) na linguagem do DS. Se o dono achar pouco enfática, (b).

### C23. Tooltip curto contra dica de permissão
- **DS:** 'Tooltips com menos de cinco palavras, sem ponto final'; tooltip com white-space: nowrap.
- **Regra atual:** Brief §5 e CLAUDE.md §5: ação sem permissão fica visível e desabilitada, com dica que explica o porquê. As dicas atuais são frases ('Preencha e salve a hora de início, a hora de fim e os dias antes de ligar a régua') e abrem por hover e por foco.
- **Opções:** (a) Cápsula do DS (ink, raio 6, 11,5px, sem seta) com max-w de 280px e quebra de linha, texto integral nas dicas de permissão; regra curta do DS só para dicas de ícone ('Anexar arquivo'). (b) Encurtar tudo para 5 palavras (perde o porquê).
- **Recomendação:** (a).

### C24. Chaves travadas da Conformidade do Agente de IA
- **DS:** Desabilitado é 45% de opacidade, sempre.
- **Regra atual:** Brief Tela 6 e backlog 3.5: as travas de conformidade aparecem ligadas, visivelmente impossíveis de desligar, e ajudam a vender. CLAUDE.md 3.2.
- **Opções:** (a) Switch ligado com aria-disabled, opacidade cheia, cadeado e dica 'Obrigatória, não pode ser desligada', como exceção documentada aos 45%. (b) 45% como no DS (o lime some).
- **Recomendação:** (a). Vale só quando a Tela 6 for construída.

### C25. Escopo que o kit sugere e o brief não tem
- **DS:** O UI kit traz: Início com listas de conversas e agenda com nome de paciente, gráfico de consultas por dia e ações 'Exportar dia' e 'Disparar lembretes'; KanbanCard com ticket em R$, tempo parado e 'urgente'; botão '+' por coluna; colunas de lista Contexto e Ticket; Pacientes com busca, Exportar, Novo paciente e seleção; Espera com prioridade Alta/Média/Baixa, 'Oferecer vaga' e 'Preencher'; Automações mestre-detalhe com 'Aplicar a' e 'Histórico de envios'; Cadastro com aba Horários, Registro ANS, prazo de repasse e busca; Configurações com vários números de WhatsApp, Lead Ads, etiqueta por campanha, último acesso e matriz de permissões editável; Resultados com investimento, custo por lead, satisfação e frase causal; Agente com prompt livre e cartão de desempenho.
- **Regra atual:** CLAUDE.md §7: não inventar escopo nem dado. O brief define os blocos de cada tela; a matriz de permissões é fixa (permissions.ts + RLS); dado de paciente em lista exige audit_log; não há fonte para ticket, satisfação ou investimento.
- **Opções:** (a) Não construir nada disso nesta adoção; usar só a forma do kit sobre o conteúdo do brief; entregar a lista ao dono como backlog a decidir. (b) Construir o que parecer útil (escopo novo sem aprovação).
- **Recomendação:** (a). Nenhum item vira código sem entrar em docs/01 ou docs/05.

### C26. Cabeçalho e blocos do Início
- **DS:** Início do kit: eyebrow com a data, 'Bom dia, Rafaela', frase com contagens, KPIs de HOJE, lista 'Conversas aguardando você' com nome e prévia, 'Agenda de hoje' com nomes, cartão escuro do Agente com números.
- **Regra atual:** Brief Tela 5: 4 indicadores do período, herói Consultas recuperadas, desempenho da IA, funil, origem, custo e próximas ações com contagens. CLAUDE.md 3.1: leitura de dado de paciente vai para audit_log (o Início é só agregado de propósito). Agente adiado para a Fase 3.
- **Opções:** (a) Manter o conteúdo do brief com o visual do DS; do kit entram só a data como eyebrow, a saudação no fuso da clínica e a frase com contagens reais de proximasAcoes (dado já buscado); cartão do Agente só quando o agente existir. (b) Adotar as listas com nome (escopo novo com trilha de leitura). (c) Nada do kit, título 'Início' como hoje.
- **Recomendação:** (a). A saudação muda o h1 da página, então precisa do OK por ser conteúdo; enquanto isso, (c) com o visual novo.

### C27. Confirmações: faixa do segundo lembrete e filtro
- **DS:** Banner lime '19 pacientes ainda não responderam' com botão 'Enviar 2º lembrete' e a estatística 'o segundo lembrete costuma converter 6 em cada 10 pendentes'; tabela plana com filtro segmentado (Todas, Confirmadas, Aguardando, Canceladas, Falhas), busca e colunas Canal e Enviado.
- **Regra atual:** O produto não tem '2º lembrete' manual (a régua tem passos; a ação manual é 'Cobrar'); a estatística não existe (não inventar dado); brief Tela 2: lista agrupada por profissional, em ordem de horário, sem filtro; o e2e usa getByText exato em 'Pendentes', 'Confirmadas' e 'Canceladas' e o nome único 'Mensagens automáticas'.
- **Opções:** (a) Faixa factual sem botão: '{n} pacientes ainda não responderam' e 'A próxima mensagem automática sai às HH:MM' (tom info), ou 'Régua de confirmação desligada' com 'Ligar a régua' (tom warning); filtro local sobre os mesmos dados com rótulos no singular (Todas, Aguardando, Confirmado, Cancelado, Não enviada) e busca, mantendo o agrupamento. (b) Só o visual, sem faixa e sem filtro. (c) Criar o 2º lembrete manual (escopo novo).
- **Recomendação:** (a) se o dono aprovar, por ser conteúdo novo; até lá, (b).

### C28. Indicadores na lista de Pacientes
- **DS:** ScreenPacientes tem 4 StatCards (Pacientes ativos com delta, Novos no mês, Retorno em 90 dias, Sem contato há 6 meses), busca e 'Novo paciente'.
- **Regra atual:** Brief Tela 9 não tem indicadores; não há definição de 'ativo' nem de 'retorno' nem histórico para delta; paciente é quem já teve consulta, então 'Novo paciente' contradiz o modelo; exportar é dado de saúde em massa.
- **Opções:** (a) Nada. (b) 4 cartões estáticos derivados dos filtros existentes (Pacientes, Risco de falta, Inativos, Saldo de pacote), contados no cliente, sem delta, não clicáveis. (c) KPIs do kit com definições e query novas.
- **Recomendação:** (a) até o dono decidir; se ele quiser números, (b). Os cartões não podem ser botões, porque colidiriam com o filtro 'Com pacote' no e2e.

### C29. Atendimento: diferenças do kit
- **DS:** Kit: ações Transferir, Resolver e Mais ações no cabeçalho do fio; botão de envio redondo só com ícone; nota interna à esquerda; selo de canal verde #25d366 no avatar; marcas de entrega (check, check duplo, relógio) só por ícone; prévia com o texto da última mensagem; faixa de sugestão da IA e respostas rápidas.
- **Regra atual:** Brief: Assumir, Devolver para a IA, Resolver e menu no cabeçalho (o app põe no compositor e o e2e clica 'Assumir conversa' no aviso do compositor); 'Enviar' e 'Salvar nota' se distinguem por texto (houve defeito de nota indo ao paciente); lado da bolha indica autoria; branco sobre #25d366 dá 1,98:1 e só existe um canal; marcas de entrega e respostas rápidas não estão no backlog; a prévia exige mudar a query.
- **Opções:** (a) Nesta passada: ações no compositor como hoje; Enviar com texto (40px) e Salvar nota em tinta com cadeado; nota à direita; sem selo de canal; sem marcas de entrega; prévia 'Tipo · Etapa'; sem sugestão da IA. Depois da leva de lógica, subir Devolver e Resolver para o cabeçalho (brief e kit concordam), extraindo um hook useAcoesDaConversa, com Assumir só no aviso. (b) Seguir o kit em tudo.
- **Recomendação:** (a). A mudança das ações para o cabeçalho e a prévia da última mensagem ficam como itens separados para o dono priorizar, porque mexem em lógica e query.

### C30. Sintaxe das variáveis e ponto de vista da prévia do WhatsApp
- **DS:** Variáveis com chave simples ({primeiro_nome}, {profissional}) e contador de 320 caracteres; a prévia mostra a mensagem como bolha de saída da clínica, à direita, em lime ou tinta.
- **Regra atual:** App (lib/domain/modelo-mensagem.ts): {{nome}}, {{clinica}}, {{data}} etc., limite de 2000, textos já salvos nas réguas. Brief Tela 7: prévia 'em balão de WhatsApp' com os botões renderizados; o app titula 'Como o paciente vê'.
- **Opções:** (a) Manter {{campo}} e 2000; adotar só a apresentação (dica e contador n/2000); prévia como bolha recebida pelo paciente, à esquerda, branca, botões em fileiras neutras, sem gastar o lime. (b) Trocar a sintaxe (quebra textos salvos e o envio).
- **Recomendação:** (a).

### C31. Switch contra Checkbox em formulário com Salvar
- **DS:** Switch só para o que aplica na hora; dentro de formulário com botão Salvar, Checkbox com rótulo e descrição.
- **Regra atual:** O app usa Switch em formulários com Salvar (profissional ativo, exige avaliação, IA pode agendar, conversões da jornada, envio sem identificador na Meta). Nenhum e2e atual usa esses switches, mas o papel muda de 'switch' para 'checkbox'.
- **Opções:** (a) Trocar por Checkbox nos formulários com Salvar e manter Switch onde aplica na hora (régua, código da clínica, IA do vínculo, devolver conversões). (b) Manter Switch em tudo.
- **Recomendação:** (a). É também o comportamento correto para leitor de tela; tratar o valor 'indeterminate' do Radix Checkbox no handler.

### C32. Eyebrow de 10px contra micro de 11px
- **DS:** Eyebrow de 10px, caixa alta, 0,14em, negrito, em rótulo de KPI, cabeçalho de coluna e de seção; horários da grade em 10,5px; hora da bolha em 10px.
- **Regra atual:** Brief 3.6: 'Micro' em 11px e texto pequeno com 4,5:1 e leitura fácil para a recepcionista.
- **Opções:** (a) 10px só no eyebrow (caixa alta, negrito, 6,76:1) e em contador numérico dentro de pílula; todo outro texto com no mínimo 11px. (b) 11px também no eyebrow. (c) Escala do DS inteira, com 10 e 10,5px em hora e metadado.
- **Recomendação:** (a). O eyebrow em caixa alta e negrito lê como maior; horários e metadados sobem para 11px.

### C33. Seletor de dimensão em Resultados
- **DS:** SegmentedControl para 2 a 4 vistas exclusivas; Select é para listas.
- **Regra atual:** Brief Tela 11 e spec 10.7: 'dimensão primária trocável por dropdown'.
- **Opções:** (a) Manter o Select. (b) SegmentedControl para Canal/Campanha e Profissional/Procedimento/Situação, mesmo comportamento com as opções à vista.
- **Recomendação:** (b) com o aval do dono, porque o brief diz 'dropdown'; até lá, (a).

### C34. Marca em fundo claro
- **DS:** O wordmark só existe em creme; em fundo claro o DS monta o símbolo em tinta com 'conduzza' escrito em Manrope 800 (texto imitando o logotipo).
- **Regra atual:** Brief Tela 12 e spec 11.2 pedem logo em versão clara e escura. O repo tem public/brand/conduzza-logo-preta.png, wordmark antigo sem símbolo.
- **Opções:** (a) Pedir ao dono o lockup oficial em tinta; até chegar, nenhum lugar usa marca em fundo claro (login no celular e e-mail usam faixa ink). (b) A construção do DS. (c) O wordmark antigo.
- **Recomendação:** (a). A opção (c) misturaria duas versões da marca.

### C35. A pasta do DS e as imagens do Behance no git
- **DS:** uploads/Behance_3_Projetos_Imagens/ traz 44 imagens (10 MB de 12 MB) de três projetos da RondesignLab, usadas como referência de clima, 'não são telas da Conduzza'. Hoje a pasta do DS não está rastreada.
- **Regra atual:** Não há regra escrita, mas é obra de terceiros; o handoff anterior foi versionado como referência. Um git add -A de qualquer agente leva as imagens para o histórico, e tirar depois exige reescrever o histórico. O lint já quebra por causa do _ds_bundle.js.
- **Opções:** (a) Versionar a pasta do DS como referência, com o Behance no .gitignore (e movido para o Drive do dono), a pasta no ignores do eslint, no exclude do tsconfig e no @source not do Tailwind. (b) Não versionar a pasta do DS. (c) Versionar tudo.
- **Recomendação:** (a), com a regra do .gitignore antes de qualquer commit.

### C36. Login em fundo ink
- **DS:** brand-surfaces: 'Chrome e marketing: ink com lime. Sidebar, toasts, telas de login, hero.'
- **Regra atual:** CLAUDE.md §5: claro por padrão, escuro obrigatório; o login hoje segue a chave de tema.
- **Opções:** (a) Tela dividida: painel ink com o lockup oficial e o slogan, formulário no tema ativo; no celular, faixa ink de 56px no topo. (b) Tela inteira em ink. (c) Tudo claro com o símbolo em tinta.
- **Recomendação:** (a). Mostra a marca oficial e mantém o tema claro por padrão no formulário.

### C37. Voz do sistema e nomes
- **DS:** O produto nunca diz 'eu' nem 'nós'. O produto se chama 'Conduzza Chat'; as telas são 'Resultados', 'Cadastro', 'Planos de saúde'; o agente se chama 'Agente Conduzza'.
- **Regra atual:** Brief e app: Conduzza Clínicas (white-label), 'Cadastros', 'Convênios', 'Resultados' (já no menu), autor da IA 'Assistente'; hoje há textos com 'nós' ('Enviamos um link de confirmação', 'a gente confirma'). Conteúdo é do brief.
- **Opções:** (a) Manter os nomes do app e do brief; decidir a voz impessoal à parte e, se aprovada, reescrever tudo de uma vez (nenhum e2e depende desses textos). (b) Adotar os nomes do DS.
- **Recomendação:** (a). Esta adoção muda só a aparência.
