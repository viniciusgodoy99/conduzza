import type { SupabaseClient } from "@supabase/supabase-js";

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
// T2, clinicas habilitadas: desde a onda 1 (decisao do dono de 20/10/2026)
//     a lista fixa de duas clinicas saiu do codigo e do banco. A habilitacao
//     do agente por clinica e DADO (ia_clinica_habilitada, estado 'teste'),
//     escrito so pelo super admin pelo Painel geral (definir_agente_da_clinica,
//     com trilha), e lido aqui por ia_clinicas_da_fase_controlada(), a mesma
//     funcao que as travas do banco usam (sem clinica suspensa). O codigo le
//     a lista do banco a cada requisicao (cache curto em
//     lib/queries/ia-liberacao.ts) ou a cada passagem do motor da IA.
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
// As funcoes de ambiente sao puras: recebem o ambiente, nao leem nada
// sozinhas alem do padrao process.env, nao registram nada e nunca devolvem
// o valor da chave. A leitura da lista recebe o cliente de quem chama (a
// service role: a funcao do banco nao e executavel pela sessao).

export type ConfigDaIa = {
  /** T1: producao da Vercel com a chave da OpenAI e o segredo do identificador. */
  readonly ligado: boolean;
  /**
   * T2: as clinicas com o agente habilitado (lidas do banco), em
   * minusculas. Vazia quando T1 esta desligado.
   */
  readonly clinicas: readonly string[];
};

type Ambiente = Readonly<Record<string, string | undefined>>;

const DESLIGADA: ConfigDaIa = Object.freeze({
  ligado: false,
  clinicas: Object.freeze([]) as readonly string[],
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

/** So T1 (o ambiente). Sem argumento, le process.env. */
export function ambienteDaIaLigado(env: Ambiente = process.env): boolean {
  return (
    env.VERCEL_ENV === "production" &&
    (env.OPENAI_API_KEY ?? "").trim() !== "" &&
    segredoDoIdentificadorValido(env)
  );
}

/**
 * Normaliza a lista: so uuid, em minusculas, sem repeticao, na ordem do
 * banco. Item fora do formato fica de fora (nunca vira clinica liberada).
 */
function listaNormalizada(clinicas: readonly unknown[]): readonly string[] {
  const vistas = new Set<string>();
  for (const item of clinicas) {
    if (typeof item !== "string") {
      continue;
    }
    const id = item.trim().toLowerCase();
    if (UUID.test(id)) {
      vistas.add(id);
    }
  }
  return Object.freeze([...vistas]);
}

/**
 * T1 e T2: o ambiente (sem segundo argumento, process.env) e a lista das
 * clinicas habilitadas, ja lida do banco por quem chama
 * (lerClinicasHabilitadasDaIa). Sem T1, a lista nem conta: DESLIGADA.
 */
export function lerConfigDaIa(
  clinicas: readonly string[],
  env: Ambiente = process.env,
): ConfigDaIa {
  if (!ambienteDaIaLigado(env)) {
    return DESLIGADA;
  }
  return Object.freeze({
    ligado: true,
    clinicas: listaNormalizada(clinicas),
  });
}

/**
 * T1 e T2 para uma clinica. So o ambiente e a lista: o banco (ia_pode_atender,
 * ia_pode_simular, ia_clinica_liberada) continua obrigatorio depois disto.
 */
export function iaLiberadaNoAmbiente(
  config: ConfigDaIa,
  clinicId: string,
): boolean {
  return (
    config.ligado && config.clinicas.includes(clinicId.trim().toLowerCase())
  );
}

/**
 * As clinicas com o agente habilitado, do banco: ia_clinicas_da_fase_controlada()
 * (estado 'teste' em ia_clinica_habilitada, sem clinica suspensa), com o
 * cliente de quem chama (service role). Erro ou formato estranho: LANCA, e
 * quem chama fecha (nada e liberado por uma lista que nao foi lida).
 */
export async function lerClinicasHabilitadasDaIa(
  admin: SupabaseClient,
): Promise<readonly string[]> {
  const { data, error } = await admin.rpc("ia_clinicas_da_fase_controlada");
  if (error || !Array.isArray(data)) {
    throw new Error("lista de clinicas da IA ilegivel");
  }
  return listaNormalizada(data as unknown[]);
}

/**
 * T1 e T2 de uma vez, para o motor e o simulador. Sem T1, nem le o banco
 * (DESLIGADA). Leitura que falha: LANCA (lerClinicasHabilitadasDaIa).
 */
export async function lerConfigDaIaDoBanco(
  admin: SupabaseClient,
  env: Ambiente = process.env,
): Promise<ConfigDaIa> {
  if (!ambienteDaIaLigado(env)) {
    return DESLIGADA;
  }
  return lerConfigDaIa(await lerClinicasHabilitadasDaIa(admin), env);
}
