-- ---------------------------------------------------------------------------
-- E3, a IA no WhatsApp so com os telefones da equipe: fila, tabelas frias e
-- funcoes (13/10/2026)
-- ---------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/10/2026 ("pode"), com as recomendacoes de
-- todas as decisoes: ~/.claude/plans/e3-whatsapp/plano.md (revisao 2) e o
-- contrato comum ~/.claude/plans/e3-whatsapp/contrato.md. A IA so existe na
-- teste123 (acd9c539) e na Conduzza Teste (f0c115dd), sempre por id. A frase
-- fixa (D5) continua PROVISORIA.
--
-- Esta e a M1 de tres (ordem de APLICACAO: M1 20261013100000, M3
-- 20261013110000 com o gatilho de message, M2 20261013120000 com as funcoes
-- quentes da ingestao e do celular). Nenhum ALTER TABLE em message,
-- conversation ou contact em nenhuma das tres.
--
-- O que faz, na ordem do arquivo:
--
--   1. ai_turno (estado do turno, um por job) e ia_janela_da_conversa (de
--      onde o historico comeca e com qual contato e telefone). RLS ligada,
--      sem policy: so a service role le e escreve. Depois a coluna
--      ia_contato_liberado.forcado (D-B da revisao de 13/10/2026: telefone
--      com sinal de paciente ligado com o "forcar" pela equipe Conduzza) e o
--      gatilho que so deixa definir_contato_liberado_da_ia forcar.
--   2. ai_decision_log (fria, 0 linhas): motivos novos de escalonamento
--      (falha_tecnica, teto_de_respostas, nao_individual, pedido_de_agenda),
--      colunas desfecho e motivo_da_falha, coerencia leve do desfecho e o
--      grant de leitura da sessao por COLUNA, sem blocked_draft (o rascunho
--      bloqueado pode ser dado de saude). Depois ai_rascunho_bloqueado, a
--      unica casa do rascunho, lida so por ler_rascunho_bloqueado (D25: so a
--      equipe Conduzza nesta fase).
--   3. Funcoes novas: decisao (telefone_e_numero_da_plataforma,
--      contato_tem_sinal_de_paciente, ia_atende_no_whatsapp COM o teto de
--      24 h, ia_pode_falar_com SEM o teto; as duas recusam telefone com
--      sinal de paciente que nao foi forcado), o criterio unico de "devido"
--      (ia_jobs_devidos) e o estado do motor (ia_estado_do_motor, interna),
--      textos (frase fixa e eventos),
--      escrita na conversa (ia_tirar_conversa interna,
--      passar_conversa_da_ia_para_equipe, gravar_evento_da_ia,
--      tirar_conversa_da_ia_pelo_servidor, devolver_para_ia,
--      ia_devolver_disponivel, ia_marcar_respondida), fila
--      (enfileirar_resposta_da_ia, claim_jobs_da_ia, ia_pode_enviar_agora,
--      disparar_ciclo_da_ia, motor_ia_agendar, motor_ia_desagendar), leitura
--      (ler_rascunho_bloqueado, situacao_da_ia_na_clinica) e a funcao do
--      gatilho de message (mensagem_ia_exige_aprovacao; o gatilho e a M3).
--   4. CREATE OR REPLACE das funcoes frias, partindo do corpo de producao de
--      13/10/2026: saude_do_motor (chave ia), definir_liberacao_da_ia e
--      definir_numero_da_ia (ligar o WhatsApp so pela equipe Conduzza),
--      definir_contato_liberado_da_ia (assinatura NOVA com
--      p_forcar_contato_existente; recusa numero da plataforma e telefone de
--      paciente), ia_desligar (evento no fio), proteger_status_ia_atendendo
--      (pela sessao, so devolver_para_ia poe conversa na IA),
--      motor_manutencao (varredura da IA e retencoes) e claim_jobs (o legado
--      nao pega nem enterra o kind novo).
--   5. Por ultimo, job_queue: CHECK de kind com 'responder_com_ia' (e
--      'enviar_mensagem_agendada', que continua), CHECK do payload (so ids) e
--      o indice unico parcial que junta a rajada so em job que nunca rodou.
--
-- Regras gerais: corrida usa CZ409 (NUNCA 40001 nem 40P01: o PostgREST
-- repete esses sem limite). Nas funcoes NOVAS a mensagem de erro e uma
-- chave snake_case (o TS traduz). Nenhuma mensagem de erro, last_error,
-- payload, evento ou audit_log leva texto, nome ou telefone de paciente.
-- SQLSTATE proprios: CZ409, CZIA1 (ia_sem_aprovacao), CZIA2
-- (ia_nao_liberada), CZIA3 (frase_divergente).
--
-- NADA LIGA SOZINHO: a migration nao chama motor_ia_agendar(), nao libera
-- numero nem telefone, nao mexe no interruptor nem em ia_liberacao. Com a
-- teste123 em simulador e o interruptor desligado, todas as funcoes novas
-- dizem nao.
--
-- LOCKS: APLICAR DE MADRUGADA. lock_timeout de 5 s. Ordem fixa: clinic
-- (SHARE ROW EXCLUSIVE, pelas FKs dos CREATE TABLE, instante), depois
-- ia_contato_liberado em ACCESS EXCLUSIVE (fria, poucas linhas: ADD COLUMN
-- com default constante, so catalogo, e o CREATE TRIGGER), depois
-- ai_decision_log em ACCESS EXCLUSIVE (fria, 0 linhas), e por ULTIMO
-- job_queue em ACCESS EXCLUSIVE (troca do CHECK, validacao de cerca de 1100
-- linhas e o indice parcial), para a fila ficar parada o menor tempo
-- possivel (alvo: menos de 1 s). As funcoes em SQL que leem job_queue pegam
-- so ACCESS SHARE ate o fim. Se cair por 55P03, nada fica gravado: tentar de
-- novo minutos depois. Nenhuma trava em message, conversation ou contact
-- alem de ACCESS SHARE de leitura de catalogo.
--
-- ROLLBACK manual, nesta ordem:
--   0. ANTES de tudo, publicar o codigo sem o E3 (motor da IA, rota,
--      envio, actions): com as funcoes fora, essas chamadas falham.
--   1. select public.motor_ia_desagendar(); (se a entrada 'motor-ia' existir)
--   2. update public.job_queue set status = 'cancelado', last_error =
--      'rollback' where kind = 'responder_com_ia' and status in
--      ('pendente', 'executando');
--   3. (a M3 sai antes desta: drop dos dois gatilhos de message)
--   4. reaplicar os corpos ANTERIORES de claim_jobs, motor_manutencao,
--      saude_do_motor, definir_liberacao_da_ia, definir_numero_da_ia,
--      ia_desligar e proteger_status_ia_atendendo, lidos da producao antes
--      desta migration e guardados em
--      supabase/operacao/rollback/20261013100000-corpos-anteriores.sql;
--      no mesmo arquivo, drop da definir_contato_liberado_da_ia nova
--      (uuid, text, text, boolean, boolean) e create da antiga (uuid, text,
--      text, boolean) com os grants de antes;
--   5. drop das funcoes novas: mensagem_ia_exige_aprovacao,
--      situacao_da_ia_na_clinica, ler_rascunho_bloqueado,
--      motor_ia_desagendar, motor_ia_agendar, disparar_ciclo_da_ia,
--      ia_pode_enviar_agora, claim_jobs_da_ia, enfileirar_resposta_da_ia,
--      ia_marcar_respondida, ia_devolver_disponivel, devolver_para_ia,
--      tirar_conversa_da_ia_pelo_servidor, gravar_evento_da_ia,
--      passar_conversa_da_ia_para_equipe, ia_tirar_conversa,
--      rotulo_do_motivo_da_ia, frase_de_escalonamento_da_ia,
--      ia_estado_do_motor, ia_jobs_devidos,
--      ia_pode_falar_com, ia_atende_no_whatsapp,
--      contato_tem_sinal_de_paciente, telefone_e_numero_da_plataforma;
--   6. drop table public.ai_rascunho_bloqueado, public.ai_turno,
--      public.ia_janela_da_conversa; drop trigger
--      ia_contato_liberado_forcado_so_pela_funcao on ia_contato_liberado,
--      drop function ia_contato_liberado_forcado_so_pela_funcao() e drop
--      column ia_contato_liberado.forcado;
--   7. ai_decision_log: drop constraint ai_decision_log_desfecho_coerente,
--      drop column desfecho, drop column motivo_da_falha, CHECK de
--      escalation_reason com os 13 motivos de antes (so depois de apagar
--      linhas com os 4 motivos novos) e o grant como estava: revoke all on
--      public.ai_decision_log from anon, authenticated; grant all on
--      public.ai_decision_log to anon, authenticated;
--   8. job_queue: drop index public.job_queue_resposta_da_ia_nova; drop
--      constraint job_queue_ia_tem_conversa; delete from public.job_queue
--      where kind = 'responder_com_ia' (message.job_id e on delete set
--      null); job_queue_kind_check sem 'responder_com_ia' e COM
--      'enviar_mensagem_agendada';
--   9. notify pgrst, 'reload schema';
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) Tabelas frias novas (FK para clinic: SHARE ROW EXCLUSIVE em clinic,
--    instante). Sem FK para conversation, message ou job_queue: nada de
--    trava nas tabelas quentes, e a fila e podada.
-- ---------------------------------------------------------------------------

create table public.ai_turno (
  job_id uuid primary key,                         -- sem FK: a fila e podada
  clinic_id uuid not null references public.clinic(id) on delete cascade,
  conversation_id uuid not null,                   -- sem FK: evita trava em conversation
  estado text not null
    constraint ai_turno_estado_valido check (estado in
      ('reservado', 'decidido', 'passou_para_equipe', 'enviado', 'sem_envio')),
  reserva_id uuid,                                 -- reserva viva em ia_uso
  reservas_perdidas uuid[] not null default '{}',  -- reservas de tentativas cortadas (so auditoria)
  saida text
    constraint ai_turno_saida_valida check (saida in ('resposta', 'frase', 'nenhuma')),
  texto text
    constraint ai_turno_texto_tamanho check (texto is null or length(texto) <= 4000),
  texto_sha256 text
    constraint ai_turno_sha_formato check (texto_sha256 is null or texto_sha256 ~ '^[0-9a-f]{64}$'),
  decision_id uuid,                                -- ai_decision_log.id (sem FK)
  mensagens_lidas uuid[] not null default '{}',    -- ids das mensagens PENDENTES do paciente que o turno respondeu
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_turno_texto_coerente
    check (texto is null or (saida = 'resposta' and texto_sha256 is not null))
);
create index ai_turno_conversa_idx on public.ai_turno (conversation_id);
create index ai_turno_criado_idx on public.ai_turno (created_at);
create trigger set_updated_at before update on public.ai_turno
  for each row execute function public.set_updated_at();
alter table public.ai_turno enable row level security;   -- sem policy: so service role
revoke all on public.ai_turno from anon, authenticated;

comment on table public.ai_turno is
  'Estado do turno da IA no WhatsApp, um por job responder_com_ia. Texto so '
  'enquanto pode sair (apagado ao enviar, ao desistir e pela varredura em 1 h).';

create table public.ia_janela_da_conversa (
  conversation_id uuid primary key,                -- sem FK: evita trava em conversation
  clinic_id uuid not null references public.clinic(id) on delete cascade,
  contact_id uuid not null,
  phone_key text not null
    constraint ia_janela_telefone_valido check (phone_key ~ '^\+[1-9][0-9]{7,14}$'),
  desde timestamptz not null,
  aberta_por text not null
    constraint ia_janela_aberta_por_valida check (aberta_por in ('ingestao', 'devolver')),
  updated_at timestamptz not null default now()
);
alter table public.ia_janela_da_conversa enable row level security;  -- sem policy
revoke all on public.ia_janela_da_conversa from anon, authenticated;

