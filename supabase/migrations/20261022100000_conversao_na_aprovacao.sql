-- ---------------------------------------------------------------------------
-- Conversao so na aprovacao (onda 2, item 10)
-- ---------------------------------------------------------------------------
-- Decisao do dono na E4 (20/10/2026, decisao 6), confirmada em 20 e
-- 21/10/2026 (P10a e P10b, contrato da onda 2 em
-- ~/.claude/plans/onda2-agente/contrato.md, secao 1): a consulta PENDENTE
-- (a que a IA marca nasce approval_status 'pendente') nao converte o lead
-- nem avanca o funil ate a equipe aprovar; recusar ou cancelar a pendente
-- conta como recusar. Vale para TODA consulta pendente (P10a): hoje so a da
-- IA nasce assim; o encaixe pendente, se um dia existir, segue a mesma
-- regra. Nenhuma funcao da onda 1 muda aqui.
--
-- 1. converter_lead_em_paciente() e avancar_funil_ao_agendar() (gatilhos
--    AFTER INSERT de appointment): CREATE OR REPLACE com o corpo de
--    producao e, no topo, "INSERT de consulta pendente nao faz nada"
--    (marca [onda 2: conversao na aprovacao]). Dois gatilhos NOVOS em appointment,
--    AFTER UPDATE OF approval_status, quando a consulta passa de pendente
--    para aprovado, chamam as MESMAS funcoes:
--      avancar_funil_na_aprovacao  -> avancar_funil_ao_agendar()
--      converter_lead_na_aprovacao -> converter_lead_em_paciente()
--    A ordem alfabetica repete a do INSERT: o funil primeiro, com o contato
--    ainda lead (registrar_conversao_do_funil, a conversao da Meta, e
--    registrar_entrada_para_automacao, que so registra lead, veem o mesmo de
--    hoje), depois o kind. Efeito: Leads, Resultados, a conversao da Meta e
--    a automacao "entrou na etapa" passam a contar na APROVACAO. Recusa e
--    cancelamento da pendente nao disparam nada, nem quando a pendente ja
--    cancelada (cancelar_pelo_paciente muda so o status) e aprovada depois:
--    o WHEN dos dois gatilhos pula os status de cancelamento. A consulta
--    marcada pela equipe (approval_status nulo) converte no INSERT, como
--    hoje.
--
-- 2. contato_tem_sinal_de_paciente(uuid, text) (a trava K): a consulta
--    pendente e a recusada deixam de contar como sinal de paciente (marca
--    [onda 2: conversao na aprovacao]); o resto (kind paciente, campanha, anuncio,
--    importacao, qualquer outra consulta) fica. Efeito: o telefone da equipe
--    que pediu horario continua conversando com a IA depois do agendar (a
--    resposta ao "sim" sai). Depois da APROVACAO o contato vira paciente e a
--    trava K volta a valer para telefone nao forcado (D-B de 13/10/2026,
--    mantida).
--
-- 3. Consulta pendente nao anda antes da aprovacao (P10b): gatilho NOVO
--    consulta_pendente_espera_aprovacao, BEFORE UPDATE OF status de
--    appointment, quando a consulta continua pendente e o status novo e
--    aguardando_confirmacao, confirmado_paciente, confirmado_recepcao,
--    na_recepcao, em_atendimento, compareceu ou faltou: 23514
--    'consulta_pendente' (a tela traduz). O nome comeca com "consulta" de
--    proposito: gatilhos BEFORE do mesmo evento rodam em ordem alfabetica e
--    este vem antes de consumir_sessao_de_pacote e dos outros. Cancelamento
--    passa (pela Agenda ele ja e a recusa, que troca approval_status no
--    mesmo UPDATE; pelo paciente, cancelar_pelo_paciente continua). Aprovar
--    e mudar o status no mesmo UPDATE passa. Fecha o buraco de "Compareceu"
--    numa pendente, que avancaria o funil pelo avancar_funil_ao_comparecer
--    antes da aprovacao. As quatro funcoes de producao que fazem UPDATE de
--    appointment (lidas em 21/10/2026): marcar_aguardando_confirmacao (so a
--    regua, que so pega send_confirmation, falso na pendente) e
--    confirmar_pelo_paciente (a regua e a confirmar_presenca da IA, que ja
--    excluem a pendente) recebem 23514 se chegarem numa pendente;
--    cancelar_pelo_paciente passa; pedir_remarcacao_pelo_paciente nao muda
--    status (o gatilho nem dispara). O ensaio prova as quatro. Residuo: a
--    recepcao que remarca uma pendente dispara o aviso de remarcacao, e o
--    "confirmar" do paciente nesse aviso da 23514 (o interceptador trata
--    como falha tecnica): o runbook diz "aprove antes de remarcar".
--
-- Funcoes trocadas (corpo de PRODUCAO lido por fndef.js em 21/10/2026,
-- guardado em supabase/operacao/rollback/20261022100000-corpos-anteriores.sql
-- com o md5 do prosrc; o ensaio confere que o banco ainda esta assim):
-- converter_lead_em_paciente, avancar_funil_ao_agendar e
-- contato_tem_sinal_de_paciente. Security, search_path, grants e comentario
-- de cada uma ficam como eram (CREATE OR REPLACE). Funcao nova:
-- consulta_pendente_espera_aprovacao() (so gatilho; ninguem executa).
-- Erros de regra: 23514 'consulta_pendente'. Nunca 40001/40P01. Nada aqui
-- grava texto de paciente.
--
-- LOCKS: lock_timeout de 3 s. Os tres CREATE TRIGGER seguram SHARE ROW
-- EXCLUSIVE em appointment ate o commit (escrita em appointment espera
-- milissegundos; leitura nao). Nenhum ALTER em message, conversation,
-- contact, clinic_member, job_queue nem clinic. Nenhuma linha muda ao
-- aplicar: as 15 consultas da producao (21/10/2026) tem approval_status nulo.
--
-- ORDEM: ensaio (~/.claude/plans/onda2-agente/ensaio-20261022100000.sql),
-- esta migration, conferir os md5 novos, os testes de RLS e de integracao,
-- e so DEPOIS o codigo da Agenda (recusa de status em pendente) e a nota de
-- "Confirmar presenca" na Tela 6. O codigo de hoje com a migration: mudar a
-- situacao de uma pendente para algo que nao e cancelamento da 23514 (falha
-- generica na tela) em vez de passar.
--
-- ROLLBACK (manual): o codigo antes; depois, numa transacao, no SQL editor,
-- supabase/operacao/rollback/20261022100000-corpos-anteriores.sql (os tres
-- gatilhos e a funcao nova saem, os tres corpos de antes voltam). O que
-- converteu na aprovacao fica convertido.

