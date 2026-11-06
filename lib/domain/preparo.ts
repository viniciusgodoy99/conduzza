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
//  - normalizarTextoDoPreparo: a mesma ordem e as mesmas trocas da copia do
//    texto antigo (CR vira LF, a tabulacao vira espaco, NFC e o trim() do
//    JavaScript, os 25 brancos de cadastro_texto_valido); revisao da AG7
//    (TELA-8): a tabulacao vira espaco aqui e na copia, para o texto e o hash
//    serem os mesmos (a paridade do harness confere);
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
 * O texto como o banco guarda: "\r\n" e "\r" viram "\n", a tabulacao vira
 * espaco, depois NFC, depois o trim() do JavaScript (a ordem da copia do
 * texto antigo, secao 1.6 do contrato da AG7). A tela e a Server Action
 * normalizam ANTES de mandar. Revisao da AG7 (TELA-8): a tabulacao vira
 * espaco como o CR vira LF (a lista numerada colada do Word, "1.\tJejum",
 * caia em "caracteres invisiveis" sem a pessoa achar o que tirar); o banco
 * continua recusando a tabulacao crua, e a copia do texto antigo (migration
 * 20261103100000, passo 10) faz as mesmas trocas, na mesma ordem: o texto e o
 * hash da copia sao os que a tela guardaria.
 */
