-- ---------------------------------------------------------------------------
-- CRM, Leva B: automacoes de fluxo
-- ---------------------------------------------------------------------------
-- Plano "Automacoes de fluxo e CRM" (pedido do dono em 02/10/2026, item 4).
-- Pressupoe a 20261002120000_crm_leva_a.sql aplicada (contact_activity com
-- origem 'automacao' e automacao_id ainda sem FK) e nao a edita.
--
-- Regra por clinica em colunas fixas (sem linguagem generica, CLAUDE.md 4):
-- QUANDO (gatilho) o LEAD esta na ETAPA, FAZ (acao).
--
--   Gatilhos:
--     tempo_na_etapa         espera_minutos depois de entrar na etapa
--     sem_resposta_na_etapa  espera_minutos sem mensagem DO LEAD na etapa
--                            (ancora greatest(funnel_stage_changed_at,
--                            last_contact_at); a mensagem da clinica nao
--                            zera o relogio)
--     entrou_na_etapa        o lead entrou na etapa (inclusive ao nascer)
--     mensagem_recebida      o lead mandou mensagem estando na etapa
--   Acoes (decisao do dono em 02/10; NADA de envio ao paciente, que continua
--   sendo a regua de follow-up da etapa):
--     mover_etapa      para etapa_destino (Perdido so com o motivo
--                      'nao_respondeu' e pulando quem tem consulta futura)
--     etiquetar        etiqueta do catalogo na conversa mais recente do lead
--     criar_atividade  contact_activity origem 'automacao': titulo da regra,
--                      prazo em N dias no fuso da clinica, responsavel = quem
--                      atende a conversa mais recente (ou ninguem)
--     nota_interna     nota interna (autor sistema) na conversa mais recente
--
-- O que faz, na ordem do arquivo:
--   1. Relogios do contato: funnel_stage_changed_at e last_contact_at deixam
--      de ser editaveis pela sessao (gatilho proteger_relogios_do_contato).
--   2. automacao_fluxo (a regra), com validar_automacao_de_fluxo (destino,
--      Perdido, ciclo, vigente_desde, autoria) e RLS (membro ativo le; admin
--      e gestor escrevem).
--   3. FK de contact_activity.automacao_id (ON DELETE SET NULL).
--   4. automacao_execucao (uma execucao por regra, contato e entrada na
--      etapa; historico com status, motivo curto e o retrato do que a regra
--      fez naquela execucao: acao, etiqueta e o nome dela). So funcoes
--      definer escrevem.
--   5. Gatilhos que REGISTRAM (nunca executam): entrada na etapa (contact) e
--      mensagem recebida (message).
--   6. planejar_automacoes_de_fluxo (varredura dos gatilhos de tempo) e
--      executar_automacoes_de_fluxo (executa as pendentes).
--   7. previa_da_automacao_de_fluxo (quantos leads ja se encaixam: a regra
--      nao e retroativa).
--   8. proteger_jornada e proteger_etiqueta_de_conversa (corpos de producao)
--      recusam excluir etapa ou etiqueta usada por automacao.
--   9. motor_manutencao (corpo de producao) ganha dois blocos, antes de
--      planejar_reguas: o follow-up da etapa nova ja nasce na mesma passagem.
--
-- Travas (todas do plano aprovado):
--   - uma vez por entrada na etapa (UNIQUE); voltar a etapa rearma;
--   - nao retroativo: so dispara o que venceu depois de vigente_desde, que
--     volta a now() ao ligar ou ao editar gatilho, etapa ou espera;
--   - so leads (kind 'lead'); importados que nunca mudaram de etapa ficam de
--     fora (mesmo criterio do follow-up), em todos os gatilhos;
--   - Agendou e Compareceu nunca sao destino (sao fatos da Agenda e virariam
--     conversao falsa para a Meta);
--   - sem laco: ciclo recusado ao salvar (arestas so dos gatilhos que nao
--     sao de mensagem), cascata ate 3 saltos (GUC
--     conduzza.automacao_profundidade), no maximo 10 movimentos automaticos
--     por lead em 24 h, um salto por passagem;
--   - mensagem_recebida ignora a primeira fala do contato novo (a mensagem
--     que cria o contato e as que chegam nos 2 minutos seguintes: cada
--     entrega do webhook e outra transacao, e o lead costuma dividir a
--     primeira fala em varias mensagens), e o termo-chave vence: a troca e
--     guardada pela etapa e pelo instante de entrada (CAS), e a execucao so
--     fica devida 15 segundos depois do recebimento;
--   - o movimento humano vence (CAS por funnel_stage e
--     funnel_stage_changed_at, contato travado com SKIP LOCKED);
--   - audit_log de sistema (user_id nulo, sem conteudo).
--
-- Rollback (nesta ordem; as automacoes e o historico deixam de existir):
--   (motor_manutencao, proteger_jornada e proteger_etiqueta_de_conversa
--    voltam aos corpos anteriores: tirar as linhas entre os marcadores
--    "[automacoes de fluxo]" e recriar)
--   drop trigger if exists registrar_mensagem_para_automacao on public.message;
--   drop trigger if exists registrar_entrada_para_automacao on public.contact;
--   drop trigger if exists proteger_relogios_do_contato on public.contact;
--   drop function if exists public.previa_da_automacao_de_fluxo(uuid, text, text, integer);
--   drop function if exists public.executar_automacoes_de_fluxo(integer, uuid, boolean);
--   drop function if exists public.planejar_automacoes_de_fluxo(integer, uuid, boolean);
--   drop function if exists public.registrar_mensagem_para_automacao();
--   drop function if exists public.registrar_entrada_para_automacao();
--   drop function if exists public.proteger_relogios_do_contato();
--   drop table if exists public.automacao_execucao;
--   alter table public.contact_activity
--     drop constraint if exists contact_activity_automacao_id_fkey;
--   drop index if exists public.contact_activity_da_automacao;
--   drop table if exists public.automacao_fluxo;
--   drop function if exists public.validar_automacao_de_fluxo();
--   drop index if exists public.contact_etapa_e_entrada_idx;

-- ---------------------------------------------------------------------------
-- 1) Relogios do contato
-- ---------------------------------------------------------------------------
-- funnel_stage_changed_at (tempo na etapa) e last_contact_at (ultima
-- mensagem do lead) passam a mover automacao. Ate aqui a sessao (admin,
-- gestor e recepcao, pela policy de UPDATE de contact) podia reescrever os
-- dois pela API sem mudar de etapa. REVOKE de coluna nao serve: o UPDATE de
-- authenticated e de tabela (o padrao do Supabase), e trocar por grants de
-- coluna deixaria toda coluna futura de contact sem escrita em silencio.
--
-- Escritores conferidos em 02/10: last_contact_at so pela ingestao
-- (ingest_inbound_message, service role); funnel_stage_changed_at so pelo
-- gatilho validar_etapa_do_contato. Os testes e o seed escrevem os dois com
-- service role (auth.uid() nulo), que continua livre. Com sessao:
--   - INSERT: last_contact_at nasce nulo (o relogio da etapa o
--     validar_etapa_do_contato ja carimba com now());
--   - UPDATE: last_contact_at fica como estava; funnel_stage_changed_at fica
--     como estava quando a etapa nao muda (quando muda, o
--     validar_etapa_do_contato, que roda depois por ordem alfabetica, carimba
--     now()).

