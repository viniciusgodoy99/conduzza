-- ---------------------------------------------------------------------------
-- Mensagem agendada na conversa (06/10/2026)
-- ---------------------------------------------------------------------------
-- Item do backlog (docs/05) com o desenho revisado e as decisoes do dono de
-- 06/10/2026 (A1 a A5). A pessoa que esta com a conversa escreve uma
-- mensagem para sair sozinha numa data e hora (ate 1 ano a frente); o motor
-- envia na hora marcada, pelo MESMO numero da conversa, em nome de quem
-- assina, e a conversa fica com quem assina depois que a mensagem sai.
--
-- O que faz, na ordem do arquivo:
--
--   0. falhas_sem_envio(): os codigos de falha que garantem que a mensagem
--      nao saiu (espelho de FALHAS_SEM_ENVIO do send.ts).
--   1. mensagem_agendada: a tabela, com RLS. O texto vive aqui so enquanto
--      pode sair (e na nao enviada ate ser dispensada); depois vive em
--      message. clinic_id NOT NULL, contato da mesma clinica (gatilho
--      exigir_contato_da_mesma_clinica), sem DELETE (exclui-se cancelando).
--   2. proteger_mensagem_agendada: o gatilho que carimba autoria e datas
--      (o cliente nunca forja), confere futuro, teto de 1 ano no dia civil
--      da clinica, numero ativo, conversa em atendimento com quem agenda,
--      autorizacao vigente e o teto de 10 ativas por contato (com trava por
--      contato: duas insercoes simultaneas nao passam do teto), e deixa a
--      sessao mudar so texto e hora (editar), situacao para cancelada
--      (excluir) e dispensada_em (dispensar), uma coisa de cada vez.
--      A1: qualquer pessoa que escreve e ve a agendada edita; quem editou
--      por ultimo vira o ASSINANTE (coalesce(editada_por, criada_por)).
--      Excluir a que esta na fila cancela o job pendente se nada pode ter
--      saido: sem mensagem do job, ou mensagem 'falhou' com codigo de
--      falhas_sem_envio() (a mesma lista de FALHAS_SEM_ENVIO do send.ts).
--   3. RLS: membro ativo le (o profissional so a da conversa dele, a mesma
--      regua de message); quem escreve (user_can_write) agenda na conversa
--      que esta com ele e mexe na agendada que ve.
--   4. encerrar_agendada_sem_envio (A3): o UNICO caminho para nao_enviada e
--      nao_confirmada. Fecha a agendada e cria UMA atividade (contact_activity,
--      origem automacao, sem regra) para o assinante conferir, se ele ainda
--      e membro ativo com escrita; senao sem responsavel. Idempotente: so
--      fecha o que ainda esta agendada ou enviando, e a agendada guarda a
--      atividade (atividade_id).
--   5. planejar_mensagens_agendadas: a vencida vira job
--      'enviar_mensagem_agendada' (payload so com ids, NUNCA o texto), uma
--      por vez por contato e numero, na ordem (a que espera a anterior nem
--      entra no lote: o limite conta so o que da para planejar); vencida ha
--      mais de 12 h desiste ('atrasou'); numero removido nao sai. A2
--      (madrugada) e do executor: a planejadora cria o job na hora e quem
--      segura e ele. Cada agendada num bloco proprio: erro numa linha nao
--      para as outras (erros_por_linha).
--   6. Reconciliacao: reconciliar_mensagem_agendada (uma; o worker chama
--      depois de concluir ou falhar o job; com o job encerrado de vez, o
--      motivo FINAL do job vence o codigo velho da mensagem) e
--      reconciliar_mensagens_agendadas (lote do motor, uma por bloco, com a
--      retencao de 30 dias da A5: apaga o texto e dispensa a nao enviada e
--      a nao confirmada esquecidas).
--   7. tirar_agendada_para_enviar_agora: retira a agendada (A1: qualquer
--      pessoa que escreve e esta COM a conversa) e devolve o texto para o
--      envio 1:1 da Server Action. Retirar antes de enviar: o pior caso e
--      nada sair, nunca o paciente receber em dobro. Trilha
--      'retirou_agendada_para_enviar_agora' (o envio de fato e auditado pela
--      Server Action).
--   8. agendadas_param_na_revogacao: a revogacao da autorizacao encerra as
--      agendadas do contato na hora (regra 3.4), inclusive a que esta na
--      fila com o job pendente (o job e cancelado). Reautorizar nao as
--      revive. A revogacao nunca falha por causa de uma agendada.
--   9. remover_numero: as agendadas do numero removido nao saem (o job
--      pendente e cancelado no mesmo passo).
--  10. motor_manutencao: planejadora e reconciliacao, por ultimo. Codigos
--      novos no planner_erro: mensagem_agendada:<SQLSTATE>,
--      agendada_reconciliar:<SQLSTATE>, agendadas_erros:<n> (linhas que
--      deram erro nesta passagem) e agendadas_presas:<n> (runbook
--      supabase/operacao/motor-por-cron.md).
--  11. atendimento_do_periodo: a agendada nao conta como primeira resposta.
--  12. validar_atividade: aceita a atividade da agendada (origem automacao
--      sem regra de automacao), inclusive dentro de uma sessao (a revogacao
--      pela ficha e feita pela sessao de quem revoga).
--  13. Privilegios. A tabela NAO entra na publicacao supabase_realtime: o
--      Realtime desta instancia (wal2json) ignora a lista de colunas da
--      publicacao e entregaria o texto a toda aba do Atendimento. A tela
--      rele a lista pela sessao (eventos de message e conversation, e um
--      intervalo enquanto a conversa esta aberta).
--  14. job_queue_kind_check com 'enviar_mensagem_agendada'. NOTA PARA O E3:
--      a migration do 'responder_com_ia' redefine esta lista inteira e
--      precisa manter 'enviar_mensagem_agendada'.
--  15. claim_jobs (o claim LEGADO do npm run worker e das suites de
--      integracao contra a producao) deixa de reivindicar e de enterrar o
--      kind 'enviar_mensagem_agendada': so o motor (claim_jobs_por_clinica)
--      executa agendada.
--
-- Regras gerais: corrida usa SQLSTATE CZ409 (NUNCA 40001 nem 40P01: o
-- PostgREST repete esses sem limite). Nenhuma mensagem de erro, last_error,
-- payload de job ou audit_log leva texto, nome ou telefone de paciente.
-- Funcoes novas: security definer, search_path vazio e nomes qualificados.
-- Os caminhos do sistema se identificam pela GUC
-- conduzza.agendada_pelo_sistema = 'sim' (so as funcoes definer daqui a
-- ligam; o PostgREST nao expoe set_config), no padrao de
-- recalcular_previa_da_conversa, e cada funcao devolve o valor anterior.
--
-- LOCKS: APLICAR EM HORARIO CALMO (madrugada). Todas as travas das tabelas
-- quentes sao pegas logo abaixo, antes de qualquer DDL, numa ordem fixa e
-- ja no modo mais forte que a migration vai usar (sem subir de modo no
-- meio): primeiro job_queue em ACCESS EXCLUSIVE (troca do CHECK, cerca de
-- 1100 linhas), depois message, conversation, contact, whatsapp_account,
-- contact_consent e contact_activity em SHARE ROW EXCLUSIVE (FKs do CREATE
-- TABLE e o CREATE TRIGGER em contact_consent). O CREATE TABLE ainda pega
-- SHARE ROW EXCLUSIVE em clinic e auth.users (FKs de autoria), que quase
-- nao recebem escrita. Enquanto espera uma trava, a migration segura as que
-- ja pegou e as escritas nelas esperam (ate o lock_timeout de 5 s); um
-- envio em curso pode formar ciclo com ela e o detector derruba um dos
-- dois em 1 s. Se a migration cair (55P03 ou 40P01), nada fica gravado:
-- tentar de novo minutos depois. Nada aqui faz ALTER em message,
-- conversation ou contact.
--
-- ROLLBACK manual, nesta ordem:
--   0. ANTES de tudo, publicar o codigo sem a mensagem agendada (lista,
--      acoes, executor e Enviar agora): com a tabela fora, essas chamadas
--      falham.
--   1. drop trigger agendadas_param_na_revogacao on public.contact_consent;
--      drop trigger proteger_mensagem_agendada on public.mensagem_agendada;
--   2. update public.job_queue set status = 'cancelado', last_error =
--      'rollback' where kind = 'enviar_mensagem_agendada' and status in
--      ('pendente', 'executando');
--   3. reaplicar os corpos ANTERIORES de remover_numero, motor_manutencao,
--      atendimento_do_periodo, validar_atividade e claim_jobs, lidos da
--      producao antes desta migration e guardados em
--      supabase/operacao/rollback/20261006140000-corpos-anteriores.sql;
--   4. drop table public.mensagem_agendada; drop das funcoes novas
--      (proteger_mensagem_agendada, agendadas_param_na_revogacao,
--      encerrar_agendada_sem_envio, planejar_mensagens_agendadas,
--      reconciliar_mensagem_agendada, reconciliar_mensagens_agendadas,
--      motivo_da_agendada, tirar_agendada_para_enviar_agora,
--      falhas_sem_envio);
--   5. job_queue_kind_check sem 'enviar_mensagem_agendada' (so depois do
--      passo 2; as linhas antigas desse kind precisam sair antes: delete
--      from public.job_queue where kind = 'enviar_mensagem_agendada');
--   6. notify pgrst, 'reload schema';
--   As atividades criadas pela agendada ficam (sao do CRM).
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

