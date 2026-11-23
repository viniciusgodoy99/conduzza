// Ferramenta anotar_para_a_equipe do agente de IA (decisao do dono de
// 23/11/2026, "anota e continua"). PURO.
//
// A pessoa pergunta algo que a clinica NAO cadastrou (valor, procedimento,
// profissional, unidade, requisito, convenio, resposta da base): a IA nao
// passa mais a conversa. Ela anota a pergunta, resumida, e segue atendendo o
// resto. O executor do WhatsApp grava a nota interna na conversa e aplica a
// etiqueta "Pergunta para a equipe" (lib/agente/whatsapp.ts); a conversa
// continua com a IA. Sempre oferecida, como escalar_humano (a habilidade
// travada "Passar para a equipe").
//
// O resumo e do modelo e so vai para a nota interna (a equipe le na
// conversa): nunca para log, trilha ou ai_decision_log. Ele sai sem quebra de
// linha, sem os marcadores do envelope e com CPF, telefone e e-mail
// mascarados (minimizarParaLlm).

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import { minimizarParaLlm } from "@/lib/domain/conformidade/minimizar";
import { numaLinha, semMarcadores } from "@/lib/integrations/llm/verificador";

export const NOME_DA_ANOTACAO = "anotar_para_a_equipe";

/** Quantas perguntas um turno anota (a partir dai, a ferramenta recusa). */
export const MAXIMO_DE_ANOTACOES_POR_TURNO = 3;

const TAMANHO_DA_PERGUNTA = { minimo: 3, maximo: 200 } as const;

/** Definicao para a Responses API (strict). */
export const FERRAMENTA_ANOTAR_PARA_A_EQUIPE: FunctionTool = {
  type: "function",
  name: NOME_DA_ANOTACAO,
  strict: true,
  description:
    "Anota para a equipe da clínica uma pergunta da pessoa que o Cadastro, as ferramentas e o bloco <base_da_clinica> não respondem (valor, procedimento, profissional, unidade, o que levar, convênio ou outra informação da clínica que não está cadastrada). A conversa continua com você: depois de anotar, responda o resto e diga que deixou a pergunta anotada para a equipe responder por aqui, sem dizer quando.",
  parameters: {
    type: "object",
    properties: {
      pergunta: {
        type: "string",
        description:
          "A pergunta da pessoa resumida numa frase curta, sem nome, telefone, CPF, data de nascimento ou número de carteirinha.",
      },
    },
    required: ["pergunta"],
    additionalProperties: false,
  },
};

const entradaDaAnotacaoSchema = z.object({ pergunta: z.string() }).strict();

/** A pergunta pronta para a nota, ou null (entrada fora do formato). */
export function perguntaDaAnotacao(argumentos: unknown): string | null {
  const lido = entradaDaAnotacaoSchema.safeParse(argumentos);
  if (!lido.success) {
    return null;
  }
  const pergunta = numaLinha(semMarcadores(minimizarParaLlm(lido.data.pergunta)))
    .replace(/\s+/g, " ")
    .trim();
  const tamanho = Array.from(pergunta).length;
  return tamanho >= TAMANHO_DA_PERGUNTA.minimo &&
    tamanho <= TAMANHO_DA_PERGUNTA.maximo
    ? pergunta
    : null;
}

/** O que a ferramenta devolve ao modelo. */
export const SAIDAS_DA_ANOTACAO = {
  anotado: JSON.stringify({ resultado: "anotado" }),
  entradaInvalida: JSON.stringify({ resultado: "entrada_invalida" }),
  limite: JSON.stringify({ resultado: "limite_de_anotacoes" }),
} as const;

/** O passo da trilha (nunca a pergunta: e texto do paciente). */
export const PASSO_DA_ANOTACAO =
  "Anotou uma pergunta que o Cadastro não responde para a equipe responder por aqui. A conversa continua com o assistente.";
