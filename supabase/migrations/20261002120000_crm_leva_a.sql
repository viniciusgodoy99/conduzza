-- ---------------------------------------------------------------------------
-- CRM, Leva A: termos da jornada pela clinica, descricao da etapa, mensagens
-- padrao e atividades
-- ---------------------------------------------------------------------------
-- Plano "Automacoes de fluxo e CRM" (pedido do dono em 02/10/2026, itens 0 a
-- 3; o item 4, automacoes de fluxo, e a Leva B e vem na migration seguinte).
-- Migration UNICA de dados da Leva A. Pressupoe a 20261002110000 aplicada e
-- nao a edita.
--
-- O que faz, na ordem do arquivo:
--
--   1. funnel_stage_def.termos_de_quem ('paciente', 'clinica' ou
--      'qualquer', padrao 'paciente'): quem escreve o termo-chave que anda o
--      lead para a etapa. Ate hoje so a mensagem do PACIENTE andava o lead
--      (ingest.ts, tentarMoverPorTermo); a frase de boas-vindas da recepcao
--      nao. O padrao 'paciente' mantem exatamente o comportamento atual de
--      toda etapa que ja existe. O teste puro (mais longo vence, so para
--      frente, nunca entra nem sai de Perdido) e o mesmo nos tres casos; o
--      codigo decide de que lado a mensagem veio.
--   2. funnel_stage_def.descricao (opcional, 1 a 140 caracteres sem contar
--      espacos das pontas): o texto que aparece no Kanban logo abaixo do nome
--      da coluna. Nao e dado de paciente. RLS, set_updated_at e
--      proteger_jornada que ja existem cobrem a coluna. As etapas existentes
--      ficam nulas e a semeadura nao muda (texto padrao seria decisao do
--      dono).
--   3. resposta_rapida: as mensagens padrao da clinica ("/" no compositor,
--      spec 1.11). Atalho ^[a-z0-9_]{1,30}$ unico por clinica, titulo de 2 a
--      60 unico por clinica sem diferenciar caixa, corpo de 1 a 4096 (o
--      mesmo teto do envio), ativo, posicao. Membro ATIVO le (pendente nao);
--      admin e gestor escrevem (molde de conversation_tag_def). Autoria
--      carimbada por gatilho com auth.uid(); clinic_id imutavel.
--   4. contact_activity: as atividades do lead ou paciente ("criar
--      lembrete", spec 1.9, e a pagina Atividades). Nome em ingles na familia
--      de contact_consent. O texto e dado de paciente (pode ser dado de
--      saude): RLS, leitura auditada pelo codigo, nunca em log.
--      - Prazo: due_on (date, dia civil da clinica) obrigatorio; due_at
--        (timestamptz) so quando tem hora, e ai quem manda e due_at: due_on
--        e SEMPRE recalculado dele no fuso da clinica, a cada gravacao do
--        prazo e tambem quando a clinica troca de fuso (gatilho
--        recalcular_dia_das_atividades em clinic; regra 3.6; o precedente de
--        date para dia civil e package_balance.expires_at).
--      - status pendente, concluida ou cancelada, com completed_at/by e
--        canceled_at/by carimbados pelo gatilho com auth.uid() (o cliente
--        nao forja) e limpos ao reabrir.
--      - origem 'manual' (pessoa, created_by obrigatorio e sempre a propria
--        sessao) ou 'automacao' (o motor da Leva B, sem sessao, created_by
--        nulo, automacao_id obrigatorio na criacao). automacao_id ainda SEM
--        FK: a tabela de automacoes nasce na migration seguinte, que
--        acrescenta a FK.
--      - Gatilhos: set_updated_at; exigir_contato_da_mesma_clinica (o mesmo
--        de waitlist, appointment e contact_consent); validar_atividade
--        (responsavel membro ATIVO da clinica, conversa do mesmo contato,
--        due_on no fuso, travas de clinica, contato, autoria e origem,
--        carimbos de concluida e cancelada).
--      - RLS: membro ativo le (o profissional tambem: e o mesmo recorte de
--        contact); admin, gestor e recepcao criam (em nome proprio) e
--        editam; profissional e leitura so leem nesta versao. Sem DELETE:
--        cancelar no lugar de apagar (o apagamento LGPD vem em cascata pelo
--        contato).
--   5. contagem_de_atividades(clinica): {atrasadas, hoje, minhas_atrasadas,
--      minhas_hoje} das pendentes, com o "hoje" no fuso da clinica. Alimenta
--      o Inicio e o contador do menu. SECURITY INVOKER: a RLS recorta.
--   6. termo_eco_visto e marcar_eco_para_termo(clinica, wa_message_id): o
--      eco do celular conectado (a recepcao escrevendo fora do sistema) anda
--      o lead por termo da clinica UMA vez por wa_message_id. O eco nao vira
--      linha de message, entao a reentrega do provedor nao esbarra no unique
--      de message.wa_message_id; esta marca e a garantia de "nunca
--      reentrega" (regra 3.3). So ids, RLS ligada sem policy, so o service
--      role usa.
--
-- Predicado unico de atrasada e para hoje (espelhar em TS, em
-- lib/domain/atividades.ts, com teste de unidade):
--   atrasada  = pendente e (due_at < now(), ou due_at nulo e due_on < hoje)
--   para hoje = pendente e due_on = hoje e NAO atrasada
-- As duas nao se sobrepoem: a de hoje com hora que ja passou e atrasada.
--
-- Colunas de usuario (created_by, updated_by, assignee_user_id,
-- completed_by, canceled_by) apontam para auth.users SEM acao de exclusao,
-- como message.author_user_id, audit_log.user_id e
-- conversation.assignee_user_id: quem deixou rastro nao some da base. Isso
-- tambem deixa as travas dos gatilhos seguras (um ON DELETE SET NULL faria
-- um UPDATE em cascata que a trava desfaria, deixando referencia pendurada).
--
-- Rollback (nesta ordem; Mensagens padrao, Atividades e os campos novos da
-- Jornada deixam de ter dado):
--   drop function if exists public.marcar_eco_para_termo(uuid, text);
--   drop table if exists public.termo_eco_visto;
--   drop function if exists public.contagem_de_atividades(uuid);
--   drop trigger if exists recalcular_dia_das_atividades on public.clinic;
--   drop function if exists public.recalcular_dia_das_atividades();
--   drop table if exists public.contact_activity;
--   drop function if exists public.validar_atividade();
--   drop table if exists public.resposta_rapida;
--   drop function if exists public.proteger_resposta_rapida();
--   alter table public.funnel_stage_def
--     drop constraint if exists descricao_de_etapa_com_tamanho,
--     drop column if exists descricao,
--     drop constraint if exists termos_de_quem_valido,
--     drop column if exists termos_de_quem;
--   (e o codigo que le termos_de_quem e descricao volta junto: sem as
--   colunas, o JORNADA_SELECT falha e a Jornada e o Kanban caem no erro.)

-- ---------------------------------------------------------------------------
-- 1) funnel_stage_def.termos_de_quem
-- ---------------------------------------------------------------------------

