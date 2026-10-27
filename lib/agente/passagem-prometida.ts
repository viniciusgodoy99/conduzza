// A resposta final do modelo que PROMETE passar a conversa para a equipe
// (ou que alguem vai retornar) sem ter chamado escalar_humano. PURO.
//
// Revisao de producao de 19/10/2026 (Q5): "Vou passar sua conversa para a
// equipe, que te informa o valor" saia como texto, porque nenhuma regra do
// filtro olha passagem e o verificador permite "dizer que vai passar a
// conversa para a equipe". A conversa continuava na IA, sem "Aguardando
// voce", e ninguem da equipe ficava sabendo: o paciente esperava uma
// resposta que nunca vinha. O laco (lib/agente/laco.ts) trata essa resposta
// como escalonamento (agente_pediu): o texto do modelo nunca sai e o
// paciente recebe a frase fixa, como em toda passagem.
//
// Lado seguro: na duvida, conta como promessa (o pior caso e passar para a
// equipe uma conversa que a IA podia continuar). Conta a primeira pessoa da
// IA ("vou passar", "encaminhei", "vou confirmar com a equipe", "ja te
// retorno") e a equipe agindo depois ("a equipe vai te responder", "alguem
// te responde"). Nao conta a informacao: "fale com a recepcao", "a equipe
// atende de segunda a sexta", "passe na recepcao", "vou te passar o valor",
// "a medica avalia na consulta".
//
// AG2 (27/10/2026): tambem conta a IA prometendo VOLTAR depois de conferir
// alguma coisa, sem chamar a ferramenta de passar ("vou verificar e ja te
// retorno", "deixa eu confirmar e te aviso", "vou checar e te falo", "te
// aviso assim que souber", "ja volto com a resposta", "aguarde um momento",
// "so um instante"). A IA so fala quando o paciente manda mensagem: quem
// promete voltar deixa o paciente esperando uma mensagem que nunca vem, e
// a conversa nao chega a ninguem da equipe. "A confirmacao chega por
// aqui" (a mensagem do sistema depois da aprovacao) e "entramos em contato
// um dia antes" (a rotina da clinica) continuam informacao.
//
// Revisao da AG2 (27/10/2026), com o que o turno fez (ContextoDaPassagem):
//  - depois de um agendar com sucesso (acao "marcou"), avisar da aprovacao
//    e informacao: "te confirmo assim que for aprovada", "te aviso assim
//    que a equipe confirmar" e "a equipe vai aprovar" falam da mensagem que
//    o sistema manda quando a equipe aprova a consulta pendente. Qualquer
//    outra promessa no mesmo texto continua contando;
//  - "vou conferir a agenda", "vou verificar a disponibilidade", "estou
//    verificando" sem ferramenta no turno (ou na ultima frase da resposta,
//    com ferramenta) contam: a IA nao volta sozinha, e o paciente fica
//    esperando. A oferta em pergunta ("posso verificar?") e a conferencia
//    com o resultado logo depois ("vou verificar: tenho terca as 14h") nao.

import type { AcaoDoTurno } from "@/lib/domain/conformidade/fatos-do-turno";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";

/** Palavras que podem vir antes de quem recebe ("alguem da nossa equipe"). */
const ANTES_DE_QUEM =
  "(?:(?:a|o|os|as|um|uma|nossa|nosso|nossas|nossos|alguem|algum|alguma|da|do|das|dos|de|time|pessoa|pessoas|colega|colegas)\\s+)*";

/** Quem da equipe age depois ("a equipe vai", "alguem te responde"). */
const EQUIPE = `${ANTES_DE_QUEM}(?:equipe|time|atendente|atendentes|recepcao|recepcionista|recepcionistas|secretaria|secretarias|colega|colegas|pessoa|pessoas|humano|humana|responsavel|responsaveis|setor|alguem)\\b`;

