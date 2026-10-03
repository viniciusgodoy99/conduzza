-- ---------------------------------------------------------------------------
-- Aba parada sem retentativa do PostgREST (02/10/2026)
-- ---------------------------------------------------------------------------
-- O QUE FAZ: troca o codigo do erro "O cadastro mudou enquanto voce editava"
-- das duas RPCs do convenio pelo medico (20261002140000) de 40001
-- (serialization_failure) para CZ409, um codigo proprio da Conduzza.
--
-- POR QUE: o PostgREST trata 40001 como conflito de serializacao e REPETE a
-- transacao sozinho, sem limite. A recusa da aba parada e deterministica (a
-- abertura enviada nunca vai bater), entao cada chamada virava um laco: no
-- teste de integracao de 02/10 foram mais de 12 mil repeticoes em 3 minutos,
-- segurando uma conexao e a trava consultiva da clinica. Com CZ409 o PostgREST
-- devolve o erro na hora (HTTP 400, code "CZ409") e a action traduz para
-- code "cadastro_mudou". Nada mais muda: corpo, assinatura, SECURITY INVOKER,
-- search_path, grants e comentarios ficam como estao (CREATE OR REPLACE com o
-- corpo de producao, so o errcode trocado nos 3 pontos).
--
-- ROLLBACK: reaplicar as duas funcoes de 20261002140000 (volta o 40001 e o
-- laco; nao recomendado).

