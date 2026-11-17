-- ---------------------------------------------------------------------------
-- Casar a mensagem com o clique do link quando o codigo nao veio (etapa 3d
-- do plano de 16/11/2026, "Rastreio completo"), como no Q5
-- ---------------------------------------------------------------------------
-- Decisao do dono em 16/11/2026. A pessoa que apaga o codigo da mensagem
-- pronta ainda pode ser ligada ao clique:
--   - RECLAMAR (confirmado): a mensagem casou com a mensagem pronta ou a
--     palavra-chave de uma origem (a ingestao ja grava a origem), e existe
--     EXATAMENTE UM clique pendente do link dessa origem, no mesmo numero,
--     nos ultimos 10 minutos. O clique fica ligado ao contato (UTMs e
--     identificadores para a conversao; o numero do anuncio da Meta vai para
--     o contato).
--   - JANELA (provavel): contato NOVO, sem origem e sem nenhum outro sinal,
--     e existe EXATAMENTE UM clique de link pendente no numero que recebeu a
--     mensagem, nos ultimos 10 minutos. O contato ganha a origem cadastrada
--     com o metodo link_provavel, e o clique fica marcado provavel: nao leva
--     identificador de clique para os eventos da Meta.
-- Com dois ou mais cliques na janela, ninguem casa (na duvida, vazio).
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo. O codigo antigo nao
-- chama a funcao nova e le o resumo so com os campos de antes.
--
-- TRAVAS: contact tem 653 linhas (16/11/2026), nenhuma com o metodo novo: a
-- troca do check confere tudo em milissegundos. lock_timeout de 4s.
--
-- ROLLBACK (manual): reaplicar proteger_atribuicao_de_anuncio de producao de
-- antes (sem o bloco "[link provavel]") e resumo_dos_links_rastreados de
-- 20261116120000; drop de casar_clique_sem_codigo e de
-- clique_do_site.provavel; o check de contact so volta sem link_provavel se
-- nenhum contato tiver ganho o metodo (a origem e imutavel).

set local lock_timeout = '4s';

-- ---------------------------------------------------------------------------
-- 1) contact: o metodo link_provavel
-- ---------------------------------------------------------------------------

alter table public.contact
  drop constraint contact_source_method_valido,
  add constraint contact_source_method_valido check (
    source_method is null or source_method in (
      'link_token', 'mensagem_padrao', 'palavra_chave', 'manual', 'importacao',
      'anuncio_ctwa', 'clique_site', 'link_provavel'
    )
  );

-- ---------------------------------------------------------------------------
-- 2) A sessao nao forja a origem provavel
-- ---------------------------------------------------------------------------
-- Corpo de PRODUCAO (pg_get_functiondef em 16/11/2026) com o que e novo
-- entre os marcadores "[link provavel]". Fora deles, identico. Grants
-- mantidos pelo CREATE OR REPLACE.

create or replace function public.proteger_atribuicao_de_anuncio()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- [clique do site] inicio
  -- Os ids do Google sao parte da origem do clique no site: gravados com
  -- ela, nem o sistema os troca (impedir_reatribuicao_de_origem nao vigia
  -- estas colunas). Mesma mensagem e mesmo codigo (P0001) daquele gatilho.
  if tg_op = 'UPDATE'
     and old.source_method is not distinct from 'clique_site'
     and (new.source_google_campaign_id is distinct from old.source_google_campaign_id
       or new.source_google_adgroup_id is distinct from old.source_google_adgroup_id)
  then
    raise exception 'A origem do contato é capturada uma vez e preservada para sempre.';
  end if;
  -- [clique do site] fim
  if auth.uid() is null then
    return new;
  end if;
  -- [origem real] inicio
  -- O metodo anuncio_ctwa so nasce pelo sistema (ingestao do anuncio ou a
  -- correcao da migration 20261004100000). Reenviar o valor que ja estava
  -- gravado passa (formulario que manda a linha inteira).
  if new.source_method is not distinct from 'anuncio_ctwa' then
    if tg_op = 'INSERT' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem de anúncio é registrada só pelo sistema.';
    elsif old.source_method is distinct from 'anuncio_ctwa' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem de anúncio é registrada só pelo sistema.';
    end if;
  end if;
  -- [origem real] fim
  -- [clique do site] inicio
  -- O metodo clique_site e os ids do Google so nascem pelo sistema
  -- (casar_clique_do_site). Reenviar o valor que ja estava gravado passa.
  if new.source_method is not distinct from 'clique_site' then
    if tg_op = 'INSERT' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem do clique no site é registrada só pelo sistema.';
    elsif old.source_method is distinct from 'clique_site' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem do clique no site é registrada só pelo sistema.';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.source_google_campaign_id is not null
       or new.source_google_adgroup_id is not null
    then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A campanha do Google é registrada só pelo sistema.';
    end if;
  elsif new.source_google_campaign_id is distinct from old.source_google_campaign_id
     or new.source_google_adgroup_id is distinct from old.source_google_adgroup_id
  then
    raise exception using errcode = 'insufficient_privilege',
      message = 'A campanha do Google é registrada só pelo sistema.';
  end if;
  -- [clique do site] fim
  -- [link provavel] inicio
  -- O metodo link_provavel (o lead novo casado com o unico clique de link dos
  -- ultimos 10 minutos) so nasce pelo sistema (casar_clique_sem_codigo).
  -- Reenviar o valor que ja estava gravado passa.
  if new.source_method is not distinct from 'link_provavel' then
    if tg_op = 'INSERT' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem provável do link é registrada só pelo sistema.';
    elsif old.source_method is distinct from 'link_provavel' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem provável do link é registrada só pelo sistema.';
    end if;
  end if;
  -- [link provavel] fim
  if tg_op = 'INSERT' then
    new.ctwa_clid := null;
    new.source_ad_id := null;
    new.source_adset_id := null;
    new.source_campaign_id := null;
    return new;
  end if;
  new.ctwa_clid := old.ctwa_clid;
  new.source_ad_id := old.source_ad_id;
  new.source_adset_id := old.source_adset_id;
  new.source_campaign_id := old.source_campaign_id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) clique_do_site: o clique casado pela janela e "provavel"