create or replace function public.proteger_relogios_do_contato()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.last_contact_at := null;
    return new;
  end if;
  new.last_contact_at := old.last_contact_at;
  if new.funnel_stage is not distinct from old.funnel_stage then
    new.funnel_stage_changed_at := old.funnel_stage_changed_at;
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_relogios_do_contato()
  from public, anon, authenticated;

drop trigger if exists proteger_relogios_do_contato on public.contact;
create trigger proteger_relogios_do_contato
  before insert or update of funnel_stage_changed_at, last_contact_at
  on public.contact
  for each row execute function public.proteger_relogios_do_contato();

-- A varredura dos gatilhos de tempo procura por clinica, etapa e entrada.
create index if not exists contact_etapa_e_entrada_idx
  on public.contact (clinic_id, funnel_stage, funnel_stage_changed_at);

-- ---------------------------------------------------------------------------
-- 2) automacao_fluxo (a regra)
-- ---------------------------------------------------------------------------

create table if not exists public.automacao_fluxo (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  nome text not null,
  -- Nasce desligada: ligar e um ato explicito (e zera vigente_desde).
  ativa boolean not null default false,
  gatilho text not null,
  -- Etapa onde o lead esta (a origem).
  etapa text not null,
  -- So nos gatilhos de tempo: de 1 hora a 90 dias, em minutos.
  espera_minutos integer,
  acao text not null,
  -- mover_etapa
  etapa_destino text,
  motivo_perda text,
  -- etiquetar (chave do catalogo conversation_tag_def)
  etiqueta text,
  -- criar_atividade
  atividade_titulo text,
  atividade_prazo_dias integer,
  -- nota_interna (texto fixo da clinica; o paciente nunca ve)
  nota_texto text,
  -- A trava contra disparo retroativo: so vale o que vence (tempo) ou
  -- acontece (entrada, mensagem) a partir daqui.
  vigente_desde timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FKs compostas NO ACTION (o padrao), nunca RESTRICT: o RESTRICT e
  -- conferido na hora e quebraria o cascade de exclusao da clinica (os
  -- afterAll dos testes). A exclusao de UMA etapa ou etiqueta usada e
  -- recusada antes, com mensagem clara, por proteger_jornada e
  -- proteger_etiqueta_de_conversa. Com coluna nula (MATCH SIMPLE) a FK nao
  -- confere, e a coerencia por acao fica nos checks abaixo.
  constraint automacao_fluxo_etapa_fkey
    foreign key (clinic_id, etapa)
    references public.funnel_stage_def (clinic_id, chave),
  constraint automacao_fluxo_etapa_destino_fkey
    foreign key (clinic_id, etapa_destino)
    references public.funnel_stage_def (clinic_id, chave),
  constraint automacao_fluxo_etiqueta_fkey
    foreign key (clinic_id, etiqueta)
    references public.conversation_tag_def (clinic_id, chave),
  constraint nome_de_automacao_com_tamanho
    check (char_length(btrim(nome)) between 2 and 80),
  constraint gatilho_de_automacao_valido
    check (gatilho in ('tempo_na_etapa', 'sem_resposta_na_etapa',
                       'entrou_na_etapa', 'mensagem_recebida')),
  constraint acao_de_automacao_valida
    check (acao in ('mover_etapa', 'etiquetar', 'criar_atividade', 'nota_interna')),
  constraint espera_so_nos_gatilhos_de_tempo
    check ((gatilho in ('tempo_na_etapa', 'sem_resposta_na_etapa'))
           = (espera_minutos is not null)),
  constraint espera_na_faixa
    check (espera_minutos is null or espera_minutos between 60 and 129600),
  constraint acao_mover_tem_destino
    check ((acao = 'mover_etapa') = (etapa_destino is not null)),
  constraint destino_diferente_da_origem
    check (etapa_destino is null or etapa_destino <> etapa),
  -- Perdido so com "Nao respondeu" (decisao do dono); o gatilho confere que
  -- o motivo existe se e somente se o destino tem papel perdido.
  constraint motivo_de_perda_da_automacao
    check (motivo_perda is null
           or (acao = 'mover_etapa' and motivo_perda = 'nao_respondeu')),
  constraint acao_etiquetar_tem_etiqueta
    check ((acao = 'etiquetar') = (etiqueta is not null)),
  constraint acao_atividade_tem_titulo_e_prazo
    check (((acao = 'criar_atividade') = (atividade_titulo is not null))
           and ((acao = 'criar_atividade') = (atividade_prazo_dias is not null))),
  -- O mesmo tamanho do titulo de contact_activity.
  constraint titulo_de_atividade_da_automacao
    check (atividade_titulo is null
           or char_length(btrim(atividade_titulo)) between 2 and 120),
  constraint prazo_de_atividade_da_automacao
    check (atividade_prazo_dias is null or atividade_prazo_dias between 0 and 365),
  constraint acao_nota_tem_texto
    check ((acao = 'nota_interna') = (nota_texto is not null)),
  constraint nota_da_automacao_com_tamanho
    check (nota_texto is null
           or (char_length(nota_texto) <= 2000 and btrim(nota_texto) <> ''))
);

comment on table public.automacao_fluxo is
  'Automacoes de fluxo da clinica (Configuracoes, ao lado de Jornada e conversoes): quando o lead esta na etapa e acontece o gatilho, move de etapa, etiqueta a conversa mais recente, cria atividade ou deixa nota interna. Nunca envia ao paciente. Membro ativo le; admin e gestor escrevem.';
comment on column public.automacao_fluxo.vigente_desde is
  'Trava contra disparo retroativo. Volta a now() ao ligar e ao editar gatilho, etapa ou espera_minutos. Com sessao e sempre o banco quem escreve.';
comment on column public.automacao_fluxo.espera_minutos is
  'So nos gatilhos tempo_na_etapa e sem_resposta_na_etapa: de 60 (1 hora) a 129600 (90 dias).';

-- Os gatilhos de contato e de mensagem perguntam "a clinica tem regra ligada
-- deste gatilho nesta etapa?" a cada movimento e a cada mensagem recebida.
create index if not exists automacao_fluxo_ligadas
  on public.automacao_fluxo (clinic_id, gatilho, etapa)
  where ativa;
