# Modelo de Dados
### Conduzza Clínicas, V1

SQL de referência. Não é a migration final: o Claude Code deve gerar as migrations a partir daqui, uma por fase do backlog, revisando nomes e índices.

**Convenções:** `snake_case`, chave primária `uuid default gen_random_uuid()`, todo timestamp em `timestamptz`, toda tabela de negócio com `clinic_id not null` e RLS habilitada, `created_at` e `updated_at` em tudo.

---

## 1. Núcleo e acesso

```sql
create table clinic (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  timezone text not null default 'America/Fortaleza',
  spend_cap_cents integer,
  spend_cap_action text not null default 'pausar',   -- pausar | avisar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table clinic_branding (
  clinic_id uuid primary key references clinic(id) on delete cascade,
  product_name text not null default 'Conduzza Clínicas',
  primary_color text not null default '#5B9CFF',
  logo_wide_light text, logo_wide_dark text,
  logo_icon_light text, logo_icon_dark text,
  labels jsonb not null default '{"profissional":"profissional","procedimento":"procedimento","paciente":"paciente","consulta":"consulta"}'
);

create table clinic_member (
  clinic_id uuid not null references clinic(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','gestor','recepcao','profissional','leitura')),
  professional_id uuid,                 -- preenchido quando role = profissional
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table unit (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null, address text, phone text,
  active boolean not null default true
);
```

---

## 2. Catálogo clínico

```sql
create table professional (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null,
  photo_url text,
  council_type text,          -- LIVRE: CRM, CRO, CREFITO, CRBM, CRN, ou null p/ esteticista
  council_number text,
  specialties text[] not null default '{}',
  calendar_color text,
  active boolean not null default true
);

create table professional_schedule (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id) on delete cascade,
  unit_id uuid references unit(id),
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null
);

create table professional_block (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  blocks_overbooking boolean not null default true
);

-- Sem tela desde 29/09/2026 (decisão do dono): a tabela, a coluna
-- procedure.resource_id e a trava sem_sobreposicao_recurso continuam.
create table resource (                       -- sala, cabine, equipamento
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  unit_id uuid references unit(id),
  name text not null,
  kind text not null check (kind in ('sala','cabine','equipamento')),
  active boolean not null default true
);

create table procedure (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null,
  description text,
  default_duration_min integer not null default 30,
  base_price_cents integer,
  requires_evaluation boolean not null default false,
  prep_instructions text,
  resource_id uuid references resource(id),   -- sem campo na tela desde 29/09/2026
  bookable_by_ai boolean not null default true, -- fonte única: o vínculo segue esta chave
  active boolean not null default true
);

create table insurance (                      -- convênio
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null,
  plan_name text,
  requires_card boolean not null default true,
  notes text,
  active boolean not null default true
);

-- A MATRIZ DE TRÊS PONTAS. É o coração do cadastro.
-- Desde 29/09/2026 é gerida pelo PROCEDIMENTO (seção "Quem faz e convênios"
-- do modal), gravada de uma vez pela RPC sincronizar_vinculos_do_procedimento
-- (ver a nota abaixo). Não há mais tela própria de vínculos.
create table service_link (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id) on delete cascade,
  procedure_id uuid not null references procedure(id) on delete cascade,
  insurance_id uuid references insurance(id),        -- null = particular
  price_cents integer,                                -- null = coberto pelo convênio
  covered_by_insurance boolean not null default false,-- diferencia "coberto" de "zero" e de "vazio"
  duration_min integer not null,
  bookable_by_ai boolean not null default true,
  active boolean not null default true,
  unique (professional_id, procedure_id, insurance_id)
);

create table package (                        -- pacote de sessões, exigência do nicho de estética
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  price_cents integer not null,                -- o valor que a clínica define; não é distribuído entre os itens
  validity_days integer,                       -- validade do PACOTE (conta da venda); null = não vence
  active boolean not null default true,        -- "à venda"
  procedure_id uuid references procedure(id),  -- LEGADO desde 29/09/2026 (código novo grava null); sai no contrato
  sessions integer check (sessions > 0)        -- LEGADO desde 29/09/2026; sai no contrato
);

-- Os procedimentos do pacote (29/09/2026): Botox 2 sessões + Facelift 1 sessão.
create table package_item (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  package_id uuid not null references package(id) on delete cascade,
  procedure_id uuid not null references procedure(id),
  sessions integer not null check (sessions > 0),
  unique (package_id, procedure_id)            -- o mesmo procedimento uma vez só
);
```

> **Atenção de produto:** `price_cents = 0` e `covered_by_insurance = true` e `price_cents is null` são **três coisas diferentes** e a interface precisa mostrar as três de forma diferente ("R$ 0,00", "Coberto", campo vazio). Confundir isso faz a IA informar preço errado ao paciente.

> **`service_link` é gerido pelo Procedimento (decisão do dono em 29/09/2026, migration `20260929100000_vinculos_do_procedimento.sql`).** A tela manda o estado desejado do procedimento inteiro (uma linha por profissional e convênio, com preço, "Coberto" e duração já resolvidos: o padrão do procedimento vira valor concreto antes de gravar) para a RPC `sincronizar_vinculos_do_procedimento(p_procedure_id uuid, p_linhas jsonb) returns jsonb`, que reconcilia numa transação só:
> - **cria** o vínculo que ainda não existe;
> - **reativa e atualiza** o que existe (ativo ou não) e continua na lista; o unique de três pontas faz o Particular desativado voltar em vez de duplicar;
> - **desativa, nunca apaga,** o vínculo ativo que saiu da lista: `appointment.service_link_id` continua apontando para ele, e desativado ele some do modal de agendamento e da reoferta da lista de espera;
> - grava `bookable_by_ai = procedure.bookable_by_ai` em todo vínculo (uma fonte só para "IA pode agendar");
> - devolve `{criados, reativados, atualizados, desativados, consultas_futuras}`; `consultas_futuras` conta as consultas que ainda vão acontecer nos vínculos que acabaram de sair (a desativação não desmarca nada, a recepção remarca ou cancela pela Agenda).
>
> É `SECURITY INVOKER`, com `execute` só para `authenticated`: a RLS de `procedure` e de `service_link` vale inteira. O papel é conferido no começo (admin ou gestor, senão 42501); procedimento de outra clínica ou inexistente dá "não encontrado" (P0002); profissional ou convênio de outra clínica é recusado pelo gatilho `exigir_cadastro_da_mesma_clinica` (23503). A linha do procedimento fica travada (`FOR UPDATE`) durante a reconciliação: dois Salvar simultâneos do mesmo procedimento rodam em série e o último vence por inteiro. A lista é validada antes de gravar (até 500 linhas, duração de 5 a 600 minutos, preço não negativo, "Coberto" só com convênio, o mesmo profissional no mesmo convênio uma vez só).

