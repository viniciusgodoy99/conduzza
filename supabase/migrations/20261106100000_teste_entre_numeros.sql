-- ---------------------------------------------------------------------------
-- Teste do agente de IA entre numeros conectados (06/11/2026)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 06/11/2026: "liberar um numero para conversar com outro
-- que esta conectado, principalmente se tiverem conectado 2 numeros na mesma
-- empresa, e o agente responder". Escrita na branch teste-entre-numeros e
-- provada so no Postgres local. NAO aplicar sem o ok do dono.
--
-- POR QUE AS TRAVAS EXISTEM (CLAUDE.md, 3.3): dois agentes respondendo um ao
-- outro queimam dinheiro e podem banir o numero no canal nao oficial. Por isso
-- isto e uma liberacao EXPLICITA, por telefone, so de teste, e tudo cai para
-- "o agente nao responde" na duvida.
--
-- O QUE MUDA:
--   1. ia_contato_liberado.entre_numeros (so definir_contato_liberado_da_ia
--      grava, gatilho como o do forcado; desligado nunca fica marcado).
--   2. definir_contato_liberado_da_ia: DROP e CREATE com
--      p_confirmou_entre_numeros (default false) no fim. Sem ele, numero da
--      plataforma continua 23514 telefone_invalido_para_equipe. Com ele:
--      23514 entre_numeros_fora_da_fase (clinica fora da fase controlada e nao
--      de teste, mesmo pelo servidor ou super admin), 23514
--      entre_numeros_reciproco (fecharia o par) ou a marca, com a trilha
--      marcou_numero_conectado_em_teste.
--   3. ia_pode_falar_com, ia_atende_no_whatsapp, ia_devolver_disponivel e
--      situacao_da_ia_na_clinica: numero da plataforma so passa com
--      ia_entre_numeros_vale. Nenhuma outra linha muda.
--   4. ingest_inbound_message, tres trechos [entre numeros]:
--      (a) outro numero ativo da MESMA clinica vira conversa so com a marca
--          ativa; sem ela, numero_proprio como hoje;
--      (b) a resposta do numero que atende, chegando ao numero em teste, volta
--          ignorada 'resposta_entre_numeros', sem contato, conversa nem linha;
--      (c) a mensagem do numero marcado grava o id proprio
--          'entre:<numero que recebeu>:<id>'.
--
-- A COLISAO DE wa_message_id (unique global; o id e o mesmo para quem envia e
-- quem recebe). Antes de (b) e (c), em par de clinicas diferentes: a resposta
-- do agente chegava ao numero que escreveu e, se o envio ja tinha gravado o id,
-- criava contato e conversa vazios la e a mensagem sumia (on conflict); se
-- chegasse antes do update do envio, gravava o id la e o update do envio batia
-- em 23505 (send.ts nao reenvia, mas a linha da IA ficava 'enviando'). E a
-- mensagem do numero que escreve, enviada pela caixa de entrada dele, se perdia
-- em quem atende, sem turno da IA. Agora: quem recebe a pergunta guarda com id
-- proprio (idempotente: a reentrega bate no mesmo id derivado) e o id bruto
-- continua so com quem enviou; a resposta fica so na conversa de quem atende.
-- Nenhum dos lados repete e nada se perde. O eco da saida
-- (registrar_mensagem_do_celular) nao muda. LIMITE: a citacao e o apagamento
-- pelo WhatsApp da mensagem de id derivado nao casam (so teste); reentrega do
-- provedor no segundo exato em que a marca liga ou desliga pode duplicar a
-- linha numa clinica de teste, sem turno a mais (o teto de respostas vale).
--
-- A TRAVA CONTRA O LACO, em tres camadas:
--   1. definir_contato_liberado_da_ia recusa fechar o par (a clinica do numero
--      marcado ja marcou um numero desta clinica; na mesma clinica, outro
--      numero dela ja marcado), serializado por advisory lock de transacao;
--   2. ia_entre_numeros_vale (toda decisao em execucao, mesmo com a recusa
--      contornada): falso com o par reciproco, com o numero que escreve com o
--      agente ligado para responder ao numero que recebe (numero_inteiro conta
--      como ligado), com o numero que recebe sem telefone conhecido, ou
--      escrevendo para si mesmo. Falha fechada: nulo e falso;
--   3. o teto de respostas por conversa por hora (ia_liberacao, padrao 20), do
--      executor, com a simulacao dos dois lados em
--      tests/unit/ia-whatsapp/entre-numeros-laco.test.ts.
-- Basta o PAR: o agente so responde a quem escreveu, entao um ciclo de tres
-- numeros nao propaga mensagem. Nenhuma funcao usa 40001 nem 40P01.
--
-- CONTATO E AUTORIZACAO: a primeira mensagem do numero cria o contato e a
-- autorizacao source='conversa' (como hoje); autorizacao revogada: o executor
-- passa sem responder (sem_autorizacao). Nada aqui toca contact_consent.
--
-- CUSTO NA CLINICA SEM MARCA: em toda mensagem, uma leitura de
-- ia_resposta_entre_numeros, que para nas linhas marcadas (nenhuma); as outras
-- leituras so rodam em numero proprio ou em telefone candidato da lista.
--
-- TRAVAS: ACCESS EXCLUSIVE em ia_contato_liberado (tabela fria, poucas linhas),
-- porque ADD COLUMN e CREATE TRIGGER pedem: so catalogo, default constante,
-- fracao de milissegundo depois de pegar. Toda ingestao le esta tabela, entao
-- o pedido da trava e NOWAIT com 30 tentativas de 100 ms: nunca fica na frente
-- da fila. Sem trava em message, conversation nem contact: funcoes trocadas com
-- CREATE OR REPLACE (a de hoje termina com o corpo de hoje).
--
-- ROLLBACK: supabase/operacao/rollback/20261106100000-corpos-anteriores.sql.
-- ORDEM: primeiro esta migration, depois o codigo (a aba le a coluna nova e, sem
-- ela, cai na leitura sem a coluna; o RPC so manda o parametro novo com a
-- confirmacao marcada).
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

do $travas$
declare
  v_tentativas integer := 0;
begin
  loop
    begin
      lock table public.ia_contato_liberado in access exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 30 then
        raise exception using errcode = 'lock_not_available',
          message = 'Migration 20261106100000: ia_contato_liberado seguiu ocupada por 3 s. Nada foi gravado: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- ---------------------------------------------------------------------------
