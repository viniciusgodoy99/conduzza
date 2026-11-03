// A orientacao de preparo do procedimento aprovada pelo responsavel tecnico
// (RT) da clinica (AG7; D-80, autorizada pelo dono em 03/11/2026). Modulo
// PURO e sem import: o navegador (Cadastros, Configuracoes, o fio do
// Atendimento) e o servidor (o motor, o filtro de conformidade) leem daqui.
//
// O texto aprovado sai como mensagem do SISTEMA, palavra por palavra,
// montada pelo banco a partir da versao aprovada (mensagem_do_preparo, na
// migration 20261103100000): o cabecalho fixo, o texto e o rodape fixo.
// Remedio, dose e jejum sao aceitos DENTRO desse texto, porque sao o
// protocolo que o RT aprovou. A IA nunca escreve, le nem resume o preparo, e
// o filtro na saida continua barrando qualquer preparo que o modelo escreva
// (os padroes de padroes.ts e trechoDePreparoNaResposta, abaixo).
//
// Cada regra aqui espelha o banco:
//  - normalizarTextoDoPreparo: a mesma ordem da copia do texto antigo (CR
//    vira LF, NFC e o trim() do JavaScript, os 25 brancos de
//    cadastro_texto_valido);
//  - textoDoPreparoValido: o CHECK preparo_texto_valido;
//  - mensagemDoPreparo: a funcao mensagem_do_preparo, byte a byte;
//  - CONSELHOS, UFS e SITUACOES_DO_PREPARO: os CHECKs das duas tabelas.
//
// trechoDePreparoNaResposta mora aqui (e nao so em
// lib/domain/conformidade/preparo-aprovado.ts, que a reexporta) porque o
// filtro deterministico a chama: preparo-aprovado.ts importa o filtro, e o
// filtro importando preparo-aprovado.ts fecharia um ciclo de import.

// ---------------------------------------------------------------------------
// Limites e listas (os mesmos dos CHECKs)
// ---------------------------------------------------------------------------

/** O texto aprovado: de 1 a 3.500 caracteres (D-84). */
export const LIMITE_DO_TEXTO_DO_PREPARO = 3500;

/** Os conselhos de classe do RT (D-70, PROPOSTA; CHECK de responsavel_tecnico). */
export const CONSELHOS = [
  "CRM",
  "CRO",
  "CRBM",
  "CRF",
  "COREN",
  "CREFITO",
  "CRN",
  "CRP",
  "CRFa",
  "CREF",
] as const;

export type Conselho = (typeof CONSELHOS)[number];

/** As 27 siglas, na ordem do CHECK (a mesma de unit_uf_valida). */
export const UFS: readonly string[] = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
];

/** As situacoes de uma versao (CHECK preparo_do_procedimento_situacao_valida). */
export const SITUACOES_DO_PREPARO = [
  "aguardando_rt",
  "aprovado",
  "devolvido",
  "descartado",
  "substituido",
  "suspenso",
] as const;

export type SituacaoDoPreparo = (typeof SITUACOES_DO_PREPARO)[number];

export function ehConselho(valor: unknown): valor is Conselho {
  return (
    typeof valor === "string" &&
    (CONSELHOS as readonly string[]).includes(valor)
  );
}

export function ehUf(valor: unknown): valor is string {
  return typeof valor === "string" && UFS.includes(valor);
}

// ---------------------------------------------------------------------------
// Textos fixos (PROPOSTA, D-76 e D-77; sem travessao)
// ---------------------------------------------------------------------------

/** O prefixo da primeira linha da mensagem do preparo. */
export const CABECALHO_DO_PREPARO = "Orientação de preparo para ";

/** O prefixo da segunda linha: o RT, com o conselho, a UF e o numero. */
export const LINHA_DO_RT = "Responsável técnico da clínica: ";