-- Default constante: no PG 11+ o add column e so catalogo (sem reescrever a
-- tabela), e toda etapa existente fica 'paciente', que e o comportamento de
-- hoje.
alter table public.funnel_stage_def
  add column if not exists termos_de_quem text not null default 'paciente';

alter table public.funnel_stage_def
  drop constraint if exists termos_de_quem_valido;
alter table public.funnel_stage_def
  add constraint termos_de_quem_valido
    check (termos_de_quem in ('paciente', 'clinica', 'qualquer'));

comment on column public.funnel_stage_def.termos_de_quem is
  'Quem escreve o termo-chave que anda o lead para esta etapa: paciente (mensagem recebida, o comportamento original), clinica (envio pelo sistema ou pelo celular pareado) ou qualquer (os dois).';

-- ---------------------------------------------------------------------------
-- 2) funnel_stage_def.descricao
-- ---------------------------------------------------------------------------

alter table public.funnel_stage_def
  add column if not exists descricao text;

-- Mesmo padrao de conversation_tag_def.nome_de_etiqueta_com_tamanho. String
-- vazia nao entra: o codigo grava null quando o campo fica em branco.
alter table public.funnel_stage_def
  drop constraint if exists descricao_de_etapa_com_tamanho;
alter table public.funnel_stage_def
  add constraint descricao_de_etapa_com_tamanho
    check (descricao is null or char_length(btrim(descricao)) between 1 and 140);

