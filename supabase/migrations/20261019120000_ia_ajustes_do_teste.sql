-- ---------------------------------------------------------------------------
-- Agente de IA: ajustes da revisao de producao do E3 (19/10/2026)
-- ---------------------------------------------------------------------------
-- Revisao para producao de 19/10/2026 (~/.claude/plans/e3-whatsapp/
-- revisao-producao: mudancas-1910.md A1, A2 e A5; operacao.md 3, 5 e 9;
-- caminho.md A1 e A4). Quatro funcoes, todas a partir do corpo de PRODUCAO
-- lido em 19/10/2026 (guardados em
-- supabase/operacao/rollback/20261019120000-corpos-anteriores.sql, com o
-- md5 do prosrc de cada um; o ensaio confere que o banco ainda esta assim).
-- O trecho novo de cada uma esta entre "-- [<marca>] inicio" e "... fim"; o
-- resto e o corpo de producao linha a linha.
--
-- 1. situacao_da_ia_na_clinica (CREATE OR REPLACE, mesma assinatura e
--    grants), marca [conversa aberta por numero]: chave NOVA
--    conversas_abertas, uma linha por telefone ATIVO da lista e numero
--    LIGADO (nao removido) em que o contato desse telefone tem conversa
--    aberta com a equipe (aguardando ou em atendimento):
--      {telefone_id, whatsapp_account_id, conversation_id}.
--    A ingestao so poe na IA a conversa NOVA: enquanto essa estiver aberta,
--    a mensagem do telefone naquele numero fica com a equipe, em silencio.
--    A aba passa a dizer QUAL numero e a levar a conversa para alguem
--    assumir e resolver. A chave antiga telefones_com_conversa_aberta
--    continua igual (o codigo de antes e a consulta A de acompanhamento
--    leem ela). Quem le continua o mesmo (servidor, super admin ou
--    ia_membro_ve_a_liberacao: administrador e gestor ativos da propria
--    clinica); o id da conversa nao e dado de paciente e quem le ja ve as
--    conversas da clinica.
--
-- 2. definir_contato_liberado_da_ia (DROP da assinatura de hoje e CREATE da
--    nova: um parametro a mais nao cabe no CREATE OR REPLACE, que criaria
--    uma segunda funcao e deixaria a antiga aberta), marca [aviso da openai
--    no banco]. Parametro NOVO p_confirmou_aviso_da_openai boolean default
--    false, chamado sempre por nome:
--      - telefone que NAO esta na lista: ligar so cria a linha com a
--        confirmacao (sem ela, 23514 'aviso_da_openai_nao_confirmado' e
--        nada muda); desligar nao cria linha nem trilha (antes nascia uma
--        linha desligada, que voltava pelo "Ligar de novo" sem a
--        confirmacao), mas roda a varredura de sempre (ia_desligar);
--      - a trilha 'confirmou_aviso_da_openai' (audit_log, entidade
--        ia_contato_liberado) e gravada PELA FUNCAO, na mesma transacao, no
--        nome de quem liga, sempre que liga com a confirmacao (o formulario
--        de adicionar sempre manda). Antes a action gravava depois, pela
--        sessao, e a politica do audit_log recusava quem nao era membro
--        ativo (a confirmacao ficava so no log da aplicacao).
--    O resto e o corpo de hoje (o guarda, o forcar so da equipe Conduzza,
--    as recusas da plataforma e do paciente, o forcado, ia_desligar e as
--    trilhas 'editou' e 'forcou_telefone_de_paciente_na_ia'). Grants: os de
--    hoje (authenticated e service_role; nada para anon nem public).
--
-- 3. ia_devolver_disponivel (CREATE OR REPLACE, mesma assinatura e grants),
--    marca [devolver: liberacao antes da pergunta]: a pergunta pendente
--    passa a ser conferida DEPOIS da liberacao (assistente, numero, lista,
--    plataforma e sinal de paciente). Conversa de paciente nunca mais mostra
--    "Responda o paciente antes de devolver para a IA." (o botao prometia um
--    devolver que nunca vinha). Para quem nao e gestao, o motivo da
--    liberacao continua nao_disponivel: nada da lista vaza.
--
-- 4. rotulo_do_motivo_da_ia (CREATE OR REPLACE, mesma assinatura, IMMUTABLE
--    e grants), marca [parada neutra]: so o texto de 'parada' muda, para
--    "O assistente não atendeu esta mensagem: ele está parado para este
--    telefone ou este número." O evento sai tambem quando so aquele numero
--    esta desligado do assistente (ou o telefone deixou de valer), e "parado
--    nesta clinica" mentia nesse caso. Nenhum evento 'parada' existe hoje
--    na producao (conferido em 19/10/2026). O espelho TEXTO_DO_EVENTO_DA_IA
--    (lib/domain/agente/config.ts) muda junto, no mesmo deploy do codigo.
--
-- NADA LIGA SOZINHO: nenhuma linha muda com a migration.
--
-- LOCKS: nenhum de tabela (so DROP, CREATE e CREATE OR REPLACE FUNCTION e os
-- grants da recriada). Nenhum ALTER. Horario calmo.
--
-- ORDEM: ensaio (~/.claude/plans/e3-whatsapp/ensaios/
-- ensaio-m6-20261019120000.sql), esta migration, conferir os md5 novos e so
-- DEPOIS o codigo. Entre a migration e o deploy, o codigo de hoje: a aba
-- continua igual (le a chave antiga); ADICIONAR telefone novo falha com o
-- texto generico (a action de hoje nao manda a confirmacao ao banco), e
-- ligar de novo e desligar seguem. O codigo novo antes da migration: a aba
-- mostra o erro de leitura (a chave nova e obrigatoria, nunca o verde) e
-- adicionar telefone falha (a funcao de hoje nao tem o parametro novo).
--
-- ROLLBACK manual: PRIMEIRO voltar o codigo, depois reaplicar
-- supabase/operacao/rollback/20261019120000-corpos-anteriores.sql (apaga a
-- definir_contato_liberado_da_ia nova e recria a de hoje, com os grants; os
-- outros tres com CREATE OR REPLACE). As linhas e trilhas gravadas no meio
-- continuam validas.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. situacao_da_ia_na_clinica
-- ===========================================================================

