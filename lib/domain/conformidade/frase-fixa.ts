// A frase que o paciente recebe quando a IA nao pode responder: regra
// disparada, verificador fora do ar, gatilho de entrada, teto atingido.
//
// E SEMPRE a mesma, qualquer que seja o motivo: assim o paciente nao usa a
// resposta para descobrir o que dispara o filtro. Nunca e escrita pela IA e
// sai como autor "sistema" (plano de seguranca 2.5).
//
// Texto aprovado pelo dono em 19/10/2026 (decisao 5). Um teste exige
// igualdade exata e outro exige que ela passe pelo filtro deterministico.
// Citar o 192 em caso de sintoma so com aval do responsavel tecnico.
export const FRASE_DE_ESCALONAMENTO =
  "Recebi sua mensagem. Vou passar sua conversa para alguém da nossa equipe, que vai te responder por aqui assim que possível.";

// As frases fixas que saem como RESPOSTA da IA (onda 2). Diferente da frase
// de escalonamento: o modelo so escolhe a frase (por uma ferramenta sem
// argumentos), nunca escreve o texto, e ela sai com autor "ia", depois de
// passar pelo filtro de saida INTEIRO como qualquer resposta (regras e
// verificador, falha fechada: bloqueio vira a frase de escalonamento;
// CLAUDE.md 3.2). Nada nelas revela o sistema (modelo, provedor,
// ferramenta, instrucao). Um teste exige que cada uma passe nas regras do
// filtro e no portao da bateria de conformidade.

/**
 * Item 5 (decisao do dono P5a): a pergunta que nao e da clinica nem de
 * saude, ou que e sobre a tecnologia, a empresa ou o modelo por tras do
 * assistente (ferramenta fora_do_assunto). Texto proposto no contrato da onda
 * 2 (secao 9), usado como esta por decisao do dono de 21/10/2026.
 */
export const FRASE_FORA_DO_ASSUNTO =
  "Desculpe, por aqui eu só consigo ajudar com assuntos da clínica. Posso ajudar com alguma coisa sobre a clínica?";

/**
 * PROPOSTA, espera aprovacao do dono (P5c e P11a; nao vai ao ar antes).
 * O MESMO texto (contrato da onda 2, P5c: "é o mesmo texto do aviso de
 * assistente virtual da P11a") serve a duas coisas:
 *  - a resposta a "você é um robô?" (ferramenta sou_assistente_virtual): diz
 *    que e a assistente virtual da clinica e oferece uma pessoa da equipe;
 *  - o aviso que o sistema cola antes da primeira resposta da IA em cada
 *    janela da conversa (P11a), descontado em limiteDaMensagem.
 * Sem o nome da clinica nem do assistente (texto fixo, igual para todas).
 */
export const FRASE_DO_ASSISTENTE_VIRTUAL =
  "Eu sou a assistente virtual da clínica. Se preferir falar com uma pessoa da equipe, é só pedir.";
