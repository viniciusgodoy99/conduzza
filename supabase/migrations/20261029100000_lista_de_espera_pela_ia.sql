-- ---------------------------------------------------------------------------
-- A IA coloca o paciente na lista de espera (AG5, parte de banco): o pedido
-- e a entrada pela conversa, em duas fases, a regra da oferta para a
-- entrada da IA, a mensagem tratada pelo sistema e o CHECK das lidas
-- ---------------------------------------------------------------------------
-- Pedido do dono em 26/10/2026: a IA faz todo o atendimento e o agendamento.
-- D-11: a IA poe na lista de espera; encaixe nunca pela IA. Ate aqui (AG4,
-- 20261028100000) a lista de espera e so da equipe. Esta migration e o BANCO
-- da etapa AG5; o codigo do agente (lib/agente), a reoferta em TypeScript
-- (lib/domain/lista-espera.ts e lib/jobs/lista-espera.ts) e as telas vem em
-- outras frentes, lendo este contrato.
--
-- DECISOES DO DONO QUE VALEM: D-11, D-2, D-8, D-13, D-25, D-30 e D-31 (os
-- padroes da AG4). DECISOES AINDA PENDENTES, construidas com a recomendacao
-- (cada uma e uma constante nomeada; trocar e uma migration pequena com o
-- mesmo corpo e outro valor):
--   D-36 a habilidade lista_de_espera so vale com Agendar valendo
--        (c_exige_agendar em lista_de_espera_da_ia_ligada);
--   D-37 a entrada da IA guarda o pagamento e so vale para o vinculo que a
--        IA marca, na oferta e no aceite (c_regra_da_entrada_da_ia em
--        aceitar_oferta_de_espera; o espelho e REGRA_DA_ENTRADA_DA_IA em
--        lib/domain/lista-espera.ts: trocar e trocar nos dois);
--   D-38 com mais de uma unidade ativa, a lista pela IA passa para a equipe
--        (c_maximo_de_unidades em conferir_pedido_de_espera_da_ia);
--   D-41 quem ja tem consulta futura do mesmo procedimento nao entra pela IA
--        (c_ja_tem_consulta_barra, idem);
--   D-43 a pergunta vale 60 minutos (c_validade_da_pergunta em
--        entrar_na_lista_de_espera_pela_ia; a mesma de c_validade_do_pedido
--        da AG4, a confirmar junto);
--   D-44 menor de idade e consulta para outra pessoa passam para a equipe
--        (c_d8_na_lista em conferir_pedido_de_espera_da_ia).
-- D-39 (a oferta depois: so o interceptador aceita ou recusa) usa
-- marcar_mensagem_tratada_pelo_sistema; D-40, D-42, D-45 e D-46 sao do
-- codigo e das telas.
--
-- O QUE MUDA:
--   1. ai_turno ganha o CHECK ai_turno_lidas_sem_nulo (nenhum nulo dentro de
--      mensagens_lidas). Com um nulo, "not (id = any (lidas))" vira nulo e a
--      conferencia da mensagem nova (R12 da AG4, nesta e na AG4) falharia
--      aberta. Producao em 27/10/2026: 3 linhas, nenhuma com nulo nem com
--      mais de uma dimensao. CHECK validado na hora (NOT VALID e VALIDATE
--      nao ajudam numa transacao so: o ADD pega ACCESS EXCLUSIVE do mesmo
--      jeito, e a varredura das 3 linhas e de microssegundos).
--   2. waitlist ganha origem ('equipe' por padrao, ou 'ia'), ia_job_id (o
--      job da IA que criou a entrada, unico: a idempotencia da fase 2),
--      conversation_id (a conversa da IA, sem FK: tabela quente),
--      insurance_id (FK para insurance, sem cascata) e particular (o
--      pagamento declarado; nulo = nao declarado, a regra de antes), com
--      CHECKs. As linhas que existem viram origem 'equipe', sem pagamento:
--      leem a regra de hoje. O gatilho exigir_entrada_da_ia: convenio de
--      outra clinica e 23503 (para qualquer um); a sessao nunca grava origem
--      'ia', ia_job_id nem conversation_id (42501
--      entrada_da_ia_so_pelo_servidor) e nunca muda as cinco colunas de uma
--      entrada da IA (23514 entrada_da_ia_nao_muda). "Remover" (active) e o
--      reordenar (priority) nao disparam.
--   3. ia_pedido_de_espera (tabela nova, fria): o pedido da fase 1, um vivo
--      por conversa, ancorado pelo job que pediu (e escreveu a pergunta
--      T-E1). RLS ligada sem policy; so a service role le. Nunca texto do
--      paciente.
--   4. Funcoes internas (nenhum papel da API executa):
--      preferencia_da_espera_valida (o CHECK das preferencias do pedido),
--      descrever_preferencia_da_espera (o texto do evento),
--      lista_de_espera_da_ia_ligada (a habilidade na versao em uso),
--      entrada_da_espera_no_grupo (a entrada ativa do mesmo grupo do indice
--      waitlist_ativa_unica) e conferir_pedido_de_espera_da_ia (as recusas
--      que as duas fases repetem).
--   5. pedir_lista_de_espera_pela_ia (fase 1, so service role): confere e
--      grava o pedido. Nada mais e gravado.
--   6. entrar_na_lista_de_espera_pela_ia (fase 2, so service role): confere
--      de novo, ancora o "sim" na pergunta escrita pelo job do pedido (a
--      ancora forte da AG4, com a citacao), cria a entrada (origem 'ia'),
--      consome o pedido e grava o evento no fio.
--   7. marcar_mensagem_tratada_pelo_sistema (so service role; D-39): a
--      mensagem do paciente que o interceptador tratou (SIM ou NAO QUERO da
--      oferta, o lembrete, o toque de confirmacao) vira lida por um turno
--      'enviado' sem saida (ai_turno sintetico): deixa de voltar como
--      pendente para a IA (lib/agente/historico.ts, idsRespondidos) e conta
--      como lida no R12 do banco.
--   8. aceitar_oferta_de_espera (CREATE OR REPLACE, mesma assinatura e
--      grants; D-37): o pagamento declarado na entrada e estrito; a entrada
--      da IA so com o vinculo que a IA marca (vinculo e procedimento com "IA
--      pode agendar", convenio do vinculo ativo) e e lida mesmo inativa (a
--      regra dela vale ate o fim). Entrada sem pagamento declarado e sem
--      origem 'ia' (todas as de hoje): EXATAMENTE o corpo de antes (paridade
--      provada no ensaio).
--   9. podar_agendamento_da_ia (CREATE OR REPLACE): poda tambem o pedido sem
--      consumo com 7 dias (ou da conversa que sumiu) e o consumido com 30
--      dias; devolve tambem pedidos_de_espera.
--
-- AS RECUSAS (o contrato para o motor; os COMMENT ON abaixo repetem):
--   fase 1, pedir: 22004 (nulo fora de profissional e convenio) -> (trava
--     da conversa) -> 22023 job_invalido -> idempotencia (reutilizado, ou
--     22023 job_de_outro_pedido) -> 22023 preferencia_invalida,
--     pagamento_invalido, cadastro_invalido -> ia_desligada ->
--     lista_de_espera_desligada -> mais_de_uma_unidade -> so_com_a_equipe ->
--     sem_autorizacao -> ja_na_lista -> consulta_para_outra_pessoa ->
--     menor_de_idade -> ja_tem_consulta -> grava.
--   fase 2, entrar: 22004 -> (trava da conversa) -> 22023 job_invalido ->
--     idempotencia (reutilizado, ou 22023 job_de_outra_conversa) ->
--     ia_desligada -> lista_de_espera_desligada -> sem_pedido_de_espera ->
--     (pedido travado) mais_de_uma_unidade -> so_com_a_equipe ->
--     sem_autorizacao -> ja_na_lista -> mensagem_nova_do_paciente ->
--     consulta_para_outra_pessoa -> menor_de_idade -> ja_tem_consulta ->
--     pedido_vencido -> sem_confirmacao_do_paciente -> (insert)
--     ja_na_lista -> grava. R13 da AG4: as estruturais antes da mensagem
--     nova; o que depende da pessoa depois. Antes da mensagem nova, so
--     travas e leituras.
--
-- A ANCORA DO "SIM" (a da AG4, R2, R12 e R13, com o job do pedido): a
-- pergunta e a mensagem da IA (que nao falhou, nem evento nem nota) escrita
-- pelo job do pedido (message.job_id = pedido.job_id), gravada depois do
-- pedido e antes da ultima mensagem do paciente; a ultima saida antes da
-- ultima mensagem do paciente (toda saida que nao e evento nem nota, de
-- qualquer autor e situacao de entrega) e ela, sem outra no mesmo instante
-- (empate conta como outra); nenhuma mensagem do paciente depois dela cita
-- (ou responde por botao a) outra mensagem (message.reply_to_message_id ou
-- reply_to_wa_message_id: a citacao de outra, ou de uma que nao e linha
-- nossa, e sem_confirmacao_do_paciente); a mensagem do paciente foi lida
-- por algum turno (R12: as lidas do job mais as dos turnos da conversa em
-- enviado ou passou_para_equipe e as de decidido de outro job; a lida e
-- apagada so pelas do job); a pergunta tem menos de 60 minutos.
--
-- Producao em 27/10/2026 (q.js, so leitura): a ultima migration aplicada e a
-- 20261027120000 (a AG4, 20261028100000, vai antes desta); waitlist e
-- waitlist_offer vazias; 3 linhas em ai_turno (nenhum nulo nas lidas);
-- nenhuma unidade; 2 convenios. Nenhuma linha muda de valor: as colunas
-- novas nascem com o padrao (origem 'equipe') ou nulas.
--
-- TRAVAS (medidas no Postgres local: pg_locks da transacao depois da
-- migration). TODAS no comeco, no bloco 0, antes de qualquer mudanca, numa
-- ordem fixa: waitlist e ai_turno em ACCESS EXCLUSIVE (os ALTER, o indice,
-- o gatilho, a FK da tabela nova para a fila), insurance e clinic em SHARE
-- ROW EXCLUSIVE (as FKs novas para elas). Cada tentativa pede as quatro com
-- NOWAIT; com uma ocupada, solta as que pegou (o savepoint do bloco),
-- espera 100 ms SEM trava nenhuma e tenta de novo, ate 30 vezes (uns 3 s);
-- depois falha inteira com 55P03, nada gravado: rodar de novo. Nunca espera
-- trava com outra na mao e nao fecha ciclo (40P01) com sessao nenhuma.
-- Depois do bloco, so pede travas que ja tem (ou mais fracas) e nunca
-- espera; o lock_timeout de 3 s fica de rede. As funcoes sao plpgsql (o
-- corpo nao e validado contra as tabelas no CREATE: nenhuma trava nelas),
-- menos as duas puras em SQL, que nao leem tabela.
-- Nesse tempo: a Tela 10, o dialogo de cancelar da Agenda (que le a fila) e
-- o job da reoferta esperam a waitlist; o turno da IA espera ai_turno
-- (gravar o turno e ler o historico); a gravacao de convenio e a de dados da
-- clinica esperam; a LEITURA de clinic e de insurance segue (SHARE ROW
-- EXCLUSIVE nao barra leitura nem FK de outras tabelas). Nenhuma trava em
-- message, conversation, contact, appointment, job_queue, ai_agent_config,
-- ai_decision_log, ia_atendimento, waitlist_offer nem audit_log. Horario
-- calmo.
--
-- ORDEM DE PUBLICACAO: a AG4 (20261028100000) aplicada e publicada antes;
-- esta migration; os tipos (lib/supabase/database.types.ts foi escrito a mao
-- no formato do gerador; regenerar depois de aplicar) e SO DEPOIS o codigo
-- da AG5 (as tres frentes juntas). Esta migration com o codigo de hoje:
-- nada muda (insert da recepcao cai no padrao 'equipe'; a tela, o dialogo e
-- o job leem colunas explicitas; o aceite novo e identico para entrada sem
-- origem 'ia' e sem pagamento; as RPCs e a tabela novas nao tem quem
-- chame; a poda devolve uma chave a mais, que ninguem le; o motor de hoje
-- nunca grava nulo nas lidas). O codigo da AG5 antes desta migration: a
-- Tela 10 e o job da reoferta leem colunas que nao existem (42703: a tela
-- cai no erro, o job tenta de novo e a reoferta para). A migration vai
-- primeiro.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo da AG5 e desativar as
-- entradas da IA cujo pagamento a regra de antes nao reproduz (o rollback
-- se recusa com uma ativa; ou desativar todas as da IA, avisando a
-- clinica); DEPOIS, numa transacao, no SQL editor,
-- supabase/operacao/rollback/20261029100000-corpos-anteriores.sql (os dois
-- corpos de antes, com os comentarios; as funcoes, o gatilho, a tabela, os
-- indices, os CHECKs e as colunas novas saem; confere no fim). SE PERDE: a
-- origem, o job, a conversa e o pagamento das entradas (elas ficam, como
-- entradas comuns) e os pedidos. Os eventos da conversa ficam.
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 0) As travas, todas aqui, antes de qualquer mudanca (cabecalho, TRAVAS)
-- ---------------------------------------------------------------------------
-- Ordem fixa, cada tabela ja no modo mais forte que a migration pede nela.
-- NOWAIT: tabela ocupada solta o que esta tentativa pegou (o savepoint do
-- bloco) e espera 100 ms sem trava nenhuma; 30 tentativas, depois 55P03 e
-- nada gravado. Nunca espera com trava na mao: nao fecha ciclo com sessao.

