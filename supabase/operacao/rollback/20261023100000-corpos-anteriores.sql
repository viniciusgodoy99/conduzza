-- Corpos lidos da producao em 21/10/2026, antes da migration 20261023100000
-- (jornada obrigatoria e a passagem da IA no funil, onda 3, M1). md5(prosrc)
-- na leitura (o ensaio confere que o banco ainda esta assim antes de
-- trocar):
--   semear_jornada_padrao(uuid)                   90ef6844231bd0371967f37a7287bd89
--   reordenar_etapa_da_jornada(uuid, text, text)  06f629751167b225f08906a9c500663f
-- Nenhuma das duas tinha comentario (continua sem).
--
-- ROLLBACK manual da migration (cabecalho dela). ORDEM:
--   0. ANTES, o rollback da M2 (20261023110000-corpos-anteriores.sql): o
--      gatilho de conversation sai. Este arquivo PARA se ele ainda existir.
--   1. O codigo da onda 3 (P1) funciona com o banco de antes: nao precisa
--      voltar.
--   2. Rodar ESTE arquivo inteiro no SQL editor. Sao DUAS transacoes. A
--      PRIMEIRA desfaz tudo menos a tabela de pendencias:
--      a. a entrada funil-da-passagem do pg_cron e a batida motor-funil saem;
--      b. o gatilho de cadence, o gatilho da ordem da jornada
--         (conferir_ordem_da_jornada) e as cinco funcoes novas saem; sem
--         elas a tabela de pendencias fica inerte (nada le nem grava; a
--         pendencia ainda nao processada, so ids, se perde: o lead fica onde
--         esta);
--      c. os dois corpos de antes voltam (CREATE OR REPLACE: mesmas
--         assinaturas, security, search_path e grants);
--      d. papel nulo de novo em Aguardando resposta e Em contato, com
--         proteger_jornada desligado SO nesta transacao;
--      e. a Aguardando resposta que a M1 recriou (nas clinicas que nao a
--         tinham em 21/10/2026: so a Salud Care) sai se continuar vazia (sem
--         contato, sem regua de follow-up e sem automacao de fluxo);
--      f. a ordem de antes: Aguardando resposta logo DEPOIS de Em contato, o
--         resto na ordem de agora (posicao, chave), renumerado 10, 20, 30. Com
--         a jornada como a M1 deixou, devolve exatamente as posicoes de
--         21/10/2026; o que a clinica mudou depois da M1 (etapa nova,
--         reordenacao das livres, clinica nova) fica, so com as duas na ordem
--         de antes;
--      g. o CHECK de papel de antes (entrada, agendou, compareceu, perdido);
--      h. conferencia (so aviso, NOTICE): as posicoes de agora contra o
--         retrato de 21/10/2026 (260 linhas: clinica, chave e posicao, nada de
--         paciente). Diferenca so aparece se a clinica mudou a jornada depois
--         da M1.
--      A SEGUNDA, sozinha e curta, so faz o DROP da tabela
--      etapa_pendente_da_passagem. Pode ficar para outro horario: a tabela
--      ja esta inerte.
-- TRAVAS. PRIMEIRA transacao, lock_timeout de 3 s: o CHECK segura
-- funnel_stage_def (ACCESS EXCLUSIVE) ate o commit, como na M1 (a ingestao
-- espera fracoes de segundo); os DROP de gatilho pegam ACCESS EXCLUSIVE em
-- cadence (fria) e em funnel_stage_def (ja travada). Nenhuma trava em clinic.
-- SEGUNDA transacao, lock_timeout de 1 s: tirar a FK da tabela para clinic
-- apaga os gatilhos de integridade do lado de clinic, e isso pega ACCESS
-- EXCLUSIVE em CLINIC ate o commit (medido no Postgres local em 21/10/2026).
-- Enquanto o pedido espera na fila e ate o commit, param toda leitura de
-- clinic e todo insert com FK para clinic (message, contact, conversation,
-- job_queue, audit_log): a ingestao, o motor e as telas. Por isso ela nao
-- divide a transacao com mais nada (o DROP leva milissegundos) e desiste em
-- 1 s: se cair por 55P03 (lock_timeout, uma transacao longa tocou clinic),
-- nada mudou; tentar de novo minutos depois. Horario calmo para as duas.
-- O que fica: a trilha ia_moveu_etapa (audit_log); os leads que a passagem
-- levou para Aguardando resposta continuam la (etapa livre de novo); as
-- execucoes de automacao e as conversoes que a entrada na etapa gerou.
-- Conferir no fim: os dois md5 acima, nenhuma das cinco funcoes novas, nenhum
-- gatilho conferir_ordem_da_jornada, nenhuma tabela
-- etapa_pendente_da_passagem, nenhum papel aguardando ou em_contato, nenhuma
-- entrada funil-da-passagem em cron.job.

begin;
set local lock_timeout = '3s';

-- 0. A M2 tem de ter saido antes (o gatilho dela chama a funcao que sai aqui).
do $antes$
begin
  if exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.conversation'::regclass
       and t.tgname = 'passagem_da_ia_move_o_lead'
  ) then
    raise exception 'Rode antes o rollback da M2 (supabase/operacao/rollback/20261023110000-corpos-anteriores.sql): o gatilho passagem_da_ia_move_o_lead ainda existe.';
  end if;
end;
$antes$;

