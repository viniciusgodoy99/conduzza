// Normalizacao do texto antes de casar os padroes do filtro de conformidade.
// PURO, zero I/O.
//
// O problema: o filtro deterministico casa palavras ("dipirona", "garantido"),
// e quem quer passar por ele (um paciente testando o robo, ou o proprio modelo
// enganado por uma injecao) escreve "d i p i r o n a", "G a r a n t 1 d o",
// "d\u0456pirona" com o i cirilico, "dipi\u200brona" com um caractere invisivel no
// meio ou letras de largura cheia. Cada truque abaixo desfaz um desses.
//
// Sao varias visoes do mesmo texto, e os padroes de frase rodam em todas (o
// filtro so bloqueia, entao mais visoes so aumentam a chance de pegar):
//  - base: sem acento, minusculas, sem invisivel, homoglifo trocado pela letra
//    latina, pontuacao tipografica simplificada e espacos unicos. Numero
//    continua numero: e nela que preco, dose e telefone sao lidos.
//  - despacado: base com as sequencias de letras soltas juntadas
//    ("d i p i r o n a" e "d.i.p.i.r.o.n.a" viram "dipirona").
//  - leet: despacado com numero e simbolo no lugar de letra desfeitos, so
//    dentro de palavra que tem letra ("t0 c0m f3br3" vira "to com febre";
//    "500 mg" continua "500 mg").
//  - emendado: hifen e quebra de linha no meio da palavra removidos
//    ("nor-mal", "gra\nve" e "trama-\ndol" viram "normal", "grave",
//    "tramadol").
//  - preservado: letras soltas juntadas sem engolir a palavra de uma letra
//    vizinha ("e n o r m a l" vira "e normal", e nao "enormal") e com dois
//    ou mais espacos valendo como fim de palavra ("t o  c o m  d o r" vira
//    "to com dor").
//  - compacto: leet so com letras, sem espaco e sem letra repetida
//    ("di-pi-ro-na", "diiipiiirona" e "dipi rona" viram "dipirona"). Serve
//    so para o lexico forte (nomes que nao aparecem por acaso no meio de
//    duas palavras), nunca para padroes de frase.
//
// Alem das visoes, tres sinais ESTRUTURAIS que nao dependem de lista e que
// a recepcao nunca produz: letra fora de [a-z] depois da normalizacao,
// simbolo grudado entre duas letras ("d!p!rona", "tra\u{1f48a}madol") e
// quatro ou mais letras soltas seguidas ("n o r m a l").
//
// SEM tratamento de negacao, de proposito (plano de seguranca 2.2): "nao e
// nada grave" e triagem, e "nao garantimos" cai como falso positivo e escala.