do $travas$
declare
  v_tentativas integer := 0;
begin
  loop
    begin
      lock table public.waitlist, public.ai_turno in access exclusive mode nowait;
      lock table public.insurance, public.clinic in share row exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 30 then
        raise exception using errcode = 'lock_not_available',
          message = 'Migration 20261029100000: waitlist, ai_turno, insurance ou clinic seguiu ocupada por 3 s. Nada foi gravado: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- ---------------------------------------------------------------------------
-- 1) ai_turno: nenhum nulo dentro das mensagens lidas
-- ---------------------------------------------------------------------------

-- array_position com nulo procura por IS NOT DISTINCT FROM: acha o nulo. Lista
-- de mais de uma dimensao faz o CHECK falhar com erro (nada grava).
alter table public.ai_turno
  add constraint ai_turno_lidas_sem_nulo check (array_position(mensagens_lidas, null) is null);

comment on constraint ai_turno_lidas_sem_nulo on public.ai_turno is
  'AG5: nenhum nulo dentro de mensagens_lidas. Com um nulo, a conferencia da mensagem nova (not (id = any (lidas)), R12 da AG4) daria nulo e falharia aberta.';

-- ---------------------------------------------------------------------------
-- 2) waitlist: a origem, o job, a conversa e o pagamento
-- ---------------------------------------------------------------------------

alter table public.waitlist
  add column origem text not null default 'equipe',
  add column ia_job_id uuid,
  add column conversation_id uuid,
  add column insurance_id uuid
    constraint waitlist_insurance_id_fkey references public.insurance (id),
  add column particular boolean,
  add constraint waitlist_origem_valida check (origem in ('equipe', 'ia')),
  add constraint waitlist_ia_job_coerente check ((origem = 'ia') = (ia_job_id is not null)),
  add constraint waitlist_conversa_so_da_ia check (conversation_id is null or origem = 'ia'),
  add constraint waitlist_pagamento_coerente check (
    (particular is null and insurance_id is null)
    or (particular is not null and particular = (insurance_id is null))),
  add constraint waitlist_entrada_da_ia_completa check (
    origem <> 'ia'
    or (conversation_id is not null and particular is not null and procedure_id is not null));

-- A idempotencia da fase 2: uma entrada por job da IA.
create unique index waitlist_ia_job_id_unico
  on public.waitlist (ia_job_id)
  where ia_job_id is not null;

-- A FK do convenio (apagar o convenio confere aqui).
create index waitlist_insurance_id_idx
  on public.waitlist (insurance_id)
  where insurance_id is not null;

comment on column public.waitlist.origem is
  'Quem criou a entrada (AG5): equipe (a recepcao, padrao; todas as de antes) ou ia (entrar_na_lista_de_espera_pela_ia, pela conversa). So o servidor grava ia (gatilho exigir_entrada_da_ia).';
comment on column public.waitlist.ia_job_id is
  'O job responder_com_ia que criou a entrada da IA (unico; a idempotencia da fase 2). Igual ao job_id da decisao em ai_decision_log. Nulo nas da equipe. Sem FK: a fila e podada.';
comment on column public.waitlist.conversation_id is
  'A conversa em que a IA criou a entrada (a Tela 10 abre a conversa). So na entrada da IA. Sem FK (tabela quente).';
comment on column public.waitlist.insurance_id is
  'O convenio declarado na entrada (AG5, D-37): a oferta e o aceite usam SO o vinculo deste convenio. Nulo com particular nulo: nao declarado (a regra de antes: o convenio do contato, senao o particular). Convenio de outra clinica: 23503.';
comment on column public.waitlist.particular is
  'O pagamento declarado na entrada (AG5, D-37): true, so o vinculo particular; false, so o do convenio de insurance_id; nulo, nao declarado (a regra de antes). A entrada da IA sempre declara.';

-- ---------------------------------------------------------------------------
-- 3) O gatilho da entrada da IA
-- ---------------------------------------------------------------------------

create function public.exigir_entrada_da_ia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- O convenio declarado e da clinica da entrada (para qualquer um que
  -- grava: a FK so confere existencia e ignora a RLS).
  if new.insurance_id is not null and not exists (
    select 1
      from public.insurance i
     where i.id = new.insurance_id
       and i.clinic_id = new.clinic_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'O convênio da entrada não é desta clínica.';
  end if;
  -- O servidor (sem sessao: a service role, o SQL editor) grava o resto.
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.origem is distinct from 'equipe' or new.ia_job_id is not null or new.conversation_id is not null then
      raise exception using errcode = '42501', message = 'entrada_da_ia_so_pelo_servidor',
        hint = 'Só o assistente cria a entrada pela conversa.';
    end if;
    return new;
  end if;
  -- A entrada da IA nao muda pela sessao (a recepcao remove, nunca edita o
  -- que a pessoa pediu ao assistente).
  if old.origem = 'ia'
     and (new.origem, new.ia_job_id, new.conversation_id, new.insurance_id, new.particular)
         is distinct from (old.origem, old.ia_job_id, old.conversation_id, old.insurance_id, old.particular)
  then
    raise exception using errcode = '23514', message = 'entrada_da_ia_nao_muda',
      hint = 'A entrada que o assistente criou não muda: remova e adicione de novo, se for o caso.';
  end if;
  if new.origem is distinct from old.origem
     or new.ia_job_id is distinct from old.ia_job_id
     or new.conversation_id is distinct from old.conversation_id
  then
    raise exception using errcode = '42501', message = 'entrada_da_ia_so_pelo_servidor',
      hint = 'Só o assistente cria a entrada pela conversa.';
  end if;
  return new;
end;
$$;

revoke all on function public.exigir_entrada_da_ia()
  from public, anon, authenticated, service_role;

comment on function public.exigir_entrada_da_ia() is
  'Gatilho BEFORE INSERT OR UPDATE OF origem, ia_job_id, conversation_id, insurance_id, particular, clinic_id de waitlist (AG5): o convenio declarado e da clinica da entrada (23503, para qualquer um); a sessao (auth.uid() nao nulo) nunca grava origem ia, ia_job_id nem conversation_id (42501 entrada_da_ia_so_pelo_servidor) e nunca muda as cinco colunas de uma entrada da IA (23514 entrada_da_ia_nao_muda). Remover (active) e reordenar (priority) nao disparam. Ninguem executa direto.';

create trigger exigir_entrada_da_ia
  before insert or update of origem, ia_job_id, conversation_id, insurance_id, particular, clinic_id
  on public.waitlist
  for each row execute function public.exigir_entrada_da_ia();

-- ---------------------------------------------------------------------------
-- 4) ia_pedido_de_espera: o pedido da fase 1
-- ---------------------------------------------------------------------------

