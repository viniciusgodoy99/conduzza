// Ferramenta buscar_procedimento do agente de IA (E2): o valor e o convenio
// de um procedimento, lidos do Cadastro (service_link). PURO: o catalogo e
// carregado no servidor (lib/agente/contexto.ts) com o clinic_id explicito e
// chega aqui pronto; nada daqui le o banco nem a rede.
//
// Regras (docs/04, nota da secao 2; lib/domain/pricing.ts):
//  - So entra no indice o procedimento ATIVO com "IA pode agendar" ligado
//    no procedimento E em pelo menos um vinculo ativo (as duas chaves
//    bookable_by_ai), com profissional ativo e, no convenio, convenio ativo.
//  - Os tres estados de preco nunca se confundem: price_cents 0 e "R$ 0,00"
//    (valor de verdade), coberto pelo convenio sem preco e "coberto" (nunca
//    moeda) e preco nulo sem cobertura e "sem valor cadastrado".
//  - Todo valor devolvido ao modelo entra em `precos` (centavos exatos): o
//    filtro de saida so deixa sair o "R$" que veio daqui NESTE turno
//    (precosDoTurno).
//  - O nome do convenio que o paciente disse chega pelo modelo: ele so serve
//    para identificar o convenio no Cadastro e nunca volta para a trilha nem
//    para log (a trilha so cita nomes do Cadastro).
//  - Valor e cobertura so saem quando o que foi dito identifica EXATAMENTE UM
//    convenio do Cadastro inteiro (identificarConvenio, uma regra so): todos
//    os convenios ativos, com e sem vinculo do agente. Qualquer duvida vira
//    opcoes SEM valor, cada uma com o rotulo ("chamar_com") que identifica so
//    ela, para o modelo perguntar ao paciente e consultar de novo com a opcao
//    que ele confirmar. A ferramenta nunca escolhe pelo paciente, e a trilha
//    nunca afirma uma operadora que nao foi identificada.
//  - Convenio identificado sem vinculo do agente neste procedimento e "sem
//    informacao", nunca "nao cobre": o catalogo so traz os vinculos com "IA
//    pode agendar", entao a ferramenta nao sabe. "particular" e "sem
//    convenio" sao o valor particular.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import { normalizarBase } from "@/lib/domain/conformidade/normalizar";
import { formatarCentavos } from "@/lib/utils/moeda";

// ---------------------------------------------------------------------------
// Catalogo que o agente enxerga
// ---------------------------------------------------------------------------

/** Um procedimento do indice: o codigo curto (p1, p2...) vai ao modelo. */
export type ProcedimentoDoIndice = { codigo: string; id: string; nome: string };

export type VinculoDoAgente = {
  procedimentoId: string;
  profissional: string;
  /** null = particular. */
  convenioId: string | null;
  precoCentavos: number | null;
  cobertoPeloConvenio: boolean;
};

export type ConvenioDoAgente = {
  id: string;
  nome: string;
  plano: string | null;
};

export type CatalogoDoAgente = {
  /** Ordenado por nome (e id): a ordem estavel e a do cache do prompt. */
  procedimentos: ProcedimentoDoIndice[];
  vinculos: VinculoDoAgente[];
  /** Os convenios com pelo menos um vinculo do agente. */
  convenios: ConvenioDoAgente[];
  /**
   * Todos os convenios ATIVOS do Cadastro, com e sem vinculo do agente (so
   * nome e plano, nunca preco), por nome: as entradas que a busca compara
   * com o que o paciente disse. Um convenio daqui sem vinculo do agente no
   * procedimento e "sem informacao", nunca "coberto" nem "nao cobre".
   */
  conveniosDoCadastro: ConvenioDoAgente[];
};

export const CATALOGO_VAZIO: CatalogoDoAgente = {
  procedimentos: [],
  vinculos: [],
  convenios: [],
  conveniosDoCadastro: [],
};

/** As linhas cruas do banco, como contexto.ts le (colunas explicitas). */
export type LinhasDoCatalogo = {
  procedimentos: readonly {
    id: string;
    name: string;
    active: boolean;
    bookable_by_ai: boolean;
  }[];
  vinculos: readonly {
    procedure_id: string;
    professional_id: string;
    insurance_id: string | null;
    price_cents: number | null;
    covered_by_insurance: boolean;
    bookable_by_ai: boolean;
    active: boolean;
  }[];
  profissionais: readonly { id: string; name: string; active: boolean }[];
  convenios: readonly {
    id: string;
    name: string;
    plan_name: string | null;
    active: boolean;
  }[];
};

function porNome<T extends { nome: string; id: string }>(a: T, b: T): number {
  return a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id);
}

/**
 * O catalogo do agente a partir das linhas do banco. Procedimento sem
 * vinculo valido nao entra no indice (a IA nao fala do que nao pode
 * informar). Nunca lanca.
 */
