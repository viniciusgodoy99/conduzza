-- ---------------------------------------------------------------------------
-- Painel geral do sistema, conta suspensa e agente por clinica (onda 1)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 20/10/2026, depois da reuniao com o Victor ("painel geral
-- de administracao... gerir essas contas, ativar, desativar conta"; "liberar
-- o agente pra essa clinica ou nao, liberar pra testar e liberar depois pra
-- producao. Porque vamos ter que controlar os gastos"). Plano em
-- ~/.claude/plans/onda1-painel/plano.md; esta migration e a secao 1 do
-- contrato entre as frentes (~/.claude/plans/onda1-painel/contrato.md).
-- Decisoes do dono de 20/10/2026:
--   - painel do sistema inteiro, so para a equipe Conduzza (super admin);
--   - desativar a conta = SUSPENDER mantendo os dados: a equipe da clinica
--     ve "Conta suspensa" ao entrar, os envios automaticos e a IA param, as
--     mensagens que chegam continuam gravadas e reativar volta como estava;
--   - agente por clinica em desligado, teste ou producao (producao so na
--     onda 2: aqui o CHECK so aceita desligado e teste);
--   - gasto de IA por clinica no painel, com o teto ajustavel pela equipe.
--
-- 1. CONTA SUSPENSA (tabela nova clinica_suspensa; zero ALTER em clinic).
--    clinica_esta_suspensa(uuid) responde ao envio (trava final em
--    enviarPeloCanal e no teste da regua, pela service role) e as funcoes
--    daqui; so a service role a executa (a sessao nao pergunta pela conta
--    de outra clinica). As tres funcoes de acesso das
--    policies (user_active_clinic_ids, user_has_role, user_can_write)
--    passam a excluir a clinica suspensa, SALVO para o super admin
--    (is_product_admin()): o membro de clinica suspensa nao le nem escreve
--    dado da clinica (RLS, Realtime e Storage passam por elas; fica o que
--    nao passa por elas: o proprio vinculo, a marca da clinica e o nome dos
--    colegas, nada de paciente), e a tela sabe o porque por
--    minhas_clinicas_suspensas() (molde: minhas_clinicas_pendentes). Sem
--    suspensao o resultado das tres e IDENTICO ao de antes: a condicao nova
--    e "nao existe linha de suspensao da clinica OU e super admin",
--    verdadeira para toda clinica nao suspensa (o ensaio compara as tres,
--    antes e depois, para todo vinculo). Em user_has_role e user_can_write
--    ela fica DEPOIS do exists do vinculo (o AND para no primeiro falso):
--    so roda quando o vinculo com o papel existe. Custo medido no harness
--    (Postgres 18, 5000 conversas, policy de conversation, que chama
--    user_has_role por linha): cerca de 1,2 microssegundo a mais por linha
--    quando o papel nao bate e 3,4 quando bate (a montagem do subplano a
--    mais em cada chamada da funcao SQL); user_active_clinic_ids roda uma
--    vez por consulta, sem diferenca medida.
--    suspender_clinica e reativar_clinica: so o super admin, a service role
--    e o SQL editor (42501 para os outros). Suspender grava a linha, devolve
--    as conversas do agente para a equipe (ia_desligar; nada e enviado) e
--    grava a trilha suspendeu_clinica {motivo}. Reativar apaga a linha,
--    CANCELA a mensagem automatica que venceu durante a suspensao (job
--    pendente da clinica com run_at ja passado, e o 'executando' de lease
--    vencido, que o motor pegaria de novo: status cancelado, last_error
--    'vencido_na_suspensao'; os futuros ficam), fecha como nao enviado o
--    toque de regua desse job (cadence_run: falha_envio /
--    vencido_na_suspensao; senao ficaria "na fila" para sempre em
--    Confirmacoes) e grava reativou_clinica {motivo, jobs_vencidos}. A
--    mensagem agendada desse job a reconciliacao do motor ja fecha como nao
--    enviada. O que nao manda mensagem ao paciente NAO e cancelado e segue
--    ao reativar, como estava: a midia que chega (baixar_midia) e as tres da
--    Meta (enviar_conversao_meta, que ja descarta o evento fora da janela de
--    7 dias e deixaria o conversion_event 'enfileirado' para sempre se
--    cancelado; sincronizar_gasto_meta; resolver_anuncio_meta). Qualquer
--    outro tipo, inclusive um que nasca depois, e cancelado: na duvida,
--    nada sai fora de hora.
--    O motor: claim_jobs_por_clinica nao reivindica job de clinica suspensa
--    (como ja nao reivindica de e_de_teste), MENOS 'baixar_midia': a midia
--    que chega e parte da mensagem recebida, que continua gravada (decisao
--    do dono); por isso reativar tambem nao a cancela. ia_jobs_devidos (e
--    com ela claim_jobs_da_ia, ia_estado_do_motor e disparar_ciclo_da_ia)
--    deixa de fora a clinica suspensa. ia_pode_atender e falso em clinica
--    suspensa; com ela ia_atende_no_whatsapp (que a chama), a ingestao, o
--    Devolver e o gatilho de status: conversa nova nao nasce na IA. A
--    ingestao em si nao muda (a mensagem que chega e gravada).
--    A saude do motor nao acusa o que a suspensao segura: saude_do_motor()
--    nao conta em 'atrasados' o job que o claim segura (o da clinica
--    suspensa, menos a midia), e reconciliar_mensagens_agendadas() nao conta
--    em 'presas' a agendada da clinica suspensa (a tarefa dela espera a
--    reativacao). Sem isso o monitor externo ficava vermelho (fila_atrasada,
--    agendadas_presas) a suspensao inteira e escondia uma parada de verdade.
--
-- 2. AGENTE POR CLINICA (sai a lista fixa). ia_clinica_habilitada (estado
--    'desligado' ou 'teste'; 'producao' entra no CHECK na onda 2), escrita
--    so por definir_agente_da_clinica (super admin), com trilha
--    mudou_agente_da_clinica {estado, motivo}. SEMEADA aqui com teste123 e
--    Conduzza Teste em 'teste', as duas da lista fixa: ao aplicar, nada muda.
--    ia_clinicas_da_fase_controlada() mantem nome e assinatura e passa de
--    IMMUTABLE (o array fixo) a STABLE: le as clinicas em 'teste', sem as
--    suspensas. As cerca de 15 funcoes que a usam continuam iguais (nenhuma
--    e IMMUTABLE; nao ha CHECK, indice, coluna gerada, policy nem view com
--    ela: conferido no catalogo da producao em 20/10/2026). Plano em cache
--    que dobrou a constante antiga nao fica velho: o Postgres registra a
--    dependencia da funcao dobrada e invalida o plano na troca (provado no
--    Postgres 17 e no 18 locais, com plpgsql em expressao simples e em
--    consulta). 'teste' liga a clinica pelo caminho que existe
--    (definir_liberacao_da_ia: gatilho ia_liberacao_so_na_lista, trava da
--    linha, trilha propria e ia_desligar), em modo contatos e liberada.
--    'desligado' tira a clinica da lista, poe a linha de liberacao (se
--    existe) em liberada = false (o gatilho deixa desligar sempre; assim o
--    teto continua ajustavel e voltar a 'teste' liga de novo) e devolve as
--    conversas do agente para a equipe (ia_desligar). Clinica e_de_teste e
--    recusada (as suites ligam a IA delas pelo caminho delas).
--    definir_teto_da_ia: o teto diario (1 a 100000 centavos de dolar, janela
--    movel de 24 h; zerar o gasto e o estado desligado) e as respostas por
--    conversa por hora (1 a 200), so na clinica que ja tem a linha de
--    liberacao, com trilha mudou_teto_da_ia {os dois, e os de antes}.
--
-- 3. PAINEL. painel_geral_das_clinicas(): so o super admin (e a service
--    role); uma linha por clinica (sem as e_de_teste, salvo
--    p_incluir_teste) e os totais, SO CONTAGENS. O formato e o que o leitor
--    da tela confere (lerPainelDoBanco em lib/queries/painel-geral.ts) e
--    esta no comentario da funcao. Os volumes da producao em 20/10/2026 sao
--    pequenos (499 contatos, 501 conversas, 7 linhas de ia_uso) e os indices
--    que a consulta usa ja existem (contact (clinic_id, first_contact_at),
--    conversation (clinic_id, created_at), ia_uso (clinic_id, created_at)):
--    nenhum indice novo.
--
-- Erros de regra: chaves que a tela traduz (app/(app)/painel-geral/
-- actions.ts) em P0001 (clinica_ja_suspensa, clinica_nao_suspensa,
-- clinica_de_teste, clinica_suspensa, sem_liberacao) e em 22023
-- (motivo_invalido, estado_invalido, teto_invalido, respostas_invalidas);
-- 42501 para quem nao e da equipe Conduzza; P0002 para clinica que nao
-- existe; 22004 para argumento nulo. Nunca 40001/40P01 (o PostgREST repete
-- sem limite). Nada aqui grava conteudo de mensagem, nome ou telefone de
-- paciente: o motivo e texto da equipe Conduzza.
--
-- Nove funcoes de producao mudam, todas a partir do corpo de PRODUCAO lido
-- em 20/10/2026 (fndef.js, so leitura) e guardado em
-- supabase/operacao/rollback/20261021100000-corpos-anteriores.sql com o md5
-- do prosrc de cada um (o ensaio confere que o banco ainda esta assim):
-- user_active_clinic_ids, user_has_role, user_can_write,
-- claim_jobs_por_clinica, ia_jobs_devidos, ia_pode_atender, saude_do_motor
-- e reconciliar_mensagens_agendadas ganham um trecho entre "-- [clinica
-- suspensa] inicio" e "... fim" (o resto e o corpo de producao linha a
-- linha); ia_clinicas_da_fase_controlada troca o corpo inteiro (entre "--
-- [agente por clinica] inicio" e "... fim") e a volatilidade. Security,
-- search_path e grants de cada uma ficam como eram (CREATE OR REPLACE
-- mantem os grants).
--
-- LOCKS: lock_timeout de 3 s. As duas FKs novas para clinic seguram SHARE
-- ROW EXCLUSIVE em clinic ate o commit (escrita em clinic espera; leitura
-- nao). As outras tabelas sao novas. Nenhum ALTER em message,
-- conversation, contact, clinic_member, job_queue nem clinic, e nenhuma
-- linha delas muda aqui.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo (o de hoje chama as
-- funcoes novas e le a lista do banco), DEPOIS, numa transacao, no SQL
-- editor, o arquivo supabase/operacao/rollback/
-- 20261021100000-corpos-anteriores.sql (as funcoes novas saem, os nove
-- corpos e comentarios de antes voltam, as duas tabelas saem). Clinica
-- suspensa volta a ver tudo; a lista volta a ser as duas clinicas fixas,
-- MESMO que outra tenha sido ligada em teste pelo painel (desligar antes:
-- definir_agente_da_clinica 'desligado').

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) Conta suspensa
-- ---------------------------------------------------------------------------

