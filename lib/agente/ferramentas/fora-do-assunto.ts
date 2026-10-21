// As duas ferramentas de frase fixa do agente de IA (onda 2). PURO.
//
//  - fora_do_assunto (item 5; decisao do dono P5a): a mensagem nao e sobre a
//    clinica nem sobre saude, ou pergunta da tecnologia, da empresa ou do
//    modelo por tras do assistente. O paciente recebe FRASE_FORA_DO_ASSUNTO.
//    Insistir (a segunda na mesma janela, P5b) passa a conversa para a
//    equipe com o motivo de sistema fora_do_assunto (lib/agente/laco.ts).
//  - sou_assistente_virtual (P5c): a pessoa pergunta se esta falando com um
//    robo, uma maquina, uma inteligencia artificial ou uma pessoa, sem pedir
//    alguem. O paciente recebe FRASE_DO_ASSISTENTE_VIRTUAL, que diz que e a
//    assistente virtual da clinica e oferece uma pessoa da equipe. Nao conta
//    como fora do assunto. O contrato da onda 2 nao dizia o mecanismo desta:
//    e o mesmo da fora_do_assunto (frase fixa escolhida pelo modelo).
//
// As duas sao strict e SEM argumentos: o modelo so escolhe a ferramenta; o
// texto e do dono (lib/domain/conformidade/frase-fixa.ts) e passa pelo
// filtro de saida inteiro como qualquer resposta. Chamada com qualquer
// argumento e anomalia: falha fechada (ferramenta_invalida). Sempre
// oferecidas, como escalar_humano (habilidade travada "Responder dúvidas").

import type { FunctionTool } from "openai/resources/responses/responses";

export const NOME_DO_FORA_DO_ASSUNTO = "fora_do_assunto";
export const NOME_DO_ASSISTENTE_VIRTUAL = "sou_assistente_virtual";

const SEM_ARGUMENTOS = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

/** Definicao para a Responses API (strict, sem argumentos). */
export const FERRAMENTA_FORA_DO_ASSUNTO: FunctionTool = {
  type: "function",
  name: NOME_DO_FORA_DO_ASSUNTO,
  strict: true,
  description:
    "Use quando a mensagem não for sobre a clínica nem sobre saúde, ou perguntar sobre a tecnologia, a empresa ou o modelo de IA por trás do atendimento. O sistema responde ao paciente com uma frase pronta. Depois de chamar, não escreva mais nada.",
  parameters: { ...SEM_ARGUMENTOS },
};

/** Definicao para a Responses API (strict, sem argumentos). */
export const FERRAMENTA_SOU_ASSISTENTE_VIRTUAL: FunctionTool = {
  type: "function",
  name: NOME_DO_ASSISTENTE_VIRTUAL,
  strict: true,
  description:
    "Use quando a pessoa perguntar se está falando com um robô, uma máquina, uma inteligência artificial ou uma pessoa de verdade, sem pedir para falar com alguém. O sistema responde que esta é a assistente virtual da clínica e oferece uma pessoa da equipe. Depois de chamar, não escreva mais nada.",
  parameters: { ...SEM_ARGUMENTOS },
};

/**
 * Os argumentos da chamada valem: exatamente um objeto vazio (o que o
 * strict manda). Qualquer outra coisa (argumento, texto, nada): false, e o
 * laco falha fechado.
 */
export function semArgumentos(argumentos: unknown): boolean {
  return (
    typeof argumentos === "object" &&
    argumentos !== null &&
    !Array.isArray(argumentos) &&
    Object.keys(argumentos).length === 0
  );
}
