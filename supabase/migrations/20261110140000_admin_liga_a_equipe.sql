-- O administrador da clinica liga "Conversar com a equipe" e o numero do
-- assistente (decisao do dono de 10/11/2026: "preciso que todos os admin
-- das clinicas consigam colocar para conversar a equipe, nao faz sentido
-- ser so o da conduzza").
--
-- Antes (E3, decisao de 13/10/2026), ligar o atendimento pelo WhatsApp era
-- so da equipe Conduzza (ia_exigir_equipe_conduzza), e desde 06/11 o super
-- admin nao entra mais em clinica: pela aba, ninguem ligava.
--
-- Muda so a trava de LIGAR, nas duas funcoes; o resto do corpo e o de
-- 20261022120000 (definir_liberacao_da_ia) e de 20261019110000
-- (definir_numero_da_ia), igual. Continua:
--  - ia_exigir_quem_libera: so o administrador ativo da clinica (ou o super
--    admin), e so em clinica da fase controlada (o super admin liga pelo
--    Painel geral) ou de teste;
--  - "Atendendo os contatos" (numero_inteiro) e ligar numero com a clinica
--    nele: so a equipe Conduzza;
--  - o numero da propria clinica e nao removido (ia_numero_liberado_coerente)
--    e o telefone de paciente so com o forcar (definir_contato_liberado_da_ia,
--    sem mudanca).
-- create or replace mantem dono, grants e a assinatura.

set local lock_timeout = '3s';

create or replace function public.definir_liberacao_da_ia(p_clinic_id uuid, p_liberada boolean, p_modo text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- [onda 2: producao] inicio
  -- Onda 2 (M3): numero_inteiro (todos os contatos), que o gatilho
  -- ia_liberacao_so_na_lista so deixa em clinica em producao.
  if p_modo is not null and p_modo not in ('simulador', 'contatos', 'numero_inteiro') then
    raise exception using errcode = '22023',
      message = 'Modo inválido: use simulador, contatos ou numero_inteiro.';
  end if;
  -- [onda 2: producao] fim
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
  -- Desde 10/11/2026 (decisao do dono), o administrador da clinica tambem
  -- liga o modo contatos ("Conversar com a equipe"), como ja desligava e
  -- punha em "So simulador" (ia_exigir_quem_libera, acima: administrador
  -- ativo, clinica da fase controlada). So numero_inteiro ("Atendendo os
  -- contatos") continua so pela equipe Conduzza, pelo Painel geral.
  select l.modo into v_modo_atual
    from public.ia_liberacao l
   where l.clinic_id = p_clinic_id;
  if p_liberada and coalesce(p_modo, v_modo_atual, 'simulador') = 'numero_inteiro' then
    perform public.ia_exigir_equipe_conduzza();
  end if;
  -- [whatsapp so pela equipe] fim
  -- [onda 2: producao] inicio
  -- Com a clinica em producao, o modo e a liberacao so mudam pelo Painel
  -- geral (revisao da onda 2): definir_agente_da_clinica grava o estado
  -- ANTES de chamar esta funcao (de producao para teste ela ja chega aqui
  -- com o estado teste), e aqui so passa ligar numero_inteiro, o proprio
  -- caminho do painel. A clinica para pelo Pausar (definir_pausa_da_ia).
  -- Sem isto, "So simulador" ou "Desligado" pela aba gravavam o modo
  -- com o estado ainda producao (estado e modo divergentes no painel).
  if exists (
       select 1 from public.ia_clinica_habilitada h
        where h.clinic_id = p_clinic_id
          and h.estado = 'producao'
     )
     and not (p_liberada and coalesce(p_modo, v_modo_atual, '') = 'numero_inteiro')
  then
    raise exception using errcode = 'P0001', message = 'clinica_em_producao',
      hint = 'Com o assistente atendendo os contatos, o modo só muda pelo Painel geral.';
  end if;
  -- [onda 2: producao] fim

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

create or replace function public.definir_numero_da_ia(p_clinic_id uuid, p_whatsapp_account_id uuid, p_ativo boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  if p_clinic_id is null or p_whatsapp_account_id is null or p_ativo is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, o número e se ele fica liberado.';
  end if;

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- [whatsapp so pela equipe] inicio
  -- Desde 10/11/2026 (decisao do dono), o administrador da clinica tambem
  -- liga numero (ia_exigir_quem_libera, acima; o numero tem de ser da
  -- clinica e nao removido, gatilho ia_numero_liberado_coerente). Com o
  -- assistente atendendo os contatos (numero_inteiro), ligar numero continua
  -- so pela equipe Conduzza: cada numero ligado passa a atender todos os
  -- contatos dele. Desligar continua livre.
  if p_ativo and exists (
       select 1
         from public.ia_liberacao l
        where l.clinic_id = p_clinic_id
          and l.modo = 'numero_inteiro'
     )
  then
    perform public.ia_exigir_equipe_conduzza();
  end if;
  -- [whatsapp so pela equipe] fim

  -- [varios numeros] inicio
  -- Decisao do dono de 19/10/2026: a IA pode atender mais de um numero da
  -- mesma clinica. Ligar este numero NAO mexe nos outros (de 06/10 ate a
  -- decisao, ligar desligava os outros da clinica na mesma transacao). Cada
  -- numero liga e desliga sozinho, debaixo da mesma trava da clinica: duas
  -- chamadas ao mesmo tempo, cada uma ligando um numero, terminam com os
  -- dois ligados. Desligar devolve so as conversas DESTE numero
  -- (ia_desligar, abaixo, decide conversa a conversa pelo numero dela).
  -- [varios numeros] fim

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
