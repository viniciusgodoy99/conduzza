-- Agregados da tela de Resultados calculados NO BANCO. Correcao de dois
-- defeitos graves achados na revisao adversarial de 08/09/2026:
--
-- 1. O TETO ERA ILUSORIO E O CORTE, SILENCIOSO. A tela somava as linhas de
--    contact no servidor de aplicacao com .limit(5000), mas o PostgREST corta
--    em 1000 (max_rows). Acima de 1000 contatos, TODOS os indicadores ficavam
--    errados sem nenhum aviso, e sem ORDER BY nem se sabia quais 1000 linhas
--    sobreviviam. Agregado em SQL nao tem teto de linhas: a conta e feita onde
--    o dado mora.
--
-- 2. "AGENDAMENTOS" ERA UMA FOTO, NAO UMA COORTE. Somar quem esta HOJE em
--    agendou/compareceu esquece quem agendou e depois foi arrastado para
--    Perdido no Kanban (fluxo comum apos falta). O agendamento aconteceu; a
--    conversao existiu. A coorte certa vem da tabela appointment: quem JA teve
--    agendamento, e quem JA compareceu, contando cada pessoa uma vez.
--
-- SECURITY INVOKER de proposito: a RLS de contact e appointment decide o que o
-- usuario enxerga, entao a funcao nao abre nada que a sessao nao veria linha a
-- linha (regra 3.1: o recorte vive no Postgres).

create or replace function public.resultados_da_clinica(p_clinic_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'total_leads', (
      select count(*) from contact where clinic_id = p_clinic_id
    ),
    -- A etapa ATUAL de cada contato: alimenta o desenho do funil, que e
    -- explicitamente um retrato de hoje.
    'por_etapa', (
      select coalesce(jsonb_object_agg(funnel_stage, n), '{}'::jsonb)
        from (
          select funnel_stage, count(*) as n
            from contact
           where clinic_id = p_clinic_id
           group by funnel_stage
        ) etapas
    ),
    -- COORTE: quem ja agendou alguma vez, mesmo que hoje esteja em Perdido.
    'agendaram', (
      select count(distinct contact_id)
        from appointment
       where clinic_id = p_clinic_id
    ),
    -- COORTE: quem ja compareceu alguma vez.
    'compareceram', (
      select count(distinct contact_id)
        from appointment
       where clinic_id = p_clinic_id
         and status = 'compareceu'
    ),
    'por_canal', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('canal', source_channel, 'total', n)
          order by n desc
        ),
        '[]'::jsonb
      )
        from (
          select source_channel, count(*) as n
            from contact
           where clinic_id = p_clinic_id
           group by source_channel
        ) canais
    )
  );
$$;

grant execute on function public.resultados_da_clinica(uuid) to authenticated;