create table public.clinica_suspensa (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  suspensa_em timestamptz not null default now(),
  suspensa_por uuid,
  motivo text not null
    constraint clinica_suspensa_motivo_tamanho
      check (char_length(btrim(motivo)) between 3 and 300)
);

alter table public.clinica_suspensa enable row level security;

revoke all on table public.clinica_suspensa from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.clinica_suspensa from authenticated;

create policy "super admin le as clinicas suspensas"
  on public.clinica_suspensa
  for select to authenticated
  using (public.is_product_admin());

comment on table public.clinica_suspensa is
  'Conta suspensa pela equipe Conduzza (onda 1, decisao do dono de 20/10/2026): os dados ficam, a equipe da clinica nao le nem escreve nada (user_active_clinic_ids, user_has_role e user_can_write a excluem, salvo para o super admin), os envios automaticos e a IA param e as mensagens que chegam continuam gravadas. Uma linha por clinica suspensa; reativar apaga a linha. So o super admin le; escrita so por suspender_clinica e reativar_clinica, com trilha.';
comment on column public.clinica_suspensa.suspensa_por is
  'auth.uid() de quem suspendeu (nulo pela service role ou pelo SQL editor).';
comment on column public.clinica_suspensa.motivo is
  'Texto da equipe Conduzza, de 3 a 300 caracteres. Nunca dado de paciente.';

create function public.clinica_esta_suspensa(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinica_suspensa s where s.clinic_id = p_clinic_id
  )
$$;

-- So a service role: quem pergunta e o envio (enviarPeloCanal e o teste da
-- regua, pelo cliente de servico); as funcoes do banco a chamam como dono.
-- A sessao nao executa: um vinculo qualquer, ate pendente ou de outra
-- clinica, saberia se a conta de qualquer clinica esta suspensa.
revoke all on function public.clinica_esta_suspensa(uuid)
  from public, anon, authenticated;
grant execute on function public.clinica_esta_suspensa(uuid) to service_role;

comment on function public.clinica_esta_suspensa(uuid) is
  'A conta da clinica esta suspensa (clinica_suspensa)? Responde ao envio (enviarPeloCanal e o teste da regua, trava final) e as funcoes do banco. So o booleano. So service_role (e as funcoes do banco): a sessao nao executa.';

-- ---------------------------------------------------------------------------
-- 2) Agente por clinica: a lista deixa de ser fixa
-- ---------------------------------------------------------------------------

create table public.ia_clinica_habilitada (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  estado text not null
    constraint ia_clinica_habilitada_estado_valido
      check (estado in ('desligado', 'teste')),
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  motivo text
    constraint ia_clinica_habilitada_motivo_tamanho
      check (motivo is null or char_length(motivo) between 1 and 300)
);

alter table public.ia_clinica_habilitada enable row level security;

