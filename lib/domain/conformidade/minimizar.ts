// Minimizacao do texto antes de ir a um modelo de linguagem (LGPD, plano de
// seguranca secao 4). PURO, zero I/O.
//
// Troca por marcador o que identifica a pessoa e nao ajuda a responder:
// e-mail, CPF, CNPJ, CEP, telefone e qualquer sequencia longa de digitos
// (carteirinha do convenio, RG, cartao). Data e hora ficam: "dia 14/10 as
// 10h30" e justamente o que a recepcao precisa entender.
//
// O filtro de saida usa a MESMA funcao para achar dado pessoal no rascunho:
// se minimizar muda o texto, o rascunho tem dado que nao pode sair.

const MARCADORES = {
  email: "[email]",
  cpf: "[cpf]",
  cnpj: "[cnpj]",
  cep: "[cep]",
  telefone: "[telefone]",
  numero: "[numero]",
} as const;

// Uma regex so, com as alternativas em ORDEM de prioridade: em cada posicao
// a primeira que casa vence. Data e hora vem antes do telefone e da sequencia
// longa, para "05/10/2026" e "10:30" nunca virarem numero.
const PADRAO = new RegExp(
  [
    // e-mail
    "(?<email>[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)+)",
    // data (dd/mm, dd/mm/aa, dd/mm/aaaa, com barra, ponto ou hifen)
    "(?<data>(?<![\\p{N}])\\d{1,2}[/.-]\\d{1,2}(?:[/.-](?:\\d{4}|\\d{2}))?(?![\\p{N}]))",
    // hora (10:30, 10h, 10h30)
    "(?<hora>(?<![\\p{N}])\\d{1,2}(?::\\d{2}|h\\d{0,2})(?![\\p{N}]))",
    // CNPJ formatado
    "(?<cnpj>(?<![\\p{N}])\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}(?![\\p{N}]))",
    // CPF formatado ou corrido
    "(?<cpf>(?<![\\p{N}])\\d{3}\\.\\d{3}\\.\\d{3}-?\\d{2}(?![\\p{N}]))",
    // CEP formatado (60000-000 ou 60.000-000)
    "(?<cep>(?<![\\p{N}])\\d{2}\\.?\\d{3}-\\d{3}(?![\\p{N}]))",
    // telefone brasileiro: +55, DDD entre parenteses, 8 ou 9 digitos
    "(?<telefone>(?:\\+?\\s?55[\\s.-]?)?(?:\\(\\s?\\d{2}\\s?\\)|(?<![\\p{N}])\\d{2})?[\\s.-]?(?<![\\p{N}])9?\\s?\\d{4}[\\s.-]?\\d{4}(?![\\p{N}]))",
    // qualquer sequencia de 8 ou mais digitos, com separador simples
    "(?<numero>(?<![\\p{N}])\\+?\\d(?:[\\s./-]?\\d){7,}(?![\\p{N}]))",
  ].join("|"),
  "giu",
);

type Grupos = Partial<
  Record<keyof typeof MARCADORES | "data" | "hora", string>
>;

/**
 * Texto com e-mail, CPF, CNPJ, CEP, telefone e sequencias longas de digitos
 * trocados por marcadores. Datas e horas preservadas.
 */
export function minimizarParaLlm(texto: string): string {
  return texto.replace(PADRAO, (trecho: string, ...args: unknown[]) => {
    const grupos = args[args.length - 1] as Grupos;
    if (grupos.data !== undefined || grupos.hora !== undefined) {
      return trecho;
    }
    for (const chave of Object.keys(MARCADORES) as Array<
      keyof typeof MARCADORES
    >) {
      if (grupos[chave] !== undefined) {
        // Preserva o espaco que o padrao do telefone pode ter engolido no
        // comeco, para a frase nao colar no marcador.
        const espaco = /^\s/.test(trecho) ? " " : "";
        return `${espaco}${MARCADORES[chave]}`;
      }
    }
    return trecho;
  });
}