/** A ultima linha da mensagem do preparo. */
export const RODAPE_DO_PREPARO =
  "Se tiver qualquer dúvida sobre o preparo, responda por aqui que a equipe da clínica te ajuda.";

/**
 * A frase fixa F2 (D-76): colada pelo sistema na resposta do turno que
 * marcou um procedimento com texto em vigor. Nunca diz nada do conteudo.
 */
export const FRASE_DO_PREPARO_DEPOIS_DE_MARCAR =
  "Este procedimento tem orientação de preparo aprovada pela clínica. Se quiser recebê-la agora, é só pedir.";

/**
 * O que o modelo le no lugar de um texto de preparo da clinica que esta no
 * historico (a regua mandou o texto dentro do toque de 24 horas).
 */
export const SUBSTITUTO_DO_TEXTO_DO_PREPARO =
  "(o texto da orientação de preparo aprovada pela clínica estava aqui)";

/**
 * O que o modelo le no lugar da mensagem do preparo inteira (a do sistema,
 * reconhecida pelo cabecalho). Sem o nome do procedimento (nunca deveria
 * faltar), a frase fica sem ele.
 */
export function substitutoDaMensagemDoPreparo(procedimento: string): string {
  const nome = procedimento.trim();
  return nome === ""
    ? "Mensagem do sistema: a orientação de preparo, aprovada pela clínica, foi enviada aqui."
    : `Mensagem do sistema: a orientação de preparo de ${nome}, aprovada pela clínica, foi enviada aqui.`;
}

/**
 * Revisao da AG7 (CFM-10): o que o modelo le no lugar de uma fala da clinica
 * NO FORMATO da mensagem do preparo (o cabecalho ou o rodape fixos) que nao e
 * a do sistema: a da equipe, a da IA, a de autoria desconhecida. Nunca diz
 * "aprovada" (ninguem conferiu que o RT aprovou aquele texto) e nunca deixa
 * o texto ir ao modelo.
 */
export function substitutoDaFalaNoFormatoDoPreparo(
  procedimento: string,
): string {
  const nome = procedimento.trim();
  return nome === ""
    ? "Mensagem da clínica: uma orientação de preparo foi enviada aqui."
    : `Mensagem da clínica: uma orientação de preparo de ${nome} foi enviada aqui.`;
}

/**
 * Revisao da AG7 (CFM-1): o que o modelo le no lugar de uma fala da clinica
 * que tinha texto de preparo quando o laco nao recebeu o nome do contato para
 * refazer a mascara (quem montou o historico esqueceu: falha fechada, nem o
 * preparo nem o nome vao ao modelo).
 */
export const SUBSTITUTO_DA_FALA_SEM_A_MASCARA =
  "(a clínica mandou uma mensagem que não aparece aqui)";

// ---------------------------------------------------------------------------
// O texto: normalizacao e validade (espelho de preparo_texto_valido)
// ---------------------------------------------------------------------------

/**
 * Os 25 brancos que o trim() do JavaScript tira das pontas, a mesma lista do
 * btrim de cadastro_texto_valido (migration 20261027100000). Todos cabem
 * numa unidade UTF-16.
 */
const BRANCOS_DO_TRIM: ReadonlySet<number> = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028,
  0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);

/** O trim() com a lista explicita do banco (linear, sem regex). */
function aparar(texto: string): string {
  let inicio = 0;
  let fim = texto.length;
  while (inicio < fim && BRANCOS_DO_TRIM.has(texto.charCodeAt(inicio))) {
    inicio += 1;
  }
  while (fim > inicio && BRANCOS_DO_TRIM.has(texto.charCodeAt(fim - 1))) {
    fim -= 1;
  }
  return texto.slice(inicio, fim);
}

/**
 * O texto como o banco guarda: "\r\n" e "\r" viram "\n", depois NFC, depois
 * o trim() do JavaScript (a ordem da copia do texto antigo, secao 1.6 do
 * contrato da AG7). A tela e a Server Action normalizam ANTES de mandar.
 */
