// A urgencia (AG6a; decisoes D-51 e D-52, PENDENTES, construidas com a
// recomendacao): uma lista CURTA e DETERMINISTICA de sinais de emergencia na
// mensagem do paciente. PURO, zero I/O (roda tambem no navegador, pelo
// portao de entrada).
//
// Para que serve, e so isso: PASSAR a conversa para a equipe marcada como
// "Urgente" (no topo do Atendimento), com a frase de SEMPRE. A IA nunca faz
// triagem nem orienta (CLAUDE.md 3.2; CFM 2.314/2022): detectar o sinal nao
// e avaliar o sintoma, e nada daqui vira texto ao paciente. O aviso do SAMU
// (192) e do CVV (188) e da AG6c, com o responsavel tecnico; nesta rodada o
// contato recebe a frase de sempre.
//
// Quem chama:
//  - o executor do WhatsApp (lib/jobs/responder-com-ia.ts, passo 7c), nos
//    textos ORIGINAIS das mensagens pendentes, ANTES do teto de respostas, da
//    reserva do gasto e de qualquer modelo (o teto do dia acabado nao segura
//    a passagem da urgencia);
//  - o portao de entrada (gatilhos-de-entrada.ts), como o gatilho "urgencia",
//    o primeiro na ordem (categorias.ts): a segunda trava no laco e o
//    simulador.
// O classificador por modelo NAO decide urgencia (D-52): ele continua so com
// "sintoma", que passa com a frase de sempre e sem a marca.
//
// Regras que so BLOQUEIAM o caminho da IA: o que casar aqui passa a conversa;
// o que nao casar segue para o portao de sempre (o "sintoma" continua
// escalando com a frase de sempre). Falso positivo: a conversa vai para a
// equipe como Urgente (o que ja ia para a equipe pelo "sintoma" na maioria
// dos sinais). Falso negativo: cai no "sintoma", sem a marca (o de hoje).
//
// Como le o texto: as mesmas visoes do portao (base, despacado, leet,
// emendado e preservado, com as trocas de expressao permitida do portao:
// "Maria do Socorro", "sou a Dores") e, em cada uma, a letra repetida vira
// uma so ("faltaaa de arrr" vira "falta de ar"). Por isso as fontes abaixo
// sao escritas SEM letra dobrada ("morer", "horivel", "terivel"): um teste
// confere. Caixa alta nao importa (a base e minuscula, sem acento).
//
// A negacao: o sinal com "nao", "nunca", "nem", "jamais", "sem", "nenhum" ou
// "nenhuma" logo antes, na mesma oracao, com no maximo quatro palavras curtas
// no meio ("nao estou com falta de ar", "nunca tive convulsao", "nao e
// emergencia", "sem dor no peito") nao conta. Palavra de outro tipo no meio
// desfaz a negacao ("nao aguento mais quero morrer" continua urgente). A
// oracao acaba na pontuacao e em "mas", "porem", "so que" e "entao".
//
// LISTA PROPOSTA AO RT (D-51), nao aprovada: cada sinal tem nome, tipo e a
// fonte. Mudar um sinal muda a versao do portao (FONTES_DA_URGENCIA entra
// em fontesDoPortao, filtro.ts).
//
// Nada daqui vai para log (nem o nome do sinal: e dado de saude derivado do
// texto do paciente).

import {
  frasesDasVisoes,
  neutralizador,
  visoesDoTexto,
} from "@/lib/domain/conformidade/normalizar";
import { NEUTRALIZACOES_DE_ENTRADA } from "@/lib/domain/conformidade/padroes";

/**
 * Os dois tipos (desenho 1.1 e 5.2): o fisico e o risco de vida por
 * sofrimento. Na AG6a os dois passam do mesmo jeito (a frase de sempre e a
 * marca); a AG6c escolhe o aviso pelo tipo.
 */
export const TIPOS_DE_URGENCIA = ["fisica", "risco_de_vida"] as const;
export type TipoDeUrgencia = (typeof TIPOS_DE_URGENCIA)[number];

export type SinalDeEmergencia = {
  /** Nome estavel do sinal (teste e versao; nunca vai para log). */
  nome: string;
  tipo: TipoDeUrgencia;
  /** A fonte da regex, para o texto normalizado e sem letra repetida. */
  fonte: string;
  /**
   * A excecao lida no trecho ANTES do sinal, na mesma oracao: casou, o sinal
   * nao conta ("contato de emergencia", "historico de convulsao").
   */
  excecaoAntes?: string;
};

export type Urgencia = {
  tipo: TipoDeUrgencia;
  /** O primeiro sinal do tipo que venceu (so para teste; nunca para log). */
  sinal: string;
};

