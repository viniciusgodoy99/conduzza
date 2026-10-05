-- ---------------------------------------------------------------------------
-- Agente de IA, E0: travas de liberacao e schema (Fase 3, 06/10/2026)
-- ---------------------------------------------------------------------------
-- Plano aprovado em 05/10/2026: a IA conversa so nas duas clinicas do dono
-- (teste123 e Conduzza Teste), so com telefones da equipe, em ambiente
-- controlado. Esta migration e SO ADITIVA e nao liga nada: nenhuma linha de
-- liberacao nasce aqui, o interruptor global nasce desligado e nenhum codigo
-- de producao le as tabelas novas (so os testes). Contrato em
-- scratchpad/fase3/contrato-e0-e1.md, itens 1 a 15; desenho em
-- scratchpad/fase3/plano-seguranca.md, secao 1.
--
-- Defesa em profundidade: basta UMA trava dizer nao para a IA nao agir.
-- No banco:
--   T3a ia_clinicas_da_fase_controlada() (IMMUTABLE, as duas ids) e o
--       gatilho ia_liberacao_so_na_lista: nenhuma outra clinica ganha
--       linha de liberacao, nem pela service role nem pelo super admin.
--       Aceita clinic.e_de_teste FORA da lista (fixtures; o motor de
--       producao ignora clinica de teste), que nao depende do interruptor
--       mas so atende em numero de provedor 'fake'. Clinica DA lista
--       obedece sempre ao interruptor, mesmo marcada e_de_teste;
--   T3b ia_liberacao (liberada, modo 'simulador' ou 'contatos', tetos);
--   T4  ia_numero_liberado (numero por clinica);
--   T5  ia_contato_liberado (por phone_key, a chave canonica de
--       chave_telefone: confere o telefone, nao o contact_id);
--   T6  ia_interruptor (linha unica, o kill switch global);
--   T7  ia_liberacao.pausada_pela_clinica (a RPC da clinica vem no E5).
-- Escrita so pelo super admin (ou SQL editor e service role), pelas RPCs
-- definir_*_da_ia, que gravam audit_log. As tabelas tem RLS, SELECT so para
-- is_product_admin(), nenhuma policy de escrita e revoke da sessao.
--
-- ia_pode_atender(clinica, numero, phone_key) combina T3 a T7 e o teto de
-- gasto das ultimas 24 horas (ia_uso, janela movel: nao depende de
-- clinic.timezone, que o admin da clinica edita). ia_pode_simular faz o
-- mesmo sem numero e contato. ia_clinica_liberada responde a tela (so para
-- membro ativo ou super admin).
--
-- Buracos de hoje que isto fecha:
--   - qualquer membro grava conversation.status = 'ia_atendendo' pelo
--     PostgREST: gatilho proteger_status_ia_atendendo (vale para toda
--     sessao, inclusive dentro de RPC: entrar em 'ia_atendendo', ou trocar
--     o contato de conversa que ja esta nele, exige ia_pode_atender; o
--     servidor e guardado nos outros pontos);
--   - o admin da clinica muda clinic.e_de_teste: gatilho
--     proteger_e_de_teste (molde proteger_limite_de_numeros). T3a confia em
--     e_de_teste.
--
-- 3.1 do backlog: ai_agent_config (versoes; publicada imutavel) e
-- knowledge_item. Livro de gasto ia_uso e preco em tabela llm_preco (como
-- message_pricing: preco nunca no codigo). ai_decision_log (0 linhas em
-- 06/10/2026, tabela fria) ganha as colunas do filtro e CHECK em
-- compliance_rule, escalation_reason, camada e gatilho_entrada.
--
-- NAO entra aqui (E3): gatilho em message, job responder_com_ia (o kind
-- ainda nao existe no CHECK de job_queue), mudancas em ingest e envio.
--
-- Erros de regra: SQLSTATE padrao (42501, 22004, 22023, 23503, 23514,
-- P0001, P0002). Nunca 40001/40P01. Nada aqui grava conteudo de mensagem nem
-- telefone em log ou em mensagem de erro.
--
-- Locks: CREATE TRIGGER em conversation e clinic e as FKs novas para
-- conversation e whatsapp_account seguram por instantes um lock SHARE ROW
-- EXCLUSIVE nessas tabelas. Nenhum ALTER em message, conversation ou
-- contact. ALTER so em ai_decision_log (fria).
--
-- ROLLBACK (manual, nesta ordem): drop trigger proteger_status_ia_atendendo
-- on conversation e proteger_e_de_teste on clinic; drop das funcoes
-- definir_interruptor_da_ia, definir_liberacao_da_ia, definir_numero_da_ia,
-- definir_contato_liberado_da_ia, ia_exigir_equipe_conduzza, ia_desligar,
-- ia_clinica_liberada, ia_pode_simular, ia_pode_atender,
-- ia_liberacao_vigente, proteger_status_ia_atendendo, proteger_e_de_teste;
-- drop das tabelas ia_contato_liberado, ia_numero_liberado, ia_liberacao,
-- ia_interruptor, ia_uso, llm_preco, knowledge_item, ai_agent_config (e das
-- funcoes de gatilho delas); drop de ia_clinicas_da_fase_controlada; em
-- ai_decision_log, drop dos CHECKs ai_decision_log_* novos, do indice
-- ai_decision_log_job_idx e das colunas novas (a tabela tinha 0 linhas).

-- ---------------------------------------------------------------------------
-- 1) T3a: a lista fechada de clinicas da fase controlada
-- ---------------------------------------------------------------------------
-- Espelho EXATO de CLINICAS_DA_FASE_CONTROLADA em lib/ia/liberacao.ts (o
-- teste de integracao compara). Mudar a lista e uma migration revisada.

create function public.ia_clinicas_da_fase_controlada()
returns uuid[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    'acd9c539-585e-4f2a-a195-712c70099564'::uuid, -- teste123
    'f0c115dd-e98c-4767-a1bb-93d517844852'::uuid  -- Conduzza Teste
  ]
$$;

revoke all on function public.ia_clinicas_da_fase_controlada()
  from public, anon, authenticated;
grant execute on function public.ia_clinicas_da_fase_controlada()
  to service_role;

comment on function public.ia_clinicas_da_fase_controlada() is
  'Lista fechada das clinicas da fase controlada da IA (teste123 e Conduzza Teste). Espelho exato de CLINICAS_DA_FASE_CONTROLADA em lib/ia/liberacao.ts. Nenhuma outra clinica ganha linha em ia_liberacao (gatilho ia_liberacao_so_na_lista), salvo clinica e_de_teste.';

-- ---------------------------------------------------------------------------
-- 2) T6: interruptor global (linha unica)
-- ---------------------------------------------------------------------------

