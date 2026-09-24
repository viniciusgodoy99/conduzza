import {
  dentroDaJanela,
  proximaAbertura,
  type JanelaDeEnvio,
} from "./cadence";
import { diaCivil, diasEntre } from "./horarios";

// Toque de confirmacao ATRASADO (achado da revisao de 24/09/2026). Regras
// PURAS, sem I/O: quem le banco e decide o envio e lib/jobs/regua.ts.
//
// O texto de cada passo fala do DIA da consulta em relacao ao dia do envio: o
// de 24h diz "Amanhã", o de 3h diz "hoje". Quando a janela de envio (ou o
// WhatsApp fora do ar) empurra um toque para OUTRO dia civil, esse texto passa
// a mentir. O caso real: janela de segunda a sabado, 08:00 as 18:00, consulta
// segunda as 09:00. O toque de 24h vence domingo as 09:00, fora da janela, e
// sairia segunda as 08:00 dizendo "Amanhã", colado no de 3h ("é hoje").
//
// A regra:
//   - mesmo dia civil do vencimento: nada muda;
//   - outro dia, e um passo POSTERIOR da mesma regua sai antes da consulta NO
//     MESMO DIA CIVIL em que este sairia: este toque e pulado
//     ('toque_atrasado'), o seguinte cobre aquele dia (o caso do "Amanhã"
//     colado no "é hoje");
//   - outro dia, sem passo posterior naquele mesmo dia: o toque sai (melhor
//     avisar que nao avisar), com o dia relativo do texto corrigido.
//
// Por que o MESMO DIA, e nao "qualquer passo posterior a tempo" (revisao da
// leva 1, 24/09/2026): janela de segunda a sabado, 08:00 as 18:00, consulta
// terca as 18:30. O de 72h cai segunda 08:00, o de 24h cai terca 08:00 e o de
// 3h sai terca 15:30. Com a regra antiga o de 72h cedia ao de 24h (ou ao de
// 3h), o de 24h cedia ao de 3h, e o paciente ficava so com o toque de 3h. O
// de 72h e o unico aviso de segunda: ele sai, e o texto dele (com a data por
// extenso) continua certo.
//
// A cascata ("o posterior tambem sera pulado?") ja esta resolvida por essa
// regra, sem recursao: se algum passo posterior sai naquele dia, o ULTIMO
// deles nao tem outro depois dele no mesmo dia, entao nunca e pulado e de
// fato avisa o paciente naquele dia (com o dia do texto corrigido, se for o
// caso). A saida efetiva cresce com o offset, entao "algum sai naquele dia"
// e "o que de fato sai naquele dia" sao a mesma pergunta.

const MINUTOS_POR_DIA = 1440;

/** O "dia" que o texto de um passo afirma: -180 e hoje, -1440 e amanha. */
export function diaDoPasso(offsetMinutes: number): number {
  return Math.floor(-offsetMinutes / MINUTOS_POR_DIA);
}

/** O toque vai sair num dia civil diferente daquele em que venceu? */
export function mudouDeDia(entrada: {
  agora: Date;
  scheduledFor: Date;
  timezone: string;
}): boolean {
  return (
    diaCivil(entrada.timezone, entrada.agora) !==
    diaCivil(entrada.timezone, entrada.scheduledFor)
  );
}

/**
 * Quando um passo de fato sairia, visto de `agora`: no vencimento dele (ou
 * agora, se ja venceu), empurrado para a proxima abertura da janela quando
 * cai fora dela. Null quando a janela e invalida.
 */
export function saidaEfetiva(entrada: {
  venceEm: Date;
  agora: Date;
  janela: JanelaDeEnvio;
  timezone: string;
}): Date | null {
  const inicio =
    entrada.venceEm.getTime() > entrada.agora.getTime()
      ? entrada.venceEm
      : entrada.agora;
  if (dentroDaJanela(entrada.janela, inicio, entrada.timezone)) {
    return inicio;
  }
  return proximaAbertura(entrada.janela, inicio, entrada.timezone);
}

/**
 * Existe passo da mesma regua MAIS PERTO da consulta (offset maior, ainda
 * antes do evento) que sai antes dela e NO MESMO DIA CIVIL em que este toque
 * sai (`agora`)? So esse cobre o toque atrasado: e ele que avisa o paciente
 * naquele dia, com o texto certo. Um passo que so sai num dia seguinte nao
 * cobre, porque pular este toque deixaria o paciente sem aviso neste dia (ver
 * o cabecalho: a cascata ja esta resolvida por esta regra).
 */