export function normalizarTextoDoPreparo(texto: string): string {
  return aparar(
    texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n").normalize("NFC"),
  );
}

// Controle alem do "\n" (o banco nunca guarda o U+0000; aqui ele tambem e
// recusado). O "\r" e o "\t" caem aqui.
const CONTROLE_NO_TEXTO = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

// Os invisiveis que o CHECK recusa.
const INVISIVEL_NO_TEXTO =
  /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/;

/**
 * Espelho de preparo_texto_valido: de 1 a 3.500 caracteres (pontos de
 * codigo, como o char_length), aparado pelos 25 brancos, em NFC, sem "\r",
 * sem controle alem do "\n", sem invisivel e sem "{{" nem "}}" (a regua os
 * apagaria do toque).
 */
export function textoDoPreparoValido(texto: string): boolean {
  if (typeof texto !== "string") {
    return false;
  }
  const tamanho = Array.from(texto).length;
  return (
    tamanho >= 1 &&
    tamanho <= LIMITE_DO_TEXTO_DO_PREPARO &&
    aparar(texto) === texto &&
    texto.normalize("NFC") === texto &&
    !texto.includes("\r") &&
    !CONTROLE_NO_TEXTO.test(texto) &&
    !INVISIVEL_NO_TEXTO.test(texto) &&
    !texto.includes("{{") &&
    !texto.includes("}}")
  );
}

// ---------------------------------------------------------------------------
// A mensagem do sistema (espelho de mensagem_do_preparo)
// ---------------------------------------------------------------------------

export type ResponsavelTecnicoDaMensagem = {
  nome: string;
  conselho: string;
  uf: string;
  numero: string;
};

/**
 * A mensagem que o paciente recebe, igual a mensagem_do_preparo do banco:
 *
 *   Orientacao de preparo para {procedimento}
 *   Responsavel tecnico da clinica: {nome} ({conselho}-{UF} {numero})
 *
 *   {o texto aprovado}
 *
 *   {rodape}
 *
 * Quem envia nunca usa esta funcao: a mensagem do envio vem do banco,
 * conferida por hash (preparo-aprovado.ts). Ela serve a tela (a previa do
 * dialogo de aprovacao) e aos testes de igualdade com o banco.
 */
export function mensagemDoPreparo(e: {
  procedimento: string;
  rt: ResponsavelTecnicoDaMensagem;
  texto: string;
}): string {
  return `${CABECALHO_DO_PREPARO}${e.procedimento}\n${LINHA_DO_RT}${e.rt.nome} (${e.rt.conselho}-${e.rt.uf} ${e.rt.numero})\n\n${e.texto}\n\n${RODAPE_DO_PREPARO}`;
}

const FIM_DA_MENSAGEM = `\n\n${RODAPE_DO_PREPARO}`;

/**
 * As partes de um corpo no formato da mensagem do preparo, ou null: a
 * primeira linha e o cabecalho com o procedimento, a segunda e a do RT, a
 * terceira e vazia, depois o texto (nao vazio) e, por fim, uma linha vazia e
 * o rodape.
 */
