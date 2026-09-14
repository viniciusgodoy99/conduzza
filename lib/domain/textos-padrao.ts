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

/**
 * No instante em que a falta foi marcada: offset_minutes 0. O texto cita a
 * DATA DA CONSULTA, nunca "hoje": quem marca a falta e uma pessoa (regra 3.5)
 * e ela pode fechar o dia dias depois, quando "hoje" ja seria mentira.
 */
export const POS_FALTA_D0 =
  "Oi, {{nome}}. Sentimos sua falta na {{clinica}}, no seu horário de {{data}}. Aconteceu algum imprevisto? Se quiser remarcar, é só responder esta mensagem.";

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

const ROTULO_POR_OFFSET = new Map(
  [...PASSOS_CONFIRMACAO, ...PASSOS_POS_FALTA].map((passo) => [
    passo.offsetMinutes,
    passo.rotulo,
  ]),
);

/**
 * "72 horas antes" para os passos padrao; conta horas (ou dias, quando a
 * conta fecha redonda) para os demais. Compartilhado entre o painel da Tela 2
 * e o editor da Tela 7.
 */
export function rotuloDoPasso(offsetMinutes: number): string {
  const conhecido = ROTULO_POR_OFFSET.get(offsetMinutes);
  if (conhecido) {
    return conhecido;
  }
  if (offsetMinutes === 0) {
    return "Na hora";
  }
  const absoluto = Math.abs(offsetMinutes);
  const sufixo = offsetMinutes < 0 ? "antes" : "depois";
  if (absoluto % 1440 === 0) {
    const dias = absoluto / 1440;
    return dias === 1 ? `1 dia ${sufixo}` : `${dias} dias ${sufixo}`;
  }
  const horas = Math.round(absoluto / 60);
  return horas === 1 ? `1 hora ${sufixo}` : `${horas} horas ${sufixo}`;
}

/** Nomes das reguas padrao, iguais aos de seed_reguas_padrao. */
export const NOME_REGUA_CONFIRMACAO = "Confirmação de consulta";
export const NOME_REGUA_POS_FALTA = "Recuperação depois da falta";

// Retorno ao paciente que respondeu o toque de confirmacao (tarefa 4.7).
// Saem pelo job de envio ativo DEPOIS de a RPC mudar o status: sem eco a
// pessoa fica sem saber se a mensagem dela valeu. Texto fixo e curto de
// proposito, sem dado da consulta: quem responde ja sabe qual e.

/** Depois de confirmar_pelo_paciente. */
export const RESPOSTA_CONFIRMADA = "Presença confirmada, obrigado! Até lá.";

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

// Lista de espera (tarefa 4.9): a oferta do horario vago e os retornos. A
// oferta instrui exatamente o vocabulario que o interceptador entende
// (interpretarRespostaDeOferta). {{prazo}} e a janela em minutos da clinica.

export const OFERTA_DE_ESPERA =
  "Oi, {{nome}}! Aqui é da {{clinica}}. Abriu um horário de {{procedimento}} com {{profissional}}: {{data}} às {{hora}}. Você está na nossa lista de espera e pode ficar com ele. Responda SIM em até {{prazo}} minutos e o horário é seu. Se não quiser, responda NÃO QUERO, que você continua na lista.";

/** O vencedor da oferta. */
export const RESPOSTA_OFERTA_GANHOU =
  "O horário é seu! Ficou marcado para {{data}} às {{hora}} com {{profissional}}. Até lá!";

/** O segundo a responder (a recusa educada do aceite da 4.9). */
export const RESPOSTA_OFERTA_PERDIDA =
  "Poxa, esse horário não está mais disponível. Você continua na nossa lista de espera e a gente avisa quando abrir outra vaga.";

/** Quem respondeu que nao quer ESTA vaga. */
export const RESPOSTA_OFERTA_RECUSADA =
  "Tudo bem! Você continua na lista de espera para a próxima vaga.";
