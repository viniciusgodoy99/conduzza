-- ---------------------------------------------------------------------------
-- Pacote com varios procedimentos
-- ---------------------------------------------------------------------------
-- Pedido do dono (29/09/2026): um PACOTE pode juntar varios procedimentos
-- (ex.: Botox 2 sessoes + Facelift 1 sessao). O cadastro mostra o "Preco
-- avulso" (soma de sessoes x preco base de cada procedimento, calculado na
-- tela a partir de procedure.base_price_cents, nunca gravado) e o "Preco do
-- pacote" (o valor que a clinica define), para ver o desconto.
--
-- Regras:
--   - a validade e do PACOTE (package.validity_days, package_balance.
--     expires_at), nao de cada item;
--   - o mesmo procedimento aparece uma vez so no pacote
--     (unique (package_id, procedure_id));
--   - o saldo vendido e POR ITEM (procedimento): package_balance_item, uma
--     COPIA dos itens do pacote feita na venda, que isola o que o paciente
--     comprou de qualquer edicao futura do pacote;
--   - a sessao continua sendo descontada SO no Compareceu, pelo gatilho
--     consumir_sessao_de_pacote: o procedimento do vinculo da consulta casa
--     com um item de saldo do mesmo contato, dentro da validade, com sessao
--     sobrando, do que vence primeiro (sem validade por ultimo), no empate o
--     vendido antes. Mesma regra e mesma ordem de antes, agora por item;
--   - o preco do pacote nao e distribuido entre os itens;
--   - item de pacote VENDIDO fica congelado (procedimento e sessoes): nome,
--     preco, validade e "a venda" continuam editaveis.
--
-- MODO EXPAND. O codigo publicado hoje continua funcionando nos minutos
-- entre aplicar esta migration e publicar o codigo novo:
--   - package.procedure_id e package.sessions viram NULLABLE e deixam de ser
--     usados pelo codigo novo (salvar_pacote grava null neles). Enquanto o
--     codigo antigo existir, o gatilho espelhar_item_do_pacote_legado
--     transforma o INSERT/UPDATE antigo (procedure_id + sessions) no item
--     unico do pacote, e preencher_nome_do_pacote_legado da nome ao pacote
--     criado sem nome (o nome do procedimento, como a tela antiga mostrava);
--   - package_balance.sessions_total vira NULLABLE. A venda antiga (INSERT
--     direto com sessions_total) ganha o item de saldo pelo gatilho
--     criar_itens_da_venda_legada; a venda nova (vender_pacote) grava null
--     ali e os itens logo depois;
--   - package_balance.sessions_total e sessions_used passam a ser a SOMA dos
--     itens, mantida pelo gatilho espelhar_totais_no_saldo_legado, para a
--     ficha e o Compareceu antigos lerem numero coerente. O codigo novo le
--     so os itens;
--   - ajustar_saldo_de_pacote(uuid, integer, date, text), a assinatura
--     antiga, continua existindo para saldo de UM procedimento (ajusta o
--     item unico); a nova e ajustar_saldo_de_pacote(uuid, jsonb, date, text).
--     cancelar_venda_de_pacote, uso_dos_pacotes e pacientes_resumo mantem a
--     assinatura e passam a somar pelos itens.
--
-- FUTURA MIGRATION DE CONTRATO (depois do codigo novo publicado e das
-- fixtures de teste migradas para itens):
--   - drop dos gatilhos e funcoes preencher_nome_do_pacote_legado,
--     espelhar_item_do_pacote_legado, criar_itens_da_venda_legada e
--     espelhar_totais_no_saldo_legado;
--   - drop de package.procedure_id (FK e package_procedure_id_idx) e
--     package.sessions (e package_sessions_check); tirar o ramo 'package'
--     de exigir_cadastro_da_mesma_clinica e o procedure_id da lista de
--     colunas do gatilho em package;
--   - drop de package_balance.sessions_total e sessions_used (e dos CHECKs
--     package_balance_check, _sessions_total_check, _sessions_used_check);
--   - drop function ajustar_saldo_de_pacote(uuid, integer, date, text);
--   - appointment.package_balance_id FICA (a ficha e a trava de cancelamento
--     leem a venda); package_balance_item_id e o detalhe.
--
-- Isolamento: package_item e package_balance_item tem clinic_id NOT NULL,
-- RLS ligada com as mesmas policies de package e package_balance, e entram
-- no gatilho exigir_cadastro_da_mesma_clinica (pacote, saldo e procedimento
-- da MESMA clinica; a FK so confere existencia e ignora RLS).
--
-- RPCs novas, todas SECURITY INVOKER (a sessao de quem chama: RLS e papel
-- valem la dentro), execute so para authenticated e service_role:
--   salvar_pacote(p_clinic_id, p_name, p_itens, p_price_cents,
--                 p_validity_days, p_active, p_package_id default null)
--   vender_pacote(p_contact_id, p_package_id, p_inicio default null,
--                 p_usadas default '[]')
--   ajustar_saldo_de_pacote(p_balance_id, p_itens jsonb, p_expires_at,
--                           p_reason)

-- ---------------------------------------------------------------------------
-- 1) package: nome, e procedure_id/sessions viram legado
-- ---------------------------------------------------------------------------

alter table public.package add column if not exists name text;

update public.package p
   set name = left(btrim(pr.name), 80)
  from public.procedure pr
 where pr.id = p.procedure_id
   and p.name is null;

-- Rede de seguranca: procedimento com nome so de espacos (nao deveria
-- existir) nao deixa pacote sem nome.
update public.package set name = 'Pacote'
 where name is null or char_length(btrim(name)) = 0;

alter table public.package alter column name set not null;
alter table public.package drop constraint if exists package_name_check;
alter table public.package add constraint package_name_check
  check (char_length(btrim(name)) between 1 and 80);

alter table public.package alter column procedure_id drop not null;
alter table public.package alter column sessions drop not null;

-- A venda nova grava null e os itens logo depois; a soma dos itens chega
-- pelo gatilho espelhar_totais_no_saldo_legado. Os CHECKs (total > 0 e
-- usadas <= total) continuam valendo quando ha numero.
alter table public.package_balance alter column sessions_total drop not null;

-- sessions_total e sessions_used de package_balance passam a ser so o
-- espelho da soma dos itens (gatilho legado, SECURITY DEFINER), e
-- package_id, contact_id e clinic_id so mudam por INSERT ou pelas RPCs.
-- Ninguem edita essas colunas direto: uma edicao pela API derrubaria o
-- Compareceu (o espelho passaria do total) e mudaria saldo sem registro em
-- package_balance_adjustment. So a validade continua editavel (a RPC de
-- ajuste grava expires_at pela sessao).
revoke update on table public.package_balance from authenticated;
grant update (expires_at) on table public.package_balance to authenticated;