-- Ordem fixa, a mais forte primeiro (cabecalho, LOCKS).
lock table public.job_queue in access exclusive mode;
lock table public.message, public.conversation, public.contact,
  public.whatsapp_account, public.contact_consent, public.contact_activity
  in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- 0) Falhas que garantem que a mensagem NAO saiu
-- ---------------------------------------------------------------------------
-- A MESMA lista de FALHAS_SEM_ENVIO (lib/integrations/whatsapp/send.ts; um
-- teste de unidade cruza as duas). Uma message 'falhou' com um destes
-- codigos certamente nao chegou ao paciente, e o job volta a 'pendente'
-- para nova tentativa. Excluir a agendada, remover o numero e revogar a
-- autorizacao cancelam o job pendente quando a unica mensagem dele e assim.
-- Uma linha por codigo.

create or replace function public.falhas_sem_envio()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    'slot_indisponivel',
    'leitura_falhou',
    'canal_ocupado',
    'sem_consentimento_no_envio',
    'sem_instancia',
    'configuracao_ausente',
    'provider_indisponivel'
  ]::text[]
$$;

-- ---------------------------------------------------------------------------
-- 1) Tabela e indices
-- ---------------------------------------------------------------------------

create table public.mensagem_agendada (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  -- Apagar o contato (LGPD) leva as agendadas junto.
  contact_id uuid not null references public.contact (id) on delete cascade,
  -- O numero e FIXO: a agendada nunca troca de numero (numero removido nao
  -- sai). Numero e apagado so pela clinica (cascata).
  whatsapp_account_id uuid not null references public.whatsapp_account (id),
  -- A conversa onde foi agendada; depois de sair, a da mensagem enviada.
  conversation_id uuid references public.conversation (id) on delete set null,
  -- Dado de paciente. Nulo depois de enviada, cancelada ou dispensada.
  texto text,
  enviar_em timestamptz not null,
  situacao text not null default 'agendada',
  motivo text,
  criada_por uuid not null references auth.users (id),
  criada_em timestamptz not null default now(),
  -- A1: quem editou por ultimo; o assinante e coalesce(editada_por,
  -- criada_por).
  editada_por uuid references auth.users (id),
  editada_em timestamptz,
  cancelada_por uuid references auth.users (id),
  cancelada_em timestamptz,
  dispensada_por uuid references auth.users (id),
  dispensada_em timestamptz,
  job_id uuid references public.job_queue (id) on delete set null,
  message_id uuid references public.message (id) on delete set null,
  -- A3: a atividade criada quando a agendada nao saiu (uma so).
  atividade_id uuid references public.contact_activity (id) on delete set null,
  enviada_em timestamptz,
  encerrada_em timestamptz,
  updated_at timestamptz not null default now(),
  constraint situacao_da_agendada check (situacao in (
    'agendada', 'enviando', 'enviada', 'nao_enviada', 'nao_confirmada',
    'cancelada'
  )),
  -- Mesma lista de MOTIVOS_DA_AGENDADA (lib/domain/mensagem-agendada.ts; um
  -- teste de unidade cruza as duas).
  constraint motivo_da_agendada check (motivo is null or motivo in (
    'sem_autorizacao', 'numero_removido', 'numero_desconectado', 'atrasou',
    'madrugada', 'canal_ocupado', 'falha_no_envio', 'envio_incerto',
    'enviada_agora'
  )),
  constraint texto_da_agendada
    check (texto is null or char_length(btrim(texto)) between 1 and 4096),
  constraint texto_enquanto_vale
    check (texto is not null or situacao not in ('agendada', 'enviando'))
);

comment on table public.mensagem_agendada is
  'Mensagem escrita por uma pessoa para sair sozinha na hora marcada. O texto vive aqui so enquanto pode sair (e na nao enviada ate ser dispensada); depois vive em message. Dado de paciente: RLS, leitura auditada pelo codigo, nunca em log.';
comment on column public.mensagem_agendada.editada_por is
  'Quem editou por ultimo. O assinante da agendada (author_user_id da mensagem, dono da conversa depois do envio, responsavel pela atividade quando nao sai) e coalesce(editada_por, criada_por).';
comment on column public.mensagem_agendada.atividade_id is
  'Atividade criada por encerrar_agendada_sem_envio quando a agendada nao saiu (uma por agendada).';

-- Lista do contato (todos os numeros), vencidas da planejadora, uma por vez
-- por contato e numero, as do numero (remover_numero), as do assinante
-- (Configuracoes > Equipe), as FKs com ON DELETE SET NULL e a retencao.
create index mensagem_agendada_contato
  on public.mensagem_agendada (clinic_id, contact_id);
create index mensagem_agendada_vencendo
  on public.mensagem_agendada (enviar_em)
  where situacao = 'agendada';
create index mensagem_agendada_enviando
  on public.mensagem_agendada (clinic_id, contact_id, whatsapp_account_id)
  where situacao = 'enviando';
create index mensagem_agendada_numero
  on public.mensagem_agendada (whatsapp_account_id)
  where situacao in ('agendada', 'enviando');
create index mensagem_agendada_autor
  on public.mensagem_agendada (clinic_id, (coalesce(editada_por, criada_por)))
  where situacao = 'agendada';
create index mensagem_agendada_conversa
  on public.mensagem_agendada (conversation_id)
  where conversation_id is not null;
create index mensagem_agendada_mensagem
  on public.mensagem_agendada (message_id)
  where message_id is not null;
create unique index mensagem_agendada_job
  on public.mensagem_agendada (job_id)
  where job_id is not null;
create unique index mensagem_agendada_atividade
  on public.mensagem_agendada (atividade_id)
  where atividade_id is not null;
create index mensagem_agendada_para_reter
  on public.mensagem_agendada (encerrada_em)
  where situacao in ('nao_enviada', 'nao_confirmada') and dispensada_em is null;
-- O duplo clique e o reenvio do formulario: a mesma mensagem, para o mesmo
-- contato, pelo mesmo numero, na mesma hora, so uma vez enquanto vale.
create unique index mensagem_agendada_sem_duplicata
  on public.mensagem_agendada (
    clinic_id, contact_id, whatsapp_account_id, enviar_em, md5(texto)
  )
  where situacao in ('agendada', 'enviando');

create trigger exigir_contato_da_mesma_clinica
  before insert on public.mensagem_agendada
  for each row execute function public.exigir_contato_da_mesma_clinica();

-- ---------------------------------------------------------------------------
-- 2) Gatilho de protecao (molde validar_atividade)
-- ---------------------------------------------------------------------------
-- Nenhum CHECK usa now(): futuro e teto ficam aqui. O WITH CHECK da RLS roda
-- depois dos gatilhos BEFORE, entao o criada_por carimbado satisfaz a policy.

create or replace function public.proteger_mensagem_agendada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_fuso text;
  v_hoje date;
  v_excluir boolean;
  v_dispensar boolean;
  v_editar boolean;
  v_so_fk public.mensagem_agendada;
  -- Teto de agendadas ativas por contato (A5, padrao assumido; o dono pode
  -- trocar). Espelho: TETO_DE_AGENDADAS_POR_CONTATO.
  v_teto constant integer := 10;