/** Verdadeiro quando o texto tem algum dado que minimizarParaLlm trocaria. */
export function temDadoPessoal(texto: string): boolean {
  return minimizarParaLlm(texto) !== texto;
}

/** O tipo do marcador que um trecho vira (as chaves de MARCADORES). */
export type TipoDoTrechoMinimizado = keyof typeof MARCADORES;

/** Um trecho do texto ORIGINAL que minimizarParaLlm troca por marcador. */
export type TrechoMinimizado = {
  tipo: TipoDoTrechoMinimizado;
  /** O trecho como esta no texto (sem o espaco da frente). */
  texto: string;
};

/**
 * AG3 (27/10/2026): os trechos que minimizarParaLlm troca por marcador, com
 * o tipo, pela MESMA expressao e na mesma prioridade (data e hora ficam de
 * fora, como na troca). E por aqui que o servidor acha, no texto ORIGINAL
 * do paciente, o CPF e o numero da carteirinha que o modelo so viu como
 * [cpf] e [numero] (lib/agente/ferramentas/registrar-dados.ts). Nao muda a
 * minimizacao. Nunca vai para log nem para a OpenAI.
 */
export function trechosMinimizados(texto: string): TrechoMinimizado[] {
  const trechos: TrechoMinimizado[] = [];
  for (const casou of texto.matchAll(PADRAO)) {
    const grupos = (casou.groups ?? {}) as Grupos;
    if (grupos.data !== undefined || grupos.hora !== undefined) {
      continue;
    }
    for (const chave of Object.keys(MARCADORES) as Array<
      keyof typeof MARCADORES
    >) {
      if (grupos[chave] !== undefined) {
        trechos.push({ tipo: chave, texto: casou[0].trim() });
        break;
      }
    }
  }
  return trechos;
}

// ---------------------------------------------------------------------------
// Revisao final da AG3 (achado 14): o nome completo e o nascimento no turno
// da coleta de dados
// ---------------------------------------------------------------------------
//
// No turno em que a pessoa manda os dados para marcar, o AGENTE precisa do
// nome completo e da data de nascimento (registrar_dados_do_paciente copia
// os dois); o verificador de saida nao.
//
// Revisao curta das correcoes da AG3 (27/10/2026, achado 1, ALTO, CFM): a
// mascara pela deixa ("me chamo", "meu nome e", "nome completo:") aceitava
// ate 8 palavras minusculas e escondia o SINTOMA dito depois do nome ("me
// chamo ana e to com o dente mole" chegava ao classificador como "me chamo
// [nome]"). Decisao: o CLASSIFICADOR volta a receber o texto sem mascara de
// nome e de nascimento (o agente ja recebe o texto inteiro do mesmo
// provedor, e esconder sintoma do portao e o risco maior); o VERIFICADOR
// recebe a copia de mascararParaOVerificador: so os nomes que o servidor
// validou no turno E que parecem nome (pareceNomeDePessoa), e o nascimento.
// mascararNomeCompleto e mascararDadosDaColeta (a heuristica da deixa)
// ficam so pelos testes antigos: o turno NAO usa mais, e nenhuma copia que
// vai a um modelo de conformidade pode usar. Nada aqui muda o que o agente
// le, nem a minimizacao de sempre.

/** O marcador do nome completo na copia do classificador e do verificador. */
export const MARCADOR_DO_NOME_COMPLETO = "[nome]";
/** O marcador da data de nascimento na mesma copia. */
export const MARCADOR_DO_NASCIMENTO = "[nascimento]";

const MESES_POR_EXTENSO =
  "janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";

