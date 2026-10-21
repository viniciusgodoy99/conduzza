-- Corpos lidos da producao em 20/10/2026, antes da migration 20261021100000
-- (painel geral, conta suspensa e agente por clinica, onda 1). md5(prosrc)
-- na leitura (o ensaio confere que o banco ainda esta assim antes de
-- trocar):
--   user_active_clinic_ids()                                 d9591f80ad1a42acf29161f1ec899407
--   user_has_role(uuid, text[])                              14829965587503d5d3f74ee636620223
--   user_can_write(uuid)                                     948759619197b0e2a78e73daceeb2111
--   ia_clinicas_da_fase_controlada()                         3a29e89c32113b0ac266b177c02bce1a
--   claim_jobs_por_clinica(text, integer, text[], boolean)   c068771dfd90059bfae9a78b900f41ff
--   ia_jobs_devidos(uuid[], boolean, interval)               e5427641be276f51af5bcded2febc4b1
--   ia_pode_atender(uuid, uuid, text)                        cd9be3d347947620092d0afd9955d3f8
--   saude_do_motor()                                         df040f27760673a69993af0000d28f43
--   reconciliar_mensagens_agendadas(integer, uuid, boolean)  4c90bbd239c35364dccbcbb7175183f0
-- user_can_write, ia_clinicas_da_fase_controlada e ia_pode_atender tinham
-- comentario (volta como era, no passo 2); as outras seis, nao (o
-- comentario que a migration pos sai).
--
-- ROLLBACK manual da migration (cabecalho dela). ORDEM:
--   0. ANTES, pelo painel ou pelo SQL editor: desligar o agente de toda
--      clinica que foi ligada em teste pelo painel (fora teste123 e
--      Conduzza Teste): select public.definir_agente_da_clinica(
--      '<id>', 'desligado', 'rollback da onda 1'); (a lista volta a ser so
--      as duas fixas, e a linha de liberacao delas ficaria liberada fora da
--      lista). Reativar as clinicas suspensas que devem voltar a enviar
--      (reativar_clinica cancela o que venceu; depois do rollback a
--      suspensao some e o motor pegaria tudo, inclusive o vencido).
--   1. Voltar o CODIGO (o de hoje chama as funcoes novas e le a lista do
--      banco: lib/ia/liberacao.ts, lib/auth/active-clinic.ts,
--      lib/integrations/whatsapp/send.ts, o painel geral).
--   2. Rodar ESTE arquivo inteiro, numa transacao, no SQL editor: as
--      funcoes novas saem; os nove corpos de antes e os comentarios de
--      antes voltam (CREATE OR REPLACE: mesmas assinaturas, security,
--      search_path e grants), ANTES de as tabelas sairem (os corpos novos as
--      leem); as duas tabelas saem (com as policies).
-- TRAVAS: o DROP das tabelas solta as FKs para clinic (SHARE ROW EXCLUSIVE
-- em clinic ate o commit); lock_timeout de 3 s, horario calmo.
-- O que fica: a trilha (audit_log) de suspender, reativar, agente e teto; os
-- jobs cancelados na reativacao (vencido_na_suspensao) e os toques fechados
-- (falha_envio, vencido_na_suspensao); a liberacao (ia_liberacao) como o
-- painel a deixou (tetos, liberada).
-- Conferir no fim: os nove md5 acima, nenhuma das sete funcoes novas,
-- nenhuma das duas tabelas novas.

begin;
set local lock_timeout = '3s';

-- 1. As funcoes novas.
drop function if exists public.painel_geral_das_clinicas(boolean);
drop function if exists public.definir_teto_da_ia(uuid, integer, integer);
drop function if exists public.definir_agente_da_clinica(uuid, text, text);
drop function if exists public.reativar_clinica(uuid, text);
drop function if exists public.suspender_clinica(uuid, text);
drop function if exists public.minhas_clinicas_suspensas();
drop function if exists public.clinica_esta_suspensa(uuid);

-- 2. Os corpos de antes e os comentarios de antes.
CREATE OR REPLACE FUNCTION public.user_active_clinic_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select clinic_id from clinic_member
  where user_id = auth.uid() and status = 'ativo'
$function$;
comment on function public.user_active_clinic_ids() is null;