// Homoglifos: letra de outro alfabeto que parece latina. Maiusculas e
// minusculas mapeadas ANTES de baixar a caixa, porque o Eta grego maiusculo
// parece H e o minusculo parece n. Escritos como escape para o arquivo nao
// ter letra estrangeira solta (e para o teste do travessao).
const HOMOGLIFOS: ReadonlyMap<string, string> = new Map([
  // Cirilico maiusculo
  ["\u0410", "a"],
  ["\u0412", "b"],
  ["\u0415", "e"],
  ["\u0405", "s"],
  ["\u0406", "i"],
  ["\u0408", "j"],
  ["\u041a", "k"],
  ["\u041c", "m"],
  ["\u041d", "h"],
  ["\u041e", "o"],
  ["\u0420", "p"],
  ["\u0421", "c"],
  ["\u0422", "t"],
  ["\u0425", "x"],
  ["\u0423", "y"],
  ["\u04ae", "y"],
  ["\u051a", "q"],
  ["\u051c", "w"],
  ["\u0500", "d"],
  ["\u04ba", "h"],
  ["\u04c0", "l"],
  // Cirilico minusculo
  ["\u0430", "a"],
  ["\u0432", "b"],
  ["\u0435", "e"],
  ["\u0455", "s"],
  ["\u0456", "i"],
  ["\u0458", "j"],
  ["\u043a", "k"],
  ["\u043c", "m"],
  ["\u043d", "h"],
  ["\u043e", "o"],
  ["\u0440", "p"],
  ["\u0441", "c"],
  ["\u0442", "t"],
  ["\u0445", "x"],
  ["\u0443", "y"],
  ["\u04af", "y"],
  ["\u051b", "q"],
  ["\u051d", "w"],
  ["\u0501", "d"],
  ["\u04bb", "h"],
  ["\u04cf", "l"],
  ["\u0491", "r"],
  // Grego maiusculo
  ["\u0391", "a"],
  ["\u0392", "b"],
  ["\u0395", "e"],
  ["\u0396", "z"],
  ["\u0397", "h"],
  ["\u0399", "i"],
  ["\u039a", "k"],
  ["\u039c", "m"],
  ["\u039d", "n"],
  ["\u039f", "o"],
  ["\u03a1", "p"],
  ["\u03a4", "t"],
  ["\u03a5", "y"],
  ["\u03a7", "x"],
  // Grego minusculo
  ["\u03b1", "a"],
  ["\u03b2", "b"],
  ["\u03b3", "y"],
  ["\u03b5", "e"],
  ["\u03b7", "n"],
  ["\u03b9", "i"],
  ["\u03ba", "k"],
  ["\u03bc", "u"],
  ["\u03bd", "v"],
  ["\u03bf", "o"],
  ["\u03c1", "p"],
  ["\u03c4", "t"],
  ["\u03c5", "u"],
  ["\u03c7", "x"],
  ["\u03c9", "w"],
  ["\u03f2", "c"],
  ["\u03f3", "j"],
  // Armenio
  ["\u0585", "o"],
  ["\u057d", "u"],
  ["\u0570", "h"],
  ["\u0578", "n"],
  // Latim estendido que o NFKD nao decompoe
  ["\u0131", "i"],
  ["\u0237", "j"],
  ["\u0251", "a"],
  ["\u0261", "g"],
  ["\u0269", "i"],
  ["\u0142", "l"],
  ["\u0141", "l"],
  ["\u00f8", "o"],
  ["\u00d8", "o"],
  ["\u0111", "d"],
  ["\u0110", "d"],
  ["\u0127", "h"],
  ["\u0167", "t"],
  ["\u0192", "f"],
  ["\u00df", "ss"],
  ["\u00e6", "ae"],
  ["\u00c6", "ae"],
  ["\u0153", "oe"],
  ["\u0152", "oe"],
  ["\u00f0", "d"],
  // Latim estendido com risco ou barra (U+0180 a U+024F e IPA), que tambem
  // e Script=Latin e por isso nao acende o alfabeto estranho. A lista nao
  // precisa ser completa: letra fora de [a-z] que sobrar depois daqui vira
  // formato invalido no filtro (letraForaDoAlfabeto).
  ["\u0268", "i"],
  ["\u0197", "i"],
  ["\u023c", "c"],
  ["\u023b", "c"],
  ["\u0188", "c"],
  ["\u0275", "o"],
  ["\u019f", "o"],
  ["\u024d", "r"],
  ["\u024c", "r"],
  ["\u0180", "b"],
  ["\u0243", "b"],
  ["\u0247", "e"],
  ["\u0246", "e"],
  ["\u2c65", "a"],
  ["\u023a", "a"],
  ["\u0256", "d"],
  ["\u0257", "d"],
  ["\u0289", "u"],
  ["\u0244", "u"],
  // Versaletes (letras "pequenas maiusculas")
  ["\u1d00", "a"],
  ["\u0299", "b"],
  ["\u1d04", "c"],
  ["\u1d05", "d"],
  ["\u1d07", "e"],
  ["\u0493", "f"],
  ["\u0262", "g"],
  ["\u029c", "h"],
  ["\u026a", "i"],
  ["\u1d0a", "j"],
  ["\u1d0b", "k"],
  ["\u029f", "l"],
  ["\u1d0d", "m"],
  ["\u0274", "n"],
  ["\u1d0f", "o"],
  ["\u1d18", "p"],
  ["\u0280", "r"],
  ["\ua731", "s"],
  ["\u1d1b", "t"],
  ["\u1d1c", "u"],
  ["\u1d20", "v"],
  ["\u1d21", "w"],
  ["\u028f", "y"],
  ["\u1d22", "z"],
]);