create table public.ia_interruptor (
  id boolean primary key default true
    constraint ia_interruptor_linha_unica check (id),
  ligado boolean not null default false,
  motivo text,
  alterado_por uuid references auth.users (id) on delete set null,
  alterado_em timestamptz not null default now()
);

insert into public.ia_interruptor (id, ligado, motivo)
values (true, false, 'nasce desligado (migration 20261006100000)');

alter table public.ia_interruptor enable row level security;

revoke all on table public.ia_interruptor from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.ia_interruptor from authenticated;

create policy "super admin le o interruptor da ia"
  on public.ia_interruptor
  for select to authenticated
  using (public.is_product_admin());

comment on table public.ia_interruptor is
  'Kill switch global da IA (T6), linha unica. Desligado: ia_pode_atender e ia_pode_simular falsos em toda clinica da lista fechada (mesmo marcada e_de_teste); so a clinica e_de_teste fora da lista nao depende dele. Muda so por definir_interruptor_da_ia (super admin, SQL editor ou service role); o UPDATE direto e so recuo e nao devolve as conversas.';

-- ---------------------------------------------------------------------------
-- 3) T3b e T7: liberacao por clinica
-- ---------------------------------------------------------------------------
-- modo 'numero_inteiro' (todos os contatos do numero) fica barrado pelo
-- CHECK ate uma migration futura, como cadence_step.use_ai. Os tetos so
-- mudam pelo SQL editor (nenhuma RPC os altera nesta etapa).

create table public.ia_liberacao (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  modo text not null default 'simulador'
    constraint ia_liberacao_modo_valido
      check (modo in ('simulador', 'contatos')),
  liberada boolean not null default false,
  pausada_pela_clinica boolean not null default false,
  teto_diario_centavos_usd integer not null default 500
    constraint ia_liberacao_teto_diario_positivo
      check (teto_diario_centavos_usd > 0),
  teto_respostas_por_conversa_hora integer not null default 20
    constraint ia_liberacao_teto_por_conversa_positivo
      check (teto_respostas_por_conversa_hora > 0),
  motivo text,
  alterado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- T3a. Recusa (42501) linha de clinica fora da lista e que nao e de teste,
-- para QUALQUER papel (service role e super admin inclusive). No UPDATE so
-- recusa o que liga (liberada = true) ou troca a clinica: desligar sempre
-- passa, mesmo se a lista encolher numa migration futura.
create function public.ia_liberacao_so_na_lista()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and not new.liberada
     and new.clinic_id = old.clinic_id
  then
    return new;
  end if;
  if not exists (
    select 1
      from public.clinic c
     where c.id = new.clinic_id
       and (c.id = any (public.ia_clinicas_da_fase_controlada()) or c.e_de_teste)
  ) then
    raise exception using errcode = '42501',
      message = 'Esta clínica não está na fase controlada da IA.';
  end if;
  return new;
end;
$$;

revoke all on function public.ia_liberacao_so_na_lista()
  from public, anon, authenticated;

create trigger ia_liberacao_so_na_lista
  before insert or update on public.ia_liberacao
  for each row execute function public.ia_liberacao_so_na_lista();

create trigger set_updated_at
  before update on public.ia_liberacao
  for each row execute function public.set_updated_at();

alter table public.ia_liberacao enable row level security;

revoke all on table public.ia_liberacao from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.ia_liberacao from authenticated;

create policy "super admin le a liberacao da ia"
  on public.ia_liberacao
  for select to authenticated
  using (public.is_product_admin());

comment on table public.ia_liberacao is
  'Liberacao da IA por clinica (T3b e T7). So clinicas de ia_clinicas_da_fase_controlada() ou e_de_teste (gatilho ia_liberacao_so_na_lista, 42501 ate para a service role). modo simulador (so a Tela 6) ou contatos (WhatsApp so com ia_contato_liberado). Escrita por definir_liberacao_da_ia; pausada_pela_clinica so reduz (RPC da clinica no E5).';
comment on column public.ia_liberacao.teto_diario_centavos_usd is
  'Teto de gasto das ultimas 24 horas (ia_uso.custo_microdolar somado numa janela movel de 24 h, sem depender de clinic.timezone), em centavos de dolar. Atingido: ia_pode_atender e ia_pode_simular falsos ate o gasto mais antigo da janela sair dela.';
comment on column public.ia_liberacao.teto_respostas_por_conversa_hora is
  'Teto de respostas da IA por conversa por hora. Conferido pelo job do E3 (nao entra em ia_pode_atender).';

-- ---------------------------------------------------------------------------
-- 4) T4: numero liberado
-- ---------------------------------------------------------------------------
-- A FK para ia_liberacao exige a linha da clinica; o gatilho confere o
-- numero da MESMA clinica e nao removido (ao ligar).

