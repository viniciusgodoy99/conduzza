// Ferramenta consultar_requisitos do agente de IA (AG2, 27/10/2026): o que o
// paciente precisa levar ou fazer para um procedimento, numa lista fechada
// de tipos (pedido medico, autorizacao previa do convenio, carteirinha,
// documento com foto, exames anteriores, acompanhante, chegar antes, idade
// minima, avaliacao antes e outro), com o texto ao paciente que a clinica
// cadastrou. PURO: le o catalogo carregado no servidor; nada de paciente.
//
// Regras:
//  - Os requisitos ATIVOS gerais (para todos) e, com o convenio
//    identificado pela MESMA regra de buscar_procedimento (convenioParaAgenda,
//    exatamente um convenio do Cadastro), os dele. Duvida sobre o convenio
//    volta como opcoes, sem nada do convenio, com os gerais.
//  - Nunca preparo clinico: procedure.prep_instructions nem e lido (decisao
//    D-4, opcao A: jejum e cuidados continuam passando para a equipe). O
//    texto ao paciente ja passou pelas regras do filtro ao ser carregado.
//  - Procedimento so com a equipe que nao deixa informar (ia_pode_informar
//    desligado): "so_com_a_equipe", sem nada.
//  - Com "Informar preço e convênio" desligada, convenio nenhum e
//    identificado: "informar_convenio_desligado" (o modelo passa para a equipe).
//  - Sem nada cadastrado: "sem_requisitos_cadastrados" (nunca "nao precisa
//    de nada").

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import {
  convenioParaAgenda,
  procedimentoDoCodigo,
  type CatalogoDoAgente,
} from "./buscar-procedimento";
import {
  itemDoRequisito,
  requisitosDoProcedimento,
  temRequisitoPorConvenio,
  type RequisitoDoAgente,
} from "./cadastro-do-agente";
import type {
  OpcoesDaConsulta,
  ResultadoDaConsulta,
} from "./consultas-do-cadastro";

export const NOME_DA_CONSULTA_DE_REQUISITOS = "consultar_requisitos";

/** Entrada validada no servidor (o modelo nunca e confiavel). */
export const entradaDaConsultaDeRequisitosSchema = z
  .object({
    procedimento: z.string().trim().min(1).max(64),
    convenio: z.string().trim().max(256).nullable(),
  })
  .strict();

/** Definicao para a Responses API (strict, escrita a mao). */
export const FERRAMENTA_CONSULTAR_REQUISITOS: FunctionTool = {
  type: "function",
  name: NOME_DA_CONSULTA_DE_REQUISITOS,
  strict: true,
  description:
    "Consulta no Cadastro o que o paciente precisa levar ou fazer para um procedimento: documento, carteirinha, pedido médico, autorização do convênio, exames anteriores, chegar antes, acompanhante, idade mínima ou avaliação antes. Nunca traz preparo, jejum nem cuidados com o corpo.",
  parameters: {
    type: "object",
    properties: {
      procedimento: {
        type: "string",
        description:
          "Código do procedimento no bloco <procedimentos>, por exemplo p3.",
      },
      convenio: {
        type: ["string", "null"],
        description:
          "Nome do convênio (e do plano, se o paciente disse) como o paciente falou, ou o chamar_com da opção que o paciente confirmou, ou null quando o paciente não falou de convênio.",
      },
    },
    required: ["procedimento", "convenio"],
    additionalProperties: false,
  },
};

/** Um requisito como vai ao modelo: o item e o texto ao paciente. */
function requisitoParaOModelo(
  requisito: RequisitoDoAgente,
): Record<string, string> {
  const item = itemDoRequisito(requisito);
  return requisito.tipo === "outro" || requisito.texto === null
    ? { item }
    : { item, texto_ao_paciente: requisito.texto };
}

function quantos(n: number): string {
  return n === 1 ? "1 item" : `${n} itens`;
}

/**
 * Executa consultar_requisitos sobre o catalogo carregado. Nunca lanca:
 * entrada invalida vira um resultado que o modelo le.
 */
