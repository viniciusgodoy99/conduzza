-- Reordenacao da jornada numa transacao so (correcao da revisao adversarial
-- das fases 3 e 4).
--
-- A primeira versao fazia o swap em duas escritas PostgREST independentes:
-- se a segunda falhasse, ou se duas pessoas reordenassem ao mesmo tempo com
-- leituras velhas, duas etapas ficavam com a MESMA posicao PARA SEMPRE (nada
-- renumerava posicao), e o empate desligava em silencio o avanco automatico
-- do funil (os gatilhos de agendar/comparecer e o termo-chave comparam
-- posicao com "menor que" estrito).
--
-- Esta RPC resolve as tres pontas de uma vez:
-- 1. transacao unica com FOR UPDATE: reordenacoes concorrentes serializam;
-- 2. renumeracao completa (10, 20, 30...): qualquer empate historico e
--    consertado no proximo reordenar, nunca e permanente;
-- 3. SECURITY INVOKER: a RLS decide. FOR UPDATE sob RLS exige que a linha
--    passe na policy de UPDATE, entao papel sem escrita enxerga zero linhas
--    e recebe "Etapa nao encontrada", nao um bypass.
--
-- Devolve o id da etapa movida para a trilha de auditoria da action.

create or replace function public.reordenar_etapa_da_jornada(
  p_clinic_id uuid,
  p_chave text,
  p_direcao text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_chaves text[];
  v_ids uuid[];
  v_indice integer;
  v_alvo integer;
  v_tmp text;
  v_movida uuid;
  i integer;
begin
  if p_direcao not in ('subir', 'descer') then
    raise exception 'Direção inválida.';
  end if;

  -- Agregado sobre subquery porque FOR UPDATE nao convive com array_agg na
  -- mesma query. O desempate por chave e o MESMO da leitura da tela
  -- (fetchJornada ordena por posicao, chave): o que o usuario ve e o que
  -- a troca usa.
  select
      array_agg(etapas.chave order by etapas.posicao, etapas.chave),
      array_agg(etapas.id order by etapas.posicao, etapas.chave)
    into v_chaves, v_ids
    from (
      select id, chave, posicao
        from public.funnel_stage_def
       where clinic_id = p_clinic_id
         for update
    ) etapas;

  v_indice := array_position(v_chaves, p_chave);
  if v_indice is null then
    raise exception 'Etapa não encontrada.';
  end if;

  v_alvo := v_indice + case when p_direcao = 'subir' then -1 else 1 end;
  if v_alvo < 1 or v_alvo > array_length(v_chaves, 1) then
    raise exception 'A etapa já está na ponta da jornada.';
  end if;

  v_movida := v_ids[v_indice];
  v_tmp := v_chaves[v_indice];
  v_chaves[v_indice] := v_chaves[v_alvo];
  v_chaves[v_alvo] := v_tmp;

  for i in 1..array_length(v_chaves, 1) loop
    update public.funnel_stage_def
       set posicao = i * 10
     where clinic_id = p_clinic_id
       and chave = v_chaves[i]
       and posicao is distinct from i * 10;
  end loop;

  return v_movida;
end;
$$;

revoke all on function public.reordenar_etapa_da_jornada(uuid, text, text)
  from public;
grant execute on function public.reordenar_etapa_da_jornada(uuid, text, text)
  to authenticated, service_role;