-- ---------------------------------------------------------------------------
-- 2) package_item: os procedimentos do pacote
-- ---------------------------------------------------------------------------

create table if not exists public.package_item (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  package_id uuid not null references public.package (id) on delete cascade,
  procedure_id uuid not null references public.procedure (id),
  sessions integer not null check (sessions > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_item_procedimento_unico unique (package_id, procedure_id)
);

create index if not exists package_item_clinic_id_idx
  on public.package_item (clinic_id);
create index if not exists package_item_procedure_id_idx
  on public.package_item (procedure_id);

alter table public.package_item enable row level security;

-- As mesmas regras de package: membro ativo le, admin e gestor escrevem.
drop policy if exists "membro ativo le itens de pacote" on public.package_item;
create policy "membro ativo le itens de pacote" on public.package_item
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

drop policy if exists "admin e gestor escrevem itens de pacote"
  on public.package_item;
create policy "admin e gestor escrevem itens de pacote" on public.package_item
  for all to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

revoke all on table public.package_item from anon;
revoke truncate on table public.package_item from authenticated;

-- ---------------------------------------------------------------------------
-- 3) package_balance_item: o saldo vendido, por procedimento
-- ---------------------------------------------------------------------------

create table if not exists public.package_balance_item (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  package_balance_id uuid not null
    references public.package_balance (id) on delete cascade,
  procedure_id uuid not null references public.procedure (id),
  sessions_total integer not null check (sessions_total > 0),
  sessions_used integer not null default 0 check (sessions_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_balance_item_usadas_ate_o_total
    check (sessions_used <= sessions_total),
  constraint package_balance_item_procedimento_unico
    unique (package_balance_id, procedure_id)
);

create index if not exists package_balance_item_clinic_id_idx
  on public.package_balance_item (clinic_id);
create index if not exists package_balance_item_procedure_id_idx
  on public.package_balance_item (procedure_id);

alter table public.package_balance_item enable row level security;

-- As mesmas regras de package_balance: membro ativo le; admin, gestor e
-- recepcao vendem e ajustam; so admin e gestor removem.
drop policy if exists "membro le itens de saldo de pacote"
  on public.package_balance_item;
create policy "membro le itens de saldo de pacote"
  on public.package_balance_item
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

drop policy if exists "recepcao e gestao vendem itens de pacote"
  on public.package_balance_item;
create policy "recepcao e gestao vendem itens de pacote"
  on public.package_balance_item
  for insert to authenticated
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']));

drop policy if exists "recepcao e gestao ajustam itens de saldo"
  on public.package_balance_item;
create policy "recepcao e gestao ajustam itens de saldo"
  on public.package_balance_item
  for update to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']))
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']));

drop policy if exists "gestao remove itens de saldo"
  on public.package_balance_item;
create policy "gestao remove itens de saldo" on public.package_balance_item
  for delete to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

revoke all on table public.package_balance_item from anon;
revoke truncate on table public.package_balance_item from authenticated;

-- ---------------------------------------------------------------------------
-- 4) Historico e consulta apontam o item
-- ---------------------------------------------------------------------------

-- set null: o cancelamento apaga o saldo e os itens, e o registro precisa
-- sobreviver. procedure_id fica, para a trilha dizer QUAL procedimento.
alter table public.package_balance_adjustment
  add column if not exists package_balance_item_id uuid
    references public.package_balance_item (id) on delete set null,
  add column if not exists procedure_id uuid
    references public.procedure (id);

create index if not exists package_balance_adjustment_item_idx
  on public.package_balance_adjustment (package_balance_item_id);

-- Sem cascata, como package_balance_id: consulta que descontou segura o
-- saldo (o cancelamento recusa e o caminho e o ajuste).
alter table public.appointment
  add column if not exists package_balance_item_id uuid
    references public.package_balance_item (id);

create index if not exists appointment_package_balance_item_id_idx
  on public.appointment (package_balance_item_id);

-- ---------------------------------------------------------------------------
-- 5) Backfill (producao: 0 pacotes e 0 vendas em 29/09/2026; converte o que
-- existir em seed e teste). Antes dos gatilhos novos: o congelamento de
-- item vendido e os espelhos legados nao podem rodar aqui.
-- ---------------------------------------------------------------------------

insert into public.package_item (clinic_id, package_id, procedure_id, sessions)
select p.clinic_id, p.id, p.procedure_id, p.sessions
  from public.package p
 where p.procedure_id is not null
   and p.sessions is not null
   and not exists (
     select 1 from public.package_item pi where pi.package_id = p.id
   );

-- Totais e usadas DO SALDO (o que foi vendido e debitado), nao do pacote.
insert into public.package_balance_item (
  clinic_id, package_balance_id, procedure_id, sessions_total, sessions_used
)
select pb.clinic_id, pb.id, p.procedure_id, pb.sessions_total, pb.sessions_used
  from public.package_balance pb
  join public.package p on p.id = pb.package_id
 where p.procedure_id is not null
   and pb.sessions_total is not null
   and not exists (
     select 1 from public.package_balance_item i
      where i.package_balance_id = pb.id
   );

update public.appointment a
   set package_balance_item_id = i.id
  from public.package_balance_item i
 where i.package_balance_id = a.package_balance_id
   and a.package_balance_id is not null
   and a.package_balance_item_id is null;

-- ---------------------------------------------------------------------------
-- 6) Mesma clinica: item de pacote, item de saldo e o item na consulta
-- ---------------------------------------------------------------------------
-- Corpo da 20260929110000_regua_vinculada.sql (producao + ramo de cadence),
-- com os ramos novos: package_item (pacote e procedimento desta clinica),
-- package_balance_item (saldo e procedimento desta clinica; procedimento e
-- saldo nao mudam depois de gravados), appointment.package_balance_item_id
-- (item desta clinica e do saldo que a consulta aponta) e package com
-- procedure_id opcional. A mesma mensagem para "de outra clinica" e "nao
-- existe".