create or replace function public.situacao_da_ia_na_clinica(p_clinic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_teto boolean;
  v_versao integer;
  v_invalidos jsonb;
  v_sem_autorizacao jsonb;
  v_abertas jsonb;
  v_motor jsonb;
  -- [conversa aberta por numero] inicio
  v_conversas jsonb;
  -- [conversa aberta por numero] fim
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

  -- [conversa aberta por numero] inicio
  -- Por telefone ATIVO da lista e por numero LIGADO (nao removido) da
  -- clinica: a conversa aberta com a equipe (aguardando ou em atendimento)
  -- do contato desse telefone naquele numero. A ingestao so poe na IA a
  -- conversa NOVA; enquanto esta estiver aberta, a mensagem do telefone
  -- nesse numero fica com a equipe. A aba diz o numero e leva a conversa
  -- (o id), para alguem assumir e resolver. No maximo uma por par: o
  -- contato e unico pela chave na clinica, e conversation_aberta_por_numero
  -- so deixa uma conversa nao resolvida por contato e numero (o distinct on
  -- e so a segunda camada, com a mais recente).
  select coalesce(jsonb_agg(jsonb_build_object(
           'telefone_id', a.telefone_id,
           'whatsapp_account_id', a.whatsapp_account_id,
           'conversation_id', a.conversation_id
         ) order by a.telefone_criado, a.telefone_id, a.numero_criado, a.whatsapp_account_id), '[]'::jsonb)
    into v_conversas
    from (
      select distinct on (k.id, n.whatsapp_account_id)
             k.id as telefone_id,
             k.created_at as telefone_criado,
             n.whatsapp_account_id,
             n.created_at as numero_criado,
             c.id as conversation_id
        from public.ia_contato_liberado k
        join public.contact ct
          on ct.clinic_id = p_clinic_id
         and ct.phone_key = k.phone_key
        join public.conversation c
          on c.clinic_id = p_clinic_id
         and c.contact_id = ct.id
         and c.status in ('aguardando_humano', 'em_atendimento')
        join public.ia_numero_liberado n
          on n.clinic_id = p_clinic_id
         and n.whatsapp_account_id = c.whatsapp_account_id
         and n.ativo
        join public.whatsapp_account w
          on w.id = n.whatsapp_account_id
         and w.clinic_id = p_clinic_id
         and w.removido_em is null
       where k.clinic_id = p_clinic_id
         and k.ativo
       order by k.id, n.whatsapp_account_id, c.created_at desc, c.id
    ) a;
  -- [conversa aberta por numero] fim

  v_motor := public.ia_estado_do_motor();

  return jsonb_build_object(
    'teto_atingido', v_teto,
    'versao_publicada', v_versao,
    'telefones_invalidos', v_invalidos,
    'telefones_sem_autorizacao', v_sem_autorizacao,
    'telefones_com_conversa_aberta', v_abertas,
    -- [conversa aberta por numero] inicio
    'conversas_abertas', v_conversas,
    -- [conversa aberta por numero] fim
    'motor_parado', not coalesce((v_motor ->> 'agendado')::boolean, false)
                    or coalesce((v_motor ->> 'alerta')::boolean, false)
  );
end;
$function$;

-- ===========================================================================
-- 2. definir_contato_liberado_da_ia (assinatura NOVA)
-- ===========================================================================

drop function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean);

