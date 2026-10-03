// Versao da Graph/Marketing API da Meta, num lugar so (C10 da Fase 4).
//
// A Marketing API (Insights) tem calendario proprio, mais curto que o da
// Graph API: a v24 caiu em 06/10/2026 e a v25 deve cair por volta de fev/2027
// (padrao de cerca de 12 meses das versoes anteriores). A v26.0 saiu em
// 29/07/2026 sem mudanca no Insights nem na Conversions API. Insights e
// Conversions API importam daqui, para nunca andarem em versoes diferentes.
//
// Se a v26.0 for recusada (codigo 2635, "versao_descontinuada", ou erro de
// parametro no primeiro "Testar leitura"), voltar para "v25.0" aqui.
export const GRAPH_VERSION = "v26.0";