-- 4a. O CHECK das preferencias (pura, sem tabela): sem nulo, sem repetir, so
-- os valores da lista, em ordem (manha, tarde, noite; 0 = domingo a 6 =
-- sabado, a convencao de waitlist), e nunca todos (todos = qualquer = vazio).
create function public.preferencia_da_espera_valida(p_turnos text[], p_dias smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_turnos is not null
     and p_dias is not null
     and cardinality(p_turnos) < 3
     and cardinality(p_dias) < 7
     and p_turnos = coalesce((
           select array_agg(d.t order by d.ordem)
             from unnest(array['manha', 'tarde', 'noite']::text[]) with ordinality as d(t, ordem)
            where d.t = any (p_turnos)), '{}'::text[])
     and p_dias = coalesce((
           select array_agg(d.dia::smallint order by d.dia)
             from generate_series(0, 6) as d(dia)
            where d.dia::smallint = any (p_dias)), '{}'::smallint[])
$$;

revoke execute on function public.preferencia_da_espera_valida(text[], smallint[])
  from public, anon, authenticated, service_role;

comment on function public.preferencia_da_espera_valida(text[], smallint[]) is
  'Interna (o CHECK de ia_pedido_de_espera; nenhum papel da API executa): a preferencia normalizada do pedido da lista de espera. Periodos: subconjunto de manha, tarde, noite, nessa ordem, sem repetir, menos de 3. Dias: subconjunto de 0 (domingo) a 6 (sabado), em ordem crescente, sem repetir, menos de 7. Vazio = qualquer. Nulo dentro, nulo e lista de mais de uma dimensao: falso.';

create table public.ia_pedido_de_espera (
  id uuid not null default gen_random_uuid(),
  clinic_id uuid not null,
  -- Sem FK para conversation e contact (tabelas quentes): as RPCs conferem;
  -- a poda tira o orfao.
  conversation_id uuid not null,
  contact_id uuid not null,
  -- A janela da IA (ia_janela_da_conversa.desde) em que o pedido vale: o
  -- Devolver abre janela nova, e o pedido de antes nao vale nela.
  janela_desde timestamptz not null,
  -- O job que pediu (e escreveu a pergunta T-E1). Sem FK: a fila e podada.
  job_id uuid not null,
  -- O pedido, do ESTADO do atendimento (a ultima busca), nunca do texto do
  -- modelo. Sem FK (as RPCs conferem a clinica).
  procedure_id uuid not null,
  professional_id uuid,
  insurance_id uuid,
  particular boolean not null,
  preferred_shifts text[] not null default '{}',
  preferred_weekdays smallint[] not null default '{}',
  created_at timestamptz not null default now(),
  -- O consumo pela fase 2: quando, a entrada e o job que a criou.
  consumido_em timestamptz,
  waitlist_id uuid,
  job_id_da_entrada uuid,
  constraint ia_pedido_de_espera_pkey primary key (id),
  constraint ia_pedido_de_espera_clinic_id_fkey
    foreign key (clinic_id) references public.clinic (id) on delete cascade,
  constraint ia_pedido_de_espera_waitlist_id_fkey
    foreign key (waitlist_id) references public.waitlist (id) on delete set null,
  constraint ia_pedido_de_espera_job_id_key unique (job_id),
  constraint ia_pedido_de_espera_pagamento_coerente check (particular = (insurance_id is null)),
  constraint ia_pedido_de_espera_preferencia_valida check (
    public.preferencia_da_espera_valida(preferred_shifts, preferred_weekdays)),
  constraint ia_pedido_de_espera_consumo_coerente check (
    (consumido_em is null and waitlist_id is null and job_id_da_entrada is null)
    or (consumido_em is not null and job_id_da_entrada is not null))
);

-- Um pedido vivo por conversa (a fase 1 apaga o anterior antes de gravar).
create unique index ia_pedido_de_espera_um_vivo
  on public.ia_pedido_de_espera (conversation_id)
  where consumido_em is null;
-- A leitura do motor (o pedido e a entrada desta conversa na janela).
create index ia_pedido_de_espera_conversa_idx
  on public.ia_pedido_de_espera (conversation_id, janela_desde);
create index ia_pedido_de_espera_clinic_id_idx
  on public.ia_pedido_de_espera (clinic_id);
-- A FK da entrada (apagar a entrada confere aqui).
create index ia_pedido_de_espera_waitlist_id_idx
  on public.ia_pedido_de_espera (waitlist_id)
  where waitlist_id is not null;

-- RLS ligada, sem policy: nenhuma sessao le nem grava. A service role so le
-- (a escrita e so pelas duas RPCs e pela poda).
alter table public.ia_pedido_de_espera enable row level security;
revoke all on table public.ia_pedido_de_espera from anon, authenticated, service_role;
grant select on table public.ia_pedido_de_espera to service_role;

comment on table public.ia_pedido_de_espera is
  'O pedido de entrada na lista de espera pela IA (AG5, migration 20261029100000_lista_de_espera_pela_ia.sql): a fase 1 (pedir_lista_de_espera_pela_ia) grava, um vivo por conversa, com o job que pediu e escreveu a pergunta T-E1; a fase 2 (entrar_na_lista_de_espera_pela_ia) consome, ligando a entrada e o job dela. Procedimento, profissional (nulo = qualquer) e pagamento do ESTADO do atendimento; os periodos e os dias normalizados (vazio = qualquer). So vale na janela atual da IA (janela_desde). Nunca texto do paciente: so ids, listas fechadas e instantes. Podado pela manutencao (podar_agendamento_da_ia): o vivo com 7 dias ou da conversa que sumiu, o consumido com 30 dias. Nenhuma sessao le; a service role so le.';
comment on column public.ia_pedido_de_espera.job_id is
  'O job responder_com_ia que pediu (unico; a idempotencia da fase 1) e que escreveu a pergunta: a ancora do "sim" e a mensagem com message.job_id igual a este.';
comment on column public.ia_pedido_de_espera.janela_desde is
  'A janela da IA na conversa (ia_janela_da_conversa.desde) em que o pedido foi feito. So vale o da janela atual.';
comment on column public.ia_pedido_de_espera.preferred_weekdays is
  '0 = domingo a 6 = sabado (a convencao de waitlist), em ordem, sem repetir; vazio = qualquer dia (os sete viram vazio).';
comment on column public.ia_pedido_de_espera.consumido_em is
  'Quando a fase 2 criou a entrada (waitlist_id) pelo job job_id_da_entrada. Nulo: o pedido vivo.';

-- ---------------------------------------------------------------------------
-- 5) As funcoes internas
-- ---------------------------------------------------------------------------

