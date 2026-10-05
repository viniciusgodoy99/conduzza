// Travas de AMBIENTE da IA (Fase 3, E0). Desenho em
// scratchpad/fase3/plano-seguranca.md, secao 1.
//
// T1, interruptor de ambiente: a IA so existe com IA_AGENTE_LIGADO=sim,
//     VERCEL_ENV=production e ANTHROPIC_API_KEY presente (variaveis so no
//     escopo Production da Vercel; nunca no .env.local).
// T2, lista de clinicas: IA_CLINICAS_LIBERADAS (uuids separados por
//     virgula) CRUZADA com CLINICAS_DA_FASE_CONTROLADA. O ambiente so
//     estreita, nunca amplia: uma id fora da constante e descartada, e um
//     valor que nao e uuid derruba a lista inteira (falha fechada).
//
// As travas do banco (T3 a T7: ia_clinicas_da_fase_controlada,
// ia_liberacao, ia_numero_liberado, ia_contato_liberado, ia_interruptor e a
// pausa da clinica) vivem na migration 20261006100000 e se combinam em
// ia_pode_atender. Basta UMA dizer nao para a IA nao agir.
//
// Funcao pura: recebe o ambiente, nao le nada sozinha alem do padrao
// process.env, nao registra nada e nunca devolve o valor da chave.

/**
 * As unicas clinicas que podem ter IA nesta fase: teste123 e Conduzza Teste.
 * Espelho EXATO de ia_clinicas_da_fase_controlada() no banco (o teste de
 * integracao compara). Mudar a lista exige commit E migration revisados.
 */
export const CLINICAS_DA_FASE_CONTROLADA: readonly string[] = Object.freeze([
  "acd9c539-585e-4f2a-a195-712c70099564", // teste123
  "f0c115dd-e98c-4767-a1bb-93d517844852", // Conduzza Teste
]);

export type ConfigDaIa = {
  /** T1: interruptor de ambiente. */
  readonly ligado: boolean;
  /**
   * T2: clinicas liberadas pelo ambiente, ja cruzadas com a constante, em
   * minusculas e sem repeticao. Vazia quando T1 esta desligado ou quando a
   * lista do ambiente tem qualquer valor que nao e uuid.
   */
  readonly clinicas: readonly string[];
};

type Ambiente = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DESLIGADA: ConfigDaIa = Object.freeze({
  ligado: false,
  clinicas: Object.freeze([]) as readonly string[],
});

function interruptorDeAmbiente(env: Ambiente): boolean {
  return (
    env.IA_AGENTE_LIGADO === "sim" &&
    env.VERCEL_ENV === "production" &&
    (env.ANTHROPIC_API_KEY ?? "").trim() !== ""
  );
}

/**
 * Lista do ambiente cruzada com a constante. Um item que nao e uuid
 * derruba a lista inteira: um erro de digitacao nunca libera "o resto".
 */
function clinicasDoAmbiente(valor: string | undefined): readonly string[] {
  const itens = (valor ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
  if (itens.some((item) => !UUID.test(item))) {
    return [];
  }
  return CLINICAS_DA_FASE_CONTROLADA.filter((id) => itens.includes(id));
}

/** Le T1 e T2 do ambiente. Sem argumento, le process.env. */
export function lerConfigDaIa(env: Ambiente = process.env): ConfigDaIa {
  if (!interruptorDeAmbiente(env)) {
    return DESLIGADA;
  }
  return Object.freeze({
    ligado: true,
    clinicas: Object.freeze(clinicasDoAmbiente(env.IA_CLINICAS_LIBERADAS)),
  });
}

/**
 * T1 e T2 para uma clinica. So o ambiente: o banco (ia_pode_atender,
 * ia_pode_simular, ia_clinica_liberada) continua obrigatorio depois disto.
 */
export function iaLiberadaNoAmbiente(
  config: ConfigDaIa,
  clinicId: string,
): boolean {
  return config.ligado && config.clinicas.includes(clinicId.toLowerCase());
}