comment on column public.funnel_stage_def.descricao is
  'Descricao curta da etapa (ate 140), mostrada no Kanban abaixo do nome da coluna. Nunca no cartao do lead.';

-- ---------------------------------------------------------------------------
-- 3) resposta_rapida (mensagens padrao)
-- ---------------------------------------------------------------------------
-- O nome evita mensagem_padrao, que ja e o metodo de atribuicao de origem
-- (lib/domain/attribution.ts) e o arquivo textos-padrao.ts. O rotulo na tela
-- e "Mensagens padrao". Nao reaproveita message_template: aquela e o modelo
-- aprovado da Meta (canal oficial), com categoria, botoes e status.

create table if not exists public.resposta_rapida (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  -- O que se digita depois da "/" no compositor.
  atalho text not null,
  titulo text not null,
  -- Texto com {{nome}} e {{clinica}}, renderizado no compositor por
  -- renderizarModelo e sempre editavel antes de enviar.
  corpo text not null,
  ativo boolean not null default true,
  -- Ordem da lista (o codigo grava de 10 em 10, como a jornada).
  posicao integer not null default 0,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resposta_rapida_atalho_unico unique (clinic_id, atalho),
  constraint atalho_de_resposta_valido check (atalho ~ '^[a-z0-9_]{1,30}$'),
  constraint titulo_de_resposta_com_tamanho
    check (char_length(btrim(titulo)) between 2 and 60),
  -- 4096 e o teto do envio (bodySchema em atendimento/actions.ts e o
  -- compositor). Texto so de espacos nao e mensagem.
  constraint corpo_de_resposta_com_tamanho
    check (char_length(corpo) between 1 and 4096 and btrim(corpo) <> ''),
  constraint posicao_de_resposta_valida check (posicao >= 0)
);

-- Dois titulos iguais seriam indistinguiveis na lista do compositor.
create unique index if not exists resposta_rapida_titulo_unico
  on public.resposta_rapida (clinic_id, lower(btrim(titulo)));

-- A lista do compositor e da aba: so as ativas, na ordem.
create index if not exists resposta_rapida_lista
  on public.resposta_rapida (clinic_id, posicao) where ativo;

comment on table public.resposta_rapida is
  'Mensagens padrao da clinica ("/" no compositor, spec 1.11). Membro ativo le; admin e gestor escrevem. Texto da clinica, sem dado de paciente; o nome do paciente so entra na renderizacao, no navegador de quem usa.';

drop trigger if exists set_updated_at on public.resposta_rapida;
create trigger set_updated_at
  before update on public.resposta_rapida
  for each row execute function public.set_updated_at();

-- Autoria pela sessao: com sessao, created_by e updated_by sao sempre quem
-- esta usando (o que o cliente mandar e ignorado). Sem sessao (service role,
-- scripts) vale o que vier. clinic_id, created_by e created_at nao mudam.
create or replace function public.proteger_resposta_rapida()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Uma mensagem padrão não muda de clínica.'
        using errcode = '23514';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if v_uid is not null then
      new.updated_by := v_uid;
    end if;
    return new;
  end if;

  if v_uid is not null then
    new.created_by := v_uid;
    new.updated_by := v_uid;
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_resposta_rapida()
  from public, anon, authenticated;

drop trigger if exists proteger_resposta_rapida on public.resposta_rapida;
create trigger proteger_resposta_rapida
  before insert or update on public.resposta_rapida
  for each row execute function public.proteger_resposta_rapida();

alter table public.resposta_rapida enable row level security;