export function normalizarTextoDoPreparo(texto: string): string {
  return aparar(
    texto
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\t/g, " ")
      .normalize("NFC"),
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

/**
 * Revisao da AG7 (TELA-8): o que torna o texto invalido (o mesmo
 * preparo_texto_valido), com o que a pessoa precisa para achar e tirar:
 *  - vazio, longo (com o tamanho) e chaves ("{{" ou "}}", com a linha);
 *  - tabulacao (a linha; normalizarTextoDoPreparo ja a troca por espaco);
 *  - emoji_com_juncao: o emoji que leva o U+200D (o "juntador" de emoji,
 *    como em profissional de saude), com o emoji e a linha;
 *  - invisivel: o caractere invisivel (U+200B e outros), com a linha e o
 *    codigo;
 *  - controle: outro caractere de controle, com a linha e o codigo;
 *  - fora_do_padrao: o texto que nao passou por normalizarTextoDoPreparo
 *    (fora da NFC, branco nas pontas, "\r").
 * null: o texto e valido. Recebe o texto JA normalizado (o que vai ao banco).
 */
export type ProblemaDeFormatoDoPreparo =
  | { causa: "vazio" }
  | { causa: "longo"; tamanho: number }
  | { causa: "chaves"; linha: number }
  | { causa: "tabulacao"; linha: number }
  | { causa: "emoji_com_juncao"; linha: number; emoji: string }
  | { causa: "invisivel"; linha: number; codigo: string }
  | { causa: "controle"; linha: number; codigo: string }
  | { causa: "fora_do_padrao" };

/** "U+200B" de um ponto de codigo. */
function codigoDoCaractere(caractere: string): string {
  return `U+${(caractere.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** A linha (de 1 para cima) da posicao no texto. */
function linhaDe(texto: string, posicao: number): number {
  let linha = 1;
  for (let i = 0; i < posicao; i += 1) {
    if (texto.charCodeAt(i) === 0x0a) {
      linha += 1;
    }
  }
  return linha;
}

/** O emoji inteiro (o agrupamento que a pessoa ve) em volta da posicao. */
function emojiEmVolta(texto: string, posicao: number): string {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmentador = new Intl.Segmenter("pt-BR", {
      granularity: "grapheme",
    });
    for (const { segment, index } of segmentador.segment(texto)) {
      if (posicao >= index && posicao < index + segment.length) {
        return segment;
      }
    }
  }
  return texto.slice(Math.max(0, posicao - 2), posicao + 3);
}

export function problemaDeFormatoDoTextoDoPreparo(
  texto: string,
): ProblemaDeFormatoDoPreparo | null {
  if (typeof texto !== "string" || texto.trim() === "") {
    return { causa: "vazio" };
  }
  const tamanho = Array.from(texto).length;
  if (tamanho > LIMITE_DO_TEXTO_DO_PREPARO) {
    return { causa: "longo", tamanho };
  }
  const chaves = [texto.indexOf("{{"), texto.indexOf("}}")].filter(
    (i) => i >= 0,
  );
  if (chaves.length > 0) {
    return { causa: "chaves", linha: linhaDe(texto, Math.min(...chaves)) };
  }
  for (let i = 0; i < texto.length; i += 1) {
    const caractere = texto.charAt(i);
    if (caractere === "\t") {
      return { causa: "tabulacao", linha: linhaDe(texto, i) };
    }
    if (caractere === "\u200d") {
      return {
        causa: "emoji_com_juncao",
        linha: linhaDe(texto, i),
        emoji: emojiEmVolta(texto, i),
      };
    }
    if (INVISIVEL_NO_TEXTO.test(caractere)) {
      return {
        causa: "invisivel",
        linha: linhaDe(texto, i),
        codigo: codigoDoCaractere(caractere),
      };
    }
    if (caractere !== "\n" && CONTROLE_NO_TEXTO.test(caractere)) {
      return {
        causa: "controle",
        linha: linhaDe(texto, i),
        codigo: codigoDoCaractere(caractere),
      };
    }
  }
  return textoDoPreparoValido(texto) ? null : { causa: "fora_do_padrao" };
}

// ---------------------------------------------------------------------------
// O nome do procedimento e do RT (espelho de preparo_nome_valido; revisao
// curta da AG7, CURTA-6)
// ---------------------------------------------------------------------------

/** O tamanho do nome que vai no cabecalho da mensagem (o CHECK do banco). */
export const LIMITE_DO_NOME_DO_PREPARO = 120;

// O controle (C0, DEL e C1) que preparo_nome_valido recusa no nome.
const CONTROLE_NO_NOME = /[\u0000-\u001f\u007f-\u009f]/;

// Os invisiveis e as marcas e isolamentos de direcao que preparo_nome_valido
// recusa no nome (os do texto e os que o filtro tambem recusa): reordenariam
// a linha que o paciente le.
const INVISIVEL_NO_NOME =
  /[\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u2800\u3164\ufeff\uffa0\u{e0000}-\u{e007f}]/u;

/**
 * Espelho de preparo_nome_valido (migration 20261103100000): o nome do
 * procedimento ou do RT, que vai no cabecalho da mensagem ao paciente, de 1 a
 * 120 caracteres (pontos de codigo), aparado pelos 25 brancos, sem controle e
 * sem invisivel nem marca ou isolamento de direcao. O Cadastros e o
 * formulario do RT nao conferiam os invisiveis, e o banco recusava sem dizer
 * o que (CURTA-6).
 */
export function nomeDoPreparoValido(nome: string): boolean {
  if (typeof nome !== "string") {
    return false;
  }
  const tamanho = Array.from(nome).length;
  return (
    tamanho >= 1 &&
    tamanho <= LIMITE_DO_NOME_DO_PREPARO &&
    aparar(nome) === nome &&
    !CONTROLE_NO_NOME.test(nome) &&
    !INVISIVEL_NO_NOME.test(nome)
  );
}

/**
 * O primeiro invisivel ou marca de direcao do nome que preparo_nome_valido
 * recusa, pela posicao (indice UTF-16): a tela diz o que tirar e onde. null:
 * nenhum.
 */
export function invisivelNoNome(nome: string): { posicao: number } | null {
  if (typeof nome !== "string") {
    return null;
  }
  const achado = INVISIVEL_NO_NOME.exec(nome);
  return achado === null ? null : { posicao: achado.index };
}

/**
 * O nome tem um caractere de controle que preparo_nome_valido recusa (C0,
 * DEL e C1: a tabulacao colada de outro lugar)? O resto da regra do nome
 * (os invisiveis) e de invisivelNoNome. Revisao curta da AG7, a sobra da
 * CURTA-6: o Salvar do procedimento em Cadastros diz o que tirar.
 */
export function controleNoNome(nome: string): boolean {
  return typeof nome === "string" && CONTROLE_NO_NOME.test(nome);
}

// ---------------------------------------------------------------------------
// O conteudo que o banco recusa sozinho (espelho de preparo_texto_recusado)
// ---------------------------------------------------------------------------

/**
 * Os conselhos cujo RT salva e aprova texto com remedio ou dose (decisao do
 * dono de 05/11/2026; a lista de CONSELHOS tem conselhos que nao prescrevem).
 * O mesmo par de preparo_conselho_recusa_texto, na migration 20261103100000.
 */
export const CONSELHOS_DE_REMEDIO_E_DOSE: readonly string[] = ["CRM", "CRO"];

/**
 * O conselho na linha do RT da mensagem ("... Dra. Ana (CRM-CE 123)"), ou null
 * (o envio recusa o texto que cita remedio ou dose, falha fechada).
 */
export function conselhoDaLinhaDoRt(linha: string): string | null {
  return /\(([A-Za-z]+)-[A-Z]{2} [^()]*\)$/.exec(linha)?.[1] ?? null;
}

/**
 * O que preparo_texto_recusado (migration 20261103100000, CFM-2) recusa, com
 * o lugar: o link, o valor em reais e o arroba com a frase do texto (como a
 * clinica escreveu, aparada) que dispara sozinha (null quando so o texto
 * inteiro dispara), e o invisivel com a posicao (indice UTF-16) do primeiro.
 * Fechamento entre as frentes da AG7: o salvar (22023) e o aprovar (P0001)
 * respondem so o codigo texto_recusado, e a action diz o que tirar a partir
 * do texto que mandou. As regras da tela (problemasDoTextoDoPreparo) recusam
 * antes tudo isso e mais; este espelho e o que sobra quando o banco recusa e
 * as regras nao (uma divergencia), e a paridade do harness confere que ele
 * diz o mesmo que a funcao do banco num corpus.
 */
export type ConteudoRecusadoPeloBanco =
  | {
      causa:
        | "link"
        | "valor_em_reais"
        | "arroba"
        | "sintoma_normalizado"
        | "oferta_de_outro_procedimento";
      trecho: string | null;
    }
  | { causa: "invisivel"; posicao: number };

// O \m e o \M do Postgres (comeco e fim de palavra; a palavra e letra, digito
// decimal ou sublinhado, como o u_isalnum do ICU da producao).
const COMECO_DE_PALAVRA = "(?<![\\p{L}\\p{Nd}_])(?=[\\p{L}\\p{Nd}_])";
const FIM_DE_PALAVRA = "(?<=[\\p{L}\\p{Nd}_])(?![\\p{L}\\p{Nd}_])";
// O [[:space:]] do ICU (u_isspace): os separadores e os brancos de controle.
const ESPACO_DO_BANCO =
  "\\p{Zs}\\t\\n\\v\\f\\r\\u001c-\\u001f\\u0085\\u2028\\u2029";

const LINK_DO_BANCO = new RegExp(
  `://|${COMECO_DE_PALAVRA}https?${FIM_DE_PALAVRA}|${COMECO_DE_PALAVRA}www\\.|` +
    `${COMECO_DE_PALAVRA}[a-z0-9-]{2,}\\.(?:com|net|org|br|io|ly|me|gl|co|app|link|site|info|xyz|online|store|shop|page|to|cc|ai|gg|tk|ml)(?:\\.[a-z]{2})?${FIM_DE_PALAVRA}`,
  "u",
);
const VALOR_DO_BANCO = new RegExp(
  `${COMECO_DE_PALAVRA}r\\$ ?[0-9]|${COMECO_DE_PALAVRA}[0-9]+(?:[.,][0-9]+)* reais${FIM_DE_PALAVRA}`,
  "u",
);
const ARROBA_DO_BANCO = new RegExp(
  `(?:^|[${ESPACO_DO_BANCO}(){}"',;:!?/*<>=|])@[a-z0-9_.]{2,}|${COMECO_DE_PALAVRA}arroba${FIM_DE_PALAVRA}`,
  "u",
);
// No texto como veio: os invisiveis que o filtro recusa e o CHECK nao, e o
// seletor de variacao colado numa letra ou digito (o "1" do emoji de tecla).
const INVISIVEL_DO_BANCO =
  /[\u034f\u061c\u115f\u1160\u180e\u2066-\u2069\u2800\u3164\uffa0\u{e0000}-\u{e007f}]|(?<=[0-9A-Za-z])[\ufe00-\ufe0f]/u;

/** A visao base do banco: NFKD, minusculas e sem os acentos U+0300 a U+036F. */
function baseDoBanco(texto: string): string {
  return texto
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "");
}

