-- Fase 4 do retorno de conversao a Meta: o caminho assincrono do envio.
--
-- 1. Kind novo na job_queue.
-- 2. Coluna whatsapp_business_account_id na conta: a doc da Meta (Business
--    Messaging na Conversions API) exige esse id no user_data do evento de
--    anuncio clique-para-WhatsApp, junto do ctwa_clid. Sem ele o evento cai
--    no formato generico por telefone hasheado.
-- 3. v2 do gatilho de registro: quando a clinica tem envio_ativado, o evento
--    recem-criado ja nasce 'enfileirado' com o job. Clinica sem envio segue
--    apenas registrando (estado de 100% da producao ate a decisao D6).

alter table public.job_queue drop constraint job_queue_kind_check;
alter table public.job_queue add constraint job_queue_kind_check
  check (kind in (
    'enviar_mensagem_ativa',
    'baixar_midia',
    'executar_passo_de_regua',
    'enviar_conversao_meta'
  ));

alter table public.meta_ads_account
  add column whatsapp_business_account_id text;

create or replace function public.registrar_conversao_do_funil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def record;
  v_evento_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.funnel_stage is not distinct from old.funnel_stage then
    return new;
  end if;

  select meta_event_name, conversao_ativa, value_source, value_cents
    into v_def
    from public.funnel_stage_def
   where clinic_id = new.clinic_id
     and chave = new.funnel_stage;
  if not found
     or v_def.meta_event_name is null
     or not v_def.conversao_ativa then
    return new;
  end if;

  -- Semantica do Tintim: UMA conversao por contato por etapa. Reentrar na
  -- etapa cai no on conflict e nada acontece (v_evento_id fica nulo).
  insert into public.conversion_event
    (clinic_id, contact_id, stage_chave, event_name, value_cents, ctwa_clid)
  values (
    new.clinic_id,
    new.id,
    new.funnel_stage,
    v_def.meta_event_name,
    public.valor_da_conversao(
      new.clinic_id, new.id, v_def.value_source, v_def.value_cents),
    new.ctwa_clid
  )
  on conflict (clinic_id, contact_id, stage_chave) do nothing
  returning id into v_evento_id;

  -- Envio ligado: o evento novo ja entra na fila. O job revalida tudo na
  -- hora de enviar (config pode mudar entre o registro e a execucao).
  if v_evento_id is not null and exists (
    select 1 from public.meta_ads_account a
     where a.clinic_id = new.clinic_id and a.envio_ativado
  ) then
    update public.conversion_event
       set status = 'enfileirado'
     where id = v_evento_id;
    insert into public.job_queue (clinic_id, kind, payload)
    values (
      new.clinic_id,
      'enviar_conversao_meta',
      jsonb_build_object('conversion_event_id', v_evento_id)
    );
  end if;

  return new;
exception when others then
  -- Nunca bloquear o movimento do funil. Warning sem dado de paciente.
  raise warning 'registro de conversao falhou (clinic %): %',
    new.clinic_id, sqlerrm;
  return new;
end;
$$;
