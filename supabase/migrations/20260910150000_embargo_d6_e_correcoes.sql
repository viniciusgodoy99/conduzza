-- Correcoes da revisao adversarial do retorno de conversao (10 achados
-- confirmados em 09/09/2026). Os dois desta migration:
--
-- 1. EMBARGO DA DECISAO D6 NO BANCO. A trava "nada sai ate o dono decidir a
--    base legal" vivia so numa constante de React, e a policy de gestao
--    permite UPDATE em meta_ads_account: um gestor ligaria o envio de
--    telefone hasheado por chamada direta ao PostgREST, sem tocar em codigo
--    e sem rastro (regra 3.4: esconder botao nao protege nada). Agora o
--    gatilho recusa QUALQUER modo_user_data enquanto o embargo existir; sem
--    modo, o CHECK envio_exige_configuracao impede ligar o envio. Quando o
--    dono decidir a D6, a migration de liberacao troca o gatilho (e vira a
--    constante da tela).
--    De quebra, a conferencia de token passa a valer tambem no INSERT (a
--    versao anterior so cobria UPDATE).
--
-- 2. valor_da_conversao escolhia o agendamento de starts_at mais FUTURO e
--    aceitava falta. Agora: agendamento nao cancelado e nao faltoso mais
--    PROXIMO de agora, que e o que causou a conversao.

create or replace function public.conferir_token_antes_de_ligar_envio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- EMBARGO D6 (LGPD): enquanto a decisao de base legal nao for tomada pelo
  -- dono do produto, nenhum modo de envio de dados pessoais pode ser
  -- escolhido, por NINGUEM (o gatilho vale ate para o service role). A
  -- liberacao e uma migration que substitui esta funcao.
  if new.modo_user_data is not null then
    raise exception
      'A forma de envio dos dados ainda está em definição (decisão de privacidade pendente).';
  end if;

  if new.envio_ativado
     and (tg_op = 'INSERT' or not old.envio_ativado) then
    if not exists (
      select 1
        from public.meta_ads_account_secret s
       where s.clinic_id = new.clinic_id
         and s.capi_access_token is not null
    ) then
      raise exception
        'Para ligar o envio, cadastre o token da API de conversões.';
    end if;
  end if;
  return new;
end;
$$;

-- O gatilho anterior era so BEFORE UPDATE; recriar cobrindo INSERT.
drop trigger conferir_token_antes_de_ligar_envio on public.meta_ads_account;
create trigger conferir_token_antes_de_ligar_envio
  before insert or update on public.meta_ads_account
  for each row execute function public.conferir_token_antes_de_ligar_envio();

-- O agendamento que causou a conversao e o mais proximo de agora, nunca um
-- futuro distante; cancelado nao vale e falta nao e compra.
create or replace function public.valor_da_conversao(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_value_source text,
  p_value_cents integer
) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_value_source = 'fixo' then p_value_cents
    when p_value_source = 'service_link' then (
      select sl.price_cents
        from public.appointment a
        join public.service_link sl on sl.id = a.service_link_id
       where a.clinic_id = p_clinic_id
         and a.contact_id = p_contact_id
         and a.status not in
           ('cancelado_paciente', 'cancelado_clinica', 'faltou')
       order by abs(extract(epoch from (a.starts_at - now())))
       limit 1
    )
    else null
  end;
$$;
