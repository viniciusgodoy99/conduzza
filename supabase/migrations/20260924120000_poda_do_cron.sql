-- ---------------------------------------------------------------------------
-- Poda diaria do historico do pg_cron (revisao de liberacao, 24/09/2026,
-- achado 129)
-- ---------------------------------------------------------------------------
-- O QUE. Agenda no pg_cron a entrada 'poda-do-cron', uma vez por dia, que
-- apaga de cron.job_run_details as execucoes com mais de 7 dias.
--
-- POR QUE. O motor tem duas entradas (motor-fila a cada 20 segundos,
-- motor-manutencao a cada 60): sao 5.760 linhas por dia em
-- cron.job_run_details, e o pg_cron nunca apaga nenhuma. Em 24/09 eram
-- 126.919 linhas e 20 MB acumulados desde 02/09 (cerca de 6 MB por semana),
-- contando contra a cota de 500 MB do plano Free, acima da qual o projeto
-- entra em modo somente leitura e o webhook deixa de gravar a mensagem do
-- paciente. Com a poda o historico fica perto de 40 mil linhas, que ainda
-- cobrem a semana inteira para diagnosticar um incidente.
--
-- POR QUE EM MIGRATION, se a 20260902120000 deixou cron.schedule de fora. La
-- o risco era um Postgres de laptop virar um SEGUNDO motor chamando a
-- producao pelo pg_net. A poda nao chama nada fora do banco: num banco local
-- ela so apaga o historico daquele banco. O outro cuidado de la continua
-- valendo: a migration precisa aplicar num banco SEM pg_cron (o CLI local
-- pode nao te-lo), entao o agendamento so acontece se a extensao existir, e
-- por execute, resolvido em tempo de execucao.
--
-- IDEMPOTENTE. cron.schedule com um nome que ja existe atualiza a entrada em
-- vez de criar outra (pg_cron 1.3 em diante; a producao tem 1.6.4).
--
-- HORARIO. '17 6 * * *' no fuso do pg_cron (cron.timezone = GMT na
-- producao) e 03:17 em America/Fortaleza: longe da janela das reguas (08:00 a
-- 20:30) e fora de minuto redondo.
--
-- CRITERIO. coalesce(end_time, start_time): uma execucao que nunca terminou
-- (end_time nulo) tambem sai quando envelhece, em vez de ficar para sempre.
--
-- O QUE NAO ESTA AQUI. O REINDEX dos indices de message (60 MB de indice para
-- cerca de 5 mil linhas, efeito dos testes contra o banco) nao roda dentro de
-- transacao, e toda migration roda numa. E passo manual, descrito em
-- supabase/operacao/motor-por-cron.md, secao "Espaco em disco".
--
-- Para desligar: select cron.unschedule('poda-do-cron');
-- ---------------------------------------------------------------------------

do $poda$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$
      select cron.schedule(
        'poda-do-cron',
        '17 6 * * *',
        $cmd$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days'$cmd$
      )
    $cron$;
  end if;
end;
$poda$;