create table public.ia_numero_liberado (
  whatsapp_account_id uuid primary key
    references public.whatsapp_account (id) on delete cascade,
  clinic_id uuid not null
    references public.ia_liberacao (clinic_id) on delete cascade,
  ativo boolean not null default false,
  alterado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ia_numero_liberado_clinica_idx
  on public.ia_numero_liberado (clinic_id);

create function public.ia_numero_liberado_coerente()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_clinica_do_numero uuid;
  v_removido_em timestamptz;
begin
  if not exists (
    select 1 from public.ia_liberacao l where l.clinic_id = new.clinic_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'Libere a clínica para a IA antes de liberar um número.';
  end if;

  select w.clinic_id, w.removido_em
    into v_clinica_do_numero, v_removido_em
    from public.whatsapp_account w
   where w.id = new.whatsapp_account_id;
  if v_clinica_do_numero is distinct from new.clinic_id then
    raise exception using errcode = 'foreign_key_violation',
      message = 'O número informado não pertence a esta clínica.';
  end if;
  if new.ativo and v_removido_em is not null then
    raise exception using errcode = 'check_violation',
      message = 'Este número foi removido da clínica.';
  end if;
  return new;
end;
$$;

revoke all on function public.ia_numero_liberado_coerente()
  from public, anon, authenticated;

create trigger ia_numero_liberado_coerente
  before insert or update on public.ia_numero_liberado
  for each row execute function public.ia_numero_liberado_coerente();

create trigger set_updated_at
  before update on public.ia_numero_liberado
  for each row execute function public.set_updated_at();

alter table public.ia_numero_liberado enable row level security;

revoke all on table public.ia_numero_liberado from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.ia_numero_liberado from authenticated;

create policy "super admin le os numeros liberados para a ia"
  on public.ia_numero_liberado
  for select to authenticated
  using (public.is_product_admin());

comment on table public.ia_numero_liberado is
  'Numeros de WhatsApp em que a IA pode atender (T4). Exige linha em ia_liberacao e numero da mesma clinica, nao removido ao ligar. Escrita por definir_numero_da_ia. ia_pode_atender confere ativo e removido_em na hora.';

-- ---------------------------------------------------------------------------
-- 5) T5: contato liberado (telefone da equipe), por phone_key
-- ---------------------------------------------------------------------------
-- O gatilho grava SEMPRE a chave canonica (chave_telefone), por qualquer
-- caminho: com e sem o nono digito sao a mesma linha.

create table public.ia_contato_liberado (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null
    references public.ia_liberacao (clinic_id) on delete cascade,
  phone_key text not null
    constraint ia_contato_liberado_telefone_valido
      check (phone_key ~ '^\+[1-9][0-9]{7,14}$'),
  rotulo text
    constraint ia_contato_liberado_rotulo_tamanho
      check (rotulo is null or char_length(rotulo) between 1 and 80),
  ativo boolean not null default false,
  alterado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ia_contato_liberado_unico unique (clinic_id, phone_key)
);

create function public.ia_contato_liberado_coerente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ia_liberacao l where l.clinic_id = new.clinic_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'Libere a clínica para a IA antes de liberar um telefone.';
  end if;
  new.phone_key := public.chave_telefone(btrim(new.phone_key));
  return new;
end;
$$;

revoke all on function public.ia_contato_liberado_coerente()
  from public, anon, authenticated;

create trigger ia_contato_liberado_coerente
  before insert or update on public.ia_contato_liberado
  for each row execute function public.ia_contato_liberado_coerente();

create trigger set_updated_at
  before update on public.ia_contato_liberado
  for each row execute function public.set_updated_at();

alter table public.ia_contato_liberado enable row level security;

revoke all on table public.ia_contato_liberado from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.ia_contato_liberado from authenticated;

create policy "super admin le os contatos liberados para a ia"
  on public.ia_contato_liberado
  for select to authenticated
  using (public.is_product_admin());

comment on table public.ia_contato_liberado is
  'Telefones (da equipe) com quem a IA pode conversar no modo contatos (T5). phone_key e sempre a chave canonica (chave_telefone), gravada pelo gatilho; a checagem e no telefone que enviou e no de destino, nunca no contact_id (o admin da clinica edita contact.phone_e164). Escrita por definir_contato_liberado_da_ia.';
comment on column public.ia_contato_liberado.rotulo is
  'De quem e o telefone, por exemplo "Vinicius, equipe". Ate 80 caracteres.';

-- ---------------------------------------------------------------------------
-- 6) ia_uso: livro de gasto por chamada ao modelo
-- ---------------------------------------------------------------------------
-- Uma linha por chamada (agente, verificador, classificador), inclusive do
-- simulador. Custo em microdolar (1 US$ = 1.000.000), calculado pelo codigo
-- a partir de llm_preco. So o sistema escreve; o super admin le. Nada de
-- texto aqui.

create table public.ia_uso (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  conversation_id uuid references public.conversation (id) on delete set null,
  origem text not null
    constraint ia_uso_origem_valida
      check (origem in ('whatsapp', 'simulador', 'avaliacao')),
  papel text not null
    constraint ia_uso_papel_valido
      check (papel in ('agente', 'verificador', 'classificador')),
  modelo text not null
    constraint ia_uso_modelo_tamanho
      check (char_length(modelo) between 1 and 100),
  tokens_entrada integer not null default 0
    constraint ia_uso_tokens_entrada_validos check (tokens_entrada >= 0),
  tokens_saida integer not null default 0
    constraint ia_uso_tokens_saida_validos check (tokens_saida >= 0),
  tokens_cache_lidos integer not null default 0
    constraint ia_uso_tokens_cache_lidos_validos check (tokens_cache_lidos >= 0),
  tokens_cache_gravados integer not null default 0
    constraint ia_uso_tokens_cache_gravados_validos check (tokens_cache_gravados >= 0),
  custo_microdolar bigint not null
    constraint ia_uso_custo_valido check (custo_microdolar >= 0),
  job_id uuid,
  created_at timestamptz not null default now()
);

create index ia_uso_clinica_dia_idx on public.ia_uso (clinic_id, created_at);
create index ia_uso_conversa_idx on public.ia_uso (conversation_id)
  where conversation_id is not null;

alter table public.ia_uso enable row level security;

revoke all on table public.ia_uso from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.ia_uso from authenticated;

create policy "super admin le o uso da ia"
  on public.ia_uso
  for select to authenticated
  using (public.is_product_admin());

comment on table public.ia_uso is
  'Livro de gasto da IA: uma linha por chamada ao modelo (origem whatsapp, simulador ou avaliacao; papel agente, verificador ou classificador). custo_microdolar calculado pelo codigo a partir de llm_preco. So o sistema escreve; o super admin le. A soma das ultimas 24 horas (janela movel) contra ia_liberacao.teto_diario_centavos_usd entra em ia_pode_atender. job_id sem FK (a fila e podada).';

-- ---------------------------------------------------------------------------
-- 7) llm_preco: preco por modelo (global, como message_pricing)
-- ---------------------------------------------------------------------------
-- Microdolar por milhao de tokens. Semeado da tabela oficial da Anthropic
-- (guia claude-api, cache de 24/06/2026): US$ por milhao de tokens de
-- entrada e saida; leitura de cache 0,1x da entrada; escrita de cache (TTL
-- de 5 minutos) 1,25x da entrada. Preco muda por migration ou SQL editor,
-- nunca no codigo.

