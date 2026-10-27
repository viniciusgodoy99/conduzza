-- ---------------------------------------------------------------------------
-- Agendamento completo pela IA (AG3, parte de banco): o estado do
-- atendimento entre os turnos, os dados que o paciente informa para marcar,
-- a unidade da reserva e as recusas novas do agendar
-- ---------------------------------------------------------------------------
-- Pedido do dono em 26/10/2026: a IA faz TODO o agendamento (escolher
-- procedimento, profissional, convenio ou particular e unidade, oferecer,
-- reservar, pedir os dados, confirmar e marcar, e depois remarcar e
-- cancelar). Ate aqui (E4, 20261020130000) a IA busca 3 horarios, reserva
-- por 10 minutos e marca a consulta pendente, sem unidade e sem dado nenhum
-- do paciente, e nada sobrevive de um turno para o outro (os codigos h1,
-- h2... valem so no turno). Esta migration e o BANCO da etapa AG3; o codigo
-- do agente (lib/agente) vem depois, noutra frente, lendo este contrato.
--
-- DECISOES DO DONO AINDA PENDENTES, construidas com o padrao recomendado
-- (trocar e uma migration pequena): D-2 a consulta da IA continua pendente
-- de aprovacao (nada muda nisso); D-6 os dados exigidos por padrao sao o
-- nome completo e o nascimento, e o CPF e a carteirinha so se a clinica
-- ligar; D-7 os dados informados ficam numa tabela a parte e sao aplicados
-- ao cadastro do contato na APROVACAO, so nos campos vazios; D-8 consulta
-- para outra pessoa e menor de 18 anos passam para a equipe. Decisoes desta
-- frente (no relatorio, para o dono): as versoes do agente que ja existem
-- leem os tres exige_* FALSOS e o rascunho copia a ultima publicada, como
-- todo campo (o codigo de hoje marca sem pedir dado; o padrao do dono vale
-- na primeira versao de uma clinica e para quem ligar e publicar: a
-- teste123 e a Conduzza Teste precisam ligar); a
-- carteirinha e exigida na consulta pelo convenio quando o convenio tem
-- "Carteirinha obrigatoria" (insurance.requires_card, o Cadastro de
-- convenios) ou o procedimento tem o requisito carteirinha (AG1); o nome so
-- troca quando o cadastro esta sem nome ou com o nome do WhatsApp (criterio
-- no item 6); menor de idade e no dia da consulta, no fuso da clinica, pelo
-- nascimento informado ou pelo do cadastro do contato (basta um); os dados
-- exigidos sao pedidos mesmo quando o cadastro ja os tem (o cadastro nao
-- muda); o estado e zerado pela janela da conversa (o Devolver abre janela
-- nova); a poda e de 30 dias depois de a conversa ser resolvida.
--
-- O QUE MUDA:
--   1. Tres funcoes puras de validacao (IMMUTABLE, search_path vazio, para
--      os CHECKs; o EXECUTE padrao do esquema, porque nao leem tabela nem
--      devolvem dado): cpf_valido(text)
--      (11 digitos, nao todos iguais, os dois verificadores);
--      ia_horarios_oferecidos_validos(jsonb) (ate 9 objetos, cada um so com
--      codigo h1 a h99, service_link_id, professional_id, unit_id, starts_at,
--      ends_at e oferecido_em, instantes em UTC com Z); e
--      ia_estado_do_atendimento_valido(jsonb) (as 14 chaves do estado, so
--      listas fechadas, ids e instantes). Nunca lancam: forma errada e falso.
--   2. ai_agent_config: exige_nome_completo e exige_nascimento (boolean not
--      null; as linhas que existem leem falso; a primeira versao de uma
--      clinica nasce com verdadeiro, e o rascunho copia a ultima publicada)
--      e exige_cpf (falso), com o grant por coluna de skills.
--      agente_garantir_rascunho e restaurar_versao_do_agente copiam as tres
--      (CREATE OR REPLACE do corpo de producao, marca [agendamento
--      completo]).
--   3. ai_decision_log: o CHECK de escalation_reason com
--      consulta_para_outra_pessoa, ja_tem_consulta e faltam_dados (drop e
--      add com o mesmo nome, NOT VALID e VALIDATE). A 20261027110000 (AG2)
--      mexe so no CHECK de compliance_rule: nao conflita. rotulo_do_motivo_
--      da_ia ganha os tres eventos (o espelho TEXTO_DO_EVENTO_DA_IA muda
--      junto, no codigo).
--   4. slot_hold.unit_id (FK unit, on delete set null, indice parcial) e o
--      gatilho exigir_unidade_da_reserva_da_mesma_clinica (unidade de outra
--      clinica: 23503, pela sessao e pela service role).
--      conferir_horario_da_ia ganha p_unit_id (DROP e CREATE, interna): a
--      unidade da clinica e ativa (senao unidade_invalida, logo depois de
--      vinculo_invalido) e, com unidade, so a jornada dela e a sem unidade
--      contam (como a Agenda). reservar_horario_da_ia ganha p_unit_id
--      DEFAULT NULL (DROP e CREATE com os grants de antes: o codigo de hoje
--      chama por nome com 5 parametros e continua igual), grava a unidade e
--      a devolve (unit_id); e, depois da conferencia do horario e antes de
--      gravar, recusa ja_tem_consulta (revisao final, abaixo).
--   5. agendar_pela_ia (DROP e CREATE do corpo de producao com
--      p_slot_hold_id DEFAULT NULL, os grants de antes; o codigo de hoje
--      chama por nome com 3 parametros e continua igual): com
--      p_slot_hold_id, recusa reserva_diferente (revisao final, abaixo);
--      confere a unidade da reserva; depois da conferencia do horario e
--      antes da confirmacao do paciente, recusa, nesta ordem, com
--      consulta_para_outra_pessoa, menor_de_idade (pelo nascimento
--      informado ou pelo do cadastro do contato), ja_tem_consulta (o contato
--      ja tem consulta futura ativa do mesmo procedimento, com qualquer
--      profissional; devolve o appointment_id dela) e faltam_dados (devolve
--      faltam: a lista); grava a unidade na consulta e liga os dados
--      informados (a linha aberta da janela atual) a consulta e a reserva
--      consumida. Tudo o mais igual (pendente, travas, exclusion,
--      idempotencia, a mensagem do paciente depois da pergunta, o evento).
--   6. Duas tabelas novas, RLS ligada e SEM policy, nada para anon e
--      authenticated, so SELECT para a service role (a escrita e so pelas
--      RPCs e pelo gatilho):
--      - ia_atendimento: o estado do atendimento entre os turnos, um por
--        conversa e janela (ia_janela_da_conversa.desde): etapa, intencao,
--        procedimento, profissional, convenio ou particular, unidade, os
--        horarios oferecidos (ate 9), a reserva viva, a consulta em foco, o
--        pedido pendente (cancelar ou remarcar) e quando, falhas seguidas,
--        desfecho, o ultimo job, a versao e o estado de antes do ultimo job
--        (anterior). Nunca texto do paciente. Assumir tira a conversa da IA
--        (as RPCs dizem fora_da_ia) e o Devolver abre janela nova: o estado
--        recomeca, e o da janela anterior sai na gravacao seguinte e na poda.
--      - dados_informados_na_marcacao: nome completo, nascimento, CPF (so
--        digitos, verificador valido) e carteirinha que o paciente informou,
--        se a consulta e para ele, o contato e a conversa, a janela da IA em
--        que a linha foi aberta (janela_desde), a reserva e/ou a consulta,
--        aplicado_em e aplicado_por. Uma linha aberta por conversa ate o
--        agendar (so vale a da janela atual), uma por consulta. Dado de outra
--        pessoa nunca fica (CHECK). A aprovacao da consulta da IA (gatilho
--        dados_informados_na_aprovacao, AFTER UPDATE OF approval_status, o
--        ultimo na ordem alfabetica dos que disparam ali) aplica ao contato
--        so nos campos vazios: nascimento e CPF vazios; a carteirinha vazia,
--        na consulta pelo convenio, com o convenio do cadastro vazio (vem
--        junto) ou o mesmo; o NOME quando o cadastro esta sem nome ou com o
--        nome do WhatsApp, que e o nome que nenhuma pessoa escreveu: o
--        contato nao veio de importacao, nao tem na trilha (audit_log) uma
--        pessoa que o criou ou editou ('criou' ou 'editou' em contact, com
--        user_id) e nenhum nome informado foi aplicado antes. Grava
--        aplicado_em, aplicado_por (quem aprovou) e a trilha
--        aplicou_dados_da_marcacao (so os nomes dos campos). Recusar ou
--        cancelar a pendente nao aplica nada.
--   7. RPCs novas, SECURITY DEFINER, search_path vazio, nunca 40001 nem
--      40P01, resultado de negocio em JSON:
--      - registrar_dados_da_marcacao (so service role), sob a trava da
--        conversa do reservar e do agendar, na linha da janela atual (sem
--        janela: ia_desligada);
--      - ler_dados_informados_na_marcacao (authenticated e service role):
--        a leitura humana, para quem aprova a consulta (a policy de UPDATE
--        de appointment: escrita na clinica e, o profissional, so na propria
--        agenda), com a trilha leu_dados_da_marcacao sem conteudo;
--      - ler_atendimento_da_ia e gravar_atendimento_da_ia (so service role):
--        idempotentes por job (o mesmo job parte do estado de antes dele),
--        com a versao lida (estado_mudou), o job da conversa em execucao e
--        da janela atual (D-A do E3: a conversa travada antes de ler a
--        janela).
--      E as internas (nenhum papel da API executa): dados_que_faltam_para_
--      marcar, ia_estado_do_atendimento, aplicar_dados_na_aprovacao (do
--      gatilho) e podar_agendamento_da_ia.
--   8. A poda, na manutencao do motor (motor_manutencao, CREATE OR REPLACE
--      do corpo de producao, um bloco novo com o erro proprio
--      agendamento_da_ia:<SQLSTATE> e a chave agendamento_da_ia no retorno):
--      o estado da conversa que sumiu, resolvida ha mais de 30 dias, de
--      janela que nao e mais a da conversa, ou parado ha mais de 90 dias; os
--      dados da linha aberta 7 dias depois de mexida e os da consulta 30
--      dias depois de deixar de estar pendente ou do dia da consulta. Ate
--      1000 de cada por passagem, SKIP LOCKED.
--   9. REVISAO FINAL (27/10/2026: os achados de banco da revisao final do
--      agendamento completo, com o contrato acertado com a frente de
--      codigo; marca [revisao final] nos corpos):
--      a) agendar_pela_ia ganha p_slot_hold_id DEFAULT NULL (achado 1,
--         alta: o "Confirma ...?" perguntava um horario e o "sim" marcava a
--         reserva viva, que podia ser outra). Com ele, se a reserva viva da
--         conversa (ou, no mesmo job de novo, a que ele consumiu) nao for
--         essa, reserva_diferente, antes de qualquer gravacao (logo depois
--         de reserva_inexistente, antes de reserva_vencida). Nulo: como
--         antes.
--      b) reservar_horario_da_ia recusa ja_tem_consulta ANTES de reservar
--         (achado 6: o paciente informava todos os dados e so no fim ouvia
--         que ja tinha consulta), depois da conferencia do horario, com
--         appointment_id e starts_at (a IA diz so o dia e a hora), pela
--         mesma regra do agendar (qualquer profissional; a pendente da IA
--         conta; cancelada, recusada, faltou e compareceu nao). Nada grava
--         (a reserva que a conversa ja tinha fica). O agendar continua
--         conferindo (a consulta pode nascer entre o reservar e o agendar).
--      c) dados_informados_na_marcacao.janela_desde (achado 7: a marca de
--         consulta para outra pessoa travava a IA na conversa por ate 7
--         dias): a linha guarda a janela da IA em que foi aberta
--         (ia_janela_da_conversa.desde). O registrar, o agendar e o
--         ler_atendimento_da_ia so leem a linha aberta da janela atual; a de
--         outra janela (o Devolver abre outra; o Assumir ja tira da IA) nao
--         vale, o registrar a apaga na gravacao seguinte (com dado invalido,
--         nada grava e ela fica, ignorada) e a poda continua (7 dias depois
--         de mexida). Conversa sem janela: o registrar diz ia_desligada, sem
--         gravar.
--      d) gravar_atendimento_da_ia grava como nulo o slot_hold_id que ja
--         nao existe (achado 10: o limpar_holds_vencidos apagava a reserva
--         vencida no meio do turno, o 22023 subia e a resposta caia em
--         falha tecnica). A reserva que existe e e de outra clinica ou de
--         outra conversa continua 22023.
--
-- CONTRATO para a frente de codigo: os COMMENT ON de cada funcao, tabela e
-- coluna abaixo (assinatura, retorno, motivos, erros e criterios). Nos
-- espelhos do TypeScript: MOTIVOS_DE_ESCALONAMENTO e TEXTO_DO_EVENTO_DA_IA
-- ganham os tres motivos do item 3; os motivos do reservar ganham
-- unidade_invalida e ja_tem_consulta (com appointment_id e starts_at); os do
-- agendar, reserva_diferente, unidade_invalida, ja_tem_consulta (com
-- appointment_id), consulta_para_outra_pessoa, faltam_dados e
-- menor_de_idade; o agendar ganha p_slot_hold_id (a reserva do "Confirma").
--
-- Producao em 27/10/2026 (q.js, so leitura): a ultima migration aplicada e
-- a 20261026130000 (a 20261027100000 e a 20261027110000, da branch, vao
-- antes desta); slot_hold e unit vazias; ai_agent_config com 3 linhas, todas
-- publicadas, Agendar desligada em todas; ai_decision_log com 3 linhas;
-- 15 consultas, nenhuma da IA, nenhuma futura, nenhuma com unidade; 1
-- janela; os 2 convenios das clinicas reais com "Carteirinha obrigatoria".
-- Nenhuma linha muda de valor: as colunas novas nascem falsas ou nulas e as
-- tabelas, vazias.
--
-- TRAVAS (medidas no Postgres local: pg_locks da transacao depois da
-- migration). TODAS no comeco, no bloco 0, antes de qualquer mudanca, numa
-- ordem fixa e cada uma ja no modo mais forte que a migration pede na
-- tabela: ai_agent_config, ai_decision_log e slot_hold em ACCESS EXCLUSIVE
-- (os ALTER); appointment (o gatilho e a FK da tabela nova), unit (a FK da
-- unidade da reserva) e clinic (as FKs das tabelas novas) em SHARE ROW
-- EXCLUSIVE. Cada tentativa pede as seis com NOWAIT; com uma ocupada, solta
-- as que pegou (o savepoint do bloco), espera 100 ms SEM trava nenhuma e
-- tenta de novo, ate 30 vezes (uns 3 s); depois falha inteira com 55P03,
-- nada gravado: rodar de novo. Assim a migration nunca espera trava com
-- outra na mao e nao fecha ciclo (40P01) com sessao nenhuma (o teste de
-- concorrencia do harness prova: ~/.claude/plans/agente-completo/ag3/banco/
-- travas). Depois do bloco, so pede travas que ja tem (ou mais fracas, nas
-- mesmas tabelas) e nunca espera; o lock_timeout de 3 s fica de rede. Os
-- DROP e CREATE de funcao (a conferencia, o reservar e, na revisao final, o
-- agendar) so pegam a trava do objeto da funcao, que ninguem segura (chamar
-- a funcao nao trava nada). A revisao final nao trouxe trava nova, nem na
-- migration (medido de novo: as mesmas tabelas, nos mesmos modos) nem nas
-- RPCs (o ja_tem_consulta do reservar e a janela no registrar, no agendar e
-- no ler sao leituras sem trava; o registrar apaga a linha de outra janela
-- sob a mesma trava da conversa).
-- Quanto tempo: do bloco ao commit, de 18 a 22 ms no Postgres local (5
-- rodadas, com o commit): os ADD COLUMN sao so de catalogo (o default
-- constante nao reescreve), o VALIDATE varre 3 linhas e o resto e catalogo.
-- Nesse tempo ai_agent_config, ai_decision_log e slot_hold nem leem nem
-- gravam (o turno da IA e a Agenda esperam os milissegundos); appointment,
-- unit e clinic seguem lendo, e a escrita nelas espera. Nenhuma trava em
-- message, conversation, contact, clinic_member, job_queue, audit_log nem
-- ia_janela_da_conversa. Horario calmo.
--
-- ORDEM DE PUBLICACAO: as duas da branch (20261027100000 e 20261027110000),
-- esta migration, os tipos (lib/supabase/database.types.ts foi escrito a mao
-- no formato do gerador; regenerar depois de aplicar) e SO DEPOIS o codigo da
-- AG3. Esta migration com o codigo de hoje: o reservar e o agendar seguem
-- chamando igual (5 e 3 parametros por nome; p_unit_id e p_slot_hold_id
-- nulos: a unidade nula e a reserva viva, como hoje), e nenhuma versao que
-- existe exige nome, nascimento nem CPF. O que muda sao recusas que o codigo
-- de hoje nao conhece (lerRespostaDaReserva e lerRespostaDoAgendar devolvem
-- nulo, o turno falha fechado e a conversa vai para a equipe), e so numa
-- clinica com Agendar ligada (nenhuma, em 27/10/2026): no reservar,
-- ja_tem_consulta (o contato ja tem consulta futura ativa do mesmo
-- procedimento); no agendar, ja_tem_consulta, menor_de_idade (o contato com
-- nascimento de menor no cadastro) e faltam_dados com a carteirinha, que nao
-- depende de exige_*: na consulta pelo convenio com "Carteirinha obrigatoria"
-- (insurance.requires_card; os 2 convenios das clinicas reais tem) ou com o
-- requisito carteirinha do procedimento, o codigo de hoje nao registra a
-- carteirinha e a IA nao marca. consulta_para_outra_pessoa e
-- reserva_diferente nao acontecem com o codigo de hoje (ele nao registra
-- dados nem passa a reserva). O codigo da AG3 antes desta migration: as RPCs
-- novas nao existem (PGRST202), a aba do agente nao carrega (42703 nas
-- colunas exige_*) e o agendar com p_slot_hold_id nao existe (PGRST202). Tres
-- casos dos testes de unidade quebram assim que este arquivo entra no
-- repositorio (os espelhos do CHECK e do rotulo:
-- tests/unit/agente/config.test.ts, 1, e
-- tests/unit/ia-whatsapp/espelhos.test.ts, 2), ate o codigo trazer os tres
-- motivos novos (MOTIVOS_DE_ESCALONAMENTO, o rotulo e TEXTO_DO_EVENTO_DA_IA)
-- e o espelhos.test.ts aceitar o NOT VALID depois do CHECK (como
-- tests/unit/conformidade/categorias.test.ts ja faz com o da AG2): este
-- arquivo e essa mudanca entram no MESMO commit. A bateria do prebuild
-- (tests/unit/conformidade) nao le este CHECK.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo da AG3, DEPOIS, numa
-- transacao, no SQL editor, supabase/operacao/rollback/20261027120000-corpos-
-- anteriores.sql (os sete corpos de antes, com os comentarios e os grants; o
-- agendar de 4 parametros, o reservar de 6 e a conferencia de 7 saem e os
-- de antes voltam; as funcoes, as tabelas, as colunas e os gatilhos novos
-- saem; o CHECK de antes, NOT VALID se ja houver decisao com motivo novo;
-- confere no fim; as travas dele estao no cabecalho dele). SE PERDE: o
-- estado dos atendimentos, os dados informados ainda nao aplicados (o que a
-- aprovacao aplicou fica no contato), a unidade das reservas (a consulta
-- guarda a dela) e as escolhas de exige_*.
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
      lock table public.ai_agent_config, public.ai_decision_log, public.slot_hold
        in access exclusive mode nowait;
      lock table public.appointment, public.unit, public.clinic
        in share row exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 30 then
        raise exception using errcode = 'lock_not_available',
          message = 'Migration 20261027120000: ai_agent_config, ai_decision_log, slot_hold, appointment, unit ou clinic seguiu ocupada por 3 s. Nada foi gravado: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- ---------------------------------------------------------------------------
