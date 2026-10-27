// Ferramentas pedir_cancelamento e cancelar_consulta do agente de IA (AG4,
// 27/10/2026; decisao D-9 do dono: cancelar pela IA como o botao do toque,
// com a confirmacao numa mensagem NOVA e o prazo da clinica). Duas fases,
// como reservar e agendar:
//  1. pedir_cancelamento({consulta}): confere a consulta (o espelho de
//     conferir_consulta_da_ia) e, podendo, o SISTEMA escreve a pergunta fixa
//     (T1, "Confirma o cancelamento da sua consulta de ...?") e arma o pedido
//     no estado do atendimento (etapa e pedido "cancelar", a consulta em
//     foco; o banco carimba o instante). O modelo nao escreve nada.
//  2. cancelar_consulta(), numa mensagem nova: so com o pedido armado no
//     comeco do turno; o "sim" do paciente e conferido numa lista fechada
//     (D-30, interpretarRespostaAoCancelamento) e a RPC
//     cancelar_consulta_pela_ia confere TUDO de novo (a trava da conversa,
//     a idempotencia pelo job, a habilidade e o prazo da versao publicada, o
//     pedido no estado, a consulta, "a consulta mudou" e a mensagem do
//     paciente depois da pergunta) e faz a mesma transicao do botao
//     (cancelado_paciente, com a reoferta e a regua pelos gatilhos de
//     sempre). Deu certo: o sistema responde com o texto do botao (T2).
// PURO: as definicoes, as entradas, os motivos da RPC e a leitura defensiva
// da resposta. Quem chama a RPC (com o job_id do turno) e lib/agente/agenda.ts.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

export const NOME_DO_PEDIDO_DE_CANCELAMENTO = "pedir_cancelamento";
export const NOME_DO_CANCELAMENTO = "cancelar_consulta";

export const entradaDoPedidoDeCancelamentoSchema = z
  .object({ consulta: z.string().trim().min(1).max(8) })
  .strict();

export const entradaDoCancelamentoSchema = z.object({}).strict();

export const FERRAMENTA_PEDIR_CANCELAMENTO: FunctionTool = {
  type: "function",
  name: NOME_DO_PEDIDO_DE_CANCELAMENTO,
  strict: true,
  description:
    "Pede o cancelamento de uma consulta da pessoa, pelo código que consultar_minhas_consultas trouxe nesta resposta. O sistema confere a consulta e o prazo e faz a pergunta de confirmação: depois de chamar, não escreva mais nada. Nada é cancelado aqui.",
  parameters: {
    type: "object",
    properties: {
      consulta: {
        type: "string",
        description: "O código da consulta, por exemplo c1.",
      },
    },
    required: ["consulta"],
    additionalProperties: false,
  },
};

export const FERRAMENTA_CANCELAR_CONSULTA: FunctionTool = {
  type: "function",
  name: NOME_DO_CANCELAMENTO,
  strict: true,
  description:
    'Cancela a consulta da pergunta de cancelamento que o sistema fez. Use só quando a pessoa responder que confirma, numa mensagem nova depois da pergunta "Confirma o cancelamento ...?". O sistema confere a resposta e responde (se a pergunta não valer mais, ele pergunta de novo): depois de chamar, não escreva mais nada.',
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

/**
 * Os motivos de cancelar_consulta_pela_ia (desenho da AG4, 3.3 b), lista
 * fechada, na ordem do banco: a trava da conversa, a habilidade e o prazo, o
 * pedido no estado, a conferencia da consulta (conferir_consulta_da_ia, sem
 * pendente_da_equipe, que so vale na remarcacao), "a consulta mudou", o
 * pedido vencido (revisao da AG4: a pergunta vale 60 minutos; o motor
 * pergunta de novo) e a mensagem do paciente logo depois da pergunta
 * (revisao da AG4: a ultima saida antes da ultima mensagem do paciente tem
 * de ser a pergunta da IA, a ancora forte). Revisao curta das correcoes da
 * AG4: mensagem_nova_do_paciente (a ultima mensagem do paciente nao esta
 * entre as que o job leu, ai_turno.mensagens_lidas): o turno para sem
 * enviar nada e o proximo le a mensagem nova.
 */
export const MOTIVOS_DO_CANCELAMENTO = [
  "ia_desligada",
  "cancelamento_desligado",
  "sem_pedido_de_cancelamento",
  "consulta_nao_encontrada",
  "consulta_encerrada",
  "encaixe",
  "so_com_a_equipe",
  "remarcacao_pendente",
  "fora_do_prazo",
  "consulta_mudou",
  "pedido_vencido",
  "mensagem_nova_do_paciente",
  "sem_confirmacao_do_paciente",
] as const;

/**
 * Revisao da AG4 (achado 1): a pergunta do cancelamento (T1) vale por 60
 * minutos (c_validade_do_pedido no banco: cancelar_consulta_pela_ia recusa
 * pedido_vencido e gravar_atendimento_da_ia carimba de novo o pedido
 * vencido). DECISAO A CONFIRMAR COM O DONO (o mesmo numero no banco).
 */
export const VALIDADE_DO_PEDIDO_MS = 60 * 60_000;

/**
 * O pedido armado no instante `pedidoEm` (ISO) ainda vale agora? Vencido e
 * `pedidoEm <= agora - 60 minutos`, como o banco; instante nulo ou
 * ilegivel nao vale (falha fechada).
 */
export function pedidoAindaVale(
  pedidoEm: string | null,
  agoraMs: number,
): boolean {
  if (pedidoEm === null) {
    return false;
  }
  const em = Date.parse(pedidoEm);
  return Number.isFinite(em) && em > agoraMs - VALIDADE_DO_PEDIDO_MS;
}
export type MotivoDoCancelamento = (typeof MOTIVOS_DO_CANCELAMENTO)[number];

export type RespostaDoCancelamento =
  | {
      ok: true;
      /** ISO (UTC) do inicio da consulta cancelada; null quando nao veio. */
      inicio: string | null;
      /** Repetir o job devolve o cancelamento que ele ja tinha feito. */
      reutilizado: boolean;
    }
  | { ok: false; motivo: MotivoDoCancelamento };

function ehInstante(valor: unknown): valor is string {
  return typeof valor === "string" && Number.isFinite(Date.parse(valor));
}

/**
 * O jsonb de cancelar_consulta_pela_ia, lido sem confiar no formato. null =
 * fora do formato (motivo desconhecido inclusive): quem chama falha fechado,
 * porque nao sabe o que o banco fez.
 */
export function lerRespostaDoCancelamento(
  dado: unknown,
): RespostaDoCancelamento | null {
  if (typeof dado !== "object" || dado === null || Array.isArray(dado)) {
    return null;
  }
  const r = dado as Record<string, unknown>;
  if (r.ok === true) {
    return {
      ok: true,
      inicio: ehInstante(r.starts_at) ? r.starts_at : null,
      reutilizado: r.reutilizado === true,
    };
  }
  if (
    r.ok === false &&
    typeof r.motivo === "string" &&
    (MOTIVOS_DO_CANCELAMENTO as readonly string[]).includes(r.motivo)
  ) {
    return { ok: false, motivo: r.motivo as MotivoDoCancelamento };
  }
  return null;
}