set local lock_timeout = '3s';

-- ===========================================================================
-- 1. Os gatilhos de conversao pulam a consulta pendente
-- ===========================================================================

create or replace function public.converter_lead_em_paciente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- [onda 2: conversao na aprovacao] inicio
  -- Item 10 da onda 2 (decisao do dono na E4, 20/10/2026): a consulta
  -- pendente (a da IA nasce assim) nao conta no INSERT; conta na
  -- aprovacao, pelo gatilho converter_lead_na_aprovacao (AFTER UPDATE OF
  -- approval_status, de pendente para aprovado), que chama esta mesma
  -- funcao. Recusar ou cancelar a pendente nao dispara nada.
  if tg_op = 'INSERT' and new.approval_status is not distinct from 'pendente' then
    return new;
  end if;
  -- [onda 2: conversao na aprovacao] fim
  update contact
  set kind = 'paciente'
  where id = new.contact_id
    and clinic_id = new.clinic_id
    and kind = 'lead';
  return new;
end;
$function$;

create or replace function public.avancar_funil_ao_agendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_destino record;
begin
  -- [onda 2: conversao na aprovacao] inicio
  -- Item 10 da onda 2 (decisao do dono na E4, 20/10/2026): a consulta
  -- pendente (a da IA nasce assim) nao conta no INSERT; conta na
  -- aprovacao, pelo gatilho avancar_funil_na_aprovacao (AFTER UPDATE OF
  -- approval_status, de pendente para aprovado), que chama esta mesma
  -- funcao. Recusar ou cancelar a pendente nao dispara nada.
  if tg_op = 'INSERT' and new.approval_status is not distinct from 'pendente' then
    return new;
  end if;
  -- [onda 2: conversao na aprovacao] fim
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

