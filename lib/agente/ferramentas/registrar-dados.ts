// Ferramenta registrar_dados_do_paciente do agente de IA (AG3, 27/10/2026):
// os dados que o paciente informa para marcar (D-6 a D-8). PURO: a
// definicao, a entrada, as regras de cada dado (o espelho das conferencias de
// registrar_dados_da_marcacao, migration 20261027120000) e a extracao do CPF
// e da carteirinha do texto ORIGINAL do paciente. Quem chama a RPC e
// lib/agente/agenda.ts; quem monta a saida para o modelo e
// lib/agente/ferramentas/agenda-do-turno.ts.
//
// De onde vem cada dado:
//  - o nome completo e a data de nascimento vem do modelo, validados aqui
//    (Zod e as regras do banco) e CONFERIDOS no que o paciente escreveu:
//    o nome tem de estar, letra por letra (sem diferenciar maiusculas,
//    acentos e espacos), numa mensagem do paciente que o modelo leu, e a
//    data, escrita em alguma mensagem do paciente (dd/mm/aaaa, dd/mm/aa,
//    "12 de marco de 1985"...). O modelo nunca inventa nem completa um dado.
//    O nome do contato no historico do WhatsApp chega ao modelo trocado pela
//    marca ("Fulano", lib/agente/historico.ts): o nome que o modelo copia
//    com a marca e trocado pelo trecho ORIGINAL da mesma mensagem (o
//    servidor tem os dois textos), nunca registrado com a marca;
//  - o CPF e o numero da carteirinha o SERVIDOR acha no texto ORIGINAL das
//    mensagens novas do paciente: o modelo so viu [cpf] e [numero] (a
//    minimizacao, lib/domain/conformidade/minimizar.ts) e diz, em
//    campos_mascarados, quais acha que o paciente mandou. O CPF passa pelo
//    digito verificador aqui e de novo no banco;
//  - a carteirinha CURTA (menos de 8 digitos) a minimizacao deixa passar:
//    com a carteirinha em jogo (pedida, informada ou citada na conversa), o
//    turno esconde tambem esses codigos (esconderCodigosCurtos, em
//    lib/agente/laco.ts) de todo modelo (agente, classificador e
//    verificador), e o servidor procura a carteirinha entre eles do mesmo
//    jeito (codigosCurtos).
// Nada daqui volta ao modelo nem vai para log: a saida diz so QUAIS campos
// ficaram registrados, quais faltam e qual teve problema, nunca o valor.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import {
  minimizarParaLlm,
  trechosMinimizados,
} from "@/lib/domain/conformidade/minimizar";

import type { DadoDaMarcacao } from "../atendimento";
import { MARCA_DO_NOME } from "../marca-do-nome";

export const NOME_DO_REGISTRO_DE_DADOS = "registrar_dados_do_paciente";

/** Os dados que o modelo so ve mascarados ([cpf] e [numero]). */
export const CAMPOS_MASCARADOS = ["cpf", "carteirinha"] as const;
export type CampoMascarado = (typeof CAMPOS_MASCARADOS)[number];

const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Entrada validada no servidor (o modelo nunca e confiavel). */
export const entradaDoRegistroDeDadosSchema = z
  .object({
    nome_completo: z.string().trim().min(1).max(160).nullable(),
    data_nascimento: z.string().trim().regex(DIA_ISO).nullable(),
    para_o_titular: z.boolean(),
    campos_mascarados: z.array(z.enum(CAMPOS_MASCARADOS)).max(2),
  })
  .strict();

export type EntradaDoRegistroDeDados = z.infer<
  typeof entradaDoRegistroDeDadosSchema
>;

/**
 * Definicao para a Responses API (strict: todas as propriedades exigidas,
 * nenhuma a mais). Um teste confere que as chaves batem com o Zod.
 */