/** A data com ano (dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd, "12 de marco de 1985"). */
const DATA_COM_ANO = new RegExp(
  [
    "(?<![\\p{N}])\\d{1,2}\\s?[/.-]\\s?\\d{1,2}\\s?[/.-]\\s?(?<ano>\\d{4}|\\d{2})(?![\\p{N}])",
    "(?<![\\p{N}])(?<anoIso>\\d{4})-\\d{2}-\\d{2}(?![\\p{N}])",
    `(?<![\\p{N}])\\d{1,2}\\s*(?:º|o)?\\s+de\\s+(?:${MESES_POR_EXTENSO})\\s+(?:de\\s+)?(?<anoExtenso>\\d{4}|\\d{2})(?![\\p{N}])`,
  ].join("|"),
  "giu",
);

/** O ano com dois digitos no seculo que da a data no passado. */
function anoCompleto(texto: string, anoCorrente: number): number {
  const numero = Number(texto);
  if (texto.length === 4) {
    return numero;
  }
  const seculo = Math.floor(anoCorrente / 100) * 100;
  return seculo + numero > anoCorrente ? seculo - 100 + numero : seculo + numero;
}

/** A data com ano no passado (o nascimento) vira MARCADOR_DO_NASCIMENTO. */
export function mascararNascimentos(texto: string, anoCorrente: number): string {
  return texto.replace(DATA_COM_ANO, (trecho, ...args: unknown[]) => {
    const grupos = args[args.length - 1] as Record<string, string | undefined>;
    const ano = grupos.ano ?? grupos.anoIso ?? grupos.anoExtenso;
    return ano !== undefined && anoCompleto(ano, anoCorrente) < anoCorrente
      ? MARCADOR_DO_NASCIMENTO
      : trecho;
  });
}

/** As particulas do nome ("Maria DA Silva"). */
const PARTICULAS_DO_NOME = new Set(["da", "das", "de", "do", "dos", "e", "d'"]);
/** O que encerra o nome depois da deixa ("Maria Souza e nasci em..."). */
const FIM_DO_NOME = new Set([
  "nasci",
  "nascido",
  "nascida",
  "nascimento",
  "data",
  "cpf",
  "carteirinha",
  "rg",
  "telefone",
  "email",
  "tenho",
  "sou",
  "moro",
  "quero",
  "gostaria",
  "preciso",
  "pode",
  "obrigado",
  "obrigada",
]);
/** A deixa antes do nome. */
const DEIXA_DO_NOME =
  /\b(?:meu\s+nome(?:\s+completo)?(?:\s+(?:e|é|eh))?|nome(?:\s+completo)?\s*(?::|-|(?:\s+(?:e|é|eh)))|me\s+chamo|chamo-me)\s*:?\s*/giu;
