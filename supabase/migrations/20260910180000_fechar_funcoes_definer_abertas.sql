-- Varredura de funcoes SECURITY DEFINER com EXECUTE aberto, feita apos o
-- oraculo de valor_da_conversao (migration 20260910170000): mesmo defeito,
-- outras portas. Duas reais:
--
-- 1. consentimento_vigente: o grant a authenticated/service_role existia
--    (migration 20260820200000), mas o EXECUTE default de PUBLIC nunca foi
--    revogado, entao qualquer portador da chave anon, sem login, sondava o
--    consentimento de qualquer paciente por UUID (dado sobre paciente, regra
--    3.1). E um usuario logado de OUTRA clinica podia sondar tambem, porque
--    a funcao nao tinha guarda interna nenhuma. Fecha as duas pontas:
--    revoke de public/anon e guarda de clinica para sessao (o padrao de
--    incrementar_no_show: auth.uid() nulo e o worker por service_role, que
--    mantem acesso pleno).
--
-- 2. seed_reguas_padrao: aberta para public/anon/authenticated e sem guarda,
--    qualquer um semeava reguas na clinica dos outros (escrita atravessando
--    a fronteira do tenant). So o gatilho de criacao de clinica (definer,
--    dono postgres) e o service role chamam.
--
-- Conferidas e corretas, sem mudanca: incrementar_no_show e saude_do_motor
-- (anon ja revogado), pode_apagar/apagar_mensagem (guarda interna de
-- sessao), validar_codigo_clinica (anon por desenho, fluxo de cadastro),
-- funcoes user_* (so revelam o proprio vinculo).

create or replace function public.consentimento_vigente(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_channel text default 'whatsapp'
) returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select case
    -- Sessao de usuario so consulta consentimento da PROPRIA clinica; fora
    -- dela a resposta e a mesma de "sem consentimento", nada a aprender.
    when auth.uid() is not null
         and p_clinic_id not in (select public.user_active_clinic_ids())
      then false
    else coalesce(
      (select revoked_at is null
         from contact_consent
        where clinic_id = p_clinic_id
          and contact_id = p_contact_id
          and channel = p_channel
        order by granted_at desc, created_at desc
        limit 1),
      false
    )
  end
$$;

revoke execute on function public.consentimento_vigente(uuid, uuid, text)
  from public, anon;

revoke execute on function public.seed_reguas_padrao(uuid)
  from public, anon, authenticated;