> **Pacote com vários procedimentos (pedido do dono em 29/09/2026, migration `20260929120000_pacote_com_varios_procedimentos.sql`).** Um pacote junta procedimentos em `package_item` (procedimento e sessões, cada procedimento uma vez). O cadastro mostra o **preço avulso** (soma de sessões x `procedure.base_price_cents` de cada item, **calculado** na leitura, nunca gravado; item de procedimento sem preço base deixa a soma incompleta e a tela diz isso) ao lado do **preço do pacote** (`package.price_cents`, o valor que a clínica define), para ver o desconto. A validade é do pacote. O preço do pacote não é distribuído entre os itens.
> - **Gravação:** RPC `salvar_pacote(p_clinic_id uuid, p_name text, p_itens jsonb, p_price_cents integer, p_validity_days integer, p_active boolean, p_package_id uuid default null) returns uuid`, `SECURITY INVOKER`, cria ou edita pacote e itens numa transação (`p_itens = [{procedure_id, sessions}]`, 1 a 30 itens, 1 a 200 sessões). Papel admin ou gestor (42501); pacote de outra clínica, P0002; procedimento de outra clínica, 23503; regra, 23514 com a mensagem em português.
> - **Item de pacote vendido fica congelado** (gatilho `travar_itens_de_pacote_vendido`, em qualquer caminho): o item não entra, não sai e não muda de procedimento ou de sessões depois da primeira venda (23514). Nome, preço, validade e "à venda" continuam editáveis; mandar os mesmos itens passa. A trava pega a linha do pacote `FOR UPDATE`, que conflita com o `KEY SHARE` da FK da venda: item mudando e venda acontecendo rodam em série.
> - **Isolamento:** `package_item` tem as mesmas policies de `package` (membro ativo lê, admin e gestor escrevem) e entra em `exigir_cadastro_da_mesma_clinica` (pacote e procedimento da mesma clínica, 23503). O gatilho de isolamento roda antes do de congelamento, então o item que aponta pacote de outra clínica nunca revela se ele foi vendido.
> - **Modo expand:** `package.procedure_id` e `package.sessions` ficaram opcionais e o código novo não os usa. Enquanto o código publicado antes existir, o INSERT/UPDATE antigo (procedure_id + sessions) vira o item único do pacote (gatilho `espelhar_item_do_pacote_legado`) e o pacote criado sem nome recebe o nome do procedimento (`preencher_nome_do_pacote_legado`). A migration de contrato apaga as duas colunas e os dois gatilhos.

---

## 3. Contatos, leads e pacientes

```sql
create table contact (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  phone_e164 text not null,
  name text,
  cpf text, email text, birth_date date,
  insurance_id uuid references insurance(id),
  insurance_card text,
  kind text not null default 'lead' check (kind in ('lead','paciente')),
  funnel_stage text not null default 'novo'
    check (funnel_stage in ('novo','em_contato','aguardando_resposta','agendou','compareceu','perdido')),
  lost_reason text,
  owner_user_id uuid references auth.users(id),
  tags text[] not null default '{}',
  -- atribuição de origem, preservada para sempre
  source_channel text, source_origin text, source_medium text, source_campaign text,
  source_captured_at timestamptz, source_method text,
  first_contact_at timestamptz not null default now(),
  last_contact_at timestamptz,
  inactive_since timestamptz,
  no_show_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (clinic_id, phone_e164)
);

-- Consentimento. Sem isso o disparo derruba o quality rating do número.
create table contact_consent (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  channel text not null default 'whatsapp',
  source text not null,          -- formulario_site | anuncio_ctwa | recepcao | importacao_planilha | conversa
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  active boolean generated always as (revoked_at is null) stored,
  evidence text
);

-- A venda de um pacote a um contato. A validade é da venda inteira.
create table package_balance (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  package_id uuid not null references package(id),
  expires_at date,                             -- dia civil da clínica; null = não vence
  -- LEGADO desde 29/09/2026: soma dos itens, mantida pelo gatilho
  -- espelhar_totais_no_saldo_legado para o código antigo; sai no contrato.
  sessions_used integer not null default 0,
  sessions_total integer
);

-- O saldo vendido, POR PROCEDIMENTO: cópia dos itens do pacote feita na
-- venda, que isola o que o paciente comprou de qualquer edição futura do
-- pacote. Procedimento, venda e sessões vendidas não mudam depois de
-- gravados: pela sessão, só sessions_used tem UPDATE (o que o ajuste grava).
create table package_balance_item (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  package_balance_id uuid not null references package_balance(id) on delete cascade,
  procedure_id uuid not null references procedure(id),
  sessions_total integer not null check (sessions_total > 0),
  sessions_used integer not null default 0 check (sessions_used >= 0),
  check (sessions_used <= sessions_total),
  unique (package_balance_id, procedure_id)
);

-- Trilha de ajuste e cancelamento de saldo (quem, antes, depois e o motivo).
create table package_balance_adjustment (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  package_balance_id uuid references package_balance(id) on delete set null,
  package_balance_item_id uuid references package_balance_item(id) on delete set null,
  procedure_id uuid references procedure(id),  -- qual procedimento; null = ajuste só da validade
  package_id uuid not null references package(id),
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('ajuste','cancelamento')),
  sessions_total integer not null,
  sessions_used_before integer not null,
  sessions_used_after integer,
  expires_at_before date,
  expires_at_after date,
  reason text not null,
  created_at timestamptz not null default now()
);
```

**Saldo de pacote por item (29/09/2026).** Todas as funções abaixo são `SECURITY INVOKER` (a RLS e o papel da sessão valem lá dentro), com `execute` só para `authenticated` e `service_role`:

- `vender_pacote(p_contact_id uuid, p_package_id uuid, p_inicio date default null, p_usadas jsonb default '[]') returns uuid`: grava a venda e copia os itens do pacote numa transação. `p_inicio` é o dia em que o pacote começou (null = hoje no fuso da clínica; a validade conta dali); `p_usadas = [{procedure_id, sessions_used}]` cobre o pacote **em andamento** de quem chega ao sistema no meio dele. Precisa sobrar ao menos uma sessão. Papel admin, gestor e recepção (42501); pacote ou paciente de outra clínica, P0002; pacote desativado, data futura, pacote já vencido, sessões fora do item ou procedimento fora do pacote, 23514.
- `ajustar_saldo_de_pacote(p_balance_id uuid, p_itens jsonb, p_expires_at date, p_reason text)`: `p_itens = [{item_id, sessions_used}]` (só os itens a gravar) e a validade da venda. Grava na trilha uma linha por item que mudou (com o item e o procedimento); ajuste só da validade grava uma linha sem item. Nada mudou é recusado (23514). Leitura, profissional e outra clínica recebem P0002 (o `FOR UPDATE` com RLS não devolve a venda). A assinatura antiga `(uuid, integer, date, text)` continua para venda de **um** procedimento até a migration de contrato.
- `cancelar_venda_de_pacote(p_balance_id uuid, p_reason text)`: só admin e gestor; venda com consulta que descontou (pela venda **ou** por um item dela) não se cancela (23503, o caminho é o ajuste). A trilha guarda uma linha por procedimento cancelado.
- `uso_dos_pacotes(p_clinic_id)` e `pacientes_resumo(p_clinic_id)` somam pelos itens; `saldo_sessoes` (sessões sobrando nas vendas dentro da validade) e `saldo_total` (sessões vendidas) continuam números únicos.

