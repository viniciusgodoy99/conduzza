-- Fase 3 da tarefa 4.8 (follow-up de leads), parte 1: a ANCORA.
--
-- A regua de follow-up dispara "X tempo depois que o lead ENTROU na etapa", e
-- ate aqui nenhuma coluna dizia quando isso aconteceu. A ancora nasce como
-- coluna do contato, carimbada DENTRO de validar_etapa_do_contato(): e o
-- gatilho BEFORE que ja roda em todo caminho que mexe em funnel_stage
-- (Kanban, acoes em massa, termo-chave, gatilhos da agenda), entao nenhum
-- caminho novo consegue esquecer o carimbo.
--
-- Backfill = now() pelo proprio default do add column, de proposito: lead
-- antigo so entra na regua quando se mover a partir de agora, sem rajada
-- retroativa no deploy. Sem trava de escrita direta: e automacao da propria
-- clinica (nao seguranca), e e assim que o teste de integracao viaja no
-- tempo.

alter table public.contact
  add column funnel_stage_changed_at timestamptz not null default now();

create or replace function public.validar_etapa_do_contato()
returns trigger
language plpgsql
as $$
declare
  v_papel text;
begin
  select papel into v_papel
    from public.funnel_stage_def
   where clinic_id = new.clinic_id and chave = new.funnel_stage;

  if not found then
    -- errcode de CHECK preservado: e o codigo que o contrato antigo (o check
    -- global) devolvia, e que actions e testes ja tratam.
    raise exception 'A etapa "%" não existe na jornada desta clínica.',
      new.funnel_stage using errcode = '23514';
  end if;

  -- A regra que era o CHECK contact_perdido_exige_motivo, agora por papel:
  -- perder um lead exige dizer por que, seja qual for o nome da etapa.
  if v_papel = 'perdido' and new.lost_reason is null then
    raise exception 'Marcar como perdido exige o motivo da perda.'
      using errcode = '23514';
  end if;

  -- ANCORA do follow-up (4.8): quando o contato muda de etapa (ou nasce), o
  -- relogio da regua zera. Update que nao toca funnel_stage nao mexe aqui.
  if tg_op = 'INSERT'
     or new.funnel_stage is distinct from old.funnel_stage then
    new.funnel_stage_changed_at := now();
  end if;

  return new;
end;
$$;
