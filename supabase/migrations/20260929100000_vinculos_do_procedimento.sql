-- ---------------------------------------------------------------------------
-- Vinculos do procedimento: quem faz e quais convenios, gravados de uma vez
-- ---------------------------------------------------------------------------
-- Frente 1 (Cadastros), decisao do dono em 29/09/2026: a aba Vinculos sai de
-- Cadastros e o vinculo (service_link: profissional x procedimento x
-- convenio, com preco, duracao e cobertura) passa a ser feito DENTRO do modal
-- do Procedimento, na secao "Quem faz e convenios". A tela manda o estado
-- desejado do procedimento inteiro (uma linha por profissional e convenio,
-- com preco e duracao ja resolvidos: o "padrao" do procedimento vira valor
-- concreto antes de chegar aqui) e esta funcao reconcilia numa transacao so:
--
--   - CRIA o vinculo que ainda nao existe;
--   - REATIVA e atualiza o que existe (ativo ou nao) e continua na lista. O
--     unique de tres pontas (service_link_vinculo_unico, NULLS NOT DISTINCT)
--     faz o "Particular" desativado voltar, em vez de duplicar;
--   - DESATIVA (active = false, nunca apaga) o vinculo ativo do procedimento
--     que saiu da lista. appointment.service_link_id e FK sem cascata: as
--     consultas antigas continuam apontando para ele. Desativado, ele some do
--     modal de agendamento e da reoferta da lista de espera, que ja filtram
--     service_link.active (o mesmo efeito do antigo "Desativar" da aba).
--   - "IA pode agendar" tem UMA fonte, a chave do procedimento: todo vinculo
--     gravado aqui leva bookable_by_ai = procedure.bookable_by_ai.
--
-- SECURITY INVOKER: roda com a sessao de quem chama, entao a RLS de
-- procedure (leitura por membro ativo) e a de service_link (escrita so de
-- admin e gestor, "admin e gestor escrevem vinculos") valem inteiras. A
-- conferencia de papel logo no comeco nao substitui a policy: so troca o
-- "nada aconteceu" silencioso da RLS no UPDATE (zero linhas, sem erro) por
-- um 42501 claro para a recepcao, a leitura e o profissional.
--
-- Isolamento entre clinicas: o procedimento de outra clinica nao aparece
-- para a sessao (P0002, "nao encontrado", sem dizer que existe); profissional
-- ou convenio de outra clinica e recusado no INSERT pelo gatilho
-- exigir_cadastro_da_mesma_clinica (23503), que ja cobre service_link desde
-- 20260924106000. O vinculo que ja existe para este procedimento passou pelo
-- mesmo gatilho quando nasceu, e o UPDATE daqui nao troca profissional,
-- procedimento, convenio nem clinica.
--
-- Concorrencia: a linha do procedimento fica travada (FOR UPDATE) durante a
-- reconciliacao. Dois "Salvar" simultaneos do mesmo procedimento rodam um
-- depois do outro e o ultimo vence por inteiro, sem mistura das duas listas.
--
-- Devolve as contagens para a tela avisar o que mudou, inclusive quantas
-- consultas futuras continuam marcadas em vinculos que acabaram de sair (a
-- desativacao nao desmarca nada; a recepcao remarca ou cancela pela Agenda).

