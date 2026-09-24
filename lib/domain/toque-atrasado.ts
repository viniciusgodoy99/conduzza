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
//   - outro dia, e existe passo POSTERIOR da mesma regua que ainda sai antes
//     da consulta: este toque e pulado ('toque_atrasado'), o seguinte cobre;
//   - outro dia, sem passo posterior que saia a tempo: o toque sai (melhor
//     avisar que nao avisar), com o dia relativo do texto corrigido.

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
 * antes do evento) que sai antes dela? E ele que avisa o paciente, com o texto
 * certo para o dia.
 */
export function existePassoPosteriorATempo(entrada: {
  passos: readonly { offsetMinutes: number }[];
  offsetDoToque: number;
  startsAt: Date;
  agora: Date;
  janela: JanelaDeEnvio;
  timezone: string;
}): boolean {
  const inicioDaConsulta = entrada.startsAt.getTime();
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
    return saida !== null && saida.getTime() < inicioDaConsulta;
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
    existePassoPosteriorATempo({
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