begin
  -- Motor, executor, remover_numero e revogacao (sem sessao ou pela GUC).
  if v_uid is null
     or coalesce(current_setting('conduzza.agendada_pelo_sistema', true), '') = 'sim' then
    new.updated_at := now();
    return new;
  end if;

  -- ON DELETE SET NULL de conversa, job, mensagem ou atividade apagada: a
  -- cascata roda dentro do gatilho da FK (profundidade > 1) com a sessao de
  -- quem apagou. Passa so quando a unica mudanca e a FK virando nula.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    v_so_fk := new;
    if new.conversation_id is null then v_so_fk.conversation_id := old.conversation_id; end if;
    if new.job_id is null then v_so_fk.job_id := old.job_id; end if;
    if new.message_id is null then v_so_fk.message_id := old.message_id; end if;
    if new.atividade_id is null then v_so_fk.atividade_id := old.atividade_id; end if;
    if v_so_fk is not distinct from old then
      new.updated_at := now();
      return new;
    end if;
  end if;

  new.updated_at := now();
  select coalesce(c.timezone, 'America/Fortaleza') into v_fuso
    from public.clinic c where c.id = new.clinic_id;
  v_fuso := coalesce(v_fuso, 'America/Fortaleza');
  v_hoje := (now() at time zone v_fuso)::date;

  if tg_op = 'INSERT' then
    -- Autoria e estado inicial: sempre do banco, nunca do cliente.
    new.criada_por := v_uid;
    new.criada_em := now();
    new.situacao := 'agendada';
    new.motivo := null;
    new.job_id := null;
    new.message_id := null;
    new.atividade_id := null;
    new.enviada_em := null;
    new.encerrada_em := null;
    new.editada_por := null;
    new.editada_em := null;
    new.cancelada_por := null;
    new.cancelada_em := null;
    new.dispensada_por := null;
    new.dispensada_em := null;
    -- Primeiro a permissao: quem nao escreve nesta clinica nao aprende nada
    -- sobre numero, conversa ou autorizacao dela pelas mensagens abaixo (o
    -- gatilho roda antes do WITH CHECK da policy).
    if not public.user_can_write(new.clinic_id) then
      raise exception 'Sem permissão para agendar mensagens nesta clínica.'
        using errcode = '42501';
    end if;
    if new.texto is null or char_length(btrim(new.texto)) not between 1 and 4096 then
      raise exception 'Escreva a mensagem (até 4096 caracteres).'
        using errcode = '23514';
    end if;
    if new.enviar_em <= now() then
      raise exception 'Essa hora já passou. Escolha outra.'
        using errcode = '23514';
    end if;
    if (new.enviar_em at time zone v_fuso)::date > (v_hoje + interval '1 year')::date then
      raise exception 'Mais de 1 ano à frente não dá para agendar.'
        using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.whatsapp_account w
       where w.id = new.whatsapp_account_id
         and w.clinic_id = new.clinic_id
         and w.removido_em is null
    ) then
      raise exception 'O número desta conversa foi removido. Não dá para agendar por ele.'
        using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.conversation c
       where c.id = new.conversation_id
         and c.clinic_id = new.clinic_id
         and c.contact_id = new.contact_id
         and c.whatsapp_account_id = new.whatsapp_account_id
         and c.status = 'em_atendimento'
         and c.assignee_user_id = v_uid
    ) then
      raise exception 'Assuma a conversa antes de agendar.'
        using errcode = '42501';
    end if;
    if public.consentimento_vigente(new.clinic_id, new.contact_id, 'whatsapp') is not true then
      raise exception 'Este contato não autorizou receber mensagens. Registre a autorização na ficha antes de agendar.'
        using errcode = '23514';
    end if;
    -- Teto com trava por contato: duas insercoes simultaneas do mesmo
    -- contato (duas abas, dois numeros) contam uma depois da outra. A
    -- contagem roda depois da espera, com snapshot novo (READ COMMITTED), e
    -- ve a linha que a outra ja gravou. Dura so ate o fim da transacao.
    perform pg_advisory_xact_lock(
      hashtextextended('mensagem_agendada:' || new.contact_id::text, 0)
    );
    if (
      select count(*) from public.mensagem_agendada a
       where a.clinic_id = new.clinic_id
         and a.contact_id = new.contact_id
         and a.situacao = 'agendada'
    ) >= v_teto then
      raise exception 'Este contato já tem muitas mensagens agendadas. Exclua uma antes de agendar outra.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE pela sessao: so texto, hora, exclusao e dispensa.
  if (new.id, new.clinic_id, new.contact_id, new.whatsapp_account_id,
      new.conversation_id, new.criada_por, new.criada_em, new.job_id,
      new.message_id, new.atividade_id, new.enviada_em, new.encerrada_em,
      new.motivo)
     is distinct from
     (old.id, old.clinic_id, old.contact_id, old.whatsapp_account_id,
      old.conversation_id, old.criada_por, old.criada_em, old.job_id,
      old.message_id, old.atividade_id, old.enviada_em, old.encerrada_em,
      old.motivo) then
    raise exception 'Só o texto, a hora, a exclusão e o dispensar mudam por aqui.'
      using errcode = '42501';
  end if;
  v_excluir := new.situacao is distinct from old.situacao;
  v_dispensar := old.dispensada_em is null and new.dispensada_em is not null;
  v_editar := new.texto is distinct from old.texto
              or new.enviar_em is distinct from old.enviar_em;
  -- Carimbos nunca vem do cliente.
  new.editada_por := old.editada_por;
  new.editada_em := old.editada_em;
  new.cancelada_por := old.cancelada_por;
  new.cancelada_em := old.cancelada_em;
  new.dispensada_por := old.dispensada_por;
  new.dispensada_em := old.dispensada_em;
  if v_excluir::int + v_dispensar::int + v_editar::int > 1 then
    raise exception 'Faça uma mudança de cada vez.'
      using errcode = '42501';
  end if;

  if v_excluir then
    if new.situacao <> 'cancelada' or old.situacao not in ('agendada', 'enviando') then
      raise exception 'Só dá para excluir uma mensagem agendada ou na fila para sair.'
        using errcode = '42501';
    end if;
    if old.situacao = 'enviando' then
      -- Atomico com o claim, que so reivindica 'pendente': ou o job e
      -- cancelado aqui, ou ja comecou a sair e a exclusao perde. A message
      -- do job que 'falhou' com codigo de falhas_sem_envio() certamente nao
      -- saiu (o job so voltou a 'pendente' para tentar de novo): cancela.
      -- Qualquer outra message (enviando, enviada, envio_incerto, codigo
      -- fora da lista ou nulo) pode ter chegado: a exclusao perde.
      update public.job_queue j
         set status = 'cancelado',
             last_error = 'cancelada_pela_clinica'
       where j.id = old.job_id
         and j.status = 'pendente'
         and not exists (
           select 1 from public.message m
            where m.job_id = j.id
              and not coalesce(
                m.delivery_status = 'falhou'
                  and m.error_code = any (public.falhas_sem_envio()),
                false)
         );
      if not found then
        raise exception 'Esta mensagem já começou a sair e não dá mais para excluir. Confira a conversa.'
          using errcode = 'CZ409';
      end if;
    end if;
    new.cancelada_por := v_uid;
    new.cancelada_em := now();
    new.encerrada_em := now();
    new.texto := null;
    return new;
  end if;

  if v_dispensar then
    if old.situacao not in ('nao_enviada', 'nao_confirmada') then
      raise exception 'Só uma mensagem que não saiu pode ser dispensada.'
        using errcode = '42501';
    end if;
    new.dispensada_por := v_uid;
    new.dispensada_em := now();
    new.texto := null;
    return new;
  end if;

  if v_editar then
    if old.situacao <> 'agendada' then
      raise exception 'Esta mensagem já começou a sair e a mudança não foi salva. Confira a conversa.'
        using errcode = 'CZ409';
    end if;
    -- A1: qualquer pessoa que escreve e ve a agendada (RLS) edita; ela passa
    -- a assinar.
    if new.texto is null or char_length(btrim(new.texto)) not between 1 and 4096 then
      raise exception 'Escreva a mensagem (até 4096 caracteres).'
        using errcode = '23514';
    end if;
    if new.enviar_em is distinct from old.enviar_em then
      if new.enviar_em <= now() then
        raise exception 'Essa hora já passou. Escolha outra.'
          using errcode = '23514';
      end if;
      if (new.enviar_em at time zone v_fuso)::date > (v_hoje + interval '1 year')::date then
        raise exception 'Mais de 1 ano à frente não dá para agendar.'
          using errcode = '23514';
      end if;
    end if;
    new.editada_por := v_uid;
    new.editada_em := now();
  end if;
  return new;
end;
$$;

create trigger proteger_mensagem_agendada
  before insert or update on public.mensagem_agendada
  for each row execute function public.proteger_mensagem_agendada();

-- ---------------------------------------------------------------------------
-- 3) RLS e privilegios da tabela
-- ---------------------------------------------------------------------------

alter table public.mensagem_agendada enable row level security;

revoke all on table public.mensagem_agendada from anon;
-- Sem DELETE: exclui-se cancelando, como atividade. A cascata do contato e
-- da clinica nao depende deste privilegio.
revoke delete, truncate, references, trigger on table public.mensagem_agendada
  from authenticated;

-- Membro ativo le; o profissional so a da conversa dele (a mesma regua de
-- message), mais a da conversa aberta do mesmo contato e numero (a agendada
-- de uma conversa resolvida continua visivel na conversa nova).
create policy "membro ativo le agendadas conforme papel"
  on public.mensagem_agendada
  for select to authenticated
  using (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
         where c.clinic_id = mensagem_agendada.clinic_id
           and c.assignee_user_id = auth.uid()
           and (
             c.id = mensagem_agendada.conversation_id
             or (c.contact_id = mensagem_agendada.contact_id
                 and c.whatsapp_account_id = mensagem_agendada.whatsapp_account_id
                 and c.status <> 'resolvida')
           )
      )
    )
  );