**Débito no Compareceu (gatilho `consumir_sessao_de_pacote`, `BEFORE UPDATE OF status` na troca para `compareceu`).** O item do procedimento do vínculo da consulta, do mesmo contato, com sessão sobrando, de venda dentro da validade no dia civil da clínica; a venda que vence primeiro (sem validade por último), no empate a mais antiga e por fim o id. `SKIP LOCKED`. Grava `appointment.package_balance_item_id` **e** `package_balance_id`. A tela prevê o item com `saldoDescontadoAoComparecer` (`lib/domain/appointment-status.ts`), espelho desta regra. Falta nunca desconta.

**Escrita direta pela API (migration `20261002100000`, 02/10/2026).** O saldo muda pelas RPCs, com trilha, e pelo débito do Compareceu. O que a sessão de quem está logado **não** faz direto:

- `package_balance`: UPDATE só em `expires_at` (desde a `20260929120000`); `sessions_total` e `sessions_used` são o espelho legado.
- `package_balance_item`: UPDATE só em `sessions_used`, a coluna que `ajustar_saldo_de_pacote` grava pela sessão. `sessions_total`, `procedure_id`, `package_balance_id` e `clinic_id` nascem no INSERT da venda e só mudam pelos caminhos `SECURITY DEFINER` (débito e espelhos legados). Mudar o total direto dá 42501 para qualquer papel, admin e gestor inclusive.
- `appointment.package_balance_id` e `package_balance_item_id`: depois que a consulta tem desconto (qualquer das duas preenchida), nenhuma das duas muda nem é limpa. Gatilho `travar_desconto_de_pacote` (`BEFORE UPDATE OF` as duas colunas), 23514 com "O desconto de pacote desta consulta não muda. Para corrigir, ajuste o saldo na ficha do paciente.". Vale para todo papel, `service_role` inclusive. Sem a trava, limpar as duas colunas de uma consulta em Compareceu liberava o cancelamento de venda já usada e um segundo débito ao sair e voltar para Compareceu. O débito não esbarra nela: `consumir_sessao_de_pacote` só preenche coluna vazia e escreve em `NEW` (fora do `OF`). INSERT não passa por ela.

**Ainda aberto até a migration de contrato**, no mesmo nível de antes (as RPCs `SECURITY INVOKER` e o código publicado antes dependem dessas permissões):

- UPDATE direto de `package_balance_item.sessions_used` pela recepção e pela gestão, sem trilha;
- INSERT direto de item numa venda já feita (`vender_pacote` insere os itens pela sessão);
- DELETE direto de item pela gestão (`cancelar_venda_de_pacote` apaga os itens pela sessão);
- INSERT direto em `package_balance` com `sessions_total` livre (é a venda do código antigo; `criar_itens_da_venda_legada` copia o total para o item);
- consulta **sem** desconto pode ganhar `package_balance_id` ou `package_balance_item_id` por UPDATE direto, sem debitar.

O contrato passa `vender_pacote`, `ajustar_saldo_de_pacote` (assinatura nova) e `cancelar_venda_de_pacote` para `SECURITY DEFINER`, com `set search_path = public` e papel e clínica conferidos de forma explícita (`user_has_role` da clínica da venda; o ajuste responde P0002 a quem não pode, para não revelar venda de outra clínica; o cancelamento só admin e gestor; `auth.uid()` na trilha), e então revoga INSERT, UPDATE e DELETE de `package_balance_item` e INSERT de `package_balance` para `authenticated`.

**Modo expand:** venda feita pelo INSERT antigo em `package_balance` (com `sessions_total`) ganha os itens pelo gatilho `criar_itens_da_venda_legada`; a venda nova grava `sessions_total` null e os itens ela mesma. A migration de contrato apaga `package_balance.sessions_total`, `sessions_used`, os gatilhos `criar_itens_da_venda_legada` e `espelhar_totais_no_saldo_legado` e a assinatura antiga do ajuste, além do fechamento de escrita do parágrafo acima (a lista completa está nos cabeçalhos da `20260929120000` e da `20261002100000`).

---

## 4. Conversas e mensagens

```sql
create table conversation (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  status text not null default 'ia_atendendo'
    check (status in ('ia_atendendo','aguardando_humano','em_atendimento','resolvida')),
  assignee_user_id uuid references auth.users(id),
  window_expires_at timestamptz,           -- janela de 24h da Meta
  unread_count integer not null default 0, -- por LER; zera ao abrir a conversa
  awaiting_reply boolean not null default false, -- ver nota abaixo
  last_message_at timestamptz,
  tags text[] not null default '{}',   -- CHAVES do catalogo, ver abaixo
  created_at timestamptz not null default now()
);

-- Catalogo de etiquetas por clinica (21/09/2026). conversation.tags guarda a
-- CHAVE, nunca o nome: por isso renomear uma etiqueta e um update de uma
-- linha so e todo chip muda junto, inclusive nas conversas ja resolvidas.
create table conversation_tag_def (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  chave text not null,                     -- imutavel por gatilho
  nome text not null,                      -- renomeavel
  tom text not null default 'neutral'      -- paleta de status, sem o violeta
    check (tom in ('neutral','info','warning','success','alert')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, chave)
);
```

**Duas invariantes de etiqueta, ambas do banco e não da tela.** Um gatilho em
`conversation` recusa qualquer chave que não exista no catálogo da clínica
(errcode 23514, o mesmo contrato da etapa do funil), e ele só roda quando
`tags` muda de fato, então o caminho quente da ingestão de mensagem não paga
nada. E excluir uma etiqueta do catálogo **a remove das conversas** no mesmo
gatilho: sem isso, uma chave pendurada faria o validador recusar toda edição
futura de etiqueta naquela conversa, e quem atende ficaria travado sem
entender o motivo.

**`awaiting_reply` não é o mesmo que `unread_count > 0`, e não é o mesmo que `status = 'aguardando_humano'`.** As três respondem perguntas diferentes, e confundi-las já custou dois defeitos:

| Coluna | Pergunta que responde | Por que não serve de contador |
|---|---|---|
| `status` | quem é o dono da conversa agora | a régua abre conversa em `aguardando_humano` só para enviar a confirmação: 40 disparos viram badge 40 |
| `unread_count` | tem mensagem por ler | zera quando alguém apenas ABRE para ler, e o lembrete some sem ninguém ter respondido |
| `awaiting_reply` | a última mensagem veio do paciente e ninguém respondeu | é este que o badge de Atendimento e a ordem do Inbox usam |

Sobe em `ingest_inbound_message` (mensagem de entrada). Desce **só** em envio com `author = 'usuario'` e ao resolver a conversa: toque automático de régua (`author = 'sistema'`) não apaga pergunta de paciente.