export function partesDaMensagemDoPreparo(corpo: string): {
  procedimento: string;
  linhaDoRt: string;
  texto: string;
} | null {
  if (
    typeof corpo !== "string" ||
    !corpo.startsWith(CABECALHO_DO_PREPARO) ||
    !corpo.endsWith(FIM_DA_MENSAGEM)
  ) {
    return null;
  }
  const primeiraQuebra = corpo.indexOf("\n");
  if (primeiraQuebra < 0) {
    return null;
  }
  const procedimento = corpo.slice(CABECALHO_DO_PREPARO.length, primeiraQuebra);
  if (procedimento.trim() === "") {
    return null;
  }
  const segundaQuebra = corpo.indexOf("\n", primeiraQuebra + 1);
  if (segundaQuebra < 0) {
    return null;
  }
  const linhaDoRt = corpo.slice(primeiraQuebra + 1, segundaQuebra);
  if (
    !linhaDoRt.startsWith(LINHA_DO_RT) ||
    linhaDoRt.slice(LINHA_DO_RT.length).trim() === "" ||
    corpo.charAt(segundaQuebra + 1) !== "\n"
  ) {
    return null;
  }
  const inicioDoTexto = segundaQuebra + 2;
  const fimDoTexto = corpo.length - FIM_DA_MENSAGEM.length;
  if (fimDoTexto <= inicioDoTexto) {
    return null;
  }
  const texto = corpo.slice(inicioDoTexto, fimDoTexto);
  return texto.trim() === "" ? null : { procedimento, linhaDoRt, texto };
}

/**
 * O procedimento da primeira linha de um corpo que comeca pelo cabecalho do
 * preparo (aparado), ou null quando nao comeca. NAO confirma que e a
 * mensagem do sistema (isso e ehMensagemDoPreparo): serve para trocar, no
 * historico que vai ao modelo, qualquer fala da clinica que comece pelo
 * cabecalho (substitutoDaMensagemDoPreparo).
 */
export function procedimentoDaMensagemDoPreparo(corpo: string): string | null {
  if (typeof corpo !== "string" || !corpo.startsWith(CABECALHO_DO_PREPARO)) {
    return null;
  }
  const quebra = corpo.indexOf("\n");
  return corpo
    .slice(CABECALHO_DO_PREPARO.length, quebra < 0 ? corpo.length : quebra)
    .trim();
}

/** Os campos da mensagem que o reconhecedor le (o fio, o motor, os testes). */
export type MensagemParaReconhecer = {
  author: string;
  body?: string | null;
  is_internal_note: boolean;
  author_user_id?: string | null;
  direction?: string;
  content_type?: string;
  pelo_celular?: boolean;
  media_url?: string | null;
  job_id?: string | null;
};

/**
 * A mensagem e a orientacao de preparo enviada pelo sistema? Saida do
 * sistema (author 'sistema', sem pessoa), em texto, que nao e nota interna,
 * nao saiu pelo celular e nao tem midia, com o corpo no formato da mensagem
 * do preparo (cabecalho, linha do RT, texto e rodape). No molde de
 * ehNotaDaPassagemDaIa (lib/agente/nota-da-passagem.ts) e de
 * ehAvisoAutomaticoDaIa (components/atendimento/aviso-automatico.ts): o fio
 * nao traz o job_id; quando ele vier junto, nulo nao e o preparo (a mensagem
 * sai sempre pelo job da IA).
 */
export function ehMensagemDoPreparo(m: MensagemParaReconhecer): boolean {
  const corpo = m.body ?? null;
  return (
    m.author === "sistema" &&
    !m.is_internal_note &&
    !m.author_user_id &&
    m.pelo_celular !== true &&
    (m.direction === undefined || m.direction === "saida") &&
    (m.content_type === undefined || m.content_type === "texto") &&
    (m.media_url === undefined || m.media_url === null) &&
    m.job_id !== null &&
    corpo !== null &&
    partesDaMensagemDoPreparo(corpo) !== null
  );
}

/**
 * O codigo curto do texto para a tela e a trilha: os 8 primeiros
 * hexadecimais do sha256, em maiusculas, em dois grupos ("A1B2 C3D4"). Hash
 * fora do formato devolve "".
 */
export function codigoDoTexto(sha256: string): string {
  if (typeof sha256 !== "string" || !/^[0-9a-f]{8}/i.test(sha256)) {
    return "";
  }
  const oito = sha256.slice(0, 8).toUpperCase();
  return `${oito.slice(0, 4)} ${oito.slice(4)}`;
}

// ---------------------------------------------------------------------------
// O historico que vai ao modelo: o texto da clinica vira marcador
// ---------------------------------------------------------------------------