create or replace function public.exigir_cadastro_da_mesma_clinica()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Pacote com varios procedimentos (29/09/2026): o item de saldo que a
    -- consulta descontou e desta clinica e, quando a consulta tambem aponta
    -- o saldo, e um item DESSE saldo.
    if new.package_balance_item_id is not null and not exists (
      select 1 from package_balance_item
       where id = new.package_balance_item_id
         and clinic_id = new.clinic_id
         and (new.package_balance_id is null
              or package_balance_id = new.package_balance_id)
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
    -- Desde 29/09/2026 os procedimentos do pacote moram em package_item, e
    -- package.procedure_id e legado (o codigo novo grava null). So confere
    -- quando vem preenchido: e o caminho do codigo publicado antes da troca.
    -- O congelamento depois da venda passou para package_item (gatilho
    -- travar_itens_de_pacote_vendido), onde vale para todo item.
    if new.procedure_id is not null and not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'package_item' then
    if not exists (
      select 1 from package
       where id = new.package_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O pacote informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
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

  elsif tg_table_name = 'package_balance_item' then
    if not exists (
      select 1 from package_balance
       where id = new.package_balance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O saldo de pacote informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    -- O item vendido e a copia do pacote no dia da venda: o procedimento e o
    -- saldo a que ele pertence nao mudam depois. Sessoes usadas mudam pelo
    -- debito e pelo ajuste (com motivo), nunca trocando o procedimento.
    if tg_op = 'UPDATE'
       and (new.procedure_id is distinct from old.procedure_id
            or new.package_balance_id is distinct from old.package_balance_id)
    then
      raise exception using errcode = 'check_violation',
        message = 'O procedimento de um pacote vendido não muda. Ajuste o saldo ou cancele a venda.';
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

  elsif tg_table_name = 'whatsapp_account' then
    -- Unidade opcional do numero (decisao 3 do dono, 25/09/2026).
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_account_secret' then
    -- account_id nulo e o caminho legado (so clinic_id): o gatilho
    -- preencher_conta_do_segredo, que roda DEPOIS deste pela ordem do nome,
    -- escolhe o principal da MESMA clinica, e o NOT NULL fecha o resto.
    if new.account_id is not null and not exists (
      select 1 from whatsapp_account
       where id = new.account_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_envio_automatico' then
    -- Modo fixo: o numero e desta clinica e nao foi removido. A mesma
    -- mensagem para "de outra clinica" e "nao existe": nada a aprender.
    if new.conta_fixa_id is not null then
      if not exists (
        select 1 from whatsapp_account
         where id = new.conta_fixa_id and clinic_id = new.clinic_id
      ) then
        raise exception using errcode = 'foreign_key_violation',
          message = 'O número escolhido não pertence a esta clínica.';
      end if;
      if exists (
        select 1 from whatsapp_account
         where id = new.conta_fixa_id and removido_em is not null
      ) then
        raise exception using errcode = 'check_violation',
          message = 'O número escolhido foi removido da clínica.';
      end if;
    end if;

  elsif tg_table_name = 'cadence' then
    -- Regua vinculada (29/09/2026): o procedimento e o profissional da regua
    -- sao desta clinica. A FK so confere existencia, e a checagem de FK
    -- ignora RLS: sem isto, o gestor de uma clinica apontava a regua dele
    -- para o cadastro de outra.
    if new.procedure_id is not null and not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
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
$function$;

-- ---------------------------------------------------------------------------
-- 7) Gatilhos de coerencia nas tabelas novas e na consulta
-- ---------------------------------------------------------------------------

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.package_item;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, package_id, procedure_id
  on public.package_item
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica
  on public.package_balance_item;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, package_balance_id, procedure_id
  on public.package_balance_item
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.appointment;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, professional_id, service_link_id,
    unit_id, resource_id, package_balance_id, package_balance_item_id
  on public.appointment
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

drop trigger if exists set_updated_at on public.package_item;
create trigger set_updated_at before update on public.package_item
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.package_balance_item;
create trigger set_updated_at before update on public.package_balance_item
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 8) Item de pacote vendido fica congelado
-- ---------------------------------------------------------------------------
-- Vale para qualquer caminho (salvar_pacote, API direta, espelho legado): o
-- item nao entra, nao sai e nao muda de procedimento ou de sessoes depois
-- da primeira venda do pacote. A venda ja copiou os itens para o saldo, mas
-- o pacote precisa continuar dizendo o que foi vendido.
--
-- Concorrencia: a linha do pacote e travada FOR UPDATE antes de conferir a
-- venda. A venda insere package_balance, e a checagem da FK trava a mesma
-- linha em KEY SHARE, que conflita com FOR UPDATE: item mudando e venda
-- acontecendo rodam um depois do outro, e quem chega por ultimo enxerga o
-- que o outro gravou.
--
-- O nome do gatilho vem DEPOIS de exigir_cadastro_da_mesma_clinica na
-- ordem alfabetica (os BEFORE rodam assim): o item que aponta pacote de
-- outra clinica e recusado pelo isolamento (23503) antes de chegar aqui, e
-- a resposta nunca revela se o pacote da outra clinica foi vendido.
--
-- SECURITY DEFINER para enxergar a venda de verdade (a RLS de quem chama
-- nao decide o congelamento). DELETE por cascata do proprio pacote (ou da
-- clinica) passa: quem decide e a FK de package_balance (23503, "vendido
-- nao sai do banco").

create or replace function public.travar_itens_de_pacote_vendido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pacotes uuid[];
begin
  if tg_op = 'DELETE' then
    -- Cascata: o pacote ou a clinica ja sumiu nesta transacao. Quem decide
    -- e a FK de package_balance (pacote vendido nao sai; clinica apagada
    -- leva tudo junto).
    if not exists (select 1 from package where id = old.package_id)
       or not exists (select 1 from clinic where id = old.clinic_id)
    then
      return old;
    end if;
    v_pacotes := array[old.package_id];
  elsif tg_op = 'INSERT' then
    v_pacotes := array[new.package_id];
  else
    if new.procedure_id is not distinct from old.procedure_id
       and new.sessions is not distinct from old.sessions
       and new.package_id is not distinct from old.package_id
    then
      return new;
    end if;
    v_pacotes := array[old.package_id, new.package_id];
  end if;

  perform 1 from package where id = any (v_pacotes) order by id for update;

  if exists (
    select 1 from package_balance where package_id = any (v_pacotes)
  ) then
    raise exception using errcode = 'check_violation',
      message = 'Este pacote já foi vendido. Os procedimentos e as sessões não mudam: para mudar, crie um pacote novo.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.travar_itens_de_pacote_vendido()
  from public, anon, authenticated;

drop trigger if exists travar_itens_de_pacote_vendido on public.package_item;
create trigger travar_itens_de_pacote_vendido
  before insert or update or delete on public.package_item
  for each row execute function public.travar_itens_de_pacote_vendido();

-- ---------------------------------------------------------------------------
-- 9) Espelhos do caminho legado (expand; sai na migration de contrato)
-- ---------------------------------------------------------------------------

-- Pacote criado pelo codigo antigo chega sem nome: ganha o nome do
-- procedimento, que era como a tela antiga o mostrava.
create or replace function public.preencher_nome_do_pacote_legado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select left(btrim(pr.name), 80) into new.name
    from procedure pr
   where pr.id = new.procedure_id and pr.clinic_id = new.clinic_id;
  if new.name is null or char_length(btrim(new.name)) = 0 then
    new.name := 'Pacote';
  end if;
  return new;
end;
$$;

revoke execute on function public.preencher_nome_do_pacote_legado()
  from public, anon, authenticated;

drop trigger if exists preencher_nome_do_pacote_legado on public.package;
create trigger preencher_nome_do_pacote_legado
  before insert on public.package
  for each row
  when (new.name is null and new.procedure_id is not null)
  execute function public.preencher_nome_do_pacote_legado();

-- INSERT/UPDATE antigo (procedure_id + sessions) vira o item unico do
-- pacote. Com o pacote ja vendido, mudar o item e recusado pelo
-- congelamento (23514, a mesma resposta que a tela antiga ja tratava).
create or replace function public.espelhar_item_do_pacote_legado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantos integer;
  v_item package_item%rowtype;
begin
  select count(*) into v_quantos from package_item where package_id = new.id;
  if v_quantos = 0 then
    insert into package_item (clinic_id, package_id, procedure_id, sessions)
    values (new.clinic_id, new.id, new.procedure_id, new.sessions);
  elsif v_quantos = 1 then
    select * into v_item from package_item where package_id = new.id;
    if v_item.procedure_id is distinct from new.procedure_id
       or v_item.sessions is distinct from new.sessions
    then
      update package_item
         set procedure_id = new.procedure_id,
             sessions = new.sessions
       where id = v_item.id;
    end if;
  else
    raise exception using errcode = 'check_violation',
      message = 'Este pacote tem mais de um procedimento. Atualize a página para editar.';
  end if;
  return null;
end;
$$;

revoke execute on function public.espelhar_item_do_pacote_legado()
  from public, anon, authenticated;

drop trigger if exists espelhar_item_do_pacote_legado on public.package;
create trigger espelhar_item_do_pacote_legado
  after insert or update of procedure_id, sessions on public.package
  for each row
  when (new.procedure_id is not null and new.sessions is not null)
  execute function public.espelhar_item_do_pacote_legado();

-- Venda antiga (INSERT direto em package_balance com sessions_total) ganha
-- os itens. Pacote de um procedimento: o item leva o total e as usadas da
-- venda (inclusive o "em andamento"). A venda nova grava sessions_total
-- null e os itens ela mesma, entao este gatilho nao roda para ela.
create or replace function public.criar_itens_da_venda_legada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantos integer;
begin
  if exists (
    select 1 from package_balance_item where package_balance_id = new.id
  ) then
    return null;
  end if;
  select count(*) into v_quantos from package_item
   where package_id = new.package_id;
  if v_quantos = 1 then
    insert into package_balance_item (
      clinic_id, package_balance_id, procedure_id, sessions_total, sessions_used
    )
    select new.clinic_id, new.id, pi.procedure_id, new.sessions_total,
           new.sessions_used
      from package_item pi
     where pi.package_id = new.package_id;
  elsif v_quantos > 1 then
    insert into package_balance_item (
      clinic_id, package_balance_id, procedure_id, sessions_total, sessions_used
    )
    select new.clinic_id, new.id, pi.procedure_id, pi.sessions, 0
      from package_item pi
     where pi.package_id = new.package_id;
  else
    raise exception using errcode = 'check_violation',
      message = 'Este pacote não tem procedimentos.';
  end if;
  return null;
end;
$$;

revoke execute on function public.criar_itens_da_venda_legada()
  from public, anon, authenticated;

drop trigger if exists criar_itens_da_venda_legada on public.package_balance;
create trigger criar_itens_da_venda_legada
  after insert on public.package_balance
  for each row
  when (new.sessions_total is not null)
  execute function public.criar_itens_da_venda_legada();

-- package_balance.sessions_total/sessions_used = soma dos itens, para a
-- ficha e o Compareceu antigos. UPDATE soma a DIFERENCA (e nao recalcula a
-- soma): dois debitos simultaneos em itens diferentes da mesma venda se
-- enfileiram na linha do saldo, e a diferenca e reavaliada sobre a versao
-- mais nova da linha; recalcular com o retrato do comando perderia um
-- debito. INSERT e DELETE (venda e cancelamento) recalculam.
create or replace function public.espelhar_totais_no_saldo_legado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.sessions_total is distinct from old.sessions_total
       or new.sessions_used is distinct from old.sessions_used
    then
      update package_balance
         set sessions_total = coalesce(sessions_total, 0)
               + (new.sessions_total - old.sessions_total),
             sessions_used = sessions_used
               + (new.sessions_used - old.sessions_used)
       where id = new.package_balance_id;
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_balance_id := old.package_balance_id;
  else
    v_balance_id := new.package_balance_id;
  end if;
  update package_balance pb
     set sessions_total = s.total,
         sessions_used = coalesce(s.usadas, 0)
    from (
      select sum(i.sessions_total)::integer as total,
             sum(i.sessions_used)::integer as usadas
        from package_balance_item i
       where i.package_balance_id = v_balance_id
    ) s
   where pb.id = v_balance_id
     and (pb.sessions_total is distinct from s.total
          or pb.sessions_used is distinct from coalesce(s.usadas, 0));
  return null;
end;
$$;

revoke execute on function public.espelhar_totais_no_saldo_legado()
  from public, anon, authenticated;

drop trigger if exists espelhar_totais_no_saldo_legado
  on public.package_balance_item;
create trigger espelhar_totais_no_saldo_legado
  after insert or delete or update of sessions_total, sessions_used
  on public.package_balance_item
  for each row execute function public.espelhar_totais_no_saldo_legado();

-- ---------------------------------------------------------------------------
-- 10) Debito no Compareceu, por item
-- ---------------------------------------------------------------------------
-- Mesma regra e mesma ordem da versao de 20260825140000, agora sobre
-- package_balance_item: o item do procedimento do vinculo da consulta, do
-- mesmo contato e clinica, com sessao sobrando, dentro da validade no DIA
-- CIVIL da clinica (regra 3.6), do saldo que vence primeiro (sem validade
-- por ultimo), no empate o vendido antes e, por fim, o id (desempate fixo).
-- Grava o item E o saldo na consulta.
-- SKIP LOCKED como antes, travando a VENDA e o item: o debito nunca espera
-- lock nenhum. Ajuste e cancelamento travam a venda primeiro e os itens
-- depois; se o debito travasse so o item e depois esperasse a venda (o
-- espelho legado atualiza package_balance), um Compareceu ao mesmo tempo
-- que um ajuste da mesma venda travaria um esperando o outro (deadlock).
-- Consequencia: venda travada naquele instante (por um ajuste, por um
-- cancelamento OU por outro Compareceu de outro procedimento da MESMA
-- venda, marcado no mesmo instante) e pulada, e o Compareceu desconta da
-- proxima que servir (ou de nenhuma). Limitacao conhecida e rara (dois
-- cliques no mesmo instante no mesmo paciente); a correcao e pelo ajuste
-- de saldo na ficha.
-- O gatilho continua o mesmo (BEFORE UPDATE OF status, so na troca para
-- compareceu): trocar o corpo aqui, na mesma transacao do backfill, nao
-- deixa janela sem debito nem com debito dobrado.

create or replace function public.consumir_sessao_de_pacote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_balance_id uuid;
  v_hoje_local date;
begin
  if new.package_balance_item_id is not null
     or new.package_balance_id is not null
  then
    return new;  -- ja debitado (compareceu e terminal no dominio; defesa extra)
  end if;
  select (now() at time zone c.timezone)::date into v_hoje_local
    from clinic c where c.id = new.clinic_id;
  select i.id, i.package_balance_id into v_item_id, v_balance_id
    from package_balance_item i
    join package_balance pb on pb.id = i.package_balance_id
    join service_link sl on sl.id = new.service_link_id
   where pb.clinic_id = new.clinic_id
     and i.clinic_id = new.clinic_id
     and pb.contact_id = new.contact_id
     and i.procedure_id = sl.procedure_id
     and i.sessions_used < i.sessions_total
     and (pb.expires_at is null or pb.expires_at >= v_hoje_local)
   order by pb.expires_at asc nulls last, pb.created_at asc, pb.id asc
   limit 1
   for update of pb, i skip locked;
  if v_item_id is not null then
    update package_balance_item
       set sessions_used = sessions_used + 1
     where id = v_item_id;
    new.package_balance_item_id := v_item_id;
    new.package_balance_id := v_balance_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11) salvar_pacote: cria ou edita o pacote e os itens numa transacao
