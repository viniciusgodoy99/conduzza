// Ferramenta buscar_profissionais do agente de IA (AG2, 27/10/2026): os
// profissionais ativos da clinica, com o codigo do indice (r1, r2...), as
// especialidades, se o assistente marca com cada um, as unidades onde atende
// (pela jornada) e a idade atendida. Nunca preco. PURO: le o catalogo
// carregado no servidor; nada de paciente.
//
// Filtros, todos opcionais (nulo = sem filtro), juntos:
//  - especialidade: a do Cadastro, igual sem contar acento e caixa (como no
//    bloco <profissionais>). Sem nenhuma igual: "especialidade_nao_encontrada"
//    com as especialidades cadastradas, para o modelo consultar de novo
//    (nunca escolhe pela pessoa e nunca le sintoma: isso e triagem).
//  - procedimento (codigo do bloco <procedimentos>, do indice ou so com a
//    equipe): quem tem vinculo ATIVO nele (a matriz de vinculos).
//  - convenio, pela MESMA regra de buscar_procedimento (exatamente um do
//    Cadastro; duvida volta como opcoes): com o procedimento, o vinculo ativo
//    do procedimento nesse convenio; sem ele, o convenio do profissional
//    (professional_insurance) ou um vinculo ativo nele. "particular" e o
//    vinculo particular. Com "Informar preço e convênio" desligada, nenhum
//    convenio e identificado: "informar_convenio_desligado".
//  - unidade (codigo que consultar_unidades trouxe): quem tem jornada nela
//    (a faixa sem unidade vale para todas).
// marca_pela_ia: com a agenda ligada, o profissional tem vinculo do agente
// ("IA pode agendar") que cabe nos filtros de procedimento e convenio.
// Fatos do turno: com o convenio identificado e alguem na lista, ele
// "atende" (o profissional atende por ele); lista vazia nunca vira "nao
// atende".

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import type { FatosDaFerramenta } from "@/lib/domain/conformidade/fatos-do-turno";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";

import {
  coberturaDoConvenio,
  convenioParaAgenda,
  indiceDosProfissionais,
  procedimentoDoCodigo,
  type CatalogoDoAgente,
  type ConvenioDoAgente,
  type ProfissionalDoCatalogo,
} from "./buscar-procedimento";
import {
  idadeAtendidaEmTexto,
  profissionaisDaUnidade,
  unidadesDoProfissional,
} from "./cadastro-do-agente";
import type {
  OpcoesDaConsulta,
  ResultadoDaConsulta,
} from "./consultas-do-cadastro";

export const NOME_DA_BUSCA_DE_PROFISSIONAIS = "buscar_profissionais";

/** No maximo isto de especialidades na resposta "nao encontrada". */
export const MAXIMO_DE_ESPECIALIDADES_LISTADAS = 40;

/** Entrada validada no servidor (o modelo nunca e confiavel). */
export const entradaDaBuscaDeProfissionaisSchema = z
  .object({
    especialidade: z.string().trim().max(120).nullable(),
    procedimento: z.string().trim().max(64).nullable(),
    convenio: z.string().trim().max(256).nullable(),
    unidade: z.string().trim().max(16).nullable(),
  })
  .strict();

/** Definicao para a Responses API (strict, escrita a mao). */
export const FERRAMENTA_BUSCAR_PROFISSIONAIS: FunctionTool = {
  type: "function",
  name: NOME_DA_BUSCA_DE_PROFISSIONAIS,
  strict: true,
  description:
    "Consulta no Cadastro os profissionais da clínica, com as especialidades, se o assistente marca com cada um, as unidades onde atendem e a idade atendida. Os filtros são opcionais e valem juntos. Nunca traz valor.",
  parameters: {
    type: "object",
    properties: {
      especialidade: {
        type: ["string", "null"],
        description:
          "Especialidade como aparece no bloco <profissionais>, ou null. Nunca deduzida de sintoma.",
      },
      procedimento: {
        type: ["string", "null"],
        description:
          "Código do procedimento no bloco <procedimentos>, por exemplo p3, ou null.",
      },
      convenio: {
        type: ["string", "null"],
        description:
          "Nome do convênio (e do plano, se o paciente disse) como o paciente falou, ou o chamar_com da opção que o paciente confirmou, ou null para não filtrar por convênio.",
      },
      unidade: {
        type: ["string", "null"],
        description:
          "Código de uma unidade que consultar_unidades trouxe nesta resposta, por exemplo u1, ou null.",
      },
    },
    required: ["especialidade", "procedimento", "convenio", "unidade"],
    additionalProperties: false,
  },
};

/** O convenio do filtro: nenhum, o particular ou um do Cadastro. */
type FiltroDoConvenio =
  | { tipo: "nenhum" }
  | { tipo: "particular" }
  | { tipo: "convenio"; convenio: ConvenioDoAgente; nome: string };

/**
 * Executa buscar_profissionais sobre o catalogo carregado. Nunca lanca:
 * entrada invalida vira um resultado que o modelo le.
 */