-- 1) As funcoes de validacao dos CHECKs (puras)
-- ---------------------------------------------------------------------------

create function public.cpf_valido(p_cpf text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- 11 digitos, nao todos iguais, e os dois digitos verificadores certos
  -- (modulo 11). Nulo ou qualquer outra forma: falso. Nunca lanca (o CASE
  -- garante que so 11 digitos chegam a conta).
  select case
    when p_cpf is null or p_cpf !~ '^[0-9]{11}$' or p_cpf ~ '^([0-9])\1{10}$' then false
    else (
      select (case when s1 % 11 < 2 then 0 else 11 - s1 % 11 end) = substr(p_cpf, 10, 1)::integer
         and (case when s2 % 11 < 2 then 0 else 11 - s2 % 11 end) = substr(p_cpf, 11, 1)::integer
        from (
          select (select sum(substr(p_cpf, i, 1)::integer * (11 - i)) from generate_series(1, 9) as i) as s1,
                 (select sum(substr(p_cpf, i, 1)::integer * (12 - i)) from generate_series(1, 10) as i) as s2
        ) as somas
    )
  end
$$;

comment on function public.cpf_valido(text) is
  'CHECK de dados_informados_na_marcacao.cpf (migration 20261027120000_agendamento_completo_da_ia.sql): 11 digitos, nao todos iguais, com os dois digitos verificadores certos. Nulo ou outra forma: falso. Pura.';

create function public.ia_horarios_oferecidos_validos(p_horarios jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_item jsonb;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_instante constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$';
  v_chave text;
begin
  -- Uma lista de ate 9 horarios oferecidos (os 3 de cada uma das 3 ultimas
  -- buscas), cada um so com as 7 chaves, sem texto livre: o codigo (h1 a
  -- h99), os ids em uuid minusculo, a unidade (uuid ou nulo) e os instantes
  -- em UTC com Z. Codigo repetido nao. Forma errada e falso, nunca erro:
  -- cada conferencia so roda depois da que a protege.
  if p_horarios is null or jsonb_typeof(p_horarios) is distinct from 'array'
     or jsonb_array_length(p_horarios) > 9 then
    return false;
  end if;
  for v_item in select e.value from jsonb_array_elements(p_horarios) as e loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      return false;
    end if;
    if (select count(*) from jsonb_object_keys(v_item)) <> 7
       or not (v_item ?& array['codigo', 'service_link_id', 'professional_id', 'unit_id',
                                'starts_at', 'ends_at', 'oferecido_em'])
    then
      return false;
    end if;
    foreach v_chave in array array['codigo', 'service_link_id', 'professional_id', 'starts_at',
                                   'ends_at', 'oferecido_em'] loop
      if jsonb_typeof(v_item -> v_chave) is distinct from 'string' then
        return false;
      end if;
    end loop;
    if jsonb_typeof(v_item -> 'unit_id') not in ('string', 'null') then
      return false;
    end if;
    if (v_item ->> 'codigo') !~ '^h[1-9][0-9]?$'
       or (v_item ->> 'service_link_id') !~ v_uuid
       or (v_item ->> 'professional_id') !~ v_uuid
       or coalesce((v_item ->> 'unit_id') !~ v_uuid, false)
       or (v_item ->> 'starts_at') !~ v_instante
       or (v_item ->> 'ends_at') !~ v_instante
       or (v_item ->> 'oferecido_em') !~ v_instante
    then
      return false;
    end if;
    if not pg_input_is_valid(v_item ->> 'starts_at', 'timestamptz')
       or not pg_input_is_valid(v_item ->> 'ends_at', 'timestamptz')
       or not pg_input_is_valid(v_item ->> 'oferecido_em', 'timestamptz')
    then
      return false;
    end if;
    -- Com Z explicito, a conversao nao depende do fuso da sessao.
    if (v_item ->> 'ends_at')::timestamptz <= (v_item ->> 'starts_at')::timestamptz then
      return false;
    end if;
  end loop;
  if (select count(distinct e.value ->> 'codigo') from jsonb_array_elements(p_horarios) as e)
     <> jsonb_array_length(p_horarios)
  then
    return false;
  end if;
  return true;
end;
$$;

comment on function public.ia_horarios_oferecidos_validos(jsonb) is
  'CHECK de ia_atendimento.horarios_oferecidos (migration 20261027120000_agendamento_completo_da_ia.sql): lista de ate 9 objetos com exatamente codigo (h1 a h99, sem repetir), service_link_id, professional_id, unit_id (uuid ou nulo), starts_at, ends_at (depois do inicio) e oferecido_em (instantes em UTC com Z). Forma errada e falso, nunca erro. Pura.';

create function public.ia_estado_do_atendimento_valido(p_estado jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_instante constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$';
  v_chave text;
begin
  -- O estado do atendimento como a RPC o le e o grava (e como fica em
  -- ia_atendimento.anterior): um objeto com exatamente as 14 chaves, so
  -- listas fechadas, ids e instantes, nunca texto livre. Forma errada e
  -- falso, nunca erro: cada conferencia so roda depois da que a protege.
  if p_estado is null or jsonb_typeof(p_estado) is distinct from 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(p_estado)) <> 14
     or not (p_estado ?& array['etapa', 'intencao', 'procedure_id', 'professional_id', 'insurance_id',
                                'particular', 'unit_id', 'horarios_oferecidos', 'slot_hold_id',
                                'appointment_id', 'pedido_pendente', 'pedido_pendente_em',
                                'falhas_seguidas', 'desfecho'])
  then
    return false;
  end if;
  -- Os tipos de cada chave.
  if jsonb_typeof(p_estado -> 'etapa') is distinct from 'string'
     or jsonb_typeof(p_estado -> 'intencao') not in ('string', 'null')
     or jsonb_typeof(p_estado -> 'particular') not in ('boolean', 'null')
     or jsonb_typeof(p_estado -> 'pedido_pendente') not in ('string', 'null')
     or jsonb_typeof(p_estado -> 'pedido_pendente_em') not in ('string', 'null')
     or jsonb_typeof(p_estado -> 'falhas_seguidas') is distinct from 'number'
     or jsonb_typeof(p_estado -> 'desfecho') not in ('string', 'null')
  then
    return false;
  end if;
  foreach v_chave in array array['procedure_id', 'professional_id', 'insurance_id', 'unit_id',
                                 'slot_hold_id', 'appointment_id'] loop
    if jsonb_typeof(p_estado -> v_chave) not in ('string', 'null')
       or coalesce((p_estado ->> v_chave) !~ v_uuid, false)
    then
      return false;
    end if;
  end loop;
  -- As listas fechadas (nulo onde pode).
  if (p_estado ->> 'etapa') not in ('informacao', 'escolha', 'oferta', 'aguardando_confirmacao',
                                    'pos_marcacao', 'remarcar', 'cancelar')
     or coalesce((p_estado ->> 'intencao') not in ('informacao', 'agendar', 'remarcar', 'cancelar',
                                                    'confirmar'), false)
     or coalesce((p_estado ->> 'pedido_pendente') not in ('cancelar', 'remarcar'), false)
     or coalesce((p_estado ->> 'desfecho') not in ('marcou', 'remarcou', 'cancelou', 'confirmou',
                                                    'passou_para_equipe', 'sem_marcacao'), false)
     or (p_estado ->> 'falhas_seguidas') !~ '^[0-9]{1,2}$'
  then
    return false;
  end if;
  if (p_estado ->> 'falhas_seguidas')::integer > 20 then
    return false;
  end if;
  -- O pedido pendente e o instante dele andam juntos; o instante, em UTC
  -- com Z. Particular e convenio nao andam juntos.
  if (jsonb_typeof(p_estado -> 'pedido_pendente') = 'null')
       <> (jsonb_typeof(p_estado -> 'pedido_pendente_em') = 'null')
     or ((p_estado -> 'particular') = 'true'::jsonb
         and jsonb_typeof(p_estado -> 'insurance_id') <> 'null')
  then
    return false;
  end if;
  if jsonb_typeof(p_estado -> 'pedido_pendente_em') = 'string'
     and ((p_estado ->> 'pedido_pendente_em') !~ v_instante
          or not pg_input_is_valid(p_estado ->> 'pedido_pendente_em', 'timestamptz'))
  then
    return false;
  end if;
  return public.ia_horarios_oferecidos_validos(p_estado -> 'horarios_oferecidos');
end;
$$;

comment on function public.ia_estado_do_atendimento_valido(jsonb) is
  'A forma do estado do atendimento da IA (migration 20261027120000_agendamento_completo_da_ia.sql), a que ler_atendimento_da_ia devolve e gravar_atendimento_da_ia recebe, e o CHECK de ia_atendimento.anterior: objeto com exatamente etapa, intencao, procedure_id, professional_id, insurance_id, particular, unit_id, horarios_oferecidos, slot_hold_id, appointment_id, pedido_pendente, pedido_pendente_em, falhas_seguidas (0 a 20) e desfecho, so listas fechadas, ids em uuid minusculo e instantes em UTC com Z. Forma errada e falso, nunca erro. Pura.';

-- ---------------------------------------------------------------------------
-- 2) ai_agent_config: os dados que a clinica exige para a IA marcar
-- ---------------------------------------------------------------------------
-- As versoes que ja existem leem falso (o codigo de hoje marca sem pedir
-- dado nenhum); a versao nova nasce com o padrao do dono (D-6): nome
-- completo e nascimento, sim; CPF, nao.

alter table public.ai_agent_config
  add column exige_nome_completo boolean not null default false,
  add column exige_nascimento boolean not null default false,
  add column exige_cpf boolean not null default false;

alter table public.ai_agent_config
  alter column exige_nome_completo set default true,
  alter column exige_nascimento set default true;

-- As mesmas permissoes por coluna de skills (a tabela nao tem grant de
-- tabela para authenticated, so por coluna, e nada para anon). A policy de
-- UPDATE continua so no rascunho, so administrador e gestor (e o super
-- admin); a publicada nao muda (proteger_versao_publicada_do_agente).
grant select (exige_nome_completo, exige_nascimento, exige_cpf),
      update (exige_nome_completo, exige_nascimento, exige_cpf)
  on public.ai_agent_config to authenticated;

comment on column public.ai_agent_config.exige_nome_completo is
  'A IA so marca consulta com o nome completo do paciente informado (AG3, D-6). Versionada: vale ao publicar; o rascunho copia a ultima publicada. Padrao (a primeira versao da clinica): sim. As versoes de antes da migration 20261027120000 leem falso.';
comment on column public.ai_agent_config.exige_nascimento is
  'A IA so marca consulta com a data de nascimento do paciente informada (AG3, D-6). Versionada: vale ao publicar; o rascunho copia a ultima publicada. Padrao (a primeira versao da clinica): sim. As versoes de antes da migration 20261027120000 leem falso.';
comment on column public.ai_agent_config.exige_cpf is
  'A IA so marca consulta com o CPF do paciente informado (AG3, D-6: so se a clinica ligar). Versionada: vale ao publicar; o rascunho copia a ultima publicada. Padrao: nao.';

create or replace function public.agente_garantir_rascunho(p_clinic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_versao integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ai_agent_config:' || p_clinic_id::text, 0)
  );

  select a.id into v_id
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'rascunho';
  if found then
    return v_id;
  end if;

  select coalesce(max(a.version), 0) + 1 into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id;

  begin
    insert into public.ai_agent_config (
      clinic_id, version, agent_name, tone, use_emoji, greeting, closing,
      skills, operating_mode, fallback_minutes, operating_hours,
      escalation_rules, instrucoes
      -- [agenda da ia] inicio
      , agenda_antecedencia_horas, agenda_horizonte_dias
      -- [agenda da ia] fim
      -- [onda 2: publico da ia] inicio
      , publico_atendido
      -- [onda 2: publico da ia] fim
      -- [agendamento completo] inicio
      , exige_nome_completo, exige_nascimento, exige_cpf
      -- [agendamento completo] fim
    )
    select p_clinic_id, v_versao, a.agent_name, a.tone, a.use_emoji,
           a.greeting, a.closing, a.skills, a.operating_mode,
           a.fallback_minutes, a.operating_hours, a.escalation_rules,
           a.instrucoes
           -- [agenda da ia] inicio
           , a.agenda_antecedencia_horas, a.agenda_horizonte_dias
           -- [agenda da ia] fim
           -- [onda 2: publico da ia] inicio
           , a.publico_atendido
           -- [onda 2: publico da ia] fim
           -- [agendamento completo] inicio
           , a.exige_nome_completo, a.exige_nascimento, a.exige_cpf
           -- [agendamento completo] fim
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
       and a.status = 'publicada'
     order by a.version desc
     limit 1
    returning id into v_id;

    if v_id is null then
      insert into public.ai_agent_config (clinic_id, version)
      values (p_clinic_id, v_versao)
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'CZ409',
      message = 'O agente de IA foi alterado ao mesmo tempo por outra pessoa. Tente de novo.';
  end;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'criou_rascunho_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$function$;

comment on function public.agente_garantir_rascunho(uuid) is
  'Interna (sem guarda de papel). Trava a clinica (consultiva ai_agent_config:<clinica>) e devolve o rascunho; sem rascunho, cria um copiando a ultima publicada (inclusive instrucoes, antecedencia e horizonte da agenda, o publico atendido e os dados que a IA exige para marcar) ou os padroes, com version = max + 1, e grava audit_log criou_rascunho_do_agente. Corrida com um INSERT direto do sistema: CZ409.';

create or replace function public.restaurar_versao_do_agente(p_clinic_id uuid, p_versao integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_origem public.ai_agent_config%rowtype;
  v_id uuid;
begin
  if p_clinic_id is null or p_versao is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e a versão.';
  end if;
  perform public.agente_exigir_quem_configura(p_clinic_id);
  perform public.agente_exigir_fase_controlada(p_clinic_id);

  select * into v_origem
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.version = p_versao
     and a.status = 'publicada';
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Versão não encontrada.';
  end if;

  v_id := public.agente_garantir_rascunho(p_clinic_id);

  update public.ai_agent_config
     set agent_name = v_origem.agent_name,
         -- [agenda da ia] inicio
         agenda_antecedencia_horas = v_origem.agenda_antecedencia_horas,
         agenda_horizonte_dias = v_origem.agenda_horizonte_dias,
         -- [agenda da ia] fim
         -- [onda 2: publico da ia] inicio
         publico_atendido = v_origem.publico_atendido,
         -- [onda 2: publico da ia] fim
         -- [agendamento completo] inicio
         exige_nome_completo = v_origem.exige_nome_completo,
         exige_nascimento = v_origem.exige_nascimento,
         exige_cpf = v_origem.exige_cpf,
         -- [agendamento completo] fim
         tone = v_origem.tone,
         use_emoji = v_origem.use_emoji,
         greeting = v_origem.greeting,
         closing = v_origem.closing,
         skills = v_origem.skills,
         operating_mode = v_origem.operating_mode,
         fallback_minutes = v_origem.fallback_minutes,
         operating_hours = v_origem.operating_hours,
         escalation_rules = v_origem.escalation_rules,
         instrucoes = v_origem.instrucoes
   where id = v_id;

  -- A base viva passa a valer como a congelada daquela versao, sem apagar
  -- nada: o item ativo que nao esta nela fica DESATIVADO (guardado, como a
  -- tela promete; os ja desativados ficam como estao), volta com a mesma id
  -- o que foi excluido, e o que esta nela fica com o texto dela e ativo.
  update public.knowledge_item k
     set active = false
   where k.clinic_id = p_clinic_id
     and k.active
     and not exists (
       select 1
         from jsonb_array_elements(v_origem.conhecimento) e
        where (e ->> 'id')::uuid = k.id
     );

  insert into public.knowledge_item as k (id, clinic_id, question, answer, active)
  select (e ->> 'id')::uuid, p_clinic_id, e ->> 'pergunta', e ->> 'resposta', true
    from jsonb_array_elements(v_origem.conhecimento) e
  on conflict (id) do update
     set question = excluded.question,
         answer = excluded.answer,
         active = true
   where k.clinic_id = excluded.clinic_id
     and (k.question, k.answer, k.active)
         is distinct from (excluded.question, excluded.answer, true);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'restaurou_versao_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$function$;

comment on function public.restaurar_versao_do_agente(uuid, integer) is
  'O rascunho (garantido) passa a ter os campos da versao publicada p_versao, inclusive as instrucoes, a antecedencia e o horizonte da agenda, o publico atendido e os dados que a IA exige para marcar, e a base viva (knowledge_item) passa a valer como a base congelada dela: mesmas ids, ativas e com o texto dela (a excluida volta); o item fora dela fica desativado, nunca apagado. Administrador ou gestor ativo com escrita, super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501); versao inexistente ou nao publicada: P0002. Devolve o id do rascunho. Grava audit_log.';

-- ---------------------------------------------------------------------------
-- 3) ai_decision_log: os motivos novos de passar para a equipe, e o evento
--    de cada um no fio
-- ---------------------------------------------------------------------------
-- O CHECK de hoje (20261022110000) inteiro, mais tres. Drop e add com o
-- MESMO nome, NOT VALID (o add nao varre a tabela) e VALIDATE em seguida
-- (toda linha valida no CHECK antigo e valida no novo, que so acrescenta).

alter table public.ai_decision_log
  drop constraint ai_decision_log_escalation_reason_valida;

alter table public.ai_decision_log
  add constraint ai_decision_log_escalation_reason_valida
    check (escalation_reason is null or escalation_reason in (
      'sintoma', 'pedido_humano', 'insatisfacao', 'menor_de_idade',
      'valor_fora_da_tabela', 'falhas_seguidas', 'assunto_clinico',
      'midia_nao_suportada', 'tentativa_de_manipulacao', 'conformidade',
      'agente_pediu', 'teto_atingido', 'regra_do_procedimento',
      'falha_tecnica', 'teto_de_respostas', 'nao_individual',
      'pedido_de_agenda', 'fora_do_assunto',
      'consulta_para_outra_pessoa', 'ja_tem_consulta', 'faltam_dados')) not valid;

alter table public.ai_decision_log
  validate constraint ai_decision_log_escalation_reason_valida;

create or replace function public.rotulo_do_motivo_da_ia(p_motivo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
    -- [onda 2: fora do assunto] inicio
    when 'fora_do_assunto' then 'A IA passou a conversa para a equipe: a pessoa insistiu num assunto fora da clínica.'
    -- [onda 2: fora do assunto] fim
    -- [agendamento completo] inicio
    when 'consulta_para_outra_pessoa' then 'A IA passou a conversa para a equipe: a consulta é para outra pessoa.'
    when 'ja_tem_consulta' then 'A IA passou a conversa para a equipe: o paciente já tem consulta marcada deste procedimento.'
    when 'faltam_dados' then 'A IA passou a conversa para a equipe: faltaram dados do paciente para marcar.'
    -- [agendamento completo] fim
    when 'teto_atingido' then 'A IA passou a conversa para a equipe: o limite de gasto de hoje acabou.'
    when 'regra_do_procedimento' then 'A IA passou a conversa para a equipe: o procedimento pede contato da equipe.'
    when 'falha_tecnica' then 'A IA passou a conversa para a equipe: o assistente teve uma falha técnica.'
    when 'teto_de_respostas' then 'A IA passou a conversa para a equipe: o limite de respostas desta conversa na última hora acabou.'
    when 'pedido_de_agenda' then 'A IA passou a conversa para a equipe: o paciente quer marcar, remarcar ou cancelar.'
    when 'nao_individual' then 'Chegou uma mensagem de grupo ou de status. A conversa voltou para a equipe.'
    when 'fora_do_horario' then 'A IA passou a conversa para a equipe: agora está fora do horário escolhido para o assistente.'
    -- [onda 2: horario da ia] inicio
    when 'horario_nao_suportado' then 'O assistente não atende pelo WhatsApp no modo de horário escolhido. A conversa ficou com a equipe.'
    when 'no_expediente' then 'O assistente não respondeu: agora é o horário da equipe. Se ninguém da equipe responder, ele assume quando o horário dele começar.'
    when 'retomou_no_horario' then 'Começou o horário do assistente: ele assumiu esta conversa, que ninguém da equipe tinha respondido.'
    -- [onda 2: horario da ia] fim
    when 'sem_versao_publicada' then 'A IA passou a conversa para a equipe: o assistente ainda não tem versão publicada.'
    when 'liberacao_perdida' then 'A IA passou a conversa para a equipe: o assistente deixou de estar liberado para este telefone ou este número.'
    when 'numero_desconectado' then 'A IA passou a conversa para a equipe: o número do assistente está desconectado.'
    when 'envio_incerto' then 'A IA pode não ter enviado a última resposta. A conversa voltou para a equipe.'
    when 'aviso_nao_enviado' then 'O aviso automático ao contato não foi enviado.'
    when 'celular' then 'Alguém respondeu pelo celular. A IA parou de responder nesta conversa.'
    when 'sem_resposta' then 'A IA não respondeu a tempo. A conversa voltou para a equipe.'
    when 'desligada' then 'O assistente foi desligado. A conversa voltou para a equipe.'
    -- [parada neutra] inicio
    when 'parada' then 'O assistente não atendeu esta mensagem: ele está parado para este telefone ou este número.'
    -- [parada neutra] fim
    when 'sem_autorizacao' then 'A IA passou a conversa para a equipe: o contato não tem autorização para receber mensagens.'
  end
$function$;

-- ---------------------------------------------------------------------------
-- 4) slot_hold.unit_id: a unidade da reserva
-- ---------------------------------------------------------------------------

alter table public.slot_hold
  add column unit_id uuid
    constraint slot_hold_unit_id_fkey references public.unit (id) on delete set null;

create index slot_hold_unit_id_idx
  on public.slot_hold (unit_id)
  where unit_id is not null;

comment on column public.slot_hold.unit_id is
  'A unidade em que a IA reservou (AG3; nula = como antes, a jornada de todas as unidades). Da clinica (gatilho exigir_unidade_da_reserva_da_mesma_clinica). agendar_pela_ia passa para a consulta.';

create function public.exigir_unidade_da_reserva_da_mesma_clinica()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A FK so confere existencia, e a checagem de FK ignora RLS: sem isto, a
  -- reserva (inclusive a da recepcao, pela sessao) apontava a unidade de
  -- outra clinica. A frase de sempre.
  if new.unit_id is not null and not exists (
    select 1 from public.unit u
     where u.id = new.unit_id
       and u.clinic_id = new.clinic_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'A unidade informada não pertence a esta clínica.';
  end if;
  return new;
end;
$$;

revoke all on function public.exigir_unidade_da_reserva_da_mesma_clinica()
  from public, anon, authenticated, service_role;

comment on function public.exigir_unidade_da_reserva_da_mesma_clinica() is
  'Gatilho de slot_hold (migration 20261027120000_agendamento_completo_da_ia.sql): a unidade da reserva e da clinica da linha, senao 23503. Funcao propria, em vez de mais um ramo em exigir_cadastro_da_mesma_clinica (que nao muda).';

create trigger exigir_unidade_da_reserva_da_mesma_clinica
  before insert or update of clinic_id, unit_id
  on public.slot_hold
  for each row execute function public.exigir_unidade_da_reserva_da_mesma_clinica();

-- ---------------------------------------------------------------------------
-- 5) ia_atendimento: o estado do atendimento da IA entre os turnos
-- ---------------------------------------------------------------------------

create table public.ia_atendimento (
  id uuid not null default gen_random_uuid(),
  clinic_id uuid not null,
  -- Sem FK para conversation (como ai_turno e ia_janela_da_conversa): nao
  -- trava a tabela quente. A RPC confere a conversa; a poda tira a orfa.
  conversation_id uuid not null,
  -- O desde da janela (ia_janela_da_conversa) em que o estado vale: o
  -- Devolver abre janela nova, e o estado comeca do zero.
  janela_desde timestamptz not null,
  etapa text not null default 'informacao',
  intencao text,
  procedure_id uuid,
  professional_id uuid,
  insurance_id uuid,
  particular boolean,
  unit_id uuid,
  horarios_oferecidos jsonb not null default '[]'::jsonb,
  slot_hold_id uuid,
  appointment_id uuid,
  pedido_pendente text,
  pedido_pendente_em timestamptz,
  falhas_seguidas integer not null default 0,
  desfecho text,
  -- O ultimo job que gravou (sem FK: a fila e podada), a versao e o estado
  -- de antes dele (a idempotencia por job: o mesmo job, de novo, parte do
  -- mesmo estado).
  job_id uuid not null,
  versao integer not null default 1,
  anterior jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ia_atendimento_pkey primary key (id),
  constraint ia_atendimento_clinic_id_fkey
    foreign key (clinic_id) references public.clinic (id) on delete cascade,
  constraint ia_atendimento_um_por_janela unique (conversation_id, janela_desde),
  constraint ia_atendimento_etapa_valida check (
    etapa in ('informacao', 'escolha', 'oferta', 'aguardando_confirmacao', 'pos_marcacao',
              'remarcar', 'cancelar')),
  constraint ia_atendimento_intencao_valida check (
    intencao in ('informacao', 'agendar', 'remarcar', 'cancelar', 'confirmar')),
  constraint ia_atendimento_pagamento_coerente check (
    particular is distinct from true or insurance_id is null),
  constraint ia_atendimento_horarios_validos check (
    public.ia_horarios_oferecidos_validos(horarios_oferecidos)),
  constraint ia_atendimento_pedido_valido check (
    pedido_pendente in ('cancelar', 'remarcar')),
  constraint ia_atendimento_pedido_coerente check (
    (pedido_pendente is null) = (pedido_pendente_em is null)),
  constraint ia_atendimento_falhas_validas check (
    falhas_seguidas between 0 and 20),
  constraint ia_atendimento_desfecho_valido check (
    desfecho in ('marcou', 'remarcou', 'cancelou', 'confirmou', 'passou_para_equipe', 'sem_marcacao')),
  constraint ia_atendimento_versao_valida check (versao > 0),
  constraint ia_atendimento_anterior_valido check (
    anterior is null or public.ia_estado_do_atendimento_valido(anterior))
);

create index ia_atendimento_clinic_id_idx
  on public.ia_atendimento (clinic_id);

create trigger set_updated_at
  before update on public.ia_atendimento
  for each row execute function public.set_updated_at();

-- RLS ligada, sem policy: nenhuma sessao le nem grava. A service role so le
-- (a escrita e so pela RPC gravar_atendimento_da_ia).
alter table public.ia_atendimento enable row level security;
revoke all on table public.ia_atendimento from anon, authenticated, service_role;
grant select on table public.ia_atendimento to service_role;

comment on table public.ia_atendimento is
  'O estado do atendimento da IA entre os turnos (AG3, migration 20261027120000_agendamento_completo_da_ia.sql), um por conversa e janela (ia_janela_da_conversa.desde): etapa, intencao, procedimento, profissional, convenio ou particular, unidade, os horarios oferecidos (ate 9, com o codigo), a reserva viva, a consulta em foco, o pedido de cancelar ou remarcar e quando, as falhas seguidas e o desfecho. Nunca texto do paciente: so listas fechadas, ids e instantes. Lida e gravada pelo servidor so pelas RPCs ler_atendimento_da_ia e gravar_atendimento_da_ia (idempotentes por job); o Devolver (janela nova) zera; podada 30 dias depois de a conversa ser resolvida (podar_agendamento_da_ia). Nenhuma sessao le.';
comment on column public.ia_atendimento.janela_desde is
  'O desde da janela da conversa (ia_janela_da_conversa) em que este estado vale. Janela nova (Devolver): estado novo; o da janela anterior sai na gravacao seguinte e na poda.';
comment on column public.ia_atendimento.horarios_oferecidos is
  'Os horarios que a IA ofereceu (ate 9): codigo (h1 a h99), service_link_id, professional_id, unit_id, starts_at, ends_at e oferecido_em, em UTC. CHECK por ia_horarios_oferecidos_validos.';
comment on column public.ia_atendimento.anterior is
  'O estado de antes do job que gravou por ultimo (job_id), na forma de ia_estado_do_atendimento_valido: o mesmo job, ao tentar de novo, le este (idempotencia por job).';
comment on column public.ia_atendimento.versao is
  'Sobe a cada gravacao de um job novo. gravar_atendimento_da_ia so aceita a versao que o job leu (senao estado_mudou).';

-- ---------------------------------------------------------------------------
-- 6) dados_informados_na_marcacao: o que o paciente informou para marcar
-- ---------------------------------------------------------------------------