/** Uma palavra de nome: so letras (com acento), apostrofo e hifen. */
const PALAVRA_DE_NOME = /^[\p{L}][\p{L}'’-]*$/u;
const COMECA_MAIUSCULA = /^\p{Lu}/u;

/** Quantas palavras, no maximo, tem o nome mascarado. */
const MAXIMO_DE_PALAVRAS_DO_NOME_MASCARADO = 8;

type PalavraNoTexto = { texto: string; inicio: number; fim: number };

function palavrasComPosicao(texto: string): PalavraNoTexto[] {
  return [...texto.matchAll(/[^\s,;:.!?()"]+/gu)].map((m) => ({
    texto: m[0],
    inicio: m.index ?? 0,
    fim: (m.index ?? 0) + m[0].length,
  }));
}

/**
 * O nome (as palavras de nome em sequencia, sem pontuacao entre elas) que
 * comeca na palavra `de`. Devolve o fim (no texto) ou null.
 */
function nomeDesde(
  texto: string,
  palavras: readonly PalavraNoTexto[],
  de: number,
  soMaiusculas: boolean,
): { inicio: number; fim: number } | null {
  let fim: number | null = null;
  let contadas = 0;
  let maiusculas = 0;
  for (let i = de; i < palavras.length; i += 1) {
    const palavra = palavras[i];
    if (palavra === undefined || contadas >= MAXIMO_DE_PALAVRAS_DO_NOME_MASCARADO) {
      break;
    }
    const minuscula = palavra.texto.toLocaleLowerCase("pt-BR");
    if (!PALAVRA_DE_NOME.test(palavra.texto) || FIM_DO_NOME.has(minuscula)) {
      break;
    }
    const anterior = palavras[i - 1];
    // Pontuacao entre as palavras encerra o nome.
    if (
      i > de &&
      anterior !== undefined &&
      /[,;:.!?()\n]/.test(texto.slice(anterior.fim, palavra.inicio))
    ) {
      break;
    }
    const particula = PARTICULAS_DO_NOME.has(minuscula);
    if (soMaiusculas && !particula && !COMECA_MAIUSCULA.test(palavra.texto)) {
      break;
    }
    contadas += 1;
    if (!particula) {
      maiusculas += 1;
      fim = palavra.fim;
    }
  }
  const primeira = palavras[de];
  return fim === null || primeira === undefined || maiusculas < 2
    ? null
    : { inicio: primeira.inicio, fim };
}

/**
 * O nome completo dito no turno da coleta vira MARCADOR_DO_NOME_COMPLETO: o
 * que vem depois da deixa ("meu nome e Maria da Silva Souza"), e o nome em
 * maiusculas (duas palavras ou mais) logo antes do nascimento ja mascarado
 * ("Maria da Silva Souza, [nascimento]"). Use depois de mascararNascimentos.
 *
 * NAO use numa copia que vai ao classificador ou ao verificador (revisao
 * curta, achado 1): a deixa engole o sintoma dito depois do nome. Para o
 * verificador, mascararParaOVerificador.
 */
export function mascararNomeCompleto(texto: string): string {
  const trechos: { inicio: number; fim: number }[] = [];
  const palavras = palavrasComPosicao(texto);
  const indiceDaPalavra = (posicao: number) =>
    palavras.findIndex((p) => p.inicio >= posicao);
  for (const m of texto.matchAll(DEIXA_DO_NOME)) {
    const depois = (m.index ?? 0) + m[0].length;
    const indice = indiceDaPalavra(depois);
    if (indice >= 0) {
      const nome = nomeDesde(texto, palavras, indice, false);
      if (nome !== null) {
        trechos.push(nome);
      }
    }
  }
  // O nome em maiusculas encostado no nascimento (antes dele, com virgula,
  // hifen ou "nascido em" no meio).
  let de = 0;
  for (;;) {
    const achou = texto.indexOf(MARCADOR_DO_NASCIMENTO, de);
    if (achou < 0) {
      break;
    }
    de = achou + MARCADOR_DO_NASCIMENTO.length;
    const antes = texto
      .slice(0, achou)
      .replace(/(?:\s*[,;-]\s*|\s+)(?:nascid[oa]s?\s+(?:em|no dia|dia)\s*)?$/iu, "");
    const fimDoAntes = antes.length;
    const daFrente = palavrasComPosicao(antes);
    for (let i = 0; i < daFrente.length; i += 1) {
      const nome = nomeDesde(antes, daFrente, i, true);
      if (nome !== null && nome.fim === fimDoAntes) {
        trechos.push(nome);
        break;
      }
    }
  }
  if (trechos.length === 0) {
    return texto;
  }
  let saida = "";
  let posicao = 0;
  for (const trecho of [...trechos].sort((a, b) => a.inicio - b.inicio)) {
    if (trecho.inicio < posicao) {
      continue;
    }
    saida += texto.slice(posicao, trecho.inicio) + MARCADOR_DO_NOME_COMPLETO;
    posicao = trecho.fim;
  }
  return saida + texto.slice(posicao);
}

/** Minusculo, sem acento e com os brancos juntados, com o mapa de volta. */
function semAcentoComMapa(texto: string): { texto: string; origem: number[] } {
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
    for (const parte of caractere
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()) {
      normal += parte;
      origem.push(indice);
    }
    ultimoBranco = false;
    indice += tamanho;
  }
  return { texto: normal, origem };
}