/** "ar condicionado", "ar livre": nao e o ar de respirar. */
const NAO_E_O_AR_DE_RESPIRAR =
  "(?!\\s?-?condicionad|\\s?cond\\b|\\s(?:livre|puro|fresco|quente|frio|seco|umido)\\b)";

/**
 * Quem esta "sem ar" e o lugar (a sala sem ar condicionado). Sem o "ai":
 * "ai, to sem ar" e de dor.
 */
const LUGAR_SEM_AR =
  "\\b(?:sala|salas|clinica|consultorio|recepcao|predio|espera|voces|vcs|vc|lugar|local|loja)\\b(?:\\s+\\S+){0,3}\\s*$";

/** A pergunta sobre o lugar: "ta sem ar ai?", "sem ar hoje?". */
const PERGUNTA_DO_LUGAR =
  "(?!\\s*(?:(?:ai|la|aqui|hoje|agora|de novo)\\s*)?\\?)";

/** O verbo de quem chama ou espera o socorro ("chama o SAMU"). */
const CHAMAR_O_SOCORRO =
  "(?:chamar|chama|chame|chamem|chamei|chamou|chamaram|chamamos|chamando|ligar|liga|ligue|liguem|liguei|ligou|ligaram|ligamos|ligando|acionar|aciona|acione|acionei|acionou|acionaram|esperando|aguardando|preciso d[ae]|precisa d[ae]|precisando d[ae])";

/** As palavras que reforcam a dor ("uma dor muito forte no peito"). */
const REFORCO_DA_DOR =
  "(?:muito|mto|mt|bem|super|tao|forte|fortes|intensa|intenso|aguda|horivel|terivel|insuportavel|esquisita|estranha|enorme|grande|grave|fortisima|absurda|danada|aqui|ai|la)";

/** Expressoes de exagero que nao sao risco de vida ("morrer de rir"). */
const EXAGERO_DE_MORRER =
  "(?! de (?:tanto|rir|vergonha|fome|sede|calor|frio|saudade|saudades|medo|tedio|sono|inveja|preguica|cansaco|curiosidade|amor|ciume|raiva|susto|felicidade|alegria|emocao|orgulho|chorar|dor de cabeca)\\b)";

/** "me matar de rir", "se matando de trabalhar". */
const EXAGERO_DE_MATAR =
  "(?! de (?:tanto|rir|trabalhar|estudar|fome|vergonha|cansaco|treinar|malhar|corer|comer)\\b)";

/**
 * A lista PROPOSTA ao RT (D-51; desenho 5.2), com as variacoes de escrita
 * de cada sinal. Fisica primeiro, risco de vida depois.
 */