drop policy if exists "membro le as mensagens padrao" on public.resposta_rapida;
create policy "membro le as mensagens padrao" on public.resposta_rapida
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

-- user_has_role exige status ativo: pendente nao escreve. Exclusao real
-- (nenhuma outra tabela aponta para esta na Leva A).
drop policy if exists "gestao gerencia as mensagens padrao" on public.resposta_rapida;
create policy "gestao gerencia as mensagens padrao" on public.resposta_rapida
  for all to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

revoke all on table public.resposta_rapida from anon;
revoke truncate, references, trigger on table public.resposta_rapida
  from authenticated;

-- ---------------------------------------------------------------------------
-- 4) contact_activity (atividades)
-- ---------------------------------------------------------------------------

create table if not exists public.contact_activity (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  -- Apagar o contato (LGPD 11.11) leva as atividades junto.
  contact_id uuid not null references public.contact (id) on delete cascade,
  -- De onde a atividade foi criada, quando foi pela conversa. Conversa
  -- apagada nao apaga a atividade.
  conversation_id uuid references public.conversation (id) on delete set null,
  -- "O que fazer"
  titulo text not null,
  -- "Detalhes" (opcional; o codigo grava null quando fica em branco)
  detalhes text,
  -- Dia civil da clinica. Com due_at, e sempre recalculado dele no fuso da
  -- clinica pelo gatilho (o valor mandado e ignorado).
  due_on date not null,
  -- So quando a atividade tem hora.
  due_at timestamptz,
  -- Sem responsavel e permitido (a automacao pode criar sem). Quando ha,
  -- e membro ATIVO da clinica na hora em que e definido (gatilho).
  assignee_user_id uuid references auth.users (id),
  status text not null default 'pendente',
  origem text not null default 'manual',
  -- Regra que criou (Leva B). A FK para a tabela de automacoes entra na
  -- migration que cria a tabela.
  automacao_id uuid,
  created_by uuid references auth.users (id),
  completed_at timestamptz,
  completed_by uuid references auth.users (id),
  canceled_at timestamptz,
  canceled_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint status_de_atividade_valido
    check (status in ('pendente', 'concluida', 'cancelada')),
  constraint origem_de_atividade_valida
    check (origem in ('manual', 'automacao')),
  constraint titulo_de_atividade_com_tamanho
    check (char_length(btrim(titulo)) between 2 and 120),
  constraint detalhes_de_atividade_com_tamanho
    check (detalhes is null or (char_length(detalhes) <= 2000 and btrim(detalhes) <> '')),
  -- Coerencia do status com os carimbos (o gatilho carimba; o check e a
  -- garantia final, inclusive para o service role).
  constraint concluida_tem_carimbo
    check ((status = 'concluida') = (completed_at is not null)),
  constraint cancelada_tem_carimbo
    check ((status = 'cancelada') = (canceled_at is not null)),
  constraint concluida_por_so_com_carimbo
    check (completed_by is null or completed_at is not null),
  constraint cancelada_por_so_com_carimbo
    check (canceled_by is null or canceled_at is not null),
  -- Atividade de pessoa tem autor; so a automacao cria sem.
  constraint autor_de_atividade_manual
    check (created_by is not null or origem = 'automacao'),
  constraint automacao_so_com_origem_automacao
    check (automacao_id is null or origem = 'automacao')
);

comment on table public.contact_activity is
  'Atividades do lead ou paciente (o que fazer, para quando no fuso da clinica, responsavel, pendente/concluida/cancelada). Dado de paciente: leitura auditada pelo codigo, nunca em log. Membro ativo le; admin, gestor e recepcao criam e editam; sem DELETE (cancelar).';
comment on column public.contact_activity.due_on is
  'Dia civil da clinica para a atividade. Com due_at, quem manda e due_at: este dia e recalculado dele no fuso da clinica (clinic.timezone) a cada INSERT, a cada UPDATE que mexe em due_at ou due_on e quando clinic.timezone muda (gatilho recalcular_dia_das_atividades).';
comment on column public.contact_activity.due_at is
  'Instante com hora, quando a atividade tem hora. Nulo = so o dia (due_on).';