export function montarCatalogoDoAgente(
  linhas: LinhasDoCatalogo,
): CatalogoDoAgente {
  const profissionais = new Map(
    linhas.profissionais
      .filter((p) => p.active && p.name.trim() !== "")
      .map((p) => [p.id, p.name.trim()]),
  );
  const convenios = new Map(
    linhas.convenios
      .filter((c) => c.active && c.name.trim() !== "")
      .map((c) => [
        c.id,
        {
          id: c.id,
          nome: c.name.trim(),
          plano: c.plan_name?.trim() ? c.plan_name.trim() : null,
        },
      ]),
  );
  const procedimentosValidos = new Map(
    linhas.procedimentos
      .filter((p) => p.active && p.bookable_by_ai && p.name.trim() !== "")
      .map((p) => [p.id, p.name.trim()]),
  );

  const vinculos: VinculoDoAgente[] = [];
  for (const v of linhas.vinculos) {
    const profissional = profissionais.get(v.professional_id);
    if (
      !v.active ||
      !v.bookable_by_ai ||
      profissional === undefined ||
      !procedimentosValidos.has(v.procedure_id) ||
      (v.insurance_id !== null && !convenios.has(v.insurance_id))
    ) {
      continue;
    }
    vinculos.push({
      procedimentoId: v.procedure_id,
      profissional,
      convenioId: v.insurance_id,
      precoCentavos:
        typeof v.price_cents === "number" &&
        Number.isInteger(v.price_cents) &&
        v.price_cents >= 0
          ? v.price_cents
          : null,
      cobertoPeloConvenio: v.insurance_id !== null && v.covered_by_insurance,
    });
  }

  const comVinculo = new Set(vinculos.map((v) => v.procedimentoId));
  const procedimentos = [...procedimentosValidos.entries()]
    .filter(([id]) => comVinculo.has(id))
    .map(([id, nome]) => ({ id, nome }))
    .sort(porNome)
    .map((p, indice) => ({ codigo: `p${indice + 1}`, id: p.id, nome: p.nome }));

  const usados = new Set(
    vinculos.flatMap((v) => (v.convenioId === null ? [] : [v.convenioId])),
  );
  return {
    procedimentos,
    vinculos: vinculos.sort(
      (a, b) =>
        a.procedimentoId.localeCompare(b.procedimentoId) ||
        a.profissional.localeCompare(b.profissional, "pt-BR"),
    ),
    convenios: [...convenios.values()]
      .filter((c) => usados.has(c.id))
      .sort(porNome),
    conveniosDoCadastro: [...convenios.values()].sort(porNome),
  };
}

/**
 * Os convenios do Cadastro e os do agente juntos, sem repetir (os do agente
 * ja estao no Cadastro; a uniao so protege de um catalogo montado a mao).
 */
function conveniosConhecidos(catalogo: CatalogoDoAgente): ConvenioDoAgente[] {
  const ids = new Set(catalogo.conveniosDoCadastro.map((c) => c.id));
  return [
    ...catalogo.conveniosDoCadastro,
    ...catalogo.convenios.filter((c) => !ids.has(c.id)),
  ];
}

/**
 * Nomes do catalogo que o filtro de saida mascara antes dos padroes
 * (nomesDoCatalogo): procedimentos e convenios, com o plano. Todos os
 * convenios ativos do Cadastro: a busca pode citar qualquer plano da
 * operadora.
 */
export function nomesDoCatalogo(catalogo: CatalogoDoAgente): string[] {
  const nomes = new Set<string>();
  for (const p of catalogo.procedimentos) {
    nomes.add(p.nome);
  }
  for (const c of conveniosConhecidos(catalogo)) {
    nomes.add(c.nome);
    if (c.plano !== null) {
      nomes.add(c.plano);
      nomes.add(`${c.nome} ${c.plano}`);
    }
  }
  return [...nomes];
}

// ---------------------------------------------------------------------------
// A ferramenta
// ---------------------------------------------------------------------------

export const NOME_DA_BUSCA = "buscar_procedimento";

/**
 * Entrada validada no servidor (o modelo nunca e confiavel). O convenio cabe
 * o "chamar_com" mais longo: "Nome (Plano)", com nome e plano do Cadastro
 * (120 cada, Server Action de Cadastros), o espaco e os parenteses.
 */
export const entradaDaBuscaSchema = z
  .object({
    procedimento: z.string().trim().min(1).max(64),
    convenio: z.string().trim().max(256).nullable(),
  })
  .strict();

/**
 * Definicao para a Responses API (strict: todas as propriedades exigidas,
 * nenhuma a mais). Escrita a mao, e nao gerada do zod, para o formato que o
 * modo strict aceita nao depender da versao do conversor; um teste confere
 * que as chaves batem com entradaDaBuscaSchema.
 */
export const FERRAMENTA_BUSCAR_PROCEDIMENTO: FunctionTool = {
  type: "function",
  name: NOME_DA_BUSCA,
  strict: true,
  description:
    "Consulta no Cadastro da clínica o valor de um procedimento, no particular ou num convênio. Use o código do bloco <procedimentos>.",
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
          "Nome do convênio (e do plano, se o paciente disse) como o paciente falou, ou o chamar_com da opção que o paciente confirmou, ou null para o valor particular (sem convênio).",
      },
    },
    required: ["procedimento", "convenio"],
    additionalProperties: false,
  },
};

export type ResultadoDaBusca = {
  /** JSON para o modelo (function_call_output). */
  saida: string;
  /** Centavos de todo valor devolvido (precosDoTurno do filtro). */
  precos: number[];
  /** O passo da trilha, so com nomes do Cadastro. */
  passo: string;
  /** Codigo do resultado, para log e teste (lista fechada). */
  resultado:
    | "entrada_invalida"
    | "procedimento_nao_encontrado"
    | "particular"
    | "convenio"
    | "convenio_sem_informacao"
    | "plano_nao_informado"
    | "convenio_nao_confirmado"
    | "convenio_nao_encontrado"
    | "convenio_nao_informado";
};

function valorEmReais(centavos: number): string {
  // O Intl poe espaco nao separavel depois do "R$": o modelo copiaria o
  // caractere estranho para a mensagem.
  return formatarCentavos(centavos).replace(/\s/g, " ");
}

function nomeDoConvenio(convenio: ConvenioDoAgente): string {
  return convenio.plano === null
    ? convenio.nome
    : `${convenio.nome} (${convenio.plano})`;
}

// ---------------------------------------------------------------------------
// Qual convenio o paciente disse
// ---------------------------------------------------------------------------

/** As palavras inteiras do texto, sem acento e minusculas ("Unimed-Flex" da duas). */
function palavras(texto: string): string[] {
  return normalizarBase(texto)
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra !== "");
}

/** As duas sequencias sao a mesma, palavra por palavra. */
function iguais(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((palavra, i) => palavra === b[i]);
}

