-- ---------------------------------------------------------------------------
-- Espera do canal: WhatsApp fora do ar nao gasta o teto de 20 devolucoes
-- ---------------------------------------------------------------------------
-- Aplicar logo DEPOIS de 20260925140000_numeros_whatsapp_contrato.sql e antes
-- do deploy do codigo que passa o motivo 'desconectado' (lib/jobs/regua.ts e
-- lib/jobs/worker.ts). Nao depende da de contrato: so troca o corpo de
-- reagendar_job.
--
-- O DEFEITO. Com o numero da clinica desconectado (ou a clinica sem numero),
-- o toque de regua era devolvido de 5 em 5 minutos e cada devolucao somava em
-- job_queue.devolucoes. Na vigesima (cerca de 95 minutos) reagendar_job
-- encerrava o job como 'falhou', e fechar_runs_orfas fechava a run como
-- 'falha_envio': a confirmacao morria e nao saia quando a clinica
-- reconectava, contra a regra do dono "numero desconectado: o envio espera a
-- reconexao" (docs/07). Celular caido e a falha mais provavel no uazapi.
--
-- A REGRA. Esperar o canal NAO e o "canal que nao abre" do teto de 20. Quem
-- desiste e o executor, por PRAZO FIXO (confirmacao ate a hora da consulta;
-- as demais reguas ate 12h depois da primeira abertura da janela de envio a
-- partir de scheduled_for, ou do proprio scheduled_for no toque manual e no
-- que ja vence dentro da janela; o envio ativo ate a consulta do payload ou
-- created_at + 12h; lib/domain/espera-do-canal.ts), em esperas crescentes
-- de 5 ate 30 minutos. O banco so guarda:
--
--   1. Um teto de SEGURANCA proprio para as esperas do canal (motivos
--      'desconectado' e 'sem_numero'): 400 esperas. Com a espera crescente,
--      400 voltas dao cerca de 8 dias com janela de 24h (mais com janela
--      menor, que tambem soma 1 devolucao de janela por noite no teto de 20).
--      Cobre com folga os passos de hoje (ate 72h); uma confirmacao com passo
--      maior e o celular caido por mais tempo que isso morre como
--      'falha_envio', e isso foi aceito. O teto existe para um job com prazo
--      quebrado nao girar para sempre.
--   2. A contagem das esperas do canal do job, em payload.esperas_do_canal.
--      E dela que o executor tira o tamanho da proxima espera (0: 5 minutos;
--      5 ou mais: 30 minutos), e e ela que sai da conta do teto de 20: os
--      demais motivos (canal_ocupado, fora da janela, numero_removido)
--      contam SO as devolucoes que nao foram espera do canal. Sem isto, um
--      job que esperou o celular por mais de 20 voltas morreria na primeira
--      devolucao por canal ocupado logo depois da reconexao, que e justamente
--      quando a fila da clinica anda de uma vez. So esta funcao escreve a
--      chave, e a contagem lida nunca passa das devolucoes anteriores do
--      job. Nenhum caminho de hoje copia o payload de um job de envio para
--      outro (a continuacao da lista de espera copia o de oferecer, que
--      nunca espera por aqui); quem passar a copiar deve tirar a chave.
--
-- job_queue.devolucoes continua somando TODA devolucao (diagnostico e a faixa
-- de mensagens esperando, lib/queries/mensagens-esperando.ts, que conta
-- devolucoes > 0). O motivo 'whatsapp_desconectado' da lista de espera nao
-- muda: ela ja espera por continuacao (linha nova), fora deste teto.
--
-- Mesma assinatura, mesmo retorno: o codigo publicado continua chamando
-- igual. A chave nova no payload nao muda contato_do_job (le contact_id e
-- cadence_run_id) nem o gatilho job_ganha_numero (so dispara em clinic_id e
-- whatsapp_account_id).

create or replace function public.reagendar_job(
  p_id uuid,
  p_worker text,
  p_run_at timestamptz,
  p_motivo text default null
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_devolucoes integer;
  v_esperas integer;
  v_espera_do_canal boolean :=
    coalesce(p_motivo in ('desconectado', 'sem_numero'), false);
begin
  select j.devolucoes + 1,
         -- Esperas do canal ja feitas. Valor fora do contrato conta zero, e
         -- nunca passa das devolucoes anteriores (payload editado a mao nao
         -- livra o job do teto de 20).
         case
           when jsonb_typeof(j.payload -> 'esperas_do_canal') = 'number'
             then least(
               greatest(floor((j.payload ->> 'esperas_do_canal')::numeric), 0),
               j.devolucoes
             )::integer
           else 0
         end
    into v_devolucoes, v_esperas
    from job_queue j
   where j.id = p_id and j.locked_by = p_worker and j.status = 'executando';

  if v_devolucoes is null then
    return false; -- perdeu a posse; outro executor cuida
  end if;

  if v_espera_do_canal then
    v_esperas := v_esperas + 1;
    if v_esperas >= 400 then
      -- Teto de SEGURANCA da espera do canal: o executor ja desiste pelo
      -- prazo muito antes; chegar aqui e prazo quebrado.
      update job_queue
      set status = 'falhou',
          last_error = p_motivo,
          devolucoes = v_devolucoes,
          ultimo_motivo_devolucao = p_motivo,
          payload = payload || jsonb_build_object('esperas_do_canal', v_esperas),
          locked_by = null,
          locked_at = null
      where id = p_id;
      return true;
    end if;

    update job_queue
    set status = 'pendente',
        run_at = p_run_at,
        attempts = greatest(attempts - 1, 0),
        devolucoes = v_devolucoes,
        ultimo_motivo_devolucao = p_motivo,
        payload = payload || jsonb_build_object('esperas_do_canal', v_esperas),
        locked_by = null,
        locked_at = null
    where id = p_id;
    return true;
  end if;

  if v_devolucoes - v_esperas >= 20 then
    -- Teto: 20 adiamentos (fora as esperas do canal) e sinal de canal que nao
    -- abre, nao de fila cheia.
    update job_queue
    set status = 'falhou',
        last_error = coalesce(p_motivo, 'devolucoes_demais'),
        devolucoes = v_devolucoes,
        ultimo_motivo_devolucao = p_motivo,
        locked_by = null,
        locked_at = null
    where id = p_id;
    return true;
  end if;

  update job_queue
  set status = 'pendente',
      run_at = p_run_at,
      attempts = greatest(attempts - 1, 0),
      devolucoes = v_devolucoes,
      ultimo_motivo_devolucao = p_motivo,
      locked_by = null,
      locked_at = null
  where id = p_id;
  return true;
end;
$$;

comment on function public.reagendar_job(uuid, text, timestamptz, text) is
  'Devolve o job a fila sem queimar tentativa. Teto de 20 devolucoes para canal que nao abre (canal_ocupado, janela, numero_removido), sem contar as esperas do canal. WhatsApp fora do ar (motivos desconectado e sem_numero) e espera do canal: conta em payload.esperas_do_canal, com teto de seguranca de 400; quem desiste antes e o executor, pelo prazo (lib/domain/espera-do-canal.ts).';

-- create or replace mantem os privilegios; reafirmados aqui porque a funcao
-- mexe na fila e so o motor (service role) pode chama-la.
revoke execute on function public.reagendar_job(uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.reagendar_job(uuid, text, timestamptz, text)
  to service_role;
