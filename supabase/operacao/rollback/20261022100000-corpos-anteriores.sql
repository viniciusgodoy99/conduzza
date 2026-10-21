-- Corpos lidos da producao em 21/10/2026 (fndef.js, so leitura), antes da
-- migration 20261022100000 (conversao so na aprovacao, onda 2, item 10).
-- md5(prosrc) na leitura (o ensaio confere que o banco ainda esta assim
-- antes de trocar):
--   converter_lead_em_paciente()               e8298893084d28c90823773cd3e7facb
--   avancar_funil_ao_agendar()                 db482cd16a74f1f17c2ab243589cca58
--   contato_tem_sinal_de_paciente(uuid, text)  a8b218ba933489185714c55f02916634
-- Os tres nao tinham comentario na producao; contato_tem_sinal_de_paciente
-- ganha um na migration, que sai aqui.
--
-- ROLLBACK manual da migration (cabecalho dela). As tres da onda 2 se
-- desfazem na ordem INVERSA da aplicacao: a 20261022120000 (M3), depois a
-- 20261022110000 (M2), depois esta. ORDEM:
--   1. Voltar o CODIGO da Agenda e da Tela 6 que depende da regra nova
--      (recusa de status em pendente e a nota de "Confirmar presenca").
--   2. Rodar ESTE arquivo inteiro, numa transacao, no SQL editor: os tres
--      gatilhos novos e a funcao nova saem; os tres corpos de antes voltam
--      (CREATE OR REPLACE: mesmas assinaturas, security, search_path e
--      grants).
-- O que fica: o que converteu na aprovacao continua convertido (kind
-- paciente, etapa do funil, conversion_event, execucao de automacao); a
-- consulta pendente que ja existir volta a contar como sinal de paciente.
-- TRAVAS: DROP TRIGGER segura ACCESS EXCLUSIVE em appointment ate o commit
-- (curto); lock_timeout de 3 s, horario calmo.
-- Conferir no fim: os tres md5 acima, nenhum dos tres gatilhos novos,
-- nenhuma consulta_pendente_espera_aprovacao().

begin;
set local lock_timeout = '3s';

-- 1. Os gatilhos e a funcao nova.
drop trigger if exists consulta_pendente_espera_aprovacao on public.appointment;
drop trigger if exists converter_lead_na_aprovacao on public.appointment;
drop trigger if exists avancar_funil_na_aprovacao on public.appointment;
drop function if exists public.consulta_pendente_espera_aprovacao();

-- 2. Os corpos de antes e os comentarios de antes.
CREATE OR REPLACE FUNCTION public.converter_lead_em_paciente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update contact
  set kind = 'paciente'
  where id = new.contact_id
    and clinic_id = new.clinic_id
    and kind = 'lead';
  return new;
end;
$function$;
comment on function public.converter_lead_em_paciente() is null;

CREATE OR REPLACE FUNCTION public.avancar_funil_ao_agendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_destino record;
begin
  select chave, posicao into v_destino
    from public.funnel_stage_def
   where clinic_id = new.clinic_id and papel = 'agendou';
  if not found then
    return new;
  end if;

  update public.contact c
     set funnel_stage = v_destino.chave,
         lost_reason = null,
         lost_reason_note = null
   where c.id = new.contact_id
     and c.clinic_id = new.clinic_id
     and exists (
       select 1 from public.funnel_stage_def d
        where d.clinic_id = c.clinic_id
          and d.chave = c.funnel_stage
          and (d.posicao < v_destino.posicao or d.papel = 'perdido')
     );
  return new;
end;
$function$;
comment on function public.avancar_funil_ao_agendar() is null;

CREATE OR REPLACE FUNCTION public.contato_tem_sinal_de_paciente(p_clinic_id uuid, p_phone_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(exists (
    select 1
      from public.contact k
     where k.clinic_id = p_clinic_id
       and k.phone_key = public.chave_telefone(btrim(p_phone_key))
       and (
         k.kind = 'paciente'
         or k.source_campaign is not null
         or k.source_campaign_id is not null
         or k.source_ad_id is not null
         or k.ctwa_clid is not null
         or k.source_google_campaign_id is not null
         or k.criado_por_importacao
         or exists (
           select 1
             from public.appointment a
            where a.clinic_id = p_clinic_id
              and a.contact_id = k.id
         )
       )
  ), false)
$function$;
comment on function public.contato_tem_sinal_de_paciente(uuid, text) is null;

commit;

-- Conferencia (so leitura), depois do commit:
-- select p.oid::regprocedure, md5(p.prosrc)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('converter_lead_em_paciente', 'avancar_funil_ao_agendar',
--                      'contato_tem_sinal_de_paciente',
--                      'consulta_pendente_espera_aprovacao');
-- select tgname from pg_trigger
--  where tgrelid = 'public.appointment'::regclass
--    and tgname in ('avancar_funil_na_aprovacao', 'converter_lead_na_aprovacao',
--                   'consulta_pendente_espera_aprovacao');