// As duas recusas de 05/11/2026 (pontos 5 e 8 da AG7), na base com os espacos
// repetidos juntados. As fontes abaixo estao na sintaxe do Postgres (\m e \M):
// preparo_texto_recusado as traz byte a byte, e o teste
// tests/unit/agente/ag7-espelhos.test.ts confere. So valem para o texto da
// clinica: o filtro da resposta do modelo tem as regras dele (padroes.ts).

// O limite de uma frase para a regra do sintoma (a virgula nao separa: "Se
// tiver colica, e normal").
const NA_MESMA_FRASE = "[^.!?;\\n]*";
const SINTOMA_OU_REACAO =
  "\\m(?:colicas?|dor|dores|enjoos?|nauseas?|vomitos?|diarreias?|tonturas?|mal[- ]estar|inchacos?|vermelhid(?:ao|oes)|sangramentos?|coceiras?|ardencias?|ardor|queimac(?:ao|oes)|formigamentos?|febres?|fraquezas?|cansacos?|sonolencias?|gases|estufamentos?|desconfortos?|hematomas?|manchas?|reac(?:ao|oes)|sintomas?|efeitos? colaterais|efeito colateral|evacuac(?:ao|oes)|evacuar|sentir|doer|doi|doem|doendo|arder|arde|ardem|ardendo|cocar|coca|cocam|cocando|sangrar|sangra|sangram|sangrando|inchar|incha|incham|inchad[oa]|inchando|enjoar|enjoad[oa]|vomitar|formigar|formigando|latejar|lateja|latejando|queimar|queimando|incomodar|incomodo)\\M";
const COMO_NORMAL =
  "(?:normal|normais|esperad[oa]s?|comum|comuns|natural|naturais|previst[oa]s?|habitual|habituais|passageir[oa]s?|transitori[oa]s?)\\M";
// "Em caso de febre, e comum remarcar o exame": depois do adjetivo, o que a
// pessoa faz na recepcao nao normaliza o sintoma.
const SEM_ATO_ADMINISTRATIVO =
  "(?! (?:remarcar|reagendar|adiar|cancelar|desmarcar|agendar|marcar|avisar|ligar|retornar|voltar|trazer|levar|esperar|aguardar|chegar|vir|ir|pedir|solicitar|procurar|comunicar|informar)\\M)";
const NAO_SE_PREOCUPE =
  "(?:nao se preocupe|nao precisa se preocupar|fique tranquil[oa]|pode ficar tranquil[oa])";