comment on table public.ia_janela_da_conversa is
  'De quando a IA pode ler a conversa (desde) e com qual contato e chave de '
  'telefone. Gravada pela ingestao (conversa nova na IA) e por devolver_para_ia. '
  'Janela aberta pela ingestao (conversa nova) vale para a conversa inteira.';

-- D-B (revisao de 13/10/2026): o telefone da equipe que tambem tem sinal de
-- paciente so aciona o assistente quando a equipe Conduzza o ligou com o
-- "forcar" (fica registrado em audit_log). Sem o forcar, o sinal de paciente
-- barra em todo lugar (ingestao, fila, guarda, gatilho, varredura,
-- Devolver), inclusive quando o contato vira paciente DEPOIS de ligado.
-- Tabela fria: ADD COLUMN com default constante so mexe no catalogo.
alter table public.ia_contato_liberado
  add column forcado boolean not null default false;

comment on column public.ia_contato_liberado.forcado is
  'Ligado com o forcar (telefone com sinal de paciente). So '
  'definir_contato_liberado_da_ia grava; desligado nunca fica forcado.';

-- So definir_contato_liberado_da_ia forca (flag local da transacao
-- conduzza.forcar_telefone_da_ia); qualquer outro caminho (service role,
-- seed, SQL solto) recebe 42501 so_pelo_forcar. Trocar o telefone ou a
-- clinica de uma linha ja forcada conta como forcar de novo (o forcar vale
-- para AQUELE telefone NAQUELA clinica, com a trilha em audit_log): sem a
-- funcao, 42501 tambem. Telefone desligado volta a forcado = false sozinho.
create function public.ia_contato_liberado_forcado_so_pela_funcao()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not new.ativo then
    new.forcado := false;
    return new;
  end if;
  if new.forcado
     and (tg_op = 'INSERT'
          or not old.forcado
          or new.phone_key is distinct from old.phone_key
          or new.clinic_id is distinct from old.clinic_id)
     and current_setting('conduzza.forcar_telefone_da_ia', true) is distinct from 'sim'
  then
    raise exception using errcode = '42501', message = 'so_pelo_forcar';
  end if;
  return new;
end;
$function$;

create trigger ia_contato_liberado_forcado_so_pela_funcao
  before insert or update on public.ia_contato_liberado
  for each row execute function public.ia_contato_liberado_forcado_so_pela_funcao();

-- ---------------------------------------------------------------------------
-- 2) ai_decision_log (fria, 0 linhas em producao) e ai_rascunho_bloqueado
-- ---------------------------------------------------------------------------

lock table public.ai_decision_log in access exclusive mode;

alter table public.ai_decision_log
  drop constraint ai_decision_log_escalation_reason_valida,
  add constraint ai_decision_log_escalation_reason_valida
    check (escalation_reason is null or escalation_reason in (
      'sintoma', 'pedido_humano', 'insatisfacao', 'menor_de_idade',
      'valor_fora_da_tabela', 'falhas_seguidas', 'assunto_clinico',
      'midia_nao_suportada', 'tentativa_de_manipulacao', 'conformidade',
      'agente_pediu', 'teto_atingido', 'regra_do_procedimento',
      'falha_tecnica', 'teto_de_respostas', 'nao_individual', 'pedido_de_agenda'));

alter table public.ai_decision_log
  add column desfecho text
    constraint ai_decision_log_desfecho_valido
      check (desfecho is null or desfecho in ('respondeu', 'escalou', 'bloqueou', 'falhou')),
  add column motivo_da_falha text
    constraint ai_decision_log_motivo_da_falha_valido
      check (motivo_da_falha is null or motivo_da_falha in (
        'sem_cliente', 'modelo_invalido', 'prazo', 'timeout', 'conexao', 'abortado',
        'limite', 'cota', 'sobrecarga', 'servidor', 'requisicao_invalida',
        'autenticacao', 'permissao', 'nao_encontrado', 'outro_http', 'recusa',
        'max_tokens', 'parada_inesperada', 'saida_invalida', 'incoerente',
        'confianca_baixa', 'contexto_truncado', 'desconhecida',
        'rodadas_esgotadas', 'ferramenta_invalida', 'liberacao_suspensa',
        'sem_identificador', 'sem_mensagem'));

alter table public.ai_decision_log
  add constraint ai_decision_log_desfecho_coerente check (
    (desfecho is distinct from 'respondeu' or aprovado is true)
    and (desfecho is distinct from 'bloqueou' or compliance_blocked));

-- A sessao le todas as colunas MENOS blocked_draft. A escrita e so do
-- servidor (service role, que nao e afetada). A policy de SELECT de hoje
-- continua.
revoke all on public.ai_decision_log from anon, authenticated;
grant select (
  id, clinic_id, conversation_id, message_id, tool_used, context_read,
  escalation_reason, compliance_blocked, compliance_rule, latency_ms, created_at,
  aprovado, camada, texto_sha256, agente_modelo, verificador_modelo,
  versao_filtro, versao_prompt, config_version, job_id,
  tokens_entrada, tokens_saida, tokens_cache, gatilho_entrada,
  desfecho, motivo_da_falha
) on public.ai_decision_log to authenticated;

create table public.ai_rascunho_bloqueado (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic(id) on delete cascade,
  decision_id uuid not null references public.ai_decision_log(id) on delete cascade,
  conversation_id uuid not null,                   -- sem FK
  job_id uuid not null,                            -- sem FK
  texto text not null
    constraint ai_rascunho_bloqueado_texto_tamanho check (length(texto) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint ai_rascunho_bloqueado_um_por_decisao unique (decision_id)
);
create index ai_rascunho_bloqueado_criado_idx on public.ai_rascunho_bloqueado (created_at);
alter table public.ai_rascunho_bloqueado enable row level security;  -- sem policy
revoke all on public.ai_rascunho_bloqueado from anon, authenticated;

comment on table public.ai_rascunho_bloqueado is
  'Rascunho que o filtro do CFM barrou (pode ter dado de saude). Lido so por '
  'ler_rascunho_bloqueado, com audit_log. Retencao de 90 dias.';

-- ---------------------------------------------------------------------------
-- 3) Funcoes de decisao
-- ---------------------------------------------------------------------------

-- Telefone que e numero de WhatsApp de QUALQUER clinica do Conduzza (nao
-- removido). A normalizacao e a do filtro numero_proprio da ingestao.
create function public.telefone_e_numero_da_plataforma(p_telefone text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    nullif(btrim(p_telefone), '') is not null
    and exists (
      select 1
        from public.whatsapp_account a
       where a.removido_em is null
         and a.display_phone is not null
         and length(regexp_replace(a.display_phone, '\D', '', 'g'))
             between 10 and 15
         and public.chave_telefone(
               '+' || regexp_replace(a.display_phone, '\D', '', 'g')
             ) = public.chave_telefone(btrim(p_telefone))
    ),
    false
  )
$function$;

-- Contato da clinica com essa chave que tem sinal de paciente: cadastrado
-- como paciente, com consulta (qualquer status), vindo de campanha ou
-- anuncio, ou importado. Mensagens antigas NAO contam (o celular de quem
-- testa provavelmente ja conversou com a clinica).
create function public.contato_tem_sinal_de_paciente(p_clinic_id uuid, p_phone_key text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(exists (
    select 1
      from public.contact k
     where k.clinic_id = p_clinic_id
       and k.phone_key = public.chave_telefone(btrim(p_phone_key))
       and (
         k.kind = 'paciente'
         or k.source_campaign is not null
         or k.source_campaign_id is not null
         or k.source_ad_id is not null
         or k.ctwa_clid is not null
         or k.source_google_campaign_id is not null
         or k.criado_por_importacao
         or exists (
           select 1
             from public.appointment a
            where a.clinic_id = p_clinic_id
              and a.contact_id = k.id
         )
       )
  ), false)
$function$;

-- A IA pode COMECAR a atender (conversa nova, Devolver): ia_pode_atender
-- (com o teto de 24 h), versao publicada, telefone que nao e numero da
-- plataforma e, com sinal de paciente, so o telefone forcado (D-B).
create function public.ia_atende_no_whatsapp(
  p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text
)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    public.ia_pode_atender(p_clinic_id, p_whatsapp_account_id, p_telefone)
    and exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
    and exists (
      select 1
        from public.ai_agent_config c
       where c.clinic_id = p_clinic_id
         and c.status = 'publicada'
    )
    and not public.telefone_e_numero_da_plataforma(p_telefone),
    false
  )
$function$;

-- A IA pode CONTINUAR falando (conversa que ja esta na IA): as mesmas
-- condicoes de ia_atende_no_whatsapp SEM o teto de 24 h (o teto decide na
-- reserva; com ele estourado, a frase fixa sai, D44). Escrito por extenso.
-- O contato que vira paciente depois de ligado (sem o forcar) deixa de
-- falar com a IA na hora (D-B).
create function public.ia_pode_falar_com(
  p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text
)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    exists (
      select 1
        from public.clinic c
        join public.ia_liberacao l on l.clinic_id = c.id
        left join public.ia_interruptor i on i.id
       where c.id = p_clinic_id
         and (
               (c.id = any (public.ia_clinicas_da_fase_controlada())
                and coalesce(i.ligado, false))
               or (c.e_de_teste
                   and not (c.id = any (public.ia_clinicas_da_fase_controlada())))
             )
         and l.liberada
         and not l.pausada_pela_clinica
         and l.modo = 'contatos'
    )
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
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
    and exists (
      select 1
        from public.ai_agent_config c
       where c.clinic_id = p_clinic_id
         and c.status = 'publicada'
    )
    and not public.telefone_e_numero_da_plataforma(p_telefone),
    false
  )
$function$;

-- O criterio UNICO de "devido" da resposta da IA (B4 da revisao): o claim
-- (folga 0), a guarda do pg_cron (folga 0, so a lista) e a saude do motor
-- (folga de 60 s) contam os mesmos jobs. Por conversa, so o job VIVO mais
-- antigo (com prioridade ao que ja decidiu) pode rodar, e so se estiver
-- devido e nenhum outro da conversa estiver executando com lease valido:
-- mensagem nova durante o turno, ou job atras de um em retry, nao e devido.
-- p_clinic_ids nulo: todas as clinicas (com o filtro da lista abaixo).
-- Security invoker: o claim roda pela service role e a saude e a guarda
-- (definer) pelo dono. Le so job_queue, clinic e ai_turno, sem travar.
-- plpgsql de proposito: uma funcao SQL validaria o corpo no CREATE e
-- pegaria ACCESS SHARE em job_queue ja aqui; assim a fila so e travada no
-- ultimo bloco da migration.
create function public.ia_jobs_devidos(
  p_clinic_ids uuid[], p_incluir_teste boolean, p_folga interval
)
returns setof uuid
language plpgsql
stable
set search_path to ''
as $function$
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

-- INTERNA (so o dono, de dentro de saude_do_motor e de
-- situacao_da_ia_na_clinica). O motor da IA: entrada 'motor-ia' no pg_cron
-- (lida so quando o esquema cron existe), vigiado (liberacao em contatos de
-- clinica da lista com o interruptor ligado), devidos ha mais de 60 s pelo
-- criterio unico e o alerta.
create function public.ia_estado_do_motor()
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_agendado boolean := false;
  v_vigiado boolean;
  v_devidos integer;