```sql
create table message (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  wa_message_id text unique,               -- IDEMPOTÊNCIA do webhook
  direction text not null check (direction in ('entrada','saida')),
  author text not null check (author in ('paciente','ia','usuario','sistema')),
  author_user_id uuid references auth.users(id),
  content_type text not null default 'texto',  -- texto | imagem | audio | documento | template | evento
  body text,
  media_url text,
  transcript text,                         -- transcrição de áudio recebido
  template_id uuid,
  is_internal_note boolean not null default false,
  pricing_category text,                   -- utility | marketing | service | authentication
  billable boolean not null default false,
  cost_cents integer,
  delivery_status text,                    -- enviada | entregue | lida | falhou
  error_code text,
  created_at timestamptz not null default now()
);

create table ai_decision_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  message_id uuid references message(id),
  tool_used text,
  context_read jsonb,
  escalation_reason text,
  compliance_blocked boolean not null default false,
  compliance_rule text,                    -- triagem | promessa_resultado | medicamento | oferta_casada
  blocked_draft text,                      -- o que a IA ia responder, para auditoria
  latency_ms integer,
  created_at timestamptz not null default now()
);
```

---

## 5. Agenda, com as travas de concorrência

```sql
create extension if not exists btree_gist;

create table appointment (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  unit_id uuid references unit(id),
  contact_id uuid not null references contact(id),
  professional_id uuid not null references professional(id),
  service_link_id uuid not null references service_link(id),
  resource_id uuid references resource(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'agendado' check (status in (
    'agendado','aguardando_confirmacao',
    'confirmado_paciente','confirmado_recepcao',
    'na_recepcao','em_atendimento','compareceu',
    'cancelado_paciente','cancelado_clinica','faltou'
  )),
  confirmed_by_user_id uuid references auth.users(id),
  confirmation_channel text,               -- whatsapp | telefone | presencial
  is_overbooking boolean not null default false,
  source text not null default 'interna' check (source in ('interna','externa')),
  external_id text,                        -- prepara integração com PMS no V2
  notes text,
  -- Venda de pacote e item (procedimento) que o Compareceu descontou; os
  -- dois ou nenhum. Sem cascata: consulta que descontou segura a venda.
  package_balance_id uuid references package_balance(id),
  package_balance_item_id uuid references package_balance_item(id),
  created_at timestamptz not null default now()
);

-- A trava. Impede duas marcações no mesmo horário mesmo em requisições simultâneas.
alter table appointment add constraint sem_sobreposicao_profissional
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelado_paciente','cancelado_clinica') and is_overbooking = false);

alter table appointment add constraint sem_sobreposicao_recurso
  exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (resource_id is not null and status not in ('cancelado_paciente','cancelado_clinica'));

create table appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  appointment_id uuid not null references appointment(id) on delete cascade,
  status text not null,
  changed_by_user_id uuid references auth.users(id),
  changed_by text not null default 'usuario' check (changed_by in ('usuario','ia','paciente','sistema')),
  changed_at timestamptz not null default now()
);

-- Reserva temporária: a IA oferece o horário, o slot trava por 10 minutos.
create table slot_hold (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id),
  contact_id uuid references contact(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  created_by text not null default 'ia'
);

create table waitlist (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  procedure_id uuid references procedure(id),
  professional_id uuid references professional(id),
  preferred_shifts text[],                 -- manha | tarde | noite
  preferred_weekdays smallint[],
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table waitlist_offer (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  slot_starts_at timestamptz not null,
  professional_id uuid not null references professional(id),
  offered_to uuid[] not null,
  responded_by uuid references contact(id),
  expires_at timestamptz not null,
  status text not null default 'aberta' check (status in ('aberta','preenchida','expirada','cancelada'))
);
```

---

## 6. Agente de IA

```sql
create table ai_agent_config (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  version integer not null default 1,
  published boolean not null default false,
  agent_name text not null default 'Assistente',
  tone text not null default 'cordial' check (tone in ('formal','cordial','proximo')),
  use_emoji boolean not null default false,
  greeting text, closing text,
  skills jsonb not null default '{}',       -- { "agendar": true, "informar_preco": true, ... }
  operating_mode text not null default '24h' check (operating_mode in ('24h','fora_expediente','fallback')),
  fallback_minutes integer default 5,
  operating_hours jsonb,
  escalation_rules jsonb not null default '{}',
  published_at timestamptz,
  published_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (clinic_id, version)
);

create table knowledge_item (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  question text not null,
  answer text not null,
  source text not null default 'manual',    -- manual | correcao_humano | documento
  active boolean not null default true
);
```

---

## 7. Réguas e fila de jobs

```sql
create table cadence (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  kind text not null check (kind in ('confirmacao','followup','pos_falta','reativacao','lista_espera')),
  name text not null,
  trigger_stage text,                       -- para followup
  -- Régua vinculada (29/09/2026): UM vínculo por régua, e só em confirmacao
  -- e pos_falta. Os três nulos = régua geral.
  procedure_id uuid references procedure(id),-- vínculo com um procedimento
  professional_id uuid references professional(id) on delete cascade, -- vínculo com um médico
  specialty text,                           -- vínculo com uma especialidade (rótulo como o usuário escolheu)
  for_no_show_history boolean not null default false,
  no_show_threshold integer not null default 2 check (no_show_threshold >= 1), -- faltas a partir das quais a reforçada vale
  send_window_start time, send_window_end time,
  send_weekdays smallint[],
  active boolean not null default false,
  constraint cadence_um_vinculo
    check (num_nonnulls(procedure_id, professional_id, specialty) <= 1),
  constraint cadence_especialidade_preenchida
    check (specialty is null or chave_de_especialidade(specialty) <> ''),
  constraint cadence_vinculo_so_na_agenda
    check (kind in ('confirmacao','pos_falta')
           or (professional_id is null and specialty is null)),
  constraint followup_sem_excecao
    check (kind <> 'followup'
           or (procedure_id is null and professional_id is null
               and specialty is null and not for_no_show_history))
);
create index cadence_professional_id_idx on cadence (professional_id);
-- Uma régua por recorte (tipo, vínculo e reforço). A especialidade entra pela
-- CHAVE: "Dermatologia" e "dermatologia " conflitam (23505).
create unique index cadence_configuracao_unica on cadence (
  clinic_id, kind,
  coalesce(procedure_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(chave_de_especialidade(specialty), ''),
  for_no_show_history
) where kind <> 'followup';

create table cadence_step (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  cadence_id uuid not null references cadence(id) on delete cascade,
  offset_minutes integer not null,          -- negativo = antes do evento
  use_ai boolean not null default false,
  template_id uuid,
  fixed_body text,
  stop_conditions text[] not null default '{respondeu,agendou,perdido}'
);

create table cadence_run (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  cadence_step_id uuid not null references cadence_step(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  appointment_id uuid references appointment(id),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  skipped_reason text,                      -- sem_consentimento | fora_janela | teto_gasto | condicao_parada | falha_envio
                                            -- | desconectado | canal_ocupado | numero_removido | consulta_remarcada
                                            -- | remarcacao_pedida | toque_atrasado
  -- Código curto do porquê da falha de envio (02/10/2026, migration
  -- 20261002110000). Só existe com skipped_reason = 'falha_envio'.
  motivo_da_falha text
    check (motivo_da_falha is null or motivo_da_falha ~ '^[a-z0-9_]{1,64}$')
    check (motivo_da_falha is null or skipped_reason is not distinct from 'falha_envio'),
  message_id uuid references message(id),
  -- Não duplica envio. appointment_id ENTRA na chave: sem ele, duas consultas
  -- do mesmo paciente no mesmo passo colidiam no toque manual ("Cobrar agora",
  -- que usa o minuto corrente como scheduled_for) e a segunda sumia em
  -- silêncio. nulls not distinct preserva a trava para régua sem consulta.
  unique nulls not distinct
    (cadence_step_id, contact_id, appointment_id, scheduled_for)
);

create table job_queue (
  id bigserial primary key,
  clinic_id uuid references clinic(id) on delete cascade,
  kind text not null,                       -- process_inbound | run_cadence_step | expire_holds | waitlist_offer
  payload jsonb not null,
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text
);
create index on job_queue (run_at) where completed_at is null;
```