const DIZ_QUE_E_NORMAL =
  `(?:\\m(?:e|eh|sao|ser|seja|sera|serao|considerad[oa]s?)\\M (?:[a-z]+ ){0,2}${COMO_NORMAL}${SEM_ATO_ADMINISTRATIVO}|` +
  `\\mdentro d[oa] (?:normal|normalidade|esperado)\\M|\\m(?:vai|vao|deve|devem|costuma|costumam|tende a|tendem a) (?:passar|sumir|melhorar|desaparecer|ceder)\\M|\\m(?:${NAO_SE_PREOCUPE}|nao ha motivo para preocupac|sem motivo para preocupac|nao e grave|sem gravidade|faz parte))`;
// O fim de uma frase, e o comeco da seguinte.
const FIM_DA_FRASE_ANTERIOR = "[.!?;\\n]+[ \\n]*";
const FRASE_ACABA = " *(?:[.!?;\\n]|$)";
/**
 * "Colica leve depois do laxante e normal e passa sozinha." Triagem, fora da
 * D-80 (CLAUDE.md 3.2): "passa sozinho" e "efeito esperado" em qualquer frase,
 * o sintoma (ou o verbo dele: "e normal doer") com o adjetivo colado, o que diz
 * que e normal na mesma frase de um sintoma, o sintoma que passa ("a dor passa
 * rapido", menos "a dor que nao passa", que e o alerta), "isso e normal" sozinho
 * e a frase seguinte que so diz que e normal ("Pode haver colica. E normal.").
 * Sem o sintoma, a frase e administrativa e passa ("E normal levar um
 * acompanhante.", "E comum haver fila na recepcao."). Sem tratar negacao, como
 * o filtro: "nao e normal ter febre" tambem e triagem. Sobra: a normalizacao
 * sem sintoma nem pronome ("Acontece com todo mundo") e a que so fala do tempo
 * ("Em dois dias voce esta nova").
 */
export const FONTE_DO_SINTOMA_NORMALIZADO =
  "\\m(?:passa|passam|passara|passarao|some|somem|sumira|sumirao|melhora|melhoram|melhorara|melhorarao|desaparece|desaparecem|desaparecera|desaparecerao|cede|cedem|cedera|cederao)\\M (?:[a-z]+ )?(?:sozinh[oa]s?|naturalmente|espontaneamente)\\M" +
  // "pode passar sozinha" fica de fora: "nao pode passar sozinha pela recepcao".
  "|\\m(?:vai|vao|deve|devem|costuma|costumam|tende a|tendem a|ira|irao) (?:passar|sumir|melhorar|desaparecer|ceder) (?:[a-z]+ )?(?:sozinh[oa]s?|naturalmente|espontaneamente)\\M" +
  "|\\mefeitos? esperados?\\M" +
  `|\\m(?:isso|isto|tudo isso)\\M (?:e|eh|sera) (?:[a-z]+ ){0,2}${COMO_NORMAL}` +
  "|\\m(?:isso|isto) (?:passa|some|melhora|cede)\\M" +
  `|${SINTOMA_OU_REACAO} (?:[a-z]+ )?${COMO_NORMAL}` +
  `|${SINTOMA_OU_REACAO}${NA_MESMA_FRASE}${DIZ_QUE_E_NORMAL}` +
  `|${DIZ_QUE_E_NORMAL}${NA_MESMA_FRASE}${SINTOMA_OU_REACAO}` +
  `|${SINTOMA_OU_REACAO}${NA_MESMA_FRASE}(?<!nao )\\m(?:passa|passam|some|somem|melhora|melhoram|desaparece|desaparecem|cede|cedem|alivia|aliviam|diminui|diminuem)\\M` +
  `|${SINTOMA_OU_REACAO}${NA_MESMA_FRASE}${FIM_DA_FRASE_ANTERIOR}(?:(?:e|sao|sera) (?:[a-z]+ ){0,2}${COMO_NORMAL}|(?:${NAO_SE_PREOCUPE})(?: com isso)?|faz parte(?: d[oa] [a-z]+)?)${FRASE_ACABA}`;

const OFERECE =
  "(?:faca|marque|agende|realize|inclua|adicione|conheca|experimente|contrate)";
const OFERECE_NO_INFINITIVO =
  "(?:fazer|marcar|agendar|realizar|incluir|adicionar|conhecer|experimentar|contratar)";
// O que continua sendo item do preparo depois de "faca tambem", de "aproveite",
// de "que tal" e de "tambem pode fazer". A lista e do que passa, nunca do que se
// oferece: o procedimento do Cadastro nao esta disponivel na regra do banco, e o
// que nao esta aqui e recusado ("a limpeza de pele", "a remocao de tatuagem").
// A limpeza e a remocao so com o que as faz item de preparo.
const ITEM_DO_PREPARO =
  "(?: (?:[a-z]+ ){0,2}(?:jejum|dieta|preparo|preparacao|exames?|coleta|higiene|banho|lavagem|enema|hidratacao|repouso|assepsia|tricotomia|refeic(?:ao|oes)|lanche|alimentacao|retorno|assinatura|termo|ficha|cadastro|limpeza d[oa] [a-z]+ com|(?:remocao|retirada) d[aeo]s? (?:esmaltes?|maquiagem|adornos?|joias?|brincos?|aneis|anel|proteses?|lentes|piercings?)|depilacao d[aeo])\\M)";