export const FERRAMENTA_REGISTRAR_DADOS: FunctionTool = {
  type: "function",
  name: NOME_DO_REGISTRO_DE_DADOS,
  strict: true,
  description:
    "Registra os dados que a pessoa informou para marcar a consulta. O nome completo e a data de nascimento vão exatamente como ela escreveu; o CPF e o número da carteirinha o sistema lê da mensagem dela (você só diz em campos_mascarados se ela mandou). Devolve quais dados ficaram registrados e quais ainda faltam, nunca o valor.",
  parameters: {
    type: "object",
    properties: {
      nome_completo: {
        type: ["string", "null"],
        description:
          "O nome completo exatamente como a pessoa escreveu numa mensagem desta conversa, ou null se ela não mandou. Se o nome tiver a palavra Fulano (a máscara do nome do contato), copie com ela: o sistema troca pelo nome de verdade.",
      },
      data_nascimento: {
        type: ["string", "null"],
        description:
          "A data de nascimento que a pessoa escreveu, no formato aaaa-mm-dd, ou null se ela não mandou.",
      },
      para_o_titular: {
        type: "boolean",
        description:
          "true se a consulta é para a própria pessoa que está conversando; false se é para outra pessoa (filho, mãe, amigo).",
      },
      campos_mascarados: {
        type: "array",
        items: { type: "string", enum: [...CAMPOS_MASCARADOS] },
        description:
          'Quais destes a pessoa mandou nas mensagens novas: "cpf" e "carteirinha" (você vê [cpf] ou [numero] no lugar do número). Vazio se nenhum.',
      },
    },
    required: [
      "nome_completo",
      "data_nascimento",
      "para_o_titular",
      "campos_mascarados",
    ],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// As regras de cada dado (o espelho de registrar_dados_da_marcacao)
// ---------------------------------------------------------------------------

/** Os brancos que o banco junta (v_brancos) e o .trim() do JavaScript. */
const BRANCOS = new RegExp(
  "[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+",
  "g",
);

function juntarBrancos(texto: string): string {
  return texto.replace(BRANCOS, " ").trim();
}

/** Simbolos e digitos que o nome nunca tem (a regra do banco). */
const NAO_E_NOME = /[0-9@#$%&*_=+<>{}|/:;"!?()[\]\\]/;

/**
 * O nome completo pelas regras do banco: brancos juntados e aparado, de 2 a
 * 120 caracteres, pelo menos duas palavras e sem digito nem simbolo.
 */
export function nomeCompletoValido(nome: string): string | null {
  const limpo = juntarBrancos(nome);
  const tamanho = Array.from(limpo).length;
  if (
    tamanho < 2 ||
    tamanho > 120 ||
    !/[^ ] +[^ ]/.test(limpo) ||
    NAO_E_NOME.test(limpo)
  ) {
    return null;
  }
  return limpo;
}

/** aaaa-mm-dd que existe no calendario, ou null. */
export function diaQueExiste(texto: string): string | null {
  if (!DIA_ISO.test(texto)) {
    return null;
  }
  const [ano, mes, dia] = texto.split("-").map(Number);
  const data = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1));
  return data.getUTCFullYear() === ano &&
    data.getUTCMonth() + 1 === mes &&
    data.getUTCDate() === dia
    ? texto
    : null;
}

/** O nascimento pelas regras do banco: de 1900 ate hoje (no fuso da clinica). */
export function nascimentoValido(dia: string, hoje: string): boolean {
  return diaQueExiste(dia) !== null && dia >= "1900-01-01" && dia <= hoje;
}

/** CPF: 11 digitos, nao todos iguais, com os dois verificadores (modulo 11). */
export function cpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) {
    return false;
  }
  const verificador = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) {
      soma += Number(digitos[i]) * (ate + 1 - i);
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return (
    verificador(9) === Number(digitos[9]) &&
    verificador(10) === Number(digitos[10])
  );
}

/**
 * A carteirinha pelas regras do banco: brancos juntados e aparada, ate 60,
 * so letras sem acento, digitos, espaco, ponto, hifen e barra, e pelo menos
 * 4 digitos.
 */
export function carteirinhaValida(texto: string): string | null {
  const limpo = juntarBrancos(texto);
  const tamanho = Array.from(limpo).length;
  if (
    tamanho < 1 ||
    tamanho > 60 ||
    !/^[0-9A-Za-z .\-/]+$/.test(limpo) ||
    limpo.replace(/[^0-9]/g, "").length < 4
  ) {
    return null;
  }
  return limpo;
}

/** Idade em anos completos no dia `dia` (aaaa-mm-dd) de quem nasceu em `nascimento`. */
export function idadeNoDia(nascimento: string, dia: string): number | null {
  if (diaQueExiste(nascimento) === null || diaQueExiste(dia) === null) {
    return null;
  }
  const [an, mn, dn] = nascimento.split("-").map(Number);
  const [a, m, d] = dia.split("-").map(Number);
  if ([an, mn, dn, a, m, d].some((n) => n === undefined)) {
    return null;
  }
  let idade = (a as number) - (an as number);
  if ((m as number) < (mn as number) || (m === mn && (d as number) < (dn as number))) {
    idade -= 1;
  }
  return idade;
}