function escaparParaRegex(texto: string): string {
  return texto.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

/**
 * O texto da clinica como regex: os brancos viram \s+ (a quebra "\r\n", o
 * espaco no fim da linha) e as pontas nao podem cair no meio de uma palavra.
 */
function regexDoTexto(texto: string): RegExp {
  const miolo = texto.split(/\s+/u).map(escaparParaRegex).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${miolo}(?![\\p{L}\\p{N}])`, "gu");
}

/**
 * Troca, numa fala da clinica que vai ao modelo, todo trecho igual a um
 * texto de preparo da clinica (textos_de_preparo_da_clinica: as versoes e o
 * prep_instructions que a regua mandou antes da AG7) pelo marcador
 * SUBSTITUTO_DO_TEXTO_DO_PREPARO. O texto mais longo vale primeiro, e o
 * marcador nunca e lido de novo. Texto sem letra nem numero e ignorado
 * (trocar todo branco do historico estragaria a conversa). E defesa em
 * profundidade: o modelo nunca ve o preparo, nem quando a regua o mandou.
 */
export function semOPreparo(texto: string, textos: readonly string[]): string {
  if (typeof texto !== "string" || texto === "") {
    return texto;
  }
  const nfc = texto.normalize("NFC");
  const trechos = trechosDoPreparo(nfc, textos);
  if (trechos.length === 0) {
    return trechos === SEM_AGULHA ? texto : nfc;
  }
  let saida = "";
  let ultimo = 0;
  for (const { inicio, fim } of trechos) {
    saida += nfc.slice(ultimo, inicio) + SUBSTITUTO_DO_TEXTO_DO_PREPARO;
    ultimo = fim;
  }
  return saida + nfc.slice(ultimo);
}

/** Um trecho do texto, em indices de unidade UTF-16 ([inicio, fim)). */
export type TrechoDoPreparo = { inicio: number; fim: number };

// A lista vazia de quando nao ha agulha nenhuma (semOPreparo devolve o texto
// como veio, sem a NFC, como sempre).
const SEM_AGULHA: readonly TrechoDoPreparo[] = Object.freeze([]);

/**
 * Os trechos de `texto` (JA em NFC) iguais a um texto de preparo da clinica,
 * em ordem e sem sobrepor: a mesma busca de semOPreparo (o texto mais longo
 * primeiro, os brancos como \s+, as pontas sem cortar palavra, o trecho ja
 * trocado nunca lido de novo). Revisao da AG7 (CFM-1): o laco troca estes
 * trechos no corpo como saiu e refaz a mascara do nome so no resto.
 */
export function trechosDoPreparo(
  texto: string,
  textos: readonly string[],
): readonly TrechoDoPreparo[] {
  const agulhas = agulhasDe(textos);
  if (agulhas.length === 0 || typeof texto !== "string" || texto === "") {
    return SEM_AGULHA;
  }
  let livres: TrechoDoPreparo[] = [{ inicio: 0, fim: texto.length }];
  const tomados: TrechoDoPreparo[] = [];
  for (const agulha of agulhas) {
    // A sonda: toda ocorrencia do texto da clinica tem as palavras mais
    // longas dele, iguais. Sem elas no texto, a regex nem e montada.
    if (!agulha.sondas.every((sonda) => texto.includes(sonda))) {
      continue;
    }
    agulha.regex ??= regexDoTexto(agulha.texto);
    const regex = agulha.regex;
    const restantes: TrechoDoPreparo[] = [];
    for (const livre of livres) {
      const pedaco = texto.slice(livre.inicio, livre.fim);
      let ultimo = 0;
      for (const achado of pedaco.matchAll(regex)) {
        const inicio = achado.index ?? 0;
        restantes.push({
          inicio: livre.inicio + ultimo,
          fim: livre.inicio + inicio,
        });
        tomados.push({
          inicio: livre.inicio + inicio,
          fim: livre.inicio + inicio + achado[0].length,
        });
        ultimo = inicio + achado[0].length;
      }
      restantes.push({ inicio: livre.inicio + ultimo, fim: livre.fim });
    }
    livres = restantes;
  }
  return tomados.sort((a, b) => a.inicio - b.inicio);
}

/**
 * Um texto de preparo pronto para a busca: o texto (NFC, aparado), as sondas
 * (as duas palavras mais longas) e a regex, montada so na primeira vez que a
 * sonda passa.
 */
type Agulha = {
  readonly texto: string;
  readonly sondas: readonly string[];
  regex: RegExp | null;
};

// As agulhas de cada lista de textos (a do catalogo do turno, a mesma para
// toda mensagem do historico), sem segurar a lista depois do turno. Revisao
// da AG7 (teto de 1.000 textos): montar as regex de todos os textos para
// cada mensagem levava um minuto no teto.
const AGULHAS_DA_LISTA = new WeakMap<readonly string[], readonly Agulha[]>();

/** As agulhas da lista: sem repetir, com letra ou numero, a mais longa antes. */
function agulhasDe(textos: readonly string[]): readonly Agulha[] {
  if (!Array.isArray(textos)) {
    return [];
  }
  const pronta = AGULHAS_DA_LISTA.get(textos);
  if (pronta !== undefined) {
    return pronta;
  }
  const agulhas = [
    ...new Set(
      textos
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.normalize("NFC").trim())
        .filter((t) => /[\p{L}\p{N}]/u.test(t)),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .map((texto): Agulha => ({
      texto,
      sondas: [...new Set(texto.split(/\s+/u).filter((p) => p !== ""))]
        .sort((a, b) => b.length - a.length)
        .slice(0, 2),
      regex: null,
    }));
  AGULHAS_DA_LISTA.set(textos, agulhas);
  return agulhas;
}

// ---------------------------------------------------------------------------
// O filtro na saida: a resposta da IA que copia um trecho do texto da clinica
// ---------------------------------------------------------------------------

/** A frase do texto da clinica que conta como trecho (normalizada). */
export const TAMANHO_MINIMO_DO_TRECHO = 25;

/**
 * Minusculas, sem acento (NFKD sem as marcas), o que nao e letra nem numero
 * vira espaco, espaco unico. Os dois lados passam por aqui.
 */
function normalizarParaOTrecho(texto: string): string {
  return soLetrasENumeros(semAcentoEMinusculo(texto));
}

/** A primeira metade da normalizacao: NFKD sem as marcas, minusculas. */
function semAcentoEMinusculo(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A segunda: o que nao e letra nem numero vira espaco, espaco unico. */
function soLetrasENumeros(texto: string): string {
  return texto.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// O fim de frase: ponto, exclamacao, interrogacao, ponto e virgula ou dois
// pontos seguidos de branco (ou no fim), e a quebra de linha. "0,9" e
// "18:00" nao quebram.
const FIM_DE_FRASE = /[.!?;:\u2026]+(?=\s|$)|[\r\n\u2028\u2029]+/u;
// Revisao da AG7 (CFM-8): o fim de frase e a virgula seguida de branco ("0,9"
// nao quebra).
const FIM_DE_FRASE_OU_ORACAO = /[.!?;:,\u2026]+(?=\s|$)|[\r\n\u2028\u2029]+/u;

/**
 * Revisao da AG7 (CFM-8): quantas palavras seguidas de um texto da clinica
 * contam como trecho mesmo fora da frase e da oracao inteiras (a copia longa
 * com uma palavra trocada no fim). A oracao entre virgulas ja pega "Venha
 * com um acompanhante maior de idade porque vai receber sedacao" (sem o
 * "voce") e "Tome com um gole de agua as 6h do dia do exame" (meia frase).
 * Dez, e nao seis ou sete: a janela curta barrava o requisito de sempre
 * ("documento com foto e a carteirinha do convenio") quando a clinica o pos
 * no texto do preparo (0 falsos positivos em 494 frases de recepcao e
 * controles com dez; 2 com sete).
 */
export const PALAVRAS_DA_JANELA_DO_TRECHO = 10;

/** O texto da clinica normalizado: as frases que contam e as palavras. */
type FormasDoTexto = {
  readonly trechos: readonly string[];
  readonly palavras: readonly string[];
};

// As formas de cada texto, por lista (a do catalogo do turno), sem segurar a
// lista depois do turno.
const FORMAS_DA_LISTA = new WeakMap<
  readonly string[],
  Map<string, FormasDoTexto>
>();

/** As frases de um texto da clinica que contam como trecho, normalizadas. */
function formasDoTexto(texto: string, lista: readonly string[]): FormasDoTexto {
  let daLista = FORMAS_DA_LISTA.get(lista);
  if (daLista === undefined) {
    daLista = new Map();
    FORMAS_DA_LISTA.set(lista, daLista);
  }
  const pronta = daLista.get(texto);
  if (pronta !== undefined) {
    return pronta;
  }
  // A NFKD uma vez so (o texto chega a 4.000 caracteres e a lista a 1.000
  // textos): a pontuacao continua ate o corte das frases e das oracoes.
  const minusculo = semAcentoEMinusculo(texto);
  const inteiro = soLetrasENumeros(minusculo);
  const formas: FormasDoTexto = {
    trechos: [
      ...minusculo.split(FIM_DE_FRASE).map(soLetrasENumeros),
      // Revisao da AG7 (CFM-8): a oracao entre virgulas tambem conta.
      ...minusculo.split(FIM_DE_FRASE_OU_ORACAO).map(soLetrasENumeros),
      // O texto inteiro tambem conta: um texto so de frases curtas copiado
      // por inteiro.
      inteiro,
    ].filter((trecho) => Array.from(trecho).length >= TAMANHO_MINIMO_DO_TRECHO),
    palavras: inteiro === "" ? [] : inteiro.split(" "),
  };
  daLista.set(texto, formas);
  return formas;
}

/**
 * A resposta do modelo copia um trecho de um texto de preparo da clinica?
 * Os dois lados normalizados (minusculas, sem acento, sem pontuacao, espaco
 * unico); conta, sem cortar palavra:
 *  - a frase do texto com TAMANHO_MINIMO_DO_TRECHO caracteres ou mais (ou o
 *    texto inteiro) que aparece inteira na resposta;
 *  - revisao da AG7 (CFM-8): a oracao entre virgulas com
 *    TAMANHO_MINIMO_DO_TRECHO caracteres ou mais, inteira (a frase com uma
 *    palavra a menos depois da virgula, a meia frase), e
 *    PALAVRAS_DA_JANELA_DO_TRECHO palavras seguidas do texto (com
 *    TAMANHO_MINIMO_DO_TRECHO caracteres ou mais) que aparecem seguidas na
 *    resposta.
 * A frase curta comum ("Jejum de 8 horas.") e a resposta que so fala do
 * mesmo assunto com outras palavras nao contam: elas ficam para os padroes
 * de padroes.ts e para o verificador. Regra da camada deterministica
 * (trecho_do_preparo_da_clinica, filtro-deterministico.ts).
 */
export function trechoDePreparoNaResposta(
  rascunho: string,
  textos: readonly string[],
): boolean {
  if (typeof rascunho !== "string" || !Array.isArray(textos)) {
    return false;
  }
  const normalizada = normalizarParaOTrecho(rascunho);
  if (normalizada === "") {
    return false;
  }
  const resposta = ` ${normalizada} `;
  const palavrasDaResposta = new Set(normalizada.split(" "));
  for (const texto of textos) {
    if (typeof texto !== "string") {
      continue;
    }
    const { trechos, palavras } = formasDoTexto(texto, textos);
    for (const trecho of trechos) {
      if (resposta.includes(` ${trecho} `)) {
        return true;
      }
    }
    for (
      let i = 0;
      i + PALAVRAS_DA_JANELA_DO_TRECHO <= palavras.length;
      i += 1
    ) {
      // So monta a janela que comeca numa palavra que a resposta tem.
      if (!palavrasDaResposta.has(palavras[i] ?? "")) {
        continue;
      }
      const janela = palavras
        .slice(i, i + PALAVRAS_DA_JANELA_DO_TRECHO)
        .join(" ");
      if (
        Array.from(janela).length >= TAMANHO_MINIMO_DO_TRECHO &&
        resposta.includes(` ${janela} `)
      ) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// A situacao na tela (o chip da secao "Orientacao de preparo")
// ---------------------------------------------------------------------------

/** As colunas que a tela le de preparo_do_procedimento. */
export type VersaoNaTela = {
  id: string;
  versao: number;
  situacao: SituacaoDoPreparo;
  textoSha256: string;
  nomeDoProcedimento: string;
  rtId: string | null;
};

export type SituacaoDoPreparoNaTela =
  | "aprovada"
  | "aguardando"
  | "precisa_de_nova_aprovacao"
  | "suspenso"
  | "sem_orientacao";

/** As situacoes de quem ja foi aprovado um dia (a linha do envio). */
const JA_APROVADAS: ReadonlySet<SituacaoDoPreparo> = new Set([
  "aprovado",
  "substituido",
  "suspenso",
]);

function maisNova(versoes: readonly VersaoNaTela[]): VersaoNaTela | null {
  let escolhida: VersaoNaTela | null = null;
  for (const versao of versoes) {
    if (escolhida === null || versao.versao > escolhida.versao) {
      escolhida = versao;
    }
  }
  return escolhida;
}

/**
 * O chip do procedimento (os cinco do desenho, 5.1), na ordem de quem vale:
 *  1. ha versao aprovado: "aprovada" quando ela esta em vigor (o RT dela e o
 *     RT aberto, com acesso ativo, e o nome do procedimento nao mudou), e
 *     "precisa_de_nova_aprovacao" quando nao esta (RT trocado ou sem acesso,
 *     nome mudado). O texto novo que espera o RT aparece no bloco proprio,
 *     sem trocar o chip;
 *  2. senao, ha versao aguardando o RT: "aguardando";
 *  3. senao, a ultima versao que ja foi aprovada esta suspensa: "suspenso";
 *  4. senao: "sem_orientacao" (nenhuma versao, ou so devolvidas e
 *     descartadas).
 * A conferencia do hash recalculado e do banco (preparo_em_vigor); a
 * paridade entre esta funcao e a do banco e testada na integracao.
 */
export function situacaoDoPreparoNaTela(e: {
  versoes: readonly VersaoNaTela[];
  rtAberto: { id: string; userId: string } | null;
  rtComAcesso: boolean;
  nomeAtual: string;
}): SituacaoDoPreparoNaTela {
  const aprovada = maisNova(e.versoes.filter((v) => v.situacao === "aprovado"));
  if (aprovada !== null) {
    const emVigor =
      aprovada.rtId !== null &&
      e.rtAberto !== null &&
      aprovada.rtId === e.rtAberto.id &&
      e.rtComAcesso &&
      aprovada.nomeDoProcedimento === e.nomeAtual;
    return emVigor ? "aprovada" : "precisa_de_nova_aprovacao";
  }
  if (e.versoes.some((v) => v.situacao === "aguardando_rt")) {
    return "aguardando";
  }
  const ultimaAprovada = maisNova(
    e.versoes.filter((v) => JA_APROVADAS.has(v.situacao)),
  );
  return ultimaAprovada?.situacao === "suspenso"
    ? "suspenso"
    : "sem_orientacao";
}
