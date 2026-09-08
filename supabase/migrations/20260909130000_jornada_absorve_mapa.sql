-- A jornada absorve o mapa de conversao (fase 3 da jornada configuravel).
--
-- No Tintim, evento da Meta, "e venda" e valor moram NA EDICAO DA ETAPA, e o
-- dono pediu exatamente esse modelo. A funnel_conversion_map viveu 1 dia como
-- tabela propria (criada em 08/09); com as colunas de conversao ja nascidas em
-- funnel_stage_def, mante-la seria duas fontes para a mesma resposta, e a
-- primeira etapa personalizada quebraria o check de 5 chaves fixas dela.
--
-- O que houver configurado no mapa e copiado para a etapa correspondente
-- ANTES de a tabela cair (em producao ha zero linhas, mas migration se escreve
-- para o caso geral).

update public.funnel_stage_def d
   set meta_event_name = m.meta_event_name,
       conversao_ativa = m.active,
       is_sale = m.is_sale,
       is_first_contact = m.is_first_contact,
       value_source = m.value_source,
       value_cents = m.value_cents
  from public.funnel_conversion_map m
 where m.clinic_id = d.clinic_id
   and m.trigger_stage = d.chave;

drop table public.funnel_conversion_map;
