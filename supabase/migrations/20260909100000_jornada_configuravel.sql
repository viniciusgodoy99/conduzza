-- Jornada configuravel por clinica (decisao do dono em 08/09/2026: "tudo
-- configuravel, para ser escalavel", no modelo da Jornada de Compra do Tintim).
--
-- A IDEIA CENTRAL. contact.funnel_stage continua sendo TEXTO com a chave da
-- etapa, mas o conjunto de chaves deixa de ser um CHECK global e passa a ser
-- definido por clinica nesta tabela. Cada clinica existente e semeada com as 6
-- etapas de hoje, COM AS MESMAS CHAVES: nenhum dado muda, nenhum consumidor
-- quebra, e a troca do resto do sistema acontece por fases.
--
-- QUATRO ETAPAS SAO DE SISTEMA (papel): entrada, agendou, compareceu, perdido.
-- Sao os ganchos que fazem o produto andar sozinho: o lead nasce na entrada,
-- criar agendamento move para a etapa-agendou DA CLINICA, comparecer move para
-- a etapa-compareceu, e perdido exige motivo. Elas podem ser RENOMEADAS e
-- REORDENADAS, nunca excluidas nem trocadas de papel: o sistema conhece
-- papeis, e o nome vira decisao da clinica. Todo o resto e etapa livre.
--
-- A CONVERSAO DA META MORA NA ETAPA, como no Tintim (evento, e venda, primeiro
-- contato, valor, tudo na edicao da etapa). As colunas ja nascem aqui; a
-- funnel_conversion_map de 08/09 sera absorvida e removida na fase da tela
-- (os dados dela, hoje zero linhas, serao copiados na hora).

-- ---------------------------------------------------------------------------
-- 1. A tabela da jornada

create table public.funnel_stage_def (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  -- Identidade ESTAVEL da etapa: e o que contact.funnel_stage guarda, o que a
  -- URL de filtro carrega e o que o Kanban usa de id. Imutavel por gatilho:
  -- renomear e mudar `nome`, nunca a chave, senao todo contato da etapa
  -- ficaria apontando para uma chave que nao existe mais.
  chave text not null,
  nome text not null,
  -- Ordem no Kanban e na regra de "so avanca": espacada de 10 em 10 para caber
  -- etapa nova no meio sem renumerar tudo.
  posicao integer not null,
  -- Aparencia dentro do vocabulario do design system (regra das 3 camadas):
  -- tom vem da paleta de status, icone e um nome do catalogo fixo do app.
  tom text not null default 'neutral'
    check (tom in ('neutral', 'info', 'warning', 'success', 'alert')),
  icone text not null default 'circle',
  -- O gancho de sistema. Nulo = etapa livre.
  papel text check (papel in ('entrada', 'agendou', 'compareceu', 'perdido')),
  -- Termo-chave (fase 4): palavras na conversa que movem o lead para ca.
  termos_chave text[] not null default '{}',
  -- Conversao para a Meta, absorvendo o desenho da funnel_conversion_map.
  meta_event_name text,
  conversao_ativa boolean not null default true,
  is_sale boolean not null default false,
  is_first_contact boolean not null default false,
  value_source text check (value_source in ('service_link', 'fixo')),
  value_cents integer check (value_cents is null or value_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, chave),
  constraint chave_de_etapa_valida check (chave ~ '^[a-z0-9_]{1,40}$'),
  constraint valor_fixo_exige_cents
    check (value_source is distinct from 'fixo' or value_cents is not null),
  -- Nao se devolve conversao de lead perdido (mesma decisao do mapa antigo).
  constraint perdido_sem_conversao
    check (papel is distinct from 'perdido' or meta_event_name is null)
);

-- No maximo UMA etapa por papel por clinica: dois "agendou" deixariam o
-- gatilho da agenda sem saber para onde mover.
create unique index funnel_stage_def_papel_unico
  on public.funnel_stage_def (clinic_id, papel)
  where papel is not null;

create index funnel_stage_def_ordem
  on public.funnel_stage_def (clinic_id, posicao);

create trigger set_updated_at before update on public.funnel_stage_def
  for each row execute function public.set_updated_at();

alter table public.funnel_stage_def enable row level security;

create policy "membro le a jornada" on public.funnel_stage_def
  for select using (clinic_id in (select public.user_active_clinic_ids()));

create policy "gestao gerencia a jornada" on public.funnel_stage_def
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- ---------------------------------------------------------------------------
-- 2. Protecoes que nao dependem de tela (valem ate para o service role)

create or replace function public.proteger_jornada()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.chave is distinct from old.chave then
      raise exception 'A chave de uma etapa não muda. Renomeie o nome da etapa.';
    end if;
    if new.papel is distinct from old.papel then
      raise exception 'O papel de sistema de uma etapa não muda.';
    end if;
    return new;
  end if;
  -- DELETE. Se a CLINICA inteira esta sendo apagada, o cascade manda: as
  -- protecoes abaixo valem para apagar UMA etapa, nao para desmontar a
  -- clinica (sem isto, nenhuma clinica conseguiria ser excluida, e todo
  -- afterAll de teste quebraria).
  if not exists (select 1 from public.clinic where id = old.clinic_id) then
    return old;
  end if;
  if old.papel is not null then
    raise exception 'Etapa de sistema não pode ser excluída. Renomeie ou reordene.';
  end if;
  if exists (
    select 1 from public.contact
     where clinic_id = old.clinic_id and funnel_stage = old.chave
  ) then
    raise exception 'Mova os contatos desta etapa antes de excluí-la.';
  end if;
  return old;
end;
$$;

create trigger proteger_jornada
  before update or delete on public.funnel_stage_def
  for each row execute function public.proteger_jornada();

-- ---------------------------------------------------------------------------
-- 3. Semeadura: a jornada padrao (as 6 etapas de hoje, mesmas chaves)

create or replace function public.semear_jornada_padrao(p_clinic_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.funnel_stage_def
    (clinic_id, chave, nome, posicao, tom, icone, papel)
  values
    (p_clinic_id, 'novo',                'Novo',                10, 'neutral', 'badge-plus',          'entrada'),
    (p_clinic_id, 'em_contato',          'Em contato',          20, 'info',    'message-square-text', null),
    (p_clinic_id, 'aguardando_resposta', 'Aguardando resposta', 30, 'warning', 'timer',               null),
    (p_clinic_id, 'agendou',             'Agendou',             40, 'success', 'calendar-plus',       'agendou'),
    (p_clinic_id, 'compareceu',          'Compareceu',          50, 'success', 'check-check',         'compareceu'),
    (p_clinic_id, 'perdido',             'Perdido',             60, 'alert',   'user-round-x',        'perdido')
  on conflict (clinic_id, chave) do nothing;
$$;

revoke all on function public.semear_jornada_padrao(uuid)
  from public, anon, authenticated;

-- Toda clinica que EXISTE ganha a jornada agora...
select public.semear_jornada_padrao(id) from public.clinic;

-- ...e toda clinica que NASCER ganha a dela junto (o cadastro publico cria a
-- clinica pelo gatilho handle_new_user; este AFTER INSERT roda na mesma
-- transacao).
create or replace function public.semear_jornada_de_clinica_nova()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.semear_jornada_padrao(new.id);
  return new;
end;
$$;

create trigger semear_jornada_de_clinica_nova
  after insert on public.clinic
  for each row execute function public.semear_jornada_de_clinica_nova();

-- ---------------------------------------------------------------------------
-- 4. contact: a validacao deixa de ser um CHECK global e passa a ser por
-- clinica. Etapa desconhecida e RECUSADA, no insert e no update: a chave
-- 'novo' (entrada) existe garantidamente em toda clinica, porque a semeadura
-- a cria, a chave e imutavel e etapa de sistema e indelevel. Um fallback
-- silencioso aqui aceitaria lixo com cara de sucesso, que e pior que falhar
-- alto.

alter table public.contact
  drop constraint if exists contact_funnel_stage_check;
alter table public.contact
  drop constraint if exists contact_perdido_exige_motivo;

create or replace function public.validar_etapa_do_contato()
returns trigger
language plpgsql
as $$
declare
  v_papel text;
begin
  select papel into v_papel
    from public.funnel_stage_def
   where clinic_id = new.clinic_id and chave = new.funnel_stage;

  if not found then
    -- errcode de CHECK preservado: e o codigo que o contrato antigo (o check
    -- global) devolvia, e que actions e testes ja tratam.
    raise exception 'A etapa "%" não existe na jornada desta clínica.',
      new.funnel_stage using errcode = '23514';
  end if;

  -- A regra que era o CHECK contact_perdido_exige_motivo, agora por papel:
  -- perder um lead exige dizer por que, seja qual for o nome da etapa.
  if v_papel = 'perdido' and new.lost_reason is null then
    raise exception 'Marcar como perdido exige o motivo da perda.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger validar_etapa_do_contato
  before insert or update on public.contact
  for each row execute function public.validar_etapa_do_contato();

-- ---------------------------------------------------------------------------
-- 5. Os gatilhos da agenda passam a resolver a etapa POR PAPEL e a decidir
-- avanco POR POSICAO, preservando exatamente o comportamento de hoje na
-- jornada semeada: novo(10)/em_contato(20)/aguardando(30) avancam para
-- agendou(40); perdido volta ao funil; compareceu(50) nunca regride. Com
-- etapas livres depois de compareceu (ex.: "Comprou pacote"), um novo
-- agendamento NAO puxa o lead para tras, que e o que a lista fixa antiga nao
-- tinha como expressar.

create or replace function public.avancar_funil_ao_agendar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destino record;
begin
  select chave, posicao into v_destino
    from public.funnel_stage_def
   where clinic_id = new.clinic_id and papel = 'agendou';
  if not found then
    return new;
  end if;

  update public.contact c
     set funnel_stage = v_destino.chave,
         lost_reason = null,
         lost_reason_note = null
   where c.id = new.contact_id
     and c.clinic_id = new.clinic_id
     and exists (
       select 1 from public.funnel_stage_def d
        where d.clinic_id = c.clinic_id
          and d.chave = c.funnel_stage
          and (d.posicao < v_destino.posicao or d.papel = 'perdido')
     );
  return new;
end;
$$;

create or replace function public.avancar_funil_ao_comparecer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destino record;
begin
  select chave, posicao into v_destino
    from public.funnel_stage_def
   where clinic_id = new.clinic_id and papel = 'compareceu';
  if not found then
    return new;
  end if;

  update public.contact c
     set funnel_stage = v_destino.chave
   where c.id = new.contact_id
     and c.clinic_id = new.clinic_id
     and exists (
       select 1 from public.funnel_stage_def d
        where d.clinic_id = c.clinic_id
          and d.chave = c.funnel_stage
          and (d.posicao < v_destino.posicao or d.papel = 'perdido')
     );
  return new;
end;
$$;