-- 5a. O texto da preferencia, para o evento no fio (pura).
create function public.descrever_preferencia_da_espera(p_turnos text[], p_dias smallint[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_turnos text[];
  v_dias text[];
  v_texto_turnos text;
  v_texto_dias text;
begin
  select coalesce(array_agg(case t when 'manha' then 'manhã' else t end order by o), '{}'::text[])
    into v_turnos
    from unnest(coalesce(p_turnos, '{}'::text[])) with ordinality as x(t, o);
  select coalesce(array_agg((array['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'])[d + 1]
                            order by o), '{}'::text[])
    into v_dias
    from unnest(coalesce(p_dias, '{}'::smallint[])) with ordinality as x(d, o);
  v_texto_turnos := case cardinality(v_turnos)
    when 0 then 'qualquer período'
    when 1 then v_turnos[1]
    else array_to_string(v_turnos[1:cardinality(v_turnos) - 1], ', ') || ' e ' || v_turnos[cardinality(v_turnos)]
  end;
  v_texto_dias := case cardinality(v_dias)
    when 0 then 'qualquer dia'
    when 1 then v_dias[1]
    else array_to_string(v_dias[1:cardinality(v_dias) - 1], ', ') || ' e ' || v_dias[cardinality(v_dias)]
  end;
  return v_texto_turnos || '; ' || v_texto_dias;
end;
$$;

revoke execute on function public.descrever_preferencia_da_espera(text[], smallint[])
  from public, anon, authenticated, service_role;

comment on function public.descrever_preferencia_da_espera(text[], smallint[]) is
  'Interna (nenhum papel da API executa): a preferencia em texto, para o evento da entrada pela IA: "manhã; segunda e quarta", "manhã e tarde; qualquer dia", "qualquer período; segunda, terça e quarta". Na ordem das listas.';

-- 5b. A habilidade na versao em uso (D-36).
create function public.lista_de_espera_da_ia_ligada(p_clinic_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  -- D-36 (DECISAO DO DONO A CONFIRMAR, cabecalho): a lista pela IA so vale
  -- com Agendar valendo (skills.agendar, antecedencia e horizonte). false
  -- aqui: so a chave lista_de_espera.
  c_exige_agendar constant boolean := true;
  v_config record;
begin
  -- A versao em uso e a ultima publicada (a que o agente le no WhatsApp).
  select a.skills, a.agenda_antecedencia_horas, a.agenda_horizonte_dias
    into v_config
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if not found or (v_config.skills ->> 'lista_de_espera') is distinct from 'true' then
    return false;
  end if;
  if c_exige_agendar
     and ((v_config.skills ->> 'agendar') is distinct from 'true'
          or v_config.agenda_antecedencia_horas is null
          or v_config.agenda_horizonte_dias is null)
  then
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function public.lista_de_espera_da_ia_ligada(uuid)
  from public, anon, authenticated, service_role;

comment on function public.lista_de_espera_da_ia_ligada(uuid) is
  'Interna (nenhum papel da API executa): a habilidade lista_de_espera ligada na ULTIMA versao publicada do agente (skills ->> ''lista_de_espera'' = ''true'') e, enquanto c_exige_agendar (D-36, a confirmar), Agendar valendo nela (skills.agendar, agenda_antecedencia_horas e agenda_horizonte_dias preenchidos). Sem versao publicada: falso.';

-- 5c. A entrada ativa do contato no mesmo grupo do indice waitlist_ativa_unica
-- (procedimento e profissional, nulo casando nulo), para o ja_na_lista.
create function public.entrada_da_espera_no_grupo(
  p_clinic_id uuid,
  p_contato uuid,
  p_procedure_id uuid,
  p_professional_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entrada record;
begin
  select pf.name as profissional, w.preferred_shifts, w.preferred_weekdays
    into v_entrada
    from public.waitlist w
    left join public.professional pf on pf.id = w.professional_id and pf.clinic_id = w.clinic_id
   where w.clinic_id = p_clinic_id
     and w.contact_id = p_contato
     and w.active
     and coalesce(w.procedure_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_procedure_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(w.professional_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_professional_id, '00000000-0000-0000-0000-000000000000'::uuid)
   order by w.created_at, w.id
   limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'profissional', v_entrada.profissional,
    'turnos', to_jsonb(v_entrada.preferred_shifts),
    'dias', to_jsonb(v_entrada.preferred_weekdays));
end;
$$;

revoke execute on function public.entrada_da_espera_no_grupo(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.entrada_da_espera_no_grupo(uuid, uuid, uuid, uuid) is
  'Interna (nenhum papel da API executa): a entrada ATIVA do contato no mesmo grupo do indice waitlist_ativa_unica (procedimento e profissional, nulo casando nulo), de qualquer origem: {profissional (nome; nulo = qualquer), turnos, dias} ou nulo.';

-- 5d. As conferencias que as duas fases repetem, na ordem do contrato.
create function public.conferir_pedido_de_espera_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_janela_desde timestamptz,
  p_contato uuid,
  p_procedure_id uuid,
  p_professional_id uuid,
  p_insurance_id uuid,
  out o_motivo text,
  out o_motivo_da_pessoa text,
  out o_procedimento text,
  out o_profissional text,
  out o_convenio text,
  out o_plano text,
  out o_fuso text,
  out o_entrada jsonb,
  out o_consulta uuid,
  out o_consulta_inicio timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  -- D-38 (DECISAO DO DONO A CONFIRMAR, cabecalho): a fila e a oferta nao
  -- tem unidade; com mais unidades ativas que isto, a lista pela IA passa
  -- para a equipe.
  c_maximo_de_unidades constant integer := 1;
  -- D-44 (a confirmar): menor de idade e consulta para outra pessoa passam
  -- para a equipe (D-8), como na marcacao.
  c_d8_na_lista constant boolean := true;
  c_idade_minima constant integer := 18;
  -- D-41 (a confirmar): quem ja tem consulta futura do mesmo procedimento
  -- nao entra pela IA (o SIM da oferta criaria outra consulta sem cancelar a
  -- primeira).
  c_ja_tem_consulta_barra constant boolean := true;
  v_para_o_titular boolean;
  v_nascimento_informado date;
  v_nascimento_no_cadastro date;
  v_hoje date;
begin
  if p_clinic_id is null or p_contato is null or p_procedure_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- O fuso e os nomes (sempre: as respostas e o evento usam).
  select coalesce(c.timezone, 'America/Fortaleza') into o_fuso
    from public.clinic c
   where c.id = p_clinic_id;
  o_fuso := coalesce(o_fuso, 'America/Fortaleza');
  select pr.name into o_procedimento
    from public.procedure pr
   where pr.id = p_procedure_id
     and pr.clinic_id = p_clinic_id;
  if p_professional_id is not null then
    select pf.name into o_profissional
      from public.professional pf
     where pf.id = p_professional_id
       and pf.clinic_id = p_clinic_id;
  end if;
  if p_insurance_id is not null then
    select i.name, i.plan_name into o_convenio, o_plano
      from public.insurance i
     where i.id = p_insurance_id
       and i.clinic_id = p_clinic_id;
  end if;

  -- 1. D-38: mais de uma unidade ativa (a lista nao guarda a unidade).
  if (select count(*) from public.unit u where u.clinic_id = p_clinic_id and u.active)
     > c_maximo_de_unidades
  then
    o_motivo := 'mais_de_uma_unidade';
    return;
  end if;

  -- 2. So com a equipe: o procedimento que a IA nao agenda (ou inativo, ou
  -- que nao existe mais), o convenio inativo (ou que nao existe mais), ou
  -- nenhum vinculo que a IA marca do procedimento, do pagamento e do
  -- profissional pedido (ou de algum profissional ativo, com "qualquer").
  if not exists (
       select 1 from public.procedure pr
        where pr.id = p_procedure_id
          and pr.clinic_id = p_clinic_id
          and pr.active
          and pr.bookable_by_ai)
     or (p_insurance_id is not null and not exists (
       select 1 from public.insurance i
        where i.id = p_insurance_id
          and i.clinic_id = p_clinic_id
          and i.active))
     or not exists (
       select 1
         from public.service_link sl
         join public.professional pf on pf.id = sl.professional_id and pf.clinic_id = sl.clinic_id
        where sl.clinic_id = p_clinic_id
          and sl.procedure_id = p_procedure_id
          and sl.insurance_id is not distinct from p_insurance_id
          and sl.active
          and sl.bookable_by_ai
          and pf.active
          and (p_professional_id is null or sl.professional_id = p_professional_id))
  then
    o_motivo := 'so_com_a_equipe';
    return;
  end if;

  -- 3. A autorizacao para receber mensagens (a oferta chega por aqui; a IA
  -- nunca promete mensagem que nao sai).
  if not coalesce(public.consentimento_vigente(p_clinic_id, p_contato, 'whatsapp'), false) then
    o_motivo := 'sem_autorizacao';
    return;
  end if;

  -- 4. Ja esta na lista no mesmo grupo (de qualquer origem).
  o_entrada := public.entrada_da_espera_no_grupo(p_clinic_id, p_contato, p_procedure_id, p_professional_id);
  if o_entrada is not null then
    o_motivo := 'ja_na_lista';
    return;
  end if;

  -- 5. O que depende da pessoa, nesta ordem (quem chama decide quando
  -- responde: na fase 2, depois da mensagem nova).
  if c_d8_na_lista then
    -- (a) D-8: a marca de outra pessoa nos dados informados da janela atual.
    select d.para_o_titular, d.data_nascimento into v_para_o_titular, v_nascimento_informado
      from public.dados_informados_na_marcacao d
     where d.clinic_id = p_clinic_id
       and d.conversation_id = p_conversation_id
       and d.appointment_id is null
       and d.contact_id = p_contato
       and d.janela_desde = p_janela_desde;
    if v_para_o_titular is not distinct from false then
      o_motivo_da_pessoa := 'consulta_para_outra_pessoa';
      return;
    end if;
    -- (b) D-8: menor de 18 anos hoje, no fuso da clinica, pelo nascimento
    -- informado na janela ou pelo do cadastro (basta um dos dois).
    select k.birth_date into v_nascimento_no_cadastro
      from public.contact k
     where k.id = p_contato
       and k.clinic_id = p_clinic_id;
    v_hoje := (now() at time zone o_fuso)::date;
    if exists (
      select 1
        from unnest(array[v_nascimento_informado, v_nascimento_no_cadastro]) as n(nascimento)
       where n.nascimento > (v_hoje - make_interval(years => c_idade_minima))::date
    ) then
      o_motivo_da_pessoa := 'menor_de_idade';
      return;
    end if;
  end if;

  -- (c) D-41: a consulta futura ativa do contato, do mesmo procedimento, com
  -- qualquer profissional (o predicado do ja_tem_consulta da AG3: nao
  -- cancelada, nao recusada, nem faltou nem compareceu; a pendente da IA
  -- conta). A mais proxima.
  if c_ja_tem_consulta_barra then
    select a.id, a.starts_at into o_consulta, o_consulta_inicio
      from public.appointment a
      join public.service_link sl on sl.id = a.service_link_id and sl.clinic_id = a.clinic_id
     where a.clinic_id = p_clinic_id
       and a.contact_id = p_contato
       and sl.procedure_id = p_procedure_id
       and a.starts_at > now()
       and a.status not in ('cancelado_paciente', 'cancelado_clinica', 'faltou', 'compareceu')
       and a.approval_status is distinct from 'recusado'
     order by a.starts_at, a.id
     limit 1;
    if o_consulta is not null then
      o_motivo_da_pessoa := 'ja_tem_consulta';
      return;
    end if;
  end if;
end;
$$;

revoke execute on function public.conferir_pedido_de_espera_da_ia(uuid, uuid, timestamptz, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.conferir_pedido_de_espera_da_ia(uuid, uuid, timestamptz, uuid, uuid, uuid, uuid) is
  'Interna (nenhum papel da API executa): as conferencias da lista de espera pela IA que as duas fases repetem (AG5). Sempre: o_fuso e os nomes (o_procedimento, o_profissional, o_convenio, o_plano; nulos quando o id e nulo ou nao e da clinica). o_motivo, as estruturais, nesta ordem: mais_de_uma_unidade (D-38: mais de c_maximo_de_unidades unidade ativa), so_com_a_equipe (procedimento inativo, sem IA pode agendar ou que nao existe; convenio inativo ou que nao existe; nenhum vinculo ativo com IA pode agendar do procedimento, do pagamento, nulo = particular, e do profissional pedido, ativo, ou de algum profissional ativo com profissional nulo), sem_autorizacao (consentimento_vigente do WhatsApp falso), ja_na_lista (entrada ativa do contato no mesmo grupo do indice waitlist_ativa_unica, de qualquer origem; o_entrada = {profissional, turnos, dias}). Sem o_motivo, o_motivo_da_pessoa, nesta ordem: consulta_para_outra_pessoa (os dados informados da janela p_janela_desde com para_o_titular falso), menor_de_idade (menos de 18 anos hoje, no fuso da clinica, pelo nascimento informado na janela ou pelo do cadastro), ja_tem_consulta (o_consulta e o_consulta_inicio: a consulta futura ativa do mesmo procedimento, a mais proxima). Os dois primeiros enquanto c_d8_na_lista (D-44) e o terceiro enquanto c_ja_tem_consulta_barra (D-41). Nao trava. Parametro nulo (clinica, contato ou procedimento): 22004.';

-- ---------------------------------------------------------------------------
-- 6) A fase 1: o pedido
-- ---------------------------------------------------------------------------

create function public.pedir_lista_de_espera_pela_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid,
  p_procedure_id uuid,
  p_professional_id uuid,
  p_insurance_id uuid,
  p_particular boolean,
  p_turnos text[],
  p_dias smallint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_criado_em timestamptz;
  v_desde timestamptz;
  v_contato_da_janela uuid;
  v_existente public.ia_pedido_de_espera%rowtype;
  v_preferencia_ok boolean := false;
  v_turnos text[];
  v_dias smallint[];
  v_conversa record;
  v_conf record;
  v_pedido public.ia_pedido_de_espera%rowtype;
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null or p_procedure_id is null
     or p_particular is null or p_turnos is null or p_dias is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- A trava da conversa, a mesma do reservar, do agendar, do cancelar e do
  -- registrar dados: um turno por vez mexe na agenda desta conversa. Depois
  -- dela, so o pedido. Ninguem trava o pedido e depois a conversa.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );

  -- O job e desta conversa e da janela atual (senao 22023, erro de quem
  -- chama). Sem janela, o ia_desligada responde abaixo.
  select j.created_at into v_job_criado_em
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.clinic_id = p_clinic_id
     and j.payload ->> 'conversation_id' = p_conversation_id::text;
  if not found then
    raise exception using errcode = '22023', message = 'job_invalido';
  end if;
  select w.desde, w.contact_id into v_desde, v_contato_da_janela
    from public.ia_janela_da_conversa w
   where w.conversation_id = p_conversation_id
     and w.clinic_id = p_clinic_id;
  if v_desde is not null and v_job_criado_em < v_desde then
    raise exception using errcode = '22023', message = 'job_invalido';
  end if;

  -- A preferencia normalizada: sem nulo, sem repetir, so os valores da
  -- lista, em ordem; os tres periodos ou os sete dias viram qualquer
  -- (vazio). Lida antes da idempotencia (que compara com ela).
  if coalesce(array_ndims(p_turnos), 1) = 1 and coalesce(array_ndims(p_dias), 1) = 1 then
    if array_position(p_turnos, null) is null
       and array_position(p_dias, null) is null
       and p_turnos <@ array['manha', 'tarde', 'noite']::text[]
       and p_dias <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
       and cardinality(p_turnos) = (select count(distinct t) from unnest(p_turnos) as u(t))
       and cardinality(p_dias) = (select count(distinct d) from unnest(p_dias) as u(d))
    then
      v_preferencia_ok := true;
      select coalesce(array_agg(d.t order by d.ordem), '{}'::text[]) into v_turnos
        from unnest(array['manha', 'tarde', 'noite']::text[]) with ordinality as d(t, ordem)
       where d.t = any (p_turnos);
      if cardinality(v_turnos) = 3 then
        v_turnos := '{}'::text[];
      end if;
      select coalesce(array_agg(d order by d), '{}'::smallint[]) into v_dias
        from unnest(p_dias) as u(d);
      if cardinality(v_dias) = 7 then
        v_dias := '{}'::smallint[];
      end if;
    end if;
  end if;

  -- Idempotencia: o pedido deste job volta como esta (o mesmo pedido); com
  -- outro pedido ou de outra conversa, 22023.
  select p.* into v_existente
    from public.ia_pedido_de_espera p
   where p.job_id = p_job_id;
  if found then
    if v_existente.clinic_id is distinct from p_clinic_id
       or v_existente.conversation_id is distinct from p_conversation_id
       or v_existente.procedure_id is distinct from p_procedure_id
       or v_existente.professional_id is distinct from p_professional_id
       or v_existente.insurance_id is distinct from p_insurance_id
       or v_existente.particular is distinct from p_particular
       or not v_preferencia_ok
       or v_existente.preferred_shifts is distinct from v_turnos
       or v_existente.preferred_weekdays is distinct from v_dias
    then
      raise exception using errcode = '22023', message = 'job_de_outro_pedido';
    end if;
    select * into v_conf
      from public.conferir_pedido_de_espera_da_ia(p_clinic_id, p_conversation_id, v_existente.janela_desde,
                                                  v_existente.contact_id, v_existente.procedure_id,
                                                  v_existente.professional_id, v_existente.insurance_id);
    return jsonb_build_object(
      'ok', true, 'pedido_id', v_existente.id, 'reutilizado', true,
      'procedimento', v_conf.o_procedimento, 'profissional', v_conf.o_profissional,
      'convenio', v_conf.o_convenio, 'plano', v_conf.o_plano, 'particular', v_existente.particular,
      'turnos', to_jsonb(v_existente.preferred_shifts), 'dias', to_jsonb(v_existente.preferred_weekdays));
  end if;

  -- Os parametros (erro de quem chama, 22023).
  if not v_preferencia_ok then
    raise exception using errcode = '22023', message = 'preferencia_invalida';
  end if;
  if p_particular is distinct from (p_insurance_id is null) then
    raise exception using errcode = '22023', message = 'pagamento_invalido';
  end if;
  if not exists (
       select 1 from public.procedure pr where pr.id = p_procedure_id and pr.clinic_id = p_clinic_id)
     or (p_professional_id is not null and not exists (
       select 1 from public.professional pf where pf.id = p_professional_id and pf.clinic_id = p_clinic_id))
     or (p_insurance_id is not null and not exists (
       select 1 from public.insurance i where i.id = p_insurance_id and i.clinic_id = p_clinic_id))
  then
    raise exception using errcode = '22023', message = 'cadastro_invalido';
  end if;

  -- A conversa e da clinica, esta com a IA, a IA pode atender este contato
  -- neste numero, e a janela e do contato de agora.
  select c.whatsapp_account_id, c.contact_id, c.status, k.phone_key
    into v_conversa
    from public.conversation c
    join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  if not found
     or v_conversa.status is distinct from 'ia_atendendo'
     or not public.ia_pode_atender(p_clinic_id, v_conversa.whatsapp_account_id, v_conversa.phone_key)
     or v_desde is null
     or v_contato_da_janela is distinct from v_conversa.contact_id
  then
    return jsonb_build_object('ok', false, 'motivo', 'ia_desligada');
  end if;

  -- A habilidade na versao em uso (D-36).
  if not public.lista_de_espera_da_ia_ligada(p_clinic_id) then
    return jsonb_build_object('ok', false, 'motivo', 'lista_de_espera_desligada');
  end if;

  -- As conferencias (as estruturais, depois as da pessoa).
  select * into v_conf
    from public.conferir_pedido_de_espera_da_ia(p_clinic_id, p_conversation_id, v_desde, v_conversa.contact_id,
                                                p_procedure_id, p_professional_id, p_insurance_id);
  if v_conf.o_motivo = 'ja_na_lista' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_na_lista', 'entrada', v_conf.o_entrada);
  end if;
  if v_conf.o_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', v_conf.o_motivo);
  end if;
  if v_conf.o_motivo_da_pessoa = 'ja_tem_consulta' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_consulta', 'starts_at', v_conf.o_consulta_inicio);
  end if;
  if v_conf.o_motivo_da_pessoa is not null then
    return jsonb_build_object('ok', false, 'motivo', v_conf.o_motivo_da_pessoa);
  end if;

  -- O pedido vivo anterior da conversa sai; o novo entra (um vivo por
  -- conversa).
  delete from public.ia_pedido_de_espera p
   where p.conversation_id = p_conversation_id
     and p.consumido_em is null;
  insert into public.ia_pedido_de_espera (
    clinic_id, conversation_id, contact_id, janela_desde, job_id, procedure_id, professional_id,
    insurance_id, particular, preferred_shifts, preferred_weekdays
  ) values (
    p_clinic_id, p_conversation_id, v_conversa.contact_id, v_desde, p_job_id, p_procedure_id,
    p_professional_id, p_insurance_id, p_particular, v_turnos, v_dias
  )
  returning * into v_pedido;

  return jsonb_build_object(
    'ok', true, 'pedido_id', v_pedido.id, 'reutilizado', false,
    'procedimento', v_conf.o_procedimento, 'profissional', v_conf.o_profissional,
    'convenio', v_conf.o_convenio, 'plano', v_conf.o_plano, 'particular', v_pedido.particular,
    'turnos', to_jsonb(v_pedido.preferred_shifts), 'dias', to_jsonb(v_pedido.preferred_weekdays));
end;
$$;

revoke execute on function public.pedir_lista_de_espera_pela_ia(uuid, uuid, uuid, uuid, uuid, uuid, boolean, text[], smallint[])
  from public, anon, authenticated;
grant execute on function public.pedir_lista_de_espera_pela_ia(uuid, uuid, uuid, uuid, uuid, uuid, boolean, text[], smallint[])
  to service_role;

comment on function public.pedir_lista_de_espera_pela_ia(uuid, uuid, uuid, uuid, uuid, uuid, boolean, text[], smallint[]) is
  'So o servidor (service_role). A fase 1 da lista de espera pela IA (AG5): confere e grava o PEDIDO (ia_pedido_de_espera) do job p_job_id, que escreve em seguida a pergunta fixa T-E1. p_procedure_id, p_professional_id (nulo = qualquer) e o pagamento (p_particular true e p_insurance_id nulo, ou false com o convenio) vem do ESTADO do atendimento, nunca do texto do modelo; p_turnos (manha, tarde, noite) e p_dias (0 = domingo a 6 = sabado) sem nulo e sem repetir, vazio = qualquer; o banco ordena e os tres periodos ou os sete dias viram vazio. Na ordem: 22004 (nulo fora de profissional e convenio); a trava da conversa; 22023 job_invalido (nao e responder_com_ia desta clinica e conversa, ou e de antes da janela atual); a idempotencia (o pedido deste job, com os mesmos parametros, volta com reutilizado true; com outros, ou de outra conversa, 22023 job_de_outro_pedido); 22023 preferencia_invalida, pagamento_invalido e cadastro_invalido (procedimento, profissional ou convenio que nao e da clinica); ia_desligada (conversa de outra clinica, fora da IA, contato que a IA nao atende, sem janela ou com a janela de outro contato); lista_de_espera_desligada (lista_de_espera_da_ia_ligada); mais_de_uma_unidade, so_com_a_equipe, sem_autorizacao e ja_na_lista (com entrada: {profissional, turnos, dias}), de conferir_pedido_de_espera_da_ia; consulta_para_outra_pessoa, menor_de_idade e ja_tem_consulta (com starts_at, ISO UTC; a IA diz so o dia e a hora). Depois apaga o pedido vivo anterior da conversa e grava o novo (nada mais e gravado). Devolve {ok:true, pedido_id, reutilizado, procedimento, profissional (nulo = qualquer), convenio (nulo = particular), plano, particular, turnos, dias} ou {ok:false, motivo}. Nunca 40001 nem 40P01.';

-- ---------------------------------------------------------------------------
-- 7) A fase 2: a entrada
-- ---------------------------------------------------------------------------

create function public.entrar_na_lista_de_espera_pela_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- D-43 (DECISAO DO DONO A CONFIRMAR, cabecalho): a pergunta T-E1 vale 60
  -- minutos (a mesma de c_validade_do_pedido da AG4, a confirmar junto).
  c_validade_da_pergunta constant interval := interval '60 minutes';
  v_job_criado_em timestamptz;
  v_entrada public.waitlist%rowtype;
  v_conversa record;
  v_desde timestamptz;
  v_contato_da_janela uuid;
  v_pedido public.ia_pedido_de_espera%rowtype;
  v_conf record;
  v_sim timestamptz;
  v_pergunta_id uuid;
  v_pergunta_em timestamptz;
  v_ultima_saida uuid;
  v_lidas uuid[];
  v_respondidas uuid[];
  v_waitlist uuid;
  v_restricao text;
  v_existente jsonb;
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- A trava da conversa (a da fase 1). Depois dela, o pedido (FOR UPDATE,
  -- abaixo) e o insert. Ninguem trava o pedido ou a entrada e depois a
  -- conversa.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );

  -- O job e desta conversa (senao 22023, erro de quem chama).
  select j.created_at into v_job_criado_em
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.clinic_id = p_clinic_id
     and j.payload ->> 'conversation_id' = p_conversation_id::text;
  if not found then
    raise exception using errcode = '22023', message = 'job_invalido';
  end if;

  -- Idempotencia: a entrada deste job volta como esta (mesmo se a recepcao
  -- a removeu depois).
  select w.* into v_entrada
    from public.waitlist w
   where w.ia_job_id = p_job_id;
  if found then
    if v_entrada.clinic_id is distinct from p_clinic_id
       or v_entrada.conversation_id is distinct from p_conversation_id then
      raise exception using errcode = '22023', message = 'job_de_outra_conversa';
    end if;
    select * into v_conf
      from public.conferir_pedido_de_espera_da_ia(p_clinic_id, p_conversation_id, null, v_entrada.contact_id,
                                                  v_entrada.procedure_id, v_entrada.professional_id,
                                                  v_entrada.insurance_id);
    return jsonb_build_object(
      'ok', true, 'waitlist_id', v_entrada.id, 'reutilizado', true,
      'procedimento', v_conf.o_procedimento, 'profissional', v_conf.o_profissional,
      'convenio', v_conf.o_convenio, 'plano', v_conf.o_plano, 'particular', v_entrada.particular,
      'turnos', to_jsonb(v_entrada.preferred_shifts), 'dias', to_jsonb(v_entrada.preferred_weekdays));
  end if;

  -- A conversa e da clinica, esta com a IA, a IA pode atender este contato
  -- neste numero, e a janela e do contato de agora.
  select w.desde, w.contact_id into v_desde, v_contato_da_janela
    from public.ia_janela_da_conversa w
   where w.conversation_id = p_conversation_id
     and w.clinic_id = p_clinic_id;
  select c.whatsapp_account_id, c.contact_id, c.status, k.phone_key
    into v_conversa
    from public.conversation c
    join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  if not found
     or v_conversa.status is distinct from 'ia_atendendo'
     or not public.ia_pode_atender(p_clinic_id, v_conversa.whatsapp_account_id, v_conversa.phone_key)
     or v_desde is null
     or v_contato_da_janela is distinct from v_conversa.contact_id
  then
    return jsonb_build_object('ok', false, 'motivo', 'ia_desligada');
  end if;

  -- A habilidade na versao em uso (D-36).
  if not public.lista_de_espera_da_ia_ligada(p_clinic_id) then
    return jsonb_build_object('ok', false, 'motivo', 'lista_de_espera_desligada');
  end if;

  -- O pedido vivo desta conversa, da janela atual e do contato de agora,
  -- travado. O job de antes da janela (Assumir e Devolver no meio) nao
  -- responde ao pedido da janela nova.
  select p.* into v_pedido
    from public.ia_pedido_de_espera p
   where p.conversation_id = p_conversation_id
     and p.clinic_id = p_clinic_id
     and p.consumido_em is null
     and p.janela_desde = v_desde
     and p.contact_id = v_conversa.contact_id
     for update;
  if not found or v_job_criado_em < v_desde then
    return jsonb_build_object('ok', false, 'motivo', 'sem_pedido_de_espera');
  end if;

  -- As conferencias de novo, com o pedido. As estruturais respondem ja.
  select * into v_conf
    from public.conferir_pedido_de_espera_da_ia(p_clinic_id, p_conversation_id, v_desde, v_conversa.contact_id,
                                                v_pedido.procedure_id, v_pedido.professional_id,
                                                v_pedido.insurance_id);
  if v_conf.o_motivo = 'ja_na_lista' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_na_lista', 'entrada', v_conf.o_entrada);
  end if;
  if v_conf.o_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', v_conf.o_motivo);
  end if;

  -- O "sim" e a pergunta que ele responde, lidos uma vez: v_sim e a ULTIMA
  -- mensagem do paciente; a pergunta e a mensagem da IA escrita pelo job do
  -- pedido (message.job_id; unico), que nao falhou, gravada depois do pedido
  -- e antes do "sim".
  select max(m.created_at) into v_sim
    from public.message m
   where m.conversation_id = p_conversation_id
     and m.clinic_id = p_clinic_id
     and m.direction = 'entrada'
     and m.author = 'paciente';
  select x.id, x.created_at into v_pergunta_id, v_pergunta_em
    from public.message x
   where x.conversation_id = p_conversation_id
     and x.clinic_id = p_clinic_id
     and x.job_id = v_pedido.job_id
     and x.direction = 'saida'
     and x.author = 'ia'
     and x.content_type <> 'evento'
     and not x.is_internal_note
     and x.delivery_status is distinct from 'falhou'
     and x.created_at > v_pedido.created_at
     and x.created_at < v_sim;

  -- R12 da AG4: a mensagem do paciente que NENHUM turno leu e nova (a
  -- ultima e toda mensagem dele depois da pergunta): contam as lidas do job
  -- MAIS as dos turnos desta conversa em enviado ou passou_para_equipe e as
  -- de decidido de outro job (o idsRespondidos do motor,
  -- lib/agente/historico.ts); a lida e apagada depois, so pelas lidas do
  -- job. As de sem_envio, de reservado de outro job e de outra conversa nao
  -- contam. A apagada que o job nao leu nao conta. Sem a linha do turno do
  -- job, ele nada leu. Falha fechada mesmo com nulo nas lidas (o CHECK
  -- ai_turno_lidas_sem_nulo ja impede). Logo depois das estruturais e ANTES
  -- de tudo o que depende da pessoa. Nada foi gravado ate aqui.
  select t.mensagens_lidas into v_lidas
    from public.ai_turno t
   where t.job_id = p_job_id
     and t.clinic_id = p_clinic_id
     and t.conversation_id = p_conversation_id;
  v_lidas := coalesce(v_lidas, '{}'::uuid[]);
  select coalesce(array_agg(l.id), '{}'::uuid[]) into v_respondidas
    from public.ai_turno t
    cross join lateral unnest(t.mensagens_lidas) as l(id)
   where t.conversation_id = p_conversation_id
     and t.clinic_id = p_clinic_id
     and (t.job_id = p_job_id
          or t.estado in ('enviado', 'passou_para_equipe')
          or (t.estado = 'decidido' and t.job_id <> p_job_id));
  if exists (
    select 1
      from public.message m
     where m.conversation_id = p_conversation_id
       and m.clinic_id = p_clinic_id
       and m.direction = 'entrada'
       and m.author = 'paciente'
       and (m.created_at >= v_sim or m.created_at > v_pergunta_em)
       and ((m.deleted_at is null and not coalesce(m.id = any (v_respondidas), false))
            or (m.deleted_at is not null and coalesce(m.id = any (v_lidas), true)))
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_nova_do_paciente');
  end if;

  -- O que depende da pessoa (D-8 e D-41), na ordem.
  if v_conf.o_motivo_da_pessoa = 'ja_tem_consulta' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_consulta', 'starts_at', v_conf.o_consulta_inicio);
  end if;
  if v_conf.o_motivo_da_pessoa is not null then
    return jsonb_build_object('ok', false, 'motivo', v_conf.o_motivo_da_pessoa);
  end if;

  -- A pergunta ainda vale (c_validade_da_pergunta, contada DELA). Vencida, a
  -- IA pergunta de novo. Sem pergunta, segue (sem_confirmacao_do_paciente).
  if v_pergunta_em <= now() - c_validade_da_pergunta then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_vencido');
  end if;

  -- O "sim" responde a pergunta (a ancora forte): a ULTIMA saida antes da
  -- ultima mensagem do paciente (toda saida que nao e evento nem nota, de
  -- qualquer autor e em qualquer situacao de entrega: regua, campanha,
  -- agendada, a equipe, a oferta, outra resposta da IA) e a pergunta, sem
  -- outra no mesmo instante (empate conta como outra, o lado seguro); e
  -- nenhuma mensagem do paciente depois da pergunta cita (ou responde por
  -- botao a) outra mensagem, ou uma que nao e linha nossa. O que chega
  -- depois da ultima mensagem do paciente nao conta.
  if v_pergunta_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_confirmacao_do_paciente');
  end if;
  select o.id into v_ultima_saida
    from public.message o
   where o.conversation_id = p_conversation_id
     and o.clinic_id = p_clinic_id
     and o.direction = 'saida'
     and o.content_type <> 'evento'
     and not o.is_internal_note
     and o.created_at < v_sim
   order by o.created_at desc, o.id desc
   limit 1;
  if v_ultima_saida is distinct from v_pergunta_id
     or exists (
       select 1
         from public.message o
        where o.conversation_id = p_conversation_id
          and o.clinic_id = p_clinic_id
          and o.direction = 'saida'
          and o.content_type <> 'evento'
          and not o.is_internal_note
          and o.created_at = v_pergunta_em
          and o.id <> v_pergunta_id)
     or exists (
       select 1
         from public.message m
        where m.conversation_id = p_conversation_id
          and m.clinic_id = p_clinic_id
          and m.direction = 'entrada'
          and m.author = 'paciente'
          and m.deleted_at is null
          and m.created_at > v_pergunta_em
          and m.created_at <= v_sim
          and (m.reply_to_message_id is not null or m.reply_to_wa_message_id is not null)
          and m.reply_to_message_id is distinct from v_pergunta_id)
  then
    return jsonb_build_object('ok', false, 'motivo', 'sem_confirmacao_do_paciente');
  end if;

  -- A entrada: origem ia, o job, a conversa, o pedido inteiro (procedimento,
  -- profissional, pagamento e preferencia), a prioridade padrao (no fim do
  -- grupo). Outra entrada ativa no mesmo grupo gravada ao mesmo tempo (a
  -- recepcao, outra conversa do mesmo contato): o indice waitlist_ativa_unica
  -- espera a outra transacao e, confirmada ela, e ja_na_lista.
  begin
    insert into public.waitlist (
      clinic_id, contact_id, procedure_id, professional_id, preferred_shifts, preferred_weekdays,
      origem, ia_job_id, conversation_id, insurance_id, particular
    ) values (
      p_clinic_id, v_conversa.contact_id, v_pedido.procedure_id, v_pedido.professional_id,
      v_pedido.preferred_shifts, v_pedido.preferred_weekdays,
      'ia', p_job_id, p_conversation_id, v_pedido.insurance_id, v_pedido.particular
    )
    returning id into v_waitlist;
  exception when unique_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao is distinct from 'waitlist_ativa_unica' then
      raise;
    end if;
    v_existente := public.entrada_da_espera_no_grupo(p_clinic_id, v_conversa.contact_id,
                                                     v_pedido.procedure_id, v_pedido.professional_id);
    return jsonb_build_object('ok', false, 'motivo', 'ja_na_lista', 'entrada', v_existente);
  end;

  update public.ia_pedido_de_espera p
     set consumido_em = now(),
         waitlist_id = v_waitlist,
         job_id_da_entrada = p_job_id
   where p.id = v_pedido.id;

  -- O evento no fio (autor sistema; 0 e nao cobravel; a equipe le).
  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
    'A IA colocou o paciente na lista de espera: '
      || coalesce(v_conf.o_procedimento, 'procedimento')
      || ', ' || coalesce(v_conf.o_profissional, 'qualquer profissional')
      || ', ' || case when v_pedido.particular then 'particular'
                      else 'convênio ' || coalesce(v_conf.o_convenio, '')
                           || coalesce(' (' || v_conf.o_plano || ')', '') end
      || '. Preferência: '
      || public.descrever_preferencia_da_espera(v_pedido.preferred_shifts, v_pedido.preferred_weekdays)
      || '.',
    false, 0
  );

  return jsonb_build_object(
    'ok', true, 'waitlist_id', v_waitlist, 'reutilizado', false,
    'procedimento', v_conf.o_procedimento, 'profissional', v_conf.o_profissional,
    'convenio', v_conf.o_convenio, 'plano', v_conf.o_plano, 'particular', v_pedido.particular,
    'turnos', to_jsonb(v_pedido.preferred_shifts), 'dias', to_jsonb(v_pedido.preferred_weekdays));
end;
$$;

revoke execute on function public.entrar_na_lista_de_espera_pela_ia(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.entrar_na_lista_de_espera_pela_ia(uuid, uuid, uuid)
  to service_role;

comment on function public.entrar_na_lista_de_espera_pela_ia(uuid, uuid, uuid) is
  'So o servidor (service_role). A fase 2 da lista de espera pela IA (AG5): com o "sim" do paciente numa mensagem nova, cria a entrada da fila (waitlist, origem ia, ia_job_id = p_job_id, conversation_id, o procedimento, o profissional, o pagamento e a preferencia do pedido vivo; prioridade padrao, no fim do grupo), consome o pedido (consumido_em, waitlist_id, job_id_da_entrada) e grava o evento no fio ("A IA colocou o paciente na lista de espera: procedimento, profissional ou qualquer profissional, particular ou convênio X (plano). Preferência: períodos; dias."). Nunca a resposta ao paciente (o sistema escreve a T-E2). Na ordem: 22004; a trava da conversa; 22023 job_invalido (nao e responder_com_ia desta clinica e conversa); a idempotencia (a entrada com ia_job_id = p_job_id volta com reutilizado true; de outra clinica ou conversa, 22023 job_de_outra_conversa); ia_desligada (conversa de outra clinica, fora da IA, contato que a IA nao atende, sem janela ou com a janela de outro contato); lista_de_espera_desligada; sem_pedido_de_espera (nenhum pedido vivo desta conversa, da janela atual e do contato de agora, ou o job e de antes da janela; o pedido fica travado); mais_de_uma_unidade, so_com_a_equipe, sem_autorizacao e ja_na_lista (com entrada), com o pedido; mensagem_nova_do_paciente (R12 da AG4: a ultima mensagem do paciente, ou uma dele depois da pergunta, que NENHUM turno leu: fora das lidas do job e das dos turnos desta conversa em enviado ou passou_para_equipe ou em decidido de outro job; ou que o job leu e foi apagada; sem a linha do turno do job, ele nada leu); consulta_para_outra_pessoa, menor_de_idade e ja_tem_consulta (com starts_at); pedido_vencido (a pergunta tem 60 minutos ou mais, c_validade_da_pergunta, D-43); sem_confirmacao_do_paciente (a ancora forte: a pergunta e a mensagem da IA, que nao falhou, escrita pelo job do pedido, message.job_id, gravada depois do pedido e antes da ultima mensagem do paciente; a ultima saida antes dessa mensagem, toda saida que nao e evento nem nota, de qualquer autor e situacao, tem de ser ela, sem empate; nenhuma mensagem do paciente depois dela cita ou responde por botao a outra mensagem, reply_to_message_id, ou a uma que nao e linha nossa, reply_to_wa_message_id); o insert que bate no indice waitlist_ativa_unica (23505, outra entrada ativa no grupo gravada ao mesmo tempo) vira ja_na_lista. Devolve {ok:true, waitlist_id, reutilizado, procedimento, profissional (nulo = qualquer), convenio (nulo = particular), plano, particular, turnos, dias} ou {ok:false, motivo}. Nao grava audit_log (escrita do sistema; a trilha e a linha da fila e o evento). Nunca 40001 nem 40P01.';

-- ---------------------------------------------------------------------------
-- 8) A mensagem tratada pelo sistema (D-39)
-- ---------------------------------------------------------------------------

create function public.marcar_mensagem_tratada_pelo_sistema(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_clinic_id is null or p_conversation_id is null or p_message_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- Uma marcacao por mensagem de cada vez (a idempotencia exata).
  perform pg_advisory_xact_lock(
    hashtextextended('mensagem_tratada:' || p_message_id::text, 0)
  );

  -- A mensagem e do paciente, desta conversa e desta clinica (senao 22023,
  -- erro de quem chama).
  if not exists (
    select 1
      from public.message m
     where m.id = p_message_id
       and m.clinic_id = p_clinic_id
       and m.conversation_id = p_conversation_id
       and m.direction = 'entrada'
       and m.author = 'paciente'
  ) then
    raise exception using errcode = '22023', message = 'mensagem_invalida';
  end if;

  -- So na conversa com a IA (com a equipe, quem le e a recepcao).
  select c.status into v_status
    from public.conversation c
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  if v_status is distinct from 'ia_atendendo' then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_ia');
  end if;

  -- Ja respondida por um turno encerrado: nada.
  if exists (
    select 1
      from public.ai_turno t
     where t.conversation_id = p_conversation_id
       and t.clinic_id = p_clinic_id
       and t.estado in ('enviado', 'passou_para_equipe')
       and p_message_id = any (t.mensagens_lidas)
  ) then
    return jsonb_build_object('ok', true, 'marcada', false);
  end if;

  -- Um turno sintetico, encerrado e sem saida, que leu so esta mensagem: o
  -- idsRespondidos do motor e o R12 do banco a contam como respondida, sem
  -- mudar quem os le. O job_id e novo (nao e job da fila).
  insert into public.ai_turno (job_id, clinic_id, conversation_id, estado, saida, mensagens_lidas)
  values (gen_random_uuid(), p_clinic_id, p_conversation_id, 'enviado', 'nenhuma', array[p_message_id]);

  return jsonb_build_object('ok', true, 'marcada', true);
end;
$$;

revoke execute on function public.marcar_mensagem_tratada_pelo_sistema(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.marcar_mensagem_tratada_pelo_sistema(uuid, uuid, uuid)
  to service_role;

comment on function public.marcar_mensagem_tratada_pelo_sistema(uuid, uuid, uuid) is
  'So o servidor (service_role; AG5, D-39). A mensagem p_message_id do paciente, que o sistema tratou sem a IA (o interceptador: SIM ou NAO QUERO da oferta da lista de espera, a mensagem do lembrete, o toque de confirmacao), deixa de voltar como pendente para a IA: grava em ai_turno um turno sintetico (job_id novo, que nao e job da fila; estado enviado, saida nenhuma, mensagens_lidas = {p_message_id}). O idsRespondidos do motor (lib/agente/historico.ts), o ia_marcar_respondida e o R12 do banco a contam como respondida. Na ordem: 22004 (nulo); 22023 mensagem_invalida (nao e mensagem do paciente desta conversa e desta clinica); {ok:false, motivo:fora_da_ia} (a conversa nao esta com a IA: nada grava); {ok:true, marcada:false} (ja lida por um turno enviado ou passou_para_equipe da conversa: nada grava); {ok:true, marcada:true}. Nao mexe em awaiting_reply (o interceptador ja tira do contador). Idempotente (trava por mensagem). Nunca 40001 nem 40P01.';

-- ---------------------------------------------------------------------------
-- 9) O aceite da oferta com a regra da entrada da IA (D-37)
-- ---------------------------------------------------------------------------
-- O corpo de producao (20260924104000, lido com fndef.js em 27/10/2026, md5
-- ee00dcac054a8e54129543f567604b38), com os trechos [lista pela IA]. A
-- entrada sem pagamento declarado e sem origem ia (todas as de hoje) segue
-- EXATAMENTE a regra de antes.

create or replace function public.aceitar_oferta_de_espera(
  p_clinic_id uuid,
  p_offer_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- [lista pela IA] D-37 (DECISAO DO DONO A CONFIRMAR, cabecalho da
  -- 20261029100000): o pagamento declarado na entrada e estrito, e a
  -- entrada da IA so vale para o vinculo que a IA marca (e e lida mesmo
  -- inativa). false aqui (uma palavra): toda entrada volta a regra de antes.
  -- O espelho e REGRA_DA_ENTRADA_DA_IA em lib/domain/lista-espera.ts:
  -- trocar e trocar nos dois.
  c_regra_da_entrada_da_ia constant boolean := true;
  v_oferta record;
  v_indice integer;
  v_entrada_id uuid;
  v_entrada_ativa uuid;
  v_procedimento uuid;
  v_procedimento_da_vaga uuid;
  v_unidade uuid;
  v_convenio uuid;
  v_vinculo uuid;
  v_duracao integer;
  v_recurso uuid;
  v_fim timestamptz;
  v_motivo text;
  v_restricao text;
  v_appointment uuid;
  v_profissional text;
  v_timezone text;
  -- [lista pela IA] inicio
  v_origem text;
  v_particular_declarado boolean;
  v_convenio_declarado uuid;
  -- [lista pela IA] fim
begin
  select * into v_oferta
    from public.waitlist_offer
   where id = p_offer_id
     and clinic_id = p_clinic_id
     and status = 'aberta'
     and expires_at > now()
     and p_contact_id = any(offered_to)
     and not (p_contact_id = any(declined_by))
     for update;
  if not found then
    -- Segundo a responder, oferta cancelada, vencida ou recusada por ele.
    return jsonb_build_object('ok', false, 'erro', 'ja_tratado');
  end if;

  -- A entrada que o JOB casou com esta vaga, pela posicao no array.
  -- Variaveis escalares de proposito: campo de record nunca atribuido e
  -- erro em plpgsql ("record is not assigned yet").
  v_indice := array_position(v_oferta.offered_to, p_contact_id);
  if v_indice is not null
     and coalesce(array_length(v_oferta.matched_waitlist_ids, 1), 0) >= v_indice
  then
    v_entrada_id := v_oferta.matched_waitlist_ids[v_indice];
  end if;
  if v_entrada_id is not null then
    select w.id, w.procedure_id
           -- [lista pela IA] a origem e o pagamento declarado
           , w.origem, w.particular, w.insurance_id
      into v_entrada_ativa, v_procedimento
           , v_origem, v_particular_declarado, v_convenio_declarado
      from public.waitlist w
     where w.id = v_entrada_id
       and w.clinic_id = p_clinic_id
       -- [lista pela IA] a entrada da IA vale ate o fim, mesmo inativa
       and (w.active or (c_regra_da_entrada_da_ia and w.origem = 'ia'));
  end if;

  -- Fallback para ofertas criadas antes de matched_waitlist_ids (ou entrada
  -- que saiu da fila no meio tempo): a heuristica antiga, com o
  -- procedimento atendido pelo profissional na frente.
  if v_entrada_ativa is null then
    select w.id, w.procedure_id
           -- [lista pela IA] a origem e o pagamento declarado
           , w.origem, w.particular, w.insurance_id
      into v_entrada_ativa, v_procedimento
           , v_origem, v_particular_declarado, v_convenio_declarado
      from public.waitlist w
     where w.clinic_id = p_clinic_id
       and w.contact_id = p_contact_id
       and w.active
       and (w.professional_id is null
            or w.professional_id = v_oferta.professional_id)
     order by
       (w.procedure_id is not null and exists (
          select 1 from public.service_link sl
           where sl.clinic_id = p_clinic_id
             and sl.professional_id = v_oferta.professional_id
             and sl.procedure_id = w.procedure_id
             and sl.active
       )) desc,
       (w.procedure_id is not null) desc,
       w.priority, w.created_at, w.id
     limit 1;
  end if;
  -- [lista pela IA] Sem a regra (c_regra_da_entrada_da_ia false), a de
  -- antes para toda entrada.
  if not c_regra_da_entrada_da_ia then
    v_origem := null;
    v_particular_declarado := null;
    v_convenio_declarado := null;
  end if;

  -- Entrada "qualquer procedimento" herda o PROCEDIMENTO da consulta
  -- cancelada; a unidade tambem vem dela (o horario e o mesmo).
  select sl.procedure_id, a.unit_id
    into v_procedimento_da_vaga, v_unidade
    from public.appointment a
    join public.service_link sl on sl.id = a.service_link_id
   where a.id = v_oferta.source_appointment_id
     and a.clinic_id = p_clinic_id;
  v_procedimento := coalesce(v_procedimento, v_procedimento_da_vaga);

  -- O vinculo pelo CONVENIO DO CONTATO, senao o particular. Ordem explicita:
  -- service_link e unico por (profissional, procedimento, convenio), entao
  -- ha no maximo um de cada e o convenio vem na frente.
  select c.insurance_id into v_convenio
    from public.contact c
   where c.id = p_contact_id
     and c.clinic_id = p_clinic_id;
  if v_procedimento is not null then
    select sl.id, sl.duration_min, pr.resource_id
      into v_vinculo, v_duracao, v_recurso
      from public.service_link sl
      join public.procedure pr
        on pr.id = sl.procedure_id
       and pr.clinic_id = sl.clinic_id
     where sl.clinic_id = p_clinic_id
       and sl.professional_id = v_oferta.professional_id
       and sl.procedure_id = v_procedimento
       and sl.active
       and pr.active
       -- [lista pela IA] o pagamento declarado na entrada e estrito (true:
       -- so o particular; false: so o convenio dela); sem declaracao, a
       -- regra de antes (o convenio do contato, senao o particular)
       and case when v_particular_declarado is null
                  then (sl.insurance_id is null or sl.insurance_id = v_convenio)
                when v_particular_declarado
                  then sl.insurance_id is null
                else sl.insurance_id = v_convenio_declarado
           end
       -- [lista pela IA] a entrada da IA, so com o vinculo que a IA marca
       -- (vinculo e procedimento com IA pode agendar, convenio ativo)
       and (v_origem is distinct from 'ia'
            or (sl.bookable_by_ai
                and pr.bookable_by_ai
                and (sl.insurance_id is null or exists (
                  select 1 from public.insurance i
                   where i.id = sl.insurance_id
                     and i.clinic_id = p_clinic_id
                     and i.active))))
     order by (sl.insurance_id is not null) desc, sl.id
     limit 1;
  end if;
  if v_vinculo is null then
    -- O catalogo mudou depois da onda: esta pessoa nao tem como ser
    -- agendada aqui. A oferta segue aberta para o resto da onda.
    return jsonb_build_object('ok', false, 'erro', 'sem_vinculo');
  end if;

  v_fim := v_oferta.slot_starts_at + make_interval(mins => v_duracao);
  if v_fim > v_oferta.slot_ends_at then
    return jsonb_build_object('ok', false, 'erro', 'nao_cabe');
  end if;

  -- A vaga ainda existe? Bloqueio criado depois da onda, profissional
  -- desativado, jornada mudada ou horario ocupado (inclusive encaixe): a
  -- oferta morre com honestidade.
  v_motivo := public.vaga_de_espera_indisponivel(
    p_clinic_id, v_oferta.professional_id,
    v_oferta.slot_starts_at, v_fim, v_unidade
  );
  if v_motivo is not null then
    update public.waitlist_offer
       set status = 'cancelada'
     where id = p_offer_id;
    perform public.encerrar_envios_da_oferta(p_clinic_id, p_offer_id);
    return jsonb_build_object(
      'ok', false, 'erro', 'horario_ocupado', 'motivo', v_motivo
    );
  end if;

  -- A trava REAL contra corrida com marcacao manual continua sendo a
  -- exclusion constraint.
  begin
    insert into public.appointment (
      clinic_id, unit_id, contact_id, professional_id, service_link_id,
      resource_id, starts_at, ends_at, status, created_by, source
    )
    values (
      p_clinic_id, v_unidade, p_contact_id, v_oferta.professional_id,
      v_vinculo, v_recurso, v_oferta.slot_starts_at, v_fim,
      'agendado', 'sistema', 'interna'
    )
    returning id into v_appointment;
  exception when exclusion_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao = 'sem_sobreposicao_recurso' then
      -- So a SALA/EQUIPAMENTO do procedimento desta pessoa esta ocupado: o
      -- horario do profissional continua livre para o resto da onda.
      return jsonb_build_object(
        'ok', false, 'erro', 'horario_ocupado', 'motivo', 'recurso_ocupado'
      );
    end if;
    update public.waitlist_offer
       set status = 'cancelada'
     where id = p_offer_id;
    perform public.encerrar_envios_da_oferta(p_clinic_id, p_offer_id);
    return jsonb_build_object(
      'ok', false, 'erro', 'horario_ocupado', 'motivo', 'ocupado'
    );
  end;

  update public.waitlist_offer
     set status = 'preenchida',
         responded_by = p_contact_id,
         responded_at = now(),
         appointment_id = v_appointment
   where id = p_offer_id;
  -- Quem ainda nao recebeu a mensagem nao recebe mais.
  perform public.encerrar_envios_da_oferta(p_clinic_id, p_offer_id);

  -- O vencedor sai da fila (a entrada que casou; active=false, nunca delete).
  if v_entrada_ativa is not null then
    update public.waitlist set active = false where id = v_entrada_ativa;
  end if;

  -- Evento na conversa, como confirmar_pelo_paciente faz.
  if p_conversation_id is not null then
    insert into public.message (
      clinic_id, conversation_id, direction, author,
      content_type, body, billable, cost_cents
    )
    values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema',
      'evento', 'O paciente aceitou o horário oferecido pela lista de espera.',
      false, 0
    );
  end if;

  select p.name into v_profissional
    from public.professional p where p.id = v_oferta.professional_id;
  select c.timezone into v_timezone
    from public.clinic c where c.id = p_clinic_id;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_appointment,
    'starts_at', v_oferta.slot_starts_at,
    'profissional', v_profissional,
    'timezone', v_timezone
  );
end;
$$;

comment on function public.aceitar_oferta_de_espera(uuid, uuid, uuid, uuid) is
  'So o servidor (service_role; o interceptador, no SIM da oferta). O primeiro que responde leva o horario da oferta aberta (FOR UPDATE): a entrada casada pelo job (matched_waitlist_ids), senao a heuristica antiga; o vinculo do procedimento da entrada (ou o da vaga) com o profissional da oferta; a vaga conferida (vaga_de_espera_indisponivel); a consulta agendado, autor sistema (D-45: sem a aprovacao); a entrada sai da fila; o evento na conversa. AG5 (D-37, c_regra_da_entrada_da_ia, a confirmar): o pagamento declarado na entrada (waitlist.particular) e estrito (particular: so o vinculo particular; convenio: so o vinculo do convenio dela); sem declaracao, a regra de antes (o convenio do contato, senao o particular); a entrada de origem ia so com o vinculo que a IA marca (vinculo e procedimento com IA pode agendar, convenio do vinculo ativo) e e lida mesmo inativa (a regra dela vale ate o fim). Entrada sem origem ia e sem pagamento declarado: exatamente o corpo de antes. Devolve {ok:true, appointment_id, starts_at, profissional, timezone} ou {ok:false, erro: ja_tratado | sem_vinculo | nao_cabe | horario_ocupado (com motivo)}.';

-- ---------------------------------------------------------------------------
-- 10) A poda, com o pedido da lista de espera
-- ---------------------------------------------------------------------------
-- O corpo de producao (20261027120000, lido com fndef.js em 27/10/2026, md5
-- 2adc71187aaf5c4bacfc58abc073473e), com o trecho [lista pela IA].

create or replace function public.podar_agendamento_da_ia()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_atendimentos integer := 0;
  v_dados integer := 0;
  -- [lista pela IA] inicio
  -- O pedido vivo (sem consumo) vale ate a resposta seguinte: 7 dias e
  -- folga. O consumido e so a trilha de quem pediu: 30 dias.
  c_pedido_vivo constant interval := interval '7 days';
  c_pedido_consumido constant interval := interval '30 days';
  v_pedidos integer := 0;
  -- [lista pela IA] fim
begin
  -- O estado do atendimento: da conversa que sumiu, resolvida ha mais de 30
  -- dias, de janela que nao e mais a da conversa (Devolver, ou a janela
  -- podada) e o parado ha mais de 90 dias. Ate 1000 por passagem, sem
  -- esperar ninguem.
  delete from public.ia_atendimento a
   where a.id in (
     select x.id
       from public.ia_atendimento x
       left join public.conversation c on c.id = x.conversation_id
      where c.id is null
         or (c.status = 'resolvida' and c.updated_at < now() - interval '30 days')
         or not exists (
              select 1 from public.ia_janela_da_conversa w
               where w.conversation_id = x.conversation_id
                 and w.desde = x.janela_desde)
         or x.updated_at < now() - interval '90 days'
      limit 1000
        for update of x skip locked
   );
  get diagnostics v_atendimentos = row_count;

  -- Os dados informados (dado pessoal: o minimo de tempo). A linha aberta
  -- (sem consulta) 7 dias depois de mexida, ou da conversa que sumiu. A da
  -- consulta 30 dias depois de a consulta deixar de estar pendente (aprovada
  -- e aplicada, recusada) ou 30 dias depois do dia da consulta. A consulta
  -- apagada leva a linha (FK em cascata).
  delete from public.dados_informados_na_marcacao d
   where d.id in (
     select x.id
       from public.dados_informados_na_marcacao x
       left join public.appointment a on a.id = x.appointment_id
      where (x.appointment_id is null
             and (x.updated_at < now() - interval '7 days'
                  or not exists (select 1 from public.conversation c where c.id = x.conversation_id)))
         or (x.appointment_id is not null
             and ((a.approval_status is distinct from 'pendente' and x.updated_at < now() - interval '30 days')
                  or a.starts_at < now() - interval '30 days'))
      limit 1000
        for update of x skip locked
   );
  get diagnostics v_dados = row_count;

  -- [lista pela IA] inicio
  -- O pedido da lista de espera (AG5): o vivo com 7 dias ou da conversa que
  -- sumiu; o consumido com 30 dias. Ate 1000 por passagem, sem esperar
  -- ninguem (a fase 1 e a 2 travam o pedido: SKIP LOCKED).
  delete from public.ia_pedido_de_espera p
   where p.id in (
     select x.id
       from public.ia_pedido_de_espera x
      where (x.consumido_em is null
             and (x.created_at < now() - c_pedido_vivo
                  or not exists (select 1 from public.conversation c where c.id = x.conversation_id)))
         or (x.consumido_em is not null and x.consumido_em < now() - c_pedido_consumido)
      limit 1000
        for update of x skip locked
   );
  get diagnostics v_pedidos = row_count;
  -- [lista pela IA] fim

  return jsonb_build_object('atendimentos', v_atendimentos, 'dados', v_dados
                            -- [lista pela IA]
                            , 'pedidos_de_espera', v_pedidos);
end;
$$;

comment on function public.podar_agendamento_da_ia() is
  'Interna (motor_manutencao; nenhum papel da API executa): a poda do agendamento completo pela IA (AG3) e do pedido da lista de espera (AG5). ia_atendimento: conversa que sumiu, resolvida ha mais de 30 dias, janela que nao e mais a da conversa, ou parado ha mais de 90 dias. dados_informados_na_marcacao: a linha aberta 7 dias depois de mexida (ou da conversa que sumiu); a da consulta 30 dias depois de deixar de estar pendente, ou 30 dias depois do dia da consulta. ia_pedido_de_espera: o vivo (sem consumo) com 7 dias ou da conversa que sumiu; o consumido com 30 dias. Ate 1000 linhas de cada por passagem, SKIP LOCKED. Devolve {atendimentos, dados, pedidos_de_espera}.';
