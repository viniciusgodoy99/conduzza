-- ---------------------------------------------------------------------------
-- Conversoes para o Google Ads, por arquivo (etapa 6A do plano de
-- 16/11/2026, "Rastreio completo")
-- ---------------------------------------------------------------------------
-- Decisao do dono em 16/11/2026 (benchmark do Tintim: a planilha de
-- conversoes offline com GCLID). A tela de Resultados passa a exportar um
-- arquivo que a agencia sobe no Google Ads (importacao de conversoes por
-- clique): cada conversao registrada (conversion_event) de um contato que
-- chegou por anuncio do Google, com o identificador do clique que o script do
-- site ou o link rastreado guardaram.
--
-- A funcao so devolve o que o arquivo precisa: o gclid, a etapa, a hora, o
-- valor e o id da conversao (o "Order ID", para o Google nao contar duas
-- vezes). Nenhum dado de paciente. O clique e o mais recente do contato,
-- confirmado (nao o provavel), de antes da conversao.
--
-- LIMITE do arquivo do Google: ele so aceita o GCLID. O clique de iPhone que
-- veio so com gbraid ou wbraid nao entra por arquivo (so pelo envio
-- automatico, a etapa 6B): esses sao contados em sem_gclid, para a tela
-- dizer quantos ficaram de fora. O gclid e apagado 90 dias depois do clique
-- (o mesmo prazo que o Google aceita), entao conversao mais antiga nao sai.
--
-- So administrador e gestor da clinica (e o sistema): o gclid e
-- identificador, e clique_do_site nao tem policy nem grant para a sessao.
--
-- ORDEM DE PUBLICACAO: antes do codigo (a action chama a funcao). Nao mexe em
-- tabela nenhuma.
--
-- ROLLBACK: drop function public.conversoes_para_o_google(uuid, timestamptz, timestamptz).

create function public.conversoes_para_o_google(
  p_clinic_id uuid,
  p_de timestamptz,
  p_ate timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_linhas jsonb;
  v_sem_gclid integer;
begin
  if p_clinic_id is null or p_de is null or p_ate is null or p_ate <= p_de then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica e período são obrigatórios.';
  end if;
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'Somente administradores e gestores exportam as conversões.';
    end if;
  elsif not public.user_has_role(p_clinic_id, array['admin', 'gestor']) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Somente administradores e gestores exportam as conversões.';
  end if;

  with conversoes as (
    select e.event_id, e.stage_chave, e.created_at, e.value_cents, e.currency,
           k.gclid
      from public.conversion_event e
      join lateral (
        select q.gclid
          from public.clique_do_site q
         where q.clinic_id = e.clinic_id
           and q.contact_id = e.contact_id
           and not q.provavel
           and (q.gclid is not null or q.gbraid is not null or q.wbraid is not null)
           and q.criado_em <= e.created_at
         order by q.criado_em desc
         limit 1
      ) k on true
     where e.clinic_id = p_clinic_id
       and e.created_at >= p_de
       and e.created_at < p_ate
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'gclid', c.gclid,
               'etapa', c.stage_chave,
               'convertido_em', c.created_at,
               'valor_cents', c.value_cents,
               'moeda', c.currency,
               'evento_id', c.event_id
             ) order by c.created_at, c.event_id
           ) filter (where c.gclid is not null),
           '[]'::jsonb
         ),
         (count(*) filter (where c.gclid is null))::integer
    into v_linhas, v_sem_gclid
    from conversoes c;

  return jsonb_build_object('linhas', v_linhas, 'sem_gclid', v_sem_gclid);
end;
$$;

revoke all on function public.conversoes_para_o_google(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.conversoes_para_o_google(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.conversoes_para_o_google(uuid, timestamptz, timestamptz) is
  'As conversoes registradas no periodo de contatos que chegaram por anuncio do Google, com o gclid do clique confirmado mais recente de antes da conversao: {linhas: [{gclid, etapa, convertido_em, valor_cents, moeda, evento_id}], sem_gclid}. sem_gclid conta as que so tem gbraid ou wbraid (o arquivo do Google so aceita o gclid). So administrador e gestor da clinica ou service_role; 42501 fora disso. 22023 sem clinica ou periodo.';

notify pgrst, 'reload schema';
