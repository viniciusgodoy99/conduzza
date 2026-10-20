-- ---------------------------------------------------------------------------
-- Detalhes do anuncio do WhatsApp (20/10/2026)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 20/10/2026 ("pode fazer, mas revise para realmente
-- funcionar"): guardar e mostrar, para todas as clinicas, o titulo, a
-- descricao e o link do anuncio de clique para WhatsApp, como no cartao
-- "Detalhes do anuncio" que a uazapi mostra. Ate aqui o parser
-- (lib/integrations/whatsapp/inbound.ts) lia o clique, o id do anuncio, a
-- plataforma, o tipo e o endereco, e jogava fora o titulo e a descricao.
-- Campanha e conjunto continuam vindo so da Meta (meta_anuncio): nao vem na
-- mensagem em canal nenhum.
--
-- 1. Tabela NOVA public.anuncio_do_whatsapp, uma linha POR ANUNCIO da
--    clinica (primary key clinic_id + ad_id), nunca por contato: os leads do
--    mesmo anuncio leem a mesma linha, e o lead antigo de um anuncio ganha
--    os detalhes quando a proxima mensagem desse anuncio chegar. Nenhum
--    ALTER em contact, message ou conversation.
--    - ad_id: ^[0-9]{1,32}$, o formato de meta_anuncio e o unico id que as
--      telas aceitam (idDeAnuncioValido). contact.source_ad_id nao tem CHECK
--      no banco; a ingestao so registra o id nesse formato.
--    - titulo (1 a 300 caracteres, uma linha: nem a quebra LF nem os
--      separadores de linha U+2028 e U+2029), descricao (1 a 2000, aceita a
--      quebra de linha LF) e link (https, ate 2000, sem espaco): sem espaco
--      nas pontas, sem caractere de controle (C0, DEL e C1) e sem marca de
--      direcao de texto. Quem saneia e o codigo
--      (lib/domain/anuncio-do-whatsapp.ts: corte sem partir caractere, NEL
--      vira quebra e VT e FF viram espaco na descricao, link so num
--      endereco onde o anuncio vive); o CHECK e a garantia do banco.
--    - plataforma (Facebook, Instagram ou nulo) e tipo (ad, post ou nulo):
--      os mesmos valores da origem (contact.source_medium e o sourceType).
--      So PREENCHEM o vazio: a plataforma e do clique (o mesmo anuncio
--      aparece no Facebook e no Instagram), e trocar a cada mensagem seria
--      gangorra.
--    - texto_visto_em: o horario da mensagem do texto guardado (o envio no
--      aparelho; sem ele, a chegada). Titulo, descricao e link so sao
--      trocados por mensagem MAIS NOVA que esta: a reentrega atrasada do
--      provedor e o clique de antes da edicao do anuncio nao voltam o
--      texto velho. Campo vazio, qualquer mensagem preenche.
--    - primeiro_visto_em e atualizado_em (a ultima vez que algum campo
--      mostrado mudou; mensagem repetida nao mexe).
--    - Toda linha tem ao menos um de titulo, descricao e link.
--    RLS ligada. Leitura: membro ATIVO da propria clinica, pelo helper das
--    tabelas de cadastro e de meta_anuncio (user_active_clinic_ids).
--    Escrita pela sessao: nenhuma (sem policy de escrita; authenticated so
--    com SELECT, anon sem nada, nem TRUNCATE).
--
-- 2. registrar_anuncio_do_whatsapp(p_clinic_id, p_ad_id, p_titulo,
--    p_descricao, p_link, p_plataforma, p_tipo, p_visto_em) returns text: a
--    UNICA escrita. SECURITY DEFINER, search_path vazio, EXECUTE so da
--    service_role (a ingestao do webhook). INSERT ... ON CONFLICT DO NOTHING
--    por (clinic_id, ad_id) e, com a linha ja existente, a linha travada
--    (FOR UPDATE) e decidida campo a campo:
--    - titulo, descricao e link: o valor que veio (NAO nulo) preenche o
--      campo vazio com qualquer mensagem; troca o guardado so quando a
--      mensagem e mais nova que texto_visto_em (o anunciante pode editar o
--      texto, e vale o da mensagem mais nova); nulo nunca apaga;
--    - plataforma e tipo: so preenchem o vazio;
--    - texto_visto_em: avanca para o horario da mensagem mais nova, mesmo
--      com o texto igual (uma mensagem mais velha que chegar depois nao
--      troca o texto).
--    p_visto_em e o horario da mensagem (a ingestao manda o envio no
--    aparelho ou a chegada); nulo vale now(), e o futuro vale now() (um
--    horario forjado la na frente travaria o texto). Texto vazio vale como
--    nulo. Devolve 'inserido', 'atualizado' (algum campo mostrado mudou),
--    'sem_mudanca' (nenhum campo mostrado mudou, nem o atualizado_em; o
--    texto_visto_em pode ter avancado) ou 'sem_detalhes' (titulo, descricao
--    e link nulos: nada grava). Clinica ou anuncio nulos: 22023. Valor fora
--    do CHECK: 23514; clinica inexistente: 23503.
--
-- 3. anuncios_do_periodo(p_clinic_id, p_de, p_ate) returns jsonb: a dimensao
--    "Anuncio" do Detalhe da origem em Resultados. SECURITY INVOKER (a RLS
--    de contact, appointment, anuncio_do_whatsapp e meta_anuncio recorta),
--    nula para o profissional (como funil_do_periodo), EXECUTE para
--    authenticated e service_role. Leads pela chegada (first_contact_at em
--    [p_de, p_ate)), o criterio do funil e de campanhas_do_periodo:
--      { leads, linhas: [{ad_id, titulo, nome_na_meta, leads, agendaram,
--        compareceram}], nao_identificado: {leads, agendaram, compareceram},
--        sem_anuncio: {leads, agendaram, compareceram} }
--    Uma linha por source_ad_id no formato do id, aparado pela regra do
--    JavaScript (o btrim com a lista de String.prototype.trim: espaco
--    Unicode, tabulacao, quebras, NBSP e BOM; a mesma de apararIdDoAnuncio,
--    que a ingestao usa no contato e nos detalhes), com o titulo guardado
--    aqui e o nome do anuncio na Meta (ad_name).
--    nao_identificado: lead de anuncio (clique, id de anuncio, de conjunto
--    ou de campanha, ou metodo anuncio_ctwa) sem id de anuncio valido.
--    sem_anuncio: o resto (a tela chama de "Sem anuncio da Meta": o lead do
--    clique no site, anuncio do Google, cai aqui). Invariante: soma das
--    linhas + nao_identificado + sem_anuncio = leads = leads do
--    funil_do_periodo. agendaram = tem alguma consulta; compareceram = tem
--    consulta com compareceu (as regras do funil). Ordem: mais leads,
--    depois o id.
--
-- Nenhuma funcao existente muda (sem corpos anteriores a guardar). Nada aqui
-- grava dado de paciente: o texto e o do anuncio da clinica, e nunca vai
-- para log.
--
-- LOCKS: o CREATE TABLE com a FK pega SHARE ROW EXCLUSIVE em clinic por
-- instantes (tabela que quase nao recebe escrita). Nenhum ALTER de tabela
-- existente; as funcoes sao novas. Horario calmo, como sempre.
--
-- ORDEM: ensaio (~/.claude/plans/e3-whatsapp/ensaios/
-- ensaio-anuncio-20261020100000.sql), esta migration, regenerar os tipos e
-- so DEPOIS o codigo. O codigo novo sem a migration: a gravacao falha so com
-- log (anuncio_detalhes_falhou, codigo PGRST202) e a ingestao segue; o bloco
-- "Detalhes do anuncio" mostra o erro de leitura e a dimensao Anuncio, o
-- erro com "Tentar de novo". A migration com o codigo de hoje: nada muda
-- (ninguem grava nem le a tabela nova).
--
-- ROLLBACK manual: primeiro voltar o codigo; depois
--   drop function public.anuncios_do_periodo(uuid, timestamptz, timestamptz);
--   drop function public.registrar_anuncio_do_whatsapp(uuid, text, text, text, text, text, text, timestamptz);
--   drop table public.anuncio_do_whatsapp;
-- Os detalhes guardados se perdem (voltam na proxima mensagem de cada
-- anuncio, depois de reaplicar).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. anuncio_do_whatsapp
-- ===========================================================================

create table public.anuncio_do_whatsapp (
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  ad_id text not null
    constraint anuncio_do_whatsapp_ad_id_valido
      check (ad_id ~ '^[0-9]{1,32}$'),
  titulo text
    constraint anuncio_do_whatsapp_titulo_valido check (
      titulo is null or (
        char_length(titulo) between 1 and 300
        and titulo = btrim(titulo)
        -- uma linha: nenhum controle (nem a quebra), nenhum separador de
        -- linha ou de paragrafo (U+2028, U+2029) nem marca de direcao
        and titulo !~ '[\x01-\x1f\x7f-\x9f\x61c\x200e\x200f\x2028\x2029\x202a-\x202e\x2066-\x2069]'
      )
    ),
  descricao text
    constraint anuncio_do_whatsapp_descricao_valida check (
      descricao is null or (
        char_length(descricao) between 1 and 2000
        and descricao = btrim(descricao, E' \n')
        -- a quebra de linha (LF, 0x0a) fica; os outros controles nao
        and descricao !~ '[\x01-\x09\x0b-\x1f\x7f-\x9f\x61c\x200e\x200f\x202a-\x202e\x2066-\x2069]'
      )
    ),
  link text
    constraint anuncio_do_whatsapp_link_valido check (
      link is null or (
        char_length(link) <= 2000
        and link ~ '^https://[^[:space:]]+$'
        and link !~ '[\x01-\x1f\x7f-\x9f]'
      )
    ),
  plataforma text
    constraint anuncio_do_whatsapp_plataforma_valida
      check (plataforma is null or plataforma in ('Facebook', 'Instagram')),
  tipo text
    constraint anuncio_do_whatsapp_tipo_valido
      check (tipo is null or tipo in ('ad', 'post')),
  texto_visto_em timestamptz not null default now(),
  primeiro_visto_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (clinic_id, ad_id),
  constraint anuncio_do_whatsapp_com_detalhe
    check (titulo is not null or descricao is not null or link is not null)
);

alter table public.anuncio_do_whatsapp enable row level security;

create policy "membro ativo le os anuncios do whatsapp" on public.anuncio_do_whatsapp
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

-- Os privilegios padrao do esquema dao tudo a anon e authenticated: anon
-- fica sem nada (TRUNCATE ignora a RLS) e authenticated so le, pela policy.
revoke all on table public.anuncio_do_whatsapp from anon, authenticated;
grant select on table public.anuncio_do_whatsapp to authenticated;

comment on table public.anuncio_do_whatsapp is
  'Detalhes do anuncio de clique para WhatsApp (titulo, descricao e link) como vieram na mensagem, um por anuncio da clinica. Todo membro ativo le; so o sistema escreve, pela registrar_anuncio_do_whatsapp (ingestao). Vale o texto da mensagem mais nova (texto_visto_em); campo vazio qualquer mensagem preenche; valor nulo nunca apaga o guardado.';
comment on column public.anuncio_do_whatsapp.ad_id is
  'Id do anuncio na Meta (o source_id do referral), o mesmo de contact.source_ad_id e de meta_anuncio.';
comment on column public.anuncio_do_whatsapp.titulo is
  'Titulo do anuncio (title ou headline do referral), saneado: uma linha, ate 300 caracteres.';
comment on column public.anuncio_do_whatsapp.descricao is
  'Descricao do anuncio (body do referral), saneada: com as quebras de linha, ate 2000 caracteres.';
comment on column public.anuncio_do_whatsapp.link is
  'Link do anuncio (source_url do referral): so https; o codigo so grava e so mostra endereco onde o anuncio vive (fb.me, fb.watch, facebook.com e instagram.com, host exato, sem redirecionador).';
comment on column public.anuncio_do_whatsapp.plataforma is
  'Onde o anuncio apareceu na primeira mensagem que informou (Facebook ou Instagram), como contact.source_medium. So preenche o vazio: a plataforma e do clique.';
comment on column public.anuncio_do_whatsapp.tipo is
  'sourceType do referral (ad ou post), quando o canal informa. So preenche o vazio.';
comment on column public.anuncio_do_whatsapp.texto_visto_em is
  'Horario da mensagem do texto guardado (o envio no aparelho; sem ele, a chegada; nunca no futuro). Titulo, descricao e link so sao trocados por mensagem mais nova.';
comment on column public.anuncio_do_whatsapp.atualizado_em is
  'A ultima vez que algum campo mostrado mudou (mensagem repetida nao mexe).';

-- ===========================================================================
-- 2. registrar_anuncio_do_whatsapp (a unica escrita)
-- ===========================================================================

create or replace function public.registrar_anuncio_do_whatsapp(
  p_clinic_id uuid,
  p_ad_id text,
  p_titulo text default null,
  p_descricao text default null,
  p_link text default null,
  p_plataforma text default null,
  p_tipo text default null,
  p_visto_em timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Texto vazio vale como nulo: nunca apaga o que esta guardado.
  v_titulo constant text := nullif(p_titulo, '');
  v_descricao constant text := nullif(p_descricao, '');
  v_link constant text := nullif(p_link, '');
  v_plataforma constant text := nullif(p_plataforma, '');
  v_tipo constant text := nullif(p_tipo, '');
  -- O horario da mensagem (o envio no aparelho; sem ele, a chegada). Nunca
  -- no futuro: um horario forjado la na frente travaria o texto guardado.
  v_visto_em constant timestamptz := least(coalesce(p_visto_em, now()), now());
  v_atual record;
  v_mais_nova boolean;
  v_novo_titulo text;
  v_nova_descricao text;
  v_novo_link text;
  v_nova_plataforma text;
  v_novo_tipo text;
begin
  if p_clinic_id is null or p_ad_id is null then
    raise exception using errcode = '22023',
      message = 'clinica_e_anuncio_obrigatorios';
  end if;
  if v_titulo is null and v_descricao is null and v_link is null then
    return 'sem_detalhes';
  end if;

  -- Anuncio novo. Com a linha ja existente, o ON CONFLICT nao insere nada
  -- (e a gravacao concorrente do mesmo anuncio espera a outra terminar).
  insert into public.anuncio_do_whatsapp (
    clinic_id, ad_id, titulo, descricao, link, plataforma, tipo, texto_visto_em
  ) values (
    p_clinic_id, p_ad_id, v_titulo, v_descricao, v_link, v_plataforma, v_tipo, v_visto_em
  )
  on conflict (clinic_id, ad_id) do nothing;
  if found then
    return 'inserido';
  end if;

  -- Ja existia: trava a linha (a gravacao concorrente do mesmo anuncio
  -- espera e decide depois, com o que esta gravacao deixou) e decide campo
  -- a campo.
  select a.titulo, a.descricao, a.link, a.plataforma, a.tipo, a.texto_visto_em
    into v_atual
    from public.anuncio_do_whatsapp a
   where a.clinic_id = p_clinic_id
     and a.ad_id = p_ad_id
     for update;
  if not found then
    -- A linha sumiu entre o insert e a trava (a clinica foi apagada).
    return 'sem_mudanca';
  end if;

  v_mais_nova := v_visto_em > v_atual.texto_visto_em;
  -- Titulo, descricao e link: o vazio qualquer mensagem preenche; o
  -- guardado so a mensagem mais nova troca; nulo nunca apaga.
  v_novo_titulo := case
    when v_titulo is not null and (v_atual.titulo is null or v_mais_nova)
      then v_titulo
    else v_atual.titulo
  end;
  v_nova_descricao := case
    when v_descricao is not null and (v_atual.descricao is null or v_mais_nova)
      then v_descricao
    else v_atual.descricao
  end;
  v_novo_link := case
    when v_link is not null and (v_atual.link is null or v_mais_nova)
      then v_link
    else v_atual.link
  end;
  -- Plataforma e tipo: so preenchem o vazio (a plataforma e do clique).
  v_nova_plataforma := coalesce(v_atual.plataforma, v_plataforma);
  v_novo_tipo := coalesce(v_atual.tipo, v_tipo);

  if v_novo_titulo is distinct from v_atual.titulo
     or v_nova_descricao is distinct from v_atual.descricao
     or v_novo_link is distinct from v_atual.link
     or v_nova_plataforma is distinct from v_atual.plataforma
     or v_novo_tipo is distinct from v_atual.tipo
  then
    update public.anuncio_do_whatsapp a
       set titulo = v_novo_titulo,
           descricao = v_nova_descricao,
           link = v_novo_link,
           plataforma = v_nova_plataforma,
           tipo = v_novo_tipo,
           texto_visto_em = greatest(v_atual.texto_visto_em, v_visto_em),
           atualizado_em = now()
     where a.clinic_id = p_clinic_id
       and a.ad_id = p_ad_id;
    return 'atualizado';
  end if;

  -- Nada mostrado mudou. O mesmo texto numa mensagem mais nova so avanca o
  -- horario do texto (uma mensagem mais velha que chegar depois nao o
  -- troca); a reentrega da mesma mensagem nao escreve nada.
  if v_mais_nova then
    update public.anuncio_do_whatsapp a
       set texto_visto_em = v_visto_em
     where a.clinic_id = p_clinic_id
       and a.ad_id = p_ad_id;
  end if;
  return 'sem_mudanca';
end;
$$;

revoke all on function public.registrar_anuncio_do_whatsapp(uuid, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.registrar_anuncio_do_whatsapp(uuid, text, text, text, text, text, text, timestamptz)
  to service_role;

comment on function public.registrar_anuncio_do_whatsapp(uuid, text, text, text, text, text, text, timestamptz) is
  'Guarda os detalhes do anuncio de clique para WhatsApp (so o sistema, pela ingestao). Upsert por clinica e anuncio: titulo, descricao e link vazios qualquer mensagem preenche e so a mensagem mais nova (p_visto_em, nunca no futuro) troca; plataforma e tipo so preenchem o vazio; nulo nunca apaga. Devolve inserido, atualizado, sem_mudanca ou sem_detalhes.';

-- ===========================================================================
-- 3. anuncios_do_periodo (dimensao Anuncio de Resultados)
-- ===========================================================================

create or replace function public.anuncios_do_periodo(
  p_clinic_id uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with leads as (
        select c.id,
               case
                 when aparado.id ~ '^[0-9]{1,32}$' then aparado.id
               end as ad_id,
               (c.ctwa_clid is not null
                or c.source_ad_id is not null
                or c.source_adset_id is not null
                or c.source_campaign_id is not null
                or c.source_method is not distinct from 'anuncio_ctwa') as de_anuncio,
               exists (
                 select 1 from public.appointment a
                  where a.clinic_id = p_clinic_id and a.contact_id = c.id
               ) as agendou,
               exists (
                 select 1 from public.appointment a
                  where a.clinic_id = p_clinic_id and a.contact_id = c.id
                    and a.status = 'compareceu'
               ) as compareceu
          from public.contact c
          -- O id aparado pela regra do JavaScript (String.prototype.trim): a
          -- mesma lista de apararIdDoAnuncio, que a ingestao usa no contato e
          -- nos detalhes. O btrim sem lista so tiraria o espaco ASCII.
          cross join lateral (
            select btrim(c.source_ad_id, E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff') as id
          ) aparado
         where c.clinic_id = p_clinic_id
           and c.first_contact_at >= p_de and c.first_contact_at < p_ate
      ),
      por_anuncio as (
        select l.ad_id,
               count(*) as leads,
               count(*) filter (where l.agendou) as agendaram,
               count(*) filter (where l.compareceu) as compareceram
          from leads l
         where l.ad_id is not null
         group by l.ad_id
      )
      select jsonb_build_object(
        'leads', (select count(*) from leads),
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'ad_id', p.ad_id,
                   'titulo', w.titulo,
                   'nome_na_meta', m.ad_name,
                   'leads', p.leads,
                   'agendaram', p.agendaram,
                   'compareceram', p.compareceram
                 ) order by p.leads desc, p.ad_id)
            from por_anuncio p
            left join public.anuncio_do_whatsapp w
              on w.clinic_id = p_clinic_id and w.ad_id = p.ad_id
            left join public.meta_anuncio m
              on m.clinic_id = p_clinic_id and m.ad_id = p.ad_id
        ), '[]'::jsonb),
        'nao_identificado', (
          select jsonb_build_object(
                   'leads', count(*),
                   'agendaram', count(*) filter (where l.agendou),
                   'compareceram', count(*) filter (where l.compareceu))
            from leads l
           where l.ad_id is null and l.de_anuncio
        ),
        'sem_anuncio', (
          select jsonb_build_object(
                   'leads', count(*),
                   'agendaram', count(*) filter (where l.agendou),
                   'compareceram', count(*) filter (where l.compareceu))
            from leads l
           where l.ad_id is null and not l.de_anuncio
        )
      )
    )
  end
$$;

revoke all on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz) is
  'Leads do periodo (pela chegada) por anuncio (o id aparado como no JavaScript), com o titulo guardado e o nome na Meta, mais os de anuncio sem id e os sem anuncio da Meta. SECURITY INVOKER; nulo para o profissional.';
