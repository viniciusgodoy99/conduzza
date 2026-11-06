// O numero da carteirinha que o leitor de midia devolve (decisao do dono de
// 06/11/2026). PURO. O arquivo e DADO: o numero nao pode virar canal de
// instrucao. Por isso a validacao e estreita: sobra so letra e digito depois
// de tirar espaco, ponto e traco, num tamanho plausivel, quase tudo digito. O
// que nao passa e descartado e nunca vai a lugar nenhum. O espelho no banco
// esta em gravar_leitura_da_midia (migration 20261106130000).
//
// O numero so existe no caminho do leitor ate a RPC. Nunca vai para
// ia_leitura_da_midia, ai_decision_log, ai_turno, resumo, nota, log, Sentry
// nem para o modelo do agente.

/**
 * Os limites do numero depois da limpeza. As carteirinhas brasileiras tem de
 * 5 a 20 e poucos caracteres; o limite de 60 da ficha do paciente
 * (app/(app)/pacientes/actions.ts) fica folgado.
 */
export const LIMITES_DO_NUMERO_DA_CARTEIRINHA = {
  minimo: 5,
  maximo: 30,
  minimoDeDigitos: 4,
  maximoDeLetras: 6,
} as const;

/**
 * O numero limpo (sem espaco, ponto e traco, em maiuscula), ou null se nao
 * passar. Nunca lanca.
 */
export function numeroDaCarteirinhaLido(valor: unknown): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const limpo = valor.replace(/[ .-]/g, "").toUpperCase();
  const { minimo, maximo, minimoDeDigitos, maximoDeLetras } =
    LIMITES_DO_NUMERO_DA_CARTEIRINHA;
  if (
    limpo.length < minimo ||
    limpo.length > maximo ||
    !/^[0-9A-Z]+$/.test(limpo)
  ) {
    return null;
  }
  const digitos = limpo.replace(/[^0-9]/g, "").length;
  return digitos >= minimoDeDigitos && limpo.length - digitos <= maximoDeLetras
    ? limpo
    : null;
}

/** O cadastro ja tem a carteirinha de que a marcacao precisa (o que veio do banco). */
export type CarteirinhaNoCadastro = {
  /** contact.insurance_id; null: o cadastro nao diz de qual convenio e. */
  convenioId: string | null;
};

/**
 * A carteirinha do cadastro vale para a consulta por este convenio? So com o
 * mesmo convenio, ou com o convenio do cadastro vazio. O espelho e
 * dados_que_faltam_para_marcar (migration 20261106130000).
 */
export function carteirinhaDoCadastroVale(
  noCadastro: CarteirinhaNoCadastro | null | undefined,
  convenioDaConsulta: string | null,
): boolean {
  return (
    noCadastro !== null &&
    noCadastro !== undefined &&
    (noCadastro.convenioId === null ||
      noCadastro.convenioId === convenioDaConsulta)
  );
}
