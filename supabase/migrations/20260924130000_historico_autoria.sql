-- Historico da consulta: autoria e hora que a sessao nao forja, e a
-- remarcacao para outro dia de quem ja chegou (revisao adversarial da leva 1
-- de liberacao, 24/09/2026, grupo agenda).
--
-- 1. A LINHA DE STATUS DA SESSAO E SEMPRE "EQUIPE" (achado R19). A policy de
--    insert reescrita em 20260924105000 exigia changed_by_user_id = auth.uid()
--    e kind = 'status', mas deixava livres changed_by, event e changed_at.
--    Uma sessao com escrita (recepcao, gestor, profissional na propria
--    agenda) gravava pela API "Pediu para remarcar, por Paciente",
--    "Cancelado pelo paciente, por Paciente" ou uma linha com data inventada,
--    e a trilha mostrava igual a verdadeira. Agora a sessao so grava
--    changed_by = 'usuario' (a autoria "Equipe" da tela) e event nulo. As
--    linhas de paciente, de sistema e o evento remarcacao_pedida nascem so
--    das funcoes security definer (que nao passam pela RLS): nada legitimo
--    quebra. O unico insert de sessao no codigo (registrarHistorico, em
--    app/(app)/agenda/actions.ts) ja grava exatamente isso.
--
--    A situacao da linha NAO e amarrada a situacao atual da consulta: isso
--    acoplaria a policy a ordem das chamadas da Server Action (o historico e
--    gravado depois do update).
--
-- 2. A HORA DA LINHA E A DO BANCO. Gatilho BEFORE INSERT: linha gravada com
--    sessao de usuario (auth.uid() presente) recebe changed_at = now(),
--    venha o que vier no payload. Sem sessao (service role do motor, do
--    webhook e dos testes) o valor informado vale, como antes: e o sistema.
--    Nenhuma funcao do banco informa changed_at explicito; todas usam o
--    default now(), entao o resultado delas nao muda.
--
-- 3. REMARCAR PARA OUTRO DIA QUEM JA CHEGOU VOLTA PARA AGENDADO (achado R4).
--    preparar_remarcacao mantinha Na recepcao e Em atendimento em qualquer
--    troca, com a justificativa "o paciente ja esta na clinica". Isso so vale
--    no MESMO dia civil da clinica (atraso do medico, troca de sala). Movida
--    para outro dia, a consulta aparecia amanha com o paciente ja presente e
--    a regua nunca pedia confirmacao (o planner so pergunta a agendado e
--    aguardando_confirmacao). Agora: outro dia no fuso da clinica volta para
--    'agendado', limpando canal e autor da confirmacao; mesmo dia fica como
--    esta. A Server Action faz o mesmo de forma explicita
--    (statusAposRemarcar com mesmoDia); o gatilho e a defesa para qualquer
--    outro caminho. Partiu da definicao vigente em producao.

-- ---------------------------------------------------------------------------
-- 1. Policy de insert do historico pela sessao
-- ---------------------------------------------------------------------------

drop policy if exists "membro com escrita registra historico"
  on public.appointment_status_history;
create policy "membro com escrita registra historico"
  on public.appointment_status_history
  for insert
  with check (
    changed_by_user_id = auth.uid()
    and changed_by = 'usuario'
    and event is null
    and kind = 'status'
    and exists (
      select 1
        from public.appointment a
       where a.id = appointment_status_history.appointment_id
         and a.clinic_id = appointment_status_history.clinic_id
         and public.user_can_write(a.clinic_id)
         and (
           not public.user_has_role(a.clinic_id, array['profissional'])
           or a.professional_id = public.user_professional_id(a.clinic_id)
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. A hora da linha gravada por sessao e a do banco
-- ---------------------------------------------------------------------------

create or replace function public.historico_na_hora_do_banco()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.changed_at := now();
  end if;
  return new;
end;
$$;

comment on function public.historico_na_hora_do_banco() is
  'Linha do historico da consulta gravada com sessao de usuario recebe changed_at = now(): a trilha nao aceita hora informada pela API (achado R19).';

drop trigger if exists historico_na_hora_do_banco
  on public.appointment_status_history;
create trigger historico_na_hora_do_banco
  before insert on public.appointment_status_history
  for each row
  execute function public.historico_na_hora_do_banco();

-- ---------------------------------------------------------------------------
-- 3. Remarcar: outro dia devolve para Agendado quem ja tinha chegado
-- ---------------------------------------------------------------------------

create or replace function public.preparar_remarcacao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fuso text;
begin
  if old.status in ('compareceu', 'faltou', 'cancelado_paciente', 'cancelado_clinica') then
    raise exception 'consulta_encerrada_nao_se_remarca'
      using errcode = 'check_violation',
            hint = 'Consulta encerrada não se remarca. Marque uma nova consulta.';
  end if;

  -- So as situacoes de antes do atendimento voltam a pedir confirmacao. Uma
  -- mudanca de status explicita para outra situacao no MESMO update (ex.:
  -- cancelar) nao e sobrescrita.
  if old.status in ('agendado', 'aguardando_confirmacao', 'confirmado_paciente', 'confirmado_recepcao')
     and new.status in ('agendado', 'aguardando_confirmacao', 'confirmado_paciente', 'confirmado_recepcao')
  then
    new.status := 'agendado';
    new.confirmed_by_user_id := null;
    new.confirmation_channel := null;
  elsif old.status in ('na_recepcao', 'em_atendimento')
     and new.status in (old.status, 'agendado')
     and old.starts_at is distinct from new.starts_at
  then
    -- Paciente ja na clinica: so a troca no MESMO dia civil da clinica
    -- mantem a situacao. Outro dia volta para Agendado, para a regua pedir
    -- confirmacao do horario novo.
    select c.timezone into v_fuso
      from public.clinic c
     where c.id = new.clinic_id;
    v_fuso := coalesce(v_fuso, 'America/Fortaleza');
    if (old.starts_at at time zone v_fuso)::date
       <> (new.starts_at at time zone v_fuso)::date
    then
      new.status := 'agendado';
      new.confirmed_by_user_id := null;
      new.confirmation_channel := null;
    end if;
  end if;
  return new;
end;
$$;
