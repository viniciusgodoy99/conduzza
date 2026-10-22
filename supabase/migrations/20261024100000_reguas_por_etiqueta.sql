-- ---------------------------------------------------------------------------
-- Reguas de follow-up por etiqueta (onda 4, migration A de duas)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 20/10/2026 (reuniao com o Victor, item 16 do plano): mais
-- de uma regua de follow-up na mesma etapa, cada uma para os leads com certas
-- etiquetas. Contrato entre as frentes em ~/.claude/plans/onda4-automacoes/
-- (levantamento.md e contrato.md, secao 2). Decisoes do dono de 20 e
-- 21/10/2026 (as recomendacoes do contrato):
--   D1 a etiqueta conta se estiver no lead (contact.tags, texto livre) OU em
--      qualquer conversa dele (conversation.tags, chaves do catalogo, pelo
--      NOME da etiqueta no catalogo), sem diferenca de maiuscula e acento;
--   D2 o lead que casa com duas reguas na mesma etapa recebe a de cima: as
--      com etiqueta antes da geral; entre elas, a ordem da clinica
--      (prioridade), depois created_at e id;
--   D3 a etiqueta mudou no meio da sequencia: troca no proximo toque, com a
--      trava de 30 minutos contra toque repetido;
--   D4 regua com etiqueta desligada nao conta (os leads dela caem na geral);
--   D6 "qualquer uma" (OU) ou "todas" (E), uma escolha por regua.
-- Precedente que o desenho copia: a regua vinculada (regua_da_consulta,
-- 20260929110000): uma regua vale por vez, a mais especifica vence,
-- desligada nao conta, a vigente e reconferida antes de cada toque (no
-- executor, lib/jobs/regua.ts, pelo codigo da onda) e passo ja vencido so
-- nasce sem toque recente.
--
-- 1. FUNCOES DE ETIQUETA (a migration B, 20261024110000, usa as mesmas):
--    chave_de_etiqueta (o corpo de chave_de_especialidade, com nome proprio
--    para nao acoplar especialidade e etiqueta; em pt-BR o mesmo resultado de
--    chaveDaEtiqueta, lib/domain/etiquetas-do-lead.ts), chaves_de_etiquetas
--    (as chaves distintas, ordenadas byte a byte, sem a vazia),
--    etiquetas_validas (ate 10; cada uma de 1 a 40 caracteres, sem espaco nas
--    pontas, com chave, sem repetir chave), etiquetas_casam (filtro sem
--    etiqueta casa sempre; qualquer = alguma em comum; todas = todas) e
--    chaves_de_etiqueta_do_contato (as do lead e as das conversas dele, pelo
--    nome no catalogo; SECURITY INVOKER: a RLS recorta).
-- 2. CADENCE (tabela fria): etiquetas (os NOMES; vazio e a regua geral),
--    etiquetas_modo (qualquer ou todas) e prioridade (0 a 1000, a ordem da
--    clinica entre as com etiqueta da etapa), com os checks. Com 0 ou 1
--    etiqueta o modo e sempre qualquer (com uma so, qualquer e todas sao o
--    mesmo filtro; revisao de 21/10/2026). O indice unico
--    de uma regua de follow-up por etapa vira dois: um para a regua GERAL
--    (sem etiqueta: o invariante de hoje, que vale igual para as reguas que
--    existem) e um para o mesmo filtro (etapa, modo e as mesmas chaves).
--    NENHUMA linha muda: as reguas de follow-up de hoje (3 reais, todas
--    desligadas em 21/10/2026, e as das clinicas de teste) ficam com
--    etiquetas vazias, a geral da etapa delas.
-- 3. PRECEDENCIA: regua_de_followup_do_contato(contato) devolve a regua de
--    follow-up LIGADA da etapa do contato que vale para as etiquetas dele
--    (D1, D2, D4), ou nulo. SECURITY INVOKER, como regua_da_consulta: a
--    sessao so ve a propria clinica (a B recebe nulo); o motor e o executor
--    das reguas (service role) veem tudo.
-- 4. PLANEJAMENTO: followups_devidos(clinica) e o recorte do follow-up de
--    planejar_reguas reescrito em dois passos: as candidatas (contato numa
--    etapa da jornada, fora o importado parado, sem resposta desde a entrada
--    e com ALGUMA regua ligada da etapa tendo passo na janela: condicao
--    necessaria, materializada, para nao chamar a precedencia a toa) e, por
--    candidata, os passos na janela da regua que vale para ela, com a trava
--    de toque repetido (D3): passo ja vencido so nasce se o contato nao
--    recebeu, nos ultimos 30 minutos, toque de OUTRA regua de follow-up da
--    mesma etapa e da mesma entrada (pelo indice cadence_run (clinic_id,
--    contact_id, sent_at desc)). O parametro serve ao ensaio e aos testes;
--    o motor chama com nulo. planejar_reguas troca SO o CTE devidas do
--    follow-up por essa funcao (corpo de producao; o trecho entre "--
--    [reguas por etiqueta] inicio" e "... fim"): confirmacao e pos falta
--    ficam byte a byte iguais, e motor_manutencao nao muda.
--    PARIDADE (provada no ensaio): com uma regua sem etiqueta por etapa (todo
--    o estado de hoje), a precedencia devolve a unica regua ligada da etapa
--    e a trava nunca dispara (nao existe OUTRA regua da etapa): o conjunto
--    (passo, contato, horario) e o mesmo do CTE de antes.
-- 5. LEITURAS DA TELA (so contagens): alcance_das_reguas_de_followup(clinica)
--    (por regua: casam, recebem, sem_autorizacao, entradas_30d; por etapa com
--    regua ligada: sem_regua) e ordenar_reguas_de_followup(clinica, etapa,
--    ids) (grava a prioridade na ordem da lista; so a gestao), as duas
--    SECURITY INVOKER: a RLS de cadence e de contact decide.
--
-- Etapa Aguardando resposta (onda 3, D3 = A): o gatilho
-- recusar_followup_em_aguardando recusa regua de follow-up nela, com ou sem
-- etiqueta (a regua por etiqueta e uma linha de cadence de kind followup como
-- outra qualquer): nada a fazer aqui. E nenhum lead esta numa regua dela.
--
-- Uma funcao de producao muda, a partir do corpo de PRODUCAO lido em
-- 21/10/2026 (fndef.js, so leitura; as ondas 2 e 3 nao a trocam) e guardado
-- em supabase/operacao/rollback/20261024100000-corpos-anteriores.sql com o
-- md5 do prosrc (o ensaio confere que o banco ainda esta assim):
-- planejar_reguas (a6b44fa9224ec006028db85d12c0b3ed). O resto e o corpo de
-- producao linha a linha (o ensaio confere fora do marcador). Security,
-- search_path e grants ficam como eram (CREATE OR REPLACE mantem os grants).
--
-- Erros de regra: 23505 nos dois indices (segunda regua geral na etapa;
-- mesmo filtro na mesma etapa), 23514 nos checks, 42501 e 22023 em
-- ordenar_reguas_de_followup (quem nao gerencia a clinica; a lista que nao e
-- a das reguas com etiqueta da etapa). Nunca 40001/40P01 (o PostgREST repete
-- sem limite). Nada aqui grava nome, telefone, etiqueta ou conteudo de
-- mensagem de paciente em log.
--
-- LOCKS: lock_timeout de 3 s. O ALTER de cadence segura ACCESS EXCLUSIVE em
-- cadence (fria: 98 linhas em 21/10/2026) ate o commit; o planejar_reguas do
-- cron e o executor das reguas esperam fracoes de segundo. Nenhum ALTER em
-- message, conversation, contact, clinic_member, job_queue nem clinic,
-- nenhuma FK nova e nenhuma linha de nenhuma tabela muda. Aplicar em horario
-- calmo.
--
-- ORDEM DE PUBLICACAO (decidida pelo coordenador em 22/10/2026, no lugar
-- da secao 8 do contrato): depois das ondas 2 e 3; esta migration e a B
-- (20261024110000), cada uma com ensaio e o ok do dono, ANTES de todo o
-- codigo da onda 4, que sobe de uma vez depois das duas (o codigo depende
-- delas e falha fechado sem elas). O codigo de hoje funciona com esta
-- migration: as colunas novas tem padrao, o indice da geral e o invariante
-- de hoje e ninguem cria regua com etiqueta antes do codigo novo.
--
-- ROLLBACK (manual): supabase/operacao/rollback/20261024100000-corpos-
-- anteriores.sql (depois do rollback da migration B, se ela foi aplicada,
-- com as reguas com etiqueta desligadas ha 30 minutos e com a perda delas
-- aceita: os passos 1 e 3 dele, que ele confere).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) Funcoes de etiqueta
-- ---------------------------------------------------------------------------