/**
 * LIG: palavras de funcao que o paciente (ou o modelo) poe em volta do nome
 * do convenio ("tenho Unimed", "pelo meu plano Unimed", "Unimed, e o
 * Nacional", "sou cliente Amil", "minha carteirinha e da Amil"). Ja sem
 * acento e minusculas (normalizarBase): o "e" acentuado chega aqui como "e".
 * UMA lista, fixa, que nunca depende do Cadastro; sai dos DOIS lados (o que
 * foi dito e o Cadastro) antes de comparar. Nunca entra palavra que pode ser
 * nome de plano (Pro, Top, Flex, Plus, Nacional, Familia, e "nosso", do
 * "Nosso Plano" da Hapvida) nem negacao: "nao" sempre conta, e "nao tenho
 * Unimed" nunca casa a Unimed. "sem" tambem conta ("sem coparticipacao" e
 * plano).
 */
export const PALAVRAS_DE_LIGACAO: ReadonlySet<string> = new Set([
  // artigos, preposicoes, contracoes e conjuncoes
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "ou",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "pelo",
  "pela",
  "pelos",
  "pelas",
  "por",
  "pra",
  "para",
  "com",
  "via",
  // quem tem
  "eu",
  "meu",
  "minha",
  "meus",
  "minhas",
  "sou",
  "somos",
  "tenho",
  "tem",
  "temos",
  "possuo",
  "uso",
  "usa",
  "usamos",
  "ja",
  "sim",
  "isso",
  "aqui",
  "cliente",
  "titular",
  "dependente",
  "beneficiario",
  "beneficiaria",
  "associado",
  "associada",
  // o que se pergunta
  "aceita",
  "aceitam",
  "atende",
  "atendem",
  "cobre",
  "cobrem",
  "voces",
  // o proprio convenio
  "plano",
  "planos",
  "convenio",
  "convenios",
  "saude",
  "operadora",
  "carteirinha",
  "carteira",
  "cartao",
]);

/**
 * Palavras que aparecem no nome de muitas operadoras e nao distinguem uma de
 * outra. So servem para dizer se o nome distingue a entrada (a entrada
 * fragil e a que nao tem nenhuma outra) e para achar parecidos ("Sao
 * Cristovao" nao e parecido com "Sao Francisco Saude"). A negacao e o "sem"
 * tambem nao distinguem.
 */
export const PALAVRAS_QUE_NAO_DISTINGUEM: ReadonlySet<string> = new Set([
  "saude",
  "seguro",
  "seguros",
  "seguradora",
  "assistencia",
  "assistencial",
  "medica",
  "medicas",
  "medico",
  "medicos",
  "hospital",
  "hospitalar",
  "clinica",
  "clinicas",
  "cooperativa",
  "servico",
  "servicos",
  "grupo",
  "sistema",
  "plano",
  "planos",
  "convenio",
  "convenios",
  "operadora",
  "sao",
  "santa",
  "santo",
  "santas",
  "santos",
  "nossa",
  "senhora",
  "dom",
  "dona",
  "nao",
  "sem",
]);

/** Quantas letras (a-z) a palavra tem; os numeros nao contam. */
function letras(palavra: string): number {
  return palavra.replace(/[^a-z]/g, "").length;
}

/** Palavra que distingue um convenio: 3 letras ou mais, fora das listas. */
function distintiva(palavra: string): boolean {
  return (
    !PALAVRAS_DE_LIGACAO.has(palavra) &&
    !PALAVRAS_QUE_NAO_DISTINGUEM.has(palavra) &&
    letras(palavra) >= 3
  );
}

/**
 * Teto do trabalho por consulta nos parecidos e na juncao: so as primeiras
 * MAXIMO_DE_PALAVRAS_DA_FALA palavras do que foi dito contam, e palavra ou
 * juncao com mais de MAXIMO_DE_LETRAS_DA_PALAVRA caracteres nao entra (a
 * palavra longa demais so separa as vizinhas). Nome de convenio de verdade
 * cabe com folga; o teto so corta texto absurdo. O seletor exato, os
 * candidatos e a completude olham o que foi dito inteiro.
 */
const MAXIMO_DE_PALAVRAS_DA_FALA = 40;
const MAXIMO_DE_LETRAS_DA_PALAVRA = 40;

/**
 * A palavra e a juncao de duas ou mais palavras seguidas do trecho, porque a
 * mesma operadora se escreve junta ou separada ("SulAmerica" e "Sul
 * America", "Hap Vida" e "Hapvida", "BradescoSaude" e "Bradesco Saude",
 * "TemSaude" e "Tem Saude", "UnimedMix" e "Unimed Mix"). As de ligacao
 * contam; a palavra tem 3 letras ou mais (e no maximo
 * MAXIMO_DE_LETRAS_DA_PALAVRA caracteres) e, com `soComDistintiva`, a juncao
 * tem pelo menos uma palavra distintiva.
 */
function ehJuncao(
  palavra: string,
  trecho: readonly string[],
  soComDistintiva: boolean,
): boolean {
  if (letras(palavra) < 3 || palavra.length > MAXIMO_DE_LETRAS_DA_PALAVRA) {
    return false;
  }
  for (let inicio = 0; inicio < trecho.length; inicio += 1) {
    let feito = 0;
    let comDistintiva = false;
    for (let i = inicio; i < trecho.length; i += 1) {
      const seguinte = trecho[i] ?? "";
      if (seguinte === "" || !palavra.startsWith(seguinte, feito)) {
        break;
      }
      feito += seguinte.length;
      comDistintiva ||= distintiva(seguinte);
      if (feito === palavra.length) {
        if (i > inicio && (comDistintiva || !soComDistintiva)) {
          return true;
        }
        break;
      }
    }
  }
  return false;
}