/**
 * "Aproveite e faca tambem a limpeza de pele." Oferta casada, fora da D-80
 * (CFM 2.336/2023), pela estrutura: "aproveite" com o verbo de oferta, "que tal"
 * com qualquer coisa, e "tambem" ou "junto" com o verbo de oferta ("voce tambem
 * pode fazer"), sempre menos o item do preparo ("faca tambem o jejum",
 * "aproveite para trazer os exames" nem tem o verbo). Sobra: a oferta sem
 * nenhuma dessas palavras ("Temos peeling com desconto" ja cai nas regras do
 * filtro; "Recomendamos a limpeza de pele" fica so no TS).
 */
export const FONTE_DA_OFERTA_DE_OUTRO_PROCEDIMENTO =
  `\\m(?:aproveit[a-z]*)\\M (?:[a-z]+ ){0,3}?(?:${OFERECE}|${OFERECE_NO_INFINITIVO})\\M(?!${ITEM_DO_PREPARO})` +
  `|\\mque tal\\M(?!${ITEM_DO_PREPARO})` +
  `|\\m(?:${OFERECE}|${OFERECE_NO_INFINITIVO}) (?:tambem|junto)\\M(?!${ITEM_DO_PREPARO})` +
  `|\\mtambem ${OFERECE}\\M(?!${ITEM_DO_PREPARO})` +
  `|\\mtambem (?:[a-z]+ ){0,2}?${OFERECE_NO_INFINITIVO}\\M(?!${ITEM_DO_PREPARO})` +
  `|\\mpode(?:m|ra)? tambem ${OFERECE_NO_INFINITIVO}\\M(?!${ITEM_DO_PREPARO})`;

/**
 * O que qualquer RT aprova, porque nao e remedio nem dose (revisao final da AG7;
 * a decisao de 05/11/2026 era "remedio e dose so de CRM ou CRO"): o jejum, tomar
 * agua, o frasco que a pessoa traga e o pedido de informar os medicamentos em
 * uso. Sai do texto antes da conferencia do remedio e da dose, entao o resto da
 * frase continua lido: "Traga 1 frasco de Picoprep" barra pelo nome. Lista
 * fechada: o nome de remedio e a instrucao de tomar ficam fora dela.
 */
export const FONTE_DO_QUE_NAO_E_REMEDIO_NEM_DOSE =
  "\\mem jejum\\M" +
  "|\\m(?:tomar|ingerir|beber)\\M (?:apenas |so |somente |bastante )?(?:agua|liquidos?|chas?|sucos?|caldos?|isotonicos?)\\M" +
  "|\\m(?:traga|leve|trazer|levar|colete|coletar|entregue|entregar|apresente|apresentar)\\M (?:[a-z]+ ){0,2}?[0-9]+ ?(?:frascos?|potes?|potinhos?|tubos?)\\M" +
  "|\\m(?:informe|informar|liste|listar|avise|avisar|comunique|comunicar|relate|relatar|mencione|mencionar)\\M (?:(?:os|as|o|a|seus|suas|seu|sua|todos|todas|quais|qual|que|se|sobre|de|dos|das|do|da|usa|usar|toma|tomar|esta|usando|tomando|algum|alguma|qualquer) ){0,5}?(?:medicament|remedi|medicac)[a-z]*\\M" +
  "|\\m(?:traga|leve|trazer|levar|apresente|apresentar)\\M (?:(?:a|as|sua|suas) )?(?:(?:lista|relacao) d[eo]s? (?:(?:seus|suas) )?(?:medicament|remedi|medicac)[a-z]*|receitas?(?: medicas?)?)\\M";

/** A fonte na sintaxe do Postgres, como RegExp do JavaScript. */
function regexDoBanco(fonte: string, flags = "u"): RegExp {
  return new RegExp(
    fonte.replaceAll("\\m", COMECO_DE_PALAVRA).replaceAll("\\M", FIM_DE_PALAVRA),
    flags,
  );
}

const SINTOMA_NORMALIZADO_DO_BANCO = regexDoBanco(FONTE_DO_SINTOMA_NORMALIZADO);
const OFERTA_DO_BANCO = regexDoBanco(FONTE_DA_OFERTA_DE_OUTRO_PROCEDIMENTO);
const NAO_E_REMEDIO_NEM_DOSE = regexDoBanco(
  FONTE_DO_QUE_NAO_E_REMEDIO_NEM_DOSE,
  "gu",
);

/** A base do banco com os espacos repetidos juntados (as quebras ficam). */
function frasesDoBanco(texto: string): string {
  return baseDoBanco(texto).replace(/ +/g, " ");
}

/** A regra de 05/11/2026: o texto diz que o sintoma e normal ou passa sozinho? */
export function normalizaSintoma(texto: string): boolean {
  return SINTOMA_NORMALIZADO_DO_BANCO.test(frasesDoBanco(texto));
}

/** A regra de 05/11/2026: o texto oferece outro procedimento? */
export function ofereceOutroProcedimento(texto: string): boolean {
  return OFERTA_DO_BANCO.test(frasesDoBanco(texto));
}

