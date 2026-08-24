-- Correcoes da auditoria da Fase 2 (24/08/2026). Endurece as policies de
-- escrita que o SELECT ja recortava, adiciona a jornada transacional e o
-- incremento atomico de falta.

-- ---------------------------------------------------------------------------
-- A2: trilha de status forjavel (autoria, clinica alvo e dominio do status)
-- ---------------------------------------------------------------------------
-- A policy de insert so exigia user_can_write(clinic_id): permitia gravar
-- linha com changed_by_user_id de OUTRO usuario, com clinic_id que nao casa
-- com a consulta, sem o recorte do profissional, e com status fora do enum
-- (que depois quebrava a folha de historico ao renderizar). Fecha os quatro.

drop policy "membro com escrita registra historico" on public.appointment_status_history;
create policy "membro com escrita registra historico" on public.appointment_status_history
  for insert with check (
    changed_by_user_id = auth.uid()
    and exists (
      select 1 from appointment a
      where a.id = appointment_id
        and a.clinic_id = clinic_id
        and public.user_can_write(a.clinic_id)
        and (
          not public.user_has_role(a.clinic_id, array['profissional'])
          or a.professional_id = public.user_professional_id(a.clinic_id)
        )
    )
  );

-- Status fora do enum vira lixo que a UI nao sabe renderizar: amarra o
-- dominio no banco (mesmas chaves do appointment).
alter table public.appointment_status_history
  add constraint appointment_status_history_status_check
  check (status in (
    'agendado', 'aguardando_confirmacao',
    'confirmado_paciente', 'confirmado_recepcao',
    'na_recepcao', 'em_atendimento', 'compareceu',
    'cancelado_paciente', 'cancelado_clinica', 'faltou'));

-- ---------------------------------------------------------------------------
-- A3: slot_hold escrito/apagado sem o recorte do profissional
-- ---------------------------------------------------------------------------
-- O SELECT restringia o papel profissional a propria agenda, mas INSERT e
-- DELETE usavam so user_can_write: um profissional criava ou apagava holds da
-- agenda de um colega (negacao de servico, dupla oferta). Aplica o recorte.

drop policy "membro com escrita cria hold" on public.slot_hold;
create policy "membro com escrita cria hold" on public.slot_hold
  for insert with check (
    public.user_can_write(clinic_id)
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or professional_id = public.user_professional_id(clinic_id)
    )
  );

drop policy "membro com escrita libera hold" on public.slot_hold;
create policy "membro com escrita libera hold" on public.slot_hold
  for delete using (
    public.user_can_write(clinic_id)
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or professional_id = public.user_professional_id(clinic_id)
    )
  );

-- ---------------------------------------------------------------------------
-- A4: jornada substituida numa transacao (delete + insert atomicos)
-- ---------------------------------------------------------------------------
-- A action deletava todas as faixas e depois inseria em duas chamadas
-- separadas: uma falha no insert deixava o profissional SEM jornada. Uma
-- funcao unica torna a substituicao tudo ou nada. SECURITY INVOKER: a RLS de
-- professional_schedule (admin/gestor) continua valendo.

create or replace function public.substituir_jornada(
  p_clinic_id uuid,
  p_professional_id uuid,
  p_faixas jsonb
) returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  delete from professional_schedule
  where clinic_id = p_clinic_id and professional_id = p_professional_id;

  insert into professional_schedule
    (clinic_id, professional_id, unit_id, weekday, starts_at, ends_at)
  select
    p_clinic_id,
    p_professional_id,
    nullif(faixa ->> 'unit_id', '')::uuid,
    (faixa ->> 'weekday')::smallint,
    (faixa ->> 'starts_at')::time,
    (faixa ->> 'ends_at')::time
  from jsonb_array_elements(p_faixas) as faixa;
end;
$$;

revoke execute on function public.substituir_jornada(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.substituir_jornada(uuid, uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Divida: incremento atomico do contador de falta
-- ---------------------------------------------------------------------------
-- Read-then-write perdia contagem com dois "faltou" concorrentes do mesmo
-- paciente. SECURITY INVOKER: so quem ja pode atualizar contact escreve.

create or replace function public.incrementar_no_show(p_contact_id uuid)
returns void
language sql security invoker
set search_path = public
as $$
  update contact set no_show_count = no_show_count + 1 where id = p_contact_id
$$;

revoke execute on function public.incrementar_no_show(uuid) from public, anon;
grant execute on function public.incrementar_no_show(uuid) to authenticated;