// ---------------------------------------------------------------------------
// O texto do paciente: normalizar sem perder o caminho de volta
// ---------------------------------------------------------------------------

/** Minusculo, sem acento e com os brancos juntados, com o mapa de volta. */
function normalizarComMapa(texto: string): { texto: string; origem: number[] } {
  let normal = "";
  const origem: number[] = [];
  let indice = 0;
  let ultimoBranco = true;
  for (const caractere of texto) {
    const tamanho = caractere.length;
    if (/\s/u.test(caractere)) {
      if (!ultimoBranco) {
        normal += " ";
        origem.push(indice);
        ultimoBranco = true;
      }
      indice += tamanho;
      continue;
    }
    const simples = caractere
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    for (const parte of simples) {
      normal += parte;
      origem.push(indice);
    }
    ultimoBranco = false;
    indice += tamanho;
  }
  return { texto: normal, origem };
}

function normalizar(texto: string): string {
  return normalizarComMapa(texto).texto.trim();
}

/**
 * Onde cada trecho do texto mascarado esta no ORIGINAL. A mascara do nome
 * troca trechos inteiros pela marca e nao mexe no resto: o texto mascarado
 * e P0 + marca + P1 + marca + P2..., e o original e P0 + X1 + P1 + X2 + P2...
 * Devolve, para cada marca, o trecho original (Xi) e as posicoes, ou null
 * quando os dois textos nao se alinham (nada e registrado).
 */
function alinharMascara(
  mascarado: string,
  original: string,
): { pedacos: { mascarado: [number, number]; original: [number, number] }[] } | null {
  const partes = mascarado.split(MARCA_DO_NOME);
  const pedacos: { mascarado: [number, number]; original: [number, number] }[] =
    [];
  let noMascarado = 0;
  let noOriginal = 0;
  for (let i = 0; i < partes.length; i += 1) {
    const parte = partes[i] ?? "";
    if (i === 0) {
      if (!original.startsWith(parte)) {
        return null;
      }
      pedacos.push({
        mascarado: [0, parte.length],
        original: [0, parte.length],
      });
      noMascarado = parte.length;
      noOriginal = parte.length;
      continue;
    }
    // A marca: o trecho original vai ate a proxima parte literal.
    const fimDaMarca = noMascarado + MARCA_DO_NOME.length;
    const ultima = i === partes.length - 1;
    const achou = ultima
      ? original.length - parte.length
      : parte === ""
        ? -1
        : original.indexOf(parte, noOriginal + 1);
    if (achou <= noOriginal || (ultima && !original.endsWith(parte))) {
      return null;
    }
    pedacos.push({
      mascarado: [noMascarado, fimDaMarca],
      original: [noOriginal, achou],
    });
    pedacos.push({
      mascarado: [fimDaMarca, fimDaMarca + parte.length],
      original: [achou, achou + parte.length],
    });
    noMascarado = fimDaMarca + parte.length;
    noOriginal = achou + parte.length;
  }
  return noMascarado === mascarado.length && noOriginal === original.length
    ? { pedacos }
    : null;
}

/** A posicao no original de uma posicao no mascarado (borda de trecho). */
function posicaoNoOriginal(
  pedacos: { mascarado: [number, number]; original: [number, number] }[],
  posicao: number,
  borda: "inicio" | "fim",
): number | null {
  for (const pedaco of pedacos) {
    const [de, ate] = pedaco.mascarado;
    const ehMarca =
      ate - de === MARCA_DO_NOME.length &&
      pedaco.original[1] - pedaco.original[0] !== MARCA_DO_NOME.length;
    if (posicao < de || posicao > ate) {
      continue;
    }
    if (ehMarca) {
      if (posicao === de && borda === "inicio") {
        return pedaco.original[0];
      }
      if (posicao === ate && borda === "fim") {
        return pedaco.original[1];
      }
      if (posicao === de || posicao === ate) {
        continue;
      }
      // No meio da marca: o nome nao comeca nem termina ali.
      return null;
    }
    return pedaco.original[0] + (posicao - de);
  }
  return null;
}

/** Uma mensagem do paciente: o que o modelo leu e o texto como chegou. */
export type MensagemDoPaciente = {
  /** O texto que foi ao modelo (no WhatsApp, com a marca do nome). */
  mascarado: string;
  /** O texto como chegou (sem a marca); igual ao mascarado no simulador. */
  original: string;
};