-- A FK composta do destino e da etiqueta (proteger_jornada e
-- proteger_etiqueta_de_conversa procuram por elas).
create index if not exists automacao_fluxo_por_destino
  on public.automacao_fluxo (clinic_id, etapa_destino)
  where etapa_destino is not null;
create index if not exists automacao_fluxo_por_etiqueta
  on public.automacao_fluxo (clinic_id, etiqueta)
  where etiqueta is not null;

drop trigger if exists set_updated_at on public.automacao_fluxo;
create trigger set_updated_at
  before update on public.automacao_fluxo
  for each row execute function public.set_updated_at();

-- security definer: le a jornada e TODAS as regras da clinica (o detector de
-- ciclo nao pode depender do que a policy do chamador alcanca). auth.uid()
-- continua sendo a sessao. Erros com errcode 23514 (o contrato de validacao
-- do projeto) e hint com um codigo curto para a action traduzir.
--
-- A primeira coisa e conferir que a SESSAO gerencia a clinica da linha. O
-- Postgres confere o WITH CHECK da RLS so DEPOIS dos gatilhos BEFORE: sem
-- esta guarda, qualquer autenticado com o uuid de outra clinica (o pendente,
-- o admin da clinica vizinha) leria pelo codigo de erro o papel das etapas e
-- o grafo das regras ligadas dela (hints automacao_destino_da_agenda,
-- automacao_perdido_sem_motivo, automacao_ciclo), e seguraria a trava da
-- clinica alheia. Recusa com 42501, o mesmo codigo da RLS (falha fechada:
-- nao depende de a RLS estar ligada depois). Sem sessao (service role,
-- testes, motor) nao ha guarda.
create or replace function public.validar_automacao_de_fluxo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_papel text;
  v_ciclo boolean;
begin
  if v_uid is not null
     and not public.user_has_role(new.clinic_id, array['admin', 'gestor']) then
    raise exception 'Sem permissão para gerenciar as automações desta clínica.'
      using errcode = '42501';
  end if;

  -- Duas regras salvas ao mesmo tempo nao podem, cada uma sem ver a outra,
  -- fechar um ciclo: uma clinica por vez. Cada comando seguinte desta funcao
  -- (READ COMMITTED) ja enxerga o que a outra transacao gravou.
  perform pg_advisory_xact_lock(
    hashtextextended('automacao_fluxo:' || new.clinic_id::text, 0)
  );

  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Uma automação não muda de clínica.'
        using errcode = '23514';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if v_uid is not null then
      new.updated_by := v_uid;
    end if;
    -- Sem sessao (service role, testes), quem mexe em vigente_desde de
    -- proposito e atendido. Com sessao, so o banco escreve.
    if v_uid is null and new.vigente_desde is distinct from old.vigente_desde then
      null;
    elsif (new.ativa and not old.ativa)
       or new.gatilho is distinct from old.gatilho
       or new.etapa is distinct from old.etapa
       or new.espera_minutos is distinct from old.espera_minutos then
      new.vigente_desde := now();
    else
      new.vigente_desde := old.vigente_desde;
    end if;
  else
    if v_uid is not null then
      new.created_by := v_uid;
      new.updated_by := v_uid;
      new.created_at := now();
      new.vigente_desde := now();
    else
      new.vigente_desde := coalesce(new.vigente_desde, now());
    end if;
  end if;

  if new.acao = 'mover_etapa' then
    -- Etapa inexistente: a FK composta recusa no fim do comando.
    select papel into v_papel
      from funnel_stage_def
     where clinic_id = new.clinic_id and chave = new.etapa_destino;
    if v_papel in ('agendou', 'compareceu') then
      raise exception 'Agendou e Compareceu são marcados pela Agenda e não podem ser destino de uma automação.'
        using errcode = '23514', hint = 'automacao_destino_da_agenda';
    end if;
    if v_papel = 'perdido' and new.motivo_perda is null then
      raise exception 'Para mover para a etapa de perda, a automação usa o motivo "Não respondeu".'
        using errcode = '23514', hint = 'automacao_perdido_sem_motivo';
    end if;
    if v_papel is distinct from 'perdido' and new.motivo_perda is not null then
      raise exception 'O motivo da perda só vale quando o destino é a etapa de perda.'
        using errcode = '23514', hint = 'automacao_motivo_sem_perdido';
    end if;

    -- Detector de ciclo. Arestas: regras LIGADAS de mover cujo gatilho nao e
    -- de mensagem (essas so andam se o lead escrever, entao o vai e volta
    -- depende dele). Se do destino desta regra se chega de volta a origem,
    -- o lead ficaria girando sozinho. Regra desligada nao entra (ligar e
    -- salvar de novo, e ai confere).
    if new.ativa and new.gatilho <> 'mensagem_recebida' then
      with recursive alcance (etapa) as (
        select new.etapa_destino
        union
        select a.etapa_destino
          from automacao_fluxo a
          join alcance on a.etapa = alcance.etapa
         where a.clinic_id = new.clinic_id
           and a.id <> new.id
           and a.ativa
           and a.acao = 'mover_etapa'
           and a.gatilho <> 'mensagem_recebida'
      )
      select exists (select 1 from alcance where etapa = new.etapa)
        into v_ciclo;
      if v_ciclo then
        raise exception 'Esta automação fecha um ciclo com outra automação ligada: o lead ficaria indo e voltando entre as etapas. Mude o destino ou desligue a outra automação.'
          using errcode = '23514', hint = 'automacao_ciclo';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validar_automacao_de_fluxo()
  from public, anon, authenticated;

drop trigger if exists validar_automacao_de_fluxo on public.automacao_fluxo;
create trigger validar_automacao_de_fluxo
  before insert or update on public.automacao_fluxo
  for each row execute function public.validar_automacao_de_fluxo();

alter table public.automacao_fluxo enable row level security;

-- Membro ativo le (pendente nao): o aviso da acao em massa de Leads e a
-- recepcao entendendo por que o lead andou precisam ler as regras.
drop policy if exists "membro ativo le as automacoes de fluxo" on public.automacao_fluxo;
create policy "membro ativo le as automacoes de fluxo" on public.automacao_fluxo
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

-- Molde de cadence e funnel_stage_def: admin e gestor gerenciam.
drop policy if exists "gestao gerencia as automacoes de fluxo" on public.automacao_fluxo;
create policy "gestao gerencia as automacoes de fluxo" on public.automacao_fluxo
  for all to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

revoke all on table public.automacao_fluxo from anon;
revoke truncate, references, trigger on table public.automacao_fluxo
  from authenticated;

-- ---------------------------------------------------------------------------
-- 3) contact_activity.automacao_id ganha a FK (a Leva A deixou sem)
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL: apagar a regra nao apaga a atividade que ela criou, e
-- validar_atividade ja aceita automacao_id virando nulo.

alter table public.contact_activity
  drop constraint if exists contact_activity_automacao_id_fkey;
