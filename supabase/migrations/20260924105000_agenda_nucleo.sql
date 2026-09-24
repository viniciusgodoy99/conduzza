-- Agenda, nucleo (revisao de liberacao de 24/09/2026, grupo agenda-nucleo).
--
-- Achados 78, 79, 81, 84, 85, 133 e 7 (parte da falta). O que muda no banco:
--
-- 1. REMARCACAO VOLTA A PEDIR CONFIRMACAO (decisao do dono em 24/09/2026).
--    Quem confirmou confirmou o HORARIO ANTIGO. O gatilho preparar_remarcacao
--    devolve a consulta para 'agendado' (limpando canal e autor da
--    confirmacao) sempre que o horario ou o profissional mudam, para a regua
--    reconfirmar o horario novo. Na recepcao e Em atendimento ficam como
--    estao: o paciente ja esta na clinica. A Server Action faz o mesmo de
--    forma explicita; o gatilho e a defesa para qualquer outro caminho.
--
-- 2. CONSULTA ENCERRADA NAO SE REMARCA (achado 78). Mover uma consulta com
--    Compareceu, Faltou ou cancelada apagava a falta do dia original e
--    prendia o horario novo com uma situacao final. O mesmo gatilho recusa.
--
-- 3. A REMARCACAO ENTRA NA TRILHA (achado 84). Antes ela so ia para o
--    audit_log, que nenhuma tela le. Agora o gatilho registrar_remarcacao grava
--    no historico da consulta uma linha kind = 'remarcacao' com o horario e o
--    profissional de antes e de depois, quem mudou e quando. E pula os toques
--    ainda pendentes do horario antigo ('consulta_remarcada'); o planner cria
--    os do horario novo sozinho (a chave unica inclui scheduled_for).
--
-- 4. FALTA SO A PARTIR DO HORARIO (achado 81). Marcar Faltou antes da consulta
--    acontecer somava falta, disparava "Sentimos sua falta" em segundos e nao
--    tinha volta. O gatilho impedir_falta_antes_do_horario recusa; a Server
--    Action recusa antes, com a mensagem para a recepcao.
--
-- 5. O CONTADOR DE FALTAS PASSA A SER DO BANCO (achados 133 e 7). A RPC
--    incrementar_no_show era security definer e aberta a qualquer membro
--    ativo, inclusive o papel leitura: somava falta sem consulta nenhuma em
--    'faltou' e empurrava o paciente para a regua reforcada. Agora quem soma e
--    o gatilho contar_falta, na transicao de status. Ele herda o recorte da
--    policy de update de appointment (leitura nao escreve, profissional so a
--    propria agenda). A RPC deixa de existir: o unico chamador era a Server
--    Action, que parou de chamar.
--
-- 6. appointment.oferecer_vaga_ao_cancelar (contrato com o grupo
--    lista-de-espera, que cria a mesma coluna e a le no gatilho
--    oferecer_ao_cancelar): o dialogo de cancelamento grava a escolha da
--    recepcao. "if not exists" nos dois lados: a ordem de aplicacao nao
--    importa.

-- ---------------------------------------------------------------------------
-- 6. Coluna da escolha de oferecer a vaga
-- ---------------------------------------------------------------------------

alter table public.appointment
  add column if not exists oferecer_vaga_ao_cancelar boolean not null default true;

-- ---------------------------------------------------------------------------
-- 3a. Historico: a linha de remarcacao
-- ---------------------------------------------------------------------------

alter table public.appointment_status_history
  add column if not exists kind text not null default 'status',
  add column if not exists previous_starts_at timestamptz,
  add column if not exists previous_professional_id uuid
    references public.professional (id) on delete set null,
  add column if not exists new_starts_at timestamptz,
  add column if not exists new_professional_id uuid
    references public.professional (id) on delete set null;

alter table public.appointment_status_history
  drop constraint if exists appointment_status_history_kind_check;
alter table public.appointment_status_history
  add constraint appointment_status_history_kind_check
  check (kind in ('status', 'remarcacao'));

-- Linha de status nao carrega horario; linha de remarcacao carrega os dois.
alter table public.appointment_status_history
  drop constraint if exists appointment_status_history_remarcacao_check;
alter table public.appointment_status_history
  add constraint appointment_status_history_remarcacao_check
  check (
    (kind = 'status'
      and previous_starts_at is null
      and new_starts_at is null
      and previous_professional_id is null
      and new_professional_id is null)
    or
    (kind = 'remarcacao'
      and previous_starts_at is not null
      and new_starts_at is not null)
  );