/**
 * As palavras de ligacao que os parecidos separam quando vem coladas no nome
 * ("AmilSaude", "PlanoAmil"): as de 4 letras ou mais (as curtas, como "de"
 * e "uma", aparecem dentro de nome demais).
 */
const LIGACAO_QUE_COLA: readonly string[] = [...PALAVRAS_DE_LIGACAO].filter(
  (palavra) => palavra.length >= 4,
);

/**
 * As formas de uma palavra dita nos parecidos: ela mesma e, quando ela
 * comeca ou termina com uma palavra de ligacao de 4 letras ou mais, o resto,
 * se tiver 3 letras ou mais ("amilsaude" tambem conta como "amil";
 * "planoamil" e "convenioamil", como "amil"). Tira uma palavra de ligacao,
 * de um lado so.
 */
function formasDe(palavra: string): string[] {
  const formas = [palavra];
  for (const ligacao of LIGACAO_QUE_COLA) {
    const restos = [
      palavra.startsWith(ligacao) ? palavra.slice(ligacao.length) : "",
      palavra.endsWith(ligacao)
        ? palavra.slice(0, palavra.length - ligacao.length)
        : "",
    ];
    for (const resto of restos) {
      if (letras(resto) >= 3 && !formas.includes(resto)) {
        formas.push(resto);
      }
    }
  }
  return formas;
}

/** O que foi dito como os parecidos e a juncao o veem (falaDe). */
type Fala = {
  /**
   * As formas de cada palavra dita que conta, na ordem do que foi dito (a
   * palavra longa demais fica sem forma e so separa as vizinhas).
   */
  posicoes: readonly (readonly string[])[];
  /** Todas as formas das palavras ditas, sem repetir. */
  formas: ReadonlySet<string>;
  /**
   * O que juncaoDeDitas ja respondeu nesta consulta, por palavra: cada
   * palavra do Cadastro e conferida uma vez so.
   */
  juntas: Map<string, boolean>;
};

/**
 * As primeiras MAXIMO_DE_PALAVRAS_DA_FALA palavras ditas, cada uma com as
 * formas que contam: so ela ou, com `comResto` (so nos parecidos), tambem o
 * resto dela sem a palavra de ligacao colada (formasDe). A palavra com mais
 * de MAXIMO_DE_LETRAS_DA_PALAVRA caracteres fica sem forma: so separa.
 */
function falaDe(cru: readonly string[], comResto: boolean): Fala {
  const posicoes = cru
    .slice(0, MAXIMO_DE_PALAVRAS_DA_FALA)
    .map((palavra) =>
      palavra.length > MAXIMO_DE_LETRAS_DA_PALAVRA
        ? []
        : comResto
          ? formasDe(palavra)
          : [palavra],
    );
  return { posicoes, formas: new Set(posicoes.flat()), juntas: new Map() };
}

/**
 * A palavra (3 letras ou mais, ate MAXIMO_DE_LETRAS_DA_PALAVRA caracteres) e
 * a juncao de duas ou mais palavras ditas seguidas, cada uma numa das formas
 * dela ("Hap Vida" para "hapvida"). Confere posicao a posicao, sem montar as
 * juncoes da fala (elas crescem com o produto das formas de cada palavra):
 * `feitos` sao os pontos da palavra ja escritos por ditas seguidas que
 * acabam na posicao anterior, entao o trabalho e no maximo posicoes x
 * caracteres x formas, qualquer que seja a fala.
 */
function juncaoDeDitas(palavra: string, fala: Fala): boolean {
  const sabida = fala.juntas.get(palavra);
  if (sabida !== undefined) {
    return sabida;
  }
  let junta = false;
  if (letras(palavra) >= 3 && palavra.length <= MAXIMO_DE_LETRAS_DA_PALAVRA) {
    let feitos: number[] = [];
    for (const formas of fala.posicoes) {
      const seguintes = new Set<number>();
      for (const feito of [0, ...feitos]) {
        for (const forma of formas) {
          if (!palavra.startsWith(forma, feito)) {
            continue;
          }
          const ate = feito + forma.length;
          if (ate < palavra.length) {
            seguintes.add(ate);
          } else if (feito > 0) {
            // Acabou a palavra com duas ou mais ditas.
            junta = true;
          }
        }
      }
      if (junta) {
        break;
      }
      feitos = [...seguintes];
    }
  }
  fala.juntas.set(palavra, junta);
  return junta;
}

/** L(x): as palavras sem as de ligacao. */
function semLigacao(cru: readonly string[]): string[] {
  return cru.filter((palavra) => !PALAVRAS_DE_LIGACAO.has(palavra));
}

/**
 * O texto cru: sem acento, minusculo e com os espacos repetidos juntados
 * (normalizarBase). E assim que o seletor exato compara o que veio com o
 * rotulo, e e o "mesmo nome" da operadora. O resto conta, pontuacao
 * inclusive: "Unimed (Pleno+)" nao e "Unimed (Pleno)", e "Unimed, sem
 * plano" nao e o rotulo "Unimed sem plano".
 */
function textoCru(texto: string): string {
  return normalizarBase(texto);
}

/**
 * O rotulo de uma entrada, que o seletor exato reconhece: "Nome (Plano)" ou,
 * sem plano, "Nome sem plano".
 */
function rotuloDe(convenio: ConvenioDoAgente): string {
  return convenio.plano === null
    ? `${convenio.nome} sem plano`
    : nomeDoConvenio(convenio);
}

