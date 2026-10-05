// Camada deterministica do filtro de conformidade (CLAUDE.md 3.2). PURO.
//
// So BLOQUEIA. Nunca aprova sozinha: o rascunho que passa limpo por aqui
// ainda vai ao verificador por modelo (filtro.ts). Roda primeiro porque e
// gratis, instantaneo e nao pode ser convencido por uma injecao.
//
// Alem dos padroes por categoria (padroes.ts), aqui moram as regras que
// dependem do contexto do turno:
//  - preco: todo valor em reais do rascunho tem de estar entre os precos que
//    buscar_procedimento devolveu NESTE turno (centavos exatos). Moeda
//    estrangeira, valor por extenso ou ilegivel bloqueiam.
//  - formato: dado pessoal (a mesma deteccao de minimizar.ts), texto longo,
//    vazio, ou escrito para enganar (alfabeto estranho, invisivel, zalgo,
//    letra fora de [a-z], simbolo grudado entre letras, letras soltas,
//    emoji de remedio ou de bebida, contato escrito por extenso).
//  - contexto clinico: se o paciente falou de sintoma ou de assunto clinico,
//    nenhum rascunho passa (o portao de entrada ja devia ter escalado).
//  - catalogo: o nome exato do procedimento sai das visoes (para "Tratamento
//    da dor lombar" nao cair como triagem), MAS promessa, oferta casada e
//    antes e depois rodam tambem no texto sem mascara: "Botox sem dor" ou
//    "Peeling resultado garantido" cadastrado pela clinica continua sendo
//    promessa (o cadastro do nome e validado no E5).

import {
  CATEGORIAS_DE_CONFORMIDADE,
  ordenarPorPrioridade,
  type CategoriaDeConformidade,
} from "@/lib/domain/conformidade/categorias";
import { gatilhosDosTextos } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import { temDadoPessoal } from "@/lib/domain/conformidade/minimizar";
import {
  compactarComInicios,
  type Compacto,
  distanciaDeEdicao,
  FONTES_DA_NORMALIZACAO,
  frasesDasVisoes,
  neutralizador,
  ocorreNoInicioDePalavra,
  sinaisDeOfuscacao,
  temLetraForaDoAlfabeto,
  temLetrasSoltas,
  temSimboloEntreLetras,
  visoesDoTexto,
  type VisoesDoTexto,
} from "@/lib/domain/conformidade/normalizar";
import {
  CONTEXTO_CLINICO,
  LEXICO_APROXIMADO,
  LEXICO_COMPACTO,
  NEUTRALIZACOES_DE_SAIDA,
  PADROES_DE_SAIDA,
} from "@/lib/domain/conformidade/padroes";

/** Rascunho acima disso e formato invalido (plano de seguranca 2.2). */
export const LIMITE_DO_RASCUNHO = 700;

export type ContextoDasRegras = {
  /** price_cents que buscar_procedimento devolveu neste turno. */
  precosDoTurno: readonly number[];
  /**
   * Nomes exatos do catalogo da clinica (procedimento, vinculo, convenio),
   * mascarados antes de casar os padroes.
   */
  nomesDoCatalogo: readonly string[];
  /** So as mensagens do paciente ainda nao respondidas. */
  mensagensDoPaciente: readonly string[];
};

export type AchadoDaRegra = {
  categoria: Exclude<CategoriaDeConformidade, "falha_verificador">;
  /** Nome da regra (nunca o trecho do texto). */
  regra: string;
};

export type ResultadoDasRegras = {
  /** Categorias que dispararam, em ordem de prioridade. Vazia = limpo. */
  categorias: CategoriaDeConformidade[];
  achados: AchadoDaRegra[];
};

// ---------------------------------------------------------------------------
// Preco
// ---------------------------------------------------------------------------

const NUMERO = "\\d(?:[\\d.,]*\\d)?";

