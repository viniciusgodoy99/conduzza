-- Fase 4, tarefa 4.5: Tela 9 (Pacientes e ficha).
--
-- A RPC pacientes_resumo nasceu na 4.1 e nunca foi chamada. Agora que a tela
-- existe, ela ganha as duas colunas que faltavam para o brief: o NOME do
-- convenio (a lista mostra nome, a RPC devolvia so o id) e os profissionais
-- que ja atenderam o paciente (o filtro "por profissional" do brief nao tinha
-- como existir). Mais a coluna de observacoes da ficha e o indice que sustenta
-- a varredura por clinica + paciente.

-- ---------------------------------------------------------------------------
-- Observacoes da ficha (spec 6.1). Texto livre da recepcao sobre o paciente.
-- NAO e prontuario: a spec 6.10 corta prontuario de proposito, porque puxa
-- responsabilidade de guarda e certificacao.
-- ---------------------------------------------------------------------------

alter table public.contact add column notes text;

-- ---------------------------------------------------------------------------
-- A RPC varre contact por (clinic_id, kind) e nenhum indice servia: o de
-- funil so ajuda como prefixo. Parcial, porque a tela so olha paciente.
-- ---------------------------------------------------------------------------

create index contact_pacientes_idx on public.contact (clinic_id)
  where kind = 'paciente';

-- ---------------------------------------------------------------------------
-- pacientes_resumo v3
-- ---------------------------------------------------------------------------
-- Muda a lista de colunas devolvidas, entao precisa de drop antes do create
-- (create or replace nao altera o retorno de funcao que devolve table).
--
-- Mantido da v2: security INVOKER (as policies de contact, appointment e
-- package_balance valem, inclusive o recorte de clinica) e o vencimento de
-- pacote no DIA CIVIL da clinica, nao na data UTC do servidor.
--
-- Contadores: total_compareceu e total_faltou saem das CONSULTAS, que e a
-- fonte que nao mente. contact.no_show_count e um contador denormalizado que
-- so cresce quando alguem marca falta pela agenda; os dois podem divergir em
-- base antiga, e a Tela 9 usa os daqui de proposito.

drop function public.pacientes_resumo(uuid);

create function public.pacientes_resumo(p_clinic_id uuid)
returns table (
  contact_id uuid,
  name text,
  phone_e164 text,
  insurance_id uuid,
  insurance_name text,
  no_show_count integer,
  tags text[],
  ultima_consulta timestamptz,
  proxima_consulta timestamptz,
  total_compareceu bigint,
  total_faltou bigint,
  saldo_sessoes bigint,
  saldo_total bigint,
  profissionais_ids uuid[]
)
language sql stable
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.phone_e164,
    c.insurance_id,
    i.name,
    c.no_show_count,
    c.tags,
    a.ultima_consulta,
    a.proxima_consulta,
    coalesce(a.total_compareceu, 0),
    coalesce(a.total_faltou, 0),
    coalesce(pb.saldo_sessoes, 0),
    coalesce(pb.saldo_total, 0),
    coalesce(a.profissionais_ids, '{}')
  from contact c
  cross join lateral (
    select (now() at time zone cl.timezone)::date as hoje_local
    from clinic cl where cl.id = p_clinic_id
  ) tz
  left join insurance i on i.id = c.insurance_id
  left join lateral (
    select
      max(ap.starts_at) filter (
        where ap.starts_at <= now()
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as ultima_consulta,
      min(ap.starts_at) filter (
        where ap.starts_at > now()
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as proxima_consulta,
      count(*) filter (where ap.status = 'compareceu') as total_compareceu,
      count(*) filter (where ap.status = 'faltou') as total_faltou,
      array_agg(distinct ap.professional_id) filter (
        where ap.professional_id is not null
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as profissionais_ids
    from appointment ap
    where ap.contact_id = c.id
  ) a on true
  left join lateral (
    select
      sum(b.sessions_total - b.sessions_used) filter (
        where b.expires_at is null or b.expires_at >= tz.hoje_local
      ) as saldo_sessoes,
      sum(b.sessions_total) as saldo_total
    from package_balance b
    where b.contact_id = c.id
  ) pb on true
  where c.clinic_id = p_clinic_id
    and c.kind = 'paciente'
$$;

revoke execute on function public.pacientes_resumo(uuid) from public, anon;
grant execute on function public.pacientes_resumo(uuid) to authenticated, service_role;
