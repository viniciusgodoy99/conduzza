-- Rollback manual da migration 20261106110000_preparo_sem_conferencia_e_agendar.sql
-- (o preparo sem a conferencia do registro do RT e "Agendar consulta" ligada por
-- padrao, decisoes do dono de 06/11/2026).
--
-- O QUE A MIGRATION FEZ: so o create or replace e o comentario de
-- preparo_em_vigor, conferir_horario_da_ia e lista_de_espera_da_ia_ligada.
-- Nenhuma tabela, coluna, indice ou linha.
--
-- O QUE ESTE ARQUIVO FAZ: devolve as tres funcoes e os comentarios ao que eram
-- e confere o md5(prosrc). O dono, os grants, o search_path e a assinatura nao
-- mudam nem na migration nem aqui.
--
-- ORDEM: primeiro voltar o codigo, depois este arquivo. Com o codigo novo e o
-- banco de antes, o motor ofereceria a marcacao que o banco recusa, e a tela
-- diria em vigor um preparo que nao sai.
--
-- O QUE MUDA PARA QUEM USA, NA HORA: o preparo aprovado volta a exigir a
-- conferencia do registro do RT, e nada dele sai ate alguem conferir, pela RPC
-- conferir_registro_do_responsavel_tecnico, na clinica cujo RT nao foi conferido;
-- a clinica com skills sem a chave agendar deixa de marcar consulta pela IA. Nada
-- se perde: nenhuma linha foi escrita.
--
-- TRAVAS: as mesmas da migration: so catalogo. lock_timeout de 3 s: o rollback
-- falha inteiro e roda-se de novo.

