-- Tarefa 4.9, fase 3: reordenar a prioridade da fila numa transacao so
-- (modelo exato de reordenar_etapa_da_jornada: FOR UPDATE + renumeracao
-- completa, SECURITY INVOKER para a RLS decidir quem mexe; papel sem
-- escrita enxerga zero linhas e recebe "Entrada não encontrada").
--
-- O grupo da renumeracao e o MESMO grupo visivel da tela: as entradas
-- ativas com o mesmo profissional e o mesmo procedimento (nulos casando).

create or replace function public.mover_na_lista_de_espera(
  p_clinic_id uuid,
  p_id uuid,
  p_nova_posicao integer
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_alvo record;
  v_ids uuid[];
  v_indice integer;
  v_destino integer;
  v_movida uuid;
  i integer;
begin
  select id, professional_id, procedure_id into v_alvo
    from public.waitlist
   where clinic_id = p_clinic_id and id = p_id and active
   for update;
  if not found then
    raise exception 'Entrada não encontrada.';
  end if;

  select array_agg(id order by priority, created_at)
    into v_ids
    from (
      select id, priority, created_at
        from public.waitlist
       where clinic_id = p_clinic_id
         and active
         and professional_id is not distinct from v_alvo.professional_id
         and procedure_id is not distinct from v_alvo.procedure_id
         for update
    ) grupo;

  v_indice := array_position(v_ids, p_id);
  v_destino := greatest(1, least(p_nova_posicao, array_length(v_ids, 1)));
  if v_indice is null then
    raise exception 'Entrada não encontrada.';
  end if;

  v_ids := array_remove(v_ids, p_id);
  v_ids := v_ids[1:v_destino-1] || p_id || v_ids[v_destino:];
  v_movida := p_id;

  for i in 1..array_length(v_ids, 1) loop
    update public.waitlist
       set priority = i * 10
     where clinic_id = p_clinic_id
       and id = v_ids[i]
       and priority is distinct from i * 10;
  end loop;

  return v_movida;
end;
$$;

revoke all on function public.mover_na_lista_de_espera(uuid, uuid, integer)
  from public, anon;
grant execute on function public.mover_na_lista_de_espera(uuid, uuid, integer)
  to authenticated, service_role;