-- A sessao le so a clinica e o estado (o motivo e quem mudou ficam com a
-- equipe Conduzza: painel, SQL editor e trilha). Escrita so pela RPC.
revoke all on table public.ia_clinica_habilitada from anon, authenticated;
grant select (clinic_id, estado) on table public.ia_clinica_habilitada
  to authenticated;

create policy "super admin le o agente das clinicas"
  on public.ia_clinica_habilitada
  for select to authenticated
  using (public.is_product_admin());

create policy "membro ativo le o estado do agente da clinica"
  on public.ia_clinica_habilitada
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

comment on table public.ia_clinica_habilitada is
  'O agente de IA por clinica (onda 1): desligado ou teste (so os telefones da equipe, modo contatos). Producao entra no CHECK na onda 2. Sem linha = desligado. ia_clinicas_da_fase_controlada() le daqui as clinicas em teste, sem as suspensas. Escrita so por definir_agente_da_clinica (super admin), com trilha mudou_agente_da_clinica. A sessao le so clinic_id e estado (membro ativo da propria clinica e super admin).';

-- As duas clinicas da lista fixa de antes (teste123 e Conduzza Teste), em
-- teste: ao aplicar, a lista e a mesma. Pelo select em clinic (a FK exige a
-- clinica; num banco sem elas, nada e semeado).
insert into public.ia_clinica_habilitada (clinic_id, estado, motivo)
select c.id, 'teste', 'Lista fixa da fase controlada ate a migration 20261021100000'
  from public.clinic c
 where c.id in ('acd9c539-585e-4f2a-a195-712c70099564',  -- teste123
                'f0c115dd-e98c-4767-a1bb-93d517844852'); -- Conduzza Teste

create or replace function public.ia_clinicas_da_fase_controlada()
 RETURNS uuid[]
 LANGUAGE sql
 -- [agente por clinica] STABLE (era IMMUTABLE): le ia_clinica_habilitada
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  -- [agente por clinica] inicio
  -- Onda 1 (21/10/2026): a lista deixa de ser fixa. As clinicas com o
  -- agente em teste, sem as de conta suspensa, em ordem de id (a lista
  -- fixa de antes, teste123 e Conduzza Teste, ja estava nessa ordem).
  select coalesce(array_agg(h.clinic_id order by h.clinic_id), '{}'::uuid[])
    from public.ia_clinica_habilitada h
   where h.estado = 'teste'
     and not exists (
       select 1 from public.clinica_suspensa s where s.clinic_id = h.clinic_id
     )
  -- [agente por clinica] fim
$function$;

comment on function public.ia_clinicas_da_fase_controlada() is
  'As clinicas com o agente de IA em teste (ia_clinica_habilitada.estado = ''teste''), sem as suspensas (clinica_suspensa), em ordem de id. STABLE desde a onda 1 (antes, o array fixo de teste123 e Conduzza Teste). Nenhuma outra clinica ganha linha liberada em ia_liberacao (gatilho ia_liberacao_so_na_lista), salvo clinica e_de_teste. So service_role (e as funcoes do banco).';

-- ---------------------------------------------------------------------------
-- 3) As tres funcoes de acesso das policies: clinica suspensa fora, salvo
--    para o super admin
-- ---------------------------------------------------------------------------

create or replace function public.user_active_clinic_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select clinic_id from clinic_member
  where user_id = auth.uid() and status = 'ativo'
    -- [clinica suspensa] inicio
    -- Conta suspensa (onda 1, 21/10/2026): a clinica sai, salvo para o
    -- super admin. Sem suspensao a condicao e sempre verdadeira.
    and (not exists (
           select 1 from public.clinica_suspensa s
            where s.clinic_id = clinic_member.clinic_id
         )
         or public.is_product_admin())
    -- [clinica suspensa] fim
$function$;

create or replace function public.user_has_role(p_clinic_id uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from clinic_member
    where clinic_id = p_clinic_id
      and user_id = auth.uid()
      and status = 'ativo'
      and role = any (p_roles)
  )
  -- [clinica suspensa] inicio
  -- Conta suspensa (onda 1, 21/10/2026): falso, salvo para o super
  -- admin. Sem suspensao a condicao e sempre verdadeira; e so roda
  -- quando o vinculo acima existe.
  and (not exists (
         select 1 from public.clinica_suspensa s
          where s.clinic_id = p_clinic_id
       )
       or public.is_product_admin())
  -- [clinica suspensa] fim
$function$;

create or replace function public.user_can_write(p_clinic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from clinic_member
    where clinic_id = p_clinic_id
      and user_id = auth.uid()
      and status = 'ativo'
      and role in ('admin', 'gestor', 'recepcao', 'profissional')
  )
  -- [clinica suspensa] inicio
  -- Conta suspensa (onda 1, 21/10/2026): falso, salvo para o super
  -- admin. Sem suspensao a condicao e sempre verdadeira; e so roda
  -- quando o vinculo acima existe.
  and (not exists (
         select 1 from public.clinica_suspensa s
          where s.clinic_id = p_clinic_id
       )
       or public.is_product_admin())
  -- [clinica suspensa] fim
$function$;

comment on function public.user_active_clinic_ids() is
  'As clinicas em que a sessao e membro ATIVO, sem as de conta suspensa (clinica_suspensa), salvo para o super admin. Base das policies de leitura.';
comment on function public.user_has_role(uuid, text[]) is
  'A sessao e membro ATIVO da clinica com um dos papeis? Falso em clinica de conta suspensa, salvo para o super admin.';
comment on function public.user_can_write(uuid) is
  'Papel com permissao de escrita em dado de paciente. Exclui leitura. Falso em clinica de conta suspensa, salvo para o super admin.';

create function public.minhas_clinicas_suspensas()
returns table (clinic_id uuid, nome text, suspensa_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, s.suspensa_em
    from public.clinic_member m
    join public.clinic c on c.id = m.clinic_id
    join public.clinica_suspensa s on s.clinic_id = m.clinic_id
   where m.user_id = auth.uid()
     and m.status = 'ativo'
   order by c.name, c.id
$$;

revoke all on function public.minhas_clinicas_suspensas() from public, anon;
grant execute on function public.minhas_clinicas_suspensas()
  to authenticated, service_role;

comment on function public.minhas_clinicas_suspensas() is
  'Para a sessao: os vinculos ATIVOS do proprio usuario em clinica de conta suspensa (id, nome da clinica e quando foi suspensa), para a tela "Conta suspensa" (a RLS de clinic nao mostra a clinica suspensa a quem nao e super admin). So o proprio usuario; nada de paciente.';

-- ---------------------------------------------------------------------------
-- 4) O motor e a IA param na clinica suspensa
-- ---------------------------------------------------------------------------