/** Um convenio do Cadastro pronto para comparar. */
type Entrada = {
  convenio: ConvenioDoAgente;
  /** palavras(nome). */
  nome: string[];
  /** O texto cru do nome: o "mesmo nome" da operadora. */
  nomeCru: string;
  /** palavras(plano); vazio sem plano. */
  plano: string[];
  /** N = L(nome). */
  n: string[];
  /** P = L(plano). */
  p: string[];
  /**
   * N sem palavra distintiva ("Tem Saude", "Meu Plano", "Santa Saude", ou
   * um nome sem letra nem numero): so e candidato pelo texto cru, nunca por
   * L; com plano, nunca por um dito so com palavras de ligacao; e o nome sem
   * palavra nunca e candidato (so o rotulo o identifica).
   */
  fragil: boolean;
  /** W: todas as palavras cruas do nome e do plano (a completude). */
  todas: ReadonlySet<string>;
  /** As palavras cruas do nome e do plano, nessa ordem (a do rotulo). */
  cruas: string[];
  /** As palavras cruas coladas: uma juncao delas so pode estar aqui dentro. */
  coladas: string;
  /**
   * As palavras que distinguem a entrada, para os parecidos: as distintivas
   * de N e P; na fragil, todas as de N e P.
   */
  distingue: ReadonlySet<string>;
  /** So as palavras distintivas de N e P, para ordenar as opcoes. */
  distintivas: ReadonlySet<string>;
  /** O texto cru do rotulo (o seletor exato). */
  rotulo: string;
};

/**
 * Todos os convenios, sem excecao: um nome sem letra nem numero ("++") e
 * fragil, e o seletor exato (o rotulo dele) ainda o identifica.
 */
function entradasDe(convenios: readonly ConvenioDoAgente[]): Entrada[] {
  return convenios.map((convenio) => {
    const nome = palavras(convenio.nome);
    const plano = convenio.plano === null ? [] : palavras(convenio.plano);
    const n = semLigacao(nome);
    const p = semLigacao(plano);
    const fragil = !n.some(distintiva);
    const distintivas = [...n, ...p].filter(distintiva);
    return {
      convenio,
      nome,
      nomeCru: textoCru(convenio.nome),
      plano,
      n,
      p,
      fragil,
      todas: new Set([...nome, ...plano]),
      cruas: [...nome, ...plano],
      coladas: [...nome, ...plano].join(""),
      distingue: new Set(fragil ? [...n, ...p] : distintivas),
      distintivas: new Set(distintivas),
      rotulo: textoCru(rotuloDe(convenio)),
    };
  });
}

/** No maximo isto de parecidos vai ao modelo; o resto vira "mais_opcoes". */
export const MAXIMO_DE_OPCOES = 8;

/**
 * O que o paciente disse, contra o Cadastro inteiro:
 * - casou: exatamente um convenio (so ele pode dar valor ou cobertura);
 * - plano_nao_informado: o que foi dito fecha um convenio, mas outros da
 *   MESMA operadora (o mesmo nome) tambem cabem; os convenios sao esses;
 * - convenio_nao_confirmado: mais de um convenio possivel, ou so parecidos
 *   (ate MAXIMO_DE_OPCOES, e maisOpcoes quando cortou);
 * - convenio_nao_encontrado: nenhum parecido;
 * - convenio_nao_informado: o que foi dito so tem palavras de ligacao e nao
 *   e o nome de uma entrada fragil sem plano ("tenho plano", "convenio", e
 *   tambem "tenho Tem Saude", porque o nome dela so tem palavras de
 *   ligacao; a fragil com plano, nesse caso, so pelo rotulo).
 * Nenhum desses afirma uma operadora que nao foi identificada.
 */
export type IdentificacaoDoConvenio =
  | { tipo: "casou"; convenio: ConvenioDoAgente }
  | {
      tipo: "plano_nao_informado";
      operadora: string;
      convenios: ConvenioDoAgente[];
    }
  | {
      tipo: "convenio_nao_confirmado";
      convenios: ConvenioDoAgente[];
      maisOpcoes: boolean;
    }
  | { tipo: "convenio_nao_encontrado" }
  | { tipo: "convenio_nao_informado" };

function porNomeDoConvenio(a: Entrada, b: Entrada): number {
  return (
    nomeDoConvenio(a.convenio).localeCompare(
      nomeDoConvenio(b.convenio),
      "pt-BR",
    ) || a.convenio.id.localeCompare(b.convenio.id)
  );
}

/**
 * A entrada escrita junta ou separada no que foi dito: uma forma dita e a
 * juncao de palavras seguidas do nome e do plano dela (com uma distintiva,
 * menos na fragil), ou uma palavra que a distingue e a juncao de palavras
 * ditas seguidas (juncaoDeDitas).
 */
function juntaOuSeparada(e: Entrada, fala: Fala): boolean {
  for (const forma of fala.formas) {
    if (e.coladas.includes(forma) && ehJuncao(forma, e.cruas, !e.fragil)) {
      return true;
    }
  }
  for (const palavra of e.distingue) {
    if (juncaoDeDitas(palavra, fala)) {
      return true;
    }
  }
  return false;
}

/**
 * Opcoes para o paciente escolher: mais palavras distintivas em comum com as
 * `ditas` primeiro (a mesma palavra escrita junta ou separada conta uma),
 * depois por nome; ate MAXIMO_DE_OPCOES. A conta e feita uma vez por
 * entrada, nunca a cada comparacao da ordenacao.
 */
function opcoes(
  entradas: readonly Entrada[],
  ditas: ReadonlySet<string>,
  fala: Fala,
): IdentificacaoDoConvenio {
  const comuns = new Map<Entrada, number>();
  for (const e of entradas) {
    let palavrasEmComum = 0;
    for (const palavra of ditas) {
      if (e.distintivas.has(palavra)) {
        palavrasEmComum += 1;
      }
    }
    comuns.set(
      e,
      palavrasEmComum > 0 || !juntaOuSeparada(e, fala) ? palavrasEmComum : 1,
    );
  }
  const ordenadas = [...entradas].sort(
    (a, b) =>
      (comuns.get(b) ?? 0) - (comuns.get(a) ?? 0) || porNomeDoConvenio(a, b),
  );
  return {
    tipo: "convenio_nao_confirmado",
    convenios: ordenadas.slice(0, MAXIMO_DE_OPCOES).map((e) => e.convenio),
    maisOpcoes: ordenadas.length > MAXIMO_DE_OPCOES,
  };
}