/**
 * Valor escrito em reais para centavos. Aceita "1.500,00", "150,00", "150",
 * "1500", "1,500.00" e "150.00". Qualquer outra forma devolve null (e o
 * filtro bloqueia: valor que nao da para conferir nao sai).
 */
export function centavosDoValor(texto: string): number | null {
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(texto)) {
    return paraCentavos(texto.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d+(?:,\d{1,2})?$/.test(texto)) {
    return paraCentavos(texto.replace(",", "."));
  }
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(texto)) {
    return paraCentavos(texto.replace(/,/g, ""));
  }
  if (/^\d+\.\d{1,2}$/.test(texto)) {
    return paraCentavos(texto);
  }
  return null;
}

function paraCentavos(decimal: string): number | null {
  const [inteiro = "", fracao = ""] = decimal.split(".");
  if (!/^\d+$/.test(inteiro) || !/^\d{0,2}$/.test(fracao)) {
    return null;
  }
  return Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
}

export type ValoresDoTexto = {
  centavos: number[];
  /** Valor em reais que nao da para ler (por extenso, "1 mil", sem numero). */
  ilegivel: boolean;
  /** Dolar, euro, libra. */
  estrangeiro: boolean;
};

const EXTENSO =
  "(?:vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzent(?:os|as|inhos)|trezent(?:os|as|inhos)|quatrocent(?:os|as)|quinhent(?:os|as|inhos)|seiscent(?:os|as)|setecent(?:os|as)|oitocent(?:os|as)|novecent(?:os|as)|mil)";

// O numero sem "R$" e sem "reais" so e lido como preco depois de quem diz
// valor (revisao de precisao de 05/10/2026). Preco nao tem segunda trava: o
// verificador por modelo nunca julga valor (categorias.ts), entao o que
// passar daqui sai. Mesmo assim, "por 2 motivos", "1 por semana" e "Sessao
// 2 confirmada" nao sao dinheiro.

// Verbo ou nome que diz valor: qualquer numero depois dele e preco.
const PALAVRA_DE_PRECO =
  "(?:custa|custam|custando|custaria|custar|valor|valores|preco|precos|cobra|cobram|cobramos|cobro|investimento|pague|paga|pagar|total|sai|saem|saindo|faco|fazemos|deixo)";

// Verbo de ligacao e quem tem preco seguido de verbo ou sinal ("fica 199",
// "ta 199", "da 199", "deu 199", "sao 199 a consulta", "vai ser 199", "a consulta e
// 199", "Consulta: 300", "consulta = 199", "a consulta, 199", "consulta -
// 199", "o [marcador] e 300", com o nome do catalogo mascarado). Aqui o
// numero precisa de dois digitos ou mais: "a sessao e 1 por semana" nao.
const LIGACAO_DE_PRECO =
  "(?:fica|ficam|ficaria|ta|esta|eh|da|deu|sao|vai ser|vai sair|sera|seria|faz)";
const SUJEITO_DE_PRECO =
  "(?:\\u00a7|\\b(?:consultas?|sessao|sessoes|retorno|avaliacao|particular|procedimento|aplicacao|limpeza|peeling|toxina|botox|preenchimento|pacote))(?:\\s*[:=,]|\\s+-|\\s+(?:e|eh|por)\\b)";

const GATILHO_FORTE = `\\b${PALAVRA_DE_PRECO}\\b`;
const GATILHO_FRACO = `(?:\\b${LIGACAO_DE_PRECO}\\b|${SUJEITO_DE_PRECO})`;
const GATILHO_DE_PRECO = `(?:${GATILHO_FORTE}|${GATILHO_FRACO})`;

// "Consulta 1 e 99" e "Consulta 1.99": reais e centavos separados por "e"
// ou por ponto, logo depois de um item no singular ("sessoes 10 e 11" sao
// numeros de sessao; "10.30h" e hora).
const REAIS_E_CENTAVOS =
  "(?:\\u00a7|\\b(?:consulta|avaliacao|peeling|toxina|botox|limpeza|preenchimento))\\s+\\d{1,4}(?: e |\\.)\\d{2}\\b(?! de |\\s*h\\b)";