/** Para quem a IA passa (inclui a medica: "vou te passar para a Dra."). */
const DESTINO = `${ANTES_DE_QUEM}(?:equipe|time|atendente|atendentes|recepcao|recepcionista|recepcionistas|secretaria|secretarias|colega|colegas|pessoa|pessoas|humano|humana|responsavel|responsaveis|setor|alguem|dra|dr|doutora|doutor|medica|medico|enfermeira|enfermeiro|profissional)\\b`;

/** O que vai para a equipe ("sua conversa", "voce", "isso"). */
const O_QUE_PASSA =
  "(?:(?:te|lhe|voce|vc|a senhora|o senhor|sua conversa|seu atendimento|sua mensagem|suas mensagens|sua duvida|suas duvidas|sua pergunta|seu pedido|sua solicitacao|seu contato|seu caso|o seu caso|o caso|seu recado|isso|essa conversa|esta conversa|a conversa|o atendimento|essa duvida|essa pergunta|essa questao)\\s+)?";

/** O pedido do paciente como objeto, sem destino ("vou encaminhar seu pedido"). */
const PEDIDO_DO_PACIENTE =
  "(?:sua conversa|seu atendimento|sua mensagem|suas mensagens|sua duvida|suas duvidas|sua pergunta|seu pedido|sua solicitacao|seu contato|seu caso|seu recado)\\b";

const PASSAR =
  "(?:passar|encaminhar|transferir|repassar|direcionar|redirecionar|enviar|mandar|levar)";
const PASSANDO =
  "(?:passando|encaminhando|transferindo|repassando|direcionando|redirecionando|enviando|mandando|levando)";
const PASSEI =
  "(?:passei|encaminhei|transferi|repassei|direcionei|redirecionei|enviei|mandei|levei|encaminhamos|transferimos|repassamos)";
/** So os verbos que, com "te" ou "voce", ja sao passar a conversa. */
const TRANSFERIR = "(?:encaminhar|transferir|direcionar|redirecionar)";
const PASSADA =
  "(?:passad|encaminhad|transferid|repassad|direcionad|redirecionad|enviad)[oa]s?";
const PARA = "(?:para|pra|pro|ao|a|com)\\s+";
const EU_VOU =
  "(?:vou|irei|vamos|iremos|posso|podemos|ja vou|eu vou|deixa eu|deixe-me)";
const DEPOIS = "(?:ja\\s+|logo\\s+|em breve\\s+|depois\\s+|rapidinho\\s+)?";
const EQUIPE_E_APOSTO = `${EQUIPE}(?:\\s+d[aoe]s?\\s+\\w+){0,2}`;

/** Conferir alguma coisa ("vou verificar", "deixa eu confirmar"). */
const CONFERIR =
  "(?:verificar|confirmar|consultar|checar|conferir|ver|olhar|averiguar|pesquisar|procurar|levantar|analisar|validar|perguntar|buscar|dar uma (?:olhada|olhadinha|conferida|checada|verificada|pesquisada))";
/** Voltar a falar com o paciente, na primeira pessoa ("te aviso"). */
const VOLTAR =
  "(?:(?:te|lhe)\\s+)?(?:aviso|retorno|falo|digo|respondo|confirmo|informo|passo|mando|envio|chamo|escrevo|conto|volto|entro em contato)";
/** O depois da promessa ("assim que souber", "em seguida"). */
const QUANDO_VOLTA =
  "(?:assim que|quando|logo que|em seguida|em breve|daqui a pouco|ja ja|mais tarde|depois|em instantes|em alguns minutos|o quanto antes|se)";