-- ---------------------------------------------------------------------------
-- p_itens: [{ "procedure_id": uuid, "sessions": 1..200 }], de 1 a 30 itens,
-- cada procedimento uma vez. p_package_id null cria; preenchido edita.
-- Pacote vendido: nome, preco, validade e "a venda" (p_active) mudam; itens
-- diferentes dos gravados sao recusados (23514). Mesmos itens passam, entao
-- a tela pode mandar o pacote inteiro sempre.
-- Erros: 22023 lista malformada; 23514 regra (mensagem em portugues);
-- 42501 papel (so admin e gestor); P0002 pacote nao encontrado nesta
-- clinica; 23503 procedimento de outra clinica (gatilho de isolamento).
-- A conferencia de papel nao substitui a policy (admin e gestor escrevem
-- pacotes): so troca o "nada aconteceu" silencioso por um 42501 claro.

create or replace function public.salvar_pacote(
  p_clinic_id uuid,
  p_name text,
  p_itens jsonb,
  p_price_cents integer,
  p_validity_days integer,
  p_active boolean,
  p_package_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_nome text := btrim(coalesce(p_name, ''));
  v_itens_iguais boolean;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A lista de procedimentos do pacote é inválida.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_itens) as e
     where jsonb_typeof(e) <> 'object'
  ) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A lista de procedimentos do pacote é inválida.';
  end if;
  if jsonb_array_length(p_itens) = 0 then
    raise exception using errcode = 'check_violation',
      message = 'Escolha ao menos um procedimento para o pacote.';
  end if;
  if jsonb_array_length(p_itens) > 30 then
    raise exception using errcode = 'check_violation',
      message = 'Um pacote tem no máximo 30 procedimentos.';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_itens) as d (procedure_id uuid, sessions integer)
     where d.procedure_id is null
        or d.sessions is null
        or d.sessions < 1
        or d.sessions > 200
  ) then
    raise exception using errcode = 'check_violation',
      message = 'Cada procedimento do pacote tem de 1 a 200 sessões.';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_itens) as d (procedure_id uuid)
     group by d.procedure_id
    having count(*) > 1
  ) then
    raise exception using errcode = 'check_violation',
      message = 'O mesmo procedimento aparece duas vezes no pacote.';
  end if;
  if char_length(v_nome) < 1 or char_length(v_nome) > 80 then
    raise exception using errcode = 'check_violation',
      message = 'Dê um nome ao pacote, com até 80 caracteres.';
  end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 100000000
  then
    raise exception using errcode = 'check_violation',
      message = 'Confira o preço do pacote.';
  end if;
  if p_validity_days is not null
     and (p_validity_days < 1 or p_validity_days > 3650)
  then
    raise exception using errcode = 'check_violation',
      message = 'A validade vai de 1 a 3650 dias.';
  end if;

  if not public.user_has_role(p_clinic_id, array['admin', 'gestor']) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Somente administradores e gestores alteram os cadastros.';
  end if;

  -- Criacao: pacote e itens na mesma transacao. procedure_id e sessions
  -- ficam null (legado), entao os espelhos legados nao rodam.
  if p_package_id is null then
    insert into package (clinic_id, name, price_cents, validity_days, active)
    values (p_clinic_id, v_nome, p_price_cents, p_validity_days,
            coalesce(p_active, true))
    returning id into v_id;
    insert into package_item (clinic_id, package_id, procedure_id, sessions)
    select p_clinic_id, v_id, d.procedure_id, d.sessions
      from jsonb_to_recordset(p_itens) as d (procedure_id uuid, sessions integer);
    return v_id;
  end if;

  -- Edicao: o pacote como a SESSAO o enxerga, travado (serializa com outro
  -- Salvar e com uma venda em andamento, ver travar_itens_de_pacote_vendido).
  select p.id into v_id
    from package p
   where p.id = p_package_id and p.clinic_id = p_clinic_id
     for update;
  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'Pacote não encontrado.';
  end if;

  select not exists (
    (select pi.procedure_id, pi.sessions
       from package_item pi where pi.package_id = v_id
     except
     select d.procedure_id, d.sessions
       from jsonb_to_recordset(p_itens) as d (procedure_id uuid, sessions integer))
    union all
    (select d.procedure_id, d.sessions
       from jsonb_to_recordset(p_itens) as d (procedure_id uuid, sessions integer)
     except
     select pi.procedure_id, pi.sessions
       from package_item pi where pi.package_id = v_id)
  ) into v_itens_iguais;

  if not v_itens_iguais then
    -- A mensagem antes de tocar em qualquer item (o gatilho de
    -- congelamento recusaria do mesmo jeito, item por item).
    if exists (select 1 from package_balance where package_id = v_id) then
      raise exception using errcode = 'check_violation',
        message = 'Este pacote já foi vendido. Os procedimentos e as sessões não mudam: para mudar, crie um pacote novo.';
    end if;
    delete from package_item pi
     where pi.package_id = v_id
       and not exists (
         select 1
           from jsonb_to_recordset(p_itens) as d (procedure_id uuid)
          where d.procedure_id = pi.procedure_id
       );
    update package_item pi
       set sessions = d.sessions
      from jsonb_to_recordset(p_itens) as d (procedure_id uuid, sessions integer)
     where pi.package_id = v_id
       and pi.procedure_id = d.procedure_id
       and pi.sessions <> d.sessions;
    insert into package_item (clinic_id, package_id, procedure_id, sessions)
    select p_clinic_id, v_id, d.procedure_id, d.sessions
      from jsonb_to_recordset(p_itens) as d (procedure_id uuid, sessions integer)
     where not exists (
       select 1 from package_item pi
        where pi.package_id = v_id and pi.procedure_id = d.procedure_id
     );
  end if;

  update package
     set name = v_nome,
         price_cents = p_price_cents,
         validity_days = p_validity_days,
         active = coalesce(p_active, true),
         procedure_id = null,
         sessions = null
   where id = v_id;
  return v_id;
