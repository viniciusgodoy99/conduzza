-- A citação do paciente a uma mensagem de conversa anterior era descartada.
-- Achado da revisão adversarial de 03/09/2026.
--
-- vincular_citacao_recebida exigia que a mensagem citada estivesse na MESMA
-- conversa. Mas conversa, aqui, não é o fio do WhatsApp: ingest_inbound_message
-- abre uma conversa NOVA sempre que a anterior está 'resolvida'. Para o
-- paciente existe um fio só, e ele cita normalmente algo de semanas atrás.
--
-- O resultado era o pior dos dois mundos: a mensagem citada estava no banco, e
-- mesmo assim a bolha exibia "Respondendo a uma mensagem que não está neste
-- histórico". A tela afirmava, com todas as letras, algo falso.
--
-- Agora casa dentro das conversas do MESMO CONTATO. O recorte continua
-- fechado: clinic_id na busca (wa_message_id não é único entre clínicas, cada
-- instância numera os seus) e contact_id, que é o mesmo paciente. Nada
-- atravessa para outro paciente nem para outra clínica.

create or replace function public.vincular_citacao_recebida(
  p_clinic_id uuid,
  p_message_id uuid,
  p_quoted_wa_id text
) returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.message m
     set reply_to_wa_message_id = p_quoted_wa_id,
         reply_to_message_id = (
           select c.id
             from public.message c
             join public.conversation conv_c on conv_c.id = c.conversation_id
             join public.conversation conv_m on conv_m.id = m.conversation_id
            where c.clinic_id = p_clinic_id
              and c.wa_message_id = p_quoted_wa_id
              -- Mesmo PACIENTE, não necessariamente a mesma conversa: uma
              -- conversa resolvida e reaberta vira outra linha, e o fio do
              -- WhatsApp continua sendo um só.
              and conv_c.contact_id = conv_m.contact_id
            order by c.created_at desc
            limit 1
         )
   where m.id = p_message_id
     and m.clinic_id = p_clinic_id;
$$;

revoke all on function public.vincular_citacao_recebida(uuid, uuid, text)
  from public, anon, authenticated;