/**
 * Todas com o mesmo nome (o mesmo texto cru, sem contar acento, caixa e
 * espacos repetidos): os planos de uma operadora, por nome, e o nome dela.
 */
function planosDaOperadora(
  entradas: readonly Entrada[],
): IdentificacaoDoConvenio | undefined {
  const ordenadas = [...entradas].sort(porNomeDoConvenio);
  const [primeira] = ordenadas;
  return primeira !== undefined &&
    ordenadas.every((e) => e.nomeCru === primeira.nomeCru)
    ? {
        tipo: "plano_nao_informado",
        operadora: primeira.convenio.nome,
        convenios: ordenadas.map((e) => e.convenio),
      }
    : undefined;
}

/**
 * O seletor exato: a entrada cujo rotulo e o texto cru do que veio, quando
 * e so uma (o rotulo duplicado no Cadastro nao identifica ninguem).
 */
function seletorExato(
  entradas: readonly Entrada[],
  dito: string,
): Entrada | undefined {
  const texto = textoCru(dito);
  const achadas = entradas.filter((e) => e.rotulo === texto);
  return achadas.length === 1 ? achadas[0] : undefined;
}

/**
 * A regra, uma so, sem excecao por entrada (L tira as palavras de ligacao):
 *  1. Seletor exato (o caminho do chamar_com): o texto cru do que veio e o
 *     rotulo de exatamente uma entrada ("Unimed (Nacional)", "Unimed sem
 *     plano"): casou.
 *  2. Candidatos completos: L(dito) igual a N+P, P+N ou N da entrada; a
 *     entrada fragil so pelo texto cru (palavras(dito) igual ao nome e ao
 *     plano dela, ou so ao nome quando ela nao tem plano), e nunca a de nome
 *     sem palavra ("++", "--"), nem pelo plano sozinho. L(dito) vazio: so a
 *     fragil SEM plano cujo nome e palavras(dito) e candidata (a fragil com
 *     plano, so pelo rotulo); nenhum candidato: convenio_nao_informado.
 *  3. Completude: C sao as entradas cujas palavras (W, cruas, do nome e do
 *     plano) contem todas as de L(dito) (ou as de palavras(dito), quando
 *     L(dito) e vazio). Casou so com um candidato e C igual a ele. Com
 *     candidato e C maior: da mesma operadora, plano_nao_informado; senao,
 *     opcoes. Sem candidato, C nao vazio: opcoes.
 *  4. C vazio: os parecidos (uma palavra que distingue a entrada foi dita,
 *     ou a entrada esta escrita junta ou separada no que foi dito; na
 *     fragil, qualquer palavra de N ou P distingue). So aqui a palavra dita
 *     colada numa de ligacao de 4 letras ou mais tambem conta pelo resto
 *     (formasDe), e so as primeiras MAXIMO_DE_PALAVRAS_DA_FALA palavras
 *     contam, ate MAXIMO_DE_LETRAS_DA_PALAVRA caracteres (falaDe): opcoes;
 *     nenhum, convenio_nao_encontrado.
 */
function identificar(
  entradas: readonly Entrada[],
  dito: string,
): IdentificacaoDoConvenio {
  const rotulada = seletorExato(entradas, dito);
  if (rotulada !== undefined) {
    return { tipo: "casou", convenio: rotulada.convenio };
  }

  const cru = palavras(dito);
  const alvo = semLigacao(cru);
  const candidatos = entradas.filter((e) =>
    e.fragil
      ? e.nome.length > 0 &&
        (alvo.length > 0 || e.convenio.plano === null) &&
        iguais(cru, [...e.nome, ...e.plano])
      : iguais(alvo, e.n) ||
        iguais(alvo, [...e.n, ...e.p]) ||
        iguais(alvo, [...e.p, ...e.n]),
  );
  if (alvo.length === 0 && candidatos.length === 0) {
    return { tipo: "convenio_nao_informado" };
  }

  const termos = alvo.length > 0 ? alvo : cru;
  const completas = entradas.filter((e) =>
    termos.every((palavra) => e.todas.has(palavra)),
  );
  const [candidato] = candidatos;
  if (candidato !== undefined) {
    if (
      candidatos.length === 1 &&
      completas.length === 1 &&
      completas[0] === candidato
    ) {
      return { tipo: "casou", convenio: candidato.convenio };
    }
    return (
      planosDaOperadora(completas) ??
      opcoes(completas, new Set(alvo), falaDe(cru, false))
    );
  }
  if (completas.length > 0) {
    return opcoes(completas, new Set(alvo), falaDe(cru, false));
  }

  // Os parecidos: a palavra colada numa de ligacao conta tambem pelo resto
  // (nunca cria "casou": este passo so devolve opcoes).
  const fala = falaDe(cru, true);
  const parecidos = entradas.filter(
    (e) =>
      [...e.distingue].some((palavra) => fala.formas.has(palavra)) ||
      juntaOuSeparada(e, fala),
  );
  return parecidos.length > 0
    ? opcoes(parecidos, fala.formas, fala)
    : { tipo: "convenio_nao_encontrado" };
}

/**
 * Identifica o convenio que o paciente disse entre `convenios` (o Cadastro
 * inteiro), por palavras inteiras, sem acento e sem caixa. A regra esta em
 * identificar().
 */
export function identificarConvenio(
  convenios: readonly ConvenioDoAgente[],
  dito: string,
): IdentificacaoDoConvenio {
  return identificar(entradasDe(convenios), dito);
}

/**
 * O modelo as vezes manda a palavra do paciente em vez de null: "particular"
 * e "sem convenio" sao o preco particular, nunca um convenio desconhecido.
 */
