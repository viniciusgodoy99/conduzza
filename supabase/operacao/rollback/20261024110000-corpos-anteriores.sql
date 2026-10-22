-- Corpos lidos da producao em 21/10/2026, antes da migration 20261024110000
-- (automacoes compostas, onda 4, migration B). md5(prosrc) na leitura (as
-- ondas 2 e 3 nao trocam nenhum; o ensaio confere que o banco ainda esta
-- assim antes de trocar):
--   executar_automacoes_de_fluxo(integer, uuid, boolean)  1d97f21aeedf2532f8a65c06995b9392
--   planejar_automacoes_de_fluxo(integer, uuid, boolean)  ef59c12a7692313c8f9f6affc5a75263
--   validar_automacao_de_fluxo()                          0991a62876ce9ba0b6b9406cfbc96466
--   proteger_jornada()                                    12d4da109649c84e69d0bb7b23b7b115
--   proteger_etiqueta_de_conversa()                       08beca71728c576aca9600bbcad07ba4
-- Nenhuma delas tinha comentario (continuam sem). O comentario de
-- automacao_execucao.motivo volta ao de antes; automacao_fluxo.acao nao
-- tinha.
--
-- ROLLBACK manual da migration (cabecalho dela). ORDEM:
--   1. O codigo novo das automacoes (a RPC, as tabelas filhas, o historico
--      por acao) sai do ar ANTES. O codigo velho funciona com o banco de
--      antes. Rodar este arquivo LOGO DEPOIS (correcao de 22/10/2026): entre
--      um e outro, a aba de automacoes de fluxo do codigo velho nao le a
--      regra gravada pelo codigo novo (a acao legada nula) e mostra o erro
--      dela; o motor continua o novo ate este arquivo.
--   2. Rodar ESTE arquivo inteiro no SQL editor (uma transacao):
--      a. o espelho sai (as escritas abaixo nao regravam as filhas);
--      a2. as execucoes feitas pela metade (pendentes com retrato de alguma
--         acao: uma acao adiada pela trava da conversa) fecham AGORA, com as
--         acoes de agora, pela mesma fechar_execucoes_pela_metade da
--         migration (o que falta fica pulado, regra_alterada, e a execucao
--         fecha executada se alguma acao fez). Sem isto o executor de antes
--         as fecharia como pulada, regra_desligada (a regra composta e
--         desligada em b), e o historico diria que nada foi feito quando uma
--         acao ja tinha rodado (correcao de 22/10/2026). Quando so UMA acao
--         fez, o retrato dela (acao, etiqueta, conversa e atividade) vai para
--         a execucao: o historico de antes so le a execucao. NOTICE com
--         quantas fecharam (so a contagem);
--      b. as regras gravadas pelo codigo novo (acao legada nula) ganham de
--         volta as colunas legadas a partir da acao da posicao mais baixa. A
--         regra que o modelo de antes NAO representa (mais de uma acao, ou
--         alguma condicao) e DESLIGADA, para nao rodar diferente do que a
--         pessoa configurou: NOTICE com os ids dessas regras (configuracao
--         da clinica, nada de paciente), para religar ou refazer depois;
--      c. os cinco corpos de antes voltam (CREATE OR REPLACE: mesmas
--         assinaturas, security, search_path e grants);
--      d. as funcoes novas e as tres tabelas filhas saem; com elas, o
--         historico POR ACAO (automacao_execucao_acao) se perde. O historico
--         de cada execucao (automacao_execucao) fica, com o retrato do pai;
--      e. automacao_fluxo volta: sem combinar, sem o unique (id, clinic_id) e
--         acao NOT NULL de novo.
--   3. Depois, se for o caso, o rollback da migration A
--      (20261024100000-corpos-anteriores.sql).
-- TRAVAS: lock_timeout de 3 s, horario calmo. A escrita em automacao_fluxo e
-- o ALTER dela seguram a tabela (ACCESS EXCLUSIVE no ALTER) ate o commit: os
-- gatilhos que registram (entrada na etapa e mensagem recebida) leem
-- automacao_fluxo, entao a ingestao e a mudanca de etapa esperam fracoes de
-- segundo. Apagar as tabelas filhas tira as FKs delas, e isso pega ACCESS
-- EXCLUSIVE tambem nas tabelas apontadas (funnel_stage_def,
-- conversation_tag_def, automacao_execucao e contact_activity; medido no
-- harness local em 21/10/2026) ate o commit: a gravacao de contato (que le
-- funnel_stage_def) e a conversa nova (que le conversation_tag_def) esperam a
-- transacao inteira, que e curta (milissegundos no harness). Nenhuma trava
-- em message, conversation, contact, clinic_member, job_queue nem clinic.
-- Conferir no fim: os cinco md5 acima, nenhuma das tres tabelas,
-- automacao_fluxo.acao NOT NULL, nenhuma coluna combinar.