CREATE OR REPLACE FUNCTION public.user_has_role(p_clinic_id uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from clinic_member
    where clinic_id = p_clinic_id
      and user_id = auth.uid()
      and status = 'ativo'
      and role = any (p_roles)
  )
$function$;
comment on function public.user_has_role(uuid, text[]) is null;

CREATE OR REPLACE FUNCTION public.user_can_write(p_clinic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from clinic_member
    where clinic_id = p_clinic_id
      and user_id = auth.uid()
      and status = 'ativo'
      and role in ('admin', 'gestor', 'recepcao', 'profissional')
  )
$function$;
comment on function public.user_can_write(uuid) is
  'Papel com permissao de escrita em dado de paciente. Exclui leitura.';

CREATE OR REPLACE FUNCTION public.ia_clinicas_da_fase_controlada()
 RETURNS uuid[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select array[
    'acd9c539-585e-4f2a-a195-712c70099564'::uuid, -- teste123
    'f0c115dd-e98c-4767-a1bb-93d517844852'::uuid  -- Conduzza Teste
  ]
$function$;
comment on function public.ia_clinicas_da_fase_controlada() is
  'Lista fechada das clinicas da fase controlada da IA (teste123 e Conduzza Teste). Espelho exato de CLINICAS_DA_FASE_CONTROLADA em lib/ia/liberacao.ts. Nenhuma outra clinica ganha linha em ia_liberacao (gatilho ia_liberacao_so_na_lista), salvo clinica e_de_teste.';

CREATE OR REPLACE FUNCTION public.claim_jobs_por_clinica(p_worker text, p_max_clinicas integer, p_kinds text[], p_incluir_teste boolean DEFAULT false)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- Ramo 1: enterra o que travou sem tentativas restantes.
  update job_queue
  set status = 'falhou',
      last_error = coalesce(last_error, 'lease_expirado'),
      locked_by = null,
      locked_at = null
  where status = 'executando'
    and locked_at < now() - interval '180 seconds'
    and attempts >= max_attempts
    and kind = any(p_kinds);

  -- Ramos 2 e 3: um job elegivel por raia. Dentro da raia, a menor
  -- prioridade primeiro e, empatado, o mais atrasado: confirmacao vencida
  -- sai antes de follow-up. Entre raias, a mesma regra.
  return query
  with raia_numero as (
    select e.id, e.prioridade, e.run_at
    from whatsapp_account a
    join clinic c on c.id = a.clinic_id
    cross join lateral (
      select q.id, q.prioridade, q.run_at
      from job_queue q
      where q.whatsapp_account_id = a.id
        and q.kind = any(p_kinds)
        and (
          (q.status = 'pendente' and q.run_at <= now())
          or (q.status = 'executando'
              and q.locked_at < now() - interval '180 seconds'
              and q.attempts < q.max_attempts)
        )
      order by q.prioridade, q.run_at
      limit 1
    ) e
    where (p_incluir_teste or not c.e_de_teste)
    order by e.prioridade, e.run_at
    limit p_max_clinicas
    for update of a skip locked
  ),
  raia_clinica as (
    select e.id, e.prioridade, e.run_at
    from clinic c
    cross join lateral (
      select q.id, q.prioridade, q.run_at
      from job_queue q
      where q.clinic_id = c.id
        and q.whatsapp_account_id is null
        and q.kind = any(p_kinds)
        and (
          (q.status = 'pendente' and q.run_at <= now())
          or (q.status = 'executando'
              and q.locked_at < now() - interval '180 seconds'
              and q.attempts < q.max_attempts)
        )
      order by q.prioridade, q.run_at
      limit 1
    ) e
    where (p_incluir_teste or not c.e_de_teste)
    order by e.prioridade, e.run_at
    limit p_max_clinicas
    for update of c skip locked
  ),
  escolhidos as (
    select t.id
    from (
      select * from raia_numero
      union all
      select * from raia_clinica
    ) t
    order by t.prioridade, t.run_at
    limit p_max_clinicas
  )
  update job_queue j
  set status = 'executando',
      locked_by = p_worker,
      locked_at = now(),
      attempts = j.attempts + 1
  where j.id in (select escolhidos.id from escolhidos)
    and (
      (j.status = 'pendente' and j.run_at <= now())
      or (j.status = 'executando'
          and j.locked_at < now() - interval '180 seconds'
          and j.attempts < j.max_attempts)
    )
  returning j.*;
end;
$function$;
comment on function public.claim_jobs_por_clinica(text, integer, text[], boolean) is null;

CREATE OR REPLACE FUNCTION public.ia_jobs_devidos(p_clinic_ids uuid[], p_incluir_teste boolean, p_folga interval)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  return query
  with vivos as (
    select q.id,
           q.payload ->> 'conversation_id' as conversa,
           q.status,
           q.run_at,
           q.locked_at,
           q.created_at,
           exists (
             select 1 from public.ai_turno t
              where t.job_id = q.id and t.estado = 'decidido'
           ) as decidido
      from public.job_queue q
      join public.clinic c on c.id = q.clinic_id
     where q.kind = 'responder_com_ia'
       and (p_clinic_ids is null or q.clinic_id = any (p_clinic_ids))
       and ((c.id = any (public.ia_clinicas_da_fase_controlada()) and not c.e_de_teste)
            or (coalesce(p_incluir_teste, false) and c.e_de_teste))
       and (q.status = 'pendente'
            or (q.status = 'executando'
                and q.locked_at < now() - interval '90 seconds'
                and q.attempts < q.max_attempts))
  ),
  primeiro as (
    select distinct on (v.conversa) v.*
      from vivos v
     order by v.conversa, v.decidido desc, v.created_at, v.id
  )
  select p.id
    from primeiro p
   where ((p.status = 'pendente'
           and p.run_at <= now() - coalesce(p_folga, interval '0 seconds'))
          or (p.status = 'executando'
              and p.locked_at < now() - interval '90 seconds'
                                - coalesce(p_folga, interval '0 seconds')))
     and not exists (
       select 1 from public.job_queue o
        where o.kind = 'responder_com_ia'
          and o.status = 'executando'
          and o.payload ->> 'conversation_id' = p.conversa
          and o.locked_at >= now() - interval '90 seconds'
     );
end;
$function$;
comment on function public.ia_jobs_devidos(uuid[], boolean, interval) is null;

CREATE OR REPLACE FUNCTION public.ia_pode_atender(p_clinic_id uuid, p_whatsapp_account_id uuid, p_phone_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.ia_liberacao_vigente(p_clinic_id, array['contatos'])
    and exists (
      select 1
        from public.ia_numero_liberado n
        join public.whatsapp_account w on w.id = n.whatsapp_account_id
       where n.whatsapp_account_id = p_whatsapp_account_id
         and n.clinic_id = p_clinic_id
         and n.ativo
         and w.clinic_id = p_clinic_id
         and w.removido_em is null
         -- clinica e_de_teste fora da lista: so o WhatsApp falso
         and (p_clinic_id = any (public.ia_clinicas_da_fase_controlada())
              or w.provider = 'fake')
    )
    and exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_phone_key))
         and k.ativo
    ),
    false
  )