create or replace function public.claim_jobs_por_clinica(p_worker text, p_max_clinicas integer, p_kinds text[], p_incluir_teste boolean DEFAULT false)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- Ramo 1: enterra o que travou sem tentativas restantes.
  update job_queue
  set status = 'falhou',
      last_error = coalesce(last_error, 'lease_expirado'),
      locked_by = null,
      locked_at = null
  where status = 'executando'
    and locked_at < now() - interval '180 seconds'
    and attempts >= max_attempts
    and kind = any(p_kinds);

  -- Ramos 2 e 3: um job elegivel por raia. Dentro da raia, a menor
  -- prioridade primeiro e, empatado, o mais atrasado: confirmacao vencida
  -- sai antes de follow-up. Entre raias, a mesma regra.
  return query
  with raia_numero as (
    select e.id, e.prioridade, e.run_at
    from whatsapp_account a
    join clinic c on c.id = a.clinic_id
    cross join lateral (
      select q.id, q.prioridade, q.run_at
      from job_queue q
      where q.whatsapp_account_id = a.id
        and q.kind = any(p_kinds)
        -- [clinica suspensa] inicio
        -- Conta suspensa (onda 1, 21/10/2026): nada da clinica sai, menos
        -- a midia que chega (a mensagem recebida continua gravada).
        and (q.kind = 'baixar_midia'
             or not exists (
               select 1 from public.clinica_suspensa s where s.clinic_id = c.id
             ))
        -- [clinica suspensa] fim
        and (
          (q.status = 'pendente' and q.run_at <= now())
          or (q.status = 'executando'
              and q.locked_at < now() - interval '180 seconds'
              and q.attempts < q.max_attempts)
        )
      order by q.prioridade, q.run_at
      limit 1
    ) e
    where (p_incluir_teste or not c.e_de_teste)
    order by e.prioridade, e.run_at
    limit p_max_clinicas
    for update of a skip locked
  ),
  raia_clinica as (
    select e.id, e.prioridade, e.run_at
    from clinic c
    cross join lateral (
      select q.id, q.prioridade, q.run_at
      from job_queue q
      where q.clinic_id = c.id
        and q.whatsapp_account_id is null
        and q.kind = any(p_kinds)
        -- [clinica suspensa] inicio
        -- Conta suspensa (onda 1, 21/10/2026): nada da clinica sai, menos
        -- a midia que chega (a mensagem recebida continua gravada).
        and (q.kind = 'baixar_midia'
             or not exists (
               select 1 from public.clinica_suspensa s where s.clinic_id = c.id
             ))
        -- [clinica suspensa] fim
        and (
          (q.status = 'pendente' and q.run_at <= now())
          or (q.status = 'executando'
              and q.locked_at < now() - interval '180 seconds'
              and q.attempts < q.max_attempts)
        )
      order by q.prioridade, q.run_at
      limit 1
    ) e
    where (p_incluir_teste or not c.e_de_teste)
    order by e.prioridade, e.run_at
    limit p_max_clinicas
    for update of c skip locked
  ),
  escolhidos as (
    select t.id
    from (
      select * from raia_numero
      union all
      select * from raia_clinica
    ) t
    order by t.prioridade, t.run_at
    limit p_max_clinicas
  )
  update job_queue j
  set status = 'executando',
      locked_by = p_worker,
      locked_at = now(),
      attempts = j.attempts + 1
  where j.id in (select escolhidos.id from escolhidos)
    and (
      (j.status = 'pendente' and j.run_at <= now())
      or (j.status = 'executando'
          and j.locked_at < now() - interval '180 seconds'
          and j.attempts < j.max_attempts)
    )
  returning j.*;
end;
$function$;

create or replace function public.ia_jobs_devidos(p_clinic_ids uuid[], p_incluir_teste boolean, p_folga interval)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  return query
  with vivos as (
    select q.id,
           q.payload ->> 'conversation_id' as conversa,
           q.status,
           q.run_at,
           q.locked_at,
           q.created_at,
           exists (
             select 1 from public.ai_turno t
              where t.job_id = q.id and t.estado = 'decidido'
           ) as decidido
      from public.job_queue q
      join public.clinic c on c.id = q.clinic_id
     where q.kind = 'responder_com_ia'
       and (p_clinic_ids is null or q.clinic_id = any (p_clinic_ids))
       and ((c.id = any (public.ia_clinicas_da_fase_controlada()) and not c.e_de_teste)
            or (coalesce(p_incluir_teste, false) and c.e_de_teste))
       -- [clinica suspensa] inicio
       -- Conta suspensa (onda 1, 21/10/2026): a clinica da lista ja sai
       -- dela; a e_de_teste, so aqui.
       and not exists (
         select 1 from public.clinica_suspensa s where s.clinic_id = c.id
       )
       -- [clinica suspensa] fim
       and (q.status = 'pendente'
            or (q.status = 'executando'
                and q.locked_at < now() - interval '90 seconds'
                and q.attempts < q.max_attempts))
  ),
  primeiro as (
    select distinct on (v.conversa) v.*
      from vivos v
     order by v.conversa, v.decidido desc, v.created_at, v.id
  )
  select p.id
    from primeiro p
   where ((p.status = 'pendente'
           and p.run_at <= now() - coalesce(p_folga, interval '0 seconds'))
          or (p.status = 'executando'
              and p.locked_at < now() - interval '90 seconds'
                                - coalesce(p_folga, interval '0 seconds')))
     and not exists (
       select 1 from public.job_queue o
        where o.kind = 'responder_com_ia'
          and o.status = 'executando'
          and o.payload ->> 'conversation_id' = p.conversa
          and o.locked_at >= now() - interval '90 seconds'
     );
end;
$function$;

