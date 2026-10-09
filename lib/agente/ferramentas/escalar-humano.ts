// Ferramenta escalar_humano do agente de IA (E2): passar a conversa para a
// equipe. PURO. A habilidade "Passar para a equipe" e travada ligada
// (lib/domain/agente/config.ts): o modelo sempre recebe esta ferramenta.
//
// O motivo e um codigo de escalation_reason (CHECK de ai_decision_log). O
// modelo so escolhe entre os motivos que fazem sentido para ele; os do
// sistema (conformidade, teto, midia) nunca vem do modelo. Pedido de passar
// para a equipe NUNCA falha: entrada fora do formato vira "agente_pediu",
// porque a intencao de escalar ja e clara e escalar e o lado seguro.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import type { MotivoDeEscalonamento } from "@/lib/domain/agente/config";

export const NOME_DO_ESCALONAMENTO = "escalar_humano";

/** Os motivos que o modelo pode dar (subconjunto de escalation_reason). */
export const MOTIVOS_DO_AGENTE = [
  "sintoma",
  "assunto_clinico",
  "pedido_humano",
  "insatisfacao",
  "valor_fora_da_tabela",
  "menor_de_idade",
  "tentativa_de_manipulacao",
  "regra_do_procedimento",
  "falhas_seguidas",
  "agente_pediu",
] as const satisfies readonly MotivoDeEscalonamento[];

export type MotivoDoAgente = (typeof MOTIVOS_DO_AGENTE)[number];

export const entradaDoEscalonamentoSchema = z
  .object({ motivo: z.enum(MOTIVOS_DO_AGENTE) })
  .strict();

/** Definicao para a Responses API (strict). */
export const FERRAMENTA_ESCALAR_HUMANO: FunctionTool = {
  type: "function",
  name: NOME_DO_ESCALONAMENTO,
  strict: true,
  description:
    "Passa a conversa para uma pessoa da equipe da clínica. Depois de chamar, não escreva mais nada: o sistema avisa o paciente.",
  parameters: {
    type: "object",
    properties: {
      motivo: {
        type: "string",
        enum: [...MOTIVOS_DO_AGENTE],
        description: "Por que a conversa vai para a equipe.",
      },
    },
    required: ["motivo"],
    additionalProperties: false,
  },
};

/** O motivo pedido pelo modelo; fora do formato, "agente_pediu". */
export function motivoDoEscalonamento(argumentos: unknown): MotivoDoAgente {
  const lido = entradaDoEscalonamentoSchema.safeParse(argumentos);
  return lido.success ? lido.data.motivo : "agente_pediu";
}