create table public.dados_informados_na_marcacao (
  id uuid not null default gen_random_uuid(),
  clinic_id uuid not null,
  -- Sem FK para conversation e contact (tabelas quentes): a RPC confere; a
  -- poda tira a orfa.
  conversation_id uuid not null,
  contact_id uuid not null,
  -- [revisao final] A janela da IA (ia_janela_da_conversa.desde) em que a
  -- linha foi aberta. So vale a da janela atual: o Devolver abre janela
  -- nova, e a linha de antes (inclusive a marca de outra pessoa) deixa de
  -- valer.
  janela_desde timestamptz not null,
  slot_hold_id uuid,
  appointment_id uuid,
  nome_completo text,
  data_nascimento date,
  cpf text,
  carteirinha text,
  para_o_titular boolean not null,
  job_id uuid not null,
  aplicado_em timestamptz,
  aplicado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dados_informados_na_marcacao_pkey primary key (id),
  constraint dados_informados_na_marcacao_clinic_id_fkey
    foreign key (clinic_id) references public.clinic (id) on delete cascade,
  constraint dados_informados_na_marcacao_slot_hold_id_fkey
    foreign key (slot_hold_id) references public.slot_hold (id) on delete set null,
  constraint dados_informados_na_marcacao_appointment_id_fkey
    foreign key (appointment_id) references public.appointment (id) on delete cascade,
  constraint dados_informados_na_marcacao_nome_valido check (
    public.cadastro_texto_valido(nome_completo, 120) and char_length(nome_completo) >= 2),
  constraint dados_informados_na_marcacao_nascimento_valido check (
    data_nascimento >= date '1900-01-01'),
  constraint dados_informados_na_marcacao_cpf_valido check (
    cpf is null or public.cpf_valido(cpf)),
  constraint dados_informados_na_marcacao_carteirinha_valida check (
    public.cadastro_texto_valido(carteirinha, 60)),
  -- Dado de outra pessoa nunca fica: so a marca de que a consulta e para
  -- outra pessoa (D-8: a IA passa para a equipe).
  constraint dados_informados_na_marcacao_so_do_titular check (
    para_o_titular
    or (nome_completo is null and data_nascimento is null and cpf is null and carteirinha is null)),
  constraint dados_informados_na_marcacao_aplicacao_coerente check (
    (aplicado_em is null or appointment_id is not null)
    and (aplicado_por is null or aplicado_em is not null))
);

