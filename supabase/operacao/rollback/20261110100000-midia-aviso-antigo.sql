-- Rollback da 20261110100000: volta a exigir o aviso novo na midia. Rodar
-- DEPOIS de voltar o codigo (o codigo novo nao mostra o chip do aviso antigo).
begin;
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
       and k.aviso_da_openai_versao >= 2
  )
$function$;

comment on function public.midia_da_ia_liberada(uuid, text) is
  'So o servidor (service_role; o motor da IA e gravar_leitura_da_midia). AG6b (D-60, D-95): verdadeiro so se a clinica tem em ia_contato_liberado o telefone (pela chave canonica, chave_telefone(btrim(p_telefone))), ativo, com aviso_da_openai_versao >= 2 (o aviso com audio, foto e documento). Qualquer nulo: falso. Nesta entrega nao ha outro caminho: contato fora da lista nunca manda midia a OpenAI.';
commit;