comment on column public.contact_activity.origem is
  'manual (criada por pessoa, created_by = a sessao) ou automacao (motor da Leva B, sem sessao, automacao_id obrigatorio na criacao).';

-- Indices: a lista e o contador por responsavel, a lista da clinica, as do
-- contato (drawer, conversa e ficha), as concluidas recentes e a FK da
-- conversa (o ON DELETE SET NULL procura por ela).
create index if not exists contact_activity_pendentes_por_responsavel
  on public.contact_activity (clinic_id, assignee_user_id, due_on)
  where status = 'pendente';
create index if not exists contact_activity_pendentes_por_dia
  on public.contact_activity (clinic_id, due_on)
  where status = 'pendente';
create index if not exists contact_activity_do_contato
  on public.contact_activity (contact_id, status, due_on);
create index if not exists contact_activity_concluidas
  on public.contact_activity (clinic_id, completed_at desc)
  where status = 'concluida';
create index if not exists contact_activity_da_conversa
  on public.contact_activity (conversation_id)
  where conversation_id is not null;

drop trigger if exists set_updated_at on public.contact_activity;
create trigger set_updated_at
  before update on public.contact_activity
  for each row execute function public.set_updated_at();

-- O contato tem de ser da clinica da atividade (mesma funcao de waitlist,
-- appointment, package_balance, slot_hold e contact_consent).
drop trigger if exists exigir_contato_da_mesma_clinica on public.contact_activity;
create trigger exigir_contato_da_mesma_clinica
  before insert or update of contact_id on public.contact_activity
  for each row execute function public.exigir_contato_da_mesma_clinica();

-- security definer: le clinic.timezone, clinic_member (o responsavel pode
-- nao ser visivel ao papel de quem grava) e conversation (o profissional so
-- ve a conversa atribuida a ele). auth.uid() continua sendo a sessao.
create or replace function public.validar_atividade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fuso text;
begin
  if tg_op = 'INSERT' then
    -- Autoria. Com sessao, a atividade e sempre em nome de quem esta usando
    -- e de origem manual (a policy de INSERT confere de novo). Sem sessao
    -- (motor, service role) valem os checks da tabela.
    if v_uid is not null then
      if new.origem is distinct from 'manual' then
        raise exception 'Atividade criada por uma pessoa tem origem manual.'
          using errcode = '42501';
      end if;
      if new.created_by is null then
        new.created_by := v_uid;
      elsif new.created_by <> v_uid then
        raise exception 'A atividade é criada em nome de quem está usando o sistema.'
          using errcode = '42501';
      end if;
      new.created_at := now();
    end if;
    if new.origem = 'automacao' and new.automacao_id is null then
      raise exception 'Atividade criada por automação precisa da automação de origem.'
        using errcode = '23514';
    end if;
    if new.status is distinct from 'pendente' then
      raise exception 'Uma atividade nasce pendente.'
        using errcode = '23514';
    end if;
    new.completed_at := null;
    new.completed_by := null;
    new.canceled_at := null;
    new.canceled_by := null;
  else
    -- Travas
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Uma atividade não muda de clínica.'
        using errcode = '23514';
    end if;
    if new.contact_id is distinct from old.contact_id then
      raise exception 'Uma atividade não muda de contato. Crie outra para o contato certo.'
        using errcode = '23514';
    end if;
    if new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.origem is distinct from old.origem then
      raise exception 'Quem criou a atividade, quando e como não mudam.'
        using errcode = '23514';
    end if;
    -- automacao_id so pode virar nulo (a FK da Leva B pode limpar ao apagar
    -- a regra); trocar de regra, nunca.
    if new.automacao_id is distinct from old.automacao_id
       and new.automacao_id is not null then
      raise exception 'A automação de origem de uma atividade não muda.'
        using errcode = '23514';
    end if;

    -- Carimbos: so o gatilho escreve. Mudou o status, carimba com a sessao
    -- (nula para o service role) e limpa o outro par; reabrir limpa tudo.
    -- Status igual, os carimbos ficam como estavam.
    if new.status is distinct from old.status then
      if new.status = 'concluida' then
        new.completed_at := now();
        new.completed_by := v_uid;
        new.canceled_at := null;
        new.canceled_by := null;
      elsif new.status = 'cancelada' then
        new.canceled_at := now();
        new.canceled_by := v_uid;
        new.completed_at := null;
        new.completed_by := null;
      else
        new.completed_at := null;
        new.completed_by := null;
        new.canceled_at := null;
        new.canceled_by := null;
      end if;
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
      new.canceled_at := old.canceled_at;
      new.canceled_by := old.canceled_by;
    end if;
  end if;

  -- Responsavel: membro ATIVO desta clinica. So quando e definido ou
  -- trocado: alguem que saiu da equipe depois nao trava concluir, adiar ou
  -- reatribuir a atividade.
  if new.assignee_user_id is not null
     and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id) then
    if not exists (
      select 1 from public.clinic_member m
       where m.clinic_id = new.clinic_id
         and m.user_id = new.assignee_user_id
         and m.status = 'ativo'
    ) then
      raise exception 'O responsável precisa ser alguém ativo da equipe desta clínica.'
        using errcode = '23514';
    end if;
  end if;

  -- Conversa: da mesma clinica e do mesmo contato.
  if new.conversation_id is not null
     and (tg_op = 'INSERT' or new.conversation_id is distinct from old.conversation_id) then
    if not exists (
      select 1 from public.conversation c
       where c.id = new.conversation_id
         and c.clinic_id = new.clinic_id
         and c.contact_id = new.contact_id
    ) then
      raise exception 'A conversa informada não é deste contato.'
        using errcode = '23514';
    end if;
  end if;

  -- Prazo com hora: o dia sai da hora, no fuso da clinica (regra 3.6).
  -- Recalcula quando o prazo mexe; a troca do fuso da clinica recalcula
  -- todas as que tem hora pelo gatilho recalcular_dia_das_atividades (em
  -- clinic), que passa por aqui com o fuso novo ja gravado.
  if new.due_at is not null
     and (tg_op = 'INSERT'
          or new.due_at is distinct from old.due_at
          or new.due_on is distinct from old.due_on) then
    select c.timezone into v_fuso from public.clinic c where c.id = new.clinic_id;
    new.due_on := (new.due_at at time zone coalesce(v_fuso, 'America/Fortaleza'))::date;
  end if;

  return new;