// Pontuacao tipografica para a forma simples.
const PONTUACAO: ReadonlyMap<string, string> = new Map([
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201a", "'"],
  ["\u201b", "'"],
  ["\u201c", '"'],
  ["\u201d", '"'],
  ["\u201e", '"'],
  ["\u2010", "-"],
  ["\u2011", "-"],
  ["\u2012", "-"],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u2015", "-"],
  ["\u2212", "-"],
]);

// Caracteres que nao aparecem na tela: largura zero, controle de direcao,
// hifen suave, marcas de formato (\p{Cf}), seletores de variacao,
// preenchimentos invisiveis do hangul e o braille em branco.
const INVISIVEIS =
  /[\p{Cf}\u034f\u115f\u1160\u3164\uffa0\u2800\ufe00-\ufe0f]|[\u{e0100}-\u{e01ef}]/gu;

// Separadores que alguem poe entre letras para quebrar a palavra.
const SEPARADOR = "[\\s.\\-_*\\u00b7\\u2022\\u2027\\u2219/|~+,:;'\"`^=]";

// Tres ou mais "letras soltas" seguidas, separadas por separador.
const LETRAS_SOLTAS = new RegExp(
  `(?<![a-z0-9@$])(?:[a-z0-9@$]${SEPARADOR}+){2,}[a-z0-9@$](?![a-z0-9@$])`,
  "g",
);

// O mesmo separador, mas com espaco UNICO: dois ou mais espacos seguidos
// valem como fim de palavra ("t o  c o m" sao duas palavras).
const SEPARADOR_FINO =
  "(?:[.\\-_*\\u00b7\\u2022\\u2027\\u2219/|~+,:;'\"`^=]|[ \\t](?![ \\t]))";
const LETRAS_SOLTAS_FINAS = new RegExp(
  `(?<![a-z0-9@$])(?:[a-z0-9@$]${SEPARADOR_FINO}+){2,}[a-z0-9@$](?![a-z0-9@$])`,
  "g",
);

// Palavras de uma letra que vem coladas na frente da palavra espacada
// ("e n o r m a l", "o h o s p i t a l", "a u p a").
const PALAVRAS_DE_UMA_LETRA = new Set(["e", "o", "a"]);

// Quatro ou mais LETRAS soltas seguidas (so letra: "1, 2 e 3" nao conta).
// A recepcao nunca escreve assim; no filtro e formato invalido e na
// entrada e tentativa de manipulacao.
const QUATRO_LETRAS_SOLTAS = new RegExp(
  `(?<![a-z0-9@$])(?:[a-z]${SEPARADOR}+){3,}[a-z](?![a-z0-9@$])`,
);