create table public.llm_preco (
  modelo text primary key
    constraint llm_preco_modelo_formato
      check (modelo ~ '^[a-z0-9][a-z0-9.-]{0,99}$'),
  entrada_microdolar_por_milhao bigint not null
    constraint llm_preco_entrada_valida check (entrada_microdolar_por_milhao >= 0),
  saida_microdolar_por_milhao bigint not null
    constraint llm_preco_saida_valida check (saida_microdolar_por_milhao >= 0),
  cache_leitura_microdolar_por_milhao bigint not null
    constraint llm_preco_cache_leitura_valida check (cache_leitura_microdolar_por_milhao >= 0),
  cache_escrita_microdolar_por_milhao bigint not null
    constraint llm_preco_cache_escrita_valida check (cache_escrita_microdolar_por_milhao >= 0),
  vigente_desde date not null,
  fonte text not null
    constraint llm_preco_fonte_preenchida check (btrim(fonte) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.llm_preco
  for each row execute function public.set_updated_at();

insert into public.llm_preco (
  modelo,
  entrada_microdolar_por_milhao,
  saida_microdolar_por_milhao,
  cache_leitura_microdolar_por_milhao,
  cache_escrita_microdolar_por_milhao,
  vigente_desde,
  fonte
) values
  ('claude-opus-5', 5000000, 25000000, 500000, 6250000, date '2026-06-24',
   'Tabela de precos da Anthropic, guia claude-api (cache de 24/06/2026): US$ 5 entrada e US$ 25 saida por milhao de tokens; cache leitura 0,1x e escrita (5 min) 1,25x da entrada'),
  ('claude-sonnet-5', 2000000, 10000000, 200000, 2500000, date '2026-06-24',
   'Tabela de precos da Anthropic, guia claude-api (cache de 24/06/2026): US$ 2 entrada e US$ 10 saida por milhao de tokens; cache leitura 0,1x e escrita (5 min) 1,25x da entrada'),
  ('claude-haiku-4-5', 1000000, 5000000, 100000, 1250000, date '2026-06-24',
   'Tabela de precos da Anthropic, guia claude-api (cache de 24/06/2026): US$ 1 entrada e US$ 5 saida por milhao de tokens; cache leitura 0,1x e escrita (5 min) 1,25x da entrada');

alter table public.llm_preco enable row level security;

revoke all on table public.llm_preco from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.llm_preco from authenticated;

create policy "autenticado le os precos dos modelos"
  on public.llm_preco
  for select to authenticated
  using (true);

comment on table public.llm_preco is
  'Preco por modelo de linguagem, em microdolar por milhao de tokens (entrada, saida, leitura e escrita de cache de 5 minutos). Global, sem clinic_id, como message_pricing: o preco vive em tabela, nunca no codigo. fonte diz de onde veio o numero.';

-- ---------------------------------------------------------------------------
-- 8) Decisao: ia_liberacao_vigente, ia_pode_atender, ia_pode_simular,
--    ia_clinica_liberada
-- ---------------------------------------------------------------------------

-- Interna: T3a, T3b, T6, T7, modo e teto. Sem linha de liberacao, sem
-- clinica ou sem a linha do interruptor: falso (falha fechada).
-- T3a com T6: clinica DA lista exige o interruptor ligado, SEMPRE (mesmo
-- marcada e_de_teste); o atalho e_de_teste (sem interruptor) vale so para
-- clinica FORA da lista, que e onde as suites montam a tabela verdade sem
-- tocar no interruptor do banco compartilhado. ia_pode_atender ainda exige,
-- fora da lista, numero de provedor 'fake'.
-- Teto: janela movel das ultimas 24 horas. Nao usa clinic.timezone, que o
-- admin da clinica edita (um fuso escolhido a dedo zerava a soma; um fuso
-- invalido fazia esta funcao levantar 22023 e derrubava ia_desligar).
create function public.ia_liberacao_vigente(p_clinic_id uuid, p_modos text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select (
             (c.id = any (public.ia_clinicas_da_fase_controlada())
              and coalesce(i.ligado, false))
             or (c.e_de_teste
                 and not (c.id = any (public.ia_clinicas_da_fase_controlada())))
           )
       and l.liberada
       and not l.pausada_pela_clinica
       and l.modo = any (p_modos)
       and (
         select coalesce(sum(u.custo_microdolar), 0)
           from public.ia_uso u
          where u.clinic_id = c.id
            and u.created_at >= now() - interval '24 hours'
       ) < l.teto_diario_centavos_usd::bigint * 10000
      from public.clinic c
      join public.ia_liberacao l on l.clinic_id = c.id
      left join public.ia_interruptor i on i.id
     where c.id = p_clinic_id
  ), false)
$$;

revoke all on function public.ia_liberacao_vigente(uuid, text[])
  from public, anon, authenticated, service_role;

comment on function public.ia_liberacao_vigente(uuid, text[]) is
  'Interna. Verdadeiro so com: clinica da lista fechada com o interruptor ligado (ou clinica e_de_teste FORA da lista, que nao depende dele), liberada, nao pausada pela clinica, modo entre p_modos e gasto das ultimas 24 horas (ia_uso, janela movel) abaixo do teto.';

create function public.ia_pode_atender(
  p_clinic_id uuid,
  p_whatsapp_account_id uuid,
  p_phone_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.ia_liberacao_vigente(p_clinic_id, array['contatos'])
    and exists (
      select 1
        from public.ia_numero_liberado n
        join public.whatsapp_account w on w.id = n.whatsapp_account_id
       where n.whatsapp_account_id = p_whatsapp_account_id
         and n.clinic_id = p_clinic_id
         and n.ativo
         and w.clinic_id = p_clinic_id
         and w.removido_em is null
         -- clinica e_de_teste fora da lista: so o WhatsApp falso
         and (p_clinic_id = any (public.ia_clinicas_da_fase_controlada())
              or w.provider = 'fake')
    )
    and exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_phone_key))
         and k.ativo
    ),
    false
  )
$$;

revoke all on function public.ia_pode_atender(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ia_pode_atender(uuid, uuid, text)
  to service_role;

comment on function public.ia_pode_atender(uuid, uuid, text) is
  'A IA pode atender este telefone (phone_key, ou o E.164, que vira a chave) neste numero desta clinica? Combina T3a, T3b, T4, T5, T6, T7, modo contatos e o teto das ultimas 24 horas. Clinica e_de_teste fora da lista: so em numero de provedor fake. Nulo em qualquer argumento: falso. So service_role (e as funcoes do banco).';

create function public.ia_pode_simular(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.ia_liberacao_vigente(p_clinic_id, array['simulador', 'contatos'])
$$;

revoke all on function public.ia_pode_simular(uuid)
  from public, anon, authenticated;
grant execute on function public.ia_pode_simular(uuid)
  to service_role;

comment on function public.ia_pode_simular(uuid) is
  'O simulador da Tela 6 pode chamar o modelo para esta clinica? As travas de ia_pode_atender sem numero e contato, com modo simulador ou contatos. So service_role.';

-- Para a tela: falso para quem nao e membro ativo da clinica nem super
-- admin (e para anon). Nao olha pausa nem teto: a tela mostra a clinica
-- liberada mesmo pausada (o cartao Ativo/Pausado e do E5).
create function public.ia_clinica_liberada(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (
             (auth.uid() is null
              and coalesce(auth.role(), 'service_role') = 'service_role')
             or public.is_product_admin()
             or exists (
               select 1
                 from public.clinic_member m
                where m.clinic_id = c.id
                  and m.user_id = auth.uid()
                  and m.status = 'ativo'
             )
           )
       and (
             (c.id = any (public.ia_clinicas_da_fase_controlada())
              and coalesce(i.ligado, false))
             or (c.e_de_teste
                 and not (c.id = any (public.ia_clinicas_da_fase_controlada())))
           )
       and l.liberada
      from public.clinic c
      join public.ia_liberacao l on l.clinic_id = c.id
      left join public.ia_interruptor i on i.id
     where c.id = p_clinic_id
  ), false)
$$;

revoke all on function public.ia_clinica_liberada(uuid)
  from public, anon, authenticated;
grant execute on function public.ia_clinica_liberada(uuid)
  to authenticated, service_role;

comment on function public.ia_clinica_liberada(uuid) is
  'Para a tela: a IA esta liberada nesta clinica (da lista com o interruptor ligado, ou e_de_teste fora da lista; e liberada)? Falso para quem nao e membro ativo nem super admin. Nao olha pausa, modo nem teto.';

-- ---------------------------------------------------------------------------
-- 9) ia_desligar: devolve as conversas para a equipe e cancela os jobs
-- ---------------------------------------------------------------------------
-- Interna, chamada pelas RPCs definir_*_da_ia depois de gravar a mudanca,
-- na MESMA transacao. Reavalia cada conversa em 'ia_atendendo' das clinicas
-- com ia_pode_atender: a que perdeu a liberacao (clinica, interruptor,
-- numero, telefone, modo ou teto) volta para 'aguardando_humano', com
-- awaiting_reply ligado quando a ultima mensagem (sem nota interna e sem
-- evento) e do paciente. Desligar a clinica ou o interruptor devolve todas
-- (salvo, no interruptor, a clinica e_de_teste fora da lista, que nao
-- depende dele). Jobs 'responder_com_ia' pendentes de conversa que nao esta
-- mais na IA (ou sem payload.conversation_id) viram 'cancelado'; o kind nasce
-- no E3, ate la o update nao acha nada. NADA e enviado ao desligar.
--
-- Corrida com a sessao que poe a conversa na IA no mesmo instante: as RPCs
-- definir_* travam a linha da clinica em ia_liberacao (FOR UPDATE; o
-- interruptor trava a propria linha no upsert) antes de gravar, e o gatilho
-- proteger_status_ia_atendendo trava as mesmas linhas FOR SHARE antes de
-- perguntar a ia_pode_atender. Quem chega depois espera o commit do outro e
-- le o estado novo (READ COMMITTED: cada comando do plpgsql tira um retrato
-- novo): ou a sessao ve a liberacao ja desligada (42501), ou a varredura ve
-- a conversa ja na IA e a devolve.