const PROMESSAS: readonly RegExp[] = [
  // "Vou passar sua conversa para alguem da nossa equipe", "posso te
  // encaminhar para um atendente?", "ja vou passar voce a recepcao".
  new RegExp(
    `\\b${EU_VOU}\\s+(?:te\\s+|lhe\\s+)?${PASSAR}\\s+${O_QUE_PASSA}${PARA}${DESTINO}`,
  ),
  // "Vou encaminhar seu pedido", "vou te transferir".
  new RegExp(
    `\\b${EU_VOU}\\s+(?:te\\s+|lhe\\s+)?${PASSAR}\\s+${PEDIDO_DO_PACIENTE}`,
  ),
  new RegExp(
    `\\b${EU_VOU}\\s+(?:te|lhe|voce|vc)\\s+${TRANSFERIR}\\b|\\b${EU_VOU}\\s+${TRANSFERIR}\\s+(?:voce|vc)\\b`,
  ),
  // "Estou passando sua conversa para a equipe", "ja encaminhei para a
  // recepcao".
  new RegExp(
    `\\b(?:estou|to|tou|estamos)\\s+(?:te\\s+|lhe\\s+)?${PASSANDO}\\s+${O_QUE_PASSA}${PARA}${DESTINO}`,
  ),
  new RegExp(
    `\\b(?:te\\s+|lhe\\s+)?${PASSEI}\\s+${O_QUE_PASSA}${PARA}${DESTINO}`,
  ),
  // "Sua conversa foi encaminhada para a equipe".
  new RegExp(
    `\\b(?:foi|foram|sera|serao|vai ser|vao ser|esta sendo|estao sendo)\\s+${PASSADA}\\s+${PARA}${DESTINO}`,
  ),
  // "Vou confirmar com a equipe", "vou verificar com a recepcao e te aviso",
  // "vou pedir para a equipe te ligar", "vou avisar a equipe".
  new RegExp(
    `\\b${EU_VOU}\\s+(?:\\w+\\s+)?(?:verificar|confirmar|consultar|checar|conferir|perguntar|ver|falar|conversar|alinhar|pedir|solicitar)\\b[^.!?\\n]{0,40}?\\b${PARA}${DESTINO}`,
  ),
  new RegExp(
    `\\b${EU_VOU}\\s+(?:chamar|acionar|avisar|notificar|sinalizar)\\s+${DESTINO}`,
  ),
  // A oferta tambem: "quer que eu passe sua conversa para a equipe?".
  new RegExp(
    `\\bque eu\\s+(?:te\\s+|lhe\\s+)?(?:passe|encaminhe|transfira|repasse|direcione)\\s+${O_QUE_PASSA}${PARA}${DESTINO}|\\bque eu\\s+(?:chame|acione|avise)\\s+${DESTINO}`,
  ),
  // "A equipe vai te responder", "um atendente ja vai falar com voce",
  // "alguem te responde em breve", "nossa equipe entrara em contato".
  new RegExp(
    `\\b${EQUIPE_E_APOSTO}\\s+${DEPOIS}(?:vai|vao|ira|irao|deve|devem|devera|podera|pode)\\s+(?:te\\s+|lhe\\s+)?(?:entrar em contato|retornar|responder|atender|chamar|ligar|falar|dar|informar|confirmar|verificar|ajudar|passar|explicar|enviar|mandar|esclarecer|orientar|tirar|resolver|continuar|seguir|cuidar|conversar)\\b`,
  ),
  new RegExp(
    `\\b${EQUIPE_E_APOSTO}\\s+${DEPOIS}(?:te|lhe)\\s+(?:responde|retorna|atende|liga|chama|procura|informa|explica|passa|confirma)\\b`,
  ),
  new RegExp(
    `\\b${EQUIPE_E_APOSTO}\\s+${DEPOIS}(?:entrara em contato|retornara|respondera|atendera|ligara|informara|confirmara|explicara|esclarecera)\\b`,
  ),
  // A IA prometendo voltar depois: "ja te retorno", "te dou um retorno",
  // "entraremos em contato". Ela nao volta: so a equipe.
  /\b(?:te|lhe)\s+(?:retorno|retornamos|retornaremos|dou\s+(?:um\s+)?retorno|damos\s+(?:um\s+)?retorno|darei\s+(?:um\s+)?retorno|daremos\s+(?:um\s+)?retorno)\b/,
  /\b(?:entraremos|entrarei)\s+em\s+contato\b/,
  // AG2: conferir e voltar depois. "Vou verificar e ja te retorno", "deixa
  // eu confirmar e te aviso", "vou checar aqui e te falo", "vou ver a agenda
  // e retorno", "vou consultar e entro em contato". A pergunta ("posso
  // verificar e te aviso?") nao conta: a resposta do paciente traz a IA de
  // volta.
  new RegExp(
    `\\b${EU_VOU}\\s+(?:\\w+\\s+){0,2}?${CONFERIR}\\b[^.!?\\n]{0,60}?\\be\\s+(?:ja\\s+|logo\\s+|depois\\s+|em seguida\\s+)?${VOLTAR}\\b(?![^.!?\\n]*\\?)`,
  ),
  // "Te aviso assim que souber", "te falo em seguida", "e aviso se surgir
  // uma vaga". Revisao da AG2: e no fim da frase ("assim que tiver
  // novidade, te aviso", "pode deixar que te aviso").
  new RegExp(
    `\\b(?:te|lhe)\\s+(?:aviso|falo|digo|respondo|confirmo|informo|passo|mando|envio|escrevo|conto)\\s+${QUANDO_VOLTA}\\b|\\be\\s+aviso\\s+${QUANDO_VOLTA}\\b|\\b(?:te|lhe)\\s+(?:aviso|falo|digo|respondo|confirmo|informo|retorno)\\s*(?:[.!]|$)`,
  ),
  // "Ja volto", "volto em seguida", "volto com a resposta", "retorno ja ja".
  /\b(?:ja|logo)\s+(?:te\s+)?(?:volto|retorno)\b|\b(?:volto|retorno)\s+(?:ja\b|logo\b|em seguida|em breve|em instantes|ja ja|daqui a pouco|assim que|com (?:a|as|uma|o|os) (?:resposta|informac|confirmac|retorno|novidade|valor|horario))/,
  // "Assim que eu souber", "assim que tiver a resposta".
  /\bassim que eu\s+(?:souber|tiver|conseguir|verificar|confirmar|checar|receber|falar)\b|\bassim que (?:souber|tiver (?:a|uma|o) (?:resposta|informac|confirmac|retorno))/,
  // "Aguarde um momento", "me da um minutinho" (fora da recepcao: "aguarde
  // um momento na recepcao, que a Dra. chama" e informacao).
  /\b(?:aguarde|aguarda|espere|espera|me (?:da|de)(?:\s+so)?)\s+(?:so\s+)?(?:um|uns)\s+(?:momento|minuto|minutinho|minutos|instante|instantinho|pouquinho|segundo|segundinho)s?\b(?!\s+(?:na|no|ao|quando|ate)\s+(?:recepcao|sala|consultorio|chegar|chegada|ser chamad))/,
  // "So um instante.", "Um momento, por favor."
  /(?:^|[.!?,]\s*)(?:so\s+)?um\s+(?:momento|minutinho|instante|instantinho|segundinho|minuto)\b(?=\s*(?:[,.!]|por favor|que\b|enquanto|$))/,
];