-- Uma linha aberta (ainda sem consulta) por conversa; uma por consulta.
create unique index dados_informados_na_marcacao_aberta_por_conversa
  on public.dados_informados_na_marcacao (conversation_id)
  where appointment_id is null;
create unique index dados_informados_na_marcacao_uma_por_consulta
  on public.dados_informados_na_marcacao (appointment_id)
  where appointment_id is not null;
create index dados_informados_na_marcacao_clinic_id_idx
  on public.dados_informados_na_marcacao (clinic_id);
create index dados_informados_na_marcacao_slot_hold_id_idx
  on public.dados_informados_na_marcacao (slot_hold_id)
  where slot_hold_id is not null;

create trigger set_updated_at
  before update on public.dados_informados_na_marcacao
  for each row execute function public.set_updated_at();

-- RLS ligada, sem policy: nenhuma sessao le nem grava a tabela. A leitura
-- humana e so por ler_dados_informados_na_marcacao (que grava audit_log); a
-- escrita, so por registrar_dados_da_marcacao (o servidor), agendar_pela_ia
-- e o gatilho da aprovacao. A service role so le.
alter table public.dados_informados_na_marcacao enable row level security;
revoke all on table public.dados_informados_na_marcacao from anon, authenticated, service_role;
grant select on table public.dados_informados_na_marcacao to service_role;

comment on table public.dados_informados_na_marcacao is
  'O que o paciente informou a IA para marcar (AG3, D-7; migration 20261027120000_agendamento_completo_da_ia.sql): nome completo, nascimento, CPF (so digitos, com digito verificador) e carteirinha, e se a consulta e para ele mesmo. Uma linha aberta por conversa ate o agendar, que a liga a reserva consumida e a consulta; so vale a da janela atual da IA (janela_desde); aplicada ao cadastro do contato na APROVACAO da consulta, so nos campos vazios (gatilho dados_informados_na_aprovacao). Dado de saude e pessoal: nenhuma sessao le a tabela; a leitura humana e por ler_dados_informados_na_marcacao, com trilha. Podada pela manutencao (podar_agendamento_da_ia).';
comment on column public.dados_informados_na_marcacao.contact_id is
  'O contato da conversa quando o dado foi informado. Contato trocado na conversa: a linha nao vale para o contato novo.';
comment on column public.dados_informados_na_marcacao.janela_desde is
  'A janela da IA na conversa (ia_janela_da_conversa.desde) em que a linha foi aberta. So vale a linha aberta da janela atual: registrar_dados_da_marcacao, agendar_pela_ia e ler_atendimento_da_ia ignoram a de outra janela (a marca de consulta para outra pessoa nao sobrevive ao Devolver); o registrar a apaga na gravacao seguinte, e a poda, 7 dias depois de mexida.';
comment on column public.dados_informados_na_marcacao.para_o_titular is
  'A consulta e para o proprio contato da conversa. Falso: nenhum dado pessoal fica (CHECK) e o agendar recusa (consulta_para_outra_pessoa, D-8).';
comment on column public.dados_informados_na_marcacao.aplicado_em is
  'Quando a aprovacao da consulta aplicou os dados ao cadastro do contato (so nos campos vazios). aplicado_por: quem aprovou (nulo sem sessao).';

-- ---------------------------------------------------------------------------
-- 7) As funcoes internas
-- ---------------------------------------------------------------------------

-- 7a. As conferencias do reservar e do agendar, agora com a unidade.
drop function public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid);

create function public.conferir_horario_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_service_link_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reserva_propria uuid,
  p_unit_id uuid,
  out o_motivo text,
  out o_contato uuid,
  out o_profissional uuid,
  out o_fim timestamptz,
  out o_recurso uuid,
  out o_fuso text,
  out o_procedimento text,
  out o_nome_do_profissional text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_conversa record;
  v_config record;
  v_vinculo record;
  v_na_jornada boolean;
begin
  -- 4. A conversa e da clinica, esta com a IA, e a IA pode atender este
  -- contato neste numero (a mesma pergunta da ingestao e do envio).
  select c.whatsapp_account_id, c.contact_id, c.status, k.phone_key
    into v_conversa
    from public.conversation c
    join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  if not found
     or v_conversa.status is distinct from 'ia_atendendo'
     or not public.ia_pode_atender(p_clinic_id, v_conversa.whatsapp_account_id, v_conversa.phone_key)
  then
    o_motivo := 'ia_desligada';
    return;
  end if;
  o_contato := v_conversa.contact_id;

  -- 5. A versao em uso e a ultima publicada (a que o agente le no WhatsApp):
  -- Agendar ligada e as duas colunas preenchidas. Ninguem inventa valor.
  select a.skills, a.agenda_antecedencia_horas, a.agenda_horizonte_dias
    into v_config
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if not found
     or (v_config.skills ->> 'agendar') is distinct from 'true'
     or v_config.agenda_antecedencia_horas is null
     or v_config.agenda_horizonte_dias is null
  then
    o_motivo := 'agenda_nao_configurada';
    return;
  end if;

  -- 6. O vinculo que a IA pode agendar: ativo, com bookable_by_ai, de
  -- procedimento ativo com bookable_by_ai e de profissional ativo.
  select sl.professional_id, sl.duration_min, pr.resource_id,
         pr.name as procedimento, pf.name as profissional
    into v_vinculo
    from public.service_link sl
    join public.procedure pr on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
    join public.professional pf on pf.id = sl.professional_id and pf.clinic_id = sl.clinic_id
   where sl.id = p_service_link_id
     and sl.clinic_id = p_clinic_id
     and sl.active
     and sl.bookable_by_ai
     and pr.active
     and pr.bookable_by_ai
     and pf.active;
  if not found then
    o_motivo := 'vinculo_invalido';
    return;
  end if;
  o_profissional := v_vinculo.professional_id;
  o_recurso := v_vinculo.resource_id;
  o_procedimento := v_vinculo.procedimento;
  o_nome_do_profissional := v_vinculo.profissional;
  o_fim := coalesce(p_ends_at, p_starts_at + make_interval(mins => v_vinculo.duration_min));
  if o_fim <= p_starts_at then
    o_motivo := 'vinculo_invalido';
    return;
  end if;

  -- [agendamento completo] inicio
  -- 6b. A unidade escolhida (AG3): da clinica e ativa, senao
  -- unidade_invalida. Sem unidade, como antes.
  if p_unit_id is not null and not exists (
    select 1 from public.unit u
     where u.id = p_unit_id
       and u.clinic_id = p_clinic_id
       and u.active
  ) then
    o_motivo := 'unidade_invalida';
    return;
  end if;
  -- [agendamento completo] fim

  -- 7. Antecedencia minima e horizonte, a partir de agora.
  if p_starts_at < now() + make_interval(hours => v_config.agenda_antecedencia_horas) then
    o_motivo := 'antes_da_antecedencia';
    return;
  end if;
  if p_starts_at > now() + make_interval(days => v_config.agenda_horizonte_dias) then
    o_motivo := 'depois_do_horizonte';
    return;
  end if;

  -- 8. A jornada no fuso da clinica, como o motor da Agenda: cada dia civil
  -- local do horario (e a vespera, pela janela que vira o dia) da as faixas
  -- do seu weekday (0 = domingo); faixa com fim <= inicio termina no dia
  -- seguinte; faixas encostadas se somam. O horario cabe inteiro numa delas.
  select coalesce(c.timezone, 'America/Fortaleza') into o_fuso
    from public.clinic c
   where c.id = p_clinic_id;
  o_fuso := coalesce(o_fuso, 'America/Fortaleza');
  select coalesce(
           range_agg(tstzrange(j.inicio, j.fim, '[)')) @> tstzrange(p_starts_at, o_fim, '[)'),
           false)
    into v_na_jornada
    from (
      select (d.dia + s.starts_at) at time zone o_fuso as inicio,
             ((d.dia + case when s.ends_at <= s.starts_at then 1 else 0 end) + s.ends_at)
               at time zone o_fuso as fim
        from generate_series(
               -1,
               (o_fim at time zone o_fuso)::date - (p_starts_at at time zone o_fuso)::date
             ) as g(n)
        cross join lateral (
          select (p_starts_at at time zone o_fuso)::date + g.n as dia
        ) as d
        join public.professional_schedule s
          on s.professional_id = o_profissional
         and s.clinic_id = p_clinic_id
         and s.weekday = extract(dow from d.dia)::smallint
         -- [agendamento completo] inicio
         -- Com unidade, so a jornada dela e a sem unidade (que vale para
         -- todas), como a Agenda (components/agenda, jornadasDoDia).
         and (p_unit_id is null or s.unit_id is null or s.unit_id = p_unit_id)
         -- [agendamento completo] fim
    ) as j;
  if not v_na_jornada then
    o_motivo := 'fora_da_jornada';
    return;
  end if;

  -- 9. O que ja ocupa o horario.
  if exists (
    select 1
      from public.professional_block b
     where b.professional_id = o_profissional
       and b.clinic_id = p_clinic_id
       and b.starts_at < o_fim
       and b.ends_at > p_starts_at
  ) then
    o_motivo := 'bloqueado';
    return;
  end if;
  if exists (
    select 1
      from public.appointment a
     where a.clinic_id = p_clinic_id
       and a.professional_id = o_profissional
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.starts_at < o_fim
       and a.ends_at > p_starts_at
  ) then
    o_motivo := 'ocupado';
    return;
  end if;
  if o_recurso is not null and exists (
    select 1
      from public.appointment a
     where a.clinic_id = p_clinic_id
       and a.resource_id = o_recurso
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.starts_at < o_fim
       and a.ends_at > p_starts_at
  ) then
    o_motivo := 'ocupado';
    return;
  end if;
  if exists (
    select 1
      from public.slot_hold h
     where h.clinic_id = p_clinic_id
       and h.professional_id = o_profissional
       and h.expires_at > now()
       and h.consumido_em is null
       and h.conversation_id is distinct from p_conversation_id
       and h.id is distinct from p_reserva_propria
       and h.starts_at < o_fim
       and h.ends_at > p_starts_at
  ) then
    o_motivo := 'reservado_por_outra_conversa';
    return;
  end if;
  -- [recurso da reserva] (revisao da E4): a reserva viva de OUTRA conversa,
  -- em qualquer profissional, num vinculo cujo procedimento usa o mesmo
  -- recurso. Sem isto, duas conversas reservavam o mesmo horario da mesma
  -- sala (em dois profissionais) e a segunda so descobria no agendar,
  -- depois de o paciente confirmar.
  if o_recurso is not null and exists (
    select 1
      from public.slot_hold h
      join public.service_link sl
        on sl.id = h.service_link_id and sl.clinic_id = h.clinic_id
      join public.procedure pr
        on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
     where h.clinic_id = p_clinic_id
       and pr.resource_id = o_recurso
       and h.expires_at > now()
       and h.consumido_em is null
       and h.conversation_id is distinct from p_conversation_id
       and h.id is distinct from p_reserva_propria
       and h.starts_at < o_fim
       and h.ends_at > p_starts_at
  ) then
    o_motivo := 'reservado_por_outra_conversa';
    return;
  end if;
end;
$$;

revoke execute on function public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid) is
  'Interna (nenhum papel da API executa): as conferencias que reservar_horario_da_ia e agendar_pela_ia repetem, na ordem do contrato da E4, mais a unidade (AG3). o_motivo nulo = pode; senao ia_desligada, agenda_nao_configurada, vinculo_invalido, unidade_invalida (unidade de outra clinica, inativa ou que nao existe), antes_da_antecedencia, depois_do_horizonte, fora_da_jornada (com unidade, so a jornada dela e a sem unidade), bloqueado, ocupado ou reservado_por_outra_conversa. p_ends_at nulo = inicio + duracao do vinculo; p_reserva_propria fica fora da conferencia de reservas; p_unit_id nulo = a jornada de todas as unidades, como antes.';

-- 7b. Os dados que faltam para marcar, pela configuracao publicada em uso
-- e pelo vinculo.
create function public.dados_que_faltam_para_marcar(
  p_clinic_id uuid,
  p_service_link_id uuid,
  p_nome_completo text,
  p_data_nascimento date,
  p_cpf text,
  p_carteirinha text
)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_config record;
  v_vinculo record;
  v_faltam text[] := array[]::text[];
begin
  -- A versao em uso e a ultima publicada (a mesma de conferir_horario_da_ia).
  select a.exige_nome_completo, a.exige_nascimento, a.exige_cpf
    into v_config
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if found then
    if v_config.exige_nome_completo and p_nome_completo is null then
      v_faltam := array_append(v_faltam, 'nome_completo');
    end if;
    if v_config.exige_nascimento and p_data_nascimento is null then
      v_faltam := array_append(v_faltam, 'data_nascimento');
    end if;
    if v_config.exige_cpf and p_cpf is null then
      v_faltam := array_append(v_faltam, 'cpf');
    end if;
  end if;
  -- A carteirinha (D-6: so se a clinica ligar): so na consulta pelo
  -- convenio, quando o convenio tem "Carteirinha obrigatoria"
  -- (insurance.requires_card, o Cadastro de convenios) ou o procedimento tem
  -- o requisito carteirinha ativo para todos ou para esse convenio
  -- (procedure_requirement, o cadastro da AG1).
  if p_carteirinha is null and p_service_link_id is not null then
    select sl.procedure_id, sl.insurance_id into v_vinculo
      from public.service_link sl
     where sl.id = p_service_link_id
       and sl.clinic_id = p_clinic_id;
    if found and v_vinculo.insurance_id is not null and (
      exists (
        select 1
          from public.insurance i
         where i.id = v_vinculo.insurance_id
           and i.clinic_id = p_clinic_id
           and i.requires_card
      )
      or exists (
        select 1
          from public.procedure_requirement q
         where q.clinic_id = p_clinic_id
           and q.procedure_id = v_vinculo.procedure_id
           and q.tipo = 'carteirinha'
           and q.ativo
           and (q.insurance_id is null or q.insurance_id = v_vinculo.insurance_id)
      )
    ) then
      v_faltam := array_append(v_faltam, 'carteirinha');
    end if;
  end if;
  return v_faltam;