-- 1) A marca
-- ---------------------------------------------------------------------------
alter table public.ia_contato_liberado
  add column entre_numeros boolean not null default false;

comment on column public.ia_contato_liberado.entre_numeros is
  'Numero conectado do Conduzza liberado SO para teste do agente entre numeros (decisao do dono de 06/11/2026). So definir_contato_liberado_da_ia grava, com a confirmacao e a trilha marcou_numero_conectado_em_teste; desligado nunca fica marcado. Quem decide em execucao e ia_entre_numeros_vale.';

create function public.ia_contato_liberado_entre_numeros_so_pela_funcao()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not new.ativo then
    new.entre_numeros := false;
    return new;
  end if;
  if new.entre_numeros
     and (tg_op = 'INSERT'
          or not old.entre_numeros
          or new.phone_key is distinct from old.phone_key
          or new.clinic_id is distinct from old.clinic_id)
     and current_setting('conduzza.entre_numeros_da_ia', true) is distinct from 'sim'
  then
    raise exception using errcode = '42501', message = 'so_pela_marca_entre_numeros';
  end if;
  return new;
end;
$function$;

revoke all on function public.ia_contato_liberado_entre_numeros_so_pela_funcao()
  from public, anon, authenticated;

create trigger ia_contato_liberado_entre_numeros_so_pela_funcao
  before insert or update on public.ia_contato_liberado
  for each row execute function public.ia_contato_liberado_entre_numeros_so_pela_funcao();

-- ---------------------------------------------------------------------------
-- 2) As decisoes (so o servidor e as funcoes do banco)
-- ---------------------------------------------------------------------------

-- A chave canonica do telefone de um numero conectado. display_phone guarda
-- digitos ou, em conta antiga, o nome do perfil: sem 10 a 15 digitos, nula (o
-- mesmo filtro de numero_proprio).
create function public.chave_do_numero_conectado(p_display_phone text)
returns text
language sql
stable
set search_path to ''
as $function$
  select case
    when length(regexp_replace(p_display_phone, '\D', '', 'g')) between 10 and 15
    then public.chave_telefone('+' || regexp_replace(p_display_phone, '\D', '', 'g'))
  end
$function$;

-- A marca ativa, numa clinica que ainda pode te-la (a que saiu da fase ou foi
-- suspensa volta a numero_proprio).
create function public.ia_entre_numeros_marcado(p_clinic_id uuid, p_telefone text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    exists (
      select 1
        from public.ia_contato_liberado k
        join public.clinic c on c.id = k.clinic_id
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and k.entre_numeros
         and (c.id = any (public.ia_clinicas_da_fase_controlada()) or c.e_de_teste)
    ),
    false
  )
$function$;

-- Camada 1: marcar p_chave nesta clinica fecharia um par? Algum outro numero
-- ativo desta clinica ja esta marcado numa clinica dona de p_chave (a propria,
-- quando os dois numeros sao da mesma).
create function public.ia_entre_numeros_fecha_par(p_clinic_id uuid, p_chave text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    exists (
      select 1
        from public.whatsapp_account minha
        join public.ia_contato_liberado k
          on k.phone_key = public.chave_do_numero_conectado(minha.display_phone)
         and k.ativo
         and k.entre_numeros
        join public.whatsapp_account dona
          on dona.clinic_id = k.clinic_id
         and dona.removido_em is null
         and public.chave_do_numero_conectado(dona.display_phone) = p_chave
       where minha.clinic_id = p_clinic_id
         and minha.removido_em is null
         and public.chave_do_numero_conectado(minha.display_phone) <> p_chave
    ),
    false
  )
$function$;

-- Camada 2: este telefone marcado pode falar com o agente deste numero AGORA?
-- Reavaliada em toda decisao: ligar o outro lado depois derruba o teste.
create function public.ia_entre_numeros_vale(
  p_clinic_id uuid,
  p_whatsapp_account_id uuid,
  p_telefone text
)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    public.ia_entre_numeros_marcado(p_clinic_id, p_telefone)
    and exists (
      select 1
        from public.whatsapp_account recebe
       where recebe.id = p_whatsapp_account_id
         and recebe.clinic_id = p_clinic_id
         and recebe.removido_em is null
         -- O numero que recebe tem telefone conhecido e nao e o que escreve.
         and public.chave_do_numero_conectado(recebe.display_phone)
             <> public.chave_telefone(btrim(p_telefone))
         -- O par reciproco.
         and not exists (
           select 1
             from public.whatsapp_account escreve
             join public.ia_contato_liberado k
               on k.clinic_id = escreve.clinic_id
              and k.phone_key = public.chave_do_numero_conectado(recebe.display_phone)
              and k.ativo
              and k.entre_numeros
            where escreve.removido_em is null
              and public.chave_do_numero_conectado(escreve.display_phone)
                  = public.chave_telefone(btrim(p_telefone))
         )
         -- O numero que escreve com o agente ligado para responder a este.
         and not exists (
           select 1
             from public.whatsapp_account escreve
             join public.ia_numero_liberado n
               on n.whatsapp_account_id = escreve.id
              and n.clinic_id = escreve.clinic_id
              and n.ativo
             join public.ia_liberacao l
               on l.clinic_id = escreve.clinic_id
              and l.liberada
            where escreve.removido_em is null
              and public.chave_do_numero_conectado(escreve.display_phone)
                  = public.chave_telefone(btrim(p_telefone))
              and (l.modo = 'numero_inteiro'
                   or (l.modo = 'contatos' and exists (
                         select 1 from public.ia_contato_liberado q
                          where q.clinic_id = escreve.clinic_id
                            and q.ativo
                            and q.phone_key = public.chave_do_numero_conectado(recebe.display_phone)
                       )))
         )
    ),
    false
  )
$function$;

-- Na ingestao: esta mensagem e a resposta do numero que atende, chegando ao
-- numero em teste que escreveu? As linhas marcadas sao a primeira condicao: em
-- clinica sem marca, nada mais roda.
create function public.ia_resposta_entre_numeros(p_whatsapp_account_id uuid, p_telefone text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    exists (
      select 1
        from public.ia_contato_liberado k
        join public.whatsapp_account recebe
          on recebe.id = p_whatsapp_account_id
         and recebe.removido_em is null
        join public.whatsapp_account escreve
          on escreve.clinic_id = k.clinic_id
         and escreve.removido_em is null
       where k.entre_numeros
         and k.ativo
         and k.phone_key = public.chave_do_numero_conectado(recebe.display_phone)
         and public.chave_do_numero_conectado(escreve.display_phone)
             = public.chave_telefone(btrim(p_telefone))
         and public.ia_entre_numeros_marcado(k.clinic_id, k.phone_key)
    ),
    false
  )