-- Na aprovacao: as mesmas funcoes, na mesma ordem do INSERT (alfabetica:
-- avancar_funil_na_aprovacao antes de converter_lead_na_aprovacao). A
-- pendente CANCELADA (cancelar_pelo_paciente muda so o status e ela
-- continua 'pendente') conta como recusada: aprovada depois, nao dispara
-- nada (revisao da onda 2).
create trigger avancar_funil_na_aprovacao
  after update of approval_status on public.appointment
  for each row
  when (old.approval_status = 'pendente' and new.approval_status = 'aprovado'
        and new.status not in ('cancelado_paciente', 'cancelado_clinica'))
  execute function public.avancar_funil_ao_agendar();

create trigger converter_lead_na_aprovacao
  after update of approval_status on public.appointment
  for each row
  when (old.approval_status = 'pendente' and new.approval_status = 'aprovado'
        and new.status not in ('cancelado_paciente', 'cancelado_clinica'))
  execute function public.converter_lead_em_paciente();

comment on trigger avancar_funil_na_aprovacao on public.appointment is
  'Onda 2, item 10: a consulta pendente que a equipe aprova avanca o funil (etapa de papel agendou) como o INSERT da consulta da equipe faz. Roda antes de converter_lead_na_aprovacao (ordem alfabetica): a conversao da Meta e a automacao veem o contato ainda lead. A pendente ja cancelada nao dispara (conta como recusada).';
comment on trigger converter_lead_na_aprovacao on public.appointment is
  'Onda 2, item 10: a consulta pendente que a equipe aprova converte o lead em paciente, como o INSERT da consulta da equipe faz. A pendente ja cancelada nao dispara (conta como recusada).';

-- ===========================================================================
-- 2. O sinal de paciente ignora a pendente e a recusada
-- ===========================================================================

create or replace function public.contato_tem_sinal_de_paciente(p_clinic_id uuid, p_phone_key text)
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
              -- [onda 2: conversao na aprovacao] inicio
              -- A consulta pendente (antes da aprovacao) e a recusada nao
              -- fazem do contato um paciente (item 10 da onda 2).
              and a.approval_status is distinct from 'pendente'
              and a.approval_status is distinct from 'recusado'
              -- [onda 2: conversao na aprovacao] fim
         )
       )
  ), false)
$function$;

comment on function public.contato_tem_sinal_de_paciente(uuid, text) is
  'Trava K da IA: o contato deste telefone tem sinal de paciente (kind paciente, campanha, anuncio, ctwa_clid, Google, importacao ou consulta)? A consulta pendente (antes da aprovacao) e a recusada nao contam (onda 2, item 10). So service_role (e as funcoes do banco).';

-- ===========================================================================
-- 3. Consulta pendente nao anda antes da aprovacao
-- ===========================================================================

create function public.consulta_pendente_espera_aprovacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- So roda pelo WHEN do gatilho: a consulta continua pendente e o status
  -- novo nao e cancelamento. Nada a gravar: a chave para a tela.
  raise exception using errcode = '23514', message = 'consulta_pendente',
    hint = 'Aprove ou recuse a consulta antes de mudar a situação.';
end;
$$;

revoke all on function public.consulta_pendente_espera_aprovacao()
  from public, anon, authenticated, service_role;

comment on function public.consulta_pendente_espera_aprovacao() is
  'Gatilho BEFORE UPDATE OF status de appointment (consulta_pendente_espera_aprovacao): a consulta pendente so aprova, recusa ou cancela. Confirmar, chegar, atender, compareceu e faltou levantam 23514 consulta_pendente (onda 2, item 10, P10b). Ninguem executa direto.';

create trigger consulta_pendente_espera_aprovacao
  before update of status on public.appointment
  for each row
  when (old.approval_status = 'pendente'
        and new.approval_status = 'pendente'
        and new.status in ('aguardando_confirmacao', 'confirmado_paciente',
                           'confirmado_recepcao', 'na_recepcao',
                           'em_atendimento', 'compareceu', 'faltou'))
  execute function public.consulta_pendente_espera_aprovacao();

comment on trigger consulta_pendente_espera_aprovacao on public.appointment is
  'Onda 2, item 10 (P10b): consulta pendente nao confirma, nao chega, nao e atendida nem falta antes da aprovacao (23514 consulta_pendente). Cancelar passa; aprovar e mudar o status no mesmo UPDATE passa.';