-- O corpo de chave_de_especialidade, letra por letra (o ensaio confere o
-- md5): sem acento (as letras do portugues e do espanhol), minuscula, um
-- espaco so entre as palavras, sem espaco nas pontas.
create function public.chave_de_etiqueta(p_texto text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      lower(
        translate(
          p_texto,
          'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ',
          'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy'
        )
      ),
      '\s+', ' ', 'g'
    )
  )
$$;

comment on function public.chave_de_etiqueta(text) is
  'Chave de comparacao de etiqueta (onda 4): sem acento, minuscula, um espaco so entre as palavras, sem espaco nas pontas. O mesmo corpo de chave_de_especialidade; em pt-BR, o mesmo resultado de chaveDaEtiqueta (lib/domain/etiquetas-do-lead.ts).';

-- As chaves distintas, sem a vazia, em ordem de byte (collate "C": a ordem
-- nao depende do idioma do banco). E a forma de comparar dois filtros e a
-- expressao do indice cadence_followup_mesmo_filtro.
create function public.chaves_de_etiquetas(p_etiquetas text[])
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(k.chave order by k.chave collate "C"), '{}'::text[])
    from (
      select distinct public.chave_de_etiqueta(e) as chave
        from unnest(p_etiquetas) as e
    ) k
   where k.chave <> ''