const PARTICULAS = new Set(["da", "das", "de", "do", "dos", "e"]);

/**
 * O nome so em maiusculas ou so em minusculas vira "Maria da Silva" (as
 * particulas em minusculas); com as duas caixas, fica como a pessoa
 * escreveu.
 */
function caixaDoNome(nome: string): string {
  const temMaiuscula = /\p{Lu}/u.test(nome);
  const temMinuscula = /\p{Ll}/u.test(nome);
  if (temMaiuscula && temMinuscula) {
    return nome;
  }
  return nome
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((palavra, indice) =>
      indice > 0 && PARTICULAS.has(palavra)
        ? palavra
        : palavra
            .split("-")
            .map((p) => p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1))
            .join("-"),
    )
    .join(" ");
}

/**
 * O nome completo como o PACIENTE escreveu: o que o modelo mandou tem de
 * estar numa das mensagens que o modelo leu (sem diferenciar maiusculas,
 * acentos e brancos), inteiro, com as bordas em fim de palavra. Com a marca
 * do nome no trecho, vale o trecho ORIGINAL da mesma mensagem. null: nao
 * achou (o modelo pede de novo).
 */
export function nomeNoTextoDoPaciente(
  nome: string,
  mensagens: readonly MensagemDoPaciente[],
): string | null {
  // "Fulana" (o modelo concordando com o genero) e a mesma marca.
  const marca = normalizar(MARCA_DO_NOME);
  const procurado = normalizar(nome).replace(/(?<!\p{L})fulan[oa](?!\p{L})/gu, marca);
  if (procurado === "") {
    return null;
  }
  for (const mensagem of mensagens) {
    const { texto, origem } = normalizarComMapa(mensagem.mascarado);
    let de = 0;
    for (;;) {
      let achou = texto.indexOf(procurado, de);
      if (achou < 0) {
        break;
      }
      de = achou + 1;
      let fim = achou + procurado.length;
      // O modelo que tirou a marca do comeco ou do fim ("da Silva Souza" no
      // lugar de "Fulano da Silva Souza"): o nome vai com o trecho dela.
      if (texto.slice(Math.max(0, achou - marca.length - 1), achou) === `${marca} `) {
        achou -= marca.length + 1;
      }
      if (texto.slice(fim, fim + marca.length + 1) === ` ${marca}`) {
        fim += marca.length + 1;
      }
      const antes = achou > 0 ? texto[achou - 1] : " ";
      const depois = fim < texto.length ? texto[fim] : " ";
      if (/[\p{L}\p{N}]/u.test(antes ?? "") || /[\p{L}\p{N}]/u.test(depois ?? "")) {
        continue;
      }
      const inicioNoMascarado = origem[achou] ?? 0;
      const ultimo = origem[fim - 1] ?? inicioNoMascarado;
      const fimNoMascarado =
        ultimo + ((mensagem.mascarado.codePointAt(ultimo) ?? 0) > 0xffff ? 2 : 1);
      const trecho = mensagem.mascarado.slice(inicioNoMascarado, fimNoMascarado);
      if (!trecho.includes(MARCA_DO_NOME)) {
        return caixaDoNome(juntarBrancos(trecho));
      }
      const alinhado = alinharMascara(mensagem.mascarado, mensagem.original);
      if (alinhado === null) {
        return null;
      }
      const inicio = posicaoNoOriginal(alinhado.pedacos, inicioNoMascarado, "inicio");
      const final = posicaoNoOriginal(alinhado.pedacos, fimNoMascarado, "fim");
      if (inicio === null || final === null || final <= inicio) {
        return null;
      }
      return caixaDoNome(juntarBrancos(mensagem.original.slice(inicio, final)));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// A data de nascimento escrita pelo paciente
// ---------------------------------------------------------------------------

const MESES: Readonly<Record<string, number>> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/** As datas com ano que o texto traz, como {dia, mes, ano (2 ou 4 digitos)}. */
function datasDoTexto(
  texto: string,
): { dia: number; mes: number; ano: number; digitosDoAno: number }[] {
  const base = normalizar(texto);
  const datas: { dia: number; mes: number; ano: number; digitosDoAno: number }[] =
    [];
  for (const m of base.matchAll(
    /(?<!\d)(\d{1,2})\s?[/.-]\s?(\d{1,2})\s?[/.-]\s?(\d{4}|\d{2})(?!\d)/g,
  )) {
    datas.push({
      dia: Number(m[1]),
      mes: Number(m[2]),
      ano: Number(m[3]),
      digitosDoAno: (m[3] ?? "").length,
    });
  }
  for (const m of base.matchAll(
    /(?<!\d)(\d{1,2})o?\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?(\d{4}|\d{2})(?!\d)/g,
  )) {
    datas.push({
      dia: Number(m[1]),
      mes: MESES[m[2] ?? ""] ?? 0,
      ano: Number(m[3]),
      digitosDoAno: (m[3] ?? "").length,
    });
  }
  for (const m of base.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    datas.push({
      dia: Number(m[3]),
      mes: Number(m[2]),
      ano: Number(m[1]),
      digitosDoAno: 4,
    });
  }
  return datas;
}

/**
 * A data (aaaa-mm-dd) esta escrita numa das mensagens do paciente: o mesmo
 * dia, mes e ano (o ano com dois digitos vale para o seculo que da a data
 * mandada).
 */
export function dataNoTextoDoPaciente(
  dia: string,
  mensagens: readonly MensagemDoPaciente[],
): boolean {
  const [ano, mes, d] = dia.split("-").map(Number);
  return mensagens.some((mensagem) =>
    datasDoTexto(mensagem.original).some(
      (lida) =>
        lida.dia === d &&
        lida.mes === mes &&
        (lida.digitosDoAno === 4
          ? lida.ano === ano
          : (ano ?? 0) % 100 === lida.ano),
    ),
  );
}

// ---------------------------------------------------------------------------
// O CPF e a carteirinha, do texto ORIGINAL (o modelo so viu o marcador)
// ---------------------------------------------------------------------------

export type ExtracaoDoCpf =
  | { tipo: "achou"; cpf: string }
  | { tipo: "nao_encontrado" }
  | { tipo: "invalido" }
  | { tipo: "ambiguo" };

export type ExtracaoDaCarteirinha =
  | { tipo: "achou"; carteirinha: string }
  | { tipo: "nao_encontrada" }
  | { tipo: "ambigua" };

/**
 * Os trechos com digitos que a minimizacao esconde, de todas as mensagens,
 * com o tipo do marcador ([cpf], [numero], [telefone] e [cnpj]: a
 * carteirinha de 14 digitos casa como CNPJ).
 */
function trechosNumericos(
  mensagens: readonly MensagemDoPaciente[],
): { tipo: string; texto: string }[] {
  return mensagens.flatMap((mensagem) =>
    trechosMinimizados(mensagem.original).filter(
      (t) =>
        t.tipo === "cpf" ||
        t.tipo === "numero" ||
        t.tipo === "telefone" ||
        t.tipo === "cnpj",
    ),
  );
}

/**
 * O CPF que o paciente mandou: entre os trechos que a minimizacao troca por
 * [cpf], [numero] ou [telefone] (o CPF corrido com o terceiro digito 9 casa
 * como telefone), os que tem 11 digitos e o verificador certo. Um so: ele.
 * Nenhum com 11 digitos: nao encontrado; com 11 digitos e verificador
 * errado: invalido; mais de um diferente: ambiguo.
 */
export function extrairCpf(
  mensagens: readonly MensagemDoPaciente[],
): ExtracaoDoCpf {
  const comOnze = trechosNumericos(mensagens)
    .map((t) => t.texto)
    .filter((t) => /^[0-9 .\-/]+$/.test(t))
    .map((t) => t.replace(/[^0-9]/g, ""))
    .filter((digitos) => digitos.length === 11);
  if (comOnze.length === 0) {
    return { tipo: "nao_encontrado" };
  }
  const validos = [...new Set(comOnze.filter(cpfValido))];
  if (validos.length === 0) {
    return { tipo: "invalido" };
  }
  if (validos.length > 1) {
    return { tipo: "ambiguo" };
  }
  return { tipo: "achou", cpf: validos[0] ?? "" };
}

/** Datas e horas nunca sao carteirinha ("12/03/1985", "14:30", "14h30"). */
const DATA_OU_HORA =
  /^(?:\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{1,2}(?::\d{2}|h\d{0,2}(?:min)?)|\d{4}-\d{2}-\d{2})$/i;

// ---------------------------------------------------------------------------
// A carteirinha curta: o que a minimizacao deixa passar (LGPD)
// ---------------------------------------------------------------------------

/**
 * O codigo que pode ser a carteirinha e que a minimizacao deixa passar (ela
 * so esconde 8 digitos ou mais): letras e digitos, com ponto, hifen ou barra
 * entre eles e espaco so entre digitos ("12345", "AB1234", "12.345-6",
 * "123 456"). A data e a hora vem ANTES na alternancia, com as mesmas
 * expressoes da minimizacao, e ficam ("12/03/1985", "14:30", "14h30").
 */
const CODIGO_CURTO = new RegExp(
  [
    "(?<data>(?<![\\p{N}])\\d{1,2}[/.-]\\d{1,2}(?:[/.-](?:\\d{4}|\\d{2}))?(?![\\p{N}]))",
    "(?<hora>(?<![\\p{N}])\\d{1,2}(?::\\d{2}|h\\d{0,2})(?![\\p{N}]))",
    "(?<codigo>(?<![\\p{L}\\p{N}])[0-9A-Za-z]+(?:[./-][0-9A-Za-z]+|(?<=\\d) \\d[0-9A-Za-z]*)*(?![\\p{L}\\p{N}]))",
  ].join("|"),
  "gu",
);

/** O ano sozinho (1900 a 2099) fica: "nasci em 1985", "12 de marco de 1985". */
const ANO_SOZINHO = /^(?:19|20)\d{2}$/;

/** O marcador do codigo escondido: o mesmo do numero da minimizacao. */
export const MARCADOR_DO_CODIGO = "[numero]";

function ehCodigoCurto(trecho: string): boolean {
  return trecho.replace(/[^0-9]/g, "").length >= 4 && !ANO_SOZINHO.test(trecho);
}

/**
 * Os codigos com 4 digitos ou mais que esconderCodigosCurtos troca (data,
 * hora e o ano sozinho ficam de fora). Use no texto JA minimizado: o que a
 * minimizacao troca nao entra.
 */
export function codigosCurtos(texto: string): string[] {
  const codigos: string[] = [];
  for (const casou of texto.matchAll(CODIGO_CURTO)) {
    const codigo = casou.groups?.codigo;
    if (codigo !== undefined && ehCodigoCurto(codigo)) {
      codigos.push(codigo);
    }
  }
  return codigos;
}

/**
 * O texto com cada codigo de 4 digitos ou mais (que nao e data, hora nem o
 * ano sozinho) trocado por [numero]: o complemento da minimizacao quando a
 * carteirinha esta em jogo (lib/agente/laco.ts). Use DEPOIS de
 * minimizarParaLlm, que troca o resto com o marcador certo ([cpf]...).
 */
export function esconderCodigosCurtos(texto: string): string {
  return texto.replace(CODIGO_CURTO, (trecho: string, ...args: unknown[]) => {
    const grupos = args[args.length - 1] as { codigo?: string } | undefined;
    const codigo = grupos?.codigo;
    return codigo !== undefined && ehCodigoCurto(codigo)
      ? MARCADOR_DO_CODIGO
      : trecho;
  });
}

const FALA_DA_CARTEIRINHA = /\b(?:carteirinha|carteira|cartao|matricula)s?\b/;

/** O texto fala da carteirinha (ou da carteira, do cartao, da matricula). */
export function falaDaCarteirinha(texto: string): boolean {
  return FALA_DA_CARTEIRINHA.test(
    texto.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase(),
  );
}

/**
 * O numero da carteirinha, entre o que o modelo NAO viu: os trechos que a
 * minimizacao esconde ([numero], [cnpj] e [telefone]) e os codigos curtos
 * que o turno esconde com a carteirinha em jogo (codigosCurtos: 4 digitos
 * ou mais, com letras ou nao), no formato do banco. Nunca data nem hora, e
 * nunca o que parece CPF: o trecho no formato do CPF ([cpf]) e, quando a
 * pessoa tambem mandou o CPF (cpfPedido), todo trecho de 11 digitos (o CPF
 * digitado errado nunca vira carteirinha). Uma so: ela. Nenhuma: nao
 * encontrada; mais de uma: ambigua (o modelo pede so o numero de novo; o
 * servidor nunca escolhe uma).
 */
export function extrairCarteirinha(
  mensagens: readonly MensagemDoPaciente[],
  cpfAchado: string | null,
  cpfPedido = cpfAchado !== null,
): ExtracaoDaCarteirinha {
  const escondidos = trechosNumericos(mensagens)
    .filter((t) => {
      const digitos = t.texto.replace(/[^0-9]/g, "");
      return (
        t.tipo !== "cpf" &&
        !DATA_OU_HORA.test(t.texto) &&
        digitos !== cpfAchado &&
        !(cpfPedido && digitos.length === 11)
      );
    })
    .map((t) => carteirinhaValida(t.texto))
    .filter((t): t is string => t !== null);
  const curtos = mensagens
    .flatMap((mensagem) => codigosCurtos(minimizarParaLlm(mensagem.original)))
    .map((c) => carteirinhaValida(c))
    .filter((c): c is string => c !== null);
  const candidatas = [...new Set([...escondidos, ...curtos])];
  if (candidatas.length === 0) {
    return { tipo: "nao_encontrada" };
  }
  if (candidatas.length > 1) {
    return { tipo: "ambigua" };
  }
  return { tipo: "achou", carteirinha: candidatas[0] ?? "" };
}

// ---------------------------------------------------------------------------
// A preparacao do registro (o que vai a RPC) e a resposta dela
// ---------------------------------------------------------------------------

/** O problema de um campo, como vai ao modelo (nunca o valor). */
export type ProblemaDoCampo =
  "nao_encontrado" | "invalido" | "ambiguo";

/** O que vai a registrar_dados_da_marcacao (os valores so no servidor). */
export type DadosParaRegistrar = {
  paraOTitular: boolean;
  nomeCompleto: string | null;
  dataNascimento: string | null;
  cpf: string | null;
  carteirinha: string | null;
};

export type PreparoDoRegistro =
  | { tipo: "entrada_invalida" }
  | { tipo: "outra_pessoa" }
  | {
      tipo: "pronto";
      dados: DadosParaRegistrar;
      /** Os campos que vao registrados. */
      campos: DadoDaMarcacao[];
      /** Os que tiveram problema (nao vao), com o problema. */
      problemas: Partial<Record<DadoDaMarcacao, ProblemaDoCampo>>;
    };

/**
 * Prepara o registro a partir do que o modelo mandou e das mensagens do
 * paciente. Consulta para outra pessoa: so a marca (nenhum dado). Cada dado
 * com problema fica de fora e vai na lista de problemas; o resto vai
 * registrado. Nunca lanca.
 */
export function prepararRegistro(entrada: {
  argumentos: unknown;
  /**
   * As mensagens do paciente que o modelo leu neste turno (o historico):
   * onde o nome e a data tem de estar escritos.
   */
  doPaciente: readonly MensagemDoPaciente[];
  /**
   * As mensagens NOVAS do paciente (as pendentes do turno): onde o servidor
   * procura o CPF e a carteirinha.
   */
  pendentes: readonly MensagemDoPaciente[];
  /** Hoje no fuso da clinica (aaaa-mm-dd). */
  hoje: string;
}): PreparoDoRegistro {
  const lido = entradaDoRegistroDeDadosSchema.safeParse(entrada.argumentos);
  if (!lido.success) {
    return { tipo: "entrada_invalida" };
  }
  const pedido = lido.data;
  if (!pedido.para_o_titular) {
    return { tipo: "outra_pessoa" };
  }
  const problemas: Partial<Record<DadoDaMarcacao, ProblemaDoCampo>> = {};
  const dados: DadosParaRegistrar = {
    paraOTitular: true,
    nomeCompleto: null,
    dataNascimento: null,
    cpf: null,
    carteirinha: null,
  };
  if (pedido.nome_completo !== null) {
    const doPaciente = nomeNoTextoDoPaciente(
      pedido.nome_completo,
      entrada.doPaciente,
    );
    if (doPaciente === null) {
      problemas.nome_completo = "nao_encontrado";
    } else {
      const valido = nomeCompletoValido(doPaciente);
      if (valido === null) {
        problemas.nome_completo = "invalido";
      } else {
        dados.nomeCompleto = valido;
      }
    }
  }
  if (pedido.data_nascimento !== null) {
    const dia = diaQueExiste(pedido.data_nascimento);
    if (dia === null || !nascimentoValido(dia, entrada.hoje)) {
      problemas.data_nascimento = "invalido";
    } else if (!dataNoTextoDoPaciente(dia, entrada.doPaciente)) {
      problemas.data_nascimento = "nao_encontrado";
    } else {
      dados.dataNascimento = dia;
    }
  }
  const campos = new Set(pedido.campos_mascarados);
  if (campos.has("cpf")) {
    const cpf = extrairCpf(entrada.pendentes);
    if (cpf.tipo === "achou") {
      dados.cpf = cpf.cpf;
    } else {
      problemas.cpf =
        cpf.tipo === "nao_encontrado"
          ? "nao_encontrado"
          : cpf.tipo === "invalido"
            ? "invalido"
            : "ambiguo";
    }
  }
  if (campos.has("carteirinha")) {
    const carteirinha = extrairCarteirinha(
      entrada.pendentes,
      dados.cpf,
      campos.has("cpf"),
    );
    if (carteirinha.tipo === "achou") {
      dados.carteirinha = carteirinha.carteirinha;
    } else {
      problemas.carteirinha =
        carteirinha.tipo === "nao_encontrada" ? "nao_encontrado" : "ambiguo";
    }
  }
  const registrados: DadoDaMarcacao[] = [];
  if (dados.nomeCompleto !== null) {
    registrados.push("nome_completo");
  }
  if (dados.dataNascimento !== null) {
    registrados.push("data_nascimento");
  }
  if (dados.cpf !== null) {
    registrados.push("cpf");
  }
  if (dados.carteirinha !== null) {
    registrados.push("carteirinha");
  }
  if (registrados.length === 0 && Object.keys(problemas).length === 0) {
    // Nada mandado: o pedido nao diz o que registrar.
    return { tipo: "entrada_invalida" };
  }
  return { tipo: "pronto", dados, campos: registrados, problemas };
}

/** O codigo de resultado do primeiro problema (para a saida e as falhas). */
export function resultadoDoProblema(
  campo: DadoDaMarcacao,
  problema: ProblemaDoCampo,
): string {
  if (campo === "nome_completo") {
    return problema === "nao_encontrado" ? "nome_nao_encontrado" : "dados_invalidos";
  }
  if (campo === "data_nascimento") {
    return problema === "nao_encontrado" ? "data_nao_encontrada" : "dados_invalidos";
  }
  if (campo === "cpf") {
    return problema === "nao_encontrado"
      ? "cpf_nao_encontrado"
      : problema === "invalido"
        ? "cpf_invalido"
        : "cpf_ambiguo";
  }
  return problema === "nao_encontrado"
    ? "carteirinha_nao_encontrada"
    : "carteirinha_ambigua";
}

/** Os motivos de registrar_dados_da_marcacao (contrato da AG3), lista fechada. */
export const MOTIVOS_DO_REGISTRO = [
  "ia_desligada",
  "dados_invalidos",
  "consulta_para_outra_pessoa",
  "menor_de_idade",
] as const;
export type MotivoDoRegistro = (typeof MOTIVOS_DO_REGISTRO)[number];

export type RespostaDoRegistro =
  | { ok: true; faltam: DadoDaMarcacao[] }
  | {
      ok: false;
      motivo: MotivoDoRegistro;
      /** So em dados_invalidos: os campos (nunca o valor). */
      invalidos?: DadoDaMarcacao[];
    };

const DADOS: readonly string[] = [
  "nome_completo",
  "data_nascimento",
  "cpf",
  "carteirinha",
];

function listaDeDados(valor: unknown): DadoDaMarcacao[] | null {
  return Array.isArray(valor) && valor.every((v) => DADOS.includes(v as string))
    ? [...new Set(valor as DadoDaMarcacao[])]
    : null;
}

/**
 * O jsonb de registrar_dados_da_marcacao, lido sem confiar no formato. null
 * = fora do formato (motivo desconhecido inclusive): quem chama falha
 * fechado, porque nao sabe o que o banco gravou.
 */
export function lerRespostaDoRegistro(dado: unknown): RespostaDoRegistro | null {
  if (typeof dado !== "object" || dado === null || Array.isArray(dado)) {
    return null;
  }
  const r = dado as Record<string, unknown>;
  if (r.ok === true) {
    const faltam = listaDeDados(r.faltam);
    return faltam === null ? null : { ok: true, faltam };
  }
  if (
    r.ok === false &&
    typeof r.motivo === "string" &&
    (MOTIVOS_DO_REGISTRO as readonly string[]).includes(r.motivo)
  ) {
    const motivo = r.motivo as MotivoDoRegistro;
    if (motivo === "dados_invalidos") {
      const invalidos = listaDeDados(r.invalidos);
      return invalidos === null ? null : { ok: false, motivo, invalidos };
    }
    return { ok: false, motivo };
  }
  return null;
}