end;
$$;

revoke execute on function
  public.salvar_pacote(uuid, text, jsonb, integer, integer, boolean, uuid)
  from public, anon;
grant execute on function
  public.salvar_pacote(uuid, text, jsonb, integer, integer, boolean, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12) vender_pacote: a venda e a copia dos itens numa transacao
-- ---------------------------------------------------------------------------
-- p_inicio: dia em que o pacote comecou (a validade conta dali); null = hoje
-- no fuso da clinica. Cobre o pacote EM ANDAMENTO de quem chega ao sistema
-- no meio de um pacote comprado antes: p_usadas =
-- [{ "procedure_id": uuid, "sessions_used": 0..sessoes do item }], so os
-- procedimentos com sessao ja usada (o resto nasce com 0). Precisa sobrar
-- ao menos uma sessao na venda.
-- Papel: admin, gestor e recepcao (as policies "recepcao e gestao vendem").
-- Erros: 22023 lista malformada; 23514 regra; 42501 papel; P0002 pacote ou
-- paciente nao encontrado nesta clinica.

create or replace function public.vender_pacote(
  p_contact_id uuid,
  p_package_id uuid,
  p_inicio date default null,
  p_usadas jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pacote package%rowtype;
  v_usadas jsonb := coalesce(p_usadas, '[]'::jsonb);
  v_hoje date;
  v_inicio date;
  v_expira date;
  v_restantes integer;
  v_balance_id uuid;
begin
  if jsonb_typeof(v_usadas) <> 'array' or jsonb_array_length(v_usadas) > 30
  then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A lista de sessões já usadas é inválida.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_usadas) as e
     where jsonb_typeof(e) <> 'object'
  ) or exists (
    select 1
      from jsonb_to_recordset(v_usadas) as d (procedure_id uuid, sessions_used integer)
     where d.procedure_id is null or d.sessions_used is null
  ) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A lista de sessões já usadas é inválida.';
  end if;

  select * into v_pacote from package where id = p_package_id;
  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'Pacote não encontrado.';
  end if;

  if not public.user_has_role(
    v_pacote.clinic_id, array['admin', 'gestor', 'recepcao']
  ) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Seu perfil não pode vender pacote.';
  end if;

  if not exists (
    select 1 from contact
     where id = p_contact_id and clinic_id = v_pacote.clinic_id
  ) then
    raise exception using errcode = 'no_data_found',
      message = 'Paciente não encontrado nesta clínica.';
  end if;

  if not v_pacote.active then
    raise exception using errcode = 'check_violation',
      message = 'Este pacote está desativado e não pode ser vendido.';
  end if;
  if not exists (select 1 from package_item where package_id = p_package_id)
  then
    raise exception using errcode = 'check_violation',
      message = 'Este pacote não tem procedimentos.';
  end if;

  -- Dia civil da clinica (regra 3.6).
  select (now() at time zone c.timezone)::date into v_hoje
    from clinic c where c.id = v_pacote.clinic_id;
  v_inicio := coalesce(p_inicio, v_hoje);
  if v_inicio > v_hoje then
    raise exception using errcode = 'check_violation',
      message = 'A data de início não pode ser depois de hoje.';
  end if;
  if v_pacote.validity_days is not null then
    v_expira := v_inicio + v_pacote.validity_days;
  end if;
  if v_expira is not null and v_expira < v_hoje then
    raise exception using errcode = 'check_violation',
      message = 'Com essa data de início o pacote já teria vencido. Confira a data.';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(v_usadas) as d (procedure_id uuid)
     group by d.procedure_id
    having count(*) > 1
  ) then
    raise exception using errcode = 'check_violation',
      message = 'O mesmo procedimento aparece duas vezes nas sessões já usadas.';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(v_usadas) as d (procedure_id uuid)
     where not exists (
       select 1 from package_item pi
        where pi.package_id = p_package_id and pi.procedure_id = d.procedure_id
     )
  ) then
    raise exception using errcode = 'check_violation',
      message = 'Um procedimento informado não faz parte deste pacote.';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(v_usadas) as d (procedure_id uuid, sessions_used integer)
      join package_item pi
        on pi.package_id = p_package_id and pi.procedure_id = d.procedure_id
     where d.sessions_used < 0 or d.sessions_used > pi.sessions
  ) then
    raise exception using errcode = 'check_violation',
      message = 'As sessões já usadas de cada procedimento vão de 0 até as sessões dele no pacote.';
  end if;
  select sum(pi.sessions - coalesce(d.sessions_used, 0)) into v_restantes
    from package_item pi
    left join jsonb_to_recordset(v_usadas) as d (procedure_id uuid, sessions_used integer)
      on d.procedure_id = pi.procedure_id
   where pi.package_id = p_package_id;
  if coalesce(v_restantes, 0) <= 0 then
    raise exception using errcode = 'check_violation',
      message = 'Com essas sessões já usadas não sobra nenhuma para descontar. Confira as sessões.';
  end if;

  -- sessions_total null: a venda nova nao passa pelo espelho legado; a
  -- soma dos itens chega pelo espelhar_totais_no_saldo_legado. O INSERT
  -- trava o pacote em KEY SHARE (checagem da FK): os itens copiados abaixo
  -- sao os que estao gravados, sem edicao no meio.
  insert into package_balance (
    clinic_id, contact_id, package_id, sessions_total, sessions_used,
    expires_at
  ) values (
    v_pacote.clinic_id, p_contact_id, p_package_id, null, 0, v_expira
  )
  returning id into v_balance_id;

  insert into package_balance_item (
    clinic_id, package_balance_id, procedure_id, sessions_total, sessions_used
  )
  select v_pacote.clinic_id, v_balance_id, pi.procedure_id, pi.sessions,
         coalesce(d.sessions_used, 0)
    from package_item pi
    left join jsonb_to_recordset(v_usadas) as d (procedure_id uuid, sessions_used integer)
      on d.procedure_id = pi.procedure_id
   where pi.package_id = p_package_id;

  return v_balance_id;
