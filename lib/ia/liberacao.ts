// Travas de AMBIENTE da IA (Fase 3, E0). Desenho em
// scratchpad/fase3/plano-seguranca.md, secao 1.
//
// T1, ambiente: a IA so existe na producao da Vercel (VERCEL_ENV=production),
//     com OPENAI_API_KEY presente (chave do projeto producao-agente da
//     OpenAI; so no escopo Production da Vercel, nunca no .env.local) e com
//     IA_SEGREDO_DO_IDENTIFICADOR de 32 caracteres ou mais (o segredo do
//     safety_identifier: sem ele todo turno falha em sem_identificador, entao
//     a IA nao esta de pe; revisao do E3). UAZAPI_OPENAI_KEY, a da
//     transcricao, nao conta. Apagar ou revogar a chave desliga tudo.
// T2, lista fechada: CLINICAS_DA_FASE_CONTROLADA, espelho da funcao imutavel
//     do banco. Mudar exige commit E migration revisados.
//
// Ligar e desligar e no sistema, nao em variavel (decisao do dono em
// 13/10/2026): IA_AGENTE_LIGADO e IA_CLINICAS_LIBERADAS sairam, porque
// repetiam o interruptor geral e a liberacao por clinica do banco, que o
// super admin muda em segundos pela aba Agente de IA de Configuracoes.
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
  /** T1: producao da Vercel com a chave da OpenAI e o segredo do identificador. */
  readonly ligado: boolean;
  /**
   * T2: as clinicas da lista fechada, em minusculas. Vazia quando T1 esta
   * desligado.
   */
  readonly clinicas: readonly string[];
};

type Ambiente = Readonly<Record<string, string | undefined>>;

const DESLIGADA: ConfigDaIa = Object.freeze({
  ligado: false,
  clinicas: Object.freeze([]) as readonly string[],
});

/**
 * Minimo do segredo do identificador: o mesmo de identificadorDeSeguranca
 * (lib/integrations/llm/openai.ts; o teste de ambiente confere os dois).
 */
export const TAMANHO_MINIMO_DO_SEGREDO_DO_IDENTIFICADOR = 32;

/** IA_SEGREDO_DO_IDENTIFICADOR presente e longo o bastante (sem as pontas). */
export function segredoDoIdentificadorValido(env: Ambiente): boolean {
  return (
    (env.IA_SEGREDO_DO_IDENTIFICADOR ?? "").trim().length >=
    TAMANHO_MINIMO_DO_SEGREDO_DO_IDENTIFICADOR
  );
}

function interruptorDeAmbiente(env: Ambiente): boolean {
  return (
    env.VERCEL_ENV === "production" &&
    (env.OPENAI_API_KEY ?? "").trim() !== "" &&
    segredoDoIdentificadorValido(env)
  );
}

/** Le T1 e T2. Sem argumento, le process.env. */
export function lerConfigDaIa(env: Ambiente = process.env): ConfigDaIa {
  if (!interruptorDeAmbiente(env)) {
    return DESLIGADA;
  }
  return Object.freeze({
    ligado: true,
    clinicas: CLINICAS_DA_FASE_CONTROLADA,
  });
}

/**
 * T1 e T2 para uma clinica. So o ambiente e a lista fechada: o banco (ia_pode_atender,
 * ia_pode_simular, ia_clinica_liberada) continua obrigatorio depois disto.
 */
export function iaLiberadaNoAmbiente(
  config: ConfigDaIa,
  clinicId: string,
): boolean {
  return config.ligado && config.clinicas.includes(clinicId.toLowerCase());
}