begin;
set local lock_timeout = '3s';

-- a. O espelho do codigo velho sai antes de qualquer escrita.
drop trigger if exists espelhar_acao_legada on public.automacao_fluxo;

-- a2. As execucoes feitas pela metade fecham antes de o retrato por acao sair
-- (correcao de 22/10/2026).
do $metade$
declare
  v_metade uuid[];
  v_regra uuid;
  v_fechadas integer := 0;
begin
  -- Trava antes as pendentes com retrato (a passagem do motor que estiver
  -- com alguma termina primeiro; lock_timeout de 3 s: se nao der, nada mudou
  -- e e so rodar de novo).
  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[])
    into v_metade
    from (
      select x.id
        from public.automacao_execucao x
       where x.status = 'pendente'
         and exists (
           select 1 from public.automacao_execucao_acao ea where ea.execucao_id = x.id
         )
       order by x.id
         for update of x
    ) x;
  for v_regra in
    select distinct x.automacao_id
      from public.automacao_execucao x
     where x.id = any (v_metade)
     order by 1
  loop
    v_fechadas := v_fechadas + public.fechar_execucoes_pela_metade(v_regra);
  end loop;
  -- Uma acao so fez: o retrato dela vai para a execucao (como o executor de
  -- antes gravava), para o historico de antes dizer o que foi feito.
  update public.automacao_execucao x
     set acao = case when ea.acao <> 'etiquetar'
                       or (ea.etiqueta is not null and ea.etiqueta_nome is not null)
                     then ea.acao end,
         etiqueta = case when ea.acao = 'etiquetar' and ea.etiqueta_nome is not null
                         then ea.etiqueta end,
         etiqueta_nome = case when ea.acao = 'etiquetar' and ea.etiqueta is not null
                              then ea.etiqueta_nome end,
         conversation_id = ea.conversation_id,
         atividade_id = ea.atividade_id
    from public.automacao_execucao_acao ea
   where x.id = any (v_metade)
     and x.status = 'executada'
     and ea.execucao_id = x.id
     and ea.status = 'executada'
     and (select count(*) from public.automacao_execucao_acao e2
           where e2.execucao_id = x.id and e2.status = 'executada') = 1;
  if exists (
    select 1 from public.automacao_execucao x
     where x.status = 'pendente'
       and exists (
         select 1 from public.automacao_execucao_acao ea where ea.execucao_id = x.id
       )
  ) then
    raise exception 'rollback 20261024110000: sobrou execucao feita pela metade sem fechar';
  end if;
  raise notice 'rollback 20261024110000: % execucao(oes) feita(s) pela metade fechada(s)', v_fechadas;
end;
$metade$;

-- b. As regras do codigo novo voltam ao modelo de uma acao (a da posicao mais
-- baixa); a que tinha mais de uma acao ou condicao fica desligada.
do $regras$
declare
  v_desligadas uuid[];
  v_n integer;
begin
  select coalesce(array_agg(a.id order by a.id), '{}'::uuid[])
    into v_desligadas
    from public.automacao_fluxo a
   where (select count(*) from public.automacao_acao x where x.automacao_id = a.id) > 1
      or exists (select 1 from public.automacao_condicao k where k.automacao_id = a.id);

  update public.automacao_fluxo a
     set acao = x.acao,
         etapa_destino = x.etapa_destino,
         motivo_perda = x.motivo_perda,
         etiqueta = x.etiqueta,
         atividade_titulo = x.atividade_titulo,
         atividade_prazo_dias = x.atividade_prazo_dias,
         nota_texto = x.nota_texto,
         ativa = a.ativa and not (a.id = any (v_desligadas))
    from (
      select distinct on (aa.automacao_id) aa.*
        from public.automacao_acao aa
       order by aa.automacao_id, aa.posicao
    ) x
   where x.automacao_id = a.id
     and (a.acao is null or a.id = any (v_desligadas));
  get diagnostics v_n = row_count;

  -- A regra sem acao nenhuma (gravada direto pela API, sem a RPC) nao tem
  -- como voltar ao modelo de antes: o rollback para e diz os ids, para
  -- excluir ou completar a regra antes.
  if exists (select 1 from public.automacao_fluxo a where a.acao is null) then
    raise exception 'rollback 20261024110000: ha automacao sem acao nenhuma (ids: %); exclua ou complete antes', (
      select string_agg(a.id::text, ', ' order by a.id)
        from public.automacao_fluxo a where a.acao is null);
  end if;

  raise notice 'rollback 20261024110000: % regra(s) voltaram ao modelo de uma acao; desligadas por terem mais de uma acao ou condicao: %',
    v_n, coalesce(nullif(array_to_string(v_desligadas, ', '), ''), 'nenhuma');