end;
$$;

revoke execute on function public.vender_pacote(uuid, uuid, date, jsonb)
  from public, anon;
grant execute on function public.vender_pacote(uuid, uuid, date, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13) Ajuste de saldo, por item
-- ---------------------------------------------------------------------------
-- p_itens: [{ "item_id": uuid, "sessions_used": 0..total do item }], so os
-- itens que a tela quer gravar (os ausentes ficam como estao). p_expires_at
-- e a validade da VENDA (null = nao vence). Nada mudou = recusa, para a
-- trilha nao encher de ajuste vazio.
-- Trilha (package_balance_adjustment, kind 'ajuste'): uma linha por item
-- que mudou, com o item, o procedimento, o antes e o depois, e a validade
-- antes e depois. Ajuste so da validade: uma linha sem item (item e
-- procedimento null), com as somas da venda.
-- Papel: admin, gestor e recepcao. O FOR UPDATE com RLS so devolve a venda
-- para quem pode altera-la: leitura, profissional e outra clinica recebem
-- "nao encontrado" (P0002), como na versao anterior.

create or replace function public.ajustar_saldo_de_pacote(
  p_balance_id uuid,
  p_itens jsonb,
  p_expires_at date,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saldo package_balance%rowtype;
  v_mudou_validade boolean;
  v_itens_mudados integer;
  v_linhas integer;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception using errcode = 'check_violation',
      message = 'Escreva o motivo do ajuste.';
  end if;
  if char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = 'check_violation',
      message = 'O motivo passa de 500 caracteres.';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) > 30
     or exists (
       select 1 from jsonb_array_elements(p_itens) as e
        where jsonb_typeof(e) <> 'object'
     )
  then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A lista de procedimentos do ajuste é inválida.';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_itens) as d (item_id uuid, sessions_used integer)
     where d.item_id is null or d.sessions_used is null
  ) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A lista de procedimentos do ajuste é inválida.';
  end if;

  select * into v_saldo
    from package_balance
   where id = p_balance_id
   for update;
  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'Saldo de pacote não encontrado.';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_itens) as d (item_id uuid)
     group by d.item_id
    having count(*) > 1
  ) then
    raise exception using errcode = 'check_violation',
      message = 'O mesmo procedimento aparece duas vezes no ajuste.';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_itens) as d (item_id uuid)
     where not exists (
       select 1 from package_balance_item i
        where i.id = d.item_id and i.package_balance_id = p_balance_id
     )
  ) then
    raise exception using errcode = 'no_data_found',
      message = 'Procedimento não encontrado nesta venda de pacote.';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_itens) as d (item_id uuid, sessions_used integer)
      join package_balance_item i on i.id = d.item_id
     where d.sessions_used < 0 or d.sessions_used > i.sessions_total
  ) then
    raise exception using errcode = 'check_violation',
      message = 'As sessões usadas vão de 0 até o total de cada procedimento do pacote.';
  end if;

  v_mudou_validade := p_expires_at is distinct from v_saldo.expires_at;
  select count(*) into v_itens_mudados
    from jsonb_to_recordset(p_itens) as d (item_id uuid, sessions_used integer)
    join package_balance_item i on i.id = d.item_id
   where i.sessions_used <> d.sessions_used;
  if v_itens_mudados = 0 and not v_mudou_validade then
    raise exception using errcode = 'check_violation',
      message = 'Nada mudou no saldo.';
  end if;

  -- Trilha primeiro: o "antes" vem das linhas como estao agora.
  insert into package_balance_adjustment (
    clinic_id, contact_id, package_balance_id, package_id,
    package_balance_item_id, procedure_id, user_id, kind,
    sessions_total, sessions_used_before, sessions_used_after,
    expires_at_before, expires_at_after, reason
  )
  select v_saldo.clinic_id, v_saldo.contact_id, v_saldo.id,
         v_saldo.package_id, i.id, i.procedure_id, auth.uid(), 'ajuste',
         i.sessions_total, i.sessions_used, d.sessions_used,
         v_saldo.expires_at, p_expires_at, btrim(p_reason)
    from jsonb_to_recordset(p_itens) as d (item_id uuid, sessions_used integer)
    join package_balance_item i on i.id = d.item_id
   where i.sessions_used <> d.sessions_used;

  if v_itens_mudados = 0 then
    insert into package_balance_adjustment (
      clinic_id, contact_id, package_balance_id, package_id,
      package_balance_item_id, procedure_id, user_id, kind,
      sessions_total, sessions_used_before, sessions_used_after,
      expires_at_before, expires_at_after, reason
    )
    select v_saldo.clinic_id, v_saldo.contact_id, v_saldo.id,
           v_saldo.package_id, null, null, auth.uid(), 'ajuste',
           coalesce(sum(i.sessions_total), 0)::integer,
           coalesce(sum(i.sessions_used), 0)::integer,
           coalesce(sum(i.sessions_used), 0)::integer,
           v_saldo.expires_at, p_expires_at, btrim(p_reason)
      from package_balance_item i
     where i.package_balance_id = p_balance_id;
  end if;

  update package_balance_item i
     set sessions_used = d.sessions_used
    from jsonb_to_recordset(p_itens) as d (item_id uuid, sessions_used integer)
   where i.id = d.item_id
     and i.package_balance_id = p_balance_id
     and i.sessions_used <> d.sessions_used;
  get diagnostics v_linhas = row_count;
  if v_linhas <> v_itens_mudados then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Seu perfil não pode ajustar saldo de pacote.';
  end if;

  if v_mudou_validade then
    update package_balance
       set expires_at = p_expires_at
     where id = p_balance_id;
    get diagnostics v_linhas = row_count;
    if v_linhas = 0 then
      raise exception using errcode = 'insufficient_privilege',
        message = 'Seu perfil não pode ajustar saldo de pacote.';
    end if;
  end if;
