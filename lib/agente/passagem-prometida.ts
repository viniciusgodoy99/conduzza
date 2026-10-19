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

const PROMESSAS: readonly RegExp[] = [
  // "Vou passar sua conversa para alguem da nossa equipe", "posso te
  // encaminhar para um atendente?", "ja vou passar voce a recepcao".
  new RegExp(
    `\\b${EU_VOU}\\s+(?:te\\s+|lhe\\s+)?${PASSAR}\\s+${O_QUE_PASSA}${PARA}${DESTINO}`,
  ),
  // "Vou encaminhar seu pedido", "vou te transferir".
  new RegExp(`\\b${EU_VOU}\\s+(?:te\\s+|lhe\\s+)?${PASSAR}\\s+${PEDIDO_DO_PACIENTE}`),
  new RegExp(
    `\\b${EU_VOU}\\s+(?:te|lhe|voce|vc)\\s+${TRANSFERIR}\\b|\\b${EU_VOU}\\s+${TRANSFERIR}\\s+(?:voce|vc)\\b`,
  ),
  // "Estou passando sua conversa para a equipe", "ja encaminhei para a
  // recepcao".
  new RegExp(
    `\\b(?:estou|to|tou|estamos)\\s+(?:te\\s+|lhe\\s+)?${PASSANDO}\\s+${O_QUE_PASSA}${PARA}${DESTINO}`,
  ),
  new RegExp(`\\b(?:te\\s+|lhe\\s+)?${PASSEI}\\s+${O_QUE_PASSA}${PARA}${DESTINO}`),
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
];

/**
 * A resposta promete passar a conversa para a equipe (ou que alguem vai
 * retornar)? Le o texto sem acento e sem caixa (normalizarBase).
 */
export function prometePassagemParaAEquipe(texto: string): boolean {
  const base = normalizarBase(texto);
  return PROMESSAS.some((padrao) => padrao.test(base));
}