CREATE OR REPLACE FUNCTION public.sincronizar_vinculos_do_procedimento(p_procedure_id uuid, p_linhas jsonb, p_planos uuid[] DEFAULT NULL::uuid[], p_vinculos_na_abertura jsonb DEFAULT NULL::jsonb, p_planos_na_abertura uuid[] DEFAULT NULL::uuid[], p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_legado constant boolean := p_planos is null;
  v_clinic_id uuid;
  v_ia boolean;
  v_desativados uuid[];
  v_reativados integer := 0;
  v_alterados integer := 0;
  v_criados integer := 0;
  v_consultas_futuras integer := 0;
  v_primeira_consulta timestamptz;
  v_planos uuid[];
  v_planos_atuais uuid[];
  v_planos_entram uuid[] := '{}'::uuid[];
  v_planos_saem uuid[] := '{}'::uuid[];
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

  -- Os parametros novos so existem junto com p_planos: sem ele, a chamada e
  -- a do codigo antigo, e um "confirmar" ou uma abertura ali e engano de
  -- quem chamou (melhor recusar do que ignorar em silencio).
  if v_legado then
    if p_vinculos_na_abertura is not null
       or p_planos_na_abertura is not null
       or coalesce(p_confirmar, false) then
      raise exception using errcode = 'invalid_parameter_value',
        message = 'Informe os convênios que cobrem este procedimento.';
    end if;
  else
    if cardinality(p_planos) > 200
       or exists (select 1 from unnest(p_planos) as x (id) where x.id is null)
       or (p_planos_na_abertura is not null and (
             cardinality(p_planos_na_abertura) > 200
             or exists (select 1 from unnest(p_planos_na_abertura) as x (id)
                         where x.id is null)))
    then
      raise exception using errcode = 'invalid_parameter_value',
        message = 'A lista de convênios é inválida.';
    end if;
    if p_vinculos_na_abertura is not null and (
         jsonb_typeof(p_vinculos_na_abertura) <> 'array'
         or jsonb_array_length(p_vinculos_na_abertura) > 500
         or exists (select 1 from jsonb_array_elements(p_vinculos_na_abertura) as e
                     where jsonb_typeof(e) <> 'object'))
    then
      raise exception using errcode = 'invalid_parameter_value',
        message = 'A lista de vínculos é inválida.';
    end if;
    v_planos := array(select distinct x.id from unnest(p_planos) as x (id));
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

  -- Fila da clinica (a mesma de sincronizar_convenios_do_profissional),
  -- depois a trava do procedimento (serializa o "Salvar" concorrente) e a
  -- chave da IA que todo vinculo gravado aqui vai seguir.
  perform pg_advisory_xact_lock(
    hashtextextended('convenios_do_catalogo:' || v_clinic_id::text, 0)
  );
  select p.bookable_by_ai into v_ia
    from procedure p
   where p.id = p_procedure_id
     for update;

  if not v_legado then
    -- (a) Aba parada: os vinculos ativos e os planos de agora tem de ser os
    -- que a tela leu na abertura. EXCEPT trata o null do Particular como
    -- igual.
    if p_vinculos_na_abertura is not null and exists (
      (select sl.professional_id, sl.insurance_id
         from service_link sl
        where sl.procedure_id = p_procedure_id
          and sl.active
       except
       select d.professional_id, d.insurance_id
         from jsonb_to_recordset(p_vinculos_na_abertura) as d (
           professional_id uuid,
           insurance_id uuid
         ))
      union all
      (select d.professional_id, d.insurance_id
         from jsonb_to_recordset(p_vinculos_na_abertura) as d (
           professional_id uuid,
           insurance_id uuid
         )
       except
       select sl.professional_id, sl.insurance_id
         from service_link sl
        where sl.procedure_id = p_procedure_id
          and sl.active)
    ) then
      raise exception using errcode = 'CZ409',
        message = 'O cadastro mudou enquanto você editava. Feche, abra de novo e salve.';
    end if;

    select coalesce(array_agg(q.insurance_id), '{}'::uuid[]) into v_planos_atuais
      from procedure_insurance q
     where q.procedure_id = p_procedure_id;

    if p_planos_na_abertura is not null and exists (
      (select x.id from unnest(v_planos_atuais) as x (id)
       except
       select y.id from unnest(p_planos_na_abertura) as y (id))
      union all
      (select y.id from unnest(p_planos_na_abertura) as y (id)
       except
       select x.id from unnest(v_planos_atuais) as x (id))
    ) then
      raise exception using errcode = 'CZ409',
        message = 'O cadastro mudou enquanto você editava. Feche, abra de novo e salve.';
    end if;

    -- (b) Todo plano marcado e convenio desta clinica (como a sessao o ve).
    if exists (
      select 1 from unnest(v_planos) as x (id)
       where not exists (
         select 1 from insurance i
          where i.id = x.id
            and i.clinic_id = v_clinic_id
       )
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'Um convênio escolhido não é desta clínica.';
    end if;

    -- (c) Convenio desativado nao ENTRA: nem como plano novo que cobre, nem
    -- numa linha nova. O que ja estava gravado pode ficar, e o plano em uso
    -- num vinculo ativo deste procedimento conta como ja marcado (a cura da
    -- abertura, igual ao v_atuais da RPC do medico): ele so ganha a linha em
    -- procedure_insurance. Medido antes do passo (1) e sob a trava.
    if exists (
      select 1 from insurance i
       where i.id = any (v_planos)
         and not (i.id = any (v_planos_atuais))
         and not exists (
           select 1 from service_link sl
            where sl.procedure_id = p_procedure_id
              and sl.active
              and sl.insurance_id = i.id
         )
         and not i.active
    ) or exists (
      select 1
        from jsonb_to_recordset(p_linhas) as d (
          professional_id uuid,
          insurance_id uuid
        )
        join insurance i on i.id = d.insurance_id
       where not i.active
         and not exists (
           select 1 from service_link sl
            where sl.procedure_id = p_procedure_id
              and sl.professional_id = d.professional_id
              and sl.insurance_id = d.insurance_id
              and sl.active
         )
    ) then
      raise exception using errcode = 'invalid_parameter_value',
        message = 'Um convênio desativado não pode ser marcado.';
    end if;

    -- (d) Todo convenio de linha esta entre os que cobrem.
    if exists (
      select 1
        from jsonb_to_recordset(p_linhas) as d (insurance_id uuid)
       where d.insurance_id is not null
         and not (d.insurance_id = any (v_planos))
    ) then
      raise exception using errcode = 'check_violation',
        message = 'Um convênio marcado para um profissional não está entre os convênios que cobrem este procedimento.';
    end if;

    -- (e) Linha de convenio que ENTRA (nao estava ativa) exige que o
    -- profissional atenda o convenio. A que ja estava ativa passa (dado
    -- antigo, curado na abertura do modal).
    if exists (
      select 1
        from jsonb_to_recordset(p_linhas) as d (
          professional_id uuid,
          insurance_id uuid
        )
       where d.insurance_id is not null
         and not exists (
           select 1 from service_link sl
            where sl.procedure_id = p_procedure_id
              and sl.professional_id = d.professional_id
              and sl.insurance_id = d.insurance_id
              and sl.active
         )
         and not exists (
           select 1 from professional_insurance pi
            where pi.professional_id = d.professional_id
              and pi.insurance_id = d.insurance_id
         )
    ) then
      raise exception using errcode = 'check_violation',
        message = 'Um profissional não atende um dos convênios marcados. Feche, abra de novo e salve.';
    end if;

    v_planos_entram := array(
      select x.id from unnest(v_planos) as x (id)
       where not (x.id = any (v_planos_atuais))
       order by x.id
    );
    v_planos_saem := array(
      select x.id from unnest(v_planos_atuais) as x (id)
       where not (x.id = any (v_planos))
       order by x.id
    );

    -- (f) Previa do que sai e das consultas que continuam marcadas nele.
    -- Sem a confirmacao, devolve a previa e NADA e gravado.
    v_desativados := array(
      select sl.id
        from service_link sl
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
    );
    if cardinality(v_desativados) > 0 then
      select count(*), min(a.starts_at)
        into v_consultas_futuras, v_primeira_consulta
        from appointment a
       where a.service_link_id = any (v_desativados)
         and a.status not in ('cancelado_paciente', 'cancelado_clinica')
         and a.ends_at > now();
    end if;
    if v_consultas_futuras > 0 and not coalesce(p_confirmar, false) then
      return jsonb_build_object(
        'aplicado', false,
        'criados', 0,
        'reativados', 0,
        'atualizados', 0,
        'desativados', cardinality(v_desativados),
        'consultas_futuras', v_consultas_futuras,
        'primeira_consulta', v_primeira_consulta,
        'planos_entram', to_jsonb(v_planos_entram),
        'planos_saem', to_jsonb(v_planos_saem)
      );
    end if;
  end if;

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
    select count(*), min(a.starts_at)
      into v_consultas_futuras, v_primeira_consulta
      from appointment a
     where a.service_link_id = any (v_desativados)
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.ends_at > now();
  end if;

  if v_legado then
    -- O mesmo retorno de 20260929100000, chave por chave.
    return jsonb_build_object(
      'criados', v_criados,
      'reativados', v_reativados,
      'atualizados', v_alterados - v_reativados,
      'desativados', cardinality(v_desativados),
      'consultas_futuras', v_consultas_futuras
    );
  end if;

  -- (4) Os convenios que cobrem passam a ser exatamente p_planos.
  delete from procedure_insurance q
   where q.procedure_id = p_procedure_id
     and q.insurance_id = any (v_planos_saem);
  insert into procedure_insurance (clinic_id, procedure_id, insurance_id)
  select v_clinic_id, p_procedure_id, x.id
    from unnest(v_planos_entram) as x (id)
  on conflict (procedure_id, insurance_id) do nothing;

  return jsonb_build_object(
    'aplicado', true,
    'criados', v_criados,
    'reativados', v_reativados,
    'atualizados', v_alterados - v_reativados,
    'desativados', cardinality(v_desativados),
    'consultas_futuras', v_consultas_futuras,
    'primeira_consulta', v_primeira_consulta,
    'planos_entram', to_jsonb(v_planos_entram),
    'planos_saem', to_jsonb(v_planos_saem)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sincronizar_convenios_do_profissional(p_professional_id uuid, p_convenios uuid[], p_convenios_na_abertura uuid[] DEFAULT NULL::uuid[], p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_clinic_id uuid;
  v_novos uuid[];
  v_pares uuid[];
  v_atuais uuid[];
  v_entram uuid[];
  v_saem uuid[];
  v_faz uuid[];
  v_alvo_procedimentos uuid[];
  v_alvo_planos uuid[];
  v_vinculos_que_saem uuid[];
  v_deixa_de_fazer jsonb;
  v_entram_em jsonb;
  v_saem_de jsonb;
  v_consultas integer := 0;
  v_primeira timestamptz;
  v_criados integer := 0;
  v_reativados integer := 0;
  v_desativados integer := 0;
begin
  if p_convenios is null
     or cardinality(p_convenios) > 200
     or exists (select 1 from unnest(p_convenios) as c (id) where c.id is null)
     or (p_convenios_na_abertura is not null and (
           cardinality(p_convenios_na_abertura) > 200
           or exists (select 1 from unnest(p_convenios_na_abertura) as c (id)
                       where c.id is null)))
  then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A lista de convênios é inválida.';
  end if;
  v_novos := array(select distinct c.id from unnest(p_convenios) as c (id));

  -- O profissional como a SESSAO o enxerga: de outra clinica, inexistente
  -- ou para membro pendente, "nao encontrado".
  select p.clinic_id into v_clinic_id
    from professional p
   where p.id = p_professional_id;
  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'Profissional não encontrado.';
  end if;

  if not public.user_has_role(v_clinic_id, array['admin', 'gestor']) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Somente administradores e gestores alteram os cadastros.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('convenios_do_catalogo:' || v_clinic_id::text, 0)
  );

  -- Aba parada: os pares crus de agora tem de ser os da abertura.
  v_pares := array(
    select pi.insurance_id
      from professional_insurance pi
     where pi.professional_id = p_professional_id
  );
  if p_convenios_na_abertura is not null and exists (
    (select x.id from unnest(v_pares) as x (id)
     except
     select y.id from unnest(p_convenios_na_abertura) as y (id))
    union all
    (select y.id from unnest(p_convenios_na_abertura) as y (id)
     except
     select x.id from unnest(v_pares) as x (id))
  ) then
    raise exception using errcode = 'CZ409',
      message = 'O cadastro mudou enquanto você editava. Feche, abra de novo e salve.';
  end if;

  if exists (
    select 1 from unnest(v_novos) as c (id)
     where not exists (
       select 1 from insurance i
        where i.id = c.id
          and i.clinic_id = v_clinic_id
     )
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'Um convênio escolhido não é desta clínica.';
  end if;

  -- Atuais com cura: o plano que so existia num vinculo ativo dele conta
  -- como ja marcado (ganha o par mais abaixo, sem cascata).
  v_atuais := array(
    select x.id
      from (
        select y.id from unnest(v_pares) as y (id)
        union
        select sl.insurance_id
          from service_link sl
         where sl.professional_id = p_professional_id
           and sl.active
           and sl.insurance_id is not null
      ) as x
  );
  v_entram := array(
    select c.id from unnest(v_novos) as c (id)
     where not (c.id = any (v_atuais))
  );
  v_saem := array(
    select a.id from unnest(v_atuais) as a (id)
     where not (a.id = any (v_novos))
  );

  -- Convenio desativado nao entra; o que ja estava marcado pode ficar.
  if exists (
    select 1 from insurance i
     where i.id = any (v_entram)
       and not i.active
  ) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Um convênio desativado não pode ser marcado.';
  end if;

  -- "Faz": qualquer vinculo ativo dele, medido ANTES desta gravacao.
  v_faz := array(
    select distinct sl.procedure_id
      from service_link sl
     where sl.professional_id = p_professional_id
       and sl.active
  );

  -- Alvos da cascata: procedimento que ele faz x plano que entra, so onde o
  -- plano cobre o procedimento.
  select coalesce(array_agg(f.id order by f.id, e.id), '{}'::uuid[]),
         coalesce(array_agg(e.id order by f.id, e.id), '{}'::uuid[])
    into v_alvo_procedimentos, v_alvo_planos
    from unnest(v_faz) as f (id)
   cross join unnest(v_entram) as e (id)
   where exists (select 1 from procedure_insurance q where q.procedure_id = f.id and q.insurance_id = e.id);

  v_vinculos_que_saem := array(
    select sl.id
      from service_link sl
     where sl.professional_id = p_professional_id
       and sl.active
       and sl.insurance_id = any (v_saem)
  );

  -- Deixa de fazer: todos os vinculos ativos dele no procedimento saem (o
  -- Particular nunca sai por aqui) e nenhum plano que entra cobre.
  select coalesce(jsonb_agg(x.procedure_id order by pr.name, x.procedure_id),
                  '[]'::jsonb)
    into v_deixa_de_fazer
    from (
      select sl.procedure_id
        from service_link sl
       where sl.professional_id = p_professional_id
         and sl.active
       group by sl.procedure_id
      having bool_and(coalesce(sl.insurance_id = any (v_saem), false))
    ) as x
    left join procedure pr on pr.id = x.procedure_id
   where not (x.procedure_id = any (v_alvo_procedimentos));

  if cardinality(v_vinculos_que_saem) > 0 then
    select count(*), min(a.starts_at) into v_consultas, v_primeira
      from appointment a
     where a.service_link_id = any (v_vinculos_que_saem)
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.ends_at > now();
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'insurance_id', e.id,
             'procedure_ids', coalesce((
               select jsonb_agg(a.procedure_id order by pr.name, a.procedure_id)
                 from unnest(v_alvo_procedimentos, v_alvo_planos)
                        as a (procedure_id, insurance_id)
                 left join procedure pr on pr.id = a.procedure_id
                where a.insurance_id = e.id
             ), '[]'::jsonb)
           ) order by i.name, e.id), '[]'::jsonb)
    into v_entram_em
    from unnest(v_entram) as e (id)
    left join insurance i on i.id = e.id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'insurance_id', s.id,
             'procedure_ids', coalesce((
               select jsonb_agg(sl.procedure_id order by pr.name, sl.procedure_id)
                 from service_link sl
                 left join procedure pr on pr.id = sl.procedure_id
                where sl.id = any (v_vinculos_que_saem)
                  and sl.insurance_id = s.id
             ), '[]'::jsonb)
           ) order by i.name, s.id), '[]'::jsonb)
    into v_saem_de
    from unnest(v_saem) as s (id)
    left join insurance i on i.id = s.id;

  if not coalesce(p_confirmar, false)
     and (v_consultas > 0 or jsonb_array_length(v_deixa_de_fazer) > 0) then
    return jsonb_build_object(
      'aplicado', false,
      'entram', v_entram_em,
      'saem', v_saem_de,
      'deixa_de_fazer', v_deixa_de_fazer,
      'consultas_futuras', v_consultas,
      'primeira_consulta', v_primeira,
      'vinculos_criados', 0,
      'vinculos_reativados', 0,
      'vinculos_desativados', 0
    );
  end if;

  -- Sai: desativa (nunca apaga) e tira o par.
  update service_link sl
     set active = false
   where sl.id = any (v_vinculos_que_saem);
  get diagnostics v_desativados = row_count;

  delete from professional_insurance pi
   where pi.professional_id = p_professional_id
     and pi.insurance_id = any (v_saem);

  -- Os pares passam a ser exatamente a lista (inclui o plano curado).
  insert into professional_insurance (clinic_id, professional_id, insurance_id)
  select v_clinic_id, p_professional_id, c.id
    from unnest(v_novos) as c (id)
  on conflict (professional_id, insurance_id) do nothing;

  -- Entra: reativa com os valores gravados (D2), chave da IA do
  -- procedimento.
  update service_link sl
     set active = true,
         bookable_by_ai = pr.bookable_by_ai
    from unnest(v_alvo_procedimentos, v_alvo_planos)
           as a (procedure_id, insurance_id)
    join procedure pr on pr.id = a.procedure_id
   where sl.professional_id = p_professional_id
     and sl.procedure_id = a.procedure_id
     and sl.insurance_id = a.insurance_id
     and not sl.active;
  get diagnostics v_reativados = row_count;

  -- Entra: o que nao existe em estado nenhum nasce Coberto.
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
    p_professional_id,
    a.procedure_id,
    a.insurance_id,
    null,
    true,
    pr.default_duration_min,
    pr.bookable_by_ai,
    true
    from unnest(v_alvo_procedimentos, v_alvo_planos)
           as a (procedure_id, insurance_id)
    join procedure pr on pr.id = a.procedure_id
   where not exists (
     select 1
       from service_link sl
      where sl.professional_id = p_professional_id
        and sl.procedure_id = a.procedure_id
        and sl.insurance_id = a.insurance_id
   );
  get diagnostics v_criados = row_count;

  return jsonb_build_object(
    'aplicado', true,
    'entram', v_entram_em,
    'saem', v_saem_de,
    'deixa_de_fazer', v_deixa_de_fazer,
    'consultas_futuras', v_consultas,
    'primeira_consulta', v_primeira,
    'vinculos_criados', v_criados,
    'vinculos_reativados', v_reativados,
    'vinculos_desativados', v_desativados
  );
end;
$function$;