const DITOS_DE_PARTICULAR: ReadonlySet<string> = new Set([
  "particular",
  "no particular",
  "pelo particular",
  "valor particular",
  "preco particular",
  "sem convenio",
  "sem plano",
  "sem plano de saude",
  "nenhum",
  "nenhum convenio",
  "nao tenho",
  "nao tenho convenio",
  "nao tenho plano",
  "nao tenho plano de saude",
]);

function ehParticular(dito: string): boolean {
  return DITOS_DE_PARTICULAR.has(palavras(dito).join(" "));
}

/**
 * O texto que, mandado de volta como `convenio`, identifica exatamente este
 * convenio: sempre um rotulo. Com plano, "Nome (Plano)"; sem plano, "Nome"
 * quando a regra sozinha ja o identifica e, senao, "Nome sem plano". So o
 * cadastro duplicado de verdade (o mesmo rotulo, sem contar acento, caixa e
 * espacos repetidos) nao tem texto que o separe: volta como opcao, nunca
 * com valor.
 */
function textoParaChamar(
  entradas: readonly Entrada[],
  convenio: ConvenioDoAgente,
): string {
  if (convenio.plano === null && !ehParticular(convenio.nome)) {
    const r = identificar(entradas, convenio.nome);
    if (r.tipo === "casou" && r.convenio.id === convenio.id) {
      return convenio.nome;
    }
  }
  return rotuloDe(convenio);
}

type Situacao =
  | { situacao: "valor"; valor: string; centavos: number }
  | { situacao: "coberto" }
  | { situacao: "sem_valor_cadastrado" };

function situacaoDoVinculo(v: VinculoDoAgente): Situacao {
  // Mesma ordem de exibirPrecoVinculo (lib/domain/pricing.ts).
  if (v.cobertoPeloConvenio && v.precoCentavos === null) {
    return { situacao: "coberto" };
  }
  if (v.precoCentavos !== null) {
    return {
      situacao: "valor",
      valor: valorEmReais(v.precoCentavos),
      centavos: v.precoCentavos,
    };
  }
  return { situacao: "sem_valor_cadastrado" };
}

function linhaParaOModelo(
  v: VinculoDoAgente,
  s: Situacao,
): Record<string, string> {
  return s.situacao === "valor"
    ? { profissional: v.profissional, situacao: s.situacao, valor: s.valor }
    : { profissional: v.profissional, situacao: s.situacao };
}

/**
 * A situacao de um plano para o procedimento quando o plano ainda nao foi
 * dito (plano_nao_informado). NUNCA o valor: nenhum "R$" sai antes de o
 * plano ser confirmado (o filtro barra o que nao estiver em `precos`).
 *  - sem_informacao: nenhum vinculo do agente deste plano neste
 *    procedimento. Nunca "nao cobre": o catalogo so traz os vinculos com "IA
 *    pode agendar", entao a ferramenta nao sabe;
 *  - coberto, com_valor ou sem_valor_cadastrado: os vinculos deste
 *    procedimento no plano (situacaoDoVinculo), todos iguais;
 *  - depende_do_profissional: os vinculos do plano nao concordam.
 */
type SituacaoDoPlano =
  | "sem_informacao"
  | "coberto"
  | "com_valor"
  | "sem_valor_cadastrado"
  | "depende_do_profissional";

function situacaoDoPlano(
  convenio: ConvenioDoAgente,
  doProcedimento: readonly VinculoDoAgente[],
): SituacaoDoPlano {
  const situacoes = new Set(
    doProcedimento
      .filter((v) => v.convenioId === convenio.id)
      .map((v) => situacaoDoVinculo(v).situacao),
  );
  const [unica] = situacoes;
  if (unica === undefined) {
    return "sem_informacao";
  }
  if (situacoes.size > 1) {
    return "depende_do_profissional";
  }
  return unica === "valor" ? "com_valor" : unica;
}

/**
 * Teto, em bytes, de UMA saida de buscar_procedimento neste catalogo (para
 * a reserva do gasto, lib/agente/gasto.ts). Numa saida, cada vinculo aparece
 * no maximo uma vez e cada convenio do Cadastro no maximo uma vez (aceitos,
 * o casado, os planos ou as opcoes, sem repetir), com o nome, a situacao e o
 * chamar_com (o rotulo, "Nome (Plano)" ou "Nome sem plano", ou o nome, que e
 * mais curto). Cada texto conta como fica no JSON (aspas e escape).
 */
export function limiteDaSaidaDaBusca(catalogo: CatalogoDoAgente): number {
  const noJson = (texto: string) =>
    Buffer.byteLength(JSON.stringify(texto), "utf8");
  const maiorProcedimento = catalogo.procedimentos.reduce(
    (maior, p) => Math.max(maior, noJson(p.nome)),
    0,
  );
  const vinculos = catalogo.vinculos.reduce(
    (soma, v) => soma + noJson(v.profissional) + 96,
    0,
  );
  const convenios = conveniosConhecidos(catalogo).reduce(
    (soma, c) => soma + noJson(nomeDoConvenio(c)) + noJson(rotuloDe(c)) + 128,
    0,
  );
  return 512 + maiorProcedimento + vinculos + convenios;
}

/**
 * Executa buscar_procedimento sobre o catalogo carregado. Nunca lanca:
 * entrada invalida vira um resultado que o modelo le ("entrada_invalida").
 */
