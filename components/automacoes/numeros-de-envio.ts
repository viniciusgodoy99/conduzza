import {
  WHATSAPP_CONNECTION_STATUS,
  type StatusDefinition,
  type WhatsAppConnectionStatus,
} from "@/lib/design/status";
import { chaveDoCelularPareado } from "@/lib/domain/celular-duplicado";
import { formatarTelefone } from "@/lib/domain/telefone";
import type { NumeroDaClinica } from "@/lib/queries/conversations";

// O que a tela de Automacoes precisa saber dos numeros de WhatsApp da clinica
// (varios numeros por clinica, docs/07, Fase 4): a lista dos ATIVOS e a
// politica de envio das mensagens automaticas (whatsapp_envio_automatico).
// PURO, zero I/O: a pagina le pela sessao e estes calculos decidem o que o
// cartao e o dialogo de teste mostram.

export type ModoDeEnvio = "ultimo_usado" | "fixo";

export type PoliticaDeEnvio = {
  modo: ModoDeEnvio;
  /** So no modo fixo. Nulo quando o numero guardado nao esta mais ativo. */
  contaFixaId: string | null;
};

export type NumerosDasAutomaticas = {
  /** Os numeros ATIVOS, o principal primeiro (fetchNumerosDaClinica). */
  numeros: NumeroDaClinica[];
  politica: PoliticaDeEnvio;
};

/**
 * A linha crua de whatsapp_envio_automatico, ja lida. Sem linha, vale o
 * ultimo usado (comentario da tabela). Modo fixo apontando para numero que
 * nao esta na lista dos ativos fica fixo SEM numero: a tela pede a escolha,
 * e nunca finge um numero que o envio nao usa.
 */
export function lerPoliticaDeEnvio(
  linha: { modo?: unknown; conta_fixa_id?: unknown } | null | undefined,
  numeros: readonly { id: string }[],
): PoliticaDeEnvio {
  if (linha?.modo !== "fixo") {
    return { modo: "ultimo_usado", contaFixaId: null };
  }
  const conta =
    typeof linha.conta_fixa_id === "string" ? linha.conta_fixa_id : null;
  return {
    modo: "fixo",
    contaFixaId:
      conta !== null && numeros.some((numero) => numero.id === conta)
        ? conta
        : null,
  };
}

/** A escolha so aparece com MAIS DE UM numero ativo (docs/07, telas). */
export function temEscolhaDeNumero(
  dados: NumerosDasAutomaticas | null | undefined,
): dados is NumerosDasAutomaticas {
  return (dados?.numeros.length ?? 0) > 1;
}

/**
 * A situacao do numero em 3 camadas (WHATSAPP_CONNECTION_STATUS). Valor que
 * o mapa nao conhece vira "Desconectado": o envio so sai por numero
 * conectado, entao prometer outra coisa seria mentir.
 */
export function situacaoDoNumero(status: string): StatusDefinition {
  return Object.prototype.hasOwnProperty.call(
    WHATSAPP_CONNECTION_STATUS,
    status,
  )
    ? WHATSAPP_CONNECTION_STATUS[status as WhatsAppConnectionStatus]
    : WHATSAPP_CONNECTION_STATUS.desconectado;
}

/**
 * O telefone pareado, para exibir. Nulo quando o valor guardado nao e
 * telefone (instancias antigas guardavam o NOME do perfil em display_phone)
 * ou quando o numero nunca conectou.
 */
export function telefoneDoNumero(displayPhone: string | null): string | null {
  const chave = chaveDoCelularPareado(displayPhone);
  return chave === null ? null : formatarTelefone(chave);
}

/**
 * O numero que o dialogo de teste ja deixa marcado: o mesmo padrao de
 * testarEnvioAction (o fixo das automaticas, senao o principal), desde que
 * esteja conectado; senao o primeiro conectado. Nulo quando nenhum esta.
 */
export function numeroPadraoDoTeste(
  dados: NumerosDasAutomaticas,
): string | null {
  const conectados = dados.numeros.filter(
    (numero) => numero.connection_status === "conectado",
  );
  const preferido =
    dados.politica.modo === "fixo" && dados.politica.contaFixaId
      ? dados.politica.contaFixaId
      : (dados.numeros.find((numero) => numero.principal)?.id ?? null);
  return (
    conectados.find((numero) => numero.id === preferido)?.id ??
    conectados[0]?.id ??
    null
  );
}