end;
$$;

revoke execute on function public.dados_que_faltam_para_marcar(uuid, uuid, text, date, text, text)
  from public, anon, authenticated, service_role;

comment on function public.dados_que_faltam_para_marcar(uuid, uuid, text, date, text, text) is
  'Interna (nenhum papel da API executa): os dados que faltam para a IA marcar, em ordem (nome_completo, data_nascimento, cpf, carteirinha). Os tres primeiros pela ultima versao publicada (exige_nome_completo, exige_nascimento, exige_cpf; sem versao publicada, nenhum). A carteirinha so com vinculo de convenio e, nele, o convenio com Carteirinha obrigatoria (insurance.requires_card) ou o requisito carteirinha ativo do procedimento para todos ou para esse convenio (procedure_requirement). Nulo = nao informado.';

-- 7c. O estado do atendimento em jsonb (a forma de
-- ia_estado_do_atendimento_valido), de uma linha ou o vazio.
create function public.ia_estado_do_atendimento(p_linha public.ia_atendimento)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p_linha.id is null then
    jsonb_build_object(
      'etapa', 'informacao', 'intencao', null, 'procedure_id', null, 'professional_id', null,
      'insurance_id', null, 'particular', null, 'unit_id', null, 'horarios_oferecidos', '[]'::jsonb,
      'slot_hold_id', null, 'appointment_id', null, 'pedido_pendente', null,
      'pedido_pendente_em', null, 'falhas_seguidas', 0, 'desfecho', null)
  else
    jsonb_build_object(
      'etapa', p_linha.etapa,
      'intencao', p_linha.intencao,
      'procedure_id', p_linha.procedure_id,
      'professional_id', p_linha.professional_id,
      'insurance_id', p_linha.insurance_id,
      'particular', p_linha.particular,
      'unit_id', p_linha.unit_id,
      'horarios_oferecidos', p_linha.horarios_oferecidos,
      'slot_hold_id', p_linha.slot_hold_id,
      'appointment_id', p_linha.appointment_id,
      'pedido_pendente', p_linha.pedido_pendente,
      'pedido_pendente_em',
        to_char(p_linha.pedido_pendente_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'falhas_seguidas', p_linha.falhas_seguidas,
      'desfecho', p_linha.desfecho)
  end
$$;

revoke execute on function public.ia_estado_do_atendimento(public.ia_atendimento)
  from public, anon, authenticated, service_role;

comment on function public.ia_estado_do_atendimento(public.ia_atendimento) is
  'Interna (nenhum papel da API executa): a linha de ia_atendimento no jsonb do estado (a forma de ia_estado_do_atendimento_valido); linha nula = o estado vazio (etapa informacao, sem horarios, zero falhas).';

-- ---------------------------------------------------------------------------
-- 8) A reserva e o agendar
-- ---------------------------------------------------------------------------

-- 8a. A IA reserva um horario por 10 minutos, agora com a unidade. Mesmo
-- nome, um parametro a mais com default: o codigo de hoje (5 parametros por
-- nome) continua chamando, e o PostgREST nao ve duas funcoes.
drop function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid);

create function public.reservar_horario_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_service_link_id uuid,
  p_starts_at timestamptz,
  p_job_id uuid,
  p_unit_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profissional uuid;
  v_recurso uuid;
  v_reserva public.slot_hold%rowtype;
  v_conf record;
  -- [revisao final] inicio
  v_ja_marcada uuid;
  v_ja_marcada_em timestamptz;
  -- [revisao final] fim
begin
  if p_clinic_id is null or p_conversation_id is null or p_service_link_id is null
     or p_starts_at is null or p_job_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- Trava da conversa (uma reserva por conversa, mesmo com dois turnos ao
  -- mesmo tempo) e, depois dela, a do profissional do vinculo e, quando o
  -- procedimento tem recurso, a do recurso (ordem fixa: conversa,
  -- profissional, recurso). Vinculo de outra clinica fica sem as duas
  -- ultimas e cai em vinculo_invalido.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );
  select sl.professional_id, pr.resource_id into v_profissional, v_recurso
    from public.service_link sl
    left join public.procedure pr
      on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
   where sl.id = p_service_link_id
     and sl.clinic_id = p_clinic_id;
  if v_profissional is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('slot_hold:' || v_profissional::text, 0)
    );
  end if;
  -- [recurso da reserva] (revisao da E4): duas conversas em dois
  -- profissionais que usam o mesmo recurso esperam uma pela outra.
  if v_recurso is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('slot_hold_recurso:' || v_recurso::text, 0)
    );
  end if;

  -- Idempotencia: a reserva deste job, viva ou consumida, volta como esta.
  select h.* into v_reserva
    from public.slot_hold h
   where h.job_id = p_job_id;
  if found then
    if v_reserva.clinic_id is distinct from p_clinic_id
       or v_reserva.conversation_id is distinct from p_conversation_id then
      raise exception using errcode = '22023', message = 'job_de_outra_conversa';
    end if;
    return jsonb_build_object(
      'ok', true,
      'hold_id', v_reserva.id,
      'starts_at', v_reserva.starts_at,
      'ends_at', v_reserva.ends_at,
      'expires_at', v_reserva.expires_at,
      'reutilizado', true
      -- [agendamento completo] inicio
      , 'unit_id', v_reserva.unit_id
      -- [agendamento completo] fim
    );
  end if;

  select * into v_conf
    from public.conferir_horario_da_ia(
      p_clinic_id, p_conversation_id, p_service_link_id, p_starts_at, null, null
      -- [agendamento completo] a unidade
      , p_unit_id
    );
  if v_conf.o_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', v_conf.o_motivo);
  end if;
  -- O vinculo trocou de profissional (ou o procedimento, de recurso) entre a
  -- trava e a conferencia.
  if v_conf.o_profissional is distinct from v_profissional
     or v_conf.o_recurso is distinct from v_recurso then
    return jsonb_build_object('ok', false, 'motivo', 'vinculo_invalido');
  end if;

  -- [revisao final] inicio
  -- ja_tem_consulta ANTES de reservar (a mesma regra do agendar, que
  -- confere de novo): o contato da conversa ja tem consulta futura ativa do
  -- mesmo procedimento, com qualquer profissional (a pendente da IA conta;
  -- cancelada, recusada, faltou e compareceu nao). Devolve a mais proxima e
  -- o inicio dela (a IA diz so o dia e a hora); nada grava, e a reserva que
  -- a conversa ja tinha fica. Antes, o paciente informava todos os dados e
  -- so no agendar ouvia que ja tinha consulta.
  select a.id, a.starts_at into v_ja_marcada, v_ja_marcada_em
    from public.appointment a
    join public.service_link sl on sl.id = a.service_link_id and sl.clinic_id = a.clinic_id
   where a.clinic_id = p_clinic_id
     and a.contact_id = v_conf.o_contato
     and sl.procedure_id = (
       select x.procedure_id from public.service_link x
        where x.id = p_service_link_id and x.clinic_id = p_clinic_id)
     and a.starts_at > now()
     and a.status not in ('cancelado_paciente', 'cancelado_clinica', 'faltou', 'compareceu')
     and a.approval_status is distinct from 'recusado'
   order by a.starts_at, a.id
   limit 1;
  if v_ja_marcada is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_consulta',
                              'appointment_id', v_ja_marcada, 'starts_at', v_ja_marcada_em);
  end if;
  -- [revisao final] fim

  -- As vencidas nao consumidas do profissional e as nao consumidas desta
  -- conversa saem (a consumida fica: e a consulta e a idempotencia). SKIP
  -- LOCKED: a linha travada por outro e a que outro ja esta apagando ou
  -- consumindo.
  delete from public.slot_hold h
   where h.id in (
     select x.id
       from public.slot_hold x
      where x.consumido_em is null
        and ((x.professional_id = v_profissional and x.expires_at <= now())
             or (x.clinic_id = p_clinic_id and x.conversation_id = p_conversation_id))
        for update skip locked
   );

  insert into public.slot_hold (
    clinic_id, professional_id, contact_id, service_link_id, conversation_id,
    job_id, starts_at, ends_at, expires_at, created_by
    -- [agendamento completo] a unidade
    , unit_id
  ) values (
    p_clinic_id, v_profissional, v_conf.o_contato, p_service_link_id, p_conversation_id,
    p_job_id, p_starts_at, v_conf.o_fim, now() + interval '10 minutes', 'ia'
    -- [agendamento completo] a unidade
    , p_unit_id
  )
  returning * into v_reserva;

  return jsonb_build_object(
    'ok', true,
    'hold_id', v_reserva.id,
    'starts_at', v_reserva.starts_at,
    'ends_at', v_reserva.ends_at,
    'expires_at', v_reserva.expires_at,
    'reutilizado', false
    -- [agendamento completo] inicio
    , 'unit_id', v_reserva.unit_id
    -- [agendamento completo] fim
  );
end;
$$;

revoke execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid)
  to service_role;

comment on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid) is
  'So o servidor (service_role). A IA reserva por 10 minutos o horario p_starts_at do vinculo p_service_link_id para a conversa (uma reserva por conversa), na unidade p_unit_id (AG3; nula = como antes, a jornada de todas as unidades). Confere tudo de novo no banco (conferir_horario_da_ia) sob trava da conversa, do profissional e, quando o procedimento tem, do recurso. Devolve {ok:true, hold_id, starts_at, ends_at, expires_at, reutilizado, unit_id} ou {ok:false, motivo}: ia_desligada, agenda_nao_configurada, vinculo_invalido, unidade_invalida, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, ocupado, reservado_por_outra_conversa; depois, ja_tem_consulta (revisao final; com appointment_id e starts_at da consulta futura ativa do mesmo procedimento que o contato ja tem, com qualquer profissional, a mais proxima, pela mesma regra do agendar; nada grava). Idempotente pelo job_id (a reserva do job volta com reutilizado true, como esta; job de outra conversa: 22023). Parametro nulo: 22004.';

-- 8b. A IA marca a consulta reservada, pendente da aprovacao da equipe.
-- [revisao final] Um parametro a mais com default: p_slot_hold_id, a
-- reserva que o "Confirma ...?" perguntou. DROP e CREATE com os grants de
-- antes, como o reservar: o codigo de hoje (3 parametros por nome) continua
-- chamando, e o PostgREST nao ve duas funcoes.
drop function public.agendar_pela_ia(uuid, uuid, uuid);

create function public.agendar_pela_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid,
  p_slot_hold_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserva public.slot_hold%rowtype;
  v_conf record;
  v_consulta uuid;
  v_recurso uuid;
  v_pergunta timestamptz;
  -- [agendamento completo] inicio
  v_ja_marcada uuid;
  v_dados public.dados_informados_na_marcacao%rowtype;
  v_faltam text[];
  v_nascimento_no_cadastro date;
  -- [agendamento completo] fim
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );

  -- Idempotencia: a reserva que este job consumiu devolve a consulta.
  select h.* into v_reserva
    from public.slot_hold h
   where h.job_id_do_agendar = p_job_id;
  if found then
    if v_reserva.clinic_id is distinct from p_clinic_id
       or v_reserva.conversation_id is distinct from p_conversation_id then
      raise exception using errcode = '22023', message = 'job_de_outra_conversa';
    end if;
    -- [revisao final] A reserva que este job consumiu nao e a pedida.
    if p_slot_hold_id is not null and v_reserva.id is distinct from p_slot_hold_id then
      return jsonb_build_object('ok', false, 'motivo', 'reserva_diferente');
    end if;
    if v_reserva.appointment_id is null then
      -- A consulta deste job foi apagada depois: nada a repetir.
      return jsonb_build_object('ok', false, 'motivo', 'reserva_inexistente');
    end if;
    return (
      select jsonb_build_object(
               'ok', true,
               'appointment_id', a.id,
               'starts_at', a.starts_at,
               'ends_at', a.ends_at,
               'reutilizado', true
             )
        from public.appointment a
       where a.id = v_reserva.appointment_id
    );
  end if;

  -- A reserva viva desta conversa (no maximo uma; a mais nova, por garantia).
  select h.* into v_reserva
    from public.slot_hold h
   where h.clinic_id = p_clinic_id
     and h.conversation_id = p_conversation_id
     and h.consumido_em is null
   order by h.created_at desc, h.id desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_inexistente');
  end if;
  -- [revisao final] A reserva viva nao e a que o "Confirma ...?" perguntou
  -- (outro turno reservou outra depois): o "sim" do paciente nao vale para
  -- ela. Nada grava.
  if p_slot_hold_id is not null and v_reserva.id is distinct from p_slot_hold_id then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_diferente');
  end if;
  if v_reserva.expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_vencida');
  end if;

  -- Trava do profissional e a reserva travada: o que foi lido antes da
  -- trava e lido de novo.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold:' || v_reserva.professional_id::text, 0)
  );
  select h.* into v_reserva
    from public.slot_hold h
   where h.id = v_reserva.id
     for update;
  if not found or v_reserva.consumido_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_inexistente');
  end if;
  if v_reserva.expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_vencida');
  end if;
  -- [recurso da reserva] (revisao da E4): a trava do recurso do
  -- procedimento, depois da do profissional (a ordem do reservar).
  select pr.resource_id into v_recurso
    from public.service_link sl
    join public.procedure pr
      on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
   where sl.id = v_reserva.service_link_id
     and sl.clinic_id = p_clinic_id;
  if v_recurso is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('slot_hold_recurso:' || v_recurso::text, 0)
    );
  end if;

  -- As mesmas conferencias do reservar, sem a propria reserva e com o fim
  -- dela. Consulta que passou a ocupar o horario (a recepcao marcou por
  -- cima durante a reserva) e conflito, como o 23P01.
  select * into v_conf
    from public.conferir_horario_da_ia(
      p_clinic_id, p_conversation_id, v_reserva.service_link_id,
      v_reserva.starts_at, v_reserva.ends_at, v_reserva.id
      -- [agendamento completo] a unidade da reserva
      , v_reserva.unit_id
    );
  if v_conf.o_motivo is not null then
    return jsonb_build_object(
      'ok', false,
      'motivo', case when v_conf.o_motivo = 'ocupado' then 'conflito' else v_conf.o_motivo end
    );
  end if;
  if v_conf.o_profissional is distinct from v_reserva.professional_id
     or v_conf.o_recurso is distinct from v_recurso then
    return jsonb_build_object('ok', false, 'motivo', 'vinculo_invalido');
  end if;

  -- [agendamento completo] inicio
  -- Na ordem: primeiro o que passa para a equipe (D-8), depois a consulta
  -- que ja existe e por fim os dados que faltam (a IA nao pede dado para
  -- uma consulta que nao vai marcar).
  -- (a) Os dados informados: a linha aberta da conversa, do contato de
  -- agora (registrar_dados_da_marcacao, sob a mesma trava da conversa) e
  -- [revisao final] da janela atual da IA (a de outra janela, inclusive a
  -- marca de outra pessoa, nao vale depois do Devolver), lidas na mesma
  -- foto.
  select d.* into v_dados
    from public.dados_informados_na_marcacao d
    join public.ia_janela_da_conversa w
      on w.conversation_id = d.conversation_id
     and w.clinic_id = d.clinic_id
     and w.desde = d.janela_desde
   where d.clinic_id = p_clinic_id
     and d.conversation_id = p_conversation_id
     and d.appointment_id is null
     and d.contact_id = v_conf.o_contato
     for update of d;
  -- (b) D-8: consulta para outra pessoa passa para a equipe.
  if v_dados.id is not null and not v_dados.para_o_titular then
    return jsonb_build_object('ok', false, 'motivo', 'consulta_para_outra_pessoa');
  end if;
  -- (c) D-8: menor de 18 anos no dia da consulta (no fuso da clinica) passa
  -- para a equipe, pelo nascimento informado ou pelo do cadastro do contato
  -- (basta um dos dois).
  select k.birth_date into v_nascimento_no_cadastro
    from public.contact k
   where k.id = v_conf.o_contato
     and k.clinic_id = p_clinic_id;
  if exists (
    select 1
      from unnest(array[v_dados.data_nascimento, v_nascimento_no_cadastro]) as n(nascimento)
     where n.nascimento > ((v_reserva.starts_at at time zone v_conf.o_fuso)::date - interval '18 years')::date
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'menor_de_idade');
  end if;
  -- (d) ja_tem_consulta: o contato da conversa ja tem consulta futura ativa
  -- (nao cancelada, nao recusada, nem faltou nem compareceu; a pendente da
  -- IA conta) do mesmo procedimento, com qualquer profissional. Devolve a
  -- consulta (a mais proxima), para a IA oferecer remarcar.
  select a.id into v_ja_marcada
    from public.appointment a
    join public.service_link sl on sl.id = a.service_link_id and sl.clinic_id = a.clinic_id
   where a.clinic_id = p_clinic_id
     and a.contact_id = v_conf.o_contato
     and sl.procedure_id = (
       select x.procedure_id from public.service_link x
        where x.id = v_reserva.service_link_id and x.clinic_id = p_clinic_id)
     and a.starts_at > now()
     and a.status not in ('cancelado_paciente', 'cancelado_clinica', 'faltou', 'compareceu')
     and a.approval_status is distinct from 'recusado'
   order by a.starts_at, a.id
   limit 1;
  if v_ja_marcada is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_consulta', 'appointment_id', v_ja_marcada);
  end if;
  -- (e) D-6: os dados que a clinica exige para marcar.
  v_faltam := public.dados_que_faltam_para_marcar(
    p_clinic_id, v_reserva.service_link_id, v_dados.nome_completo, v_dados.data_nascimento,
    v_dados.cpf, v_dados.carteirinha);
  if cardinality(v_faltam) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'faltam_dados', 'faltam', to_jsonb(v_faltam));
  end if;
  -- [agendamento completo] fim

  -- [confirmacao depois da pergunta] (revisao da E4): o paciente confirmou
  -- numa mensagem PROPRIA, depois de a IA perguntar. A pergunta e a
  -- PRIMEIRA resposta da IA gravada depois da reserva (o "Confirma ...?" do
  -- turno que reservou), e so a que nao falhou (a que falhou nao chegou ao
  -- paciente). A mensagem do paciente que chegou entre a reserva e a
  -- pergunta nao vale: ele ainda nao tinha visto dia, hora, profissional e
  -- procedimento, e o historico do turno seguinte a mostra depois da
  -- pergunta (as pendentes vao para o fim).
  select min(x.created_at) into v_pergunta
    from public.message x
   where x.conversation_id = p_conversation_id
     and x.clinic_id = p_clinic_id
     and x.direction = 'saida'
     and x.author = 'ia'
     and x.created_at > v_reserva.created_at
     and x.delivery_status is distinct from 'falhou';
  if v_pergunta is null or not exists (
    select 1
      from public.message m
     where m.conversation_id = p_conversation_id
       and m.clinic_id = p_clinic_id
       and m.direction = 'entrada'
       and m.author = 'paciente'
       and m.created_at > v_pergunta
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_confirmacao_do_paciente');
  end if;

  -- A consulta pendente (D12), sem regua ate a aprovacao e sem oferecer a
  -- vaga a lista de espera se for recusada. 23P01: conflito, nada gravado.
  begin
    insert into public.appointment (
      clinic_id, contact_id, professional_id, service_link_id, resource_id,
      starts_at, ends_at, status, created_by, approval_status,
      send_confirmation, oferecer_vaga_ao_cancelar, is_overbooking, source
      -- [agendamento completo] a unidade da reserva
      , unit_id
    ) values (
      p_clinic_id, v_conf.o_contato, v_reserva.professional_id, v_reserva.service_link_id,
      v_conf.o_recurso, v_reserva.starts_at, v_reserva.ends_at, 'agendado', 'ia', 'pendente',
      false, false, false, 'interna'
      -- [agendamento completo] a unidade da reserva
      , v_reserva.unit_id
    )
    returning id into v_consulta;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'conflito');
  end;

  -- A reserva vira a consulta: consumida (fica, e o elo e a idempotencia) e
  -- vencida agora (a Agenda so desenha reserva com expires_at > now()).
  update public.slot_hold h
     set consumido_em = now(),
         appointment_id = v_consulta,
         job_id_do_agendar = p_job_id,
         expires_at = least(h.expires_at, now())
   where h.id = v_reserva.id;

  -- [agendamento completo] inicio
  -- Os dados informados ficam com a reserva consumida e a consulta (D-7: a
  -- aprovacao os aplica ao cadastro do contato).
  if v_dados.id is not null then
    update public.dados_informados_na_marcacao d
       set appointment_id = v_consulta,
           slot_hold_id = v_reserva.id
     where d.id = v_dados.id;
  end if;
  -- [agendamento completo] fim

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
    'A IA marcou '
      || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'DD/MM') || ' às '
      || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'HH24:MI')
      || ' (' || v_conf.o_procedimento || ', ' || v_conf.o_nome_do_profissional
      || '), pendente de aprovação da equipe.',
    false, 0
  );

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_consulta,
    'starts_at', v_reserva.starts_at,
    'ends_at', v_reserva.ends_at,
    'reutilizado', false
  );
