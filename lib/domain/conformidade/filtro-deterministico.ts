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
//  - fatos do turno (AG2, fatos-do-turno.ts): data e hora, endereco,
//    convenio e acao de agenda so com fato do turno. Entrada OPCIONAL, como
//    o molde do preco: o turno da IA passa os fatos e a regra vale; os
//    textos estaticos conferidos na publicacao da Tela 6
//    (problemaNoTextoDoAgente), o nome da clinica e a retomada do envio nao
//    passam, e para eles nada muda. Revisao da AG2: o endereco que uma
//    ferramenta do turno trouxe ("Rua das Dores, 100") e nome de lugar e sai
//    so das vedacoes clinicas que a mascara do catalogo cobre, como o nome
//    do catalogo (trechosDeEnderecoDasFerramentas); o resto do rascunho
//    continua lido.
//  - [AG7 preparo] o trecho do preparo: com os textos de preparo da
//    clinica (textosDePreparo, opcional como os fatos), a resposta que copia
//    uma frase de um deles e orientacao clinica (trechoDePreparoNaResposta,
//    lib/domain/preparo.ts). O texto aprovado pelo RT sai pelo sistema,
//    palavra por palavra (D-80); pelo modelo, nunca.

import {
  CATEGORIAS_DE_CONFORMIDADE,
  ordenarPorPrioridade,
  type CategoriaDeConformidade,
} from "@/lib/domain/conformidade/categorias";
import {
  FONTES_DOS_FATOS,
  regrasDosFatos,
  // [AG7 preparo] A resposta a pergunta do preparo sem os textos colados.
  semTextosColados,
  trechosDeEnderecoDasFerramentas,
  type FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { gatilhosDosTextos } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import { temDadoPessoal } from "@/lib/domain/conformidade/minimizar";
import {
  compactarComInicios,
  type Compacto,
  distanciaDeEdicao,
  FONTES_DA_NORMALIZACAO,
  frasesDasVisoes,
  // [AG7 preparo] A pergunta e a resposta do preparo (CFM-5).
  mascararNomes,
  normalizarBase,
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
  MEDICAMENTOS_DO_PREPARO,
  NEUTRALIZACOES_DE_SAIDA,
  PADROES_DE_SAIDA,
} from "@/lib/domain/conformidade/padroes";
// [AG7 preparo] início
// A regra do trecho mora no modulo puro (lib/domain/preparo.ts) e
// preparo-aprovado.ts a reexporta: este arquivo nao importa
// preparo-aprovado.ts, que importa este (ciclo de import).
import {
  LIMITE_DA_INTRODUCAO_DO_PREPARO,
  PALAVRAS_DA_JANELA_DO_TRECHO,
  SINTOMA_OU_REACAO,
  TAMANHO_MINIMO_DO_TRECHO,
  trechoDePreparoNaResposta,
} from "@/lib/domain/preparo";
// [AG7 preparo] fim

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
  /**
   * Os fatos do turno (AG2). Ausente: as regras dos fatos nao rodam (texto
   * estatico, retomada do envio). O turno da IA sempre passa.
   */
  fatos?: FatosDoTurno;
  // [AG7 preparo] início
  /**
   * Os textos de preparo da clinica (textos_de_preparo_da_clinica: toda
   * versao e o prep_instructions que a regua mandou antes da AG7), que NUNCA
   * vao ao modelo. Ausente: a regra do trecho nao roda (texto estatico,
   * retomada do envio, o texto do proprio preparo). O turno da IA passa.
   */
  textosDePreparo?: readonly string[];
  /**
   * Revisao curta da AG7 (CURTA-1): a habilidade "Enviar orientacao de
   * preparo" valendo no turno (o mesmo comPreparo do classificador). So com
   * ela a regra resposta_ao_preparo roda. Ausente: sem a habilidade (os
   * textos estaticos, a retomada do envio, o texto do proprio preparo).
   */
  comPreparo?: boolean;
  // [AG7 preparo] fim
  /**
   * Decisao do dono de 06/11/2026: o rascunho e a introducao que a IA escreve
   * antes do bloco exato do preparo. Muda so a regra resposta_ao_preparo, que
   * le o rascunho sem o anuncio ("segue a orientacao"); o resto do rascunho
   * continua lido e todas as outras regras valem igual.
   */
  introducaoDoPreparo?: boolean;
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
export const CATEGORIAS_SEM_MASCARA: ReadonlySet<AchadoDaRegra["categoria"]> =
  new Set(["promessa_resultado", "oferta_casada", "antes_depois"]);

/**
 * Revisao da AG2: as vedacoes clinicas que deixam de ler o endereco que a
 * ferramenta do turno trouxe ("Rua das Dores, 100", "Nossa Senhora dos
 * Remedios"), as mesmas que a mascara do catalogo cobre. Promessa, oferta
 * casada, antes e depois, formato e preco continuam lendo o trecho.
 */
export const CATEGORIAS_SEM_O_ENDERECO: ReadonlySet<
  AchadoDaRegra["categoria"]
> = new Set([
  "triagem",
  "diagnostico",
  "orientacao_clinica",
  "medicamento",
  "dosagem",
]);

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

// [AG7 preparo] início
/**
 * AG7: a resposta da IA que copia um trecho de um texto de preparo da
 * clinica (orientacao_clinica, camada regra). So roda com textosDePreparo.
 */
export const REGRA_DO_TRECHO_DO_PREPARO = "trecho_do_preparo_da_clinica";

/**
 * Revisao da AG7 (CFM-5) e revisao curta (CURTA-1): a resposta da IA que
 * afirma ou nega o jejum ou o preparo depois da pergunta do paciente (D-75;
 * orientacao_clinica, camada regra). So com a habilidade "Enviar orientacao
 * de preparo" (contexto.comPreparo): com ela, o classificador deixa a
 * pergunta geral chegar ao modelo (D-81: o portao nao muda), e o turno certo
 * e enviar_preparo (sem rascunho), a oferta, a pergunta do procedimento ou a
 * passagem. Sem a habilidade, a pergunta escala no classificador, como
 * sempre, e a regra nao roda.
 *
 * A pergunta conta frase a frase: a frase da pendente que pergunta (ou pede)
 * tem de ter o assunto ("Ja fiz o preparo. Qual o endereco?" nao conta), e a
 * dieta so conta com o exame, a vespera ou o procedimento na frase (a
 * clinica de nutricao). Com a pergunta, barra so a frase do rascunho que
 * responde a ela: a que comeca respondendo, termina em ", sim" ou ", nao",
 * diz a necessidade, qualifica o preparo, libera ou da as horas ("Precisa
 * sim.", "Nao precisa.", "Sim, 8 horas.", "Pode comer normalmente."), a
 * pergunta que comeca respondendo ("Sim, quer receber...?") e a frase que
 * fala do assunto fora da oferta e da pergunta do procedimento ("Para a
 * endoscopia e so jejum."). A frase que so fala de outra coisa ("Chegue as
 * 7h30.", "Aceitamos Unimed.") e a pergunta do procedimento ("E a
 * colonoscopia ou a endoscopia?", "Qual e o seu exame?") passam. Antes da
 * revisao da AG7, so o verificador barrava a resposta curta (AG7-S07).
 */
export const REGRA_DA_RESPOSTA_AO_PREPARO = "resposta_ao_preparo";

// O assunto: o preparo, o jejum e o laxante, ou o "posso comer" aplicado ao
// procedimento. Lido na visao base (minusculas, sem acento), com os nomes do
// catalogo mascarados ("Glicemia de jejum" e procedimento) e sem o nome do
// exame de sangue de jejum.
const ASSUNTO_DO_PREPARO =
  "\\b(?:jejum|preparo|preparos|preparacao|preparar|laxantes?|remedios?|medicamentos?|medicac(?:ao|oes))\\b|\\b(?:posso|pode|podem|devo|deve|tenho que|tem que|precisa|preciso|da pra|da para)\\b (?:\\w+ ){0,3}?(?:comer|beber|tomar|ingerir|almocar|jantar|lanchar|mastigar)\\b";
// Revisao curta (CURTA-1): a dieta so e assunto do preparo com o exame, a
// vespera ou o procedimento do catalogo (mascarado) na mesma frase: a
// clinica de nutricao fala de dieta o tempo todo ("Voces fazem dieta?"). As
// duas conferidas a parte (a mensagem do paciente nao tem teto de tamanho).
const DIETA = "\\bdieta\\b";
const CONTEXTO_DA_DIETA =
  "\\u00a7|\\b(?:vespera|dia anterior|exames?|procedimentos?|cirurgias?)\\b";
// A pergunta ou o pedido (a frase que so cita o preparo, "obrigada pelo
// preparo", nao conta).
const PERGUNTA_OU_PEDIDO =
  "\\?|\\b(?:qual|quais|como|quanto|quantas|quantos|precisa|preciso|tem|posso|pode|devo|deve|manda|mande|envia|envie|passa|passe|quero|queria|gostaria|orientac(?:ao|oes)|me diz|me fala|sabe|sabia)\\b";
// O exame que tem jejum no nome nao e pergunta de jejum.
const EXAME_DE_JEJUM = "\\b(?:glicemia|glicose) (?:de|em) jejum\\b";
// As formas permitidas: a oferta do envio ("Quer receber a orientacao de
// preparo da colonoscopia?", "Voce quer a orientacao de preparo?", "Posso te
// enviar a orientacao de preparo?") e a pergunta do procedimento.
const OFERTA_DO_PREPARO = [
  "\\b(?:quer|queria|gostaria|deseja|prefere)\\b (?:\\w+ ){0,3}?(?:receber|que (?:eu )?(?:te |lhe )?(?:envie|mande|encaminhe))\\b.*\\b(?:orientac(?:ao|oes)|preparo)\\b",
  "\\b(?:quer|queria|gostaria|deseja|prefere)\\b (?:\\w+ ){0,2}?(?:a|as|o|os) (?:orientac(?:ao|oes)|preparo)\\b",
  "\\bposso (?:te |lhe )?(?:enviar|mandar|encaminhar)\\b.*\\b(?:orientac(?:ao|oes)|preparo)\\b",
].join("|");
const PERGUNTA_DO_PROCEDIMENTO =
  "\\b(?:qual|quais|que|de qual|para qual|pra qual|em qual)\\b (?:\\w+ ){0,2}?(?:procedimentos?|exames?|consultas?)\\b";
// As palavras de abertura que nao mudam a frase ("Claro!", "Olha,").
const ABERTURA =
  "^(?:(?:oi|ola|claro|certo|entao|olha|bom|pois e|ah|perfeito|otimo|beleza|tudo bem|isso)\\b[ ,!.]*)*";
// A frase afirmativa que responde: comeca pela resposta (sim, nao, o verbo
// da pergunta), termina nela (", nao."), diz a necessidade, qualifica o
// preparo (tranquilo, simples, rapido), libera ("sem restricao",
// "liberado") ou da um tempo de jejum (o numero de horas sem "as" na
// frente, que e hora do dia).
const COMECA_RESPONDENDO = `${ABERTURA}(?:sim|nao|precisa|precisam|necessita|e necessario|e preciso|tem|tem que|pode|podem|deve|devem|basta|bastam|so|apenas|somente|nenhum|nenhuma|nada|exige|dispensa)\\b`;
const RESPOSTA_NA_FRASE = [
  COMECA_RESPONDENDO,
  ",? (?:sim|nao)[ .!]*$",
  "\\b(?:precisa|precisam|necessari[oa]s?|preciso|exige|exigem|dispensa|obrigatori[oa]s?)\\b",
  "\\b(?:e|eh|fica|vai ser|sera|bem|super)\\b (?:bem |bastante |super |mais )?(?:tranquil\\w*|simples|rapid\\w*|levinh\\w*|facil|faceis|suave)\\b",
  "\\b(?:sem restric\\w*|nenhuma restric\\w*|liberad[oa]s?)\\b",
  "(?<!\\b(?:as|das|pelas|ate as|a partir das|por volta das) )\\b(?:\\d{1,2}|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|doze)\\s?(?:h|hs|horas?)\\b",
].join("|");
// A pergunta que comeca respondendo ("Sim, quer receber...?", "Precisa sim,
// posso enviar?"); "Pode ser amanha?" e pergunta de agenda.
const PERGUNTA_QUE_RESPONDE = `${ABERTURA}(?:sim|nao|(?:precisa|tem|pode|deve|e) (?:sim|nao))\\b`;
// O assunto na resposta: o preparo, a orientacao, o jejum, a dieta, o
// laxante, comer e beber e a restricao. Fora da oferta e da pergunta do
// procedimento, a frase que fala disso depois da pergunta responde a ela.
const ASSUNTO_NA_RESPOSTA =
  "\\b(?:jejum|preparo|preparos|preparacao|preparar|orientac(?:ao|oes)|laxantes?|remedios?|medicamentos?|medicac(?:ao|oes)|tomar|toma|tome|tomam|tomem|tomando|tomado|tomada|comprimidos?|capsulas?|gotas?|doses?|dieta|comer|coma|come|comendo|comida|comidas|beber|beba|bebe|bebendo|bebida|bebidas|alimentac\\w*|alimentos?|refeic\\w*|liquidos?|restric\\w*)\\b";

const REGEX_DO_ASSUNTO = new RegExp(ASSUNTO_DO_PREPARO);
const REGEX_DA_DIETA = new RegExp(DIETA);
const REGEX_DO_CONTEXTO_DA_DIETA = new RegExp(CONTEXTO_DA_DIETA);
const REGEX_DA_PERGUNTA = new RegExp(PERGUNTA_OU_PEDIDO);
const REGEX_DO_EXAME_DE_JEJUM = new RegExp(EXAME_DE_JEJUM, "g");
const REGEX_DA_OFERTA = new RegExp(OFERTA_DO_PREPARO);
const REGEX_DA_PERGUNTA_DO_PROCEDIMENTO = new RegExp(PERGUNTA_DO_PROCEDIMENTO);
const REGEX_DA_RESPOSTA = new RegExp(RESPOSTA_NA_FRASE);
const REGEX_DA_PERGUNTA_QUE_RESPONDE = new RegExp(PERGUNTA_QUE_RESPONDE);
const REGEX_DO_ASSUNTO_NA_RESPOSTA = new RegExp(ASSUNTO_NA_RESPOSTA);

/**
 * As frases de um texto (o do paciente ou o rascunho) na visao base, com os
 * nomes do catalogo mascarados (linha a linha, antes do corte: "Dra. Ana"
 * nao corta o nome) e sem o nome do exame de jejum, com o sinal de que
 * terminam em pergunta.
 */
function frasesDoTexto(
  texto: string,
  nomesDoCatalogo: readonly string[],
): { frase: string; pergunta: boolean }[] {
  const frases: { frase: string; pergunta: boolean }[] = [];
  for (const linha of texto.split(/[\r\n\u2028\u2029]+/u)) {
    const base = mascararNomes(normalizarBase(linha), nomesDoCatalogo).replace(
      REGEX_DO_EXAME_DE_JEJUM,
      " ",
    );
    for (const pedaco of base.split(/(?<=[.!?])\s+/u)) {
      const frase = pedaco.trim();
      if (/[a-z0-9]/.test(frase)) {
        frases.push({ frase, pergunta: /\?$/.test(frase) });
      }
    }
  }
  return frases;
}

/**
 * Alguma frase das mensagens pendentes do paciente pergunta (ou pede) o
 * preparo ou o jejum? A frase que pergunta tem de ter o assunto.
 */
export function perguntaDePreparo(
  mensagensDoPaciente: readonly string[],
  nomesDoCatalogo: readonly string[],
): boolean {
  return mensagensDoPaciente.some((mensagem) =>
    frasesDoTexto(mensagem, nomesDoCatalogo).some(
      ({ frase }) =>
        (REGEX_DO_ASSUNTO.test(frase) ||
          (REGEX_DA_DIETA.test(frase) &&
            REGEX_DO_CONTEXTO_DA_DIETA.test(frase))) &&
        REGEX_DA_PERGUNTA.test(frase),
    ),
  );
}

/** A frase do rascunho (base, mascarada) responde a pergunta do preparo? */
function fraseQueResponde(frase: string, pergunta: boolean): boolean {
  if (
    pergunta
      ? REGEX_DA_PERGUNTA_QUE_RESPONDE.test(frase)
      : REGEX_DA_RESPOSTA.test(frase)
  ) {
    return true;
  }
  return (
    REGEX_DO_ASSUNTO_NA_RESPOSTA.test(frase) &&
    !REGEX_DA_OFERTA.test(frase) &&
    !REGEX_DA_PERGUNTA_DO_PROCEDIMENTO.test(frase)
  );
}

/**
 * Revisao da AG7 (CFM-6): o pedido do preparo que vem junto de uma situacao
 * da pessoa (um sintoma, uma doenca, um remedio que toma, o que comeu ou
 * esqueceu, a permissao para comer ou beber, outra pessoa, a idade) passa
 * para a equipe ANTES do envio (lib/agente/laco.ts, o ramo enviar_preparo).
 * O protocolo generico, com dose, em resposta a um sintoma funciona como
 * resposta clinica. O portao de entrada nao muda (D-81): a conferencia e so
 * do envio do preparo, deterministica, nas pendentes do turno (o texto como
 * chegou), com os nomes do catalogo mascarados ("tenho Colonoscopia amanha"
 * e o pedido de sempre).
 */
export const REGRA_DO_PEDIDO_COM_SITUACAO_PESSOAL =
  "pedido_do_preparo_com_situacao_pessoal";

// O que nao e situacao da pessoa depois de "to com" e "tenho": o
// procedimento do catalogo (mascarado), o exame, a consulta, o horario, a
// duvida e o "tenho que".
const NAO_E_SITUACAO =
  "(?:(?:um|uma|o|a|os|as|meu|minha|meus|minhas) )?(?:\\u00a7|(?:exames?|consultas?|procedimentos?|horarios?|agendamentos?|retornos?|pedidos?|guias?|encaminhamentos?|duvidas?|uma pergunta|pressa|tempo|horario marcado)\\b)";
const SITUACAO_PESSOAL = [
  // O estado ou o sintoma ("to com intestino preso", "estou com diarreia").
  `\\b(?:to|tou|estou|ando|fiquei|tava|estava|estive) com\\b(?! ${NAO_E_SITUACAO})`,
  `\\btenho\\b(?! (?:que|q|de)\\b)(?! ${NAO_E_SITUACAO})`,
  "\\b(?:sinto|senti|sentindo|sofro|sofri)\\b",
  "\\b(?:intestino preso|prisao de ventre|constipad\\w*|constipacao|diarreia|enjoo|enjoad[oa]|nausea|vomit\\w*|dor|dores|febre|sangr\\w*|colica|azia|gases|inchad[oa]|inchaco|alergi\\w*|tontura|desmai\\w*|fraqueza|tosse|gripe|gripad[oa]|resfriad[oa]|infeccao|menstruad[oa]|menstruacao|hemorroida)\\b",
  // A condicao ("sou diabetica", "pressao alta", "gravida").
  "\\b(?:diabet\\w*|hipertens\\w*|pressao alta|pressao baixa|cardiac\\w*|marca-?passo|insuficiencia|renal|figado|tireoide|epilep\\w*|convuls\\w*|anemi\\w*|gravida|gestante|gravidez|amamenta\\w*|lactante|operad[oa]|cirurgia|transplant\\w*)\\b",
  // O remedio que toma, o que comeu, bebeu ou esqueceu.
  "\\b(?:tomo|tomei|tomando|uso|usei|usando|comi|bebi|fumo|fumei|mastiguei|masco|mascando|esqueci|esquecer|vomitei|nao consegui|nao consigo|nao vou conseguir)\\b",
  // A permissao aplicada a pessoa ("posso mascar chiclete no jejum?").
  "\\b(?:posso|pode|devo|deve|da pra|da para|consigo)\\b (?:\\w+ ){0,3}?(?:comer|beber|tomar|mascar|chupar|fumar|usar|mastigar|ingerir|almocar|jantar|lanchar|dirigir|trabalhar|malhar|treinar)\\b",
  // Parar o remedio ("preciso parar o remedio antes do exame?").
  "\\b(?:parar|paro|parei|suspender|suspendo|suspendi|interromper|interrompo|interrompi|cortar|corto|cortei)\\b (?:de tomar )?(?:\\w+ ){0,2}?(?:remedios?|medicamentos?|medicac(?:ao|oes))\\b",
  // Outra pessoa e a idade ("pra minha mae que tem 80 anos").
  "\\b(?:minha|meu) (?:mae|pai|filh[oa]s?|marido|esposa|esposo|mulher|avo|vo|vovo|tia|tio|irma|irmao|sogra|sogro|namorad[oa]|bebe|crianca|net[oa]|parente)\\b",
  "\\b\\d{1,3} ?anos\\b",
].join("|");
const REGEX_DA_SITUACAO_PESSOAL = new RegExp(SITUACAO_PESSOAL);
/**
 * Decisao do dono de 06/11/2026 (opcao A): "como eu tomo" e "qual remedio eu
 * tomo antes do exame" pedem o texto aprovado; nao dizem que a pessoa toma um
 * remedio. Sai so a expressao, e so sem remedio pelo nome depois dela ("como
 * eu tomo remedio de pressao" continua). O resto da frase continua lido.
 */
const REMEDIO_DA_PERGUNTA = "(?:remedios?|medicamentos?|medicac(?:ao|oes))";
const DO_EXAME_DA_PERGUNTA =
  "(?:d[aoe]s?|dess[ae]s?|dest[ae]s?) (?:exames?|preparos?|\\u00a7)(?![a-z0-9])";
const COMO_TOMAR_NAO_E_SITUACAO = [
  `\\bcomo (?:que )?(?:eu )?(?:devo )?(?:tomo|tomar|toma)\\b(?= (?:(?:o|os|esse|esses|este|estes) )?(?:${REMEDIO_DA_PERGUNTA}|preparos?) ${DO_EXAME_DA_PERGUNTA}|\\s*(?:[.,;:!?]|$))`,
  `\\b(?:qual|quais|que) ${REMEDIO_DA_PERGUNTA} (?:que )?(?:eu )?(?:tomo|toma)\\b(?= antes ${DO_EXAME_DA_PERGUNTA})`,
].join("|");
const REGEX_DO_COMO_TOMAR = new RegExp(COMO_TOMAR_NAO_E_SITUACAO, "g");

/**
 * Revisao da AG7 (CFM-6): alguma pendente do paciente (o texto como chegou)
 * traz uma situacao da pessoa junto do pedido do preparo?
 */
export function situacaoPessoalNoPedidoDoPreparo(
  textos: readonly string[],
  nomesDoCatalogo: readonly string[],
): boolean {
  return textos.some((texto) =>
    REGEX_DA_SITUACAO_PESSOAL.test(
      mascararNomes(normalizarBase(texto), nomesDoCatalogo).replace(
        REGEX_DO_COMO_TOMAR,
        " ",
      ),
    ),
  );
}

// [remedios do preparo] inicio
/**
 * O anuncio que so a introducao diz, na visao base: sem ele, "Claro! Segue a
 * orientacao da clinica:" cairia em resposta_ao_preparo, que le "orientacao"
 * como o assunto. O resto da frase continua lido ("Precisa sim, segue a
 * orientacao" barra).
 */
export const FONTE_DO_ANUNCIO_DA_INTRODUCAO =
  "\\b(?:segue|seguem|aqui esta|aqui estao|envio|te envio|te passo)\\b (?:\\w+ ){0,2}?orientac(?:ao|oes)\\b";
const REGEX_DO_ANUNCIO_DA_INTRODUCAO = new RegExp(
  FONTE_DO_ANUNCIO_DA_INTRODUCAO,
  "g",
);

/**
 * O que a introducao nunca diz, na sintaxe do Postgres (preparo_introducao_valida
 * traz este texto byte a byte; o teste tests/unit/conformidade/preparo-introducao
 * confere), lido na visao base com os espacos juntados: qualquer digito, a
 * unidade, o numero por extenso, como tomar e o assunto do remedio, os remedios
 * do preparo e o sintoma. So bloqueia. Fica aqui porque entra na versao das
 * regras; quem aplica e problemaDaIntroducao (preparo-aprovado.ts).
 */
export const FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ = [
  "[0-9]",
  `\\m(?:mg|mcg|ug|ml|g|kg|l|ui|u|gotas?|gotinhas?|pingos?|comprimidos?|compr|capsulas?|cps?|caps|saches?|colher(?:es)?|colheradas?|doses?|ampolas?|jatos?|borrifadas?|puffs?|miligramas?|mililitros?|microgramas?|gramas?|litros?|seringas?|frascos?|copos?|xicaras?|unidades?|horas?|minutos?` +
    `|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|doze|quinze|vinte|trinta|meio|meia` +
    `|tome|toma|tomar|tomando|tomem|ingira|ingerir|ingerindo|beba|bebam|beber|bebendo|coma|comam|comer|comendo|engula|engolir|dilua|diluir|misture|misturar|aplique|aplicar|use|usar|usando|evite|evitar|suspenda|suspender|interrompa|interromper|pare|parar|jejum|dieta|laxantes?|remedios?|medicamentos?|medicac(?:ao|oes))\\M`,
  `\\m(?:${MEDICAMENTOS_DO_PREPARO.join("|").replaceAll("\\b", "\\M")})`,
  SINTOMA_OU_REACAO,
].join("|");
// [remedios do preparo] fim

/**
 * Revisao da AG7 (CFM-5) e revisao curta (CURTA-1): o rascunho responde a
 * pergunta de preparo ou de jejum do paciente? So com a habilidade do
 * preparo e com a pergunta. Os textos colados pelo sistema (a saudacao, o
 * aviso, a F2, o encerramento) saem antes; a F2 escrita pelo modelo, nao.
 */
export function respondeAPerguntaDePreparo(
  rascunho: string,
  contexto: Pick<
    ContextoDasRegras,
    | "mensagensDoPaciente"
    | "nomesDoCatalogo"
    | "fatos"
    | "comPreparo"
    | "introducaoDoPreparo"
  >,
): boolean {
  if (
    contexto.comPreparo !== true ||
    !perguntaDePreparo(contexto.mensagensDoPaciente, contexto.nomesDoCatalogo)
  ) {
    return false;
  }
  const colados = contexto.fatos?.textosColados ?? [];
  return frasesDoTexto(
    semTextosColados(rascunho, colados),
    contexto.nomesDoCatalogo,
  ).some(({ frase, pergunta }) =>
    fraseQueResponde(
      contexto.introducaoDoPreparo === true
        ? frase.replace(REGEX_DO_ANUNCIO_DA_INTRODUCAO, " ")
        : frase,
      pergunta,
    ),
  );
}
// [AG7 preparo] fim

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
  `sem o endereco da ferramenta: ${[...CATEGORIAS_SEM_O_ENDERECO].join(",")}`,
  // Revisao final de 31/10/2026: a saida cedo do rascunho longo.
  `com os fatos, acima de ${LIMITE_DO_RASCUNHO} caracteres: so formato_invalido/longo, sem ler o resto`,
  // [AG7 preparo] início
  `${REGRA_DO_TRECHO_DO_PREPARO}: com os textos de preparo da clinica, a frase de ${TAMANHO_MINIMO_DO_TRECHO} caracteres ou mais de um deles (ou o texto inteiro) que aparece inteira no rascunho, e (revisao da AG7, CFM-8) a oracao entre virgulas de ${TAMANHO_MINIMO_DO_TRECHO} caracteres ou mais, inteira, e ${PALAVRAS_DA_JANELA_DO_TRECHO} palavras seguidas de um deles, com ${TAMANHO_MINIMO_DO_TRECHO} caracteres ou mais, que aparecem seguidas no rascunho, os dois lados em minusculas, sem acento, sem pontuacao e com espaco unico (orientacao_clinica)`,
  // Revisao da AG7 (CFM-6): a situacao da pessoa no pedido do preparo (a
  // conferencia do envio, no laco).
  `${REGRA_DO_PEDIDO_COM_SITUACAO_PESSOAL}: nas pendentes do turno do envio do preparo (o texto como chegou, os nomes do catalogo mascarados), ${SITUACAO_PESSOAL} passa para a equipe (assunto_clinico) antes do envio, sem ${COMO_TOMAR_NAO_E_SITUACAO}`,
  // Revisao da AG7 (CFM-5) e revisao curta (CURTA-1): a resposta que
  // afirma ou nega o jejum ou o preparo, so com a habilidade.
  `${REGRA_DA_RESPOSTA_AO_PREPARO}: so com a habilidade do preparo (comPreparo) e com a pergunta numa frase das mensagens do paciente (${ASSUNTO_DO_PREPARO}, ou ${DIETA} com ${CONTEXTO_DA_DIETA}, e ${PERGUNTA_OU_PEDIDO} na mesma frase, sem ${EXAME_DE_JEJUM}, os nomes do catalogo mascarados), barra a frase do rascunho sem os textos colados que responde (${RESPOSTA_NA_FRASE}), a pergunta que comeca respondendo (${PERGUNTA_QUE_RESPONDE}) e a frase que fala do assunto (${ASSUNTO_NA_RESPOSTA}) fora da oferta (${OFERTA_DO_PREPARO}) e da pergunta do procedimento (${PERGUNTA_DO_PROCEDIMENTO}) (orientacao_clinica)`,
  // [AG7 preparo] fim
  // Decisao do dono de 06/11/2026: a introducao antes do bloco exato.
  `introducao do preparo: em ${REGRA_DA_RESPOSTA_AO_PREPARO}, sem ${FONTE_DO_ANUNCIO_DA_INTRODUCAO}; barrada por ${LIMITE_DA_INTRODUCAO_DO_PREPARO} caracteres ou por ${FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ}`,
  CNPJ_COM_MASCARA.source,
  ...NEUTRALIZACOES_DE_SAIDA.map(({ nome, fonte, troca }) =>
    [nome, fonte, troca].join(" "),
  ),
  ...FONTES_DA_NORMALIZACAO,
  ...FONTES_DOS_FATOS,
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

/**
 * As visoes do rascunho: com a mascara do catalogo, sem ela (promessa,
 * oferta casada e antes e depois leem as duas) e, so para as vedacoes
 * clinicas, com o endereco da ferramenta tambem mascarado.
 */
type VisoesDasRegras = {
  comMascara: VisoesDoTexto;
  semMascara: VisoesDoTexto;
  semOEndereco: VisoesDoTexto;
  frases: {
    comMascara: readonly string[];
    comESemMascara: readonly string[];
    semOEndereco: readonly string[];
  };
};

function visoesDasRegras(
  comMascara: VisoesDoTexto,
  semMascara: VisoesDoTexto,
  semOEndereco: VisoesDoTexto,
): VisoesDasRegras {
  const frasesComMascara = frasesDasVisoes(comMascara);
  return {
    comMascara,
    semMascara,
    semOEndereco,
    frases: {
      comMascara: frasesComMascara,
      comESemMascara: [...frasesComMascara, ...frasesDasVisoes(semMascara)],
      semOEndereco:
        semOEndereco === comMascara
          ? frasesComMascara
          : frasesDasVisoes(semOEndereco),
    },
  };
}

function frasesPara(
  categoria: AchadoDaRegra["categoria"],
  visoes: VisoesDasRegras,
): readonly string[] {
  if (CATEGORIAS_SEM_MASCARA.has(categoria)) {
    return visoes.frases.comESemMascara;
  }
  return CATEGORIAS_SEM_O_ENDERECO.has(categoria)
    ? visoes.frases.semOEndereco
    : visoes.frases.comMascara;
}

function compactosPara(
  categoria: AchadoDaRegra["categoria"],
  visoes: VisoesDasRegras,
): readonly VisoesDoTexto[] {
  if (CATEGORIAS_SEM_MASCARA.has(categoria)) {
    return [visoes.comMascara, visoes.semMascara];
  }
  return [
    CATEGORIAS_SEM_O_ENDERECO.has(categoria)
      ? visoes.semOEndereco
      : visoes.comMascara,
  ];
}

/**
 * Avalia o rascunho contra todas as regras. Devolve as categorias que
 * dispararam (vazia = nenhuma regra achou nada; isso NAO e aprovacao).
 */
export function avaliarRegras(
  rascunho: string,
  contexto: ContextoDasRegras,
): ResultadoDasRegras {
  // Revisao final de 31/10/2026 (desempenho): no turno da IA (com os fatos),
  // o rascunho acima do limite ja barra como "longo" (formato_invalido), e
  // o resto nao muda a decisao: sai aqui, sem ler o resto. O rascunho chega
  // a uns 32 mil caracteres (MAX_TOKENS_DO_AGENTE, 8.192) e as regras dos
  // fatos leem frase a frase (". " repetido levava 31,6 s em 65.536
  // caracteres). So muda a categoria registrada do bloqueio de um rascunho
  // longo (formato_invalido, e nao a primeira das outras). Sem os fatos (os
  // textos da Tela 6 e do Cadastro, problemaNoTextoDoAgente, em que as
  // instrucoes passam do limite e quem chama descarta o "longo"; a retomada
  // do envio), todas as regras continuam lidas, como antes.
  if (
    contexto.fatos !== undefined &&
    Array.from(rascunho).length > LIMITE_DO_RASCUNHO
  ) {
    return {
      categorias: ["formato_invalido"],
      achados: [{ categoria: "formato_invalido", regra: "longo" }],
    };
  }
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
  // Revisao da AG2: o endereco que a ferramenta do turno trouxe e nome de
  // lugar para as vedacoes clinicas ("Rua das Dores, 100").
  const enderecos =
    contexto.fatos === undefined
      ? []
      : trechosDeEnderecoDasFerramentas(rascunho, contexto.fatos);
  const todas = visoesDasRegras(
    visoes,
    semMascara,
    enderecos.length > 0
      ? visoesDoTexto(
          rascunho,
          [...contexto.nomesDoCatalogo, ...enderecos],
          neutralizarSaida,
        )
      : visoes,
  );

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
        ? [...frasesPara(padrao.categoria, todas), todas.semOEndereco.leetComL]
        : frasesPara(padrao.categoria, todas);
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
    const alvos = compactosPara(entrada.categoria, todas);
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
  const invertidos = [
    todas.semOEndereco.compacto,
    todas.semOEndereco.compactoComL,
  ].map((compacto) => [...compacto].reverse().join(""));
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
      compactosPara(categoria, todas).flatMap((alvo) => [
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

  // Fatos do turno (AG2): so quando quem chama passa os fatos.
  if (contexto.fatos !== undefined) {
    achados.push(
      ...regrasDosFatos(rascunho, {
        fatos: contexto.fatos,
        nomesDoCatalogo: contexto.nomesDoCatalogo,
        mensagensDoPaciente: contexto.mensagensDoPaciente,
      }),
    );
  }

  // [AG7 preparo] início
  // O trecho do preparo (AG7): a resposta que copia uma frase de um texto de
  // preparo da clinica e barrada, mesmo sem palavra nenhuma dos padroes. O
  // texto aprovado so sai pela mensagem do sistema, nunca pelo modelo.
  if (
    contexto.textosDePreparo !== undefined &&
    trechoDePreparoNaResposta(rascunho, contexto.textosDePreparo)
  ) {
    achados.push({
      categoria: "orientacao_clinica",
      regra: REGRA_DO_TRECHO_DO_PREPARO,
    });
  }
  // Revisao da AG7 (CFM-5): a resposta a pergunta de preparo ou de jejum
  // do paciente (a resposta curta, "Precisa sim.", que so o verificador
  // barrava).
  if (respondeAPerguntaDePreparo(rascunho, contexto)) {
    achados.push({
      categoria: "orientacao_clinica",
      regra: REGRA_DA_RESPOSTA_AO_PREPARO,
    });
  }
  // [AG7 preparo] fim

  // Contexto: o paciente falou de saude.
  for (const gatilho of gatilhosDosTextos(contexto.mensagensDoPaciente, {
    comPreparo: contexto.comPreparo === true,
  })) {
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