export const SINAIS_DE_EMERGENCIA: readonly SinalDeEmergencia[] = [
  // ---- respirar -----------------------------------------------------------
  {
    nome: "falta_de_ar",
    tipo: "fisica",
    fonte: `\\b(?:falta(?: de)?|faltando|faltou)(?: o)? ar\\b${NAO_E_O_AR_DE_RESPIRAR}`,
  },
  {
    nome: "sem_ar",
    tipo: "fisica",
    fonte: `\\b(?:sem|perdi o|perdendo o) ar\\b${NAO_E_O_AR_DE_RESPIRAR}${PERGUNTA_DO_LUGAR}`,
    excecaoAntes: LUGAR_SEM_AR,
  },
  {
    nome: "nao_consigo_respirar",
    tipo: "fisica",
    fonte:
      "\\b(?:(?:nao|nem) (?:consigo|consegui|conseguia|consegue|conseguimos|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo|estava conseguindo|tava conseguindo)|sem conseguir) (?:mais )?respirar\\b",
  },
  {
    nome: "dificuldade_para_respirar",
    tipo: "fisica",
    fonte:
      "\\bdificuldades? (?:(?:de|para|pra|pa|em|pro) )?respirar\\b|\\bdificuldade respiratoria\\b|\\brespirando com dificuldade\\b",
  },
  { nome: "sufocando", tipo: "fisica", fonte: "\\bsufocando\\b" },
  {
    nome: "garganta_fechando",
    tipo: "fisica",
    fonte: "\\bgarganta (?:\\S+ ){0,3}?(?:fechando|fechou)\\b",
  },
  // ---- peito --------------------------------------------------------------
  {
    nome: "dor_no_peito",
    tipo: "fisica",
    fonte: `\\b(?:dor|dores|dorzinha|aperto|apertos|queimacao|queimor|pontada|pontadas)(?: ${REFORCO_DA_DOR})* (?:(?:no|do|em|nese|neste|aqui no|bem no)(?: meu)?|(?:no|do) (?:lado (?:esquerdo|direito)|meio|centro) do) peito\\b|\\bpeito (?:(?:ta|esta|todo|muito|bem|meio|super|tao|ficou|fica) )*(?:doendo|apertad[oa]|queimando|ardendo)\\b`,
  },
  // ---- desmaio e convulsao ------------------------------------------------
  {
    nome: "desmaio",
    tipo: "fisica",
    fonte: "\\bdesmai(?:ei|ou|ando|aram|amos)\\b|\\bdesmaiad[oa]s?\\b",
  },
  {
    nome: "perdeu_os_sentidos",
    tipo: "fisica",
    fonte:
      "\\bperd(?:i|eu|emos|eram|endo|ido) (?:os sentidos|a consciencia)\\b|\\b(?:ta|esta|ficou|estava|tava) (?:\\S+ )?(?:inconsciente|desacordad[oa])\\b",
  },
  {
    nome: "convulsao",
    tipo: "fisica",
    fonte: "\\bconvuls(?:ao|oes|ionando|ionou|ionei|ionaram|iva|ivo)\\b",
    // O historico e o remedio sao assunto clinico, nao a crise agora.
    excecaoAntes:
      "\\b(?:historico|historia|antecedente|antecedentes|ja tive|ja teve|ja tivemos|ja tinha|remedio|remedios|medicamento|medicamentos|medicacao|tratamento|tomo|toma|tomava|controle)\\b(?:\\s+(?:de|da|do|pra|para|pela|pelo|contra|com|uma|um|anti|alguma|algum|as|os))*\\s*$",
  },
  // ---- rosto, fala e um lado do corpo (sinais de AVC) ----------------------
  {
    nome: "boca_torta",
    tipo: "fisica",
    fonte: "\\bboca (?:\\S+ ){0,2}?(?:torta|entortou|entortando)\\b",
  },
  {
    nome: "rosto_torto_ou_caido",
    tipo: "fisica",
    fonte:
      "\\b(?:rosto|face|lado do rosto|metade do rosto) (?:\\S+ ){0,2}?(?:torto|torta|caido|caida|caindo|caiu|entortou|entortando)\\b",
  },
  {
    nome: "fala_enrolada",
    tipo: "fisica",
    fonte: "\\b(?:fala|falando) (?:\\S+ )?(?:enrolad[ao]|arastad[ao])\\b",
  },
  {
    nome: "nao_consigo_falar",
    tipo: "fisica",
    // So no fim da oracao: "nao consigo falar com a clinica" e "nao consigo
    // falar agora" nao sao o sinal.
    fonte:
      "\\b(?:nao|nem) (?:consigo|consegue|conseguia|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo) (?:mais )?falar(?: direito)?(?=\\s*$|\\s*[.!?,;:]|\\s+e\\b)",
    // Ligacao, atendimento ou alguem da clinica: e o telefone, nao a fala.
    excecaoAntes:
      "\\b(?:lig\\w*|telefon\\w*|chamada|chamadas|audio|whats|zap|zapzap|atend\\w*|recepc\\w*|secretaria|clinica|alguem|ninguem|voces|vcs|vc|doutor\\w*|dra|dr|medic\\w*)\\b",
  },
  {
    nome: "lado_do_corpo",
    tipo: "fisica",
    fonte:
      "\\b(?:lado|metade|parte|banda) (?:esquerd[oa] |direit[oa] )?do (?:meu )?corpo (?:\\S+ ){0,2}?(?:sem forca|fraco|fraca|dormente|dormentes|paralisad[oa]|adormecid[oa])\\b",
  },
  // ---- alergia forte ------------------------------------------------------
  {
    nome: "garganta_ou_lingua_inchando",
    tipo: "fisica",
    fonte: "\\b(?:garganta|lingua) (?:\\S+ ){0,2}?(?:inchando|inchou)\\b",
  },
  {
    nome: "reacao_alergica_forte",
    tipo: "fisica",
    fonte:
      "\\breac(?:ao|oes) alergicas? (?:\\S+ )?(?:forte|fortes|grave|graves|severa|severas|seria|serias)\\b|\\b(?:forte|grave|severa|seria) reac(?:ao|oes) alergicas?\\b",
  },
  {
    nome: "anafilaxia",
    tipo: "fisica",
    fonte: "\\banafila(?:xia|tic[oa]s?)\\b",
  },
  // ---- sangramento --------------------------------------------------------
  {
    nome: "sangrando_muito",
    tipo: "fisica",
    fonte:
      "\\bsangrando (?:muito|mto|mt|demais|bastante|sem parar|tanto|um monte|horores)\\b",
  },
  {
    nome: "nao_para_de_sangrar",
    tipo: "fisica",
    fonte:
      "\\b(?:nao|nem) (?:para|parou|ta parando|esta parando|quer parar|consigo parar|consegue parar|conseguimos parar|estanca|estancou) de sangrar\\b|\\b(?:sangue|sangramento) (?:que )?(?:nao|nem) (?:para|parou|estanca|estancou)\\b",
  },
  {
    nome: "muito_sangue",
    tipo: "fisica",
    fonte:
      "\\b(?:muito|mto|mt|bastante|tanto|um monte de) sangue\\b|\\bsangue (?:demais|pra todo lado)\\b",
  },
  // ---- emergencia e socorro -----------------------------------------------
  {
    nome: "emergencia",
    tipo: "fisica",
    fonte: "\\bemergencias?\\b",
    // O nome de uma coisa ("contato de emergencia", "saida de emergencia")
    // e a pergunta "em caso de emergencia" nao sao a emergencia.
    excecaoAntes:
      "\\b(?:(?:contato|contatos|telefone|telefones|numero|numeros|fone|celular|pesoa|saida|saidas|kit|luz|freio|botao|fundo) de|em caso de)\\s*$",
  },
  {
    nome: "chamar_o_socorro",
    tipo: "fisica",
    // "Chama o SAMU", "liguei pro 192", "a ambulancia esta a caminho". O
    // SAMU citado sem o pedido ("o SAMU fica perto dai?") nao conta.
    fonte: `\\b${CHAMAR_O_SOCORRO}(?: (?:o|a|um|uma|pro|pra|para|ao|no|na|de|do|da))?(?: (?:o|a))? (?:samu|ambulancia|192)\\b|\\b(?:samu|ambulancia) (?:(?:ja|ta|esta) )?(?:a caminho|vindo|chegando|chegou|veio|levou|levando)\\b`,
  },
  // ---- risco de vida (sofrimento) -----------------------------------------
  {
    nome: "quero_morrer",
    tipo: "risco_de_vida",
    fonte: `\\b(?:quero|queria|vontade de|to querendo|tou querendo|estou querendo|so quero|so queria|prefiro|preferia|desejo|pensando em|penso em|pensei em)(?: (?:muito|tanto|mesmo|so|logo))? morer\\b${EXAGERO_DE_MORRER}`,
  },
  {
    nome: "me_matar",
    tipo: "risco_de_vida",
    fonte: `\\b(?:me|se) mat(?:ar|o|ando)\\b${EXAGERO_DE_MATAR}`,
  },
  {
    nome: "tirar_a_propria_vida",
    tipo: "risco_de_vida",
    fonte:
      "\\btirar (?:a )?(?:minha|propria|sua|tua) (?:propria )?vida\\b|\\bacabar com (?:a )?(?:minha|propria) vida\\b|\\bdar fim (?:a|na) (?:minha )?vida\\b",
  },
  { nome: "suicidio", tipo: "risco_de_vida", fonte: "\\bsuicid\\w*" },
  {
    nome: "nao_quero_mais_viver",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:(?:nao|nem) (?:quero|queria|aguento|consigo|tenho (?:mais )?vontade de|vejo sentido em)|sem vontade de|cansad[oa] de) (?:mais )?viver\\b|\\b(?:vida|viver) nao (?:tem|faz) (?:mais )?sentido\\b",
  },
];