end;
$$;

revoke execute on function public.agendar_pela_ia(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.agendar_pela_ia(uuid, uuid, uuid, uuid)
  to service_role;

comment on function public.agendar_pela_ia(uuid, uuid, uuid, uuid) is
  'So o servidor (service_role). Marca a consulta da reserva viva da conversa, depois de uma mensagem do paciente posterior a pergunta da IA (a primeira resposta da IA gravada depois da reserva, que nao falhou): agendado, created_by ia, approval_status pendente, send_confirmation false (a regua so comeca com a aprovacao), oferecer_vaga_ao_cancelar false, source interna, a unidade da reserva; consome a reserva, liga os dados informados (dados_informados_na_marcacao, a linha aberta da janela atual da IA) a consulta e grava o evento na conversa. p_slot_hold_id (revisao final; nulo = como antes): a reserva que o "Confirma ...?" perguntou; se a reserva viva da conversa (ou, no mesmo job de novo, a que ele consumiu) for outra, reserva_diferente, sem gravar nada. Devolve {ok:true, appointment_id, starts_at, ends_at, reutilizado} ou {ok:false, motivo}: reserva_inexistente, reserva_diferente, reserva_vencida, ia_desligada, agenda_nao_configurada, vinculo_invalido, unidade_invalida, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, conflito (consulta no horario, inclusive o 23P01, sem gravar nada), reservado_por_outra_conversa; depois, nesta ordem, consulta_para_outra_pessoa (a marca da janela atual), menor_de_idade (menos de 18 anos no dia da consulta, pelo nascimento informado ou pelo do cadastro do contato), ja_tem_consulta (com appointment_id: o contato ja tem consulta futura ativa do mesmo procedimento; o reservar ja recusa antes, e o agendar confere de novo) e faltam_dados (com faltam: a lista do que falta); e sem_confirmacao_do_paciente. Idempotente pelo job_id (a consulta do job volta com reutilizado true; job de outra conversa: 22023). Parametro nulo: 22004.';

-- ---------------------------------------------------------------------------
-- 9) Os dados que o paciente informa (o servidor grava; a equipe le)
-- ---------------------------------------------------------------------------

create function public.registrar_dados_da_marcacao(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid,
  p_para_o_titular boolean,
  p_nome_completo text default null,
  p_data_nascimento date default null,
  p_cpf text default null,
  p_carteirinha text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brancos constant text := '[' || E'\u0009\u000a\u000b\u000c\u000d                  　﻿' || ']+';
  v_conversa record;
  v_fuso text;
  v_hoje date;
  v_nome text;
  v_cpf text;
  v_carteirinha text;
  v_invalidos text[] := array[]::text[];
  v_reserva public.slot_hold%rowtype;
  v_aberta public.dados_informados_na_marcacao%rowtype;
  v_id uuid;
  v_faltam text[];
  -- [revisao final] inicio
  v_desde timestamptz;
  v_de_outra_janela uuid;
  -- [revisao final] fim
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null
     or p_para_o_titular is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- A trava da conversa, a mesma do reservar e do agendar: o agendar que
  -- confere os dados espera este terminar, e vice-versa.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );

  -- O job de outra conversa (a mesma regra do reservar e do agendar).
  if exists (
    select 1 from public.dados_informados_na_marcacao d
     where d.job_id = p_job_id
       and (d.clinic_id is distinct from p_clinic_id
            or d.conversation_id is distinct from p_conversation_id)
  ) then
    raise exception using errcode = '22023', message = 'job_de_outra_conversa';
  end if;

  -- A conversa e da clinica, esta com a IA, e a IA pode atender este contato
  -- neste numero (a regra 4 de conferir_horario_da_ia).
  select c.contact_id, c.status, c.whatsapp_account_id, k.phone_key
    into v_conversa
    from public.conversation c
    join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  if not found
     or v_conversa.status is distinct from 'ia_atendendo'
     or not public.ia_pode_atender(p_clinic_id, v_conversa.whatsapp_account_id, v_conversa.phone_key)
  then
    return jsonb_build_object('ok', false, 'motivo', 'ia_desligada');
  end if;
  -- [revisao final] inicio
  -- A janela atual da IA na conversa (o Devolver abre outra). Sem janela, a
  -- IA nao esta atendendo: ia_desligada, nada grava.
  select w.desde into v_desde
    from public.ia_janela_da_conversa w
   where w.conversation_id = p_conversation_id
     and w.clinic_id = p_clinic_id;
  if v_desde is null then
    return jsonb_build_object('ok', false, 'motivo', 'ia_desligada');
  end if;
  -- [revisao final] fim

  select coalesce(nullif(c.timezone, ''), 'America/Fortaleza') into v_fuso
    from public.clinic c where c.id = p_clinic_id;
  v_hoje := (now() at time zone coalesce(v_fuso, 'America/Fortaleza'))::date;

  -- A reserva viva da conversa, se houver (a linha guarda qual era).
  select h.* into v_reserva
    from public.slot_hold h
   where h.clinic_id = p_clinic_id
     and h.conversation_id = p_conversation_id
     and h.consumido_em is null
     and h.expires_at > now()
   order by h.created_at desc, h.id desc
   limit 1;

  -- A linha aberta da conversa (no maximo uma), travada.
  select d.* into v_aberta
    from public.dados_informados_na_marcacao d
   where d.clinic_id = p_clinic_id
     and d.conversation_id = p_conversation_id
     and d.appointment_id is null
     for update;
  -- [revisao final] inicio
  -- A linha aberta de outra janela nao vale (nem a marca de outra pessoa):
  -- daqui em diante e como se nao houvesse linha, e ela sai na gravacao
  -- (abaixo). Com dado invalido nada grava, e ela fica, ignorada.
  if v_aberta.id is not null and v_aberta.janela_desde is distinct from v_desde then
    v_de_outra_janela := v_aberta.id;
    v_aberta := null;
  end if;
  -- [revisao final] fim

  -- D-8: a consulta e para outra pessoa. Nenhum dado pessoal fica (o de
  -- antes desta conversa sai), so a marca, e a IA passa para a equipe.
  if not p_para_o_titular then
    -- [revisao final] a linha de outra janela sai
    delete from public.dados_informados_na_marcacao d
     where d.id = v_de_outra_janela;
    if v_aberta.id is null then
      insert into public.dados_informados_na_marcacao (
        clinic_id, conversation_id, contact_id, slot_hold_id, para_o_titular, job_id
        -- [revisao final] a janela
        , janela_desde
      ) values (
        p_clinic_id, p_conversation_id, v_conversa.contact_id, v_reserva.id, false, p_job_id
        -- [revisao final] a janela
        , v_desde
      );
    else
      update public.dados_informados_na_marcacao d
         set contact_id = v_conversa.contact_id,
             slot_hold_id = v_reserva.id,
             nome_completo = null,
             data_nascimento = null,
             cpf = null,
             carteirinha = null,
             para_o_titular = false,
             job_id = p_job_id
       where d.id = v_aberta.id;
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'consulta_para_outra_pessoa');
  end if;

  -- A forma de cada dado informado; o que veio nulo nao muda o que ja
  -- estava. Nome: brancos juntados, aparado, de 2 a 120, com pelo menos duas
  -- palavras e sem digito nem simbolo. Nascimento: de 1900 ate hoje (no fuso
  -- da clinica). CPF: so os digitos, 11, com os verificadores. Carteirinha:
  -- brancos juntados, aparada, ate 60, so letras sem acento, digitos,
  -- espaco, ponto, hifen e barra, e pelo menos 4 digitos. Errado: nada
  -- grava, e a lista diz quais (nunca o valor).
  if p_nome_completo is not null then
    v_nome := btrim(regexp_replace(p_nome_completo, v_brancos, ' ', 'g'), ' ');
    if char_length(v_nome) not between 2 and 120
       or v_nome !~ '[^ ] +[^ ]'
       or v_nome ~ '[0-9@#$%&*_=+<>{}|/:;"!?()\[\]\\]'
       or not public.cadastro_texto_valido(v_nome, 120)
    then
      v_invalidos := array_append(v_invalidos, 'nome_completo');
    end if;
  end if;
  if p_data_nascimento is not null
     and (p_data_nascimento < date '1900-01-01' or p_data_nascimento > v_hoje) then
    v_invalidos := array_append(v_invalidos, 'data_nascimento');
  end if;
  if p_cpf is not null then
    v_cpf := regexp_replace(p_cpf, '[^0-9]', '', 'g');
    if not public.cpf_valido(v_cpf) or p_cpf !~ '^[0-9 .\-]+$' then
      v_invalidos := array_append(v_invalidos, 'cpf');
    end if;
  end if;
  if p_carteirinha is not null then
    v_carteirinha := btrim(regexp_replace(p_carteirinha, v_brancos, ' ', 'g'), ' ');
    if char_length(v_carteirinha) not between 1 and 60
       or v_carteirinha !~ '^[0-9A-Za-z .\-/]+$'
       or char_length(regexp_replace(v_carteirinha, '[^0-9]', '', 'g')) < 4
       or not public.cadastro_texto_valido(v_carteirinha, 60)
    then
      v_invalidos := array_append(v_invalidos, 'carteirinha');
    end if;
  end if;
  if cardinality(v_invalidos) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'dados_invalidos', 'invalidos', to_jsonb(v_invalidos));
  end if;

  -- A linha aberta: a de antes, se for do mesmo contato e para o titular (o
  -- que veio nulo fica como estava); senao, comeca de novo.
  if v_aberta.id is not null
     and (v_aberta.contact_id is distinct from v_conversa.contact_id or not v_aberta.para_o_titular)
  then
    v_aberta.nome_completo := null;
    v_aberta.data_nascimento := null;
    v_aberta.cpf := null;
    v_aberta.carteirinha := null;
  end if;
  v_aberta.nome_completo := coalesce(v_nome, v_aberta.nome_completo);
  v_aberta.data_nascimento := coalesce(p_data_nascimento, v_aberta.data_nascimento);
  v_aberta.cpf := coalesce(v_cpf, v_aberta.cpf);
  v_aberta.carteirinha := coalesce(v_carteirinha, v_aberta.carteirinha);
  -- [revisao final] a linha de outra janela sai
  delete from public.dados_informados_na_marcacao d
   where d.id = v_de_outra_janela;
  if v_aberta.id is null then
    insert into public.dados_informados_na_marcacao (
      clinic_id, conversation_id, contact_id, slot_hold_id, nome_completo, data_nascimento,
      cpf, carteirinha, para_o_titular, job_id
      -- [revisao final] a janela
      , janela_desde
    ) values (
      p_clinic_id, p_conversation_id, v_conversa.contact_id, v_reserva.id, v_aberta.nome_completo,
      v_aberta.data_nascimento, v_aberta.cpf, v_aberta.carteirinha, true, p_job_id
      -- [revisao final] a janela
      , v_desde
    )
    returning id into v_id;
  else
    update public.dados_informados_na_marcacao d
       set contact_id = v_conversa.contact_id,
           slot_hold_id = v_reserva.id,
           nome_completo = v_aberta.nome_completo,
           data_nascimento = v_aberta.data_nascimento,
           cpf = v_aberta.cpf,
           carteirinha = v_aberta.carteirinha,
           para_o_titular = true,
           job_id = p_job_id
     where d.id = v_aberta.id;
    v_id := v_aberta.id;
  end if;

  -- D-8: menor de 18 anos (no dia da reserva viva, ou hoje sem ela) passa
  -- para a equipe. O dado fica (e do proprio paciente): o agendar recusa.
  if v_aberta.data_nascimento is not null
     and v_aberta.data_nascimento > (coalesce((v_reserva.starts_at at time zone v_fuso)::date, v_hoje)
                                     - interval '18 years')::date
  then
    return jsonb_build_object('ok', false, 'motivo', 'menor_de_idade', 'dados_id', v_id);
  end if;

  v_faltam := public.dados_que_faltam_para_marcar(
    p_clinic_id, v_reserva.service_link_id, v_aberta.nome_completo, v_aberta.data_nascimento,
    v_aberta.cpf, v_aberta.carteirinha);
  return jsonb_build_object('ok', true, 'dados_id', v_id, 'faltam', to_jsonb(v_faltam));