$function$;

revoke all on function public.chave_do_numero_conectado(text) from public, anon, authenticated;
revoke all on function public.ia_entre_numeros_marcado(uuid, text) from public, anon, authenticated;
revoke all on function public.ia_entre_numeros_fecha_par(uuid, text) from public, anon, authenticated;
revoke all on function public.ia_entre_numeros_vale(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ia_resposta_entre_numeros(uuid, text) from public, anon, authenticated;
grant execute on function public.chave_do_numero_conectado(text) to service_role;
grant execute on function public.ia_entre_numeros_marcado(uuid, text) to service_role;
grant execute on function public.ia_entre_numeros_fecha_par(uuid, text) to service_role;
grant execute on function public.ia_entre_numeros_vale(uuid, uuid, text) to service_role;
grant execute on function public.ia_resposta_entre_numeros(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Os corpos de hoje com os trechos [entre numeros]
-- ---------------------------------------------------------------------------

drop function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean, smallint);

CREATE FUNCTION public.definir_contato_liberado_da_ia(p_clinic_id uuid, p_telefone_e164 text, p_rotulo text, p_ativo boolean, p_forcar_contato_existente boolean DEFAULT false, p_confirmou_aviso_da_openai boolean DEFAULT false, p_confirmou_teste_com_paciente boolean DEFAULT false, p_versao_do_aviso smallint DEFAULT 1, p_confirmou_entre_numeros boolean DEFAULT false)
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
  -- [AG6b midia] inicio
  -- A versao do aviso confirmado (1 o de hoje, 2 com audio, foto e
  -- documento). Nulo vale 1, o lado seguro.
  v_versao smallint := coalesce(p_versao_do_aviso, 1);
  -- [AG6b midia] fim
  -- [entre numeros]
  v_entre_numeros boolean := false;
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  -- [telefone pelo administrador] inicio
  -- Ligar telefone (adicionar ou "Ligar de novo") basta o guarda acima:
  -- administrador ativo da propria clinica da lista fechada (ou e_de_teste,
  -- nas suites), super admin ou o servidor. Decisao do dono de 19/10/2026;
  -- [onda 2: teste com paciente] inicio
  -- de 13/10 ate ela, ligar exigia a equipe Conduzza. Desligar, como
  -- sempre, so com o guarda acima. SAIU daqui (onda 2, item 3, P3 (a)):
  -- o FORCAR era so da equipe Conduzza. O trecho de antes, comentado:
  --   de 13/10 ate ela, ligar exigia a equipe Conduzza. O FORCAR continua so
  --   da equipe Conduzza: conferido aqui, antes de qualquer leitura, mesmo
  --   quando o telefone nao tem sinal de paciente. Desligar, como sempre, so
  --   com o guarda acima.
  --   if p_ativo and coalesce(p_forcar_contato_existente, false) then
  --     perform public.ia_exigir_equipe_conduzza();
  --   end if;
  -- No lugar, o forcar exige a confirmacao do teste (logo abaixo).
  -- [onda 2: teste com paciente] fim
  -- [telefone pelo administrador] fim
  -- [onda 2: teste com paciente] inicio
  -- Onda 2, item 3 (P3 (a), decisao do dono de 21/10/2026): o FORCAR deixa
  -- de ser so da equipe Conduzza. Basta o guarda acima MAIS a confirmacao,
  -- no nome de quem forca, de que a pessoa deste telefone sabe que vai
  -- conversar com um assistente virtual de teste e que o que escrever vai
  -- para a OpenAI, nos EUA (p_confirmou_teste_com_paciente). Conferida
  -- aqui, antes de qualquer leitura, com ou sem sinal de paciente (o erro
  -- nao revela se o telefone e de paciente). Sem ela, 23514
  -- teste_com_paciente_nao_confirmado e nada muda.
  if p_ativo and coalesce(p_forcar_contato_existente, false)
     and not coalesce(p_confirmou_teste_com_paciente, false) then
    raise exception using errcode = '23514', message = 'teste_com_paciente_nao_confirmado';
  end if;
  -- [onda 2: teste com paciente] fim
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
  -- [AG6b midia] inicio
  -- So 1 (o aviso de hoje) ou 2 (com audio, foto e documento), antes de
  -- qualquer gravacao.
  if v_versao not between 1 and 2 then
    raise exception using errcode = '22023', message = 'versao_do_aviso_invalida';
  end if;
  -- [AG6b midia] fim
  v_chave := public.chave_telefone(v_telefone);

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- [whatsapp so pela equipe] inicio
  -- So ao LIGAR: numero de WhatsApp de qualquer clinica do Conduzza nunca;
  -- telefone com sinal de paciente so com o forcar ([onda 2: teste com paciente]:
  -- com a confirmacao conferida acima), com trilha propria. Desligar
  -- nunca e recusado. Nenhuma mensagem leva o telefone.
  if p_ativo then
    if public.telefone_e_numero_da_plataforma(v_telefone) then
      -- [entre numeros] inicio
      -- Sem a confirmacao, como sempre. Com ela: so clinica da fase controlada
      -- ou de teste (a guarda deixa passar o servidor e o super admin em
      -- qualquer clinica), nunca fechando o par. A trava serializa as
      -- marcacoes: duas clinicas marcando ao mesmo tempo nao fecham o par.
      if not coalesce(p_confirmou_entre_numeros, false) then
        raise exception using errcode = '23514', message = 'telefone_invalido_para_equipe';
      end if;
      if not exists (
        select 1 from public.clinic c
         where c.id = p_clinic_id
           and (c.id = any (public.ia_clinicas_da_fase_controlada()) or c.e_de_teste)
      ) then
        raise exception using errcode = '23514', message = 'entre_numeros_fora_da_fase';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('conduzza.entre_numeros', 0));
      if public.ia_entre_numeros_fecha_par(p_clinic_id, v_chave) then
        raise exception using errcode = '23514', message = 'entre_numeros_reciproco';
      end if;
      v_entre_numeros := true;
      -- [entre numeros] fim
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
  -- [entre numeros] so esta funcao marca (gatilho, como o forcar)
  if v_entre_numeros then
    perform set_config('conduzza.entre_numeros_da_ia', 'sim', true);
  end if;
  update public.ia_contato_liberado k
     set ativo = p_ativo,
         -- [entre numeros]
         entre_numeros = v_entre_numeros,
         rotulo = coalesce(v_rotulo, k.rotulo),
         -- [whatsapp so pela equipe] inicio
         forcado = v_forcou,
         -- [whatsapp so pela equipe] fim
         -- [AG6b midia] inicio
         -- Desligar volta a 1; ligar com a confirmacao grava a versao
         -- confirmada; ligar sem ela mantem a do telefone ligado e volta a 1
         -- o desligado (k.ativo e o valor de antes deste update).
         aviso_da_openai_versao = case
           when not p_ativo then 1
           when coalesce(p_confirmou_aviso_da_openai, false) then v_versao
           when not k.ativo then 1
           else k.aviso_da_openai_versao
         end,
         -- [AG6b midia] fim
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
                                            forcado,
                                            -- [entre numeros]
                                            entre_numeros,
                                            -- [whatsapp so pela equipe] fim
                                            -- [AG6b midia] inicio
                                            aviso_da_openai_versao
                                            -- [AG6b midia] fim
                                            )
    values (p_clinic_id, v_chave, v_rotulo, p_ativo, auth.uid(),
            -- [whatsapp so pela equipe] inicio
            v_forcou,
            -- [entre numeros]
            v_entre_numeros,
            -- [whatsapp so pela equipe] fim
            -- [AG6b midia] inicio
            v_versao
            -- [AG6b midia] fim
            )
    returning id into v_id;
  end if;
  -- [whatsapp so pela equipe] inicio
  perform set_config('conduzza.forcar_telefone_da_ia', '', true);
  -- [entre numeros]
  perform set_config('conduzza.entre_numeros_da_ia', '', true);
  -- [whatsapp so pela equipe] fim

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_contato_liberado', v_id);

  -- [aviso da openai no banco] inicio
  -- A confirmacao do aviso da OpenAI na trilha, na mesma transacao, no nome
  -- de quem liga (nulo pelo servidor): toda vez que liga com ela (o
  -- formulario de adicionar sempre manda; o "Ligar de novo" nao).
  -- [AG6b midia] com a versao confirmada em detalhes.
  if p_ativo and coalesce(p_confirmou_aviso_da_openai, false) then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id,
                                  -- [AG6b midia]
                                  detalhes)
    values (p_clinic_id, auth.uid(), 'confirmou_aviso_da_openai', 'ia_contato_liberado', v_id,
            -- [AG6b midia]
            jsonb_build_object('versao', v_versao));
  end if;
  -- [aviso da openai no banco] fim

  -- [entre numeros] inicio
  if v_entre_numeros then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'marcou_numero_conectado_em_teste', 'ia_contato_liberado', v_id);
  end if;
  -- [entre numeros] fim

  -- [whatsapp so pela equipe] inicio
  if v_forcou then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'forcou_telefone_de_paciente_na_ia', 'ia_contato_liberado', v_id);
    -- [onda 2: teste com paciente] inicio
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'confirmou_teste_com_paciente', 'ia_contato_liberado', v_id);
    -- [onda 2: teste com paciente] fim
  end if;
  -- [whatsapp so pela equipe] fim

  return p_ativo;