$function$;
comment on function public.ia_pode_atender(uuid, uuid, text) is
  'A IA pode atender este telefone (phone_key, ou o E.164, que vira a chave) neste numero desta clinica? Combina T3a, T3b, T4, T5, T6, T7, modo contatos e o teto das ultimas 24 horas. Clinica e_de_teste fora da lista: so em numero de provedor fake. Nulo em qualquer argumento: falso. So service_role (e as funcoes do banco).';

CREATE OR REPLACE FUNCTION public.saude_do_motor()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ia jsonb;
begin
  -- [resposta da ia] inicio
  if (auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role')
     or public.is_product_admin()
  then
    v_ia := public.ia_estado_do_motor();
  end if;
  -- [resposta da ia] fim

  return jsonb_build_object(
    'fila', (
      select jsonb_build_object(
        'batida_em', batida_em,
        'ultimo_lote', ultimo_lote,
        'ultimo_erro', ultimo_erro
      )
      from worker_heartbeat where worker_id = 'motor-fila'
    ),
    'planner', (
      select jsonb_build_object(
        'batida_em', batida_em,
        'ultimo_lote', ultimo_lote,
        'ultimo_erro', ultimo_erro
      )
      from worker_heartbeat where worker_id = 'motor-planner'
    ),
    'atrasados', (
      select count(*) from job_queue
      where status = 'pendente' and run_at < now() - interval '5 minutes'
    )
    -- [resposta da ia] inicio
    , 'ia', v_ia
    -- [resposta da ia] fim
  );
end;
$function$;
comment on function public.saude_do_motor() is null;

CREATE OR REPLACE FUNCTION public.reconciliar_mensagens_agendadas(p_limite integer DEFAULT 200, p_clinic_id uuid DEFAULT NULL::uuid, p_incluir_teste boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  r text;
  v_antes text := current_setting('conduzza.agendada_pelo_sistema', true);
  v_limite integer := greatest(1, least(coalesce(p_limite, 200), 1000));
  v_env integer := 0;
  v_nao integer := 0;
  v_retidas integer := 0;
  v_presas integer;
  v_erros integer := 0;
begin
  for v in
    select a.id
      from public.mensagem_agendada a
      join public.clinic c on c.id = a.clinic_id
      left join public.job_queue j on j.id = a.job_id
     where a.situacao = 'enviando'
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
       and (p_incluir_teste or not c.e_de_teste)
       and (
         j.id is null
         or j.status in ('falhou', 'cancelado', 'concluido')
         or exists (
           select 1 from public.message m
            where m.job_id = a.job_id
              and m.delivery_status in ('enviada', 'entregue', 'lida')
         )
       )
     order by a.enviar_em
     limit v_limite
  loop
    begin
      r := public.reconciliar_mensagem_agendada(v.id);
      if r = 'enviada' then
        v_env := v_env + 1;
      elsif r in ('nao_enviada', 'nao_confirmada') then
        v_nao := v_nao + 1;
      end if;
    exception when others then
      v_erros := v_erros + 1;
      raise warning 'reconciliar_mensagens_agendadas: agendada % (%)', v.id, sqlstate;
    end;
  end loop;

  -- Retencao (A5): o texto de paciente nao fica para sempre numa agendada
  -- que ninguem dispensou.
  perform set_config('conduzza.agendada_pelo_sistema', 'sim', true);
  with velhas as (
    select a.id
      from public.mensagem_agendada a
      join public.clinic c on c.id = a.clinic_id
     where a.situacao in ('nao_enviada', 'nao_confirmada')
       and a.dispensada_em is null
       and a.encerrada_em < now() - interval '30 days'
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
       and (p_incluir_teste or not c.e_de_teste)
     order by a.encerrada_em
     limit v_limite
     for update of a skip locked
  )
  update public.mensagem_agendada a
     set dispensada_em = now(),
         dispensada_por = null,
         texto = null
    from velhas
   where a.id = velhas.id;
  get diagnostics v_retidas = row_count;
  perform set_config('conduzza.agendada_pelo_sistema', coalesce(v_antes, ''), true);

  select count(*) into v_presas
    from public.mensagem_agendada a
    join public.clinic c on c.id = a.clinic_id
   where a.situacao = 'enviando'
     and a.enviar_em < now() - interval '13 hours'
     and (p_clinic_id is null or a.clinic_id = p_clinic_id)
     and (p_incluir_teste or not c.e_de_teste);

  return jsonb_build_object(
    'fechadas_enviadas', v_env,
    'fechadas_sem_envio', v_nao,
    'retidas', v_retidas,
    'presas', v_presas,
    'erros_por_linha', v_erros
  );
end;
$function$;
comment on function public.reconciliar_mensagens_agendadas(integer, uuid, boolean) is null;

-- 3. As tabelas novas (com as policies e as FKs).
drop table if exists public.ia_clinica_habilitada;
drop table if exists public.clinica_suspensa;

commit;

-- Conferencia (so leitura), depois do commit:
-- select p.oid::regprocedure, md5(p.prosrc)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('user_active_clinic_ids', 'user_has_role', 'user_can_write',
--                      'ia_clinicas_da_fase_controlada', 'claim_jobs_por_clinica',
--                      'ia_jobs_devidos', 'ia_pode_atender', 'saude_do_motor',
--                      'reconciliar_mensagens_agendadas', 'painel_geral_das_clinicas',
--                      'definir_teto_da_ia', 'definir_agente_da_clinica', 'reativar_clinica',
--                      'suspender_clinica', 'minhas_clinicas_suspensas', 'clinica_esta_suspensa');
-- select to_regclass('public.clinica_suspensa'), to_regclass('public.ia_clinica_habilitada');