> **Régua vinculada (decisão do dono em 29/09/2026, migration `20260929110000_regua_vinculada.sql`).** Cada régua de confirmação ou de pós falta pode ter **um** vínculo: um procedimento (`procedure_id`, que já existia), um profissional (`professional_id`) ou uma especialidade (`specialty`). Sem vínculo, é a régua geral, que o código lê como `procedure_id is null and professional_id is null and specialty is null and not for_no_show_history`. Follow-up não tem vínculo (`followup_sem_excecao`).
>
> - **`chave_de_especialidade(p_texto text) returns text`** (`immutable`, `strict`, `search_path` vazio): minúsculas, sem acento, sem espaço nas pontas e com os espaços internos colapsados (`translate` antes de `lower`). `professional.specialties` é texto livre, então a régua guarda o rótulo como o usuário escolheu e toda comparação (casar com o profissional, índice único) passa pela chave. A tela tem um espelho em TypeScript da mesma tabela de acentos (`components/automacoes/vinculo-da-regua.ts`): mudou uma, muda a outra.
> - **Mesma clínica:** `cadence` entra no gatilho `exigir_cadastro_da_mesma_clinica` (`before insert or update of clinic_id, procedure_id, professional_id`). O procedimento e o profissional da régua têm de ser da clínica da régua (23503). Isso fecha também a falha antiga de `procedure_id` apontando para procedimento de outra clínica, que a FK sozinha não pegava.
> - **`regua_da_consulta(p_appointment_id uuid, p_kind text) returns uuid`** (`stable`, `SECURITY INVOKER`, `execute` para `authenticated` e `service_role`): devolve a régua **ativa** do tipo (`confirmacao` ou `pos_falta`; outro tipo devolve nulo) que vale para a consulta. O procedimento vem do vínculo da consulta (`service_link`), o profissional e as especialidades vêm do profissional da consulta, o histórico de falta vem do contato (`no_show_count >= no_show_threshold` para a reforçada). Precedência: **procedimento (3) > profissional (2) > especialidade (1) > geral (0)**; no mesmo nível a reforçada vence a comum; desempate fixo por `created_at, id` (profissional com duas especialidades que têm régua fica com a mais antiga). Régua desligada não entra, e a consulta cai para a próxima que casar. Pela sessão, a RLS vale como em qualquer leitura (consulta de outra clínica devolve nulo).
> - **Planner:** `planejar_reguas()` escolhe a régua de cada consulta por `regua_da_consulta`, na confirmação e no pós falta (o pós falta tinha `limit 1` sem ordem). Uma régua só por consulta. Duas travas novas:
>   - **toque repetido quando a vigente muda:** a vinculada nasce com os mesmos momentos da geral e a chave de `cadence_run` leva o `cadence_step_id`, então ligar, desligar ou trocar a régua vigente logo depois de um toque faria o passo de mesmo momento nascer de novo. Por isso um passo **já vencido** (a recuperação da folga de 30 minutos) só é materializado se a consulta não recebeu nenhum toque do mesmo tipo nos últimos 30 minutos, de qualquer régua; passo futuro continua nascendo adiantado. Como excluir uma régua apaga as runs dela no cascade (e com elas essa prova), a exclusão de régua vinculada que enviou nos últimos 30 minutos é recusada ("Desligue agora e exclua daqui a 30 minutos");
>   - **custo:** `regua_da_consulta` não é inlinada, então a confirmação filtra antes as consultas candidatas (CTE `materialized`: só a consulta que tem, em alguma régua ativa de confirmação da clínica, um passo dentro do horizonte). O horizonte aparece nos dois lugares e muda junto.
>   - Consequência aceita: quando a régua vigente muda no meio da sequência, o passo da régua nova cujo momento já passou há mais de 30 minutos não nasce, e o paciente pode ficar sem esse toque.
> - **Executor** (`lib/jobs/regua.ts`): antes de cada toque de confirmação ou pós falta confere se a run ainda é da régua vigente da consulta. Se não é (troca de médico, régua mais específica ligada ou desligada depois do planejamento), pula a run como `condicao_parada`; os toques da régua vigente são outras runs, que o planner materializa.
> - **Ordem de publicação:** a migration vai ao banco **antes** do código. Sem a função, todo toque de confirmação e pós falta vira nova tentativa e, esgotadas, falha; sem as colunas, as telas de Confirmações e Automações quebram.

> **Motivo da falha de envio (Fase 3 das métricas, 02/10/2026, migration `20261002110000_metricas_da_fase_3.sql`).** `cadence_run.motivo_da_falha` guarda o código curto do porquê de um toque fechado como `falha_envio`, para o rodapé do cartão "Não enviadas" de Confirmações e para o chip da linha. Nunca texto do provedor nem dado de paciente: só o trecho antes do primeiro `:`, sem espaço nas pontas e em minúsculas; o que não cabe em `^[a-z0-9_]{1,64}$` vira `desconhecido`.
>
> - **Dois CHECKs:** o formato, e a existência só com `skipped_reason = 'falha_envio'`. O segundo usa `is not distinct from`: com `=`, `skipped_reason` nulo daria nulo e o CHECK passaria (motivo gravado numa run ainda aberta).
> - **Quem grava:** `pularRun(admin, run, motivo, detalhe?)` em `lib/jobs/regua.ts` (pela service role, com `motivoDaFalhaDeEnvio(resultado.code)`, a mesma regra do SQL; nos outros motivos o update continua só com `skipped_reason`), e `fechar_runs_orfas()`, que fecha como `falha_envio` a run cujo job de régua desistiu e grava o código do `job_queue.last_error` do job **mais recente** da run (`distinct on` por `updated_at desc`, para a escolha ser determinística). `fechar_runs_orfas` continua `SECURITY DEFINER` e só para `service_role`.
> - **Quem lê:** todo membro ativo, pela policy de leitura de `cadence_run` que já existia; ninguém grava pela sessão. Linha antiga fica nula (em 02/10, produção não tinha nenhuma run `falha_envio`) e a tela lê nulo como "Falha no envio".
> - **Exemplos de código:** `uazapi_<status>`, `whatsapp_463`, `envio_incerto`, `provider_indisponivel`, `instancia_invalida`, `conta_divergente`, `conversa_inexistente`, `contato_inexistente`, `slot_indisponivel`, `sem_instancia`, `configuracao_ausente`, `lease_expirado`, `devolucoes_demais`. O rótulo em português de cada um mora em `lib/domain/falha-de-envio.ts`.
> - **Ordem de publicação:** a coluna vai ao banco antes do código. Confirmações passa a ler `motivo_da_falha` e a lançar erro quando a leitura de `cadence_run` falha (antes o erro virava "nenhum toque" e zerava Não enviadas); sem a coluna, a lista do dia e a aba de faltas caem no estado de erro, e o update do pulo no executor falha e vira nova tentativa do job.