end;
$$;

revoke execute on function public.registrar_dados_da_marcacao(uuid, uuid, uuid, boolean, text, date, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_dados_da_marcacao(uuid, uuid, uuid, boolean, text, date, text, text)
  to service_role;

comment on function public.registrar_dados_da_marcacao(uuid, uuid, uuid, boolean, text, date, text, text) is
  'So o servidor (service_role). Grava o que o paciente informou para marcar (AG3, D-6 a D-8) na linha aberta da conversa na janela atual da IA (dados_informados_na_marcacao, janela_desde = ia_janela_da_conversa.desde), sob a trava da conversa do reservar e do agendar: o que veio nulo nao muda o que ja estava; linha de outro contato ou de outra pessoa comeca de novo; a linha de outra janela (o Devolver abriu outra) nao vale e sai na gravacao (com dado invalido, fica, ignorada). Devolve {ok:true, dados_id, faltam} (faltam: o que a configuracao publicada e o vinculo da reserva viva ainda pedem) ou {ok:false, motivo}: ia_desligada (conversa de outra clinica, fora da IA, contato que a IA nao atende ou conversa sem janela), dados_invalidos (com invalidos: os campos, nunca o valor; nada grava), consulta_para_outra_pessoa (p_para_o_titular falso: nenhum dado pessoal fica, so a marca; a IA passa para a equipe), menor_de_idade (menos de 18 anos no dia da reserva viva, ou hoje; o dado fica e o agendar recusa; com dados_id). Job de outra conversa: 22023. Parametro obrigatorio nulo: 22004. Nunca devolve nem registra o valor informado.';

create function public.ler_dados_informados_na_marcacao(p_clinic_id uuid, p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profissional uuid;
  v_dados public.dados_informados_na_marcacao%rowtype;
begin
  -- Guarda: com sessao, quem aprova a consulta (a policy de UPDATE de
  -- appointment: escrita na clinica e, o profissional, so na propria
  -- agenda); sem sessao, a service role e o SQL editor. O resto, 42501.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501', message = 'sem_permissao';
    end if;
  elsif p_clinic_id is null or not public.user_can_write(p_clinic_id) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;
  if p_clinic_id is null or p_appointment_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica e a consulta.';
  end if;

  select a.professional_id into v_profissional
    from public.appointment a
   where a.id = p_appointment_id
     and a.clinic_id = p_clinic_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'consulta_nao_encontrada';
  end if;
  if auth.uid() is not null
     and public.user_has_role(p_clinic_id, array['profissional'])
     and v_profissional is distinct from public.user_professional_id(p_clinic_id)
  then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select d.* into v_dados
    from public.dados_informados_na_marcacao d
   where d.appointment_id = p_appointment_id
     and d.clinic_id = p_clinic_id;
  if not found then
    return jsonb_build_object('dados', null);
  end if;

  -- A trilha da leitura de dado de paciente: quem, quando e qual consulta,
  -- nunca o conteudo.
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'leu_dados_da_marcacao', 'appointment', p_appointment_id);

  return jsonb_build_object('dados', jsonb_build_object(
    'nome_completo', v_dados.nome_completo,
    'data_nascimento', v_dados.data_nascimento,
    'cpf', v_dados.cpf,
    'carteirinha', v_dados.carteirinha,
    'para_o_titular', v_dados.para_o_titular,
    'informado_em', v_dados.created_at,
    'atualizado_em', v_dados.updated_at,
    'aplicado_em', v_dados.aplicado_em,
    'aplicado_por', v_dados.aplicado_por));
end;
$$;

revoke execute on function public.ler_dados_informados_na_marcacao(uuid, uuid) from public, anon;
grant execute on function public.ler_dados_informados_na_marcacao(uuid, uuid) to authenticated, service_role;

comment on function public.ler_dados_informados_na_marcacao(uuid, uuid) is
  'O que o paciente informou a IA para a consulta p_appointment_id (AG3, D-7): {dados: {nome_completo, data_nascimento, cpf, carteirinha, para_o_titular, informado_em, atualizado_em, aplicado_em, aplicado_por}} ou {dados: null}. A unica leitura humana da tabela: grava audit_log leu_dados_da_marcacao (entity appointment, sem conteudo) quando ha dado. Quem aprova a consulta (escrita na clinica, user_can_write; o profissional so na propria agenda), a service role e o SQL editor; o resto 42501 (anon sem EXECUTE). 22004 (nulo) e P0002 (consulta que nao e da clinica).';

-- ---------------------------------------------------------------------------
-- 10) O estado do atendimento (o servidor le e grava)
-- ---------------------------------------------------------------------------

create function public.ler_atendimento_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conversa record;
  v_desde timestamptz;
  v_contato_da_janela uuid;
  v_job record;
  v_linha public.ia_atendimento%rowtype;
  v_estado jsonb;
  v_versao integer;
  v_dados public.dados_informados_na_marcacao%rowtype;
  v_reserva uuid;
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- O job e desta conversa (senao 22023: erro de quem chama).
  select j.created_at into v_job
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.clinic_id = p_clinic_id
     and j.payload ->> 'conversation_id' = p_conversation_id::text;
  if not found then
    raise exception using errcode = '22023', message = 'job_invalido';
  end if;

  -- A conversa e da clinica, esta com a IA, sem responsavel, com a janela
  -- do contato de agora.
  select c.status, c.assignee_user_id, c.contact_id into v_conversa
    from public.conversation c
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  select w.desde, w.contact_id into v_desde, v_contato_da_janela
    from public.ia_janela_da_conversa w
   where w.conversation_id = p_conversation_id
     and w.clinic_id = p_clinic_id;
  if v_conversa.status is distinct from 'ia_atendendo'
     or v_conversa.assignee_user_id is not null
     or v_desde is null
     or v_contato_da_janela is distinct from v_conversa.contact_id
  then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_ia');
  end if;
  -- D-A do E3: o job de antes da janela atual (Assumir e Devolver no meio)
  -- nao le o estado da janela nova.
  if v_job.created_at < v_desde then
    return jsonb_build_object('ok', false, 'motivo', 'job_antigo');
  end if;

  select a.* into v_linha
    from public.ia_atendimento a
   where a.conversation_id = p_conversation_id
     and a.janela_desde = v_desde;
  if v_linha.id is null then
    v_estado := public.ia_estado_do_atendimento(null::public.ia_atendimento);
    v_versao := 0;
  elsif v_linha.job_id = p_job_id then
    -- O mesmo job de novo (outra tentativa): parte do estado de antes dele.
    v_estado := coalesce(v_linha.anterior, public.ia_estado_do_atendimento(null::public.ia_atendimento));
    v_versao := v_linha.versao - 1;
  else
    v_estado := public.ia_estado_do_atendimento(v_linha);
    v_versao := v_linha.versao;
  end if;

  -- O que o paciente ja informou (so se informou; nunca o valor) e o que
  -- falta, pela reserva viva da conversa. [revisao final] So a linha da
  -- janela atual: a de antes do Devolver nao vale.
  select d.* into v_dados
    from public.dados_informados_na_marcacao d
   where d.clinic_id = p_clinic_id
     and d.conversation_id = p_conversation_id
     and d.appointment_id is null
     and d.contact_id = v_conversa.contact_id
     and d.janela_desde = v_desde;
  select h.service_link_id into v_reserva
    from public.slot_hold h
   where h.clinic_id = p_clinic_id
     and h.conversation_id = p_conversation_id
     and h.consumido_em is null
     and h.expires_at > now()
   order by h.created_at desc, h.id desc
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'versao', v_versao,
    'janela_desde', v_desde,
    'estado', v_estado,
    'dados', jsonb_build_object(
      'nome_completo', v_dados.nome_completo is not null,
      'data_nascimento', v_dados.data_nascimento is not null,
      'cpf', v_dados.cpf is not null,
      'carteirinha', v_dados.carteirinha is not null,
      'para_o_titular', v_dados.para_o_titular,
      'faltam', to_jsonb(public.dados_que_faltam_para_marcar(
        p_clinic_id, v_reserva, v_dados.nome_completo, v_dados.data_nascimento, v_dados.cpf,
        v_dados.carteirinha))));
end;
$$;

