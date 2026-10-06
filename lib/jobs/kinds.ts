// Os kinds da fila (job_queue.kind) por trilho do motor, num lugar so. Antes
// a lista de envio vivia no motor e numa copia em mensagens-esperando, com um
// comentario pedindo "mudou la, muda aqui": a mensagem agendada seria a
// primeira a escapar de uma das copias.
//
// A uniao dos quatro trilhos e exatamente o CHECK job_queue_kind_check do
// banco (um teste de unidade cruza com a migration mais recente que redefine
// o CHECK): kind que o banco aceita e nenhum trilho reivindica ficaria
// pendente para sempre, sem last_error e sem aparecer em lugar nenhum.
//
// NOTA PARA O E3: o 'responder_com_ia' entra no CHECK e num trilho daqui.

/**
 * Tipos que disputam o slot de envio do numero (reservar_slot_envio_v2) e
 * mandam mensagem ao paciente. A faixa de "mensagens esperando" conta estes.
 */
export const KINDS_DE_ENVIO = [
  "enviar_mensagem_ativa",
  "executar_passo_de_regua",
  "enviar_mensagem_agendada",
] as const;

/** Midia nao toca o slot de envio: trilho proprio. */
export const KINDS_DE_MIDIA = ["baixar_midia"] as const;

/**
 * Integracoes externas (Meta CAPI) e a orquestracao da lista de espera: nao
 * disputam o slot anti-ban nem atrasam confirmacao de consulta.
 */
export const KINDS_DE_INTEGRACAO = [
  "enviar_conversao_meta",
  "oferecer_lista_espera",
] as const;

/**
 * Leituras da Meta (investimento e consulta de anuncio por id): claim proprio
 * e grupo proprio (L1).
 */
export const KINDS_DE_GASTO = [
  "sincronizar_gasto_meta",
  "resolver_anuncio_meta",
] as const;

/** Todos os kinds que o motor reivindica (= CHECK job_queue_kind_check). */
export const KINDS_DO_MOTOR = [
  ...KINDS_DE_ENVIO,
  ...KINDS_DE_MIDIA,
  ...KINDS_DE_INTEGRACAO,
  ...KINDS_DE_GASTO,
] as const;

export type KindDeJob = (typeof KINDS_DO_MOTOR)[number];