/**
 * A base do texto (como preparo_conselho_recusa_texto le) sem o que nao e
 * remedio nem dose: quem confere o remedio e a dose le este texto.
 */
export function semOQueNaoERemedioNemDose(texto: string): string {
  return baseDoBanco(texto)
    .replace(/\s+/gu, " ")
    .replace(NAO_E_REMEDIO_NEM_DOSE, " ");
}

/** As frases do texto, como escritas e aparadas (o corte das recusas da tela). */
export function frasesParaORecorte(texto: string): string[] {
  return texto
    .split(/(?<=[.!?;:])\s+|\n+/u)
    .map((frase) => frase.trim())
    .filter((frase) => /[\p{L}\p{N}]/u.test(frase));
}

export function conteudoRecusadoPeloBanco(
  texto: string,
): ConteudoRecusadoPeloBanco[] {
  if (typeof texto !== "string" || texto === "") {
    return [];
  }
  const base = baseDoBanco(texto);
  const achados: ConteudoRecusadoPeloBanco[] = [];
  const causas = [
    ["link", LINK_DO_BANCO],
    ["valor_em_reais", VALOR_DO_BANCO],
    ["arroba", ARROBA_DO_BANCO],
  ] as const;
  for (const [causa, regex] of causas) {
    if (regex.test(base)) {
      const trecho =
        frasesParaORecorte(texto).find((frase) =>
          regex.test(baseDoBanco(frase)),
        ) ?? null;
      achados.push({ causa, trecho });
    }
  }
  const frases = [
    ["sintoma_normalizado", normalizaSintoma],
    ["oferta_de_outro_procedimento", ofereceOutroProcedimento],
  ] as const;
  for (const [causa, dispara] of frases) {
    if (dispara(texto)) {
      achados.push({
        causa,
        trecho: frasesParaORecorte(texto).find(dispara) ?? null,
      });
    }
  }
  const invisivel = INVISIVEL_DO_BANCO.exec(texto);
  if (invisivel) {
    achados.push({ causa: "invisivel", posicao: invisivel.index });
  }
  return achados;
}

