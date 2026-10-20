-- Corpos lidos da producao em 20/10/2026, antes da migration 20261020130000
-- (a IA marca consulta pelo WhatsApp, E4). md5(prosrc) na leitura (o ensaio
-- confere que o banco ainda esta assim antes de trocar):
--   agente_garantir_rascunho(uuid)                  5739f4a3284e2ddc7ffbe03aa5fc8fbf
--   restaurar_versao_do_agente(uuid, integer)       49967736a143546c2d4e3d55bc70a543
--   exigir_cadastro_da_mesma_clinica()              63fd701214899b14aa5130064462e6a2
--   limpar_holds_vencidos()                         5d6c472408ae0797d18a55ef31223267
-- agente_garantir_rascunho e restaurar_versao_do_agente tinham comentario
-- (volta como era, no passo 2); as outras duas, nao.
--
-- ROLLBACK manual da migration (cabecalho dela). ORDEM: PRIMEIRO voltar o
-- codigo (o de hoje le e grava as colunas novas de ai_agent_config, chama
-- reservar_horario_da_ia, agendar_pela_ia e
-- devolver_conversa_da_consulta_recusada), DEPOIS rodar este arquivo
-- inteiro, numa transacao, no SQL editor:
--   1. drop das quatro funcoes novas;
--   2. os quatro corpos de antes (CREATE OR REPLACE: mesmas assinaturas,
--      security e grants) e os dois comentarios de antes. Os corpos voltam
--      ANTES de apagar as colunas: limpar_holds_vencidos e SQL e o gatilho
--      de clinica olha as colunas novas;
--   3. o gatilho de clinica da slot_hold como era (so clinic_id e
--      professional_id);
--   4. as colunas novas de slot_hold (com os indices e os CHECKs delas) e de
--      ai_agent_config (com os grants por coluna delas).
-- TRAVAS: ACCESS EXCLUSIVE em ai_agent_config e em slot_hold (frias) e o
-- DROP das FKs pega SHARE ROW EXCLUSIVE em service_link, conversation e
-- appointment ate o commit; lock_timeout de 3 s, horario calmo.
-- O que fica: as consultas que a IA marcou (sao consultas como as outras,
-- com created_by ia) e as reservas, sem o elo com a conversa (a vencida sai
-- na proxima limpeza). A antecedencia e o horizonte que as clinicas
-- preencheram se perdem.
-- Conferir no fim: os quatro md5 acima, nenhuma das quatro funcoes novas,
-- nenhuma das oito colunas novas.

begin;
set local lock_timeout = '3s';

-- 1. As funcoes novas.
drop function if exists public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid);
drop function if exists public.agendar_pela_ia(uuid, uuid, uuid);
drop function if exists public.devolver_conversa_da_consulta_recusada(uuid, uuid);
drop function if exists public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid);

-- 2. Os corpos de antes e os comentarios de antes.
-- agente_garantir_rascunho: corpo do banco ANTES da 20261020130000
CREATE OR REPLACE FUNCTION public.agente_garantir_rascunho(p_clinic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_versao integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ai_agent_config:' || p_clinic_id::text, 0)
  );

  select a.id into v_id
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'rascunho';
  if found then
    return v_id;
  end if;

  select coalesce(max(a.version), 0) + 1 into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id;

  begin
    insert into public.ai_agent_config (
      clinic_id, version, agent_name, tone, use_emoji, greeting, closing,
      skills, operating_mode, fallback_minutes, operating_hours,
      escalation_rules, instrucoes
    )
    select p_clinic_id, v_versao, a.agent_name, a.tone, a.use_emoji,
           a.greeting, a.closing, a.skills, a.operating_mode,
           a.fallback_minutes, a.operating_hours, a.escalation_rules,
           a.instrucoes
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
       and a.status = 'publicada'
     order by a.version desc
     limit 1
    returning id into v_id;

    if v_id is null then
      insert into public.ai_agent_config (clinic_id, version)
      values (p_clinic_id, v_versao)
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'CZ409',
      message = 'O agente de IA foi alterado ao mesmo tempo por outra pessoa. Tente de novo.';
  end;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'criou_rascunho_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$function$;