end;
$$;

revoke all on function public.validar_atividade()
  from public, anon, authenticated;

drop trigger if exists validar_atividade on public.contact_activity;
create trigger validar_atividade
  before insert or update on public.contact_activity
  for each row execute function public.validar_atividade();

-- O fuso da clinica mudou: o dia das atividades COM hora acompanha o
-- instante (regra 3.6; o aviso de Configuracoes > Clinica promete o mesmo
-- instante mostrado no fuso novo). Sem isto ficava o dia do fuso antigo com
-- a hora do fuso novo, um prazo que nao e instante nenhum: a lista dizia
-- "Amanha, 23:30" para o que vence hoje, a contagem nao o via em "hoje", e
-- editar so o titulo pelo dialogo (que preenche o dia com due_on) andava o
-- prazo 24 horas sem ninguem perceber.
-- Todas as que tem hora, nao so as pendentes: a concluida que for reaberta
-- volta com o dia certo, e o texto do prazo da concluida tambem fica certo.
-- Sem hora, o dia e o que a pessoa escolheu e nao muda.
-- Cada linha passa pelo validar_atividade (status igual: carimbos ficam;
-- prazo mexeu: recalcula o mesmo valor, com o fuso novo ja visivel no AFTER).
-- security definer: a troca e consequencia do fuso, nao edicao da atividade,
-- e tem de alcancar todas as linhas da clinica, sem depender das policies de
-- contact_activity para quem gravou o fuso.
create or replace function public.recalcular_dia_das_atividades()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contact_activity a
     set due_on = (a.due_at at time zone new.timezone)::date
   where a.clinic_id = new.id
     and a.due_at is not null
     and a.due_on is distinct from (a.due_at at time zone new.timezone)::date;
  return null;
