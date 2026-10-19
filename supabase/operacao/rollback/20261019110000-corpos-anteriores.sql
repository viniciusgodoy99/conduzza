-- Corpo e comentario lidos da producao em 19/10/2026, antes da migration
-- 20261019110000 (mais de um numero da mesma clinica; decisao do dono de
-- 19/10/2026). md5(prosrc) na leitura: d3ba61b49cc7a987e48178ffc9909b08 (o
-- ensaio confere que o banco ainda esta assim antes de trocar).
--
-- ROLLBACK manual da migration (cabecalho dela): reaplicar este corpo e o
-- comentario, que voltam ao "um numero por vez" (ligar um numero desliga os
-- outros da clinica na mesma transacao). CREATE OR REPLACE mantem a
-- assinatura e os grants de hoje (authenticated e service_role; nada para
-- anon nem public). Nenhuma trava de tabela.
--
-- ATENCAO: o corpo antigo so mexe nos outros numeros AO LIGAR. Os numeros
-- que ficaram ligados juntos depois da migration CONTINUAM ligados, e a IA
-- continua respondendo por todos eles (as funcoes de decisao sempre foram
-- por numero). Antes de voltar o codigo antigo da aba, desligar os que
-- sobrarem, deixando um so: pela aba ("Desligar" no cartao "Números do
-- assistente") ou pela RPC, por nome de parametro:
--   select public.definir_numero_da_ia(p_clinic_id => '<clinica>',
--     p_whatsapp_account_id => '<numero>', p_ativo => false);
-- Conferir (uma linha por clinica, nenhuma com mais de um):
--   select clinic_id, count(*) filter (where ativo) as ligados
--     from public.ia_numero_liberado group by clinic_id;

-- definir_numero_da_ia: corpo do banco ANTES da 20261019110000
CREATE OR REPLACE FUNCTION public.definir_numero_da_ia(p_clinic_id uuid, p_whatsapp_account_id uuid, p_ativo boolean)
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

  -- Um numero por vez nesta fase: ligar este desliga os outros da clinica,
  -- na mesma transacao e debaixo da mesma trava (duas chamadas ao mesmo
  -- tempo, cada uma ligando um numero, terminam com um so: a segunda espera
  -- o commit da primeira e desliga o dela). Se a gravacao deste numero falhar
  -- adiante (23503 de outra clinica, 23514 removido), tudo volta junto e os
  -- outros continuam como estavam. Uma linha de trilha por numero desligado.
  if p_ativo then
    with desligados as (
      update public.ia_numero_liberado n
         set ativo = false,
             alterado_por = auth.uid()
       where n.clinic_id = p_clinic_id
         and n.whatsapp_account_id <> p_whatsapp_account_id
         and n.ativo
      returning n.whatsapp_account_id
    )
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    select p_clinic_id, auth.uid(), 'editou', 'ia_numero_liberado', d.whatsapp_account_id
      from desligados d;
  end if;

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
  'Libera ou desliga um numero de WhatsApp para a IA (T4). Um numero por vez: ligar desliga os outros numeros da clinica na mesma transacao (uma linha de trilha por numero desligado); desligar nao mexe nos outros. Exige a clinica liberada antes (23503), numero da mesma clinica (23503) e nao removido ao ligar (23514); com erro, nada muda. Desligar devolve as conversas do numero para a equipe. Quem chama: super admin, SQL editor, service role ou o administrador ativo da propria clinica da lista (ou e_de_teste), pelo guarda ia_exigir_quem_libera (42501 para os demais). Grava audit_log.';

notify pgrst, 'reload schema';
