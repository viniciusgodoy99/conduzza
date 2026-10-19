-- ---------------------------------------------------------------------------
-- Agente de IA: o administrador da clinica cadastra e liga os telefones da
-- equipe (19/10/2026)
-- ---------------------------------------------------------------------------
-- Decisao do dono em 19/10/2026 ("liberar o administrador"), tomada depois
-- do aviso de que nao era a recomendacao: o administrador da Conduzza Teste
-- (f0c115dd) cadastra os telefones de teste de la, e o dono nao e membro
-- dela. Reve a trava F do E3 (docs/04, 17.13; migration 20261013100000) SO
-- no telefone. Contrato: ~/.claude/plans/e3-whatsapp/contrato.md, 10.7.
--
-- So CREATE OR REPLACE de definir_contato_liberado_da_ia, partindo do corpo
-- de PRODUCAO de 19/10/2026 (guardado em
-- supabase/operacao/rollback/20261019100000-corpos-anteriores.sql). Mesma
-- assinatura (uuid, text, text, boolean, boolean), mesmo search_path vazio,
-- mesmo security definer, mesmos grants (CREATE OR REPLACE os mantem:
-- authenticated e service_role; nada para anon nem public). O trecho novo
-- esta entre "-- [telefone pelo administrador] inicio" e "... fim"; o resto
-- e o corpo de producao linha a linha.
--
-- O que muda:
--   - LIGAR telefone (p_ativo verdadeiro: adicionar ou "Ligar de novo")
--     passa a valer para quem ia_exigir_quem_libera aceita: o administrador
--     ativo da propria clinica da lista fechada (ou e_de_teste, nas
--     suites), o super admin e o servidor. Antes, so
--     ia_exigir_equipe_conduzza (super admin e servidor).
--   - O FORCAR (p_forcar_contato_existente verdadeiro ao ligar) continua so
--     da equipe Conduzza (ia_exigir_equipe_conduzza, 42501 com a mensagem de
--     hoje), conferido logo depois do guarda, antes de qualquer leitura e
--     MESMO quando o telefone nao tem sinal de paciente.
--
-- O que NAO muda: desligar (so o guarda, nunca recusado por plataforma nem
-- por paciente); para todos, a recusa do numero de WhatsApp de qualquer
-- clinica do Conduzza (23514 telefone_invalido_para_equipe) e do telefone
-- com sinal de paciente sem o forcar (23514 contato_de_paciente); a lista
-- fechada (ia_exigir_quem_libera, intocado); os gatilhos de
-- ia_contato_liberado (ia_contato_liberado_coerente e
-- ia_contato_liberado_forcado_so_pela_funcao); e_de_teste; a trilha
-- (audit_log 'editou' e 'forcou_telefone_de_paciente_na_ia'); ia_desligar.
-- Ligar o modo contatos (definir_liberacao_da_ia) e ligar numero
-- (definir_numero_da_ia) continuam so da equipe Conduzza: nao sao tocados.
--
-- NADA LIGA SOZINHO: nenhuma linha muda com a migration, e telefone ligado
-- sem o modo contatos e sem numero ligado (os dois so pela equipe Conduzza)
-- nao aciona o assistente.
--
-- LOCKS: nenhum de tabela (so CREATE OR REPLACE FUNCTION). Horario calmo.
-- Nenhum ALTER.
--
-- ORDEM: ensaio (~/.claude/plans/e3-whatsapp/ensaios/
-- ensaio-m4-20261019100000.sql), esta migration e so DEPOIS o codigo da
-- aba. O codigo de antes recusa o administrador na propria action, entao a
-- migration aplicada antes do deploy nao muda nada na tela.
--
-- ROLLBACK manual: reaplicar o corpo de
-- supabase/operacao/rollback/20261019100000-corpos-anteriores.sql (ligar
-- telefone volta a exigir a equipe Conduzza). Os telefones que o
-- administrador ligou continuam ligados: desligar pela aba ou pela RPC, se
-- o dono quiser. O codigo novo sem esta migration recebe 42501 do banco ao
-- ligar telefone pelo administrador e mostra o texto de permissao; nada e
-- gravado.
-- ---------------------------------------------------------------------------

create or replace function public.definir_contato_liberado_da_ia(p_clinic_id uuid, p_telefone_e164 text, p_rotulo text, p_ativo boolean, p_forcar_contato_existente boolean DEFAULT false)
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

  -- [whatsapp so pela equipe] inicio
  if v_forcou then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'forcou_telefone_de_paciente_na_ia', 'ia_contato_liberado', v_id);
  end if;
  -- [whatsapp so pela equipe] fim

  return p_ativo;
end;
$function$;

notify pgrst, 'reload schema';
