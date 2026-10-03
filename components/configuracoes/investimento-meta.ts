import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import type { LeituraMetaStatus } from "@/lib/design/status";
import {
  eProblemaDeLeitura,
  PROBLEMAS_QUE_PAUSAM,
  type ProblemaDeLeitura,
} from "@/lib/domain/meta-anuncios";

// Regras do cartao "Investimento nos anuncios" (Configuracoes, aba Anuncios
// da Meta; Fase 4). Modulo PURO, sem "use client" nem "use server": o
// cartao, as Server Actions e os testes usam as mesmas regras e os mesmos
// textos (um arquivo "use server" so pode exportar funcao assincrona, entao
// constantes e textos moram aqui). Mesmo molde de components/whatsapp/
// numeros.ts.
//
// A situacao gravada (meta_gasto_leitura, migration 20261003100000) e
// escrita so pelo sistema: as actions pelo cliente de servico, depois da
// guarda de papel, e o job. A tela so le (policy de admin e gestor).

/** Intervalo minimo entre dois "Atualizar agora" (o mesmo da funcao do banco). */
export const INTERVALO_DO_PEDIDO_MANUAL_MS = 10 * 60_000;

/**
 * Teto do "Atualizando": um pedido mais velho que isto, sem tentativa
 * registrada depois dele, deixa de girar. O job repete a falha passageira
 * com backoff e so grava a tentativa na ultima vez; um caminho que termine
 * sem gravar (raro) nao pode deixar o chip girando para sempre.
 */
export const ATUALIZANDO_NO_MAXIMO_MS = 60 * 60_000;

/**
 * O mesmo formato que a integracao aceita (lib/integrations/meta/
 * insights.ts): so caracteres visiveis de ASCII, de 20 a 500. Salvar o que o
 * job vai recusar so adiaria o erro.
 */
export const TOKEN_DE_LEITURA_VALIDO = /^[\x21-\x7e]{20,500}$/;

/** Textos fixos do cartao e das actions (o e2e procura por eles). */
export const TEXTOS_DA_LEITURA = {
  semConfiguracao:
    "Salve a conta de anúncios e o token de leitura antes de testar.",
  contaInvalida:
    "Confira a conta de anúncios: são só números, com ou sem act_ na frente.",
  tokenInvalido:
    "O token parece incompleto. Cole o valor inteiro, sem espaços.",
  tokenVazio: "Cole o token de leitura para salvar.",
  tokenSalvoSemConta:
    "O token foi salvo. Salve a conta de anúncios para testar a leitura.",
  tokenSalvoComFalha: "O token foi salvo, mas a leitura não funcionou.",
  tokenNaoSalvo: "Não foi possível salvar o token. Tente de novo.",
  tokenRemovido:
    "Token de leitura removido. O investimento já lido continua guardado.",
  tokenNaoRemovido: "Não foi possível remover o token. Tente de novo.",
  configuracaoIlegivel:
    "Não foi possível ler a configuração da leitura. Tente de novo.",
  mudouDuranteOTeste:
    "A conta de anúncios ou o token mudou durante o teste. Teste de novo.",
  resultadoNaoGuardado:
    "A Meta respondeu, mas não foi possível guardar o resultado do teste. Tente de novo.",
  testeFalhou: "Não foi possível testar a leitura agora. Tente de novo.",
  semResposta:
    "Não foi possível concluir agora. Confira a internet e tente de novo.",
  leituraPedida: "A leitura do investimento começou e termina em alguns minutos.",
  pausada:
    "A leitura está parada porque a Meta recusou o token ou a conta. Corrija e use Testar leitura.",
  atualizacaoEmAndamento:
    "A atualização já foi pedida. O investimento novo aparece em alguns minutos.",
  atualizacaoPedida:
    "Atualização pedida. O investimento novo aparece em alguns minutos.",
  atualizacaoNaoPedida:
    "Não foi possível pedir a atualização. Tente de novo.",
  clinicaDeTeste:
    "Esta é uma clínica de teste: a leitura do investimento não roda nela.",
  semPermissao: "Só administrador e gestor mexem na leitura do investimento.",
  sessaoExpirada: "Sessão expirada. Entre de novo.",
  semLeitura: "Ainda sem leitura do investimento.",
} as const;

export type SituacaoDaLeitura = "nao_testada" | "funcionando" | "com_problema";

/** A situacao da leitura como a tela usa (camelCase, ja conferida). */
export type LeituraDoInvestimento = {
  situacao: SituacaoDaLeitura;
  problema: ProblemaDeLeitura | null;
  codigoDaMeta: number | null;
  nomeDaConta: string | null;
  moeda: string | null;
  fusoDaConta: string | null;
  contaAtiva: boolean | null;
  testadaEm: string | null;
  sincronizadoEm: string | null;
  tentadoEm: string | null;
  atualizacaoPedidaEm: string | null;
};

