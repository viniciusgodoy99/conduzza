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

-- Convênio pelo médico (02/10/2026, seção 13): o profissional atende o
-- convênio, e o convênio cobre o procedimento. O Particular é implícito e
-- nunca é gravado. A linha entra ou sai, nunca é editada (sem updated_at).
create table professional_insurance (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id) on delete cascade,
  insurance_id uuid not null references insurance(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (professional_id, insurance_id)
);
create table procedure_insurance (             -- sem linha = procedimento só Particular
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  procedure_id uuid not null references procedure(id) on delete cascade,
  insurance_id uuid not null references insurance(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (procedure_id, insurance_id)
);

-- A MATRIZ DE TRÊS PONTAS. É o coração do cadastro.
-- Desde 29/09/2026 é gerida pelo PROCEDIMENTO (seção "Quem faz e convênios"
-- do modal), gravada de uma vez pela RPC sincronizar_vinculos_do_procedimento
-- (ver a nota abaixo). Desde 02/10/2026 tem um segundo escritor, a RPC
-- sincronizar_convenios_do_profissional (a cascata do convênio marcado no
-- profissional, seção 13). Não há tela própria de vínculos. Continua a fonte
-- da agenda, da IA, do preço, dos relatórios e das conversões.
create table service_link (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id) on delete cascade,
  procedure_id uuid not null references procedure(id) on delete cascade,
  insurance_id uuid references insurance(id),        -- null = particular
  price_cents integer,                                -- null = sem preço informado ("Coberto" é o covered_by_insurance)
  covered_by_insurance boolean not null default false,-- diferencia "coberto" de "zero" e de "vazio"; só com convênio (coberto_exige_convenio)
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
> É `SECURITY INVOKER`, com `execute` só para `authenticated`: a RLS de `procedure` e de `service_link` vale inteira. O papel é conferido no começo (admin ou gestor, senão 42501); procedimento de outra clínica ou inexistente dá "não encontrado" (P0002); profissional ou convênio de outra clínica é recusado pelo gatilho `exigir_cadastro_da_mesma_clinica` (23503). A linha do procedimento fica travada (`FOR UPDATE`) durante a reconciliação: dois Salvar simultâneos do mesmo procedimento rodam em série. A lista é validada antes de gravar (até 500 linhas, duração de 5 a 600 minutos, preço não negativo, "Coberto" só com convênio, o mesmo profissional no mesmo convênio uma vez só).
>
> **Revisto em 02/10/2026 (convênio pelo médico, seção 13, migration `20261002140000`):** a assinatura passou a `sincronizar_vinculos_do_procedimento(p_procedure_id uuid, p_linhas jsonb, p_planos uuid[] default null, p_vinculos_na_abertura jsonb default null, p_planos_na_abertura uuid[] default null, p_confirmar boolean default false)`, **uma função só** (a de 2 argumentos foi apagada). Com `p_planos` nulo é o **modo legado**, idêntico ao descrito acima (mesmo retorno de 5 chaves), e é o que o código publicado antes chama. Com `p_planos`, o modo novo também grava `procedure_insurance` e recusa a aba parada. "O último vence por inteiro" **deixou de valer**: as gravações do catálogo da clínica entram numa fila (trava consultiva por clínica, nos dois modos) e, no modo novo, a aba que leu um estado antigo recebe CZ409 em vez de sobrescrever. `execute` passou a `authenticated` e `service_role`.

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
  -- source_method: link_token | mensagem_padrao | palavra_chave | manual |
  -- importacao | anuncio_ctwa (desde 20261004100000, aplicada em 04/10/2026)
  -- | clique_site (desde 20261005100000, ainda não aplicada). Com
  -- anuncio_ctwa, o CHECK contact_origem_de_anuncio_coerente exige canal
  -- trafego_pago, origem Meta, meio Facebook, Instagram ou nulo e
  -- source_campaign NULO: a campanha e o conjunto do lead de anúncio vêm de
  -- meta_anuncio por source_ad_id, nunca de texto no contato (seção 14.9).
  -- Com clique_site, o CHECK contact_origem_do_clique_do_site_coerente exige
  -- canal trafego_pago, origem Google, meio e source_campaign NULOS (seção 15).
  -- ids do anúncio da Meta (08/09/2026; só a ingestão grava, o primeiro
  -- anúncio vence e a sessão não reescreve desde a Fase 4): seção 14
  ctwa_clid text, source_ad_id text, source_adset_id text, source_campaign_id text,
  -- ids da campanha e do grupo de anúncios do Google (só dígitos), gravados
  -- por casar_clique_do_site junto com a origem clique_site e só com ela
  -- (20261005100000, ainda não aplicada): seção 15
  source_google_campaign_id text, source_google_adgroup_id text,
  first_contact_at timestamptz not null default now(),
  last_contact_at timestamptz,
  inactive_since timestamptz,
  no_show_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (clinic_id, phone_e164)
);
-- Desatualizado: desde a jornada configurável (09/09/2026) o CHECK fixo de
-- funnel_stage deu lugar à validação por gatilho contra funnel_stage_def da
-- clínica (23514), e o contato tem hoje, entre outras colunas que vieram
-- depois deste rascunho, funnel_stage_changed_at (o instante da entrada na
-- etapa, carimbado pelo gatilho validar_etapa_do_contato), lost_reason_note
-- e criado_por_importacao. A jornada, a proteção dos relógios (02/10/2026) e
-- as atividades do contato (contact_activity) estão na seção 12.

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

Sobe em `ingest_inbound_message` (mensagem de entrada). Desce **só** em envio com `author = 'usuario'`, na mensagem enviada pelo celular pareado quando a última mensagem do paciente é **anterior** ao envio (pelos horários de envio quando o eco e a mensagem do paciente os têm, senão `last_inbound_at` nulo ou mais de 8 s antes do horário de envio; `registrar_mensagem_do_celular`, seção 16), no eco do celular que não vira linha (destino que é número de outra clínica da plataforma ou `wa_message_id` de outra clínica: só a conversa aberta daquele número, pela mesma regra de chegada) e ao resolver a conversa. Não apagam pergunta de paciente: o toque automático de régua (`author = 'sistema'`); a resposta automática do app WhatsApp Business (o paciente enviou de 8 s antes a 2 s depois do eco, ou chegou de 8 s antes a 10 s depois do envio sem os horários, gravada como `author = 'sistema'`); e a mensagem do celular enviada antes de a pergunta existir, mesmo quando é de pessoa e chega colada nela (rajada de reconexão). Se o eco de um envio automático nosso escapar dos filtros, for lido como pessoa e derrubar a espera, `adotar_eco_do_envio` a devolve (seção 16.4).

**Mensagens padrão e nota de automação (02/10/2026, seção 12).** As mensagens padrão do compositor vivem em `resposta_rapida` (seção 12.2). A automação de fluxo pode gravar em `message` uma nota interna com `author = 'sistema'`, `author_user_id` nulo e `is_internal_note = true` (seção 12.8). A mensagem recebida do paciente (`direction = 'entrada'`, `author = 'paciente'`, sem nota) passa a disparar o gatilho que só registra a automação (seção 12.7).

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
  pelo_celular boolean not null default false, -- enviada pelo WhatsApp do número pareado, fora do sistema (seção 16)
  enviada_no_aparelho_em timestamptz,      -- horário de envio do payload, só p/ autoria e espera (seção 16)
  created_at timestamptz not null default now()
);
-- message_pelo_celular_coerente: not pelo_celular or (direction = 'saida'
--   and author in ('usuario','sistema') and author_user_id is null
--   and job_id is null and not is_internal_note
--   and content_type in ('texto','imagem','audio','documento'))

create table ai_decision_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  message_id uuid references message(id),
  tool_used text,
  context_read jsonb,
  escalation_reason text,                  -- codigo com CHECK (secao 17.9), nunca texto livre
  compliance_blocked boolean not null default false,
  compliance_rule text,                    -- categoria do filtro com CHECK (secao 17.9)
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

**Este desenho original foi substituído pela seção 17** (migration `20261006100000_ia_liberacao_e_schema.sql`, Fase 3, E0). Não crie nada a partir do bloco antigo: as tabelas reais estão em 17.8 (`ai_agent_config` e `knowledge_item`) e 17.9 (colunas e CHECKs novos de `ai_decision_log`), e as travas de liberação da IA em 17.2 a 17.6.

O que mudou em relação ao desenho original desta seção:

- `ai_agent_config.published boolean` virou `status` (`rascunho` ou `publicada`), com a versão publicada imutável por gatilho (P0001 para qualquer papel) e `published_at`/`published_by` carimbados pelo banco. Ganhou `updated_at` e CHECKs (`version > 0`, `skills` e `escalation_rules` objetos, `fallback_minutes` positivo). A sessão não publica: publicar é do sistema, pela RPC `publicar_agente` da Tela 6 (17.12, migration `20261006150000`, aplicada em 09/10/2026), que também congela a base na versão.
- `knowledge_item.source` é `manual`, `correcao_humana` ou `documento` (o desenho dizia `correcao_humano`), com CHECK; ganhou `created_by` (default `auth.uid()`), `created_at` e `updated_at`.
- RLS das duas: membro ativo lê; administrador e gestor que escrevem criam, editam e apagam (em `ai_agent_config`, só rascunho). A Tela 6 (17.12) tira da sessão criar e apagar versão de `ai_agent_config`: o rascunho passa a nascer só pela RPC `garantir_rascunho_do_agente`.

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