begin
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = $1)'
      into v_agendado
      using 'motor-ia';
  end if;

  v_vigiado := exists (
    select 1
      from public.ia_liberacao l
     where l.clinic_id = any (public.ia_clinicas_da_fase_controlada())
       and l.liberada
       and not l.pausada_pela_clinica
       and l.modo = 'contatos'
  ) and coalesce((select i.ligado from public.ia_interruptor i where i.id), false);

  select count(*) into v_devidos
    from public.ia_jobs_devidos(null, false, interval '60 seconds');

  return jsonb_build_object(
    'batida_em', (select h.batida_em from public.worker_heartbeat h where h.worker_id = 'motor-ia'),
    'ultimo_erro', (select h.ultimo_erro from public.worker_heartbeat h where h.worker_id = 'motor-ia'),
    'agendado', coalesce(v_agendado, false),
    'vigiado', v_vigiado,
    'devidos', v_devidos,
    'alerta', v_vigiado and (v_devidos > 0 or not coalesce(v_agendado, false))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Textos (espelhos em lib/domain/conformidade/frase-fixa.ts e
-- TEXTO_DO_EVENTO_DA_IA em lib/domain/agente/config.ts)
-- ---------------------------------------------------------------------------

-- Frase fixa PROVISORIA (D5). Quando o dono aprovar outro texto, muda aqui e
-- no TS na mesma leva.
create function public.frase_de_escalonamento_da_ia()
returns text
language sql
immutable
set search_path to ''
as $function$
  select 'Recebi sua mensagem. Vou passar sua conversa para alguém da nossa equipe, que vai te responder por aqui assim que possível.'::text
$function$;

-- Corpo do evento no fio por motivo (um por linha, lido pelo teste de
-- espelho). Motivo desconhecido ou nulo: nulo.
create function public.rotulo_do_motivo_da_ia(p_motivo text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_motivo
    when 'sintoma' then 'A IA passou a conversa para a equipe: o paciente descreveu um sintoma.'
    when 'pedido_humano' then 'A IA passou a conversa para a equipe: o paciente pediu para falar com uma pessoa.'
    when 'insatisfacao' then 'A IA passou a conversa para a equipe: o paciente demonstrou insatisfação.'
    when 'menor_de_idade' then 'A IA passou a conversa para a equipe: o paciente é menor de idade.'
    when 'valor_fora_da_tabela' then 'A IA passou a conversa para a equipe: o assunto envolve valor fora da tabela.'
    when 'falhas_seguidas' then 'A IA passou a conversa para a equipe: o assistente não resolveu em duas tentativas.'
    when 'assunto_clinico' then 'A IA passou a conversa para a equipe: o assunto é clínico.'
    when 'midia_nao_suportada' then 'A IA passou a conversa para a equipe: o paciente mandou um conteúdo que o assistente não lê.'
    when 'tentativa_de_manipulacao' then 'A IA passou a conversa para a equipe: a mensagem tentou mudar o comportamento do assistente.'
    when 'conformidade' then 'A IA passou a conversa para a equipe: a resposta não passou na conformidade.'
    when 'agente_pediu' then 'A IA passou a conversa para a equipe: o assistente preferiu passar para a equipe.'
    when 'teto_atingido' then 'A IA passou a conversa para a equipe: o limite de gasto de hoje acabou.'
    when 'regra_do_procedimento' then 'A IA passou a conversa para a equipe: o procedimento pede contato da equipe.'
    when 'falha_tecnica' then 'A IA passou a conversa para a equipe: o assistente teve uma falha técnica.'
    when 'teto_de_respostas' then 'A IA passou a conversa para a equipe: o limite de respostas desta conversa na última hora acabou.'
    when 'pedido_de_agenda' then 'A IA passou a conversa para a equipe: o paciente quer marcar, remarcar ou cancelar.'
    when 'nao_individual' then 'Chegou uma mensagem de grupo ou de status. A conversa voltou para a equipe.'
    when 'fora_do_horario' then 'A IA passou a conversa para a equipe: agora está fora do horário escolhido para o assistente.'
    when 'horario_nao_suportado' then 'A IA passou a conversa para a equipe: o modo de horário escolhido ainda não funciona no WhatsApp.'
    when 'sem_versao_publicada' then 'A IA passou a conversa para a equipe: o assistente ainda não tem versão publicada.'
    when 'liberacao_perdida' then 'A IA passou a conversa para a equipe: o assistente deixou de estar liberado para este telefone ou este número.'
    when 'numero_desconectado' then 'A IA passou a conversa para a equipe: o número do assistente está desconectado.'
    when 'envio_incerto' then 'A IA pode não ter enviado a última resposta. A conversa voltou para a equipe.'
    when 'aviso_nao_enviado' then 'O aviso automático ao contato não foi enviado.'
    when 'celular' then 'Alguém respondeu pelo celular. A IA parou de responder nesta conversa.'
    when 'sem_resposta' then 'A IA não respondeu a tempo. A conversa voltou para a equipe.'
    when 'desligada' then 'O assistente foi desligado. A conversa voltou para a equipe.'
    when 'parada' then 'O assistente não atendeu esta mensagem: ele está parado nesta clínica.'
    when 'sem_autorizacao' then 'A IA passou a conversa para a equipe: o contato não tem autorização para receber mensagens.'
  end
$function$;

-- ---------------------------------------------------------------------------
-- Escrita na conversa
-- ---------------------------------------------------------------------------

-- INTERNA (so o dono executa, de dentro das funcoes definer). Tira a
-- conversa da IA se ela ainda estiver la: status aguardando_humano,
-- awaiting_reply = p_aguardando (nulo: nao mexe), cancela os
-- responder_com_ia pendentes da conversa e grava o evento. Devolve se mudou.
create function public.ia_tirar_conversa(
  p_conversation_id uuid, p_motivo text, p_aguardando boolean
)
returns boolean
language plpgsql
volatile
set search_path to ''
as $function$
declare
  v_corpo text := public.rotulo_do_motivo_da_ia(p_motivo);
  v_clinica uuid;
begin
  if v_corpo is null then
    raise exception using errcode = '22023', message = 'motivo_invalido';
  end if;

  update public.conversation c
     set status = 'aguardando_humano',
         awaiting_reply = coalesce(p_aguardando, c.awaiting_reply)
   where c.id = p_conversation_id
     and c.status = 'ia_atendendo'
  returning c.clinic_id into v_clinica;
  if v_clinica is null then
    return false;
  end if;

  update public.job_queue j
     set status = 'cancelado',
         last_error = 'conversa_fora_da_ia'
   where j.id in (
     select q.id
       from public.job_queue q
      where q.kind = 'responder_com_ia'
        and q.status = 'pendente'
        and q.payload ->> 'conversation_id' = p_conversation_id::text
        for update skip locked
   );

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    v_clinica, p_conversation_id, 'saida', 'sistema', 'evento', v_corpo,
    false, 0
  );
  return true;
end;
$function$;

-- O job (com posse) passa a conversa para a equipe. passou = false quer
-- dizer que ela ja tinha saido da IA (alguem assumiu, codigo ja_fora_da_ia)
-- ou que o job e de ANTES da janela atual (codigo job_antigo, D-A da
-- revisao: Assumir e Devolver no meio do turno; o job velho esta morto e
-- nao mexe na sessao nova). Nos dois casos a frase NAO sai.
create function public.passar_conversa_da_ia_para_equipe(
  p_job_id uuid, p_worker text, p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_conversa uuid;
  v_clinica uuid;
  v_criado timestamptz;
begin
  if public.rotulo_do_motivo_da_ia(p_motivo) is null then
    raise exception using errcode = '22023', message = 'motivo_invalido';
  end if;

  -- O CHECK job_queue_ia_tem_conversa garante o uuid no payload do kind.
  select (j.payload ->> 'conversation_id')::uuid, j.clinic_id, j.created_at
    into v_conversa, v_clinica, v_criado
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.status = 'executando'
     and j.locked_by = p_worker;
  if v_conversa is null or not exists (
    select 1 from public.conversation c
     where c.id = v_conversa and c.clinic_id = v_clinica
  ) then
    return jsonb_build_object('passou', false, 'codigo', 'sem_posse');
  end if;

  -- D-A: trava a conversa ANTES de ler a janela (o Devolver trava a
  -- conversa e depois grava a janela): um Devolver que comitou antes ja
  -- aparece aqui; um que vem depois espera esta transacao.
  perform 1 from public.conversation c where c.id = v_conversa for no key update;
  if exists (
    select 1 from public.ia_janela_da_conversa w
     where w.conversation_id = v_conversa
       and v_criado < w.desde
  ) then
    return jsonb_build_object('passou', false, 'codigo', 'job_antigo');
  end if;

  if public.ia_tirar_conversa(v_conversa, p_motivo, true) then
    return jsonb_build_object('passou', true, 'codigo', 'passou');
  end if;
  return jsonb_build_object('passou', false, 'codigo', 'ja_fora_da_ia');
end;
$function$;

-- O job (com posse) grava um evento no fio sem mexer na conversa (ex.: o
-- aviso automatico ao contato nao foi enviado). Job de antes da janela
-- atual (D-A): falso, sem evento.
create function public.gravar_evento_da_ia(p_job_id uuid, p_worker text, p_motivo text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_corpo text := public.rotulo_do_motivo_da_ia(p_motivo);
  v_clinica uuid;
  v_conversa uuid;
  v_criado timestamptz;
begin
  if v_corpo is null then
    raise exception using errcode = '22023', message = 'motivo_invalido';
  end if;

  select (j.payload ->> 'conversation_id')::uuid, j.clinic_id, j.created_at
    into v_conversa, v_clinica, v_criado
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.status = 'executando'
     and j.locked_by = p_worker;
  if v_conversa is null or not exists (
    select 1 from public.conversation c
     where c.id = v_conversa and c.clinic_id = v_clinica
  ) then
    return false;
  end if;
  -- D-A: a mesma ordem de passar_conversa_da_ia_para_equipe. Trava a
  -- conversa num comando proprio ANTES de ler a janela: um Devolver em voo
  -- (que ja travou a conversa e regravou a janela) termina primeiro, e a
  -- leitura seguinte, num comando novo, ja ve o desde novo.
  perform 1 from public.conversation c where c.id = v_conversa for no key update;
  if exists (
    select 1 from public.ia_janela_da_conversa w
     where w.conversation_id = v_conversa
       and v_criado < w.desde
  ) then
    return false;
  end if;

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    v_clinica, v_conversa, 'saida', 'sistema', 'evento', v_corpo, false, 0
  );
  return true;
end;
$function$;

-- A rota do webhook (sem job) tira a conversa da IA: excecao no
-- interceptador (falha_tecnica) ou mensagem de grupo, status ou canal
-- (nao_individual). Sem frase. p_job_id (opcional): o fechamento do job que
-- desistiu (worker) passa o proprio job; job de outra conversa ou clinica
-- e 22023 job_invalido, e job de ANTES da janela atual (D-A) devolve falso
-- sem efeito.
create function public.tirar_conversa_da_ia_pelo_servidor(
  p_clinic_id uuid, p_conversation_id uuid, p_motivo text, p_job_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_criado timestamptz;
begin
  if p_motivo is null or p_motivo not in ('falha_tecnica', 'nao_individual') then
    raise exception using errcode = '22023', message = 'motivo_invalido';
  end if;
  if p_job_id is not null then
    select j.created_at into v_criado
      from public.job_queue j
     where j.id = p_job_id
       and j.kind = 'responder_com_ia'
       and j.clinic_id = p_clinic_id
       and j.payload ->> 'conversation_id' = p_conversation_id::text;
    if v_criado is null then
      raise exception using errcode = '22023', message = 'job_invalido';
    end if;
  end if;
  if not exists (
    select 1 from public.conversation c
     where c.id = p_conversation_id and c.clinic_id = p_clinic_id
  ) then
    return false;
  end if;
  if p_job_id is not null then
    -- D-A: a mesma ordem de passar_conversa_da_ia_para_equipe.
    perform 1 from public.conversation c where c.id = p_conversation_id for no key update;
    if exists (
      select 1 from public.ia_janela_da_conversa w
       where w.conversation_id = p_conversation_id
         and v_criado < w.desde
    ) then
      return false;
    end if;
  end if;
  return public.ia_tirar_conversa(p_conversation_id, p_motivo, true);
end;
$function$;

-- Devolver para a IA (sessao): o UNICO caminho para a sessao por conversa
-- em ia_atendendo (proteger_status_ia_atendendo confere a flag local).
create function public.devolver_para_ia(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_clinica uuid;
  v_status text;
  v_responsavel uuid;
  v_aguardando boolean;
  v_contato uuid;
  v_numero uuid;
  v_chave text;
  v_nome text;
begin
  -- 1) So sessao
  if v_uid is null then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  -- 2) Conversa de clinica onde a pessoa e membro ativo (sem travar)
  select c.clinic_id into v_clinica
    from public.conversation c
   where c.id = p_conversation_id;
  if v_clinica is null or not exists (
    select 1 from public.clinic_member m
     where m.clinic_id = v_clinica
       and m.user_id = v_uid
       and m.status = 'ativo'
  ) then
    raise exception using errcode = 'P0002', message = 'conversa_nao_encontrada';
  end if;

  -- 3) Escrita e fase
  if not public.user_can_write(v_clinica) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;
  if not exists (
    select 1 from public.clinic k
     where k.id = v_clinica
       and (k.id = any (public.ia_clinicas_da_fase_controlada()) or k.e_de_teste)
  ) then
    raise exception using errcode = '42501', message = 'fora_da_fase';
  end if;

  -- 4) Ordem de travas: liberacao e interruptor antes da conversa
  perform 1 from public.ia_liberacao l where l.clinic_id = v_clinica for share;
  perform 1 from public.ia_interruptor i where i.id for share;

  -- 5) A conversa esta com a pessoa e sem pergunta pendente
  select c.status, c.assignee_user_id, c.awaiting_reply, c.contact_id, c.whatsapp_account_id
    into v_status, v_responsavel, v_aguardando, v_contato, v_numero
    from public.conversation c
   where c.id = p_conversation_id
     for update;
  if v_status is distinct from 'em_atendimento'
     or v_responsavel is distinct from v_uid
     or v_aguardando is distinct from false
  then
    raise exception using errcode = 'CZ409', message = 'conversa_mudou';
  end if;

  -- 6) Telefone liberado e, com sinal de paciente, so o forcado (D-B).
  -- contato_de_paciente: o telefone esta ativo na lista, nao foi forcado e
  -- o contato tem sinal de paciente; qualquer outra recusa e nao_liberada.
  select k.phone_key into v_chave
    from public.contact k
   where k.id = v_contato
     and k.clinic_id = v_clinica;
  if not public.ia_atende_no_whatsapp(v_clinica, v_numero, v_chave) then
    if exists (
         select 1 from public.ia_contato_liberado t
          where t.clinic_id = v_clinica
            and t.phone_key = public.chave_telefone(btrim(v_chave))
            and t.ativo
            and not t.forcado
       )
       and public.contato_tem_sinal_de_paciente(v_clinica, v_chave)
    then
      raise exception using errcode = '42501', message = 'contato_de_paciente';
    end if;
    raise exception using errcode = '42501', message = 'nao_liberada';
  end if;

  -- 7) Na mesma transacao: status, fila, janela, evento e trilha
  perform set_config('conduzza.devolver_para_ia', p_conversation_id::text, true);
  update public.conversation
     set status = 'ia_atendendo',
         assignee_user_id = null
   where id = p_conversation_id;
  perform set_config('conduzza.devolver_para_ia', '', true);

  update public.job_queue j
     set status = 'cancelado',
         last_error = 'devolvida_para_ia'
   where j.id in (
     select q.id
       from public.job_queue q
      where q.kind = 'responder_com_ia'
        and q.status = 'pendente'
        and q.payload ->> 'conversation_id' = p_conversation_id::text
        for update skip locked
   );

  insert into public.ia_janela_da_conversa (
    conversation_id, clinic_id, contact_id, phone_key, desde, aberta_por, updated_at
  ) values (
    p_conversation_id, v_clinica, v_contato, v_chave, now(), 'devolver', now()
  )
  on conflict (conversation_id) do update
    set clinic_id = excluded.clinic_id,
        contact_id = excluded.contact_id,
        phone_key = excluded.phone_key,
        desde = excluded.desde,
        aberta_por = excluded.aberta_por,
        updated_at = excluded.updated_at;

  -- Nome: a mesma regra de userName (lib/auth/active-clinic.ts).
  select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), u.email)
    into v_nome
    from auth.users u
   where u.id = v_uid;
  v_nome := coalesce(v_nome, 'Usuário');

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    v_clinica, p_conversation_id, 'saida', 'sistema', 'evento',
    v_nome || ' devolveu a conversa para a IA', false, 0
  );

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (v_clinica, v_uid, 'devolveu_para_ia', 'conversation', p_conversation_id);

  return jsonb_build_object('ok', true);