$$;

comment on function public.chaves_de_etiquetas(text[]) is
  'As chaves (chave_de_etiqueta) distintas das etiquetas, sem a vazia, em ordem de byte. Expressao do indice cadence_followup_mesmo_filtro e forma de comparar dois filtros (onda 4).';

-- O filtro que se grava: ate 10 etiquetas; cada uma de 1 a 40 caracteres (o
-- limite do "Etiquetar lead"), sem espaco nas pontas, com chave; sem repetir
-- a mesma etiqueta (pela chave). Lista de uma dimensao so.
create function public.etiquetas_validas(p_etiquetas text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_etiquetas is not null
     and coalesce(array_ndims(p_etiquetas), 1) = 1
     and cardinality(p_etiquetas) <= 10
     and not exists (
       select 1
         from unnest(p_etiquetas) as e
        where e is null
           or char_length(e) not between 1 and 40
           or e ~ '^\s|\s$'
           or public.chave_de_etiqueta(e) = ''
     )
     and (select count(distinct public.chave_de_etiqueta(e))
            from unnest(p_etiquetas) as e) = cardinality(p_etiquetas)
$$;

comment on function public.etiquetas_validas(text[]) is
  'Filtro de etiquetas valido (onda 4): ate 10; cada uma de 1 a 40 caracteres, sem espaco nas pontas, com chave; sem repetir a chave. Check de cadence.etiquetas e de automacao_condicao.etiqueta.';

-- O lead casa com o filtro? p_chaves_do_contato ja sao chaves; o filtro sao
-- nomes. Filtro sem etiqueta (a regua geral) casa sempre; qualquer = alguma
-- em comum; todas = contem todas.
create function public.etiquetas_casam(
  p_chaves_do_contato text[],
  p_etiquetas text[],
  p_modo text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
           when cardinality(f.chaves) = 0 then true
           when p_modo = 'todas'
             then coalesce(p_chaves_do_contato, '{}'::text[]) @> f.chaves
           else coalesce(p_chaves_do_contato, '{}'::text[]) && f.chaves
         end
    from (select public.chaves_de_etiquetas(p_etiquetas) as chaves) f
$$;

comment on function public.etiquetas_casam(text[], text[], text) is
  'O contato (as chaves dele) casa com o filtro (os nomes)? Filtro vazio casa sempre; qualquer: alguma em comum; todas: contem todas (onda 4, D6).';

-- As etiquetas do contato (D1): as do lead (contact.tags, texto livre) e as
-- das conversas dele (conversation.tags sao chaves do catalogo; conta o NOME
-- da etiqueta no catalogo), todas pela chave. SECURITY INVOKER: a sessao so
-- ve o que a RLS deixa; o motor e o executor (service role, ou as funcoes
-- definer) veem tudo. A busca das conversas vai por conversation_contact_idx
-- e a do catalogo pela chave unica (clinic_id, chave).
create function public.chaves_de_etiqueta_do_contato(p_contact_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select public.chaves_de_etiquetas(
           coalesce(
             (select ct.tags from public.contact ct where ct.id = p_contact_id),
             '{}'::text[])
           || coalesce(
             (select array_agg(d.nome)
                from public.contact ct
                join public.conversation v
                  on v.contact_id = ct.id
                 and v.clinic_id = ct.clinic_id
                cross join lateral unnest(v.tags) as t(chave)
                join public.conversation_tag_def d
                  on d.clinic_id = v.clinic_id
                 and d.chave = t.chave
               where ct.id = p_contact_id),
             '{}'::text[])
         )
$$;

comment on function public.chaves_de_etiqueta_do_contato(uuid) is
  'As chaves das etiquetas do contato (onda 4, D1): as do lead (contact.tags) e as das conversas dele, pelo nome no catalogo (conversation_tag_def). SECURITY INVOKER: a RLS recorta.';

revoke all on function public.chave_de_etiqueta(text) from public, anon;
revoke all on function public.chaves_de_etiquetas(text[]) from public, anon;
revoke all on function public.etiquetas_validas(text[]) from public, anon;
revoke all on function public.etiquetas_casam(text[], text[], text) from public, anon;
revoke all on function public.chaves_de_etiqueta_do_contato(uuid) from public, anon;
grant execute on function public.chave_de_etiqueta(text) to authenticated, service_role;
grant execute on function public.chaves_de_etiquetas(text[]) to authenticated, service_role;
grant execute on function public.etiquetas_validas(text[]) to authenticated, service_role;
grant execute on function public.etiquetas_casam(text[], text[], text) to authenticated, service_role;
grant execute on function public.chaves_de_etiqueta_do_contato(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) cadence: o filtro por etiqueta e a ordem (ADD COLUMN com padrao
-- constante: so catalogo; os checks conferem as 98 linhas)
-- ---------------------------------------------------------------------------

alter table public.cadence
  add column etiquetas text[] not null default '{}'::text[],
  add column etiquetas_modo text not null default 'qualquer',
  add column prioridade integer not null default 0,
  add constraint cadence_etiquetas_so_no_followup
    check (kind = 'followup' or cardinality(etiquetas) = 0),
  add constraint cadence_etiquetas_validas
    check (public.etiquetas_validas(etiquetas)),
  add constraint cadence_etiquetas_modo
    check (etiquetas_modo in ('qualquer', 'todas')),
  -- Com 0 ou 1 etiqueta, qualquer e todas sao o mesmo filtro: o modo
  -- guardado e sempre qualquer, a forma unica do filtro. Sem isto, a mesma
  -- etiqueta em todas e em qualquer passaria pelo indice
  -- cadence_followup_mesmo_filtro como dois filtros, e a regua de baixo
  -- nunca valeria para ninguem (revisao de 21/10/2026).
  add constraint cadence_modo_so_com_varias_etiquetas
    check (cardinality(etiquetas) >= 2 or etiquetas_modo = 'qualquer'),
  add constraint cadence_prioridade_na_faixa
    check (prioridade between 0 and 1000);

comment on column public.cadence.etiquetas is
  'So no follow-up (onda 4): os NOMES das etiquetas do filtro (o filtro casa pela chave, chave_de_etiqueta). Vazio: a regua geral da etapa.';
comment on column public.cadence.etiquetas_modo is
  'Como o filtro junta as etiquetas: qualquer (alguma delas) ou todas. Com 0 ou 1 etiqueta, sempre qualquer (check cadence_modo_so_com_varias_etiquetas).';
comment on column public.cadence.prioridade is
  'A ordem da clinica entre as reguas com etiqueta da mesma etapa (menor vem antes; D2). Gravada por ordenar_reguas_de_followup.';

-- Uma regua GERAL por etapa (o invariante de hoje) e um filtro por etapa.
-- Na mesma transacao: o indice antigo nunca fica sem substituto.
drop index public.cadence_followup_unico_por_etapa;

create unique index cadence_followup_geral_unico_por_etapa
  on public.cadence (clinic_id, trigger_stage)
  where kind = 'followup' and cardinality(etiquetas) = 0;

create unique index cadence_followup_mesmo_filtro
  on public.cadence (clinic_id, trigger_stage, etiquetas_modo, public.chaves_de_etiquetas(etiquetas))
  where kind = 'followup' and cardinality(etiquetas) > 0;

-- ---------------------------------------------------------------------------
-- 3) Precedencia: a regua de follow-up que vale para o contato
-- ---------------------------------------------------------------------------

-- As chaves do contato sao calculadas uma vez (o lateral com offset 0 nao e
-- achatado pelo planejador). A ordem e a D2; so regua ligada conta (D4).
create function public.regua_de_followup_do_contato(p_contact_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id
    from public.contact ct
    cross join lateral (
      select public.chaves_de_etiqueta_do_contato(ct.id) as chaves
      offset 0
    ) k
    join public.cadence c
      on c.clinic_id = ct.clinic_id
     and c.kind = 'followup'
     and c.active
     and c.trigger_stage = ct.funnel_stage
   where ct.id = p_contact_id
     and public.etiquetas_casam(k.chaves, c.etiquetas, c.etiquetas_modo)
   order by (cardinality(c.etiquetas) > 0) desc,
            c.prioridade,
            c.created_at,
            c.id
   limit 1
$$;

comment on function public.regua_de_followup_do_contato(uuid) is
  'A regua de follow-up LIGADA da etapa do contato que vale para as etiquetas dele (onda 4): as com etiqueta antes da geral, depois prioridade, created_at e id (D2); desligada nao conta (D4). Nulo se nenhuma. SECURITY INVOKER: a sessao so ve a propria clinica.';

revoke all on function public.regua_de_followup_do_contato(uuid) from public, anon;
grant execute on function public.regua_de_followup_do_contato(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Planejamento
-- ---------------------------------------------------------------------------

-- O recorte do follow-up de planejar_reguas, com a precedencia e a trava de
-- toque repetido. As condicoes de cada candidata sao as do CTE de antes
-- (etapa da jornada, importado parado fora, sem resposta desde a entrada); a
-- janela e a mesma (30 minutos para tras, 60 para a frente).
create function public.followups_devidos(p_clinic_id uuid default null)
returns table (clinic_id uuid, step_id uuid, contact_id uuid, scheduled_for timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with candidatas as materialized (
    select ct.id,
           ct.clinic_id,
           ct.funnel_stage,
           ct.funnel_stage_changed_at
      from public.contact ct
      join public.funnel_stage_def d
        on d.clinic_id = ct.clinic_id
       and d.chave = ct.funnel_stage
     where (p_clinic_id is null or ct.clinic_id = p_clinic_id)
       and not (
         ct.criado_por_importacao
         and ct.funnel_stage_changed_at <= ct.created_at
       )
       and (ct.last_contact_at is null
            or ct.last_contact_at <= ct.funnel_stage_changed_at)
       -- Condicao necessaria: ALGUMA regua ligada da etapa tem passo na
       -- janela (a que vale e uma delas).
       and exists (
         select 1
           from public.cadence c2
           join public.cadence_step s2 on s2.cadence_id = c2.id
          where c2.clinic_id = ct.clinic_id
            and c2.kind = 'followup'
            and c2.active
            and c2.trigger_stage = ct.funnel_stage
            and s2.offset_minutes >= 0
            and ct.funnel_stage_changed_at + make_interval(mins => s2.offset_minutes)
                between now() - interval '30 minutes' and now() + interval '60 minutes'
       )
  )
  select ca.clinic_id,
         s.id,
         ca.id,
         ca.funnel_stage_changed_at + make_interval(mins => s.offset_minutes)
    from candidatas ca
    cross join lateral (
      select public.regua_de_followup_do_contato(ca.id) as id
      offset 0
    ) v
    join public.cadence_step s on s.cadence_id = v.id
   where s.offset_minutes >= 0
     and ca.funnel_stage_changed_at + make_interval(mins => s.offset_minutes)
         between now() - interval '30 minutes' and now() + interval '60 minutes'
     -- Trava de toque repetido (D3): passo JA VENCIDO so nasce se o contato
     -- nao recebeu, nos ultimos 30 minutos, toque de OUTRA regua de
     -- follow-up da mesma etapa e da mesma entrada (a etiqueta mudou e a
     -- regua que vale trocou logo depois de um toque). Passo futuro nasce
     -- como sempre. Com uma regua so na etapa nunca dispara.
     and not (
       ca.funnel_stage_changed_at + make_interval(mins => s.offset_minutes) <= now()
       and exists (
         select 1
           from public.cadence_run r
           join public.cadence_step s3 on s3.id = r.cadence_step_id
           join public.cadence c3 on c3.id = s3.cadence_id
          where r.clinic_id = ca.clinic_id
            and r.contact_id = ca.id
            and r.sent_at > now() - interval '30 minutes'
            and r.scheduled_for >= ca.funnel_stage_changed_at
            and c3.kind = 'followup'
            and c3.trigger_stage = ca.funnel_stage
            and c3.id <> v.id
       )
     )
$$;

comment on function public.followups_devidos(uuid) is
  'Os passos de follow-up devidos (onda 4): contato numa etapa da jornada, fora o importado parado, sem resposta desde a entrada; a regua que vale para ele (regua_de_followup_do_contato) e os passos dela na janela de planejamento, com a trava de toque repetido (D3). Sem clinica: todas (o motor, via planejar_reguas). So service_role.';

revoke all on function public.followups_devidos(uuid) from public, anon, authenticated;
grant execute on function public.followups_devidos(uuid) to service_role;

-- planejar_reguas: corpo de PRODUCAO; so o CTE devidas do follow-up muda.
create or replace function public.planejar_reguas()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_confirmacao integer := 0;
  v_pos_falta integer := 0;
  v_followup integer := 0;
begin
  -- NUMERO (varios numeros, 25/09/2026; por tipo, 29/09/2026): todo job
  -- nasce com o numero de envio carimbado por resolver_conta_de_envio com o
  -- TIPO da secao (confirmacao, pos_falta, followup): o fixo daquele tipo,
  -- senao o ultimo usado pelo paciente, senao o principal.
  --
  -- REGUA VIGENTE (regua vinculada, 29/09/2026): a regua de cada consulta,
  -- na confirmacao e no pos falta, e a de regua_da_consulta (procedimento >
  -- profissional > especialidade > geral, reforcada vence no nivel,
  -- desempate por created_at e id). Uma so por consulta.
  --
  -- TOQUE REPETIDO QUANDO A VIGENTE MUDA: a vinculada nasce com os MESMOS
  -- offsets da geral (criarReguaDeExcecaoAction copia os passos), e a chave
  -- de cadence_run leva o cadence_step_id. Ligar, desligar ou trocar a
  -- regua vigente logo depois de um toque faria o passo de mesmo offset da
  -- regua nova, ja vencido e ainda dentro da folga de 30 minutos, nascer de
  -- novo e sair em seguida. Por isso um passo JA VENCIDO (scheduled_for <=
  -- now(), a recuperacao da folga) so e materializado quando a consulta nao
  -- recebeu nenhum toque do mesmo tipo nos ultimos 30 minutos, de qualquer
  -- regua (inclusive o "Cobrar agora"). Passo futuro continua nascendo
  -- adiantado, como sempre. A exclusao de uma vinculada leva as runs dela
  -- no cascade e apagaria essa prova: a excluirReguaAction recusa excluir
  -- vinculada que enviou nos ultimos 30 minutos. O toque que perguntava pelo
  -- horario ANTIGO de uma consulta remarcada depois dele nao trava (a
  -- remarcacao volta a pedir confirmacao, decisao do dono de 24/09).
  -- Limitacao conhecida: apagar UMA mensagem (passo) que saiu nos ultimos
  -- 30 minutos e, em seguida, mudar a regua vigente da consulta (ou recriar
  -- o mesmo momento) pode repetir aquele toque uma vez; recriar o mesmo
  -- momento ja repetia antes da regua vinculada.
  --
  -- Confirmacao: eixo em appointment.starts_at.
  --
  -- CUSTO: regua_da_consulta e uma funcao SQL com FROM e ORDER BY (nunca e
  -- inlinada), cara demais para rodar por consulta futura a cada minuto.
  -- `candidatas` (materialized, para o planejador nao avaliar a funcao antes
  -- do filtro) so deixa passar a consulta que tem, em ALGUMA regua ativa de
  -- confirmacao da clinica, um passo dentro do horizonte. E condicao
  -- necessaria de toda linha de `devidas`, entao o resultado nao muda. O
  -- HORIZONTE aparece duas vezes (aqui e em `devidas`): mudar os dois juntos.
  with candidatas as materialized (
    select a.id, a.clinic_id, a.contact_id, a.starts_at
    from appointment a
    where a.send_confirmation
      and a.status in ('agendado', 'aguardando_confirmacao')
      -- Paciente pediu para remarcar: perguntar se ele confirma a consulta
      -- que ele quer trocar confunde e atrapalha a recepcao que esta
      -- remarcando. Quando o pedido for resolvido (coluna limpa), os toques
      -- que ainda couberem voltam a ser planejados.
      and a.remarcacao_pedida_em is null
      and a.starts_at > now()
      and exists (
        select 1
          from cadence c2
          join cadence_step s2 on s2.cadence_id = c2.id
         where c2.clinic_id = a.clinic_id
           and c2.kind = 'confirmacao'
           and c2.active
           and a.starts_at + make_interval(mins => s2.offset_minutes)
               between now() - interval '30 minutes'
                   and now() + interval '60 minutes'
      )
  ),
  devidas as (
    select
      a.clinic_id,
      s.id as step_id,
      a.contact_id,
      a.id as appointment_id,
      a.starts_at + make_interval(mins => s.offset_minutes) as scheduled_for
    from candidatas a
    cross join lateral (
      select public.regua_da_consulta(a.id, 'confirmacao') as id
    ) c
    join cadence_step s on s.cadence_id = c.id
    where a.starts_at + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
      and not (
        a.starts_at + make_interval(mins => s.offset_minutes) <= now()
        and exists (
          select 1
            from cadence_run r
            join cadence_step s3 on s3.id = r.cadence_step_id
            join cadence c3 on c3.id = s3.cadence_id
           where r.appointment_id = a.id
             and c3.kind = 'confirmacao'
             and r.sent_at > now() - interval '30 minutes'
             -- O toque que perguntava pelo horario ANTIGO nao trava a
             -- confirmacao do horario novo: toda remarcacao volta a pedir
             -- confirmacao (decisao do dono de 24/09).
             and not exists (
               select 1 from appointment_status_history h
                where h.appointment_id = a.id
                  and h.kind = 'remarcacao'
                  and h.previous_starts_at is distinct from h.new_starts_at
                  and h.changed_at > r.sent_at
             )
        )
      )
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, appointment_id, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, contact_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (
      clinic_id, kind, payload, run_at, prioridade, whatsapp_account_id
    )
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           0,
           resolver_conta_de_envio(clinic_id, contact_id, 'confirmacao')
    from novas
    returning 1
  )
  select count(*)::integer into v_confirmacao from jobs;

  -- Pos falta: eixo no instante em que a falta foi marcada.
  with faltas as (
    select
      a.clinic_id,
      a.contact_id,
      a.id as appointment_id,
      (
        select max(h.changed_at)
        from appointment_status_history h
        where h.appointment_id = a.id and h.status = 'faltou'
      ) as marcada_em
    from appointment a
    where a.status = 'faltou'
      and a.starts_at > now() - interval '30 days'
  ),
  devidas as (
    select
      f.clinic_id,
      s.id as step_id,
      f.contact_id,
      f.appointment_id,
      f.marcada_em + make_interval(mins => s.offset_minutes) as scheduled_for
    from faltas f
    cross join lateral (
      select public.regua_da_consulta(f.appointment_id, 'pos_falta') as id
    ) c
    join cadence_step s on s.cadence_id = c.id
    where f.marcada_em is not null
      and f.marcada_em + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
      -- A mesma trava da confirmacao: passo ja vencido so nasce se a
      -- consulta nao recebeu toque de pos falta nos ultimos 30 minutos.
      and not (
        f.marcada_em + make_interval(mins => s.offset_minutes) <= now()
        and exists (
          select 1
            from cadence_run r
            join cadence_step s3 on s3.id = r.cadence_step_id
            join cadence c3 on c3.id = s3.cadence_id
           where r.appointment_id = f.appointment_id
             and c3.kind = 'pos_falta'
             and r.sent_at > now() - interval '30 minutes'
        )
      )
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, appointment_id, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, contact_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (
      clinic_id, kind, payload, run_at, prioridade, whatsapp_account_id
    )
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           0,
           resolver_conta_de_envio(clinic_id, contact_id, 'pos_falta')
    from novas
    returning 1
  )
  select count(*)::integer into v_pos_falta from jobs;

  -- Follow-up: eixo na entrada da etapa (funnel_stage_changed_at).
  -- O contato so esta no recorte enquanto CONTINUA na etapa da regua e sem
  -- resposta desde que entrou: sair ou responder e a parada da spec 7.2. O
  -- join com funnel_stage_def descarta regua orfa de etapa excluida (defesa
  -- em profundidade; o gatilho da jornada ja impede a exclusao).
  --
  -- IMPORTACAO NAO INSCREVE (decisao do dono de 24/09/2026): o contato criado
  -- pela planilha tem o relogio da etapa carimbado no insert, igual a qualquer
  -- outro, mas esse relogio nao e um ato de ninguem. Enquanto ele nao mudar
  -- de etapa (funnel_stage_changed_at continua igual ao created_at, que o
  -- insert grava com o MESMO now()), o follow-up nao o alcanca. A primeira
  -- mudanca de etapa, ato explicito de alguem (inclusive em massa), move o
  -- relogio e inscreve.
  --
  -- O job de follow-up nasce com prioridade 1: nunca passa na frente de
  -- confirmacao, pos falta, resposta ao paciente ou oferta de espera.
  with devidas as (
    -- [reguas por etiqueta] inicio
    -- Onda 4 (24/10/2026): mais de uma regua por etapa, com filtro por
    -- etiqueta. A regua que vale para cada contato (regua_de_followup_do_contato:
    -- etiquetas do lead e das conversas, a ordem da clinica, desligada nao conta)
    -- e a trava de toque repetido moram em followups_devidos, com as mesmas
    -- condicoes de antes (etapa da jornada, importado parado fora, sem resposta
    -- desde a entrada, a mesma janela). Com uma regua sem etiqueta por etapa, o
    -- conjunto e o mesmo do recorte de antes (paridade provada no ensaio).
    select f.clinic_id, f.step_id, f.contact_id, f.scheduled_for
      from public.followups_devidos(null) f
    -- [reguas por etiqueta] fim
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, null, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, contact_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (
      clinic_id, kind, payload, run_at, prioridade, whatsapp_account_id
    )
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           1,
           resolver_conta_de_envio(clinic_id, contact_id, 'followup')
    from novas
    returning 1
  )
  select count(*)::integer into v_followup from jobs;

  return jsonb_build_object(
    'confirmacao', v_confirmacao,
    'pos_falta', v_pos_falta,
    'followup', v_followup
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5) Leituras da tela (so contagens, sem dado de paciente)
-- ---------------------------------------------------------------------------

-- Por regua de follow-up da clinica (ligada ou nao):
--   casam            contatos hoje na etapa da regua que casam com o filtro
--   recebem          desses, para quem ela e a que vale agora (0 se
--                    desligada)
--   sem_autorizacao  dos que casam, os sem autorizacao para receber
--                    mensagens (consentimento_vigente)
--   entradas_30d     dos que casam, os que entraram na etapa nos ultimos 30
--                    dias (a mesma conta de hoje de fetchFollowups)
-- e por etapa com regua LIGADA: sem_regua (contatos da etapa para quem
-- nenhuma regua vale). Conta todo contato da etapa, como o planejador (que
-- nao olha kind). SECURITY INVOKER: a B recebe as listas vazias.
create function public.alcance_das_reguas_de_followup(p_clinic_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with reguas as (
    select c.id, c.trigger_stage, c.active, c.etiquetas, c.etiquetas_modo
      from public.cadence c
     where c.clinic_id = p_clinic_id
       and c.kind = 'followup'
  ),
  contatos as materialized (
    select ct.id,
           ct.funnel_stage,
           ct.funnel_stage_changed_at >= now() - interval '30 days' as entrou_em_30d,
           public.chaves_de_etiqueta_do_contato(ct.id) as chaves,
           public.consentimento_vigente(p_clinic_id, ct.id, 'whatsapp') as autorizado,
           public.regua_de_followup_do_contato(ct.id) as vigente
      from public.contact ct
     where ct.clinic_id = p_clinic_id
       and ct.funnel_stage in (select r.trigger_stage from reguas r)
  ),
  casamentos as (
    select r.id,
           k.id as contato,
           k.autorizado,
           k.entrou_em_30d,
           r.active and k.vigente = r.id as recebe
      from reguas r
      join contatos k
        on k.funnel_stage = r.trigger_stage
     where public.etiquetas_casam(k.chaves, r.etiquetas, r.etiquetas_modo)
  ),
  por_regua as (
    select r.id,
           count(m.contato) as casam,
           count(m.contato) filter (where m.recebe) as recebem,
           count(m.contato) filter (where not m.autorizado) as sem_autorizacao,
           count(m.contato) filter (where m.entrou_em_30d) as entradas_30d
      from reguas r
      left join casamentos m on m.id = r.id
     group by r.id
  ),
  por_etapa as (
    select s.trigger_stage as chave,
           (select count(*)
              from contatos k
             where k.funnel_stage = s.trigger_stage
               and k.vigente is null) as sem_regua
      from (select distinct r.trigger_stage from reguas r where r.active) s
  )
  select jsonb_build_object(
           'reguas', coalesce(
             (select jsonb_agg(jsonb_build_object(
                       'id', p.id,
                       'casam', p.casam,
                       'recebem', p.recebem,
                       'sem_autorizacao', p.sem_autorizacao,
                       'entradas_30d', p.entradas_30d)
                     order by p.id)
                from por_regua p),
             '[]'::jsonb),
           'etapas', coalesce(
             (select jsonb_agg(jsonb_build_object(
                       'chave', e.chave,
                       'sem_regua', e.sem_regua)
                     order by e.chave)
                from por_etapa e),
             '[]'::jsonb)
         )
$$;

comment on function public.alcance_das_reguas_de_followup(uuid) is
  'Contagens das reguas de follow-up da clinica (onda 4), sem dado de paciente: {reguas: [{id, casam, recebem, sem_autorizacao, entradas_30d}], etapas: [{chave, sem_regua}]} (etapas so as com regua ligada). Conta todo contato da etapa. SECURITY INVOKER: a RLS recorta (a outra clinica recebe as listas vazias).';

revoke all on function public.alcance_das_reguas_de_followup(uuid) from public, anon;
grant execute on function public.alcance_das_reguas_de_followup(uuid) to authenticated, service_role;

-- A ordem da clinica entre as reguas com etiqueta da etapa (D2): prioridade
-- = posicao na lista. A lista tem de ser EXATAMENTE as reguas com etiqueta
-- daquela etapa (a geral nao entra: ela vale por ultimo sempre). SECURITY
-- INVOKER: a RLS de cadence decide; a guarda de papel da antes o 42501 que a
-- tela traduz (quem nao gerencia nao muda nada, nem com zero linhas).
create function public.ordenar_reguas_de_followup(
  p_clinic_id uuid,
  p_trigger_stage text,
  p_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_atuais uuid[];
  v_pedidos uuid[];
begin
  if auth.uid() is not null
     and not public.user_has_role(p_clinic_id, array['admin', 'gestor']) then
    raise exception using errcode = '42501',
      message = 'Sem permissão para ordenar as réguas desta clínica.';
  end if;

  -- As reguas com etiqueta da etapa, travadas (duas ordens ao mesmo tempo:
  -- a segunda espera e confere a lista de novo).
  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[])
    into v_atuais
    from (
      select c.id
        from public.cadence c
       where c.clinic_id = p_clinic_id
         and c.kind = 'followup'
         and c.trigger_stage = p_trigger_stage
         and cardinality(c.etiquetas) > 0
         for update
    ) x;

  select coalesce(array_agg(distinct i order by i), '{}'::uuid[])
    into v_pedidos
    from unnest(p_ids) as i;

  if p_ids is null
     or cardinality(p_ids) <> cardinality(v_atuais)
     or v_pedidos is distinct from v_atuais then
    raise exception using errcode = '22023',
      message = 'A ordem tem de trazer exatamente as réguas com etiqueta desta etapa.';
  end if;

  update public.cadence c
     set prioridade = o.posicao
    from unnest(p_ids) with ordinality as o(id, posicao)
   where c.id = o.id
     and c.clinic_id = p_clinic_id
     and c.prioridade is distinct from o.posicao::integer;
end;
$$;

comment on function public.ordenar_reguas_de_followup(uuid, text, uuid[]) is
  'Grava a ordem da clinica entre as reguas com etiqueta da etapa (prioridade = posicao na lista, a partir de 1). A lista tem de ser exatamente essas reguas (22023). So administrador e gestor (42501). SECURITY INVOKER: a RLS de cadence tambem decide.';

revoke all on function public.ordenar_reguas_de_followup(uuid, text, uuid[]) from public, anon;
grant execute on function public.ordenar_reguas_de_followup(uuid, text, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Conferencia: recusa a migration inteira (P0001) se o estado nao ficou
-- como o codigo de hoje espera
-- ---------------------------------------------------------------------------

do $conferencia$
declare
  v_n integer;
begin
  -- Nenhuma regua ganhou filtro nem ordem: as de hoje sao todas gerais.
  select count(*) into v_n
    from public.cadence c
   where cardinality(c.etiquetas) <> 0
      or c.etiquetas_modo <> 'qualquer'
      or c.prioridade <> 0;
  if v_n > 0 then
    raise exception using errcode = 'P0001',
      message = format('reguas_com_filtro: %s regua(s) com filtro ou ordem depois da migration', v_n);
  end if;

  -- O indice antigo saiu e os dois novos estao la.
  if to_regclass('public.cadence_followup_unico_por_etapa') is not null
     or to_regclass('public.cadence_followup_geral_unico_por_etapa') is null
     or to_regclass('public.cadence_followup_mesmo_filtro') is null then
    raise exception using errcode = 'P0001', message = 'indices_de_followup';
  end if;
end;
$conferencia$;
