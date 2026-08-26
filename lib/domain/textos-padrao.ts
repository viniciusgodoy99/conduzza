import type { MenuOption } from "@/lib/integrations/whatsapp/provider";

// Copias EXATAS do que seed_reguas_padrao gravou em cadence_step.fixed_body
// (migration 20260826100000_motor_de_reguas.sql). Ficam aqui para a tela de
// Automacoes mostrar o texto padrao e para o teste provar que o codigo e o
// banco nao divergiram. Mudar um texto aqui sem migration correspondente
// quebra o teste de proposito.

/** 72 horas antes: offset_minutes -4320. */
export const CONFIRMACAO_72H =
  "Olá, {{nome}}! Aqui é da {{clinica}}. Sua consulta de {{procedimento}} com {{profissional}} está marcada para {{data}} às {{hora}}. Podemos confirmar sua presença?";

/** 24 horas antes: offset_minutes -1440. A linha do preparo some sozinha. */
export const CONFIRMACAO_24H =
  "Oi, {{nome}}! Amanhã, {{data}} às {{hora}}, você tem {{procedimento}} com {{profissional}}.\n{{preparo}}\nPodemos confirmar sua presença?";

/** 3 horas antes: offset_minutes -180. */
export const CONFIRMACAO_3H =
  "{{nome}}, sua consulta é hoje às {{hora}} com {{profissional}}. Está tudo certo para você vir?";

/** No instante em que a falta foi marcada: offset_minutes 0. */
export const POS_FALTA_D0 =
  "Oi, {{nome}}. Sentimos sua falta hoje na {{clinica}}. Aconteceu algum imprevisto? Se quiser remarcar, é só responder esta mensagem.";

/** Dois dias depois da falta: offset_minutes 2880. */
export const POS_FALTA_D2 =
  "Olá, {{nome}}! Ainda dá tempo de remarcar seu {{procedimento}}. Quer que a gente encontre um novo horário para você?";

export type PassoPadrao = {
  offsetMinutes: number;
  /** rotulo curto para a tela de Automacoes */
  rotulo: string;
  body: string;
};

export const PASSOS_CONFIRMACAO: readonly PassoPadrao[] = [
  { offsetMinutes: -4320, rotulo: "72 horas antes", body: CONFIRMACAO_72H },
  { offsetMinutes: -1440, rotulo: "24 horas antes", body: CONFIRMACAO_24H },
  { offsetMinutes: -180, rotulo: "3 horas antes", body: CONFIRMACAO_3H },
];

export const PASSOS_POS_FALTA: readonly PassoPadrao[] = [
  { offsetMinutes: 0, rotulo: "No dia da falta", body: POS_FALTA_D0 },
  { offsetMinutes: 2880, rotulo: "Dois dias depois", body: POS_FALTA_D2 },
];

/** Nomes das reguas padrao, iguais aos de seed_reguas_padrao. */
export const NOME_REGUA_CONFIRMACAO = "Confirmação de consulta";
export const NOME_REGUA_POS_FALTA = "Recuperação depois da falta";

// Retorno ao paciente que respondeu o toque de confirmacao (tarefa 4.7).
// Saem pelo job de envio ativo DEPOIS de a RPC mudar o status: sem eco a
// pessoa fica sem saber se a mensagem dela valeu. Texto fixo e curto de
// proposito, sem dado da consulta: quem responde ja sabe qual e.

/** Depois de confirmar_pelo_paciente. */
export const RESPOSTA_CONFIRMADA =
  "Presença confirmada, obrigado! Até lá.";

/** Depois de cancelar_pelo_paciente. */
export const RESPOSTA_CANCELADA =
  "Tudo bem, sua consulta foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.";

/** Pedido de remarcacao: nao muda status, a recepcao assume a conversa. */
export const RESPOSTA_REMARCAR =
  "Certo! Nossa recepção vai falar com você para encontrar um novo horário.";

/**
 * As tres opcoes do toque de confirmacao. O id e o que volta na resposta do
 * botao; o texto e o que o paciente le (e vira "1. Confirmar" quando o uazapi
 * degrada para lista numerada). Os dois caminhos sao lidos por
 * interpretarResposta.
 */
export const MENU_CONFIRMACAO: MenuOption[] = [
  { id: "confirmar", text: "Confirmar" },
  { id: "remarcar", text: "Remarcar" },
  { id: "cancelar", text: "Cancelar" },
];