alter table public.contact_activity
  add constraint contact_activity_automacao_id_fkey
    foreign key (automacao_id) references public.automacao_fluxo (id)
    on delete set null;

create index if not exists contact_activity_da_automacao
  on public.contact_activity (automacao_id)
  where automacao_id is not null;

-- ---------------------------------------------------------------------------
-- 4) automacao_execucao (fila de saida e historico)
-- ---------------------------------------------------------------------------

create table if not exists public.automacao_execucao (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  automacao_id uuid not null references public.automacao_fluxo (id) on delete cascade,
  -- Apagar o contato (LGPD 11.11) leva o historico junto.
  contact_id uuid not null references public.contact (id) on delete cascade,
  -- De onde (a etapa da regra no registro) e para onde (so quando moveu).
  de_etapa text not null,
  para_etapa text,
  -- O funnel_stage_changed_at do contato quando o gatilho aconteceu. E a
  -- identidade da entrada na etapa: o CAS da execucao e a unicidade.
  entrada_na_etapa timestamptz not null,
  -- Gatilho mensagem_recebida: a mensagem que disparou (nunca o texto).
  message_id uuid references public.message (id) on delete set null,
  -- Quando ficou devida (tempo: o vencimento; entrada: o movimento;
  -- mensagem: o recebimento mais 15 s, para o termo-chave andar antes).
  devida_em timestamptz not null,
  -- Saltos de cascata (0 = movimento humano, sistema ou tempo).
  profundidade smallint not null default 0,
  status text not null default 'pendente',
  motivo text,
  -- Onde a acao caiu (etiquetar, nota_interna, criar_atividade).
  conversation_id uuid references public.conversation (id) on delete set null,
  atividade_id uuid references public.contact_activity (id) on delete set null,
  -- O retrato do que a regra fez NESTA execucao (so em 'executada'). A regra
  -- pode trocar de acao ou de etiqueta depois sem recomecar a vigencia, e o
  -- historico tem de contar o que aconteceu, nao o que a regra manda hoje.
  -- A etiqueta vai pela chave (o identificador estavel, o mesmo de
  -- conversation.tags) e pelo nome que ela tinha na hora: a etiqueta pode
  -- ser renomeada, ou excluida depois que a regra deixar de usa-la.
  acao text,
  etiqueta text,
  etiqueta_nome text,
  executada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- UMA execucao por regra, contato e entrada na etapa, para todo gatilho.
  -- Voltar a etapa e outra entrada e rearma a regra.
  constraint automacao_execucao_uma_por_entrada
    unique (automacao_id, contact_id, entrada_na_etapa),
  constraint status_de_execucao_valido
    check (status in ('pendente', 'executada', 'pulada', 'falhou')),
  constraint motivo_de_execucao_curto
    check (motivo is null or motivo ~ '^[a-z0-9_]{1,64}$'),
  constraint execucao_pulada_ou_falha_tem_motivo
    check ((status in ('pulada', 'falhou')) = (motivo is not null)),
  constraint execucao_fechada_tem_carimbo
    check ((status = 'pendente') = (executada_em is null)),
  constraint para_etapa_so_quando_executada
    check (para_etapa is null or status = 'executada'),
  constraint acao_da_execucao_valida
    check (acao is null
           or acao in ('mover_etapa', 'etiquetar', 'criar_atividade', 'nota_interna')),
  constraint acao_so_quando_executada
    check (acao is null or status = 'executada'),
  -- Etiqueta (chave e nome juntos) se e somente se a acao foi etiquetar.
  constraint etiqueta_da_execucao_coerente
    check (case when acao = 'etiquetar'
                then etiqueta is not null and etiqueta_nome is not null
                else etiqueta is null and etiqueta_nome is null
           end),
  constraint profundidade_de_execucao_valida
    check (profundidade between 0 and 10)
);

comment on table public.automacao_execucao is
  'Execucoes das automacoes de fluxo: uma por regra, contato e entrada na etapa. Fila (pendente) e historico (executada, pulada com motivo, falhou com erro_<sqlstate>). So o motor e os gatilhos (security definer) escrevem; membro ativo le. Sem conteudo de mensagem.';
comment on column public.automacao_execucao.motivo is
  'Codigo curto. pulada: regra_desligada, regra_alterada, etapa_mudou, nao_e_lead, importado, lead_respondeu, limite_de_cascata, limite_diario, destino_invalido, tem_consulta_futura, sem_conversa, ja_tinha_etiqueta, limite_de_etiquetas. falhou: erro_<sqlstate>.';
comment on column public.automacao_execucao.acao is
  'A acao que a regra tinha quando o motor executou (so em executada). O historico descreve a execucao por ela, nunca pela regra atual.';
comment on column public.automacao_execucao.etiqueta_nome is
  'Nome da etiqueta na hora da execucao (so quando acao = etiquetar), junto com a chave em etiqueta.';

create index if not exists automacao_execucao_pendentes
  on public.automacao_execucao (devida_em)
  where status = 'pendente';
create index if not exists automacao_execucao_da_clinica
  on public.automacao_execucao (clinic_id, created_at desc);
create index if not exists automacao_execucao_da_regra
  on public.automacao_execucao (automacao_id, created_at desc);
-- Completo (sem predicado): a FK contact_id com ON DELETE CASCADE procura
-- por ele ao apagar um contato (LGPD 11.11) ou uma clinica, e com predicado
-- a consulta da FK ("where contact_id = $1") nao o usaria e varreria a
-- tabela, que so cresce. Serve tambem ao teto de 10 movimentos automaticos
-- por lead em 24 h (busca por contato e faixa de executada_em; status e
-- para_etapa viram filtro sobre poucas linhas).
create index if not exists automacao_execucao_do_contato
  on public.automacao_execucao (contact_id, executada_em desc);
-- FKs com ON DELETE SET NULL procuram por elas.
create index if not exists automacao_execucao_da_mensagem
  on public.automacao_execucao (message_id)
  where message_id is not null;
create index if not exists automacao_execucao_da_conversa
  on public.automacao_execucao (conversation_id)
  where conversation_id is not null;
create index if not exists automacao_execucao_da_atividade
  on public.automacao_execucao (atividade_id)
  where atividade_id is not null;

drop trigger if exists set_updated_at on public.automacao_execucao;
create trigger set_updated_at
  before update on public.automacao_execucao
  for each row execute function public.set_updated_at();

alter table public.automacao_execucao enable row level security;

drop policy if exists "membro ativo le as execucoes de automacao" on public.automacao_execucao;
create policy "membro ativo le as execucoes de automacao" on public.automacao_execucao
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

-- Sem policy de escrita e sem o privilegio: INSERT, UPDATE e DELETE pela API
-- dao 42501 em vez de zero linhas em silencio. O motor e os gatilhos sao
-- security definer (dono da tabela).
revoke all on table public.automacao_execucao from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.automacao_execucao from authenticated;

