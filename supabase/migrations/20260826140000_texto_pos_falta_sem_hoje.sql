-- Correcao de revisao: o primeiro toque de pos falta dizia "Sentimos sua falta
-- HOJE", mas o eixo da regua e o instante em que ALGUEM MARCOU a falta, nao o
-- horario da consulta. Falta e sempre acao explicita de uma pessoa (regra 3.5),
-- e a recepcao costuma fechar o dia depois: consulta de segunda marcada como
-- falta na quinta faz o paciente receber "sentimos sua falta hoje" num dia em
-- que ele nao tinha consulta nenhuma. O texto passa a citar a data da consulta,
-- que esta correta em qualquer atraso.
--
-- Fonte unica: lib/domain/textos-padrao.ts guarda a copia deste texto e o teste
-- prova que os dois nao divergiram.

create or replace function public.seed_reguas_padrao(p_clinic_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_confirmacao uuid;
  v_pos_falta uuid;
begin
  insert into cadence (clinic_id, kind, name, active)
  values (p_clinic_id, 'confirmacao', 'Confirmação de consulta', false)
  on conflict do nothing
  returning id into v_confirmacao;

  if v_confirmacao is not null then
    insert into cadence_step (clinic_id, cadence_id, offset_minutes, fixed_body)
    values
      (p_clinic_id, v_confirmacao, -4320,
       'Olá, {{nome}}! Aqui é da {{clinica}}. Sua consulta de {{procedimento}} com {{profissional}} está marcada para {{data}} às {{hora}}. Podemos confirmar sua presença?'),
      (p_clinic_id, v_confirmacao, -1440,
       'Oi, {{nome}}! Amanhã, {{data}} às {{hora}}, você tem {{procedimento}} com {{profissional}}.
{{preparo}}
Podemos confirmar sua presença?'),
      (p_clinic_id, v_confirmacao, -180,
       '{{nome}}, sua consulta é hoje às {{hora}} com {{profissional}}. Está tudo certo para você vir?');
  end if;

  insert into cadence (clinic_id, kind, name, active)
  values (p_clinic_id, 'pos_falta', 'Recuperação depois da falta', false)
  on conflict do nothing
  returning id into v_pos_falta;

  if v_pos_falta is not null then
    insert into cadence_step (clinic_id, cadence_id, offset_minutes, fixed_body)
    values
      (p_clinic_id, v_pos_falta, 0,
       'Oi, {{nome}}. Sentimos sua falta na {{clinica}}, no seu horário de {{data}}. Aconteceu algum imprevisto? Se quiser remarcar, é só responder esta mensagem.'),
      (p_clinic_id, v_pos_falta, 2880,
       'Olá, {{nome}}! Ainda dá tempo de remarcar seu {{procedimento}}. Quer que a gente encontre um novo horário para você?');
  end if;
end;
$$;

-- Clinicas que ja receberam o texto antigo. So troca quem esta com o texto
-- PADRAO: se a clinica editou o proprio texto, a edicao dela vale mais.
update public.cadence_step s
   set fixed_body = 'Oi, {{nome}}. Sentimos sua falta na {{clinica}}, no seu horário de {{data}}. Aconteceu algum imprevisto? Se quiser remarcar, é só responder esta mensagem.'
  from public.cadence c
 where c.id = s.cadence_id
   and c.kind = 'pos_falta'
   and s.offset_minutes = 0
   and s.fixed_body = 'Oi, {{nome}}. Sentimos sua falta hoje na {{clinica}}. Aconteceu algum imprevisto? Se quiser remarcar, é só responder esta mensagem.';