-- Conferida na produção em 03/10/2026 (substitui o esboço original, que
-- tinha id bigserial, completed_at e os tipos process_inbound,
-- run_cadence_step, expire_holds e waitlist_offer). Executada pelo motor por
-- pg_cron (supabase/operacao/motor-por-cron.md).
create table job_queue (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  kind text not null check (kind in (
    'enviar_mensagem_ativa', 'baixar_midia', 'executar_passo_de_regua',
    'enviar_conversao_meta', 'oferecer_lista_espera',
    'sincronizar_gasto_meta',               -- desde 20261003100000 (seção 14)
    'resolver_anuncio_meta',                -- desde 20261004100000 (seção 14.9, não aplicada em 04/10)
    'enviar_mensagem_agendada')),           -- desde 20261006140000 (seção 18, aplicada em 06/10/2026)
  -- NOTA PARA O E3: a migration do 'responder_com_ia' redefine este CHECK
  -- inteiro e precisa manter 'enviar_mensagem_agendada' (seção 18.11).
  payload jsonb not null default '{}',
  status text not null default 'pendente'
    check (status in ('pendente','executando','concluido','falhou','cancelado')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 8,  -- os dois jobs da Meta (gasto e consulta dos anúncios) nascem com 5
  locked_by text,                           -- lease do motor
  locked_at timestamptz,
  last_error text,                          -- só código curto, nunca conteúdo de mensagem nem token
  devolucoes integer not null default 0,    -- voltas sem queimar tentativa (reagendar_job)
  ultimo_motivo_devolucao text,             -- ex.: orcamento_da_passagem, limite_da_meta, config_mudou, mais_anuncios, nova_tentativa
  prioridade smallint not null default 0 check (prioridade in (0, 1)),
  whatsapp_account_id uuid references whatsapp_account(id), -- raia do envio (docs/07); nulo = raia da clínica
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_queue_prontos_idx on job_queue (run_at) where status = 'pendente';
create index job_queue_lease_idx on job_queue (locked_at) where status = 'executando';
create index job_queue_clinic_idx on job_queue (clinic_id);
create index job_queue_clinica_pendente_idx on job_queue (clinic_id, run_at) where status = 'pendente';
create index job_queue_clinica_prioridade_idx on job_queue (clinic_id, prioridade, run_at) where status = 'pendente';
create index job_queue_numero_prioridade_idx on job_queue (whatsapp_account_id, prioridade, run_at)
  where status = 'pendente' and whatsapp_account_id is not null;
-- Fase 4 (seção 14): no máximo UM job de gasto da Meta vivo por clínica.
create unique index job_queue_gasto_meta_vivo on job_queue (clinic_id)
  where kind = 'sincronizar_gasto_meta' and status in ('pendente', 'executando');
-- Origem real do anúncio (seção 14.9): no máximo UMA consulta de anúncios viva por clínica.
create unique index job_queue_resolver_anuncio_meta_vivo on job_queue (clinic_id)
  where kind = 'resolver_anuncio_meta' and status in ('pendente', 'executando');
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
  cor text not null default 'azul',         -- 06/10/2026: azul | rosa | verde | roxo | turquesa | laranja (CHECK); só identifica, sem índice único
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
clínica enviam em paralelo e o mesmo número serializa. **Exceção, a mensagem
agendada (seção 18, 06/10/2026):** o job `enviar_mensagem_agendada` nasce com
o número da própria agendada (o da conversa onde ela foi escrita), fica fora
de `redistribuir_jobs_do_numero` (lista explícita de kinds) e de
`job_ganha_numero`, nunca passa por `numero_do_job` e nunca é recarimbado;
com o número removido, o job pendente é cancelado, e não redistribuído. Só o
motor (`claim_jobs_por_clinica`) o reivindica: o claim legado `claim_jobs`
(do `npm run worker` e das suítes de integração) o exclui nos dois ramos
(18.10).

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

-- CRM de 02/10/2026 (migrations 20261002120000 e 20261002130000), seção 12.
-- Mensagens padrão: a lista do compositor e da aba.
create index resposta_rapida_lista on resposta_rapida (clinic_id, posicao) where ativo;
create unique index resposta_rapida_titulo_unico on resposta_rapida (clinic_id, lower(btrim(titulo)));
-- Atividades: pendentes por responsável e por dia (lista e contagem), as do
-- contato (drawer, conversa, ficha), as concluídas recentes e as FKs.
create index contact_activity_pendentes_por_responsavel on contact_activity (clinic_id, assignee_user_id, due_on)
  where status = 'pendente';
create index contact_activity_pendentes_por_dia on contact_activity (clinic_id, due_on) where status = 'pendente';
create index contact_activity_do_contato on contact_activity (contact_id, status, due_on);
create index contact_activity_concluidas on contact_activity (clinic_id, completed_at desc) where status = 'concluida';
create index contact_activity_da_conversa on contact_activity (conversation_id) where conversation_id is not null;
create index contact_activity_da_automacao on contact_activity (automacao_id) where automacao_id is not null;
-- Eco do celular já usado pelo termo-chave: a poda por clínica e idade.
create index termo_eco_visto_poda on termo_eco_visto (clinic_id, created_at);
-- Automações de fluxo: a varredura dos gatilhos de tempo e as regras ligadas
-- (os gatilhos de contato e de mensagem perguntam por elas a cada evento).
create index contact_etapa_e_entrada_idx on contact (clinic_id, funnel_stage, funnel_stage_changed_at);
create index automacao_fluxo_ligadas on automacao_fluxo (clinic_id, gatilho, etapa) where ativa;
create index automacao_fluxo_por_destino on automacao_fluxo (clinic_id, etapa_destino) where etapa_destino is not null;
create index automacao_fluxo_por_etiqueta on automacao_fluxo (clinic_id, etiqueta) where etiqueta is not null;
-- Execuções: a fila, o histórico por clínica e por regra, o contato e as
-- FKs com ON DELETE SET NULL.
create index automacao_execucao_pendentes on automacao_execucao (devida_em) where status = 'pendente';
create index automacao_execucao_da_clinica on automacao_execucao (clinic_id, created_at desc);
create index automacao_execucao_da_regra on automacao_execucao (automacao_id, created_at desc);
-- Completo, sem predicado (revisão de 02/10/2026): a FK contact_id com
-- ON DELETE CASCADE procura por ele ao apagar um contato (LGPD 11.11) ou
-- uma clínica; com predicado, a consulta da FK não o usaria e varreria a
-- tabela. Serve também ao teto de 10 movimentos automáticos por lead em 24 h.
create index automacao_execucao_do_contato on automacao_execucao (contact_id, executada_em desc);
create index automacao_execucao_da_mensagem on automacao_execucao (message_id) where message_id is not null;
create index automacao_execucao_da_conversa on automacao_execucao (conversation_id) where conversation_id is not null;
create index automacao_execucao_da_atividade on automacao_execucao (atividade_id) where atividade_id is not null;
-- Convênio pelo médico (02/10/2026, seção 13): o unique do par já serve à
-- leitura por profissional e por procedimento; estes servem à leitura da
-- matriz por clínica e à cascata de apagar um convênio.
create index professional_insurance_clinic_id_idx on professional_insurance (clinic_id);
create index professional_insurance_insurance_id_idx on professional_insurance (insurance_id);
create index procedure_insurance_clinic_id_idx on procedure_insurance (clinic_id);
create index procedure_insurance_insurance_id_idx on procedure_insurance (insurance_id);
-- Investimento da Meta (Fase 4, 03/10/2026, migration 20261003100000), seção 14.
-- Gasto por campanha no período e anúncios de uma campanha. Os índices únicos
-- job_queue_gasto_meta_vivo e job_queue_resolver_anuncio_meta_vivo (14.9)
-- estão na seção 7.
create index meta_gasto_diario_campanha_idx on meta_gasto_diario (clinic_id, campaign_id, dia);
create index meta_anuncio_campanha_idx on meta_anuncio (clinic_id, campaign_id);
-- Clique rastreado pelo site (F1 do Google, 04/10/2026, migration
-- 20261005100000, ainda não aplicada), seção 15.4.
create index clique_do_site_por_hora on clique_do_site (clinic_id, criado_em);
create index clique_do_site_vivos on clique_do_site (clinic_id, valido_ate) where contact_id is null;
create index clique_do_site_vencidos on clique_do_site (valido_ate) where contact_id is null;
create index clique_do_site_ids_a_zerar on clique_do_site (criado_em)
  where contact_id is not null and (gclid is not null or gbraid is not null or wbraid is not null);
create index clique_do_site_contato on clique_do_site (contact_id) where contact_id is not null;
```

---

## 10. Seeds para desenvolvimento

Criar uma clínica fictícia completa: 2 unidades, 4 profissionais (2 médicos com CRM, 1 esteticista sem conselho, 1 dentista com CRO), 10 procedimentos (incluindo 1 com preparo e 1 que exige equipamento), 4 convênios, a matriz de vínculo preenchida com preço e cobertura variando, 1 pacote de 10 sessões, 60 contatos espalhados pelas 6 etapas do funil, 40 agendamentos nos 10 status, 15 conversas em estados diferentes (incluindo uma com bloqueio de conformidade registrado) e 1 régua de confirmação ativa.

**Sem seed realista, ninguém consegue avaliar se a tela funciona.**

---

## 11. Métricas: funções de agregado da Fase 3 (02/10/2026)

Migration `20261002110000_metricas_da_fase_3.sql` (plano "Métricas do design", Frente 3, e as decisões do dono de 02/10/2026). Ensaiada em transação desfeita e **aplicada em produção em 02/10/2026** (conferido por SELECT em `supabase_migrations.schema_migrations`); o código que a usa saiu no commit `1b1d93a` (ver "Ordem de publicação" no fim desta seção). A coluna `cadence_run.motivo_da_falha` está na seção 7 e os índices na seção 9.

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

---

## 12. CRM: jornada, mensagens padrão, atividades e automações de fluxo (02/10/2026)

Escopo acrescentado em 02/10/2026 (backlog, entrada de mesmo nome). Duas migrations, ensaiadas em transação desfeita e **aplicadas em produção em 02/10/2026** (junto com a `20261002140000` do convênio e a correção `20261002150000`, nessa ordem):

- **Leva A**, `20261002120000_crm_leva_a.sql`: `funnel_stage_def.termos_de_quem` e `descricao`, `resposta_rapida`, `contact_activity`, `contagem_de_atividades` e, desde a revisão de 02/10/2026, o gatilho `recalcular_dia_das_atividades` em `clinic` (12.3) e a tabela `termo_eco_visto` com `marcar_eco_para_termo` (12.1).
- **Leva B**, `20261002130000_automacoes_de_fluxo.sql`: a proteção dos relógios do contato, `automacao_fluxo`, `automacao_execucao`, a FK de `contact_activity.automacao_id`, os gatilhos que só registram, o motor (`planejar_automacoes_de_fluxo` e `executar_automacoes_de_fluxo`), `previa_da_automacao_de_fluxo`, e os corpos novos de `proteger_jornada`, `proteger_etiqueta_de_conversa` e `motor_manutencao`. Pressupõe a Leva A e não a edita.

Os tipos de `lib/supabase/database.types.ts` foram escritos à mão no formato gerado (inclusive `termo_eco_visto`, `marcar_eco_para_termo` e as colunas novas de `automacao_execucao`) e precisam ser regenerados (`supabase gen types typescript`) depois de aplicar as duas, conferindo que o diff some.

**Ensaio conjunto (02/10/2026, depois das correções da revisão):** as duas, na ordem de aplicação e seguidas da migration seguinte de outra frente (`20261002140000`), passaram numa transação só com os asserts de cada frente, e também reaplicadas duas vezes seguidas; três sabotagens de controle (uma por frente) foram pegas. Os asserts da Leva A rodados **depois** da Leva B precisam de uma regra real em `automacao_fluxo`: a FK de `contact_activity.automacao_id` recusa um id aleatório (23503). Cada ensaio trava por 1 a 2 segundos tabelas da produção (`clinic`, `contact`, `message`, `funnel_stage_def`); a aplicação de verdade terá a mesma trava curta.

### 12.1 Jornada da clínica (`funnel_stage_def`)

A tabela existe desde a jornada configurável (09/09/2026) e não estava neste documento. Colunas em produção em 02/10, mais as duas da Leva A:

```sql
create table funnel_stage_def (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  chave text not null check (chave ~ '^[a-z0-9_]{1,40}$'),   -- imutável (proteger_jornada)
  nome text not null,
  posicao integer not null,
  tom text not null default 'neutral' check (tom in ('neutral','info','warning','success','alert')),
  icone text not null default 'circle',
  papel text check (papel in ('entrada','agendou','compareceu','perdido')), -- de sistema, imutável
  termos_chave text[] not null default '{}',
  -- Quem escreve o termo que anda o lead para esta etapa (02/10/2026).
  -- 'paciente' é o comportamento original e o valor de toda etapa existente.
  termos_de_quem text not null default 'paciente'
    constraint termos_de_quem_valido check (termos_de_quem in ('paciente','clinica','qualquer')),
  -- Texto do Kanban, abaixo do nome da coluna (02/10/2026). Vazio nunca:
  -- o código grava null.
  descricao text
    constraint descricao_de_etapa_com_tamanho
    check (descricao is null or char_length(btrim(descricao)) between 1 and 140),
  meta_event_name text,                       -- conversão para a Meta
  conversao_ativa boolean not null default true,
  is_sale boolean not null default false,
  is_first_contact boolean not null default false,
  value_source text check (value_source in ('service_link','fixo')),
  value_cents integer check (value_cents is null or value_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, chave),
  constraint perdido_sem_conversao check (papel is distinct from 'perdido' or meta_event_name is null),
  constraint valor_fixo_exige_cents check (value_source is distinct from 'fixo' or value_cents is not null)
);
-- RLS: membro ativo lê; admin e gestor gravam. set_updated_at e proteger_jornada
-- (chave e papel imutáveis; etapa de sistema, etapa com contato, etapa com
-- régua de follow-up e, desde a Leva B, etapa usada por automação não se excluem).
```

- **`termos_de_quem`** decide de que lado o termo-chave vale. A mensagem recebida (ingestão) só considera as etapas `paciente` ou `qualquer`; o envio pelo Atendimento (o texto, em `sendMessageAction`, e desde a revisão de 02/10/2026 a legenda aparada do arquivo, em `enviarArquivoAction`, sempre depois do envio bem-sucedido e em `after()`) e o eco do celular conectado só consideram `clinica` ou `qualquer`. As mensagens da IA e da régua de follow-up não passam por aqui, e o eco das mensagens que saem pela API é descartado antes (`wasSentByApi` e, desde 05/10/2026, a marca de rastreio `track_source`, seção 16). O teste puro é o mesmo (`etapaPorTermoChave(corpo, etapaAtual, jornada, quemEscreveu)` em `lib/domain/jornada.ts`: o mais longo vence, só para frente, nunca entra nem sai de Perdido), e o movimento (`tentarMoverPorTermo`, `lib/integrations/whatsapp/termo-chave.ts`) é um update guardado pela etapa atual, pela service role, com a trilha `termo_chave_moveu_etapa` (paciente) ou `termo_chave_moveu_etapa_clinica` (clínica) em `audit_log`, `entity = 'contact'`, sem o texto. No envio pelo Atendimento, `user_id` é quem enviou; no paciente e no eco, nulo.
- **Eco do celular, uma vez por `wa_message_id` (revisão de 02/10/2026).** O eco (`fromMe` que não saiu pela API: a equipe escrevendo no celular conectado) não virava linha de `message`, então o unique de `message.wa_message_id` não separava a mensagem nova da reentrega do provedor. A regra 3.3 ("`wa_message_id` é chave única, venha de onde vier") vive em `termo_eco_visto`. Desde 05/10/2026 o eco vira linha (`registrar_mensagem_do_celular`, seção 16), mas o termo-chave **continua** decidido por esta marca e não pelo `inserted` da gravação (a menor mudança: a marca já prova o "uma vez só" e não depende de a linha existir). A gravação devolve o contato também nas ignoradas `numero_da_plataforma` e `colisao_wa_message_id` (o eco não vira linha, mas continua sendo fala da equipe). A rota só chama a marca quando a gravação devolve o contato:

  ```sql
  create table termo_eco_visto (
    clinic_id uuid not null references clinic(id) on delete cascade,
    wa_message_id text not null,
    created_at timestamptz not null default now(),
    constraint termo_eco_visto_pkey primary key (clinic_id, wa_message_id),
    constraint wa_message_id_do_eco_preenchido check (btrim(wa_message_id) <> '')
  );
  -- Só ids, nenhum texto nem termo. RLS ligada SEM policy; anon e authenticated
  -- sem privilégio: nenhum papel de cliente lê nem grava, só o service role.
  ```

  **`marcar_eco_para_termo(p_clinic_id uuid, p_wa_message_id text) returns boolean`** (`SECURITY INVOKER`, `search_path` vazio, `execute` só para `service_role`): devolve `true` só quando o eco é novo **e** a clínica tem etapa `clinica` ou `qualquer` com termo (sem isso nada andaria e nada é gravado); devolve `false` na reentrega e com id vazio. Na mesma chamada, poda as marcas com mais de 1 dia **da mesma clínica**. A rota (`app/api/webhooks/whatsapp/route.ts`, eco do celular) chama a marca **antes** de `tentarMoverPorTermo` e só move com `true`; erro na marca não move, grava o log `termo_chave_marcar_eco_falhou` só com ids e não derruba o 200. A janela de 2 minutos pelo horário do payload (`ecoContaParaTermo`: eco velho, sem horário ou da sincronia de histórico não vai ao banco) ficou como defesa extra. A marca é "no máximo uma vez": se ela grava e o movimento falha por erro passageiro, a reentrega não tenta de novo.
- **`descricao`**: a action normaliza (espaços e quebras de linha repetidos viram um espaço, pontas aparadas, vazio vira null) e recusa mais de 140. Não é dado de paciente.
- `JORNADA_SELECT` (`lib/queries/jornada.ts`) passa a ler as duas colunas: sem a Leva A, toda leitura da jornada falha.

### 12.2 Mensagens padrão (`resposta_rapida`)

```sql
create table resposta_rapida (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  atalho text not null,                     -- o que se digita depois da "/"
  titulo text not null,
  corpo text not null,                      -- com {{nome}} e {{clinica}}
  ativo boolean not null default true,
  posicao integer not null default 0,       -- o código grava de 10 em 10
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resposta_rapida_atalho_unico unique (clinic_id, atalho),
  constraint atalho_de_resposta_valido check (atalho ~ '^[a-z0-9_]{1,30}$'),
  constraint titulo_de_resposta_com_tamanho check (char_length(btrim(titulo)) between 2 and 60),
  constraint corpo_de_resposta_com_tamanho check (char_length(corpo) between 1 and 4096 and btrim(corpo) <> ''),
  constraint posicao_de_resposta_valida check (posicao >= 0)
);
-- Título repetido sem diferenciar caixa nem espaços das pontas: índice único
-- resposta_rapida_titulo_unico em (clinic_id, lower(btrim(titulo))).
```

- O nome evita `mensagem_padrao` (já é o método de atribuição de origem) e não reaproveita `message_template` (o modelo aprovado da Meta). Texto da clínica, sem dado de paciente: o nome do paciente só entra na renderização, no navegador de quem usa.
- **Gatilho `proteger_resposta_rapida`:** `clinic_id` imutável (23514), `created_by` e `created_at` travados; com sessão, `created_by` e `updated_by` são sempre `auth.uid()` (o que o cliente manda é ignorado). Sem sessão, vale o que vier.
- **RLS:** membro **ativo** lê (pendente não, `user_active_clinic_ids`); admin e gestor inserem, alteram e excluem (`user_has_role`). Recepção, profissional e leitura recebem 42501 no INSERT e zero linhas no UPDATE e no DELETE. A exclusão é real (nada aponta para a tabela). `anon` sem privilégio; `authenticated` sem `truncate`, `references` e `trigger`.
- **Erros que a tela traduz:** 23505 com o nome da constraint (`resposta_rapida_atalho_unico` ou `resposta_rapida_titulo_unico`), 42501 e 23514.
- **Lista do compositor:** `.eq('ativo', true).order('posicao').order('titulo')` (índice `resposta_rapida_lista`). Mutações vão para `audit_log` com `entity = 'resposta_rapida'` e o id, sem o texto.

### 12.3 Atividades (`contact_activity`) e `contagem_de_atividades`

```sql
create table contact_activity (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,   -- LGPD 11.11 leva junto
  conversation_id uuid references conversation(id) on delete set null,  -- de onde foi criada
  titulo text not null,                     -- "O que fazer"
  detalhes text,                            -- opcional; null quando vazio
  due_on date not null,                     -- dia civil da clínica
  due_at timestamptz,                       -- só quando tem hora
  assignee_user_id uuid references auth.users(id),  -- pode ficar sem responsável
  status text not null default 'pendente',
  origem text not null default 'manual',
  automacao_id uuid references automacao_fluxo(id) on delete set null, -- FK desde a Leva B
  created_by uuid references auth.users(id),
  completed_at timestamptz, completed_by uuid references auth.users(id),
  canceled_at timestamptz,  canceled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint status_de_atividade_valido check (status in ('pendente','concluida','cancelada')),
  constraint origem_de_atividade_valida check (origem in ('manual','automacao')),
  constraint titulo_de_atividade_com_tamanho check (char_length(btrim(titulo)) between 2 and 120),
  constraint detalhes_de_atividade_com_tamanho
    check (detalhes is null or (char_length(detalhes) <= 2000 and btrim(detalhes) <> '')),
  constraint concluida_tem_carimbo check ((status = 'concluida') = (completed_at is not null)),
  constraint cancelada_tem_carimbo check ((status = 'cancelada') = (canceled_at is not null)),
  constraint concluida_por_so_com_carimbo check (completed_by is null or completed_at is not null),
  constraint cancelada_por_so_com_carimbo check (canceled_by is null or canceled_at is not null),
  constraint autor_de_atividade_manual check (created_by is not null or origem = 'automacao'),
  constraint automacao_so_com_origem_automacao check (automacao_id is null or origem = 'automacao')
);
```

- **Dado de paciente:** o texto pode ser dado de saúde. Toda leitura por pessoa vai para `audit_log` (entidade `atividades` em `lib/auth/read-audit.ts`: a página sem id; drawer, painel da conversa e ficha com o id do contato); mutações com `entity = 'contact_activity'` e o id (`criou_atividade`, `editou_atividade`, também ao adiar, `concluiu_atividade`, `reabriu_atividade`, `cancelou_atividade`), nunca o texto. Nunca em log.
- **Prazo (regra 3.6):** `due_on` é o dia civil, no precedente de `package_balance.expires_at`; com hora, quem manda é `due_at`, e `due_on` é só o dia dele no fuso da clínica: o gatilho **recalcula `due_on` de `due_at` no fuso da clínica** a cada INSERT, a cada UPDATE que mexe em `due_at` ou `due_on` e **quando a clínica troca de fuso** (revisão de 02/10/2026). Esse último caso é o gatilho **`recalcular_dia_das_atividades`** (`AFTER UPDATE OF timezone ON clinic`, `when (new.timezone is distinct from old.timezone)`; função `SECURITY DEFINER`, `search_path` vazio, sem `execute` para `public`, `anon` e `authenticated`): recalcula o dia de **toda** atividade com hora da clínica, inclusive concluídas e canceladas (a reaberta volta com o dia certo, e o texto do prazo também fica certo); cada linha passa pelo `validar_atividade` com o fuso novo já gravado, e os carimbos ficam como estavam. Atividade sem hora mantém o dia escolhido. Sem isso, a lista dizia "Amanhã, 23:30" para o que vence hoje e a contagem não o via em "hoje". O contorno "fuso da clínica mudou" de `lib/domain/atividades.ts` fica só como defesa. Criar sem hora manda só `due_on`; com hora, os dois. Adiar: `{ due_on }` sem hora, `{ due_at }` com hora, `{ due_at: null, due_on }` para tirar a hora.
- **Gatilhos:** `set_updated_at`; `exigir_contato_da_mesma_clinica` (o mesmo de waitlist, appointment e contact_consent; contato de outra clínica dá P0001); e **`validar_atividade`** (`SECURITY DEFINER`, `search_path = public`):
  - no INSERT com sessão: origem tem de ser `manual` (senão 42501), `created_by` vira `auth.uid()` quando vem nulo e é recusado se for outra pessoa (42501), `created_at = now()`; sem sessão (o motor), origem `automacao` exige `automacao_id` (23514); toda atividade nasce `pendente` (23514) e sem carimbos; **exceção desde a `20261006140000` (seção 18.10):** com a GUC `conduzza.agendada_pelo_sistema = 'sim'`, que só as funções `SECURITY DEFINER` da mensagem agendada ligam, a atividade "a mensagem agendada não saiu" passa com origem `automacao`, sem `automacao_id` e sem `created_by`, mesmo nascendo dentro de uma sessão (a revogação da autorização pela ficha roda com a sessão de quem revoga);
  - no UPDATE: `clinic_id`, `contact_id`, `created_by`, `created_at` e `origem` imutáveis (23514); `automacao_id` só pode virar nulo; mudou o status, o gatilho carimba `completed_at/by` ou `canceled_at/by` com a sessão (nula para a service role) e limpa ao reabrir; com o status igual, os carimbos ficam como estavam (o cliente não forja);
  - o responsável tem de ser membro **ativo** da clínica, conferido só quando é definido ou trocado (quem saiu da equipe depois não trava concluir, adiar nem reatribuir);
  - a conversa tem de ser da mesma clínica e do mesmo contato (23514).
- **RLS:** SELECT para membro ativo (admin, gestor, recepção, profissional e leitura; pendente não). INSERT para admin, gestor e recepção (`user_has_role`; `user_can_write` não serve, porque inclui o profissional) com `created_by = auth.uid()`. UPDATE para admin, gestor e recepção em qualquer atividade da clínica, inclusive as da automação. **Sem DELETE:** nem policy nem privilégio, então o DELETE pela API dá 42501 (cancelar no lugar de apagar); a cascata do contato e da clínica não depende disso. `anon` sem privilégio.
- **Colunas de usuário** apontam para `auth.users` sem ação de exclusão, como `message.author_user_id`: quem deixou rastro não some da base.
- **`contagem_de_atividades(p_clinic_id uuid) returns jsonb`** (`stable`, `SECURITY INVOKER`, `search_path` vazio; `execute` para `authenticated` e `service_role`, negado a `anon`): `{ atrasadas, hoje, minhas_atrasadas, minhas_hoje }` das pendentes. **Atrasada** = `coalesce(due_at < now(), due_on < hoje)`; **hoje** = `due_on = hoje` e não atrasada (a de hoje com hora que já passou é atrasada; as duas não se sobrepõem); "hoje" é `(now() at time zone clinic.timezone)::date`; "minhas" = `assignee_user_id = auth.uid()` (zero para a service role). Quem não é membro ativo recebe zeros. O espelho em TypeScript é `ehAtrasada` e `ehParaHoje` em `lib/domain/atividades.ts`: mudou um, muda o outro. O `coalesce` é o que faz a atividade sem hora contar como atrasada (sem ele, `due_at < now()` com `due_at` nulo daria nulo e a linha sumiria da contagem: defeito pego pelo ensaio).

### 12.4 Relógios do contato (Leva B)

`contact.funnel_stage_changed_at` (tempo na etapa) e `contact.last_contact_at` (última mensagem do lead) passam a mover automação, e até a Leva B a sessão (admin, gestor e recepção, pela policy de UPDATE de `contact`) podia reescrevê-los pela API sem mudar de etapa. Gatilho **`proteger_relogios_do_contato`** (`BEFORE INSERT OR UPDATE OF funnel_stage_changed_at, last_contact_at`):

- com sessão (`auth.uid()` presente), no INSERT `last_contact_at` nasce nulo; no UPDATE, `last_contact_at` fica como estava e `funnel_stage_changed_at` também, quando a etapa não muda (quando muda, `validar_etapa_do_contato` carimba `now()`). O valor mandado é ignorado em silêncio, sem erro;
- sem sessão (ingestão, motor, testes, seed), livre.

O gatilho foi escolhido no lugar de `REVOKE` de coluna porque o UPDATE de `authenticated` é concedido na tabela inteira, e trocar por grants de coluna deixaria sem escrita toda coluna nova de `contact`. Escritores conferidos em 02/10: `last_contact_at` só por `ingest_inbound_message` (service role) e pelo seed e e2e; `funnel_stage_changed_at` só pelo gatilho e pelos testes. Nenhum caminho atual quebra.

### 12.5 A regra (`automacao_fluxo`)

```sql
create table automacao_fluxo (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  nome text not null,                       -- 2 a 80
  ativa boolean not null default false,     -- nasce desligada
  gatilho text not null,                    -- tempo_na_etapa | sem_resposta_na_etapa | entrou_na_etapa | mensagem_recebida
  etapa text not null,                      -- a origem
  espera_minutos integer,                   -- 60 a 129600, só nos gatilhos de tempo
  acao text not null,                       -- mover_etapa | etiquetar | criar_atividade | nota_interna
  etapa_destino text,                       -- mover_etapa
  motivo_perda text,                        -- só 'nao_respondeu', só com destino Perdido
  etiqueta text,                            -- etiquetar (chave do catálogo)
  atividade_titulo text,                    -- criar_atividade, 2 a 120
  atividade_prazo_dias integer,             -- criar_atividade, 0 a 365
  nota_texto text,                          -- nota_interna, até 2000, não só de espaços
  vigente_desde timestamptz not null default now(), -- trava contra disparo retroativo
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FKs compostas NO ACTION (nunca RESTRICT, que quebraria o cascade da clínica)
  constraint automacao_fluxo_etapa_fkey foreign key (clinic_id, etapa) references funnel_stage_def (clinic_id, chave),
  constraint automacao_fluxo_etapa_destino_fkey foreign key (clinic_id, etapa_destino) references funnel_stage_def (clinic_id, chave),
  constraint automacao_fluxo_etiqueta_fkey foreign key (clinic_id, etiqueta) references conversation_tag_def (clinic_id, chave)
  -- mais os checks por ação: nome_de_automacao_com_tamanho, gatilho_de_automacao_valido,
  -- acao_de_automacao_valida, espera_so_nos_gatilhos_de_tempo, espera_na_faixa,
  -- acao_mover_tem_destino, destino_diferente_da_origem, motivo_de_perda_da_automacao,
  -- acao_etiquetar_tem_etiqueta, acao_atividade_tem_titulo_e_prazo,
  -- titulo_de_atividade_da_automacao, prazo_de_atividade_da_automacao,
  -- acao_nota_tem_texto, nota_da_automacao_com_tamanho
);
```

- Regra em colunas fixas, sem linguagem genérica (CLAUDE.md 4). Os campos de uma ação vão nulos nas outras. **Não existe ação de enviar mensagem** (decisão do dono em 02/10/2026): a mensagem ao paciente é a régua de follow-up da etapa.
- **Gatilho `validar_automacao_de_fluxo`** (`SECURITY DEFINER`, com `pg_advisory_xact_lock` por clínica, para duas regras salvas ao mesmo tempo não fecharem um ciclo sem se verem):
  - **primeiro, a guarda da sessão** (revisão de 02/10/2026): com sessão, quem não é admin nem gestor da clínica da linha recebe 42501 ("Sem permissão para gerenciar as automações desta clínica.") antes de qualquer leitura ou trava. O Postgres confere o WITH CHECK da RLS só **depois** dos gatilhos BEFORE; sem a guarda, o pendente ou o admin de outra clínica, com o uuid dela, leria pelo hint do erro (`automacao_destino_da_agenda`, `automacao_perdido_sem_motivo`, `automacao_ciclo`) o papel das etapas e o grafo das regras ligadas, e seguraria a trava da clínica alheia. Sem sessão (service role, testes, motor) não há guarda;
  - `clinic_id` imutável ("Uma automação não muda de clínica.", 23514); `created_by`, `updated_by` e `created_at` carimbados com a sessão;
  - **`vigente_desde`** volta a `now()` ao ligar (`ativa` de falso para verdadeiro) e ao mudar `gatilho`, `etapa` ou `espera_minutos`; com sessão, só o banco escreve (sem sessão, quem mexe de propósito é atendido);
  - destino com papel `agendou` ou `compareceu` é recusado (hint `automacao_destino_da_agenda`); destino `perdido` exige `motivo_perda = 'nao_respondeu'` (hint `automacao_perdido_sem_motivo`), e motivo sem destino Perdido é recusado (hint `automacao_motivo_sem_perdido`), todos 23514;
  - **detector de ciclo:** as arestas são as regras **ligadas** de `mover_etapa` cujo gatilho não é `mensagem_recebida` (essa só anda se o lead escrever), de `etapa` para `etapa_destino`, sem a versão antiga da própria regra. Se do destino se chega de volta à origem, 23514 com hint `automacao_ciclo`. Roda ao criar ligada, ao ligar e ao editar; regra desligada não entra. O espelho em TypeScript é `cicloDaAutomacao` (`lib/domain/automacoes-de-fluxo.ts`), que devolve o caminho para a tela.
- **RLS:** membro ativo lê (a recepção, que não vê a aba, entende por que o lead andou); admin e gestor gerenciam (`user_has_role`). Recepção, leitura, profissional, pendente e outra clínica recebem 42501 no INSERT e zero linhas, sem erro, no UPDATE e no DELETE (a policy `for all` só barra pelo USING, e a action trata o retorno vazio como "Esta automação não existe mais"). Etapa, destino ou etiqueta que não existem na clínica dão 23503 (as FKs acima). `anon` sem privilégio.
- Mutações pela tela vão para `audit_log` com `entity = 'automacao_fluxo'` e o id (`criou_`, `editou_`, `ligou_`, `desligou_` e `excluiu_automacao_de_fluxo`), sem nome nem texto. A exclusão é real e leva o histórico (cascade); as atividades criadas ficam (`contact_activity.automacao_id` vira nulo) e as notas ficam.

### 12.6 O histórico (`automacao_execucao`)

```sql
create table automacao_execucao (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  automacao_id uuid not null references automacao_fluxo(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  de_etapa text not null,                   -- a etapa da regra no registro
  para_etapa text,                          -- só quando moveu
  entrada_na_etapa timestamptz not null,    -- o funnel_stage_changed_at da entrada: identidade e CAS
  message_id uuid references message(id) on delete set null,      -- mensagem_recebida (nunca o texto)
  devida_em timestamptz not null,           -- vencimento, movimento, ou recebimento + 15 s
  profundidade smallint not null default 0 check (profundidade between 0 and 10),
  status text not null default 'pendente' check (status in ('pendente','executada','pulada','falhou')),
  motivo text check (motivo is null or motivo ~ '^[a-z0-9_]{1,64}$'),
  conversation_id uuid references conversation(id) on delete set null,
  atividade_id uuid references contact_activity(id) on delete set null,
  -- O retrato do que a regra fez NESTA execução, só em 'executada' (revisão de 02/10/2026).
  acao text,                                -- mover_etapa | etiquetar | criar_atividade | nota_interna
  etiqueta text,                            -- a chave da etiqueta (a mesma de conversation.tags)
  etiqueta_nome text,                       -- o nome que a etiqueta tinha na hora
  executada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automacao_execucao_uma_por_entrada unique (automacao_id, contact_id, entrada_na_etapa),
  constraint execucao_pulada_ou_falha_tem_motivo check ((status in ('pulada','falhou')) = (motivo is not null)),
  constraint execucao_fechada_tem_carimbo check ((status = 'pendente') = (executada_em is null)),
  constraint para_etapa_so_quando_executada check (para_etapa is null or status = 'executada'),
  constraint acao_da_execucao_valida check (acao is null
    or acao in ('mover_etapa','etiquetar','criar_atividade','nota_interna')),
  constraint acao_so_quando_executada check (acao is null or status = 'executada'),
  -- chave e nome juntos se e somente se a ação foi etiquetar
  constraint etiqueta_da_execucao_coerente check (case when acao = 'etiquetar'
    then etiqueta is not null and etiqueta_nome is not null
    else etiqueta is null and etiqueta_nome is null end)
);
```

- **O retrato** existe porque editar a ação ou a etiqueta de uma regra não recomeça a vigência (`vigente_desde`): sem ele, o histórico descrevia execuções antigas pela regra de hoje (a regra que etiquetou 20 vezes e virou "Nota interna" passava a dizer 20 vezes "Deixou uma nota interna"). O executor grava `acao` ao fechar como `executada` e, em `etiquetar`, a chave e o nome da etiqueta na hora (a etiqueta pode ser renomeada, ou excluída depois que a regra deixar de usá-la). A tela (`descreverExecucao`) descreve por ele: "Moveu de {etapa} para {etapa}", "Etiquetou a conversa com {nome da hora}", "Criou uma atividade", "Deixou uma nota interna na conversa"; sem o retrato, o texto neutro "Executou a automação".

- **Uma execução por regra, contato e entrada na etapa**, para todo gatilho: sair e voltar é outra entrada e rearma.
- **Motivos da pulada:** `regra_desligada`, `regra_alterada`, `etapa_mudou` (o movimento humano ou o termo-chave venceu), `nao_e_lead`, `importado`, `lead_respondeu`, `limite_de_cascata`, `limite_diario`, `destino_invalido`, `tem_consulta_futura`, `sem_conversa`, `ja_tinha_etiqueta`, `limite_de_etiquetas`. **Falhou:** `erro_<sqlstate>`. O texto em português de cada um mora em `textoDoMotivo` (`lib/domain/automacoes-de-fluxo.ts`).
- **RLS:** membro ativo lê; INSERT, UPDATE e DELETE revogados de `authenticated` (42501): só funções `SECURITY DEFINER` escrevem. A consulta do histórico na tela embute `contact:contact_id(name)`, que é dado de paciente: a action grava a leitura em `audit_log` antes de devolver, com a entidade própria `automacoes_de_fluxo` em `lib/auth/read-audit.ts`, sem id (tela de lista). Até a revisão de 02/10/2026 a entidade era `leads`, e a leitura do histórico se confundia com a da lista de Leads na janela de 5 minutos da deduplicação.
- **Índices:** além da fila, do histórico por clínica e por regra e das FKs com `ON DELETE SET NULL`, `automacao_execucao_do_contato (contact_id, executada_em desc)`, completo (seção 9).

### 12.7 Gatilhos que só registram

Executar dentro do gatilho faria um UPDATE de `contact` dentro do AFTER UPDATE do mesmo contato, e uma falha da automação desfaria o movimento humano. Por isso os dois gatilhos só inserem em `automacao_execucao` (com `on conflict do nothing`); qualquer falha vira `warning` só com o sqlstate e **nunca bloqueia** o movimento nem a ingestão. Sem regra ligada do gatilho, só fazem um `exists`.

- **`registrar_entrada_para_automacao`** (`AFTER INSERT OR UPDATE OF funnel_stage` em `contact`): o ponto único que pega todo movimento (Kanban, ação em massa, Assumir, termo-chave, Agenda, a própria automação) e o nascimento do contato. Só lead, e fora o importado que nunca mudou de etapa; só regra com `vigente_desde <= funnel_stage_changed_at`. A profundidade da cadeia vem do GUC `conduzza.automacao_profundidade`, que o executor liga durante o próprio movimento.
- **`registrar_mensagem_para_automacao`** (`AFTER INSERT` em `message`, `when direction = 'entrada' and author = 'paciente' and not is_internal_note`): cobre `ingest_inbound_message` sem tocar nela (a reentrega do webhook não insere `message`, então não registra de novo). Ignora a **primeira fala** do contato novo: a mensagem que o cria e as que chegam até 2 minutos depois do nascimento dele (`contact.created_at > now() - interval '2 minutes'`; espelho `PRIMEIRA_FALA_MINUTOS` em `lib/domain/automacoes-de-fluxo.ts`). Cada entrega do webhook é outra transação, e ignorar só a mensagem que cria deixava a segunda da rajada disparar (todo lead novo saía da etapa de entrada em cerca de 1 minuto); na contagem de produção citada na migration (60 dias até 02/10/2026, só contagens), 130 de 200 segundas mensagens chegaram em até 2 minutos. A âncora é o nascimento do contato, não a entrada na etapa: a resposta rápida de um lead que a recepção acabou de mover conta. Efeito colateral: o contato cadastrado à mão pela recepção que escreve nos 2 minutos seguintes também não conta. A janela veio na revisão de 02/10/2026 e é ponto aberto para o dono (backlog). Deixa a execução devida em `now() + 15 segundos`, para o termo-chave (no webhook, logo depois da ingestão) andar antes e o CAS da execução ver a etapa mudada.

### 12.8 O motor (`planejar_automacoes_de_fluxo` e `executar_automacoes_de_fluxo`)

As duas são `SECURITY DEFINER`, com `execute` só para `service_role`, e rodam dentro de `motor_manutencao` (pg_cron, a cada minuto), cada uma no próprio bloco de exceção, **antes de `planejar_reguas`** (para o follow-up da etapa para onde a automação moveu já nascer na mesma passagem). Os erros entram, como os outros passos, em `worker_heartbeat.ultimo_erro` do `motor-planner` (`planejar_automacoes:<sqlstate>` e `executar_automacoes:<sqlstate>`), que `/api/webhooks/saude` mostra como `planner_erro` e responde 503 (`planner_com_erro`); o retorno de `motor_manutencao` ganhou a chave `automacoes`. Clínica de teste (`e_de_teste`) fica fora do cron: os testes chamam com `p_clinic_id` e `p_incluir_teste = true`. A idempotência vem do UNIQUE, do `SKIP LOCKED` e do CAS, nunca de "só um motor" (o `npm run worker` local também chama `motor_manutencao`).

- **`planejar_automacoes_de_fluxo(p_limite int default 500, p_clinic_id uuid default null, p_incluir_teste bool default false) returns int`**: varre os gatilhos de tempo. Âncora: `funnel_stage_changed_at` em `tempo_na_etapa`; `greatest(funnel_stage_changed_at, last_contact_at)` em `sem_resposta_na_etapa` (sem mensagem do lead, vale a entrada; a mensagem da clínica não conta). **Não retroativa:** só registra o que venceu em ou depois de `vigente_desde`. Só lead, fora o importado que nunca mudou de etapa. Lote limitado (até 5000), idempotente.
- **`executar_automacoes_de_fluxo(p_limite int default 100, p_clinic_id uuid default null, p_incluir_teste bool default false) returns jsonb`** (`{ executadas, puladas, falhas, adiadas }`): o lote de pendentes devidas é escolhido e travado **antes** de executar (`FOR UPDATE SKIP LOCKED`), então o que nasce durante a passagem só roda na próxima: **um salto por passagem**. Por contato, as outras ações rodam antes de mover. Cada linha no próprio bloco de exceção.
  - O contato é travado com `FOR NO KEY UPDATE SKIP LOCKED`; travado por outra transação, a linha fica para a próxima passagem (adiada).
  - Pula quando: regra desligada; registrada antes do `vigente_desde` atual (regra alterada); o contato saiu da etapa ou saiu e voltou (CAS por `funnel_stage` e `funnel_stage_changed_at`); não é lead; importado; no sem resposta, o lead respondeu e o tempo foi revalidado.
  - **Mover:** cadeia até 3 saltos (`profundidade >= 3` pula); no máximo 10 movimentos automáticos por lead em 24 horas; destino com papel `agendou` ou `compareceu` ou inexistente pula; Perdido pula quem tem consulta futura viva (agendado, aguardando confirmação ou confirmado). O update é guardado pela etapa e pela entrada (CAS); entrar em Perdido grava `lost_reason = 'nao_respondeu'`, sair limpa o motivo, e `lost_reason_note` vai nulo. O movimento dispara conversão para a Meta e follow-up como qualquer outro, e o Realtime de `contact` leva ao Kanban. Trilha `automacao_moveu_etapa` (`contact`).
  - **Etiquetar, criar atividade e nota interna** caem na conversa **mais recente** do lead, por `coalesce(last_message_at, created_at)`, em qualquer status.
    - Etiquetar: conversa travada (`FOR NO KEY UPDATE SKIP LOCKED`) fica para a próxima; pula se não há conversa, se a etiqueta já está ou se a conversa já tem 8. Trilha `automacao_etiquetou` (`conversation`).
    - Criar atividade: `contact_activity` com `origem = 'automacao'`, `automacao_id`, `created_by` nulo, `titulo = atividade_titulo`, `due_on` = hoje no fuso da clínica mais N dias, `due_at` nulo, `conversation_id` = essa conversa e o responsável = quem atende a conversa, se ainda é membro ativo, senão nulo. Trilha `automacao_criou_atividade` (`contact_activity`).
    - Nota interna: `message` com `direction = 'saida'`, `author = 'sistema'`, `author_user_id` nulo, `is_internal_note = true`, `content_type = 'texto'`, `billable = false` e `body = nota_texto` (o número vem da conversa por gatilho; nota não mexe na prévia nem no "esperando resposta"). Pula sem conversa. Trilha `automacao_anotou` (`message`). No Atendimento, a bolha assina "Automação" (`docs/06`, 5.3).
  - Ao fechar a linha como `executada`, grava o retrato (`acao` e, em `etiquetar`, `etiqueta` e `etiqueta_nome` lido do catálogo na hora); pulada e falha ficam sem retrato (12.6).
  - Erro transitório (deadlock, serialização, trava) deixa a linha pendente; os outros erros fecham a linha como `falhou` com `erro_<sqlstate>`, sem dado de paciente.
  - Sem sessão (pg_cron, service role), `auth.uid()` é nulo, que é o que `validar_atividade` exige para origem `automacao`. Com sessão, o banco recusa origem `automacao` (42501).
- Toda trilha da automação no `audit_log` tem `user_id` nulo e nenhum conteúdo.
- **Latência:** tempo e entrada em até 60 segundos; mensagem em até uns 75 segundos.

### 12.9 Prévia (`previa_da_automacao_de_fluxo`)

**`previa_da_automacao_de_fluxo(p_clinic_id uuid, p_gatilho text, p_etapa text, p_espera_minutos int default null) returns jsonb`** (`stable`, `SECURITY INVOKER`, `search_path` vazio; `execute` para `authenticated` e `service_role`): `{ na_etapa, ja_se_encaixam, importados_fora }`, só contagens. `na_etapa`: leads da etapa que a regra alcança. `ja_se_encaixam`: nos gatilhos de tempo, os que **já passaram do tempo e não serão afetados**; em `entrou_na_etapa`, os que já estão na etapa; em `mensagem_recebida`, zero (vale a próxima mensagem). `importados_fora`: os importados que nunca mudaram de etapa. Gatilho inválido ou espera fora de 60 a 129600: 22023. A RLS de `contact` recorta: quem não é membro ativo recebe zeros.

### 12.10 Etapa e etiqueta usadas por automação

`proteger_jornada` e `proteger_etiqueta_de_conversa` foram recriadas a partir dos corpos de produção (`pg_get_functiondef` em 02/10/2026), com um bloco novo entre os marcadores `[automacoes de fluxo]` (o ensaio confere que, fora deles, são idênticas às de produção). Excluir etapa usada por automação, como origem ou destino, dá P0001 com hint `etapa_usada_por_automacao` e "Esta etapa é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etapa."; excluir etiqueta usada dá P0001 com hint `etiqueta_usada_por_automacao` e "Esta etiqueta é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etiqueta.". Sem o bloco, a FK composta recusaria do mesmo jeito, mas com 23503 e sem dizer o que fazer. A tela não mostra o texto cru do banco: `excluirEtapaDaJornadaAction` e `excluirEtiquetaDeConversaAction` reconhecem a recusa pelo hint (ou, se o hint não chegar, pelo começo da mensagem) com `recusaDaEtapaUsadaPorAutomacao` e `recusaDaEtiquetaUsadaPorAutomacao` (`lib/domain/automacoes-de-fluxo.ts`) e mostram o texto que diz onde resolver: "Esta etapa é usada por uma automação de fluxo. Exclua a automação ou troque a etapa dela na aba Automações de fluxo antes de excluir a etapa." (a mesma frase está em `RECUSAS_DA_JORNADA`) e o equivalente da etiqueta. Apagar a clínica inteira continua passando (o escape do cascade dos dois gatilhos não mudou).

### 12.11 Ordem de publicação e rollback

**Ordem:** a Leva A, depois a Leva B, ambas **antes** do código. Sem a Leva A, a leitura da jornada falha (Jornada, Leads e Atendimento caem no erro de leitura da jornada, e o termo-chave para dos dois lados, só com o log `termo_chave_ler_jornada_falhou`), e a página Atividades e as abas de Mensagens padrão e Automações de fluxo caem no próprio erro. Sem a Leva B, a aba de automações cai no próprio erro e o motor não roda regra nenhuma. Sem a função `marcar_eco_para_termo`, o eco do celular não anda o lead (só o log `termo_chave_marcar_eco_falhou`, e o webhook segue respondendo 200). A integração da Leva A (`tests/integration/crm-leva-a.test.ts`) cria uma `automacao_fluxo` real (helper `novaRegra`) e por isso só roda com as duas aplicadas. Os casos novos de RLS e integração das automações (guarda contra o oráculo, retrato da execução, primeira fala e folga de 15 segundos) dependem das colunas e da guarda da Leva B. A `20261002140000` (convênio pelo médico, seção 13) vem logo depois, na mesma janela.

**Rollback** (detalhado no cabeçalho de cada migration, nesta ordem):
- **Leva B:** recriar `motor_manutencao`, `proteger_jornada` e `proteger_etiqueta_de_conversa` sem as linhas entre os marcadores; apagar os gatilhos `registrar_mensagem_para_automacao`, `registrar_entrada_para_automacao` e `proteger_relogios_do_contato`; as funções `previa_da_automacao_de_fluxo`, `executar_automacoes_de_fluxo`, `planejar_automacoes_de_fluxo`, `registrar_mensagem_para_automacao`, `registrar_entrada_para_automacao` e `proteger_relogios_do_contato`; a tabela `automacao_execucao`; a FK `contact_activity_automacao_id_fkey` e o índice `contact_activity_da_automacao`; a tabela `automacao_fluxo`, a função `validar_automacao_de_fluxo` e o índice `contact_etapa_e_entrada_idx`.
- **Leva A:** apagar `marcar_eco_para_termo` e a tabela `termo_eco_visto`, `contagem_de_atividades`, o gatilho `recalcular_dia_das_atividades` em `clinic` e a função de mesmo nome, a tabela `contact_activity`, `validar_atividade`, a tabela `resposta_rapida`, `proteger_resposta_rapida` e as duas colunas de `funnel_stage_def` com as constraints. O código que lê `termos_de_quem` e `descricao` volta junto.

---

## 13. Convênio pelo médico (02/10/2026)

Pedido e decisão do dono em 02/10/2026 (spec 3.4 e 3.5; backlog, entrada "Convênio pelo médico"): o profissional diz quais convênios atende, o procedimento diz quais convênios o cobrem, e o convênio do profissional entra sozinho só onde ele faz o procedimento e o convênio cobre. Migration `20261002140000_convenio_pelo_medico.sql`, ensaiada em transação desfeita e **aplicada em produção em 02/10/2026**, depois das duas do CRM e seguida da correção `20261002150000` (seção 13.5); pressupõe as duas do CRM (seção 12) e não edita nenhuma delas. Os tipos de `lib/supabase/database.types.ts` (as duas tabelas, a RPC nova e a assinatura nova da RPC do procedimento) foram escritos à mão no formato gerado e precisam ser regenerados depois de aplicar as três.

**`service_link` continua sendo a fonte** da agenda, da IA, do preço, dos relatórios e das conversões. As tabelas novas são lidas só pelo cadastro e pelas duas RPCs. Nenhum gatilho novo em `service_link`, nem de recusa nem de espelho: a recusa quebraria o código publicado e as fixtures durante a transição, e o espelho faria uma aba parada remarcar o convênio no profissional sem ninguém ver.

### 13.1 Termos

- **atende(m, P):** existe a linha (m, P) em `professional_insurance`. O Particular é implícito e nunca é gravado.
- **cobre(X, P):** existe a linha (X, P) em `procedure_insurance`. Procedimento sem linha é só Particular.
- **faz(m, X):** existe `service_link` **ativo** de m em X, de qualquer convênio, Particular incluído, medido antes da gravação e sob a trava. O `active` do profissional e do procedimento não entra.
- **Exceção:** faz, atende e cobre, sem vínculo ativo (m, X, P). É **implícita** (nada a grava) e as duas RPCs a preservam: um convênio que não mudou não é tocado.
- **Invariante I1:** todo vínculo ativo com convênio P tem atende(m, P) e cobre(X, P). Garantida pelas RPCs, não por gatilho; dado antigo fora dela (gravado pelo código publicado antes, ou direto pela API) é tolerado e **curado** na abertura dos modais e nas RPCs.

### 13.2 As tabelas

SQL na seção 2. `clinic_id NOT NULL`, unique do par, índices em `clinic_id` e em `insurance_id`, sem `updated_at` (a linha entra ou sai; o histórico fica no `audit_log` pela action). Desmarcar apaga o par, **nunca** o `service_link` (o vínculo é desativado, porque `appointment.service_link_id` não tem cascata).

- **RLS** no padrão de `package_item`: membro **ativo** lê (`user_active_clinic_ids`; pendente não lê nada); administrador e gestor escrevem pela policy `for all` com `user_has_role(clinic_id, array['admin','gestor'])`; recepção, leitura e profissional só leem. `anon` sem privilégio nenhum; `authenticated` sem `TRUNCATE` e sem `UPDATE` (as RPCs só inserem e apagam, e `on conflict do nothing` não pede UPDATE; nada de upsert pela API nessas tabelas).
- **Gatilho `exigir_convenio_da_mesma_clinica`** (`SECURITY DEFINER`, `search_path = public`, `execute` revogado de `public`, `anon` e `authenticated`; `BEFORE INSERT OR UPDATE` das colunas de chave nas duas tabelas): convênio, profissional e procedimento têm de ser da clínica da linha, senão 23503 ("O convênio informado não pertence a esta clínica.", "O profissional informado não pertence a esta clínica.", "O procedimento informado não pertence a esta clínica."). Função própria, em vez de mais um ramo em `exigir_cadastro_da_mesma_clinica`, que já foi reescrita em 4 migrations.
- **Carga inicial** (idempotente): cada (profissional, convênio) e cada (procedimento, convênio) dos vínculos **ativos** com convênio vira par, inclusive de convênio, profissional ou procedimento inativo; vínculo inativo não entra. Assim nada muda na tela nem na agenda no dia da publicação. Na produção de 02/10 são 3 vínculos ativos, todos Particular: a carga grava 0 linha.

### 13.3 As duas RPCs

Regras comuns: `SECURITY INVOKER` (a RLS de `service_link`, das tabelas novas e de `appointment` vale lá dentro), `search_path = public`, `execute` só para `authenticated` e `service_role` (revogado de `public` e `anon`); papel conferido no começo (42501 "Somente administradores e gestores alteram os cadastros."); cadastro de outra clínica, inexistente ou para membro pendente dá P0002 (a RLS esconde a linha). **Trava por clínica:** `pg_advisory_xact_lock(hashtextextended('convenios_do_catalogo:' || clinic_id, 0))` antes de ler qualquer coisa, nas duas RPCs e nos dois modos da do procedimento: as gravações do profissional e do procedimento da mesma clínica entram em fila, sem deadlock entre elas; no procedimento, depois da trava, `FOR UPDATE` da linha do procedimento. **Aba parada (CZ409):** o que a tela leu na abertura é comparado, sob a trava, com o banco; se mudou, `serialization_failure` "O cadastro mudou enquanto você editava. Feche, abra de novo e salve." Repetir a chamada com a mesma lista é seguro (zero alterações). Consulta futura é a não cancelada com `ends_at > now()`.

**`sincronizar_convenios_do_profissional(p_professional_id uuid, p_convenios uuid[], p_convenios_na_abertura uuid[] default null, p_confirmar boolean default false) returns jsonb`** (o lado do profissional, com cascata no servidor):
- `p_convenios` é a lista inteira desejada, sem o Particular; `p_convenios_na_abertura` são os pares **crus** de `professional_insurance` na abertura do modal (não a lista curada que a tela mostra marcada); nulo dispensa a conferência (profissional novo).
- `atuais = pares ∪ convênios dos vínculos ativos dele` (a **cura**: o convênio que só existia num vínculo conta como já marcado e só ganha o par, sem cascata); `entram = novos − atuais`; `saem = atuais − novos`.
- Convênio que entra: em cada procedimento que ele faz **e** que o convênio cobre, **reativa** o vínculo inativo com os valores gravados ou **cria** um "Coberto" (`price_cents` nulo, `covered_by_insurance = true`, `duration_min = procedure.default_duration_min`); `bookable_by_ai` sempre o do procedimento; vínculo já ativo não é tocado.
- Convênio que sai: desativa os vínculos ativos dele com o convênio e apaga o par. `deixa_de_fazer` lista o procedimento em que **todos** os vínculos ativos dele saem (o Particular nunca sai por aqui) e nenhum convênio que entra cobre: ele sai do procedimento, e marcar o convênio de novo não o traz de volta.
- Com consulta futura nos vínculos que saem, ou com `deixa_de_fazer`, e sem `p_confirmar`: devolve `aplicado: false` com a prévia e **nada é gravado** (`vinculos_*` vêm 0).
- Os pares passam a ser exatamente a lista (o convênio curado também ganha o par).
- Retorno: `{ aplicado, entram: [{ insurance_id, procedure_ids }], saem: [{ insurance_id, procedure_ids }], deixa_de_fazer: uuid[], consultas_futuras, primeira_consulta, vinculos_criados, vinculos_reativados, vinculos_desativados }`; `entram` tem um item por convênio que entra, mesmo sem procedimento; ordem pelo nome do convênio e do procedimento.
- Erros, na ordem em que são conferidos: 22023 "A lista de convênios é inválida." (nula, com elemento nulo ou com mais de 200); P0002 "Profissional não encontrado."; 42501; CZ409; 23503 "Um convênio escolhido não é desta clínica."; 22023 "Um convênio desativado não pode ser marcado." (só para o que **entra**; o desativado que já estava marcado pode ficar).

**`sincronizar_vinculos_do_procedimento(..., p_planos uuid[] default null, p_vinculos_na_abertura jsonb default null, p_planos_na_abertura uuid[] default null, p_confirmar boolean default false)`** (o lado do procedimento, **sem** cascata no servidor: a pré-marcação é da tela):
- **Modo legado** (`p_planos` nulo): idêntico ao de 29/09 (seção 2), mesmo retorno de 5 chaves, não lê nem grava `procedure_insurance`; a única diferença é a trava da clínica. Mandar `p_vinculos_na_abertura`, `p_planos_na_abertura` ou `p_confirmar = true` sem `p_planos` dá 22023 "Informe os convênios que cobrem este procedimento." (recusa em vez de ignorar).
- **Modo novo:** `p_planos` são os convênios que cobrem, finais (lista vazia = só Particular); `p_vinculos_na_abertura` são os `[{ professional_id, insurance_id }]` dos vínculos **ativos** na abertura (`insurance_id` nulo = Particular; o `EXCEPT` trata o nulo como igual); `p_planos_na_abertura` é o `procedure_insurance` **cru** da abertura. Conferências, na ordem: as de linha do legado (22023); 22023 "A lista de convênios é inválida."; P0002 "Procedimento não encontrado."; 42501; CZ409 (vínculos **ou** convênios da abertura); 23503 "Um convênio escolhido não é desta clínica."; 22023 "Um convênio desativado não pode ser marcado." (convênio novo em `p_planos`, ou linha nova com convênio desativado; o convênio em uso num vínculo ativo do próprio procedimento conta como já marcado, como a cura do lado do profissional, e só ganha a linha em `procedure_insurance`); 23514 "Um convênio marcado para um profissional não está entre os convênios que cobrem este procedimento."; 23514 "Um profissional não atende um dos convênios marcados. Feche, abra de novo e salve." (só para a linha que **entra**; a que já estava ativa passa, dado antigo curado na abertura).
- Com consulta futura nos vínculos que saem e sem `p_confirmar`: `aplicado: false` e nada é gravado, nem a cobertura. Com a confirmação (ou sem consulta), reconcilia como o legado e grava `procedure_insurance` igual a `p_planos`.
- Retorno do modo novo: `{ aplicado, criados, reativados, atualizados, desativados, consultas_futuras, primeira_consulta, planos_entram: uuid[], planos_saem: uuid[] }`.

### 13.4 Leitura, actions e Agenda

- **Catálogo:** `fetchCatalogo` (`lib/queries/catalogo.ts`) passou a ler **só os vínculos ativos**, paginados por id em páginas de 1000 (o PostgREST corta em `max_rows = 1000` sem erro, e um corte faria a trava otimista recusar todo Salvar com CZ409); quem lia `catalogo.vinculos` já filtrava `active`. `fetchMatrizDeConvenios` lê `professional_insurance` e `procedure_insurance` da clínica com a mesma paginação (chave `["catalogo", clinicId, "matriz-de-convenios"]`); erro em qualquer página lança, então a lista cortada nunca é entregue, e Cadastros cai no erro da página.
- **`salvarProfissionalAction`** ganhou `insurance_ids` (único, até 200; ausente = não mexe, vazio = tira todos), `insurance_ids_na_abertura` e `confirmar_convenios`. Na edição: conferência da desativação, conferência de que o profissional é da clínica ativa, a RPC (sem confirmação, volta `code = 'consultas_no_periodo'`, `motivo = 'convenios'` e o resumo), a trilha `editou_convenios_do_profissional` (`entity = 'professional'`) logo depois de a RPC aplicar, e só então o UPDATE da linha (se ele falhar, `parcial` com o id e o resumo). Na criação: o INSERT, depois a RPC com `p_confirmar` (não há vínculo para desativar); se a RPC falhar, `parcial` com o id.
- **`sincronizarVinculosDoProcedimentoAction(procedureId, linhas, extras?)`**: sem `extras`, o modo legado; com `extras`, o modo novo, com a linha de convênio fora dos que cobrem recusada antes do banco. CZ409 vira `code = 'cadastro_mudou'` (a tela recarrega o catálogo); 22023 vira "Um convênio desativado não pode ser marcado."; 23514 mostra a frase do banco; `aplicado: false` vira `code = 'consultas_no_periodo'`, `motivo = 'vinculos'`, sem trilha. Na edição, a sincronia vem **antes** da linha do procedimento, para nada ser gravado antes da confirmação; o UPDATE que alinha `bookable_by_ai` nos vínculos (só na edição) agora confere o erro e volta como `parcial`. Por isso, no meio de um Salvar, a chave da IA do vínculo e a do procedimento podem divergir por um instante, e a IA confere as duas (`docs/03`).
- **Agenda:** `criarAgendamentoAction` lê o `active` do vínculo e recusa a consulta nova em vínculo inativo (`code = 'sem_vinculo'`, "Este profissional não atende mais este procedimento por este convênio. A lista já foi atualizada: escolha de novo."); o modal refaz o catálogo da clínica. A remarcação não mudou: com o mesmo profissional mantém o vínculo da consulta, e a troca de profissional já exigia vínculo ativo.
- Nenhum dado de paciente em log: as actions devolvem só contagens, ids e a data da primeira consulta.

### 13.5 Ensaio, ordem de publicação e rollback

**Ensaio:** a migration rodou duas vezes (idempotente) sobre um prelúdio com dado antigo e a cópia exata da função de produção, com asserts de RLS por papel e isolamento A x B nas duas tabelas, mistura de clínicas (23503), modo legado comparado passo a passo com a função de hoje, o aceite do Dr. João nos dois cenários, cura, exceção, reativação, `deixa_de_fazer`, `aplicado: false` sem gravar, consulta futura e primeira consulta nos dois lados, 22023 (inclusive o convênio desativado em uso que tem de passar), CZ409 nos dois lados, as regras 23514, a I1, a carga e a cascata da clínica. 10 sabotagens, cada uma reprovada no assert esperado. Também passou no ensaio conjunto com as duas migrations do CRM (seção 12).

**Aplicada em produção em 02/10/2026**, seguida da correção `20261002150000_cadastro_mudou_sem_retentativa.sql`: a recusa da aba desatualizada saiu do código 40001 (serialization_failure), que o PostgREST repete sozinho e sem limite (cada chamada virava um laço de milhares de repetições segurando a conexão e a trava da clínica), para o código próprio **CZ409**, devolvido na hora (HTTP 400). Corpo, assinatura, grants e comentários das duas funções não mudaram. Nunca levantar 40001 nem 40P01 de propósito numa função chamada pelo PostgREST.

**Ordem:** aplicar depois da `20261002120000` e da `20261002130000`, **antes** do código novo. A migration é compatível com o código publicado (modo legado, parâmetros opcionais): sem ela, o código novo quebra Cadastros (a matriz não tem `.catch`, de propósito), e o `scripts/dev/demo-catalogo.ts` e as fixtures do e2e, que gravam os pares, param no meio.

**Rollback** (cabeçalho da migration): apagar `sincronizar_convenios_do_profissional(uuid, uuid[], uuid[], boolean)` e `sincronizar_vinculos_do_procedimento(uuid, jsonb, uuid[], jsonb, uuid[], boolean)`; rodar de novo o `create`, o `revoke`/`grant` e o `comment` da função de 2 argumentos de `20260929100000_vinculos_do_procedimento.sql`; apagar `procedure_insurance`, `professional_insurance` e `exigir_convenio_da_mesma_clinica()`. Os vínculos criados ou desativados pela cascata ficam como estão (são `service_link` comum).

---

## 14. Investimento da Meta (Fase 4 das métricas, 03/10/2026)

Escopo decidido pelo dono em 29/09/2026 (spec 10.12 e 11.14; backlog, entrada "Métricas do design", Fase 4). Duas migrations, ensaiadas em transação desfeita e **aplicadas em produção em 03/10/2026**, depois da `20261002150000`:

- **A**, `20261003100000_investimento_da_meta.sql`: o token de leitura, o formato da conta, as quatro tabelas, o tipo novo da fila, as quatro funções do job, o gatilho da troca de conta e `motor_manutencao` com o diário.
- **B**, `20261003110000_campanhas_do_periodo.sql`: a proteção da atribuição de anúncio no contato e `campanhas_do_periodo`, que Resultados lê.

Os tipos de `lib/supabase/database.types.ts` (as quatro tabelas, a coluna nova e as cinco funções) foram escritos à mão no formato gerado e precisam ser regenerados depois de aplicar as duas.

### 14.1 O que já existia e não estava neste documento

Registro do que as frentes da Meta de 25/08 a 10/09/2026 criaram (conferido na produção em 03/10/2026):

- **`campaign_link`** (`20260825100000`): a regra de atribuição por texto de cada campanha da clínica (`name`, `token` do link, `channel`, `origin`, `medium`, `campaign`, `default_message`, `keywords`, `active`), único por `(clinic_id, upper(token))`. Membro ativo lê; administrador e gestor gravam. Em 03/10/2026 tem 0 linhas e não tem tela (as actions `salvarCampanhaAction` e `desativarCampanhaAction` existem sem uso); o contato guarda só o texto da campanha (`source_campaign`), não o id da regra.
- **`contact.ctwa_clid`, `source_ad_id`, `source_adset_id`, `source_campaign_id`** (`20260908150000`): os ids do clique no anúncio Click-to-WhatsApp e do anúncio, do conjunto e da campanha na Meta, gravados pela ingestão (service role). O primeiro anúncio vence: o update da ingestão só acontece enquanto `ctwa_clid` **e** `source_ad_id` estão nulos (o segundo filtro entrou na Fase 4). Os `source_*` de nome (`source_channel`, `source_origin`, `source_medium`, `source_campaign`, `source_method`, `source_captured_at`) são a origem, vigiada por `impedir_reatribuicao_de_origem` (depois que `source_channel` tem valor, nenhum deles muda): por texto (código do link, mensagem padrão, palavra-chave, cadastro e importação) e, desde a `20261004100000` (seção 14.9, aplicada em 04/10/2026), também pelo anúncio (`source_method = 'anuncio_ctwa'`, gravado só pela ingestão, num update separado do dos ids). No código da mesma frente (publicado em 04/10/2026), o clique numa publicação (`sourceType` `post`) não grava id nenhum. A `20261005100000` (seção 15, ainda não aplicada) acrescenta a origem pelo clique rastreado no site (`source_method = 'clique_site'`), gravada só por `casar_clique_do_site`.
- **`meta_ads_account`** (`20260910100000` e `20260910120000`): uma linha por clínica, com `pixel_id`, `ad_account_id`, `test_event_code`, `envio_ativado`, `modo_user_data` (nulo até a decisão D6 de LGPD), `send_unmatched` e `whatsapp_business_account_id`. Administrador e gestor leem e gravam (policy `for all`).
- **`meta_ads_account_secret`**: o token da API de conversões (`capi_access_token`). RLS ligada sem policy; só a service role.
- **`conversion_event`** (`20260910110000`): a conversão registrada no movimento do funil (`stage_chave`, `event_name`, `event_id`, `value_cents`, `currency`, `ctwa_clid`, `status`, `sent_at`, `erro`), uma por contato por etapa, enviada pelo job `enviar_conversao_meta` quando o envio for ligado.

### 14.2 O que a migration A muda nas tabelas que existiam

```sql
alter table meta_ads_account_secret add column insights_access_token text
  check (insights_access_token is null or char_length(insights_access_token) between 20 and 500);
-- Token de leitura de anúncios (ads_read), separado do token da CAPI de propósito.
revoke all on meta_ads_account_secret from anon, authenticated;  -- a sessão recebe 42501

alter table meta_ads_account add constraint ad_account_id_formato
  check (ad_account_id is null or ad_account_id ~ '^act_[0-9]{5,20}$');  -- 0 linhas em produção em 03/10
```

A Server Action da conta normaliza antes de gravar (`normalizarContaDeAnuncios`, `lib/domain/meta-anuncios.ts`): aceita só os números, `act_` ou `ACT_` na frente, espaços no meio e o link do Gerenciador de Anúncios com `?act=`. O que não bate com o CHECK é recusado (23514).

### 14.3 As quatro tabelas novas

Todas com `clinic_id not null` e cascata da clínica, RLS ligada e **nenhuma escrita pela sessão**: `anon` sem privilégio; `authenticated` sem `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` e `TRIGGER`. Quem escreve: o job e as Server Actions de Configurações pelo cliente de serviço (depois da guarda de papel) e as funções `SECURITY DEFINER` de 14.4.

```sql
create table meta_gasto_leitura (          -- situação da leitura, uma linha por clínica
  clinic_id uuid primary key references clinic(id) on delete cascade,
  ad_account_id text,                      -- conta dos dados lidos (act_...); só regravar_gasto_meta escreve
  situacao text not null default 'nao_testada'
    check (situacao in ('nao_testada', 'funcionando', 'com_problema')),
  problema text check (problema in (
    'token_invalido', 'sem_permissao', 'conta_sem_acesso', 'exige_prova_do_app',
    'parametro_recusado', 'versao_descontinuada', 'consulta_pesada', 'limite_da_meta',
    'meta_indisponivel', 'resposta_invalida', 'prazo_esgotado', 'outro')),
  codigo_da_meta integer,                  -- error.code da Meta, para o suporte; nunca a mensagem
  nome_da_conta text,                      -- até 200
  moeda text,                              -- ^[A-Z]{3}$
  fuso_da_conta text,                      -- até 64
  conta_ativa boolean,
  testada_em timestamptz,
  lido_desde date, lido_ate date,          -- dias no fuso da CONTA
  sincronizado_em timestamptz,             -- última leitura que deu certo
  tentado_em timestamptz,                  -- última tentativa do job (certa ou não)
  atualizacao_pedida_em timestamptz,       -- último "Atualizar agora"
  ultimo_diario_dia date,                  -- dia no fuso da CLÍNICA em que o diário já enfileirou
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),   -- set_updated_at
  constraint problema_so_com_problema check ((situacao = 'com_problema') = (problema is not null)),
  constraint janela_lida check (lido_desde is null or lido_ate is null or lido_desde <= lido_ate)
);
-- SELECT: user_has_role(clinic_id, array['admin','gestor']).

create table meta_gasto_diario (           -- gasto por anúncio e por dia
  clinic_id uuid not null references clinic(id) on delete cascade,
  ad_account_id text not null,             -- act_...
  dia date not null,                       -- date_start do insights: dia civil no fuso da CONTA
  ad_id text not null, adset_id text, campaign_id text not null,   -- só dígitos, até 32
  campaign_name text,                      -- até 400
  spend_cents bigint not null check (spend_cents >= 0),            -- centésimos da moeda da conta, nunca convertido
  currency text not null,                  -- ^[A-Z]{3}$
  sincronizado_em timestamptz not null default now(),
  primary key (clinic_id, dia, ad_id)
);
-- SELECT: admin e gestor.

create table meta_gasto_conta_diario (     -- total da conta por dia (insights level=account)
  clinic_id uuid not null references clinic(id) on delete cascade,
  ad_account_id text not null, dia date not null,
  spend_cents bigint not null check (spend_cents >= 0), currency text not null,
  sincronizado_em timestamptz not null default now(),
  primary key (clinic_id, dia)
);
-- SELECT: admin e gestor. Cobre anúncio arquivado ou apagado e post impulsionado,
-- que podem sumir do level=ad: é o numerador do custo por lead.

create table meta_anuncio (                -- anúncio -> campanha, SEM dinheiro
  clinic_id uuid not null references clinic(id) on delete cascade,
  ad_id text not null, ad_account_id text not null,
  adset_id text, campaign_id text not null, campaign_name text,
  ultimo_dia_com_entrega date not null,    -- aceita nulo desde 20261004100000, só com origem 'consulta' (14.9)
  atualizado_em timestamptz not null default now(),
  primary key (clinic_id, ad_id)
);
-- SELECT: todo membro ativo (user_active_clinic_ids), para a recepção ver o lead
-- de anúncio na mesma campanha que a gestão vê. Pendente não lê.
-- Desde 20261004100000 (14.9): adset_name, ad_name, origem ('insights' ou
-- 'consulta') e consultado_em; a consulta do anúncio pelo id também grava aqui.
```

**Pausa** não é coluna: é `situacao = 'com_problema'` com `problema` em `token_invalido`, `sem_permissao`, `conta_sem_acesso` ou `exige_prova_do_app` (a mesma lista em `PROBLEMAS_QUE_PAUSAM`, `lib/domain/meta-anuncios.ts`, e nas funções). Sai quando o teste dá certo, quando um token novo é salvo (as actions gravam `nao_testada`) ou quando a conta muda (gatilho de 14.5).

**Por que a situação não mora em `meta_ads_account`:** lá a policy da gestão é `for all`, e um gestor poderia gravar "funcionando" direto pela API.

### 14.4 As funções do job (migration A)

Todas `SECURITY DEFINER`, `search_path` vazio, `execute` revogado de `public`, `anon` e `authenticated` e dado só a `service_role` (neste banco, função nova nasce com `execute` para `anon` e `authenticated`). **Nenhuma devolve o token:** o job lê o segredo pelo cliente de serviço e manda só o sha256 hexadecimal dele (`encode(sha256(convert_to(token, 'UTF8')), 'hex')`; maiúsculas também valem) para conferir se a configuração mudou.

**`enfileirar_sincronizacao_de_gasto_meta(p_clinic_id uuid, p_origem text, p_agora timestamptz default now(), p_incluir_teste boolean default false) returns jsonb`**. Devolve `{ codigo, liberado_em? }`. Conferências, nesta ordem:
- origem fora de `diario`, `manual` e `configuracao`: erro 22023;
- clínica inexistente: `sem_configuracao`; clínica de teste: `clinica_de_teste` (o claim de produção nunca a enxerga, e o job pendente acenderia `fila_atrasada`); `p_incluir_teste` existe só para os testes de integração;
- sem `ad_account_id` ou sem `insights_access_token`: `sem_configuracao`;
- cria a linha de leitura se faltar e a trava (`for update`), o que serializa cliques simultâneos e o diário;
- pausada: `pausada`, menos na origem `configuracao` (o teste que deu certo);
- origem `manual` com `atualizacao_pedida_em` há menos de 10 minutos: `aguarde`, com `liberado_em = atualizacao_pedida_em + 10 min`; senão grava `atualizacao_pedida_em = p_agora`;
- insere o job (`max_attempts` 5, `payload {origem}`, `run_at = now()` real) com `on conflict ... do nothing` no índice parcial: `enfileirado` ou `ja_na_fila`;
- origem `diario`: grava `ultimo_diario_dia` (dia local da clínica) nos dois casos.
Quem insere direto na fila (sem a função) trata 23505 como "já na fila": o PostgREST não usa índice parcial em `on_conflict`.

**`enfileirar_gasto_meta_do_dia(p_agora timestamptz default now(), p_limite integer default 3, p_clinic_ids uuid[] default null, p_incluir_teste boolean default false) returns integer`** (o diário). Elegível: não é de teste, tem conta e token, situação diferente de `nao_testada` (o diário só roda depois do primeiro teste), fora da pausa, já passou das 06:00 no fuso da clínica e ainda sem diário no dia local. Ordem `ultimo_diario_dia nulls first, id`; para em `p_limite` clínicas atendidas (enfileirado ou já na fila) e devolve quantas foram. Cada clínica num bloco próprio: fuso inválido ou falha vira `raise warning` e não derruba as outras. `p_clinic_ids` e `p_incluir_teste` só para os testes (clínica de teste só entra com os dois). `motor_manutencao` chama sem argumentos.

**`regravar_gasto_meta(p_job_id uuid, p_worker text, p_clinic_id uuid, p_ad_account_id text, p_token_sha256 text, p_desde date, p_ate date, p_moeda text, p_fuso text, p_nome_da_conta text, p_conta_ativa boolean, p_por_anuncio jsonb, p_da_conta jsonb) returns text`**: `ok`, `sem_posse`, `config_mudou` ou `janela_invalida`. Numa transação só:
1. **posse:** o job com esse id, clínica e tipo está `executando` com `locked_by = p_worker` (trava a linha do job); senão `sem_posse` e nada é gravado;
2. **configuração:** trava conta e segredo em modo compartilhado (a troca de conta espera esta gravação); conta salva diferente de `p_ad_account_id`, token nulo ou sha256 diferente: `config_mudou`;
3. **janela:** `p_desde` e `p_ate` no fuso da conta, inclusivos, de 1 a 92 dias; senão `janela_invalida`;
4. apaga as linhas de **outra conta** nas três tabelas de dados (é assim que a conta antiga some);
5. apaga a janela e insere as linhas novas. Formato: `p_por_anuncio = [{dia, ad_id, adset_id|null, campaign_id, campaign_name|null, spend_cents}]` e `p_da_conta = [{dia, spend_cents}]`; linha fora da janela é ignorada; `(dia, ad_id)` repetido dá 23505 (o job deduplica antes); valor que não é array dá 22023; a moeda de todas as linhas é `p_moeda`;
6. upsert de `meta_anuncio`, com o nome do dia mais recente e o maior `ultimo_dia_com_entrega`;
7. a leitura vira `funcionando`, sem problema nem código, com `ad_account_id`, nome (vazio vira nulo), moeda, fuso, `conta_ativa`, `sincronizado_em = tentado_em = now()`. `lido_desde` recomeça em `p_desde` na primeira leitura, com conta nova ou quando a janela nova não encosta na anterior (`p_desde > lido_ate + 1`); senão fica o menor. `lido_ate` fica o maior. Não mexe em `testada_em`.

**`registrar_falha_do_gasto_meta(p_job_id uuid, p_worker text, p_clinic_id uuid, p_ad_account_id text, p_token_sha256 text, p_problema text, p_codigo integer default null) returns text`**: `ok`, `sem_posse` ou `config_mudou`, com a mesma posse e a mesma conferência da regravação (um job que leu com o token velho não pausa a clínica que acabou de salvar um token novo). Problema fora dos 12 códigos: 22023. Grava `com_problema`, o problema, `codigo_da_meta` e `tentado_em`; preserva `lido_*` e `sincronizado_em` (o investimento já lido continua valendo). Desde a `20261004100000` (14.9), a posse aceita também o job `resolver_anuncio_meta`: o token ou a conta recusados na consulta dos anúncios pausam a leitura igual ao gasto.

### 14.5 Gatilhos

- **`reiniciar_leitura_do_gasto_meta`** em `meta_ads_account` (`SECURITY DEFINER`, `execute` revogado): `after update of ad_account_id` quando ele muda, e `after insert or delete` (apagar a conta e criar de novo pela API também é troca de conta). Volta a leitura para `nao_testada` e limpa `problema` e `codigo_da_meta`; não mexe em `lido_*`, `sincronizado_em`, no `ad_account_id` da leitura nem nos dados. Erro vira `raise warning` e nunca bloqueia a gravação da conta. O gasto da conta antiga continua em Resultados até a primeira regravação da conta nova, que o apaga.
- **`proteger_atribuicao_de_anuncio`** em `contact` (migration B; `before insert or update of ctwa_clid, source_ad_id, source_adset_id, source_campaign_id`): com sessão (`auth.uid()` não nulo), o INSERT zera e o UPDATE preserva os quatro ids, sem erro. A service role (a ingestão) continua livre. Antes, administrador, gestor e recepção podiam reescrever esses ids pela API e mover o lead de campanha. Nenhum código da sessão grava esses campos (conferido em 03/10). A regra "o primeiro anúncio vence" é da ingestão (14.1), não do gatilho. Desde a `20261004100000` (14.9), o gatilho também vigia `source_method`: a sessão que grava `anuncio_ctwa` recebe 42501. A `20261005100000` (seção 15, ainda não aplicada) acrescenta os blocos do clique do site e as duas colunas do Google.

### 14.6 `motor_manutencao`

Recriada a partir do corpo de **produção** (`pg_get_functiondef` em 03/10/2026; a última definição em arquivo é a `20261002130000`), com o que é novo entre os marcadores `-- [gasto meta]`: chama `enfileirar_gasto_meta_do_dia()` num bloco protegido, devolve também `"gasto_meta": int` (clínicas atendidas na passagem) e um erro estrutural vira `gasto_meta:<sqlstate>` em `planner_erro` (o monitor responde `planner_com_erro`). Fora dos marcadores, idêntica (o ensaio compara); grants mantidos (`postgres` e `service_role`). Frente nova que recriar `motor_manutencao` tem de partir do corpo de produção do momento: a `20261005100000` (seção 15, ainda não aplicada) parte deste e acrescenta o bloco `-- [clique do site]`; depois que ela for aplicada, a F2 do Google parte do `pg_get_functiondef` com esse bloco.

### 14.7 `campanhas_do_periodo` (migration B)

**`campanhas_do_periodo(p_clinic_id uuid, p_de timestamptz, p_ate timestamptz, p_de_anterior timestamptz default null) returns jsonb`**: a tabela Campanhas, o custo por lead e o detalhe por campanha de Resultados. `SECURITY INVOKER` (a RLS recorta clínica e papel), `execute` revogado de `public` e `anon` e dado a `authenticated` e `service_role`. **Nulo para o profissional** (como `funil_do_periodo`; a página nem chama a função para ele).

- Formato `{ atual: Bloco, anterior?: Bloco }`, com `anterior` só quando `p_de_anterior` vem (janela `[p_de_anterior, p_de)`).
- `Bloco = { leads, leads_de_anuncio, leads_casados, leads_de_anuncio_sem_campanha, leads_sem_campanha, linhas, investimento }`.
- **Lead** entra pela chegada (`first_contact_at` em `[p_de, p_ate)`), o critério de "Leads recebidos" do funil. **Lead de anúncio** tem `ctwa_clid`, `source_ad_id` ou `source_campaign_id`.
- **Casamento só por id, nunca por nome:** primeiro `source_ad_id` em `meta_anuncio`; senão `source_campaign_id`, se for campanha conhecida em `meta_anuncio`.
- Cada lead cai numa linha só: `meta` (casado), `texto` (só tem `source_campaign` digitado ou importado: conta lead, nunca casa com gasto) ou `leads_sem_campanha`. **Invariante:** soma dos leads das linhas + `leads_sem_campanha` = `leads` = leads do `funil_do_periodo`.
- `Linha = { chave ('meta:<campaign_id>' ou 'texto:<rótulo>'), tipo, meta_campaign_id, rotulo, leads, agendaram, compareceram, investimento_cents }`. `rotulo` da linha meta é o nome mais recente da campanha e pode ser nulo (a tela mostra "Campanha {id}"); desde a `20261004100000` (14.9) a escolha é por `ultimo_dia_com_entrega desc nulls last`, então a linha que só veio da consulta por id (sem dia de entrega) fica por último. `agendaram` = tem alguma consulta; `compareceram` = tem consulta com `compareceu`. Linha meta com 0 lead só aparece para a gestão, quando a campanha teve gasto em real no período. Linha texto tem sempre `investimento_cents` nulo. Ordem: meta antes de texto, maior investimento, mais leads, chave.
- **As contagens de leads são as mesmas em todos os papéis:** dependem só de `contact`, `appointment` e `meta_anuncio`, que todo membro ativo lê.
- **`investimento`** é nulo fora de administrador, gestor e service role (`auth.uid() is null or user_has_role(...)`, o padrão da seção 11), e fora da gestão o `investimento_cents` das linhas também. Para a gestão: `{ configurada, situacao, problema, moeda, fuso_da_conta, lido_desde, lido_ate, sincronizado_em, dia_de, dia_ate, investimento_cents, investimento_casado_cents, investimento_sem_lead_cents, campanhas_sem_lead, outra_moeda }`.
  - `configurada` = conta salva **e** linha de leitura existente (a sessão não lê o token). Remover o token não apaga a linha de leitura, então a leitura continua "configurada" e o investimento já lido continua aparecendo, até a leitura ficar atrasada (Resultados, abaixo).
  - `dia_de` e `dia_ate` são os dias civis da clínica tocados pela janela; o dia do gasto é o rótulo do dia da conta, sem conversão por hora.
  - `investimento_cents` é o **total da conta** em real (`meta_gasto_conta_diario`) entre `dia_de` e `dia_ate`; `investimento_casado_cents` e `investimento_sem_lead_cents` são somas por campanha (`meta_gasto_diario`), das campanhas com e sem lead no período.
  - Só linhas em `BRL` entram nas somas; havendo linha em outra moeda no período, `outra_moeda = true`. Nunca converte.
- O que a função **não** decide, de propósito (fica no TypeScript, `lib/domain/custo-por-lead.ts`): o divisor do custo por lead (`DIVISOR_DO_CUSTO_POR_LEAD = 'leads_de_anuncio'`, decisão D2, mantida pelo dono em 04/10/2026; as três contagens vêm prontas), a cobertura (o período é medido só se `lido_desde <= dia_de` e se `lido_ate` não está mais de `DIAS_DE_FOLGA_DA_LEITURA` = 2 dias antes do menor entre `dia_ate` e hoje) e o aviso de fuso.
- **Fora de propósito na Fase 4:** o caminho do lead de link (`campaign_link.meta_campaign_id` e o id da regra no contato, decisão D1) e a origem gravada do lead de anúncio (`source_channel` Tráfego pago e um `source_method` novo, decisão D3). Respostas do dono em 04/10/2026: a D1 **não** será construída (não haverá cadastro manual de campanhas; `campaign_link` fica como está e o lead de link continua na linha `texto`, sem investimento); a D3 foi construída na seção 14.9, sem mudar o SQL desta função além do `nulls last`.

### 14.8 Ensaio, ordem de publicação e rollback

**Ensaio (03/10/2026):** as duas migrations em transação desfeita, com asserts de RLS por papel e isolamento A contra B nas quatro tabelas e no segredo; ninguém escreve pela sessão; 42501 nas funções para `anon` e `authenticated`; os CHECKs; deduplicação (23505 e `ja_na_fila`); `aguarde` de 10 minutos; `clinica_de_teste`; pausa; o diário às 06:00 no fuso da clínica (Fortaleza e Tóquio), o limite e o fuso inválido isolado; a regravação (troca só a janela, apaga a conta antiga, `sem_posse`, `config_mudou` pelo sha256, `janela_invalida`, buraco de leitura, teto de 92 dias); o registro de falha; o gatilho da conta; a proteção da atribuição; `campanhas_do_periodo` (a invariante de soma contra o funil, 23h30 do último dia, outra moeda, cobertura parcial, Tóquio e todos os papéis); e `motor_manutencao` comparada com a de produção. 41 sabotagens, uma por bloco crítico, todas pegas. Os asserts das levas anteriores (CRM e convênio) passaram de novo depois destas migrations.

**Ordem:** aplicar a A e depois a B, **junto com o código** da Fase 4. A migration A troca o CHECK de `job_queue` (`alter table`, trava exclusiva por instantes): no ensaio, uma de 47 rodadas bateu num deadlock com o motor de produção, que roda a cada 20 s (o Postgres abortou o ensaio e o motor seguiu normal). Aplicar num horário calmo, com `lock_timeout` curto, e repetir se der timeout. Depois rodar as provas de RLS, integração e e2e, regenerar os tipos (o diff tem de sumir) e publicar.
- Sem as migrations, o código novo mostra o erro da aba Anúncios da Meta (a página lê `meta_gasto_leitura` e o token de leitura) e, em Resultados, o erro só no Custo por lead e em Campanhas, com "Tentar de novo" (o Exportar das abas Visão geral e Marketing fica desabilitado).
- Com as migrations e o código antigo, o Salvar da conta sem `act_` é recusado pelo CHECK (23514; há 0 contas em produção) e o segredo dá 42501 para a sessão (o código antigo já o lia só pelo cliente de serviço).

**Rollback** (cabeçalhos das migrations): B, `drop function campanhas_do_periodo`, `drop trigger proteger_atribuicao_de_anuncio on contact` e `drop function proteger_atribuicao_de_anuncio`. A, nesta ordem: cancelar os jobs `sincronizar_gasto_meta`; apagar as quatro tabelas e as quatro funções, o gatilho e a função `reiniciar_leitura_do_gasto_meta` e o índice `job_queue_gasto_meta_vivo`; recriar `job_queue_kind_check` sem o tipo novo; apagar `ad_account_id_formato` e a coluna `insights_access_token`; reaplicar `motor_manutencao` da `20261002130000`. Devolver os grants de `meta_ads_account_secret` à sessão não é recomendado.

### 14.9 Origem real do lead de anúncio (04/10/2026, migration `20261004100000_origem_real_do_anuncio.sql`)

Pedido do dono em 04/10/2026 ("tire realmente da Meta ou do Google; no uazapi ele sabe a origem e campanha") e decisão D3 (backlog, entrada "Origem real do lead de anúncio"). Ensaiada em transação desfeita contra a produção e **aplicada na produção em 04/10/2026** (sha256 `889e897b40796fb733a4f38484f5a127234eb025969b203734a9f209f8a290e5`; conferido por SELECT em `supabase_migrations.schema_migrations`, e os 8 contatos com clique estão com `anuncio_ctwa`). Pressupõe as duas migrations da Fase 4 e não edita nenhuma delas. Os tipos de `lib/supabase/database.types.ts` (as colunas novas de `meta_anuncio`, a tabela `meta_anuncio_recusado` e as três funções novas) foram escritos à mão no formato gerado e precisam ser regenerados depois de aplicar.

**Os fatos que moldam o desenho** (conferidos em 04/10/2026): o canal do WhatsApp (uazapi) entrega o clique (`ctwa_clid`) e o id do anúncio, nunca o conjunto nem a campanha; a campanha só sai da Meta, pelo id do anúncio; e a leitura diária da Fase 4 (`act_X/insights?level=ad`) não devolve anúncio arquivado nem apagado, nem anúncio sem entrega na janela lida. Por isso existe a consulta do anúncio pelo id.

**`contact`**
- `contact_source_method_valido` aceita `anuncio_ctwa`.
- CHECK novo **`contact_origem_de_anuncio_coerente`** (23514): com `source_method = 'anuncio_ctwa'`, exige `source_channel = 'trafego_pago'`, `source_origin = 'Meta'`, `source_medium` nulo, `Facebook` ou `Instagram`, e **`source_campaign` nulo** (comparações com `is not distinct from`, porque um CHECK com NULL passaria). É a D3 garantida pelo banco: a origem é imutável, então o banco recusa em vez de gravar errado para sempre.
- `proteger_atribuicao_de_anuncio` passa a vigiar `source_method`: a sessão que insere `anuncio_ctwa`, ou muda para ele num UPDATE, recebe 42501 ("A origem de anúncio é registrada só pelo sistema."); reenviar o valor já gravado passa. Os ids do anúncio seguem como na Fase 4 (14.5).
- **Quem grava:** só a ingestão (service role), num update **separado** do dos ids, com `.is('source_channel', null)`, `.is('source_method', null)` e `.is('source_campaign', null)`: canal `trafego_pago`, origem `Meta`, meio = plataforma ou nulo, método `anuncio_ctwa` e `source_captured_at` = hora da ingestão. Nunca grava `source_campaign`. Depois de gravada, qualquer mudança na origem dá P0001 (`impedir_reatribuicao_de_origem`). O banco aceitaria sobrescrever um método `importacao` com canal nulo; o filtro de `source_method` da ingestão e o da correção abaixo são mais estritos de propósito.
- **Regra da ingestão** (`origemDoAnuncio`, `lib/integrations/whatsapp/ingest.ts`): `sourceType` `post` nunca grava (nem origem, nem ids, nem o clique); `ad` sempre; sem tipo, só com `ctwa_clid`. Id de anúncio sem clique e sem tipo grava o id (como na Fase 4), mas não a origem. A plataforma vem do `sourceApp` do referral ou, na falta, do `entryPointConversionApp` do contexto; valor fora de `facebook` e `instagram` vira nulo, e a plataforma nunca é deduzida pela URL. A origem é tentada em toda mensagem de anúncio enquanto estiver vazia; o log de diagnóstico `anuncio_recebido` (só nomes de chave, tipo e se a plataforma foi reconhecida) e o pedido de consulta (`enfileirar_resolucao_de_anuncios_meta`, origem `ingestao`) acontecem só no primeiro clique que gravou os ids. A captura do anúncio roda antes da atribuição por texto: o anúncio vence o código do link, a mensagem padrão e a palavra-chave.

**`meta_anuncio`**
- `ultimo_dia_com_entrega` aceita nulo, só na linha com `origem = 'consulta'` (CHECK `meta_anuncio_sem_entrega_so_da_consulta`); linha de consulta sempre tem `consultado_em` (CHECK `meta_anuncio_consulta_tem_hora`).
- Colunas novas: `adset_name` e `ad_name` (até 400 caracteres), `origem` (`insights` ou `consulta`, padrão `insights`: quem **criou** a linha, nunca muda) e `consultado_em` (última consulta pelo id; nulo = nunca consultado).
- RLS igual à da Fase 4: todo membro ativo lê a própria clínica e ninguém escreve pela sessão.
- **A campanha e o conjunto do lead** saem da linha com `ad_id = contact.source_ad_id`, de qualquer origem (o dia pode ser nulo): campanha = `campaign_name` (sem nome, "Campanha {id}"), conjunto = `adset_name`. Telas em `lib/domain/leads-ui.ts` e `lib/queries/leads.ts`.
- **Troca de conta:** `regravar_gasto_meta` continua apagando as linhas de outra conta (14.4, passo 4), inclusive as que vieram da consulta. Os leads antigos perdem o nome da campanha e voltam a ficar pendentes; consultado com a conta nova, o anúncio da conta antiga vira recusa (`outra_conta` quando a Meta ainda o mostra ao token, senão `inacessivel`) e não volta ao mapa. É a regra "uma conta por clínica" da Fase 4.

**`meta_anuncio_recusado`** (tabela nova, só o sistema): `clinic_id`, `ad_id` (`^[0-9]{1,32}$`), PK nos dois; `motivo` (`sem_entrega_ainda`, `inacessivel`, `outra_conta` ou `resposta_invalida`); `codigo_da_meta` (o código numérico da Meta, nunca a mensagem); `ad_account_id` (`act_`) e `token_sha256` (hexadecimal de 64) do momento da recusa; `tentativas`, `primeira_recusa_em`, `recusado_em` e `tentar_de_novo_em` (nulo = só com outra conta ou outro token; CHECK: só `sem_entrega_ainda` e `resposta_invalida` têm nova tentativa). RLS ligada, nenhuma policy e nenhum grant para `anon` e `authenticated`: toda sessão recebe 42501. **A recusa vale só para a mesma conta e o mesmo sha256 do token**: trocar um dos dois libera nova tentativa sem mexer na tela.

**Novas tentativas** (calculadas por `gravar_resolucao_de_anuncios_meta`; contadas só com a mesma conta, o mesmo sha256 e o mesmo motivo, senão recomeçam em 1): `sem_entrega_ainda` depois de 1 h, 6 h e 24 h, depois a cada 24 h até 7 dias da primeira recusa, depois nunca mais (nulo); `resposta_invalida` a cada 24 h; `inacessivel` e `outra_conta` só com outra conta ou outro token.

**`job_queue`:** tipo `resolver_anuncio_meta`, `payload {origem}`, `max_attempts` 5, e o índice único parcial `job_queue_resolver_anuncio_meta_vivo` (um job vivo por clínica; insert direto duplicado dá 23505).

**Anúncio pendente:** `source_ad_id` numérico de contato da clínica sem linha em `meta_anuncio`, **ou com linha nunca consultada pelo id** (linha só do insights, que não traz o nome do conjunto), e sem recusa válida (mesma conta, mesmo sha256 e nova tentativa no futuro ou nula). Não existe tabela de "anúncio visto": o que está pendente vive nos contatos, não no job.

**As três funções novas** (todas `SECURITY DEFINER`, `search_path` vazio, `execute` revogado de `public`, `anon` e `authenticated` e dado só à `service_role`; nenhuma devolve o token, todas comparam o sha256 hexadecimal, maiúsculas também valem):
- **`anuncios_meta_a_resolver(p_clinic_id uuid, p_ad_account_id text, p_token_sha256 text, p_limite integer default 20, p_agora timestamptz default now()) returns jsonb`**, só leitura: `{codigo: 'config_mudou'}` quando a conta salva ou o sha256 do token salvo são outros; senão `{codigo: 'ok', ad_ids, restantes, proxima_tentativa_em}`. `p_limite` fica entre 1 e 50. Ordem: os nunca recusados (ou recusados com outra conta ou outro token) primeiro, depois as novas tentativas vencidas; dentro de cada grupo, o contato mais recente primeiro. `proxima_tentativa_em` é a menor nova tentativa ainda no futuro.
- **`enfileirar_resolucao_de_anuncios_meta(p_clinic_id uuid, p_origem text, p_run_at timestamptz default null, p_incluir_teste boolean default false) returns jsonb`**. Origem em `ingestao`, `gasto` ou `teste`; fora disso, 22023. Devolve `{codigo}`: `enfileirado` (com `run_at` = o maior entre `p_run_at` e agora, se há anúncio devido, ou a próxima nova tentativa), `ja_na_fila` (puxa o job pendente para mais cedo, nunca empurra), `sem_configuracao` (clínica inexistente, sem conta ou sem token de leitura), `pausada` (a leitura do gasto está `com_problema` com `token_invalido`, `sem_permissao`, `conta_sem_acesso` ou `exige_prova_do_app`; a origem `teste` ignora a pausa, e `nao_testada` não pausa), `nada_a_resolver` ou `clinica_de_teste` (salvo com `p_incluir_teste`, que só os testes de integração passam).
- **`gravar_resolucao_de_anuncios_meta(p_job_id uuid, p_worker text, p_clinic_id uuid, p_ad_account_id text, p_token_sha256 text, p_resolvidos jsonb, p_recusas jsonb) returns text`**: `ok`, `sem_posse` (exige job `resolver_anuncio_meta` executando com `locked_by = p_worker` e da mesma clínica) ou `config_mudou` (nada é gravado). Formato: `p_resolvidos = [{ad_id, ad_account_id ('act_N' ou só os dígitos), campaign_id (numérico, obrigatório), campaign_name|null, adset_id (numérico)|null, adset_name|null, ad_name|null}]` e `p_recusas = [{ad_id, motivo, codigo: inteiro|null}]`; id inválido, motivo fora da lista, código não inteiro, item que não é objeto ou lista que não é array dão 22023; listas nulas valem como vazias. Resolvido de outra conta vira recusa `outra_conta` e **não** entra no mapa; sem campanha válida, ou com conta ilegível, vira `resposta_invalida`; resolvido da conta salva faz upsert com `origem = 'consulta'` (na linha nova), `consultado_em = now()` e nomes por `coalesce` (nunca apaga nome); o resolvido perde a recusa e vence uma recusa do mesmo anúncio na mesma chamada.

**Funções recriadas** (mesma assinatura e mesmo retorno; corpo de **produção**, conferido por `pg_get_functiondef` no ensaio, com o que é novo entre os marcadores `[origem real]` ou numa única linha trocada; grants mantidos):
- `proteger_atribuicao_de_anuncio` e o gatilho (agora também `update of source_method`), acima;
- `regravar_gasto_meta`: a linha com dia nulo (só da consulta) recebe o nome e o dia do insights; não mexe em `adset_name`, `ad_name`, `origem` nem `consultado_em`;
- `registrar_falha_do_gasto_meta`: a posse aceita também o job `resolver_anuncio_meta` (14.4);
- `campanhas_do_periodo`: nome da campanha por `ultimo_dia_com_entrega desc nulls last` (14.7).

**Correção dos contatos que já existiam** (bloco `DO` no fim da migration, entre os marcadores `[correcao dos contatos de anuncio]`): UPDATE idempotente, por condição e sem id fixo, que só roda sem sessão de usuário (com sessão, levanta exceção). Pega só o contato com `ctwa_clid` e **todos** os campos de origem nulos (canal, método, origem, meio, campanha e `source_captured_at`), e grava `trafego_pago`, `Meta`, meio nulo, `anuncio_ctwa` e `source_captured_at = first_contact_at`. Id de anúncio ou de campanha sem clique fica de fora, porque pode ser publicação gravada pela ingestão anterior a esta frente. Em 04/10/2026 (SELECT na produção): 8 contatos com clique, todos de uma clínica e todos com a origem vazia, e nenhum com id de anúncio sem clique. **Não rodar o bloco de novo depois de aplicado**: um contato antigo que clicasse num anúncio no intervalo ganharia como hora de captura a do primeiro contato, falsa e permanente (backlog, ordem de publicação).

**Códigos de erro:** só 42501, 22023, 23514, 23505 e P0001. 40001 e 40P01 nunca são levantados de propósito.

**Ensaio (04/10/2026):** em transação desfeita contra a produção: retrato da produção, a migration, asserts sobre os dados reais (a correção pega exatamente os 8 contatos e nenhum outro, e o ensaio para se aparecer contato com id de anúncio sem clique), os asserts da Fase 4 adaptados, a correção rodada duas vezes (a segunda não muda nada, nem o `updated_at`) e os asserts da origem real: os CHECKs, o 42501 da sessão ao gravar `anuncio_ctwa` ou ids, as colunas novas, isolamento A contra B nas colunas novas, `meta_anuncio_recusado` ilegível para sessão e `anon`, grants revogados e `search_path` vazio, um job vivo por clínica, todos os códigos do enfileirar, a lista de pendentes, a gravação (`ok`, `sem_posse`, `config_mudou`, `outra_conta` fora do mapa, novas tentativas, troca de token), a regravação com dia nulo, o `nulls last` e a cascata ao apagar a clínica. As funções recriadas foram comparadas com as de produção. 43 sabotagens, uma ou mais por bloco crítico, todas pegas.

**Ordem de publicação:** publicada em 04/10/2026 (migration aplicada e o código no commit `65a6c85`). O que se pesou antes (backlog, entrada "Origem real do lead de anúncio"): a correção roda uma vez só; com o código novo e sem a migration, a gravação da origem falha com 23514 (só log), o lead fica com os ids e a correção o pega depois, as telas mostram "Não foi possível carregar a campanha" nos leads de anúncio e os pedidos de consulta só deixam log; com a migration e o código antigo, o lead de anúncio que chegar fica sem origem e só uma correção filtrada pela hora da aplicação o recupera. Antes de aplicar, conferir por SELECT que o alvo da correção continua sendo só contato com clique. Depois de aplicar: rodar as provas de RLS e integração escritas para esta frente e regenerar os tipos.

**Rollback** (cabeçalho da migration, manual): cancelar os jobs `resolver_anuncio_meta`; apagar as três funções novas, a tabela `meta_anuncio_recusado` e o índice `job_queue_resolver_anuncio_meta_vivo`; recriar `job_queue_kind_check` sem o tipo novo; reaplicar `proteger_atribuicao_de_anuncio` (e o gatilho) e `campanhas_do_periodo` da `20261003110000`, `regravar_gasto_meta` e `registrar_falha_do_gasto_meta` da `20261003100000`; apagar de `meta_anuncio` as linhas com origem `consulta` e dia nulo, depois as colunas novas, e voltar o NOT NULL. **A origem gravada nos contatos não volta**: `impedir_reatribuicao_de_origem` a preserva para sempre.

---

## 15. Clique rastreado pelo site (F1 do Google, 04/10/2026, migration `20261005100000_clique_do_site.sql`)

Pedido do dono em 04/10/2026: o anúncio do Google leva ao **site** da clínica, e a origem e a campanha do lead vêm do Google, sem cadastro manual (backlog, entrada "Origem e campanha do Google Ads", F1; spec 10.13 e 11.15; arquitetura no `docs/03`, seção 13). Ensaiada em transação desfeita contra a produção e **ainda não aplicada** em 04/10/2026 (sha256 `9e1cb85bc706ddf70d549aeb8aac2005e30aa5a90a13d00d81effe4a758734f9`). Tudo que ela recria parte do `pg_get_functiondef` e do `pg_get_constraintdef` de produção de 04/10/2026, já depois da `20261004100000`. Os tipos de `lib/supabase/database.types.ts` (as duas colunas de `contact`, as duas tabelas e as cinco funções) foram escritos à mão no formato gerado e precisam ser regenerados depois de aplicar.

### 15.1 Decisões registradas

- **Validade do código: 7 dias.** `valido_ate` nasce como `now() + 7 dias`, e o CHECK `clique_do_site_validade` não deixa passar disso. Depois de 7 dias o código não grava origem (`expirado`).
- **Retenção do gclid: 90 dias.** No clique casado, `gclid`, `gbraid` e `wbraid` são zerados 90 dias depois do **clique** (`criado_em`), e a linha fica (campanha, grupo e o vínculo com o contato). 90 dias é o alcance do `click_view` do Google, o que serve à F2 e a uma futura devolução de conversão pelo gclid (G3, que depende da D6). O clique **não casado** é apagado 1 dia depois de vencer, isto é, 8 dias depois do clique.
- **De quem é a decisão:** as duas regras acima são a recomendação da crítica de 04/10/2026 e foram construídas assim. **O dono ainda não as confirmou** (pergunta aberta no backlog, entrada "Origem e campanha do Google Ads"). Mudar é trocar o intervalo em `podar_cliques_do_site` e o default e o CHECK de `valido_ate`.
- **Código único por clínica em qualquer estado** (`clique_do_site_codigo_unico`, sem filtro): um código casado nunca volta a casar nem a ser registrado. Desvio consciente do contrato da crítica, que pedia índice único só enquanto não casado.
- **As colunas de anúncio não se misturam:** o Google nunca grava `ctwa_clid`, `source_ad_id`, `source_adset_id` nem `source_campaign_id` (o divisor do custo por lead da Meta não incha), e os ids do Google só existem com o método `clique_site`.
- **Origem sem meio:** a origem do Google nasce com `source_medium` nulo (não separa Pesquisa, YouTube ou Display). Como a origem é imutável, separar depois só valeria para leads novos (ponto para o dono).
- **Na dúvida, origem vazia:** contato que já tem origem, campanha em texto ou sinal de anúncio da Meta só ganha o vínculo com o clique. Origem vazia se preenche depois; errada nunca se desfaz.
- **Sem IP, sem user agent, sem caminho da página** (o caminho pode revelar interesse de saúde). Do site, só o host, tirado do cabeçalho `Origin`.

### 15.2 `contact`

```sql
alter table contact
  add column source_google_campaign_id text,   -- só dígitos, até 20
  add column source_google_adgroup_id text;    -- só dígitos, até 20
-- contact_source_method_valido: os 6 de produção (link_token, mensagem_padrao,
--   palavra_chave, manual, importacao, anuncio_ctwa) mais clique_site
-- contact_ids_do_google_validos: ^[0-9]{1,20}$ nas duas colunas
-- contact_origem_do_clique_do_site_coerente: com clique_site, canal
--   trafego_pago, origem 'Google', source_medium e source_campaign nulos
--   (comparações com is not distinct from); e os ids do Google só existem
--   com source_method = 'clique_site'
```

- **Leitura:** todo membro ativo lê as duas colunas pela RLS de `contact` (o número da campanha aparece no lead para todo papel).
- **`proteger_atribuicao_de_anuncio`** (recriado a partir do corpo de produção, o da `20261004100000`), com dois blocos `-- [clique do site]`: (1) com sessão, gravar `clique_site` no INSERT ou mudar para ele no UPDATE, ou gravar ou mudar os ids do Google, dá 42501; reenviar o valor que já estava gravado passa. (2) Num contato com origem `clique_site`, ninguém troca os ids do Google, nem o sistema: P0001 com a mesma mensagem do `impedir_reatribuicao_de_origem` ("A origem do contato é capturada uma vez e preservada para sempre."), porque aquele gatilho não vigia estas colunas. O gatilho passa a disparar também em `update of source_google_campaign_id, source_google_adgroup_id`. `impedir_reatribuicao_de_origem` e `campanhas_do_periodo` não foram tocados.
- **Quem grava:** só `casar_clique_do_site` (15.5). A ingestão nunca grava `clique_site`, `Google` nem os ids.

### 15.3 `rastreio_do_site` (a chave do site de cada clínica)

| Coluna | Tipo | Regra |
|---|---|---|
| `clinic_id` | uuid | PK, FK `clinic` com cascade |
| `chave` | text not null | única, `^[0-9a-f]{20}$` (80 bits de `gen_random_uuid`), nasce no banco |
| `ativo` | boolean not null | padrão `false` |
| `chave_trocada_em` | timestamptz not null | padrão `now()`: quando a chave atual nasceu |
| `ultimo_clique_em` | timestamptz | gravado por `registrar_clique_do_site` só quando o resultado é `ok` |

- A chave vai no HTML do site: é **pública**, não é segredo. Serve só para achar a clínica sem expor o slug nem o código de cadastro, e troca quando a clínica quiser.
- **RLS:** administrador e gestor ativos leem (`user_has_role(clinic_id, ['admin','gestor'])`); criam e ligam ou desligam com `user_has_role` mais `user_can_write`. Recepção, leitura, profissional, pendente e outra clínica veem nada.
- **Grants por coluna:** `select` para `authenticated`; `insert (clinic_id, ativo)`; `update (ativo)`; sem `delete`; nada para `anon`. Gravar a chave, as datas ou o `clinic_id` dá 42501. **Nunca upsert pelo PostgREST:** o `ON CONFLICT DO UPDATE` grava `clinic_id`, que não tem grant de update (42501); a Server Action faz update e, sem linha, insert, e refaz o update num 23505.

### 15.4 `clique_do_site` (só o sistema)

| Coluna | Regra |
|---|---|
| `id` | uuid, PK |
| `clinic_id` | not null, FK `clinic` com cascade |
| `codigo` | not null, `^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$` (o alfabeto e o tamanho de `attribution.ts`, em maiúsculas); único por clínica em qualquer estado |
| `criado_em`, `valido_ate` | `valido_ate` padrão `now() + 7 dias`; CHECK `valido_ate > criado_em` e `<= criado_em + 7 dias` |
| `gclid`, `gbraid`, `wbraid` | `^[A-Za-z0-9._~+/=-]+$`, até 512 caracteres (o Google não publica o máximo); zerados 90 dias depois do clique, se casado |
| `gad_source` | `^[A-Za-z0-9_-]{1,32}$` |
| `google_campaign_id`, `google_adgroup_id` | `^[0-9]{1,20}$` |
| `site_host` | `^[a-z0-9.-]{1,253}$`, só o host |
| `contact_id`, `casado_em` | FK `contact` com cascade (apagar o contato, LGPD, leva o clique); CHECK: os dois nulos ou os dois preenchidos |

- CHECK `clique_do_site_tem_sinal_do_google`: ao nascer, pelo menos um de gclid, gbraid, wbraid, gad_source, campanha ou grupo (o casado fica livre, porque a poda zera os identificadores).
- **RLS ligada, nenhuma policy e `revoke all` de `anon` e `authenticated`:** a sessão recebe 42501 até no `select`. Nenhum humano vê gclid, então não há leitura a auditar.
- Índices parciais: `clique_do_site_por_hora (clinic_id, criado_em)` (limite por minuto e totais de 7 dias), `clique_do_site_vivos (clinic_id, valido_ate) where contact_id is null` (teto de vivos), `clique_do_site_vencidos (valido_ate) where contact_id is null` (poda), `clique_do_site_ids_a_zerar (criado_em)` nos casados com identificador (poda de 90 dias) e `clique_do_site_contato (contact_id)` (cascata).

### 15.5 As cinco funções

Todas `SECURITY DEFINER`, `search_path` vazio, `execute` revogado de `public`, `anon` e `authenticated` e dado só a quem precisa.

- **`registrar_clique_do_site(p_chave, p_codigo, p_gclid, p_gbraid, p_wbraid, p_gad_source, p_google_campaign_id, p_google_adgroup_id, p_site_host text, os sete últimos com default null) returns text`**, só `service_role` (a rota pública). Devolve `ok`, `chave_invalida`, `desligado`, `limite`, `duplicado` ou `codigo_reservado`. Dado fora do formato, ou nenhum dos 6 sinais, dá 22023; o host fora do formato vira nulo. Ordem: chave (formato e existência), ligado, código reservado (igual, sem diferenciar caixa, a um token de `campaign_link` da clínica, ativo ou não), duplicado (o mesmo código em qualquer estado: o aviso repetido é idempotente), limite de **30 por minuto por clínica** (contado sem trava e de novo com a linha do rastreio travada, o que serializa os cliques da mesma clínica sem deadlock; se a chave trocou ou o rastreio desligou entre a leitura e a trava, vale o estado novo), grava, e só então o **teto de 2.000 vivos** (não casados e no prazo) por clínica: cheio, o clique novo entra e sai o vivo que vence primeiro, nunca o recém-gravado. O teto nunca recusa, porque a chave é pública: recusar deixaria a clínica dias sem origem do Google depois de uma enxurrada de cliques falsos, sem a troca de chave resolver. Por último, `ultimo_clique_em`.
- **`casar_clique_do_site(p_clinic_id uuid, p_contact_id uuid, p_codigo text) returns text`**, só `service_role` (a ingestão). Clínica ou contato nulos dão 22023; o código é normalizado com `upper` e `trim`. Numa transação: trava o contato (`for no key update`, da clínica) e depois o clique (da mesma clínica, pelo código), sempre nessa ordem. Devolve:
  - `nao_achado`: código fora do formato, inexistente, de outra clínica, já usado por outro contato, ou contato de outra clínica;
  - `expirado`: clique da clínica, não casado e vencido; nada muda;
  - `vinculado`: o clique ficou (ou já estava) ligado a este contato, sem gravar origem, porque o contato já tinha canal, método, campanha em texto ou sinal da Meta (`ctwa_clid`, `source_ad_id`, `source_adset_id` ou `source_campaign_id`);
  - `origem_gravada`: clique ligado e o contato com `source_channel = 'trafego_pago'`, `source_origin = 'Google'`, `source_medium` e `source_campaign` nulos, `source_method = 'clique_site'`, `source_captured_at = now()` e os dois ids do clique.
- **`trocar_chave_do_rastreio(p_clinic_id uuid) returns text`**, para `authenticated` (administrador ou gestor ativo que escreve; os demais recebem 42501) e `service_role`. Devolve a chave nova; cria a linha desligada se não existir e mantém o `ativo`. A chave velha passa a dar `chave_invalida`; os cliques já registrados continuam valendo.
- **`situacao_do_rastreio(p_clinic_id uuid) returns jsonb`**, `stable`, mesmas permissões (administrador ou gestor ativo): `{configurado, ativo, chave_trocada_em, ultimo_clique_em, cliques_7_dias, casados_7_dias}`. Só agregados: nunca a chave, o gclid ou o contato.
- **`podar_cliques_do_site(p_agora timestamptz default now(), p_clinic_ids uuid[] default null) returns jsonb`**, só `service_role`: `{apagados, zerados}`, até 5.000 de cada por passagem. `p_agora` e `p_clinic_ids` são só para testes: data futura sem a lista de clínicas dá 22023 (nenhuma clínica real é podada antes da hora).

### 15.6 `motor_manutencao`

Recriada byte a byte a partir do corpo de **produção** de 04/10/2026 (o mesmo da `20261003100000`, seção 14.6), com o que é novo entre os marcadores `-- [clique do site]`: chama `podar_cliques_do_site()` num bloco protegido, devolve também `"cliques_do_site": {apagados, zerados}`, e um erro vira `cliques_do_site:<sqlstate>` em `planner_erro`. Fora dos marcadores, idêntica (o ensaio compara); grants mantidos. A F2 recria a partir do `pg_get_functiondef` depois desta aplicada.

### 15.7 Códigos de erro, ensaio, ordem de publicação e rollback

**Códigos:** 42501, 22023, 23514, 23505 (insert direto duplicado, como o de `rastreio_do_site` criado ao mesmo tempo por duas abas) e P0001. 40001 e 40P01 nunca são levantados de propósito.

**Ensaio (04/10/2026):** em transação desfeita contra a produção: retrato de antes, a migration, os asserts da F1 e, em seguida, a suíte inteira da origem real (preparo, correção duas vezes e asserts), com o resultado "TODOS OS ASSERTS DO CLIQUE DO SITE PASSARAM | TODOS OS ASSERTS DA ORIGEM REAL PASSARAM" e ROLLBACK. Blocos: funções recriadas idênticas fora dos blocos novos, demais restrições intactas, ACL e gatilho, nenhum contato real mudou; coerência e imutabilidade no contato; 42501 da sessão e o reenvio; grants e RLS (a gestão lê `rastreio_do_site`, nenhuma sessão nem `anon` chega em `clique_do_site`); 42501 nas funções para sessão e `anon`; registrar (chave inválida ou trocada, desligado, duplicado, reservado, limite por minuto, teto de vivos com despejo, 22023); casar (prazo vencido, código já usado, código da A na B, contato de outra clínica, Meta e origem já gravada, normalização); trocar e situação; poda de 1 e de 90 dias; cascata. **71 sabotagens, todas pegas.**

**Ordem de publicação:** aplicar a migration **antes** do código da F1, ou junto. Sem a coluna no banco, as consultas de Leads, da ficha do paciente e do Atendimento, que passam a ler `source_google_campaign_id`, falham inteiras (42703), e a ingestão loga `clique_do_site_casar_falhou` (PGRST202) e não atribui a mensagem com código que não é de `campaign_link` (0 linhas em produção em 04/10/2026). A aplicação segura por instantes um lock exclusivo em `contact` (`alter table`): aplicar num momento de pouco movimento no WhatsApp. Depois, rodar as provas de RLS e integração (`tests/rls/clique-do-site.test.ts`, `tests/integration/clique-do-site.test.ts` e `tests/integration/atribuicao-clique-do-site.test.ts`) e o e2e, e regenerar os tipos (o diff tem de sumir).

**Rollback** (cabeçalho da migration, manual): reaplicar `motor_manutencao` da `20261003100000` e `proteger_atribuicao_de_anuncio` (com o gatilho) da `20261004100000`; apagar as cinco funções novas e as tabelas `clique_do_site` e `rastreio_do_site`; recriar `contact_source_method_valido` sem `clique_site`, apagar os CHECKs `contact_origem_do_clique_do_site_coerente` e `contact_ids_do_google_validos` e as colunas `source_google_*`. **Contato que já ganhou origem `clique_site` impede recriar o CHECK sem o método:** a origem é imutável e não volta.

---

## 16. Mensagem enviada pelo celular (Pelo WhatsApp, 05/10/2026, migration `20261005120000_mensagem_pelo_celular.sql`)

O que a clínica envia **direto** pelo WhatsApp do número pareado (celular, WhatsApp Web, outro aparelho vinculado), sem passar pelo sistema, chega ao webhook como evento `messages` do uazapi com `fromMe` (sem `wasSentByApi` e sem a nossa marca de rastreio). Até aqui ele só derrubava `awaiting_reply` e rodava o termo-chave, e o conteúdo era descartado: a conversa do Atendimento não mostrava o que o paciente leu. Agora ele vira **linha de `message`**, de saída, marcada `pelo_celular`, na conversa aberta daquele número, e a bolha mostra "Pelo WhatsApp". Nenhum evento novo no uazapi: `messages` já traz o que sai do aparelho, e `excludeMessages: ["wasSentByApi"]` só corta o eco da API. Revisada duas vezes em 05/10/2026 depois de revisões adversariais: a primeira trouxe `created_at` sempre a chegada, a janela da automática com limite de cima, a espera separada da autoria, o número da plataforma, a trava do número, `reclassificar_resposta_automatica` e os dois acréscimos da adoção; a segunda trouxe o **horário de envio** guardado (`message.enviada_no_aparelho_em`), a decisão de autoria e espera pelos horários de envio quando os dois existem (rajada de reconexão), a reclassificação com o horário do paciente e a espera derrubada sem linha nas ignoradas de plataforma e colisão (`espera_pelo_celular_sem_linha`). Ensaiada em transação desfeita contra a produção e **ainda não aplicada** em 05/10/2026 (sha256 `ba79f39c6af0d689e3c831c4488ec1a20ce4d30afbf267b58d667eb034697f53`). Os tipos de `lib/supabase/database.types.ts` (as duas colunas e as quatro funções) foram escritos à mão no formato gerado e precisam ser regenerados depois de aplicar.

### 16.1 Decisões registradas

- **Autoria sem valor novo em `author`.** A pessoa da clínica grava `author = 'usuario'` com `author_user_id` nulo; a **resposta automática** do app WhatsApp Business (saudação, ausência) grava `author = 'sistema'`, também sem pessoa. A regra que separa as duas é a do tempo, no banco, em duas versões:
  - **pelos horários de envio**, quando o eco traz o horário dele e a última mensagem do paciente na conversa (a de chegada mais recente) também tem o dela (`enviada_no_aparelho_em`): é automática quando o paciente enviou **alguma** mensagem da conversa de 8 s antes a 2 s depois do eco (a folga de 2 s é o relógio). O horário de envio não muda com atraso, fila ou rajada de reconexão;
  - **pela chegada**, sem um dos dois horários (eco sem `messageTimestamp`, horário implausível, ou a última mensagem do paciente sem horário): é automática quando `conversation.last_inbound_at` não é nulo e fica **entre 8 s antes e 10 s depois** do horário de envio do eco (ou da chegada do eco, sem ele). Os 10 s de cima são a folga da hora de chegada do paciente, que não é a hora de envio dele. A primeira versão não tinha limite de cima: o paciente que escrevia 30 s depois de uma fala da equipe transformava essa fala em automática.

  Quando o eco é processado **antes** da mensagem do paciente (os dois webhooks correm em paralelo), a ingestão corrige depois (`reclassificar_resposta_automatica`, 16.5). Com isso nenhum consumidor muda: a primeira resposta das métricas (só conta `usuario`), o interceptador (pergunta "humana" é `usuario` ou `ia`), a exportação ("resolvida sem humano") e o `por_autor` já tratam a pessoa como equipe e a automática como automação. Os checks de `message.author` e de `conversation.last_preview_author` não mudam.
- **Espera separada da autoria.** `awaiting_reply` desce só quando a última mensagem do paciente é **anterior** ao envio do eco menos 8 s: pelos horários de envio quando os dois existem (o envio da última mensagem do paciente antes do envio do eco menos 8 s), senão pela chegada (`last_inbound_at` nulo ou anterior ao horário de envio menos 8 s). A pergunta enviada colada no envio, ou depois dele, continua esperando, mesmo quando o eco é de pessoa: a fala da clínica saiu antes de a pergunta existir. Exemplo: o paciente escreveu 30 s depois do envio; o eco grava `usuario` e a conversa segue em "Aguardando você".
- **Rajada de reconexão.** Quando o aparelho ou a instância reconecta, o que ficou parado chega de uma vez: a fala da equipe enviada às 10:00 e a mensagem do paciente enviada às 10:03 chegam no mesmo segundo. Pela chegada, as duas estariam coladas; pelos horários de envio, a fala da equipe é anterior. Resultado: a fala continua `usuario`, a espera **não** desce (o paciente escreveu depois) e a reclassificação não a troca (16.5). A ausência do app que saiu 1 s depois do paciente, na mesma rajada, vira `sistema`.
- **Horário de envio guardado** (`message.enviada_no_aparelho_em`, 16.2): o `messageTimestamp` do payload, só quando plausível (de 7 dias atrás até 1 minuto à frente), na linha do celular (`registrar_mensagem_do_celular`) e na do paciente (`reclassificar_resposta_automatica`, chamada pela ingestão). Serve **só** para essas decisões; a ordem do fio continua sendo `created_at` (a chegada).
- **Contato nunca é criado nem atualizado** por mensagem de saída. Criar daria um lead "novo" sem consentimento, contaria conversa iniciada que não existiu, poderia mandar conversão falsa para a Meta e dispararia as automações de entrada; mexer em `last_contact_at` faria o follow-up e a automação "sem resposta" lerem a fala da clínica como resposta do lead. Destino que não está no sistema volta `ignorada: 'contato_desconhecido'`. Decisão padrão da frente; o dono pode pedir para criar.
- **Número de outra clínica da plataforma nunca é gravado.** Destino com a chave de telefone de um número **ativo** de outra clínica volta `ignorada: 'numero_da_plataforma'`, antes de procurar a linha. O `wa_message_id` é o mesmo para quem envia e para quem recebe, e o unique ainda é global (docs/07, Fase 5): se o eco da clínica X gravasse primeiro, a ingestão da Y daria `on conflict do nothing` e a mensagem que a Y **recebeu** sumiria sem aviso. O id fica com quem recebeu. Número removido da outra clínica não conta.
- **Eco sem linha continua sendo resposta da equipe.** Nas ignoradas `numero_da_plataforma` e `colisao_wa_message_id` o eco não vira linha, mas é a clínica respondendo pelo celular, como antes desta migration: a espera da conversa **aberta daquele número** desce pela regra de chegada e o contato volta no retorno (para o termo-chave), sem criar contato nem abrir conversa (`espera_pelo_celular_sem_linha`, 16.3). A conversa de outro número e a resolvida não são tocadas.
- **Consentimento** não é lido nem escrito: quem enviou foi a clínica, pelo aparelho dela. Gravar não é disparar, e o descadastro continua valendo para tudo o que o sistema envia.
- **Custo:** `billable = false` e `cost_cents = 0` (regra 3.3). `delivery_status = 'enviada'`: os recibos do uazapi sobem para entregue e lida pelo caminho que já existe, e o "apagar para todos" (que exige enviada, entregue ou lida) passa a valer para ela. Com `author_user_id` nulo, só administrador e gestor apagam pelo sistema (`pode_apagar_mensagem`, motivo `nao_e_sua` para os outros).
- **Conversa resolvida não é reaberta:** sem conversa aberta daquele número, abre uma nova (`garantir_conversa_aberta`, como a régua), em `aguardando_humano`, sem espera. Ela entra na lista e conta em conversas iniciadas.
- **Horário de chegada:** `created_at` é **sempre** a hora de chegada (`now()`), a mesma regra da ingestão, e o fio é ordenado por `created_at`. O horário do payload só vale se plausível e só serve para as decisões de autoria e espera; sem ele (ou implausível), a base é a chegada. A primeira versão gravava o horário do payload no eco com mais de 2 minutos; a revisão tirou isso: misturar o horário do payload de um lado com a hora de chegada do outro punha a resposta acima da pergunta depois de uma reconexão (a ingestão grava a hora de chegada de tudo o que chega atrasado) e fazia a mídia atrasada nascer "indisponível". Efeito aceito: depois de uma reconexão, o eco atrasado aparece no fio na hora em que chegou. O atraso sozinho não faz o eco virar automático: o eco enviado há 10 minutos com o paciente escrevendo há 5 minutos é de pessoa (fora da janela) e não derruba a espera (o paciente escreveu depois do envio).
- **Edição feita no celular** continua descartada pelo parser: o texto gravado fica o original.

### 16.2 `message.pelo_celular` e `message.enviada_no_aparelho_em`

```sql
alter table message
  add column pelo_celular boolean not null default false,
  add column enviada_no_aparelho_em timestamptz,
  add constraint message_pelo_celular_coerente check (
    not pelo_celular
    or (direction = 'saida'
        and author in ('usuario','sistema')
        and author_user_id is null
        and job_id is null
        and not is_internal_note
        and content_type in ('texto','imagem','audio','documento'))
  );
```

- **Leitura:** as duas colunas herdam a RLS de `message` (todo membro ativo da clínica; o profissional só na conversa atribuída a ele) e chegam ao Realtime pelo mesmo filtro. Sem grant por coluna.
- **Escrita de `pelo_celular`:** só o service role, por `registrar_mensagem_do_celular`. A policy de INSERT da sessão (migration `20260924106000`) exige `author_user_id = auth.uid()` para `usuario` e `content_type = 'evento'` para `sistema`; o CHECK exige pessoa nula e conteúdo que não é evento. Juntos, nenhuma sessão forja o rótulo (42501 pela policy ou 23514 pelo CHECK, conforme o que falha primeiro). Sem policy de UPDATE em `message`, ninguém liga nem desliga o rótulo depois. O autor de uma linha do celular só muda de `usuario` para `sistema` por `reclassificar_resposta_automatica` (service role).
- **`enviada_no_aparelho_em`** (nula): o horário de envio que o WhatsApp informa, só quando plausível. Gravada por `registrar_mensagem_do_celular` na linha do celular e por `reclassificar_resposta_automatica` na do paciente (só se vazia: a primeira gravação vale). Nenhuma outra escrita; nenhuma leitura de tela. Nula nas linhas antigas e quando o payload não trouxe horário: aí vale a regra de chegada.
- **Custo da aplicação:** as colunas (uma com default constante, outra nula) não reescrevem a tabela; o CHECK percorre as 7.348 linhas de 05/10/2026 sob o lock exclusivo do `alter table` (milissegundos).

### 16.3 `registrar_mensagem_do_celular`

**`registrar_mensagem_do_celular(p_clinic_id uuid, p_whatsapp_account_id uuid, p_phone_e164 text, p_wa_message_id text, p_content_type text default 'texto', p_body, p_media_url, p_media_filename, p_media_mimetype, p_quoted_wa_message_id text default null, p_enviada_em timestamptz default null) returns jsonb`** (`SECURITY DEFINER`, `search_path` vazio, `execute` só para `service_role`). `p_phone_e164` é o telefone do **paciente** (o destino); `p_enviada_em` é o `messageTimestamp` do payload. Chamada pela rota do webhook (`registrarMensagemDoCelular` em `lib/integrations/whatsapp/ingest.ts`), que depois resolve a citação com `vincular_citacao_recebida`, como a ingestão. Passos, numa transação:

1. **Entrada:** clínica, número e telefone presentes, `wa_message_id` não vazio, tipo entre texto, imagem, áudio e documento; senão 22023.
2. **Número:** de outra clínica ou inexistente, 23503; removido, `ignorada: 'numero_removido'` sem gravar nada. A leitura **trava o número com `for key share`** (a mesma trava que a FK do insert pediria depois): `remover_numero`, que trava o número e depois as conversas, espera a gravação terminar, ou a gravação espera a remoção e já vê `removido_em`. Sem isso as duas podiam se travar em ciclo (40P01, que o PostgREST repete sem limite).
3. **Horários:** o horário do payload só vale se plausível (de 7 dias atrás até 1 minuto à frente); base = esse horário, ou a chegada (`now()`) sem ele. `created_at` é sempre o default `now()`.
4. **Número próprio:** destino com a chave de telefone de um número **ativo** da clínica (o A escrevendo para o B), `ignorada: 'numero_proprio'`. O mesmo filtro da ingestão (`display_phone` com 10 a 15 dígitos, pela `chave_telefone`, que ignora o nono dígito do celular).
5. **Número da plataforma:** o mesmo filtro sobre os números ativos de **outra** clínica, `ignorada: 'numero_da_plataforma'` (16.1). Nenhuma linha; a espera da conversa aberta daquele número desce pela regra de chegada e o contato volta no retorno (`espera_pelo_celular_sem_linha`, abaixo).
6. **Já gravado** (o unique de `wa_message_id` é global): da mesma clínica, `inserted: false` com os ids da linha (reentrega do provedor, ou o eco de um envio nosso que já tem o id); de **outra** clínica, `ignorada: 'colisao_wa_message_id'`, sem nenhum id de lá, com a mesma descida da espera e o contato **desta** clínica no retorno (sobra para o número de outra clínica que já foi removido, ou que não tem `display_phone`; a solução definitiva é o unique por número da Fase 5, docs/07).
7. **Contato** pela chave do telefone, sem insert e sem update. Não achou: `ignorada: 'contato_desconhecido'`.
8. **Conversa:** `garantir_conversa_aberta(clínica, contato, número)` e trava dela com `for no key update`, que serializa com o update da ingestão: a decisão da espera é atômica. Resolvida entre achar e travar: tenta de novo (3 vezes; depois, CZ409 e o provedor reenvia).
9. **Automática e espera** (16.1). A última mensagem do paciente é a de chegada mais recente da conversa (`created_at`, desempate por id), a mesma que deu o `last_inbound_at`. Com o horário do eco **e** o dela: automática se alguma mensagem do paciente da conversa (chegada desde 1 minuto antes do envio do eco) foi enviada de 8 s antes a 2 s depois do eco; a espera desce se a última foi enviada antes do eco menos 8 s. Sem um dos dois: automática com `last_inbound_at` entre base menos 8 s e base mais 10 s; a espera desce com `last_inbound_at` nulo ou anterior a base menos 8 s.
10. **Insert** com `on conflict (wa_message_id) do nothing`: saída, autor `usuario` ou `sistema`, sem pessoa, nome e tipo do arquivo saneados como na ingestão, texto em branco vira nulo, `reply_to_wa_message_id` da citação, `enviada_no_aparelho_em` = o horário plausível (ou nulo), o número herdado da conversa (gatilho `mensagem_herda_numero`). Sem inserção (a outra entrega do mesmo eco gravou no meio), volta ao passo 6.
11. **Conversa, só quando inseriu:** `last_message_at` avança (nunca volta) e `awaiting_reply` desce pela regra do passo 9. `last_inbound_at` (a ordem do Inbox), `unread_count`, `status`, responsável e prévia não são tocados aqui; a prévia é do gatilho `manter_previa_ao_inserir_mensagem` e passa a mostrar a mensagem do celular com autoria `usuario` (ou `sistema`) sem pessoa.

**Retorno:** `{inserted, ignorada?, contact_id, conversation_id, message_id, whatsapp_account_id, automatica}`. `ignorada` é `numero_removido`, `numero_proprio`, `numero_da_plataforma`, `colisao_wa_message_id` ou `contato_desconhecido`. `automatica` é nula quando nada foi decidido agora (ignorada ou linha que já existia). Nas ignoradas `numero_da_plataforma` e `colisao_wa_message_id`, `contact_id` vem preenchido quando o contato existe nesta clínica; nas outras ignoradas, nulo.

**Auxiliar `espera_pelo_celular_sem_linha(p_clinic_id uuid, p_whatsapp_account_id uuid, p_phone_e164 text, p_base timestamptz) returns uuid`** (`SECURITY INVOKER`, `search_path` vazio, **sem `execute` para ninguém**: nem `public`, nem `anon`, nem `authenticated`, nem `service_role`; roda só dentro de `registrar_mensagem_do_celular`, que é `SECURITY DEFINER` e chama como dona). Acha o contato pela chave do telefone **desta** clínica (sem criar; não achou, devolve nulo e não faz mais nada), a conversa **aberta** daquele número (sem abrir; resolvida e conversa de outro número não contam), trava com `for no key update` e derruba `awaiting_reply` pela regra de chegada (`last_inbound_at` nulo ou anterior a `p_base` menos 8 s, com `p_base` = horário plausível do eco ou a chegada). Devolve o contato.

**Concorrência:** duas entregas do mesmo eco passam juntas do passo 6; a segunda espera a trava da conversa (ou o índice único) e, com a primeira confirmada, não insere e devolve `inserted: false`. O eco junto com a mensagem do paciente é ordenado pela trava da conversa: com a ingestão primeiro, o eco vê o `last_inbound_at` novo (e, depois da reclassificação, o horário de envio dela) e não derruba a espera que ela levantou; com o eco primeiro, ele grava como pessoa e derruba a espera, a ingestão levanta a espera de novo e `reclassificar_resposta_automatica` troca o autor para `sistema` quando os horários de envio confirmam. Espera e autoria terminam certas nos dois casos. Ordem das travas: número (`for key share`), conversa, depois o insert (que só espera pelo índice único do mesmo `wa_message_id`, e o passo 6 já descartou esse caso); a auxiliar trava só a conversa, na mesma posição; `adotar_eco_do_envio` e `reclassificar_resposta_automatica` travam mensagens e só depois a conversa, como o apagamento, e esta função nunca espera por linha de mensagem existente segurando a conversa. Sem ciclo.

**Não dispara nada:** o gatilho `registrar_mensagem_para_automacao` é só de entrada do paciente, nenhum gatilho enfileira IA ou régua, e o job `baixar_midia` da mídia é enfileirado pela rota, como na entrada (o worker não transcreve o áudio enviado pelo celular).

### 16.4 `adotar_eco_do_envio`

**`adotar_eco_do_envio(p_clinic_id uuid, p_message_id uuid, p_wa_message_id text) returns boolean`** (`SECURITY DEFINER`, `search_path` vazio, `execute` só para `service_role`). Rede de segurança do `send.ts`: a linha de saída nasce `enviando` sem `wa_message_id` e só ganha o id depois que o provedor responde. Se o eco do envio escapar dos dois filtros (`wasSentByApi` e a marca `track_source`) e for gravado como `pelo_celular` nessa janela, o update do `send.ts` bate no unique (23505). No 23505, o `send.ts` chama esta função, que numa transação trava as duas linhas (na ordem do id), confere que a nossa é de saída, não é do celular, é da clínica e não tem `wa_message_id`, e que o eco é `pelo_celular`, da mesma clínica, do **mesmo número** e não foi apagado. Então:

- quem citava o eco (`reply_to_message_id`) passa a citar a nossa linha (sem isso o `on delete set null` perderia a citação);
- o eco sai (é uma cópia da nossa mensagem, não uma fala a mais: a trilha continua na nossa linha);
- a nossa ganha o `wa_message_id` e o recibo mais avançado entre `enviada` e o do eco (`entregue` ou `lida`);
- **a conversa que o eco abriu e que ficou vazia é resolvida:** quando a nossa conversa foi resolvida no meio do envio, o eco abriu outra (`garantir_conversa_aberta` nunca reabre); se depois do delete ela não tem nenhuma mensagem, vira `resolvida` com `awaiting_reply = false` (o mesmo que o "Resolver" grava), senão sobrava na fila do Atendimento um atendimento vazio "Sem atendente". Com outra mensagem nela, fica aberta;
- **a espera que o eco de pessoa derrubou volta:** se o eco foi gravado como `usuario` e o envio adotado é automático (`sistema`, régua ou toque, que de propósito não derruba a espera), `awaiting_reply` volta a `true` na conversa do eco quando ela não está resolvida, tem `last_inbound_at` e não há fala humana (`usuario` ou `ia`, fora nota interna) com `created_at` desde a última mensagem do paciente. Envio de pessoa (Atendimento) nunca levanta a espera aqui: quem a derruba é o próprio `send.ts`;
- a prévia das conversas envolvidas é recalculada (`delete` não tem gatilho de prévia).

Devolve `true` quando adotou e também quando a nossa linha já tem esse mesmo id (repetição da chamada); `false` quando não há o que adotar. Entrada vazia, 22023. Efeito que fica, raro e aceito: o job `baixar_midia` de um eco de mídia aponta para uma linha que não existe mais (o worker não acha a linha e desiste).

### 16.5 `reclassificar_resposta_automatica`

**`reclassificar_resposta_automatica(p_clinic_id uuid, p_message_id uuid, p_enviada_em timestamptz default null) returns integer`** (`SECURITY DEFINER`, `search_path` vazio, `execute` só para `service_role`; uma função só, de 3 argumentos: a chamada com 2 continua valendo pelo default). A resposta automática do app WhatsApp Business sai do celular 1 ou 2 s depois da mensagem do paciente, e os dois webhooks correm em paralelo. Se o eco grava primeiro (a ingestão é mais longa, ou pegou partida a frio à noite, justo quando a ausência está ligada), `registrar_mensagem_do_celular` ainda não vê a mensagem do paciente e grava o eco como **pessoa**. Sem correção, a ausência contava como primeira resposta da equipe e, pior, o interceptador a lia como "a clínica falou depois do toque": o "Confirmar" tocado pelo paciente deixava de confirmar a consulta sozinho.

A ingestão (`ingerirMensagemRecebida`, em `lib/integrations/whatsapp/ingest.ts`) chama a função para cada mensagem do paciente que acabou de inserir (só na primeira entrega), **antes** de a rota chamar o interceptador, com o `messageTimestamp` do payload em `p_enviada_em`:

- só vale para mensagem de entrada do paciente (`direction = 'entrada'`, `author = 'paciente'`) da clínica pedida; qualquer outra (saída, de outra clínica, inexistente) devolve 0 sem mexer em nada, nem no horário;
- **grava o horário de envio** na linha do paciente (`enviada_no_aparelho_em`) quando é plausível (de 7 dias atrás até 1 minuto à frente) e a linha ainda não tem um: a primeira gravação vale, e a decisão usa o horário gravado antes do recebido. É o que `registrar_mensagem_do_celular` usa para decidir os ecos que chegarem depois;
- as linhas `pelo_celular` de `usuario`, não apagadas, **da mesma conversa**, com `created_at` de 8 s antes a **2 s depois** do `created_at` da entrada (a folga de cima é a corrida das transações: o eco pode ter tomado o relógio depois da ingestão e confirmado antes), viram `sistema`, **desde que**, quando os dois horários de envio existem, o eco tenha saído de 2 s antes a 8 s depois do paciente. Sem um dos dois horários, só a janela de chegada decide. Envio pelo Atendimento (sem o rótulo), linha de outra conversa, linha apagada, fala que chegou mais de 2 s depois da entrada e **fala enviada antes do paciente** ficam como estão. O filtro pelo envio é o que protege a rajada de reconexão (16.1): a fala da equipe enviada meia hora antes chega colada na mensagem seguinte do paciente, mas continua `usuario`;
- a prévia é recalculada quando algo mudou (o gatilho da prévia não olha `author`);
- devolve quantas linhas mudaram (0 no comum). Entrada nula, 22023.

A espera não muda aqui: a ingestão já a levantou. No TypeScript é melhor esforço: erro vira o log `reclassificar_automatica_falhou` só com ids e código, e a mensagem do paciente já está salva. Efeito aceito: sem os horários de envio, uma pessoa não lê e responde em menos de 8 s, então a fala da equipe pelo celular respondida pelo paciente em menos de 8 s vira `sistema`, o mesmo que a regra de chegada decide quando o eco chega depois da mensagem do paciente. Travas: mensagens e depois a conversa (recálculo da prévia), a mesma ordem do apagamento e da adoção.

### 16.6 Ensaio, ordem de publicação e rollback

**Ensaio (05/10/2026, refeito com a segunda revisão):** em transação desfeita contra a produção, a migration e um bloco de asserts com duas clínicas `e_de_teste` criadas dentro da transação (dentro dela `now()` é um só, então os horários relativos são simulados por `p_enviada_em` e por update de `created_at`, `last_inbound_at` e `enviada_no_aparelho_em`). Da primeira revisão: pessoa (linha, conversa, prévia, contato e consentimento intactos, sem horário guardado), reentrega, automática, janela de 8 s com a borda exata, folga de 10 s (9 s depois automática, 11 s depois pessoa), paciente 30 s depois do envio (pessoa, a espera fica), paciente colado 2 s antes (sistema, a espera fica), `last_inbound_at` nulo (a espera desce), horários (eco de 10 minutos entra na chegada com o horário guardado e não vira automático só pelo atraso; com o paciente escrevendo depois do envio a espera fica; recente; implausível de 8 dias e de 2 minutos à frente usa a chegada como base e não guarda horário), contato desconhecido, número próprio com e sem o nono dígito, número da plataforma (com e sem o nono dígito, sem gravar nem abrir conversa, com o contato devolvido; número removido da outra clínica deixa de bloquear), número removido, a trava do número já no passo 2, número de outra clínica, colisão entre clínicas (com o contato devolvido), resolvida abre nova, número B, mídia saneada, entradas inválidas, CHECK, adoção e seus dois acréscimos, e `reclassificar_resposta_automatica` sem horário (3 s e 8 s antes e 2 s depois viram `sistema`; 9 s e 20 s antes, 3 s depois, apagada, envio do Atendimento, outra conversa e outra clínica não mudam; a prévia refeita). Da segunda revisão:

- **pelos horários de envio** (a chegada de tudo é agora, 2 minutos depois do eco, e a regra de chegada decidiria o contrário): paciente enviado 3 s antes do eco, automática e a espera fica, com o horário guardado no eco; 20 s antes com a chegada colada, pessoa e a espera desce; bordas de 8 s antes e 2 s depois automáticas; 9 s antes pessoa e a espera desce; 3 s depois pessoa e a espera fica; enviado 30 s depois com a chegada 60 s antes, a espera fica; uma mensagem anterior do paciente na janela faz automática; um eco anterior na janela não conta como paciente;
- **a regra de chegada sem um dos horários:** eco sem horário com a última mensagem do paciente com horário; última mensagem do paciente sem horário (com uma anterior enviada na janela do eco); horário do eco implausível;
- **rajada de reconexão** (fala das 10:00 e paciente das 10:03 chegando juntos): com os ecos primeiro, a reclassificação com o horário das 10:03 troca só a ausência das 10:03:01 e a fala das 10:00 continua `usuario`, com a espera levantada; com o paciente primeiro, a fala das 10:00 é `usuario` e não derruba a espera, a ausência é automática pelo envio, e a reclassificação repetida não troca nada;
- **reclassificação com horário:** grava o horário do paciente; troca o eco que saiu 1 s depois, o que chegou 2 s depois da entrada, as bordas de 2 s antes e 8 s depois e o eco sem horário; não troca o que chegou 3 s depois, o enviado 3 s antes do paciente nem o enviado 9 s depois; a segunda chamada com outro horário não sobrescreve e decide pelo gravado; outra clínica e linha de saída não gravam horário; horário implausível (8 dias, 2 minutos à frente) não é gravado e deixa só a chegada decidir;
- **ignoradas que derrubam a espera:** número da plataforma e colisão devolvem o contato, derrubam a espera da conversa aberta daquele número e não a da conversa do outro número nem a da resolvida, não abrem conversa (contato só com resolvida, contato só no outro número), seguem a regra de chegada (paciente depois do envio pelo horário do payload fica; sem horário desce; colado fica; `last_inbound_at` nulo desce) e, sem contato na clínica (mesmo com um contato daquele telefone na outra), devolvem contato nulo sem criar nada;
- **permissões:** a auxiliar sem `execute` para `public`, `anon`, `authenticated` e `service_role`; as outras três só para `service_role`; nenhuma `reclassificar_resposta_automatica` de 2 argumentos sobrando; o service role grava pela `registrar` (que chega na auxiliar) e recebe 42501 ao chamar a auxiliar direto.

Resultado "TODOS OS ASSERTS PASSARAM" e ROLLBACK. **Sabotagens:** 27 novas, nos pontos da segunda revisão (as duas bordas da janela do envio, a espera pelo envio trocada pela chegada, a regra do envio desligada, o fallback da última mensagem sem horário, a última mensagem escolhida pelo envio, o horário cru gravado no eco e na reclassificação, o eco contando como paciente, o filtro do envio da reclassificação inteiro e cada borda e caso nulo dele, a preferência pelo horário gravado, a sobrescrita, a folga de 2 s da chegada, a auxiliar com a chegada no lugar da base, sem a auxiliar nos dois ramos, sem o filtro de número, de resolvida, do caso nulo, da regra de espera e da clínica do contato, e o `execute` do service role na auxiliar): **27 pegas**. As 24 da primeira revisão, refeitas sobre o texto novo: **24 pegas**, inclusive a guarda da clínica na leitura da entrada em `reclassificar_resposta_automatica`, que antes escapava e agora protege a gravação do horário (outra clínica não grava). Na primeira versão foram 14 sabotagens, 11 pegas.

**Provas escritas, a rodar depois de aplicar:** `tests/integration/mensagem-pelo-celular.test.ts` (a RPC direto, inclusive simultânea; a janela e a espera montadas sobre o `last_inbound_at` que o banco gravou, nunca o relógio da máquina; o eco atrasado na hora de chegada com o horário guardado; as decisões pelos horários de envio e a regra de chegada sem um deles; o número da plataforma e a colisão devolvendo o contato e derrubando a espera só da conversa aberta daquele número; a reclassificação com e sem horário; a rajada de reconexão nas duas ordens; os dois acréscimos da adoção; e a rota real com o payload do uazapi: texto, imagem com o job, citação, contato desconhecido, o eco com a nossa marca de rastreio, a ausência que chega antes da mensagem do paciente virando `sistema` quando ela chega, **a ingestão gravando o horário de envio do paciente**, a fala de pessoa da rajada continuando de pessoa e o número da plataforma pela rota) e `tests/rls/mensagem-pelo-celular.test.ts` (a clínica A não lê a da B; profissional e pendente; nenhum papel nem anon executa as três funções, 42501, nem grava o horário; a auxiliar nega `execute` a todo papel, a anon e ao próprio service role, 42501, e roda pela `registrar`; nenhuma sessão grava nem troca o rótulo). As duas provas da rota sobre o horário do paciente dependem de a ingestão passar o `messageTimestamp` da mensagem recebida em `p_enviada_em`. Os casos do celular em `tests/integration/numeros-fase-2.test.ts` também dependem dela.

**Ordem de publicação:** a migration **antes** do código. Com ela e o código antigo nada muda (colunas com default `false` e nula, funções sem chamador; a chamada antiga de `reclassificar_resposta_automatica` com 2 argumentos continua valendo pelo default). Com o código novo e sem ela, a lista e o fio do Atendimento, que passam a pedir `pelo_celular`, falham com 42703, o webhook responde 500 a toda mensagem do celular (PGRST202) e a ingestão grava o log `reclassificar_automatica_falhou` (PGRST202) em toda mensagem do paciente, sem derrubar a ingestão. Depois de aplicar: rodar as provas acima e regenerar os tipos (o diff tem de sumir).

**Rollback** (manual): apagar `registrar_mensagem_do_celular`, `adotar_eco_do_envio`, `reclassificar_resposta_automatica` e `espera_pelo_celular_sem_linha`, o CHECK `message_pelo_celular_coerente` e as colunas `pelo_celular` e `enviada_no_aparelho_em`. As linhas já gravadas pelo celular **ficam** (saída, `usuario` ou `sistema`, sem pessoa) e só perdem o rótulo; o código antigo as mostra como bolha da clínica sem autor.

---

## 17. Agente de IA: liberação controlada e schema (Fase 3, E0, 06/10/2026, migration `20261006100000_ia_liberacao_e_schema.sql`)

Plano aprovado pelo dono em 05/10/2026: a IA conversa **só** nas duas clínicas dele, **teste123** (`acd9c539-585e-4f2a-a195-712c70099564`) e **Conduzza Teste** (`f0c115dd-e98c-4767-a1bb-93d517844852`), e só com telefones da equipe. A salud-care nunca pode ser atingida. Esta migration é só aditiva e **não liga nada**: nenhuma linha de liberação nasce nela, o interruptor global nasce desligado e nenhum código de produção lê as tabelas novas (só os testes). Ensaiada três vezes em transação desfeita contra a produção (a terceira depois da revisão adversarial de 05/10/2026; sha256 da versão ensaiada por último: `0ab729e1abe48864a0706870debe1dc52f3f7b290439693f01fedc0c65485143`) e **aplicada** depois (conferido em 06/10/2026 na lista de migrations da produção, junto com a `20261006110000` e a `20261006120000`). Os tipos de `lib/supabase/database.types.ts` foram escritos à mão no formato gerado; conferir com o gerado depois de aplicar.

### 17.1 Decisões registradas

- **Defesa em profundidade:** basta uma trava dizer não para a IA não agir. No ambiente (`lib/ia/liberacao.ts`): T1 `IA_AGENTE_LIGADO=sim` com `VERCEL_ENV=production` e `OPENAI_API_KEY` (era `ANTHROPIC_API_KEY` até a troca de provedor de 05/10/2026); T2 `IA_CLINICAS_LIBERADAS` cruzada com a constante `CLINICAS_DA_FASE_CONTROLADA` (o ambiente só estreita; um valor que não é uuid derruba a lista inteira). No banco: T3a lista fechada, T3b `ia_liberacao`, T4 `ia_numero_liberado`, T5 `ia_contato_liberado`, T6 `ia_interruptor`, T7 `ia_liberacao.pausada_pela_clinica`.
- **Escrita só pelo super admin** (`is_product_admin()`), pelo SQL editor ou pela service role, sempre pelas RPCs `definir_*_da_ia`, que gravam `audit_log`. Nenhuma sessão da clínica escreve, nem o administrador dela. **Mudou em 06/10/2026 (17.11):** o administrador ativo da teste123 e da Conduzza Teste (e de clínica `e_de_teste`, para os testes) passa a escrever a liberação, o número e os telefones da própria clínica, pela aba Agente de IA de Configurações; o interruptor geral continua só do super admin.
- **Desligar nunca envia nada**, nem a frase fixa: desligar é parar a automação. As conversas que perderam a liberação voltam para a equipe.
- **Clínica `e_de_teste` fora da lista** passa em T3a e não depende do interruptor global, para as suítes provarem a tabela verdade sem tocar no interruptor (o banco é o da produção); em troca, `ia_pode_atender` só aceita, nela, número de provedor `fake`. **Clínica da lista obedece sempre ao interruptor**, mesmo marcada `e_de_teste` (revisão adversarial de 05/10/2026: antes, marcar teste123 como de teste a tirava do kill switch). O motor de produção ignora clínica de teste. Por isso `e_de_teste` passou a ser do produto (17.6).
- **Teto das últimas 24 horas** (janela móvel, `ia_uso.created_at >= now() - interval '24 hours'`), no lugar do teto "do dia" no fuso da clínica que o contrato (item 9) previa. Troca feita em 05/10/2026 depois da revisão adversarial: o dia civil dependia de `clinic.timezone`, que o administrador da clínica edita na tela de Configurações; um fuso POSIX escolhido a dedo punha o início do "dia" minutos antes de agora e zerava a soma, e um fuso inválido (`Foo/Bar`, aceito pelo banco em clínica sem atividade agendada) fazia a decisão levantar 22023 e derrubava `ia_desligar`. O nome da coluna (`teto_diario_centavos_usd`) ficou. **O dono precisa saber:** "US$ 5 por dia" passou a ser "US$ 5 a cada 24 horas corridas"; quando o teto é atingido, a IA volta quando o gasto mais antigo sair da janela, não à meia-noite.
- **Modo `numero_inteiro`** (todos os contatos do número) fica barrado pelo CHECK de `ia_liberacao.modo` até uma migration futura, como `cadence_step.use_ai`.
- **Preço em tabela** (`llm_preco`), nunca no código, como `message_pricing`. Semeado com a tabela oficial da Anthropic do guia claude-api (cache de 24/06/2026). **Provedor trocado para a OpenAI em 05/10/2026** (decisão do dono, para ser mais barato; `docs/03`, seção 14): a migration `20261006110000_llm_preco_openai.sql` acrescenta os preços da OpenAI (17.7).

### 17.2 T3a: `ia_clinicas_da_fase_controlada()`

`immutable`, devolve `uuid[]` com as duas ids, na ordem teste123 e Conduzza Teste. Espelho exato de `CLINICAS_DA_FASE_CONTROLADA` em `lib/ia/liberacao.ts` (o teste de integração compara). Mudar a lista exige migration revisada **e** commit. `execute` só para `service_role`.

O gatilho `ia_liberacao_so_na_lista` (before insert or update em `ia_liberacao`) recusa com **42501**, para qualquer papel (service role e super admin inclusive), linha de clínica que não está na lista e não é `e_de_teste`. No UPDATE, só recusa o que liga (`liberada = true`) ou troca a clínica: desligar sempre passa, mesmo se a lista encolher no futuro. Por isso as RPCs fazem UPDATE e só depois INSERT (o `ON CONFLICT` dispararia o gatilho de INSERT mesmo com a linha existente).

### 17.3 As quatro tabelas da liberação

Todas com RLS, `select` só para `is_product_admin()`, nenhuma policy de escrita, `revoke all` de `anon` e `revoke insert, update, delete` (e `truncate`, `references`, `trigger`) de `authenticated`. A sessão da clínica lê zero linhas e recebe 42501 ao escrever; anon recebe 42501 até no `select`. **Desde a migration `20261006120000` (17.11),** `ia_liberacao`, `ia_numero_liberado` e `ia_contato_liberado` ganham `select` para administrador ou gestor ativo da própria clínica quando ela está na lista fechada ou é `e_de_teste` (recepção, profissional e leitura leem zero linhas); `ia_interruptor` e `ia_uso` continuam só do super admin, e a escrita continua só pelas RPCs.

| Tabela | Colunas | Regras |
|---|---|---|
| `ia_interruptor` (T6) | `id boolean` PK default `true` com `check (id)`, `ligado` (default `false`), `motivo`, `alterado_por`, `alterado_em` | linha única, inserida desligada pela migration |
| `ia_liberacao` (T3b, T7) | `clinic_id` PK (FK `clinic`, cascade), `modo` (`simulador` ou `contatos`, default `simulador`), `liberada` (default `false`), `pausada_pela_clinica` (default `false`), `teto_diario_centavos_usd` (default 500, > 0; vale para as últimas 24 horas, 17.1), `teto_respostas_por_conversa_hora` (default 20, > 0), `motivo`, `alterado_por`, `created_at`, `updated_at` | gatilho T3a (17.2); os tetos só mudam pelo SQL editor; o teto por conversa é conferido pelo job do E3 |
| `ia_numero_liberado` (T4) | `whatsapp_account_id` PK (FK `whatsapp_account`, cascade), `clinic_id` (FK `ia_liberacao`, cascade), `ativo` (default `false`), `alterado_por`, `created_at`, `updated_at` | gatilho `ia_numero_liberado_coerente`: clínica liberada antes (23503), número da mesma clínica (23503) e, ao ligar, não removido (23514) |
| `ia_contato_liberado` (T5) | `id`, `clinic_id` (FK `ia_liberacao`, cascade), `phone_key` (E.164), `rotulo` (até 80), `ativo` (default `false`), `alterado_por`, `created_at`, `updated_at`; único `(clinic_id, phone_key)` | gatilho `ia_contato_liberado_coerente` grava sempre `chave_telefone(phone_key)` (com e sem o nono dígito são a mesma linha) e exige a clínica liberada (23503) |

**Por que `phone_key` e não `contact_id`:** o admin da clínica edita `contact.phone_e164`. A checagem é no telefone que enviou (na ingestão, E3) e no de destino, logo antes do provedor (E3).

### 17.4 Funções de decisão

- **`ia_liberacao_vigente(p_clinic_id, p_modos text[])`**, interna (sem `execute` para ninguém, nem `service_role`): clínica da lista **com o interruptor ligado**, ou clínica `e_de_teste` **fora** da lista (que não depende dele); `liberada`; não pausada; `modo` entre `p_modos`; gasto das últimas 24 horas abaixo do teto. Gasto = soma de `ia_uso.custo_microdolar` com `created_at >= now() - interval '24 hours'` (não lê `clinic.timezone`), comparada com `teto_diario_centavos_usd × 10.000`. Sem clínica, sem linha ou sem a linha do interruptor: falso.
- **`ia_pode_atender(p_clinic_id, p_whatsapp_account_id, p_phone_key) returns boolean`**, `stable`, security definer, só `service_role`: `ia_liberacao_vigente(..., ['contatos'])`, número liberado e ativo, da clínica e não removido (e, em clínica fora da lista, de provedor `fake`: uma clínica de teste nunca atende pelo WhatsApp real), e telefone liberado e ativo pela chave canônica (`chave_telefone(p_phone_key)`, então o E.164 sem o nono dígito também serve). Qualquer argumento nulo: falso. É a função que o E3 confere na ingestão, ao enfileirar, no job antes do modelo e logo antes do provedor.
- **`ia_pode_simular(p_clinic_id)`**, mesmas permissões: `ia_liberacao_vigente(..., ['simulador','contatos'])`, sem número nem telefone (simulador da Tela 6, E2).
- **`ia_clinica_liberada(p_clinic_id)`**, para a tela, `execute` para `authenticated` e `service_role`: falso para quem não é membro ativo da clínica nem super admin (e para anon, que nem executa); verdadeiro com a clínica da lista e o interruptor ligado (ou `e_de_teste` fora da lista) e `liberada`. Não olha pausa, modo nem teto (a tela mostra a clínica liberada mesmo pausada; o cartão Ativo/Pausado é do E5).

### 17.5 RPCs de escrita e `ia_desligar`

Todas security definer, `search_path` vazio, `execute` para `authenticated` e `service_role` (a função recusa quem não é super admin). Guarda comum `ia_exigir_equipe_conduzza()` (interna): com sessão, 42501 se não é `is_product_admin()`; sem sessão, só `service_role` ou conexão direta (SQL editor); anon recebe 42501. Cada chamada grava `audit_log` com `action = 'editou'`. **Desde a migration `20261006120000` (17.11),** as três RPCs por clínica usam o guarda `ia_exigir_quem_libera(p_clinic_id)`, que também deixa passar o administrador ativo da própria clínica da lista (ou `e_de_teste`); `definir_interruptor_da_ia` continua com `ia_exigir_equipe_conduzza()`.

| RPC | Faz | Erros | `audit_log` |
|---|---|---|---|
| `definir_interruptor_da_ia(p_ligado, p_motivo default null) returns boolean` | grava a linha única; desligar chama `ia_desligar` com todas as clínicas que têm linha, num bloco à parte: se a varredura falhar, **a flag desligada fica gravada** mesmo assim | 22004 (`p_ligado` nulo), 22023 (motivo > 500) | `entity 'ia_interruptor'`, sem clínica; e `entity 'ia_interruptor_varredura_falhou'` (sem texto) quando a varredura falha |
| `definir_liberacao_da_ia(p_clinic_id, p_liberada, p_modo default null, p_motivo default null) returns boolean` | UPDATE e, sem linha, INSERT; `p_modo` nulo mantém o atual (ou `simulador` na criação) | 22004, 22023 (modo ou motivo), P0002 (clínica), 42501 (T3a) | `entity 'ia_liberacao'`, `entity_id` = clínica |
| `definir_numero_da_ia(p_clinic_id, p_whatsapp_account_id, p_ativo) returns boolean` | idem por número | 22004, 23503, 23514 | `entity 'ia_numero_liberado'`, `entity_id` = número |
| `definir_contato_liberado_da_ia(p_clinic_id, p_telefone_e164, p_rotulo, p_ativo) returns boolean` | normaliza com `chave_telefone`; rótulo nulo mantém o atual | 22004, 22023 (fora de `^\+[1-9][0-9]{7,14}$` ou rótulo > 80), 23503 | `entity 'ia_contato_liberado'`, `entity_id` = linha |

Antes de gravar, as três últimas travam a linha da clínica em `ia_liberacao` (`FOR UPDATE`) e, depois de gravar, chamam **`ia_desligar(array[p_clinic_id])`** na mesma transação. `ia_desligar(p_clinic_ids uuid[]) returns jsonb` (interna, sem `execute` para ninguém) reavalia cada conversa em `ia_atendendo` das clínicas com `ia_pode_atender` e devolve para `aguardando_humano` **só a que perdeu a liberação** (clínica, interruptor, número, telefone, modo ou teto), ligando `awaiting_reply` quando a última mensagem sem nota interna e sem evento é do paciente. Desligar a clínica ou o interruptor devolve todas (no interruptor, a clínica `e_de_teste` fora da lista não depende dele e fica). Jobs `responder_com_ia` pendentes de conversa que não está mais na IA, ou sem `payload.conversation_id`, viram `cancelado` com `last_error = 'ia_desligada'`; o kind nasce no E3 e, até lá, o update não acha nada. **O E3 precisa gravar `conversation_id` no payload do job.** Devolve `{conversas, jobs}`. Nada é enviado.

**Varredura do interruptor à prova de falha.** Em `definir_interruptor_da_ia(false)`, a chamada a `ia_desligar` roda num bloco `begin ... exception when others` com `lock_timeout` de 2 segundos (o valor anterior volta no fim): conversa travada por outra transação, erro numa clínica ou impasse com uma sessão caem no bloco, a flag desligada continua gravada e o `audit_log` ganha `ia_interruptor_varredura_falhou`. O prazo curto existe porque o `statement_timeout` da API (8 s) é um cancelamento que nenhum bloco pega e desfaria a flag junto. Com a flag desligada nada responde, mesmo com conversas ainda em `ia_atendendo`: o E3 reconfere `ia_pode_atender` antes do modelo e antes do envio. As RPCs por clínica continuam sem esse bloco (desligar uma clínica é tudo ou nada).

**Corrida com a sessão (fechada no banco).** As RPCs travam a linha da clínica em `ia_liberacao` (`FOR UPDATE`; o interruptor trava a própria linha no upsert) antes de gravar, e o gatilho `proteger_status_ia_atendendo` trava as mesmas linhas `FOR SHARE` antes de perguntar a `ia_pode_atender`. Quem chega depois espera o commit do outro e, em READ COMMITTED, lê o estado novo (cada comando do plpgsql tira um retrato novo): ou a sessão já vê a liberação desligada (42501), ou a varredura já vê a conversa na IA e a devolve. Sem isso, uma sessão que pusesse a conversa na IA entre a varredura e o commit da RPC a deixava na IA depois do desligamento. Caso raro: se o super admin desliga no mesmo instante em que alguém troca o contato de uma conversa que já está na IA, as duas transações podem se esperar em ordem inversa; o Postgres desfaz uma delas (impasse detectado) e, no interruptor, isso cai no bloco acima. **O E3 precisa tomar as mesmas travas `FOR SHARE`** quando o servidor puser conversa na IA (o gatilho deixa a service role passar).

**Runbook: como desligar.**
- Todas as clínicas: no SQL editor (ou pela tela do super admin, quando existir), `select public.definir_interruptor_da_ia(false, 'motivo');`. Depois, conferir `select ligado from public.ia_interruptor;` (falso) e `select count(*) from public.conversation where status = 'ia_atendendo' and clinic_id = any (public.ia_clinicas_da_fase_controlada());` (zero). Se o `audit_log` mostrar `ia_interruptor_varredura_falhou`, a flag está desligada mas sobraram conversas na IA: repetir a chamada (a varredura roda de novo) ou, no SQL editor, `select public.ia_desligar(array(select clinic_id from public.ia_liberacao));`.
- Uma clínica: `select public.definir_liberacao_da_ia('<clinic_id>', false, null, 'motivo');`. Um número ou um telefone: `definir_numero_da_ia(..., false)` e `definir_contato_liberado_da_ia(..., false)`.
- **Desligar é sempre pela RPC.** `update public.ia_interruptor set ligado = false`, `delete from public.ia_liberacao ...` ou `update public.ia_numero_liberado set ativo = false` direto no SQL editor são **só recuo** (se a RPC não existir ou falhar): desligam sem devolver as conversas, que ficam em `ia_atendendo` sem ninguém responder até alguém rodar `ia_desligar` como acima.

### 17.6 Gatilhos que fecham buracos de hoje

- **`proteger_status_ia_atendendo`** em `conversation` (`before insert or update of status, contact_id`, `when (new.status = 'ia_atendendo')`, security definer): com **sessão** (`auth.uid()` preenchido), entrar em `ia_atendendo` (INSERT, ou UPDATE vindo de outro status) **ou trocar o `contact_id` de conversa que já está nele** exige `ia_pode_atender(clinic_id, whatsapp_account_id, phone_key do contato)`; senão 42501. Antes de perguntar, trava `FOR SHARE` a linha da clínica em `ia_liberacao` e a do interruptor (corrida, 17.5). Vale para todo papel da sessão: administrador, gestor e recepção da clínica liberada quando o telefone (ou o número) não está liberado, o administrador da clínica sem liberação e até o super admin, e também **dentro de RPC security definer** chamada pela sessão (o `auth.uid()` vem do JWT, não do dono da função). Fecha o buraco de hoje: o membro com escrita gravava esse status pelo PostgREST.
  - **Sem sessão passa** (service role, SQL editor; `auth.uid()` nulo), como no molde `proteger_limite_de_numeros`. O servidor é guardado nos outros pontos: nenhum caminho dele faz a IA agir sem passar de novo por `ia_pode_atender`, ao enfileirar, no job antes do modelo e imediatamente antes do envio (E3); e `ia_desligar` devolve para a equipe a conversa que está em `ia_atendendo` sem liberação. Assim as fixtures, o seed e os testes que montam conversa da IA pela service role em clínica fora do programa (onde o status não faz nada: nenhuma IA responde ali) continuam funcionando.
  - Confere a **entrada** no status e a **troca de contato**: a sessão tem UPDATE em `conversation.contact_id` (policy "membro com escrita atualiza conversa"), e sem isso a conversa do telefone da equipe, já na IA, passava a apontar para um paciente sem sair dela (revisão adversarial de 05/10/2026). Mandar `{status: 'ia_atendendo', contact_id: X}` numa conversa que já está na IA também é conferido. O número e a clínica da conversa não mudam depois de definidos (`conversa_ganha_numero`). Conversa que já estava em `ia_atendendo` e não trocou de contato não é reavaliada aqui (isso é `ia_desligar` e o job do E3). Roda depois de `conversa_ganha_numero` (ordem alfabética), que preenche o número no INSERT.
  - **Editar `contact.phone_e164`** (tela Pacientes: recepção, gestão e administrador) muda o `phone_key` do contato sem passar por este gatilho: uma conversa já na IA continuaria nela com um telefone fora de `ia_contato_liberado`. Isso fica **barrado no envio** (E3): a checagem do telefone de destino, logo antes do provedor, usa o `phone_key` atual do contato. Nenhuma mudança em `contact` nesta migration. As funções de produção só tiram conversas de `ia_atendendo` (`ingest_inbound_message`, `pedir_remarcacao_pelo_paciente`) e nenhuma conversa estava nesse status no último ensaio.
- **`proteger_e_de_teste`** em `clinic` (`before insert or update of e_de_teste`, molde `proteger_limite_de_numeros`): com sessão e sem `is_product_admin()`, criar clínica com `e_de_teste = true` ou mudar o valor dá 42501. Service role e o cadastro (`auth.uid()` nulo) passam. T3a confia nesse campo.

### 17.7 `ia_uso` e `llm_preco`

- **`ia_uso`**: uma linha por chamada ao modelo, inclusive do simulador. `clinic_id` (FK cascade), `conversation_id` (FK `conversation`, `on delete set null`), `origem` (`whatsapp`, `simulador`, `avaliacao`), `papel` (`agente`, `verificador`, `classificador`), `modelo` (1 a 100), `tokens_entrada`, `tokens_saida`, `tokens_cache_lidos`, `tokens_cache_gravados` (≥ 0, default 0), `custo_microdolar bigint` (≥ 0; 1 US$ = 1.000.000), `job_id` (sem FK: a fila é podada), `created_at`. Índices `(clinic_id, created_at)` e `conversation_id` parcial. Só o sistema escreve; o super admin lê. Nada de texto. A Tela 6 (17.12, migration `20261006150000`, aplicada em 09/10/2026) acrescenta a coluna `reserva` e as RPCs `reservar_gasto_da_ia` e `acertar_gasto_da_ia`, só da service role: o custo máximo do turno é reservado antes da chamada ao modelo, para o teto valer com chamadas simultâneas.
- **`llm_preco`**: `modelo` PK (`^[a-z0-9][a-z0-9.-]{0,99}$`), `entrada_`, `saida_`, `cache_leitura_` e `cache_escrita_microdolar_por_milhao` (bigint ≥ 0), `vigente_desde`, `fonte` (obrigatória), `created_at`, `updated_at`. Todo autenticado lê; ninguém da sessão escreve; anon não chega. Semeado com `claude-opus-5` (5.000.000 / 25.000.000 / 500.000 / 6.250.000), `claude-sonnet-5` (2.000.000 / 10.000.000 / 200.000 / 2.500.000) e `claude-haiku-4-5` (1.000.000 / 5.000.000 / 100.000 / 1.250.000), vigentes desde 24/06/2026: leitura de cache 0,1x e escrita de cache de 5 minutos 1,25x da entrada.
- **`llm_preco` com a OpenAI** (migration `20261006110000_llm_preco_openai.sql`, só INSERT idempotente com `on conflict (modelo) do update` e o comentário da tabela; ensaiada uma vez em transação desfeita e aplicada depois, conferido em 06/10/2026): `gpt-6-luna` (100.000 / 500.000 / 10.000 / 125.000) e `gpt-6.1-sol` (2.000.000 / 10.000.000 / 100.000 / 2.500.000), na ordem entrada / saída / cache lido / cache gravado, vigentes desde 05/10/2026, da tabela oficial da OpenAI (developers.openai.com/api/docs/pricing, faixa Standard até 272 mil tokens de entrada). Na OpenAI o `input_tokens` da resposta já inclui o cache: o código grava em `tokens_entrada` só a entrada comum (total menos o lido e o gravado) e em `tokens_saida` a saída com o raciocínio (cobrado como saída). A coluna de escrita de cache vale para a escrita de 30 minutos da OpenAI. As chamadas usam `service_tier: "default"` para o preço Standard valer. **As três linhas `claude-*` ficam**, inofensivas: a lista fechada do código não aceita nenhum modelo da Anthropic, `ia_uso` está vazia, e os testes de integração e de RLS do E0 conferem essas linhas; tirar exigiria DELETE sem ganho de segurança. Não há coluna de provedor: o id do modelo já diz de quem é.

### 17.8 3.1: `ai_agent_config` e `knowledge_item`

- **`ai_agent_config`**: `id`, `clinic_id` (FK `clinic`, cascade), `version` (default 1), `status` (`rascunho` ou `publicada`, default `rascunho`; substitui o `published` do desenho original da seção 6), `agent_name` (default `Assistente`, não vazio), `tone` (`formal`, `cordial`, `proximo`), `use_emoji`, `greeting`, `closing`, `skills` (jsonb), `operating_mode` (`24h`, `fora_expediente`, `fallback`), `fallback_minutes` (default 5), `operating_hours` (jsonb), `escalation_rules` (jsonb), `published_at`, `published_by`, `created_at` e `updated_at`. `version > 0`, único `(clinic_id, version)`; `skills` e `escalation_rules` objetos JSON; `fallback_minutes` positivo; CHECK `ai_agent_config_publicacao_coerente` (publicada se e só se `published_at` preenchido). O gatilho `proteger_versao_publicada_do_agente` recusa com **P0001** qualquer UPDATE de versão publicada, para qualquer papel (inclusive voltar a rascunho), e carimba `published_at = now()` e `published_by = auth.uid()` ao publicar (o que o cliente mandar é ignorado). RLS: membro ativo lê; administrador e gestor ativos que escrevem criam, editam e apagam **só rascunho** (a publicada não aparece para UPDATE nem DELETE da sessão; o cascade da clínica a leva). Grants por coluna: a sessão não grava `status`, `published_at` nem `published_by`. **Publicar é do sistema** (E5, depois do filtro de conformidade).
- **`knowledge_item`**: `question` e `answer` não vazias, `source` (`manual`, `correcao_humana`, `documento`), `active`, `created_by` (default `auth.uid()`, a sessão não grava a coluna), `created_at`, `updated_at`. Membro ativo lê; administrador e gestor escrevem e apagam.
- **O que a Tela 6 muda nas duas (17.12, migration `20261006150000`, aplicada em 09/10/2026):** colunas `instrucoes` e `conhecimento`, limites de tamanho, um rascunho por clínica, trava da fase controlada nas duas tabelas, leitura da sessão por coluna (sem `instrucoes`), `version` calculada pelo banco, a sessão **sem INSERT nem DELETE** em `ai_agent_config` (o rascunho só nasce pela RPC e só deixa de ser rascunho ao publicar), o super admin nas policies e as RPCs de rascunho, instruções, publicação e restauração. O que está acima continua valendo onde a 17.12 não diz o contrário.

### 17.9 `ai_decision_log` (tabela fria, 0 linhas em 06/10/2026)

Colunas novas: `aprovado`, `camada` (`regra`, `modelo`, `falha`), `texto_sha256` (`^[0-9a-f]{64}$`), `agente_modelo`, `verificador_modelo`, `versao_filtro`, `versao_prompt`, `config_version`, `job_id` (índice parcial; o gatilho de `message` do E3 procura por ele), `tokens_entrada`, `tokens_saida`, `tokens_cache` (≥ 0) e `gatilho_entrada`. CHECKs:
- `compliance_rule`: `triagem`, `orientacao_clinica`, `promessa_resultado`, `medicamento`, `dosagem`, `diagnostico`, `oferta_casada`, `antes_depois`, `preco_nao_verificado`, `formato_invalido`, `falha_verificador` (as categorias do filtro do E1);
- `escalation_reason`: `sintoma`, `pedido_humano`, `insatisfacao`, `menor_de_idade`, `valor_fora_da_tabela`, `falhas_seguidas`, `assunto_clinico`, `midia_nao_suportada`, `tentativa_de_manipulacao`, `conformidade`, `agente_pediu`, `teto_atingido`, `regra_do_procedimento`;
- `gatilho_entrada`: `sintoma`, `assunto_clinico`, `pedido_humano`, `insatisfacao`, `menor_de_idade`, `valor_fora_da_tabela`, `manipulacao`, `midia`, `mensagem_longa` (os gatilhos de entrada do E1);
- `ai_decision_log_aprovado_coerente`: aprovado exige `texto_sha256`, `compliance_blocked = false` e `compliance_rule` nula.

### 17.10 Códigos de erro, ensaio, provas, ordem de publicação e rollback

**Códigos:** 42501, 22004, 22023, 23503, 23514, 23505 (versão repetida), P0001 e P0002. 40001 e 40P01 nunca são levantados de propósito. Nenhuma mensagem de erro leva telefone.

**Ensaios (três; o terceiro autorizado depois da revisão adversarial, e o último):** em transação desfeita contra a produção, a migration e um bloco de asserts (`scratchpad/e0/asserts.sql`): grants e RLS (`has_function_privilege`, `has_table_privilege`, `has_column_privilege`), lista fechada sem a salud-care, interruptor desligado, `ia_liberacao` vazia, preços; numa clínica `e_de_teste` e numa clínica comum criadas ali, T3a pela RPC e pelo insert direto, a tabela verdade, o teto (do dia nos dois primeiros, de 24 horas no terceiro), o gatilho de status, o desligamento com `awaiting_reply`, o `audit_log`, a versão publicada imutável, os CHECKs de `ai_decision_log` e o cascade da clínica. No segundo ensaio (versão final do gatilho de status), o caso do gatilho prova os dois lados: sem sessão, a conversa de telefone não liberado entra em `ia_atendendo` por INSERT e por UPDATE; com uma sessão simulada (`request.jwt.claims` local à transação), INSERT e UPDATE com telefone não liberado e INSERT em número não liberado dão 42501, e a contraprova (telefone e número liberados) entra. Resultado: todos passaram e ROLLBACK; nada ficou na produção (conferido depois). Antes do ensaio, o mesmo bloco foi rodado num Postgres 17 local (PGlite) com um esboço do schema, inclusive contra duas versões sabotadas do gatilho (uma que deixa a sessão passar e outra que barra a service role): as duas reprovaram. Os caminhos de sessão por papel (admin, recepção, outra clínica, super admin, anon) também foram provados no PGlite, refeitos com a versão final.

**Terceiro ensaio (05/10/2026, depois da revisão adversarial; 2,6 s de transação, ROLLBACK, nada ficou: conferido que a tabela, a função, o gatilho, as colunas novas e as clínicas de ensaio não existem).** O bloco de asserts ganhou uma prova para cada correção: número `uazapi` liberado na clínica `e_de_teste` dá `ia_pode_atender` falso (o `fake` da mesma clínica, verdadeiro); gasto de 25 horas atrás fica fora do teto e o de 23 horas atrás entra; com `clinic.timezone = 'Foo/Bar'` na clínica de ensaio a decisão responde normalmente (antes: 22023); a sessão não troca o `contact_id` de conversa já na IA para telefone fora da lista, nem junto com o status (42501), e o mesmo contato passa; e o gatilho trava `FOR SHARE` a linha do interruptor (o `xmax` dela passa a ser a transação do ensaio). O que não cabe no ensaio foi provado só no PGlite, que não é a produção: a clínica da lista (id de teste123 no esboço) marcada `e_de_teste` obedece ao interruptor (desligado: não atende, não simula, a tela não a mostra liberada e a sessão recebe 42501; ligado: atende, inclusive em número `uazapi`); a varredura do interruptor que falha (gatilho de teste que levanta erro na devolução) deixa a flag desligada gravada, um `audit_log` `ia_interruptor_varredura_falhou` e o `lock_timeout` da transação como estava, e a segunda chamada devolve a conversa; e as travas das RPCs (`FOR UPDATE`) e do gatilho na linha de `ia_liberacao` (`FOR SHARE`), vistas pelo `xmax` entre transações (dentro de uma transação só, as FKs do próprio ensaio já deixam um multixact ali). **Doze sabotagens** da migration, cada uma desfazendo uma das correções (atalho `e_de_teste` antigo na decisão e na tela, sem o filtro de provedor, gatilho só em `status`, retorno cedo sem olhar o contato, teto no fuso, varredura sem bloco, `lock_timeout` sem volta, e cada uma das quatro travas), reprovaram todas. Corrida de verdade (duas conexões) não dá para ensaiar sem aplicar: fica para depois de aplicar, se o dono quiser.

**Provas para rodar depois de aplicar:** `tests/rls/ia-liberacao.test.ts` (nenhum papel lê nem escreve as travas e o gasto; 42501 nas RPCs e nas funções de decisão; `ia_clinica_liberada` por papel; status pela sessão, 42501 para admin, gestor e recepção da clínica liberada com telefone fora da lista e para o admin da clínica sem liberação, com as contraprovas da recepção com telefone liberado e da service role; troca do `contact_id` de conversa já na IA, 42501 para admin, gestor e recepção, com a contraprova do mesmo contato; `e_de_teste`; 3.1 por papel) e `tests/integration/ia-liberacao.test.ts` (lista igual à constante; T3a até para a service role; tabela verdade, inclusive número `uazapi` na clínica de teste e o teto de 24 horas com gasto de 25 e de 23 horas atrás; a service role põe a conversa em `ia_atendendo` sem liberação e o desligamento a devolve; desligamento por telefone, número e clínica, nunca pelo interruptor; `audit_log`; 3.1; preços; CHECKs). Unidade: `tests/unit/ia/liberacao-ambiente.test.ts` (T1 e T2).

**Ordem de publicação:** a migration pode ir **antes** do código: nenhum código lê as tabelas novas e as funções não têm chamador. Aplicar num momento calmo do WhatsApp: `CREATE TRIGGER` em `conversation` e `clinic` e as FKs novas para `conversation` e `whatsapp_account` seguram por instantes um lock nessas tabelas.

**Testes e seed existentes conferidos:**
- `tests/integration/telefone-canonico.test.ts` ("mensagem nova tira a conversa de 'ia_atendendo'"), `tests/e2e/takeover-realtime.spec.ts`, `tests/e2e/fixtures.ts` (conversa "Juliana Dermato") e `scripts/seed/010-conversas.ts` (cinco conversas) põem a conversa em `ia_atendendo` pela **service role**: continuam passando, porque o gatilho barra só sessão (17.6).
- `ai_decision_log.escalation_reason` agora é código com CHECK: `tests/e2e/fixtures.ts` e `scripts/seed/010-conversas.ts` gravavam texto livre (`'paciente descreveu sintoma'` e `'... pós-procedimento'`, que dariam 23514) e passaram a gravar `sintoma`. Os demais que gravam na tabela (`tests/rls/conversas.test.ts`, o seed e o e2e) usam `compliance_rule = 'triagem'`, que está na lista.

**Rollback** (cabeçalho da migration, manual): apagar os gatilhos `proteger_status_ia_atendendo` e `proteger_e_de_teste`; as funções `definir_*_da_ia`, `ia_exigir_equipe_conduzza`, `ia_desligar`, `ia_clinica_liberada`, `ia_pode_simular`, `ia_pode_atender`, `ia_liberacao_vigente` e as de gatilho; as tabelas `ia_contato_liberado`, `ia_numero_liberado`, `ia_liberacao`, `ia_interruptor`, `ia_uso`, `llm_preco`, `knowledge_item` e `ai_agent_config`; `ia_clinicas_da_fase_controlada`; e, em `ai_decision_log`, os CHECKs novos, o índice `ai_decision_log_job_idx` e as colunas novas.

### 17.11 Liberação pela tela (aba Agente de IA, 06/10/2026, migration `20261006120000_ia_liberacao_pela_tela.sql`)

Decisão do dono em 05/10/2026: ligar a IA na clínica, escolher o número e cadastrar os telefones da equipe passa a ser feito numa aba de Configurações (**Agente de IA**, Tela 12 do brief) que **só existe na teste123 e na Conduzza Teste**. Quem altera: o **administrador** ativo dessas duas clínicas e o super admin; o gestor só lê; recepção, profissional e leitura nem leem (não chegam a Configurações, e a policy também não deixa). O interruptor geral continua só do super admin. A migration é só de funções e policies (nenhuma linha nova, nada liga) e **não muda** T3a, `ia_pode_atender`, `ia_pode_simular`, `ia_desligar` nem `definir_interruptor_da_ia`.

- **Guarda novo `ia_exigir_quem_libera(p_clinic_id)`** (interno, sem `execute` para ninguém), nas três RPCs por clínica (`definir_liberacao_da_ia`, `definir_numero_da_ia`, `definir_contato_liberado_da_ia`), que são recriadas com o corpo do E0 linha a linha, com o guarda trocado (e, em `definir_numero_da_ia`, a regra de um número por vez, abaixo). Passam: sem sessão, a `service_role` e o SQL editor (anon, 42501); com sessão, o super admin e o administrador **ativo** da clínica informada (`user_has_role(p_clinic_id, array['admin'])`) quando ela está em `ia_clinicas_da_fase_controlada()` **ou** é `e_de_teste`. Gestor, recepção, profissional, leitura, pendente, inativo, administrador de outra clínica e administrador de clínica fora da lista: **42501**, antes de qualquer gravação. Numa clínica fora da lista que tenha linha (só acontece se ela deixou de ser de teste), o administrador recebe 42501 até para desligar, que T3a deixaria passar: o recusado é o guarda.
- **Um número por vez, no banco** (`definir_numero_da_ia` com `p_ativo` verdadeiro): depois do `FOR UPDATE` da linha da clínica em `ia_liberacao`, desliga os outros números ativos da **mesma** clínica (`alterado_por` de quem chamou, uma linha de `audit_log` `editou`/`ia_numero_liberado` por número desligado) e só então grava o escolhido. Tudo na mesma transação: se a gravação do escolhido falha (23503 de outra clínica, 23514 removido), os outros continuam como estavam. Duas chamadas ao mesmo tempo, cada uma ligando um número, terminam com um só (a segunda espera o commit da primeira na trava e desliga o dela). Desligar (`p_ativo` falso) não mexe nos outros. `ia_desligar` roda depois, como antes, e devolve para a equipe as conversas do número desligado. Não há índice único parcial: a regra vale para a escrita pelas RPCs (a única que a sessão tem); o SQL editor continua podendo gravar direto.
- **Leitura**: policies de `select` `"gestao le a liberacao da ia"`, `"gestao le os numeros liberados para a ia"` e `"gestao le os telefones liberados para a ia"`, todas com `ia_membro_ve_a_liberacao(clinic_id)` (security definer, `stable`, `execute` para `authenticated` e `service_role`, não para anon): verdadeiro só para o **administrador ou o gestor ativo** da clínica (os papéis que chegam a Configurações) quando ela está na lista ou é `e_de_teste`. Recepção, profissional, leitura, pendente e inativo leem zero linhas, mesmo da própria clínica. As policies do E0 (super admin lê tudo) continuam. `ia_contato_liberado` guarda telefone da **equipe**, não de paciente: a leitura não vai para a trilha.
- **`ia_interruptor_ligado()`**: `stable`, security definer, `execute` para `authenticated` e `service_role`: só o booleano do interruptor geral (sem a linha, falso). A tela mostra o estado a quem não é super admin; a linha de `ia_interruptor` continua só do super admin.
- **O que a tela faz com isso** (Server Actions de `app/(app)/configuracoes/ia-liberacao-actions.ts`, sempre com a sessão): a aba e as ações só existem na clínica ativa da lista (`abaDaIaVisivel`, em `lib/queries/ia-liberacao.ts`, pela constante `CLINICAS_DA_FASE_CONTROLADA`); a ação confere de novo administrador ou super admin. Número e telefone exigem a linha de `ia_liberacao` (FK): sem ela, a ação cria a linha **desligada** (`definir_liberacao_da_ia(..., false)`) antes. Um número por vez: uma chamada só a `definir_numero_da_ia` (o banco desliga os outros); só número conectado é escolhido. Telefone novo que já é de um contato da clínica (`contact.phone_key` = `chaveDeTelefone` do telefone, na clínica ativa) não entra sem a confirmação explícita: a ação recusa com "Este telefone já é de um contato da clínica (Nome). Só confirme se for de alguém da equipe." e só grava com `confirmarContato` marcado; mostrar o nome grava a leitura na trilha (`leu`/`ficha_paciente`, com o id do contato). "Conversar com a equipe" (modo `contatos`) exige um número escolhido e ao menos um telefone ligado. Os tetos continuam só pelo SQL editor (a tela só mostra o teto de gasto). Cada RPC grava a trilha, com o `user_id` de quem mudou.
- **Lembrete de defesa em profundidade:** a liberação pela tela não faz a IA agir sozinha. Continuam valendo o interruptor geral (super admin) e as travas de ambiente T1 e T2 (Vercel). A tela mostra "Ligado, mas parado" com o motivo enquanto alguma delas diz não.

**Ensaios:** duas vezes em transação desfeita contra a produção (o limite). **Segundo e último** (05/10/2026, depois das correções de um número por vez e da leitura só de administrador e gestor; sha256 do arquivo ensaiado `e1be1914757423f7a10206a522d977ba57429e82f04c1a162e1c9aed4ea28759`, que é o arquivo atual): os asserts do primeiro, mais a função de leitura com o papel e as policies com o nome novo; ligar o segundo número desliga o primeiro na mesma chamada; uma chamada que falha adiante (23503) não desliga nada; desligar um número não mexe no outro; a trilha do administrador com cinco linhas (duas do número desligado); o gestor sintético, trocado para recepção e depois para leitura dentro da transação, lê zero linhas e `ia_membro_ve_a_liberacao` falso, e continua com 42501 nas RPCs. Tudo passou e foi desfeito (conferido depois: nenhuma função, policy, clínica ou vínculo ficou). Antes, no PGlite, o cenário largo passou e onze sabotagens reprovaram todas (as seis do primeiro ensaio e mais: leitura de todo papel, dois números ligados, desligar número de outra clínica, desligar que desliga os outros, número desligado sem trilha). **Primeiro** (05/10/2026; sha256 `f6e579977c02ab54d7cf5de586f591b00ea627ea83db136cffaa55d510b9c577`, versão anterior do arquivo), com a migration e um bloco de asserts: grants e policies (nenhuma de escrita; `ia_interruptor` e `ia_uso` sem policy nova; o interruptor com o guarda antigo; as três RPCs com o guarda novo); numa clínica `e_de_teste` criada ali, o administrador (usuário sintético) lê a linha, o número e o telefone da clínica, escreve pelas três RPCs (modo, troca de número, telefone sem o nono dígito gravado pela chave canônica) e recebe 42501 no interruptor e na outra clínica; o gestor lê e recebe 42501 nas três; numa clínica que deixou de ser de teste com linha, o administrador não lê e recebe 42501 até para desligar; anon recebe 42501 em `ia_interruptor_ligado` e na tabela; a trilha tem as quatro escritas do administrador e nenhuma de quem foi recusado; o interruptor e as clínicas reais ficaram como estavam. Tudo passou e foi desfeito (conferido depois: nenhuma função, policy, clínica ou vínculo ficou). Antes, o mesmo cenário e um mais largo (pendente, inativo, a clínica da lista pela id de teste123, super admin sem vínculo) rodaram num Postgres 17 local (PGlite, com o esboço do schema do E0), e seis sabotagens da migration (gestor passando no guarda, guarda sem a lista, leitura sem a lista, leitura de pendente, guarda antigo, anon passando) reprovaram todas. **Aplicada** depois (conferido em 06/10/2026 na lista de migrations da produção).

**Provas para rodar depois de aplicar:** `tests/rls/ia-liberacao.test.ts` (administrador e gestor leem as três tabelas da própria clínica; recepção e leitura da própria clínica, pendente, outra clínica e clínica fora da lista leem zero; `ia_membro_ve_a_liberacao` e `ia_interruptor_ligado` por papel; o administrador escreve nas três RPCs com a trilha no nome dele, um número por vez, e o 23503 não muda nada; gestor, recepção, leitura, pendente, outra clínica, clínica fora da lista e anon recebem 42501; ninguém da clínica mexe no interruptor. A clínica F só deixa de ser `e_de_teste` dentro dos testes que precisam e volta no `finally`; a consulta de limpeza manual está no cabeçalho do arquivo) e `tests/integration/ia-liberacao.test.ts` (a leitura da tela contra o banco real, `ia_interruptor_ligado` e um número por vez com a trilha). E2E: `tests/e2e/configuracoes.spec.ts` (a aba não aparece na clínica do e2e, nem por `?aba=ia`).

**Ordem de publicação:** a migration vai **antes** do código da aba (sem as policies, a aba lê zero linhas e mostraria a clínica como desligada). Sem lock em tabela quente.

**Rollback** (cabeçalho da migration, manual): tirar a aba do ar; apagar as três policies novas (`"gestao le ..."`), `ia_membro_ve_a_liberacao(uuid)` e `ia_interruptor_ligado()`; recriar as três RPCs com o corpo e o comentário de `20261006100000` (guarda `ia_exigir_equipe_conduzza()`, sem o bloco de um número por vez); apagar `ia_exigir_quem_libera(uuid)`.

### 17.12 Tela 6: configuração, publicação e versões do agente (06/10/2026, migration `20261006150000_tela_do_agente.sql`)

Plano aprovado pelo dono em 06/10/2026 ("pode"): a Tela 6 (Agente de IA) com a configuração, o motor do agente (E2, `docs/03`, seção 14) e o simulador, só na teste123 e na Conduzza Teste. Esta migration dá ao banco o que a tela e o motor usam. Depois da construção, passou por uma revisão adversarial em 06/10/2026 (backlog, Fase 3, entrada "E2 e a Tela 6") e o **próprio arquivo** foi corrigido (nada de migration nova); esta seção descreve o arquivo corrigido. **Ensaiada três vezes em transação desfeita contra a produção** (a primeira antes da revisão; o cenário e o rollback depois das correções; os ensaios autorizados acabaram) **e aplicada em 09/10/2026 com o ok do dono** (sha256 do arquivo aplicado, o mesmo do segundo e do terceiro ensaio: `4e8d850ec193478f124c0932a09803b0cd47f987bd5c9a63cc05a664d1d7253c`; qualquer mudança no arquivo exige novo ensaio). Os tipos de `lib/supabase/database.types.ts` ganharam só acréscimos escritos à mão no formato gerado (as duas colunas de `ai_agent_config`, a coluna `reserva` de `ia_uso`, as sete RPCs e as quatro funções internas) e precisam ser regenerados depois de aplicar.

**Decisões do dono (06/10/2026) que mexem no banco:**
- **Instruções do assistente:** texto livre de até 2.000 caracteres por clínica que **só a equipe Conduzza** (super admin, `is_product_admin()`) escreve e lê. A sessão não tem grant nenhum na coluna: leitura e escrita só pelas RPCs `instrucoes_do_agente` e `definir_instrucoes_do_agente`. O motor (service role) lê direto. As travas do CFM continuam no filtro de saída (E1), nunca nesse texto.
- **Só nas clínicas da fase controlada:** fora da teste123 e da Conduzza Teste nem a service role grava configuração nem base (clínica `e_de_teste` passa, para as suítes, como no E0).
- **Papéis:** administrador e gestor ativos com escrita configuram e publicam; o super admin edita tudo; recepção, profissional e leitura não gravam. Membro ativo continua lendo pela API (a tela tira profissional e leitura pela guarda da rota).
- **A base é versionada junto da configuração:** `knowledge_item` é a base viva, o rascunho da base; publicar congela os itens ativos dentro da versão. Editar a base não muda o agente até publicar (resolve a lacuna "base com versionamento" da 3.1 e da spec 2.11).

**Colunas, limites e índice:**

| Onde | O quê | Regra |
|---|---|---|
| `ai_agent_config.instrucoes` | `text`, nulo | `ai_agent_config_instrucoes_tamanho`: até 2.000 (`char_length`). Sem grant para a sessão |
| `ai_agent_config.conhecimento` | `jsonb not null default '[]'` | `ai_agent_config_conhecimento_lista`: array. `[{id, pergunta, resposta}]` dos itens **ativos**, na ordem `created_at, id`, gravado só por `publicar_agente`; no rascunho fica `[]`. A sessão lê e não grava |
| `ai_agent_config.agent_name` | | `ai_agent_config_nome_tamanho`: até 40 |
| `ai_agent_config.greeting` e `closing` | | `ai_agent_config_saudacao_tamanho` e `ai_agent_config_encerramento_tamanho`: até 300 |
| `knowledge_item.question` e `answer` | | `knowledge_item_pergunta_tamanho` (200) e `knowledge_item_resposta_tamanho` (600) |
| `ai_agent_config_um_rascunho` | índice único parcial `(clinic_id) where status = 'rascunho'` | um rascunho por clínica; numa criação simultânea a segunda leva 23505 (dentro das RPCs vira CZ409) |
| `ia_uso.reserva` | `boolean not null default false` | a linha de reserva do gasto (abaixo, "Gasto reservado antes da chamada"). Tabela fria, 0 linhas em 06/10/2026 |

Os limites espelham `LIMITES_DO_AGENTE` de `lib/domain/agente/config.ts` (nome 40, saudação 300, encerramento 300, instruções 2.000, pergunta 200, resposta 600, 60 perguntas ativas). A resposta da base fica abaixo dos 700 caracteres do filtro de saída porque o agente pode repeti-la quase inteira. O Zod conta caracteres por `.length` (UTF-16), régua mais estrita que o `char_length` do banco: o que passa no Zod sempre passa no CHECK.

**Formato dos jsonb que a tela grava** (o banco só confere que são objeto; o formato é do código, `lib/domain/agente/config.ts`):
- `skills`: `{ responder_duvidas, informar_preco_e_convenio, passar_para_equipe }`, booleanos. Na leitura, chave desconhecida é ignorada, as travadas (`responder_duvidas` e `passar_para_equipe`) valem sempre ligadas e a ausente vale o padrão (as três ligadas). Ao salvar, a action junta com o `skills` gravado, para não apagar chave de leva futura.
- `operating_hours`: o expediente direto, `{ dom: {aberto, inicio, fim}, seg: ..., sab: ... }`, horas `HH:mm`. Dia **aberto** exige as duas horas no formato e o fim depois do início (o expediente não vira a noite; vale do início, incluso, ao fim, excluso). Dia **fechado** não valida as horas (a tela as esconde) e guarda as que estão no formato, mesmo com o fim antes do início, para voltarem quando o dia reabrir; hora fora do formato num dia fechado vira a padrão. A ida e a volta do banco preservam `aberto`: dia fechado continua fechado; dia aberto com hora inválida continua aberto, nas horas padrão; só o dia que nem diz se abre cai no padrão dele.
- `operating_mode` e `fallback_minutes` como no E0; a tela aceita de 1 a 120 minutos (o banco só exige positivo).
- `escalation_rules` não é usado nesta leva (fica `{}`): os 6 gatilhos obrigatórios são do código.

**Versão.** O rascunho nasce com `max(version) + 1` da clínica; ao publicar, vira a **maior publicada + 1**. As publicadas ficam em sequência, na ordem de publicação, mesmo que um rascunho tenha sido inserido direto pelo sistema (service role ou SQL editor) com outro número (no ensaio, a versão 50 publicou como 2). A última publicada é a de maior `version`. A sessão não muda `version` e **não cria nem apaga versão**: o rascunho só nasce por `garantir_rascunho_do_agente` e só deixa de ser rascunho ao publicar.

**Trava da fase controlada.**
- `agente_exigir_fase_controlada(p_clinic_id)` (interna, sem `execute` para ninguém): **42501** "O agente de IA ainda não está disponível nesta clínica." quando a clínica não está em `ia_clinicas_da_fase_controlada()` nem é `e_de_teste` (ou não existe). Mesma regra de T3a (17.2).
- Gatilho **`agente_so_na_fase_controlada`** (BEFORE INSERT OR UPDATE, security definer) em `ai_agent_config` e em `knowledge_item`: chama a função acima para **qualquer papel**, service role e super admin inclusive. O nome começa com "a" de propósito: gatilhos BEFORE do mesmo evento rodam em ordem alfabética, e este vem antes de `proteger_versao_publicada_do_agente` e de `set_updated_at`. Única exceção: o UPDATE da FK `on delete set null` do autor (`published_by` em `ai_agent_config`, `created_by` em `knowledge_item`, passado em `tg_argv[0]`), que só anula o carimbo quando a pessoa sai de `auth.users`; sem ela, apagar a pessoa travaria. A sessão não tem grant nessas colunas e não chega nessa exceção.

**Publicada imutável, com o autor vindo do servidor.** `proteger_versao_publicada_do_agente` é recriada (CREATE OR REPLACE: mesmo dono, grants e gatilho) com duas mudanças:
- `published_by = coalesce(auth.uid(), GUC conduzza.agente_publicado_por)`. A GUC é local, ligada **só** por `publicar_agente` durante o UPDATE e devolvida ao valor anterior logo depois (o PostgREST não expõe `set_config`), no padrão de `conduzza.agendada_pelo_sistema`. Sem isso, a publicação pela service role deixaria o autor vazio.
- A publicada continua com **P0001** "Versão publicada não muda: crie uma nova versão." para qualquer mudança, menos a mesma FK `on delete set null` de `published_by` (antes, apagar uma pessoa que publicou dava P0001). Hoje é só defensiva: `audit_log.user_id` não tem ação na FK e já impede apagar quem tem trilha.
- No rascunho, `published_at` e `published_by` ficam nulos.

**Grants e policies.**
- **Leitura por coluna:** `revoke select` de tabela em `ai_agent_config` e `grant select` em todas as colunas **menos `instrucoes`**. Para o código: **nunca `select *` nem `.select()` sem colunas** nessa tabela pela sessão (dá 42501); as leituras usam a lista explícita (`COLUNAS_DA_CONFIG_DO_AGENTE`, em `lib/queries/agente.ts`). UPDATE continua por coluna (E0), sem `instrucoes`, `conhecimento`, `status` nem os carimbos; `update (version)` sai.
- **A sessão não cria nem apaga versão** (revisão de 06/10/2026, achados 1 e 13): `revoke insert, delete on table public.ai_agent_config from authenticated` (o REVOKE de tabela leva junto o INSERT por coluna do E0) e as policies `"gestao cria versao do agente"` e `"gestao apaga rascunho do agente"` saem sem ser recriadas. Antes, um administrador ou gestor que criasse o rascunho direto pela API (o rascunho nascia com `instrucoes` nulas) ou apagasse o rascunho jogava fora as instruções do super admin e publicava sem elas. As RPCs são security definer e não dependem desses grants.
- **Policies que ficam** (recriadas com os mesmos nomes): em `ai_agent_config`, leitura para membro ativo **ou super admin** e edição **só do rascunho** para administrador ou gestor com escrita (`user_has_role(..., array['admin','gestor']) and user_can_write(...)`) **ou super admin**; em `knowledge_item`, as 4 (ler, criar, editar e apagar) com a mesma regra. O super admin entra nas policies porque as Server Actions gravam pela sessão e a decisão do dono diz que ele edita tudo, mesmo sem vínculo com a clínica.
- `llm_preco` não muda. `ia_uso` ganha só a coluna `reserva` e as duas RPCs do gasto; continua sem escrita para a sessão (só a service role) e com a leitura só do super admin.

**Funções internas** (`search_path` vazio, sem `execute` para ninguém; rodam dentro das RPCs security definer e do gatilho da fase):
- `agente_exigir_quem_configura(p_clinic_id)`: sem sessão, só service role ou SQL editor (anon, 42501); com sessão, super admin ou administrador ou gestor **ativo** da clínica com escrita. Recepção, profissional, leitura, pendente e outra clínica: **42501** "Somente o administrador ou o gestor da clínica configura o agente de IA.".
- `agente_exigir_equipe_conduzza()`: sem sessão, service role ou SQL editor; com sessão, só super admin. Senão **42501** "Somente a equipe Conduzza mexe nas instruções do assistente.".
- `agente_garantir_rascunho(p_clinic_id)`: o núcleo de garantir, sem guarda de papel (quem chama já conferiu). Trava consultiva por clínica (`pg_advisory_xact_lock(hashtextextended('ai_agent_config:' || clinic, 0))`), que serializa garantir, publicar, restaurar e definir instruções da mesma clínica. Devolve o rascunho ou cria um copiando a última publicada (inclusive as instruções; a base do rascunho é a viva) ou com os padrões da tabela, com `version = max + 1`. Só um INSERT direto do sistema (service role ou SQL editor) escapa da trava; o índice de um rascunho barra a corrida e o 23505 vira **CZ409** "O agente de IA foi alterado ao mesmo tempo por outra pessoa. Tente de novo.". Grava `audit_log` `criou_rascunho_do_agente` só quando cria.
- `agente_exigir_fase_controlada(p_clinic_id)`, descrita na trava da fase.

**RPCs** (security definer, `search_path` vazio, nomes qualificados, `revoke` de public e anon; nenhum texto em `audit_log`):

| RPC | `execute` | Faz | Erros | `audit_log` |
|---|---|---|---|---|
| `garantir_rascunho_do_agente(p_clinic_id uuid) returns uuid` | `authenticated`, `service_role` | quem configura e fase; devolve o id do rascunho, criando se faltar | 22004 "Informe a clínica.", 42501, CZ409 | `criou_rascunho_do_agente`, quando cria |
| `instrucoes_do_agente(p_clinic_id uuid) returns text` | `authenticated`, `service_role` | só a equipe Conduzza; as instruções do rascunho, ou da última publicada sem rascunho (nulo sem versão) | 42501, 22004 | não grava (texto da equipe, não de paciente) |
| `definir_instrucoes_do_agente(p_clinic_id uuid, p_instrucoes text) returns void` | `authenticated`, `service_role` | só a equipe Conduzza; fase; grava no rascunho (garante o rascunho), sem espaços nas pontas, vazio vira nulo | 42501, 22004, 22023 "As instruções do assistente têm no máximo 2.000 caracteres." | `editou_instrucoes_do_agente` |
| `publicar_agente(p_clinic_id uuid, p_autor uuid, p_conferido_em timestamptz) returns jsonb` | **só `service_role`** | abaixo | 22004 "Informe a clínica, quem publica e o que foi conferido.", 42501, P0002 "Não há alterações para publicar.", **CZ409** "O agente mudou enquanto você publicava. Confira e publique de novo.", 22023 | `publicou_agente`, no nome do autor |
| `restaurar_versao_do_agente(p_clinic_id uuid, p_versao integer) returns uuid` | `authenticated`, `service_role` | abaixo | 22004 "Informe a clínica e a versão.", 42501, P0002 "Versão não encontrada." (inexistente ou não publicada) | `restaurou_versao_do_agente` (no rascunho) |
| `reservar_gasto_da_ia(p_clinic_id uuid, p_origem text, p_custo_microdolar bigint) returns uuid` | **só `service_role`** | abaixo ("Gasto reservado") | 22004 "Informe a clínica, a origem e o custo.", 22023 (custo negativo; origem fora de `simulador` e `whatsapp`) | não grava (a linha de `ia_uso` é o registro) |
| `acertar_gasto_da_ia(p_reserva uuid, p_linhas jsonb) returns void` | **só `service_role`** | abaixo ("Gasto reservado") | 22004 "Informe a reserva e as linhas do gasto.", 22023 (não é lista, mais de 50 linhas, linha de outra clínica ou origem), P0002 "Reserva de gasto não encontrada.", 23514 (papel inválido) | não grava |

**Publicar** (`publicar_agente`, chamada pela Server Action com o cliente de serviço e o autor da sessão, depois do filtro de conformidade em TypeScript):
1. Argumento nulo: 22004. `p_autor` tem de ser administrador ou gestor **ativo** da clínica (`clinic_member`) ou super admin (`product_admin`); senão 42501 "Somente o administrador ou o gestor da clínica publica o agente de IA.".
2. Fase controlada (42501) e a trava consultiva da clínica.
3. O rascunho `FOR UPDATE`; sem rascunho, P0002.
4. **Um comando só** lê de `knowledge_item` da clínica o maior `updated_at` (de todos os itens, ativos e inativos), a contagem dos ativos e a base congelada: o carimbo e o que vai ser congelado saem do mesmo retrato.
5. **A prova de que o congelado é o conferido** (achados 17 e 36): `p_conferido_em` é o maior `updated_at` entre o rascunho e todos os itens da base, como a action os leu para rodar o filtro (`conferidoEm` de `carregarConfigDoRascunho`, `lib/agente/contexto.ts`). A action lê em sequência: o rascunho, **depois** a base, e o rascunho de novo; se ele mudou no meio (outra aba, ou um restaurar, que grava rascunho e base juntos), lê tudo outra vez (até 3 vezes; depois, "tente de novo"). Se o recalculado aqui, cortado em milissegundos (o `Date` do JS corta os microssegundos), for maior que ele, alguém escreveu depois da conferência (pela tela ou direto pela API) e a publicação é recusada com **CZ409**, sem congelar nada nem gravar trilha. Nunca `now()`. Apagar um item sem mexer em outro pode baixar o maior `updated_at` e passa: tirar conteúdo não cria problema no filtro. **A janela que sobra** é o tempo de uma transação de escrita concorrente (alguns milissegundos, não "microssegundos", como diz o comentário da função na migration): uma escrita cuja transação começou antes da leitura da action e terminou depois leva `updated_at` = `now()` do começo dela (`set_updated_at`) e pode ficar abaixo do carimbo. O que passar por essa janela ainda enfrenta as duas travas de cada turno: o motor descarta item ou instrução que não passa nas regras (`docs/03`, seção 14) e o filtro de saída confere toda resposta.
6. Mais de 60 perguntas ativas: 22023 "A base tem mais de 60 perguntas ativas. Desative ou exclua algumas antes de publicar." (espelha `LIMITES_DO_AGENTE.itensDaBase`: cada pergunta ativa vai em toda chamada do modelo).
7. Congela em `conhecimento` os itens **ativos** como `{id, pergunta, resposta}`, na ordem `created_at, id` (a mesma em que a tela lista a base); `status = 'publicada'` e `version` = maior publicada + 1, com a GUC do autor ligada só durante o UPDATE; o gatilho carimba `published_at = now()` e `published_by = p_autor`.
8. Devolve `{"versao": n}`.

**Restaurar** (`restaurar_versao_do_agente`, achados 3 e 5): garante o rascunho e copia para ele todos os campos da versão publicada pedida, **inclusive as instruções**; depois a base viva passa a valer como a congelada daquela versão **sem apagar nada**: o item ativo que não está nela fica **desativado** (`active = false`; guardado, dá para reativar no Conhecimento; os já desativados ficam como estão); o que está nela fica com o texto dela e ativo; e volta com a **mesma id** o que tinha sido excluído (com `source 'manual'`, `created_by` de quem restaurou e `created_at` de agora, então vai para o fim da lista). Antes, restaurar apagava de vez os itens fora da versão, inclusive os desativados. Não publica: a pessoa confere e publica. A RPC grava `restaurou_versao_do_agente` com o id do rascunho; a Server Action grava também `versao_restaurada_do_agente` com o id da versão publicada que voltou, sem texto.

**Gasto reservado antes da chamada** (achados 7, 15 e 21). O teto diário (`ia_liberacao_vigente`) só via o `ia_uso` dos turnos que já tinham terminado: N simulações ao mesmo tempo passavam todas pela trava e o teto estourava em N turnos; e a chamada cortada por prazo ou erro de rede não gravava nada. Agora:
- **`reservar_gasto_da_ia`** (só service role): sob uma trava consultiva por clínica (`ia_uso:<clínica>`; a função não é `stable` de propósito, cada comando lê o que já foi gravado antes da trava), confere as travas de `ia_liberacao_vigente` (origem `simulador`: modos `simulador` e `contatos`; `whatsapp`: só `contatos`) e a soma das últimas 24 horas **mais o valor pedido** contra o teto, com a mesma comparação estrita da trava (gasto menor que o teto; assim, com a reserva feita, a trava continua verdadeira durante o turno que a reservou). Se cabe, grava uma linha de reserva em `ia_uso` (papel `agente`, modelo `reserva`, tokens 0, `reserva = true`), que já soma no teto para as próximas, e devolve o id. **NULL** quando passaria do teto ou quando a liberação caiu entre a conferência do servidor e a reserva (nada gravado; o motivo exato o servidor tira de `ia_pode_simular`, que chama antes). A trava de transação dura só a RPC: por isso a reserva fica gravada, e não a trava.
- **`acertar_gasto_da_ia`** (só service role): apaga a reserva e grava as linhas reais na **mesma transação** (quem soma o gasto vê uma ou outra, nunca as duas nem nenhuma). `p_linhas` é a lista que `lib/agente/uso.ts` monta (`LinhaDoUso`: uma por chamada ao modelo, até 50); `clinic_id` e `origem` saem da reserva (se vierem na linha, têm de ser os mesmos); lista vazia só desfaz a reserva. Qualquer erro desfaz tudo e a reserva fica. Sem trava: a troca é atômica, e um gasto real acima da reserva só fecha a próxima.
- **Reserva não acertada** (o processo morreu no meio) continua somando no teto até sair da janela de 24 horas: conservador.
- O que o servidor reserva (o custo máximo do turno) e como acerta (uma linha por chamada, inclusive as abortadas) está no `docs/03`, seção 14.

**O que o servidor faz com isso** (`app/(app)/agente/actions.ts`; o motor em `lib/agente/`, `docs/03`, seção 14):
- Toda Server Action confere sessão, clínica ativa da fase (`abaDaIaVisivel`, a mesma lista `CLINICAS_DA_FASE_CONTROLADA`) e papel (administrador ou gestor pela matriz, ou super admin) antes de qualquer gravação; o banco confere de novo (RLS, gatilho da fase e guardas das RPCs).
- **Persona, habilidades e horário:** `garantir_rascunho_do_agente` e UPDATE pela sessão no rascunho (zero linhas atualizadas vira "alterado ao mesmo tempo"). Trilha `editou_persona_do_agente`, `editou_habilidades_do_agente` e `editou_horario_do_agente`.
- **Base:** INSERT, UPDATE e DELETE de `knowledge_item` pela sessão, com o rascunho garantido **antes** da escrita e **de novo depois** dela (achado 19: se alguém publicou entre os dois passos, a mudança caía numa base sem rascunho e a tela dizia que não havia o que publicar). Criar ou ativar a 61ª pergunta ativa é recusado na action. Trilha `criou_item_da_base`, `editou_item_da_base`, `ativou_item_da_base`, `desativou_item_da_base` e `excluiu_item_da_base` (`entity 'knowledge_item'`).
- **Texto da clínica** (nome, saudação, encerramento, pergunta, resposta e instruções) passa por `problemaNoTextoDoAgente` antes de gravar: as regras determinísticas do filtro de saída com contexto vazio recusam telefone, CEP, e-mail, CPF, link, R$, percentual, as vedações do CFM e palavras de bastidor, com a mensagem de recepcionista. No nome, também título de profissional de saúde.
- **Publicar:** lê o rascunho pela service role (com as instruções) e o `conferidoEm`, roda o filtro em tudo o que a versão leva (nome, saudação, encerramento, instruções e cada pergunta e resposta **ativa**), recusa se nada mudou em relação à última publicada e só então chama `publicar_agente` com o cliente de serviço, `p_autor` igual ao usuário da sessão e `p_conferido_em`. Problema nas instruções aparece **com o tipo só para o super admin**; para administrador e gestor (que não leem nem corrigem o texto) vira "As instruções da equipe Conduzza precisam de ajuste antes de publicar. Fale com a equipe Conduzza." e um `log.warn` só com a clínica e o tipo (achados 9, 24, 26 e 34).
- **"Instruções da equipe Conduzza" na tela, sem o texto** (achados 16, 25, 28 e 35): a página compara pela service role as instruções do rascunho com as da última publicada, e cada publicada com a anterior, e entrega só os booleanos (`instrucoesMudaram` e as versões que mudaram, `lib/agente/painel.ts`) a **todos** os papéis que veem a tela, recepção inclusive. A linha "Instruções da equipe Conduzza" entra na contagem de alterações, no diálogo de publicar e no "o que mudou" das Versões; leitura que falha não inventa a linha.
- **Simulador:** reserva o custo máximo do turno (`reservar_gasto_da_ia`; NULL vira "O teto de gasto de hoje acabou." ou o motivo exato, e nada é chamado), roda o turno e troca a reserva pelas linhas reais (`acertar_gasto_da_ia`, `origem 'simulador'`, uma linha por chamada ao modelo, de agente, verificador e classificador, inclusive as abortadas, com o custo de `llm_preco`). Grava a trilha `simulou_agente` (sem texto). Nada em `message`, `conversation` nem `ai_decision_log`.
- Erros do banco traduzidos: 42501 (sem permissão), P0001 (publicada não muda), CZ409 e 23505 (alterado ao mesmo tempo; na publicação, "O agente mudou enquanto você publicava. Confira e publique de novo."), 23514 (tamanho), P0002 (sem alterações ou versão não encontrada) e 22023 (mais de 60 ativas).

**Códigos:** 42501, 22004, 22023, 23514, 23505, P0001, P0002 e **CZ409** (corrida rara: outro rascunho no mesmo instante, ou o agente mudou entre a conferência do filtro e a publicação). Nunca 40001 nem 40P01, que o PostgREST repete sem limite. Nenhuma mensagem de erro, `audit_log` ou comentário leva texto da configuração, da base ou de paciente.

**Antes da produção (PGlite):** na construção, um cenário local (esboço do E0, a migration do E0 e esta) cobriu fase, grants por coluna, papéis, um rascunho por clínica, limites, RPCs, publicação com a base congelada e o autor, renumeração, restauração, trilha, as 60 perguntas e a FK `set null`: tudo verde; **cinco sabotagens** (grant, trava da fase, GUC, índice e autor) derrubaram o cenário; e o rollback devolveu um catálogo idêntico ao do E0. Depois das correções, o cenário cresceu (`cenario-2`, o mesmo do segundo ensaio) e **sete sabotagens**, uma por correção, rodaram contra ele: seis reprovaram (sessão com INSERT e DELETE; restaurar que apaga; reserva que não soma o valor pedido; reserva sem a trava por clínica; publicar que ignora o carimbo; carimbo só dos itens ativos). A sétima (comparar o carimbo sem cortar em milissegundos) passa no PGlite, cujo relógio não tem microssegundos; na produção o segundo ensaio confirmou microssegundos no `updated_at` (checagem 8.2), que é o caso que ela quebraria.

**Ensaios na produção (três, o limite; todos em transação desfeita, com troca real de papel, `authenticated`, `anon` e `service_role`, e clínicas e usuários sintéticos):**
- **Primeiro** (06/10/2026, antes da revisão; sha256 `d7341e7efea6f0d9de23b80702519c7b86806ac05ad753fe159bb60df14e58ca`, versão anterior do arquivo): 33 checagens, todas verdadeiras, em 0,44 s; ROLLBACK, e conferido depois que nada ficou (sem colunas novas, sem funções novas, sem clínica de ensaio, zero linhas nas tabelas e na trilha). Inclui: fora da fase nem o sistema grava; recepção, leitura, profissional, pendente e administrador de outra clínica recebem 42501; a sessão recebe 42501 em `instrucoes`, `select *`, `conhecimento`, `version` e `status`; publicar com autor sem papel, nulo, fora da fase e sem rascunho; a publicada imutável até para a service role; o rascunho inserido como versão 50 publica como 2; 61 ativas dá 22023 e 60 publica.
- **Segundo** (06/10/2026, depois das correções; o arquivo atual): o cenário anterior mais uma prova por correção, 39 checagens e a do tempo, todas verdadeiras, em 0,40 s; ROLLBACK. B1: administrador, gestor e super admin não inserem nem apagam versão pela sessão (42501, nem chegam ao índice) e o sistema bate no índice (23505); com rascunho, o administrador não o apaga nem o recria e as instruções ficam. B2: restaurar deixa ativas exatamente as da versão (a excluída volta, a desativada reativa) e a nova e a inativa **ficam**, desativadas. B3: com teto de 10.000 microdólares, 6.000 passa, outros 6.000 dão NULL, 3.999 cabe e 1 a mais dá NULL; a trava segue verdadeira durante o turno; `whatsapp` em modo simulador e clínica sem liberação dão NULL; os erros 22004, 22023, 23514 e P0002 deixam a reserva; acertar troca a reserva pelas linhas reais e de novo dá P0002; lista vazia só desfaz; administrador, super admin e anon recebem 42501 nas duas. B4: carimbo 1 ms velho com um item ativo e um inativo escritos depois dá CZ409, nada publicado nem na trilha; com o carimbo cortado em milissegundos, como o `Date` do JS, publica.
- **Terceiro, o rollback** (06/10/2026, o arquivo atual): na mesma transação, a migration e os passos 1 a 4 do rollback (o passo 3 é o arquivo de corpos anteriores); o retrato do catálogo das três tabelas (ACL, grants por coluna, constraints, índices, policies, gatilhos, a função recriada e os comentários) saiu **idêntico** ao tirado da produção antes; ROLLBACK, e o retrato de depois igual ao de antes.
- O caminho CZ409 de garantir (corrida com um INSERT direto do sistema) não foi exercitado: precisa de duas conexões ao mesmo tempo, e hoje só a service role ou o SQL editor chegam nele.

**Provas para rodar depois de aplicar:** `tests/rls/agente-config.test.ts` (clínica A não lê B; recepção, profissional, leitura, pendente e a B não gravam rascunho nem base e não chamam garantir nem restaurar; administrador e gestor da clínica da fase gravam rascunho e base; **nem administrador nem gestor criam ou apagam versão pela sessão** (42501) e o rascunho e as instruções ficam; um rascunho por clínica (23505 pelo sistema); ninguém grava a publicada; a sessão não lê nem grava `instrucoes`; as RPCs de instruções recusam quem não é super admin; `publicar_agente`, `reservar_gasto_da_ia` e `acertar_gasto_da_ia` recusados para toda sessão e para anon; clínica fora da fase recusa até pela service role) e `tests/integration/agente-config.test.ts` (garantir; limites; publicar congela a base e carimba o autor, e dá CZ409 sem publicar nada quando a base ou o rascunho mudam depois do carimbo; o rascunho seguinte copia a publicada; restaurar deixa ativas as da versão e desativa o resto; 60 perguntas; gasto: sem liberação não reserva, **quatro reservas ao mesmo tempo que juntas passam do teto, só uma passa**, e o acerto troca a reserva). O teste do E0 que a migration quebrava (`tests/rls/ia-liberacao.test.ts`, bloco de versões do 3.1) **já foi ajustado**: o administrador e o gestor abrem o rascunho pela RPC e o editam, e o sistema publica a versão 1 antes de o gestor abrir a 2. Depois, regenerar `lib/supabase/database.types.ts` com `supabase gen types` e conferir o acréscimo feito à mão.

**Ordem de publicação:** a migration vai **antes** do código da Tela 6 (a página lê `conhecimento` e as actions chamam as RPCs). Nenhum código publicado hoje lê ou grava as três tabelas que ela trava, então aplicar antes não muda nada para ninguém. Locks: só tabelas frias (`ai_agent_config`, `knowledge_item` e `ia_uso`, 0 linhas em 06/10/2026), em ACCESS EXCLUSIVE, nesta ordem, com `lock_timeout` de 3 s (se cair por 55P03, nada foi gravado: tentar de novo); nenhuma FK nova e nenhum ALTER em tabela quente. Aplicar só com o ok do dono (o `aplicar.js` já faz o `notify pgrst`).

**Rollback** (cabeçalho da migration, manual; ensaiado no terceiro ensaio): 0) publicar antes o código sem a Tela 6 nova e sem o simulador; 1) apagar `restaurar_versao_do_agente`, `publicar_agente(uuid, uuid, timestamptz)`, `definir_instrucoes_do_agente`, `instrucoes_do_agente`, `garantir_rascunho_do_agente`, `agente_garantir_rascunho`, `agente_exigir_equipe_conduzza`, `agente_exigir_quem_configura`, `reservar_gasto_da_ia` e `acertar_gasto_da_ia`; 2) apagar o gatilho `agente_so_na_fase_controlada` das duas tabelas e as funções `agente_so_na_fase_controlada` e `agente_exigir_fase_controlada`; 3) rodar `supabase/operacao/rollback/20261006150000-corpos-anteriores.sql` (lido da produção): o corpo anterior de `proteger_versao_publicada_do_agente`, as policies (as duas que a migration apagou voltam), os grants (o SELECT de tabela, o UPDATE de `version`, o INSERT por coluna e o DELETE de tabela) e os comentários das tabelas. Esse arquivo **apaga a coluna `instrucoes` antes de devolver o SELECT de tabela** (achados 20 e 39): as instruções do super admin nunca ficam legíveis para a sessão no meio do caminho; 4) apagar o índice `ai_agent_config_um_rascunho`, os CHECKs de tamanho, a coluna `conhecimento` e a coluna `ia_uso.reserva` (reserva que sobrar continua somando no teto como uma linha de modelo `reserva` até sair da janela de 24 horas); 5) `notify pgrst, 'reload schema'`. As linhas de `ai_agent_config` e `knowledge_item` ficam (as publicadas perdem a base congelada e as instruções junto com as colunas).

---

## 18. Mensagem agendada na conversa (06/10/2026, migration `20261006140000_mensagem_agendada.sql`)

Pedido do dono em 06/10/2026 (backlog, entrada "Mensagem agendada na conversa"): a pessoa que está com a conversa escreve uma mensagem para sair **sozinha** numa data e hora, até 1 ano à frente. O motor envia na hora marcada, pelo **mesmo número** da conversa, em nome de quem **assina** a agendada, e a conversa fica com quem assina depois que a mensagem sai. É texto escrito por uma pessoa, nunca modelo nem IA: exceção decidida pelo dono a "mensagem padrão nunca é enviada sozinha" (spec 1.11). Depois da construção, passou por uma revisão adversarial em 06/10/2026 (backlog, entrada "Mensagem agendada na conversa") e o próprio arquivo foi corrigido (nada de migration nova); esta seção descreve o arquivo corrigido. Ensaiada quatro vezes em transação desfeita contra a produção e **aplicada em 06/10/2026** (com o ok do dono; código publicado no commit `7fc9aea`; sha256 do arquivo aplicado, o mesmo do quarto ensaio, `b324ec6e8e5e8f8c3b0c98e0d1d9f46e7c102641336e1f5c02ffe3640eab53b9`). Os tipos de `lib/supabase/database.types.ts` (a tabela e as seis funções chamáveis; `falhas_sem_envio` entra quando forem regenerados) foram escritos à mão no formato gerado e precisam ser regenerados depois de aplicar.

### 18.1 Decisões registradas

- **Do pedido (06/10/2026):** a lista das agendadas fica em cima da caixa de escrever; se o paciente escrever antes, a agendada **não** se cancela sozinha (a tela avisa e a equipe decide); quando sai, a conversa fica com quem assina, e Sem atendente se essa pessoa saiu da equipe; teto de 1 ano à frente, contado no dia civil da clínica.
- **A1, quem assina:** qualquer pessoa que escreve na clínica (`user_can_write`) e **vê** a agendada pela RLS edita texto e hora enquanto ela está `agendada`. O **assinante** é `coalesce(editada_por, criada_por)`: quem editou por último, senão quem criou. Ele é o `author_user_id` da mensagem que sai, a pessoa que fica com a conversa depois do envio e a responsável pela atividade quando a mensagem não sai, sempre que ainda for **membro ativo com escrita** (administrador, gestor, recepção ou profissional; Somente leitura conta como "saiu da equipe").
- **A1, Enviar agora:** quem escreve e está **com** a conversa do número da agendada (`em_atendimento` e responsável = ela) retira a agendada e envia o texto pelo trilho 1:1, em nome **dela**, como resposta digitada.
- **A2, madrugada:** a atrasada (mais de 15 minutos depois da hora marcada) não sai entre 21:00 e 08:00 no fuso da clínica: espera as 08:00 seguintes quando elas caem **até** o prazo (`enviar_em + 12 h`, inclusive: a das 20:00 espera as 08:00, que são o próprio prazo); senão desiste com o motivo **`madrugada`** ("o envio atrasou e cairia de madrugada"; `atrasou` fica só para mais de 12 horas). O executor só desiste por prazo depois de `enviar_em + 12 h + 5 min` (`FOLGA_DA_JANELA_MS`), para a que esperou as 08:00 não morrer por segundos na vez do motor. É regra do executor (`decidirJanelaDaAgendada`, `lib/domain/mensagem-agendada.ts`); o banco só ganhou o motivo `madrugada` (CHECK, texto da atividade e `motivo_da_agendada`), e a planejadora continua criando o job na hora.
- **A3, atividade:** quando a agendada não sai (`nao_enviada` ou `nao_confirmada`), nasce **uma** atividade do CRM para o assinante conferir (18.5).
- **A4, termo da jornada:** a agendada **não** anda o lead; o Enviar agora anda, como qualquer resposta digitada.
- **A5, padrões assumidos que o dono pode trocar:** teto de **10** agendadas ativas por contato (`v_teto` no gatilho; espelho `TETO_DE_AGENDADAS_POR_CONTATO`); **retenção de 30 dias** para a não enviada e a não confirmada que ninguém dispensou; Somente leitura conta como "saiu da equipe"; em Configurações > Equipe, quem gerencia pode cancelar as agendadas de quem perde a escrita (sessão, 18.4).
- **Número fixo:** a agendada nunca troca de número. Número removido não sai; número desconectado espera até o **prazo efetivo** e depois desiste (`prazoEfetivoDaAgendada`: o prazo de `enviar_em + 12 h`, ou as 21:00 antes dele quando dali em diante ela cairia de madrugada; desiste com `desconectado` no primeiro caso e com `madrugada` no segundo). A lista mostra esse mesmo limite.

### 18.2 `mensagem_agendada`

| Coluna | Regra |
|---|---|
| `id` | uuid, PK. A tela gera o id ao abrir o diálogo: o duplo envio cai na mesma linha |
| `clinic_id` | not null, FK `clinic` com cascade |
| `contact_id` | not null, FK `contact` com cascade (a exclusão LGPD leva junto); gatilho `exigir_contato_da_mesma_clinica` no INSERT |
| `whatsapp_account_id` | not null, FK `whatsapp_account` sem ação (só a cascata da clínica apaga): o número é fixo |
| `conversation_id` | FK `conversation` com `on delete set null`: a conversa onde foi agendada; depois de sair, a da mensagem enviada |
| `texto` | dado de paciente. CHECK `texto_da_agendada`: nulo, ou de 1 a 4096 caracteres depois de `btrim` (`char_length`, pontos de código). CHECK `texto_enquanto_vale`: não nulo em `agendada` e `enviando`. Vira nulo quando sai, quando é excluída, quando é dispensada e na retenção: depois de sair, o texto vive em `message`. O CHECK é **mais frouxo** que o código: o domínio, o diálogo e as Server Actions contam em unidades UTF-16 (`texto.length`, a mesma régua do envio 1:1; um emoji conta 2 lá e 1 aqui), para o Enviar agora nunca recusar o que o agendamento aceitou |
| `enviar_em` | timestamptz not null. Futuro e teto ficam no gatilho: nenhum CHECK usa `now()` |
| `situacao` | `agendada` (padrão), `enviando` (o job existe), `enviada`, `nao_enviada` (com certeza não saiu), `nao_confirmada` (pode ter chegado) ou `cancelada`; CHECK `situacao_da_agendada` |
| `motivo` | nulo ou `sem_autorizacao`, `numero_removido`, `numero_desconectado`, `atrasou`, `madrugada`, `canal_ocupado`, `falha_no_envio`, `envio_incerto`, `enviada_agora`; CHECK `motivo_da_agendada`, a mesma lista de `MOTIVOS_DA_AGENDADA` (`tests/unit/agendada/listas-do-banco.test.ts` cruza as duas). `madrugada` (revisão de 06/10/2026): atrasou e cairia na faixa de silêncio com as 08:00 seguintes depois do prazo |
| `criada_por`, `criada_em` | not null, carimbados pelo gatilho (o cliente não manda nem forja) |
| `editada_por`, `editada_em` | quem editou por último (A1) |
| `cancelada_por`, `cancelada_em` | exclusão, Enviar agora e o cancelamento por Equipe |
| `dispensada_por`, `dispensada_em` | dispensar; na retenção, `dispensada_por` fica nulo |
| `job_id` | FK `job_queue` com `on delete set null`; índice único parcial `mensagem_agendada_job` |
| `message_id` | FK `message` com `on delete set null`: a mensagem que saiu, ou a que falhou |
| `atividade_id` | FK `contact_activity` com `on delete set null`; índice único parcial `mensagem_agendada_atividade`. A atividade de "não saiu" (A3); coluna que o desenho não tinha, para a idempotência |
| `enviada_em`, `encerrada_em`, `updated_at` | `enviada_em` é o `created_at` da mensagem que saiu; `encerrada_em` marca o fim (base da retenção) |

- As colunas de usuário apontam para `auth.users` sem ação de exclusão, como `message.author_user_id`.
- **Índices:** `mensagem_agendada_contato (clinic_id, contact_id)` (a lista); `_vencendo (enviar_em) where situacao = 'agendada'` (planejadora); `_enviando (clinic_id, contact_id, whatsapp_account_id) where situacao = 'enviando'` (uma por vez); `_numero (whatsapp_account_id) where situacao in ('agendada','enviando')` (`remover_numero` e a contagem do diálogo de remover); `_autor (clinic_id, coalesce(editada_por, criada_por)) where situacao = 'agendada'` (Equipe); `_conversa` e `_mensagem` parciais (as FKs com `set null`); `_para_reter (encerrada_em)` nas não enviadas e não confirmadas não dispensadas; e o único **`mensagem_agendada_sem_duplicata`** `(clinic_id, contact_id, whatsapp_account_id, enviar_em, md5(texto)) where situacao in ('agendada','enviando')`: a mesma mensagem para o mesmo contato, pelo mesmo número e na mesma hora só existe uma vez enquanto vale (23505).

### 18.2a `falhas_sem_envio() returns text[]` (revisão de 06/10/2026)

Primeira coisa da migration, depois das travas. SQL `immutable parallel safe`, `search_path` vazio, `execute` só para `service_role` (as funções `SECURITY DEFINER` daqui a chamam como donas). Devolve os códigos de falha que **garantem que a mensagem não saiu**, um por linha: `slot_indisponivel`, `leitura_falhou`, `canal_ocupado`, `sem_consentimento_no_envio`, `sem_instancia`, `configuracao_ausente` e `provider_indisponivel`. É a mesma lista de `FALHAS_SEM_ENVIO` (`lib/integrations/whatsapp/falhas-do-envio.ts`, reexportada por `send.ts`): uma `message` `falhou` com um destes códigos certamente não chegou ao paciente, e o job volta a `pendente` para nova tentativa. `tests/unit/agendada/listas-do-banco.test.ts` cruza as duas listas e confere que todo predicado de mensagem `falhou` da migration usa a função, nunca uma cópia da lista.

**O predicado de cancelamento**, igual nos três lugares que cancelam o job pendente de uma agendada `enviando` (a exclusão pela sessão, 18.3; a revogação, 18.9; e `remover_numero`, 18.10):

```sql
j.status = 'pendente'
and not exists (
  select 1 from public.message m
   where m.job_id = j.id
     and not coalesce(
       m.delivery_status = 'falhou'
         and m.error_code = any (public.falhas_sem_envio()),
       false)
)
```

Ou seja: o job não tem mensagem, ou a mensagem dele é `falhou` com código da lista. `envio_incerto`, código fora da lista ou nulo, `enviando` e os estados de saída contam como "pode ter saído", e o job não é cancelado.

### 18.3 Gatilho `proteger_mensagem_agendada` (BEFORE INSERT OR UPDATE)

`SECURITY DEFINER`, `search_path` vazio, molde de `validar_atividade`. O WITH CHECK da RLS roda depois dos gatilhos BEFORE, então o `criada_por` carimbado satisfaz a policy.

- **O sistema passa:** sem sessão, ou com a GUC `conduzza.agendada_pelo_sistema = 'sim'` (só as funções `SECURITY DEFINER` desta seção a ligam, cada uma guardando e devolvendo o valor anterior, para a chamada aninhada não desligar a de quem chamou; o PostgREST não expõe `set_config`). Só `updated_at` muda.
- **Cascata de FK:** dentro de outro gatilho (`pg_trigger_depth() > 1`), um UPDATE cuja única mudança é `conversation_id`, `job_id`, `message_id` ou `atividade_id` virando nulo passa. Sem isso, apagar uma conversa, um job, uma mensagem ou uma atividade dentro de uma sessão esbarraria na trava abaixo (o primeiro ensaio provou o caso).
- **INSERT pela sessão:** carimba autoria e estado (`criada_por = auth.uid()`, `situacao = 'agendada'`, o resto nulo) e confere, nesta ordem:
  1. `user_can_write` primeiro: "Sem permissão para agendar mensagens nesta clínica." (42501). Vem antes de tudo para quem é de outra clínica não descobrir, pelas mensagens seguintes, se um número ou uma conversa existe;
  2. texto: "Escreva a mensagem (até 4096 caracteres)." (23514);
  3. hora futura: "Essa hora já passou. Escolha outra." (23514);
  4. teto: `(enviar_em at time zone fuso)::date > (hoje + interval '1 year')::date` dá "Mais de 1 ano à frente não dá para agendar." (23514). O dia do teto vale inteiro, e 29/02 mais 1 ano vira 28/02, a mesma regra de `somarMeses` (`lib/domain/horarios.ts`);
  5. número ativo da clínica: "O número desta conversa foi removido. Não dá para agendar por ele." (23514);
  6. a conversa é da clínica, do contato e do número, `em_atendimento` e com quem agenda: "Assuma a conversa antes de agendar." (42501);
  7. `consentimento_vigente`: "Este contato não autorizou receber mensagens. Registre a autorização na ficha antes de agendar." (23514);
  8. teto de 10 `agendada` por contato: "Este contato já tem muitas mensagens agendadas. Exclua uma antes de agendar outra." (23514). **Com trava por contato** (revisão de 06/10/2026): antes da contagem, `pg_advisory_xact_lock(hashtextextended('mensagem_agendada:' || contact_id, 0))`; duas inserções simultâneas do mesmo contato (duas abas, dois números) contam uma depois da outra, e a segunda, com retrato novo (READ COMMITTED), vê a linha da primeira. A trava dura só até o fim da transação.
- **UPDATE pela sessão:** `id`, `clinic_id`, `contact_id`, `whatsapp_account_id`, `conversation_id`, `criada_por`, `criada_em`, `job_id`, `message_id`, `atividade_id`, `enviada_em`, `encerrada_em` e `motivo` não mudam ("Só o texto, a hora, a exclusão e o dispensar mudam por aqui.", 42501); os carimbos voltam ao que eram; uma mudança de cada vez ("Faça uma mudança de cada vez.", 42501).
  - **Excluir:** só para `cancelada`, a partir de `agendada` ou `enviando` ("Só dá para excluir uma mensagem agendada ou na fila para sair.", 42501). Em `enviando`, o mesmo comando cancela o job (`last_error = 'cancelada_pela_clinica'`) se ele ainda está `pendente` **e nada pode ter saído**: não existe mensagem do job, ou a única é `falhou` com código de `falhas_sem_envio()` (18.2a). Atômico com o claim, que só reivindica `pendente`. Qualquer outra mensagem (`enviando`, `enviada`, `envio_incerto`, código fora da lista ou nulo) pode ter chegado, e a exclusão perde: "Esta mensagem já começou a sair e não dá mais para excluir. Confira a conversa." (CZ409). Antes da revisão, qualquer mensagem do job bloqueava, e a agendada que falhou sem sair (e ia tentar de novo) não podia ser excluída e saía na tentativa seguinte. Carimba `cancelada_por`, `cancelada_em` e `encerrada_em` e apaga o texto.
  - **Dispensar** (`dispensada_em` de nulo para preenchido): só em `nao_enviada` ou `nao_confirmada` ("Só uma mensagem que não saiu pode ser dispensada.", 42501); carimba quem e quando e apaga o texto.
  - **Editar** (texto ou hora): só em `agendada` ("Esta mensagem já começou a sair e a mudança não foi salva. Confira a conversa.", CZ409); sem checagem de autor (A1); texto, hora futura e teto como no INSERT (a hora só é conferida quando muda); carimba `editada_por` com a sessão, que **passa a assinar**.
- As recusas acima são frases fixas, sem dado de paciente: a Server Action mostra cada uma como veio (`RECUSAS_DO_GATILHO`), e qualquer outra mensagem do banco vira a frase padrão da ação.

### 18.4 RLS e privilégios da tabela

- **SELECT** `"membro ativo le agendadas conforme papel"`: membro ativo da clínica (`user_active_clinic_ids`; pendente não). O **profissional** só vê a agendada de uma conversa dele: a da própria `conversation_id` ou, do mesmo contato e número, uma conversa dele que não está resolvida (a agendada de uma conversa resolvida continua visível na conversa nova). É a mesma régua de `message`.
- **INSERT** `"quem responde agenda"`: `user_can_write`, `criada_por = auth.uid()`, `situacao = 'agendada'` e a conversa da clínica, do contato e do número em atendimento com quem agenda.
- **UPDATE** `"quem escreve mexe na agendada que ve"`: `user_can_write`, a situação em `agendada`, `enviando`, `nao_enviada` ou `nao_confirmada` e, para o profissional, o mesmo predicado da leitura; `with check (user_can_write(clinic_id))`. O que cada um muda fica no gatilho. Cancelada e enviada não mudam mais.
- **Sem DELETE:** `revoke delete, truncate, references, trigger` de `authenticated`; exclui-se cancelando, como atividade. A cascata do contato e da clínica não depende do privilégio. `anon` sem privilégio nenhum.
- **Cancelar as agendadas de uma pessoa (Configurações > Equipe, A5):** é um UPDATE de sessão de administrador ou gestor (`situacao = 'cancelada'` nas `agendada` em que `coalesce(editada_por, criada_por)` é a pessoa), que a policy e o gatilho já permitem; a Server Action confere `canEdit(papel, 'configuracoes')` antes.

### 18.5 `encerrar_agendada_sem_envio(p_agendada_id uuid, p_situacao text, p_motivo text) returns boolean` (A3)

`SECURITY DEFINER`, `search_path` vazio, `execute` só para `service_role`. É o caminho para `nao_enviada` e `nao_confirmada`: a planejadora (`atrasou`, `numero_removido`), a reconciliação, a revogação da autorização (uma atividade por agendada) e `remover_numero` passam todos por ela. **Uma exceção** (revisão de 06/10/2026): se ela falhar dentro da revogação depois de o job ter sido cancelado, a revogação fecha a agendada sem a atividade (18.9), para o cancelamento nunca ser desfeito.

- `p_situacao` fora de `nao_enviada` e `nao_confirmada` dá 22023. Trava a linha (`for update`); se ela já não está `agendada` nem `enviando`, devolve `false` e não faz nada (idempotente: encerrar de novo não cria outra atividade). Devolve `true` quando fechou agora.
- Se a agendada ainda não tem atividade, cria **uma** em `contact_activity`:
  - **O que fazer:** "Mensagem agendada não saiu" (`nao_enviada`) ou "Conferir se a mensagem agendada chegou" (`nao_confirmada`);
  - **Detalhes**, com a hora marcada no fuso da clínica (`dd/mm/aaaa às HH:MM`): "A mensagem agendada para {quando} não saiu: {motivo}. Confira a conversa e, se ainda fizer sentido, agende de novo."; sem autorização, só "A mensagem agendada para {quando} não saiu: o contato não autoriza receber mensagens."; na não confirmada, "A mensagem agendada para {quando} pode ter chegado ao paciente. Confira a conversa antes de mandar de novo.". O motivo em texto: "o contato não autoriza receber mensagens", "o número {nome} foi removido da clínica", "o número {nome} ficou desconectado por mais de 12 horas" (sem nome, "o número da conversa"), "o envio atrasou mais de 12 horas", "o envio atrasou e cairia de madrugada" (`madrugada`), "o número ficou ocupado com outros envios por tempo demais" e, para o resto, "erro do sistema no envio". **Nunca** o texto da mensagem, o nome ou o telefone do contato;
  - **Prazo:** hoje, dia todo (`due_on` no fuso da clínica, sem `due_at`);
  - **Responsável:** o assinante, se ainda é membro ativo com escrita; senão, sem responsável;
  - **Conversa:** a da agendada; **origem** `automacao` sem `automacao_id` e sem `created_by` (aceito por `validar_atividade` pela GUC, 18.10);
  - trilha `agendada_criou_atividade` com `user_id` nulo, `entity = 'contact_activity'` e o id da atividade, no molde de `automacao_criou_atividade`.
- Depois grava `situacao`, `motivo`, `encerrada_em` e `atividade_id`. O texto da agendada fica até alguém dispensar, ou até a retenção (18.7).

### 18.6 Planejadora: `planejar_mensagens_agendadas(p_limite integer default 200, p_clinic_id uuid default null, p_incluir_teste boolean default false) returns jsonb`

`SECURITY DEFINER`, `search_path` vazio, só `service_role`; chamada por `motor_manutencao` (18.10). Pega as `agendada` com `enviar_em <= now()`, fora das clínicas de teste automático (`clinic.e_de_teste`; os testes de integração chamam com `p_clinic_id` e `p_incluir_teste = true` e não competem com o cron, o mesmo molde das automações de fluxo), na ordem `enviar_em, criada_em, id`, no máximo `p_limite` (entre 1 e 1000), com `for update of a skip locked for key share of w skip locked` (a trava compartilhada no número faz a planejadora pular as agendadas de um número que `remover_numero` está removendo, em vez de formar um deadlock no FK do job; a passagem seguinte as fecha como `numero_removido`).

**A vez entra no WHERE** (revisão de 06/10/2026): só entra no lote a vencida há mais de 12 horas, a do número removido, ou a que **não** espera outra do mesmo contato e número (nenhuma `enviando`, nenhuma `agendada` antes dela na ordem). O `LIMIT` conta só o que dá para planejar: antes, 200 agendadas presas atrás de um número caído gastavam o lote de todas as clínicas a cada passagem. A antecessora `agendada` também está vencida e vem antes na ordem, então entra no mesmo lote; a sucessora vai na passagem seguinte. Para cada uma do lote:

1. vencida há mais de 12 horas: `encerrar_agendada_sem_envio(..., 'nao_enviada', 'atrasou')`;
2. número removido: `encerrar_agendada_sem_envio(..., 'nao_enviada', 'numero_removido')`;
3. outra do mesmo contato e número ainda `enviando`, ou `agendada` antes dela na mesma ordem: espera. É a **segunda trava**, para a anterior que surgiu depois da consulta (uma por vez por contato e número, na ordem);
4. senão, cria o job `enviar_mensagem_agendada` com `payload {contact_id, mensagem_agendada_id}` (**nunca o texto**), o número da agendada, prioridade 0 e `run_at = now()`, e marca a agendada `enviando` com o `job_id`.

**Erro por linha isolado** (revisão de 06/10/2026): cada agendada roda no próprio `begin ... exception`. Um erro numa linha (por exemplo, a atividade recusada por `validar_atividade` porque a conversa da agendada passou a ser de outro contato) desfaz só ela, conta em `erros_por_linha` e as outras seguem; o aviso (`raise warning`) leva só o id da agendada e o SQLSTATE. Antes, uma linha assim parava a planejadora de todas as clínicas a cada passagem.

A contagem `esperando_a_anterior` (vencidas há até 12 horas que esperam a anterior, fora do lote) é só para o monitor. Devolve `{planejadas, atrasadas, numero_removido, esperando_a_anterior, erros_por_linha}`.

### 18.7 Reconciliação e retenção

- **`motivo_da_agendada(p_codigo text) returns text`** (`immutable`, SQL, só `service_role`): o código curto do job ou da mensagem para o motivo da tela. `sem_consentimento` e `sem_consentimento_no_envio` dão `sem_autorizacao`; `numero_removido` dá `numero_removido`; `desconectado` e `sem_numero` dão `numero_desconectado`; `atrasou` dá `atrasou`; `madrugada` dá `madrugada`; `canal_ocupado` e `devolucoes_demais` dão `canal_ocupado`; `envio_incerto` dá `envio_incerto`; o resto, `falha_no_envio`. `tests/unit/agendada/servidor-kinds.test.ts` confere os códigos do executor contra o SQL.
- **`reconciliar_mensagem_agendada(p_agendada_id uuid) returns text`** (`SECURITY DEFINER`, só `service_role`). Trava a agendada `enviando` com `skip locked` (travada por outro caminho fica para a passagem seguinte), lê o job e a mensagem do job (`message.job_id`) e decide:
  - mensagem `enviada`, `entregue` ou `lida`: `enviada`, com `message_id`, `conversation_id` e `enviada_em` da mensagem e o texto apagado. A conversa dessa mensagem, **se** está `aguardando_humano` e sem responsável, passa a `em_atendimento` com o assinante, desde que ele seja membro ativo com escrita: nunca rouba de colega nem da IA;
  - com o job acabado (`falhou`, `cancelado` ou `concluido`) ou sumido, primeiro escolhe o **código do desfecho** (revisão de 06/10/2026): com o job encerrado de vez (`falhou` ou `cancelado`), `coalesce(job.last_error, message.error_code)`, porque o motivo **final** do job vence o código da mensagem, que pode ser de uma tentativa antiga (`leitura_falhou` na primeira; `sem_consentimento`, `numero_removido` ou `atrasou` na segunda, que não toca a mensagem); com o job `concluido`, `coalesce(message.error_code, job.last_error)`, porque concluir não limpa um `last_error` velho. Antes, o código velho da mensagem vencia, e a tela e a atividade mostravam "erro do sistema no envio" no lugar do motivo real;
  - sem mensagem: `nao_enviada`, com o motivo desse código;
  - mensagem `falhou` e nem ela nem o código do desfecho são `envio_incerto`: grava `message_id` e fecha `nao_enviada`, com o motivo desse código;
  - o resto (mensagem parada em `enviando`, ou `envio_incerto`): grava `message_id` e fecha `nao_confirmada`, motivo `envio_incerto`.

  Devolve `enviada`, `nao_enviada`, `nao_confirmada` ou `sem_mudanca`. O worker chama depois de `concluir_job` ou `falhar_job` (`fecharAgendadaDoJob`, em `lib/jobs/mensagem-agendada.ts`; nunca lança, e em erro loga só `agendada_fechamento_falhou` com ids e código); no reagendamento, não chama.
- **`reconciliar_mensagens_agendadas(p_limite integer default 200, p_clinic_id uuid default null, p_incluir_teste boolean default false) returns jsonb`** (`SECURITY DEFINER`, só `service_role`; chamada pelo motor): fecha, pela função acima, as `enviando` cujo job acabou ou sumiu, ou cuja mensagem já saiu; aplica a **retenção de 30 dias** (A5: a `nao_enviada` e a `nao_confirmada` não dispensadas com `encerrada_em` de mais de 30 dias perdem o texto e ganham `dispensada_em`, com `dispensada_por` nulo, até `p_limite` por passagem, `skip locked`); e conta as **presas** (`enviando` com `enviar_em` de mais de 13 horas). Cada agendada do laço roda no próprio `begin ... exception` (revisão de 06/10/2026): um erro numa linha desfaz só ela, conta em `erros_por_linha` e o aviso leva só o id e o SQLSTATE, como na planejadora. Devolve `{fechadas_enviadas, fechadas_sem_envio, retidas, presas, erros_por_linha}`.

### 18.8 Enviar agora: `tirar_agendada_para_enviar_agora(p_id uuid) returns jsonb`

`SECURITY DEFINER`, `search_path` vazio, `execute` para `authenticated` e `service_role` (não `anon`). Trava a agendada e devolve um de quatro estados, sem oráculo de existência:

- `nao_encontrada`: sem sessão, id que não existe, quem não escreve na clínica, profissional que não vê a agendada (o mesmo predicado da leitura) e agendada já encerrada;
- `ja_saindo`: a agendada está `enviando`;
- `assuma_a_conversa`: quem pede não está com a conversa aberta daquele contato **naquele número** (`em_atendimento` e responsável = ela);
- `ok`: marca a agendada `cancelada` com motivo `enviada_agora` e `cancelada_por` = quem pediu, apaga o texto, grava a trilha **`retirou_agendada_para_enviar_agora`** (`entity = 'mensagem_agendada'`; é a retirada, não o envio) e devolve `{estado, texto, conversation_id}`.

**A Server Action** (`enviarAgendadaAgoraAction`, `app/(app)/atendimento/agendadas-actions.ts`; revisão de 06/10/2026). Antes de retirar, lê a agendada pela sessão e recusa **sem retirar** em dois casos: texto acima de 4096 unidades UTF-16 ("A mensagem tem {n} caracteres e o limite é 4096. Encurte antes de enviar.") e número **da agendada** desconectado (a mesma dica do botão: "O número {nome} está desconectado. A mensagem continua agendada e espera a reconexão."; o envio 1:1 recusaria depois de retirar, e a agendada, que esperaria a reconexão sozinha, deixaria de existir). Depois chama a função acima e envia o texto por `enviarComoAtendente` (o núcleo do `sendMessageAction`, no trilho 1:1, em nome de quem clicou; o termo da jornada anda, A4). A ordem é retirar e depois enviar: o pior caso é nada sair, nunca o paciente receber em dobro. Sem a checagem de autor (A1).

O desfecho vai para a trilha (sempre `entity = 'mensagem_agendada'` e o id, nunca o texto) e a tela recebe uma de três respostas:

- **saiu:** trilha `enviou_agora_mensagem_agendada`; `{ ok: true, conversationId, messageId }`;
- **certamente não saiu** (retirada sem texto ou sem conversa, recusa antes do canal, ou falha que `envioCertamenteNaoSaiu` garante sem envio: sem autorização, número desconectado ou removido, canal ocupado, as recusas antes do provedor e os códigos de `FALHAS_SEM_ENVIO`): trilha `enviar_agora_nao_saiu`; `{ ok: false, error: "A mensagem não saiu e não está mais agendada. O texto voltou para o campo.", texto }`, e o texto volta para a tela;
- **pode ter saído** (`envio_incerto`, resposta do provedor como `uazapi_500`, código desconhecido, exceção do envio): trilha `enviar_agora_incerto`; `{ ok: false, incerto: true, error: "Não deu para confirmar se a mensagem chegou ao paciente. Confira a conversa antes de mandar de novo." }`, **sem o texto**. Antes da revisão, essa falha dizia "não saiu" e devolvia o texto ao campo, e um Enter mandava a mesma mensagem duas vezes.

### 18.9 Revogação: gatilho `agendadas_param_na_revogacao` em `contact_consent`

`AFTER INSERT OR UPDATE OF revoked_at`, função `SECURITY DEFINER` sem `execute` para ninguém. Quando a autorização de WhatsApp é revogada e o contato fica sem consentimento vigente, trava as agendadas `agendada` e `enviando` do contato (`for update`, em ordem de id; depois o job, a mesma ordem da exclusão e de `remover_numero`, sem deadlock) e, uma a uma (revisão de 06/10/2026):

- **`agendada`:** fecha na hora por `encerrar_agendada_sem_envio(..., 'nao_enviada', 'sem_autorizacao')`, com a atividade;
- **`enviando` com o job `pendente`** (esperando o número, a madrugada, o canal ou nova tentativa): cancela o job com o predicado de 18.2a e `last_error = 'sem_consentimento'`, e fecha a agendada do mesmo jeito. Antes da revisão ela ficava viva, e uma reautorização antes da execução soltava a mensagem escrita antes do descadastro;
- **`enviando` com o job `executando`** (ou com mensagem que pode ter saído): fica com a reconferência da autorização no `send.ts` e com a reconciliação, que a fecha com `sem_autorizacao`.

**O cancelamento nunca é desfeito:** o fechamento com a atividade roda num bloco próprio; se ele falhar (a atividade recusada, por exemplo), a agendada é fechada **sem** a atividade (`nao_enviada`, `sem_autorizacao`, `encerrada_em`, pela GUC), com um aviso só com o id e o SQLSTATE. **A revogação nunca falha por causa de uma agendada:** cada uma roda no próprio bloco, e o laço inteiro em outro (o executor confere a autorização de qualquer jeito). Vale também quando a revogação vem da ficha, pela sessão de quem revoga. Reautorizar não revive nada: o descadastro é definitivo (regra 3.4 do CLAUDE.md).

### 18.10 Funções recriadas a partir do corpo de produção

As cinco partem do `pg_get_functiondef` de produção de 06/10/2026, com o que é novo entre marcadores `-- [mensagem agendada]`; fora deles, idênticas. Os corpos de antes, lidos da produção, estão em `supabase/operacao/rollback/20261006140000-corpos-anteriores.sql` (passo 3 do rollback, 18.13).

- **`remover_numero`:** depois do cancelamento dos ecos, com a GUC ligada, trava as agendadas do número (`agendada` e `enviando`, em ordem de id) e só depois os jobs (a mesma ordem da exclusão pela sessão, sem deadlock); cancela os jobs `enviar_mensagem_agendada` pendentes do número pelo predicado de 18.2a (sem mensagem, ou mensagem `falhou` com código de `falhas_sem_envio()`; `last_error = 'numero_removido'`); e encerra, por `encerrar_agendada_sem_envio(..., 'numero_removido')`, as `agendada` e as `enviando` cujo job ficou cancelado. O job já em `executando` morre no executor com `numero_removido`, e a reconciliação fecha a agendada. O retorno ganha `agendadas_encerradas`.
- **`motor_manutencao`:** um bloco novo, **por último** (as linhas travadas pela planejadora só soltam no fim da transação): `planejar_mensagens_agendadas()` e depois `reconciliar_mensagens_agendadas()`, cada um no seu `begin ... exception`. Códigos novos em `planner_erro`: `mensagem_agendada:<sqlstate>` (erro estrutural da planejadora), `agendada_reconciliar:<sqlstate>` (erro estrutural da reconciliação), **`agendadas_erros:<n>`** (as linhas que deram erro nesta passagem, a soma do `erros_por_linha` das duas; revisão de 06/10/2026) e `agendadas_presas:<n>` (há `enviando` de mais de 13 horas). O retorno ganha `mensagens_agendadas` (as chaves das duas funções juntas, com `erros_por_linha` somado). Diagnóstico no runbook `supabase/operacao/motor-por-cron.md`, seção "Mensagem agendada".
- **`atendimento_do_periodo`:** a subconsulta de `resposta_em` ignora a mensagem ligada a uma agendada (`not exists (select 1 from mensagem_agendada ma where ma.message_id = m.id)`): a agendada saiu sozinha e não é primeira resposta. O Enviar agora não fica ligado à agendada e conta, porque é resposta de verdade.
- **`validar_atividade`:** com a GUC `conduzza.agendada_pelo_sistema = 'sim'`, o INSERT pula a regra de sessão (origem `manual` e `created_by` de quem usa) e aceita origem `automacao` sem `automacao_id`. Sem a GUC, tudo como antes (12.3).
- **`claim_jobs`** (o claim **legado**, revisão de 06/10/2026): é o que o `npm run worker` (ferramenta local) e as suítes de integração que rodam contra a produção usam, e ele não filtra clínica de teste nem kind. Os dois ramos (enterrar o que travou sem tentativas e reivindicar) passam a excluir `kind = 'enviar_mensagem_agendada'`. Sem isso, um teste local reivindicaria a agendada real de uma clínica e a enviaria da máquina de quem desenvolve, ou a mataria com `tipo_desconhecido` num checkout sem o executor. Agendada, só o motor (`claim_jobs_por_clinica`) reivindica e enterra.

### 18.11 `job_queue`: o kind novo e a nota para o E3

- `job_queue_kind_check` passa a aceitar **`enviar_mensagem_agendada`** (seção 7). O ALTER fica perto do fim, antes do `claim_jobs`, e a trava dele (ACCESS EXCLUSIVE em `job_queue`) já é pega no topo da migration (18.13). `max_attempts` padrão; prioridade 0; o número vem sempre da agendada. O claim legado `claim_jobs` não reivindica nem enterra este kind (18.10).
- No código, o kind entra em `KINDS_DE_ENVIO` (`lib/jobs/kinds.ts`), que o motor e a faixa "mensagens esperando" usam juntos; `CUSTO_ESTIMADO_MS.enviar_mensagem_agendada = 25_000`. O teste `tests/unit/agendada/servidor-kinds.test.ts` cruza o CHECK da **migration mais recente** que o define com a união dos trilhos do motor.
- **NOTA PARA O E3:** a migration do `responder_com_ia` (Fase 3 do agente) redefine o CHECK inteiro e **precisa manter `enviar_mensagem_agendada`**. Se esquecer, o teste acima reprova, e em produção a planejadora passa a falhar com 23514 (vira `mensagem_agendada:23514` em `planner_erro`).

### 18.12 Leitura, trilha e tempo real

- **Leitura pela sessão, só no servidor:** `fetchMensagensAgendadas` (`lib/queries/mensagens-agendadas.ts`, `server-only`) lê as agendadas do contato em todos os números (as `agendada` e `enviando`; as `nao_enviada` e `nao_confirmada` não dispensadas; as `enviada` das últimas 24 horas), com o contexto: a última entrada do contato por número (o aviso "escreveu depois"), a conexão, o nome e a cor de cada número e quem é membro ativo com escrita. Quem chama é `listarAgendadasAction`, que grava a trilha `leu` com `entity = 'mensagem_agendada'` e o id do **contato** (`lib/auth/read-audit.ts`, uma linha a cada 5 minutos por pessoa e contato).
- **Fio, sem embed** (revisão de 06/10/2026): a consulta das mensagens **não** embute mais `mensagem_agendada`. Embutida, uma tabela que faltasse (código publicado antes da migration, ou o rollback) ou um embed recusado pelo PostgREST derrubava o fio de **todas** as conversas. No lugar, a autoria da bolha vem de uma consulta **separada e tolerante**: `fetchAgendadasDoFio(supabase, clinicId, messageIds)` (`lib/queries/agendadas-do-fio.ts`), pela sessão e com a RLS, só `message_id, criada_por, editada_por` (nunca o texto), em lotes de 100 ids, só ids de mensagem válidos (a bolha otimista não derruba a consulta); qualquer erro vira mapa vazio, e só a marca da bolha some. Chave do TanStack Query `['agendadas-do-fio', conversationId]` (`agendadasKeys.doFio`, no domínio), com a assinatura dos ids no fim.
- **Trilha das mutações** (sempre `entity = 'mensagem_agendada'` e o id, nunca o texto): `agendou_mensagem`, `editou_mensagem_agendada`, `excluiu_mensagem_agendada` (também uma por agendada cancelada em Equipe), `dispensou_mensagem_agendada`; no Enviar agora, `retirou_agendada_para_enviar_agora` (pela função, 18.8) e o desfecho pela Server Action: `enviou_agora_mensagem_agendada`, `enviar_agora_nao_saiu` ou `enviar_agora_incerto`. Do sistema: `agendada_criou_atividade` (18.5) e, no executor, `envio_bloqueado_sem_autorizacao` com `user_id` nulo e `entity = 'contact'`.
- **Fora do tempo real** (revisão de 06/10/2026): a tabela **não** entra na publicação `supabase_realtime`. O Realtime desta instância lê o WAL pelo wal2json, que **ignora a lista de colunas** da publicação: o texto de cada INSERT e edição iria pelo websocket a toda aba do Atendimento, sem trilha de leitura (a primeira versão publicava "sem o texto" e não segurava). A tela relê pela sessão (RLS e trilha): a lista do contato aberto (`['agendadas', clinicId, contactId]`) e a autoria do fio (`['agendadas-do-fio', conversationId]`) a cada evento de `message` ou `conversation` daquele contato (`chavesDaAgendadaNoEvento`, `lib/realtime/use-inbox-channel.ts`, com uma janela de 1 s que junta os eventos seguidos), a lista também a cada 30 s com a conversa aberta e a aba à vista e quando a janela volta ao foco, e as duas depois de cada ação própria e ao (re)conectar o canal.

### 18.13 Códigos de erro, ensaio, provas, ordem de publicação e rollback

**Códigos:** 42501 e 23514 (gatilho, com as frases de 18.3), 23505 (`mensagem_agendada_sem_duplicata` e o id repetido), CZ409 (editar ou excluir em corrida com o envio) e 22023 (`encerrar_agendada_sem_envio` com situação inválida). 40001 e 40P01 nunca são levantados de propósito (o PostgREST os repete sem limite). Nenhuma mensagem de erro, `last_error`, payload de job ou trilha leva texto, nome ou telefone de paciente.

**Avisos no log do Postgres** (revisão de 06/10/2026): a planejadora, a reconciliação e a revogação registram o erro de uma linha com `raise warning`, só com o id da agendada (ou do contato, no laço inteiro da revogação) e o SQLSTATE, nunca o texto: `planejar_mensagens_agendadas: agendada <id> (<sqlstate>)`, `reconciliar_mensagens_agendadas: agendada <id> (<sqlstate>)`, `agendadas_param_na_revogacao: agendada <id> fechada sem atividade (<sqlstate>)`, `... agendada <id> sem fechar (<sqlstate>)`, `... agendada <id> (<sqlstate>)` e `... contato <id> (<sqlstate>)`. O motor resume os da planejadora e da reconciliação em `agendadas_erros:<n>` (runbook).

**Ensaios (06/10/2026, 4):** em transação desfeita contra a produção, com uma clínica de teste criada na própria transação e a sessão simulada por `request.jwt.claims`. Os dois primeiros foram antes da revisão (o segundo, com a versão de então, deu 35 checagens verdadeiras). Depois das correções: o terceiro deu 52 verdadeiras e 1 falsa ("reautorizar não revive": com a atividade recusada, a falha ao fechar a agendada desfazia o cancelamento do job), o que levou ao fechamento sem atividade da revogação (18.9); uma rodada anterior a ele parou num erro do próprio cenário, antes de qualquer checagem. O **quarto**, com o arquivo atual (o sha256 do começo desta seção), deu **52 checagens verdadeiras e nenhuma falsa**: 12 de catálogo (RLS, as 3 policies, o kind no CHECK, a tabela **fora** da publicação do tempo real, funções novas `SECURITY DEFINER` com `search_path` vazio, `authenticated` sem as funções de sistema, Enviar agora sem `anon`, tabela sem `select` para `anon` e sem `delete` para `authenticated`, motor e `remover_numero` com o bloco, as travas no modo certo, `falhas_sem_envio()` igual a `FALHAS_SEM_ENVIO`, o motor com `agendadas_erros` e o `claim_jobs` sem o kind nos dois ramos), 39 de comportamento (as 26 de antes e as das correções: motivo e texto da atividade de `madrugada`; excluir com mensagem `falhou` por `leitura_falhou` cancela o job, e com `envio_incerto` ou sem código dá CZ409; revogação fecha a `enviando` com job pendente e deixa a que executa; reautorizar não revive; a linha quebrada erra sozinha na planejadora e na reconciliação, e a revogação grava mesmo com ela; consertada a conversa, as duas fecham; com limite 1, a planejadora planeja a outra e a que espera fica; o motivo do job vence o da mensagem; o `claim_jobs` pula a agendada e pega o job seguinte; a trava por contato no INSERT da sessão) e a do tempo. Migration e cenário em cerca de 0,56 s.

**Provas para rodar depois de aplicar:** `npm run test:rls -- mensagem-agendada` (`tests/rls/mensagem-agendada.test.ts`: A e B, cada papel, profissional, carimbos forjados, A1, exclusão e cancelada que não volta, dispensar, conversa, número, autorização, bordas do teto, texto, teto de 10 e o teto com duas inserções ao mesmo tempo, duplicata, sem DELETE, `anon`, funções de sistema (com a lista de falhas), Enviar agora sem oráculo, excluir na fila depois de uma falha que certamente não enviou, cancelamento por Equipe e a revogação pela sessão, com a atividade e com a da fila); `npm run test:integration -- mensagem-agendada` (`tests/integration/mensagem-agendada.test.ts`: planejadora, com o limite que conta só o que dá para planejar e o erro numa linha que não para as outras; executor pelo provedor fake; revogação com a da fila; corridas; excluir depois de uma falha que certamente não enviou; queda e reexecução, com o motivo do job vencendo o da mensagem; `remover_numero`; madrugada, com o motivo `madrugada`; retenção; CHECKs; o claim legado que não pega a agendada; `atendimento_do_periodo` e as Server Actions); o e2e `tests/e2e/mensagem-agendada.spec.ts`; e regenerar os tipos (o diff tem de sumir).

**Ordem de publicação:** a migration vai **antes** do código. Sem ela, a lista e as ações falham (a lista mostra "Não foi possível carregar as mensagens agendadas." e o botão do compositor fica desabilitado), mas o fio **não** cai mais: a autoria da bolha é uma consulta separada e tolerante (18.12). Com a migration e o código antigo, nada muda (nenhuma agendada existe). **Aplicar em horário calmo (madrugada):** `lock_timeout` de 5 s e, logo abaixo, **todas as travas das tabelas quentes numa ordem fixa, antes de qualquer DDL e já no modo mais forte que a migration vai usar** (revisão de 06/10/2026; sem subir de modo no meio): primeiro `lock table public.job_queue in access exclusive mode` (a troca do CHECK, cerca de 1100 linhas), depois `message`, `conversation`, `contact`, `whatsapp_account`, `contact_consent` e `contact_activity` em SHARE ROW EXCLUSIVE (as FKs do CREATE TABLE e o CREATE TRIGGER em `contact_consent`). O CREATE TABLE ainda pega SHARE ROW EXCLUSIVE em `clinic` e `auth.users` (FKs de autoria), que quase não recebem escrita. Enquanto espera uma trava, a migration segura as que já pegou e as escritas nelas esperam (até o `lock_timeout`); um envio em curso pode formar ciclo com ela, e o detector derruba um dos dois em 1 s. Se a migration cair (55P03 ou 40P01), nada fica gravado: tentar de novo minutos depois. Nada aqui faz ALTER em `message`, `conversation` ou `contact`.

**Rollback** (cabeçalho da migration, manual, nesta ordem):

0. **antes de tudo, publicar o código sem a mensagem agendada** (lista, ações, executor e Enviar agora): com a tabela fora, essas chamadas falham;
1. apagar os gatilhos `agendadas_param_na_revogacao` (em `contact_consent`) e `proteger_mensagem_agendada`;
2. cancelar os jobs `enviar_mensagem_agendada` pendentes e executando (`last_error = 'rollback'`);
3. reaplicar os corpos **anteriores** de `remover_numero`, `motor_manutencao`, `atendimento_do_periodo`, `validar_atividade` e `claim_jobs`, lidos da produção antes desta migration e guardados em `supabase/operacao/rollback/20261006140000-corpos-anteriores.sql`;
4. apagar a tabela e as nove funções novas (`proteger_mensagem_agendada`, `agendadas_param_na_revogacao`, `encerrar_agendada_sem_envio`, `planejar_mensagens_agendadas`, `reconciliar_mensagem_agendada`, `reconciliar_mensagens_agendadas`, `motivo_da_agendada`, `tirar_agendada_para_enviar_agora` e `falhas_sem_envio`);
5. recriar `job_queue_kind_check` sem o kind, só depois do passo 2 e de apagar as linhas dele;
6. `notify pgrst, 'reload schema'`.

Não há passo de publicação: a tabela nunca entrou nela. As atividades criadas pela agendada ficam (são do CRM).