-- ---------------------------------------------------------------------------
-- 5) Gatilhos que REGISTRAM (a execucao e sempre no motor)
-- ---------------------------------------------------------------------------
-- Executar dentro do gatilho faria um UPDATE de contact dentro do AFTER
-- UPDATE do mesmo contato (o RETURNING da action devolveria a etapa velha),
-- e uma falha da automacao desfaria o movimento humano. Aqui so se registra,
-- e qualquer falha vira warning sem dado de paciente: nunca bloqueia o
-- movimento nem a ingestao.

-- Entrada na etapa: ponto unico que pega todo movimento (Kanban, acao em
-- massa, Assumir, termo-chave, Agenda, a propria automacao) e o nascimento
-- do contato. A profundidade da cascata vem do GUC que o executor liga
-- durante o proprio movimento.
create or replace function public.registrar_entrada_para_automacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profundidade integer;
begin
  if tg_op = 'UPDATE'
     and new.funnel_stage is not distinct from old.funnel_stage then
    return null;
  end if;
  if new.kind is distinct from 'lead'
     or (new.criado_por_importacao
         and new.funnel_stage_changed_at <= new.created_at) then
    return null;
  end if;
  if not exists (
    select 1 from automacao_fluxo
     where clinic_id = new.clinic_id
       and ativa
       and gatilho = 'entrou_na_etapa'
       and etapa = new.funnel_stage
  ) then
    return null;
  end if;

  begin
    v_profundidade := coalesce(
      nullif(current_setting('conduzza.automacao_profundidade', true), ''),
      '0'
    )::integer;
    insert into automacao_execucao (
      clinic_id, automacao_id, contact_id, de_etapa, entrada_na_etapa,
      devida_em, profundidade
    )
    select new.clinic_id, a.id, new.id, a.etapa, new.funnel_stage_changed_at,
           now(), least(greatest(v_profundidade, 0), 10)
      from automacao_fluxo a
     where a.clinic_id = new.clinic_id
       and a.ativa
       and a.gatilho = 'entrou_na_etapa'
       and a.etapa = new.funnel_stage
       and a.vigente_desde <= new.funnel_stage_changed_at
    on conflict (automacao_id, contact_id, entrada_na_etapa) do nothing;
  exception when others then
    raise warning 'registro de automacao de fluxo (entrada) falhou (clinic %): %',
      new.clinic_id, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.registrar_entrada_para_automacao()
  from public, anon, authenticated;

drop trigger if exists registrar_entrada_para_automacao on public.contact;
create trigger registrar_entrada_para_automacao
  after insert or update of funnel_stage on public.contact
  for each row execute function public.registrar_entrada_para_automacao();

-- Mensagem recebida do paciente. Cobre ingest_inbound_message sem tocar
-- nela; a reentrega do webhook nao insere message (on conflict de
-- wa_message_id), entao nao registra de novo. A primeira fala do contato
-- novo e ignorada: a mensagem que o CRIA e as que chegam ate 2 minutos
-- depois do nascimento do contato. Cada entrega do webhook e outra transacao
-- (o contato ja nasceu numa anterior), e o lead costuma dividir a primeira
-- fala em varias mensagens: so ignorar a que cria deixava a segunda da
-- rajada disparar, e na pratica todo lead novo saia da etapa de entrada em
-- cerca de 1 minuto. Em producao (60 dias ate 02/10/2026, so contagens), 130
-- de 200 segundas mensagens chegaram em ate 2 minutos e nenhuma delas depois
-- de uma resposta da clinica. A ancora e o nascimento do contato, nao a
-- entrada na etapa: a resposta rapida de um lead que a recepcao acabou de
-- mover e justamente o que "mandou mensagem" deve pegar. A execucao so fica
-- devida 15 s depois: o termo-chave (no webhook, logo depois da ingestao)
-- anda antes, e o CAS da execucao ve a etapa mudada.
create or replace function public.registrar_mensagem_para_automacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contato record;
begin
  if not exists (
    select 1 from automacao_fluxo
     where clinic_id = new.clinic_id
       and ativa
       and gatilho = 'mensagem_recebida'
  ) then
    return null;
  end if;

  begin
    select c.id, c.kind, c.funnel_stage, c.funnel_stage_changed_at,
           c.created_at, c.criado_por_importacao
      into v_contato
      from conversation v
      join contact c on c.id = v.contact_id
     where v.id = new.conversation_id;
    if not found
       or v_contato.kind is distinct from 'lead'
       -- A primeira fala do contato novo (inclui o contato nascido nesta
       -- mesma transacao, em que created_at = now()).
       or v_contato.created_at > now() - interval '2 minutes'
       or (v_contato.criado_por_importacao
           and v_contato.funnel_stage_changed_at <= v_contato.created_at) then
      return null;
    end if;

    insert into automacao_execucao (
      clinic_id, automacao_id, contact_id, de_etapa, entrada_na_etapa,
      message_id, devida_em, profundidade
    )
    select new.clinic_id, a.id, v_contato.id, a.etapa,
           v_contato.funnel_stage_changed_at, new.id,
           now() + interval '15 seconds', 0
      from automacao_fluxo a
     where a.clinic_id = new.clinic_id
       and a.ativa
       and a.gatilho = 'mensagem_recebida'
       and a.etapa = v_contato.funnel_stage
       and a.vigente_desde <= now()
    on conflict (automacao_id, contact_id, entrada_na_etapa) do nothing;
  exception when others then
    raise warning 'registro de automacao de fluxo (mensagem) falhou (clinic %): %',
      new.clinic_id, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.registrar_mensagem_para_automacao()
  from public, anon, authenticated;

drop trigger if exists registrar_mensagem_para_automacao on public.message;
create trigger registrar_mensagem_para_automacao
  after insert on public.message
  for each row
  when (new.direction = 'entrada'
        and new.author = 'paciente'
        and not new.is_internal_note)
  execute function public.registrar_mensagem_para_automacao();

-- ---------------------------------------------------------------------------
-- 6) Planejar (gatilhos de tempo) e executar
-- ---------------------------------------------------------------------------
-- Os dois rodam dentro de motor_manutencao (pg_cron, 60 s), cada um no
-- proprio bloco de excecao. p_incluir_teste=false (o padrao do motor) deixa
-- de fora as clinicas de teste: os testes de integracao chamam com
-- p_clinic_id e p_incluir_teste=true e nao competem com o cron. O worker
-- local (npm run worker) tambem chama motor_manutencao: a idempotencia vem do
-- UNIQUE, do SKIP LOCKED e do CAS, nunca de "so um motor".