end;
$function$;

-- O botao Devolver: {pode, motivo}. Quem nao e administrador nem gestor
-- (nem super admin) recebe nao_disponivel no lugar dos motivos que revelam a
-- lista de telefones (docs/04 17.11).
create function public.ia_devolver_disponivel(p_conversation_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_clinica uuid;
  v_status text;
  v_responsavel uuid;
  v_aguardando boolean;
  v_numero uuid;
  v_chave text;
  v_gestao boolean;
  v_motivo text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select c.clinic_id, c.status, c.assignee_user_id, c.awaiting_reply,
         c.whatsapp_account_id, k.phone_key
    into v_clinica, v_status, v_responsavel, v_aguardando, v_numero, v_chave
    from public.conversation c
    left join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
   where c.id = p_conversation_id;
  if v_clinica is null or not exists (
    select 1 from public.clinic_member m
     where m.clinic_id = v_clinica
       and m.user_id = v_uid
       and m.status = 'ativo'
  ) then
    raise exception using errcode = 'P0002', message = 'conversa_nao_encontrada';
  end if;

  if not exists (
    select 1 from public.clinic k
     where k.id = v_clinica
       and (k.id = any (public.ia_clinicas_da_fase_controlada()) or k.e_de_teste)
  ) then
    return jsonb_build_object('pode', false, 'motivo', 'fora_da_fase');
  end if;

  if not public.user_can_write(v_clinica) then
    return jsonb_build_object('pode', false, 'motivo', 'sem_permissao');
  end if;
  if v_status is distinct from 'em_atendimento' or v_responsavel is distinct from v_uid then
    return jsonb_build_object('pode', false, 'motivo', 'nao_e_sua');
  end if;
  if v_aguardando then
    return jsonb_build_object('pode', false, 'motivo', 'pergunta_pendente');
  end if;

  if not (
    public.ia_liberacao_vigente(v_clinica, array['contatos'])
    and exists (
      select 1 from public.ai_agent_config a
       where a.clinic_id = v_clinica and a.status = 'publicada'
    )
  ) then
    v_motivo := 'assistente_desligado';
  elsif not exists (
          select 1
            from public.ia_numero_liberado n
            join public.whatsapp_account w on w.id = n.whatsapp_account_id
           where n.whatsapp_account_id = v_numero
             and n.clinic_id = v_clinica
             and n.ativo
             and w.clinic_id = v_clinica
             and w.removido_em is null
             and (v_clinica = any (public.ia_clinicas_da_fase_controlada())
                  or w.provider = 'fake')
        )
        or not exists (
          select 1 from public.ia_contato_liberado k
           where k.clinic_id = v_clinica
             and k.phone_key = public.chave_telefone(btrim(v_chave))
             and k.ativo
        )
        or public.telefone_e_numero_da_plataforma(v_chave)
  then
    v_motivo := 'nao_liberada';
  elsif public.contato_tem_sinal_de_paciente(v_clinica, v_chave)
        and not exists (
          select 1 from public.ia_contato_liberado k
           where k.clinic_id = v_clinica
             and k.phone_key = public.chave_telefone(btrim(v_chave))
             and k.ativo
             and k.forcado
        )
  then
    -- Telefone forcado pela equipe Conduzza (D-B) passa.
    v_motivo := 'contato_de_paciente';
  end if;

  if v_motivo is null then
    return jsonb_build_object('pode', true, 'motivo', null);
  end if;

  v_gestao := public.is_product_admin()
    or public.user_has_role(v_clinica, array['admin', 'gestor']);
  if not v_gestao then
    v_motivo := 'nao_disponivel';
  end if;
  return jsonb_build_object('pode', false, 'motivo', v_motivo);
end;
$function$;

-- Depois do envio: derruba "Aguardando voce" so se nao ha mensagem do
-- paciente da janela que nenhum turno encerrado (nem este job) leu. Criterio
-- por id, nunca por horario. Janela aberta pela ingestao (conversa NOVA, B6
-- da revisao) vale para a conversa inteira: a mensagem cuja transacao
-- comecou antes da que criou a conversa ainda conta. Trava a conversa
-- antes de conferir (B5): uma ingestao em voo termina primeiro, e a
-- conferencia, num comando novo, ja ve a mensagem dela.
create function public.ia_marcar_respondida(p_job_id uuid, p_worker text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_conversa uuid;
  v_desde timestamptz;
  v_aberta_por text;
begin
  select (j.payload ->> 'conversation_id')::uuid
    into v_conversa
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.status = 'executando'
     and j.locked_by = p_worker;
  if v_conversa is null then
    return false;
  end if;

  perform 1 from public.conversation c where c.id = v_conversa for no key update;

  select w.desde, w.aberta_por into v_desde, v_aberta_por
    from public.ia_janela_da_conversa w
   where w.conversation_id = v_conversa;
  if v_desde is null then
    return false;
  end if;

  update public.conversation c
     set awaiting_reply = false
   where c.id = v_conversa
     and c.status = 'ia_atendendo'
     and not exists (
       select 1
         from public.message m
        where m.conversation_id = c.id
          and m.direction = 'entrada'
          and m.author = 'paciente'
          and m.deleted_at is null
          and (v_aberta_por = 'ingestao' or m.created_at >= v_desde)
          and not (m.id = any (coalesce((
            select array_agg(x)
              from public.ai_turno t, unnest(t.mensagens_lidas) x
             where t.conversation_id = c.id
               and (t.job_id = p_job_id
                    or t.estado in ('enviado', 'passou_para_equipe'))
          ), '{}'::uuid[])))
     );
  return found;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Fila
-- ---------------------------------------------------------------------------

-- A rota do webhook enfileira a resposta (payload so com ids). A rajada se
-- junta no job que NUNCA rodou (indice job_queue_resposta_da_ia_nova): o
-- run_at anda 4 s a cada mensagem, ate 15 s depois do primeiro. Nenhum
-- codigo lanca.
create function public.enfileirar_resposta_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_incluir_teste boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_contato uuid;
  v_numero uuid;
  v_chave text;
  v_job uuid;
  v_inserido boolean;
begin
  -- 1) Clinica da lista (nunca e_de_teste em producao) ou de teste com a flag
  if not exists (
    select 1 from public.clinic c
     where c.id = p_clinic_id
       and ((c.id = any (public.ia_clinicas_da_fase_controlada()) and not c.e_de_teste)
            or (coalesce(p_incluir_teste, false) and c.e_de_teste))
  ) then
    return jsonb_build_object('codigo', 'fora_da_fase', 'job_id', null);
  end if;

  -- 2) Ordem de travas
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for share;
  perform 1 from public.ia_interruptor i where i.id for share;

  -- 3) Conversa da clinica na IA, sem responsavel
  select c.contact_id, c.whatsapp_account_id
    into v_contato, v_numero
    from public.conversation c
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id
     and c.status = 'ia_atendendo'
     and c.assignee_user_id is null;
  if not found then
    return jsonb_build_object('codigo', 'conversa_fora_da_ia', 'job_id', null);
  end if;

  -- 4) Mensagem do paciente desta conversa
  if not exists (
    select 1 from public.message m
     where m.id = p_message_id
       and m.clinic_id = p_clinic_id
       and m.conversation_id = p_conversation_id
       and m.direction = 'entrada'
       and m.author = 'paciente'
       and m.deleted_at is null
  ) then
    return jsonb_build_object('codigo', 'mensagem_invalida', 'job_id', null);
  end if;

  -- 5) Janela confere (contato e telefone atuais)
  select k.phone_key into v_chave
    from public.contact k
   where k.id = v_contato;
  if not exists (
    select 1 from public.ia_janela_da_conversa w
     where w.conversation_id = p_conversation_id
       and w.contact_id = v_contato
       and w.phone_key = v_chave
  ) then
    return jsonb_build_object('codigo', 'janela_invalida', 'job_id', null);
  end if;

  -- 6) Sem o teto (a conversa ja esta na IA; o teto decide na reserva, D44)
  if not public.ia_pode_falar_com(p_clinic_id, v_numero, v_chave) then
    return jsonb_build_object('codigo', 'nao_liberada', 'job_id', null);
  end if;

  -- 7) Insere ou junta
  insert into public.job_queue as j
    (clinic_id, kind, whatsapp_account_id, payload, run_at, max_attempts)
  values (p_clinic_id, 'responder_com_ia', v_numero,
          jsonb_build_object('conversation_id', p_conversation_id::text,
                             'ultima_mensagem_id', p_message_id::text),
          now() + interval '4 seconds', 3)
  on conflict ((payload ->> 'conversation_id'))
    where kind = 'responder_com_ia' and status = 'pendente'
      and attempts = 0 and devolucoes = 0
  do update set
    run_at  = least(greatest(j.run_at, now() + interval '4 seconds'),
                    j.created_at + interval '15 seconds'),
    payload = j.payload || jsonb_build_object('ultima_mensagem_id', excluded.payload -> 'ultima_mensagem_id')
  returning j.id, (j.xmax = 0) into v_job, v_inserido;

  return jsonb_build_object(
    'codigo', case when v_inserido then 'enfileirado' else 'juntou' end,
    'job_id', v_job
  );