/**
 * As palavras curtas que podem ficar entre a negacao e o sinal ("nao ESTOU
 * COM falta de ar", "nunca TIVE convulsao"). Sem letra repetida ("iso").
 */
const PONTE_DA_NEGACAO =
  "(?:e|eh|foi|era|sera|seria|ta|to|tou|estou|esta|estava|estive|tava|tive|teve|tenho|tem|tinha|sinto|senti|sentiu|sentindo|sentir|com|de|da|do|uma|um|nenhuma|nenhum|mais|muita|muito|qualquer|tipo|caso|se|trata|me|eu|ela|ele|iso|deu|ficou|fiquei|houve|aconteceu|sou|ter|tido|estar|nada|ainda|mesmo|tanta|tanto|penso|pensei|pensou|pensar|pensando|em|nem|nunca)";

/** A negacao logo antes do sinal, no fim do trecho da mesma oracao. */
const NEGACAO_ANTES = new RegExp(
  `\\b(?:nao|nunca|nem|jamais|sem|nenhum|nenhuma)(?:\\s+${PONTE_DA_NEGACAO}){0,4}\\s*$`,
);

/** Onde a oracao comeca: depois da ultima pontuacao ou do "mas". */
const FIM_DA_ORACAO =
  /[.!?;,:\n]|\b(?:mas|porem|so que|entao|contudo|todavia)\b/g;