revoke execute on function public.ler_atendimento_da_ia(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ler_atendimento_da_ia(uuid, uuid, uuid) to service_role;

comment on function public.ler_atendimento_da_ia(uuid, uuid, uuid) is
  'So o servidor (service_role). O estado do atendimento da IA na janela atual da conversa, para o job p_job_id: {ok:true, versao, janela_desde, estado (a forma de ia_estado_do_atendimento_valido; sem linha, o vazio, versao 0; o mesmo job que ja gravou recebe o estado de ANTES dele, versao - 1: idempotencia por job), dados: {nome_completo, data_nascimento, cpf, carteirinha (se foram informados, nunca o valor), para_o_titular, faltam} (so a linha aberta da janela atual)} ou {ok:false, motivo}: fora_da_ia (conversa de outra clinica, fora da IA, com responsavel, sem janela ou com a janela de outro contato), job_antigo (job de antes da janela atual). Job que nao e desta conversa: 22023 job_invalido. Parametro nulo: 22004.';

create function public.gravar_atendimento_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid,
  p_versao integer,
  p_estado jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado jsonb;
  v_conversa record;
  v_desde timestamptz;
  v_contato_da_janela uuid;
  v_job record;
  v_linha public.ia_atendimento%rowtype;
  v_versao integer;
  v_item jsonb;
  v_horarios jsonb := '[]'::jsonb;
  v_formato constant text := 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null
     or p_versao is null or p_estado is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- A forma (22023, erro de quem chama). Os instantes viram UTC com Z e os
  -- ids, minusculos, antes de conferir.
  if jsonb_typeof(p_estado) <> 'object'
     or jsonb_typeof(p_estado -> 'horarios_oferecidos') is distinct from 'array'
     or p_versao < 0
  then
    raise exception using errcode = '22023', message = 'estado_invalido';
  end if;
  begin
    for v_item in select e.value from jsonb_array_elements(p_estado -> 'horarios_oferecidos') as e loop
      v_horarios := v_horarios || jsonb_build_array(
        case when jsonb_typeof(v_item) = 'object'
               and jsonb_typeof(v_item -> 'starts_at') = 'string'
               and jsonb_typeof(v_item -> 'ends_at') = 'string'
               and jsonb_typeof(v_item -> 'oferecido_em') = 'string'
             then v_item
                  || jsonb_build_object(
                       'starts_at', to_char((v_item ->> 'starts_at')::timestamptz at time zone 'UTC', v_formato),
                       'ends_at', to_char((v_item ->> 'ends_at')::timestamptz at time zone 'UTC', v_formato),
                       'oferecido_em', to_char((v_item ->> 'oferecido_em')::timestamptz at time zone 'UTC', v_formato))
                  || case when jsonb_typeof(v_item -> 'service_link_id') = 'string'
                          then jsonb_build_object('service_link_id', lower(v_item ->> 'service_link_id'))
                          else '{}'::jsonb end
                  || case when jsonb_typeof(v_item -> 'professional_id') = 'string'
                          then jsonb_build_object('professional_id', lower(v_item ->> 'professional_id'))
                          else '{}'::jsonb end
                  || case when jsonb_typeof(v_item -> 'unit_id') = 'string'
                          then jsonb_build_object('unit_id', lower(v_item ->> 'unit_id'))
                          else '{}'::jsonb end
             else v_item end);
    end loop;
    v_estado := p_estado || jsonb_build_object('horarios_oferecidos', v_horarios);
    if jsonb_typeof(p_estado -> 'pedido_pendente_em') = 'string' then
      v_estado := v_estado || jsonb_build_object('pedido_pendente_em',
        to_char((p_estado ->> 'pedido_pendente_em')::timestamptz at time zone 'UTC', v_formato));
    end if;
    v_estado := v_estado
      || (select coalesce(jsonb_object_agg(k.chave, lower(p_estado ->> k.chave)), '{}'::jsonb)
            from unnest(array['procedure_id', 'professional_id', 'insurance_id', 'unit_id',
                              'slot_hold_id', 'appointment_id']) as k (chave)
           where jsonb_typeof(p_estado -> k.chave) = 'string');
  exception when others then
    raise exception using errcode = '22023', message = 'estado_invalido';
  end;
  if not public.ia_estado_do_atendimento_valido(v_estado) then
    raise exception using errcode = '22023', message = 'estado_invalido';
  end if;

  -- D-A do E3: trava a conversa ANTES de ler a janela (o Devolver trava a
  -- conversa e depois grava a janela).
  select c.status, c.assignee_user_id, c.contact_id into v_conversa
    from public.conversation c
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id
     for no key update;
  select w.desde, w.contact_id into v_desde, v_contato_da_janela
    from public.ia_janela_da_conversa w
   where w.conversation_id = p_conversation_id
     and w.clinic_id = p_clinic_id;
  if v_conversa.status is distinct from 'ia_atendendo'
     or v_conversa.assignee_user_id is not null
     or v_desde is null
     or v_contato_da_janela is distinct from v_conversa.contact_id
  then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_ia');
  end if;

  -- O job: desta conversa (senao 22023), em execucao (senao sem_posse) e da
  -- janela atual (senao job_antigo).
  select j.status, j.created_at into v_job
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.clinic_id = p_clinic_id
     and j.payload ->> 'conversation_id' = p_conversation_id::text;
  if not found then
    raise exception using errcode = '22023', message = 'job_invalido';
  end if;
  if v_job.status is distinct from 'executando' then
    return jsonb_build_object('ok', false, 'motivo', 'sem_posse');
  end if;
  if v_job.created_at < v_desde then
    return jsonb_build_object('ok', false, 'motivo', 'job_antigo');
  end if;

  -- [revisao final] A reserva do estado que ja nao existe (o
  -- limpar_holds_vencidos apagou a vencida no meio do turno) e gravada
  -- nula: nao e erro de quem chama. A que existe e de outra clinica ou de
  -- outra conversa continua 22023 (abaixo).
  if v_estado ->> 'slot_hold_id' is not null and not exists (
       select 1 from public.slot_hold x
        where x.id = (v_estado ->> 'slot_hold_id')::uuid)
  then
    v_estado := v_estado || jsonb_build_object('slot_hold_id', null);
  end if;

  -- Os ids sao desta clinica: o procedimento, o profissional, o convenio e a
  -- unidade; a reserva e desta conversa; a consulta e do contato da
  -- conversa; e os vinculos, profissionais e unidades dos horarios.
  if (v_estado ->> 'procedure_id' is not null and not exists (
        select 1 from public.procedure x
         where x.id = (v_estado ->> 'procedure_id')::uuid and x.clinic_id = p_clinic_id))
     or (v_estado ->> 'professional_id' is not null and not exists (
        select 1 from public.professional x
         where x.id = (v_estado ->> 'professional_id')::uuid and x.clinic_id = p_clinic_id))
     or (v_estado ->> 'insurance_id' is not null and not exists (
        select 1 from public.insurance x
         where x.id = (v_estado ->> 'insurance_id')::uuid and x.clinic_id = p_clinic_id))
     or (v_estado ->> 'unit_id' is not null and not exists (
        select 1 from public.unit x
         where x.id = (v_estado ->> 'unit_id')::uuid and x.clinic_id = p_clinic_id))
     or (v_estado ->> 'slot_hold_id' is not null and not exists (
        select 1 from public.slot_hold x
         where x.id = (v_estado ->> 'slot_hold_id')::uuid and x.clinic_id = p_clinic_id
           and x.conversation_id = p_conversation_id))
     or (v_estado ->> 'appointment_id' is not null and not exists (
        select 1 from public.appointment x
         where x.id = (v_estado ->> 'appointment_id')::uuid and x.clinic_id = p_clinic_id
           and x.contact_id = v_conversa.contact_id))
     or exists (
        select 1
          from jsonb_array_elements(v_estado -> 'horarios_oferecidos') as e
         where not exists (
                 select 1 from public.service_link x
                  where x.id = (e.value ->> 'service_link_id')::uuid and x.clinic_id = p_clinic_id
                    and x.professional_id = (e.value ->> 'professional_id')::uuid)
            or (e.value ->> 'unit_id' is not null and not exists (
                 select 1 from public.unit x
                  where x.id = (e.value ->> 'unit_id')::uuid and x.clinic_id = p_clinic_id)))
  then
    raise exception using errcode = '22023', message = 'estado_invalido';
  end if;

  -- O estado de outra janela desta conversa sai (Devolver: comeca do zero).
  delete from public.ia_atendimento a
   where a.conversation_id = p_conversation_id
     and a.janela_desde is distinct from v_desde;

  select a.* into v_linha
    from public.ia_atendimento a
   where a.conversation_id = p_conversation_id
     and a.janela_desde = v_desde
     for update;

  if v_linha.id is null then
    -- Primeira gravacao da janela: o job leu o vazio (versao 0).
    if p_versao <> 0 then
      return jsonb_build_object('ok', false, 'motivo', 'estado_mudou');
    end if;
    insert into public.ia_atendimento (
      clinic_id, conversation_id, janela_desde, etapa, intencao, procedure_id, professional_id,
      insurance_id, particular, unit_id, horarios_oferecidos, slot_hold_id, appointment_id,
      pedido_pendente, pedido_pendente_em, falhas_seguidas, desfecho, job_id, versao, anterior
    ) values (
      p_clinic_id, p_conversation_id, v_desde, v_estado ->> 'etapa', v_estado ->> 'intencao',
      (v_estado ->> 'procedure_id')::uuid, (v_estado ->> 'professional_id')::uuid,
      (v_estado ->> 'insurance_id')::uuid, (v_estado ->> 'particular')::boolean,
      (v_estado ->> 'unit_id')::uuid, v_estado -> 'horarios_oferecidos',
      (v_estado ->> 'slot_hold_id')::uuid, (v_estado ->> 'appointment_id')::uuid,
      v_estado ->> 'pedido_pendente', (v_estado ->> 'pedido_pendente_em')::timestamptz,
      (v_estado ->> 'falhas_seguidas')::integer, v_estado ->> 'desfecho', p_job_id, 1, null
    );
    return jsonb_build_object('ok', true, 'versao', 1, 'reutilizado', false);
  end if;

  if v_linha.job_id = p_job_id then
    -- O mesmo job de novo: o job leu o estado de antes dele (versao - 1), e
    -- a gravacao troca a dele; a versao e o anterior ficam.
    if p_versao <> v_linha.versao - 1 then
      return jsonb_build_object('ok', false, 'motivo', 'estado_mudou');
    end if;
    v_versao := v_linha.versao;
  else
    if p_versao <> v_linha.versao then
      return jsonb_build_object('ok', false, 'motivo', 'estado_mudou');
    end if;
    v_versao := v_linha.versao + 1;
  end if;

  update public.ia_atendimento a
     set etapa = v_estado ->> 'etapa',
         intencao = v_estado ->> 'intencao',
         procedure_id = (v_estado ->> 'procedure_id')::uuid,
         professional_id = (v_estado ->> 'professional_id')::uuid,
         insurance_id = (v_estado ->> 'insurance_id')::uuid,
         particular = (v_estado ->> 'particular')::boolean,
         unit_id = (v_estado ->> 'unit_id')::uuid,
         horarios_oferecidos = v_estado -> 'horarios_oferecidos',
         slot_hold_id = (v_estado ->> 'slot_hold_id')::uuid,
         appointment_id = (v_estado ->> 'appointment_id')::uuid,
         pedido_pendente = v_estado ->> 'pedido_pendente',
         pedido_pendente_em = (v_estado ->> 'pedido_pendente_em')::timestamptz,
         falhas_seguidas = (v_estado ->> 'falhas_seguidas')::integer,
         desfecho = v_estado ->> 'desfecho',
         anterior = case when v_linha.job_id = p_job_id then a.anterior
                         else public.ia_estado_do_atendimento(v_linha) end,
         job_id = p_job_id,
         versao = v_versao
   where a.id = v_linha.id;
  return jsonb_build_object('ok', true, 'versao', v_versao, 'reutilizado', v_linha.job_id = p_job_id);
end;
$$;

revoke execute on function public.gravar_atendimento_da_ia(uuid, uuid, uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.gravar_atendimento_da_ia(uuid, uuid, uuid, integer, jsonb)
  to service_role;

comment on function public.gravar_atendimento_da_ia(uuid, uuid, uuid, integer, jsonb) is
  'So o servidor (service_role). Grava o estado do atendimento da IA (p_estado, a forma de ia_estado_do_atendimento_valido; os instantes viram UTC com Z) na janela atual da conversa, pelo job p_job_id, que leu a versao p_versao (ler_atendimento_da_ia). Trava a conversa antes de ler a janela (D-A do E3). Idempotente por job: o mesmo job grava de novo sobre o estado de antes dele (versao - 1), a versao e o anterior ficam; job novo sobe a versao e guarda o estado de antes em anterior. Apaga o estado de outra janela da conversa. A reserva do estado que ja nao existe (apagada no meio do turno) e gravada nula (revisao final), sem erro. Devolve {ok:true, versao, reutilizado} ou {ok:false, motivo}: fora_da_ia (conversa de outra clinica, fora da IA, com responsavel, sem janela ou com a janela de outro contato), sem_posse (job fora de execucao), job_antigo, estado_mudou (outro job gravou depois da leitura: ler de novo). Forma errada, id de outra clinica ou conversa (a reserva que existe e e de outra conversa inclusive), ou job que nao e desta conversa: 22023 (estado_invalido, job_invalido). Parametro nulo: 22004.';

-- ---------------------------------------------------------------------------
-- 11) A aplicacao dos dados ao cadastro do contato, na aprovacao
-- ---------------------------------------------------------------------------

create function public.aplicar_dados_na_aprovacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dados public.dados_informados_na_marcacao%rowtype;
  v_contato public.contact%rowtype;
  v_convenio uuid;
  v_nome boolean := false;
  v_nascimento boolean := false;
  v_cpf boolean := false;
  v_carteirinha boolean := false;
  v_convenio_novo boolean := false;
  v_campos text[] := array[]::text[];
begin
  -- So roda pelo WHEN do gatilho: a consulta da IA passou de pendente para
  -- aprovada (e nao esta cancelada). Recusar nao chega aqui.
  select d.* into v_dados
    from public.dados_informados_na_marcacao d
   where d.appointment_id = new.id
     and d.clinic_id = new.clinic_id
     and d.aplicado_em is null
     for update;
  if not found or not v_dados.para_o_titular or v_dados.contact_id is distinct from new.contact_id then
    return null;
  end if;

  select k.* into v_contato
    from public.contact k
   where k.id = new.contact_id
     and k.clinic_id = new.clinic_id
     for no key update;
  if not found then
    return null;
  end if;

  -- Nome (D-7, criterio): so quando o cadastro esta sem nome ou com o nome
  -- do WhatsApp. O nome e do WhatsApp quando ninguem da equipe o escreveu:
  -- o contato nao veio de importacao, nao tem na trilha uma pessoa que o
  -- criou ou editou ('criou' ou 'editou' em contact, com user_id), e nenhum
  -- nome informado foi aplicado antes ('aplicou_dados_da_marcacao' com
  -- name). Nome igual nao conta.
  v_nome := v_dados.nome_completo is not null
    and v_dados.nome_completo is distinct from v_contato.name
    and (nullif(btrim(v_contato.name), '') is null
         or (not v_contato.criado_por_importacao
             and not exists (
               select 1
                 from public.audit_log t
                where t.clinic_id = new.clinic_id
                  and t.entity = 'contact'
                  and t.entity_id = v_contato.id
                  and ((t.action in ('criou', 'editou') and t.user_id is not null)
                       or (t.action = 'aplicou_dados_da_marcacao'
                           and coalesce(t.detalhes -> 'campos', '[]'::jsonb) ? 'name')))));
  -- Nascimento e CPF: so no campo vazio.
  v_nascimento := v_dados.data_nascimento is not null and v_contato.birth_date is null;
  v_cpf := v_dados.cpf is not null and nullif(btrim(v_contato.cpf), '') is null;
  -- Carteirinha: consulta pelo convenio, campo vazio, e o convenio do
  -- cadastro vazio ou o mesmo; com o convenio vazio, ele vem junto.
  select sl.insurance_id into v_convenio
    from public.service_link sl
   where sl.id = new.service_link_id
     and sl.clinic_id = new.clinic_id;
  v_carteirinha := v_dados.carteirinha is not null
    and v_convenio is not null
    and nullif(btrim(v_contato.insurance_card), '') is null
    and (v_contato.insurance_id is null or v_contato.insurance_id = v_convenio);
  v_convenio_novo := v_carteirinha and v_contato.insurance_id is null;

  if v_nome then v_campos := array_append(v_campos, 'name'); end if;
  if v_nascimento then v_campos := array_append(v_campos, 'birth_date'); end if;
  if v_cpf then v_campos := array_append(v_campos, 'cpf'); end if;
  if v_carteirinha then v_campos := array_append(v_campos, 'insurance_card'); end if;
  if v_convenio_novo then v_campos := array_append(v_campos, 'insurance_id'); end if;

  if cardinality(v_campos) > 0 then
    update public.contact k
       set name = case when v_nome then v_dados.nome_completo else k.name end,
           birth_date = case when v_nascimento then v_dados.data_nascimento else k.birth_date end,
           cpf = case when v_cpf then v_dados.cpf else k.cpf end,
           insurance_card = case when v_carteirinha then v_dados.carteirinha else k.insurance_card end,
           insurance_id = case when v_convenio_novo then v_convenio else k.insurance_id end
     where k.id = v_contato.id;
    -- A trilha: quem aprovou, qual contato e quais campos, nunca o valor.
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
    values (new.clinic_id, auth.uid(), 'aplicou_dados_da_marcacao', 'contact', v_contato.id,
            jsonb_build_object('campos', to_jsonb(v_campos), 'appointment_id', new.id));
  end if;

  update public.dados_informados_na_marcacao d
     set aplicado_em = now(),
         aplicado_por = auth.uid()
   where d.id = v_dados.id;
  return null;
end;
$$;

revoke all on function public.aplicar_dados_na_aprovacao()
  from public, anon, authenticated, service_role;

comment on function public.aplicar_dados_na_aprovacao() is
  'Gatilho AFTER UPDATE OF approval_status de appointment (dados_informados_na_aprovacao; migration 20261027120000_agendamento_completo_da_ia.sql): na aprovacao da consulta da IA, aplica ao cadastro do contato os dados que o paciente informou (D-7), so nos campos vazios: nascimento e CPF vazios; carteirinha vazia, na consulta pelo convenio, com o convenio do cadastro vazio (vem junto) ou o mesmo; nome vazio ou ainda o do WhatsApp (contato que nao veio de importacao, sem trilha de pessoa que o criou ou editou e sem nome informado aplicado antes). Marca aplicado_em e aplicado_por (quem aprovou) e grava a trilha aplicou_dados_da_marcacao (os campos, nunca o valor). Dado de outra pessoa ou de outro contato: nada. Ninguem executa direto.';

create trigger dados_informados_na_aprovacao
  after update of approval_status on public.appointment
  for each row
  when (old.approval_status = 'pendente' and new.approval_status = 'aprovado'
        and new.status not in ('cancelado_paciente', 'cancelado_clinica')
        and new.created_by = 'ia')
  execute function public.aplicar_dados_na_aprovacao();

comment on trigger dados_informados_na_aprovacao on public.appointment is
  'AG3 (D-7): a consulta da IA aprovada aplica ao cadastro do contato os dados que o paciente informou, so nos campos vazios (aplicar_dados_na_aprovacao). Roda depois de avancar_funil_na_aprovacao e converter_lead_na_aprovacao (ordem alfabetica): o funil e a conversao veem o contato como antes. Recusar e a pendente cancelada nao disparam.';

-- ---------------------------------------------------------------------------
-- 12) A poda, na manutencao do motor
-- ---------------------------------------------------------------------------

create function public.podar_agendamento_da_ia()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_atendimentos integer := 0;
  v_dados integer := 0;
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

  return jsonb_build_object('atendimentos', v_atendimentos, 'dados', v_dados);
end;
$$;

revoke execute on function public.podar_agendamento_da_ia()
  from public, anon, authenticated, service_role;

comment on function public.podar_agendamento_da_ia() is
  'Interna (motor_manutencao; nenhum papel da API executa): a poda do agendamento completo pela IA (AG3). ia_atendimento: conversa que sumiu, resolvida ha mais de 30 dias, janela que nao e mais a da conversa, ou parado ha mais de 90 dias. dados_informados_na_marcacao: a linha aberta 7 dias depois de mexida (ou da conversa que sumiu); a da consulta 30 dias depois de deixar de estar pendente, ou 30 dias depois do dia da consulta. Ate 1000 linhas de cada por passagem, SKIP LOCKED. Devolve {atendimentos, dados}.';

create or replace function public.motor_manutencao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- [onda 2: horario da ia] inicio
  v_horario_da_ia jsonb := '{}'::jsonb;
  -- [onda 2: horario da ia] fim
  -- [agendamento completo] inicio
  v_agendamento_da_ia jsonb := '{}'::jsonb;
  -- [agendamento completo] fim
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
              -- [onda 2: horario da ia] a espera conta da retomada (greatest)
              and greatest(c.last_inbound_at, w.updated_at) < now() - interval '3 minutes') as sem_resposta
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
           -- [onda 2: horario da ia] a espera conta da retomada (greatest; sem janela,
           -- greatest ignora o nulo e e o de antes)
           (c.awaiting_reply
            and greatest(c.last_inbound_at, w.updated_at) < now() - interval '3 minutes')
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
  -- [onda 2: horario da ia] inicio
  -- Horario do assistente (onda 2, item 7). Depois da resposta da IA (que
  -- tira da IA a conversa sem resposta): ate 50 conversas que ficaram com
  -- a equipe por causa do horario voltam para a IA quando o horario do
  -- assistente comeca (ia_retomar_conversas_no_horario). Linha com erro
  -- vira ia_horario_erros:<n>; erro estrutural, ia_horario:<SQLSTATE>.
  begin
    v_horario_da_ia := public.ia_retomar_conversas_no_horario(50, false);
    if coalesce((v_horario_da_ia ->> 'erros_por_linha')::integer, 0) > 0 then
      v_erros := v_erros || ('ia_horario_erros:' || (v_horario_da_ia ->> 'erros_por_linha'));
    end if;
  exception when others then
    v_erros := v_erros || ('ia_horario:' || sqlstate);
  end;

  -- [onda 2: horario da ia] fim
  -- [agendamento completo] inicio
  -- Agendamento completo pela IA (AG3, 27/10/2026), depois da resposta da IA
  -- (que pode podar a janela): a poda do estado do atendimento e dos dados
  -- informados (podar_agendamento_da_ia). Erro vira
  -- agendamento_da_ia:<SQLSTATE>.
  begin
    v_agendamento_da_ia := public.podar_agendamento_da_ia();
  exception when others then
    v_erros := v_erros || ('agendamento_da_ia:' || sqlstate);
  end;

  -- [agendamento completo] fim
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
    -- [onda 2: horario da ia] inicio
    , 'horario_da_ia', v_horario_da_ia
    -- [onda 2: horario da ia] fim
    -- [agendamento completo] inicio
    , 'agendamento_da_ia', v_agendamento_da_ia
    -- [agendamento completo] fim
  );
end;
$function$;

notify pgrst, 'reload schema';