---

## 8. WhatsApp, custo, auditoria e assinatura

```sql
-- Vários números por clínica (25/09/2026, docs/07). Cada linha é um número
-- (uma instância do provedor). Remoção é lógica: conversas, mensagens e jobs
-- guardam a FK para sempre.
create table whatsapp_account (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  nome text not null default 'Número principal', -- livre, 1 a 40, único por clínica entre os ativos
  unit_id uuid references unit(id) on delete set null, -- opcional, mesma clínica por gatilho
  principal boolean not null default false, -- um por clínica entre os ativos (índice único parcial)
  removido_em timestamptz, removido_por uuid,
  provider text not null default 'fake',    -- fake | uazapi | cloud_api
  server_url text, instance_id text,        -- único (provider, instance_id) entre os ativos
  display_phone text,
  connection_status text not null default 'desconectado',
  connected_at timestamptz, disconnected_at timestamptz,
  next_send_at timestamptz, next_bulk_send_at timestamptz, -- slot anti-ban, dois trilhos, por número
  phone_number_id text, waba_id text,       -- canal oficial, futuro
  business_verified boolean not null default false,
  quality_rating text, messaging_limit text
);

-- Segredos por número (token da instância, segredo do webhook, QR). Nenhuma
-- sessão lê: só service role e funções definer.
create table whatsapp_account_secret (
  account_id uuid primary key references whatsapp_account(id) on delete cascade,
  clinic_id uuid not null references clinic(id) on delete cascade,
  instance_token text, webhook_secret text not null,
  qr_code text, qr_code_expires_at timestamptz
);

-- Por onde saem as automáticas, POR TIPO de mensagem (29/09/2026, migration
-- 20260929130000). Tabela própria para não abrir o update de clinic ao
-- gestor. Tipo sem linha = ultimo_usado. RLS: membro ativo lê; admin e
-- gestor inserem e alteram; ninguém apaga por sessão.
create table whatsapp_envio_automatico (
  clinic_id uuid not null references clinic(id) on delete cascade,
  tipo text not null check (tipo in ('confirmacao','pos_falta','followup','lista_espera','aviso_remarcacao')),
                                            -- confirmacao inclui o Cobrar agora
  modo text not null default 'ultimo_usado' check (modo in ('ultimo_usado','fixo')),
  conta_fixa_id uuid references whatsapp_account(id), -- mesma clínica e ativo, por gatilho
  check ((modo = 'fixo') = (conta_fixa_id is not null)),
  primary key (clinic_id, tipo)
);

-- clinic.limite_de_numeros int null: nulo = sem limite. Só o dono do produto
-- altera (gatilho proteger_limite_de_numeros); o gatilho antes_de_criar_numero
-- recusa o excedente mesmo em concorrência. Preparado para planos por número.
```

**Conversa, mensagem e job carregam o número.** `conversation.whatsapp_account_id`
é NOT NULL e nunca muda: o mesmo paciente falando com dois números tem duas
conversas (índice aberto único em `(clinic_id, contact_id, whatsapp_account_id)
where status <> 'resolvida'`). `message.whatsapp_account_id` é NOT NULL e é
sempre copiada da conversa por gatilho, nunca vem do cliente.
`job_queue.whatsapp_account_id` é carimbada no enfileiramento pela regra de
`conta_de_envio` com o **tipo** do job (o fixo ativo daquele tipo, depois a
conversa em que o paciente escreveu por último, depois o principal) e
conferida na execução por `numero_do_job`. O tipo vem de
`tipo_de_envio_do_job(kind, payload)`: na régua, o `cadence.kind` da run (o
Cobrar agora é run da confirmação); no envio ativo, o marcador
`payload.tipo_de_envio` (`aviso_remarcacao` ou `lista_espera`). O eco da
resposta ao toque não tem tipo: sai pelo número que recebeu (D4). Sem tipo,
nenhuma escolha fixa vale. Número desconectado faz o envio esperar, nunca troca de número (a espera tem
prazo próprio e não gasta o teto de 20 devoluções: `payload.esperas_do_canal`,
ver docs/07); número
removido tem os jobs pendentes redistribuídos (menos o eco da resposta ao
toque, que é cancelado), e a escolha fixa de todo tipo que apontava para ele
volta a `ultimo_usado` (`remover_numero`). Trocar a escolha de um tipo
recarimba só os pendentes daquele tipo (`redistribuir_jobs_do_numero(numero,
p_tipos)`). O motor reivindica por **raia**
(`coalesce(whatsapp_account_id, clinic_id)`), então dois números da mesma
clínica enviam em paralelo e o mesmo número serializa.

```sql

create table message_template (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null, language text not null default 'pt_BR',
  category text not null,                   -- utility | marketing | authentication
  body text not null,
  buttons jsonb,                            -- os botões de resposta rápida são margem, não estética
  meta_status text not null default 'rascunho',
  meta_template_id text
);

create table message_pricing (               -- preço NUNCA fixo no código
  id uuid primary key default gen_random_uuid(),
  category text not null, currency text not null default 'BRL',
  cents integer not null, valid_from date not null
);

create table audit_log (
  id bigserial primary key,
  clinic_id uuid references clinic(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,                     -- leu | criou | editou | excluiu | exportou | assumiu_conversa
  entity text not null, entity_id uuid,
  ip text, user_agent text,
  created_at timestamptz not null default now()
);

create table subscription (
  clinic_id uuid primary key references clinic(id) on delete cascade,
  plan text not null check (plan in ('essencial','completo')),
  status text not null default 'trial' check (status in ('trial','ativa','atrasada','suspensa','cancelada')),
  billing_cycle text not null default 'mensal',
  gateway_customer_id text, gateway_subscription_id text,
  trial_ends_at timestamptz, current_period_end timestamptz
);
```

---

## 9. Índices que importam

```sql
create index on message (conversation_id, created_at desc);
create index on conversation (clinic_id, status, last_message_at desc);
create index on appointment (clinic_id, professional_id, starts_at);
create index on appointment (clinic_id, starts_at) where status = 'aguardando_confirmacao';
create index on contact (clinic_id, funnel_stage, last_contact_at desc);
create index on contact (clinic_id, source_campaign);
create index on cadence_run (scheduled_for) where sent_at is null;
create index on slot_hold (expires_at);

-- Métricas da Fase 3 (02/10/2026, migration 20261002110000), seção 11.
-- Comparecimentos por clínica e data: ativos, retorno, primeiro
-- comparecimento e faturamento do período.
create index appointment_comparecimento_idx on appointment (clinic_id, starts_at)
  include (contact_id) where status = 'compareceu';
-- "Último disparo HH:mm" do Início: max(sent_at) da clínica no dia.
create index cadence_run_clinic_sent_at_idx on cadence_run (clinic_id, sent_at desc)
  where sent_at is not null;
```

---

## 10. Seeds para desenvolvimento