end;
$$;

revoke execute on function
  public.ajustar_saldo_de_pacote(uuid, jsonb, date, text) from public, anon;
grant execute on function
  public.ajustar_saldo_de_pacote(uuid, jsonb, date, text)
  to authenticated, service_role;

-- Assinatura antiga (expand; sai no contrato): o codigo publicado antes da
-- troca ajusta "o saldo" inteiro. Venda de um procedimento: ajusta o item
-- unico pela funcao nova (mesmas regras, mesma trilha). Venda de varios
-- procedimentos: recusa, porque "sessoes usadas" sem procedimento nao diz
-- de qual item. Grants como estavam (authenticated e service_role).
create or replace function public.ajustar_saldo_de_pacote(
  p_balance_id uuid,
  p_sessions_used integer,
  p_expires_at date,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_quantos integer;
  v_item uuid;
begin
  select count(*), (array_agg(i.id))[1] into v_quantos, v_item
    from package_balance_item i
   where i.package_balance_id = p_balance_id;
  if v_quantos > 1 then
    raise exception using errcode = 'check_violation',
      message = 'Este pacote tem mais de um procedimento. Atualize a página e ajuste cada procedimento.';
  end if;
  if v_item is not null and p_sessions_used is null then
    raise exception using errcode = 'check_violation',
      message = 'As sessões usadas vão de 0 até o total do pacote.';
  end if;
  perform public.ajustar_saldo_de_pacote(
    p_balance_id,
    case
      when v_item is null then '[]'::jsonb
      else jsonb_build_array(
        jsonb_build_object('item_id', v_item, 'sessions_used', p_sessions_used)
      )
    end,
    p_expires_at,
    p_reason
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 14) Cancelamento de venda, conferindo consultas pelos itens
-- ---------------------------------------------------------------------------
-- Mesma assinatura e regras da 20260925102000. Venda que ja descontou sessao
-- (a consulta aponta o saldo OU um item dele) nao se cancela: 23503 com a
-- orientacao de ajustar. A trilha ganha uma linha por item cancelado, com o
-- procedimento (package_balance_item_id fica null: o item some com a
-- venda). Os itens saem ANTES da venda, de proposito: a linha da trilha foi
-- inserida nesta mesma transacao, e o Postgres confere de novo todas as FKs
-- dela quando o delete da venda a atualiza (set null); com a venda saindo
-- primeiro, a cascata dos itens deixava essa conferencia apontando para item
-- ja apagado.
-- Sem permissao de DELETE, o insert da trilha ja recusa pela policy (so
-- admin e gestor registram cancelamento) e o delete confere de novo pela
-- contagem de linhas.

create or replace function public.cancelar_venda_de_pacote(
  p_balance_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saldo package_balance%rowtype;
  v_linhas integer;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception using errcode = 'check_violation',
      message = 'Escreva o motivo do cancelamento.';
  end if;
  if char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = 'check_violation',
      message = 'O motivo passa de 500 caracteres.';
  end if;

  select * into v_saldo
    from package_balance
   where id = p_balance_id
   for update;
  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'Saldo de pacote não encontrado.';
  end if;

  if exists (
    select 1 from appointment where package_balance_id = p_balance_id
  ) or exists (
    select 1
      from appointment a
      join package_balance_item i on i.id = a.package_balance_item_id
     where i.package_balance_id = p_balance_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'Esta venda já descontou sessão de consulta e não pode ser cancelada. Para corrigir, ajuste o saldo.';
  end if;

  insert into package_balance_adjustment (
    clinic_id, contact_id, package_balance_id, package_id,
    package_balance_item_id, procedure_id, user_id, kind,
    sessions_total, sessions_used_before, sessions_used_after,
    expires_at_before, expires_at_after, reason
  )
  select v_saldo.clinic_id, v_saldo.contact_id, v_saldo.id,
         v_saldo.package_id, null, i.procedure_id, auth.uid(), 'cancelamento',
         i.sessions_total, i.sessions_used, null,
         v_saldo.expires_at, null, btrim(p_reason)
    from package_balance_item i
   where i.package_balance_id = p_balance_id;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    -- Venda sem item (nao deveria existir depois do backfill): a trilha
    -- registra a venda inteira, como antes.
    insert into package_balance_adjustment (
      clinic_id, contact_id, package_balance_id, package_id, user_id, kind,
      sessions_total, sessions_used_before, sessions_used_after,
      expires_at_before, expires_at_after, reason
    ) values (
      v_saldo.clinic_id, v_saldo.contact_id, v_saldo.id, v_saldo.package_id,
      auth.uid(), 'cancelamento',
      coalesce(v_saldo.sessions_total, 0), coalesce(v_saldo.sessions_used, 0),
      null, v_saldo.expires_at, null, btrim(p_reason)
    );
  end if;

  delete from package_balance_item where package_balance_id = p_balance_id;
  delete from package_balance where id = p_balance_id;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Só administrador e gestor cancelam venda de pacote.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 15) Contagens pelos itens (mesmas assinaturas, mesmos grants)
-- ---------------------------------------------------------------------------

-- Aba Pacotes: vendas por pacote e pacientes com saldo usavel (alguma
-- sessao sobrando em algum item, dentro da validade no dia civil da
-- clinica). So numeros: nenhum dado de paciente sai daqui.
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
      where s.restantes > 0
        and (pb.expires_at is null or pb.expires_at >= tz.hoje_local)
    ))::integer as pacientes_com_saldo
  from package_balance pb
  cross join lateral (
    select (now() at time zone cl.timezone)::date as hoje_local
    from clinic cl where cl.id = p_clinic_id
  ) tz
  cross join lateral (
    select coalesce(sum(i.sessions_total - i.sessions_used), 0) as restantes
      from package_balance_item i
     where i.package_balance_id = pb.id
  ) s
  where pb.clinic_id = p_clinic_id
  group by pb.package_id
