-- Correcao de falha ALTA da revisao adversarial de 25/08/2026, provada contra
-- o banco real.
--
-- As policies de escrita de contact e contact_consent usavam user_can_write,
-- que INCLUI o papel profissional. A matriz do produto diz o contrario
-- (leads_pacientes: profissional = "ver"), e as Server Actions obedeciam a
-- matriz. Resultado: a tela recusava, mas o PostgREST aceitava. Com o proprio
-- token de sessao, um profissional inseria linha em contact_consent e
-- DEVOLVIA autorizacao a quem tinha pedido descadastro (o gatilho de
-- reconsentimento so cobra texto nao vazio), e ainda editava telefone, CPF e
-- observacoes de qualquer paciente da clinica.
--
-- E a mesma classe corrigida em 20260825140000 para package_balance; contact e
-- contact_consent tinham ficado de fora. Regra 3.1: o filtro vive na policy,
-- porque esconder botao nao protege nada.

-- ---------------------------------------------------------------------------
-- 1. Editar dado de paciente e de autorizacao: admin, gestor e recepcao
-- ---------------------------------------------------------------------------
-- INSERT de contact continua com user_can_write DE PROPOSITO: o profissional
-- cria paciente ao marcar consulta na propria agenda (criarPacienteRapidoAction
-- roda sob canEdit(role,'agenda'), e agenda do profissional e "proprio").
-- Criar para agendar e ato de agenda; EDITAR ficha e ato de cadastro, e ai a
-- matriz manda.

drop policy "membro com escrita edita contato" on public.contact;

create policy "recepcao e gestao editam contato" on public.contact
  for update using (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']))
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']));

drop policy "membro com escrita registra consentimento" on public.contact_consent;
drop policy "membro com escrita revoga consentimento" on public.contact_consent;

create policy "recepcao e gestao registram consentimento" on public.contact_consent
  for insert with check (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']));

-- Revogar continua sendo o UNICO update permitido (a linha ativa vira
-- revogada); reativar por update segue impossivel pelo gatilho
-- impedir_reativacao_consentimento.
create policy "recepcao e gestao revogam consentimento" on public.contact_consent
  for update using (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao'])
    and revoked_at is null)
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao'])
    and revoked_at is not null);

-- ---------------------------------------------------------------------------
-- 2. Marcar falta continua funcionando para o profissional
-- ---------------------------------------------------------------------------
-- incrementar_no_show era security INVOKER e dependia da policy de update de
-- contact, que acabou de fechar. Falta e ato de agenda ("sempre acao explicita
-- de alguem", regra 3.5) e o profissional marca falta na propria agenda, entao
-- a funcao vira definer com recorte de clinica explicito: so mexe em contato de
-- clinica onde quem chama esta ativo. Service role (auth.uid nulo) segue
-- passando, como em toda a base.

create or replace function public.incrementar_no_show(p_contact_id uuid)
returns void
language sql security definer
set search_path = public
as $$
  update contact
     set no_show_count = no_show_count + 1
   where id = p_contact_id
     and (
       auth.uid() is null
       or clinic_id in (select public.user_active_clinic_ids())
     )
$$;

revoke execute on function public.incrementar_no_show(uuid) from public, anon;
grant execute on function public.incrementar_no_show(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Lista de pacientes com ordem definida
-- ---------------------------------------------------------------------------
-- O PostgREST corta a resposta em max_rows (1000). Sem ORDER BY, o corte era
-- arbitrario: a mesma clinica via listas diferentes a cada chamada. Ordenar no
-- banco torna o corte estavel e a paginacao possivel depois.

create or replace function public.pacientes_resumo(p_clinic_id uuid)
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
  order by c.name nulls last, c.id
$$;

revoke execute on function public.pacientes_resumo(uuid) from public, anon;
grant execute on function public.pacientes_resumo(uuid) to authenticated, service_role;