Criar uma clínica fictícia completa: 2 unidades, 4 profissionais (2 médicos com CRM, 1 esteticista sem conselho, 1 dentista com CRO), 10 procedimentos (incluindo 1 com preparo e 1 que exige equipamento), 4 convênios, a matriz de vínculo preenchida com preço e cobertura variando, 1 pacote de 10 sessões, 60 contatos espalhados pelas 6 etapas do funil, 40 agendamentos nos 10 status, 15 conversas em estados diferentes (incluindo uma com bloqueio de conformidade registrado) e 1 régua de confirmação ativa.

**Sem seed realista, ninguém consegue avaliar se a tela funciona.**

---

## 11. Métricas: funções de agregado da Fase 3 (02/10/2026)

Migration `20261002110000_metricas_da_fase_3.sql` (plano "Métricas do design", Frente 3, e as decisões do dono de 02/10/2026). Em 02/10 ela foi ensaiada em transação desfeita e **ainda não estava aplicada** em produção: vai ao banco antes do código que a usa (ver "Ordem de publicação" no fim desta seção). A coluna `cadence_run.motivo_da_falha` está na seção 7 e os índices na seção 9.

**Regras comuns.** Todas as funções novas são `SECURITY INVOKER` (a RLS da sessão recorta clínica e papel; nenhuma precisa enxergar além disso), com `search_path` fixo, sem `execute` para `public` e `anon` e com `execute` para `authenticated` e `service_role`. Os limites de tempo seguem o fuso da clínica (regra 3.6): ou o TypeScript manda os instantes UTC já calculados (`diaCivil`, `limitesDoDia`, `somarDias`), ou a função parte do dia civil local (`now() at time zone clinic.timezone`). Nulo tem dois sentidos, dito em cada função, e **nunca quer dizer zero**:
- **trava do profissional:** a função de agregado da clínica devolve nulo para o papel `profissional` (a RLS de `appointment` recortaria a agenda dele e o número da clínica sairia enganoso), como `funil_do_periodo` e `agenda_do_periodo` já faziam. O código transforma esse nulo em erro.
- **valor em reais só para a gestão** (decisão do dono em 02/10): quem não é `admin` nem `gestor` **da clínica pedida** recebe nulo no valor em reais. A condição é `auth.uid() is null or user_has_role(clinica, array['admin','gestor'])`: a `service_role` (testes e scripts, sem `sub` no JWT) passa, `anon` não tem grant, e `authenticated` sempre tem `sub`, então a sessão só vê reais com o papel.

Clínica que não é da sessão: a RLS esconde as linhas e a função devolve zeros, lista vazia ou nulo, nunca o dado da outra clínica.

**`consulta_foi_confirmada(p_status text, p_canal text) returns boolean`** (`immutable`, nunca nulo). O predicado único de "Confirmada" (Confirmações e Início): verdadeiro com status `confirmado_paciente` ou `confirmado_recepcao`, ou com canal não nulo e status `na_recepcao`, `em_atendimento`, `compareceu` ou `faltou`. O canal (`appointment.confirmation_channel`) é gravado em toda confirmação (recepção, paciente pelo WhatsApp, motor de réguas) e limpo quando a remarcação volta a consulta para `agendado` (`preparar_remarcacao`), então a remarcada de volta não conta; a cancelada também não. O espelho em TypeScript é `foiConfirmada(status, canal)` em `lib/queries/confirmacoes.ts` (canal `''` conta como gravado, como no SQL): mudou um, muda o outro. `agenda_do_periodo.confirmadas_alguma_vez` (Resultados) continua lendo a trilha de status, que é outra medida.

**`resumo_do_dia(p_clinic_id uuid, p_inicios timestamptz[], p_fim timestamptz, p_semana_passada_de timestamptz, p_semana_passada_ate timestamptz) returns jsonb`** (cartões do dia e barras de 7 dias do Início). Nulo para o profissional.
- Argumentos montados no TS (`janelasDoResumo` em `lib/queries/inicio.ts`): `p_inicios` são os 7 inícios UTC dos dias civis de seis dias atrás até hoje, em ordem; o fim de cada dia é o início do seguinte, e o de hoje é `p_fim`; `p_semana_passada_de` e `p_semana_passada_ate` são o mesmo dia civil da semana passada.
- Devolve `{ hoje: { total, confirmadas, aguardando, canceladas, unidades }, semana_passada: { total, confirmadas }, ultimo_disparo, por_dia: [{ ordem, total }] }`. `total` conta todas as situações; `confirmadas` usa o predicado único; `aguardando` é `agendado` ou `aguardando_confirmacao`; `unidades` são os `unit_id` distintos das não canceladas; `ultimo_disparo` é o maior `sent_at` do dia da régua de tipo `confirmacao` (inclui o "Cobrar agora", que também vira run dessa régua), ou nulo; `por_dia` vai da `ordem` 1 (seis dias atrás) à 7 (hoje), com a mesma definição de `total`, então a barra de hoje bate com o cartão.

**`funil_da_jornada(p_clinic_id uuid) returns jsonb`** (Funil de leads do Início). Nulo para o profissional. Lista `[{ chave, nome, papel, posicao, total }]` das etapas de `funnel_stage_def` da clínica, em ordem de `posicao` e depois `chave`, com `total` = quantos contatos estão **agora** em cada etapa (`contact.funnel_stage`, sem filtro de `kind`, o mesmo número do Kanban de Leads) e zero na etapa vazia. Lista vazia quando não há etapa visível (outra clínica ou membro pendente). `resultados_da_clinica` não servia: devolve só um mapa de chave e total, sem nome, posição nem as etapas vazias.

**`metricas_de_pacientes(p_clinic_id uuid) returns table (ativos, ativos_30d_atras, novos_no_mes, retorno_base, retorno_voltaram, sem_contato_6m bigint, primeiro_comparecimento timestamptz)`** (indicadores da lista de Pacientes). Sempre **uma** linha; clínica sem dado devolve zeros e `primeiro_comparecimento` nulo. **Não** é nula para o profissional: a RLS de `appointment` recorta a agenda dele, e a tela diz "na sua agenda". A base é `appointment.status`, não `contact.kind` (que vira `paciente` na primeira consulta criada, mesmo cancelada). As janelas fecham no fim de hoje no fuso da clínica, porque o Compareceu é liberado desde o início do dia da consulta.
- `ativos`: contatos com comparecimento nos últimos 12 meses; `ativos_30d_atras`: o mesmo cálculo com a janela terminando 30 dias atrás (a variação em pessoas da tela).
- `novos_no_mes`: contatos cuja primeira consulta não cancelada cai no mês civil da clínica, passada ou futura.
- `retorno_base` e `retorno_voltaram`: dos comparecimentos de 12 meses atrás até 90 dias atrás (janela madura), quantos têm outra consulta do mesmo contato, nem cancelada nem faltada, em **outro dia civil** e até 90 dias depois. A unidade é o comparecimento.
- `sem_contato_6m`: contatos cujo último comparecimento foi há mais de 6 meses e sem consulta futura não cancelada. Quem nunca compareceu não entra.
- `primeiro_comparecimento`: o primeiro `compareceu` da clínica. Com ele a tela decide "Contando desde" e "Ainda não medido" (`cartoesDePacientes` em `lib/domain/pacientes-ui.ts`, com as mesmas fronteiras e o fim de mês igual ao `date + interval` do Postgres). O tipo gerado marca a coluna como texto não nulo: o código a trata como anulável.
- Armadilha conferida: `date_trunc` em `timestamptz` trunca no fuso da **sessão** (UTC); por isso o mês parte do dia civil local convertido para `timestamp` sem fuso.