end;
$function$;

-- Claim da IA (security invoker, como os outros claims; so a service role
-- executa). Lease de 90 s. O que esta devido vem de ia_jobs_devidos (o
-- criterio unico, o mesmo da guarda do pg_cron e da saude): por conversa,
-- so o job VIVO mais antigo (com prioridade ao que ja decidiu), so quando
-- estiver devido, e um mais novo nunca passa a frente. Trava so linhas de
-- job_queue.
create function public.claim_jobs_da_ia(
  p_worker text,
  p_max integer,
  p_clinic_ids uuid[],
  p_incluir_teste boolean default false
)
returns setof public.job_queue
language plpgsql
security invoker
set search_path to ''
as $function$
begin
  if p_clinic_ids is null or cardinality(p_clinic_ids) = 0 then
    return;
  end if;

  -- Higiene (antes do enterro): nao roda o pendente de conversa fora da IA
  -- ou sem janela, nem o job criado ANTES da janela atual (D-A da revisao:
  -- Assumir e Devolver no meio), pendente ou executando com lease vencido
  -- (a invocacao dele caiu). Sem esperar ninguem.
  with alvo as (
    select q.id,
           (w.conversation_id is not null and q.created_at < w.desde) as antigo
      from public.job_queue q
      left join public.conversation c
        on c.id = case when q.kind = 'responder_com_ia'
                       then (q.payload ->> 'conversation_id')::uuid end
      left join public.ia_janela_da_conversa w
        on w.conversation_id = c.id
     where q.kind = 'responder_com_ia'
       and q.clinic_id = any (p_clinic_ids)
       and ((q.status = 'pendente'
             and (c.id is null
                  or c.status <> 'ia_atendendo'
                  or w.conversation_id is null
                  or q.created_at < w.desde))
            or (q.status = 'executando'
                and q.locked_at < now() - interval '90 seconds'
                and w.conversation_id is not null
                and q.created_at < w.desde))
       for update of q skip locked
  )
  update public.job_queue j
     set status = 'cancelado',
         last_error = case when a.antigo then 'job_antigo' else 'conversa_fora_da_ia' end,
         locked_by = null,
         locked_at = null
    from alvo a
   where j.id = a.id;

  -- Enterro: so o kind, das clinicas pedidas, sem esperar ninguem.
  update public.job_queue
     set status = 'falhou',
         last_error = coalesce(last_error, 'lease_expirado'),
         locked_by = null,
         locked_at = null
   where id in (
     select q.id
       from public.job_queue q
      where q.kind = 'responder_com_ia'
        and q.clinic_id = any (p_clinic_ids)
        and q.status = 'executando'
        and q.locked_at < now() - interval '90 seconds'
        and q.attempts >= q.max_attempts
        for update skip locked
   );

  return query
  with travados as (
    select j.id
      from public.job_queue j
     where j.id in (
       select d.id
         from public.ia_jobs_devidos(p_clinic_ids, p_incluir_teste, interval '0 seconds') as d(id)
     )
     order by j.run_at
     limit greatest(1, least(coalesce(p_max, 4), 8))
       for update of j skip locked
  )
  update public.job_queue j
     set status = 'executando',
         locked_by = p_worker,
         locked_at = now(),
         attempts = j.attempts + 1
   where j.id in (select travados.id from travados)
     and j.kind = 'responder_com_ia'
     and ((j.status = 'pendente' and j.run_at <= now())
          or (j.status = 'executando'
              and j.locked_at < now() - interval '90 seconds'
              and j.attempts < j.max_attempts))
  returning j.*;
end;
$function$;

-- A guarda do envio (resposta ou frase): chamada cedo e IMEDIATAMENTE antes
-- do provedor, com o telefone que vai ao provedor e o numero ativo. Renova a
-- posse. Devolve ok, sem_posse, fora_da_ia, janela_invalida ou nao_liberada.
create function public.ia_pode_enviar_agora(
  p_job_id uuid,
  p_worker text,
  p_conversation_id uuid,
  p_whatsapp_account_id uuid,
  p_telefone text,
  p_tipo text
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_clinica uuid;
  v_job_clinica uuid;
  v_job_criado timestamptz;
  v_conv_clinica uuid;
  v_status text;
  v_responsavel uuid;
  v_contato uuid;
  v_numero uuid;
  v_chave text;
begin
  if p_tipo is null or p_tipo not in ('resposta', 'frase') then
    raise exception using errcode = '22023', message = 'tipo_invalido';
  end if;

  select c.clinic_id into v_clinica
    from public.conversation c
   where c.id = p_conversation_id;
  if v_clinica is not null then
    perform 1 from public.ia_liberacao l where l.clinic_id = v_clinica for share;
    perform 1 from public.ia_interruptor i where i.id for share;
  end if;

  update public.job_queue j
     set locked_at = now()
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.status = 'executando'
     and j.locked_by = p_worker
     and j.payload ->> 'conversation_id' = p_conversation_id::text
  returning j.clinic_id, j.created_at into v_job_clinica, v_job_criado;
  if v_job_clinica is null then
    return 'sem_posse';
  end if;

  select c.clinic_id, c.status, c.assignee_user_id, c.contact_id, c.whatsapp_account_id
    into v_conv_clinica, v_status, v_responsavel, v_contato, v_numero
    from public.conversation c
   where c.id = p_conversation_id;
  if v_conv_clinica is distinct from v_job_clinica
     or v_numero is distinct from p_whatsapp_account_id
  then
    return 'nao_liberada';
  end if;
  if v_responsavel is not null
     or v_status is distinct from (case p_tipo when 'resposta' then 'ia_atendendo'
                                                else 'aguardando_humano' end)
  then
    return 'fora_da_ia';
  end if;

  select k.phone_key into v_chave
    from public.contact k
   where k.id = v_contato;
  if not exists (
    select 1 from public.ia_janela_da_conversa w
     where w.conversation_id = p_conversation_id
       and w.contact_id = v_contato
       and w.phone_key = v_chave
       and w.phone_key = public.chave_telefone(btrim(p_telefone))
       and v_job_criado >= w.desde
  ) then
    return 'janela_invalida';
  end if;

  if not public.ia_pode_falar_com(v_job_clinica, p_whatsapp_account_id, p_telefone) then
    return 'nao_liberada';
  end if;
  return 'ok';
end;
$function$;

-- Chamada pelo pg_cron (entrada 'motor-ia', so pela operacao). So chama a
-- Vercel quando ha trabalho DEVIDO de clinica da lista, pelo criterio unico
-- (ia_jobs_devidos, o mesmo do claim e de saude_do_motor): mensagem nova
-- durante o turno, ou job atras de um em retry, nao chama.
create function public.disparar_ciclo_da_ia()
returns boolean
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.ia_jobs_devidos(null, false, interval '0 seconds')
  ) then
    return false;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'motor_tick_url';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'motor_tick_secret';

  if v_url is null or v_secret is null then
    raise exception 'motor_tick_url ou motor_tick_secret ausente no Vault';
  end if;
  if v_url !~ '/api/webhooks/motor$' then
    raise exception 'motor_tick_url fora do formato esperado';
  end if;
  v_url := regexp_replace(v_url, '/api/webhooks/motor$', '/api/webhooks/motor-ia');

  execute format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 58000)',
    v_url,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::text,
    jsonb_build_object('origem', 'cron', 'disparado_em', now())::text
  );
  return true;
end;
$function$;

-- So a operacao chama (supabase/operacao/agente-ia.md). A migration NUNCA.
create function public.motor_ia_agendar()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  execute $cron$ select cron.schedule('motor-ia', '10 seconds', 'select public.disparar_ciclo_da_ia()') $cron$;
  return 'motor-ia (10s) agendado';
end;
$function$;

create function public.motor_ia_desagendar()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  execute $cron$ select cron.unschedule('motor-ia') $cron$;
  return 'motor-ia desagendado';
end;
$function$;

-- ---------------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------------