create function public.ia_desligar(p_clinic_ids uuid[])
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_conversas integer := 0;
  v_jobs integer := 0;
begin
  if p_clinic_ids is null or cardinality(p_clinic_ids) = 0 then
    return jsonb_build_object('conversas', 0, 'jobs', 0);
  end if;

  update public.conversation c
     set status = 'aguardando_humano',
         awaiting_reply = c.awaiting_reply or coalesce((
           select m.author = 'paciente'
             from public.message m
            where m.conversation_id = c.id
              and not m.is_internal_note
              and m.content_type <> 'evento'
            order by m.created_at desc, m.id desc
            limit 1
         ), false)
   where c.clinic_id = any (p_clinic_ids)
     and c.status = 'ia_atendendo'
     and not public.ia_pode_atender(
       c.clinic_id,
       c.whatsapp_account_id,
       (select k.phone_key from public.contact k where k.id = c.contact_id)
     );
  get diagnostics v_conversas = row_count;

  update public.job_queue j
     set status = 'cancelado',
         last_error = 'ia_desligada'
   where j.kind = 'responder_com_ia'
     and j.status = 'pendente'
     and j.clinic_id = any (p_clinic_ids)
     and not exists (
       select 1
         from public.conversation c
        where c.id::text = j.payload ->> 'conversation_id'
          and c.status = 'ia_atendendo'
     );
  get diagnostics v_jobs = row_count;

  return jsonb_build_object('conversas', v_conversas, 'jobs', v_jobs);
end;
$$;

revoke all on function public.ia_desligar(uuid[])
  from public, anon, authenticated, service_role;

comment on function public.ia_desligar(uuid[]) is
  'Interna (chamada pelas RPCs definir_*_da_ia). Conversas em ia_atendendo das clinicas que nao passam mais em ia_pode_atender voltam para aguardando_humano (awaiting_reply ligado se a ultima mensagem, sem nota e sem evento, e do paciente); jobs responder_com_ia pendentes de conversa fora da IA viram cancelado. Nada e enviado. Devolve {conversas, jobs}.';

-- ---------------------------------------------------------------------------
-- 10) RPCs de escrita, so do super admin
-- ---------------------------------------------------------------------------
-- Com sessao: so is_product_admin() (42501 para os demais). Sem sessao
-- (auth.uid() nulo): so service role ou conexao direta (SQL editor); anon
-- recebe 42501. Cada mudanca grava audit_log (action 'editou').

create function public.ia_exigir_equipe_conduzza()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza libera a IA.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza libera a IA.';
  end if;
end;
$$;

revoke all on function public.ia_exigir_equipe_conduzza()
  from public, anon, authenticated, service_role;

comment on function public.ia_exigir_equipe_conduzza() is
  'Interna. 42501 para sessao que nao e super admin e para anon; passa para o super admin, a service role e o SQL editor.';