/**
 * Os trechos citados (o nome que o agente registrou no turno) viram o
 * marcador onde aparecem no texto, sem diferenciar maiusculas, acentos e
 * brancos, com borda de palavra.
 */
export function mascararTrechosCitados(
  texto: string,
  trechos: readonly string[],
  marcador: string,
): string {
  let saida = texto;
  // O mais comprido primeiro ("Fulano da Silva Souza" antes de "da Silva
  // Souza").
  const emOrdem = [...trechos].sort((a, b) => b.length - a.length);
  for (const trecho of emOrdem) {
    const procurado = semAcentoComMapa(trecho).texto.trim();
    if (Array.from(procurado).length < 3) {
      continue;
    }
    for (let voltas = 0; voltas < 20; voltas += 1) {
      const { texto: normal, origem } = semAcentoComMapa(saida);
      let achou = -1;
      for (
        let de = normal.indexOf(procurado);
        de >= 0;
        de = normal.indexOf(procurado, de + 1)
      ) {
        const antes = de > 0 ? normal[de - 1] : " ";
        const depois =
          de + procurado.length < normal.length
            ? normal[de + procurado.length]
            : " ";
        if (!/[\p{L}\p{N}]/u.test(antes ?? "") && !/[\p{L}\p{N}]/u.test(depois ?? "")) {
          achou = de;
          break;
        }
      }
      if (achou < 0) {
        break;
      }
      const inicio = origem[achou] ?? 0;
      const ultimo = origem[achou + procurado.length - 1] ?? inicio;
      const fim = ultimo + ((saida.codePointAt(ultimo) ?? 0) > 0xffff ? 2 : 1);
      saida = saida.slice(0, inicio) + marcador + saida.slice(fim);
    }
  }
  return saida;
}

/**
 * O nascimento e o nome completo mascarados pela heuristica da deixa (e os
 * nomes citados, quando quem chama sabe).
 *
 * NAO use numa copia que vai ao classificador ou ao verificador (revisao
 * curta, achado 1): a heuristica engole o sintoma dito depois do nome. O
 * turno usa mascararParaOVerificador.
 */
export function mascararDadosDaColeta(
  texto: string,
  entrada: { anoCorrente: number; nomes?: readonly string[] },
): string {
  const semNascimento = mascararNascimentos(texto, entrada.anoCorrente);
  return mascararTrechosCitados(
    mascararNomeCompleto(semNascimento),
    entrada.nomes ?? [],
    MARCADOR_DO_NOME_COMPLETO,
  );
}

// ---------------------------------------------------------------------------
// Revisao curta das correcoes da AG3 (achado 1): a copia do verificador
// ---------------------------------------------------------------------------

/** Quantas palavras, no minimo e no maximo, tem o nome que pode sumir. */
const PALAVRAS_DO_NOME_QUE_SOME = { minimo: 2, maximo: 6 } as const;