// "199 a consulta." no comeco da frase. O ponto seguido de digito e
// separador de milhar, nao fim de frase: "R$ 2.400 a sessao" nao e "400 a
// sessao" (bug medido no conjunto cego 1, 05/10/2026).
const PRECO_ANTES_DO_SUJEITO =
  "(?:^|[.!?;:](?!\\d)\\s*)(\\d{2,}(?:[\\d.,]*\\d)?)\\s+(?:a|o|cada|por)\\s+(?:\\u00a7|consultas?|sessao|sessoes|retorno|avaliacao|procedimento|aplicacao|limpeza|peeling|toxina|botox|preenchimento|pacote)\\b";

const CONECTOR =
  "(?:\\s+(?:e|de|em|por|a|o|apenas|so|somente|total|r\\$|fica|sai))*";

// O numero depois da palavra de preco nao e preco quando vem com unidade de
// tempo, quantidade, lugar ou data ("fica em 15 minutos", "sai em 3 dias",
// "deixar 2 horarios", "fica no 3o andar", "fica 9h30", "sessao 2 de 5").
const UNIDADES_QUE_NAO_SAO_DINHEIRO =
  "h\\d{0,2}\\b|hs\\b|horas?|min|minutos?|minutinhos|dias?|semanas?|meses|mes\\b|anos?|sessoes|sessao|vez\\b|vezes|x\\b|%|pessoas?|aplicacoes|areas|unidades|ml|mg|kg\\b|quilos|metros|km\\b|quilometros|andar|salas?|horarios?|vagas?|opcoes|consultas?|procedimentos?|retornos?|pacientes?|profissionais|medic|convenios?|lugares|motivos?|graus?|segundos?|andares|as\\b|ate\\b|:|/|de \\d|em \\d|por (?:semana|mes|dia|ano|sessao|vez|pessoa)|da (?:manha|tarde|noite)|de (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)";

const NAO_E_DINHEIRO = `(?![ao]\\b)(?!\\s*(?:${UNIDADES_QUE_NAO_SAO_DINHEIRO}))`;

// Valor da parcela ("10x de 150", "em 3 vezes de R$ 400", "parcelas de
// 120", "ou 3 de 400"): o parcelamento simples e permitido (politica da
// fase controlada, 05/10/2026), mas o valor da parcela e preco e tem de
// estar no turno. Sem "x" nem "vezes", o valor precisa de dois digitos ou
// mais ("ou 3 de 400"; "a sessao 2 de 5" nao e parcela).
const VALOR_DA_PARCELA = `(?:\\b\\d{1,2} ?(?:x|vezes)|\\bparcelas?)(?: sem juros| fixas| iguais| mensais)? (?:de|por) (?:r\\$ ?)?(${NUMERO})(?!\\d|[.,]\\d)${NAO_E_DINHEIRO}|\\b(?:ou|em|ate) \\d{1,2} (?:de|por) (?:r\\$ ?)?(\\d{2,}(?:[\\d.,]*\\d)?)(?!\\d|[.,]\\d)${NAO_E_DINHEIRO}`;

// O mesmo para o valor por extenso, que pode ter varias partes ("vinte e
// cinco minutos").
const EXTENSO_NAO_E_DINHEIRO = `(?!(?:\\s+e\\s+[a-z]+)*\\s*(?:${UNIDADES_QUE_NAO_SAO_DINHEIRO}))`;