-- 1. A entrada do pg_cron (por execute: o banco pode nao ter o pg_cron) e a
-- batida.
do $cron$
begin
  if to_regclass('cron.job') is not null then
    execute $q$
      select cron.unschedule(j.jobname)
        from cron.job j
       where j.jobname = 'funil-da-passagem'
    $q$;
  end if;
end;
$cron$;
delete from public.worker_heartbeat where worker_id = 'motor-funil';

-- 2. Os gatilhos e as funcoes novas. O gatilho da ordem sai ANTES de
-- qualquer comando em funnel_stage_def nesta transacao (a ordem de antes
-- poe Aguardando resposta depois de Em contato, e ele recusaria). A tabela de
-- pendencias NAO sai aqui: o DROP dela trava clinic (veja TRAVAS) e vai
-- sozinho na segunda transacao, no fim deste arquivo.
drop trigger if exists conferir_ordem_da_jornada on public.funnel_stage_def;
drop function if exists public.conferir_ordem_da_jornada();
drop trigger if exists recusar_followup_em_aguardando on public.cadence;
drop function if exists public.recusar_followup_em_aguardando();
drop function if exists public.processar_pendencias_do_funil(integer, uuid, boolean);
drop function if exists public.passagem_da_ia_move_o_lead();
drop function if exists public.mover_lead_para_aguardando(uuid, uuid, uuid, boolean);

