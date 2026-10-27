// Ferramenta consultar_unidades do agente de IA (AG2, 27/10/2026): as
// unidades ativas da clinica, com o endereco montado num campo so (e,
// desde a revisao 2, o bairro e a cidade tambem em campos proprios), o ponto
// de referencia, o estacionamento, a acessibilidade, a observacao ao
// paciente, o horario de funcionamento em texto curto e quem atende em cada
// uma (pela jornada). PURO: le o catalogo carregado no servidor
// (lib/agente/contexto.ts, cadastro-do-agente.ts); nada daqui le o banco nem
// a rede, e nada de paciente.
//
// Regras:
//  - Nunca CEP, telefone, link do mapa nem o texto livre de endereco: o
//    filtro de saida barra os tres primeiros, e o endereco montado e o que a
//    regra de endereco dos fatos do turno reconhece (logradouro com numero).
//  - O endereco e os horarios que esta saida traz sao FATOS do turno: o
//    filtro de saida so deixa sair o endereco e a hora que vieram daqui (ou
//    da base publicada). Endereco inventado e barrado.
//  - Sem unidade cadastrada: "sem_unidade_cadastrada" (o modelo usa a base
//    publicada, se ela responder, ou passa para a equipe).
//  - Codigos u1, u2... pela ordem do nome (e do id): a mesma clinica da
//    sempre os mesmos codigos no turno.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import type { CatalogoDoAgente } from "./buscar-procedimento";
import {
  profissionaisDaUnidade,
  type UnidadeDoAgente,
} from "./cadastro-do-agente";
import type { ResultadoDaConsulta } from "./consultas-do-cadastro";

export const NOME_DA_CONSULTA_DE_UNIDADES = "consultar_unidades";

/** Entrada validada no servidor (o modelo nunca e confiavel). */
export const entradaDaConsultaDeUnidadesSchema = z
  .object({
    unidade: z.string().trim().max(16).nullable(),
  })
  .strict();

/**
 * Definicao para a Responses API (strict: todas as propriedades exigidas,
 * nenhuma a mais). Escrita a mao, como buscar_procedimento; um teste confere
 * que as chaves batem com o Zod.
 */
export const FERRAMENTA_CONSULTAR_UNIDADES: FunctionTool = {
  type: "function",
  name: NOME_DA_CONSULTA_DE_UNIDADES,
  strict: true,
  description:
    "Consulta no Cadastro as unidades da clínica: o endereço, o horário de funcionamento, o ponto de referência, o estacionamento, a acessibilidade, a observação ao paciente e quem atende em cada uma. Cada unidade vem com um código (u1, u2...).",
  parameters: {
    type: "object",
    properties: {
      unidade: {
        type: ["string", "null"],
        description:
          "Código de uma unidade que esta ferramenta trouxe nesta resposta, por exemplo u1, ou null para todas as unidades.",
      },
    },
    required: ["unidade"],
    additionalProperties: false,
  },
};

/** Os nomes de quem atende na unidade, na ordem do catalogo. */
function quemAtende(
  catalogo: CatalogoDoAgente,
  unidade: UnidadeDoAgente,
): string[] {
  const ids = profissionaisDaUnidade(catalogo, unidade.id);
  return (catalogo.profissionais ?? [])
    .filter((p) => ids.has(p.id))
    .map((p) => p.nome);
}

/** Uma unidade como vai ao modelo: so o que esta cadastrado. */
function unidadeParaOModelo(
  catalogo: CatalogoDoAgente,
  unidade: UnidadeDoAgente,
): Record<string, unknown> {
  const profissionais = quemAtende(catalogo, unidade);
  return {
    codigo: unidade.codigo,
    nome: unidade.nome,
    // Nulo diz ao modelo que nao ha o que informar (nunca estimar).
    endereco: unidade.endereco,
    // Revisao 2 da AG2: o bairro e a cidade em campos proprios (o filtro
    // de saida reconhece o nome de lugar citado sozinho).
    ...(unidade.bairro === null ? {} : { bairro: unidade.bairro }),
    ...(unidade.cidade === null ? {} : { cidade: unidade.cidade }),
    ...(unidade.referencia === null
      ? {}
      : { ponto_de_referencia: unidade.referencia }),
    ...(unidade.estacionamento === null
      ? {}
      : { estacionamento: unidade.estacionamento }),
    ...(unidade.acessibilidade === null
      ? {}
      : { acessibilidade: unidade.acessibilidade }),
    ...(unidade.observacao === null ? {} : { observacao: unidade.observacao }),
    horario_de_funcionamento: unidade.horario,
    ...(profissionais.length === 0 ? {} : { profissionais }),
  };
}

function nomesEmTexto(unidades: readonly UnidadeDoAgente[]): string {
  return unidades.map((u) => u.nome).join(", ");
}

/**
 * Executa consultar_unidades sobre o catalogo carregado. Nunca lanca:
 * entrada invalida vira um resultado que o modelo le.
 */
export function consultarUnidades(
  catalogo: CatalogoDoAgente,
  argumentos: unknown,
): ResultadoDaConsulta {
  const lido = entradaDaConsultaDeUnidadesSchema.safeParse(argumentos);
  if (!lido.success) {
    return {
      saida: JSON.stringify({ resultado: "entrada_invalida" }),
      passo: "Tentou consultar as unidades com um pedido incompleto",
      resultado: "entrada_invalida",
    };
  }
  const unidades = catalogo.unidades ?? [];
  if (unidades.length === 0) {
    return {
      saida: JSON.stringify({ resultado: "sem_unidade_cadastrada" }),
      passo: "Consultou as unidades: nenhuma unidade ativa no Cadastro",
      resultado: "sem_unidade_cadastrada",
    };
  }
  const codigo = (lido.data.unidade ?? "").toLowerCase();
  const escolhidas =
    codigo === "" ? unidades : unidades.filter((u) => u.codigo === codigo);
  if (escolhidas.length === 0) {
    return {
      saida: JSON.stringify({ resultado: "unidade_nao_encontrada" }),
      passo: "Procurou uma unidade que não está no Cadastro",
      resultado: "unidade_nao_encontrada",
    };
  }
  return {
    saida: JSON.stringify({
      resultado: "unidades",
      unidades: escolhidas.map((u) => unidadeParaOModelo(catalogo, u)),
    }),
    passo:
      escolhidas.length === 1
        ? `Consultou a unidade ${nomesEmTexto(escolhidas)}`
        : `Consultou as unidades: ${nomesEmTexto(escolhidas)}`,
    resultado: "unidades",
  };
}
