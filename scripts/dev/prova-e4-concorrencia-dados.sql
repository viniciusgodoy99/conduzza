-- Dados da prova de concorrencia da E4 (scripts/dev/prova-e4-concorrencia-
-- local.mjs). SO no Postgres LOCAL descartavel, num banco com as migrations
-- do repositorio aplicadas (a 20261020130000_ia_agenda inclusive). Comitados:
-- as chamadas concorrentes vem de conexoes separadas. NUNCA rodar na
-- producao (cria clinica, conversas e contatos ficticios e nao apaga nada).
--
-- Trazido do scratchpad da frente de banco na revisao da E4 (20/10/2026),
-- com o procedimento que usa um recurso (a sala) nos dois profissionais.
do $$
declare
  v_a constant uuid := '00000000-0000-4000-8000-00000000000a';
  v_num constant uuid := '00000000-0000-4000-8000-0000000000b1';
  v_p1 constant uuid := '00000000-0000-4000-8000-0000000000c1';
  v_p2 constant uuid := '00000000-0000-4000-8000-0000000000c2';
  v_x constant uuid := '00000000-0000-4000-8000-0000000000d1';
  v_z constant uuid := '00000000-0000-4000-8000-0000000000d2';
  v_sala constant uuid := '00000000-0000-4000-8000-0000000000a1';
  v_k uuid;
begin
  insert into public.clinic (id, name, slug, e_de_teste, timezone)
  values (v_a, 'Concorrencia local', 'concorrencia-local', true, 'America/Fortaleza');
  insert into public.whatsapp_account (id, clinic_id, provider, connection_status, nome)
  values (v_num, v_a, 'fake', 'conectado', 'Local');
  insert into public.professional (id, clinic_id, name) values
    (v_p1, v_a, 'Dra. Local'),
    (v_p2, v_a, 'Dr. Local Dois');
  insert into public.resource (id, clinic_id, name, kind)
  values (v_sala, v_a, 'Sala local', 'sala');
  insert into public.procedure (id, clinic_id, name) values (v_x, v_a, 'Consulta local');
  insert into public.procedure (id, clinic_id, name, resource_id)
  values (v_z, v_a, 'Procedimento da sala', v_sala);
  -- e1: P1 + consulta; e2: P2 + consulta; e3: P1 + sala; e4: P2 + sala.
  insert into public.service_link (id, clinic_id, professional_id, procedure_id, duration_min) values
    ('00000000-0000-4000-8000-0000000000e1', v_a, v_p1, v_x, 30),
    ('00000000-0000-4000-8000-0000000000e2', v_a, v_p2, v_x, 30),
    ('00000000-0000-4000-8000-0000000000e3', v_a, v_p1, v_z, 30),
    ('00000000-0000-4000-8000-0000000000e4', v_a, v_p2, v_z, 30);
  insert into public.professional_schedule (clinic_id, professional_id, weekday, starts_at, ends_at)
  select v_a, p.id, w, time '07:00', time '20:00'
    from generate_series(0, 6) as w
    cross join (values (v_p1), (v_p2)) as p(id);
  insert into public.ia_liberacao (clinic_id, liberada, modo) values (v_a, true, 'contatos');
  insert into public.ia_numero_liberado (whatsapp_account_id, clinic_id, ativo) values (v_num, v_a, true);
  insert into public.ai_agent_config (clinic_id, version, status, published_at, skills,
                                      agenda_antecedencia_horas, agenda_horizonte_dias)
  values (v_a, 1, 'publicada', now(), '{"agendar": true}', 2, 30);
  for i in 1..16 loop
    insert into public.ia_contato_liberado (clinic_id, phone_key, ativo)
    values (v_a, '+55849999300' || lpad(i::text, 2, '0'), true);
    insert into public.contact (clinic_id, phone_e164, name)
    values (v_a, '+55849999300' || lpad(i::text, 2, '0'), 'Local ' || i)
    returning id into v_k;
    insert into public.conversation (id, clinic_id, contact_id, status, whatsapp_account_id)
    values (('00000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, v_a, v_k,
            'ia_atendendo', v_num);
  end loop;
  insert into public.contact (id, clinic_id, phone_e164, name, kind)
  values ('00000000-0000-4000-8000-0000000000f0', v_a, '+5584999930099', 'Paciente da recepcao', 'paciente');
end;
$$;
