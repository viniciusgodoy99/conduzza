-- ---------------------------------------------------------------------------
-- Audio, foto e documento para todo telefone liberado (decisao do dono de
-- 09/11/2026)
-- ---------------------------------------------------------------------------
-- O dono, sobre o chip "Sem audio, foto e documento" do telefone com o aviso
-- antigo: "nao faz sentido estar desligado para o agente isso, o agente sempre
-- precisa transcrever o audio com o whisper, sempre tem que entender a foto e
-- documento tambem". midia_da_ia_liberada deixa de exigir o aviso novo
-- (aviso_da_openai_versao >= 2, D-95): vale para todo telefone ativo da lista.
-- A coluna fica (o formulario continua gravando a 2), sem efeito na midia.
--
-- O QUE NAO MUDA: so telefone da lista; em numero_inteiro, quem nao esta na
-- lista continua sem midia pela IA (decisao de LGPD ainda do dono). O resto da
-- trava da midia (a posse do job, a janela, o teto) fica no codigo e em
-- gravar_leitura_da_midia, que chama esta funcao.
--
-- TRAVAS: so catalogo. ORDEM: antes do codigo (o codigo novo tira o chip).
-- ROLLBACK: supabase/operacao/rollback/20261110100000-midia-aviso-antigo.sql.

set local lock_timeout = '3s';

create or replace function public.midia_da_ia_liberada(p_clinic_id uuid, p_telefone text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
      from public.ia_contato_liberado k
     where k.clinic_id = p_clinic_id
       and k.phone_key = public.chave_telefone(btrim(p_telefone))
       and k.ativo
  )
$function$;

comment on function public.midia_da_ia_liberada(uuid, text) is
  'So o servidor (service_role; o motor da IA e gravar_leitura_da_midia). Verdadeiro se a clinica tem em ia_contato_liberado o telefone (pela chave canonica, chave_telefone(btrim(p_telefone))), ativo. Desde a decisao do dono de 09/11/2026 (o agente sempre transcreve o audio e entende a foto e o documento) nao exige mais o aviso novo (aviso_da_openai_versao >= 2). Qualquer nulo: falso. Contato fora da lista continua sem midia pela IA.';