create or replace function public.ia_pode_atender(p_clinic_id uuid, p_whatsapp_account_id uuid, p_phone_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.ia_liberacao_vigente(p_clinic_id, array['contatos'])
    -- [clinica suspensa] inicio
    -- Conta suspensa (onda 1, 21/10/2026): conversa nova nao nasce na IA
    -- (a clinica da lista ja sai dela; a e_de_teste, so aqui).
    and not exists (
      select 1 from public.clinica_suspensa s where s.clinic_id = p_clinic_id
    )
    -- [clinica suspensa] fim
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
$function$;

comment on function public.claim_jobs_por_clinica(text, integer, text[], boolean) is
  'Claim do motor por raia (numero, ou clinica para job sem numero): um job por raia, a menor prioridade e o mais atrasado primeiro. Clinica e_de_teste so com p_incluir_teste. Clinica de conta suspensa: so a midia que chega (baixar_midia); o resto espera a reativacao, que cancela a mensagem automatica que venceu.';
comment on function public.ia_jobs_devidos(uuid[], boolean, interval) is
  'Os jobs responder_com_ia devidos (um por conversa), das clinicas da lista (ou de teste, com a flag), sem as de conta suspensa.';
comment on function public.ia_pode_atender(uuid, uuid, text) is
  'A IA pode atender este telefone (phone_key, ou o E.164, que vira a chave) neste numero desta clinica? Combina T3a, T3b, T4, T5, T6, T7, modo contatos e o teto das ultimas 24 horas. Falso em clinica de conta suspensa. Clinica e_de_teste fora da lista: so em numero de provedor fake. Nulo em qualquer argumento: falso. So service_role (e as funcoes do banco).';

-- A saude do motor (o monitor externo, /api/webhooks/saude, e a faixa da
-- tela) nao acusa o que a suspensao segura de proposito: o job que o claim
-- nao reivindica (o da clinica suspensa, menos a midia) nao e atraso do
-- motor, e a agendada da clinica suspensa, com a tarefa segurada, nao e
-- trilho parado. Ao reativar, os dois voltam a contar (e o que venceu e
-- cancelado; a reconciliacao fecha a agendada).

create or replace function public.saude_do_motor()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ia jsonb;
begin
  -- [resposta da ia] inicio
  if (auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role')
     or public.is_product_admin()
  then
    v_ia := public.ia_estado_do_motor();
  end if;
  -- [resposta da ia] fim

  return jsonb_build_object(
    'fila', (
      select jsonb_build_object(
        'batida_em', batida_em,
        'ultimo_lote', ultimo_lote,
        'ultimo_erro', ultimo_erro
      )
      from worker_heartbeat where worker_id = 'motor-fila'
    ),
    'planner', (
      select jsonb_build_object(
        'batida_em', batida_em,
        'ultimo_lote', ultimo_lote,
        'ultimo_erro', ultimo_erro
      )
      from worker_heartbeat where worker_id = 'motor-planner'
    ),
    'atrasados', (
      select count(*) from job_queue
      where status = 'pendente' and run_at < now() - interval '5 minutes'
        -- [clinica suspensa] inicio
        -- Conta suspensa (onda 1, 21/10/2026): o job que o claim segura (o
        -- da clinica suspensa, menos a midia) nao e atraso do motor. Sem
        -- suspensao a condicao e sempre verdadeira.
        and (kind = 'baixar_midia'
             or not exists (
               select 1 from public.clinica_suspensa s
                where s.clinic_id = job_queue.clinic_id
             ))
        -- [clinica suspensa] fim
    )
    -- [resposta da ia] inicio
    , 'ia', v_ia
    -- [resposta da ia] fim
  );
end;
$function$;

create or replace function public.reconciliar_mensagens_agendadas(p_limite integer DEFAULT 200, p_clinic_id uuid DEFAULT NULL::uuid, p_incluir_teste boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  r text;
  v_antes text := current_setting('conduzza.agendada_pelo_sistema', true);
  v_limite integer := greatest(1, least(coalesce(p_limite, 200), 1000));
  v_env integer := 0;
  v_nao integer := 0;
  v_retidas integer := 0;
  v_presas integer;
  v_erros integer := 0;
begin
  for v in
    select a.id
      from public.mensagem_agendada a
      join public.clinic c on c.id = a.clinic_id
      left join public.job_queue j on j.id = a.job_id
     where a.situacao = 'enviando'
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
       and (p_incluir_teste or not c.e_de_teste)
       and (
         j.id is null
         or j.status in ('falhou', 'cancelado', 'concluido')
         or exists (
           select 1 from public.message m
            where m.job_id = a.job_id
              and m.delivery_status in ('enviada', 'entregue', 'lida')
         )
       )
     order by a.enviar_em
     limit v_limite
  loop
    begin
      r := public.reconciliar_mensagem_agendada(v.id);
      if r = 'enviada' then
        v_env := v_env + 1;
      elsif r in ('nao_enviada', 'nao_confirmada') then
        v_nao := v_nao + 1;
      end if;
    exception when others then
      v_erros := v_erros + 1;
      raise warning 'reconciliar_mensagens_agendadas: agendada % (%)', v.id, sqlstate;
    end;
  end loop;

  -- Retencao (A5): o texto de paciente nao fica para sempre numa agendada
  -- que ninguem dispensou.
  perform set_config('conduzza.agendada_pelo_sistema', 'sim', true);
  with velhas as (
    select a.id
      from public.mensagem_agendada a
      join public.clinic c on c.id = a.clinic_id
     where a.situacao in ('nao_enviada', 'nao_confirmada')
       and a.dispensada_em is null
       and a.encerrada_em < now() - interval '30 days'
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
       and (p_incluir_teste or not c.e_de_teste)
     order by a.encerrada_em
     limit v_limite
     for update of a skip locked
  )
  update public.mensagem_agendada a
     set dispensada_em = now(),
         dispensada_por = null,
         texto = null
    from velhas
   where a.id = velhas.id;
  get diagnostics v_retidas = row_count;
  perform set_config('conduzza.agendada_pelo_sistema', coalesce(v_antes, ''), true);

  select count(*) into v_presas
    from public.mensagem_agendada a
    join public.clinic c on c.id = a.clinic_id
   where a.situacao = 'enviando'
     and a.enviar_em < now() - interval '13 hours'
     and (p_clinic_id is null or a.clinic_id = p_clinic_id)
     -- [clinica suspensa] inicio
     -- Conta suspensa (onda 1, 21/10/2026): a tarefa da agendada espera a
     -- reativacao (que a cancela se venceu, e a reconciliacao fecha a
     -- agendada); nao e trilho parado.
     and not exists (
       select 1 from public.clinica_suspensa s where s.clinic_id = a.clinic_id
     )
     -- [clinica suspensa] fim
     and (p_incluir_teste or not c.e_de_teste);

  return jsonb_build_object(
    'fechadas_enviadas', v_env,
    'fechadas_sem_envio', v_nao,
    'retidas', v_retidas,
    'presas', v_presas,
    'erros_por_linha', v_erros
  );
end;
$function$;

comment on function public.saude_do_motor() is
  'A prova de vida do motor: as batidas da fila e do planner, os atrasados (job pendente com run_at vencido ha mais de 5 minutos, sem o que a suspensao segura: o job da clinica de conta suspensa, menos a midia que chega) e, para a service role e o super admin, o estado do motor da IA.';
comment on function public.reconciliar_mensagens_agendadas(integer, uuid, boolean) is
  'Fecha as agendadas em enviando cujo job terminou (ou cuja mensagem saiu), aplica a retencao de 30 dias e conta as presas (enviando ha mais de 13 horas), sem a clinica e_de_teste (salvo p_incluir_teste) e sem a clinica de conta suspensa (a tarefa dela espera a reativacao). So service_role.';

-- ---------------------------------------------------------------------------
-- 5) Suspender e reativar
-- ---------------------------------------------------------------------------

create function public.suspender_clinica(p_clinic_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza suspende a conta de uma clínica.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza suspende a conta de uma clínica.';
  end if;
  if p_clinic_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica.';
  end if;
  if v_motivo is null or char_length(v_motivo) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'motivo_invalido',
      hint = 'O motivo tem de 3 a 300 caracteres.';
  end if;
  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;

  -- A mesma ordem de travas das definir_*_da_ia e da ingestao: a linha de
  -- liberacao da IA da clinica primeiro. A ingestao que ia por uma conversa
  -- na IA agora espera esta transacao e ja ve a conta suspensa.
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  insert into public.clinica_suspensa (clinic_id, suspensa_por, motivo)
  values (p_clinic_id, auth.uid(), v_motivo)
  on conflict (clinic_id) do nothing;
  if not found then
    raise exception using errcode = 'P0001', message = 'clinica_ja_suspensa';
  end if;

  -- As conversas com o agente voltam para a equipe (ia_pode_atender ja e
  -- falso aqui); os jobs da IA pendentes saem. Nada e enviado.
  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (p_clinic_id, auth.uid(), 'suspendeu_clinica', 'clinic', p_clinic_id,
          jsonb_build_object('motivo', v_motivo));
end;
$$;

revoke all on function public.suspender_clinica(uuid, text) from public, anon;
grant execute on function public.suspender_clinica(uuid, text)
  to authenticated, service_role;

comment on function public.suspender_clinica(uuid, text) is
  'Suspende a conta da clinica mantendo os dados (onda 1). So super admin, service role e SQL editor (42501). Motivo de 3 a 300 caracteres (22023 motivo_invalido); clinica que nao existe P0002; ja suspensa P0001 clinica_ja_suspensa. Devolve as conversas do agente para a equipe (ia_desligar) e grava a trilha suspendeu_clinica {motivo}.';

create function public.reativar_clinica(p_clinic_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
  v_jobs integer := 0;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza reativa a conta de uma clínica.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza reativa a conta de uma clínica.';
  end if;
  if p_clinic_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica.';
  end if;
  if v_motivo is null or char_length(v_motivo) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'motivo_invalido',
      hint = 'O motivo tem de 3 a 300 caracteres.';
  end if;
  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;

  delete from public.clinica_suspensa s where s.clinic_id = p_clinic_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'clinica_nao_suspensa';
  end if;

  -- A mensagem automatica que venceu durante a suspensao nao sai mais: o
  -- job pendente da clinica com run_at ja passado e o 'executando' de lease
  -- vencido (o motor o pegaria de novo) viram cancelado. Os futuros ficam.
  -- O que nao manda mensagem ao paciente segue, como estava: a midia que
  -- chega (o claim nunca a segurou) e as tres da Meta (a conversao, que o
  -- job ja descarta fora da janela de 7 dias e cujo conversion_event
  -- ficaria 'enfileirado' para sempre; a leitura do gasto; a consulta do
  -- anuncio). Qualquer outro tipo, inclusive um novo, e cancelado. O toque
  -- de regua do job cancelado fecha como nao enviado; a mensagem agendada a
  -- reconciliacao do motor fecha sozinha (job cancelado).
  with vencidos as (
    update public.job_queue j
       set status = 'cancelado',
           last_error = 'vencido_na_suspensao',
           locked_by = null,
           locked_at = null
     where j.clinic_id = p_clinic_id
       and j.kind not in ('baixar_midia', 'enviar_conversao_meta',
                          'sincronizar_gasto_meta', 'resolver_anuncio_meta')
       and ((j.status = 'pendente' and j.run_at < now())
            or (j.status = 'executando'
                and j.locked_at < now() - interval '180 seconds'))
    returning j.id, j.kind, j.payload
  ),
  toques as (
    update public.cadence_run r
       set skipped_reason = 'falha_envio',
           motivo_da_falha = 'vencido_na_suspensao'
      from vencidos v
     where v.kind = 'executar_passo_de_regua'
       and r.id::text = v.payload ->> 'cadence_run_id'
       and r.clinic_id = p_clinic_id
       and r.sent_at is null
       and r.skipped_reason is null
    returning r.id
  )
  select count(*) into v_jobs from vencidos;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (p_clinic_id, auth.uid(), 'reativou_clinica', 'clinic', p_clinic_id,
          jsonb_build_object('motivo', v_motivo, 'jobs_vencidos', v_jobs));

  return jsonb_build_object('jobs_vencidos', v_jobs);
end;
$$;

revoke all on function public.reativar_clinica(uuid, text) from public, anon;
grant execute on function public.reativar_clinica(uuid, text)
  to authenticated, service_role;

comment on function public.reativar_clinica(uuid, text) is
  'Reativa a conta da clinica (onda 1). So super admin, service role e SQL editor (42501). Motivo de 3 a 300 caracteres (22023 motivo_invalido); clinica que nao existe P0002; conta nao suspensa P0001 clinica_nao_suspensa. Cancela a mensagem automatica que venceu durante a suspensao (job pendente com run_at passado e executando de lease vencido, menos o que nao manda mensagem ao paciente: baixar_midia, enviar_conversao_meta, sincronizar_gasto_meta e resolver_anuncio_meta seguem; last_error vencido_na_suspensao), fecha o toque de regua desses jobs (falha_envio, vencido_na_suspensao) e grava a trilha reativou_clinica {motivo, jobs_vencidos}. Devolve {"jobs_vencidos": n}.';

-- ---------------------------------------------------------------------------
-- 6) O agente e o teto, pelo painel
-- ---------------------------------------------------------------------------

create function public.definir_agente_da_clinica(
  p_clinic_id uuid,
  p_estado text,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  v_de_teste boolean;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  perform public.ia_exigir_equipe_conduzza();
  if p_clinic_id is null or p_estado is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e o estado do agente.';
  end if;
  if p_estado not in ('desligado', 'teste') then
    raise exception using errcode = '22023', message = 'estado_invalido',
      hint = 'Use desligado ou teste. Produção chega na onda 2.';
  end if;
  if char_length(v_motivo) > 300 then
    raise exception using errcode = '22023', message = 'motivo_invalido',
      hint = 'O motivo tem no máximo 300 caracteres.';
  end if;
  select c.e_de_teste into v_de_teste from public.clinic c where c.id = p_clinic_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;
  if v_de_teste then
    -- As suites automatizadas ligam a IA das clinicas e_de_teste pelo
    -- caminho delas (definir_liberacao_da_ia); elas nunca entram na lista.
    raise exception using errcode = 'P0001', message = 'clinica_de_teste';
  end if;
  if p_estado = 'teste' and public.clinica_esta_suspensa(p_clinic_id) then
    raise exception using errcode = 'P0001', message = 'clinica_suspensa';
  end if;

  -- A mesma ordem de travas das definir_*_da_ia: a linha de liberacao
  -- primeiro, depois a do estado.
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  insert into public.ia_clinica_habilitada as h
    (clinic_id, estado, alterado_em, alterado_por, motivo)
  values (p_clinic_id, p_estado, now(), auth.uid(), v_motivo)
  on conflict (clinic_id) do update
     set estado = excluded.estado,
         alterado_em = excluded.alterado_em,
         alterado_por = excluded.alterado_por,
         motivo = excluded.motivo;

  if p_estado = 'teste' then
    -- A clinica acabou de entrar na lista: fica liberada em modo contatos
    -- (so os telefones da equipe) pelo caminho que ja existe.
    perform public.definir_liberacao_da_ia(p_clinic_id, true, 'contatos', v_motivo);
  else
    -- Fora da lista a IA ja nao atende; a linha de liberacao fica desligada
    -- (o gatilho ia_liberacao_so_na_lista deixa desligar sempre) e as
    -- conversas do agente voltam para a equipe.
    update public.ia_liberacao l
       set liberada = false,
           motivo = v_motivo,
           alterado_por = auth.uid()
     where l.clinic_id = p_clinic_id
       and l.liberada;
    perform public.ia_desligar(array[p_clinic_id]);
  end if;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (p_clinic_id, auth.uid(), 'mudou_agente_da_clinica', 'ia_clinica_habilitada',
          p_clinic_id, jsonb_build_object('estado', p_estado, 'motivo', v_motivo));
end;
$$;

revoke all on function public.definir_agente_da_clinica(uuid, text, text) from public, anon;
grant execute on function public.definir_agente_da_clinica(uuid, text, text)
  to authenticated, service_role;

comment on function public.definir_agente_da_clinica(uuid, text, text) is
  'O agente de IA da clinica: desligado ou teste (onda 1; producao na onda 2: 22023 estado_invalido). So super admin, service role e SQL editor (42501). Clinica e_de_teste: P0001 clinica_de_teste; teste em conta suspensa: P0001 clinica_suspensa. Teste: a clinica entra na lista e fica liberada em modo contatos (definir_liberacao_da_ia). Desligado: sai da lista, a liberacao fica desligada e as conversas do agente voltam para a equipe. Trilha mudou_agente_da_clinica {estado, motivo}.';

create function public.definir_teto_da_ia(
  p_clinic_id uuid,
  p_teto_diario_centavos_usd integer,
  p_teto_respostas_por_conversa_hora integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes record;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  perform public.ia_exigir_equipe_conduzza();
  if p_clinic_id is null
     or p_teto_diario_centavos_usd is null
     or p_teto_respostas_por_conversa_hora is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e os dois tetos.';
  end if;
  if p_teto_diario_centavos_usd not between 1 and 100000 then
    raise exception using errcode = '22023', message = 'teto_invalido',
      hint = 'O teto diário vai de 1 a 100000 centavos de dólar.';
  end if;
  if p_teto_respostas_por_conversa_hora not between 1 and 200 then
    raise exception using errcode = '22023', message = 'respostas_invalidas',
      hint = 'As respostas por conversa por hora vão de 1 a 200.';
  end if;
  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;

  select l.teto_diario_centavos_usd, l.teto_respostas_por_conversa_hora, l.liberada
    into v_antes
    from public.ia_liberacao l
   where l.clinic_id = p_clinic_id
     for update;
  if not found then
    -- O teto mora na linha de liberacao, que nasce quando o agente e ligado
    -- em teste pela primeira vez.
    raise exception using errcode = 'P0001', message = 'sem_liberacao';
  end if;
  if v_antes.liberada and public.clinica_esta_suspensa(p_clinic_id) then
    -- A clinica suspensa sai da lista e o gatilho ia_liberacao_so_na_lista
    -- recusaria a linha liberada (42501): a chave da tela no lugar.
    raise exception using errcode = 'P0001', message = 'clinica_suspensa';
  end if;

  update public.ia_liberacao l
     set teto_diario_centavos_usd = p_teto_diario_centavos_usd,
         teto_respostas_por_conversa_hora = p_teto_respostas_por_conversa_hora,
         alterado_por = auth.uid()
   where l.clinic_id = p_clinic_id;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (p_clinic_id, auth.uid(), 'mudou_teto_da_ia', 'ia_liberacao', p_clinic_id,
          jsonb_build_object(
            'teto_diario_centavos_usd', p_teto_diario_centavos_usd,
            'teto_respostas_por_conversa_hora', p_teto_respostas_por_conversa_hora,
            'antes', jsonb_build_object(
              'teto_diario_centavos_usd', v_antes.teto_diario_centavos_usd,
              'teto_respostas_por_conversa_hora', v_antes.teto_respostas_por_conversa_hora)));
end;
$$;

revoke all on function public.definir_teto_da_ia(uuid, integer, integer) from public, anon;
grant execute on function public.definir_teto_da_ia(uuid, integer, integer)
  to authenticated, service_role;

comment on function public.definir_teto_da_ia(uuid, integer, integer) is
  'Os tetos da IA da clinica (ia_liberacao): o diario em centavos de dolar, de 1 a 100000 (22023 teto_invalido; janela movel de 24 h; para zerar o gasto, o agente desligado), e as respostas por conversa por hora, de 1 a 200 (22023 respostas_invalidas). So super admin, service role e SQL editor (42501). Sem a linha de liberacao: P0001 sem_liberacao; liberada em conta suspensa: P0001 clinica_suspensa. Trilha mudou_teto_da_ia {os dois e os de antes}.';

-- ---------------------------------------------------------------------------
-- 7) O painel geral
-- ---------------------------------------------------------------------------

create function public.painel_geral_das_clinicas(p_incluir_teste boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_painel jsonb;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza vê o painel geral.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza vê o painel geral.';
  end if;

  -- SO CONTAGENS: de paciente, nada alem de quantos. O gasto vem de ia_uso
  -- (custo_microdolar; US$ 1 = 1.000.000) com as reservas, como o teto
  -- conta, em centavos de dolar arredondados (10.000 microdolares = 1
  -- centavo): as ultimas 24 horas (a janela movel do teto) e o mes corrente
  -- no fuso da clinica; "sem simulador" tira a origem simulador. Os totais
  -- arredondam a soma das clinicas, nao somam os arredondados.
  with clinicas as (
    select c.id,
           c.name,
           c.created_at,
           c.timezone,
           date_trunc('month', now() at time zone coalesce(nullif(c.timezone, ''), 'America/Fortaleza'))
             at time zone coalesce(nullif(c.timezone, ''), 'America/Fortaleza') as inicio_do_mes
      from public.clinic c
     where coalesce(p_incluir_teste, false) or not c.e_de_teste
  ),
  membros as (
    select m.clinic_id,
           count(*) filter (where m.status = 'ativo') as ativos,
           count(*) filter (where m.status = 'pendente') as pendentes,
           coalesce(
             jsonb_agg(jsonb_build_object('nome', p.name, 'email', u.email)
                       order by lower(coalesce(p.name, u.email, '')), m.user_id)
               filter (where m.status = 'ativo' and m.role = 'admin'),
             '[]'::jsonb) as administradores
      from public.clinic_member m
      left join public.profile p on p.user_id = m.user_id
      left join auth.users u on u.id = m.user_id
     where m.clinic_id in (select k.id from clinicas k)
     group by m.clinic_id
  ),
  numeros as (
    select w.clinic_id,
           count(*) as total,
           count(*) filter (where w.connection_status = 'conectado') as conectados,
           jsonb_agg(jsonb_build_object(
               'id', w.id,
               'nome', w.nome,
               'final', case
                 when char_length(regexp_replace(coalesce(w.display_phone, ''), '[^0-9]', '', 'g')) >= 4
                 then right(regexp_replace(w.display_phone, '[^0-9]', '', 'g'), 4)
               end,
               'conexao', w.connection_status,
               'ia_ligada', coalesce(n.ativo, false))
             order by w.principal desc, w.created_at, w.id) as lista
      from public.whatsapp_account w
      left join public.ia_numero_liberado n
        on n.whatsapp_account_id = w.id
       and n.clinic_id = w.clinic_id
     where w.removido_em is null
       and w.clinic_id in (select k.id from clinicas k)
     group by w.clinic_id
  ),
  contatos as (
    select t.clinic_id,
           count(*) as total,
           count(*) filter (where t.first_contact_at >= now() - interval '30 days') as novos_30
      from public.contact t
     where t.clinic_id in (select k.id from clinicas k)
     group by t.clinic_id
  ),
  conversas as (
    select v.clinic_id,
           count(*) filter (where v.created_at >= now() - interval '30 days') as criadas_30,
           max(v.last_inbound_at) as ultima_recebida
      from public.conversation v
     where v.clinic_id in (select k.id from clinicas k)
     group by v.clinic_id
  ),
  telefones as (
    select t.clinic_id, count(*) as ligados
      from public.ia_contato_liberado t
     where t.ativo
     group by t.clinic_id
  ),
  gasto as (
    select u.clinic_id,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= now() - interval '24 hours'), 0) as d24,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= k.inicio_do_mes), 0) as mes,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= now() - interval '24 hours'
                       and u.origem <> 'simulador'), 0) as d24_sem_simulador,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= k.inicio_do_mes
                       and u.origem <> 'simulador'), 0) as mes_sem_simulador
      from public.ia_uso u
      join clinicas k on k.id = u.clinic_id
     where u.created_at >= least(now() - interval '24 hours', k.inicio_do_mes)
     group by u.clinic_id
  )
  select jsonb_build_object(
           'totais', jsonb_build_object(
             'clinicas', count(*),
             'ativas', count(*) filter (where s.clinic_id is null),
             'suspensas', count(*) filter (where s.clinic_id is not null),
             'agente_em_teste', count(*) filter (where h.estado = 'teste'),
             'gasto_24h_centavos_usd', round(coalesce(sum(g.d24), 0) / 10000.0)::bigint,
             'gasto_mes_centavos_usd', round(coalesce(sum(g.mes), 0) / 10000.0)::bigint),
           'clinicas', coalesce(jsonb_agg(jsonb_build_object(
               'id', k.id,
               'nome', k.name,
               'criada_em', k.created_at,
               'fuso', k.timezone,
               'membros_ativos', coalesce(m.ativos, 0),
               'membros_pendentes', coalesce(m.pendentes, 0),
               'administradores', coalesce(m.administradores, '[]'::jsonb),
               'numeros_total', coalesce(n.total, 0),
               'numeros_conectados', coalesce(n.conectados, 0),
               'numeros', coalesce(n.lista, '[]'::jsonb),
               'contatos', coalesce(ct.total, 0),
               'leads_30_dias', coalesce(ct.novos_30, 0),
               'conversas_30_dias', coalesce(cv.criadas_30, 0),
               'ultima_mensagem_em', cv.ultima_recebida,
               'suspensao', case when s.clinic_id is not null then
                 jsonb_build_object('suspensa_em', s.suspensa_em, 'motivo', s.motivo)
               end,
               'agente', jsonb_build_object(
                 'estado', coalesce(h.estado, 'desligado'),
                 'modo', l.modo,
                 'liberada', coalesce(l.liberada, false),
                 'pausada_pela_clinica', coalesce(l.pausada_pela_clinica, false),
                 'telefones_ligados', coalesce(t.ligados, 0)),
               'gasto', jsonb_build_object(
                 'ultimas_24h_centavos_usd', round(coalesce(g.d24, 0) / 10000.0)::bigint,
                 'mes_centavos_usd', round(coalesce(g.mes, 0) / 10000.0)::bigint,
                 'ultimas_24h_sem_simulador_centavos_usd',
                   round(coalesce(g.d24_sem_simulador, 0) / 10000.0)::bigint,
                 'mes_sem_simulador_centavos_usd',
                   round(coalesce(g.mes_sem_simulador, 0) / 10000.0)::bigint),
               'teto_diario_centavos_usd', l.teto_diario_centavos_usd)
             order by lower(k.name), k.id), '[]'::jsonb))
    into v_painel
    from clinicas k
    left join membros m on m.clinic_id = k.id
    left join numeros n on n.clinic_id = k.id
    left join contatos ct on ct.clinic_id = k.id
    left join conversas cv on cv.clinic_id = k.id
    left join telefones t on t.clinic_id = k.id
    left join gasto g on g.clinic_id = k.id
    left join public.clinica_suspensa s on s.clinic_id = k.id
    left join public.ia_clinica_habilitada h on h.clinic_id = k.id
    left join public.ia_liberacao l on l.clinic_id = k.id;

  return v_painel;