begin;
-- inicio do rollback
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.preparo_em_vigor(p_clinic_id uuid, p_versao_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_versao record;
  v_nome text;
  v_clinica_do_procedimento uuid;
  v_rt record;
begin
  if p_clinic_id is null or p_versao_id is null then
    return false;
  end if;
  select v.clinic_id, v.procedure_id, v.situacao, v.texto, v.texto_sha256, v.rt_id, v.nome_do_procedimento
    into v_versao
    from public.preparo_do_procedimento v
   where v.id = p_versao_id;
  if not found
     or v_versao.clinic_id is distinct from p_clinic_id
     or v_versao.situacao is distinct from 'aprovado'
  then
    return false;
  end if;
  -- O hash recalculado (falha fechada se a linha foi mexida com o gatilho
  -- desligado).
  if encode(sha256(convert_to(v_versao.texto, 'UTF8')), 'hex') is distinct from v_versao.texto_sha256 then
    return false;
  end if;
  -- O RT que aprovou e o vigente de agora (D-73).
  if v_versao.rt_id is null
     or v_versao.rt_id is distinct from public.responsavel_tecnico_vigente(p_clinic_id)
  then
    return false;
  end if;
  -- O registro desse RT conferido pela equipe Conduzza, e o conselho dele
  -- aceita o texto (decisao de 05/11/2026; falha fechada se a regra ou a
  -- linha mudaram depois da aprovacao).
  select r.conselho, r.registro_conferido_em into v_rt
    from public.responsavel_tecnico r
   where r.id = v_versao.rt_id;
  if v_rt.registro_conferido_em is null
     or public.preparo_conselho_recusa_texto(v_rt.conselho, v_versao.texto)
  then
    return false;
  end if;
  -- O procedimento da mesma clinica, com o nome da aprovacao.
  select p.name, p.clinic_id into v_nome, v_clinica_do_procedimento
    from public.procedure p
   where p.id = v_versao.procedure_id;
  if not found
     or v_clinica_do_procedimento is distinct from p_clinic_id
     or v_nome is distinct from v_versao.nome_do_procedimento
  then
    return false;
  end if;
  return true;
end;
$function$;

comment on function public.preparo_em_vigor(uuid, uuid) is
  'Interna (AG7; nenhum papel da API executa): verdadeiro so se a versao e da clinica, esta aprovada, o hash recalculado do texto bate com texto_sha256, rt_id e o RT vigente de agora (D-73), o registro desse RT foi conferido pela equipe Conduzza, o conselho dele aceita o texto (preparo_conselho_recusa_texto), o procedimento e da mesma clinica e o nome dele e o nome_do_procedimento da versao (renomear tira a aprovacao). O procedimento inativo continua em vigor (a regua das consultas que ja existem). Qualquer nulo: falso.';

CREATE OR REPLACE FUNCTION public.conferir_horario_da_ia(p_clinic_id uuid, p_conversation_id uuid, p_service_link_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_reserva_propria uuid, p_unit_id uuid, OUT o_motivo text, OUT o_contato uuid, OUT o_profissional uuid, OUT o_fim timestamp with time zone, OUT o_recurso uuid, OUT o_fuso text, OUT o_procedimento text, OUT o_nome_do_profissional text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_conversa record;
  v_config record;
  v_vinculo record;
  v_na_jornada boolean;
begin
  -- 4. A conversa e da clinica, esta com a IA, e a IA pode atender este
  -- contato neste numero (a mesma pergunta da ingestao e do envio).
  select c.whatsapp_account_id, c.contact_id, c.status, k.phone_key
    into v_conversa
    from public.conversation c
    join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  if not found
     or v_conversa.status is distinct from 'ia_atendendo'
     or not public.ia_pode_atender(p_clinic_id, v_conversa.whatsapp_account_id, v_conversa.phone_key)
  then
    o_motivo := 'ia_desligada';
    return;
  end if;
  o_contato := v_conversa.contact_id;

  -- 5. A versao em uso e a ultima publicada (a que o agente le no WhatsApp):
  -- Agendar ligada e as duas colunas preenchidas. Ninguem inventa valor.
  select a.skills, a.agenda_antecedencia_horas, a.agenda_horizonte_dias
    into v_config
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if not found
     or (v_config.skills ->> 'agendar') is distinct from 'true'
     or v_config.agenda_antecedencia_horas is null
     or v_config.agenda_horizonte_dias is null
  then
    o_motivo := 'agenda_nao_configurada';
    return;
  end if;

  -- 6. O vinculo que a IA pode agendar: ativo, com bookable_by_ai, de
  -- procedimento ativo com bookable_by_ai e de profissional ativo.
  select sl.professional_id, sl.duration_min, pr.resource_id,
         pr.name as procedimento, pf.name as profissional
    into v_vinculo
    from public.service_link sl
    join public.procedure pr on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
    join public.professional pf on pf.id = sl.professional_id and pf.clinic_id = sl.clinic_id
   where sl.id = p_service_link_id
     and sl.clinic_id = p_clinic_id
     and sl.active
     and sl.bookable_by_ai
     and pr.active
     and pr.bookable_by_ai
     and pf.active;
  if not found then
    o_motivo := 'vinculo_invalido';
    return;
  end if;
  o_profissional := v_vinculo.professional_id;
  o_recurso := v_vinculo.resource_id;
  o_procedimento := v_vinculo.procedimento;
  o_nome_do_profissional := v_vinculo.profissional;
  o_fim := coalesce(p_ends_at, p_starts_at + make_interval(mins => v_vinculo.duration_min));
  if o_fim <= p_starts_at then
    o_motivo := 'vinculo_invalido';
    return;
  end if;

  -- [agendamento completo] inicio
  -- 6b. A unidade escolhida (AG3): da clinica e ativa, senao
  -- unidade_invalida. Sem unidade, como antes.
  if p_unit_id is not null and not exists (
    select 1 from public.unit u
     where u.id = p_unit_id
       and u.clinic_id = p_clinic_id
       and u.active
  ) then
    o_motivo := 'unidade_invalida';
    return;
  end if;
  -- [agendamento completo] fim

  -- 7. Antecedencia minima e horizonte, a partir de agora.
  if p_starts_at < now() + make_interval(hours => v_config.agenda_antecedencia_horas) then
    o_motivo := 'antes_da_antecedencia';
    return;
  end if;
  if p_starts_at > now() + make_interval(days => v_config.agenda_horizonte_dias) then
    o_motivo := 'depois_do_horizonte';
    return;
  end if;

  -- 8. A jornada no fuso da clinica, como o motor da Agenda: cada dia civil
  -- local do horario (e a vespera, pela janela que vira o dia) da as faixas
  -- do seu weekday (0 = domingo); faixa com fim <= inicio termina no dia
  -- seguinte; faixas encostadas se somam. O horario cabe inteiro numa delas.
  select coalesce(c.timezone, 'America/Fortaleza') into o_fuso
    from public.clinic c
   where c.id = p_clinic_id;
  o_fuso := coalesce(o_fuso, 'America/Fortaleza');
  select coalesce(
           range_agg(tstzrange(j.inicio, j.fim, '[)')) @> tstzrange(p_starts_at, o_fim, '[)'),
           false)
    into v_na_jornada
    from (
      select (d.dia + s.starts_at) at time zone o_fuso as inicio,
             ((d.dia + case when s.ends_at <= s.starts_at then 1 else 0 end) + s.ends_at)
               at time zone o_fuso as fim
        from generate_series(
               -1,
               (o_fim at time zone o_fuso)::date - (p_starts_at at time zone o_fuso)::date
             ) as g(n)
        cross join lateral (
          select (p_starts_at at time zone o_fuso)::date + g.n as dia
        ) as d
        join public.professional_schedule s
          on s.professional_id = o_profissional
         and s.clinic_id = p_clinic_id
         and s.weekday = extract(dow from d.dia)::smallint
         -- [agendamento completo] inicio
         -- Com unidade, so a jornada dela e a sem unidade (que vale para
         -- todas), como a Agenda (components/agenda, jornadasDoDia).
         and (p_unit_id is null or s.unit_id is null or s.unit_id = p_unit_id)
         -- [agendamento completo] fim
    ) as j;
  if not v_na_jornada then
    o_motivo := 'fora_da_jornada';
    return;
  end if;

  -- 9. O que ja ocupa o horario.
  if exists (
    select 1
      from public.professional_block b
     where b.professional_id = o_profissional
       and b.clinic_id = p_clinic_id
       and b.starts_at < o_fim
       and b.ends_at > p_starts_at
  ) then
    o_motivo := 'bloqueado';
    return;
  end if;
  if exists (
    select 1
      from public.appointment a
     where a.clinic_id = p_clinic_id
       and a.professional_id = o_profissional
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.starts_at < o_fim
       and a.ends_at > p_starts_at
  ) then
    o_motivo := 'ocupado';
    return;
  end if;
  if o_recurso is not null and exists (
    select 1
      from public.appointment a
     where a.clinic_id = p_clinic_id
       and a.resource_id = o_recurso
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.starts_at < o_fim
       and a.ends_at > p_starts_at
  ) then
    o_motivo := 'ocupado';
    return;
  end if;
  if exists (
    select 1
      from public.slot_hold h
     where h.clinic_id = p_clinic_id
       and h.professional_id = o_profissional
       and h.expires_at > now()
       and h.consumido_em is null
       and h.conversation_id is distinct from p_conversation_id
       and h.id is distinct from p_reserva_propria
       and h.starts_at < o_fim
       and h.ends_at > p_starts_at
  ) then
    o_motivo := 'reservado_por_outra_conversa';
    return;
  end if;
  -- [recurso da reserva] (revisao da E4): a reserva viva de OUTRA conversa,
  -- em qualquer profissional, num vinculo cujo procedimento usa o mesmo
  -- recurso. Sem isto, duas conversas reservavam o mesmo horario da mesma
  -- sala (em dois profissionais) e a segunda so descobria no agendar,
  -- depois de o paciente confirmar.
  if o_recurso is not null and exists (
    select 1
      from public.slot_hold h
      join public.service_link sl
        on sl.id = h.service_link_id and sl.clinic_id = h.clinic_id
      join public.procedure pr
        on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
     where h.clinic_id = p_clinic_id
       and pr.resource_id = o_recurso
       and h.expires_at > now()
       and h.consumido_em is null
       and h.conversation_id is distinct from p_conversation_id
       and h.id is distinct from p_reserva_propria
       and h.starts_at < o_fim
       and h.ends_at > p_starts_at
  ) then
    o_motivo := 'reservado_por_outra_conversa';
    return;
  end if;
end;
$function$;

comment on function public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid) is
  'Interna (nenhum papel da API executa): as conferencias que reservar_horario_da_ia e agendar_pela_ia repetem, na ordem do contrato da E4, mais a unidade (AG3). o_motivo nulo = pode; senao ia_desligada, agenda_nao_configurada, vinculo_invalido, unidade_invalida (unidade de outra clinica, inativa ou que nao existe), antes_da_antecedencia, depois_do_horizonte, fora_da_jornada (com unidade, so a jornada dela e a sem unidade), bloqueado, ocupado ou reservado_por_outra_conversa. p_ends_at nulo = inicio + duracao do vinculo; p_reserva_propria fica fora da conferencia de reservas; p_unit_id nulo = a jornada de todas as unidades, como antes.';

CREATE OR REPLACE FUNCTION public.lista_de_espera_da_ia_ligada(p_clinic_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  -- D-36 (DECISAO DO DONO A CONFIRMAR, cabecalho): a lista pela IA so vale
  -- com Agendar valendo (skills.agendar, antecedencia e horizonte). false
  -- aqui: so a chave lista_de_espera.
  c_exige_agendar constant boolean := true;
  v_config record;
begin
  -- A versao em uso e a ultima publicada (a que o agente le no WhatsApp).
  select a.skills, a.agenda_antecedencia_horas, a.agenda_horizonte_dias
    into v_config
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if not found or (v_config.skills ->> 'lista_de_espera') is distinct from 'true' then
    return false;
  end if;
  if c_exige_agendar
     and ((v_config.skills ->> 'agendar') is distinct from 'true'
          or v_config.agenda_antecedencia_horas is null
          or v_config.agenda_horizonte_dias is null)
  then
    return false;
  end if;
  return true;
end;
$function$;

comment on function public.lista_de_espera_da_ia_ligada(uuid) is
  'Interna (nenhum papel da API executa): a habilidade lista_de_espera ligada na ULTIMA versao publicada do agente (skills ->> ''lista_de_espera'' = ''true'') e, enquanto c_exige_agendar (D-36, a confirmar), Agendar valendo nela (skills.agendar, agenda_antecedencia_horas e agenda_horizonte_dias preenchidos). Sem versao publicada: falso.';

do $conferencia$
declare
  v_dif text;
begin
  select string_agg(x.nome, ', ') into v_dif
    from (values
      ('preparo_em_vigor', to_regprocedure('public.preparo_em_vigor(uuid,uuid)'), '6d4291763655f97db52034b5e538c9fc'),
      ('conferir_horario_da_ia', to_regprocedure('public.conferir_horario_da_ia(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid)'), '694fdf0601db46be639dd6b4a5d0b649'),
      ('lista_de_espera_da_ia_ligada', to_regprocedure('public.lista_de_espera_da_ia_ligada(uuid)'), '1adee02246428fa9b453567f8cc518e9')
    ) as x(nome, oid, esperado)
    left join pg_catalog.pg_proc p on p.oid = x.oid
   where md5(p.prosrc) is distinct from x.esperado;
  if v_dif is not null then
    raise exception using errcode = 'P0001', message = 'rollback_corpo_diferente',
      hint = 'Nao voltaram ao corpo de antes da 20261106110000: ' || v_dif;
  end if;
end;
$conferencia$;
-- fim do rollback
commit;
