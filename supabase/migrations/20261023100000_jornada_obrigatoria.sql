-- ---------------------------------------------------------------------------
-- Jornada obrigatoria e a passagem da IA no funil (onda 3, M1 de duas)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 20/10/2026, na segunda reuniao com o Victor (itens 10,
-- 11 e 12 do plano): a passagem da IA para a equipe leva o lead para
-- "Aguardando resposta"; "Aguardando resposta" vem antes de "Em contato",
-- tambem nas clinicas que ja existem; Novo, Aguardando resposta e Em contato
-- passam a ser obrigatorias, como Agendou, Compareceu e Perdido.
-- Levantamento e contrato entre as frentes em ~/.claude/plans/onda3-funil/
-- (levantamento.md e contrato.md, secoes 1, 2 e 6). Decisoes do dono de
-- 21/10/2026 (as recomendacoes do contrato): D0 "Aguardando resposta" passa
-- a ser "o lead espera a resposta da equipe"; D1 = A (toda saida da IA para
-- a fila com o paciente esperando move o lead; quem liga e a M2,
-- 20261023110000); D2 so lead; D3 = A (a etapa nao aceita regua de
-- follow-up); D4 as automacoes de fluxo disparam na entrada pela IA (nada a
-- fazer aqui); D5 = A (a Salud Care ganha Aguardando resposta de volta, logo
-- depois de Novo, e a "Contato inicial" vira etapa de sistema com o nome que
-- a clinica deu); D6 = A (a ordem entre Novo, Aguardando resposta, Em
-- contato, Agendou e Compareceu trava); D7 e D8 sao do codigo.
--
-- 1. PAPEIS NOVOS (itens 11 e 12). O CHECK de papel aceita 'aguardando' (o
--    lead espera a equipe; a passagem da IA poe aqui) e 'em_contato' (a
--    equipe esta com a conversa; Assumir poe aqui). As etapas que ja existem
--    ganham o papel pela chave (em_contato e aguardando_resposta), com
--    proteger_jornada DESLIGADO so nesta transacao: a regra "papel nunca
--    muda" continua valendo para todo o resto, inclusive para a service
--    role. Nome, tom, icone, descricao, termos e conversao ficam como a
--    clinica deixou (a "Contato inicial" da Salud Care mantem o nome).
--    proteger_jornada, validar_etapa_do_contato, avancar_funil_*,
--    funil_da_jornada, as automacoes e a conversao NAO mudam: ja sao
--    genericos por papel ou por chave.
-- 2. A ETAPA QUE FALTA (D5 = A). Clinica sem o papel em_contato (nenhuma em
--    21/10/2026) ganha "Em contato"; sem o papel aguardando (so a Salud
--    Care, que excluiu a etapa em 02/10/2026) ganha "Aguardando resposta",
--    vazia. Nao colide com chave: depois do passo 1, clinica sem o papel
--    nao tem a chave.
-- 3. A ORDEM NOVA (item 11). Aguardando resposta vai logo antes de Em
--    contato; o resto mantem a ordem relativa (posicao, chave), como a tela
--    mostra; renumera 10, 20, 30 (a regra da RPC de reordenar). Nenhuma chave
--    muda e nenhum contato muda de etapa, entao nada dispara (regua,
--    automacao, conversao); as duas etapas continuam antes de Agendou (os
--    gatilhos da agenda seguem iguais); o "so para frente" do termo-chave
--    inverte so entre as duas, que nao tem termo em clinica nenhuma.
--    Producao em 21/10/2026: as 41 clinicas padrao ficam Novo 10,
--    Aguardando resposta 20, Em contato 30, Agendou 40, Compareceu 50,
--    Perdido 60; a Salud Care fica Novo 10, Aguardando resposta 20, Contato
--    inicial 30, as oito livres de 40 a 110, Agendou 120, Compareceu 130,
--    Comprou HomeCare 140 e Perdido 150.
-- 4. SEMENTE NOVA. semear_jornada_padrao: Novo 10 (entrada), Aguardando
--    resposta 20 (aguardando), Em contato 30 (em_contato), Agendou 40,
--    Compareceu 50, Perdido 60; mesmos tons, icones e grants.
-- 5. ORDEM TRAVADA (D6 = A). reordenar_etapa_da_jornada recusa trocar duas
--    vizinhas quando as duas sao Novo, Aguardando resposta, Em contato,
--    Agendou ou Compareceu (P0001, mensagem 'A ordem das etapas de sistema
--    nao muda.', hint ordem_de_sistema, que a tela traduz). A troca e sempre
--    com a vizinha, entao nenhuma sequencia de trocas inverte essa cadeia.
--    As livres e Perdido continuam indo para qualquer lugar.
--    E a cadeia e INVARIANTE DO BANCO (revisao de 21/10/2026: a policy de
--    gestao e FOR ALL, e a sessao do gestor muda posicao direto pelo
--    PostgREST, sem passar pela RPC): o gatilho de restricao
--    conferir_ordem_da_jornada (AFTER INSERT OR UPDATE OF posicao, papel,
--    clinic_id em funnel_stage_def) recusa, com o mesmo P0001 e o mesmo
--    hint, a clinica que ficar sem Novo < Aguardando resposta < Em contato <
--    Agendou < Compareceu pela posicao. Estrita: empate tambem recusa,
--    porque os gatilhos da agenda e mover_lead_para_aguardando comparam
--    posicao. Vale para todo mundo (sessao, service role, migration), no fim
--    de cada comando. So a RPC adia a conferencia para o fim da transacao
--    (SET CONSTRAINTS ... DEFERRED no trecho [ordem fixa]): a renumeracao
--    dela anda uma linha por vez e passa por empates no meio do caminho.
--    Quem renumerar em mais de um comando faz o mesmo. DEFERRABLE INITIALLY
--    IMMEDIATE de proposito: adiado por padrao, todo comando em
--    funnel_stage_def deixaria evento pendente ate o commit, e um ALTER
--    TABLE nela na mesma transacao cairia em 55006 ("pending trigger
--    events").
-- 6. REGUA EM AGUARDANDO RESPOSTA (D3 = A). Gatilho novo em cadence,
--    recusar_followup_em_aguardando (BEFORE INSERT OR UPDATE OF kind,
--    trigger_stage, clinic_id): regua de follow-up em etapa de papel
--    aguardando e recusada (P0001, hint etapa_sem_followup), venha da tela,
--    do PostgREST ou da service role. Quem esta ali espera a clinica; uma
--    mensagem automatica da clinica (com offset 0, na hora) seria ruim para
--    o paciente e risco de denuncia no canal nao oficial. Nenhuma regua de
--    hoje e atingida (0 em aguardando_resposta em 21/10/2026; a conferencia
--    do fim recusa a migration se houver).
-- 7. A PASSAGEM DA IA NO FUNIL (item 10), INERTE ATE A M2:
--    - mover_lead_para_aguardando(clinica, contato, conversa,
--      da_pendencia): leva o lead para a etapa de papel aguardando. Na
--      ordem: sem a etapa, 'sem_etapa'; o contato com FOR NO KEY UPDATE SKIP
--      LOCKED (a passagem ja segura a conversa e a ingestao trava contato e
--      depois conversa: esperar pelo contato aqui seria a ordem inversa e um
--      deadlock possivel com uma mensagem do mesmo paciente chegando no
--      mesmo instante), ocupado grava ou renova a pendencia (se nao veio
--      dela) e devolve 'adiado', inexistente 'sem_contato'; paciente
--      'nao_e_lead' (D2); 'ja_esta'; etapa atual de papel em_contato,
--      agendou, compareceu ou perdido, ou com posicao maior ou igual a do
--      destino, 'nao_volta' (nunca para tras: Em contato e as livres depois
--      de Aguardando resposta ficam; Em contato tambem pelo papel, sem
--      apostar na ordem); senao move (com CAS na etapa lida), grava
--      a trilha ia_moveu_etapa (entity contact, user_id nulo, sem detalhes)
--      e devolve 'movido'. Os gatilhos de contact fazem o resto, como em
--      qualquer mudanca de etapa: relogio, automacoes (so lead), conversao da
--      Meta se a clinica configurar evento na etapa, Realtime. So as funcoes
--      do banco a chamam (execute revogado ate da service role).
--    - etapa_pendente_da_passagem: o movimento que esperou o contato (um
--      por contato). So ids, nada de paciente; sem FK para contact e
--      conversation (tabelas quentes), so para clinic. RLS ligada SEM
--      policy: nenhuma sessao le nem grava.
--    - passagem_da_ia_move_o_lead(): a funcao do gatilho da M2. Chama a de
--      cima dentro de BEGIN ... EXCEPTION; no erro, so um WARNING com a
--      clinica e o SQLSTATE. A passagem nunca falha por causa do funil.
--    - processar_pendencias_do_funil(limite, clinica, incluir_teste): tenta
--      de novo as pendencias. Apaga a pendencia com mais de 1 dia, com 60
--      tentativas ou cuja conversa ja nao esta aguardando_humano
--      ('descartadas'); processa ate 100 com FOR UPDATE SKIP LOCKED ('adiado'
--      ou erro somam uma tentativa; o resto apaga). Em cada uma, a conversa
--      ANTES do contato (a ordem de travas das passagens), FOR SHARE SKIP
--      LOCKED e ainda aguardando_humano (revisao de 21/10/2026: sem isso, o
--      Assumir que pegasse a conversa entre o descarte e o movimento ficaria
--      com o lead em Aguardando resposta): travada por outro agora, tenta na
--      proxima; fora de aguardando_humano, descarta; com ela segura ate o
--      fim da passagem, quem assume espera milissegundos e le o lead ja em
--      Aguardando resposta, que o Assumir leva para Em contato. Nunca espera
--      ninguem.
--      Devolve {movidos, descartadas, adiadas, sem_mudanca, erros}. Erro
--      vira funil_passagem:<SQLSTATE> em erros e, na passagem do motor (sem
--      clinica), na batida 'motor-funil' de worker_heartbeat (ultimo_erro),
--      como a manutencao faz com a dela. A saude do motor (saude_do_motor) e
--      o monitor externo NAO leem essa batida (leem so motor-fila e
--      motor-planner): acompanhar por ela e por cron.job_run_details; a
--      higiene da manutencao a apaga se ficar 1 hora sem bater (o cron
--      parado). Como o motor, ignora a clinica e_de_teste salvo com
--      incluir_teste (as suites passam a clinica delas).
--      Chamada pela entrada 'funil-da-passagem' do pg_cron, a cada minuto,
--      agendada aqui (molde da poda-do-cron: so chama funcao do banco, nada
--      sai pela rede; so agenda se o pg_cron existe). motor_manutencao e
--      ia_tirar_conversa NAO mudam (a onda 2 as troca em paralelo).
--    Antes da M2 nada chama mover_lead_para_aguardando: a tabela fica vazia
--    e a entrada do cron so bate ponto.
--
-- CONFERENCIA no fim (recusa a migration inteira, P0001, se falhar): toda
-- clinica com as seis etapas de sistema, uma de cada; posicoes sem empate;
-- Aguardando resposta logo antes de Em contato; a cadeia inteira na ordem,
-- Novo < Aguardando resposta < Em contato < Agendou < Compareceu (revisao de
-- 21/10/2026: a renumeracao preserva a ordem de hoje, entao uma clinica que
-- chegasse aqui com Novo depois de Em contato, ou Em contato depois de
-- Agendou, ficaria congelada assim pela D6; a migration para e o dono
-- decide); nenhuma regua de follow-up em Aguardando resposta.
--
-- Duas funcoes de producao mudam, a partir do corpo de PRODUCAO lido em
-- 21/10/2026 (fndef.js, so leitura) e guardado em supabase/operacao/
-- rollback/20261023100000-corpos-anteriores.sql com o md5 do prosrc de cada
-- um (o ensaio confere que o banco ainda esta assim): semear_jornada_padrao
-- (as duas linhas entre "-- [jornada obrigatoria] inicio" e "... fim") e
-- reordenar_etapa_da_jornada (um trecho entre "-- [ordem fixa] inicio" e
-- "... fim": a trava e o SET CONSTRAINTS); o resto e o corpo de producao
-- linha a linha. Security, search_path e grants ficam como eram (CREATE OR
-- REPLACE mantem os grants).
--
-- Erros de regra: P0001 com hint (ordem_de_sistema, etapa_sem_followup) ou
-- mensagem-chave (jornada_incompleta e as outras da conferencia). Nunca
-- 40001/40P01 (o PostgREST repete sem limite). Nada aqui grava nome,
-- telefone ou conteudo de mensagem de paciente: a pendencia e a trilha
-- guardam so ids, e os WARNINGs so a clinica e o SQLSTATE.
--
-- LOCKS: lock_timeout de 3 s. funnel_stage_def fica por ULTIMO (o resto
-- antes, para a janela ser curta): o ALTER do CHECK pega ACCESS EXCLUSIVE ate
-- o commit, e validar_etapa_do_contato le a tabela em todo insert e update
-- de contact, entao a ingestao espera fracoes de segundo (260 linhas na
-- producao). A FK nova da pendencia pega SHARE ROW EXCLUSIVE em clinic
-- (escrita em clinic, rara, espera; leitura e insert com FK para clinic, nao)
-- e o gatilho novo SHARE ROW EXCLUSIVE em cadence (fria), ate o commit; o
-- gatilho da ordem, SHARE ROW EXCLUSIVE em funnel_stage_def, que ja esta
-- travada. Nenhum ALTER em message, conversation, contact, clinic_member,
-- job_queue nem clinic, e nenhuma linha de contact, conversation, message,
-- cadence ou automacao_fluxo muda aqui. Aplicar em horario calmo.
--
-- ORDEM DE PUBLICACAO: o codigo tolerante (P1) vai ao ar ANTES desta
-- migration (o leitor do Funil de leads do Inicio recusava papel
-- desconhecido); a M2 vai depois, de madrugada.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO o rollback da M2 (o gatilho de
-- conversation sai), DEPOIS, no SQL editor, o arquivo
-- supabase/operacao/rollback/20261023100000-corpos-anteriores.sql, que sao
-- DUAS transacoes. A primeira desfaz tudo menos a tabela de pendencias (a
-- entrada do cron, o gatilho de cadence, o gatilho da ordem e as cinco
-- funcoes novas saem; os dois corpos de antes voltam; a ordem de antes
-- volta, com Aguardando resposta logo depois de Em contato; a etapa recriada
-- da Salud Care sai se continuar vazia; papel nulo de novo nas duas, com o
-- gatilho desligado na transacao; o CHECK de antes volta); sem as funcoes, a
-- tabela fica inerte. A segunda, sozinha e com lock_timeout de 1 s, so faz o
-- DROP da tabela: tirar a FK pega ACCESS EXCLUSIVE em CLINIC (toda leitura de
-- clinic e todo insert com FK para ela param ate o commit), entao ela nao
-- divide a transacao com mais nada e pode ficar para outro horario. O codigo
-- P1 funciona com o banco de antes: nao precisa voltar.

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) A passagem da IA no funil (inerte ate a M2)
-- ---------------------------------------------------------------------------

create table public.etapa_pendente_da_passagem (
  contact_id uuid primary key,
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  conversation_id uuid not null,
  criada_em timestamptz not null default now(),
  tentativas integer not null default 0
    constraint etapa_pendente_da_passagem_tentativas_validas
      check (tentativas >= 0)
);

create index etapa_pendente_da_passagem_clinic_id_idx
  on public.etapa_pendente_da_passagem (clinic_id);

alter table public.etapa_pendente_da_passagem enable row level security;

-- Sem policy: nenhuma sessao le nem grava. So as funcoes do banco (e a
-- service role, que nao passa por RLS) mexem aqui.
revoke all on table public.etapa_pendente_da_passagem from anon, authenticated;

comment on table public.etapa_pendente_da_passagem is
  'Movimento da passagem da IA que esperou o contato (onda 3): a passagem levaria o lead para Aguardando resposta, mas o contato estava travado por outra transacao (mover_lead_para_aguardando nunca espera). Um por contato; a passagem seguinte renova. processar_pendencias_do_funil tenta de novo a cada minuto (entrada funil-da-passagem do pg_cron) e descarta depois de 1 dia, 60 tentativas ou quando a conversa ja nao esta aguardando_humano. So ids, nada de paciente. RLS ligada sem policy: nenhuma sessao le nem grava.';

create function public.mover_lead_para_aguardando(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid,
  p_da_pendencia boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destino record;
  v_contato record;
  v_atual record;
  v_n integer := 0;
begin
  -- 1. A etapa de papel aguardando da clinica.
  select d.chave, d.posicao
    into v_destino
    from public.funnel_stage_def d
   where d.clinic_id = p_clinic_id
     and d.papel = 'aguardando';
  if not found then
    return 'sem_etapa';
  end if;

  -- 2. O contato, sem esperar ninguem. A passagem ja segura a conversa, e a
  -- ingestao trava contato e depois conversa: esperar aqui seria a ordem
  -- inversa. A trava que a propria transacao ja tem (a ingestao com a IA
  -- parada) nao conta como ocupado.
  select k.kind, k.funnel_stage
    into v_contato
    from public.contact k
   where k.id = p_contact_id
     and k.clinic_id = p_clinic_id
     for no key update skip locked;
  if found then
    -- 3. So lead (D2): paciente fica onde esta, como no Assumir.
    if v_contato.kind is distinct from 'lead' then
      return 'nao_e_lead';
    end if;
    -- 4. Ja esta.
    if v_contato.funnel_stage = v_destino.chave then
      return 'ja_esta';
    end if;
    -- 5. Nunca para tras: Agendou, Compareceu, Perdido, Em contato e as
    -- livres depois de Aguardando resposta ficam. Em contato tambem pelo
    -- papel, nao so pela posicao: a ordem da cadeia e invariante do banco
    -- (conferir_ordem_da_jornada), mas a regra nao aposta nisso.
    select d.papel, d.posicao
      into v_atual
      from public.funnel_stage_def d
     where d.clinic_id = p_clinic_id
       and d.chave = v_contato.funnel_stage;
    if not found
       or v_atual.papel in ('em_contato', 'agendou', 'compareceu', 'perdido')
       or v_atual.posicao >= v_destino.posicao then
      return 'nao_volta';
    end if;
    -- 6. Move, com CAS na etapa lida (a trava acima ja garante; o CAS e a
    -- rede), e grava a trilha. Os gatilhos de contact fazem o resto.
    update public.contact k
       set funnel_stage = v_destino.chave
     where k.id = p_contact_id
       and k.clinic_id = p_clinic_id
       and k.funnel_stage = v_contato.funnel_stage;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
      values (p_clinic_id, null, 'ia_moveu_etapa', 'contact', p_contact_id);
      return 'movido';
    end if;
  elsif not exists (
    select 1 from public.contact k
     where k.id = p_contact_id
       and k.clinic_id = p_clinic_id
  ) then
    return 'sem_contato';
  end if;

  -- Ocupado (ou o CAS nao pegou): fica para a proxima passagem da
  -- manutencao do funil. Quem veio da pendencia nao grava (quem chamou soma a
  -- tentativa); a passagem grava ou renova (a conversa mais recente, o
  -- relogio e as tentativas do zero).
  if not coalesce(p_da_pendencia, false) then
    insert into public.etapa_pendente_da_passagem as p (contact_id, clinic_id, conversation_id)
    values (p_contact_id, p_clinic_id, p_conversation_id)
    on conflict (contact_id) do update
       set clinic_id = excluded.clinic_id,
           conversation_id = excluded.conversation_id,
           criada_em = now(),
           tentativas = 0;
  end if;
  return 'adiado';
end;
$$;

-- So as funcoes do banco (a do gatilho e a da manutencao do funil, como
-- dono) a chamam.
revoke all on function public.mover_lead_para_aguardando(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

comment on function public.mover_lead_para_aguardando(uuid, uuid, uuid, boolean) is
  'Passagem da IA para a equipe (onda 3, item 10): leva o LEAD para a etapa de papel aguardando (Aguardando resposta). Devolve sem_etapa, adiado (contato travado por outra transacao: grava ou renova etapa_pendente_da_passagem, salvo p_da_pendencia), sem_contato, nao_e_lead, ja_esta, nao_volta (etapa atual em_contato, agendou, compareceu, perdido ou com posicao maior ou igual a do destino) ou movido (trilha ia_moveu_etapa, user_id nulo). Nunca espera trava de contato (FOR NO KEY UPDATE SKIP LOCKED). So as funcoes do banco executam.';

create function public.passagem_da_ia_move_o_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A passagem nunca falha por causa do funil: qualquer erro vira so um
  -- aviso, sem dado de paciente.
  begin
    perform public.mover_lead_para_aguardando(new.clinic_id, new.contact_id, new.id, false);
  exception when others then
    raise warning 'passagem da IA nao moveu a etapa (clinic %): %', new.clinic_id, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.passagem_da_ia_move_o_lead()
  from public, anon, authenticated, service_role;

comment on function public.passagem_da_ia_move_o_lead() is
  'Funcao do gatilho passagem_da_ia_move_o_lead de conversation (migration 20261023110000): quando a conversa sai da IA para a fila (ia_atendendo para aguardando_humano) com o paciente esperando (awaiting_reply), chama mover_lead_para_aguardando. Qualquer erro vira WARNING com a clinica e o SQLSTATE: a passagem nunca falha por causa do funil.';

create function public.processar_pendencias_do_funil(
  p_limite integer default 100,
  p_clinic_id uuid default null,
  p_incluir_teste boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite integer := greatest(1, least(coalesce(p_limite, 100), 100));
  v_movidos integer := 0;
  v_descartadas integer := 0;
  v_adiadas integer := 0;
  v_sem_mudanca integer := 0;
  v_erros text[] := array[]::text[];
  v_pendencia record;
  v_resultado text;
  v_codigo text;
begin
  begin
    -- Descarta, sem esperar ninguem: mais de 1 dia, 60 tentativas, ou a
    -- conversa ja nao espera a equipe (assumida, devolvida para a IA,
    -- resolvida ou apagada).
    with velhas as (
      select p.contact_id
        from public.etapa_pendente_da_passagem p
        join public.clinic cl on cl.id = p.clinic_id
       where (p_clinic_id is null or p.clinic_id = p_clinic_id)
         and (coalesce(p_incluir_teste, false) or not cl.e_de_teste)
         and (p.criada_em < now() - interval '1 day'
              or p.tentativas >= 60
              or not exists (
                select 1 from public.conversation c
                 where c.id = p.conversation_id
                   and c.clinic_id = p.clinic_id
                   and c.status = 'aguardando_humano'
              ))
         for update of p skip locked
    )
    delete from public.etapa_pendente_da_passagem p
     using velhas v
     where p.contact_id = v.contact_id;
    get diagnostics v_descartadas = row_count;

    -- Tenta de novo ate o limite, as mais antigas primeiro. Cada pendencia
    -- erra sozinha: o erro soma uma tentativa (descartada nas 60) e o codigo
    -- vai para erros.
    for v_pendencia in
      select p.contact_id, p.clinic_id, p.conversation_id
        from public.etapa_pendente_da_passagem p
        join public.clinic cl on cl.id = p.clinic_id
       where (p_clinic_id is null or p.clinic_id = p_clinic_id)
         and (coalesce(p_incluir_teste, false) or not cl.e_de_teste)
       order by p.criada_em, p.contact_id
       limit v_limite
         for update of p skip locked
    loop
      begin
        -- [conversa travada] A conversa antes do contato (a ordem de travas
        -- das passagens), sem esperar ninguem. O descarte acima olhou a
        -- conversa um comando antes; ela pode ter sido assumida no meio, e o
        -- Assumir que leu o lead em Novo desistiria do proprio movimento
        -- quando este o levasse para Aguardando resposta. FOR SHARE ate o fim
        -- desta passagem: quem tira a conversa de aguardando_humano
        -- (Assumir, Transferir, Devolver para a IA, Resolver) espera
        -- milissegundos e depois le o lead ja em Aguardando resposta, que o
        -- Assumir leva para Em contato. Travada por outro agora: tenta na
        -- proxima passagem. Fora de aguardando_humano: descarta.
        perform 1
          from public.conversation c
         where c.id = v_pendencia.conversation_id
           and c.clinic_id = v_pendencia.clinic_id
           and c.status = 'aguardando_humano'
           for share of c skip locked;
        if found then
          v_resultado := public.mover_lead_para_aguardando(
            v_pendencia.clinic_id, v_pendencia.contact_id, v_pendencia.conversation_id, true);
        elsif exists (
          select 1
            from public.conversation c
           where c.id = v_pendencia.conversation_id
             and c.clinic_id = v_pendencia.clinic_id
             and c.status = 'aguardando_humano'
        ) then
          v_resultado := 'adiado';
        else
          v_resultado := 'descartada';
        end if;
      exception when others then
        v_resultado := null;
        v_codigo := 'funil_passagem:' || sqlstate;
        if not v_codigo = any (v_erros) then
          v_erros := v_erros || v_codigo;
        end if;
      end;
      if v_resultado is null or v_resultado = 'adiado' then
        update public.etapa_pendente_da_passagem p
           set tentativas = p.tentativas + 1
         where p.contact_id = v_pendencia.contact_id;
        v_adiadas := v_adiadas + 1;
      else
        delete from public.etapa_pendente_da_passagem p
         where p.contact_id = v_pendencia.contact_id;
        if v_resultado = 'movido' then
          v_movidos := v_movidos + 1;
        elsif v_resultado = 'descartada' then
          v_descartadas := v_descartadas + 1;
        else
          v_sem_mudanca := v_sem_mudanca + 1;
        end if;
      end if;
    end loop;
  exception when others then
    -- Erro estrutural: nada desta passagem fica, e o codigo aparece.
    v_erros := v_erros || ('funil_passagem:' || sqlstate);
  end;

  -- A passagem do motor (sem clinica) bate ponto como a manutencao faz.
  if p_clinic_id is null then
    insert into public.worker_heartbeat as h (worker_id, batida_em, ultimo_lote, ultimo_erro, ultimo_erro_em)
    values (
      'motor-funil',
      now(),
      v_movidos,
      case when cardinality(v_erros) = 0 then null else array_to_string(v_erros, ',') end,
      case when cardinality(v_erros) = 0 then null else now() end
    )
    on conflict (worker_id) do update
    set batida_em = now(),
        ultimo_lote = excluded.ultimo_lote,
        ultimo_erro = excluded.ultimo_erro,
        ultimo_erro_em = coalesce(excluded.ultimo_erro_em, h.ultimo_erro_em);
  end if;

  return jsonb_build_object(
    'movidos', v_movidos,
    'descartadas', v_descartadas,
    'adiadas', v_adiadas,
    'sem_mudanca', v_sem_mudanca,
    'erros', to_jsonb(v_erros)
  );
end;
$$;

revoke all on function public.processar_pendencias_do_funil(integer, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.processar_pendencias_do_funil(integer, uuid, boolean)
  to service_role;

comment on function public.processar_pendencias_do_funil(integer, uuid, boolean) is
  'Manutencao do funil da passagem da IA (onda 3), a cada minuto pela entrada funil-da-passagem do pg_cron: apaga a pendencia com mais de 1 dia, com 60 tentativas ou cuja conversa ja nao esta aguardando_humano (descartadas) e tenta de novo ate p_limite (no maximo 100) com FOR UPDATE SKIP LOCKED (adiado ou erro somam uma tentativa; o resto apaga). Em cada uma, a conversa antes do contato, FOR SHARE SKIP LOCKED e ainda aguardando_humano: travada agora, adia; fora de aguardando_humano, descarta; segura ate o fim da passagem, ninguem a tira de aguardando_humano enquanto o lead anda. Nunca espera trava. Devolve {movidos, descartadas, adiadas, sem_mudanca, erros} (erros: funil_passagem:<SQLSTATE>). Sem p_clinic_id bate ponto em worker_heartbeat (motor-funil, com o erro em ultimo_erro). Ignora clinica e_de_teste salvo com p_incluir_teste. So service_role (e o pg_cron, como postgres).';

-- A entrada do pg_cron. Molde da poda-do-cron (20260924120000): so chama uma
-- funcao do banco e nada sai pela rede, entao num banco local ela so cuida
-- daquele banco; a migration aplica num banco sem pg_cron (so agenda se a
-- funcao do cron existe, por execute). cron.schedule com um nome que ja
-- existe atualiza a entrada.
do $funil$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    execute $cron$
      select cron.schedule(
        'funil-da-passagem',
        '* * * * *',
        'select public.processar_pendencias_do_funil()'
      )
    $cron$;
  end if;
end;
$funil$;

-- ---------------------------------------------------------------------------
-- 2) Regua de follow-up em Aguardando resposta (D3 = A)
-- ---------------------------------------------------------------------------

create function public.recusar_followup_em_aguardando()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'followup' and exists (
    select 1
      from public.funnel_stage_def d
     where d.clinic_id = new.clinic_id
       and d.chave = new.trigger_stage
       and d.papel = 'aguardando'
  ) then
    raise exception using errcode = 'P0001',
      message = 'A etapa em que o lead espera a resposta da equipe não tem régua de follow-up.',
      hint = 'etapa_sem_followup';
  end if;
  return new;
end;
$$;

revoke all on function public.recusar_followup_em_aguardando()
  from public, anon, authenticated, service_role;

comment on function public.recusar_followup_em_aguardando() is
  'Gatilho de cadence (onda 3, D3 = A): regua de follow-up em etapa de papel aguardando (o lead espera a resposta da equipe) e recusada com P0001, hint etapa_sem_followup, venha de onde vier.';

create trigger recusar_followup_em_aguardando
  before insert or update of kind, trigger_stage, clinic_id on public.cadence
  for each row
  execute function public.recusar_followup_em_aguardando();

-- ---------------------------------------------------------------------------
-- 3) Semente nova e ordem travada (corpos de producao com o trecho marcado)
-- ---------------------------------------------------------------------------

create or replace function public.semear_jornada_padrao(p_clinic_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.funnel_stage_def
    (clinic_id, chave, nome, posicao, tom, icone, papel)
  values
    (p_clinic_id, 'novo',                'Novo',                10, 'neutral', 'badge-plus',          'entrada'),
    -- [jornada obrigatoria] inicio
    -- Onda 3 (23/10/2026): Aguardando resposta (o lead espera a resposta da
    -- equipe) antes de Em contato, as duas etapas de sistema.
    (p_clinic_id, 'aguardando_resposta', 'Aguardando resposta', 20, 'warning', 'timer',               'aguardando'),
    (p_clinic_id, 'em_contato',          'Em contato',          30, 'info',    'message-square-text', 'em_contato'),
    -- [jornada obrigatoria] fim
    (p_clinic_id, 'agendou',             'Agendou',             40, 'success', 'calendar-plus',       'agendou'),
    (p_clinic_id, 'compareceu',          'Compareceu',          50, 'success', 'check-check',         'compareceu'),
    (p_clinic_id, 'perdido',             'Perdido',             60, 'alert',   'user-round-x',        'perdido')
  on conflict (clinic_id, chave) do nothing;
$function$;

create or replace function public.reordenar_etapa_da_jornada(p_clinic_id uuid, p_chave text, p_direcao text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_chaves text[];
  v_ids uuid[];
  v_indice integer;
  v_alvo integer;
  v_tmp text;
  v_movida uuid;
  i integer;
begin
  if p_direcao not in ('subir', 'descer') then
    raise exception 'Direção inválida.';
  end if;

  -- Agregado sobre subquery porque FOR UPDATE nao convive com array_agg na
  -- mesma query. O desempate por chave e o MESMO da leitura da tela
  -- (fetchJornada ordena por posicao, chave): o que o usuario ve e o que
  -- a troca usa.
  select
      array_agg(etapas.chave order by etapas.posicao, etapas.chave),
      array_agg(etapas.id order by etapas.posicao, etapas.chave)
    into v_chaves, v_ids
    from (
      select id, chave, posicao
        from public.funnel_stage_def
       where clinic_id = p_clinic_id
         for update
    ) etapas;

  v_indice := array_position(v_chaves, p_chave);
  if v_indice is null then
    raise exception 'Etapa não encontrada.';
  end if;

  v_alvo := v_indice + case when p_direcao = 'subir' then -1 else 1 end;
  if v_alvo < 1 or v_alvo > array_length(v_chaves, 1) then
    raise exception 'A etapa já está na ponta da jornada.';
  end if;

  -- [ordem fixa] inicio
  -- Onda 3 (23/10/2026, decisao D6 do dono): a ordem entre Novo, Aguardando
  -- resposta, Em contato, Agendou e Compareceu e fixa. A troca e sempre com
  -- a vizinha: recusa quando as duas sao dessas etapas (as livres e Perdido
  -- continuam indo para qualquer lugar). As linhas ja estao travadas acima.
  if (select count(*)
        from public.funnel_stage_def d
       where d.clinic_id = p_clinic_id
         and d.chave in (v_chaves[v_indice], v_chaves[v_alvo])
         and d.papel in ('entrada', 'aguardando', 'em_contato', 'agendou', 'compareceu')) = 2
  then
    raise exception using errcode = 'P0001',
      message = 'A ordem das etapas de sistema não muda.',
      hint = 'ordem_de_sistema';
  end if;
  -- A renumeracao abaixo anda uma linha por vez e passa por empates no
  -- meio do caminho: o gatilho conferir_ordem_da_jornada (a mesma cadeia,
  -- como invariante do banco) confere no fim da transacao, com a troca
  -- inteira feita.
  set constraints public.conferir_ordem_da_jornada deferred;
  -- [ordem fixa] fim

  v_movida := v_ids[v_indice];
  v_tmp := v_chaves[v_indice];
  v_chaves[v_indice] := v_chaves[v_alvo];
  v_chaves[v_alvo] := v_tmp;

  for i in 1..array_length(v_chaves, 1) loop
    update public.funnel_stage_def
       set posicao = i * 10
     where clinic_id = p_clinic_id
       and chave = v_chaves[i]
       and posicao is distinct from i * 10;
  end loop;

  return v_movida;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) Papeis novos, a etapa que falta e a ordem nova. Por ultimo: o ALTER do
-- CHECK segura funnel_stage_def (ACCESS EXCLUSIVE) ate o commit.
-- ---------------------------------------------------------------------------

alter table public.funnel_stage_def
  drop constraint funnel_stage_def_papel_check;
alter table public.funnel_stage_def
  add constraint funnel_stage_def_papel_check
  check (papel in ('entrada', 'aguardando', 'em_contato', 'agendou', 'compareceu', 'perdido'));

-- O papel nas etapas que ja existem. proteger_jornada desligado SO nesta
-- transacao: fora dela, papel nunca muda (nem pela service role).
alter table public.funnel_stage_def disable trigger proteger_jornada;
update public.funnel_stage_def
   set papel = 'em_contato'
 where chave = 'em_contato'
   and papel is null;
update public.funnel_stage_def
   set papel = 'aguardando'
 where chave = 'aguardando_resposta'
   and papel is null;
alter table public.funnel_stage_def enable trigger proteger_jornada;

-- A etapa que falta (D5 = A). Posicao provisoria: a renumeracao abaixo poe
-- Aguardando resposta logo antes de Em contato.
insert into public.funnel_stage_def (clinic_id, chave, nome, posicao, tom, icone, papel)
select c.id, 'em_contato', 'Em contato',
       coalesce((select d.posicao from public.funnel_stage_def d
                  where d.clinic_id = c.id and d.papel = 'aguardando'),
                (select d.posicao from public.funnel_stage_def d
                  where d.clinic_id = c.id and d.papel = 'entrada'),
                0) + 5,
       'info', 'message-square-text', 'em_contato'
  from public.clinic c
 where not exists (
   select 1 from public.funnel_stage_def d
    where d.clinic_id = c.id and d.papel = 'em_contato'
 );
insert into public.funnel_stage_def (clinic_id, chave, nome, posicao, tom, icone, papel)
select c.id, 'aguardando_resposta', 'Aguardando resposta',
       (select d.posicao from public.funnel_stage_def d
         where d.clinic_id = c.id and d.papel = 'em_contato'),
       'warning', 'timer', 'aguardando'
  from public.clinic c
 where not exists (
   select 1 from public.funnel_stage_def d
    where d.clinic_id = c.id and d.papel = 'aguardando'
 );

-- A ordem nova: cada etapa pela ordem da tela (posicao, chave); Aguardando
-- resposta no lugar de Em contato, um passo antes dela; renumera 10, 20, 30.
with ordem as (
  select d.id,
         row_number() over (
           partition by d.clinic_id
           order by case when d.papel = 'aguardando' then e.posicao else d.posicao end,
                    case when d.papel = 'aguardando' then e.chave else d.chave end,
                    case when d.papel = 'aguardando' then 0 else 1 end
         ) * 10 as nova
    from public.funnel_stage_def d
    left join public.funnel_stage_def e
      on e.clinic_id = d.clinic_id
     and e.papel = 'em_contato'
)
update public.funnel_stage_def d
   set posicao = o.nova
  from ordem o
 where d.id = o.id
   and d.posicao is distinct from o.nova;

-- ---------------------------------------------------------------------------
-- 5) A cadeia como invariante do banco (D6 = A; revisao de 21/10/2026).
-- Depois das mudancas acima de proposito: a etapa recriada passa por uma
-- posicao provisoria empatada, e quem confere a migration e o bloco 6. Daqui
-- em diante nenhum comando em funnel_stage_def roda nesta transacao (com o
-- gatilho adiado por alguem, um ALTER TABLE cairia em 55006).
-- ---------------------------------------------------------------------------

create function public.conferir_ordem_da_jornada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A cadeia da clinica da linha, na ordem dos papeis: cada etapa antes da
  -- seguinte pela posicao, sem empate. Security definer: confere a jornada
  -- inteira, nao so o que a sessao enxerga. A clinica apagada na mesma
  -- transacao nao tem linha: nada a conferir.
  if exists (
    select 1
      from (
        select d.posicao,
               lead(d.posicao) over (
                 order by array_position(
                   array['entrada', 'aguardando', 'em_contato', 'agendou', 'compareceu'],
                   d.papel)
               ) as proxima
          from public.funnel_stage_def d
         where d.clinic_id = new.clinic_id
           and d.papel in ('entrada', 'aguardando', 'em_contato', 'agendou', 'compareceu')
      ) cadeia
     where cadeia.proxima is not null
       and cadeia.posicao >= cadeia.proxima
  ) then
    raise exception using errcode = 'P0001',
      message = 'A ordem das etapas de sistema não muda.',
      hint = 'ordem_de_sistema';
  end if;
  return null;
end;
$$;

revoke all on function public.conferir_ordem_da_jornada()
  from public, anon, authenticated, service_role;

comment on function public.conferir_ordem_da_jornada() is
  'Gatilho de restricao conferir_ordem_da_jornada de funnel_stage_def (onda 3, D6 = A): recusa (P0001, hint ordem_de_sistema, a mesma recusa da RPC reordenar_etapa_da_jornada) a clinica cuja cadeia Novo < Aguardando resposta < Em contato < Agendou < Compareceu ficou fora de ordem ou empatada pela posicao, venha da RPC, do PostgREST, da service role ou de migration.';

-- DEFERRABLE INITIALLY IMMEDIATE: confere no fim de cada comando; a RPC de
-- reordenar adia para o fim da transacao (SET CONSTRAINTS ... DEFERRED).
create constraint trigger conferir_ordem_da_jornada
  after insert or update of posicao, papel, clinic_id on public.funnel_stage_def
  deferrable initially immediate
  for each row
  execute function public.conferir_ordem_da_jornada();

comment on trigger conferir_ordem_da_jornada on public.funnel_stage_def is
  'Onda 3, D6 = A: a ordem entre Novo, Aguardando resposta, Em contato, Agendou e Compareceu (pela posicao, sem empate) e invariante do banco. Confere no fim de cada comando; quem renumera em mais de um comando (a RPC reordenar_etapa_da_jornada) adia com SET CONSTRAINTS public.conferir_ordem_da_jornada DEFERRED.';

-- ---------------------------------------------------------------------------
-- 6) Conferencia: recusa a migration inteira se a jornada nao ficou como o
-- codigo espera.
-- ---------------------------------------------------------------------------

do $conferencia$
declare
  v_n integer;
begin
  select count(*) into v_n
    from public.clinic c
   where (select count(*)
            from public.funnel_stage_def d
           where d.clinic_id = c.id
             and d.papel in ('entrada', 'aguardando', 'em_contato',
                             'agendou', 'compareceu', 'perdido')) <> 6;
  if v_n > 0 then
    raise exception using errcode = 'P0001',
      message = format('jornada_incompleta: %s clinica(s) sem as seis etapas de sistema', v_n);
  end if;

  select count(*) into v_n
    from (select d.clinic_id, d.posicao
            from public.funnel_stage_def d
           group by 1, 2
          having count(*) > 1) x;
  if v_n > 0 then
    raise exception using errcode = 'P0001',
      message = format('jornada_com_empate: %s posicao(oes) repetida(s)', v_n);
  end if;

  select count(*) into v_n
    from public.funnel_stage_def a
    join public.funnel_stage_def e
      on e.clinic_id = a.clinic_id
     and e.papel = 'em_contato'
   where a.papel = 'aguardando'
     and (a.posicao >= e.posicao
          or exists (
            select 1 from public.funnel_stage_def x
             where x.clinic_id = a.clinic_id
               and x.posicao > a.posicao
               and x.posicao < e.posicao
          ));
  if v_n > 0 then
    raise exception using errcode = 'P0001',
      message = format('jornada_fora_de_ordem: %s clinica(s) sem Aguardando resposta logo antes de Em contato', v_n);
  end if;

  -- A cadeia inteira (revisao de 21/10/2026): a renumeracao acima preserva a
  -- ordem de hoje, entao a clinica que chegou aqui com Novo depois de Em
  -- contato, ou Em contato depois de Agendou, sairia com a cadeia invertida
  -- e a D6 a congelaria assim (o lead novo nunca mais iria para Aguardando
  -- resposta nem para Em contato; quem esta nelas nao iria para Agendou ao
  -- marcar consulta). A migration para e o dono decide a ordem dessa
  -- clinica antes de aplicar de novo.
  select count(distinct cadeia.clinic_id) into v_n
    from (
      select d.clinic_id,
             d.posicao,
             lead(d.posicao) over (
               partition by d.clinic_id
               order by array_position(
                 array['entrada', 'aguardando', 'em_contato', 'agendou', 'compareceu'],
                 d.papel)
             ) as proxima
        from public.funnel_stage_def d
       where d.papel in ('entrada', 'aguardando', 'em_contato', 'agendou', 'compareceu')
    ) cadeia
   where cadeia.proxima is not null
     and cadeia.posicao >= cadeia.proxima;
  if v_n > 0 then
    raise exception using errcode = 'P0001',
      message = format('jornada_fora_de_ordem: %s clinica(s) com Novo, Aguardando resposta, Em contato, Agendou e Compareceu fora de ordem', v_n);
  end if;

  select count(*) into v_n
    from public.cadence k
    join public.funnel_stage_def d
      on d.clinic_id = k.clinic_id
     and d.chave = k.trigger_stage
   where k.kind = 'followup'
     and d.papel = 'aguardando';
  if v_n > 0 then
    raise exception using errcode = 'P0001',
      message = format('followup_em_aguardando: %s regua(s) de follow-up em Aguardando resposta', v_n);
  end if;
end;
$conferencia$;