**`metricas_da_espera(p_clinic_id uuid) returns table (vagas_oferecidas, vagas_preenchidas, vagas_em_andamento, vagas_canceladas, vagas_esgotadas, primeira_onda_base, primeira_onda_aceita bigint, tempo_medio_min integer, receita_cents, vagas_com_valor, vagas_cobertas, vagas_sem_preco bigint)`** (Desempenho da lista). Sempre uma linha, no **mês civil da clínica**. Vaga é `waitlist_offer.source_appointment_id` (a consulta que abriu o horário); onda é uma linha de `waitlist_offer`; a vaga entra no mês da sua **primeira onda** (safra).
- `vagas_preenchidas`: alguma onda `preenchida`; `vagas_em_andamento`: alguma `aberta`; `vagas_canceladas` e `vagas_esgotadas`: nem preenchida nem em andamento, com a última onda `cancelada` ou `expirada`.
- `primeira_onda_base`: a primeira onda resolvida pelo paciente (`preenchida` ou `expirada`); `primeira_onda_aceita`: a primeira onda `preenchida`.
- `tempo_medio_min`: média, em minutos, da primeira onda ao aceite das vagas preenchidas; nulo sem vaga preenchida.
- `receita_cents`: soma do preço das consultas marcadas pelas vagas preenchidas, pela regra de preço do faturamento (abaixo). **Nula para recepção, leitura, profissional e outra clínica.** O tipo gerado marca `tempo_medio_min` e `receita_cents` como não nulos: o código os trata como anuláveis.
- `vagas_com_valor`, `vagas_cobertas` e `vagas_sem_preco` (revisão de 02/10/2026): das vagas preenchidas, quantas entraram na soma, quantas são de convênio "Coberto" sem valor e quantas não têm preço nenhum (vínculo sem preço e procedimento sem preço base). Nulas junto com a receita. Com vagas preenchidas e nenhuma com valor, a tela escreve "Sem preço para somar" em vez de R$ 0,00; com parte fora, o valor leva o rodapé "Fora da soma: ...".

**`faturamento_do_periodo(p_clinic_id uuid, p_de timestamptz, p_ate timestamptz, p_de_anterior timestamptz default null) returns jsonb`** (Faturamento estimado de Resultados). **Nulo para quem não é admin nem gestor da clínica pedida**; nulo é sempre "sem permissão", nunca zero, e a página nem chama a função para os outros papéis. Devolve `{ atual: Bloco }`, e também `anterior` quando `p_de_anterior` vem (janela `[p_de_anterior, p_de)`). `Bloco = { comparecimentos, valor_cents, com_valor, cobertas, sem_preco }`, só das consultas `compareceu` com `starts_at` na janela.
- **Regra de preço:** o `service_link.price_cents` do vínculo; sem ele, o `procedure.base_price_cents`. Vínculo "Coberto" (`covered_by_insurance` com `price_cents` nulo) **não** cai no preço base e conta em `cobertas`. Sem preço nenhum, conta em `sem_preco`. Preço 0 é gratuito de verdade e entra em `com_valor`.
- "Estimado" porque o preço vem do vínculo atual: a consulta não congela preço.

**`serie_diaria_do_periodo(p_clinic_id uuid, p_de timestamptz, p_ate timestamptz) returns jsonb`** (Leads x consultas agendadas). Nulo para o profissional. Lista `[{ dia: 'aaaa-mm-dd', leads, agendadas }]` com um ponto por dia civil da clínica tocado por `[p_de, p_ate)`, em ordem e com zero no dia vazio; lista vazia quando `p_ate <= p_de`. Critérios iguais aos de `funil_do_periodo` (leads por `first_contact_at`, agendadas por `appointment.created_at`), então a soma da série bate com os cartões Leads recebidos e Consultas agendadas.

**`agenda_do_periodo` (mudança).** Recriada a partir do corpo de produção, com uma linha trocada: `atual.recuperadas.receita_cents` e `anterior.recuperadas.receita_cents` passam a sair **nulos** para quem não é admin nem gestor (recepção, leitura e o profissional, inclusive no próprio recorte). Assinatura, grants, o resto do JSON e a regra de preço das recuperadas (só `service_link.price_cents`; `sem_preco` conta os nulos) não mudaram. No TypeScript, `AgendaDoPeriodo.recuperadas.receitaCents` virou `number | null`, sem converter nulo em zero.

**Objetivo de conversão (A3).** Uma linha por clínica: o objetivo da Taxa de conversão de Resultados. Sem linha, o rodapé "Objetivo: X%" some.

```sql
create table objetivo_de_conversao (
  clinic_id uuid primary key references clinic(id) on delete cascade,
  percentual numeric(4,1) not null check (percentual > 0 and percentual <= 100),
  definido_por uuid references auth.users(id) on delete set null, -- a pessoa pode sair; o objetivo fica
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()           -- gatilho set_updated_at
);
-- RLS ligada. Leitura: todo membro ativo (user_active_clinic_ids; pendente não lê).
-- Insert e update: user_has_role(clinic_id, array['admin','gestor']) e definido_por = auth.uid()
--   (o upsert por clinic_id precisa das duas). Delete: admin e gestor.
-- anon sem nenhum privilégio; authenticated sem truncate, references e trigger.
```

Erros que a tela traduz: `42501` (outro papel, ou gravar em nome de outra pessoa) e `23514` (percentual fora da faixa). A Server Action confere antes o papel e o número (Zod de 0,1 a 100 com uma casa) e grava `definiu_objetivo_de_conversao` ou `removeu_objetivo_de_conversao` em `audit_log`.

**Ordem de publicação:** a migration vai ao banco **antes** do código. Sem ela: o executor de réguas falha ao gravar o motivo do pulo e o job vira nova tentativa; Confirmações cai no estado de erro (lê `motivo_da_falha`); Início, Pacientes e Lista de espera mostram os blocos de números em erro; Resultados cai na tela de erro, porque busca a série diária e o objetivo em todo carregamento (e o faturamento, para administrador e gestor).

**Rollback** (detalhado no cabeçalho da migration, nesta ordem): recriar `agenda_do_periodo` com o corpo da `20260918100000`; apagar `serie_diaria_do_periodo`, `faturamento_do_periodo`, a tabela `objetivo_de_conversao`, `metricas_da_espera`, `metricas_de_pacientes`, o índice de comparecimento, `funil_da_jornada`, `resumo_do_dia` e `consulta_foi_confirmada`; recriar `fechar_runs_orfas` sem o motivo **antes** de apagar a coluna; apagar o índice de `sent_at` e a coluna `motivo_da_falha`, junto com o código de `lib/jobs/regua.ts` que a grava.
