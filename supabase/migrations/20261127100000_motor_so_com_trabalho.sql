-- Motor so chama a Vercel quando ha trabalho (decisao do dono de 27/11/2026:
-- reduzir o log da Supabase, "So o motor").
--
-- Antes, disparar_ciclo_do_motor chamava /api/webhooks/motor a cada 20 s
-- mesmo com a fila vazia: 4.320 chamadas por dia, cada uma com seis
-- requisicoes ao banco (duas batidas e quatro claims), uns 60% do log do
-- gateway da Supabase (medido em 24/11/2026).
--
-- Agora a chamada sai so quando:
--   1. ha job que o claim do motor pegaria (as condicoes de
--      claim_jobs_por_clinica, sem a resposta da IA, que tem motor proprio,
--      disparar_ciclo_da_ia), ou
--   2. a batida 'motor-fila' passou de 100 s: o sinal de vida. Com o cron a
--      cada 20 s a batida nunca passa de uns 2 min, abaixo dos 3 min de
--      TOLERANCIA_DE_BATIDA_MS (lib/domain/motor.ts): a faixa de motor parado
--      e a rota de saude continuam valendo como antes.
--
-- O job executando com lease vencido chama mesmo sem tentativas restantes,
-- porque e o claim que o enterra. Se a guarda errar para menos (um kind novo
-- ou uma regra nova no claim), o job espera o proximo sinal de vida, uns
-- 2 min; nunca fica parado. Com a Vercel fora, a batida envelhece e a chamada
-- volta a sair a cada 20 s, como antes.

create or replace function public.disparar_ciclo_do_motor()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
       select 1
       from job_queue q
       join clinic c on c.id = q.clinic_id
       where q.kind <> 'responder_com_ia'
         and not c.e_de_teste
         and (q.kind = 'baixar_midia'
              or not exists (
                select 1 from public.clinica_suspensa s where s.clinic_id = c.id
              ))
         and (
           (q.status = 'pendente' and q.run_at <= now())
           or (q.status = 'executando'
               and q.locked_at < now() - interval '180 seconds')
         )
     )
     and exists (
       select 1 from worker_heartbeat
       where worker_id = 'motor-fila'
         and batida_em > now() - interval '100 seconds'
     )
  then
    return;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'motor_tick_url';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'motor_tick_secret';

  if v_url is null or v_secret is null then
    raise exception 'motor_tick_url ou motor_tick_secret ausente no Vault';
  end if;

  execute format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 58000)',
    v_url,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::text,
    jsonb_build_object('origem', 'cron', 'disparado_em', now())::text
  );
end;
$$;

revoke execute on function public.disparar_ciclo_do_motor() from public, anon, authenticated;
grant execute on function public.disparar_ciclo_do_motor() to service_role;