end;
$regras$;

-- c. Os corpos de antes.
-- validar_automacao_de_fluxo: corpo do banco ANTES da migration (producao, 21/10/2026)
CREATE OR REPLACE FUNCTION public.validar_automacao_de_fluxo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- executar_automacoes_de_fluxo: corpo do banco ANTES da migration (producao, 21/10/2026)
CREATE OR REPLACE FUNCTION public.executar_automacoes_de_fluxo(p_limite integer DEFAULT 100, p_clinic_id uuid DEFAULT NULL::uuid, p_incluir_teste boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- planejar_automacoes_de_fluxo: corpo do banco ANTES da migration (producao, 21/10/2026)
CREATE OR REPLACE FUNCTION public.planejar_automacoes_de_fluxo(p_limite integer DEFAULT 500, p_clinic_id uuid DEFAULT NULL::uuid, p_incluir_teste boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- proteger_jornada: corpo do banco ANTES da migration (producao, 21/10/2026)
CREATE OR REPLACE FUNCTION public.proteger_jornada()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

-- proteger_etiqueta_de_conversa: corpo do banco ANTES da migration (producao, 21/10/2026)
CREATE OR REPLACE FUNCTION public.proteger_etiqueta_de_conversa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- d. As funcoes novas e as tabelas filhas (com o historico por acao).
drop function if exists public.salvar_automacao_de_fluxo(uuid, uuid, jsonb);
drop function if exists public.automacao_fecha_ciclo(uuid, uuid, text, text[]);
drop function if exists public.espelhar_acao_legada();
drop function if exists public.fechar_execucoes_pela_metade(uuid);
drop table if exists public.automacao_execucao_acao;
drop table if exists public.automacao_condicao;
drop table if exists public.automacao_acao;
drop function if exists public.validar_acao_de_automacao();

-- e. automacao_fluxo como antes.
alter table public.automacao_fluxo
  drop constraint if exists automacao_fluxo_id_clinica_unico,
  drop column if exists combinar,
  alter column acao set not null;
comment on column public.automacao_fluxo.acao is null;
comment on column public.automacao_execucao.motivo is
  'Codigo curto. pulada: regra_desligada, regra_alterada, etapa_mudou, nao_e_lead, importado, lead_respondeu, limite_de_cascata, limite_diario, destino_invalido, tem_consulta_futura, sem_conversa, ja_tinha_etiqueta, limite_de_etiquetas. falhou: erro_<sqlstate>.';

-- Conferencia (recusa o rollback inteiro se nao ficou como antes).
do $conferencia$
declare
  v_caso record;
begin
  for v_caso in
    select *
      from (values
        ('public.executar_automacoes_de_fluxo(integer, uuid, boolean)', '1d97f21aeedf2532f8a65c06995b9392'),
        ('public.planejar_automacoes_de_fluxo(integer, uuid, boolean)', 'ef59c12a7692313c8f9f6affc5a75263'),
        ('public.validar_automacao_de_fluxo()', '0991a62876ce9ba0b6b9406cfbc96466'),
        ('public.proteger_jornada()', '12d4da109649c84e69d0bb7b23b7b115'),
        ('public.proteger_etiqueta_de_conversa()', '08beca71728c576aca9600bbcad07ba4')
      ) as t(assinatura, md5)
  loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.md5 then
      raise exception 'rollback 20261024110000: % nao voltou ao corpo de antes', v_caso.assinatura;
    end if;
  end loop;
  if to_regclass('public.automacao_acao') is not null
     or to_regclass('public.automacao_condicao') is not null
     or to_regclass('public.automacao_execucao_acao') is not null
     or to_regprocedure('public.fechar_execucoes_pela_metade(uuid)') is not null
     or exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name = 'automacao_fluxo'
                   and (c.column_name = 'combinar'
                        or (c.column_name = 'acao' and c.is_nullable = 'YES'))) then
    raise exception 'rollback 20261024110000: o banco nao ficou como antes da migration';
  end if;
end;
$conferencia$;

commit;
