# CLAUDE.md

Regras permanentes do projeto **Conduzza Clínicas**. Leia este arquivo inteiro antes de qualquer tarefa. Ele tem precedência sobre suposições suas.

---

## 1. O que estamos construindo

SaaS multi-tenant que coloca uma recepcionista de IA no WhatsApp de clínicas médicas e de estética. Ela responde 24 horas, informa preço e convênio, agenda, remarca, cancela, confirma consulta e reoferta horário cancelado. O software também guarda leads, pacientes, agenda e mostra de qual campanha cada paciente veio.

**Documentação obrigatória, nesta ordem:**

| Arquivo | Quando ler |
|---|---|
| `docs/01_spec_funcional_conduzza_clinicas.md` | Antes de implementar qualquer módulo. É a fonte da verdade funcional |
| `docs/03_arquitetura.md` | Antes de criar arquivo, escolher biblioteca ou desenhar fluxo |
| `docs/04_modelo_dados.md` | Antes de qualquer migration |
| `docs/05_backlog.md` | Para saber o que fazer agora e em que ordem |
| `docs/02_brief_telas_claude_design.md` | Antes de construir qualquer tela. Tem paleta, tipografia, estados e componentes |

`docs/benchmarks/` é material de pesquisa. Não leia inteiro. Consulte só quando precisar justificar uma decisão de produto.

---

## 2. Stack (não trocar sem me perguntar)

| Camada | Escolha |
|---|---|
| Framework | Next.js 15, App Router, Server Components por padrão |
| Linguagem | TypeScript strict. `any` é erro, não estilo |
| Estilo | Tailwind CSS v4 + shadcn/ui |
| Estado de servidor | TanStack Query |
| Formulários | react-hook-form + Zod |
| Banco | Supabase Postgres, com RLS ligada em toda tabela |
| Auth | Supabase Auth |
| Tempo real | Supabase Realtime (Inbox e Agenda) |
| Arquivos | Supabase Storage |
| Jobs e filas | Tabela `job_queue` + `pg_cron` + Edge Function worker |
| Webhooks | Supabase Edge Functions (Deno) |
| Ícones | Lucide, traço 1.5px |
| Datas | date-fns com locale pt-BR |
| Testes | Vitest (unidade) + Playwright (fluxo crítico) |

---

## 3. Regras que não se negociam

### 3.1 Multi-tenant e LGPD

- **Toda tabela de dado de negócio tem `clinic_id NOT NULL` e RLS ligada.** Sem exceção.
- **Nunca** filtrar tenant só no código da aplicação. O filtro vive na policy do Postgres. Se a RLS falhar, o dado não pode vazar.
- Dado de saúde é dado sensível (LGPD art. 5º, II). Conversa de paciente conta como dado de saúde.
- Toda leitura de dado de paciente por usuário humano vai para `audit_log`.
- Nunca logar conteúdo de mensagem de paciente em log de aplicação, Sentry ou console.

### 3.2 Conformidade CFM (isso pode fechar a clínica do cliente)

O agente de IA **não pode**, em hipótese alguma:
- fazer triagem de sintoma ou orientar clinicamente (Resolução CFM 2.314/2022, teletriagem é ato médico privativo)
- prometer ou garantir resultado (Resolução CFM 2.336/2023, art. 11, XII)
- indicar medicamento, dosagem ou diagnóstico
- fazer oferta casada de procedimento

Isso é implementado como **filtro na saída**, rodando depois do LLM e antes do envio, não como instrução de prompt. Prompt não é garantia. Ao bloquear: não envia, escala para humano, grava em `ai_decision_log`.

### 3.3 Canal WhatsApp

**Decisão do dono do produto em 19/08/2026, revisando a regra original ("só API oficial"):** o canal inicial é o **uazapi** (API não oficial, pareamento por QR), na modalidade "uazapi agora, oficial depois". Todo código de canal passa pela **camada adaptadora** em `lib/integrations/whatsapp/provider.ts` (provedores `fake`, `uazapi` e, no futuro, `cloud_api`): migrar para a Cloud API oficial é trocar configuração, nunca reescrever. Riscos informados e aceitos para o período de validação: possibilidade de banimento do número por automação não oficial (agravada por disparo em massa), ausência de quality rating (monitorar desconexões como proxy) e botões interativos sem garantia (fallback automático em texto numerado).

O que **não** mudou com essa decisão:

- **Nunca disparar para contato sem `consent.active = true`.** No canal não oficial isso importa ainda mais: denúncia de spam acelera banimento.
- Webhook **idempotente**: `wa_message_id` é chave única, venha de onde vier.
- Toda mensagem enviada grava custo (`cost_cents`): 0 e `billable = false` no uazapi; a tabela `message_pricing` alimenta o cálculo quando o canal oficial existir.
- Disparo em massa (réguas) passa obrigatoriamente pela `job_queue` com rate limit por instância. O atraso anti-ban do provider vale só para resposta 1:1.
- **Janela de 24 horas e templates aprovados são conceitos do canal oficial:** o código fica atrás de `isOfficialChannel` e não aparece na UI com uazapi/fake.
- Nenhum dado de paciente em log, em nenhum canal.

### 3.4 Agenda

- **Conflito de horário é impedido pelo banco**, com exclusion constraint (`btree_gist`), não por checagem no código. Duas requisições simultâneas não podem marcar o mesmo slot.
- Reserva temporária (`slot_hold`) expira sozinha. A IA oferece horário, o slot trava por 10 minutos.
- Falta (`no_show`) é sempre ação explícita de alguém. Nunca inferida por passagem de tempo.

### 3.5 Datas e fuso

- Guardar sempre em `timestamptz` (UTC no banco).
- Exibir sempre no fuso da clínica (`clinic.timezone`, padrão `America/Fortaleza`).
- Nunca usar `new Date()` sem fuso explícito em lógica de régua ou agenda.

---

## 4. Regras de código

- Server Components por padrão. `"use client"` só quando houver estado, evento ou hook de browser.
- Toda mutação passa por Server Action ou Route Handler com validação Zod na entrada. Nunca confiar no cliente.
- Nomes de arquivo em `kebab-case`. Componentes em `PascalCase`. Tabelas e colunas em `snake_case`.
- Nada de `console.log` em código que vai para a branch principal.
- Tipos do banco são **gerados**, nunca escritos à mão: `supabase gen types typescript`.
- Toda função que fala com serviço externo (Meta, LLM, gateway) fica em `lib/integrations/` e tem retry com backoff e timeout explícito.
- Preferir composição a abstração precoce. Não crie camada genérica antes do terceiro caso de uso.

---

## 5. Regras de interface

Leia `docs/02_brief_telas_claude_design.md` antes de criar tela. Resumo do que mais se erra:

- Escuro por padrão, claro obrigatório. Use os tokens da seção 3 do brief, nunca hex solto no componente.
- **Todo status é comunicado por 3 camadas: ícone com forma distinta, rótulo em texto e cor.** Nunca só cor. Nunca o mesmo ícone em cores diferentes.
- Proibido: gráfico de pizza, rosca, barra empilhada, medidor, treemap e 3D. Barras horizontais ou linha com marcadores.
- Proibido: gradiente decorativo, vidro fosco, sombra colorida, ilustração 3D.
- **Nenhum travessão no texto de interface.** Nem em copy, nem em placeholder, nem em mensagem de erro. Use vírgula, dois pontos ou parênteses.
- Linguagem de recepcionista, não de programador: "Assumir" e não "handoff", "clínica" e não "tenant", "autorização para receber mensagens" e não "opt-in".
- Alvo de toque mínimo de 40x40px. Contraste WCAG AA (4.5:1 em texto, 3:1 em borda de controle).
- Ação sem permissão fica visível e desabilitada, com dica. Nunca escondida.

---

## 6. Definição de pronto

Uma tarefa só está pronta quando **tudo** abaixo é verdade:

- [ ] `npm run build` passa sem erro e sem warning novo
- [ ] `npm run typecheck` e `npm run lint` limpos
- [ ] RLS testada: um usuário da clínica A **não** consegue ler dado da clínica B (teste automatizado, não inspeção visual)
- [ ] Estados de vazio, carregando e erro implementados, não só o caminho feliz
- [ ] Tema claro e escuro conferidos
- [ ] Nenhum dado de paciente em log
- [ ] Se mexeu em envio de mensagem: opt-in verificado e custo gravado
- [ ] Se mexeu em agenda: teste de duas marcações simultâneas no mesmo slot

---

## 7. Como trabalhar comigo

- **Não invente escopo.** Se não está em `docs/01` ou em `docs/05_backlog.md`, pergunte antes de construir.
- **Não invente dado.** Se falta uma informação (preço da Meta, regra de convênio, número), pare e pergunte. Não preencha com valor plausível.
- Antes de tarefa grande, mostre o plano e espere confirmação.
- Se encontrar contradição entre os documentos, pare e aponte. Não escolha sozinho.
- Se eu pedir algo que quebra uma regra da Seção 3, me avise antes de fazer.
- Prefira dizer "isso vai dar problema porque X" a entregar calado.
