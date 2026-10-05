// Tipo marcado do texto que pode ir ao paciente como autor "ia".
//
// So filtrarSaida (filtro.ts) produz um TextoAprovado. Uma string comum NAO
// e atribuivel a ele, entao o envio que exige TextoAprovado nao compila com
// texto cru do modelo. O teste tests/unit/conformidade/texto-aprovado.test.ts
// varre o codigo e falha se aparecer conversao para este tipo fora do filtro.
//
// O tipo e a primeira de tres travas (plano de seguranca, resumo): a segunda
// e a checagem logo antes do provedor e a terceira o gatilho em message que
// confere o hash do texto em ai_decision_log.

declare const marcaDoTextoAprovado: unique symbol;

export type TextoAprovado = string & {
  readonly [marcaDoTextoAprovado]: "TextoAprovado";
};