end;
$function$
;

revoke execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean, smallint, boolean) from public, anon;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean, smallint, boolean) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ia_pode_falar_com(p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
         -- [onda 2: producao] os dois modos do WhatsApp
         and l.modo in ('contatos', 'numero_inteiro')
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
    -- [onda 2: producao] inicio
    -- A lista de telefones e a trava K so no modo contatos.
    and (
      exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = p_clinic_id
           and l.modo = 'numero_inteiro'
      )
      or
    -- [onda 2: producao] fim
    exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
    -- [onda 2: producao] inicio
    )
    -- [onda 2: producao] fim
    and exists (
      select 1
        from public.ai_agent_config c
       where c.clinic_id = p_clinic_id
         and c.status = 'publicada'
    )
    -- [entre numeros] inicio
    -- Numero da plataforma so com a marca de teste, e so se a trava do laco
    -- deixar (ia_entre_numeros_vale). Sem a marca, como antes.
    and (not public.telefone_e_numero_da_plataforma(p_telefone)
         or public.ia_entre_numeros_vale(p_clinic_id, p_whatsapp_account_id, p_telefone)),
    -- [entre numeros] fim
    false
  )
$function$
;

CREATE OR REPLACE FUNCTION public.ia_atende_no_whatsapp(p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.ia_pode_atender(p_clinic_id, p_whatsapp_account_id, p_telefone)
    -- [onda 2: producao] inicio
    -- A lista de telefones e a trava K so no modo contatos.
    and (
      exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = p_clinic_id
           and l.modo = 'numero_inteiro'
      )
      or
    -- [onda 2: producao] fim
    exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
    -- [onda 2: producao] inicio
    )
    -- [onda 2: producao] fim
    and exists (
      select 1
        from public.ai_agent_config c
       where c.clinic_id = p_clinic_id
         and c.status = 'publicada'
    )
    -- [onda 2: publico da ia] inicio
    -- Onda 2, item 4: o publico da versao publicada (so leads, so
    -- pacientes ou os dois). So na ENTRADA (conversa nova, Devolver,
    -- retomada no horario): o lead que vira paciente no meio da conversa
    -- continua (ia_pode_falar_com nao olha o publico).
    and public.ia_publico_aceita(p_clinic_id, p_telefone)
    -- [onda 2: publico da ia] fim
    -- [entre numeros] inicio
    -- Numero da plataforma so com a marca de teste, e so se a trava do laco
    -- deixar (ia_entre_numeros_vale). Sem a marca, como antes.
    and (not public.telefone_e_numero_da_plataforma(p_telefone)
         or public.ia_entre_numeros_vale(p_clinic_id, p_whatsapp_account_id, p_telefone)),
    -- [entre numeros] fim
    false
  )
$function$
;

