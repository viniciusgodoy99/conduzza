-- Registro de conversao no movimento do funil (R4, parte sincrona; fase 2 do
-- plano de retorno de conversao a Meta).
--
-- POR QUE GATILHO E NAO CODIGO: todos os caminhos que movem um contato de
-- etapa convergem num UPDATE de contact.funnel_stage (Kanban e acoes em
-- massa, termo-chave na ingestao, e os gatilhos da agenda
-- avancar_funil_ao_agendar/comparecer, que ja sao SQL). Interceptar em
-- codigo seriam quatro pontos hoje e um esquecimento silencioso a cada
-- caminho novo. E a mesma filosofia do exclusion constraint da agenda: a
-- regra vive no banco.
--
-- MELHOR ESFORCO DE VERDADE: conversao perdida e melhor que arrastar do
-- Kanban quebrado. Qualquer erro aqui vira warning e o movimento segue.
--
-- Nesta fase o evento apenas NASCE ('registrado'). O enfileiramento para
-- envio chega na migration do job (fase 4), e so quando envio_ativado.

-- Valor da conversao: 'fixo' copia o value_cents da etapa; 'service_link' le
-- o preco do agendamento nao cancelado mais recente do contato. Preco nulo
-- fica nulo: nao se inventa dado.
create or replace function public.valor_da_conversao(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_value_source text,
  p_value_cents integer
) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_value_source = 'fixo' then p_value_cents
    when p_value_source = 'service_link' then (
      select sl.price_cents
        from public.appointment a
        join public.service_link sl on sl.id = a.service_link_id
       where a.clinic_id = p_clinic_id
         and a.contact_id = p_contact_id
         and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       order by a.starts_at desc
       limit 1
    )
    else null
  end;
$$;

-- SECURITY DEFINER: conversion_event nao tem policy de escrita de usuario
-- (so o sistema escreve), e o gatilho dispara na sessao de quem moveu o
-- lead. Mesmo padrao de avancar_funil_ao_agendar.
create or replace function public.registrar_conversao_do_funil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def record;
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
  -- etapa cai no on conflict e nada acontece.
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
  on conflict (clinic_id, contact_id, stage_chave) do nothing;

  return new;
exception when others then
  -- Nunca bloquear o movimento do funil. Warning sem dado de paciente.
  raise warning 'registro de conversao falhou (clinic %): %',
    new.clinic_id, sqlerrm;
  return new;
end;
$$;

create trigger registrar_conversao_do_funil
  after insert or update of funnel_stage on public.contact
  for each row execute function public.registrar_conversao_do_funil();