-- Rascunho bloqueado: ate o dono decidir (D25), so a equipe Conduzza. Abrir
-- para administrador e gestor e um CREATE OR REPLACE de uma linha.
create function public.ler_rascunho_bloqueado(p_decision_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_clinica uuid;
  v_texto text;
begin
  if auth.uid() is null or not public.is_product_admin() then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select d.clinic_id into v_clinica
    from public.ai_decision_log d
   where d.id = p_decision_id;
  if v_clinica is null then
    raise exception using errcode = 'P0002', message = 'decisao_nao_encontrada';
  end if;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (v_clinica, auth.uid(), 'leu_rascunho_bloqueado', 'ai_decision_log', p_decision_id);

  select r.texto into v_texto
    from public.ai_rascunho_bloqueado r
   where r.decision_id = p_decision_id;
  return jsonb_build_object('texto', v_texto);
end;
$function$;

-- Para a aba Agente de IA dizer a verdade sem expor ia_uso nem numeros de
-- outras clinicas. telefones_invalidos: os que nunca acionam o assistente
-- (numero de WhatsApp do Conduzza, ou contato com sinal de paciente sem o
-- forcar, D-B). telefones_sem_autorizacao: os do contato que REVOGOU a
-- autorizacao para receber mensagens no WhatsApp (o ultimo registro de
-- contact_consent revogado; o mesmo criterio de consentimento_vigente, sem
-- contar o contato que ainda nao escreveu, que ganha a autorizacao na
-- primeira mensagem): o executor passa a conversa sem responder
-- (sem_autorizacao, S5), entao a aba nao promete conversa. motor_parado: so
-- o booleano do motor da IA (B8 da revisao: os detalhes de
-- saude_do_motor().ia ficam com o servidor e o super admin).
create function public.situacao_da_ia_na_clinica(p_clinic_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_teto boolean;
  v_versao integer;
  v_invalidos jsonb;
  v_sem_autorizacao jsonb;
  v_abertas jsonb;
  v_motor jsonb;
begin
  if not (
    (auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role')
    or public.is_product_admin()
    or public.ia_membro_ve_a_liberacao(p_clinic_id)
  ) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select coalesce((
    select (
      select coalesce(sum(u.custo_microdolar), 0)
        from public.ia_uso u
       where u.clinic_id = l.clinic_id
         and u.created_at >= now() - interval '24 hours'
    ) >= l.teto_diario_centavos_usd::bigint * 10000
      from public.ia_liberacao l
     where l.clinic_id = p_clinic_id
  ), false) into v_teto;

  select max(a.version) into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada';

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_invalidos
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and (public.telefone_e_numero_da_plataforma(k.phone_key)
          or (not k.forcado
              and public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key)));

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_sem_autorizacao
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and exists (
       select 1
         from public.contact ct
        where ct.clinic_id = p_clinic_id
          and ct.phone_key = k.phone_key
          and (
            select cc.revoked_at is not null
              from public.contact_consent cc
             where cc.clinic_id = p_clinic_id
               and cc.contact_id = ct.id
               and cc.channel = 'whatsapp'
             order by cc.granted_at desc, cc.created_at desc
             limit 1
          ) is true
     );

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_abertas
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and k.ativo
     and exists (
       select 1
         from public.conversation c
         join public.contact ct on ct.id = c.contact_id
        where c.clinic_id = p_clinic_id
          and ct.clinic_id = p_clinic_id
          and ct.phone_key = k.phone_key
          and c.status in ('aguardando_humano', 'em_atendimento')
          and c.whatsapp_account_id in (
            select n.whatsapp_account_id
              from public.ia_numero_liberado n
              join public.whatsapp_account w on w.id = n.whatsapp_account_id
             where n.clinic_id = p_clinic_id
               and n.ativo
               and w.removido_em is null
          )
     );

  v_motor := public.ia_estado_do_motor();

  return jsonb_build_object(
    'teto_atingido', v_teto,
    'versao_publicada', v_versao,
    'telefones_invalidos', v_invalidos,
    'telefones_sem_autorizacao', v_sem_autorizacao,
    'telefones_com_conversa_aberta', v_abertas,
    'motor_parado', not coalesce((v_motor ->> 'agendado')::boolean, false)
                    or coalesce((v_motor ->> 'alerta')::boolean, false)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Funcao do gatilho de message (o gatilho e a M3)
-- ---------------------------------------------------------------------------
-- Linha author = 'ia': exige job responder_com_ia em execucao da mesma
-- clinica e conversa, conversa na IA sem responsavel, janela que confere,
-- ia_pode_falar_com e decisao APROVADA do mesmo job com o mesmo hash do
-- corpo. Linha de outro autor com job da IA: so a frase fixa, como sistema.
-- Clinica e_de_teste sem job_id: passa (fixtures e seed antigos).
create function public.mensagem_ia_exige_aprovacao()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_lista boolean;
  v_teste boolean;
  v_kind text;
  v_job_status text;
  v_job_clinica uuid;
  v_job_conversa text;
  v_job_criado timestamptz;
  v_status text;
  v_responsavel uuid;
  v_contato uuid;
  v_chave text;
begin
  if new.author = 'ia' then
    select c.id = any (public.ia_clinicas_da_fase_controlada()), c.e_de_teste
      into v_lista, v_teste
      from public.clinic c
     where c.id = new.clinic_id;
    -- 1) fora das duas clinicas e nao de teste: nunca
    if not coalesce(v_lista, false) and not coalesce(v_teste, false) then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    -- 2) fixture e seed antigos em clinica de teste
    if coalesce(v_teste, false) and new.job_id is null then
      return new;
    end if;
    -- 3) forma
    if new.direction is distinct from 'saida'
       or new.job_id is null
       or new.author_user_id is not null
       or new.is_internal_note
       or new.content_type is distinct from 'texto'
       or new.media_url is not null
       or new.body is null
    then
      raise exception using errcode = 'CZIA1', message = 'ia_sem_aprovacao';
    end if;
    -- 4) job, conversa, janela e liberacao
    select j.kind, j.status, j.clinic_id, j.payload ->> 'conversation_id', j.created_at
      into v_kind, v_job_status, v_job_clinica, v_job_conversa, v_job_criado
      from public.job_queue j
     where j.id = new.job_id;
    if v_kind is distinct from 'responder_com_ia'
       or v_job_status is distinct from 'executando'
       or v_job_clinica is distinct from new.clinic_id
       or v_job_conversa is distinct from new.conversation_id::text
    then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    select c.status, c.assignee_user_id, c.contact_id
      into v_status, v_responsavel, v_contato
      from public.conversation c
     where c.id = new.conversation_id
       and c.clinic_id = new.clinic_id;
    if v_status is distinct from 'ia_atendendo' or v_responsavel is not null then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    select k.phone_key into v_chave
      from public.contact k
     where k.id = v_contato;
    if not exists (
      select 1 from public.ia_janela_da_conversa w
       where w.conversation_id = new.conversation_id
         and w.contact_id = v_contato
         and w.phone_key = v_chave
         and v_job_criado >= w.desde
    ) or not public.ia_pode_falar_com(new.clinic_id, new.whatsapp_account_id, v_chave)
    then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    -- 5) decisao aprovada do mesmo job com o mesmo hash
    if not exists (
      select 1 from public.ai_decision_log d
       where d.clinic_id = new.clinic_id
         and d.conversation_id = new.conversation_id
         and d.job_id = new.job_id
         and d.aprovado
         and not d.compliance_blocked
         and d.texto_sha256 = encode(sha256(convert_to(new.body, 'UTF8')), 'hex')
    ) then
      raise exception using errcode = 'CZIA1', message = 'ia_sem_aprovacao';
    end if;
    return new;
  end if;

  if new.job_id is null then
    return new;
  end if;
  select j.kind into v_kind
    from public.job_queue j
   where j.id = new.job_id;
  if v_kind is distinct from 'responder_com_ia' then
    return new;
  end if;

  select c.id = any (public.ia_clinicas_da_fase_controlada()), c.e_de_teste
    into v_lista, v_teste
    from public.clinic c
   where c.id = new.clinic_id;
  if not coalesce(v_lista, false) and not coalesce(v_teste, false) then
    raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
  end if;
  if new.author is distinct from 'sistema'
     or new.direction is distinct from 'saida'
     or new.content_type is distinct from 'texto'
     or new.is_internal_note
     or new.media_url is not null
     or new.body is distinct from public.frase_de_escalonamento_da_ia()
  then
    raise exception using errcode = 'CZIA3', message = 'frase_divergente';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) CREATE OR REPLACE das funcoes frias (corpo de producao de 13/10/2026)
-- ---------------------------------------------------------------------------

-- saude_do_motor: passa a plpgsql e ganha a chave ia. fila, planner e
-- atrasados como hoje. A chave ia (ia_estado_do_motor: entrada 'motor-ia'
-- no pg_cron, vigiado, devidos ha mais de 60 s pelo criterio unico de
-- ia_jobs_devidos e o alerta; nunca pela idade da batida, porque a guarda
-- nao chama a Vercel sem trabalho) so vai para o servidor (service role,
-- sem sessao) e para o super admin (B8 da revisao). Qualquer outra sessao
-- recebe "ia": null; a aba Agente de IA le so o booleano motor_parado de
-- situacao_da_ia_na_clinica.
create or replace function public.saude_do_motor()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    )
    -- [resposta da ia] inicio
    , 'ia', v_ia
    -- [resposta da ia] fim
  );
end;
$function$;

-- definir_liberacao_da_ia: ligar no modo contatos (inclui religar com
-- p_modo nulo numa linha ja em contatos) so a equipe Conduzza.
create or replace function public.definir_liberacao_da_ia(
  p_clinic_id uuid, p_liberada boolean, p_modo text default null::text,
  p_motivo text default null::text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  -- [whatsapp so pela equipe] inicio
  v_modo_atual text;
  -- [whatsapp so pela equipe] fim
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
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

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- [whatsapp so pela equipe] inicio
  -- Nesta fase, so a equipe Conduzza liga o atendimento pelo WhatsApp (E3,
  -- decisao do dono de 13/10/2026). Desligar e "So simulador" continuam com
  -- ia_exigir_quem_libera.
  select l.modo into v_modo_atual
    from public.ia_liberacao l
   where l.clinic_id = p_clinic_id;
  if p_liberada and coalesce(p_modo, v_modo_atual, 'simulador') = 'contatos' then
    perform public.ia_exigir_equipe_conduzza();
  end if;
  -- [whatsapp so pela equipe] fim

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
$function$;

-- definir_numero_da_ia: ligar um numero so a equipe Conduzza.
create or replace function public.definir_numero_da_ia(
  p_clinic_id uuid, p_whatsapp_account_id uuid, p_ativo boolean
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  -- [whatsapp so pela equipe] inicio
  if p_ativo then
    perform public.ia_exigir_equipe_conduzza();
  end if;
  -- [whatsapp so pela equipe] fim
  if p_clinic_id is null or p_whatsapp_account_id is null or p_ativo is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, o número e se ele fica liberado.';
  end if;

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- Um numero por vez nesta fase: ligar este desliga os outros da clinica,
  -- na mesma transacao e debaixo da mesma trava (duas chamadas ao mesmo
  -- tempo, cada uma ligando um numero, terminam com um so: a segunda espera
  -- o commit da primeira e desliga o dela). Se a gravacao deste numero falhar
  -- adiante (23503 de outra clinica, 23514 removido), tudo volta junto e os
  -- outros continuam como estavam. Uma linha de trilha por numero desligado.
  if p_ativo then
    with desligados as (
      update public.ia_numero_liberado n
         set ativo = false,
             alterado_por = auth.uid()
       where n.clinic_id = p_clinic_id
         and n.whatsapp_account_id <> p_whatsapp_account_id
         and n.ativo
      returning n.whatsapp_account_id
    )
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    select p_clinic_id, auth.uid(), 'editou', 'ia_numero_liberado', d.whatsapp_account_id
      from desligados d;
  end if;

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
$function$;

-- definir_contato_liberado_da_ia: assinatura NOVA (p_forcar_contato_existente
-- com default). O CREATE OR REPLACE nao serve (seria outra funcao): drop da
-- antiga e create da nova na mesma transacao, com os grants de hoje. O
-- codigo sempre chama por nome de parametro. Grava ia_contato_liberado.forcado
-- (D-B), a unica escrita dessa coluna.
drop function public.definir_contato_liberado_da_ia(uuid, text, text, boolean);

create function public.definir_contato_liberado_da_ia(
  p_clinic_id uuid,
  p_telefone_e164 text,
  p_rotulo text,
  p_ativo boolean,
  p_forcar_contato_existente boolean default false
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_telefone text := btrim(p_telefone_e164);
  v_chave text;
  v_rotulo text := nullif(btrim(p_rotulo), '');
  v_id uuid;
  -- [whatsapp so pela equipe] inicio
  v_forcou boolean := false;
  -- [whatsapp so pela equipe] fim
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  -- [whatsapp so pela equipe] inicio
  if p_ativo then
    perform public.ia_exigir_equipe_conduzza();
  end if;
  -- [whatsapp so pela equipe] fim
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

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- [whatsapp so pela equipe] inicio
  -- So ao LIGAR: numero de WhatsApp de qualquer clinica do Conduzza nunca;
  -- telefone com sinal de paciente so com o forcar (equipe Conduzza, que ja
  -- passou em ia_exigir_equipe_conduzza acima), com trilha propria. Desligar
  -- nunca e recusado. Nenhuma mensagem leva o telefone.
  if p_ativo then
    if public.telefone_e_numero_da_plataforma(v_telefone) then
      raise exception using errcode = '23514', message = 'telefone_invalido_para_equipe';
    end if;
    if public.contato_tem_sinal_de_paciente(p_clinic_id, v_chave) then
      if not coalesce(p_forcar_contato_existente, false) then
        raise exception using errcode = '23514', message = 'contato_de_paciente';
      end if;
      v_forcou := true;
    end if;
  end if;
  -- [whatsapp so pela equipe] fim

  -- [whatsapp so pela equipe] inicio
  -- forcado (D-B da revisao): verdadeiro so ao ligar com o forcar e o sinal
  -- de paciente; falso ao ligar sem sinal e ao desligar. O gatilho
  -- ia_contato_liberado_forcado_so_pela_funcao so aceita forcado com esta
  -- flag local, desligada logo depois da gravacao.
  if v_forcou then
    perform set_config('conduzza.forcar_telefone_da_ia', 'sim', true);
  end if;
  -- [whatsapp so pela equipe] fim
  update public.ia_contato_liberado k
     set ativo = p_ativo,
         rotulo = coalesce(v_rotulo, k.rotulo),
         -- [whatsapp so pela equipe] inicio
         forcado = v_forcou,
         -- [whatsapp so pela equipe] fim
         alterado_por = auth.uid()
   where k.clinic_id = p_clinic_id
     and k.phone_key = v_chave
  returning k.id into v_id;
  if not found then
    insert into public.ia_contato_liberado (clinic_id, phone_key, rotulo, ativo, alterado_por,
                                            -- [whatsapp so pela equipe] inicio
                                            forcado
                                            -- [whatsapp so pela equipe] fim
                                            )
    values (p_clinic_id, v_chave, v_rotulo, p_ativo, auth.uid(),
            -- [whatsapp so pela equipe] inicio
            v_forcou
            -- [whatsapp so pela equipe] fim
            )
    returning id into v_id;
  end if;
  -- [whatsapp so pela equipe] inicio
  perform set_config('conduzza.forcar_telefone_da_ia', '', true);
  -- [whatsapp so pela equipe] fim

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_contato_liberado', v_id);

  -- [whatsapp so pela equipe] inicio
  if v_forcou then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'forcou_telefone_de_paciente_na_ia', 'ia_contato_liberado', v_id);
  end if;
  -- [whatsapp so pela equipe] fim

  return p_ativo;
end;
$function$;

-- ia_desligar (interna): igual a hoje, mais o evento 'desligada' em cada
-- conversa devolvida.
create or replace function public.ia_desligar(p_clinic_ids uuid[])
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_conversas integer := 0;
  v_jobs integer := 0;
begin
  if p_clinic_ids is null or cardinality(p_clinic_ids) = 0 then
    return jsonb_build_object('conversas', 0, 'jobs', 0);
  end if;

  -- [resposta da ia] inicio
  with devolvidas as (
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
       )
    returning c.id, c.clinic_id
  )
  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  )
  select d.clinic_id, d.id, 'saida', 'sistema', 'evento',
         public.rotulo_do_motivo_da_ia('desligada'), false, 0
    from devolvidas d;
  get diagnostics v_conversas = row_count;
  -- [resposta da ia] fim

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
$function$;