/** Uma palavra de nome: so letras, com apostrofo ou hifen entre elas. */
const SO_LETRAS = /^\p{L}+(?:['’-]\p{L}+)*$/u;

/**
 * O que um nome de pessoa nunca tem: verbo e palavra de funcao (artigo,
 * preposicao, pronome, adverbio de tempo). Sem acento e minusculo. E por
 * aqui que "ana e to com o dente mole" e "carla mendes e tomo remedio pra
 * pressao" deixam de ser nome, mesmo que o modelo mande registrar e o
 * servidor ache o trecho na mensagem. Nomes que tambem sao palavras comuns
 * (Rosa, Luz, Paz, das Dores, do Socorro, Dias, Ramos) ficam de fora da
 * lista de proposito.
 */
const NUNCA_E_NOME: ReadonlySet<string> = new Set([
  // os verbos e as palavras da decisao
  "estou",
  "to",
  "tou",
  "tenho",
  "tomo",
  "uso",
  "sinto",
  "com",
  "sem",
  "que",
  "pra",
  "meu",
  "minha",
  "um",
  "uma",
  // os mesmos verbos em outras formas, e os que contam do corpo
  "esta",
  "estava",
  "estive",
  "estamos",
  "estao",
  "ta",
  "tava",
  "fico",
  "fiquei",
  "ficou",
  "sou",
  "era",
  "fui",
  "foi",
  "fiz",
  "faco",
  "tinha",
  "tive",
  "tem",
  "teve",
  "tomei",
  "tomando",
  "toma",
  "usei",
  "usando",
  "usa",
  "senti",
  "sentindo",
  "sente",
  "sentir",
  "doi",
  "doendo",
  "operei",
  "amamento",
  "amamentando",
  "posso",
  "pode",
  "quero",
  "queria",
  "gostaria",
  "preciso",
  "vou",
  "vai",
  "nasci",
  // palavras de funcao
  "pro",
  "pras",
  "pros",
  "para",
  "por",
  "pela",
  "pelo",
  "meus",
  "minhas",
  "uns",
  "umas",
  "o",
  "a",
  "os",
  "as",
  "no",
  "na",
  "nos",
  "nas",
  "num",
  "numa",
  "em",
  "ao",
  "aos",
  "eu",
  "ele",
  "ela",
  "me",
  "mim",
  "se",
  "nao",
  "mas",
  "ja",
  "ainda",
  "desde",
  "ontem",
  "hoje",
  "amanha",
  "agora",
  "muito",
  "muita",
  "todo",
  "toda",
  "tudo",
  "isso",
  "esse",
  "essa",
  "aqui",
]);

/** As particulas que nao contam como palavra do nome ("Maria DA Silva"). */
const PARTICULAS_QUE_NAO_CONTAM: ReadonlySet<string> = new Set([
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "d",
]);

function palavraSemAcento(palavra: string): string {
  return palavra.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Revisao curta das correcoes da AG3 (achado 1): o trecho parece nome de
 * pessoa? De 2 a 6 palavras, cada uma so de letras (apostrofo e hifen entre
 * letras valem: D'Avila, Ana-Maria), nenhuma verbo nem palavra de funcao
 * (NUNCA_E_NOME) e pelo menos duas que nao sao particula. So o nome que
 * passa aqui pode sumir da copia do verificador.
 */
export function pareceNomeDePessoa(nome: string): boolean {
  const palavras = nome.trim().split(/\s+/u).filter((p) => p !== "");
  if (
    palavras.length < PALAVRAS_DO_NOME_QUE_SOME.minimo ||
    palavras.length > PALAVRAS_DO_NOME_QUE_SOME.maximo
  ) {
    return false;
  }
  let palavrasDeNome = 0;
  for (const palavra of palavras) {
    if (!SO_LETRAS.test(palavra)) {
      return false;
    }
    const simples = palavraSemAcento(palavra);
    if (NUNCA_E_NOME.has(simples)) {
      return false;
    }
    if (!PARTICULAS_QUE_NAO_CONTAM.has(simples)) {
      palavrasDeNome += 1;
    }
  }
  return palavrasDeNome >= 2;
}

/**
 * Revisao curta das correcoes da AG3 (achado 1): a copia que vai ao
 * VERIFICADOR (o rascunho e as mensagens do paciente). Some so o nascimento
 * (a data com ano no passado) e os nomes que o servidor validou no turno e
 * que parecem nome (pareceNomeDePessoa, conferido aqui de novo); o resto,
 * sintoma inclusive, chega como esta. Nunca heuristica de deixa.
 */
export function mascararParaOVerificador(
  texto: string,
  entrada: { anoCorrente: number; nomesValidados: readonly string[] },
): string {
  const nomes = entrada.nomesValidados.filter(pareceNomeDePessoa);
  return mascararNascimentos(
    mascararTrechosCitados(texto, nomes, MARCADOR_DO_NOME_COMPLETO),
    entrada.anoCorrente,
  );
}
