-- ---------------------------------------------------------------------------
-- Regua vinculada: confirmacao e pos falta por medico, especialidade ou
-- procedimento
-- ---------------------------------------------------------------------------
-- Decisao do dono (29/09/2026), Frente 2 do plano: cada regua de CONFIRMACAO
-- ou de POS FALTA pode ter UM vinculo, e so um: um profissional
-- (professional_id), uma especialidade (specialty) ou um procedimento
-- (procedure_id, que ja existia). Sem vinculo, e a regua geral. Follow-up NAO
-- ganha vinculo (followup_sem_excecao, estendido abaixo).
--
-- PRECEDENCIA, quando mais de uma regua ativa casa com a consulta:
--
--   procedimento (3) > profissional (2) > especialidade (1) > geral (0)
--
-- dentro do mesmo nivel, a reforcada por historico de falta
-- (for_no_show_history) vence a comum, mas so vale quando o paciente ja tem
-- no_show_count >= no_show_threshold (como antes); o desempate final e fixo,
-- por created_at e id. Regua desligada nao entra: a consulta cai para a
-- proxima que casar. A escolha mora numa funcao so, regua_da_consulta, usada
-- pelo planner (confirmacao e pos falta) e pelo executor (lib/jobs/regua.ts),
-- que confere antes de cada toque se a run ainda e da regua vigente da
-- consulta (troca de medico no meio da sequencia, excecao ligada depois do
-- planejamento) e pula a run antiga como 'condicao_parada'.
--
-- ESPECIALIDADE: professional.specialties e texto livre, entao a regua guarda
-- o rotulo como o usuario escolheu (specialty) e a comparacao usa a chave de
-- chave_de_especialidade (minusculas, sem acento, sem espacos nas pontas e
-- com os espacos internos colapsados). "Dermatologia" e "dermatologia " sao a
-- mesma especialidade, para casar com o profissional e para o indice unico.
-- Quando o profissional da consulta tem DUAS especialidades com regua, as
-- duas empatam no nivel 1 e o desempate fixo decide (a mais antiga).
--
-- O que muda:
--
--   1. chave_de_especialidade(text), imutavel.
--   2. cadence.professional_id (FK, cascade) e cadence.specialty.
--   3. Checks: um vinculo so (num_nonnulls), especialidade nao vazia,
--      vinculo novo so em confirmacao e pos falta, followup_sem_excecao
--      estendido as colunas novas.
--   4. Indice unico cadence_configuracao_unica recriado com as colunas novas
--      (ainda fora do follow-up) e indice em professional_id (FK).
--   5. cadence entra no gatilho exigir_cadastro_da_mesma_clinica, para
--      procedure_id e professional_id. Fecha tambem a falha antiga de
--      procedure_id apontando para procedimento de OUTRA clinica (a FK so
--      confere existencia e ignora RLS). Conferido antes em producao: zero
--      reguas violam hoje.
--   6. regua_da_consulta(p_appointment_id, p_kind).
--   7. planejar_reguas: os dois joins laterais (confirmacao e pos falta)
--      trocados por regua_da_consulta. O do pos falta era "limit 1" sem
--      ordem. Mais duas mudancas: passo ja vencido nao nasce se a consulta
--      recebeu toque do mesmo tipo nos ultimos 30 minutos (toque repetido
--      quando a regua vigente muda), e a confirmacao filtra as consultas
--      candidatas antes de chamar a funcao (custo). Todo o resto identico
--      ao corpo de producao (pg_get_functiondef em 29/09/2026, que e o da
--      20260925131000_numeros_whatsapp_conversa_e_fila.sql).
--
-- Volume em 29/09: 13 reguas (5 de confirmacao, 5 de pos falta, 3 de
-- follow-up), nenhuma com procedimento. O indice unico e recriado dentro da
-- transacao (tabela pequena).

-- ---------------------------------------------------------------------------
-- 1) Chave da especialidade
-- ---------------------------------------------------------------------------
-- translate ANTES de lower: lower so conhece o que o LC_CTYPE conhece, e a
-- tabela de acentos aqui nao depende disso. Mesmo padrao de chave_telefone:
-- sql, imutavel, search_path vazio (so funcoes de pg_catalog).