-- proteger_status_ia_atendendo (so a funcao; o gatilho em conversation ja
-- existe): pela sessao, toda entrada em ia_atendendo (INSERT, UPDATE vindo
-- de outro status, troca de contact_id) so por devolver_para_ia, que liga a
-- flag local conduzza.devolver_para_ia com o id da conversa; com a flag,
-- reconfere ia_atende_no_whatsapp. O servidor segue como hoje.
create or replace function public.proteger_status_ia_atendendo()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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

  -- [resposta da ia] inicio
  if current_setting('conduzza.devolver_para_ia', true) is distinct from new.id::text then
    raise exception using errcode = '42501', message = 'so_pelo_devolver';
  end if;
  -- [resposta da ia] fim

  perform 1 from public.ia_liberacao l where l.clinic_id = new.clinic_id for share;
  perform 1 from public.ia_interruptor i where i.id for share;

  select k.phone_key into v_chave
    from public.contact k
   where k.id = new.contact_id
     and k.clinic_id = new.clinic_id;

  -- [resposta da ia] inicio
  if not public.ia_atende_no_whatsapp(new.clinic_id, new.whatsapp_account_id, v_chave) then
    raise exception using errcode = '42501', message = 'nao_liberada';
  end if;
  -- [resposta da ia] fim
  return new;
end;
$function$;

-- motor_manutencao: corpo de producao, com 'motor-ia' na higiene das
-- batidas e o bloco da IA depois do da agendada (o ultimo que trava
-- conversa), antes da batida motor-planner.
create or replace function public.motor_manutencao()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_erros text[] := array[]::text[];
  v_holds integer := 0;
  v_orfas integer := 0;
  v_ofertas integer := 0;
  v_reguas jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] inicio
  v_automacoes jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] fim
  -- [gasto meta] inicio
  v_gasto integer := 0;
  -- [gasto meta] fim
  -- [clique do site] inicio
  v_cliques jsonb := '{}'::jsonb;
  -- [clique do site] fim
  -- [mensagem agendada] inicio
  v_agendadas jsonb := '{}'::jsonb;
  v_reconciliadas jsonb;
  v_erros_agendadas integer := 0;
  -- [mensagem agendada] fim
  -- [resposta da ia] inicio
  v_ia_sem_resposta integer := 0;
  v_ia_liberacao_perdida integer := 0;
  v_ia_alerta integer := 0;
  v_ia record;
  -- [resposta da ia] fim
begin
  begin
    select limpar_holds_vencidos() into v_holds;
  exception when others then
    v_erros := v_erros || ('limpar_holds:' || sqlstate);
  end;

  begin
    select fechar_runs_orfas() into v_orfas;
  exception when others then
    v_erros := v_erros || ('fechar_runs_orfas:' || sqlstate);
  end;

  -- Janela de reoferta vencida vira 'expirada' e a proxima onda parte (4.9).
  begin
    select expirar_ofertas_de_espera() into v_ofertas;
  exception when others then
    v_erros := v_erros || ('expirar_ofertas:' || sqlstate);
  end;

  -- [automacoes de fluxo] inicio
  -- Automacoes de fluxo (02/10/2026): registra as regras de tempo vencidas
  -- e executa as pendentes (um salto por passagem). Antes das reguas, para o
  -- follow-up da etapa para onde a automacao moveu ja nascer nesta passagem.
  begin
    v_automacoes := jsonb_build_object('planejadas', planejar_automacoes_de_fluxo());
  exception when others then
    v_erros := v_erros || ('planejar_automacoes:' || sqlstate);
  end;

  begin
    v_automacoes := v_automacoes || executar_automacoes_de_fluxo();
  exception when others then
    v_erros := v_erros || ('executar_automacoes:' || sqlstate);
  end;

  -- [automacoes de fluxo] fim
  begin
    select planejar_reguas() into v_reguas;
  exception when others then
    v_erros := v_erros || ('planejar_reguas:' || sqlstate);
  end;

  -- [gasto meta] inicio
  -- Investimento da Meta (Fase 4, 03/10/2026): a partir das 06:00 no fuso de
  -- cada clinica, enfileira uma leitura do gasto por dia (ate 3 clinicas por
  -- passagem). Cada clinica erra sozinha dentro da funcao (raise warning);
  -- aqui so chega erro estrutural, que vira gasto_meta:<sqlstate> no
  -- planner_erro como as outras rotinas.
  begin
    v_gasto := enfileirar_gasto_meta_do_dia();
  exception when others then
    v_erros := v_erros || ('gasto_meta:' || sqlstate);
  end;

  -- [gasto meta] fim
  -- [clique do site] inicio
  -- Clique rastreado pelo site (F1 do Google, 05/10/2026): o clique nao
  -- casado sai 1 dia depois de vencer e o casado perde gclid, gbraid e
  -- wbraid 90 dias depois do clique. Erro vira cliques_do_site:<sqlstate>.
  begin
    v_cliques := podar_cliques_do_site();
  exception when others then
    v_erros := v_erros || ('cliques_do_site:' || sqlstate);
  end;

  -- [clique do site] fim
  -- Higiene: as linhas de hostname:pid da VPS, que reiniciava a cada 1 a 2
  -- minutos e nada podava.
  begin
    delete from worker_heartbeat
    -- [resposta da ia] inicio
    where worker_id not in ('motor-fila', 'motor-planner', 'motor-ia')
    -- [resposta da ia] fim
      and batida_em < now() - interval '1 hour';
  exception when others then
    v_erros := v_erros || ('higiene:' || sqlstate);
  end;

  -- Reafirma a privacidade do balde de midia (de hora em hora basta, mas
  -- rodar sempre e barato e nao depende de mais um agendamento).
  begin
    update storage.buckets set public = false
    where id = 'midia-conversas' and public is distinct from false;
  exception when others then
    v_erros := v_erros || ('balde:' || sqlstate);
  end;

  -- [mensagem agendada] inicio
  -- Mensagem agendada (06/10/2026). Por ultimo: as linhas travadas pela
  -- planejadora so soltam no fim desta transacao. A planejadora cria o job
  -- da vencida; a reconciliacao fecha o que o executor nao fechou, aplica a
  -- retencao de 30 dias e conta as presas ('enviando' ha mais de 13 h), que
  -- viram agendadas_presas:<n> no planner_erro (runbook do motor). Cada
  -- agendada erra sozinha nas duas: as linhas com erro desta passagem (soma
  -- das duas) viram agendadas_erros:<n>; erro estrutural continua
  -- mensagem_agendada:<SQLSTATE> e agendada_reconciliar:<SQLSTATE>.
  begin
    v_agendadas := public.planejar_mensagens_agendadas();
    v_erros_agendadas := v_erros_agendadas
      + coalesce((v_agendadas ->> 'erros_por_linha')::integer, 0);
  exception when others then
    v_erros := v_erros || ('mensagem_agendada:' || sqlstate);
  end;

  begin
    v_reconciliadas := public.reconciliar_mensagens_agendadas();
    v_erros_agendadas := v_erros_agendadas
      + coalesce((v_reconciliadas ->> 'erros_por_linha')::integer, 0);
    v_agendadas := v_agendadas || (v_reconciliadas - 'erros_por_linha');
    if coalesce((v_agendadas ->> 'presas')::integer, 0) > 0 then
      v_erros := v_erros || ('agendadas_presas:' || (v_agendadas ->> 'presas'));
    end if;
  exception when others then
    v_erros := v_erros || ('agendada_reconciliar:' || sqlstate);
  end;

  v_agendadas := v_agendadas
    || jsonb_build_object('erros_por_linha', v_erros_agendadas);
  if v_erros_agendadas > 0 then
    v_erros := v_erros || ('agendadas_erros:' || v_erros_agendadas);
  end if;

  -- [mensagem agendada] fim
  -- [resposta da ia] inicio
  -- Resposta da IA no WhatsApp (E3, 13/10/2026). Depois da agendada (este
  -- bloco tambem trava conversa). Ate 50 conversas na IA por passagem (da
  -- lista, ou de teste com janela), sem esperar ninguem: (a) o paciente espera ha mais de 3 minutos sem
  -- resposta, ou (b) a IA deixou de poder falar com ela (liberacao,
  -- numero, telefone, versao) ou a janela nao confere. Nenhuma mensagem ao
  -- contato; awaiting_reply fica como esta. As de (a) em clinica da lista
  -- (nao de teste) viram ia_sem_resposta:<n> no planner_erro. Erro
  -- estrutural vira ia_sem_resposta:<SQLSTATE>. Depois, as retencoes.
  begin
    for v_ia in
      select c.id,
             c.clinic_id,
             (c.awaiting_reply
              and c.last_inbound_at < now() - interval '3 minutes') as sem_resposta
        from public.conversation c
        join public.clinic cl on cl.id = c.clinic_id
        left join public.contact k on k.id = c.contact_id
        left join public.ia_janela_da_conversa w on w.conversation_id = c.id
       where c.status = 'ia_atendendo'
         -- So onde a IA pode existir: clinica da lista (sempre) ou de teste
         -- com janela (posta na IA pela ingestao ou pelo Devolver). Conversa
         -- de teste sem janela e fixture; nas outras clinicas, como hoje.
         and (cl.id = any (public.ia_clinicas_da_fase_controlada())
              or (cl.e_de_teste and w.conversation_id is not null))
         and (
           (c.awaiting_reply and c.last_inbound_at < now() - interval '3 minutes')
           or not public.ia_pode_falar_com(c.clinic_id, c.whatsapp_account_id, k.phone_key)
           or w.conversation_id is null
           or w.contact_id is distinct from c.contact_id
           or w.phone_key is distinct from k.phone_key
         )
       limit 50
         for update of c skip locked
    loop
      if v_ia.sem_resposta then
        if public.ia_tirar_conversa(v_ia.id, 'sem_resposta', null) then
          v_ia_sem_resposta := v_ia_sem_resposta + 1;
          if exists (
            select 1 from public.clinic k
             where k.id = v_ia.clinic_id
               and k.id = any (public.ia_clinicas_da_fase_controlada())
               and not k.e_de_teste
          ) then
            v_ia_alerta := v_ia_alerta + 1;
          end if;
        end if;
      elsif public.ia_tirar_conversa(v_ia.id, 'liberacao_perdida', null) then
        v_ia_liberacao_perdida := v_ia_liberacao_perdida + 1;
      end if;
    end loop;
    if v_ia_alerta > 0 then
      v_erros := v_erros || ('ia_sem_resposta:' || v_ia_alerta);
    end if;

    delete from public.ai_rascunho_bloqueado
     where created_at < now() - interval '90 days';
    update public.ai_turno
       set texto = null
     where texto is not null
       and created_at < now() - interval '1 hour';
    delete from public.ai_turno
     where created_at < now() - interval '30 days';
    delete from public.ia_janela_da_conversa w
     where w.updated_at < now() - interval '30 days'
       and not exists (
         select 1 from public.conversation c
          where c.id = w.conversation_id
            and c.status = 'ia_atendendo'
       );
  exception when others then
    v_erros := v_erros || ('ia_sem_resposta:' || sqlstate);
  end;

  -- [resposta da ia] fim
  insert into worker_heartbeat (worker_id, batida_em, ultimo_lote, ultimo_erro, ultimo_erro_em)
  values (
    'motor-planner',
    now(),
    v_holds + v_orfas + v_ofertas,
    case when array_length(v_erros, 1) is null then null
         else array_to_string(v_erros, ',') end,
    case when array_length(v_erros, 1) is null then null else now() end
  )
  on conflict (worker_id) do update
  set batida_em = now(),
      ultimo_lote = excluded.ultimo_lote,
      ultimo_erro = excluded.ultimo_erro,
      ultimo_erro_em = coalesce(excluded.ultimo_erro_em, worker_heartbeat.ultimo_erro_em);

  return jsonb_build_object(
    'holds', v_holds,
    'runs_orfas', v_orfas,
    'ofertas_expiradas', v_ofertas,
    'reguas', v_reguas,
    'erros', v_erros
    -- [automacoes de fluxo] inicio
    , 'automacoes', v_automacoes
    -- [automacoes de fluxo] fim
    -- [gasto meta] inicio
    , 'gasto_meta', v_gasto
    -- [gasto meta] fim
    -- [clique do site] inicio
    , 'cliques_do_site', v_cliques
    -- [clique do site] fim
    -- [mensagem agendada] inicio
    , 'mensagens_agendadas', v_agendadas
    -- [mensagem agendada] fim
    -- [resposta da ia] inicio
    , 'resposta_da_ia', jsonb_build_object(
        'sem_resposta', v_ia_sem_resposta,
        'liberacao_perdida', v_ia_liberacao_perdida)
    -- [resposta da ia] fim
  );
