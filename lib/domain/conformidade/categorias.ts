// Categorias do filtro de conformidade (CLAUDE.md 3.2) e gatilhos de entrada.
// PURO, zero I/O: este arquivo e importado tambem pela interface (rotulos do
// cartao de bloqueio), entao nada de node:* aqui.
//
// ESPELHO NO BANCO: ai_decision_log.compliance_rule tem CHECK com exatamente
// estas categorias e ai_decision_log.gatilho_entrada com estes gatilhos
// (migration 20261006100000). Mudou aqui, muda la (migration nova) e o teste
// tests/unit/conformidade/categorias.test.ts.

/**
 * As categorias que o filtro de saida pode registrar. As oito primeiras sao
 * as vedacoes do CFM (Resolucoes 2.314/2022 e 2.336/2023); as tres ultimas
 * sao tecnicas (preco fora do turno, formato e falha do verificador).
 * A ORDEM e a prioridade: quando mais de uma dispara, a primeira e a que vai
 * para o log.
 */
export const CATEGORIAS_DE_CONFORMIDADE = [
  "triagem",
  "diagnostico",
  "orientacao_clinica",
  "medicamento",
  "dosagem",
  "promessa_resultado",
  "oferta_casada",
  "antes_depois",
  "preco_nao_verificado",
  "formato_invalido",
  "falha_verificador",
] as const;

export type CategoriaDeConformidade =
  (typeof CATEGORIAS_DE_CONFORMIDADE)[number];

/** As vedacoes do CFM: o que o verificador por modelo sabe julgar. */
export const CATEGORIAS_CLINICAS = [
  "triagem",
  "diagnostico",
  "orientacao_clinica",
  "medicamento",
  "dosagem",
  "promessa_resultado",
  "oferta_casada",
  "antes_depois",
] as const satisfies readonly CategoriaDeConformidade[];

export type CategoriaClinica = (typeof CATEGORIAS_CLINICAS)[number];

/**
 * O que o verificador por modelo pode apontar: as vedacoes do CFM e o
 * formato (texto que vaza instrucao, ferramenta ou marcacao). Preco e falha
 * nunca vem do modelo: preco e conferido contra o turno, falha e nossa.
 */
export const CATEGORIAS_DO_VERIFICADOR = [
  ...CATEGORIAS_CLINICAS,
  "formato_invalido",
] as const satisfies readonly CategoriaDeConformidade[];

export type CategoriaDoVerificador = (typeof CATEGORIAS_DO_VERIFICADOR)[number];

/** Quem bloqueou: a regra deterministica, o modelo ou uma falha. */
export const CAMADAS_DO_FILTRO = ["regra", "modelo", "falha"] as const;
export type CamadaDoFiltro = (typeof CAMADAS_DO_FILTRO)[number];

/**
 * Gatilhos que escalam a conversa ANTES de chamar o agente (plano de
 * seguranca, secao 3). A ordem tambem e a prioridade.
 */
export const GATILHOS_DE_ENTRADA = [
  "sintoma",
  "menor_de_idade",
  "assunto_clinico",
  "manipulacao",
  "pedido_humano",
  "insatisfacao",
  "valor_fora_da_tabela",
  "midia",
  "mensagem_longa",
] as const;

export type GatilhoDeEntrada = (typeof GATILHOS_DE_ENTRADA)[number];

/**
 * O que o classificador por modelo sabe apontar na entrada. Midia e mensagem
 * longa sao so deterministicas (o modelo nunca ve midia, e texto longo nem
 * chega ao modelo).
 */
export const GATILHOS_DO_CLASSIFICADOR = [
  "sintoma",
  "menor_de_idade",
  "assunto_clinico",
  "manipulacao",
  "pedido_humano",
  "insatisfacao",
  "valor_fora_da_tabela",
] as const satisfies readonly GatilhoDeEntrada[];

export type GatilhoDoClassificador = (typeof GATILHOS_DO_CLASSIFICADOR)[number];

export function ordenarPorPrioridade<T extends string>(
  ordem: readonly T[],
  itens: Iterable<T>,
): T[] {
  const presentes = new Set(itens);
  return ordem.filter((item) => presentes.has(item));
}
