-- Cadastros e isolamento entre clinicas (revisao de liberacao, 24/09/2026).
--
-- (1) Mesma clinica em toda FK de agenda e catalogo (achados 39, 91, e a
--     garantia de banco dos achados 1, 31 e 120). FK simples so confere que o
--     id EXISTE, e a checagem de FK ignora RLS: o administrador da clinica A
--     (qualquer pessoa cria uma clinica pelo cadastro publico) apontava
--     procedure.resource_id, appointment.professional_id etc. para cadastro
--     da clinica B. Como as exclusion constraints da agenda nao tem clinic_id,
--     a consulta de A passava a travar o horario do profissional ou do
--     recurso de B, e a resposta 23P01 contra sucesso virava oraculo da
--     ocupacao de B. O gatilho abaixo segue o padrao de
--     exigir_contato_da_mesma_clinica: SECURITY DEFINER com search_path fixo,
--     para enxergar a linha referenciada de verdade (e nao depender da RLS de
--     quem chama), e vale para qualquer papel, inclusive service role.
--     Conferido antes em producao: zero linhas violam hoje, em todas as
--     tabelas cobertas.
--
-- (2) Pacote: package.active (achado 35). Pacote vendido nao some do banco
--     (a FK de package_balance segura o delete), entao "tirar de linha" e
--     desativar. Venda de pacote desativado e recusada no banco.
--
-- (3) Procedimento do pacote vendido fica congelado (achado 35). O debito
--     automatico (consumir_sessao_de_pacote) casa o saldo pelo procedimento
--     do PACOTE; trocar o procedimento depois da venda trocava o saldo de
--     todos os pacientes que ja pagaram. Escolha: RECUSAR a troca quando
--     existe saldo vendido, em vez de copiar procedure_id para o saldo. E a
--     opcao mais segura porque mantem UMA fonte da verdade: a ficha do
--     paciente, a lista e o debito continuam lendo o mesmo campo, e nenhum
--     saldo antigo fica com um procedimento diferente do que a tela mostra.
--     Para vender outro procedimento, cria-se outro pacote.
--
-- (4) Uso dos pacotes para a aba (achado 35): vendas e pacientes com saldo
--     ativo por pacote, contados no dia civil da clinica (regra 3.6).
--     SECURITY INVOKER: a RLS de package_balance vale para quem chama.
--
-- (5) INSERT de message pela sessao amarrado ao autor (achado 7c). A policy
--     so conferia user_can_write: a recepcao conseguia gravar pela API uma
--     mensagem "do paciente" ou em nome de um colega. Caminhos legitimos pela
--     sessao hoje (conferidos em app/(app)/atendimento/actions.ts): a nota
--     interna (author 'usuario', author_user_id = quem escreve, direction
--     'saida') e o evento de sistema do Inbox ("Fulano assumiu a conversa":
--     author 'sistema', content_type 'evento', sem author_user_id). Todo
--     envio ao paciente, a regua e a entrada pelo webhook gravam pelo cliente
--     de servico ou por funcao SECURITY DEFINER, que nao passam por esta
--     policy. Alem do autor, a sessao nao grava wa_message_id nem job_id
--     (sao chaves de idempotencia do webhook e do motor: uma linha forjada
--     com elas faria o envio ou a entrada verdadeira virar "ja existe"), e a
--     conversa precisa ser da mesma clinica da mensagem.

-- ---------------------------------------------------------------------------
-- (2) package.active
-- ---------------------------------------------------------------------------

alter table public.package
  add column if not exists active boolean not null default true;

-- ---------------------------------------------------------------------------
-- (1) + (2) + (3) Gatilho unico de coerencia de cadastro
-- ---------------------------------------------------------------------------

create or replace function public.exigir_cadastro_da_mesma_clinica()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profissional_do_vinculo uuid;
  v_pacote_ativo boolean;