const SINAIS_COMPILADOS = SINAIS_DE_EMERGENCIA.map((sinal) => ({
  sinal,
  regex: new RegExp(sinal.fonte, "g"),
  excecao:
    sinal.excecaoAntes === undefined ? null : new RegExp(sinal.excecaoAntes),
}));

/** A letra repetida vira uma so ("faltaaa de arrr" vira "falta de ar"). */
function semLetraRepetida(texto: string): string {
  return texto.replace(/([a-z])\1+/g, "$1");
}

/** As trocas de expressao permitida do portao ("Maria do Socorro"). */
const neutralizarEntrada = neutralizador(NEUTRALIZACOES_DE_ENTRADA);

/** As visoes do portao, cada uma sem letra repetida, sem repetir. */
function leiturasDoTexto(texto: string): string[] {
  const visoes = visoesDoTexto(texto, [], neutralizarEntrada);
  return [...new Set(frasesDasVisoes(visoes).map(semLetraRepetida))];
}

/** O trecho da mesma oracao antes da posicao. */
function oracaoAntes(texto: string, posicao: number): string {
  const antes = texto.slice(0, posicao);
  let inicio = 0;
  for (const m of antes.matchAll(FIM_DA_ORACAO)) {
    inicio = (m.index ?? 0) + m[0].length;
  }
  return antes.slice(inicio);
}

/**
 * O sinal que ja traz a propria negacao ("nao consigo respirar", "nao para
 * de sangrar"): o "nao" logo antes e enfase ("nao, nao consigo respirar"),
 * nunca a negacao do sinal. O "sem" nao entra: "nao estou sem ar" nega.
 */
const SINAL_COM_A_PROPRIA_NEGACAO = /^(?:nao|nem) /;

/** O sinal casou numa leitura, fora da negacao e da excecao. */
function sinalNaLeitura(
  leitura: string,
  compilado: (typeof SINAIS_COMPILADOS)[number],
): boolean {
  for (const m of leitura.matchAll(compilado.regex)) {
    const antes = oracaoAntes(leitura, m.index ?? 0);
    if (!SINAL_COM_A_PROPRIA_NEGACAO.test(m[0]) && NEGACAO_ANTES.test(antes)) {
      continue;
    }
    if (compilado.excecao !== null && compilado.excecao.test(antes)) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * O sinal de emergencia nos textos (os originais do paciente: o texto, e na
 * AG6 a transcricao e a legenda). Nulo: nenhum sinal fora da negacao e das
 * excecoes. Risco de vida vence o fisico (o aviso da AG6c para o risco de
 * vida cita o CVV e o SAMU). Nunca lanca; texto nulo ou vazio e ignorado.
 */
export function detectarUrgencia(
  textos: readonly (string | null | undefined)[],
): Urgencia | null {
  let fisica: string | null = null;
  for (const texto of textos) {
    if (typeof texto !== "string" || texto.trim() === "") {
      continue;
    }
    const leituras = leiturasDoTexto(texto);
    for (const compilado of SINAIS_COMPILADOS) {
      if (compilado.sinal.tipo === "fisica" && fisica !== null) {
        continue;
      }
      if (leituras.some((leitura) => sinalNaLeitura(leitura, compilado))) {
        if (compilado.sinal.tipo === "risco_de_vida") {
          return { tipo: "risco_de_vida", sinal: compilado.sinal.nome };
        }
        fisica = compilado.sinal.nome;
      }
    }
  }
  return fisica === null ? null : { tipo: "fisica", sinal: fisica };
}

/**
 * O que define a urgencia, para a versao do portao (fontesDoPortao,
 * filtro.ts): cada sinal (tipo, nome, fonte e excecao), a negacao, o fim da
 * oracao e as regras de leitura. Sem hash aqui: roda no navegador.
 */
export const FONTES_DA_URGENCIA: readonly string[] = [
  ...SINAIS_DE_EMERGENCIA.map((sinal) =>
    [sinal.tipo, sinal.nome, sinal.fonte, sinal.excecaoAntes ?? ""].join(" "),
  ),
  NEGACAO_ANTES.source,
  FIM_DA_ORACAO.source,
  SINAL_COM_A_PROPRIA_NEGACAO.source,
  "leitura: as visoes do portao com as neutralizacoes de entrada, sem letra repetida",
  "risco_de_vida vence fisica; urgencia e o primeiro gatilho de entrada",
];
