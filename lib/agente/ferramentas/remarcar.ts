// Remarcar pela IA (AG4, 27/10/2026; decisao D-10 do dono: a remarcacao cria
// uma consulta NOVA, pendente da aprovacao da equipe e ligada a antiga, que
// continua valendo ate a aprovacao). PURO: a definicao e a entrada de
// buscar_horario_para_remarcar e os motivos novos que reservar_horario_da_ia
// e agendar_pela_ia devolvem no modo de remarcacao (p_remarcar).
//
// O fluxo (agenda-do-turno.ts):
//  1. buscar_horario_para_remarcar({consulta: "c1", ...}): o primeiro uso fixa
//     a consulta em foco (etapa "remarcar", pedido "remarcar") e confere (o
//     espelho de conferir_consulta_da_ia, com o prazo de remarcar e a
//     consulta pendente da equipe de fora, D-26). O procedimento, o
//     profissional e o pagamento (convenio ou particular) sao os da consulta,
//     fixados no servidor; ao modelo vao so o dia, a hora e, com mais de uma
//     unidade na clinica, a unidade de cada horario (D-13), e
//     "mesmo_profissional": true. Os usos seguintes vem com consulta null (o
//     foco do estado);
//  2. reservar_horario(h2) no modo de remarcacao (o pedido "remarcar" no
//     estado): a pre-checagem do vinculo (o mesmo procedimento, profissional
//     e convenio) e a RPC com p_remarcar. Deu certo, o SISTEMA escreve a
//     pergunta fixa (T3) e arma "aguardando_confirmacao" pelo resultado;
//  3. agendar() numa mensagem nova: a RPC com p_remarcar cria a consulta
//     nova pendente (remarcacao_de = a antiga) e marca a antiga "pediu para
//     remarcar"; o sistema responde com o texto fixo (T4).
// A unidade pode mudar; dia e hora, claro. Outro profissional, procedimento
// ou convenio: a equipe (pedido_de_agenda).

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

// Sem importar de buscar-horario.ts: reservar-horario.ts importa daqui, e
// buscar-horario.ts importa de reservar-horario.ts (o ciclo quebraria a
// carga). Os periodos sao os de buscar_horario (um teste confere).

export const NOME_DA_BUSCA_PARA_REMARCAR = "buscar_horario_para_remarcar";

/** Os periodos do dia de buscar_horario (PERIODOS_DO_DIA). */
export const PERIODOS_DA_REMARCACAO = ["manha", "tarde", "noite"] as const;

/** Entrada validada no servidor (o modelo nunca e confiavel). */
export const entradaDaBuscaParaRemarcarSchema = z
  .object({
    consulta: z.string().trim().max(8).nullable(),
    a_partir_de: z.string().trim().max(10).nullable(),
    periodo: z.enum(PERIODOS_DA_REMARCACAO).nullable(),
    hora: z.string().trim().max(5).nullable(),
    unidade: z.string().trim().max(16).nullable(),
  })
  .strict();

export const FERRAMENTA_BUSCAR_HORARIO_PARA_REMARCAR: FunctionTool = {
  type: "function",
  name: NOME_DA_BUSCA_PARA_REMARCAR,
  strict: true,
  description:
    "Consulta horários livres para remarcar uma consulta da pessoa, sempre com o mesmo profissional, o mesmo procedimento e o mesmo pagamento da consulta. Cada horário vem com um código (h1, h2...) para reservar_horario. Na primeira vez, diga a consulta pelo código de consultar_minhas_consultas; depois, com consulta null, vale a consulta que já está sendo remarcada.",
  parameters: {
    type: "object",
    properties: {
      consulta: {
        type: ["string", "null"],
        description:
          "O código da consulta que a pessoa quer remarcar (c1, c2...), de consultar_minhas_consultas nesta resposta, ou null para a consulta que já está sendo remarcada.",
      },
      a_partir_de: {
        type: ["string", "null"],
        description:
          "Dia a partir do qual procurar, no formato aaaa-mm-dd, ou null para o primeiro horário possível.",
      },
      periodo: {
        type: ["string", "null"],
        enum: ["manha", "tarde", "noite", null],
        description:
          "Período do dia: manha (antes das 12:00), tarde (das 12:00 às 18:00) ou noite (depois das 18:00), ou null para qualquer período.",
      },
      hora: {
        type: ["string", "null"],
        description:
          "A hora que a pessoa pediu, no formato HH:mm (por exemplo 15:00), ou null. Com a_partir_de, a hora daquele dia.",
      },
      unidade: {
        type: ["string", "null"],
        description:
          "Código da unidade que a pessoa prefere (u1, u2...), de consultar_unidades, ou null para qualquer unidade.",
      },
    },
    required: ["consulta", "a_partir_de", "periodo", "hora", "unidade"],
    additionalProperties: false,
  },
};

/**
 * Os motivos que reservar_horario_da_ia e agendar_pela_ia devolvem no modo de
 * remarcacao (p_remarcar), alem dos de sempre (desenho da AG4, 3.3 c e d): a
 * habilidade e o prazo, o pedido no estado, a conferencia da consulta
 * (conferir_consulta_da_ia), o vinculo novo diferente do da consulta e, no
 * agendar, "a consulta mudou" desde o pedido.
 */
export const MOTIVOS_DA_REMARCACAO = [
  "remarcacao_desligada",
  "sem_pedido_de_remarcacao",
  "consulta_nao_encontrada",
  "consulta_encerrada",
  "encaixe",
  "so_com_a_equipe",
  "pendente_da_equipe",
  "remarcacao_pendente",
  "fora_do_prazo",
  "remarcacao_invalida",
  "consulta_mudou",
] as const;
export type MotivoDaRemarcacao = (typeof MOTIVOS_DA_REMARCACAO)[number];

export function ehMotivoDaRemarcacao(
  valor: unknown,
): valor is MotivoDaRemarcacao {
  return (
    typeof valor === "string" &&
    (MOTIVOS_DA_REMARCACAO as readonly string[]).includes(valor)
  );
}