-- restaurar_versao_do_agente: corpo do banco ANTES da 20261020130000
CREATE OR REPLACE FUNCTION public.restaurar_versao_do_agente(p_clinic_id uuid, p_versao integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_origem public.ai_agent_config%rowtype;
  v_id uuid;
begin
  if p_clinic_id is null or p_versao is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e a versão.';
  end if;
  perform public.agente_exigir_quem_configura(p_clinic_id);
  perform public.agente_exigir_fase_controlada(p_clinic_id);

  select * into v_origem
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.version = p_versao
     and a.status = 'publicada';
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Versão não encontrada.';
  end if;

  v_id := public.agente_garantir_rascunho(p_clinic_id);

  update public.ai_agent_config
     set agent_name = v_origem.agent_name,
         tone = v_origem.tone,
         use_emoji = v_origem.use_emoji,
         greeting = v_origem.greeting,
         closing = v_origem.closing,
         skills = v_origem.skills,
         operating_mode = v_origem.operating_mode,
         fallback_minutes = v_origem.fallback_minutes,
         operating_hours = v_origem.operating_hours,
         escalation_rules = v_origem.escalation_rules,
         instrucoes = v_origem.instrucoes
   where id = v_id;

  -- A base viva passa a valer como a congelada daquela versao, sem apagar
  -- nada: o item ativo que nao esta nela fica DESATIVADO (guardado, como a
  -- tela promete; os ja desativados ficam como estao), volta com a mesma id
  -- o que foi excluido, e o que esta nela fica com o texto dela e ativo.
  update public.knowledge_item k
     set active = false
   where k.clinic_id = p_clinic_id
     and k.active
     and not exists (
       select 1
         from jsonb_array_elements(v_origem.conhecimento) e
        where (e ->> 'id')::uuid = k.id
     );

  insert into public.knowledge_item as k (id, clinic_id, question, answer, active)
  select (e ->> 'id')::uuid, p_clinic_id, e ->> 'pergunta', e ->> 'resposta', true
    from jsonb_array_elements(v_origem.conhecimento) e
  on conflict (id) do update
     set question = excluded.question,
         answer = excluded.answer,
         active = true
   where k.clinic_id = excluded.clinic_id
     and (k.question, k.answer, k.active)
         is distinct from (excluded.question, excluded.answer, true);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'restaurou_versao_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$function$;

-- exigir_cadastro_da_mesma_clinica: corpo do banco ANTES da 20261020130000
CREATE OR REPLACE FUNCTION public.exigir_cadastro_da_mesma_clinica()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profissional_do_vinculo uuid;
  v_pacote_ativo boolean;
begin
  if tg_table_name = 'appointment' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    select sl.professional_id into v_profissional_do_vinculo
      from service_link sl
     where sl.id = new.service_link_id and sl.clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O vínculo informado não pertence a esta clínica.';
    end if;
    if v_profissional_do_vinculo is distinct from new.professional_id then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O vínculo informado é de outro profissional.';
    end if;
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;
    if new.resource_id is not null and not exists (
      select 1 from resource
       where id = new.resource_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O recurso informado não pertence a esta clínica.';
    end if;
    if new.package_balance_id is not null and not exists (
      select 1 from package_balance
       where id = new.package_balance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O saldo de pacote informado não pertence a esta clínica.';
    end if;
    -- Pacote com varios procedimentos (29/09/2026): o item de saldo que a
    -- consulta descontou e desta clinica e, quando a consulta tambem aponta
    -- o saldo, e um item DESSE saldo.
    if new.package_balance_item_id is not null and not exists (
      select 1 from package_balance_item
       where id = new.package_balance_item_id
         and clinic_id = new.clinic_id
         and (new.package_balance_id is null
              or package_balance_id = new.package_balance_id)
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O saldo de pacote informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'slot_hold' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'procedure' then
    if new.resource_id is not null and not exists (
      select 1 from resource
       where id = new.resource_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O recurso informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'resource' then
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'service_link' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    if new.insurance_id is not null and not exists (
      select 1 from insurance
       where id = new.insurance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O convênio informado não pertence a esta clínica.';
    end if;
    -- A consulta exige vinculo DO MESMO profissional (acima). Trocar o
    -- profissional de um vinculo que ja tem consulta quebraria essa regra
    -- nas consultas antigas: o caminho e desativar e criar outro.
    if tg_op = 'UPDATE'
       and new.professional_id is distinct from old.professional_id
       and exists (select 1 from appointment where service_link_id = new.id)
    then
      raise exception using errcode = 'check_violation',
        message = 'Este vínculo já tem consultas. Desative e crie outro.';
    end if;

  elsif tg_table_name = 'professional_schedule' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'professional_block' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'package' then
    -- Desde 29/09/2026 os procedimentos do pacote moram em package_item, e
    -- package.procedure_id e legado (o codigo novo grava null). So confere
    -- quando vem preenchido: e o caminho do codigo publicado antes da troca.
    -- O congelamento depois da venda passou para package_item (gatilho
    -- travar_itens_de_pacote_vendido), onde vale para todo item.
    if new.procedure_id is not null and not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'package_item' then
    if not exists (
      select 1 from package
       where id = new.package_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O pacote informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'package_balance' then
    select p.active into v_pacote_ativo
      from package p
     where p.id = new.package_id and p.clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O pacote informado não pertence a esta clínica.';
    end if;
    -- (2) Venda nova so de pacote ativo. Ajuste de saldo ja vendido
    -- (sessions_used) nao passa por aqui: o gatilho so olha INSERT e troca
    -- de package_id/clinic_id.
    if tg_op = 'INSERT' and v_pacote_ativo is not true then
      raise exception using errcode = 'check_violation',
        message = 'Este pacote está desativado e não pode ser vendido.';
    end if;

  elsif tg_table_name = 'package_balance_item' then
    if not exists (
      select 1 from package_balance
       where id = new.package_balance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O saldo de pacote informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    -- O item vendido e a copia do pacote no dia da venda: o procedimento e o
    -- saldo a que ele pertence nao mudam depois. Sessoes usadas mudam pelo
    -- debito e pelo ajuste (com motivo), nunca trocando o procedimento.
    if tg_op = 'UPDATE'
       and (new.procedure_id is distinct from old.procedure_id
            or new.package_balance_id is distinct from old.package_balance_id)
    then
      raise exception using errcode = 'check_violation',
        message = 'O procedimento de um pacote vendido não muda. Ajuste o saldo ou cancele a venda.';
    end if;

  elsif tg_table_name = 'clinic_member' then
    -- Vinculo usuario -> profissional (a tela e da leva 2): a policy de
    -- update de clinic_member so confere o papel do editor na clinica da
    -- linha, e a FK clinic_member_professional_fk so confere existencia.
    if new.professional_id is not null and not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_account' then
    -- Unidade opcional do numero (decisao 3 do dono, 25/09/2026).
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_account_secret' then
    -- account_id nulo e o caminho legado (so clinic_id): o gatilho
    -- preencher_conta_do_segredo, que roda DEPOIS deste pela ordem do nome,
    -- escolhe o principal da MESMA clinica, e o NOT NULL fecha o resto.
    if new.account_id is not null and not exists (
      select 1 from whatsapp_account
       where id = new.account_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_envio_automatico' then
    -- Modo fixo: o numero e desta clinica e nao foi removido. A mesma
    -- mensagem para "de outra clinica" e "nao existe": nada a aprender.
    if new.conta_fixa_id is not null then
      if not exists (
        select 1 from whatsapp_account
         where id = new.conta_fixa_id and clinic_id = new.clinic_id
      ) then
        raise exception using errcode = 'foreign_key_violation',
          message = 'O número escolhido não pertence a esta clínica.';
      end if;
      if exists (
        select 1 from whatsapp_account
         where id = new.conta_fixa_id and removido_em is not null
      ) then
        raise exception using errcode = 'check_violation',
          message = 'O número escolhido foi removido da clínica.';
      end if;
    end if;

  elsif tg_table_name = 'cadence' then
    -- Regua vinculada (29/09/2026): o procedimento e o profissional da regua
    -- sao desta clinica. A FK so confere existencia, e a checagem de FK
    -- ignora RLS: sem isto, o gestor de uma clinica apontava a regua dele
    -- para o cadastro de outra.
    if new.procedure_id is not null and not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    if new.professional_id is not null and not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
  end if;

  return new;
end;
$function$;

-- limpar_holds_vencidos: corpo do banco ANTES da 20261020130000
CREATE OR REPLACE FUNCTION public.limpar_holds_vencidos()
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  with apagados as (
    delete from slot_hold where expires_at < now() returning 1
  )
  select count(*)::integer from apagados
$function$;

comment on function public.agente_garantir_rascunho(uuid) is 'Interna (sem guarda de papel). Trava a clinica (consultiva ai_agent_config:<clinica>) e devolve o rascunho; sem rascunho, cria um copiando a ultima publicada (inclusive instrucoes) ou os padroes, com version = max + 1, e grava audit_log criou_rascunho_do_agente. Corrida com um INSERT direto do sistema: CZ409.';
comment on function public.restaurar_versao_do_agente(uuid,integer) is 'O rascunho (garantido) passa a ter os campos da versao publicada p_versao, inclusive as instrucoes, e a base viva (knowledge_item) passa a valer como a base congelada dela: mesmas ids, ativas e com o texto dela (a excluida volta); o item fora dela fica desativado, nunca apagado. Administrador ou gestor ativo com escrita, super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501); versao inexistente ou nao publicada: P0002. Devolve o id do rascunho. Grava audit_log.';

-- 3. O gatilho de clinica da slot_hold como era.
drop trigger if exists exigir_cadastro_da_mesma_clinica on public.slot_hold;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, professional_id
  on public.slot_hold
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

-- 4. As colunas novas (os indices, os CHECKs e os grants por coluna saem
-- junto).
alter table public.slot_hold
  drop constraint if exists slot_hold_reserva_da_ia_completa,
  drop constraint if exists slot_hold_consumo_coerente,
  drop column if exists service_link_id,
  drop column if exists conversation_id,
  drop column if exists job_id,
  drop column if exists consumido_em,
  drop column if exists appointment_id,
  drop column if exists job_id_do_agendar;
alter table public.ai_agent_config
  drop column if exists agenda_antecedencia_horas,
  drop column if exists agenda_horizonte_dias;

commit;

notify pgrst, 'reload schema';