-- ---------------------------------------------------------------------------

alter table public.clique_do_site
  add column provavel boolean not null default false;

comment on column public.clique_do_site.provavel is
  'Verdadeiro quando o clique do link foi casado so pela janela de 10 minutos (casar_clique_sem_codigo), sem codigo nem mensagem pronta. O clique provavel nao leva identificador para a conversao da Meta e conta a parte no resumo.';

-- Os cliques de link pendentes de um numero, para a busca da janela.
create index clique_do_site_pendente_do_numero
  on public.clique_do_site (clinic_id, whatsapp_account_id, criado_em)
  where contact_id is null and via = 'link';

-- ---------------------------------------------------------------------------
-- 4) casar_clique_sem_codigo
-- ---------------------------------------------------------------------------
-- p_campaign_link_id preenchido: RECLAMAR o clique do link dessa origem (a
-- origem ja foi gravada pela ingestao). Nulo: JANELA (grava a origem).
-- Devolve vinculado (reclamou), origem_gravada (janela), varios (dois ou
-- mais cliques na janela: ninguem casa) ou nenhum.

create function public.casar_clique_sem_codigo(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_whatsapp_account_id uuid,
  p_campaign_link_id uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_janela constant interval := interval '10 minutes';
  v_ids uuid[];
  v_clique public.clique_do_site%rowtype;
  v_canal text;
  v_origem text;
  v_meio text;
  v_campanha text;
  v_n integer;
begin
  if p_clinic_id is null or p_contact_id is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica e contato são obrigatórios.';
  end if;
  -- Sem o numero que recebeu a mensagem nao ha como saber de qual clique se
  -- trata.
  if p_whatsapp_account_id is null then
    return 'nenhum';
  end if;

  -- FOR NO KEY UPDATE: nao bloqueia quem so referencia o contato (mensagem).
  perform 1
    from public.contact c
   where c.id = p_contact_id and c.clinic_id = p_clinic_id
     for no key update;
  if not found then
    return 'nenhum';
  end if;

  -- Os cliques de link pendentes na janela, no numero que recebeu a
  -- mensagem; no modo reclamar, so os do link da origem. Dois bastam para
  -- saber que nao e um so.
  select array_agg(k.id) into v_ids
    from (
      select k.id
        from public.clique_do_site k
       where k.clinic_id = p_clinic_id
         and k.via = 'link'
         and k.contact_id is null
         and k.campaign_link_id is not null
         and k.whatsapp_account_id = p_whatsapp_account_id
         and k.valido_ate > now()
         and k.criado_em > now() - c_janela
         and (p_campaign_link_id is null or k.campaign_link_id = p_campaign_link_id)
       limit 2
    ) k;
  if v_ids is null then
    return 'nenhum';
  end if;
  if array_length(v_ids, 1) > 1 then
    return 'varios';
  end if;

  select k.* into v_clique
    from public.clique_do_site k
   where k.id = v_ids[1] and k.contact_id is null
     for update skip locked;
  if not found then
    return 'nenhum';
  end if;

  if p_campaign_link_id is not null then
    -- RECLAMAR: a origem ja esta no contato (mensagem pronta ou
    -- palavra-chave). O clique traz os detalhes.
    update public.clique_do_site
       set contact_id = p_contact_id,
           casado_em = now()
     where id = v_clique.id;
    if v_clique.meta_ad_id is not null then
      update public.contact c
         set source_ad_id = v_clique.meta_ad_id
       where c.id = p_contact_id
         and c.clinic_id = p_clinic_id
         and c.ctwa_clid is null
         and c.source_ad_id is null
         and c.source_adset_id is null
         and c.source_campaign_id is null;
      get diagnostics v_n = row_count;
      if v_n = 1 then
        begin
          perform public.enfileirar_resolucao_de_anuncios_meta(p_clinic_id, 'ingestao');
        exception when others then
          null;
        end;
      end if;
    end if;
    return 'vinculado';
  end if;

  -- JANELA: a origem cadastrada do link, so em contato sem origem e sem
  -- sinal de anuncio da Meta (a mesma guarda de casar_clique_do_site). Se o
  -- contato ja tem origem, o clique nao e gasto.
  select l.channel, l.origin, l.medium, l.campaign
    into v_canal, v_origem, v_meio, v_campanha
    from public.campaign_link l
   where l.id = v_clique.campaign_link_id
     and l.active;
  if v_canal is null then
    return 'nenhum';
  end if;
  update public.contact c
     set source_channel = v_canal,
         source_origin = v_origem,
         source_medium = v_meio,
         source_campaign = v_campanha,
         source_method = 'link_provavel',
         source_captured_at = now()
   where c.id = p_contact_id
     and c.clinic_id = p_clinic_id
     and c.source_channel is null
     and c.source_method is null
     and c.source_campaign is null
     and c.ctwa_clid is null
     and c.source_ad_id is null
     and c.source_adset_id is null
     and c.source_campaign_id is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return 'nenhum';
  end if;
  update public.clique_do_site
     set contact_id = p_contact_id,
         casado_em = now(),
         provavel = true
   where id = v_clique.id;
  return 'origem_gravada';
end;
$$;

revoke all on function public.casar_clique_sem_codigo(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.casar_clique_sem_codigo(uuid, uuid, uuid, uuid)
  to service_role;

comment on function public.casar_clique_sem_codigo(uuid, uuid, uuid, uuid) is
  'Liga o contato a um clique de link sem o codigo na mensagem, quando existe exatamente um clique pendente no numero que recebeu a mensagem nos ultimos 10 minutos. Com p_campaign_link_id: reclama o clique do link dessa origem (a origem ja foi gravada pela ingestao) e leva o numero do anuncio da Meta ao contato; devolve vinculado. Sem ele: grava a origem cadastrada com o metodo link_provavel, so em contato sem origem, e marca o clique provavel; devolve origem_gravada. varios: dois ou mais cliques na janela. nenhum: nada a casar. 22023 sem clinica ou contato. So service_role.';

-- ---------------------------------------------------------------------------
-- 5) resumo_dos_links_rastreados: os provaveis a parte
-- ---------------------------------------------------------------------------
-- O tipo de retorno muda (coluna nova), entao a antiga sai antes.

drop function public.resumo_dos_links_rastreados(uuid, integer);

create function public.resumo_dos_links_rastreados(
  p_clinic_id uuid,
  p_dias integer default 30
) returns table (campaign_link_id uuid, cliques bigint, leads bigint, provaveis bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dias constant integer := least(greatest(coalesce(p_dias, 30), 1), 365);
  v_fuso text;
  v_desde date;
begin
  if p_clinic_id is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica obrigatória.';
  end if;
  -- Quem le as origens (membro ativo da clinica) le o resumo delas.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'Somente a equipe da clínica vê os cliques dos links.';
    end if;
  elsif p_clinic_id not in (select public.user_active_clinic_ids()) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Somente a equipe da clínica vê os cliques dos links.';
  end if;

  select coalesce(c.timezone, 'America/Fortaleza') into v_fuso
    from public.clinic c
   where c.id = p_clinic_id;
  v_desde := (now() at time zone coalesce(v_fuso, 'America/Fortaleza'))::date - (v_dias - 1);

  return query
    select l.id,
           coalesce((
             select sum(d.cliques)
               from public.clique_do_link_dia d
              where d.campaign_link_id = l.id
                and d.dia >= v_desde
           ), 0)::bigint,
           (
             select count(*)
               from public.clique_do_site k
              where k.campaign_link_id = l.id
                and k.contact_id is not null
                and not k.provavel
                and k.casado_em >= (v_desde::timestamp at time zone coalesce(v_fuso, 'America/Fortaleza'))
           )::bigint,
           (
             select count(*)
               from public.clique_do_site k
              where k.campaign_link_id = l.id
                and k.contact_id is not null
                and k.provavel
                and k.casado_em >= (v_desde::timestamp at time zone coalesce(v_fuso, 'America/Fortaleza'))
           )::bigint
      from public.campaign_link l
     where l.clinic_id = p_clinic_id;
end;
$$;

revoke all on function public.resumo_dos_links_rastreados(uuid, integer)
  from public, anon;
grant execute on function public.resumo_dos_links_rastreados(uuid, integer)
  to authenticated, service_role;

comment on function public.resumo_dos_links_rastreados(uuid, integer) is
  'Cliques (clique_do_link_dia), leads (cliques casados por codigo ou mensagem) e provaveis (casados so pela janela de 10 minutos) de cada origem da clinica nos ultimos p_dias dias (1 a 365, padrao 30), no fuso da clinica. Membro ativo da clinica ou service_role; 42501 fora disso.';

notify pgrst, 'reload schema';
