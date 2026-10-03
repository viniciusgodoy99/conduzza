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

Sobe em `ingest_inbound_message` (mensagem de entrada). Desce **só** em envio com `author = 'usuario'` e ao resolver a conversa: toque automático de régua (`author = 'sistema'`) não apaga pergunta de paciente.

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

- **`termos_de_quem`** decide de que lado o termo-chave vale. A mensagem recebida (ingestão) só considera as etapas `paciente` ou `qualquer`; o envio pelo Atendimento (o texto, em `sendMessageAction`, e desde a revisão de 02/10/2026 a legenda aparada do arquivo, em `enviarArquivoAction`, sempre depois do envio bem-sucedido e em `after()`) e o eco do celular conectado só consideram `clinica` ou `qualquer`. As mensagens da IA e da régua de follow-up não passam por aqui, e o eco das mensagens que saem pela API é descartado antes (`wasSentByApi`). O teste puro é o mesmo (`etapaPorTermoChave(corpo, etapaAtual, jornada, quemEscreveu)` em `lib/domain/jornada.ts`: o mais longo vence, só para frente, nunca entra nem sai de Perdido), e o movimento (`tentarMoverPorTermo`, `lib/integrations/whatsapp/termo-chave.ts`) é um update guardado pela etapa atual, pela service role, com a trilha `termo_chave_moveu_etapa` (paciente) ou `termo_chave_moveu_etapa_clinica` (clínica) em `audit_log`, `entity = 'contact'`, sem o texto. No envio pelo Atendimento, `user_id` é quem enviou; no paciente e no eco, nulo.
- **Eco do celular, uma vez por `wa_message_id` (revisão de 02/10/2026).** O eco (`fromMe` que não saiu pela API: a equipe escrevendo no celular conectado) não vira linha de `message`, então o unique de `message.wa_message_id` não separa a mensagem nova da reentrega do provedor. A regra 3.3 ("`wa_message_id` é chave única, venha de onde vier") vive em `termo_eco_visto`:

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
  - no INSERT com sessão: origem tem de ser `manual` (senão 42501), `created_by` vira `auth.uid()` quando vem nulo e é recusado se for outra pessoa (42501), `created_at = now()`; sem sessão (o motor), origem `automacao` exige `automacao_id` (23514); toda atividade nasce `pendente` (23514) e sem carimbos;
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

Pedido e decisão do dono em 02/10/2026 (spec 3.4 e 3.5; backlog, entrada "Convênio pelo médico"): o profissional diz quais convênios atende, o procedimento diz quais convênios o cobrem, e o convênio do profissional entra sozinho só onde ele faz o procedimento e o convênio cobre. Migration `20261002140000_convenio_pelo_medico.sql`, ensaiada em transação desfeita e **não aplicada em 02/10** (a produção está na `20261002110000`); pressupõe as duas do CRM (seção 12) e não edita nenhuma delas. Os tipos de `lib/supabase/database.types.ts` (as duas tabelas, a RPC nova e a assinatura nova da RPC do procedimento) foram escritos à mão no formato gerado e precisam ser regenerados depois de aplicar as três.

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