export function consultarRequisitos(
  catalogo: CatalogoDoAgente,
  argumentos: unknown,
  opcoes: OpcoesDaConsulta,
): ResultadoDaConsulta {
  const lido = entradaDaConsultaDeRequisitosSchema.safeParse(argumentos);
  if (!lido.success) {
    return {
      saida: JSON.stringify({ resultado: "entrada_invalida" }),
      passo:
        "Tentou consultar o que o paciente precisa com um pedido incompleto",
      resultado: "entrada_invalida",
    };
  }
  const achado = procedimentoDoCodigo(catalogo, lido.data.procedimento);
  if (achado === null) {
    return {
      saida: JSON.stringify({ resultado: "procedimento_nao_encontrado" }),
      passo:
        "Procurou o que o paciente precisa para um procedimento que não está no Cadastro",
      resultado: "procedimento_nao_encontrado",
    };
  }
  const { procedimento } = achado;
  const doPaciente = `Consultou o que o paciente precisa para ${procedimento.nome}`;
  if (!achado.noIndice && !achado.procedimento.informaValor) {
    return {
      saida: JSON.stringify({
        resultado: "so_com_a_equipe",
        procedimento: procedimento.nome,
      }),
      passo: `${doPaciente}: só a equipe informa este procedimento`,
      resultado: "so_com_a_equipe",
    };
  }

  const gerais = (convenioId: string | null) => {
    const { gerais: lista, doConvenio } = requisitosDoProcedimento(
      catalogo,
      procedimento.id,
      convenioId,
    );
    return {
      gerais: lista.map(requisitoParaOModelo),
      doConvenio: doConvenio.map(requisitoParaOModelo),
    };
  };
  const dito = lido.data.convenio;

  if (dito !== null && dito !== "" && !opcoes.informarConvenio) {
    return {
      saida: JSON.stringify({
        resultado: "informar_convenio_desligado",
        procedimento: procedimento.nome,
      }),
      passo: `${doPaciente}: informar convênio está desligado`,
      resultado: "informar_convenio_desligado",
    };
  }

  const convenio =
    dito === null || dito === "" ? null : convenioParaAgenda(catalogo, dito);

  // Sem convenio (nao dito) ou no particular: so os gerais; sem convenio,
  // com o aviso de que algum convenio tem item proprio.
  if (convenio === null || convenio.tipo === "particular") {
    const { gerais: lista } = gerais(null);
    const porConvenio =
      convenio === null && temRequisitoPorConvenio(catalogo, procedimento.id);
    const base = {
      procedimento: procedimento.nome,
      ...(convenio === null ? {} : { convenio: "particular" }),
      ...(porConvenio ? { ha_requisitos_por_convenio: true } : {}),
    };
    return lista.length === 0
      ? {
          saida: JSON.stringify({
            resultado: "sem_requisitos_cadastrados",
            ...base,
          }),
          passo: `${doPaciente}: nada cadastrado${porConvenio ? " para todos (há itens de convênio)" : ""}`,
          resultado: "sem_requisitos_cadastrados",
        }
      : {
          saida: JSON.stringify({
            resultado: "requisitos",
            ...base,
            requisitos: lista,
          }),
          passo: `${doPaciente}: ${quantos(lista.length)}`,
          resultado: "requisitos",
        };
  }

  switch (convenio.tipo) {
    case "convenio_nao_informado":
    case "convenio_nao_encontrado": {
      const { gerais: lista } = gerais(null);
      return {
        saida: JSON.stringify({
          resultado: convenio.tipo,
          procedimento: procedimento.nome,
          requisitos: lista,
        }),
        passo:
          convenio.tipo === "convenio_nao_encontrado"
            ? `${doPaciente}: nenhum convênio parecido no Cadastro`
            : `${doPaciente}: a consulta não trouxe um nome de convênio que dê para identificar`,
        resultado: convenio.tipo,
      };
    }
    case "convenio_nao_confirmado": {
      const { gerais: lista } = gerais(null);
      return {
        saida: JSON.stringify({
          resultado: "convenio_nao_confirmado",
          procedimento: procedimento.nome,
          requisitos: lista,
          opcoes: convenio.opcoes,
          mais_opcoes: convenio.maisOpcoes,
        }),
        passo: `${doPaciente}: não deu para confirmar qual convênio; parecidos no Cadastro: ${convenio.nomes.join(", ")}${convenio.maisOpcoes ? " e outros" : ""}`,
        resultado: "convenio_nao_confirmado",
      };
    }
    case "plano_nao_informado": {
      const { gerais: lista } = gerais(null);
      return {
        saida: JSON.stringify({
          resultado: "plano_nao_informado",
          procedimento: procedimento.nome,
          requisitos: lista,
          planos_da_operadora: convenio.opcoes,
        }),
        passo: `${doPaciente}: falta saber qual plano de ${convenio.operadora}`,
        resultado: "plano_nao_informado",
      };
    }
    case "casou":
      break;
  }

  const { gerais: lista, doConvenio } = gerais(convenio.convenio.id);
  const total = lista.length + doConvenio.length;
  const base = { procedimento: procedimento.nome, convenio: convenio.nome };
  return total === 0
    ? {
        saida: JSON.stringify({
          resultado: "sem_requisitos_cadastrados",
          ...base,
        }),
        passo: `${doPaciente} pelo convênio ${convenio.nome}: nada cadastrado`,
        resultado: "sem_requisitos_cadastrados",
      }
    : {
        saida: JSON.stringify({
          resultado: "requisitos",
          ...base,
          requisitos: lista,
          requisitos_do_convenio: doConvenio,
        }),
        passo: `${doPaciente} pelo convênio ${convenio.nome}: ${quantos(total)}`,
        resultado: "requisitos",
      };
}