-- A sessao so grava linha de STATUS: a de remarcacao nasce do gatilho, entao
-- ninguem forja pela API uma remarcacao que nao aconteceu. De carona, a
-- linha precisa ser da MESMA clinica da consulta (a versao anterior comparava
-- a.clinic_id com ele mesmo, o que sempre e verdade).
drop policy if exists "membro com escrita registra historico"
  on public.appointment_status_history;
create policy "membro com escrita registra historico"
  on public.appointment_status_history
  for insert
  with check (
    changed_by_user_id = auth.uid()
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
-- 1 e 2. Antes de mover: situacao final recusa, as demais voltam a confirmar
-- ---------------------------------------------------------------------------

create or replace function public.preparar_remarcacao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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
  end if;
  return new;
end;
$$;

drop trigger if exists preparar_remarcacao on public.appointment;
create trigger preparar_remarcacao
  before update of starts_at, professional_id on public.appointment
  for each row
  when (
    old.starts_at is distinct from new.starts_at
    or old.professional_id is distinct from new.professional_id
  )
  execute function public.preparar_remarcacao();

-- ---------------------------------------------------------------------------
-- 3b. Depois de mover: trilha e toques do horario antigo
-- ---------------------------------------------------------------------------

create or replace function public.registrar_remarcacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Definer: a linha kind = 'remarcacao' so nasce aqui (a policy de insert
  -- da sessao aceita so 'status'). Autoria pela sessao; sem sessao e sistema.
  insert into public.appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by,
    kind, previous_starts_at, previous_professional_id,
    new_starts_at, new_professional_id
  ) values (
    new.clinic_id, new.id, new.status, auth.uid(),
    case when auth.uid() is null then 'sistema' else 'usuario' end,
    'remarcacao', old.starts_at, old.professional_id,
    new.starts_at, new.professional_id
  );

  -- Toques ainda pendentes apontam para o HORARIO ANTIGO. Troca so de
  -- profissional nao mexe neles: o horario e o mesmo e o planner nao
  -- conseguiria recria-los (mesma chave unica).
  if old.starts_at is distinct from new.starts_at then
    begin
      update public.cadence_run
         set skipped_reason = 'consulta_remarcada'
       where appointment_id = new.id
         and sent_at is null
         and skipped_reason is null;
    exception when check_violation then
      -- O motivo 'consulta_remarcada' chega pela migration do grupo
      -- reguas-e-fila. Sem ela, o motivo generico: o toque velho morre do
      -- mesmo jeito e a remarcacao nunca e bloqueada por isto.
      update public.cadence_run
         set skipped_reason = 'condicao_parada'
       where appointment_id = new.id
         and sent_at is null
         and skipped_reason is null;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists registrar_remarcacao on public.appointment;
create trigger registrar_remarcacao
  after update of starts_at, professional_id on public.appointment
  for each row
  when (
    old.starts_at is distinct from new.starts_at
    or old.professional_id is distinct from new.professional_id
  )
  execute function public.registrar_remarcacao();

-- ---------------------------------------------------------------------------
-- 4. Falta so a partir do horario da consulta
-- ---------------------------------------------------------------------------

create or replace function public.impedir_falta_antes_do_horario()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.starts_at > now() then
    raise exception 'falta_antes_do_horario'
      using errcode = 'check_violation',
            hint = 'Falta só pode ser marcada a partir do horário da consulta.';
  end if;
  return new;
end;
$$;

drop trigger if exists impedir_falta_antes_do_horario on public.appointment;
create trigger impedir_falta_antes_do_horario
  before update of status on public.appointment
  for each row
  when (new.status = 'faltou' and old.status is distinct from 'faltou')
  execute function public.impedir_falta_antes_do_horario();

-- ---------------------------------------------------------------------------
-- 5. Contador de faltas mantido pelo banco
-- ---------------------------------------------------------------------------

create or replace function public.contar_falta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Definer porque o papel profissional nao escreve em contact (migration
  -- 20260825220000) e continua podendo marcar falta na propria agenda. Quem
  -- decide se a pessoa pode marcar a falta e a policy de update de
  -- appointment, que ja rodou antes deste gatilho.
  update public.contact
     set no_show_count = no_show_count + 1
   where id = new.contact_id
     and clinic_id = new.clinic_id;
  return null;
end;
$$;

drop trigger if exists contar_falta on public.appointment;
create trigger contar_falta
  after update of status on public.appointment
  for each row
  when (new.status = 'faltou' and old.status is distinct from 'faltou')
  execute function public.contar_falta();

-- A soma avulsa deixa de existir: com ela aberta, qualquer membro ativo
-- (inclusive leitura) somava falta sem consulta nenhuma em 'faltou'. Funcoes
-- "returns trigger" (as desta migration) nao sao chamaveis pela API.
drop function if exists public.incrementar_no_show(uuid);