CREATE OR REPLACE FUNCTION public.ia_devolver_disponivel(p_conversation_id uuid)
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
    -- [onda 2: producao] os dois modos do WhatsApp
    public.ia_liberacao_vigente(v_clinica, array['contatos', 'numero_inteiro'])
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
        -- [onda 2: producao] inicio
        -- A lista de telefones so e exigida no modo contatos.
        or (not
      exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = v_clinica
           and l.modo = 'numero_inteiro'
      )
            and
        -- [onda 2: producao] fim
        not exists (
          select 1 from public.ia_contato_liberado k
           where k.clinic_id = v_clinica
             and k.phone_key = public.chave_telefone(btrim(v_chave))
             and k.ativo
        )
        -- [onda 2: producao] inicio
        )
        -- [onda 2: producao] fim
        -- [entre numeros] so a marca de teste passa
        or (public.telefone_e_numero_da_plataforma(v_chave)
            and not public.ia_entre_numeros_vale(v_clinica, v_numero, v_chave))
        -- [onda 2: producao] inicio
        -- O publico da versao publicada, como na entrada (devolver_para_ia,
        -- por ia_atende_no_whatsapp): sem ele o botao aparecia e o
        -- Devolver recusava.
        or not public.ia_publico_aceita(v_clinica, v_chave)
        -- [onda 2: producao] fim
  then
    v_motivo := 'nao_liberada';
  elsif public.contato_tem_sinal_de_paciente(v_clinica, v_chave)
        -- [onda 2: producao] inicio
        -- A trava K so no modo contatos.
        and not exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = v_clinica
           and l.modo = 'numero_inteiro'
      )
        -- [onda 2: producao] fim
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
$function$
;