-- 3. Os corpos de antes.
-- semear_jornada_padrao: corpo do banco ANTES da 20261023100000
CREATE OR REPLACE FUNCTION public.semear_jornada_padrao(p_clinic_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- reordenar_etapa_da_jornada: corpo do banco ANTES da 20261023100000
CREATE OR REPLACE FUNCTION public.reordenar_etapa_da_jornada(p_clinic_id uuid, p_chave text, p_direcao text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_chaves text[];
  v_ids uuid[];
  v_indice integer;
  v_alvo integer;
  v_tmp text;
  v_movida uuid;
  i integer;
begin
  if p_direcao not in ('subir', 'descer') then
    raise exception 'Direção inválida.';
  end if;

  -- Agregado sobre subquery porque FOR UPDATE nao convive com array_agg na
  -- mesma query. O desempate por chave e o MESMO da leitura da tela
  -- (fetchJornada ordena por posicao, chave): o que o usuario ve e o que
  -- a troca usa.
  select
      array_agg(etapas.chave order by etapas.posicao, etapas.chave),
      array_agg(etapas.id order by etapas.posicao, etapas.chave)
    into v_chaves, v_ids
    from (
      select id, chave, posicao
        from public.funnel_stage_def
       where clinic_id = p_clinic_id
         for update
    ) etapas;

  v_indice := array_position(v_chaves, p_chave);
  if v_indice is null then
    raise exception 'Etapa não encontrada.';
  end if;

  v_alvo := v_indice + case when p_direcao = 'subir' then -1 else 1 end;
  if v_alvo < 1 or v_alvo > array_length(v_chaves, 1) then
    raise exception 'A etapa já está na ponta da jornada.';
  end if;

  v_movida := v_ids[v_indice];
  v_tmp := v_chaves[v_indice];
  v_chaves[v_indice] := v_chaves[v_alvo];
  v_chaves[v_alvo] := v_tmp;

  for i in 1..array_length(v_chaves, 1) loop
    update public.funnel_stage_def
       set posicao = i * 10
     where clinic_id = p_clinic_id
       and chave = v_chaves[i]
       and posicao is distinct from i * 10;
  end loop;

  return v_movida;
end;
$function$;

-- 4. Papel nulo de novo nas duas (proteger_jornada desligado SO aqui).
alter table public.funnel_stage_def disable trigger proteger_jornada;
update public.funnel_stage_def
   set papel = null
 where papel in ('aguardando', 'em_contato');
alter table public.funnel_stage_def enable trigger proteger_jornada;

-- 5. A Aguardando resposta que a M1 recriou, se continuar vazia (as clinicas
-- que nao tinham a etapa em 21/10/2026).
delete from public.funnel_stage_def d
 where d.chave = 'aguardando_resposta'
   and d.clinic_id in (
         '682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid  -- Salud Care
       )
   and not exists (
     select 1 from public.contact k
      where k.clinic_id = d.clinic_id and k.funnel_stage = d.chave
   )
   and not exists (
     select 1 from public.cadence r
      where r.clinic_id = d.clinic_id and r.kind = 'followup' and r.trigger_stage = d.chave
   )
   and not exists (
     select 1 from public.automacao_fluxo a
      where a.clinic_id = d.clinic_id and (a.etapa = d.chave or a.etapa_destino = d.chave)
   );

-- 6. A ordem de antes: Aguardando resposta logo depois de Em contato, o resto
-- pela ordem de agora (posicao, chave); renumera 10, 20, 30.
with ordem as (
  select d.id,
         row_number() over (
           partition by d.clinic_id
           order by case when d.chave = 'aguardando_resposta' and e.id is not null
                         then e.posicao else d.posicao end,
                    case when d.chave = 'aguardando_resposta' and e.id is not null
                         then e.chave else d.chave end,
                    case when d.chave = 'aguardando_resposta' and e.id is not null
                         then 1 else 0 end
         ) * 10 as nova
    from public.funnel_stage_def d
    left join public.funnel_stage_def e
      on e.clinic_id = d.clinic_id
     and e.chave = 'em_contato'
)
update public.funnel_stage_def d
   set posicao = o.nova
  from ordem o
 where d.id = o.id
   and d.posicao is distinct from o.nova;

-- 7. O CHECK de papel de antes.
alter table public.funnel_stage_def
  drop constraint funnel_stage_def_papel_check;
alter table public.funnel_stage_def
  add constraint funnel_stage_def_papel_check
  check (papel in ('entrada', 'agendou', 'compareceu', 'perdido'));

-- 8. Conferencia (so aviso): as posicoes de agora contra o retrato de
-- 21/10/2026 (clinica, chave, posicao), nas clinicas do retrato que ainda
-- existem.
do $retrato$
declare
  v_faltam integer;
  v_sobram integer;
  v_clinicas text;
begin
  create temp table rollback_onda3_retrato (clinic_id uuid, chave text, posicao integer)
    on commit drop;
  insert into rollback_onda3_retrato (clinic_id, chave, posicao) values
      ('0462113b-11de-4645-9d7e-c968efff9ec1'::uuid, 'novo', 10),
      ('0462113b-11de-4645-9d7e-c968efff9ec1'::uuid, 'em_contato', 20),
      ('0462113b-11de-4645-9d7e-c968efff9ec1'::uuid, 'aguardando_resposta', 30),
      ('0462113b-11de-4645-9d7e-c968efff9ec1'::uuid, 'agendou', 40),
      ('0462113b-11de-4645-9d7e-c968efff9ec1'::uuid, 'compareceu', 50),
      ('0462113b-11de-4645-9d7e-c968efff9ec1'::uuid, 'perdido', 60),
      ('0fea8527-d347-4604-8e88-08bab4169f01'::uuid, 'novo', 10),
      ('0fea8527-d347-4604-8e88-08bab4169f01'::uuid, 'em_contato', 20),
      ('0fea8527-d347-4604-8e88-08bab4169f01'::uuid, 'aguardando_resposta', 30),
      ('0fea8527-d347-4604-8e88-08bab4169f01'::uuid, 'agendou', 40),
      ('0fea8527-d347-4604-8e88-08bab4169f01'::uuid, 'compareceu', 50),
      ('0fea8527-d347-4604-8e88-08bab4169f01'::uuid, 'perdido', 60),
      ('1096f648-5c64-4583-8e7c-a85b05c0a395'::uuid, 'novo', 10),
      ('1096f648-5c64-4583-8e7c-a85b05c0a395'::uuid, 'em_contato', 20),
      ('1096f648-5c64-4583-8e7c-a85b05c0a395'::uuid, 'aguardando_resposta', 30),
      ('1096f648-5c64-4583-8e7c-a85b05c0a395'::uuid, 'agendou', 40),
      ('1096f648-5c64-4583-8e7c-a85b05c0a395'::uuid, 'compareceu', 50),
      ('1096f648-5c64-4583-8e7c-a85b05c0a395'::uuid, 'perdido', 60),
      ('15761e8f-1e1c-4a74-a51b-b7cd9f95a962'::uuid, 'novo', 10),
      ('15761e8f-1e1c-4a74-a51b-b7cd9f95a962'::uuid, 'em_contato', 20),
      ('15761e8f-1e1c-4a74-a51b-b7cd9f95a962'::uuid, 'aguardando_resposta', 30),
      ('15761e8f-1e1c-4a74-a51b-b7cd9f95a962'::uuid, 'agendou', 40),
      ('15761e8f-1e1c-4a74-a51b-b7cd9f95a962'::uuid, 'compareceu', 50),
      ('15761e8f-1e1c-4a74-a51b-b7cd9f95a962'::uuid, 'perdido', 60),
      ('18a02575-de90-4905-bb07-7754ea58395e'::uuid, 'novo', 10),
      ('18a02575-de90-4905-bb07-7754ea58395e'::uuid, 'em_contato', 20),
      ('18a02575-de90-4905-bb07-7754ea58395e'::uuid, 'aguardando_resposta', 30),
      ('18a02575-de90-4905-bb07-7754ea58395e'::uuid, 'agendou', 40),
      ('18a02575-de90-4905-bb07-7754ea58395e'::uuid, 'compareceu', 50),
      ('18a02575-de90-4905-bb07-7754ea58395e'::uuid, 'perdido', 60),
      ('218a81d0-2d46-4300-8c55-b18a95215fdb'::uuid, 'novo', 10),
      ('218a81d0-2d46-4300-8c55-b18a95215fdb'::uuid, 'em_contato', 20),
      ('218a81d0-2d46-4300-8c55-b18a95215fdb'::uuid, 'aguardando_resposta', 30),
      ('218a81d0-2d46-4300-8c55-b18a95215fdb'::uuid, 'agendou', 40),
      ('218a81d0-2d46-4300-8c55-b18a95215fdb'::uuid, 'compareceu', 50),
      ('218a81d0-2d46-4300-8c55-b18a95215fdb'::uuid, 'perdido', 60),
      ('2b8c7d7c-8eb5-4fb9-99e2-e51734c23702'::uuid, 'novo', 10),
      ('2b8c7d7c-8eb5-4fb9-99e2-e51734c23702'::uuid, 'em_contato', 20),
      ('2b8c7d7c-8eb5-4fb9-99e2-e51734c23702'::uuid, 'aguardando_resposta', 30),
      ('2b8c7d7c-8eb5-4fb9-99e2-e51734c23702'::uuid, 'agendou', 40),
      ('2b8c7d7c-8eb5-4fb9-99e2-e51734c23702'::uuid, 'compareceu', 50),
      ('2b8c7d7c-8eb5-4fb9-99e2-e51734c23702'::uuid, 'perdido', 60),
      ('2f6b4bde-ade1-45ff-ab94-c2ca76c4ab2a'::uuid, 'novo', 10),
      ('2f6b4bde-ade1-45ff-ab94-c2ca76c4ab2a'::uuid, 'em_contato', 20),
      ('2f6b4bde-ade1-45ff-ab94-c2ca76c4ab2a'::uuid, 'aguardando_resposta', 30),
      ('2f6b4bde-ade1-45ff-ab94-c2ca76c4ab2a'::uuid, 'agendou', 40),
      ('2f6b4bde-ade1-45ff-ab94-c2ca76c4ab2a'::uuid, 'compareceu', 50),
      ('2f6b4bde-ade1-45ff-ab94-c2ca76c4ab2a'::uuid, 'perdido', 60),
      ('3837b006-85ed-4696-9fb6-accf5efe99c7'::uuid, 'novo', 10),
      ('3837b006-85ed-4696-9fb6-accf5efe99c7'::uuid, 'em_contato', 20),
      ('3837b006-85ed-4696-9fb6-accf5efe99c7'::uuid, 'aguardando_resposta', 30),
      ('3837b006-85ed-4696-9fb6-accf5efe99c7'::uuid, 'agendou', 40),
      ('3837b006-85ed-4696-9fb6-accf5efe99c7'::uuid, 'compareceu', 50),
      ('3837b006-85ed-4696-9fb6-accf5efe99c7'::uuid, 'perdido', 60),
      ('3d5f9563-6399-47db-9eb7-8a4b2bc718fd'::uuid, 'novo', 10),
      ('3d5f9563-6399-47db-9eb7-8a4b2bc718fd'::uuid, 'em_contato', 20),
      ('3d5f9563-6399-47db-9eb7-8a4b2bc718fd'::uuid, 'aguardando_resposta', 30),
      ('3d5f9563-6399-47db-9eb7-8a4b2bc718fd'::uuid, 'agendou', 40),
      ('3d5f9563-6399-47db-9eb7-8a4b2bc718fd'::uuid, 'compareceu', 50),
      ('3d5f9563-6399-47db-9eb7-8a4b2bc718fd'::uuid, 'perdido', 60),
      ('3e3076e0-d5b3-436c-bf4d-0c2d1b30f866'::uuid, 'novo', 10),
      ('3e3076e0-d5b3-436c-bf4d-0c2d1b30f866'::uuid, 'em_contato', 20),
      ('3e3076e0-d5b3-436c-bf4d-0c2d1b30f866'::uuid, 'aguardando_resposta', 30),
      ('3e3076e0-d5b3-436c-bf4d-0c2d1b30f866'::uuid, 'agendou', 40),
      ('3e3076e0-d5b3-436c-bf4d-0c2d1b30f866'::uuid, 'compareceu', 50),
      ('3e3076e0-d5b3-436c-bf4d-0c2d1b30f866'::uuid, 'perdido', 60),
      ('480305b0-e3c8-46cf-8475-6f8efd832bbf'::uuid, 'novo', 10),
      ('480305b0-e3c8-46cf-8475-6f8efd832bbf'::uuid, 'em_contato', 20),
      ('480305b0-e3c8-46cf-8475-6f8efd832bbf'::uuid, 'aguardando_resposta', 30),
      ('480305b0-e3c8-46cf-8475-6f8efd832bbf'::uuid, 'agendou', 40),
      ('480305b0-e3c8-46cf-8475-6f8efd832bbf'::uuid, 'compareceu', 50),
      ('480305b0-e3c8-46cf-8475-6f8efd832bbf'::uuid, 'perdido', 60),
      ('4b4056d4-cf42-4a61-b28f-51f6ad3eb1bb'::uuid, 'novo', 10),
      ('4b4056d4-cf42-4a61-b28f-51f6ad3eb1bb'::uuid, 'em_contato', 20),
      ('4b4056d4-cf42-4a61-b28f-51f6ad3eb1bb'::uuid, 'aguardando_resposta', 30),
      ('4b4056d4-cf42-4a61-b28f-51f6ad3eb1bb'::uuid, 'agendou', 40),
      ('4b4056d4-cf42-4a61-b28f-51f6ad3eb1bb'::uuid, 'compareceu', 50),
      ('4b4056d4-cf42-4a61-b28f-51f6ad3eb1bb'::uuid, 'perdido', 60),
      ('5bcb26a5-cec0-47ba-975c-fd8a94b04ac5'::uuid, 'novo', 10),
      ('5bcb26a5-cec0-47ba-975c-fd8a94b04ac5'::uuid, 'em_contato', 20),
      ('5bcb26a5-cec0-47ba-975c-fd8a94b04ac5'::uuid, 'aguardando_resposta', 30),
      ('5bcb26a5-cec0-47ba-975c-fd8a94b04ac5'::uuid, 'agendou', 40),
      ('5bcb26a5-cec0-47ba-975c-fd8a94b04ac5'::uuid, 'compareceu', 50),
      ('5bcb26a5-cec0-47ba-975c-fd8a94b04ac5'::uuid, 'perdido', 60),
      ('5c8f320f-a39c-40e4-8b53-96f76ced3916'::uuid, 'novo', 10),
      ('5c8f320f-a39c-40e4-8b53-96f76ced3916'::uuid, 'em_contato', 20),
      ('5c8f320f-a39c-40e4-8b53-96f76ced3916'::uuid, 'aguardando_resposta', 30),
      ('5c8f320f-a39c-40e4-8b53-96f76ced3916'::uuid, 'agendou', 40),
      ('5c8f320f-a39c-40e4-8b53-96f76ced3916'::uuid, 'compareceu', 50),
      ('5c8f320f-a39c-40e4-8b53-96f76ced3916'::uuid, 'perdido', 60),
      ('5e71bcec-60c1-4c5b-a3cd-ad47e570017d'::uuid, 'novo', 10),
      ('5e71bcec-60c1-4c5b-a3cd-ad47e570017d'::uuid, 'em_contato', 20),
      ('5e71bcec-60c1-4c5b-a3cd-ad47e570017d'::uuid, 'aguardando_resposta', 30),
      ('5e71bcec-60c1-4c5b-a3cd-ad47e570017d'::uuid, 'agendou', 40),
      ('5e71bcec-60c1-4c5b-a3cd-ad47e570017d'::uuid, 'compareceu', 50),
      ('5e71bcec-60c1-4c5b-a3cd-ad47e570017d'::uuid, 'perdido', 60),
      ('6180eafd-ca63-4fbe-a801-ccb72fb6b471'::uuid, 'novo', 10),
      ('6180eafd-ca63-4fbe-a801-ccb72fb6b471'::uuid, 'em_contato', 20),
      ('6180eafd-ca63-4fbe-a801-ccb72fb6b471'::uuid, 'aguardando_resposta', 30),
      ('6180eafd-ca63-4fbe-a801-ccb72fb6b471'::uuid, 'agendou', 40),
      ('6180eafd-ca63-4fbe-a801-ccb72fb6b471'::uuid, 'compareceu', 50),
      ('6180eafd-ca63-4fbe-a801-ccb72fb6b471'::uuid, 'perdido', 60),
      ('628d92b7-64a0-4610-9e6b-f588eae37879'::uuid, 'novo', 10),
      ('628d92b7-64a0-4610-9e6b-f588eae37879'::uuid, 'em_contato', 20),
      ('628d92b7-64a0-4610-9e6b-f588eae37879'::uuid, 'aguardando_resposta', 30),
      ('628d92b7-64a0-4610-9e6b-f588eae37879'::uuid, 'agendou', 40),
      ('628d92b7-64a0-4610-9e6b-f588eae37879'::uuid, 'compareceu', 50),
      ('628d92b7-64a0-4610-9e6b-f588eae37879'::uuid, 'perdido', 60),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'novo', 10),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'em_contato', 20),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'follow_1_audio', 30),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'follow_2_ligacao', 40),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'follow_3_mensagem', 50),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'follow_4_audio', 60),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'follow_5_mensagem_finalizacao', 70),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'follow_6_mensagem', 80),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'follow_7_ligacao', 90),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'follow_8_mensagem', 100),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'agendou', 110),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'compareceu', 120),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'comprou_homecare', 130),
      ('682edca6-cc7d-4bb7-8db6-4c68e2510549'::uuid, 'perdido', 140),
      ('68e52f62-2a45-4384-813d-7dfc49361ff0'::uuid, 'novo', 10),
      ('68e52f62-2a45-4384-813d-7dfc49361ff0'::uuid, 'em_contato', 20),
      ('68e52f62-2a45-4384-813d-7dfc49361ff0'::uuid, 'aguardando_resposta', 30),
      ('68e52f62-2a45-4384-813d-7dfc49361ff0'::uuid, 'agendou', 40),
      ('68e52f62-2a45-4384-813d-7dfc49361ff0'::uuid, 'compareceu', 50),
      ('68e52f62-2a45-4384-813d-7dfc49361ff0'::uuid, 'perdido', 60),
      ('6fdc5c44-d058-45dc-b2fb-4eadd763c247'::uuid, 'novo', 10),
      ('6fdc5c44-d058-45dc-b2fb-4eadd763c247'::uuid, 'em_contato', 20),
      ('6fdc5c44-d058-45dc-b2fb-4eadd763c247'::uuid, 'aguardando_resposta', 30),
      ('6fdc5c44-d058-45dc-b2fb-4eadd763c247'::uuid, 'agendou', 40),
      ('6fdc5c44-d058-45dc-b2fb-4eadd763c247'::uuid, 'compareceu', 50),
      ('6fdc5c44-d058-45dc-b2fb-4eadd763c247'::uuid, 'perdido', 60),
      ('79658216-9561-4bab-a4d3-0408766332a8'::uuid, 'novo', 10),
      ('79658216-9561-4bab-a4d3-0408766332a8'::uuid, 'em_contato', 20),
      ('79658216-9561-4bab-a4d3-0408766332a8'::uuid, 'aguardando_resposta', 30),
      ('79658216-9561-4bab-a4d3-0408766332a8'::uuid, 'agendou', 40),
      ('79658216-9561-4bab-a4d3-0408766332a8'::uuid, 'compareceu', 50),
      ('79658216-9561-4bab-a4d3-0408766332a8'::uuid, 'perdido', 60),
      ('85f09ee0-f0ce-4665-a671-7b3aea53d2df'::uuid, 'novo', 10),
      ('85f09ee0-f0ce-4665-a671-7b3aea53d2df'::uuid, 'em_contato', 20),
      ('85f09ee0-f0ce-4665-a671-7b3aea53d2df'::uuid, 'aguardando_resposta', 30),
      ('85f09ee0-f0ce-4665-a671-7b3aea53d2df'::uuid, 'agendou', 40),
      ('85f09ee0-f0ce-4665-a671-7b3aea53d2df'::uuid, 'compareceu', 50),
      ('85f09ee0-f0ce-4665-a671-7b3aea53d2df'::uuid, 'perdido', 60),
      ('883ffb00-7d88-49a9-b169-341c7db38c1c'::uuid, 'novo', 10),
      ('883ffb00-7d88-49a9-b169-341c7db38c1c'::uuid, 'em_contato', 20),
      ('883ffb00-7d88-49a9-b169-341c7db38c1c'::uuid, 'aguardando_resposta', 30),
      ('883ffb00-7d88-49a9-b169-341c7db38c1c'::uuid, 'agendou', 40),
      ('883ffb00-7d88-49a9-b169-341c7db38c1c'::uuid, 'compareceu', 50),
      ('883ffb00-7d88-49a9-b169-341c7db38c1c'::uuid, 'perdido', 60),
      ('a15bf428-898c-42bd-8e27-b52e7327bb8e'::uuid, 'novo', 10),
      ('a15bf428-898c-42bd-8e27-b52e7327bb8e'::uuid, 'em_contato', 20),
      ('a15bf428-898c-42bd-8e27-b52e7327bb8e'::uuid, 'aguardando_resposta', 30),
      ('a15bf428-898c-42bd-8e27-b52e7327bb8e'::uuid, 'agendou', 40),
      ('a15bf428-898c-42bd-8e27-b52e7327bb8e'::uuid, 'compareceu', 50),
      ('a15bf428-898c-42bd-8e27-b52e7327bb8e'::uuid, 'perdido', 60),
      ('a6e202c8-cf0d-457d-b5a7-cf8f36669725'::uuid, 'novo', 10),
      ('a6e202c8-cf0d-457d-b5a7-cf8f36669725'::uuid, 'em_contato', 20),
      ('a6e202c8-cf0d-457d-b5a7-cf8f36669725'::uuid, 'aguardando_resposta', 30),
      ('a6e202c8-cf0d-457d-b5a7-cf8f36669725'::uuid, 'agendou', 40),
      ('a6e202c8-cf0d-457d-b5a7-cf8f36669725'::uuid, 'compareceu', 50),
      ('a6e202c8-cf0d-457d-b5a7-cf8f36669725'::uuid, 'perdido', 60),
      ('aa33be67-9d20-493d-b4c2-7b1183c02965'::uuid, 'novo', 10),
      ('aa33be67-9d20-493d-b4c2-7b1183c02965'::uuid, 'em_contato', 20),
      ('aa33be67-9d20-493d-b4c2-7b1183c02965'::uuid, 'aguardando_resposta', 30),
      ('aa33be67-9d20-493d-b4c2-7b1183c02965'::uuid, 'agendou', 40),
      ('aa33be67-9d20-493d-b4c2-7b1183c02965'::uuid, 'compareceu', 50),
      ('aa33be67-9d20-493d-b4c2-7b1183c02965'::uuid, 'perdido', 60),
      ('acd9c539-585e-4f2a-a195-712c70099564'::uuid, 'novo', 10),
      ('acd9c539-585e-4f2a-a195-712c70099564'::uuid, 'em_contato', 20),
      ('acd9c539-585e-4f2a-a195-712c70099564'::uuid, 'aguardando_resposta', 30),
      ('acd9c539-585e-4f2a-a195-712c70099564'::uuid, 'agendou', 40),
      ('acd9c539-585e-4f2a-a195-712c70099564'::uuid, 'compareceu', 50),
      ('acd9c539-585e-4f2a-a195-712c70099564'::uuid, 'perdido', 60),
      ('b4085eaf-f7b1-41bd-9ab6-7d9435fd4c8a'::uuid, 'novo', 10),
      ('b4085eaf-f7b1-41bd-9ab6-7d9435fd4c8a'::uuid, 'em_contato', 20),
      ('b4085eaf-f7b1-41bd-9ab6-7d9435fd4c8a'::uuid, 'aguardando_resposta', 30),
      ('b4085eaf-f7b1-41bd-9ab6-7d9435fd4c8a'::uuid, 'agendou', 40),
      ('b4085eaf-f7b1-41bd-9ab6-7d9435fd4c8a'::uuid, 'compareceu', 50),
      ('b4085eaf-f7b1-41bd-9ab6-7d9435fd4c8a'::uuid, 'perdido', 60),
      ('b5d04390-915d-4215-accc-198724f1037b'::uuid, 'novo', 10),
      ('b5d04390-915d-4215-accc-198724f1037b'::uuid, 'em_contato', 20),
      ('b5d04390-915d-4215-accc-198724f1037b'::uuid, 'aguardando_resposta', 30),
      ('b5d04390-915d-4215-accc-198724f1037b'::uuid, 'agendou', 40),
      ('b5d04390-915d-4215-accc-198724f1037b'::uuid, 'compareceu', 50),
      ('b5d04390-915d-4215-accc-198724f1037b'::uuid, 'perdido', 60),
      ('b9a8d5bc-fb74-4774-822a-c825d76cf547'::uuid, 'novo', 10),
      ('b9a8d5bc-fb74-4774-822a-c825d76cf547'::uuid, 'em_contato', 20),
      ('b9a8d5bc-fb74-4774-822a-c825d76cf547'::uuid, 'aguardando_resposta', 30),
      ('b9a8d5bc-fb74-4774-822a-c825d76cf547'::uuid, 'agendou', 40),
      ('b9a8d5bc-fb74-4774-822a-c825d76cf547'::uuid, 'compareceu', 50),
      ('b9a8d5bc-fb74-4774-822a-c825d76cf547'::uuid, 'perdido', 60),
      ('b9da3678-dde4-4a31-b9e4-06be551c951e'::uuid, 'novo', 10),
      ('b9da3678-dde4-4a31-b9e4-06be551c951e'::uuid, 'em_contato', 20),
      ('b9da3678-dde4-4a31-b9e4-06be551c951e'::uuid, 'aguardando_resposta', 30),
      ('b9da3678-dde4-4a31-b9e4-06be551c951e'::uuid, 'agendou', 40),
      ('b9da3678-dde4-4a31-b9e4-06be551c951e'::uuid, 'compareceu', 50),
      ('b9da3678-dde4-4a31-b9e4-06be551c951e'::uuid, 'perdido', 60),
      ('be74c3c9-fbaf-45ab-b84c-1159e02813ac'::uuid, 'novo', 10),
      ('be74c3c9-fbaf-45ab-b84c-1159e02813ac'::uuid, 'em_contato', 20),
      ('be74c3c9-fbaf-45ab-b84c-1159e02813ac'::uuid, 'aguardando_resposta', 30),
      ('be74c3c9-fbaf-45ab-b84c-1159e02813ac'::uuid, 'agendou', 40),
      ('be74c3c9-fbaf-45ab-b84c-1159e02813ac'::uuid, 'compareceu', 50),
      ('be74c3c9-fbaf-45ab-b84c-1159e02813ac'::uuid, 'perdido', 60),
      ('c5284dc6-2965-4dfd-98af-a42a871ed37a'::uuid, 'novo', 10),
      ('c5284dc6-2965-4dfd-98af-a42a871ed37a'::uuid, 'em_contato', 20),
      ('c5284dc6-2965-4dfd-98af-a42a871ed37a'::uuid, 'aguardando_resposta', 30),
      ('c5284dc6-2965-4dfd-98af-a42a871ed37a'::uuid, 'agendou', 40),
      ('c5284dc6-2965-4dfd-98af-a42a871ed37a'::uuid, 'compareceu', 50),
      ('c5284dc6-2965-4dfd-98af-a42a871ed37a'::uuid, 'perdido', 60),
      ('db611273-6bb4-4d5c-905c-2ff815c4f23f'::uuid, 'novo', 10),
      ('db611273-6bb4-4d5c-905c-2ff815c4f23f'::uuid, 'em_contato', 20),
      ('db611273-6bb4-4d5c-905c-2ff815c4f23f'::uuid, 'aguardando_resposta', 30),
      ('db611273-6bb4-4d5c-905c-2ff815c4f23f'::uuid, 'agendou', 40),
      ('db611273-6bb4-4d5c-905c-2ff815c4f23f'::uuid, 'compareceu', 50),
      ('db611273-6bb4-4d5c-905c-2ff815c4f23f'::uuid, 'perdido', 60),
      ('dee90219-a768-4170-bbdb-dc4967c237d1'::uuid, 'novo', 10),
      ('dee90219-a768-4170-bbdb-dc4967c237d1'::uuid, 'em_contato', 20),
      ('dee90219-a768-4170-bbdb-dc4967c237d1'::uuid, 'aguardando_resposta', 30),
      ('dee90219-a768-4170-bbdb-dc4967c237d1'::uuid, 'agendou', 40),
      ('dee90219-a768-4170-bbdb-dc4967c237d1'::uuid, 'compareceu', 50),
      ('dee90219-a768-4170-bbdb-dc4967c237d1'::uuid, 'perdido', 60),
      ('e2d2e43f-c7a9-4cd4-b03f-bb9df81aca64'::uuid, 'novo', 10),
      ('e2d2e43f-c7a9-4cd4-b03f-bb9df81aca64'::uuid, 'em_contato', 20),
      ('e2d2e43f-c7a9-4cd4-b03f-bb9df81aca64'::uuid, 'aguardando_resposta', 30),
      ('e2d2e43f-c7a9-4cd4-b03f-bb9df81aca64'::uuid, 'agendou', 40),
      ('e2d2e43f-c7a9-4cd4-b03f-bb9df81aca64'::uuid, 'compareceu', 50),
      ('e2d2e43f-c7a9-4cd4-b03f-bb9df81aca64'::uuid, 'perdido', 60),
      ('eae6bf62-959f-4a83-8367-7e1672d03a6c'::uuid, 'novo', 10),
      ('eae6bf62-959f-4a83-8367-7e1672d03a6c'::uuid, 'em_contato', 20),
      ('eae6bf62-959f-4a83-8367-7e1672d03a6c'::uuid, 'aguardando_resposta', 30),
      ('eae6bf62-959f-4a83-8367-7e1672d03a6c'::uuid, 'agendou', 40),
      ('eae6bf62-959f-4a83-8367-7e1672d03a6c'::uuid, 'compareceu', 50),
      ('eae6bf62-959f-4a83-8367-7e1672d03a6c'::uuid, 'perdido', 60),
      ('f0c115dd-e98c-4767-a1bb-93d517844852'::uuid, 'novo', 10),
      ('f0c115dd-e98c-4767-a1bb-93d517844852'::uuid, 'em_contato', 20),
      ('f0c115dd-e98c-4767-a1bb-93d517844852'::uuid, 'aguardando_resposta', 30),
      ('f0c115dd-e98c-4767-a1bb-93d517844852'::uuid, 'agendou', 40),
      ('f0c115dd-e98c-4767-a1bb-93d517844852'::uuid, 'compareceu', 50),
      ('f0c115dd-e98c-4767-a1bb-93d517844852'::uuid, 'perdido', 60),
      ('fa6af96c-33c9-48f7-82d0-4b683452699d'::uuid, 'novo', 10),
      ('fa6af96c-33c9-48f7-82d0-4b683452699d'::uuid, 'em_contato', 20),
      ('fa6af96c-33c9-48f7-82d0-4b683452699d'::uuid, 'aguardando_resposta', 30),
      ('fa6af96c-33c9-48f7-82d0-4b683452699d'::uuid, 'agendou', 40),
      ('fa6af96c-33c9-48f7-82d0-4b683452699d'::uuid, 'compareceu', 50),
      ('fa6af96c-33c9-48f7-82d0-4b683452699d'::uuid, 'perdido', 60),
      ('fc0da23c-75c8-493b-9a27-e8f75e7d2f05'::uuid, 'novo', 10),
      ('fc0da23c-75c8-493b-9a27-e8f75e7d2f05'::uuid, 'em_contato', 20),
      ('fc0da23c-75c8-493b-9a27-e8f75e7d2f05'::uuid, 'aguardando_resposta', 30),
      ('fc0da23c-75c8-493b-9a27-e8f75e7d2f05'::uuid, 'agendou', 40),
      ('fc0da23c-75c8-493b-9a27-e8f75e7d2f05'::uuid, 'compareceu', 50),
      ('fc0da23c-75c8-493b-9a27-e8f75e7d2f05'::uuid, 'perdido', 60),
      ('fc5bbfbc-3437-4f71-9ac6-0d07d89c5b90'::uuid, 'novo', 10),
      ('fc5bbfbc-3437-4f71-9ac6-0d07d89c5b90'::uuid, 'em_contato', 20),
      ('fc5bbfbc-3437-4f71-9ac6-0d07d89c5b90'::uuid, 'aguardando_resposta', 30),
      ('fc5bbfbc-3437-4f71-9ac6-0d07d89c5b90'::uuid, 'agendou', 40),
      ('fc5bbfbc-3437-4f71-9ac6-0d07d89c5b90'::uuid, 'compareceu', 50),
      ('fc5bbfbc-3437-4f71-9ac6-0d07d89c5b90'::uuid, 'perdido', 60);
  delete from rollback_onda3_retrato r
   where not exists (select 1 from public.clinic c where c.id = r.clinic_id);

  select count(*) into v_faltam
    from (select r.clinic_id, r.chave, r.posicao from rollback_onda3_retrato r
          except
          select d.clinic_id, d.chave, d.posicao from public.funnel_stage_def d) x;
  select count(*) into v_sobram
    from (select d.clinic_id, d.chave, d.posicao
            from public.funnel_stage_def d
           where d.clinic_id in (select r.clinic_id from rollback_onda3_retrato r)
          except
          select r.clinic_id, r.chave, r.posicao from rollback_onda3_retrato r) x;
  if v_faltam = 0 and v_sobram = 0 then
    raise notice 'rollback da onda 3: as posicoes de 21/10/2026 voltaram em todas as clinicas do retrato';
  else
    select string_agg(distinct x.clinic_id::text, ', ') into v_clinicas
      from (select r.clinic_id, r.chave, r.posicao from rollback_onda3_retrato r
            except
            select d.clinic_id, d.chave, d.posicao from public.funnel_stage_def d) x;
    raise notice 'rollback da onda 3: % etapa(s) do retrato em outra posicao e % fora do retrato (a clinica mudou a jornada depois da M1). Clinicas: %',
      v_faltam, v_sobram, coalesce(v_clinicas, '(so etapas novas)');
  end if;
end;
$retrato$;

commit;

-- SEGUNDA transacao: so o DROP da tabela de pendencias, ja inerte. ACCESS
-- EXCLUSIVE em clinic por milissegundos (veja TRAVAS no cabecalho); 55P03
-- aqui nao desfaz a primeira: tentar de novo minutos depois.
begin;
set local lock_timeout = '1s';
drop table if exists public.etapa_pendente_da_passagem;
commit;

-- Conferencia (so leitura), depois das duas:
-- select p.oid::regprocedure, md5(p.prosrc)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('semear_jornada_padrao', 'reordenar_etapa_da_jornada',
--                      'mover_lead_para_aguardando', 'passagem_da_ia_move_o_lead',
--                      'processar_pendencias_do_funil', 'recusar_followup_em_aguardando',
--                      'conferir_ordem_da_jornada');
-- select tgname from pg_trigger where tgname = 'conferir_ordem_da_jornada';
-- select to_regclass('public.etapa_pendente_da_passagem');
-- select count(*) from public.funnel_stage_def where papel in ('aguardando', 'em_contato');
-- select jobname from cron.job where jobname = 'funil-da-passagem';