end;
$$;

revoke all on function public.recalcular_dia_das_atividades()
  from public, anon, authenticated;

drop trigger if exists recalcular_dia_das_atividades on public.clinic;
create trigger recalcular_dia_das_atividades
  after update of timezone on public.clinic
  for each row
  when (new.timezone is distinct from old.timezone)
  execute function public.recalcular_dia_das_atividades();

alter table public.contact_activity enable row level security;

-- Mesmo recorte de contact: membro ativo le, o profissional e a leitura
-- tambem. Pendente nao (user_active_clinic_ids filtra status ativo).
drop policy if exists "membro ativo le as atividades" on public.contact_activity;
create policy "membro ativo le as atividades" on public.contact_activity
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

-- Matriz de Leads e Pacientes (docs/02): admin, gestor e recepcao escrevem.
-- user_can_write NAO serve aqui: inclui o profissional.
drop policy if exists "recepcao e gestao criam atividade" on public.contact_activity;
create policy "recepcao e gestao criam atividade" on public.contact_activity
  for insert to authenticated
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao'])
    and created_by = auth.uid()
  );

-- Editar, concluir, reabrir, adiar e cancelar qualquer atividade da clinica
-- (inclusive as da automacao, que nao tem autor). A autoria fica travada no
-- gatilho.
drop policy if exists "recepcao e gestao editam atividade" on public.contact_activity;
create policy "recepcao e gestao editam atividade" on public.contact_activity
  for update to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']));

-- Sem policy de DELETE e sem o privilegio: o DELETE pela API da erro de
-- permissao (42501) em vez de apagar zero linhas em silencio. A cascata do
-- contato e da clinica nao depende deste privilegio.
revoke all on table public.contact_activity from anon;
revoke delete, truncate, references, trigger on table public.contact_activity
  from authenticated;

-- ---------------------------------------------------------------------------
-- 5) contagem_de_atividades
-- ---------------------------------------------------------------------------
-- O "hoje" e o dia civil da clinica (clinic.timezone), calculado aqui e nao
-- no navegador. "minhas" = responsavel e a sessao (zero para o service
-- role). Quem nao e membro ativo recebe zeros (a RLS esconde as linhas).

create or replace function public.contagem_de_atividades(p_clinic_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with hoje as (
    select (now() at time zone c.timezone)::date as dia
      from public.clinic c
     where c.id = p_clinic_id
  ),
  pendentes as (
    -- Sem coalesce o "atrasada" de quem nao tem hora seria NULL (due_at <
    -- now() com due_at nulo), e o "not atrasada" do hoje descartaria a linha.
    select a.assignee_user_id,
           coalesce(a.due_at < now(), a.due_on < h.dia) as atrasada,
           (a.due_on = h.dia) as do_dia
      from public.contact_activity a
     cross join hoje h
     where a.clinic_id = p_clinic_id
       and a.status = 'pendente'
       and (a.due_on <= h.dia or a.due_at < now())
  )
  select jsonb_build_object(
    'atrasadas', count(*) filter (where p.atrasada),
    'hoje', count(*) filter (where p.do_dia and not p.atrasada),
    'minhas_atrasadas',
      count(*) filter (where p.atrasada and p.assignee_user_id = auth.uid()),
    'minhas_hoje',
      count(*) filter (where p.do_dia and not p.atrasada and p.assignee_user_id = auth.uid())
  )
    from pendentes p
$$;

revoke all on function public.contagem_de_atividades(uuid) from public, anon;
grant execute on function public.contagem_de_atividades(uuid)
  to authenticated, service_role;

comment on function public.contagem_de_atividades(uuid) is
  'Pendentes da clinica: atrasadas (due_at < now(), ou sem hora e due_on antes de hoje), hoje (due_on = hoje e nao atrasada) e as mesmas duas so do responsavel = sessao. Hoje no fuso da clinica. SECURITY INVOKER: a RLS recorta.';

-- ---------------------------------------------------------------------------
-- 6) termo_eco_visto: o eco do celular anda o lead por termo UMA vez
-- ---------------------------------------------------------------------------
-- O eco (fromMe sem passar pela API: a recepcao escrevendo no celular
-- conectado) nao vira linha de message, entao nao existe o unique de
-- message.wa_message_id que separa a mensagem nova da reentrega do provedor.
-- A janela de 2 minutos da rota (ecoContaParaTermo) barra o eco velho, mas a
-- reentrega DENTRO dela moveria de novo um lead que alguem voltou a mao no
-- meio tempo, reancorando a regua da etapa e repetindo as automacoes de
-- "entrou na etapa". A regra 3.3 pede wa_message_id como chave unica, venha
-- de onde vier: a rota chama marcar_eco_para_termo ANTES de mover e so move
-- quando a marca nasceu agora. A janela continua como defesa extra.
--
-- So ids (nenhum texto nem termo, regra 3.1). RLS ligada SEM policy e sem
-- privilegio para anon e authenticated: nenhum papel de cliente le nem
-- escreve; so o service role do webhook.