-- Quem pode responder agenda, em nome proprio, na conversa em atendimento
-- com ele (o gatilho confere de novo, com a mensagem de erro).
create policy "quem responde agenda"
  on public.mensagem_agendada
  for insert to authenticated
  with check (
    public.user_can_write(clinic_id)
    and criada_por = auth.uid()
    and situacao = 'agendada'
    and exists (
      select 1 from public.conversation c
       where c.id = mensagem_agendada.conversation_id
         and c.clinic_id = mensagem_agendada.clinic_id
         and c.contact_id = mensagem_agendada.contact_id
         and c.whatsapp_account_id = mensagem_agendada.whatsapp_account_id
         and c.status = 'em_atendimento'
         and c.assignee_user_id = auth.uid()
    )
  );

-- A1: quem escreve mexe (edita, exclui, dispensa) na agendada que ve. O que
-- cada um pode mudar fica no gatilho. Cancelada e enviada nao mudam mais.
create policy "quem escreve mexe na agendada que ve"
  on public.mensagem_agendada
  for update to authenticated
  using (
    public.user_can_write(clinic_id)
    and situacao in ('agendada', 'enviando', 'nao_enviada', 'nao_confirmada')
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
         where c.clinic_id = mensagem_agendada.clinic_id
           and c.assignee_user_id = auth.uid()
           and (
             c.id = mensagem_agendada.conversation_id
             or (c.contact_id = mensagem_agendada.contact_id
                 and c.whatsapp_account_id = mensagem_agendada.whatsapp_account_id
                 and c.status <> 'resolvida')
           )
      )
    )
  )
  with check (public.user_can_write(clinic_id));

-- ---------------------------------------------------------------------------
-- 4) Encerrar sem envio, com a atividade (A3)
-- ---------------------------------------------------------------------------
-- Todos os caminhos que marcam nao_enviada ou nao_confirmada passam aqui:
-- planejadora (atrasou, numero_removido), reconciliacao, revogacao e
-- remover_numero. Devolve true quando fechou agora (e criou a atividade).
-- A atividade nao leva o texto da mensagem, o nome nem o telefone do
-- contato: o que fazer, o motivo em texto da tela e a hora marcada.