export function existePassoPosteriorNoMesmoDia(entrada: {
  passos: readonly { offsetMinutes: number }[];
  offsetDoToque: number;
  startsAt: Date;
  agora: Date;
  janela: JanelaDeEnvio;
  timezone: string;
}): boolean {
  const inicioDaConsulta = entrada.startsAt.getTime();
  const diaDoToque = diaCivil(entrada.timezone, entrada.agora);
  return entrada.passos.some((passo) => {
    if (passo.offsetMinutes <= entrada.offsetDoToque || passo.offsetMinutes >= 0) {
      return false;
    }
    const saida = saidaEfetiva({
      venceEm: new Date(inicioDaConsulta + passo.offsetMinutes * 60_000),
      agora: entrada.agora,
      janela: entrada.janela,
      timezone: entrada.timezone,
    });
    return (
      saida !== null &&
      saida.getTime() < inicioDaConsulta &&
      diaCivil(entrada.timezone, saida) === diaDoToque
    );
  });
}

const PALAVRA_DO_DIA: Record<number, string> = {
  0: "hoje",
  1: "amanhã",
  2: "depois de amanhã",
};

// "amanhã" (com ou sem acento) como palavra inteira, sem pegar o "amanhã" de
// "depois de amanhã". \b nao entende letra acentuada: a fronteira e feita a
// mao com a classe de letras do Unicode.
const PADRAO_DO_DIA: Record<number, RegExp> = {
  1: /(?<!depois de\s)(?<!\p{L})amanh[ãa](?!\p{L})/giu,
  2: /(?<!\p{L})depois de amanh[ãa](?!\p{L})/giu,
};

function comMesmaCaixa(original: string, troca: string): string {
  const primeira = original.charAt(0);
  if (primeira !== primeira.toLocaleLowerCase("pt-BR")) {
    return troca.charAt(0).toLocaleUpperCase("pt-BR") + troca.slice(1);
  }
  return troca;
}

/**
 * Troca o dia relativo que o texto do passo afirma pelo dia verdadeiro. Mexe
 * so na palavra do dia ("Amanhã" vira "Hoje"), nunca no resto do texto que a
 * clinica escreveu. Aplicar no MODELO, antes de preencher os campos: um nome
 * de paciente nunca e alterado.
 */
export function corrigirDiaRelativo(
  modelo: string,
  entrada: { diaDoPasso: number; diasAteAConsulta: number },
): string {
  if (entrada.diaDoPasso === entrada.diasAteAConsulta) {
    return modelo;
  }
  const padrao = PADRAO_DO_DIA[entrada.diaDoPasso];
  const troca = PALAVRA_DO_DIA[entrada.diasAteAConsulta];
  if (!padrao || !troca) {
    return modelo;
  }
  return modelo.replace(padrao, (achado) => comMesmaCaixa(achado, troca));
}

export type DecisaoDoToque =
  | { acao: "enviar"; modelo: string | null }
  | { acao: "pular" };

/**
 * A decisao completa para um toque de confirmacao prestes a sair.
 *
 * `agora` e o instante do envio (ou, na decisao antecipada do reagendamento,
 * a proxima abertura da janela). `manual` e o "Cobrar agora": quem pediu foi
 * uma pessoa, entao o toque nunca e pulado por existir passo seguinte, mas o
 * dia relativo tambem e corrigido se ele atravessou a meia-noite na fila.
 */
export function decidirToqueDeConfirmacao(entrada: {
  agora: Date;
  scheduledFor: Date;
  startsAt: Date;
  offsetDoToque: number;
  modelo: string | null;
  passos: readonly { offsetMinutes: number }[];
  janela: JanelaDeEnvio;
  timezone: string;
  manual: boolean;
}): DecisaoDoToque {
  if (
    !mudouDeDia({
      agora: entrada.agora,
      scheduledFor: entrada.scheduledFor,
      timezone: entrada.timezone,
    })
  ) {
    return { acao: "enviar", modelo: entrada.modelo };
  }
  if (
    !entrada.manual &&
    existePassoPosteriorNoMesmoDia({
      passos: entrada.passos,
      offsetDoToque: entrada.offsetDoToque,
      startsAt: entrada.startsAt,
      agora: entrada.agora,
      janela: entrada.janela,
      timezone: entrada.timezone,
    })
  ) {
    return { acao: "pular" };
  }
  if (!entrada.modelo) {
    return { acao: "enviar", modelo: entrada.modelo };
  }
  const diasAteAConsulta = diasEntre(
    diaCivil(entrada.timezone, entrada.agora),
    diaCivil(entrada.timezone, entrada.startsAt),
  );
  return {
    acao: "enviar",
    modelo: corrigirDiaRelativo(entrada.modelo, {
      diaDoPasso: diaDoPasso(entrada.offsetDoToque),
      diasAteAConsulta,
    }),
  };
}