/** O que o turno fez antes da resposta final (lib/agente/laco.ts). */
export type ContextoDaPassagem = {
  /** Alguma ferramenta rodou no turno (consulta, valor, agenda). */
  usouFerramenta: boolean;
  /** As acoes que as ferramentas do turno executaram com sucesso. */
  acoes: readonly AcaoDoTurno[];
};

/** Sem o turno: nenhuma ferramenta, nenhuma acao (o lado seguro). */
const TURNO_SEM_FERRAMENTA: ContextoDaPassagem = {
  usouFerramenta: false,
  acoes: [],
};

/** A aprovacao da consulta pendente pela equipe. */
const APROVACAO =
  "(?:aprovad\\w*|aprovar\\w*|aprovacao|confirmad\\w*|confirmar\\w*|confirmacao|liberad\\w*|liberar\\w*|validad\\w*|validar\\w*)";
const QUANDO_APROVA =
  "(?:assim que|quando|logo que|apos|depois que|depois da|depois de|tao logo)";
const AVISO =
  "(?:aviso|confirmo|informo|falo|digo|mando|envio|escrevo|conto|passo)";

/**
 * Revisao da AG2: com a consulta marcada no turno, o aviso da aprovacao e
 * informacao ("te confirmo assim que for aprovada", "assim que a equipe
 * aprovar, te aviso", "a equipe vai aprovar sua consulta").
 */