create table if not exists public.termo_eco_visto (
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  wa_message_id text not null,
  created_at timestamptz not null default now(),
  constraint termo_eco_visto_pkey primary key (clinic_id, wa_message_id),
  constraint wa_message_id_do_eco_preenchido check (btrim(wa_message_id) <> '')
);

-- A poda (abaixo) apaga por clinica e idade.
create index if not exists termo_eco_visto_poda
  on public.termo_eco_visto (clinic_id, created_at);

comment on table public.termo_eco_visto is
  'Ecos do celular conectado ja usados pelo termo-chave da clinica (um por wa_message_id), para a reentrega do provedor nao andar o lead de novo. So ids. Escrita so por marcar_eco_para_termo, pelo service role; sem policy para o cliente.';

alter table public.termo_eco_visto enable row level security;

revoke all on table public.termo_eco_visto from anon, authenticated;

-- Devolve true quando este eco e NOVO e pode andar o lead (a rota so entao
-- chama tentarMoverPorTermo). Devolve false na reentrega e tambem quando a
-- clinica nao tem etapa que aceite termo escrito pela clinica: ai nada
-- andaria e nao ha por que gravar (hoje toda etapa nasce 'paciente', entao a
-- tabela so cresce para quem usa o recurso).
-- Poda na mesma chamada: a marca so importa enquanto o eco cabe na janela da
-- rota (2 minutos, mais 1 de folga de relogio); com mais de 1 dia, sai.
-- SECURITY INVOKER: so o service role executa (ignora RLS).
create or replace function public.marcar_eco_para_termo(
  p_clinic_id uuid,
  p_wa_message_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_marcadas integer;
begin
  if p_clinic_id is null
     or p_wa_message_id is null
     or btrim(p_wa_message_id) = '' then
    return false;
  end if;

  if not exists (
    select 1
      from public.funnel_stage_def d
     where d.clinic_id = p_clinic_id
       and d.termos_de_quem in ('clinica', 'qualquer')
       and cardinality(d.termos_chave) > 0
  ) then
    return false;
  end if;

  delete from public.termo_eco_visto v
   where v.clinic_id = p_clinic_id
     and v.created_at < now() - interval '1 day';

  insert into public.termo_eco_visto (clinic_id, wa_message_id)
  values (p_clinic_id, p_wa_message_id)
  on conflict (clinic_id, wa_message_id) do nothing;
  get diagnostics v_marcadas = row_count;
  return v_marcadas = 1;
end;
$$;

revoke all on function public.marcar_eco_para_termo(uuid, text)
  from public, anon, authenticated;
grant execute on function public.marcar_eco_para_termo(uuid, text)
  to service_role;

comment on function public.marcar_eco_para_termo(uuid, text) is
  'Marca o eco do celular (wa_message_id) como usado pelo termo-chave da clinica. true = eco novo e a clinica tem etapa com termo da clinica (a rota move); false = reentrega ou nada a mover. Poda as marcas com mais de 1 dia da mesma clinica. So service role.';