/** Colunas lidas pela pagina (nunca ultimo_diario_dia nem lido_*: a tela nao usa). */
export const COLUNAS_DA_LEITURA =
  "situacao, problema, codigo_da_meta, nome_da_conta, moeda, fuso_da_conta, conta_ativa, testada_em, sincronizado_em, tentado_em, atualizacao_pedida_em";

export type LinhaDaLeitura = {
  situacao: string;
  problema: string | null;
  codigo_da_meta: number | null;
  nome_da_conta: string | null;
  moeda: string | null;
  fuso_da_conta: string | null;
  conta_ativa: boolean | null;
  testada_em: string | null;
  sincronizado_em: string | null;
  tentado_em: string | null;
  atualizacao_pedida_em: string | null;
};

function situacaoConhecida(valor: string): SituacaoDaLeitura {
  return valor === "funcionando" || valor === "com_problema"
    ? valor
    : "nao_testada";
}

/** A linha do banco vira o tipo da tela; valor desconhecido nunca vira "funcionando". */
export function leituraDaLinha(
  linha: LinhaDaLeitura | null,
): LeituraDoInvestimento | null {
  if (!linha) {
    return null;
  }
  const situacao = situacaoConhecida(linha.situacao);
  const problema = eProblemaDeLeitura(linha.problema)
    ? linha.problema
    : situacao === "com_problema"
      ? "outro"
      : null;
  return {
    situacao,
    problema: situacao === "com_problema" ? problema : null,
    codigoDaMeta: linha.codigo_da_meta,
    nomeDaConta: linha.nome_da_conta,
    moeda: linha.moeda,
    fusoDaConta: linha.fuso_da_conta,
    contaAtiva: linha.conta_ativa,
    testadaEm: linha.testada_em,
    sincronizadoEm: linha.sincronizado_em,
    tentadoEm: linha.tentado_em,
    atualizacaoPedidaEm: linha.atualizacao_pedida_em,
  };
}

function instante(valor: string | null): number | null {
  if (!valor) {
    return null;
  }
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * "Atualizando": o pedido manual e mais novo que a ultima tentativa do job
 * (critica 4.4: atualizacao_pedida_em > coalesce(tentado_em, -infinito)),
 * com o teto de ATUALIZANDO_NO_MAXIMO_MS.
 */
export function estaAtualizando(
  leitura: Pick<LeituraDoInvestimento, "atualizacaoPedidaEm" | "tentadoEm">,
  agoraMs: number,
): boolean {
  const pedido = instante(leitura.atualizacaoPedidaEm);
  if (pedido === null || agoraMs - pedido > ATUALIZANDO_NO_MAXIMO_MS) {
    return false;
  }
  return pedido > (instante(leitura.tentadoEm) ?? Number.NEGATIVE_INFINITY);
}

/** A Meta recusou o token ou a conta: o diario e o "Atualizar agora" param. */
export function leituraPausada(
  leitura: Pick<LeituraDoInvestimento, "situacao" | "problema"> | null,
): boolean {
  return (
    leitura?.situacao === "com_problema" &&
    leitura.problema !== null &&
    PROBLEMAS_QUE_PAUSAM.has(leitura.problema)
  );
}

/** O chip do cartao, pela configuracao salva e pela situacao gravada. */
export function estadoDaLeituraMeta(entrada: {
  adAccountId: string | null;
  temTokenDeLeitura: boolean;
  leitura: LeituraDoInvestimento | null;
  agoraMs: number;
}): LeituraMetaStatus {
  if (!entrada.adAccountId || !entrada.temTokenDeLeitura) {
    return "nao_configurada";
  }
  const { leitura } = entrada;
  if (!leitura) {
    return "nao_testada";
  }
  if (estaAtualizando(leitura, entrada.agoraMs)) {
    return "atualizando";
  }
  if (leitura.situacao === "com_problema") {
    return "com_problema";
  }
  return leitura.situacao === "funcionando" ? "funcionando" : "nao_testada";
}

/**
 * O resultado local de uma acao do cartao (salvar, testar, atualizar,
 * remover) vale enquanto o job nao registra tentativa nova (tentado_em).
 * Uma tentativa mais nova que a da hora do resultado quer dizer que a
 * situacao gravada e a mais recente: o resultado local sai e o problema
 * gravado, se houver, volta a aparecer (ex.: "Atualizar agora" seguido de
 * uma falha que pausa, vista pelo recarregamento automatico, que nao
 * remonta o cartao). So instantes do servidor, nunca o relogio do
 * navegador. As actions do cartao nunca escrevem tentado_em.
 */
export function resultadoLocalVale(entrada: {
  /** A ultima tentativa do job na tela quando o resultado chegou. */
  tentadoEmBase: string | null;
  /** A ultima tentativa do job na tela agora. */
  tentadoEmAtual: string | null;
}): boolean {
  const atual = instante(entrada.tentadoEmAtual);
  if (atual === null) {
    return true;
  }
  const base = instante(entrada.tentadoEmBase);
  return base !== null && atual <= base;
}

/**
 * O problema gravado que o cartao mostra: so sem resultado local vigente
 * (o resultado vigente e mais novo e diz a mesma coisa ou melhor) e com o
 * chip em "Leitura com problema".
 */
export function problemaGravadoNaTela(entrada: {
  temResultadoVigente: boolean;
  estado: LeituraMetaStatus;
  leitura: Pick<LeituraDoInvestimento, "problema"> | null;
}): ProblemaDeLeitura | null {
  if (entrada.temResultadoVigente || entrada.estado !== "com_problema") {
    return null;
  }
  return entrada.leitura?.problema ?? null;
}

/**
 * Texto do pedido cedo demais, pelo liberado_em que a funcao do banco
 * devolve (pedido + 10 minutos): n = minutos desde o pedido, de 1 a 10.
 */
export function textoDoPedidoCedoDemais(
  liberadoEm: unknown,
  agoraMs: number,
): string {
  const liberado = typeof liberadoEm === "string" ? instante(liberadoEm) : null;
  if (liberado === null) {
    return "O investimento acabou de ser atualizado. Tente de novo daqui a pouco.";
  }
  const pedidoEm = liberado - INTERVALO_DO_PEDIDO_MANUAL_MS;
  const n = Math.min(
    10,
    Math.max(1, Math.floor((agoraMs - pedidoEm) / 60_000)),
  );
  return `O investimento foi atualizado há ${n} ${n === 1 ? "minuto" : "minutos"}. Tente de novo daqui a pouco.`;
}

/** "Atualizado em dd/MM às HH:mm", no fuso da clinica (CLAUDE.md 3.6). */
export function textoDoAtualizadoEm(
  sincronizadoEm: string | null,
  timezone: string,
): string | null {
  const ms = instante(sincronizadoEm);
  if (ms === null) {
    return null;
  }
  return `Atualizado em ${format(new TZDate(ms, timezone), "dd/MM 'às' HH:mm")}`;
}

/**
 * Os dois fusos tem horario diferente agora? Nome diferente com o mesmo
 * deslocamento (America/Sao_Paulo e America/Fortaleza) nao muda o dia, e o
 * aviso so aparece quando a diferenca existe. Fuso que nao se resolve conta
 * como diferente.
 */
export function fusosComHorarioDiferente(
  fusoA: string,
  fusoB: string,
  agoraMs: number,
): boolean {
  if (fusoA === fusoB) {
    return false;
  }
  const a = new TZDate(agoraMs, fusoA).getTimezoneOffset();
  const b = new TZDate(agoraMs, fusoB).getTimezoneOffset();
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return true;
  }
  return a !== b;
}