/** Todos os valores em dinheiro do texto (visao base, ja mascarada). */
export function valoresEmDinheiro(base: string): ValoresDoTexto {
  const centavos: number[] = [];
  let ilegivel = false;

  const registrar = (numero: string | undefined, sufixo?: string) => {
    if (numero === undefined || (sufixo !== undefined && sufixo !== "")) {
      ilegivel = true;
      return;
    }
    const valor = centavosDoValor(numero);
    if (valor === null) {
      ilegivel = true;
    } else {
      centavos.push(valor);
    }
  };

  // R$ 150,00 / r$150 / rs 150 / brl 150 (e "R$ 1 mil", que nao da para ler)
  for (const m of base.matchAll(
    new RegExp(
      `(?:r\\s?\\$|\\brs(?=\\s?\\d)|\\bbrl\\b)\\s*(${NUMERO})?(\\s*(?:mil|milhao|milhoes|k)\\b)?`,
      "g",
    ),
  )) {
    registrar(m[1], m[2]?.trim() ?? "");
  }
  // 150 reais / 1 real / 150 contos (e "cento e cinquenta reais")
  for (const m of base.matchAll(
    new RegExp(
      `(?:(${NUMERO})(\\s+mil)?\\s*)?\\b(reais|real|contos?|pilas?)\\b`,
      "g",
    ),
  )) {
    const palavra = m[3];
    if (m[1] === undefined && palavra === "real") {
      continue; // "caso real", "resultado real": nao e moeda
    }
    registrar(m[1], m[2]?.trim() ?? "");
  }
  // 150,00 sem simbolo (virgula com dois decimais)
  for (const m of base.matchAll(
    /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?![\d])/g,
  )) {
    registrar(`${m[1]},${m[2]}`);
  }
  // "custa 150", "faco por 150", "valor de 250", "a consulta e 199."
  // O numero pode terminar em ponto ou virgula de fim de frase.
  for (const [gatilho, umDigitoVale] of [
    [GATILHO_FORTE, true],
    [GATILHO_FRACO, false],
  ] as const) {
    for (const m of base.matchAll(
      new RegExp(
        `${gatilho}${CONECTOR}\\s+(${NUMERO})(?!\\d|[.,]\\d)${NAO_E_DINHEIRO}`,
        "g",
      ),
    )) {
      if (umDigitoVale || !/^\d$/.test(m[1] ?? "")) {
        registrar(m[1]);
      }
    }
  }
  for (const m of base.matchAll(new RegExp(PRECO_ANTES_DO_SUJEITO, "g"))) {
    registrar(m[1]);
  }
  for (const m of base.matchAll(new RegExp(VALOR_DA_PARCELA, "g"))) {
    registrar(m[1] ?? m[2]);
  }
  if (new RegExp(REAIS_E_CENTAVOS).test(base)) {
    ilegivel = true;
  }
  // "custa duzentos e cinquenta", "por duzentinhos", "da uns cento e
  // cinquenta"
  if (
    new RegExp(
      `(?:${GATILHO_DE_PRECO}${CONECTOR}\\s+(?:uns |umas )?|\\bda (?:uns|umas) )${EXTENSO}\\b${EXTENSO_NAO_E_DINHEIRO}`,
    ).test(base)
  ) {
    ilegivel = true;
  }

  const estrangeiro =
    /(?<!\br ?)\$|\busd\b|\beur\b|[\u20ac\u00a3\u00a5]|\bdolar|\bdollar|\beuro/.test(
      base,
    );

  return { centavos, ilegivel, estrangeiro };
}