create or replace function public.chave_de_especialidade(p_texto text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      lower(
        translate(
          p_texto,
          'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ',
          'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy'
        )
      ),
      '\s+', ' ', 'g'
    )
  )
$$;

comment on function public.chave_de_especialidade(text) is
  'Chave para comparar especialidades (texto livre em professional.specialties e cadence.specialty): minusculas, sem acento, sem espacos nas pontas e com os espacos internos colapsados.';

-- ---------------------------------------------------------------------------
-- 2) Colunas
-- ---------------------------------------------------------------------------

alter table public.cadence
  add column professional_id uuid
    references public.professional (id) on delete cascade,
  add column specialty text;

comment on column public.cadence.professional_id is
  'Regua vinculada a um profissional (confirmacao ou pos falta). Um vinculo so por regua: profissional, especialidade ou procedimento.';
comment on column public.cadence.specialty is
  'Regua vinculada a uma especialidade, com o rotulo como o usuario escolheu. Casa com professional.specialties pela chave de chave_de_especialidade.';

-- ---------------------------------------------------------------------------
-- 3) Checks
-- ---------------------------------------------------------------------------

alter table public.cadence
  add constraint cadence_um_vinculo
    check (num_nonnulls(procedure_id, professional_id, specialty) <= 1),
  add constraint cadence_especialidade_preenchida
    check (
      specialty is null
      or public.chave_de_especialidade(specialty) <> ''
    ),
  add constraint cadence_vinculo_so_na_agenda
    check (
      kind in ('confirmacao', 'pos_falta')
      or (professional_id is null and specialty is null)
    );

alter table public.cadence
  drop constraint followup_sem_excecao;
alter table public.cadence
  add constraint followup_sem_excecao
    check (
      kind <> 'followup'
      or (
        procedure_id is null
        and professional_id is null
        and specialty is null
        and not for_no_show_history
      )
    );

-- ---------------------------------------------------------------------------
-- 4) Indices
-- ---------------------------------------------------------------------------

create index cadence_professional_id_idx
  on public.cadence (professional_id);

-- Uma regua por recorte: tipo, vinculo e reforco. A especialidade entra pela
-- CHAVE, entao "Dermatologia" e "dermatologia " conflitam (23505). O
-- follow-up continua com o indice proprio (cadence_followup_unico_por_etapa).
drop index public.cadence_configuracao_unica;
create unique index cadence_configuracao_unica on public.cadence
  using btree (
    clinic_id, kind,
    coalesce(procedure_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(public.chave_de_especialidade(specialty), ''),
    for_no_show_history
  )
  where kind <> 'followup';

-- ---------------------------------------------------------------------------
-- 5) Mesma clinica: cadence entra no gatilho
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 29/09/2026, o da
-- 20260925130000_numeros_whatsapp_conta.sql) com o ramo novo de cadence no
-- fim. A mesma mensagem para "de outra clinica" e "nao existe".

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

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.cadence;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, procedure_id, professional_id
  on public.cadence
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

-- ---------------------------------------------------------------------------
-- 6) A regua vigente de uma consulta
-- ---------------------------------------------------------------------------
-- Devolve o id da regua ATIVA de p_kind ('confirmacao' ou 'pos_falta') que
-- vale para a consulta, pela precedencia do cabecalho; nulo se nenhuma casa
-- (ou se p_kind for outro tipo). O procedimento vem do vinculo da consulta
-- (service_link), o profissional e as especialidades vem do profissional da
-- consulta, o historico de falta vem do contato.
--
-- SECURITY INVOKER: para a sessao, a RLS de appointment, contact, cadence,
-- service_link e professional vale como em qualquer leitura (consulta de
-- outra clinica devolve nulo, sem oraculo). O planner (SECURITY DEFINER) e o
-- executor (service role) enxergam tudo.