CREATE OR REPLACE FUNCTION public.situacao_da_ia_na_clinica(p_clinic_id uuid)
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
  -- [onda 2: publico da ia] inicio
  v_fora_do_publico jsonb;
  -- [onda 2: publico da ia] fim
  -- [onda 2: producao] inicio
  v_modo text;
  -- [onda 2: producao] fim
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
     -- [entre numeros] a marca de teste nao e invalida em algum numero ligado
     and ((public.telefone_e_numero_da_plataforma(k.phone_key)
           and not exists (
             select 1 from public.ia_numero_liberado n
              where n.clinic_id = p_clinic_id
                and n.ativo
                and public.ia_entre_numeros_vale(p_clinic_id, n.whatsapp_account_id, k.phone_key)
           ))
          or (not k.forcado
              -- [onda 2: producao] inicio
              -- Revisao da onda 2: no numero_inteiro a lista e a trava K
              -- nao valem (ia_atende_no_whatsapp e ia_pode_falar_com):
              -- o telefone que so tem o sinal de paciente aciona o
              -- assistente (com o publico) e a aba nao diz que nao.
              and not exists (
                select 1 from public.ia_liberacao l
                 where l.clinic_id = p_clinic_id
                   and l.modo = 'numero_inteiro'
              )
              -- [onda 2: producao] fim
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

  -- [onda 2: publico da ia] inicio
  -- Onda 2, item 4: os telefones ATIVOS da lista cujo contato nao cabe no
  -- publico da versao publicada. O filtro vale no teste tambem (P4b): a
  -- aba diz por que eles nao acionam o assistente.
  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb)
    into v_fora_do_publico
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and k.ativo
     and not public.ia_publico_aceita(p_clinic_id, k.phone_key);
  -- [onda 2: publico da ia] fim

  -- [onda 2: producao] inicio
  -- Onda 2 (M3): o modo da liberacao (simulador, contatos ou
  -- numero_inteiro; nulo sem a linha).
  select l.modo into v_modo
    from public.ia_liberacao l
   where l.clinic_id = p_clinic_id;
  -- [onda 2: producao] fim

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
    -- [onda 2: publico da ia] inicio
    'telefones_fora_do_publico', v_fora_do_publico,
    -- [onda 2: publico da ia] fim
    -- [onda 2: producao] inicio
    'modo', v_modo,
    -- [onda 2: producao] fim
    'motor_parado', not coalesce((v_motor ->> 'agendado')::boolean, false)
                    or coalesce((v_motor ->> 'alerta')::boolean, false)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ingest_inbound_message(p_clinic_id uuid, p_phone_e164 text, p_name text, p_wa_message_id text, p_content_type text DEFAULT 'texto'::text, p_body text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_transcript text DEFAULT NULL::text, p_media_filename text DEFAULT NULL::text, p_media_mimetype text DEFAULT NULL::text, p_whatsapp_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_contact_id uuid;
  v_contact_created boolean := false;
  v_conversation_id uuid;
  v_conta_da_conversa uuid;
  v_message_id uuid;
  v_filename text;
  v_mimetype text;
  v_conta uuid;
  v_removido_em timestamptz;
  -- [resposta da ia] inicio
  v_candidata boolean := false;
  v_ia_nova boolean := false;
  v_ia_segue boolean := false;
  v_conversa_nova uuid;
  v_status_antes text;
  v_status text;
  -- [resposta da ia] fim
  -- [onda 2: horario da ia] inicio
  v_horario text;
  v_so_horario_nova boolean := false;
  v_so_horario_segue boolean := false;
  v_motivo_parada text;
  -- [onda 2: horario da ia] fim
  -- [entre numeros]
  v_entre_numeros boolean := false;
begin
  -- NUMERO que recebeu. Nulo e o webhook de hoje, que nao conhece numero:
  -- vale o principal ativo (e nulo se a clinica nao tem numero, como antes).
  if p_whatsapp_account_id is null then
    select id into v_conta
      from whatsapp_account
     where clinic_id = p_clinic_id
       and principal
       and removido_em is null;
  else
    select id, removido_em into v_conta, v_removido_em
      from whatsapp_account
     where id = p_whatsapp_account_id
       and clinic_id = p_clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica.';
    end if;
    if v_removido_em is not null then
      -- Corrida com a remocao (a URL do numero removido ja recebe 401):
      -- nada e gravado.
      return jsonb_build_object(
        'inserted', false,
        'ignorada', 'numero_removido',
        'contact_id', null,
        'contact_created', false,
        'conversation_id', null,
        'message_id', null,
        'whatsapp_account_id', v_conta,
        -- [resposta da ia] inicio
        'ia_atendendo', false
        -- [resposta da ia] fim
      );
    end if;
  end if;

  -- FILTRO DE NUMERO PROPRIO (achado 1 do desenho): o numero A da clinica
  -- escrevendo para o numero B nao e paciente. Sem o filtro, o B criava um
  -- contato com o telefone da propria clinica, e a mensagem ainda se perdia
  -- no unique global de wa_message_id (o envio do A ja gravou o mesmo id).
  -- display_phone guarda digitos (ou, em conta antiga, o nome do perfil: sem
  -- 10 a 15 digitos, nao entra na comparacao). A comparacao e pela chave
  -- canonica, que ignora o nono digito.
  if exists (
    select 1
      from whatsapp_account a
     where a.clinic_id = p_clinic_id
       and a.removido_em is null
       and a.display_phone is not null
       and length(regexp_replace(a.display_phone, '\D', '', 'g'))
           between 10 and 15
       and public.chave_telefone(
             '+' || regexp_replace(a.display_phone, '\D', '', 'g')
           ) = public.chave_telefone(p_phone_e164)
  )
  -- [entre numeros] outro numero da clinica so com a marca ativa dela
  and not public.ia_entre_numeros_marcado(p_clinic_id, p_phone_e164)
  then
    return jsonb_build_object(
      'inserted', false,
      'ignorada', 'numero_proprio',
      'contact_id', null,
      'contact_created', false,
      'conversation_id', null,
      'message_id', null,
      'whatsapp_account_id', v_conta,
      -- [resposta da ia] inicio
      'ia_atendendo', false
      -- [resposta da ia] fim
    );
  end if;

  -- [entre numeros] inicio
  -- A resposta do numero que atende, chegando no numero em teste que escreveu:
  -- a conversa e a mensagem ficam com quem atende. Sem isto, o id igual (unique
  -- global) deixava uma conversa vazia aqui, ou batia no update do envio de la.
  if public.ia_resposta_entre_numeros(v_conta, p_phone_e164) then
    return jsonb_build_object(
      'inserted', false,
      'ignorada', 'resposta_entre_numeros',
      'contact_id', null,
      'contact_created', false,
      'conversation_id', null,
      'message_id', null,
      'whatsapp_account_id', v_conta,
      'ia_atendendo', false
    );
  end if;
  -- [entre numeros] fim

  -- [resposta da ia] inicio
  -- PRE-CHECAGEM DA IA (E3, 13/10/2026): so o telefone ATIVO na lista de
  -- telefones da equipe (ia_contato_liberado) entra no ramo novo. Sem ela,
  -- o caminho e o de antes, linha a linha. Com ela, trava a liberacao e o
  -- interruptor em FOR SHARE antes de tocar a conversa (a mesma ordem das
  -- definir_*) e decide duas coisas: se uma conversa NOVA nasce na IA (com o
  -- teto de 24 h) e se a conversa que JA esta na IA continua (sem o teto).
  v_candidata := exists (
    select 1 from public.ia_contato_liberado k
     where k.clinic_id = p_clinic_id
       and k.ativo
       and k.phone_key = public.chave_telefone(btrim(p_phone_e164))
  )
  -- [onda 2: preparo da producao] inicio
  -- Onda 2 (M2, preparo inerte da M3): tambem a clinica liberada no modo
  -- numero_inteiro (todos os contatos), pela chave primaria. Com o CHECK
  -- de hoje (simulador ou contatos) este ramo nunca casa.
  or exists (
    select 1 from public.ia_liberacao l
     where l.clinic_id = p_clinic_id
       and l.modo = 'numero_inteiro'
       and l.liberada
  )
  -- [onda 2: preparo da producao] fim
  ;
  if v_candidata then
    -- [entre numeros] so quem ja e candidato paga esta leitura
    v_entre_numeros := v_conta is not null
      and public.ia_entre_numeros_marcado(p_clinic_id, p_phone_e164);
    perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for share;
    perform 1 from public.ia_interruptor i where i.id for share;
    v_ia_nova := public.ia_atende_no_whatsapp(p_clinic_id, v_conta, p_phone_e164);
    v_ia_segue := public.ia_pode_falar_com(p_clinic_id, v_conta, p_phone_e164);
    -- [onda 2: horario da ia] inicio
    -- Onda 2, item 7: o banco decide o horario do assistente (a ultima
    -- versao publicada, no fuso da clinica; espelho de horarioDoBanco e
    -- agenteAtendeAgora). Fora do horario dele a conversa nova nao nasce
    -- na IA e a que estava na IA vai para a equipe aqui, sem esperar o
    -- executor. v_so_horario_*: a UNICA razao e o horario (a liberacao
    -- deixaria), para o evento certo e a espera do horario.
    v_horario := public.ia_horario_do_assistente(p_clinic_id);
    v_so_horario_nova := coalesce(v_ia_nova, false) and v_horario is distinct from 'atende';
    v_so_horario_segue := coalesce(v_ia_segue, false) and v_horario is distinct from 'atende';
    v_ia_nova := coalesce(v_ia_nova, false) and v_horario = 'atende';
    v_ia_segue := coalesce(v_ia_segue, false) and v_horario = 'atende';
    -- [onda 2: horario da ia] fim
  end if;
  -- [resposta da ia] fim

  -- CONTATO, achado pela CHAVE canonica e nao pelo texto exato: o WhatsApp
  -- entrega +558499990000 e a recepcao cadastrou +5584999990000; e a mesma
  -- pessoa.
  --
  -- ON CONFLICT DO NOTHING SEM alvo de proposito: contact tem DOIS indices
  -- unicos (phone_e164 e phone_key). Com alvo em um so, duas entregas
  -- simultaneas do primeiro contato podiam estourar 23505 no outro indice
  -- (o nao arbitro e conferido na hora e erra em vez de esperar). Sem alvo,
  -- todos os unicos arbitram e a corrida vira "ja existe".
  insert into contact (clinic_id, phone_e164, name, last_contact_at)
  values (p_clinic_id, p_phone_e164, nullif(trim(p_name), ''), now())
  on conflict do nothing
  returning id into v_contact_id;

  if v_contact_id is not null then
    v_contact_created := true;
  else
    -- Ja existia (inclusive gravado pela recepcao na OUTRA forma). O telefone
    -- passa a ser o que o WhatsApp entregou: e a forma que com certeza recebe
    -- mensagem, e o toque seguinte vai para ela.
    update contact
      set last_contact_at = now(),
          name = coalesce(contact.name, nullif(trim(p_name), '')),
          phone_e164 = p_phone_e164
      where clinic_id = p_clinic_id
        and phone_key = public.chave_telefone(p_phone_e164)
      returning id into v_contact_id;
  end if;

  -- Consentimento automatico source='conversa' SO na primeira relacao do
  -- contato com o canal: qualquer linha anterior (ativa OU revogada) impede o
  -- insert. Revogou, so reconsentimento explicito com evidencia reabre.
  if not exists (
    select 1 from contact_consent
    where clinic_id = p_clinic_id
      and contact_id = v_contact_id
      and channel = 'whatsapp'
  ) then
    insert into contact_consent (clinic_id, contact_id, channel, source, evidence)
    values (p_clinic_id, v_contact_id, 'whatsapp', 'conversa',
            'Primeira mensagem recebida do contato');
  end if;

  -- Uma conversa aberta por contato E NUMERO (decisao 1 do dono). SEM alvo
  -- de proposito: hoje arbitra conversation_aberta_por_contato; na Fase 3,
  -- o indice por numero. Corrida vira "ja existe".
  insert into conversation (
    clinic_id, contact_id, status, last_message_at, whatsapp_account_id
  )
  values (
    p_clinic_id, v_contact_id, 'aguardando_humano', now(), v_conta
  )
  on conflict do nothing
  -- [resposta da ia] inicio
  returning id into v_conversa_nova;
  -- [resposta da ia] fim

  -- A conversa aberta DESTE numero, ou uma aberta sem numero (clinica que
  -- ganhou numero depois, ou legado), que este numero adota.
  -- [resposta da ia] o status de antes tambem (v_status_antes)
  select id, whatsapp_account_id, status
    into v_conversation_id, v_conta_da_conversa, v_status_antes
  from conversation
  where clinic_id = p_clinic_id and contact_id = v_contact_id
    and status <> 'resolvida'
    and (whatsapp_account_id = v_conta or whatsapp_account_id is null)
  order by (whatsapp_account_id is null)
  limit 1;

  if v_conta is not null
     and v_conversation_id is not null
     and v_conta_da_conversa is null
  then
    update conversation
       set whatsapp_account_id = v_conta
     where id = v_conversation_id
       and whatsapp_account_id is null;
  end if;

  -- Nome do arquivo: defesa em profundidade (o parser ja saneia). Sem barra
  -- nem caractere de controle, ate 200 caracteres; vazio vira nulo.
  v_filename := nullif(
    btrim(left(regexp_replace(coalesce(p_media_filename, ''),
                              '[[:cntrl:]/\\]', '', 'g'), 200)),
    ''
  );
  -- Tipo: so o formato tipo/subtipo, minusculo e sem parametros ("audio/ogg;
  -- codecs=opus" vira "audio/ogg"); qualquer outra coisa e nulo.
  v_mimetype := lower(btrim(split_part(coalesce(p_media_mimetype, ''), ';', 1)));
  if v_mimetype !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
     or length(v_mimetype) > 100 then
    v_mimetype := null;
  end if;

  -- O numero da mensagem vem da conversa (gatilho mensagem_herda_numero).
  insert into message (
    clinic_id, conversation_id, wa_message_id, direction, author,
    content_type, body, media_url, transcript, billable, cost_cents,
    media_filename, media_mimetype
  ) values (
    p_clinic_id, v_conversation_id,
    -- [entre numeros] o id bruto e de quem enviou (unique global): aqui, um id
    -- proprio deste numero, que segue idempotente na reentrega
    case when v_entre_numeros
         then 'entre:' || v_conta::text || ':' || p_wa_message_id
         else p_wa_message_id
    end,
    'entrada', 'paciente',
    coalesce(p_content_type, 'texto'), p_body, p_media_url, p_transcript,
    false, 0,
    v_filename, v_mimetype
  )
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is not null then
    update conversation
      set last_message_at = now(),
          -- A chave de ordenacao do Inbox. Escrita SO aqui, no recebimento:
          -- responder nao pode mover a conversa de lugar.
          last_inbound_at = now(),
          unread_count = unread_count + 1,
          awaiting_reply = true,
          -- [resposta da ia] inicio
          -- Nenhuma conversa fica num estado que ninguem atende: o paciente
          -- escreveu e a IA nao pode mais falar com ele, a conversa volta
          -- para a fila da recepcao (contador do menu e "Aguardando voce").
          -- So a conversa NOVA deste telefone liberado nasce na IA; nunca uma
          -- que ja existia (em_atendimento ou aguardando_humano).
          status = case
            when status = 'ia_atendendo' and coalesce(v_ia_segue, false) then 'ia_atendendo'
            when status = 'ia_atendendo' then 'aguardando_humano'
            when id = v_conversa_nova and status = 'aguardando_humano'
                 and coalesce(v_ia_nova, false) then 'ia_atendendo'
            else status
          end
          -- [resposta da ia] fim
      where id = v_conversation_id
      -- [resposta da ia] inicio
      returning status into v_status;
      -- [resposta da ia] fim

    -- [resposta da ia] inicio
    if v_candidata then
      if v_status = 'ia_atendendo' and v_conversation_id = v_conversa_nova then
        -- A janela da conversa: a IA so le o que chegou a partir daqui.
        insert into public.ia_janela_da_conversa (
          conversation_id, clinic_id, contact_id, phone_key, desde, aberta_por, updated_at
        ) values (
          v_conversation_id, p_clinic_id, v_contact_id,
          public.chave_telefone(btrim(p_phone_e164)), now(), 'ingestao', now()
        )
        on conflict (conversation_id) do update
          set clinic_id = excluded.clinic_id,
              contact_id = excluded.contact_id,
              phone_key = excluded.phone_key,
              desde = excluded.desde,
              aberta_por = excluded.aberta_por,
              updated_at = excluded.updated_at;
      elsif v_status is distinct from 'ia_atendendo'
            and ((v_status_antes = 'ia_atendendo' and not coalesce(v_ia_segue, false))
                 or (v_conversation_id = v_conversa_nova and not coalesce(v_ia_nova, false))) then
        -- O telefone e da equipe, mas o assistente esta parado para ele: a
        -- equipe ve o porque no fio. So quando o motivo e a IA parada; a
        -- conversa que saiu da IA por outra transacao no meio (Assumir,
        -- passagem do executor) nao ganha evento.
        -- [onda 2: horario da ia] inicio
        -- Quando a UNICA razao e o horario: a conversa nova fica com a
        -- equipe com no_expediente (ou horario_nao_suportado no modo "Se a
        -- equipe nao responder"); a que estava na IA vai para a equipe com
        -- fora_do_horario (ou horario_nao_suportado). No expediente, ela
        -- espera o horario do assistente em ia_conversa_fora_do_horario: a
        -- nova desde agora (origem ingestao; a mensagem desta transacao
        -- entra), a que estava na IA desde a janela que ja tinha (origem
        -- turno). Outra razao: parada, como antes. Telefone fora do
        -- formato ou sem numero: nada e guardado (fica com a equipe).
        v_motivo_parada := 'parada';
        if v_status_antes = 'ia_atendendo' and v_so_horario_segue then
          v_motivo_parada := case v_horario
            when 'no_expediente' then 'fora_do_horario'
            when 'modo_nao_suportado' then 'horario_nao_suportado'
            else 'parada'
          end;
        elsif v_conversation_id = v_conversa_nova and v_so_horario_nova then
          v_motivo_parada := case v_horario
            when 'no_expediente' then 'no_expediente'
            when 'modo_nao_suportado' then 'horario_nao_suportado'
            else 'parada'
          end;
        end if;
        if v_horario = 'no_expediente'
           and v_motivo_parada in ('no_expediente', 'fora_do_horario')
           and v_conta is not null
        then
          insert into public.ia_conversa_fora_do_horario as f (
            conversation_id, clinic_id, contact_id, phone_key,
            whatsapp_account_id, desde, origem, criada_em
          )
          select v_conversation_id, p_clinic_id, k.id, k.phone_key, v_conta,
                 case when v_motivo_parada = 'fora_do_horario'
                      then coalesce((select w.desde
                                       from public.ia_janela_da_conversa w
                                      where w.conversation_id = v_conversation_id), now())
                      else now()
                 end,
                 case when v_motivo_parada = 'fora_do_horario' then 'turno' else 'ingestao' end,
                 now()
            from public.contact k
           where k.id = v_contact_id
             and k.clinic_id = p_clinic_id
             and k.phone_key ~ '^\+[1-9][0-9]{7,14}$'
          on conflict (conversation_id) do update
             set clinic_id = excluded.clinic_id,
                 contact_id = excluded.contact_id,
                 phone_key = excluded.phone_key,
                 whatsapp_account_id = excluded.whatsapp_account_id,
                 desde = excluded.desde,
                 origem = excluded.origem,
                 criada_em = excluded.criada_em;
        end if;
        -- [onda 2: horario da ia] fim
        insert into public.message (
          clinic_id, conversation_id, direction, author, content_type, body,
          billable, cost_cents
        ) values (
          p_clinic_id, v_conversation_id, 'saida', 'sistema', 'evento',
          -- [onda 2: horario da ia] o motivo: parada, no_expediente, fora_do_horario
          -- ou horario_nao_suportado (acima)
          public.rotulo_do_motivo_da_ia(v_motivo_parada), false, 0
        );
      end if;
    end if;
    -- [resposta da ia] fim
  end if;

  return jsonb_build_object(
    'inserted', v_message_id is not null,
    'contact_id', v_contact_id,
    'contact_created', v_contact_created,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'whatsapp_account_id', v_conta,
    -- [resposta da ia] inicio
    'ia_atendendo', coalesce(v_message_id is not null and v_status = 'ia_atendendo', false)
    -- [resposta da ia] fim
  );
end;
$function$
;

comment on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean, smallint, boolean) is
  'Liga ou desliga um telefone da equipe para a IA (T5). Quem chama: administrador ativo da propria clinica da lista (ou e_de_teste), super admin ou o servidor (ia_exigir_quem_libera); o forcar (telefone de paciente que aceitou testar, onda 2, P3), o mesmo guarda com p_confirmou_teste_com_paciente (sem ela, 23514 teste_com_paciente_nao_confirmado, antes de qualquer leitura). Ao ligar recusa numero de WhatsApp do Conduzza e contato com sinal de paciente sem o forcar (23514). Telefone fora da lista: ligar exige p_confirmou_aviso_da_openai (23514 aviso_da_openai_nao_confirmado), desligar nao cria linha. Grava audit_log: editou, confirmou_aviso_da_openai (ligar com a confirmacao; AG6b: detalhes {versao}), forcou_telefone_de_paciente_na_ia e confirmou_teste_com_paciente (no nome de quem forca). AG6b (D-60, D-95): p_versao_do_aviso (1 o aviso de hoje, o padrao; 2 o aviso com audio, foto e documento; nulo vale 1; fora de 1 ou 2, 22023 versao_do_aviso_invalida, depois do rotulo): ligar com a confirmacao grava a versao em aviso_da_openai_versao; desligar volta a 1; ligar sem a confirmacao mantem a versao do telefone ligado e volta a 1 o desligado. p_confirmou_entre_numeros (teste entre numeros, 06/11/2026): numero de WhatsApp do Conduzza so com ela, em clinica da fase controlada ou de teste (23514 entre_numeros_fora_da_fase) e sem fechar o par (23514 entre_numeros_reciproco); grava entre_numeros e a trilha marcou_numero_conectado_em_teste. Sempre por nome de parametro.';

comment on function public.ia_atende_no_whatsapp(uuid, uuid, text) is
  'Conversa NOVA deste telefone neste numero entra na IA? ia_pode_atender (liberacao, teto, numero e, no modo contatos, a lista) mais, no modo contatos, a trava K (o forcado passa), a versao publicada, o publico da versao publicada (ia_publico_aceita; nulo recusa no numero_inteiro) e numero da plataforma so com ia_entre_numeros_vale (a marca de teste de 06/11/2026). So na entrada: conversa nova, Devolver e retomada no horario. So service_role (e as funcoes do banco).';

comment on function public.ia_entre_numeros_vale(uuid, uuid, text) is
  'Camada 2 da trava contra o laco do teste entre numeros: marca ativa em clinica da fase ou de teste, numero que recebe com telefone conhecido e diferente de quem escreve, par nao reciproco e numero que escreve sem o agente ligado para o que recebe. Falha fechada. So service_role (e as funcoes do banco).';

notify pgrst, 'reload schema';