function regraDePreco(
  base: string,
  precosDoTurno: readonly number[],
): AchadoDaRegra[] {
  const valores = valoresEmDinheiro(base);
  const achados: AchadoDaRegra[] = [];
  if (valores.estrangeiro) {
    achados.push({
      categoria: "preco_nao_verificado",
      regra: "moeda_estrangeira",
    });
  }
  if (valores.ilegivel) {
    achados.push({
      categoria: "preco_nao_verificado",
      regra: "valor_ilegivel",
    });
  }
  const permitidos = new Set(precosDoTurno);
  if (valores.centavos.some((valor) => !permitidos.has(valor))) {
    achados.push({
      categoria: "preco_nao_verificado",
      regra: "valor_fora_do_turno",
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// Avaliacao
// ---------------------------------------------------------------------------

function limiteDeAproximacao(termo: string): number {
  if (termo.length >= 11) {
    return 2;
  }
  return termo.length >= 7 ? 1 : 0;
}

/**
 * Categorias que tambem rodam no texto SEM a mascara do catalogo: o nome que
 * a clinica cadastrou nao pode carregar promessa, oferta casada ou antes e
 * depois para dentro da resposta. Triagem, diagnostico, medicamento, dosagem
 * e orientacao continuam mascarados ("Tratamento da dor lombar").
 */
const CATEGORIAS_SEM_MASCARA: ReadonlySet<AchadoDaRegra["categoria"]> = new Set(
  ["promessa_resultado", "oferta_casada", "antes_depois"],
);

// Emoji que diz remedio, injecao, gelo, bebida, cigarro ou urgencia. O sol
// fica de fora (cumprimento "bom dia" usa); ele so conta como habito, em
// "evita sol" (padroes.ts).
const EMOJI_CLINICO =
  /[\u{1f48a}\u{1f489}\u{1f9ca}\u{1f37a}\u{1f37b}\u{1f377}\u{1f378}\u{1f379}\u{1f942}\u{1f6ac}\u{1fa79}\u{1fa78}\u{1f321}\u{1f691}]/u;

// Contato escrito por extenso: quatro ou mais digitos por extenso seguidos
// ("nove nove nove nove") ou seis ou mais itens misturando digito e digito
// por extenso ("9 nove 9 nove 0 zero").
const DIGITO_POR_EXTENSO =
  "(?:zero|um|dois|tres|quatro|cinco|seis|sete|oito|nove)";
const SEQUENCIA_DE_DIGITOS = new RegExp(
  `(?<![a-z0-9])(?:${DIGITO_POR_EXTENSO}|\\d)(?:[\\s,;.-]+(?:${DIGITO_POR_EXTENSO}|\\d))+(?![a-z0-9])`,
  "g",
);

// CNPJ com mascara (a chave pix da clinica) nao e dado pessoal: e de pessoa
// juridica (revisao de precisao de 05/10/2026). CPF, telefone, CEP e numero
// longo sem mascara continuam bloqueando.
const CNPJ_COM_MASCARA =
  /(?<![\d./-])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?!\d|[.,/-]\d)/g;

function temDadoPessoalAlemDoCnpj(texto: string): boolean {
  return temDadoPessoal(texto.replace(CNPJ_COM_MASCARA, " "));
}

// Expressao permitida ("garantir sua vaga", "100% preenchidos", "sinal de
// R$ 200", "cortesia do estacionamento"), trocada antes dos padroes.
const neutralizarSaida = neutralizador(NEUTRALIZACOES_DE_SAIDA);

/**
 * As regras que vivem em codigo (preco, formato estrutural, catalogo sem
 * mascara, expressoes permitidas), para a versao das regras (filtro.ts)
 * mudar quando elas mudarem.
 */
export const FONTES_DAS_REGRAS_EM_CODIGO: readonly string[] = [
  NUMERO,
  EXTENSO,
  GATILHO_DE_PRECO,
  PRECO_ANTES_DO_SUJEITO,
  VALOR_DA_PARCELA,
  REAIS_E_CENTAVOS,
  CONECTOR,
  NAO_E_DINHEIRO,
  EXTENSO_NAO_E_DINHEIRO,
  EMOJI_CLINICO.source,
  SEQUENCIA_DE_DIGITOS.source,
  [...CATEGORIAS_SEM_MASCARA].join(","),
  CNPJ_COM_MASCARA.source,
  ...NEUTRALIZACOES_DE_SAIDA.map(({ nome, fonte, troca }) =>
    [nome, fonte, troca].join(" "),
  ),
  ...FONTES_DA_NORMALIZACAO,
];

export function temContatoPorExtenso(base: string): boolean {
  for (const m of base.matchAll(SEQUENCIA_DE_DIGITOS)) {
    const itens = m[0].split(/[\s,;.-]+/).filter((item) => item !== "");
    const palavras = itens.filter((item) => !/^\d$/.test(item)).length;
    const digitos = itens.length - palavras;
    if (palavras >= 4 && digitos === 0) {
      return true;
    }
    if (itens.length >= 6 && palavras >= 1 && digitos >= 1) {
      return true;
    }
  }
  return false;
}

function frasesPara(
  categoria: AchadoDaRegra["categoria"],
  comMascara: readonly string[],
  semMascara: readonly string[],
): readonly string[] {
  return CATEGORIAS_SEM_MASCARA.has(categoria)
    ? [...comMascara, ...semMascara]
    : comMascara;
}

function compactosPara(
  categoria: AchadoDaRegra["categoria"],
  comMascara: VisoesDoTexto,
  semMascara: VisoesDoTexto,
): readonly VisoesDoTexto[] {
  return CATEGORIAS_SEM_MASCARA.has(categoria)
    ? [comMascara, semMascara]
    : [comMascara];
}

/**
 * Avalia o rascunho contra todas as regras. Devolve as categorias que
 * dispararam (vazia = nenhuma regra achou nada; isso NAO e aprovacao).
 */
export function avaliarRegras(
  rascunho: string,
  contexto: ContextoDasRegras,
): ResultadoDasRegras {
  const achados: AchadoDaRegra[] = [];
  const visoes = visoesDoTexto(
    rascunho,
    contexto.nomesDoCatalogo,
    neutralizarSaida,
  );
  const semMascara =
    contexto.nomesDoCatalogo.length > 0
      ? visoesDoTexto(rascunho, [], neutralizarSaida)
      : visoes;
  const frases = frasesDasVisoes(visoes);
  const frasesSemMascara = frasesDasVisoes(semMascara);

  // Formato bruto: vazio, longo e sinais de ofuscacao.
  if (rascunho.trim() === "") {
    achados.push({ categoria: "formato_invalido", regra: "vazio" });
  }
  if (Array.from(rascunho).length > LIMITE_DO_RASCUNHO) {
    achados.push({ categoria: "formato_invalido", regra: "longo" });
  }
  const sinais = sinaisDeOfuscacao(rascunho);
  if (sinais.alfabetoEstranho) {
    achados.push({ categoria: "formato_invalido", regra: "alfabeto_estranho" });
  }
  if (sinais.invisivel) {
    achados.push({
      categoria: "formato_invalido",
      regra: "caractere_invisivel",
    });
  }
  if (sinais.marcasEmpilhadas) {
    achados.push({ categoria: "formato_invalido", regra: "marcas_empilhadas" });
  }
  // Estruturais: nao dependem de lista, e a recepcao nunca escreve assim.
  if (temLetraForaDoAlfabeto(visoes.base)) {
    achados.push({
      categoria: "formato_invalido",
      regra: "letra_fora_do_alfabeto",
    });
  }
  if (temSimboloEntreLetras(visoes.base)) {
    achados.push({
      categoria: "formato_invalido",
      regra: "simbolo_entre_letras",
    });
  }
  if (temLetrasSoltas(visoes.base)) {
    achados.push({ categoria: "formato_invalido", regra: "letras_soltas" });
  }
  if (EMOJI_CLINICO.test(rascunho)) {
    achados.push({ categoria: "formato_invalido", regra: "emoji_clinico" });
  }
  if (
    temDadoPessoalAlemDoCnpj(visoes.base) ||
    temDadoPessoalAlemDoCnpj(visoes.despacado)
  ) {
    achados.push({ categoria: "formato_invalido", regra: "dado_pessoal" });
  }
  if (temContatoPorExtenso(visoes.base)) {
    achados.push({
      categoria: "formato_invalido",
      regra: "contato_por_extenso",
    });
  }
  if (/www|http|bitly/.test(visoes.soLetras)) {
    achados.push({ categoria: "formato_invalido", regra: "url_espacada" });
  }

  // Padroes por categoria, em todas as visoes. Remedio tambem na visao que
  // le "1" e "|" como "l" ("Trama1", "Dorf1ex").
  for (const padrao of PADROES_DE_SAIDA) {
    const alvos =
      padrao.categoria === "medicamento"
        ? [...frases, visoes.leetComL]
        : frasesPara(padrao.categoria, frases, frasesSemMascara);
    if (alvos.some((frase) => padrao.regex.test(frase))) {
      achados.push({ categoria: padrao.categoria, regra: padrao.nome });
    }
  }

  // Lexico forte na visao compacta (e na que le "1" e "|" como "l"). O
  // lexico ancorado no inicio da palavra precisa saber onde cada palavra
  // comecava.
  const compactos = new Map<string, Compacto>();
  const comInicios = (leet: string) => {
    const pronto = compactos.get(leet);
    if (pronto) {
      return pronto;
    }
    const novo = compactarComInicios(leet);
    compactos.set(leet, novo);
    return novo;
  };
  const jaAchados = new Set<string>();
  for (const entrada of LEXICO_COMPACTO) {
    const regra = `compacto:${entrada.categoria}`;
    if (jaAchados.has(regra)) {
      continue;
    }
    const alvos = compactosPara(entrada.categoria, visoes, semMascara);
    const achou = alvos.some((alvo) =>
      [
        [alvo.leet, alvo.compacto],
        [alvo.leetComL, alvo.compactoComL],
      ].some(([leet = "", compacto = ""]) =>
        entrada.soNoInicioDePalavra
          ? ocorreNoInicioDePalavra(comInicios(leet), entrada.termo)
          : compacto.includes(entrada.termo),
      ),
    );
    if (achou) {
      jaAchados.add(regra);
      achados.push({ categoria: entrada.categoria, regra });
    }
  }

  // Nome de remedio escrito de tras para frente ("anoripid").
  const invertidos = [visoes.compacto, visoes.compactoComL].map((compacto) =>
    [...compacto].reverse().join(""),
  );
  if (
    LEXICO_COMPACTO.some(
      (entrada) =>
        entrada.categoria === "medicamento" &&
        entrada.termo.length >= 7 &&
        invertidos.some((invertido) => invertido.includes(entrada.termo)),
    )
  ) {
    achados.push({ categoria: "medicamento", regra: "invertido:medicamento" });
  }

  // Nome de remedio (ou promessa) mal escrito.
  for (const { categoria, termo } of LEXICO_APROXIMADO) {
    const limite = limiteDeAproximacao(termo);
    const palavras = new Set(
      compactosPara(categoria, visoes, semMascara).flatMap((alvo) => [
        ...(alvo.leet.match(/[a-z]{6,}/g) ?? []),
        ...(alvo.leetComL.match(/[a-z]{6,}/g) ?? []),
      ]),
    );
    for (const palavra of palavras) {
      if (
        Math.abs(palavra.length - termo.length) <= limite &&
        distanciaDeEdicao(palavra, termo) <= limite
      ) {
        achados.push({ categoria, regra: `aproximado:${categoria}` });
        break;
      }
    }
  }

  // Preco: so na visao base (numero tem de continuar numero).
  achados.push(...regraDePreco(visoes.base, contexto.precosDoTurno));

  // Contexto: o paciente falou de saude.
  for (const gatilho of gatilhosDosTextos(contexto.mensagensDoPaciente)) {
    const categoria = CONTEXTO_CLINICO.get(gatilho);
    if (categoria) {
      achados.push({ categoria, regra: `contexto:${gatilho}` });
    }
  }

  return {
    categorias: ordenarPorPrioridade(
      CATEGORIAS_DE_CONFORMIDADE,
      achados.map((achado) => achado.categoria),
    ),
    achados,
  };
}