/** O espelho de preparo_texto_recusado: o banco recusa este texto? */
export function textoRecusadoPeloBanco(texto: string): boolean {
  return conteudoRecusadoPeloBanco(texto).length > 0;
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
 * Os jobs que enviaram a orientacao de preparo de verdade: o job_id de cada
 * decisao 'enviou_preparo' do ai_decision_log (a sessao le, com a mesma RLS
 * da mensagem). Revisao da AG7 (TELA-13 e CFM-10a): so com o job do envio a
 * bolha do Atendimento assina "Assistente" e diz "Texto aprovado pelo
 * responsavel tecnico". Um passo de regua ou uma automacao escritos pela
 * clinica no mesmo formato tem o job da regua, que nunca tem essa decisao, e
 * aparece como mensagem comum do sistema.
 */
export type EnviosDoPreparo = ReadonlySet<string>;

/** Nenhum envio confirmado (a consulta desligada, carregando ou com erro). */
export const SEM_ENVIOS_DO_PREPARO: EnviosDoPreparo = new Set<string>();

/**
 * A mensagem tem tudo da orientacao de preparo enviada pelo sistema, menos a
 * confirmacao do envio: saida do sistema (author 'sistema', sem pessoa), em
 * texto, que nao e nota interna, nao saiu pelo celular, nao tem midia, tem
 * job_id e tem o corpo no formato da mensagem do preparo (cabecalho, linha
 * do RT, texto e rodape). E o recorte dos jobs que o Atendimento confere na
 * decisao (jobsQuePodemSerDoPreparo); quem DESENHA a bolha usa
 * ehMensagemDoPreparo, que exige o envio. No molde de ehNotaDaPassagemDaIa
 * (lib/agente/nota-da-passagem.ts) e de ehAvisoAutomaticoDaIa
 * (components/atendimento/aviso-automatico.ts).
 */
export function podeSerAMensagemDoPreparo(m: MensagemParaReconhecer): boolean {
  const corpo = m.body ?? null;
  return (
    m.author === "sistema" &&
    !m.is_internal_note &&
    !m.author_user_id &&
    m.pelo_celular !== true &&
    (m.direction === undefined || m.direction === "saida") &&
    (m.content_type === undefined || m.content_type === "texto") &&
    (m.media_url === undefined || m.media_url === null) &&
    typeof m.job_id === "string" &&
    m.job_id !== "" &&
    corpo !== null &&
    partesDaMensagemDoPreparo(corpo) !== null
  );
}

/**
 * A mensagem e a orientacao de preparo enviada pelo sistema? Tudo de
 * podeSerAMensagemDoPreparo e o job dela entre os envios confirmados
 * (EnviosDoPreparo: a decisao 'enviou_preparo' do mesmo job; TELA-13 e
 * CFM-10a). Sem a confirmacao (a consulta ainda nao voltou, falhou, ou o job
 * e da regua), nao e: falha fechada, a mensagem fica como mensagem comum do
 * sistema. O gatilho de message so deixa a linha 'sistema' do job da IA
 * passar com o corpo igual a mensagem remontada da versao em vigor e a
 * decisao do mesmo job (migration 20261103100000), e cada job manda uma
 * mensagem so (message.job_id e unico).
 */
export function ehMensagemDoPreparo(
  m: MensagemParaReconhecer,
  envios: EnviosDoPreparo,
): boolean {
  return (
    podeSerAMensagemDoPreparo(m) &&
    typeof m.job_id === "string" &&
    envios.has(m.job_id)
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
 *
 * Revisao da AG7 (CFM-9), o limite: a troca e por igualdade com os textos da
 * lista. Daqui para a frente nao ha buraco: a regua so manda a versao em
 * vigor, a versao e imutavel (preparo_nao_muda) e nao se apaga (a FK do
 * procedimento nao tem cascade), e a lista traz toda versao que ja valeu e o
 * texto antigo (BANCO-3). O prep_instructions editado ANTES da AG7, porem,
 * sobrescreveu o texto que a regua ja tinha mandado: esse texto velho nao
 * esta em lugar nenhum do banco, e o toque antigo com ele vai ao modelo como
 * esta (na producao de 03/11/2026, so um texto de 9 caracteres). O filtro
 * na saida continua barrando o preparo que o modelo escrever.
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

/** A normalizacao dos dois lados: NFKD sem as marcas, minusculas. */
function semAcentoEMinusculo(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

// A palavra: o que sobra entre o que nao e letra nem numero. Os dois lados
// viram a lista das palavras (o mesmo que trocar o resto por um espaco so e
// aparar as pontas).
const PALAVRA = /[\p{L}\p{N}]+/gu;

// O fim de frase: ponto, exclamacao, interrogacao, ponto e virgula ou dois
// pontos seguidos de branco (ou no fim), e a quebra de linha. "0,9" e
// "18:00" nao quebram.
const FIM_DE_FRASE = /[.!?;:\u2026]+(?=\s|$)|[\r\n\u2028\u2029]+/gu;
// Revisao da AG7 (CFM-8): o fim de frase e a virgula seguida de branco ("0,9"
// nao quebra).
const FIM_DE_FRASE_OU_ORACAO = /[.!?;:,\u2026]+(?=\s|$)|[\r\n\u2028\u2029]+/gu;

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

/**
 * O texto da clinica normalizado, em palavras. Revisao curta da AG7
 * (CURTA-2): as frases e as oracoes viram intervalos de palavras
 * ([inicio, fim)), e nao textos montados, e a busca compara palavra com
 * palavra: cada texto da lista do turno e preparado numa passada so (no
 * teto, um quarto do tempo de antes). O resultado e o mesmo de antes
 * (tests/unit/conformidade/preparo-desempenho.test.ts compara com a forma
 * antiga).
 */
type FormasDoTexto = {
  /** As palavras do texto (minusculas, sem acento), na ordem. */
  readonly palavras: readonly string[];
  /**
   * Os pontos de codigo das palavras antes de cada uma (o tamanho de um
   * trecho e a diferenca, mais os espacos entre as palavras).
   */
  readonly acumulado: readonly number[];
  /**
   * As frases e as oracoes entre virgulas com TAMANHO_MINIMO_DO_TRECHO
   * caracteres ou mais, e o texto inteiro, como [inicio, fim) nas palavras.
   */
  readonly trechos: readonly (readonly [number, number])[];
};

// As formas de cada texto, por lista (a do catalogo do turno), sem segurar a
// lista depois do turno.
const FORMAS_DA_LISTA = new WeakMap<
  readonly string[],
  Map<string, FormasDoTexto>
>();

/** Pontos de codigo da palavra (a letra fora do plano basico conta um). */
function pontosDeCodigo(palavra: string): number {
  let pontos = 0;
  for (let i = 0; i < palavra.length; i += 1) {
    const unidade = palavra.charCodeAt(i);
    // A primeira metade do par conta; a segunda, nao.
    if (unidade < 0xdc00 || unidade > 0xdfff) {
      pontos += 1;
    }
  }
  return pontos;
}

/** O tamanho do trecho [inicio, fim) com um espaco entre as palavras. */
function tamanhoDoTrecho(
  acumulado: readonly number[],
  inicio: number,
  fim: number,
): number {
  return (acumulado[fim] ?? 0) - (acumulado[inicio] ?? 0) + (fim - inicio - 1);
}

/** As palavras de um texto (minusculas, sem acento) e onde cada uma comeca. */
function palavrasDe(minusculo: string): {
  palavras: string[];
  inicios: number[];
} {
  const palavras: string[] = [];
  const inicios: number[] = [];
  for (const achado of minusculo.matchAll(PALAVRA)) {
    palavras.push(achado[0]);
    inicios.push(achado.index);
  }
  return { palavras, inicios };
}

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
  const { palavras, inicios } = palavrasDe(minusculo);
  const acumulado = [0];
  for (const palavra of palavras) {
    acumulado.push(
      (acumulado[acumulado.length - 1] ?? 0) + pontosDeCodigo(palavra),
    );
  }
  const trechos: (readonly [number, number])[] = [];
  const somar = (inicio: number, fim: number) => {
    if (
      fim > inicio &&
      tamanhoDoTrecho(acumulado, inicio, fim) >= TAMANHO_MINIMO_DO_TRECHO
    ) {
      trechos.push([inicio, fim]);
    }
  };
  // As frases e (revisao da AG7, CFM-8) as oracoes entre virgulas: as
  // palavras entre um corte e o seguinte. O corte nunca cai dentro de uma
  // palavra (so tem pontuacao e quebra de linha).
  for (const corte of [FIM_DE_FRASE, FIM_DE_FRASE_OU_ORACAO]) {
    let comeco = 0;
    let proxima = 0;
    for (const achado of minusculo.matchAll(corte)) {
      while (
        proxima < inicios.length &&
        (inicios[proxima] ?? 0) < achado.index
      ) {
        proxima += 1;
      }
      somar(comeco, proxima);
      comeco = proxima;
    }
    somar(comeco, palavras.length);
  }
  // O texto inteiro tambem conta: um texto so de frases curtas copiado por
  // inteiro.
  somar(0, palavras.length);
  const formas: FormasDoTexto = { palavras, acumulado, trechos };
  daLista.set(texto, formas);
  return formas;
}

/** As palavras da resposta e as posicoes de cada uma. */
type PalavrasDaResposta = {
  readonly palavras: readonly string[];
  readonly posicoes: ReadonlyMap<string, readonly number[]>;
};

/** As palavras [inicio, fim) do texto aparecem seguidas na resposta? */
function seguidasNaResposta(
  palavras: readonly string[],
  inicio: number,
  fim: number,
  resposta: PalavrasDaResposta,
): boolean {
  const posicoes = resposta.posicoes.get(palavras[inicio] ?? "");
  if (posicoes === undefined) {
    return false;
  }
  const quantas = fim - inicio;
  for (const posicao of posicoes) {
    if (posicao + quantas > resposta.palavras.length) {
      return false;
    }
    let iguais = 1;
    while (
      iguais < quantas &&
      resposta.palavras[posicao + iguais] === palavras[inicio + iguais]
    ) {
      iguais += 1;
    }
    if (iguais === quantas) {
      return true;
    }
  }
  return false;
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
  const { palavras: daResposta } = palavrasDe(semAcentoEMinusculo(rascunho));
  if (daResposta.length === 0) {
    return false;
  }
  const posicoes = new Map<string, number[]>();
  daResposta.forEach((palavra, posicao) => {
    const ja = posicoes.get(palavra);
    if (ja === undefined) {
      posicoes.set(palavra, [posicao]);
    } else {
      ja.push(posicao);
    }
  });
  const resposta: PalavrasDaResposta = { palavras: daResposta, posicoes };
  for (const texto of textos) {
    if (typeof texto !== "string") {
      continue;
    }
    const { palavras, acumulado, trechos } = formasDoTexto(texto, textos);
    for (const [inicio, fim] of trechos) {
      if (seguidasNaResposta(palavras, inicio, fim, resposta)) {
        return true;
      }
    }
    for (
      let inicio = 0;
      inicio + PALAVRAS_DA_JANELA_DO_TRECHO <= palavras.length;
      inicio += 1
    ) {
      const fim = inicio + PALAVRAS_DA_JANELA_DO_TRECHO;
      if (
        tamanhoDoTrecho(acumulado, inicio, fim) >= TAMANHO_MINIMO_DO_TRECHO &&
        seguidasNaResposta(palavras, inicio, fim, resposta)
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
  | "aprovada_sem_envio"
  | "aguardando"
  | "precisa_de_nova_aprovacao"
  | "suspenso"
  | "sem_orientacao";

/**
 * O chip da secao: as situacoes do banco; "aprovada_sem_envio" e a versao
 * aprovada cujo texto as regras de hoje recusam (revisao curta da AG7,
 * CURTA-5: o servidor confere; o envio nao a deixa sair).
 */
export type SituacaoDoChipDoPreparo = SituacaoDoPreparoNaTela;

/**
 * A orientacao de preparo na Tela 6, para a nota de "Enviar orientação de
 * preparo" (lida na pagina pela sessao, para todo papel que abre a tela):
 *  - "sai": algum procedimento ativo tem texto aprovado em vigor que as
 *    regras de hoje deixam sair (sem nota);
 *  - "aprovada_sem_envio": ha texto aprovado em vigor, mas as regras de hoje
 *    recusam o de todos: o envio e a regua nao os deixam sair, e Cadastros
 *    os mostra como "Aprovada, sem envio" (revisao curta da AG7, a sobra da
 *    CURTA-5 na Tela 6);
 *  - "sem_texto_aprovado": nenhum procedimento ativo tem texto aprovado em
 *    vigor.
 */
export type PreparoDaHabilidade =
  | "sai"
  | "aprovada_sem_envio"
  | "sem_texto_aprovado";

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
 *     RT aberto, com acesso ativo, e o nome do procedimento nao mudou); e
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
    return aprovada.rtId !== null &&
      e.rtAberto !== null &&
      aprovada.rtId === e.rtAberto.id &&
      e.rtComAcesso &&
      aprovada.nomeDoProcedimento === e.nomeAtual
      ? "aprovada"
      : "precisa_de_nova_aprovacao";
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