create or replace function public.regua_da_consulta(
  p_appointment_id uuid,
  p_kind text
)
returns uuid
language sql
stable
set search_path = public
as $$
  select c.id
    from appointment a
    join contact ct
      on ct.id = a.contact_id
    left join service_link sl
      on sl.id = a.service_link_id
     and sl.clinic_id = a.clinic_id
    left join professional p
      on p.id = a.professional_id
     and p.clinic_id = a.clinic_id
    join cadence c
      on c.clinic_id = a.clinic_id
     and c.kind = p_kind
     and c.active
   where a.id = p_appointment_id
     and p_kind in ('confirmacao', 'pos_falta')
     and (not c.for_no_show_history or ct.no_show_count >= c.no_show_threshold)
     and (
       (c.procedure_id is null
        and c.professional_id is null
        and c.specialty is null)
       or c.procedure_id = sl.procedure_id
       or c.professional_id = a.professional_id
       or (
         c.specialty is not null
         and chave_de_especialidade(c.specialty) = any (
           select chave_de_especialidade(e)
             from unnest(p.specialties) as e
         )
       )
     )
   order by
     case
       when c.procedure_id is not null then 3
       when c.professional_id is not null then 2
       when c.specialty is not null then 1
       else 0
     end desc,
     c.for_no_show_history desc,
     c.created_at,
     c.id
   limit 1
$$;

comment on function public.regua_da_consulta(uuid, text) is
  'Regua ativa de confirmacao ou pos falta que vale para a consulta: procedimento > profissional > especialidade > geral; no mesmo nivel a reforcada (quando o paciente atinge o limiar) vence; desempate por created_at e id. Nulo se nenhuma casa.';

revoke all on function public.regua_da_consulta(uuid, text)
  from public, anon;
grant execute on function public.regua_da_consulta(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) planejar_reguas: a regua de cada consulta vem de regua_da_consulta
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 29/09/2026). Mudam os dois
-- joins laterais: o da confirmacao (que ja ordenava procedimento e reforco,
-- sem desempate) e o do pos falta (limit 1 sem ordem nenhuma). O join com
-- contact da confirmacao so servia ao lateral antigo e saiu junto. A
-- confirmacao ganhou o CTE `candidatas` (custo) e as duas ganharam a trava
-- do passo vencido depois de um toque recente (ver os comentarios dentro).
-- Follow-up intocado. Assinatura, SECURITY DEFINER, search_path e grants
-- iguais.

create or replace function public.planejar_reguas()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_confirmacao integer := 0;
  v_pos_falta integer := 0;
  v_followup integer := 0;