begin
  if tg_table_name = 'appointment' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    select sl.professional_id into v_profissional_do_vinculo
      from service_link sl
     where sl.id = new.service_link_id and sl.clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O vínculo informado não pertence a esta clínica.';
    end if;
    if v_profissional_do_vinculo is distinct from new.professional_id then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O vínculo informado é de outro profissional.';
    end if;
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;
    if new.resource_id is not null and not exists (
      select 1 from resource
       where id = new.resource_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O recurso informado não pertence a esta clínica.';
    end if;
    if new.package_balance_id is not null and not exists (
      select 1 from package_balance
       where id = new.package_balance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O saldo de pacote informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'slot_hold' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'procedure' then
    if new.resource_id is not null and not exists (
      select 1 from resource
       where id = new.resource_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O recurso informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'resource' then
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'service_link' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    if new.insurance_id is not null and not exists (
      select 1 from insurance
       where id = new.insurance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O convênio informado não pertence a esta clínica.';
    end if;
    -- A consulta exige vinculo DO MESMO profissional (acima). Trocar o
    -- profissional de um vinculo que ja tem consulta quebraria essa regra
    -- nas consultas antigas: o caminho e desativar e criar outro.
    if tg_op = 'UPDATE'
       and new.professional_id is distinct from old.professional_id
       and exists (select 1 from appointment where service_link_id = new.id)
    then
      raise exception using errcode = 'check_violation',
        message = 'Este vínculo já tem consultas. Desative e crie outro.';
    end if;

  elsif tg_table_name = 'professional_schedule' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'professional_block' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'package' then
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    -- (3) Procedimento congelado depois da primeira venda.
    if tg_op = 'UPDATE'
       and new.procedure_id is distinct from old.procedure_id
       and exists (select 1 from package_balance where package_id = new.id)
    then
      raise exception using errcode = 'check_violation',
        message = 'Este pacote já foi vendido. Para outro procedimento, crie um pacote novo.';
    end if;

  elsif tg_table_name = 'package_balance' then
    select p.active into v_pacote_ativo
      from package p
     where p.id = new.package_id and p.clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O pacote informado não pertence a esta clínica.';
    end if;
    -- (2) Venda nova so de pacote ativo. Ajuste de saldo ja vendido
    -- (sessions_used) nao passa por aqui: o gatilho so olha INSERT e troca
    -- de package_id/clinic_id.
    if tg_op = 'INSERT' and v_pacote_ativo is not true then
      raise exception using errcode = 'check_violation',
        message = 'Este pacote está desativado e não pode ser vendido.';
    end if;

  elsif tg_table_name = 'clinic_member' then
    -- Vinculo usuario -> profissional (a tela e da leva 2): a policy de
    -- update de clinic_member so confere o papel do editor na clinica da
    -- linha, e a FK clinic_member_professional_fk so confere existencia.
    if new.professional_id is not null and not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
  end if;

  return new;
end;
$$;

-- Funcao que devolve trigger nao e chamavel como RPC (o PostgREST nao a
-- expoe e o Postgres recusa chamada direta); os grants ficam no padrao dos
-- outros gatilhos do projeto (exigir_contato_da_mesma_clinica).

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.appointment;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, professional_id, service_link_id,
    unit_id, resource_id, package_balance_id
  on public.appointment
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.slot_hold;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, professional_id
  on public.slot_hold
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.procedure;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, resource_id
  on public.procedure
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.resource;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, unit_id
  on public.resource
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.service_link;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, professional_id, procedure_id,
    insurance_id
  on public.service_link
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica
  on public.professional_schedule;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, professional_id, unit_id
  on public.professional_schedule
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica
  on public.professional_block;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, professional_id
  on public.professional_block
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.package;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, procedure_id
  on public.package
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica
  on public.package_balance;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, package_id
  on public.package_balance
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica
  on public.clinic_member;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, professional_id
  on public.clinic_member
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

-- ---------------------------------------------------------------------------
-- (4) Uso dos pacotes (aba Pacotes de Cadastros)
-- ---------------------------------------------------------------------------

create or replace function public.uso_dos_pacotes(p_clinic_id uuid)
returns table (package_id uuid, vendas integer, pacientes_com_saldo integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    pb.package_id,
    count(*)::integer as vendas,
    (count(distinct pb.contact_id) filter (
      where pb.sessions_used < pb.sessions_total
        and (pb.expires_at is null or pb.expires_at >= tz.hoje_local)
    ))::integer as pacientes_com_saldo
  from package_balance pb
  cross join lateral (
    select (now() at time zone cl.timezone)::date as hoje_local
    from clinic cl where cl.id = p_clinic_id
  ) tz
  where pb.clinic_id = p_clinic_id
  group by pb.package_id
$$;

revoke execute on function public.uso_dos_pacotes(uuid) from public, anon;
grant execute on function public.uso_dos_pacotes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (5) INSERT de message pela sessao amarrado ao autor
-- ---------------------------------------------------------------------------

drop policy if exists "membro com escrita escreve mensagem" on public.message;
create policy "membro com escrita escreve mensagem" on public.message
  for insert with check (
    public.user_can_write(clinic_id)
    and direction = 'saida'
    and wa_message_id is null
    and job_id is null
    and (
      (author = 'usuario' and author_user_id = auth.uid())
      or (
        author = 'sistema'
        and content_type = 'evento'
        and is_internal_note = false
        and (author_user_id is null or author_user_id = auth.uid())
      )
    )
    -- A conversa e da MESMA clinica e visivel a quem escreve (a RLS de
    -- conversation vale dentro do exists); o profissional so escreve nas
    -- conversas atribuidas a ele, como antes.
    and exists (
      select 1 from public.conversation c
       where c.id = message.conversation_id
         and c.clinic_id = message.clinic_id
         and (
           (not public.user_has_role(message.clinic_id, array['profissional']))
           or c.assignee_user_id = auth.uid()
         )
    )
  );