end;
$$;

revoke all on function public.painel_geral_das_clinicas(boolean) from public, anon;
grant execute on function public.painel_geral_das_clinicas(boolean)
  to authenticated, service_role;

comment on function public.painel_geral_das_clinicas(boolean) is
  'Painel geral do sistema (onda 1), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros). SO CONTAGENS, nenhum dado de paciente. Clinicas e_de_teste so com p_incluir_teste. Formato (lido por lerPainelDoBanco em lib/queries/painel-geral.ts): {"totais": {"clinicas", "ativas", "suspensas", "agente_em_teste", "gasto_24h_centavos_usd", "gasto_mes_centavos_usd"}, "clinicas": [{"id", "nome", "criada_em", "fuso", "membros_ativos", "membros_pendentes", "administradores": [{"nome", "email"}] (ativos com papel admin; dado da equipe), "numeros_total", "numeros_conectados" (sem os removidos), "numeros": [{"id", "nome", "final" (4 ultimos digitos ou null), "conexao" (connection_status), "ia_ligada"}], "contatos", "leads_30_dias" (first_contact_at), "conversas_30_dias" (created_at), "ultima_mensagem_em" (max last_inbound_at ou null), "suspensao": null ou {"suspensa_em", "motivo"}, "agente": {"estado" (desligado sem linha), "modo" (null sem liberacao), "liberada", "pausada_pela_clinica", "telefones_ligados"}, "gasto": {"ultimas_24h_centavos_usd", "mes_centavos_usd", "ultimas_24h_sem_simulador_centavos_usd", "mes_sem_simulador_centavos_usd"}, "teto_diario_centavos_usd" (null sem liberacao)}] (por nome)}. Gasto de ia_uso com as reservas (como o teto), em centavos de dolar arredondados; mes corrente no fuso da clinica; os totais arredondam a soma.';
