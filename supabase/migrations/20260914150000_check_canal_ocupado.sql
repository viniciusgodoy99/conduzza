-- Correcao de bug latente (achado na preparacao da 4.8): o executor de regua
-- grava skipped_reason = 'canal_ocupado' quando o slot anti-ban nao abre
-- dentro da espera maxima, mas o CHECK de cadence_run nunca aceitou esse
-- valor. O update falhava em silencio (pularRun ignorava o erro), a run
-- ficava pendente e a saude do motor a enterrava depois como 'falha_envio',
-- que mente o motivo para a recepcao.
--
-- Junto com esta migration, pularRun passou a PROPAGAR o erro do update:
-- gravacao de motivo que falha vira retry do job, nunca silencio.

alter table public.cadence_run
  drop constraint cadence_run_skipped_reason_check;
alter table public.cadence_run
  add constraint cadence_run_skipped_reason_check
  check (skipped_reason in (
    'sem_consentimento',
    'fora_janela',
    'condicao_parada',
    'falha_envio',
    'desconectado',
    'teto_gasto',
    'canal_ocupado'
  ));