begin
  -- NUMERO (Fase 1B dos varios numeros, 25/09/2026): todo job nasce com o
  -- numero de envio carimbado por resolver_conta_de_envio, a mesma escolha
  -- de conta_de_envio (fixo, ultimo usado pelo paciente, principal). O
  -- executor de hoje nao le a coluna; a Fase 2 passa a enviar por ela.
  --
  -- REGUA VIGENTE (regua vinculada, 29/09/2026): a regua de cada consulta,
  -- na confirmacao e no pos falta, e a de regua_da_consulta (procedimento >
  -- profissional > especialidade > geral, reforcada vence no nivel,
  -- desempate por created_at e id). Uma so por consulta.
  --
  -- TOQUE REPETIDO QUANDO A VIGENTE MUDA: a vinculada nasce com os MESMOS
  -- offsets da geral (criarReguaDeExcecaoAction copia os passos), e a chave
  -- de cadence_run leva o cadence_step_id. Ligar, desligar ou trocar a
  -- regua vigente logo depois de um toque faria o passo de mesmo offset da
  -- regua nova, ja vencido e ainda dentro da folga de 30 minutos, nascer de
  -- novo e sair em seguida. Por isso um passo JA VENCIDO (scheduled_for <=
  -- now(), a recuperacao da folga) so e materializado quando a consulta nao
  -- recebeu nenhum toque do mesmo tipo nos ultimos 30 minutos, de qualquer
  -- regua (inclusive o "Cobrar agora"). Passo futuro continua nascendo
  -- adiantado, como sempre. A exclusao de uma vinculada leva as runs dela
  -- no cascade e apagaria essa prova: a excluirReguaAction recusa excluir
  -- vinculada que enviou nos ultimos 30 minutos. O toque que perguntava pelo
  -- horario ANTIGO de uma consulta remarcada depois dele nao trava (a
  -- remarcacao volta a pedir confirmacao, decisao do dono de 24/09).
  -- Limitacao conhecida: apagar UMA mensagem (passo) que saiu nos ultimos
  -- 30 minutos e, em seguida, mudar a regua vigente da consulta (ou recriar
  -- o mesmo momento) pode repetir aquele toque uma vez; recriar o mesmo
  -- momento ja repetia antes da regua vinculada.
  --
  -- Confirmacao: eixo em appointment.starts_at.
  --
  -- CUSTO: regua_da_consulta e uma funcao SQL com FROM e ORDER BY (nunca e
  -- inlinada), cara demais para rodar por consulta futura a cada minuto.
  -- `candidatas` (materialized, para o planejador nao avaliar a funcao antes
  -- do filtro) so deixa passar a consulta que tem, em ALGUMA regua ativa de
  -- confirmacao da clinica, um passo dentro do horizonte. E condicao
  -- necessaria de toda linha de `devidas`, entao o resultado nao muda. O
  -- HORIZONTE aparece duas vezes (aqui e em `devidas`): mudar os dois juntos.
  with candidatas as materialized (
    select a.id, a.clinic_id, a.contact_id, a.starts_at
    from appointment a
    where a.send_confirmation
      and a.status in ('agendado', 'aguardando_confirmacao')
      -- Paciente pediu para remarcar: perguntar se ele confirma a consulta
      -- que ele quer trocar confunde e atrapalha a recepcao que esta
      -- remarcando. Quando o pedido for resolvido (coluna limpa), os toques
      -- que ainda couberem voltam a ser planejados.
      and a.remarcacao_pedida_em is null
      and a.starts_at > now()
      and exists (
        select 1
          from cadence c2
          join cadence_step s2 on s2.cadence_id = c2.id
         where c2.clinic_id = a.clinic_id
           and c2.kind = 'confirmacao'
           and c2.active
           and a.starts_at + make_interval(mins => s2.offset_minutes)
               between now() - interval '30 minutes'
                   and now() + interval '60 minutes'
      )
  ),
  devidas as (
    select
      a.clinic_id,
      s.id as step_id,
      a.contact_id,
      a.id as appointment_id,
      a.starts_at + make_interval(mins => s.offset_minutes) as scheduled_for
    from candidatas a
    cross join lateral (
      select public.regua_da_consulta(a.id, 'confirmacao') as id
    ) c
    join cadence_step s on s.cadence_id = c.id
    where a.starts_at + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
      and not (
        a.starts_at + make_interval(mins => s.offset_minutes) <= now()
        and exists (
          select 1
            from cadence_run r
            join cadence_step s3 on s3.id = r.cadence_step_id
            join cadence c3 on c3.id = s3.cadence_id
           where r.appointment_id = a.id
             and c3.kind = 'confirmacao'
             and r.sent_at > now() - interval '30 minutes'
             -- O toque que perguntava pelo horario ANTIGO nao trava a
             -- confirmacao do horario novo: toda remarcacao volta a pedir
             -- confirmacao (decisao do dono de 24/09).
             and not exists (
               select 1 from appointment_status_history h
                where h.appointment_id = a.id
                  and h.kind = 'remarcacao'
                  and h.previous_starts_at is distinct from h.new_starts_at
                  and h.changed_at > r.sent_at
             )
        )
      )
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, appointment_id, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, contact_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (
      clinic_id, kind, payload, run_at, prioridade, whatsapp_account_id
    )
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           0,
           resolver_conta_de_envio(clinic_id, contact_id)
    from novas
    returning 1
  )
  select count(*)::integer into v_confirmacao from jobs;

  -- Pos falta: eixo no instante em que a falta foi marcada.
  with faltas as (
    select
      a.clinic_id,
      a.contact_id,
      a.id as appointment_id,
      (
        select max(h.changed_at)
        from appointment_status_history h
        where h.appointment_id = a.id and h.status = 'faltou'
      ) as marcada_em
    from appointment a
    where a.status = 'faltou'
      and a.starts_at > now() - interval '30 days'
  ),
  devidas as (
    select
      f.clinic_id,
      s.id as step_id,
      f.contact_id,
      f.appointment_id,
      f.marcada_em + make_interval(mins => s.offset_minutes) as scheduled_for
    from faltas f
    cross join lateral (
      select public.regua_da_consulta(f.appointment_id, 'pos_falta') as id
    ) c
    join cadence_step s on s.cadence_id = c.id
    where f.marcada_em is not null
      and f.marcada_em + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
      -- A mesma trava da confirmacao: passo ja vencido so nasce se a
      -- consulta nao recebeu toque de pos falta nos ultimos 30 minutos.
      and not (
        f.marcada_em + make_interval(mins => s.offset_minutes) <= now()
        and exists (
          select 1
            from cadence_run r
            join cadence_step s3 on s3.id = r.cadence_step_id
            join cadence c3 on c3.id = s3.cadence_id
           where r.appointment_id = f.appointment_id
             and c3.kind = 'pos_falta'
             and r.sent_at > now() - interval '30 minutes'
        )
      )
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, appointment_id, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, contact_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (
      clinic_id, kind, payload, run_at, prioridade, whatsapp_account_id
    )
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           0,
           resolver_conta_de_envio(clinic_id, contact_id)
    from novas
    returning 1
  )
  select count(*)::integer into v_pos_falta from jobs;

  -- Follow-up: eixo na entrada da etapa (funnel_stage_changed_at).
  -- O contato so esta no recorte enquanto CONTINUA na etapa da regua e sem
  -- resposta desde que entrou: sair ou responder e a parada da spec 7.2. O
  -- join com funnel_stage_def descarta regua orfa de etapa excluida (defesa
  -- em profundidade; o gatilho da jornada ja impede a exclusao).
  --
  -- IMPORTACAO NAO INSCREVE (decisao do dono de 24/09/2026): o contato criado
  -- pela planilha tem o relogio da etapa carimbado no insert, igual a qualquer
  -- outro, mas esse relogio nao e um ato de ninguem. Enquanto ele nao mudar
  -- de etapa (funnel_stage_changed_at continua igual ao created_at, que o
  -- insert grava com o MESMO now()), o follow-up nao o alcanca. A primeira
  -- mudanca de etapa, ato explicito de alguem (inclusive em massa), move o
  -- relogio e inscreve.
  --
  -- O job de follow-up nasce com prioridade 1: nunca passa na frente de
  -- confirmacao, pos falta, resposta ao paciente ou oferta de espera.
  with devidas as (
    select
      ct.clinic_id,
      s.id as step_id,
      ct.id as contact_id,
      ct.funnel_stage_changed_at
        + make_interval(mins => s.offset_minutes) as scheduled_for
    from contact ct
    join cadence c
      on c.clinic_id = ct.clinic_id
     and c.kind = 'followup'
     and c.active
     and c.trigger_stage = ct.funnel_stage
    join funnel_stage_def d
      on d.clinic_id = ct.clinic_id and d.chave = ct.funnel_stage
    join cadence_step s on s.cadence_id = c.id
    where s.offset_minutes >= 0
      and not (
        ct.criado_por_importacao
        and ct.funnel_stage_changed_at <= ct.created_at
      )
      and (ct.last_contact_at is null
           or ct.last_contact_at <= ct.funnel_stage_changed_at)
      and ct.funnel_stage_changed_at + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, null, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, contact_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (
      clinic_id, kind, payload, run_at, prioridade, whatsapp_account_id
    )
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           1,
           resolver_conta_de_envio(clinic_id, contact_id)
    from novas
    returning 1
  )
  select count(*)::integer into v_followup from jobs;

  return jsonb_build_object(
    'confirmacao', v_confirmacao,
    'pos_falta', v_pos_falta,
    'followup', v_followup
  );
end;
$function$;