export type AvisoDaLeitura = "outra_moeda" | "outro_fuso" | "conta_inativa";

/** Os avisos de uma conta lida, na ordem em que a tela mostra. */
export function avisosDaConta(
  conta: { moeda: string | null; fuso: string | null; ativa: boolean | null },
  timezoneDaClinica: string,
  agoraMs: number,
): AvisoDaLeitura[] {
  const avisos: AvisoDaLeitura[] = [];
  if (conta.moeda && conta.moeda !== "BRL") {
    avisos.push("outra_moeda");
  }
  if (conta.ativa === false) {
    avisos.push("conta_inativa");
  }
  if (
    conta.fuso &&
    fusosComHorarioDiferente(conta.fuso, timezoneDaClinica, agoraMs)
  ) {
    avisos.push("outro_fuso");
  }
  return avisos;
}

/** O texto de cada aviso; nunca converte moeda (C17). */
export function textoDoAviso(
  aviso: AvisoDaLeitura,
  conta: { moeda: string | null; fuso: string | null },
): string {
  switch (aviso) {
    case "outra_moeda":
      return `A conta de anúncios está em ${conta.moeda ?? "outra moeda"}. O Conduzza não converte moeda: em Resultados, o custo por lead aparece como Conta em outra moeda.`;
    case "conta_inativa":
      return "A Meta informa que esta conta de anúncios não está ativa. Sem anúncio rodando, não há investimento novo para ler.";
    case "outro_fuso":
      return `Os dias do investimento seguem o fuso da conta de anúncios (${conta.fuso ?? "outro fuso"}), diferente do fuso da clínica.`;
  }
}

/** "Leitura funcionando: conta {nome} ({act_...}), em {moeda}." */
export function textoDoSucessoDoTeste(conta: {
  nome: string | null;
  adAccountId: string;
  moeda: string;
}): string {
  const quem = conta.nome
    ? `${conta.nome} (${conta.adAccountId})`
    : conta.adAccountId;
  return `Leitura funcionando: conta ${quem}, em ${conta.moeda}.`;
}

/** Complemento do sucesso: houve gasto nos ultimos 30 dias? */
export function textoDoGastoRecente(temGasto: boolean): string {
  return temGasto
    ? "Há investimento nos últimos 30 dias."
    : "Nenhum investimento nos últimos 30 dias.";
}