export function buscarProcedimento(
  catalogo: CatalogoDoAgente,
  argumentos: unknown,
): ResultadoDaBusca {
  const lido = entradaDaBuscaSchema.safeParse(argumentos);
  if (!lido.success) {
    return {
      saida: JSON.stringify({ resultado: "entrada_invalida" }),
      precos: [],
      passo: "Tentou consultar um valor com um pedido incompleto",
      resultado: "entrada_invalida",
    };
  }
  const codigo = lido.data.procedimento.toLowerCase();
  const procedimento = catalogo.procedimentos.find((p) => p.codigo === codigo);
  if (procedimento === undefined) {
    return {
      saida: JSON.stringify({ resultado: "procedimento_nao_encontrado" }),
      precos: [],
      passo:
        "Procurou um procedimento que não está entre os que o assistente informa",
      resultado: "procedimento_nao_encontrado",
    };
  }

  const doProcedimento = catalogo.vinculos.filter(
    (v) => v.procedimentoId === procedimento.id,
  );
  const precos: number[] = [];
  const anotar = (s: Situacao) => {
    if (s.situacao === "valor") {
      precos.push(s.centavos);
    }
    return s;
  };

  // O Cadastro inteiro, com e sem vinculo do agente: o valor e a cobertura
  // vem DEPOIS, dos vinculos do agente do convenio identificado.
  const entradas = entradasDe(conveniosConhecidos(catalogo));
  const dito = lido.data.convenio;
  // O rotulo de um convenio vale antes das palavras do particular: "++ sem
  // plano" e o convenio "++", nunca o "sem plano" do particular.
  if (
    dito === null ||
    dito === "" ||
    (seletorExato(entradas, dito) === undefined && ehParticular(dito))
  ) {
    const particulares = doProcedimento.filter((v) => v.convenioId === null);
    const aceitos = catalogo.convenios
      .filter((c) => doProcedimento.some((v) => v.convenioId === c.id))
      .map(nomeDoConvenio);
    return {
      saida: JSON.stringify({
        resultado: "particular",
        procedimento: procedimento.nome,
        atende_particular: particulares.length > 0,
        particular: particulares.map((v) =>
          linhaParaOModelo(v, anotar(situacaoDoVinculo(v))),
        ),
        convenios_aceitos: aceitos,
      }),
      precos,
      passo: `Consultou o preço de ${procedimento.nome}`,
      resultado: "particular",
    };
  }

  const identificacao = identificar(entradas, dito);
  const doPaciente = `Consultou o convênio do paciente para ${procedimento.nome}`;
  const opcao = (c: ConvenioDoAgente) => ({
    convenio: nomeDoConvenio(c),
    chamar_com: textoParaChamar(entradas, c),
  });

  switch (identificacao.tipo) {
    case "convenio_nao_informado":
      return {
        saida: JSON.stringify({
          resultado: "convenio_nao_informado",
          procedimento: procedimento.nome,
        }),
        precos: [],
        passo: `${doPaciente}: a consulta não trouxe um nome de convênio que dê para identificar`,
        resultado: "convenio_nao_informado",
      };
    case "convenio_nao_encontrado":
      return {
        saida: JSON.stringify({
          resultado: "convenio_nao_encontrado",
          procedimento: procedimento.nome,
        }),
        precos: [],
        passo: `${doPaciente}: nenhum convênio parecido no Cadastro`,
        resultado: "convenio_nao_encontrado",
      };
    case "convenio_nao_confirmado": {
      // Mais de um possivel ou so parecidos: as opcoes, sem valor nem
      // cobertura, para o modelo perguntar qual e. A trilha cita so os
      // nomes do Cadastro, nunca o que o paciente disse.
      const nomes = [
        ...new Set(identificacao.convenios.map(nomeDoConvenio)),
      ].join(", ");
      return {
        saida: JSON.stringify({
          resultado: "convenio_nao_confirmado",
          procedimento: procedimento.nome,
          opcoes: identificacao.convenios.map(opcao),
          mais_opcoes: identificacao.maisOpcoes,
        }),
        precos: [],
        passo: `${doPaciente}: não deu para confirmar qual convênio; parecidos no Cadastro: ${nomes}${identificacao.maisOpcoes ? " e outros" : ""}`,
        resultado: "convenio_nao_confirmado",
      };
    }
    case "plano_nao_informado":
      // A operadora foi identificada (todas as possiveis tem o mesmo nome),
      // o plano nao: a situacao de cada plano para este procedimento, para o
      // modelo perguntar o plano. Nunca um "coberto" pela operadora inteira
      // e nunca valor (nem na saida nem em `precos`): o "R$" so sai depois do
      // plano confirmado.
      return {
        saida: JSON.stringify({
          resultado: "plano_nao_informado",
          procedimento: procedimento.nome,
          planos_da_operadora: identificacao.convenios.map((c) => ({
            ...opcao(c),
            situacao: situacaoDoPlano(c, doProcedimento),
          })),
        }),
        precos: [],
        passo: `${doPaciente}: falta saber qual plano de ${identificacao.operadora}`,
        resultado: "plano_nao_informado",
      };
    case "casou":
      break;
  }

  const casado = identificacao.convenio;
  const doConvenio = doProcedimento.filter((v) => v.convenioId === casado.id);
  if (doConvenio.length === 0) {
    // Identificado, mas sem vinculo do agente neste procedimento: o
    // catalogo so traz os vinculos com "IA pode agendar", entao a
    // ferramenta nao sabe se cobre. Nunca "nao cobre".
    return {
      saida: JSON.stringify({
        resultado: "convenio_sem_informacao",
        procedimento: procedimento.nome,
        convenio: nomeDoConvenio(casado),
      }),
      precos: [],
      passo: `Consultou o convênio ${nomeDoConvenio(casado)} para ${procedimento.nome}: sem informação sobre este procedimento`,
      resultado: "convenio_sem_informacao",
    };
  }
  return {
    saida: JSON.stringify({
      resultado: "convenio",
      procedimento: procedimento.nome,
      convenio: nomeDoConvenio(casado),
      atendimentos: doConvenio.map((v) =>
        linhaParaOModelo(v, anotar(situacaoDoVinculo(v))),
      ),
    }),
    precos,
    passo: `Consultou o preço de ${procedimento.nome} pelo convênio ${nomeDoConvenio(casado)}`,
    resultado: "convenio",
  };
}
