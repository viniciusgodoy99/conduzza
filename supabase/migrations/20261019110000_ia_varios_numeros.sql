-- ---------------------------------------------------------------------------
-- Agente de IA: mais de um numero da mesma clinica (19/10/2026)
-- ---------------------------------------------------------------------------
-- Decisao do dono em 19/10/2026: a IA pode atender MAIS DE UM numero da
-- mesma clinica nesta fase (o pedido concreto: os dois numeros da Conduzza
-- Teste, f0c115dd, "Número principal" 35fa44ef e "Numero 2 teste pessoal"
-- d73d3e43). Reve SO o "um numero por vez" de definir_numero_da_ia
-- (migration 20261006120000; docs/04, 17.11 e 17.13). Contrato:
-- ~/.claude/plans/e3-whatsapp/contrato.md, 10.8.
--
-- So CREATE OR REPLACE de definir_numero_da_ia, partindo do corpo de
-- PRODUCAO de 19/10/2026 (md5 do prosrc d3ba61b49cc7a987e48178ffc9909b08,
-- guardado em supabase/operacao/rollback/20261019110000-corpos-anteriores.sql),
-- e o comentario dela, que dizia "um numero por vez". Mesma assinatura
-- (uuid, uuid, boolean), mesmo search_path vazio, mesmo security definer,
-- mesmos grants (CREATE OR REPLACE os mantem: authenticated e service_role;
-- nada para anon nem public). O trecho que mudou esta entre
-- "-- [varios numeros] inicio" e "... fim"; o resto e o corpo de producao
-- linha a linha.
--
-- O que muda: LIGAR um numero (p_ativo verdadeiro) nao desliga mais os
-- outros numeros da clinica. Cada numero liga e desliga sozinho, e a trilha
-- ganha uma linha por chamada (antes, mais uma por numero desligado junto).
--
-- Conferido, sem mudanca (todas ja decidem pelo numero DA conversa, ou olham
-- todos os numeros ligados da clinica): ia_pode_atender,
-- ia_atende_no_whatsapp e ia_pode_falar_com (o numero recebido);
-- ingest_inbound_message (o numero que recebeu; uma conversa aberta por
-- contato E numero, indice conversation_aberta_por_numero);
-- enfileirar_resposta_da_ia, ia_pode_enviar_agora,
-- mensagem_ia_exige_aprovacao, proteger_status_ia_atendendo,
-- devolver_para_ia e ia_devolver_disponivel (o numero da conversa);
-- ia_desligar (cada conversa no proprio numero: desligar um numero devolve
-- so as conversas dele); motor_manutencao (a varredura, por conversa);
-- situacao_da_ia_na_clinica (telefones_com_conversa_aberta ja olha todos os
-- numeros ligados e nao removidos); saude_do_motor e ia_estado_do_motor (sem
-- numero); ia_numero_liberado_coerente (por linha). ia_numero_liberado nao
-- tem indice unico por clinica: so esta funcao impunha o "um por vez".
--
-- O que NAO muda: ligar numero continua so da equipe Conduzza
-- (ia_exigir_equipe_conduzza, 42501 com a mensagem de hoje); desligar
-- continua com quem ia_exigir_quem_libera aceita (o administrador ativo da
-- propria clinica da lista ou e_de_teste, o super admin e o servidor); a
-- trava da clinica (FOR UPDATE em ia_liberacao); os erros (22004; 23503 da
-- clinica sem linha ou do numero de outra clinica; 23514 do numero
-- removido); ia_desligar depois de gravar; a trilha 'editou'. A IA continua
-- respondendo so aos telefones da equipe ligados na aba, com todas as
-- outras travas do E3 (lista fechada, interruptor, modo contatos, janela,
-- gatilho de message, sinal de paciente, numero da plataforma).
--
-- NADA LIGA SOZINHO: nenhuma linha muda com a migration. O outro numero da
-- Conduzza Teste so passa a atender quando a equipe Conduzza o ligar (aba
-- ou RPC).
--
-- LOCKS: nenhum de tabela (so CREATE OR REPLACE FUNCTION e COMMENT ON
-- FUNCTION). Horario calmo. Nenhum ALTER.
--
-- ORDEM: ensaio (~/.claude/plans/e3-whatsapp/ensaios/
-- ensaio-m5-20261019110000.sql), esta migration, conferir o md5 novo e so
-- DEPOIS o codigo da aba "Números do assistente". O codigo de antes com a
-- migration aplicada nao quebra, mas engana: "Usar este número" passa a
-- somar o numero em vez de trocar, e o cartao antigo mostra so um deles
-- como escolhido.
--
-- ROLLBACK manual: reaplicar o corpo e o comentario de
-- supabase/operacao/rollback/20261019110000-corpos-anteriores.sql (ligar
-- volta a desligar os outros). Os numeros ligados juntos CONTINUAM ligados
-- (o corpo antigo so mexe nos outros ao ligar) e a IA continua respondendo
-- por todos eles: desligar pela aba ou pela RPC os que sobrarem, deixando um
-- so, ANTES de voltar o codigo antigo da aba.
-- ---------------------------------------------------------------------------

create or replace function public.definir_numero_da_ia(p_clinic_id uuid, p_whatsapp_account_id uuid, p_ativo boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

comment on function public.definir_numero_da_ia(uuid, uuid, boolean) is
  'Liga ou desliga um numero de WhatsApp para a IA (T4). Varios numeros por clinica (decisao do dono de 19/10/2026): cada numero liga e desliga sozinho, sem mexer nos outros. Exige a clinica liberada antes (23503), numero da mesma clinica (23503) e nao removido ao ligar (23514); com erro, nada muda. Desligar devolve para a equipe as conversas daquele numero. Ligar: so a equipe Conduzza (super admin, SQL editor ou service role; ia_exigir_equipe_conduzza, 42501). Desligar: tambem o administrador ativo da propria clinica da lista (ou e_de_teste), pelo guarda ia_exigir_quem_libera (42501 para os demais). Grava audit_log.';

notify pgrst, 'reload schema';