const AVISOS_DA_APROVACAO: readonly RegExp[] = [
  new RegExp(
    `\\b(?:te|lhe)\\s+${AVISO}\\s+${QUANDO_APROVA}\\b[^.!?]{0,60}?\\b${APROVACAO}`,
    "g",
  ),
  new RegExp(
    `\\b${QUANDO_APROVA}\\b[^.!?]{0,60}?\\b${APROVACAO}[^.!?]{0,30}?\\b(?:te|lhe)\\s+${AVISO}\\b`,
    "g",
  ),
  new RegExp(
    `\\b${EQUIPE_E_APOSTO}\\s+${DEPOIS}(?:vai|vao|ira|irao|deve|devem)\\s+(?:aprovar|confirmar|validar|liberar)(?:\\s+(?:a|o|sua|seu)\\s+(?:consulta|agendamento|marcacao|horario))?(?=\\s*(?:[.!,]|$|em breve|assim que|logo|ainda hoje))`,
    "g",
  ),
];

/** Conferir sem voltar: o verbo no infinitivo e no gerundio. */
const CONFERINDO =
  "(?:verificando|conferindo|consultando|checando|procurando|pesquisando|analisando|buscando|confirmando|levantando)";
/**
 * Revisao da AG2: "vou conferir a agenda", "vou verificar a
 * disponibilidade", "deixa eu ver", "estou verificando". Fora da pergunta e
 * sem o resultado logo depois dos dois pontos.
 */
const CONFERIR_SEM_VOLTAR = new RegExp(
  `\\b(?:(?:${EU_VOU})\\s+(?:\\w+\\s+){0,2}?${CONFERIR}|(?:estou|to|tou|estamos|ja estou)\\s+(?:\\w+\\s+)?${CONFERINDO})\\b(?![^.!?\\n]*:)`,
);
/** "Posso verificar", "podemos ver": a oferta, nao a promessa. */
const OFERTA_DE_CONFERIR = /\b(?:posso|podemos|poderia|poderiamos)\b/;

/**
 * As frases do texto normalizado, com o ponto que fecha (o de "Dra." e o
 * de "Av." nao fecham).
 */
function frasesDe(base: string): string[] {
  return base
    .split(/(?<=[!?]|\.\.|(?<=[a-z]{4}|\d)\.)\s+/)
    .map((frase) => frase.trim())
    .filter((frase) => frase !== "");
}

function conferirSemVoltar(frase: string): boolean {
  const casou = CONFERIR_SEM_VOLTAR.exec(frase);
  if (casou === null || frase.trimEnd().endsWith("?")) {
    return false;
  }
  return !OFERTA_DE_CONFERIR.test(casou[0]);
}

/**
 * A resposta promete passar a conversa para a equipe (ou que alguem vai
 * retornar)? Le o texto sem acento e sem caixa (normalizarBase). Sem o
 * contexto do turno, o lado seguro: nenhuma ferramenta e nenhuma acao.
 */
export function prometePassagemParaAEquipe(
  texto: string,
  contexto: ContextoDaPassagem = TURNO_SEM_FERRAMENTA,
): boolean {
  let base = normalizarBase(texto);
  if (contexto.acoes.includes("marcou")) {
    for (const aviso of AVISOS_DA_APROVACAO) {
      base = base.replace(aviso, " ");
    }
  }
  if (PROMESSAS.some((padrao) => padrao.test(base))) {
    return true;
  }
  const frases = frasesDe(base);
  const conferir = contexto.usouFerramenta ? frases.slice(-1) : frases;
  return conferir.some(conferirSemVoltar);
}
