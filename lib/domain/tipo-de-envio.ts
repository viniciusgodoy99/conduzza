// Por qual numero cada TIPO de mensagem automatica sai (decisao do dono de
// 29/09/2026, docs/07). A escolha mora em whatsapp_envio_automatico, uma
// linha por tipo, e quem decide o numero de cada envio e o banco
// (resolver_conta_de_envio com o tipo). Aqui ficam so os nomes dos tipos,
// iguais ao check da tabela e ao que tipo_de_envio_do_job devolve, para o
// codigo nunca escrever um tipo que o banco nao conhece.
//
// PURO, zero I/O: importado pelo servidor (jobs, actions) e pela tela.
//
// O eco da resposta ao toque ("Presença confirmada") nao tem tipo: sai pelo
// numero em que o paciente respondeu (D4), fora de qualquer escolha.

export const TIPOS_DE_ENVIO = [
  "confirmacao",
  "pos_falta",
  "followup",
  "lista_espera",
  "aviso_remarcacao",
] as const;

export type TipoDeEnvio = (typeof TIPOS_DE_ENVIO)[number];

/** Rotulo de recepcionista de cada tipo, na ordem da tela. */
export const ROTULO_DO_TIPO_DE_ENVIO: Record<TipoDeEnvio, string> = {
  confirmacao: "Confirmação de consulta e Cobrar agora",
  pos_falta: "Recuperação depois da falta",
  followup: "Follow-up de leads",
  lista_espera: "Oferta da lista de espera",
  aviso_remarcacao: "Aviso de remarcação",
};

export function ehTipoDeEnvio(valor: unknown): valor is TipoDeEnvio {
  return (
    typeof valor === "string" &&
    (TIPOS_DE_ENVIO as readonly string[]).includes(valor)
  );
}

/**
 * O tipo de envio de uma regua, pelo cadence.kind (a mesma derivacao de
 * tipo_de_envio_do_job para executar_passo_de_regua). O "Cobrar agora" e um
 * toque da regua de confirmacao, entao cai em 'confirmacao'. Regua de outro
 * kind (reativacao) nao tem escolha propria: nulo, que no banco e o ultimo
 * numero usado pelo paciente.
 */
export function tipoDeEnvioDaRegua(kind: unknown): TipoDeEnvio | null {
  return kind === "confirmacao" ||
    kind === "pos_falta" ||
    kind === "followup" ||
    kind === "lista_espera"
    ? kind
    : null;
}