end;
$function$;

-- claim_jobs (o claim LEGADO do npm run worker e das suites de integracao
-- contra a producao): nao reivindica nem enterra a resposta da IA, que so o
-- motor da IA (claim_jobs_da_ia) executa.
create or replace function public.claim_jobs(p_worker text, p_limit integer default 5)
returns setof public.job_queue
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Enterra o que travou sem tentativas restantes.
  update job_queue
  set status = 'falhou',
      last_error = coalesce(last_error, 'lease_expirado'),
      locked_by = null,
      locked_at = null
  where status = 'executando'
    -- [mensagem agendada] inicio
    and kind <> 'enviar_mensagem_agendada'
    -- [mensagem agendada] fim
    -- [resposta da ia] inicio
    and kind <> 'responder_com_ia'
    -- [resposta da ia] fim
    and locked_at < now() - interval '5 minutes'
    and attempts >= max_attempts;

  return query
  update job_queue j
  set status = 'executando',
      locked_by = p_worker,
      locked_at = now(),
      attempts = j.attempts + 1
  where j.id in (
    select id from job_queue
    where (
      (status = 'pendente' and run_at <= now())
       or (status = 'executando'
           and locked_at < now() - interval '5 minutes'
           and attempts < max_attempts)
    )
      -- [mensagem agendada] inicio
      and kind <> 'enviar_mensagem_agendada'
      -- [mensagem agendada] fim
      -- [resposta da ia] inicio
      and kind <> 'responder_com_ia'
      -- [resposta da ia] fim
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Privilegios das funcoes novas e da recriada
-- ---------------------------------------------------------------------------

-- So a service role (o servidor).
revoke execute on function public.telefone_e_numero_da_plataforma(text) from public, anon, authenticated;
grant execute on function public.telefone_e_numero_da_plataforma(text) to service_role;
revoke execute on function public.contato_tem_sinal_de_paciente(uuid, text) from public, anon, authenticated;
grant execute on function public.contato_tem_sinal_de_paciente(uuid, text) to service_role;
revoke execute on function public.ia_atende_no_whatsapp(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ia_atende_no_whatsapp(uuid, uuid, text) to service_role;
revoke execute on function public.ia_pode_falar_com(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ia_pode_falar_com(uuid, uuid, text) to service_role;
revoke execute on function public.frase_de_escalonamento_da_ia() from public, anon, authenticated;
grant execute on function public.frase_de_escalonamento_da_ia() to service_role;
revoke execute on function public.rotulo_do_motivo_da_ia(text) from public, anon, authenticated;
grant execute on function public.rotulo_do_motivo_da_ia(text) to service_role;
revoke execute on function public.passar_conversa_da_ia_para_equipe(uuid, text, text) from public, anon, authenticated;
grant execute on function public.passar_conversa_da_ia_para_equipe(uuid, text, text) to service_role;
revoke execute on function public.gravar_evento_da_ia(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gravar_evento_da_ia(uuid, text, text) to service_role;
revoke execute on function public.tirar_conversa_da_ia_pelo_servidor(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tirar_conversa_da_ia_pelo_servidor(uuid, uuid, text, uuid) to service_role;
revoke execute on function public.ia_marcar_respondida(uuid, text) from public, anon, authenticated;
grant execute on function public.ia_marcar_respondida(uuid, text) to service_role;
revoke execute on function public.enfileirar_resposta_da_ia(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.enfileirar_resposta_da_ia(uuid, uuid, uuid, boolean) to service_role;
revoke execute on function public.claim_jobs_da_ia(text, integer, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.claim_jobs_da_ia(text, integer, uuid[], boolean) to service_role;
revoke execute on function public.ia_pode_enviar_agora(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.ia_pode_enviar_agora(uuid, text, uuid, uuid, text, text) to service_role;
revoke execute on function public.disparar_ciclo_da_ia() from public, anon, authenticated;
grant execute on function public.disparar_ciclo_da_ia() to service_role;
revoke execute on function public.motor_ia_agendar() from public, anon, authenticated;
grant execute on function public.motor_ia_agendar() to service_role;
revoke execute on function public.motor_ia_desagendar() from public, anon, authenticated;
grant execute on function public.motor_ia_desagendar() to service_role;
revoke execute on function public.ia_jobs_devidos(uuid[], boolean, interval) from public, anon, authenticated;
grant execute on function public.ia_jobs_devidos(uuid[], boolean, interval) to service_role;

-- Internas: so o dono, de dentro das funcoes definer.
revoke execute on function public.ia_tirar_conversa(uuid, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.mensagem_ia_exige_aprovacao() from public, anon, authenticated, service_role;
revoke execute on function public.ia_estado_do_motor() from public, anon, authenticated, service_role;
revoke execute on function public.ia_contato_liberado_forcado_so_pela_funcao() from public, anon, authenticated, service_role;

-- Sessao e servidor.
revoke execute on function public.devolver_para_ia(uuid) from public, anon;
grant execute on function public.devolver_para_ia(uuid) to authenticated, service_role;
revoke execute on function public.ia_devolver_disponivel(uuid) from public, anon;
grant execute on function public.ia_devolver_disponivel(uuid) to authenticated, service_role;
revoke execute on function public.ler_rascunho_bloqueado(uuid) from public, anon;
grant execute on function public.ler_rascunho_bloqueado(uuid) to authenticated, service_role;
revoke execute on function public.situacao_da_ia_na_clinica(uuid) from public, anon;
grant execute on function public.situacao_da_ia_na_clinica(uuid) to authenticated, service_role;

-- A recriada: os grants de hoje (authenticated e service_role).
revoke execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean) from public, anon;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) job_queue, por ultimo (a fila fica parada o menor tempo possivel)
-- ---------------------------------------------------------------------------
-- CHECK redefinido INTEIRO: 'enviar_mensagem_agendada' continua (nota da
-- migration 20261006140000). Payload do kind so com ids (o CHECK exige a
-- conversa em uuid minusculo). Indice unico parcial: so o job que NUNCA
-- rodou (attempts = 0 e devolucoes = 0) junta a rajada; o retry
-- (falhar_job volta a pendente com attempts >= 1) e a retomada
-- (reagendar_job soma devolucoes) nunca colidem (23505) com o job novo da
-- mesma conversa.

lock table public.job_queue in access exclusive mode;

alter table public.job_queue
  drop constraint job_queue_kind_check,
  add constraint job_queue_kind_check check (kind in (
    'enviar_mensagem_ativa', 'baixar_midia', 'executar_passo_de_regua',
    'enviar_conversao_meta', 'oferecer_lista_espera', 'sincronizar_gasto_meta',
    'resolver_anuncio_meta', 'enviar_mensagem_agendada', 'responder_com_ia'));

-- coalesce: sem a chave, o ~ da nulo e o CHECK passaria.
alter table public.job_queue add constraint job_queue_ia_tem_conversa check (
  kind <> 'responder_com_ia'
  or coalesce((payload ->> 'conversation_id')
     ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false));

create unique index job_queue_resposta_da_ia_nova
  on public.job_queue ((payload ->> 'conversation_id'))
  where kind = 'responder_com_ia' and status = 'pendente'
    and attempts = 0 and devolucoes = 0;

notify pgrst, 'reload schema';