create function public.definir_contato_liberado_da_ia(p_clinic_id uuid, p_telefone_e164 text, p_rotulo text, p_ativo boolean, p_forcar_contato_existente boolean DEFAULT false, p_confirmou_aviso_da_openai boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- [telefone pelo administrador] inicio
  -- Ligar telefone (adicionar ou "Ligar de novo") basta o guarda acima:
  -- administrador ativo da propria clinica da lista fechada (ou e_de_teste,
  -- nas suites), super admin ou o servidor. Decisao do dono de 19/10/2026;
  -- de 13/10 ate ela, ligar exigia a equipe Conduzza. O FORCAR continua so
  -- da equipe Conduzza: conferido aqui, antes de qualquer leitura, mesmo
  -- quando o telefone nao tem sinal de paciente. Desligar, como sempre, so
  -- com o guarda acima.
  if p_ativo and coalesce(p_forcar_contato_existente, false) then
    perform public.ia_exigir_equipe_conduzza();
  end if;
  -- [telefone pelo administrador] fim
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
    -- [aviso da openai no banco] inicio
    -- Telefone que NAO esta na lista. Desligar nao cria linha nem trilha
    -- (nada foi gravado; o desligar chega aqui sem o forcar), mas a
    -- varredura de sempre roda: conversa na IA que nao pode mais ficar nela
    -- volta para a equipe. Ligar cria a linha so com a confirmacao do aviso
    -- da OpenAI (LGPD, D32), chamada por nome; sem ela, 23514 e nada muda. A
    -- mensagem nunca leva o telefone.
    if not p_ativo then
      perform public.ia_desligar(array[p_clinic_id]);
      return false;
    end if;
    if not coalesce(p_confirmou_aviso_da_openai, false) then
      raise exception using errcode = '23514', message = 'aviso_da_openai_nao_confirmado';
    end if;
    -- [aviso da openai no banco] fim
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

  -- [aviso da openai no banco] inicio
  -- A confirmacao do aviso da OpenAI na trilha, na mesma transacao, no nome
  -- de quem liga (nulo pelo servidor): toda vez que liga com ela (o
  -- formulario de adicionar sempre manda; o "Ligar de novo" nao).
  if p_ativo and coalesce(p_confirmou_aviso_da_openai, false) then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'confirmou_aviso_da_openai', 'ia_contato_liberado', v_id);
  end if;
  -- [aviso da openai no banco] fim

  -- [whatsapp so pela equipe] inicio
  if v_forcou then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'forcou_telefone_de_paciente_na_ia', 'ia_contato_liberado', v_id);
  end if;
  -- [whatsapp so pela equipe] fim

  return p_ativo;
end;
$function$;

-- A recriada: os grants de hoje (authenticated e service_role; nada para
-- anon nem public, que o CREATE daria pelo padrao do esquema).
revoke execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean) to authenticated, service_role;

comment on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean) is
  'Liga ou desliga um telefone da equipe para a IA (T5). Quem chama: administrador ativo da propria clinica da lista (ou e_de_teste), super admin ou o servidor (ia_exigir_quem_libera); o forcar, so a equipe Conduzza (ia_exigir_equipe_conduzza). Ao ligar recusa numero de WhatsApp do Conduzza e contato com sinal de paciente sem o forcar (23514). Telefone fora da lista: ligar exige p_confirmou_aviso_da_openai (23514 aviso_da_openai_nao_confirmado), desligar nao cria linha. Grava audit_log: editou, confirmou_aviso_da_openai (ligar com a confirmacao) e forcou_telefone_de_paciente_na_ia. Sempre por nome de parametro.';

-- ===========================================================================
-- 3. ia_devolver_disponivel
-- ===========================================================================

create or replace function public.ia_devolver_disponivel(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- [devolver: liberacao antes da pergunta] inicio
  -- A pergunta pendente saiu daqui: e conferida DEPOIS da liberacao (abaixo).
  -- [devolver: liberacao antes da pergunta] fim

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
    -- [devolver: liberacao antes da pergunta] inicio
    -- A pergunta pendente so com a liberacao conferida: em conversa de
    -- paciente (fora da lista, ou com sinal de paciente sem o forcar) o
    -- botao nunca diz "Responda o paciente antes de devolver para a IA.",
    -- que prometia um devolver que nunca vem. Para quem nao e gestao, o
    -- motivo da liberacao continua nao_disponivel (abaixo): nada da lista
    -- vaza, e a pergunta pendente continua valendo para todos os papeis.
    if v_aguardando then
      return jsonb_build_object('pode', false, 'motivo', 'pergunta_pendente');
    end if;
    -- [devolver: liberacao antes da pergunta] fim
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

-- ===========================================================================
-- 4. rotulo_do_motivo_da_ia
-- ===========================================================================

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
    -- [parada neutra] inicio
    when 'parada' then 'O assistente não atendeu esta mensagem: ele está parado para este telefone ou este número.'
    -- [parada neutra] fim
    when 'sem_autorizacao' then 'A IA passou a conversa para a equipe: o contato não tem autorização para receber mensagens.'
  end
$function$;

notify pgrst, 'reload schema';