export function buscarProfissionais(
  catalogo: CatalogoDoAgente,
  argumentos: unknown,
  opcoes: OpcoesDaConsulta,
): ResultadoDaConsulta {
  const lido = entradaDaBuscaDeProfissionaisSchema.safeParse(argumentos);
  if (!lido.success) {
    return {
      saida: JSON.stringify({ resultado: "entrada_invalida" }),
      passo: "Tentou consultar os profissionais com um pedido incompleto",
      resultado: "entrada_invalida",
    };
  }
  const pedido = lido.data;
  const filtros: string[] = [];
  let candidatos: ProfissionalDoCatalogo[] = [
    ...(catalogo.profissionais ?? []),
  ];

  // Especialidade: igual a uma do Cadastro, sem contar acento e caixa.
  const especialidadePedida = (pedido.especialidade ?? "").trim();
  if (especialidadePedida !== "") {
    const alvo = normalizarBase(especialidadePedida);
    const comEla = candidatos.filter((p) =>
      p.especialidades.some((e) => normalizarBase(e) === alvo),
    );
    if (comEla.length === 0) {
      const cadastradas = [
        ...new Map(
          candidatos
            .flatMap((p) => p.especialidades)
            .map((e) => [normalizarBase(e), e] as const),
        ).values(),
      ]
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .slice(0, MAXIMO_DE_ESPECIALIDADES_LISTADAS);
      return {
        saida: JSON.stringify({
          resultado: "especialidade_nao_encontrada",
          especialidades_cadastradas: cadastradas,
        }),
        // Nunca o que o modelo mandou (pode ser texto do paciente).
        passo:
          "Consultou os profissionais por uma especialidade que não está no Cadastro",
        resultado: "especialidade_nao_encontrada",
      };
    }
    candidatos = comEla;
    const doCadastro = comEla
      .flatMap((p) => p.especialidades)
      .find((e) => normalizarBase(e) === alvo);
    filtros.push(doCadastro ?? especialidadePedida);
  }

  // Procedimento: o codigo do bloco (no indice ou so com a equipe).
  const codigoDoProcedimento = (pedido.procedimento ?? "").trim();
  let procedimento: { id: string; nome: string } | null = null;
  if (codigoDoProcedimento !== "") {
    const achado = procedimentoDoCodigo(catalogo, codigoDoProcedimento);
    if (achado === null) {
      return {
        saida: JSON.stringify({ resultado: "procedimento_nao_encontrado" }),
        passo:
          "Consultou os profissionais de um procedimento que não está no Cadastro",
        resultado: "procedimento_nao_encontrado",
      };
    }
    // Revisao 2 da AG2: o procedimento fora do indice que nao deixa informar
    // (ia_pode_informar desligado) nao aceita o filtro de convenio nem gera
    // fato de convenio, como buscar_procedimento e consultar_requisitos: so
    // a equipe fala dele por convenio.
    const dito = (pedido.convenio ?? "").trim();
    if (!achado.noIndice && !achado.procedimento.informaValor && dito !== "") {
      return {
        saida: JSON.stringify({
          resultado: "so_com_a_equipe",
          procedimento: achado.procedimento.nome,
        }),
        passo: `Consultou os profissionais de ${achado.procedimento.nome} por convênio: só a equipe informa este procedimento`,
        resultado: "so_com_a_equipe",
      };
    }
    procedimento = achado.procedimento;
    filtros.push(procedimento.nome);
  }

  // Unidade: o codigo que consultar_unidades trouxe.
  const codigoDaUnidade = (pedido.unidade ?? "").trim().toLowerCase();
  let unidade: { id: string; nome: string } | null = null;
  if (codigoDaUnidade !== "") {
    const achada = (catalogo.unidades ?? []).find(
      (u) => u.codigo === codigoDaUnidade,
    );
    if (achada === undefined) {
      return {
        saida: JSON.stringify({ resultado: "unidade_nao_encontrada" }),
        passo:
          "Consultou os profissionais de uma unidade que não está no Cadastro",
        resultado: "unidade_nao_encontrada",
      };
    }
    unidade = achada;
    filtros.push(`unidade ${achada.nome}`);
  }

  // Convenio: a mesma regra de buscar_procedimento.
  let convenio: FiltroDoConvenio = { tipo: "nenhum" };
  const dito = pedido.convenio;
  if (dito !== null && dito.trim() !== "") {
    if (!opcoes.informarConvenio) {
      return {
        saida: JSON.stringify({ resultado: "informar_convenio_desligado" }),
        passo: "Consultou os profissionais: informar convênio está desligado",
        resultado: "informar_convenio_desligado",
      };
    }
    const identificado = convenioParaAgenda(catalogo, dito);
    const doPaciente = "Consultou os profissionais pelo convênio do paciente";
    switch (identificado.tipo) {
      case "convenio_nao_informado":
        return {
          saida: JSON.stringify({ resultado: "convenio_nao_informado" }),
          passo: `${doPaciente}: a consulta não trouxe um nome de convênio que dê para identificar`,
          resultado: "convenio_nao_informado",
        };
      case "convenio_nao_encontrado":
        return {
          saida: JSON.stringify({ resultado: "convenio_nao_encontrado" }),
          passo: `${doPaciente}: nenhum convênio parecido no Cadastro`,
          resultado: "convenio_nao_encontrado",
        };
      case "convenio_nao_confirmado":
        return {
          saida: JSON.stringify({
            resultado: "convenio_nao_confirmado",
            opcoes: identificado.opcoes,
            mais_opcoes: identificado.maisOpcoes,
          }),
          passo: `${doPaciente}: não deu para confirmar qual convênio; parecidos no Cadastro: ${identificado.nomes.join(", ")}${identificado.maisOpcoes ? " e outros" : ""}`,
          resultado: "convenio_nao_confirmado",
        };
      case "plano_nao_informado":
        return {
          saida: JSON.stringify({
            resultado: "plano_nao_informado",
            planos_da_operadora: identificado.opcoes,
          }),
          passo: `${doPaciente}: falta saber qual plano de ${identificado.operadora}`,
          resultado: "plano_nao_informado",
        };
      case "particular":
        convenio = { tipo: "particular" };
        filtros.push("particular");
        break;
      case "casou":
        convenio = {
          tipo: "convenio",
          convenio: identificado.convenio,
          nome: identificado.nome,
        };
        filtros.push(`convênio ${identificado.nome}`);
        break;
    }
  }

  const convenioId =
    convenio.tipo === "convenio"
      ? convenio.convenio.id
      : convenio.tipo === "particular"
        ? null
        : undefined;
  const matriz = catalogo.matriz ?? [];
  const casaNaMatriz = (v: {
    procedimentoId: string;
    profissionalId: string;
    convenioId: string | null;
  }) =>
    (procedimento === null || v.procedimentoId === procedimento.id) &&
    (convenioId === undefined || v.convenioId === convenioId);

  if (procedimento !== null || convenio.tipo !== "nenhum") {
    const pelaMatriz = new Set(
      matriz.filter(casaNaMatriz).map((v) => v.profissionalId),
    );
    // Sem procedimento, o convenio do profissional tambem vale.
    const peloCadastro =
      procedimento === null && convenio.tipo === "convenio"
        ? new Set(
            (catalogo.conveniosDosProfissionais ?? [])
              .filter((c) => c.convenioId === convenioId)
              .map((c) => c.profissionalId),
          )
        : new Set<string>();
    candidatos = candidatos.filter(
      (p) => pelaMatriz.has(p.id) || peloCadastro.has(p.id),
    );
  }
  if (unidade !== null) {
    const naUnidade = profissionaisDaUnidade(catalogo, unidade.id);
    candidatos = candidatos.filter((p) => naUnidade.has(p.id));
  }

  const comFiltros = filtros.length === 0 ? "" : ` (${filtros.join(", ")})`;
  if (candidatos.length === 0) {
    return {
      saida: JSON.stringify({ resultado: "nenhum_profissional" }),
      passo: `Consultou os profissionais${comFiltros}: nenhum no Cadastro`,
      resultado: "nenhum_profissional",
    };
  }

  // O codigo do indice e quem a IA marca (com a agenda ligada).
  const codigos = new Map(
    indiceDosProfissionais(catalogo).map((p) => [p.id, p.codigo]),
  );
  const marcaPelaIa = (profissionalId: string) =>
    opcoes.agendaLigada &&
    catalogo.vinculos.some(
      (v) =>
        v.profissionalId === profissionalId &&
        (procedimento === null || v.procedimentoId === procedimento.id) &&
        (convenioId === undefined || v.convenioId === convenioId),
    );
  const temUnidades = (catalogo.unidades ?? []).length > 0;
  const lista = candidatos.map((p) => {
    const codigo = codigos.get(p.id);
    const unidades = temUnidades
      ? unidadesDoProfissional(catalogo, p.id).map((u) => u.nome)
      : [];
    const idade = idadeAtendidaEmTexto(p.idadeMinima, p.idadeMaxima);
    return {
      ...(codigo === undefined ? {} : { codigo }),
      nome: p.nome,
      ...(p.especialidades.length === 0
        ? {}
        : { especialidades: p.especialidades }),
      marca_pela_ia: marcaPelaIa(p.id),
      ...(unidades.length === 0 ? {} : { unidades }),
      ...(idade === null ? {} : { idade_atendida: idade }),
    };
  });
  // O convenio identificado com alguem na lista: ele atende por ele (no
  // procedimento do filtro; sem ele, o fato nao tem procedimento e nao
  // sustenta frase que cita um).
  const fatos: FatosDaFerramenta | undefined =
    convenio.tipo === "convenio"
      ? {
          coberturas: [
            coberturaDoConvenio(
              convenio.convenio,
              "atende",
              procedimento?.nome ?? null,
            ),
          ],
        }
      : undefined;
  return {
    saida: JSON.stringify({
      resultado: "profissionais",
      ...(convenio.tipo === "convenio" ? { convenio: convenio.nome } : {}),
      profissionais: lista,
    }),
    passo: `Consultou os profissionais${comFiltros}: ${candidatos.map((p) => p.nome).join(", ")}`,
    resultado: "profissionais",
    ...(fatos === undefined ? {} : { fatos }),
  };
}