$$;

-- Lista de Pacientes: saldo_sessoes (sessoes sobrando nas vendas dentro da
-- validade) e saldo_total (sessoes vendidas) continuam numeros unicos,
-- agora somados pelos itens. O resto do corpo e o de producao
-- (pg_get_functiondef em 29/09/2026, igual ao da 20260925102000).
create or replace function public.pacientes_resumo(p_clinic_id uuid)
returns table (
  contact_id uuid,
  name text,
  phone_e164 text,
  insurance_id uuid,
  insurance_name text,
  no_show_count integer,
  tags text[],
  ultima_consulta timestamptz,
  proxima_consulta timestamptz,
  total_compareceu bigint,
  total_faltou bigint,
  saldo_sessoes bigint,
  saldo_total bigint,
  profissionais_ids uuid[],
  primeira_consulta timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.phone_e164,
    c.insurance_id,
    i.name,
    c.no_show_count,
    c.tags,
    a.ultima_consulta,
    a.proxima_consulta,
    coalesce(a.total_compareceu, 0),
    coalesce(a.total_faltou, 0),
    coalesce(pb.saldo_sessoes, 0),
    coalesce(pb.saldo_total, 0),
    coalesce(a.profissionais_ids, '{}'),
    a.primeira_consulta
  from contact c
  cross join lateral (
    select (now() at time zone cl.timezone)::date as hoje_local
    from clinic cl where cl.id = p_clinic_id
  ) tz
  left join insurance i on i.id = c.insurance_id
  left join lateral (
    select
      max(ap.starts_at) filter (
        where ap.starts_at <= now()
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as ultima_consulta,
      min(ap.starts_at) filter (
        where ap.starts_at > now()
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as proxima_consulta,
      count(*) filter (where ap.status = 'compareceu') as total_compareceu,
      count(*) filter (where ap.status = 'faltou') as total_faltou,
      array_agg(distinct ap.professional_id) filter (
        where ap.professional_id is not null
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as profissionais_ids,
      min(ap.starts_at) filter (
        where ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as primeira_consulta
    from appointment ap
    where ap.contact_id = c.id
  ) a on true
  left join lateral (
    select
      sum(bi.sessions_total - bi.sessions_used) filter (
        where b.expires_at is null or b.expires_at >= tz.hoje_local
      ) as saldo_sessoes,
      sum(bi.sessions_total) as saldo_total
    from package_balance b
    join package_balance_item bi on bi.package_balance_id = b.id
    where b.contact_id = c.id
  ) pb on true
  where c.clinic_id = p_clinic_id
    and c.kind = 'paciente'
  order by c.name nulls last, c.id
$$;