create function public.definir_interruptor_da_ia(
  p_ligado boolean,
  p_motivo text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  v_clinicas uuid[];
  v_espera_anterior text;
begin
  perform public.ia_exigir_equipe_conduzza();
  if p_ligado is null then
    raise exception using errcode = '22004',
      message = 'Informe se a IA fica ligada ou desligada.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception using errcode = '22023',
      message = 'O motivo tem no máximo 500 caracteres.';
  end if;

  -- O upsert trava a linha unica ate o commit (ver a corrida na secao 9).
  insert into public.ia_interruptor as i (id, ligado, motivo, alterado_por, alterado_em)
  values (true, p_ligado, v_motivo, auth.uid(), now())
  on conflict (id) do update
    set ligado = excluded.ligado,
        motivo = excluded.motivo,
        alterado_por = excluded.alterado_por,
        alterado_em = excluded.alterado_em;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (null, auth.uid(), 'editou', 'ia_interruptor', null);

  -- Kill switch: a flag desligada fica gravada MESMO se a varredura falhar
  -- (conversa travada, erro numa clinica). Sem a flag nada responde: o E3
  -- reconfere ia_pode_atender antes do modelo e antes do envio. A espera
  -- por trava dentro da varredura tem prazo curto (55P03, que o bloco
  -- pega) para nao estourar o statement_timeout da API, que nenhum bloco
  -- pega e desfaria a flag junto. A falha vai para o audit_log, sem texto;
  -- o recuo esta no runbook (docs/04, 17.5).
  if not p_ligado then
    select coalesce(array_agg(l.clinic_id), '{}'::uuid[])
      into v_clinicas
      from public.ia_liberacao l;
    v_espera_anterior := current_setting('lock_timeout');
    begin
      perform set_config('lock_timeout', '2s', true);
      perform public.ia_desligar(v_clinicas);
      perform set_config('lock_timeout', v_espera_anterior, true);
    exception when others then
      -- o bloco desfeito devolve o lock_timeout anterior sozinho
      insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
      values (null, auth.uid(), 'editou', 'ia_interruptor_varredura_falhou', null);
    end;
  end if;

  return p_ligado;
end;
$$;

revoke all on function public.definir_interruptor_da_ia(boolean, text)
  from public, anon, authenticated;
grant execute on function public.definir_interruptor_da_ia(boolean, text)
  to authenticated, service_role;

comment on function public.definir_interruptor_da_ia(boolean, text) is
  'Liga ou desliga a IA em todas as clinicas (T6). Desligar devolve as conversas para a equipe e cancela os jobs (ia_desligar), sem enviar nada; se essa varredura falhar, a flag desligada fica gravada e o audit_log ganha entity ia_interruptor_varredura_falhou. So super admin, SQL editor ou service role (42501 para os demais). Grava audit_log. E o caminho de desligar (o UPDATE direto em ia_interruptor e so recuo). NUNCA chamar em teste: o banco e o da producao.';

create function public.definir_liberacao_da_ia(
  p_clinic_id uuid,
  p_liberada boolean,
  p_modo text default null,
  p_motivo text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  perform public.ia_exigir_equipe_conduzza();
  if p_clinic_id is null or p_liberada is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e se a IA fica liberada.';
  end if;
  if p_modo is not null and p_modo not in ('simulador', 'contatos') then
    raise exception using errcode = '22023',
      message = 'Modo inválido: use simulador ou contatos.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception using errcode = '22023',
      message = 'O motivo tem no máximo 500 caracteres.';
  end if;
  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002',
      message = 'Clínica não encontrada.';
  end if;

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- UPDATE antes do INSERT (nunca upsert): o ON CONFLICT dispara o gatilho
  -- de INSERT (T3a) mesmo com a linha existente, e desligar tem de passar.
  update public.ia_liberacao l
     set liberada = p_liberada,
         modo = coalesce(p_modo, l.modo),
         motivo = v_motivo,
         alterado_por = auth.uid()
   where l.clinic_id = p_clinic_id;
  if not found then
    insert into public.ia_liberacao (clinic_id, modo, liberada, motivo, alterado_por)
    values (p_clinic_id, coalesce(p_modo, 'simulador'), p_liberada, v_motivo, auth.uid());
  end if;

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_liberacao', p_clinic_id);

  return p_liberada;
end;
$$;

revoke all on function public.definir_liberacao_da_ia(uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.definir_liberacao_da_ia(uuid, boolean, text, text)
  to authenticated, service_role;

comment on function public.definir_liberacao_da_ia(uuid, boolean, text, text) is
  'Libera ou desliga a IA numa clinica (T3b) e escolhe o modo (simulador ou contatos; nulo mantem o atual, ou simulador na criacao). So clinicas da lista fechada ou e_de_teste (T3a, 42501). Devolve para a equipe as conversas que perderam a liberacao (ia_desligar). So super admin, SQL editor ou service role. Grava audit_log.';

create function public.definir_numero_da_ia(
  p_clinic_id uuid,
  p_whatsapp_account_id uuid,
  p_ativo boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ia_exigir_equipe_conduzza();
  if p_clinic_id is null or p_whatsapp_account_id is null or p_ativo is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, o número e se ele fica liberado.';
  end if;

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  update public.ia_numero_liberado n
     set clinic_id = p_clinic_id,
         ativo = p_ativo,
         alterado_por = auth.uid()
   where n.whatsapp_account_id = p_whatsapp_account_id;
  if not found then
    insert into public.ia_numero_liberado (whatsapp_account_id, clinic_id, ativo, alterado_por)
    values (p_whatsapp_account_id, p_clinic_id, p_ativo, auth.uid());
  end if;

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_numero_liberado', p_whatsapp_account_id);

  return p_ativo;
end;
$$;

revoke all on function public.definir_numero_da_ia(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.definir_numero_da_ia(uuid, uuid, boolean)
  to authenticated, service_role;

comment on function public.definir_numero_da_ia(uuid, uuid, boolean) is
  'Libera ou desliga um numero de WhatsApp para a IA (T4). Exige a clinica liberada antes (23503), numero da mesma clinica (23503) e nao removido ao ligar (23514). Desligar devolve as conversas do numero para a equipe. So super admin, SQL editor ou service role. Grava audit_log.';

create function public.definir_contato_liberado_da_ia(
  p_clinic_id uuid,
  p_telefone_e164 text,
  p_rotulo text,
  p_ativo boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_telefone text := btrim(p_telefone_e164);
  v_chave text;
  v_rotulo text := nullif(btrim(p_rotulo), '');
  v_id uuid;
begin
  perform public.ia_exigir_equipe_conduzza();
  if p_clinic_id is null or v_telefone is null or p_ativo is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, o telefone e se ele fica liberado.';
  end if;
  if v_telefone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023',
      message = 'Telefone inválido: use o formato internacional, por exemplo +5585999990000.';
  end if;
  if char_length(v_rotulo) > 80 then
    raise exception using errcode = '22023',
      message = 'O rótulo tem no máximo 80 caracteres.';
  end if;
  v_chave := public.chave_telefone(v_telefone);

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  update public.ia_contato_liberado k
     set ativo = p_ativo,
         rotulo = coalesce(v_rotulo, k.rotulo),
         alterado_por = auth.uid()
   where k.clinic_id = p_clinic_id
     and k.phone_key = v_chave
  returning k.id into v_id;
  if not found then
    insert into public.ia_contato_liberado (clinic_id, phone_key, rotulo, ativo, alterado_por)
    values (p_clinic_id, v_chave, v_rotulo, p_ativo, auth.uid())
    returning id into v_id;
  end if;

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_contato_liberado', v_id);

  return p_ativo;
end;
$$;

revoke all on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean)
  to authenticated, service_role;

comment on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean) is
  'Libera ou desliga um telefone (da equipe) para a IA conversar (T5). Normaliza com chave_telefone (com e sem o nono digito sao a mesma linha). Exige a clinica liberada antes (23503); telefone fora do E.164 ou rotulo acima de 80 caracteres dao 22023. Desligar devolve as conversas desse telefone para a equipe. So super admin, SQL editor ou service role. Grava audit_log.';

-- ---------------------------------------------------------------------------
-- 11) Entrar em 'ia_atendendo' exige ia_pode_atender (todos os caminhos)
-- ---------------------------------------------------------------------------
-- Hoje o membro com escrita grava o status pelo PostgREST (UPDATE e INSERT
-- de conversation). O gatilho vale para toda SESSAO (auth.uid() preenchido),
-- inclusive dentro de RPC security definer chamada por ela (devolver para a
-- IA). O codigo do servidor (service role, auth.uid() nulo) passa, como no
-- molde proteger_limite_de_numeros: nenhum caminho do servidor faz a IA agir
-- sem passar de novo por ia_pode_atender (ao enfileirar, antes do modelo e
-- imediatamente antes do envio), e as fixtures e o seed precisam montar
-- conversa da IA em clinica que nao esta no programa (onde o status nao faz
-- nada: nenhuma IA responde ali). Confere a ENTRADA no status (INSERT ou
-- UPDATE vindo de outro status) e a TROCA de contato de conversa que ja
-- esta na IA (a sessao tem UPDATE em contact_id: sem isso, a conversa do
-- telefone da equipe passava a apontar para um paciente sem sair da IA).
-- O numero e a clinica da conversa nao mudam depois de definidos
-- (conversa_ganha_numero). Conversa que ja estava na IA e nao trocou de
-- contato nao e reavaliada aqui (isso e o ia_desligar e o job do E3). Editar
-- contact.phone_e164 do contato tambem nao passa por aqui: fica barrado no
-- envio, que confere o telefone de destino logo antes do provedor (E3).
-- Roda depois de conversa_ganha_numero (ordem alfabetica), que preenche o
-- numero no INSERT. Antes de perguntar, trava FOR SHARE a linha da clinica
-- em ia_liberacao e a do interruptor (corrida com as RPCs, secao 9).

create function public.proteger_status_ia_atendendo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave text;
begin
  if new.status is distinct from 'ia_atendendo' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'ia_atendendo'
     and new.contact_id is not distinct from old.contact_id
  then
    return new;
  end if;
  -- Servidor (service role, SQL editor): guardado pelos outros pontos.
  if auth.uid() is null then
    return new;
  end if;

  perform 1 from public.ia_liberacao l where l.clinic_id = new.clinic_id for share;
  perform 1 from public.ia_interruptor i where i.id for share;

  select k.phone_key into v_chave
    from public.contact k
   where k.id = new.contact_id
     and k.clinic_id = new.clinic_id;

  if not public.ia_pode_atender(new.clinic_id, new.whatsapp_account_id, v_chave) then
    raise exception using errcode = '42501',
      message = 'A IA não está liberada para atender esta conversa.';
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_status_ia_atendendo()
  from public, anon, authenticated;

create trigger proteger_status_ia_atendendo
  before insert or update of status, contact_id on public.conversation
  for each row
  when (new.status = 'ia_atendendo')
  execute function public.proteger_status_ia_atendendo();

-- ---------------------------------------------------------------------------
-- 12) clinic.e_de_teste so muda pela equipe do Conduzza
-- ---------------------------------------------------------------------------
-- Molde proteger_limite_de_numeros (20260925130000): a policy de UPDATE de
-- clinic e do administrador da clinica (nome e fuso); e_de_teste e do
-- produto, e T3a confia nele. Sessao sem is_product_admin() nao cria
-- clinica de teste nem muda o valor. Service role e cadastro (auth.uid()
-- nulo) passam.

create function public.proteger_e_de_teste()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not public.is_product_admin()
     and (
       (tg_op = 'INSERT' and new.e_de_teste)
       or (tg_op = 'UPDATE'
           and new.e_de_teste is distinct from (
             case when tg_op = 'UPDATE' then old.e_de_teste end
           ))
     )
  then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza marca uma clínica como de teste.';
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_e_de_teste()
  from public, anon, authenticated;

create trigger proteger_e_de_teste
  before insert or update of e_de_teste on public.clinic
  for each row execute function public.proteger_e_de_teste();

-- ---------------------------------------------------------------------------
-- 13) 3.1: ai_agent_config (versoes) e knowledge_item
-- ---------------------------------------------------------------------------
-- Campos de docs/04 (secao 6) com status rascunho/publicada no lugar de
-- published. Versao publicada e imutavel (gatilho, P0001 para qualquer
-- papel); so rascunho se edita ou apaga pela sessao. published_at e
-- published_by sao do banco (o gatilho carimba ao publicar). A sessao nao
-- grava status nem os carimbos (grant por coluna): publicar fica para o E5,
-- pelo sistema, depois do filtro de conformidade.

create table public.ai_agent_config (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  version integer not null default 1
    constraint ai_agent_config_versao_positiva check (version > 0),
  status text not null default 'rascunho'
    constraint ai_agent_config_status_valido
      check (status in ('rascunho', 'publicada')),
  agent_name text not null default 'Assistente'
    constraint ai_agent_config_nome_preenchido check (btrim(agent_name) <> ''),
  tone text not null default 'cordial'
    constraint ai_agent_config_tom_valido
      check (tone in ('formal', 'cordial', 'proximo')),
  use_emoji boolean not null default false,
  greeting text,
  closing text,
  skills jsonb not null default '{}'::jsonb
    constraint ai_agent_config_skills_objeto check (jsonb_typeof(skills) = 'object'),
  operating_mode text not null default '24h'
    constraint ai_agent_config_modo_valido
      check (operating_mode in ('24h', 'fora_expediente', 'fallback')),
  fallback_minutes integer default 5
    constraint ai_agent_config_fallback_positivo
      check (fallback_minutes is null or fallback_minutes > 0),
  operating_hours jsonb,
  escalation_rules jsonb not null default '{}'::jsonb
    constraint ai_agent_config_regras_objeto
      check (jsonb_typeof(escalation_rules) = 'object'),
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_agent_config_versao_unica unique (clinic_id, version),
  constraint ai_agent_config_publicacao_coerente
    check ((status = 'publicada') = (published_at is not null))
);

create function public.proteger_versao_publicada_do_agente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'publicada' then
    raise exception using errcode = 'P0001',
      message = 'Versão publicada não muda: crie uma nova versão.';
  end if;
  if new.status = 'publicada' then
    new.published_at := now();
    new.published_by := auth.uid();
  else
    new.published_at := null;
    new.published_by := null;
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_versao_publicada_do_agente()
  from public, anon, authenticated;

create trigger proteger_versao_publicada_do_agente
  before insert or update on public.ai_agent_config
  for each row execute function public.proteger_versao_publicada_do_agente();

create trigger set_updated_at
  before update on public.ai_agent_config
  for each row execute function public.set_updated_at();

alter table public.ai_agent_config enable row level security;

revoke all on table public.ai_agent_config from anon, authenticated;
grant select, delete on table public.ai_agent_config to authenticated;
grant insert (
  clinic_id, version, agent_name, tone, use_emoji, greeting, closing, skills,
  operating_mode, fallback_minutes, operating_hours, escalation_rules
) on table public.ai_agent_config to authenticated;
grant update (
  version, agent_name, tone, use_emoji, greeting, closing, skills,
  operating_mode, fallback_minutes, operating_hours, escalation_rules
) on table public.ai_agent_config to authenticated;

create policy "membro ativo le a configuracao do agente"
  on public.ai_agent_config
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

create policy "gestao cria versao do agente"
  on public.ai_agent_config
  for insert to authenticated
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

create policy "gestao edita rascunho do agente"
  on public.ai_agent_config
  for update to authenticated
  using (
    status = 'rascunho'
    and public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  )
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

create policy "gestao apaga rascunho do agente"
  on public.ai_agent_config
  for delete to authenticated
  using (
    status = 'rascunho'
    and public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

comment on table public.ai_agent_config is
  'Configuracao do agente de IA por versao (3.1). status rascunho ou publicada; a publicada e imutavel (gatilho, P0001 para qualquer papel). Membro ativo le; administrador e gestor criam, editam e apagam rascunho. published_at e published_by sao carimbados pelo gatilho; a sessao nao grava status (publicar e do sistema, depois do filtro, no E5).';

create table public.knowledge_item (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  question text not null
    constraint knowledge_item_pergunta_preenchida check (btrim(question) <> ''),
  answer text not null
    constraint knowledge_item_resposta_preenchida check (btrim(answer) <> ''),
  source text not null default 'manual'
    constraint knowledge_item_origem_valida
      check (source in ('manual', 'correcao_humana', 'documento')),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_item_clinica_idx on public.knowledge_item (clinic_id);

create trigger set_updated_at
  before update on public.knowledge_item
  for each row execute function public.set_updated_at();

alter table public.knowledge_item enable row level security;

revoke all on table public.knowledge_item from anon, authenticated;
grant select, delete on table public.knowledge_item to authenticated;
grant insert (clinic_id, question, answer, source, active)
  on table public.knowledge_item to authenticated;
grant update (question, answer, source, active)
  on table public.knowledge_item to authenticated;

create policy "membro ativo le a base de conhecimento"
  on public.knowledge_item
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

create policy "gestao cria item de conhecimento"
  on public.knowledge_item
  for insert to authenticated
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

create policy "gestao edita item de conhecimento"
  on public.knowledge_item
  for update to authenticated
  using (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  )
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

create policy "gestao apaga item de conhecimento"
  on public.knowledge_item
  for delete to authenticated
  using (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

comment on table public.knowledge_item is
  'Base de conhecimento do agente (perguntas e respostas da clinica, 3.1). source manual, correcao_humana ou documento. Membro ativo le; administrador e gestor escrevem. created_by e o default auth.uid() (a sessao nao grava a coluna).';

-- ---------------------------------------------------------------------------
-- 14) ai_decision_log: colunas do filtro e CHECKs (tabela fria, 0 linhas)
-- ---------------------------------------------------------------------------
-- compliance_rule: as categorias do filtro (E1, lib/domain/conformidade/
-- categorias.ts). escalation_reason: codigos do plano de seguranca (2.4).
-- gatilho_entrada: os gatilhos do portao de entrada (E1). job_id sem FK (a
-- fila e podada); o gatilho de message do E3 procura por ele.

alter table public.ai_decision_log
  add column aprovado boolean,
  add column camada text,
  add column texto_sha256 text,
  add column agente_modelo text,
  add column verificador_modelo text,
  add column versao_filtro text,
  add column versao_prompt text,
  add column config_version integer,
  add column job_id uuid,
  add column tokens_entrada integer,
  add column tokens_saida integer,
  add column tokens_cache integer,
  add column gatilho_entrada text;

alter table public.ai_decision_log
  add constraint ai_decision_log_compliance_rule_valida
    check (compliance_rule is null or compliance_rule in (
      'triagem', 'orientacao_clinica', 'promessa_resultado', 'medicamento',
      'dosagem', 'diagnostico', 'oferta_casada', 'antes_depois',
      'preco_nao_verificado', 'formato_invalido', 'falha_verificador'
    )),
  add constraint ai_decision_log_escalation_reason_valida
    check (escalation_reason is null or escalation_reason in (
      'sintoma', 'pedido_humano', 'insatisfacao', 'menor_de_idade',
      'valor_fora_da_tabela', 'falhas_seguidas', 'assunto_clinico',
      'midia_nao_suportada', 'tentativa_de_manipulacao', 'conformidade',
      'agente_pediu', 'teto_atingido', 'regra_do_procedimento'
    )),
  add constraint ai_decision_log_camada_valida
    check (camada is null or camada in ('regra', 'modelo', 'falha')),
  add constraint ai_decision_log_gatilho_entrada_valido
    check (gatilho_entrada is null or gatilho_entrada in (
      'sintoma', 'assunto_clinico', 'pedido_humano', 'insatisfacao',
      'menor_de_idade', 'valor_fora_da_tabela', 'manipulacao', 'midia',
      'mensagem_longa'
    )),
  add constraint ai_decision_log_texto_sha256_formato
    check (texto_sha256 is null or texto_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint ai_decision_log_tokens_validos
    check (coalesce(tokens_entrada, 0) >= 0
           and coalesce(tokens_saida, 0) >= 0
           and coalesce(tokens_cache, 0) >= 0),
  add constraint ai_decision_log_aprovado_coerente
    check (aprovado is not true
           or (texto_sha256 is not null
               and not compliance_blocked
               and compliance_rule is null));

create index ai_decision_log_job_idx on public.ai_decision_log (job_id)
  where job_id is not null;

comment on column public.ai_decision_log.compliance_rule is
  'Categoria que bloqueou (filtro do E1): triagem, orientacao_clinica, promessa_resultado, medicamento, dosagem, diagnostico, oferta_casada, antes_depois, preco_nao_verificado, formato_invalido, falha_verificador.';
comment on column public.ai_decision_log.escalation_reason is
  'Codigo do motivo do escalonamento (plano de seguranca 2.4): sintoma, pedido_humano, insatisfacao, menor_de_idade, valor_fora_da_tabela, falhas_seguidas, assunto_clinico, midia_nao_suportada, tentativa_de_manipulacao, conformidade, agente_pediu, teto_atingido, regra_do_procedimento.';
comment on column public.ai_decision_log.aprovado is
  'O texto passou no filtro (regras limpas E verificador aprovou). Aprovado exige texto_sha256 e nenhum bloqueio.';
comment on column public.ai_decision_log.camada is
  'Camada que decidiu o bloqueio: regra (deterministica), modelo (verificador) ou falha (verificador fora, prazo, recusa, saida invalida).';
comment on column public.ai_decision_log.texto_sha256 is
  'sha256 hexadecimal do texto exato aprovado (o enviado byte a byte). O gatilho de message do E3 confere.';
comment on column public.ai_decision_log.gatilho_entrada is
  'Gatilho do portao de entrada que escalou antes do agente (E1): sintoma, assunto_clinico, pedido_humano, insatisfacao, menor_de_idade, valor_fora_da_tabela, manipulacao, midia, mensagem_longa.';