create or replace function public.encerrar_agendada_sem_envio(
  p_agendada_id uuid,
  p_situacao text,
  p_motivo text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.mensagem_agendada%rowtype;
  v_antes text := current_setting('conduzza.agendada_pelo_sistema', true);
  v_fuso text;
  v_numero text;
  v_quando text;
  v_motivo_texto text;
  v_titulo text;
  v_detalhes text;
  v_responsavel uuid;
  v_atividade uuid;
begin
  if p_situacao is null or p_situacao not in ('nao_enviada', 'nao_confirmada') then
    raise exception 'Situação de encerramento inválida.' using errcode = '22023';
  end if;

  select * into a
    from public.mensagem_agendada
   where id = p_agendada_id
   for update;
  if not found or a.situacao not in ('agendada', 'enviando') then
    return false; -- ja encerrada: nada a fazer, nenhuma atividade nova
  end if;

  perform set_config('conduzza.agendada_pelo_sistema', 'sim', true);

  if a.atividade_id is null then
    select coalesce(c.timezone, 'America/Fortaleza') into v_fuso
      from public.clinic c where c.id = a.clinic_id;
    v_fuso := coalesce(v_fuso, 'America/Fortaleza');
    select w.nome into v_numero
      from public.whatsapp_account w where w.id = a.whatsapp_account_id;
    v_quando := to_char(a.enviar_em at time zone v_fuso, 'DD/MM/YYYY "às" HH24:MI');

    if p_situacao = 'nao_confirmada' then
      v_titulo := 'Conferir se a mensagem agendada chegou';
      v_detalhes := format(
        'A mensagem agendada para %s pode ter chegado ao paciente. Confira a conversa antes de mandar de novo.',
        v_quando);
    else
      v_titulo := 'Mensagem agendada não saiu';
      v_motivo_texto := case p_motivo
        when 'sem_autorizacao' then 'o contato não autoriza receber mensagens'
        when 'numero_removido' then
          format('o número %s foi removido da clínica', coalesce(v_numero, 'da conversa'))
        when 'numero_desconectado' then
          format('o número %s ficou desconectado por mais de 12 horas', coalesce(v_numero, 'da conversa'))
        when 'atrasou' then 'o envio atrasou mais de 12 horas'
        when 'madrugada' then 'o envio atrasou e cairia de madrugada'
        when 'canal_ocupado' then 'o número ficou ocupado com outros envios por tempo demais'
        else 'erro do sistema no envio'
      end;
      if p_motivo = 'sem_autorizacao' then
        v_detalhes := format('A mensagem agendada para %s não saiu: %s.', v_quando, v_motivo_texto);
      else
        v_detalhes := format(
          'A mensagem agendada para %s não saiu: %s. Confira a conversa e, se ainda fizer sentido, agende de novo.',
          v_quando, v_motivo_texto);
      end if;
    end if;

    -- Responsavel: o assinante, se ainda e membro ativo com escrita
    -- (Somente leitura conta como "saiu da equipe", A1/A5); senao ninguem.
    select cm.user_id into v_responsavel
      from public.clinic_member cm
     where cm.clinic_id = a.clinic_id
       and cm.user_id = coalesce(a.editada_por, a.criada_por)
       and cm.status = 'ativo'
       and cm.role in ('admin', 'gestor', 'recepcao', 'profissional');

    -- Prazo: hoje, dia todo, no fuso da clinica (regra 3.6). Origem
    -- automacao sem regra (validar_atividade aceita pela GUC).
    insert into public.contact_activity (
      clinic_id, contact_id, conversation_id, titulo, detalhes, due_on,
      assignee_user_id, origem
    ) values (
      a.clinic_id, a.contact_id, a.conversation_id, v_titulo, v_detalhes,
      (now() at time zone v_fuso)::date, v_responsavel, 'automacao'
    )
    returning id into v_atividade;

    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (a.clinic_id, null, 'agendada_criou_atividade', 'contact_activity', v_atividade);
  end if;

  update public.mensagem_agendada
     set situacao = p_situacao,
         motivo = p_motivo,
         encerrada_em = now(),
         atividade_id = coalesce(a.atividade_id, v_atividade)
   where id = a.id;

  perform set_config('conduzza.agendada_pelo_sistema', coalesce(v_antes, ''), true);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Planejadora
-- ---------------------------------------------------------------------------
-- A vencida vira job, uma por vez por contato e numero (na ordem de
-- enviar_em, criada_em, id). FOR KEY SHARE SKIP LOCKED no numero: com
-- remover_numero em andamento (que trava o numero FOR UPDATE e depois as
-- agendadas), a planejadora pula as agendadas dele em vez de travar no FK do
-- job e formar um deadlock; a passagem seguinte as fecha como
-- numero_removido.
--
-- A vez entra no WHERE: a agendada que espera a anterior do mesmo contato e
-- numero (uma 'enviando', ou uma 'agendada' que vem antes) nem entra no
-- lote, e o LIMIT conta so o que da para planejar. Sem isso, 200 agendadas
-- presas atras de um numero caido gastariam o lote de todas as clinicas a
-- cada passagem. A antecessora 'agendada' tambem esta vencida e vem antes
-- na ordem, entao entra no mesmo lote; a sucessora vai na passagem
-- seguinte. A checagem dentro do laco fica como segunda trava.
--
-- Cada agendada num bloco proprio: um erro numa linha (atividade recusada,
-- por exemplo) desfaz so ela, conta em erros_por_linha e as outras seguem.
-- O aviso leva so o id e o SQLSTATE.

create or replace function public.planejar_mensagens_agendadas(
  p_limite integer default 200,
  p_clinic_id uuid default null,
  p_incluir_teste boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_job uuid;
  v_antes text := current_setting('conduzza.agendada_pelo_sistema', true);
  v_plan integer := 0;
  v_atras integer := 0;
  v_rem integer := 0;
  v_vez integer := 0;
  v_erros integer := 0;
begin
  perform set_config('conduzza.agendada_pelo_sistema', 'sim', true);
  for v in
    select a.id, a.clinic_id, a.contact_id, a.whatsapp_account_id,
           a.enviar_em, a.criada_em, w.removido_em
      from public.mensagem_agendada a
      join public.clinic c on c.id = a.clinic_id
      join public.whatsapp_account w on w.id = a.whatsapp_account_id
     where a.situacao = 'agendada'
       and a.enviar_em <= now()
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
       and (p_incluir_teste or not c.e_de_teste)
       and (
         a.enviar_em < now() - interval '12 hours'
         or w.removido_em is not null
         or not exists (
           select 1 from public.mensagem_agendada o
            where o.clinic_id = a.clinic_id
              and o.contact_id = a.contact_id
              and o.whatsapp_account_id = a.whatsapp_account_id
              and o.id <> a.id
              and (
                o.situacao = 'enviando'
                or (o.situacao = 'agendada'
                    and (o.enviar_em, o.criada_em, o.id) < (a.enviar_em, a.criada_em, a.id))
              )
         )
       )
     order by a.enviar_em, a.criada_em, a.id
     limit greatest(1, least(coalesce(p_limite, 200), 1000))
     for update of a skip locked
     for key share of w skip locked
  loop
    begin
      if v.enviar_em < now() - interval '12 hours' then
        if public.encerrar_agendada_sem_envio(v.id, 'nao_enviada', 'atrasou') then
          v_atras := v_atras + 1;
        end if;
      elsif v.removido_em is not null then
        if public.encerrar_agendada_sem_envio(v.id, 'nao_enviada', 'numero_removido') then
          v_rem := v_rem + 1;
        end if;
      elsif exists (
        select 1 from public.mensagem_agendada o
         where o.clinic_id = v.clinic_id
           and o.contact_id = v.contact_id
           and o.whatsapp_account_id = v.whatsapp_account_id
           and o.id <> v.id
           and (
             o.situacao = 'enviando'
             or (o.situacao = 'agendada'
                 and (o.enviar_em, o.criada_em, o.id) < (v.enviar_em, v.criada_em, v.id))
           )
      ) then
        -- Segunda trava: a anterior surgiu depois da consulta. Espera (a
        -- contagem abaixo a inclui).
        null;
      else
        -- O payload nunca leva o texto: o executor le da agendada.
        insert into public.job_queue (
          clinic_id, kind, payload, whatsapp_account_id, prioridade, run_at
        ) values (
          v.clinic_id, 'enviar_mensagem_agendada',
          jsonb_build_object('contact_id', v.contact_id, 'mensagem_agendada_id', v.id),
          v.whatsapp_account_id, 0, now()
        )
        returning id into v_job;
        update public.mensagem_agendada
           set situacao = 'enviando', job_id = v_job
         where id = v.id;
        v_plan := v_plan + 1;
      end if;
    exception when others then
      v_erros := v_erros + 1;
      raise warning 'planejar_mensagens_agendadas: agendada % (%)', v.id, sqlstate;
    end;
  end loop;
  perform set_config('conduzza.agendada_pelo_sistema', coalesce(v_antes, ''), true);

  -- Quantas vencidas (ate 12 h) esperam a anterior do mesmo contato e numero,
  -- fora do lote. So para o monitor: nada aqui muda estado.
  select count(*) into v_vez
    from public.mensagem_agendada a
    join public.clinic c on c.id = a.clinic_id
   where a.situacao = 'agendada'
     and a.enviar_em <= now()
     and a.enviar_em >= now() - interval '12 hours'
     and (p_clinic_id is null or a.clinic_id = p_clinic_id)
     and (p_incluir_teste or not c.e_de_teste)
     and exists (
       select 1 from public.mensagem_agendada o
        where o.clinic_id = a.clinic_id
          and o.contact_id = a.contact_id
          and o.whatsapp_account_id = a.whatsapp_account_id
          and o.id <> a.id
          and (
            o.situacao = 'enviando'
            or (o.situacao = 'agendada'
                and (o.enviar_em, o.criada_em, o.id) < (a.enviar_em, a.criada_em, a.id))
          )
     );

  return jsonb_build_object(
    'planejadas', v_plan,
    'atrasadas', v_atras,
    'numero_removido', v_rem,
    'esperando_a_anterior', v_vez,
    'erros_por_linha', v_erros
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Reconciliacao (substitui gatilho em job_queue)
-- ---------------------------------------------------------------------------

-- Codigo curto do job ou da mensagem para o motivo da tela (so devolve
-- motivos de MOTIVOS_DA_AGENDADA; os testes de unidade da agendada leem os
-- ramos daqui); o que nao casa e 'falha_no_envio'.
create or replace function public.motivo_da_agendada(p_codigo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_codigo in ('sem_consentimento', 'sem_consentimento_no_envio') then 'sem_autorizacao'
    when p_codigo = 'numero_removido' then 'numero_removido'
    when p_codigo in ('desconectado', 'sem_numero') then 'numero_desconectado'
    when p_codigo = 'atrasou' then 'atrasou'
    when p_codigo = 'madrugada' then 'madrugada'
    when p_codigo in ('canal_ocupado', 'devolucoes_demais') then 'canal_ocupado'
    when p_codigo = 'envio_incerto' then 'envio_incerto'
    else 'falha_no_envio'
  end
$$;

-- Fecha UMA agendada 'enviando' pelo que o job e a mensagem dizem. O worker
-- chama depois de concluir ou falhar o job; o motor cobre o que escapar.
-- SKIP LOCKED: travada por outro caminho (exclusao, remover_numero), fica
-- para a proxima passagem.
create or replace function public.reconciliar_mensagem_agendada(p_agendada_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.mensagem_agendada%rowtype;
  v_antes text := current_setting('conduzza.agendada_pelo_sistema', true);
  v_js text;
  v_je text;
  m_id uuid;
  m_conv uuid;
  m_st text;
  m_cod text;
  m_em timestamptz;
  v_cod text;
  v_final text := 'sem_mudanca';
begin
  select * into a
    from public.mensagem_agendada
   where id = p_agendada_id
     and situacao = 'enviando'
   for update skip locked;
  if not found then
    return v_final;
  end if;

  select j.status, j.last_error into v_js, v_je
    from public.job_queue j where j.id = a.job_id;
  if a.job_id is not null then
    select m.id, m.conversation_id, m.delivery_status, m.error_code, m.created_at
      into m_id, m_conv, m_st, m_cod, m_em
      from public.message m
     where m.job_id = a.job_id;
  end if;

  perform set_config('conduzza.agendada_pelo_sistema', 'sim', true);
  if m_st in ('enviada', 'entregue', 'lida') then
    update public.mensagem_agendada
       set situacao = 'enviada',
           message_id = m_id,
           conversation_id = m_conv,
           enviada_em = m_em,
           encerrada_em = now(),
           motivo = null,
           texto = null
     where id = a.id;
    -- Decisao do dono, so depois de sair: a conversa fica com o assinante
    -- (A1), se ele ainda e membro ativo com escrita. Nunca rouba de colega
    -- nem da IA: so a conversa aguardando e sem atendente.
    update public.conversation c
       set status = 'em_atendimento',
           assignee_user_id = coalesce(a.editada_por, a.criada_por)
     where c.id = m_conv
       and c.clinic_id = a.clinic_id
       and c.status = 'aguardando_humano'
       and c.assignee_user_id is null
       and exists (
         select 1 from public.clinic_member cm
          where cm.clinic_id = a.clinic_id
            and cm.user_id = coalesce(a.editada_por, a.criada_por)
            and cm.status = 'ativo'
            and cm.role in ('admin', 'gestor', 'recepcao', 'profissional')
       );
    v_final := 'enviada';
  elsif v_js is null or v_js in ('falhou', 'cancelado', 'concluido') then
    -- O codigo do desfecho. Com o job encerrado de vez (falhou, cancelado),
    -- o motivo FINAL do job vence o codigo da message, que pode ser de uma
    -- tentativa antiga (leitura_falhou na 1a; sem_consentimento,
    -- numero_removido ou atrasou na 2a, que nao toca a message). Com o job
    -- concluido o last_error pode ser velho (concluir nao o limpa): vale o
    -- da message.
    v_cod := case when v_js in ('falhou', 'cancelado')
                  then coalesce(v_je, m_cod)
                  else coalesce(m_cod, v_je)
             end;
    if m_id is null then
      perform public.encerrar_agendada_sem_envio(
        a.id, 'nao_enviada', public.motivo_da_agendada(v_cod));
      v_final := 'nao_enviada';
    elsif m_st = 'falhou'
          and m_cod is distinct from 'envio_incerto'
          and v_cod is distinct from 'envio_incerto' then
      update public.mensagem_agendada set message_id = m_id where id = a.id;
      perform public.encerrar_agendada_sem_envio(
        a.id, 'nao_enviada', public.motivo_da_agendada(v_cod));
      v_final := 'nao_enviada';
    else
      -- 'enviando' parada ou envio_incerto: pode ter chegado.
      update public.mensagem_agendada set message_id = m_id where id = a.id;
      perform public.encerrar_agendada_sem_envio(a.id, 'nao_confirmada', 'envio_incerto');
      v_final := 'nao_confirmada';
    end if;
  end if;
  perform set_config('conduzza.agendada_pelo_sistema', coalesce(v_antes, ''), true);
  return v_final;
end;
$$;

-- Lote do motor: fecha as 'enviando' cujo job acabou (ou cuja mensagem ja
-- saiu), conta as presas (enviando ha mais de 13 h) e aplica a retencao da
-- A5 (nao enviada e nao confirmada esquecidas ha mais de 30 dias perdem o
-- texto e saem da lista, sem quem dispensou). Cada agendada num bloco
-- proprio: erro numa linha desfaz so ela e conta em erros_por_linha (o
-- aviso leva so o id e o SQLSTATE).
create or replace function public.reconciliar_mensagens_agendadas(
  p_limite integer default 200,
  p_clinic_id uuid default null,
  p_incluir_teste boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
     and (p_incluir_teste or not c.e_de_teste);

  return jsonb_build_object(
    'fechadas_enviadas', v_env,
    'fechadas_sem_envio', v_nao,
    'retidas', v_retidas,
    'presas', v_presas,
    'erros_por_linha', v_erros
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Enviar agora: retirar a agendada (o envio sai pelo trilho 1:1)
-- ---------------------------------------------------------------------------
-- A1: qualquer pessoa que escreve, ve a agendada e esta COM a conversa (em
-- atendimento e responsavel = ela). Sem oraculo de existencia: quem nao ve
-- recebe 'nao_encontrada', igual a quem pede um id que nao existe.

create or replace function public.tirar_agendada_para_enviar_agora(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := current_setting('conduzza.agendada_pelo_sistema', true);
  v public.mensagem_agendada%rowtype;
  v_conv uuid;
  v_texto text;
begin
  if v_uid is null then
    return jsonb_build_object('estado', 'nao_encontrada');
  end if;
  select * into v from public.mensagem_agendada where id = p_id for update;
  if not found or not public.user_can_write(v.clinic_id) then
    return jsonb_build_object('estado', 'nao_encontrada');
  end if;
  -- O profissional so ve a da conversa dele (mesma regra da policy de
  -- leitura).
  if public.user_has_role(v.clinic_id, array['profissional'])
     and not exists (
       select 1 from public.conversation c
        where c.clinic_id = v.clinic_id
          and c.assignee_user_id = v_uid
          and (
            c.id = v.conversation_id
            or (c.contact_id = v.contact_id
                and c.whatsapp_account_id = v.whatsapp_account_id
                and c.status <> 'resolvida')
          )
     ) then
    return jsonb_build_object('estado', 'nao_encontrada');
  end if;
  if v.situacao = 'enviando' then
    return jsonb_build_object('estado', 'ja_saindo');
  end if;
  if v.situacao <> 'agendada' then
    return jsonb_build_object('estado', 'nao_encontrada');
  end if;
  select c.id into v_conv
    from public.conversation c
   where c.clinic_id = v.clinic_id
     and c.contact_id = v.contact_id
     and c.whatsapp_account_id = v.whatsapp_account_id
     and c.status = 'em_atendimento'
     and c.assignee_user_id = v_uid;
  if v_conv is null then
    return jsonb_build_object('estado', 'assuma_a_conversa');
  end if;

  v_texto := v.texto;
  perform set_config('conduzza.agendada_pelo_sistema', 'sim', true);
  update public.mensagem_agendada
     set situacao = 'cancelada',
         motivo = 'enviada_agora',
         cancelada_por = v_uid,
         cancelada_em = now(),
         encerrada_em = now(),
         texto = null
   where id = v.id;
  perform set_config('conduzza.agendada_pelo_sistema', coalesce(v_antes, ''), true);
  -- A retirada, nao o envio: o que saiu (ou nao) a Server Action registra
  -- depois de tentar o 1:1.
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (v.clinic_id, v_uid, 'retirou_agendada_para_enviar_agora', 'mensagem_agendada', v.id);
  return jsonb_build_object('estado', 'ok', 'texto', v_texto, 'conversation_id', v_conv);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Revogacao da autorizacao encerra as agendadas (regra 3.4)
-- ---------------------------------------------------------------------------
-- Uma atividade por agendada (A3). Reautorizar nao revive nada: o
-- descadastro e definitivo.
--   - 'agendada': fecha na hora (nao_enviada, sem_autorizacao).
--   - 'enviando' com o job 'pendente' (esperando o numero, a madrugada, o
--     canal ou nova tentativa): cancela o job com o mesmo criterio da
--     exclusao (sem message, ou message 'falhou' com codigo de
--     falhas_sem_envio()) e last_error 'sem_consentimento', e fecha. Sem
--     isso, uma reautorizacao antes da execucao faria a mensagem escrita
--     antes do descadastro sair.
--   - 'enviando' com o job 'executando' (ou com message que pode ter saido):
--     fica com a reconferencia do send.ts e com a reconciliacao.
-- Trava as agendadas (ordem id) e depois o job, a mesma ordem da exclusao e
-- de remover_numero (sem deadlock). A revogacao NUNCA falha por causa de
-- uma agendada: cada uma num bloco proprio, e o laco inteiro em outro (o
-- executor confere a autorizacao de qualquer jeito). O aviso leva so o id
-- e o SQLSTATE.

create or replace function public.agendadas_param_na_revogacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_antes text;
begin
  if new.channel = 'whatsapp'
     and new.revoked_at is not null
     and (tg_op = 'INSERT' or old.revoked_at is null) then
    begin
      if public.consentimento_vigente(new.clinic_id, new.contact_id, 'whatsapp') then
        return null; -- outra autorizacao ainda vale
      end if;
      for v in
        select a.id, a.situacao, a.job_id
          from public.mensagem_agendada a
         where a.clinic_id = new.clinic_id
           and a.contact_id = new.contact_id
           and a.situacao in ('agendada', 'enviando')
         order by a.id
         for update
      loop
        begin
          if v.situacao = 'enviando' then
            update public.job_queue j
               set status = 'cancelado',
                   last_error = 'sem_consentimento'
             where j.id = v.job_id
               and j.status = 'pendente'
               and not exists (
                 select 1 from public.message m
                  where m.job_id = j.id
                    and not coalesce(
                      m.delivery_status = 'falhou'
                        and m.error_code = any (public.falhas_sem_envio()),
                      false)
               );
            if not found then
              -- Job executando: fica com a reconferencia do send.ts.
              continue;
            end if;
          end if;
          -- O cancelamento do job acima nao pode ser desfeito por uma falha
          -- ao fechar a agendada (revisao de 06/10/2026): fechar com a
          -- atividade num bloco proprio e, se falhar, fechar sem ela. Sem
          -- isso, uma reautorizacao antes da execucao soltaria a mensagem
          -- escrita antes do descadastro.
          begin
            perform public.encerrar_agendada_sem_envio(v.id, 'nao_enviada', 'sem_autorizacao');
          exception when others then
            begin
              v_antes := current_setting('conduzza.agendada_pelo_sistema', true);
              perform set_config('conduzza.agendada_pelo_sistema', 'sim', true);
              update public.mensagem_agendada
                 set situacao = 'nao_enviada',
                     motivo = 'sem_autorizacao',
                     encerrada_em = now()
               where id = v.id
                 and situacao in ('agendada', 'enviando');
              perform set_config('conduzza.agendada_pelo_sistema', coalesce(v_antes, ''), true);
              raise warning 'agendadas_param_na_revogacao: agendada % fechada sem atividade (%)', v.id, sqlstate;
            exception when others then
              raise warning 'agendadas_param_na_revogacao: agendada % sem fechar (%)', v.id, sqlstate;
            end;
          end;
        exception when others then
          raise warning 'agendadas_param_na_revogacao: agendada % (%)', v.id, sqlstate;
        end;
      end loop;
    exception when others then
      raise warning 'agendadas_param_na_revogacao: contato % (%)', new.contact_id, sqlstate;
    end;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) remover_numero (corpo atual do banco; so o bloco novo)
-- ---------------------------------------------------------------------------

create or replace function public.remover_numero(
  p_clinic_id uuid,
  p_account_id uuid,
  p_removido_por uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_conta whatsapp_account%rowtype;
  v_jobs integer;
  v_conversas uuid[];
  -- [mensagem agendada] inicio
  v_agendadas integer := 0;
  v_agendada uuid;
  v_antes_agendada text;
  -- [mensagem agendada] fim
begin
  perform pg_advisory_xact_lock(
    hashtextextended('whatsapp_account:' || p_clinic_id::text, 0)
  );

  select * into v_conta
    from whatsapp_account
   where id = p_account_id
     and clinic_id = p_clinic_id
   for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Número não encontrado nesta clínica.';
  end if;
  if v_conta.removido_em is not null then
    return jsonb_build_object(
      'ok', true,
      'ja_removido', true,
      'jobs_redistribuidos', 0,
      'conversas_encerradas', 0
    );
  end if;
  if v_conta.principal and exists (
    select 1 from whatsapp_account
     where clinic_id = p_clinic_id
       and removido_em is null
       and id <> p_account_id
  ) then
    raise exception using errcode = '55000',
      message = 'Escolha outro número como principal antes de remover este.';
  end if;

  update whatsapp_account
     set removido_em = now(),
         removido_por = p_removido_por,
         principal = false,
         connection_status = 'desconectado',
         disconnected_at = case
           when connection_status <> 'desconectado' then now()
           else disconnected_at
         end
   where id = p_account_id;

  update whatsapp_account_secret
     set instance_token = null,
         qr_code = null,
         qr_code_expires_at = null,
         webhook_secret = default
   where account_id = p_account_id;

  -- Decisao do dono (29/09/2026): o tipo que saia "sempre por este numero"
  -- volta para o ultimo numero usado pelo paciente. Antes da redistribuicao,
  -- para os jobs pendentes ja cairem na escolha nova.
  update whatsapp_envio_automatico
     set modo = 'ultimo_usado',
         conta_fixa_id = null
   where clinic_id = p_clinic_id
     and conta_fixa_id = p_account_id;

  v_jobs := redistribuir_jobs_do_numero(p_account_id);

  -- Ecos pendentes deste numero respondiam a conversas que estao sendo
  -- encerradas agora; sair por outro numero seria mensagem de um numero que
  -- o paciente nao usou (D4). Cancelados, sem envio.
  update job_queue
     set status = 'cancelado',
         last_error = 'numero_removido'
   where whatsapp_account_id = p_account_id
     and status = 'pendente'
     and payload ->> 'resposta_ao_paciente' = 'true'
     and not exists (select 1 from message m where m.job_id = job_queue.id);

  -- [mensagem agendada] inicio
  -- A agendada nunca troca de numero: a do numero removido nao sai. Trava as
  -- agendadas primeiro e os jobs depois, a mesma ordem da exclusao pela
  -- sessao (sem deadlock). O job pendente e cancelado com o criterio da
  -- exclusao: sem message, ou message 'falhou' com codigo de
  -- falhas_sem_envio() (certamente nao saiu). O job ja em 'executando'
  -- morre no executor com 'numero_removido' e a reconciliacao fecha a
  -- agendada. Cada uma ganha a atividade de "nao saiu"
  -- (encerrar_agendada_sem_envio, A3).
  v_antes_agendada := current_setting('conduzza.agendada_pelo_sistema', true);
  perform set_config('conduzza.agendada_pelo_sistema', 'sim', true);
  perform 1
     from public.mensagem_agendada a
    where a.whatsapp_account_id = p_account_id
      and a.situacao in ('agendada', 'enviando')
    order by a.id
      for update;
  update public.job_queue j
     set status = 'cancelado',
         last_error = 'numero_removido'
   where j.whatsapp_account_id = p_account_id
     and j.kind = 'enviar_mensagem_agendada'
     and j.status = 'pendente'
     and not exists (
       select 1 from public.message m
        where m.job_id = j.id
          and not coalesce(
            m.delivery_status = 'falhou'
              and m.error_code = any (public.falhas_sem_envio()),
            false)
     );
  for v_agendada in
    select a.id
      from public.mensagem_agendada a
     where a.whatsapp_account_id = p_account_id
       and (
         a.situacao = 'agendada'
         or (a.situacao = 'enviando'
             and exists (
               select 1 from public.job_queue j
                where j.id = a.job_id and j.status = 'cancelado'
             ))
       )
     order by a.id
  loop
    if public.encerrar_agendada_sem_envio(v_agendada, 'nao_enviada', 'numero_removido') then
      v_agendadas := v_agendadas + 1;
    end if;
  end loop;
  perform set_config('conduzza.agendada_pelo_sistema', coalesce(v_antes_agendada, ''), true);
  -- [mensagem agendada] fim

  with encerradas as (
    update conversation
       set status = 'resolvida',
           awaiting_reply = false
     where clinic_id = p_clinic_id
       and whatsapp_account_id = p_account_id
       and status <> 'resolvida'
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_conversas
    from encerradas;

  insert into message (
    clinic_id, conversation_id, direction, author, author_user_id,
    content_type, body, billable, cost_cents
  )
  select p_clinic_id, c.id, 'saida', 'sistema', p_removido_por,
         'evento',
         format(
           'Conversa encerrada porque o número "%s" foi removido da clínica.',
           v_conta.nome
         ),
         false, 0
    from unnest(v_conversas) as c(id);

  return jsonb_build_object(
    'ok', true,
    'ja_removido', false,
    'jobs_redistribuidos', v_jobs,
    'conversas_encerradas', cardinality(v_conversas)
    -- [mensagem agendada] inicio
    , 'agendadas_encerradas', v_agendadas
    -- [mensagem agendada] fim
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10) motor_manutencao (corpo atual do banco; so o bloco novo, por ultimo)
-- ---------------------------------------------------------------------------

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
    where worker_id not in ('motor-fila', 'motor-planner')
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
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 11) atendimento_do_periodo (corpo atual do banco; so o filtro novo)
-- ---------------------------------------------------------------------------
-- A mensagem agendada nao e primeira resposta: saiu sozinha. O Enviar agora
-- nao fica ligado a agendada (sai pelo 1:1) e conta, porque e resposta.

create or replace function public.atendimento_do_periodo(
  p_clinic_id uuid,
  p_de timestamp with time zone,
  p_ate timestamp with time zone,
  p_de_anterior timestamp with time zone default null::timestamp with time zone
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with janelas as (
        select 'atual'::text as rotulo, p_de as de, p_ate as ate
        union all
        select 'anterior', p_de_anterior, p_de where p_de_anterior is not null
      )
      select jsonb_object_agg(j.rotulo, bloco.corpo)
        from janelas j
        cross join lateral (
          with candidatas as (
            select conversation_id, min(created_at) as entrada_em
              from message
             where clinic_id = p_clinic_id and direction = 'entrada'
               and created_at >= j.de and created_at < j.ate
             group by 1
          ), elegiveis as (
            -- Garante que e a primeira entrada DA CONVERSA, nao so da janela.
            select c.* from candidatas c
             where not exists (
                     select 1 from message ant
                      where ant.conversation_id = c.conversation_id
                        and ant.direction = 'entrada'
                        and ant.created_at < c.entrada_em
                   )
          ), medidas as (
            select e.entrada_em,
                   (select min(m.created_at) from message m
                     where m.conversation_id = e.conversation_id
                       and m.direction = 'saida' and m.author = 'usuario'
                       and not m.is_internal_note
                       and m.created_at > e.entrada_em
                       -- [mensagem agendada] inicio
                       and not exists (
                         select 1 from public.mensagem_agendada ma
                          where ma.message_id = m.id
                       )
                       -- [mensagem agendada] fim
                   ) as resposta_em
              from elegiveis e
          )
          select jsonb_build_object(
            'conversas_iniciadas', (
              select count(*) from conversation cv
               where cv.clinic_id = p_clinic_id
                 and cv.created_at >= j.de and cv.created_at < j.ate
            ),
            'primeira_resposta', (
              select jsonb_build_object(
                'conversas', count(*),
                'respondidas', count(resposta_em),
                'mediana_segundos', round(percentile_cont(0.5) within group
                  (order by extract(epoch from resposta_em - entrada_em))::numeric),
                'p90_segundos', round(percentile_cont(0.9) within group
                  (order by extract(epoch from resposta_em - entrada_em))::numeric)
              ) from medidas
            ),
            'mensagens', (
              select jsonb_build_object(
                'por_autor', coalesce((
                  select jsonb_object_agg(t.author, t.n)
                    from (
                      select author, count(*) as n from message
                       where clinic_id = p_clinic_id
                         and created_at >= j.de and created_at < j.ate
                         and not is_internal_note
                       group by 1
                    ) t
                ), '{}'::jsonb),
                'entrada', count(*) filter (where direction = 'entrada'),
                'saida', count(*) filter (where direction = 'saida' and not is_internal_note),
                'notas_internas', count(*) filter (where is_internal_note)
              )
                from message
               where clinic_id = p_clinic_id
                 and created_at >= j.de and created_at < j.ate
            )
          ) as corpo
        ) bloco
    )
  end
$function$;

-- ---------------------------------------------------------------------------
-- 12) validar_atividade (corpo atual do banco; so o bloco novo)
-- ---------------------------------------------------------------------------
-- A atividade de "mensagem agendada nao saiu" (encerrar_agendada_sem_envio)
-- e do sistema mesmo quando nasce dentro de uma sessao (a revogacao pela
-- ficha roda com a sessao de quem revogou): origem automacao, sem autor e
-- sem regra de automacao. So a GUC das funcoes da agendada a libera.

create or replace function public.validar_atividade()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_fuso text;
  -- [mensagem agendada] inicio
  v_pela_agendada boolean :=
    coalesce(current_setting('conduzza.agendada_pelo_sistema', true), '') = 'sim';
  -- [mensagem agendada] fim
begin
  if tg_op = 'INSERT' then
    -- Autoria. Com sessao, a atividade e sempre em nome de quem esta usando
    -- e de origem manual (a policy de INSERT confere de novo). Sem sessao
    -- (motor, service role) valem os checks da tabela.
    -- [mensagem agendada] inicio
    if v_uid is not null and not v_pela_agendada then
    -- [mensagem agendada] fim
      if new.origem is distinct from 'manual' then
        raise exception 'Atividade criada por uma pessoa tem origem manual.'
          using errcode = '42501';
      end if;
      if new.created_by is null then
        new.created_by := v_uid;
      elsif new.created_by <> v_uid then
        raise exception 'A atividade é criada em nome de quem está usando o sistema.'
          using errcode = '42501';
      end if;
      new.created_at := now();
    end if;
    -- [mensagem agendada] inicio
    if new.origem = 'automacao' and new.automacao_id is null and not v_pela_agendada then
    -- [mensagem agendada] fim
      raise exception 'Atividade criada por automação precisa da automação de origem.'
        using errcode = '23514';
    end if;
    if new.status is distinct from 'pendente' then
      raise exception 'Uma atividade nasce pendente.'
        using errcode = '23514';
    end if;
    new.completed_at := null;
    new.completed_by := null;
    new.canceled_at := null;
    new.canceled_by := null;
  else
    -- Travas
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Uma atividade não muda de clínica.'
        using errcode = '23514';
    end if;
    if new.contact_id is distinct from old.contact_id then
      raise exception 'Uma atividade não muda de contato. Crie outra para o contato certo.'
        using errcode = '23514';
    end if;
    if new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.origem is distinct from old.origem then
      raise exception 'Quem criou a atividade, quando e como não mudam.'
        using errcode = '23514';
    end if;
    -- automacao_id so pode virar nulo (a FK da Leva B pode limpar ao apagar
    -- a regra); trocar de regra, nunca.
    if new.automacao_id is distinct from old.automacao_id
       and new.automacao_id is not null then
      raise exception 'A automação de origem de uma atividade não muda.'
        using errcode = '23514';
    end if;

    -- Carimbos: so o gatilho escreve. Mudou o status, carimba com a sessao
    -- (nula para o service role) e limpa o outro par; reabrir limpa tudo.
    -- Status igual, os carimbos ficam como estavam.
    if new.status is distinct from old.status then
      if new.status = 'concluida' then
        new.completed_at := now();
        new.completed_by := v_uid;
        new.canceled_at := null;
        new.canceled_by := null;
      elsif new.status = 'cancelada' then
        new.canceled_at := now();
        new.canceled_by := v_uid;
        new.completed_at := null;
        new.completed_by := null;
      else
        new.completed_at := null;
        new.completed_by := null;
        new.canceled_at := null;
        new.canceled_by := null;
      end if;
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
      new.canceled_at := old.canceled_at;
      new.canceled_by := old.canceled_by;
    end if;
  end if;

  -- Responsavel: membro ATIVO desta clinica. So quando e definido ou
  -- trocado: alguem que saiu da equipe depois nao trava concluir, adiar ou
  -- reatribuir a atividade.
  if new.assignee_user_id is not null
     and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id) then
    if not exists (
      select 1 from public.clinic_member m
       where m.clinic_id = new.clinic_id
         and m.user_id = new.assignee_user_id
         and m.status = 'ativo'
    ) then
      raise exception 'O responsável precisa ser alguém ativo da equipe desta clínica.'
        using errcode = '23514';
    end if;
  end if;

  -- Conversa: da mesma clinica e do mesmo contato.
  if new.conversation_id is not null
     and (tg_op = 'INSERT' or new.conversation_id is distinct from old.conversation_id) then
    if not exists (
      select 1 from public.conversation c
       where c.id = new.conversation_id
         and c.clinic_id = new.clinic_id
         and c.contact_id = new.contact_id
    ) then
      raise exception 'A conversa informada não é deste contato.'
        using errcode = '23514';
    end if;
  end if;

  -- Prazo com hora: o dia sai da hora, no fuso da clinica (regra 3.6).
  -- Recalcula quando o prazo mexe; a troca do fuso da clinica recalcula
  -- todas as que tem hora pelo gatilho recalcular_dia_das_atividades (em
  -- clinic), que passa por aqui com o fuso novo ja gravado.
  if new.due_at is not null
     and (tg_op = 'INSERT'
          or new.due_at is distinct from old.due_at
          or new.due_on is distinct from old.due_on) then
    select c.timezone into v_fuso from public.clinic c where c.id = new.clinic_id;
    new.due_on := (new.due_at at time zone coalesce(v_fuso, 'America/Fortaleza'))::date;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 13) Privilegios das funcoes (e por que a tabela fica fora do tempo real)
-- ---------------------------------------------------------------------------
-- mensagem_agendada NAO entra na publicacao supabase_realtime. O Realtime
-- desta instancia le o WAL pelo wal2json, que ignora a lista de colunas da
-- publicacao: o texto de cada INSERT e edicao iria pelo websocket a toda aba
-- do Atendimento, sem trilha. A tela rele a lista pela sessao (com RLS) nos
-- eventos de message e conversation da conversa aberta, num intervalo
-- enquanto ela esta aberta e depois de cada acao propria.

revoke all on function public.falhas_sem_envio() from public, anon, authenticated;
grant execute on function public.falhas_sem_envio() to service_role;
revoke all on function public.proteger_mensagem_agendada() from public, anon, authenticated;
revoke all on function public.agendadas_param_na_revogacao() from public, anon, authenticated;
revoke all on function public.encerrar_agendada_sem_envio(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.encerrar_agendada_sem_envio(uuid, text, text) to service_role;
revoke all on function public.planejar_mensagens_agendadas(integer, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.planejar_mensagens_agendadas(integer, uuid, boolean) to service_role;
revoke all on function public.reconciliar_mensagens_agendadas(integer, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.reconciliar_mensagens_agendadas(integer, uuid, boolean) to service_role;
revoke all on function public.reconciliar_mensagem_agendada(uuid) from public, anon, authenticated;
grant execute on function public.reconciliar_mensagem_agendada(uuid) to service_role;
revoke all on function public.motivo_da_agendada(text) from public, anon, authenticated;
grant execute on function public.motivo_da_agendada(text) to service_role;
revoke all on function public.tirar_agendada_para_enviar_agora(uuid) from public, anon;
grant execute on function public.tirar_agendada_para_enviar_agora(uuid) to authenticated, service_role;

comment on function public.encerrar_agendada_sem_envio(uuid, text, text) is
  'Unico caminho para nao_enviada e nao_confirmada: fecha a agendada (so se ainda agendada ou enviando) e cria UMA atividade para o assinante conferir. Idempotente. So o sistema.';
comment on function public.tirar_agendada_para_enviar_agora(uuid) is
  'Enviar agora: retira a agendada (cancelada, motivo enviada_agora) de quem escreve e esta com a conversa, e devolve o texto para o envio 1:1. Trilha retirou_agendada_para_enviar_agora (o envio e auditado pela Server Action). Estados: ok, ja_saindo, assuma_a_conversa, nao_encontrada.';

-- ---------------------------------------------------------------------------
-- 14) Gatilho em contact_consent e CHECK de job_queue (travas ja pegas no
-- topo, no modo final)
-- ---------------------------------------------------------------------------

create trigger agendadas_param_na_revogacao
  after insert or update of revoked_at on public.contact_consent
  for each row execute function public.agendadas_param_na_revogacao();

-- O kind novo fica de fora de redistribuir_jobs_do_numero (lista explicita:
-- a agendada nunca troca de numero) e de job_ganha_numero (o numero vem
-- sempre informado; o gatilho so confere a clinica). O executor nao chama
-- numero_do_job, entao este kind nunca e recarimbado.
-- NOTA PARA O E3: a migration do 'responder_com_ia' redefine esta lista
-- inteira e precisa manter 'enviar_mensagem_agendada'.
alter table public.job_queue
  drop constraint job_queue_kind_check,
  add constraint job_queue_kind_check check (kind in (
    'enviar_mensagem_ativa',
    'baixar_midia',
    'executar_passo_de_regua',
    'enviar_conversao_meta',
    'oferecer_lista_espera',
    'sincronizar_gasto_meta',
    'resolver_anuncio_meta',
    'enviar_mensagem_agendada'
  ));

-- ---------------------------------------------------------------------------
-- 15) claim_jobs (corpo atual do banco; so o bloco novo)
-- ---------------------------------------------------------------------------
-- O claim LEGADO (npm run worker, ferramenta local, e as suites de
-- integracao que rodam contra a producao) nao filtra clinica de teste nem
-- kind. Sem este bloco, um teste local reivindicaria a agendada real de uma
-- clinica e a enviaria da maquina do dev, ou a mataria com
-- tipo_desconhecido num checkout sem o executor. Agendada so o motor
-- (claim_jobs_por_clinica) reivindica e enterra.

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
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
end;
$function$;