create or replace function public.sincronizar_vinculos_do_procedimento(
  p_procedure_id uuid,
  p_linhas jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_ia boolean;
  v_desativados uuid[];
  v_reativados integer := 0;
  v_alterados integer := 0;
  v_criados integer := 0;
  v_consultas_futuras integer := 0;
begin
  -- Forma da lista: array de objetos, com tamanho de cadastro de clinica.
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A lista de vínculos é inválida.';
  end if;
  if jsonb_array_length(p_linhas) > 500 then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Vínculos demais para um procedimento.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_linhas) as e
     where jsonb_typeof(e) <> 'object'
  ) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A lista de vínculos é inválida.';
  end if;

  -- Cada linha: profissional, duracao de 5 a 600 minutos, preco nao negativo
  -- e "coberto" so com convenio (coberto_exige_convenio tambem recusa, mas
  -- aqui a mensagem e a mesma de qualquer linha invalida).
  if exists (
    select 1
      from jsonb_to_recordset(p_linhas) as d (
        professional_id uuid,
        insurance_id uuid,
        price_cents integer,
        covered_by_insurance boolean,
        duration_min integer
      )
     where d.professional_id is null
        or d.duration_min is null
        or d.duration_min < 5
        or d.duration_min > 600
        or d.price_cents < 0
        or (coalesce(d.covered_by_insurance, false) and d.insurance_id is null)
  ) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Confira o preço e a duração de cada vínculo.';
  end if;

  -- O mesmo profissional no mesmo convenio duas vezes seria o mesmo vinculo
  -- com dois precos: recusa em vez de escolher um em silencio.
  if exists (
    select 1
      from jsonb_to_recordset(p_linhas) as d (
        professional_id uuid,
        insurance_id uuid
      )
     group by d.professional_id, d.insurance_id
    having count(*) > 1
  ) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'O mesmo profissional aparece duas vezes no mesmo convênio.';
  end if;

  -- O procedimento como a SESSAO o enxerga (RLS de procedure): de outra
  -- clinica, ou inexistente, da no mesmo "nao encontrado".
  select p.clinic_id into v_clinic_id
    from procedure p
   where p.id = p_procedure_id;
  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'Procedimento não encontrado.';
  end if;

  if not public.user_has_role(v_clinic_id, array['admin', 'gestor']) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Somente administradores e gestores alteram os cadastros.';
  end if;

  -- Trava do procedimento (serializa o "Salvar" concorrente) e a chave da IA
  -- que todo vinculo gravado aqui vai seguir.
  select p.bookable_by_ai into v_ia
    from procedure p
   where p.id = p_procedure_id
     for update;

  -- (1) Sai da lista: desativa, nunca apaga.
  with saiu as (
    update service_link sl
       set active = false
     where sl.procedure_id = p_procedure_id
       and sl.active
       and not exists (
         select 1
           from jsonb_to_recordset(p_linhas) as d (
             professional_id uuid,
             insurance_id uuid
           )
          where d.professional_id = sl.professional_id
            and d.insurance_id is not distinct from sl.insurance_id
       )
    returning sl.id
  )
  select coalesce(array_agg(saiu.id), '{}'::uuid[]) into v_desativados
    from saiu;

  -- (2) Continua ou volta: quantos estavam desativados (o RETURNING do
  -- Postgres 17 so enxerga o valor novo), depois o update de quem mudou.
  select count(*) into v_reativados
    from service_link sl
    join jsonb_to_recordset(p_linhas) as d (
      professional_id uuid,
      insurance_id uuid
    )
      on d.professional_id = sl.professional_id
     and d.insurance_id is not distinct from sl.insurance_id
   where sl.procedure_id = p_procedure_id
     and not sl.active;

  update service_link sl
     set price_cents = d.price_cents,
         covered_by_insurance = coalesce(d.covered_by_insurance, false),
         duration_min = d.duration_min,
         bookable_by_ai = v_ia,
         active = true
    from jsonb_to_recordset(p_linhas) as d (
      professional_id uuid,
      insurance_id uuid,
      price_cents integer,
      covered_by_insurance boolean,
      duration_min integer
    )
   where sl.procedure_id = p_procedure_id
     and sl.professional_id = d.professional_id
     and sl.insurance_id is not distinct from d.insurance_id
     and (
       not sl.active
       or sl.price_cents is distinct from d.price_cents
       or sl.covered_by_insurance
            is distinct from coalesce(d.covered_by_insurance, false)
       or sl.duration_min is distinct from d.duration_min
       or sl.bookable_by_ai is distinct from v_ia
     );
  get diagnostics v_alterados = row_count;

  -- (3) Novo: nao existe em nenhum estado. O gatilho de isolamento confere
  -- profissional, procedimento e convenio contra a clinica do procedimento.
  insert into service_link (
    clinic_id,
    professional_id,
    procedure_id,
    insurance_id,
    price_cents,
    covered_by_insurance,
    duration_min,
    bookable_by_ai,
    active
  )
  select
    v_clinic_id,
    d.professional_id,
    p_procedure_id,
    d.insurance_id,
    d.price_cents,
    coalesce(d.covered_by_insurance, false),
    d.duration_min,
    v_ia,
    true
    from jsonb_to_recordset(p_linhas) as d (
      professional_id uuid,
      insurance_id uuid,
      price_cents integer,
      covered_by_insurance boolean,
      duration_min integer
    )
   where not exists (
     select 1
       from service_link sl
      where sl.procedure_id = p_procedure_id
        and sl.professional_id = d.professional_id
        and sl.insurance_id is not distinct from d.insurance_id
   );
  get diagnostics v_criados = row_count;

  -- Consultas que ainda vao acontecer nos vinculos que acabaram de sair.
  if cardinality(v_desativados) > 0 then
    select count(*) into v_consultas_futuras
      from appointment a
     where a.service_link_id = any (v_desativados)
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.ends_at > now();
  end if;

  return jsonb_build_object(
    'criados', v_criados,
    'reativados', v_reativados,
    'atualizados', v_alterados - v_reativados,
    'desativados', cardinality(v_desativados),
    'consultas_futuras', v_consultas_futuras
  );
end;
$$;

revoke execute on function public.sincronizar_vinculos_do_procedimento(
  uuid,
  jsonb
) from public, anon;
grant execute on function public.sincronizar_vinculos_do_procedimento(
  uuid,
  jsonb
) to authenticated;

comment on function public.sincronizar_vinculos_do_procedimento(uuid, jsonb) is
  'Reconcilia os vinculos (service_link) de um procedimento com a lista desejada: cria, reativa e atualiza, e desativa (nunca apaga) o que saiu. SECURITY INVOKER: RLS e papel da sessao valem. bookable_by_ai segue o procedimento.';
