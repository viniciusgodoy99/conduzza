import {
  WHATSAPP_CONNECTION_STATUS,
  type StatusDefinition,
  type WhatsAppConnectionStatus,
} from "@/lib/design/status";
import { chaveDoCelularPareado } from "@/lib/domain/celular-duplicado";
import { formatarTelefone } from "@/lib/domain/telefone";
import {
  ehTipoDeEnvio,
  TIPOS_DE_ENVIO,
  type TipoDeEnvio,
} from "@/lib/domain/tipo-de-envio";
import type { NumeroDaClinica } from "@/lib/queries/conversations";

// O que a tela de Automacoes precisa saber dos numeros de WhatsApp da clinica
// (varios numeros por clinica, docs/07, Fase 4): a lista dos ATIVOS e a
// escolha de numero de cada TIPO de mensagem automatica
// (whatsapp_envio_automatico, uma linha por tipo desde 29/09/2026).
// PURO, zero I/O: a pagina le pela sessao e estes calculos decidem o que o
// cartao e o dialogo de teste mostram.

/**
 * Por tipo: o id do numero fixo (sempre um numero ATIVO) ou null, que e o
 * "ultimo numero usado pelo paciente".
 */
export type PoliticaDeEnvio = Record<TipoDeEnvio, string | null>;

export type NumerosDasAutomaticas = {
  /** Os numeros ATIVOS, o principal primeiro (fetchNumerosDaClinica). */
  numeros: NumeroDaClinica[];
  politica: PoliticaDeEnvio;
};

/** Todos os tipos no ultimo usado: o que vale sem nenhuma linha gravada. */
export function politicaNoUltimoUsado(): PoliticaDeEnvio {
  return Object.fromEntries(
    TIPOS_DE_ENVIO.map((tipo) => [tipo, null]),
  ) as PoliticaDeEnvio;
}

/**
 * As linhas cruas de whatsapp_envio_automatico, ja lidas. Tipo sem linha
 * vale o ultimo usado (comentario da tabela). Fixo apontando para numero que
 * nao esta entre os ATIVOS tambem vira ultimo usado: e o que o banco faz
 * (resolver_conta_de_envio ignora numero removido, e remover_numero devolve
 * a escolha ao ultimo usado), e a tela nunca finge um numero que o envio nao
 * usa. Linha de tipo desconhecido e ignorada.
 */
export function lerPoliticaDeEnvio(
  linhas: unknown,
  numeros: readonly { id: string }[],
): PoliticaDeEnvio {
  const politica = politicaNoUltimoUsado();
  if (!Array.isArray(linhas)) {
    return politica;
  }
  const ativos = new Set(numeros.map((numero) => numero.id));
  for (const linha of linhas) {
    if (!linha || typeof linha !== "object") {
      continue;
    }
    const campos = linha as Record<string, unknown>;
    if (!ehTipoDeEnvio(campos.tipo) || campos.modo !== "fixo") {
      continue;
    }
    const conta =
      typeof campos.conta_fixa_id === "string" ? campos.conta_fixa_id : null;
    if (conta !== null && ativos.has(conta)) {
      politica[campos.tipo] = conta;
    }
  }
  return politica;
}

/**
 * Os numeros que ALGUM tipo usa como fixo, sem repeticao (a etiqueta
 * "Mensagens automáticas" do cartao do numero, em Configuracoes).
 */
export function numerosFixosDaPolitica(politica: PoliticaDeEnvio): string[] {
  return [
    ...new Set(
      TIPOS_DE_ENVIO.map((tipo) => politica[tipo]).filter(
        (conta): conta is string => conta !== null,
      ),
    ),
  ];
}

/**
 * Os tipos cuja escolha mudou entre a gravada e o rascunho, na ordem da
 * tela. So eles vao para a action: salvar nao regrava o que ninguem mexeu
 * (e nao desfaz a troca que outra pessoa fez em outro tipo).
 */
export function tiposQueMudaram(
  salva: PoliticaDeEnvio,
  rascunho: PoliticaDeEnvio,
): TipoDeEnvio[] {
  return TIPOS_DE_ENVIO.filter((tipo) => salva[tipo] !== rascunho[tipo]);
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
 * testarEnvioAction (o fixo do tipo da regua, senao o principal), desde que
 * esteja conectado; senao o primeiro conectado. Nulo quando nenhum esta.
 */
export function numeroPadraoDoTeste(
  dados: NumerosDasAutomaticas,
  tipo: TipoDeEnvio | null,
): string | null {
  const conectados = dados.numeros.filter(
    (numero) => numero.connection_status === "conectado",
  );
  const fixo = tipo === null ? null : dados.politica[tipo];
  const preferido =
    fixo ?? dados.numeros.find((numero) => numero.principal)?.id ?? null;
  return (
    conectados.find((numero) => numero.id === preferido)?.id ??
    conectados[0]?.id ??
    null
  );
}
