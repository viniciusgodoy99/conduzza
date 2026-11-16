-- Liberacao do envio de conversoes para a Meta.
--
-- Decisao D6 do dono do produto em 16/11/2026, depois do benchmark do Tintim
-- e do Q5: "Tudo, desconsidere o lgpd do nosso lado". O embargo da migration
-- 20260910150000 (que recusava qualquer modo_user_data, ate para o service
-- role) sai. A clinica volta a escolher o modo na aba "Anuncios da Meta" e a
-- ligar o envio. O que FICA: ligar o envio exige o token da API de conversoes
-- na tabela-secret (INSERT e UPDATE), e o CHECK envio_exige_configuracao
-- exige Pixel e modo.
--
-- So troca o corpo da funcao: o gatilho (before insert or update) e o mesmo.

create or replace function public.conferir_token_antes_de_ligar_envio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

comment on column public.meta_ads_account.modo_user_data is
  'ctwa_apenas: so o identificador do clique. telefone_hasheado: tambem o SHA-256 do telefone de todo contato que converte, sem corte por autorizacao (decisao D6 do dono, 16/11/2026). Nulo: a clinica ainda nao escolheu; o envio nao liga sem ele.';