create or replace function public.planejar_automacoes_de_fluxo(
  p_limite integer default 500,
  p_clinic_id uuid default null,
  p_incluir_teste boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  with candidatas as (
    select a.id as automacao_id,
           a.clinic_id,
           a.etapa,
           a.vigente_desde,
           ct.id as contact_id,
           ct.funnel_stage_changed_at as entrada,
           case a.gatilho
             when 'tempo_na_etapa' then ct.funnel_stage_changed_at
             -- greatest ignora nulo: sem mensagem do lead, vale a entrada.
             else greatest(ct.funnel_stage_changed_at, ct.last_contact_at)
           end + make_interval(mins => a.espera_minutos) as devida
      from automacao_fluxo a
      join clinic cl on cl.id = a.clinic_id
      join contact ct
        on ct.clinic_id = a.clinic_id
       and ct.funnel_stage = a.etapa
     where a.ativa
       and a.gatilho in ('tempo_na_etapa', 'sem_resposta_na_etapa')
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
       and (p_incluir_teste or not cl.e_de_teste)
       and ct.kind = 'lead'
       and not (ct.criado_por_importacao
                and ct.funnel_stage_changed_at <= ct.created_at)
  ),
  devidas as (
    select c.*
      from candidatas c
     where c.devida <= now()
       -- NAO RETROATIVO: so o que venceu depois de ligar (ou editar).
       and c.devida >= c.vigente_desde
       and not exists (
         select 1 from automacao_execucao x
          where x.automacao_id = c.automacao_id
            and x.contact_id = c.contact_id
            and x.entrada_na_etapa = c.entrada
       )
     order by c.devida
     limit greatest(1, least(coalesce(p_limite, 500), 5000))
  ),
  novas as (
    insert into automacao_execucao (
      clinic_id, automacao_id, contact_id, de_etapa, entrada_na_etapa,
      devida_em, profundidade
    )
    select clinic_id, automacao_id, contact_id, etapa, entrada, devida, 0
      from devidas
    on conflict (automacao_id, contact_id, entrada_na_etapa) do nothing
    returning 1
  )
  select count(*)::integer into v_total from novas;
  return v_total;
end;
$$;

revoke all on function public.planejar_automacoes_de_fluxo(integer, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.planejar_automacoes_de_fluxo(integer, uuid, boolean)
  to service_role;

-- Executa as pendentes devidas. O lote e escolhido e travado ANTES de
-- executar qualquer coisa (FOR UPDATE SKIP LOCKED): o que nasce durante a
-- passagem (a entrada na etapa nova de um movimento automatico) so roda na
-- proxima, o que freia a cascata a um salto por passagem. Cada linha no
-- proprio bloco de excecao: uma falha vira 'falhou' com erro_<sqlstate> e
-- nao derruba as outras nem trava a fila. Por contato, as outras acoes vem
-- antes de mover (senao o mover derrubaria o CAS delas).
--
-- Sem sessao (pg_cron, service role): auth.uid() nulo, que e o que
-- validar_atividade exige para origem 'automacao'.
create or replace function public.executar_automacoes_de_fluxo(
  p_limite integer default 100,
  p_clinic_id uuid default null,
  p_incluir_teste boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  e record;
  r record;
  v_contato record;
  v_papel text;
  v_conversa uuid;
  v_tags text[];
  v_responsavel uuid;
  v_fuso text;
  v_atividade uuid;
  v_mensagem uuid;
  v_etiqueta_nome text;
  v_n integer;
  v_status text;
  v_motivo text;
  v_para text;
  v_executadas integer := 0;
  v_puladas integer := 0;
  v_falhas integer := 0;
  v_adiadas integer := 0;
begin
  select coalesce(array_agg(s.id), array[]::uuid[])
    into v_ids
    from (
      select x.id
        from automacao_execucao x
        join clinic cl on cl.id = x.clinic_id
       where x.status = 'pendente'
         and x.devida_em <= now()
         and (p_clinic_id is null or x.clinic_id = p_clinic_id)
         and (p_incluir_teste or not cl.e_de_teste)
       order by x.devida_em, x.id
       limit greatest(1, least(coalesce(p_limite, 100), 500))
         for update of x skip locked
    ) s;

  for e in
    select x.id, x.clinic_id, x.automacao_id, x.contact_id,
           x.entrada_na_etapa, x.profundidade, x.created_at
      from automacao_execucao x
      join automacao_fluxo a on a.id = x.automacao_id
     where x.id = any (v_ids)
     order by x.contact_id, x.entrada_na_etapa,
              (a.acao = 'mover_etapa'), x.devida_em, x.id
  loop
    begin
      v_status := 'pulada';
      v_motivo := null;
      v_para := null;
      v_conversa := null;
      v_atividade := null;
      v_etiqueta_nome := null;
      v_papel := null;

      select * into r from automacao_fluxo where id = e.automacao_id;

      if not r.ativa then
        v_motivo := 'regra_desligada';
      elsif e.created_at < r.vigente_desde then
        -- Registrada antes de a regra ser religada ou editada.
        v_motivo := 'regra_alterada';
      else
        -- O contato travado ate o fim da passagem. Se outra transacao o
        -- segura (um movimento humano, a ingestao), fica para a proxima.
        select c.id, c.kind, c.funnel_stage, c.funnel_stage_changed_at,
               c.last_contact_at, c.created_at, c.criado_por_importacao
          into v_contato
          from contact c
         where c.id = e.contact_id
           for no key update skip locked;
        if not found then
          v_adiadas := v_adiadas + 1;
          continue;
        end if;

        if v_contato.funnel_stage is distinct from r.etapa
           or v_contato.funnel_stage_changed_at is distinct from e.entrada_na_etapa then
          -- Saiu da etapa (ou saiu e voltou: outra entrada). O movimento
          -- humano e o termo-chave vencem.
          v_motivo := 'etapa_mudou';
        elsif v_contato.kind is distinct from 'lead' then
          v_motivo := 'nao_e_lead';
        elsif v_contato.criado_por_importacao
              and v_contato.funnel_stage_changed_at <= v_contato.created_at then
          v_motivo := 'importado';
        elsif r.gatilho = 'sem_resposta_na_etapa'
              and greatest(v_contato.funnel_stage_changed_at, v_contato.last_contact_at)
                  + make_interval(mins => r.espera_minutos) > now() then
          v_motivo := 'lead_respondeu';
        elsif r.acao = 'mover_etapa' then
          if e.profundidade >= 3 then
            v_motivo := 'limite_de_cascata';
          elsif (
            select count(*)
              from automacao_execucao m
             where m.contact_id = e.contact_id
               and m.status = 'executada'
               and m.para_etapa is not null
               and m.executada_em > now() - interval '24 hours'
          ) >= 10 then
            v_motivo := 'limite_diario';
          else
            select d.papel into v_papel
              from funnel_stage_def d
             where d.clinic_id = e.clinic_id and d.chave = r.etapa_destino;
            if not found or v_papel in ('agendou', 'compareceu') then
              v_motivo := 'destino_invalido';
            elsif v_papel = 'perdido' and exists (
              select 1
                from appointment ap
               where ap.clinic_id = e.clinic_id
                 and ap.contact_id = e.contact_id
                 and ap.status in ('agendado', 'aguardando_confirmacao',
                                   'confirmado_paciente', 'confirmado_recepcao')
                 and ap.starts_at > now()
            ) then
              v_motivo := 'tem_consulta_futura';
            else
              -- O gatilho de entrada na etapa nova le este GUC: a proxima
              -- regra nasce um salto mais funda.
              perform set_config('conduzza.automacao_profundidade',
                                 (e.profundidade + 1)::text, true);
              -- CAS: so move se continua na mesma entrada da mesma etapa.
              -- Sair de Perdido limpa o motivo no mesmo update (como a
              -- action do Kanban); entrar grava o motivo da regra.
              update contact
                 set funnel_stage = r.etapa_destino,
                     lost_reason = case when v_papel = 'perdido' then r.motivo_perda end,
                     lost_reason_note = null
               where id = e.contact_id
                 and clinic_id = e.clinic_id
                 and funnel_stage = r.etapa
                 and funnel_stage_changed_at = e.entrada_na_etapa;
              get diagnostics v_n = row_count;
              perform set_config('conduzza.automacao_profundidade', '0', true);
              if v_n = 0 then
                v_motivo := 'etapa_mudou';
              else
                v_status := 'executada';
                v_para := r.etapa_destino;
                insert into audit_log (clinic_id, user_id, action, entity, entity_id)
                values (e.clinic_id, null, 'automacao_moveu_etapa', 'contact', e.contact_id);
              end if;
            end if;
          end if;
        else
          -- As outras tres acoes caem na conversa mais recente do lead
          -- (decisao do dono: uma conversa por numero, vale a ultima ativa).
          select v.id into v_conversa
            from conversation v
           where v.clinic_id = e.clinic_id
             and v.contact_id = e.contact_id
           order by coalesce(v.last_message_at, v.created_at) desc,
                    v.created_at desc, v.id
           limit 1;

          if r.acao = 'etiquetar' then
            if v_conversa is null then
              v_motivo := 'sem_conversa';
            else
              -- Sem esperar: quem atende pode estar com a conversa travada
              -- (e travar conversa depois de contato, na ordem contraria de
              -- uma action, seria receita de deadlock). Fica para a proxima.
              select v.tags into v_tags
                from conversation v
               where v.id = v_conversa
                 for no key update skip locked;
              if not found then
                v_adiadas := v_adiadas + 1;
                continue;
              end if;
              if r.etiqueta = any (v_tags) then
                v_motivo := 'ja_tinha_etiqueta';
              elsif cardinality(v_tags) >= 8 then
                v_motivo := 'limite_de_etiquetas';
              else
                update conversation
                   set tags = array_append(tags, r.etiqueta)
                 where id = v_conversa;
                -- O nome na hora vai para o historico (a etiqueta existe:
                -- FK composta e proteger_etiqueta_de_conversa).
                select d.nome into v_etiqueta_nome
                  from conversation_tag_def d
                 where d.clinic_id = e.clinic_id and d.chave = r.etiqueta;
                v_status := 'executada';
                insert into audit_log (clinic_id, user_id, action, entity, entity_id)
                values (e.clinic_id, null, 'automacao_etiquetou', 'conversation', v_conversa);
              end if;
            end if;
          elsif r.acao = 'criar_atividade' then
            -- Responsavel: quem atende a conversa mais recente, se ainda e
            -- membro ATIVO (validar_atividade recusaria); senao ninguem.
            v_responsavel := null;
            if v_conversa is not null then
              select v.assignee_user_id into v_responsavel
                from conversation v
               where v.id = v_conversa;
              if v_responsavel is not null and not exists (
                select 1 from clinic_member m
                 where m.clinic_id = e.clinic_id
                   and m.user_id = v_responsavel
                   and m.status = 'ativo'
              ) then
                v_responsavel := null;
              end if;
            end if;
            -- Prazo: hoje NO FUSO DA CLINICA mais N dias (regra 3.6).
            select cl.timezone into v_fuso from clinic cl where cl.id = e.clinic_id;
            insert into contact_activity (
              clinic_id, contact_id, conversation_id, titulo, due_on,
              assignee_user_id, origem, automacao_id
            ) values (
              e.clinic_id, e.contact_id, v_conversa, r.atividade_titulo,
              (now() at time zone coalesce(v_fuso, 'America/Fortaleza'))::date
                + r.atividade_prazo_dias,
              v_responsavel, 'automacao', r.id
            )
            returning id into v_atividade;
            v_status := 'executada';
            insert into audit_log (clinic_id, user_id, action, entity, entity_id)
            values (e.clinic_id, null, 'automacao_criou_atividade', 'contact_activity', v_atividade);
          elsif r.acao = 'nota_interna' then
            if v_conversa is null then
              v_motivo := 'sem_conversa';
            else
              -- O numero vem da conversa (mensagem_herda_numero). Nota nao
              -- mexe na previa nem no "esperando resposta".
              insert into message (
                clinic_id, conversation_id, direction, author, content_type,
                body, is_internal_note, billable
              ) values (
                e.clinic_id, v_conversa, 'saida', 'sistema', 'texto',
                r.nota_texto, true, false
              )
              returning id into v_mensagem;
              v_status := 'executada';
              insert into audit_log (clinic_id, user_id, action, entity, entity_id)
              values (e.clinic_id, null, 'automacao_anotou', 'message', v_mensagem);
            end if;
          end if;
        end if;
      end if;

      update automacao_execucao
         set status = v_status,
             motivo = case when v_status = 'executada' then null else v_motivo end,
             para_etapa = v_para,
             conversation_id = v_conversa,
             atividade_id = v_atividade,
             -- O retrato do que a regra fez agora: editar a acao ou a
             -- etiqueta da regra depois nao reescreve o historico.
             acao = case when v_status = 'executada' then r.acao end,
             etiqueta = case when v_status = 'executada' and r.acao = 'etiquetar'
                             then r.etiqueta end,
             etiqueta_nome = case when v_status = 'executada' and r.acao = 'etiquetar'
                                  then v_etiqueta_nome end,
             executada_em = now()
       where id = e.id;
      if v_status = 'executada' then
        v_executadas := v_executadas + 1;
      else
        v_puladas := v_puladas + 1;
      end if;
    exception
      when deadlock_detected or serialization_failure or lock_not_available then
        -- Transitorio: o bloco foi desfeito e a linha segue pendente para a
        -- proxima passagem.
        v_adiadas := v_adiadas + 1;
      when others then
        -- Sem dado de paciente: so o codigo do erro.
        update automacao_execucao
           set status = 'falhou',
               motivo = left('erro_' || lower(sqlstate), 64),
               executada_em = now()
         where id = e.id;
        v_falhas := v_falhas + 1;
    end;
  end loop;

  return jsonb_build_object(
    'executadas', v_executadas,
    'puladas', v_puladas,
    'falhas', v_falhas,
    'adiadas', v_adiadas
  );
end;
$$;

revoke all on function public.executar_automacoes_de_fluxo(integer, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.executar_automacoes_de_fluxo(integer, uuid, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7) previa_da_automacao_de_fluxo
-- ---------------------------------------------------------------------------
-- Para a tela dizer, ANTES de ligar, que a regra nao e retroativa:
--   na_etapa         leads da etapa que a regra alcanca
--   ja_se_encaixam   desses, os que ja passaram do ponto e NAO serao
--                    afetados (tempo: ja venceu; entrou: ja estao na etapa;
--                    mensagem: zero, a regra vale para a proxima mensagem)
--   importados_fora  importados que nunca mudaram de etapa (ficam de fora)
-- SECURITY INVOKER: a RLS de contact recorta (quem nao e membro ativo da
-- clinica recebe zeros). Contagem, sem dado de paciente.

create or replace function public.previa_da_automacao_de_fluxo(
  p_clinic_id uuid,
  p_gatilho text,
  p_etapa text,
  p_espera_minutos integer default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  if p_gatilho is null
     or p_gatilho not in ('tempo_na_etapa', 'sem_resposta_na_etapa',
                          'entrou_na_etapa', 'mensagem_recebida') then
    raise exception 'Gatilho de automação inválido.' using errcode = '22023';
  end if;
  if p_gatilho in ('tempo_na_etapa', 'sem_resposta_na_etapa')
     and (p_espera_minutos is null or p_espera_minutos not between 60 and 129600) then
    raise exception 'A espera vai de 1 hora a 90 dias.' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'na_etapa', count(*) filter (where not l.importado),
           'ja_se_encaixam', count(*) filter (where not l.importado and l.ja_passou),
           'importados_fora', count(*) filter (where l.importado)
         )
    into v_resultado
    from (
      select (ct.criado_por_importacao
              and ct.funnel_stage_changed_at <= ct.created_at) as importado,
             case p_gatilho
               when 'tempo_na_etapa' then
                 ct.funnel_stage_changed_at
                   + make_interval(mins => p_espera_minutos) <= now()
               when 'sem_resposta_na_etapa' then
                 greatest(ct.funnel_stage_changed_at, ct.last_contact_at)
                   + make_interval(mins => p_espera_minutos) <= now()
               when 'entrou_na_etapa' then true
               else false
             end as ja_passou
        from public.contact ct
       where ct.clinic_id = p_clinic_id
         and ct.funnel_stage = p_etapa
         and ct.kind = 'lead'
    ) l;
  return v_resultado;
end;
$$;

revoke all on function public.previa_da_automacao_de_fluxo(uuid, text, text, integer)
  from public, anon;
grant execute on function public.previa_da_automacao_de_fluxo(uuid, text, text, integer)
  to authenticated, service_role;

comment on function public.previa_da_automacao_de_fluxo(uuid, text, text, integer) is
  'Quantos leads a regra alcanca na etapa (na_etapa), quantos ja passaram do ponto e nao serao afetados (ja_se_encaixam) e quantos importados ficam de fora. SECURITY INVOKER: a RLS recorta.';

-- ---------------------------------------------------------------------------
-- 8) Etapa e etiqueta usadas por automacao nao se excluem
-- ---------------------------------------------------------------------------
-- Corpos de PRODUCAO (pg_get_functiondef em 02/10/2026), com um bloco novo
-- entre os marcadores. Sem ele a FK composta recusaria do mesmo jeito, mas
-- com 23503 e sem dizer o que fazer.

create or replace function public.proteger_jornada()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.chave is distinct from old.chave then
      raise exception 'A chave de uma etapa não muda. Renomeie o nome da etapa.';
    end if;
    if new.papel is distinct from old.papel then
      raise exception 'O papel de sistema de uma etapa não muda.';
    end if;
    return new;
  end if;
  -- DELETE. Se a CLINICA inteira esta sendo apagada, o cascade manda: as
  -- protecoes abaixo valem para apagar UMA etapa, nao para desmontar a
  -- clinica (sem isto, nenhuma clinica conseguiria ser excluida, e todo
  -- afterAll de teste quebraria).
  if not exists (select 1 from public.clinic where id = old.clinic_id) then
    return old;
  end if;
  if old.papel is not null then
    raise exception 'Etapa de sistema não pode ser excluída. Renomeie ou reordene.';
  end if;
  if exists (
    select 1 from public.contact
     where clinic_id = old.clinic_id and funnel_stage = old.chave
  ) then
    raise exception 'Mova os contatos desta etapa antes de excluí-la.';
  end if;
  if exists (
    select 1 from public.cadence
     where clinic_id = old.clinic_id
       and kind = 'followup'
       and trigger_stage = old.chave
  ) then
    raise exception 'Exclua a régua de follow-up desta etapa antes de excluí-la.';
  end if;
  -- [automacoes de fluxo] inicio
  -- Etapa usada por automacao de fluxo, como origem ou destino.
  if exists (
    select 1 from public.automacao_fluxo
     where clinic_id = old.clinic_id
       and (etapa = old.chave or etapa_destino = old.chave)
  ) then
    raise exception 'Esta etapa é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etapa.'
      using hint = 'etapa_usada_por_automacao';
  end if;
  -- [automacoes de fluxo] fim
  return old;
end;
$$;

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

  -- [automacoes de fluxo] inicio
  -- Etiqueta usada por automacao de fluxo nao se exclui (a automacao
  -- passaria a etiquetar com uma chave que nao existe mais).
  if exists (
    select 1 from public.automacao_fluxo
     where clinic_id = old.clinic_id
       and etiqueta = old.chave
  ) then
    raise exception 'Esta etiqueta é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etiqueta.'
      using hint = 'etiqueta_usada_por_automacao';
  end if;

  -- [automacoes de fluxo] fim
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

-- ---------------------------------------------------------------------------
-- 9) motor_manutencao
-- ---------------------------------------------------------------------------
-- Corpo de PRODUCAO (pg_get_functiondef em 02/10/2026; a ultima definicao em
-- arquivo e a 20260915120000_reoferta_de_espera.sql) com o que e novo entre
-- os marcadores "[automacoes de fluxo]". Fora deles, identico (o ensaio
-- confere). Os codigos curtos planejar_automacoes:<sqlstate> e
-- executar_automacoes:<sqlstate> caem em planner_erro como os outros, e o
-- monitor responde 503 planner_com_erro.

create or replace function public.motor_manutencao()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_erros text[] := array[]::text[];
  v_holds integer := 0;
  v_orfas integer := 0;
  v_ofertas integer := 0;
  v_reguas jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] inicio
  v_automacoes jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] fim
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
  );
end;
$$;