// Simbolo grudado entre duas letras: tudo que nao e letra, digito, espaco
// ou a pontuacao que a recepcao usa ("d!p!rona", "d|p|rona", "dipir\u00b0na",
// "tra\u{1f48a}madol"). Digito fica de fora: leet e lido em outra visao.
const SIMBOLO_ENTRE_LETRAS = /\p{L}[^\p{L}\p{N}\s.,;:'"()\-/]+\p{L}/u;

const LEET: ReadonlyMap<string, string> = new Map([
  ["0", "o"],
  ["1", "i"],
  ["3", "e"],
  ["4", "a"],
  ["5", "s"],
  ["7", "t"],
  ["@", "a"],
  ["$", "s"],
]);

/** O mesmo, lendo "1" como "l" ("Dorf1ex", "Rivotri1"). */
const LEET_COM_L: ReadonlyMap<string, string> = new Map([...LEET, ["1", "l"]]);

function trocarCaracteres(
  texto: string,
  mapa: ReadonlyMap<string, string>,
): string {
  let saida = "";
  for (const caractere of texto) {
    saida += mapa.get(caractere) ?? letraDeSimbolo(caractere) ?? caractere;
  }
  return saida;
}

// Letras desenhadas como simbolo, que o NFKD nao desfaz: quadrado negativo
// (U+1F170 a U+1F189) e indicador regional (U+1F1E6 a U+1F1FF, os das
// bandeiras). "\u{1f173}\u{1f178}\u{1f17f}..." vira "dip...".
function letraDeSimbolo(caractere: string): string | undefined {
  const codigo = caractere.codePointAt(0) ?? 0;
  if (codigo >= 0x1f170 && codigo <= 0x1f189) {
    return String.fromCharCode(97 + codigo - 0x1f170);
  }
  if (codigo >= 0x1f1e6 && codigo <= 0x1f1ff) {
    return String.fromCharCode(97 + codigo - 0x1f1e6);
  }
  return undefined;
}

const FRASE_COLADA = /(?<=\p{Ll})([!?]+)(?=\p{Lu}\p{Ll})/gu;

/**
 * A base sem juntar os espacos: quebra de linha e espaco duplo continuam la
 * (as visoes emendado e preservado precisam deles).
 */
function normalizarSemColapsar(texto: string): string {
  // "Maria!Tudo bem?" (faltou o espaco depois do ponto de exclamacao) e
  // fim de frase, nao simbolo grudado entre letras: minuscula, "!" ou "?",
  // e uma palavra que comeca com maiuscula.
  const frasesSeparadas = texto.replace(FRASE_COLADA, "$1 ");
  const decomposto = frasesSeparadas.normalize("NFKD");
  const semMarcas = decomposto.replace(/\p{M}/gu, "");
  const semInvisiveis = semMarcas.replace(INVISIVEIS, "");
  const latino = trocarCaracteres(semInvisiveis, HOMOGLIFOS).toLowerCase();
  const latinoDeNovo = trocarCaracteres(latino, HOMOGLIFOS);
  return trocarCaracteres(latinoDeNovo, PONTUACAO);
}

function colapsar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * Visao base: sem acento, minusculas, sem invisivel, sem homoglifo, com a
 * pontuacao simplificada e espacos unicos. Preserva digitos e simbolos.
 */
export function normalizarBase(texto: string): string {
  return colapsar(normalizarSemColapsar(texto));
}

/** Junta as sequencias de letras soltas ("g a r a n t 1 d o"). */
export function juntarLetrasSoltas(base: string): string {
  return base.replace(LETRAS_SOLTAS, (trecho) =>
    trecho.replace(/[^a-z0-9@$]/g, ""),
  );
}

/**
 * Junta as letras soltas sem engolir a palavra de uma letra que vem na
 * frente ("e n o r m a l" vira "e normal") e respeitando espaco duplo como
 * fim de palavra ("t o  c o m  d o r" vira "t o com dor"). Recebe o texto
 * ANTES de juntar os espacos.
 */
export function juntarLetrasSoltasPreservando(texto: string): string {
  return texto.replace(LETRAS_SOLTAS_FINAS, (trecho) => {
    const letras = trecho.replace(/[^a-z0-9@$]/g, "");
    const primeira = letras.charAt(0);
    return letras.length >= 4 && PALAVRAS_DE_UMA_LETRA.has(primeira)
      ? `${primeira} ${letras.slice(1)}`
      : letras;
  });
}

// Uma ou mais quebras de linha, com espaco em volta ("gra-\n\nve").
const QUEBRAS = "(?:[ \\t]*(?:\\r\\n|[\\r\\n\\u2028\\u2029]))+[ \\t]*";

/**
 * Tira o hifen e a quebra de linha do meio da palavra ("nor-mal",
 * "gra\nve", "trama-\ndol", "hos-\n\npital") e o hifen com espaco de UM
 * lado so ("nor- mal", "nor -mal"). Recebe o texto ANTES de juntar os
 * espacos. Hifen com espaco dos dois lados ("Dra. Ana - dermatologia")
 * fica.
 */
export function emendarPalavras(texto: string): string {
  return texto
    .replace(new RegExp(`(?<=[a-z])-${QUEBRAS}(?=[a-z])`, "g"), "")
    .replace(/(?<=[a-z])(?:-[ \t]+|[ \t]+-)(?=[a-z])/g, "")
    .replace(/(?<=[a-z])-(?=[a-z])/g, "")
    .replace(new RegExp(`(?<=[a-z])${QUEBRAS}(?=[a-z])`, "g"), "");
}

/** Letra que sobrou fora de [a-z] depois da normalizacao (visao base). */
export function temLetraForaDoAlfabeto(base: string): boolean {
  return /[^\P{L}a-z]/u.test(base);
}

/** Simbolo grudado entre duas letras (visao base). */
export function temSimboloEntreLetras(base: string): boolean {
  return SIMBOLO_ENTRE_LETRAS.test(base);
}

/** Quatro ou mais letras soltas seguidas (visao base). */
export function temLetrasSoltas(base: string): boolean {
  return QUATRO_LETRAS_SOLTAS.test(base);
}

// Simbolo no lugar de letra, so quando esta ENTRE letras ou digitos
// ("d!p!rona", "d|p|rona", "dipir\u00b0na"); "Ola!" no fim da frase fica.
const SIMBOLO_NO_LUGAR_DE_LETRA: ReadonlyMap<string, string> = new Map([
  ["!", "i"],
  ["|", "i"],
  ["\u00b0", "o"],
]);

// A barra vertical na BORDA da palavra, colada numa letra ("Tramado|",
// "|buprofeno"): a recepcao nunca escreve assim, e "!" na borda continua
// sendo pontuacao.
const BARRA_NA_BORDA = /(?<=[a-z])\|(?![a-z0-9])|(?<![a-z0-9])\|(?=[a-z])/g;

/**
 * Desfaz numero e simbolo no lugar de letra, so em palavra que tem letra.
 * Com `umComoL`, "1" e "|" viram "l" em vez de "i" ("Dorf1ex", "Rivotri1",
 * "Tramado|"): e uma visao a mais, so para o lexico de remedios.
 */
export function desfazerLeet(texto: string, umComoL = false): string {
  const leet = umComoL ? LEET_COM_L : LEET;
  const barra = umComoL ? "l" : "i";
  const semSimbolo = texto
    .replace(BARRA_NA_BORDA, barra)
    .replace(/(?<=[a-z0-9])[!|\u00b0](?=[a-z0-9])/g, (simbolo) =>
      simbolo === "|"
        ? barra
        : (SIMBOLO_NO_LUGAR_DE_LETRA.get(simbolo) ?? simbolo),
    );
  return semSimbolo.replace(/[a-z0-9@$]+/g, (palavra) =>
    /[a-z]/.test(palavra) && /[0-9@$]/.test(palavra)
      ? trocarCaracteres(palavra, leet)
      : palavra,
  );
}

/** So letras, sem espaco e sem letra repetida em sequencia. */
export function compactar(texto: string): string {
  return compactarComInicios(texto).compacto;
}

export type Compacto = {
  compacto: string;
  /** Posicoes do compacto em que uma palavra do texto comeca. */
  inicios: ReadonlySet<number>;
};

/**
 * O compacto e, junto, onde cada palavra comecava. Serve para o lexico que
 * so vale a partir do comeco de uma palavra ("trama dol" e remedio;
 * "especialista" nao e "cialis", nem "pouco de informacao" e "codein").
 */
export function compactarComInicios(texto: string): Compacto {
  let compacto = "";
  const inicios = new Set<number>();
  let comecoDePalavra = true;
  for (const caractere of texto) {
    if (!/[a-z]/.test(caractere)) {
      comecoDePalavra = true;
      continue;
    }
    if (compacto.endsWith(caractere)) {
      // Letra repetida some; se ela abria uma palavra, quem fica abre.
      if (comecoDePalavra) {
        inicios.add(compacto.length - 1);
      }
    } else {
      if (comecoDePalavra) {
        inicios.add(compacto.length);
      }
      compacto += caractere;
    }
    comecoDePalavra = false;
  }
  return { compacto, inicios };
}

/** O termo aparece no compacto comecando no inicio de uma palavra. */
export function ocorreNoInicioDePalavra(
  compacto: Compacto,
  termo: string,
): boolean {
  let posicao = compacto.compacto.indexOf(termo);
  while (posicao !== -1) {
    if (compacto.inicios.has(posicao)) {
      return true;
    }
    posicao = compacto.compacto.indexOf(termo, posicao + 1);
  }
  return false;
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nomesNormalizados(nomes: readonly string[]): string[] {
  return nomes
    .map((nome) => normalizarBase(nome))
    .filter((nome) => nome.length >= 3)
    .sort((a, b) => b.length - a.length);
}

function trocarNomes(texto: string, normalizados: readonly string[]): string {
  let saida = texto;
  for (const nome of normalizados) {
    const padrao = new RegExp(
      `(?<![a-z0-9])${escaparRegex(nome)}(?![a-z0-9])`,
      "g",
    );
    saida = saida.replace(padrao, " \u00a7 ");
  }
  return saida;
}

/**
 * Troca os nomes EXATOS do catalogo da clinica por um marcador neutro, para
 * "Tratamento da dor lombar" ou "Toxina botulinica 50 unidades" nao cairem
 * por engano. So o nome inteiro: parafrase do nome continua sendo avaliada.
 */
export function mascararNomes(base: string, nomes: readonly string[]): string {
  return colapsar(trocarNomes(base, nomesNormalizados(nomes)));
}

export type VisoesDoTexto = {
  base: string;
  despacado: string;
  leet: string;
  /** Hifen e quebra de linha do meio da palavra removidos. */
  emendado: string;
  /** Letras soltas juntadas sem engolir a palavra de uma letra vizinha. */
  preservado: string;
  compacto: string;
  /**
   * Leet lendo "1" e "|" como "l" ("Dorf1ex", "Tramado|"). So para o
   * lexico de remedios: nos padroes de frase o "1" continua "i".
   */
  leetComL: string;
  compactoComL: string;
  /** So letras, sem tirar repeticao (para "www" e "http" espacados). */
  soLetras: string;
};

export type Neutralizacao = {
  /** Nome da troca (para a versao das regras). */
  nome: string;
  /** Fonte da regex, escrita para o texto normalizado e com espacos unicos. */
  fonte: string;
  /** O que entra no lugar do trecho (aceita $1, $2...). */
  troca: string;
};

/**
 * Aplica as trocas de expressao permitida (padroes.ts) no texto ja
 * normalizado. Cada regex e compilada uma vez, com a flag g so aqui dentro
 * (replace com g nao guarda estado entre chamadas).
 */
export function neutralizador(
  lista: readonly Neutralizacao[],
): (texto: string) => string {
  const compiladas = lista.map((item) => ({
    regex: new RegExp(item.fonte, "g"),
    troca: item.troca,
  }));
  return (texto) =>
    compiladas.reduce(
      (saida, { regex, troca }) => saida.replace(regex, troca),
      texto,
    );
}

const SEM_NEUTRALIZAR = (texto: string) => texto;

export function visoesDoTexto(
  texto: string,
  nomesParaMascarar: readonly string[] = [],
  neutralizar: (texto: string) => string = SEM_NEUTRALIZAR,
): VisoesDoTexto {
  const nomes = nomesNormalizados(nomesParaMascarar);
  // Os nomes saem antes de emendar ou juntar, para "Pos-operatorio" do
  // catalogo nao virar outra palavra; e de novo no fim, ja com os espacos
  // juntados. A expressao permitida ("garantir sua vaga", "100%
  // preenchidos") sai por ultimo, ja com espaco unico, em cada visao de
  // frase: as visoes despacada, leet e compacta nascem da base ja trocada.
  const semColapsar = trocarNomes(normalizarSemColapsar(texto), nomes);
  const base = colapsar(
    neutralizar(colapsar(trocarNomes(colapsar(semColapsar), nomes))),
  );
  const despacado = juntarLetrasSoltas(base);
  const leet = desfazerLeet(despacado);
  const leetComL = desfazerLeet(despacado, true);
  return {
    base,
    despacado,
    leet,
    emendado: colapsar(
      neutralizar(
        colapsar(trocarNomes(colapsar(emendarPalavras(semColapsar)), nomes)),
      ),
    ),
    preservado: colapsar(
      neutralizar(
        colapsar(
          trocarNomes(
            colapsar(juntarLetrasSoltasPreservando(semColapsar)),
            nomes,
          ),
        ),
      ),
    ),
    compacto: compactar(leet),
    leetComL,
    compactoComL: compactar(leetComL),
    soLetras: leet.replace(/[^a-z]/g, ""),
  };
}

/** As visoes em que os padroes de frase rodam. */
export function frasesDasVisoes(visoes: VisoesDoTexto): string[] {
  return [
    visoes.base,
    visoes.despacado,
    visoes.leet,
    visoes.emendado,
    visoes.preservado,
  ];
}

export type SinaisDeOfuscacao = {
  /** Letra de outro alfabeto (ou letra matematica) no meio do texto. */
  alfabetoEstranho: boolean;
  /** Caractere invisivel entre letras. */
  invisivel: boolean;
  /** Acentos empilhados ou riscos sobrepostos (texto "zalgo"). */
  marcasEmpilhadas: boolean;
};

const INVISIVEL_SUSPEITO =
  /[\u200b\u200c\u200e\u200f\u2060-\u2064\ufeff\u00ad\u061c\u202a-\u202e\u2066-\u2069\u180e\u3164\u115f\u1160\uffa0\u2800\u034f]|[\u{e0000}-\u{e007f}]|[\p{L}\p{N}]\u200d|\u200d[\p{L}\p{N}]|[\p{L}\p{N}][\ufe00-\ufe0f]/u;

/**
 * Sinais de que o texto foi escrito para enganar o filtro. Lidos no texto
 * BRUTO (antes da normalizacao, que justamente apaga esses sinais).
 * Emoji nao e letra, entao nao conta.
 */
export function sinaisDeOfuscacao(bruto: string): SinaisDeOfuscacao {
  return {
    alfabetoEstranho: /[^\P{L}\p{Script=Latin}]/u.test(bruto.normalize("NFC")),
    invisivel: INVISIVEL_SUSPEITO.test(bruto),
    marcasEmpilhadas: /\p{M}{2,}|[\u0334-\u0338\u20d0-\u20f0]/u.test(
      bruto.normalize("NFD"),
    ),
  };
}

/** Distancia de edicao (Levenshtein), para nome de remedio mal escrito. */
export function distanciaDeEdicao(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(
        (atual[j - 1] ?? 0) + 1,
        (anterior[j] ?? 0) + 1,
        (anterior[j - 1] ?? 0) + custo,
      );
    }
    anterior = atual;
  }
  return anterior[b.length] ?? Math.max(a.length, b.length);
}

/** As regras estruturais, para a versao das regras do filtro. */
export const FONTES_DA_NORMALIZACAO: readonly string[] = [
  SEPARADOR,
  LETRAS_SOLTAS.source,
  LETRAS_SOLTAS_FINAS.source,
  QUATRO_LETRAS_SOLTAS.source,
  SIMBOLO_ENTRE_LETRAS.source,
  FRASE_COLADA.source,
  QUEBRAS,
  BARRA_NA_BORDA.source,
  [...LEET_COM_L].join(""),
];
