-- Etiquetas de CONVERSA com catalogo por clinica (decisao do dono em
-- 21/09/2026). Fecha a spec 1.7 ("Etiquetas por conversa, com tela de gestao
-- de etiquetas") e habilita o filtro da 1.6.
--
-- A coluna conversation.tags existe desde a Fase 1 e esta VAZIA em producao
-- (conferido: 139 conversas, zero com tags). Ela ja viaja no
-- CONVERSATION_SELECT e o realtime ja mescla mudancas dela, entao aplicar
-- etiqueta aparece na tela de quem esta com o Inbox aberto sem refetch.
--
-- O catalogo segue o molde da jornada (20260909100000): chave ESTAVEL que o
-- consumidor guarda, nome renomeavel, protecao por gatilho e semeadura por
-- clinica. As diferencas conscientes estao comentadas onde aparecem.

-- ---------------------------------------------------------------------------
-- 1. O catalogo
-- ---------------------------------------------------------------------------

create table public.conversation_tag_def (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  -- Identidade ESTAVEL: e o que conversation.tags guarda e o que o filtro
  -- carrega. Imutavel por gatilho; renomear e mudar `nome`. Guardar o NOME
  -- aqui orfanaria toda conversa etiquetada no primeiro rename (a licao do
  -- funnel_stage) e, pior, travaria toda edicao futura de etiqueta daquela
  -- conversa, porque o validador confere o array INTEIRO.
  chave text not null,
  nome text not null,
  -- Cor da paleta do sistema (regra 5: nunca hex solto). Violeta ('ai') fica
  -- de fora: e RESERVADO para a IA.
  tom text not null default 'neutral'
    check (tom in ('neutral', 'info', 'warning', 'success', 'alert')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, chave),
  constraint chave_de_etiqueta_valida check (chave ~ '^[a-z0-9_]{1,40}$'),
  constraint nome_de_etiqueta_com_tamanho
    check (char_length(btrim(nome)) between 2 and 32)
);

-- Duas etiquetas com o MESMO nome sao indistinguiveis na tela (o chip mostra
-- so o nome). A jornada nao precisa disto porque etapa tem icone e posicao.
create unique index conversation_tag_def_nome_unico
  on public.conversation_tag_def (clinic_id, lower(btrim(nome)));

create trigger set_updated_at before update on public.conversation_tag_def
  for each row execute function public.set_updated_at();

comment on table public.conversation_tag_def is
  'Catalogo de etiquetas de conversa da clinica. conversation.tags guarda a CHAVE; o nome e a cor se resolvem aqui na hora de desenhar o chip.';

-- SEM coluna `icone`: o chip do cartao tem 18px e o NOME ja e a camada
-- discriminante (a regra que vale aqui e "nunca so cor", e ela esta
-- cumprida). SEM `posicao`: etiqueta nao tem ordem semantica como o funil,
-- ordena por nome. SEM `active`: exclusao e real e limpa as conversas (item
-- 3), porque etiqueta em conversa RESOLVIDA nunca mais sairia do arquivo e
-- uma etiqueta com erro de digitacao viraria indelevel para sempre.

-- ---------------------------------------------------------------------------
-- 2. RLS: membro le, gestao gerencia
-- ---------------------------------------------------------------------------
-- Aplicar etiqueta NAO passa por esta tabela: passa pela policy de UPDATE de
-- conversation, que ja entrega o recorte que o dono pediu (recepcao aplica;
-- 'profissional' so na conversa atribuida a ele; 'leitura' nao aplica).

alter table public.conversation_tag_def enable row level security;

create policy "membro le as etiquetas" on public.conversation_tag_def
  for select using (clinic_id in (select public.user_active_clinic_ids()));

create policy "gestao gerencia as etiquetas" on public.conversation_tag_def
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- ---------------------------------------------------------------------------
-- 3. Protecao do catalogo
-- ---------------------------------------------------------------------------

create or replace function public.proteger_etiqueta_de_conversa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.chave is distinct from old.chave then
      raise exception 'A chave de uma etiqueta não muda. Renomeie o nome da etiqueta.';
    end if;
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Uma etiqueta não muda de clínica.';
    end if;
    return new;
  end if;

  -- DELETE. Se a CLINICA inteira esta sendo apagada, o cascade manda: sem
  -- este escape nenhuma clinica seria excluivel e todo afterAll de teste
  -- quebraria (mesma licao da jornada).
  if not exists (select 1 from public.clinic where id = old.clinic_id) then
    return old;
  end if;

  -- Excluir a etiqueta a REMOVE das conversas. E isto que mantem a
  -- invariante "toda chave em conversation.tags existe no catalogo", que e o
  -- que permite o chip ser desenhado sem chave crua e o proximo UPDATE de
  -- tags passar pelo validador. security definer porque a limpeza e
  -- CONSEQUENCIA de uma exclusao que a RLS ja autorizou: deixar chave
  -- pendurada porque a policy do chamador nao alcancou alguma linha
  -- quebraria a invariante em silencio.
  update public.conversation
     set tags = array_remove(tags, old.chave)
   where clinic_id = old.clinic_id
     and old.chave = any (tags);
  return old;
end;
$$;

revoke all on function public.proteger_etiqueta_de_conversa()
  from public, anon, authenticated;

create trigger proteger_etiqueta_de_conversa
  before update or delete on public.conversation_tag_def
  for each row execute function public.proteger_etiqueta_de_conversa();

-- ---------------------------------------------------------------------------
-- 4. A conversa so aceita etiqueta que existe no catalogo DELA
-- ---------------------------------------------------------------------------
-- Falha ALTA, sem fallback, pelo mesmo motivo registrado na jornada: aceitar
-- etiqueta desconhecida em silencio criaria chave pendurada, e a partir dai
-- toda edicao de etiqueta naquela conversa passaria a falhar sem pista.

create or replace function public.validar_etiquetas_da_conversa()
returns trigger
language plpgsql
as $$
declare
  v_desconhecida text;
begin
  select t into v_desconhecida
    from unnest(new.tags) as t
   where not exists (
     select 1 from public.conversation_tag_def d
      where d.clinic_id = new.clinic_id and d.chave = t
   )
   limit 1;

  if v_desconhecida is not null then
    -- errcode de CHECK: o mesmo contrato que validar_etapa_do_contato usa.
    raise exception 'A etiqueta "%" não existe nesta clínica.', v_desconhecida
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- DOIS gatilhos, nao um: o WHEN de um trigger de INSERT nao pode referenciar
-- OLD, e TG_OP nao existe dentro de WHEN.
--
-- O CAMINHO QUENTE NAO PAGA: o UPDATE da ingestao de mensagem (last_message_at,
-- unread_count, awaiting_reply) nao toca tags, entao o WHEN e falso e a funcao
-- nunca e chamada. So paga quem muda etiqueta de fato, e ai a subconsulta bate
-- no indice unique (clinic_id, chave).
create trigger validar_etiquetas_ao_criar_conversa
  before insert on public.conversation
  for each row when (cardinality(new.tags) > 0)
  execute function public.validar_etiquetas_da_conversa();

create trigger validar_etiquetas_ao_mudar_conversa
  before update on public.conversation
  for each row
  when (new.tags is distinct from old.tags and cardinality(new.tags) > 0)
  execute function public.validar_etiquetas_da_conversa();

-- Teto por conversa: o cartao mostra 2 e o painel some de legibilidade muito
-- antes de 8. Check e IMMUTABLE, nao precisa de subconsulta.
alter table public.conversation
  add constraint conversation_ate_8_etiquetas check (cardinality(tags) <= 8);

-- ---------------------------------------------------------------------------
-- 5. Aplicar e remover: uma chamada atomica
-- ---------------------------------------------------------------------------
-- Array nao se edita bem via PostgREST e read-modify-write no cliente teria
-- corrida (a mesma razao de etiquetar_contatos). Diferencas conscientes:
--   - devolve o ARRAY FINAL, nao a contagem: o cliente grava no cache e
--     encerra a duvida sobre o estado da conversa sem refetch;
--   - uma conversa por chamada: o Inbox nao tem selecao multipla, e o
--     contrato "devolve o array final" so faz sentido para uma linha;
--   - null (zero linhas) e a resposta unica para "nao existe, nao e desta
--     clinica ou a RLS recusou", que e o que NAO se deve diferenciar para o
--     cliente.
-- security invoker: a RLS de conversation decide quem etiqueta.

create or replace function public.etiquetar_conversa(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_adicionar text[] default '{}',
  p_remover text[] default '{}'
) returns text[]
language sql
security invoker
set search_path = ''
as $$
  update public.conversation
     set tags = (
       select coalesce(array_agg(distinct t order by t), '{}')
         from unnest(tags || coalesce(p_adicionar, '{}')) as t
        where t <> all (coalesce(p_remover, '{}'))
     )
   where clinic_id = p_clinic_id
     and id = p_conversation_id
  returning tags;
$$;

revoke execute on function public.etiquetar_conversa(uuid, uuid, text[], text[])
  from public, anon;
grant execute on function public.etiquetar_conversa(uuid, uuid, text[], text[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Quantas conversas usam cada etiqueta
-- ---------------------------------------------------------------------------
-- Alimenta "Usada em N conversas" na tela de gestao e o numero do dialogo de
-- exclusao: sem isso o gestor nao tem como podar o catalogo com seguranca.
--
-- NAO existe indice GIN em conversation.tags de proposito: a filtragem da
-- tela e client-side sobre as 300 conversas ja carregadas, entao um GIN so
-- encareceria o caminho de escrita mais quente do sistema para zero leitor.
-- O dia de criar o indice e o dia em que ESTA consulta ficar lenta, ou o
-- filtro da lista for para o servidor.

create or replace function public.contagem_de_etiquetas_de_conversa(
  p_clinic_id uuid
) returns table (chave text, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t as chave, count(*)::bigint
    from public.conversation c, unnest(c.tags) as t
   where c.clinic_id = p_clinic_id
   group by t
$$;

revoke execute on function public.contagem_de_etiquetas_de_conversa(uuid)
  from public, anon;
grant execute on function public.contagem_de_etiquetas_de_conversa(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Semeadura: a clinica nasce com o que usar
-- ---------------------------------------------------------------------------
-- Catalogo vazio faz a funcionalidade parecer quebrada, e ninguem cadastra
-- etiqueta numa tela que nunca usou. Quatro, escolhidas por um criterio so:
-- ESTADO DE CONVERSA que nao existe estruturado em nenhum outro lugar.
--
-- Rejeitadas de proposito: 'no-show' (ja e o status 'faltou' do agendamento
-- e o sinal derivado risco_de_falta), 'convenio' e 'particular' (ja e
-- contact.insurance_id mais o catalogo de Convenios), 'retorno' (ja e
-- historico de agendamento). Etiqueta que repete dado estruturado vira
-- terceira fonte de verdade e envenena relatorio.
--
-- 'urgente' tambem mantem scripts/seed/010-conversas.ts funcionando sem
-- edicao, e da uma conversa etiquetada de graca no ambiente de dev.

create or replace function public.semear_etiquetas_padrao(p_clinic_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.conversation_tag_def (clinic_id, chave, nome, tom)
  values
    (p_clinic_id, 'urgente',             'Urgente',             'alert'),
    (p_clinic_id, 'orcamento_enviado',   'Orçamento enviado',   'info'),
    (p_clinic_id, 'aguardando_convenio', 'Aguardando convênio', 'warning'),
    (p_clinic_id, 'aguardando_paciente', 'Aguardando paciente', 'neutral')
  -- Sem ALVO de proposito: cobre tanto (clinic_id, chave) quanto o indice
  -- unico de nome. Com alvo, uma clinica que ja tivesse "Urgente" com outra
  -- chave faria a semeadura inteira falhar.
  on conflict do nothing;
$$;

revoke all on function public.semear_etiquetas_padrao(uuid)
  from public, anon, authenticated;

-- Toda clinica que EXISTE ganha agora...
select public.semear_etiquetas_padrao(id) from public.clinic;

-- ...e toda clinica que NASCER ganha junto.
create or replace function public.semear_etiquetas_de_clinica_nova()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.semear_etiquetas_padrao(new.id);
  return new;
end;
$$;

revoke all on function public.semear_etiquetas_de_clinica_nova()
  from public, anon, authenticated;

create trigger semear_etiquetas_de_clinica_nova
  after insert on public.clinic
  for each row execute function public.semear_etiquetas_de_clinica_nova();
