import { z } from "zod";

import {
  BUSCA_MAXIMA,
  dataEHoraNaClinica,
  dataNaClinica,
  dolaresParaCampo,
  dolaresPrecisosParaPlanilha,
  descreverTendencia,
  FILTROS_PADRAO,
  ORDEM_PADRAO,
  passosDaImplantacao,
  PRIMEIRO_SENTIDO,
  quemEntrouNaLista,
  ROTULO_DA_LIBERACAO,
  rotuloDoSinal,
  SAUDE_STATUS,
  SITUACAO_DA_CONTA_STATUS,
  situacaoDaConta,
  TEXTOS_DO_PAINEL,
  textoDaImplantacao,
  type ColunaDaOrdem,
  type FiltrosDoPainel,
  type OrdemDaLista,
} from "@/components/painel-geral/painel-geral";
import { diaCivil } from "@/lib/domain/horarios";
import {
  FUSO_PADRAO_DO_PAINEL,
  type ClinicaNoPainel,
  type TendenciaNoPainel,
} from "@/lib/queries/painel-geral";

// Exportar a lista do Painel geral (segunda leva, 26/10/2026; escolha (7)
// do dono). Regras PURAS: o corpo do pedido (os filtros e a ordem da tela),
// as colunas e as linhas do arquivo, o nome do arquivo e o que vai para a
// trilha. Quem le o banco e grava a trilha e app/(app)/painel-geral/
// exportar (o molde e a exportacao dos leads, docs/04 secao 20).
//
// - O arquivo sai com as clinicas que batem com os filtros da tela, na
//   ordem da tela, com as colunas da lista (e os numeros que a lista mostra
//   resumidos, como os 30 dias anteriores). De paciente, so contagens; das
//   pessoas, so quem usou por ultimo (dado da equipe da clinica, como a
//   lista mostra).
// - A trilha leva a quantidade, os filtros de lista e a ordem; da busca, so
//   que havia uma (o texto pode ser nome ou e-mail da equipe de uma
//   clinica).
// - Campo vazio fica vazio (o arquivo e dado para planilha). Datas no fuso
//   de cada clinica, como a lista; o nome do arquivo no fuso padrao do
//   painel.

export const ROTA_DA_EXPORTACAO_DO_PAINEL = "/painel-geral/exportar";

export const MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU =
  "Não foi possível exportar o painel. Tente de novo.";
export const MENSAGEM_EXPORTACAO_DO_PAINEL_TRILHA_FALHOU =
  "Não foi possível registrar a exportação, e nada foi exportado. Tente de novo.";
export const MENSAGEM_EXPORTACAO_DO_PAINEL_VAZIA =
  "Nenhuma clínica para exportar com esses filtros.";
export const MENSAGEM_EXPORTACAO_DO_PAINEL_FILTROS_INVALIDOS =
  TEXTOS_DO_PAINEL.dadosInvalidos;

const COLUNAS_DA_ORDEM = [
  "ultimo_acesso",
  "saude",
  "ia",
  "leads",
  "conversas",
  "implantacao",
] as const satisfies readonly ColunaDaOrdem[];

/**
 * O corpo do pedido: os filtros e a ordem da tela, so os que fogem do
 * padrao (sem filtro, {}). Estrito: chave a mais e recusada.
 */
export const exportacaoDoPainelSchema = z
  .object({
    busca: z.string().max(BUSCA_MAXIMA).optional(),
    uso: z.enum(["todas", "em_uso", "sem_uso"]).optional(),
    conta: z.enum(["todas", "ativa", "suspensa"]).optional(),
    agente: z.enum(["todos", "liberado", "nao_liberado"]).optional(),
    saude: z.enum(["todas", "saudavel", "atencao", "em_risco"]).optional(),
    ordem: z.enum(COLUNAS_DA_ORDEM).optional(),
    sentido: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

export type PedidoDeExportacaoDoPainel = z.infer<
  typeof exportacaoDoPainelSchema
>;

/** O corpo que a tela manda (so o que foge do padrao). */
export function corpoDoPedidoDoPainel(
  filtros: FiltrosDoPainel,
  ordem: OrdemDaLista,
): PedidoDeExportacaoDoPainel {
  const busca = filtros.busca.trim();
  return {
    ...(busca ? { busca } : {}),
    ...(filtros.uso !== FILTROS_PADRAO.uso ? { uso: filtros.uso } : {}),
    ...(filtros.conta !== FILTROS_PADRAO.conta ? { conta: filtros.conta } : {}),
    ...(filtros.agente !== FILTROS_PADRAO.agente
      ? { agente: filtros.agente }
      : {}),
    ...(filtros.saude !== FILTROS_PADRAO.saude ? { saude: filtros.saude } : {}),
    ...(ordem.coluna !== ORDEM_PADRAO.coluna ||
    ordem.sentido !== ORDEM_PADRAO.sentido
      ? { ordem: ordem.coluna, sentido: ordem.sentido }
      : {}),
  };
}

/** Os filtros e a ordem de um pedido ja validado. */
export function filtrosEOrdemDoPedido(pedido: PedidoDeExportacaoDoPainel): {
  filtros: FiltrosDoPainel;
  ordem: OrdemDaLista;
} {
  return {
    filtros: {
      busca: pedido.busca ?? FILTROS_PADRAO.busca,
      uso: pedido.uso ?? FILTROS_PADRAO.uso,
      conta: pedido.conta ?? FILTROS_PADRAO.conta,
      agente: pedido.agente ?? FILTROS_PADRAO.agente,
      saude: pedido.saude ?? FILTROS_PADRAO.saude,
    },
    ordem: pedido.ordem
      ? {
          coluna: pedido.ordem,
          sentido: pedido.sentido ?? PRIMEIRO_SENTIDO[pedido.ordem],
        }
      : ORDEM_PADRAO,
  };
}

/** As colunas do arquivo, na ordem. */
export const COLUNAS_DA_EXPORTACAO_DO_PAINEL = [
  "Clínica",
  "Criada em",
  "Saúde",
  "Sinais de alerta",
  "Último acesso",
  "Último acesso por",
  "Equipe ativa",
  "Pedidos de entrada",
  "Números de WhatsApp",
  "Números conectados",
  "Falhas de envio em 7 dias",
  "Agente de IA",
  "IA no mês (US$)",
  "Chamadas da IA no mês",
  "Teto de IA por dia (US$)",
  "Leads em 30 dias",
  "Leads nos 30 dias anteriores",
  "Tendência dos leads",
  "Conversas em 30 dias",
  "Conversas nos 30 dias anteriores",
  "Tendência das conversas",
  "Implantação",
  "Passos que faltam",
  "Conta",
  "Suspensa desde",
  "Última nota em",
] as const;

/**
 * A tendencia como a tela mostra: "+25%", "-10%", "Estável (+5%)" ou "Sem
 * base" (a direcao e a do banco).
 */
function tendenciaParaPlanilha(tendencia: TendenciaNoPainel): string {
  const descrita = descreverTendencia(tendencia);
  if (descrita.direcao !== "estavel") {
    return descrita.visivel;
  }
  const variacao = tendencia.variacaoPercentual ?? 0;
  const comSinal =
    variacao > 0 ? `+${variacao}%` : variacao < 0 ? `-${-variacao}%` : "0%";
  return `${descrita.visivel} (${comSinal})`;
}

/** As falhas de envio dos 7 dias: a quantidade do sinal, ou zero. */
function falhasDeEnvio(clinica: ClinicaNoPainel): number {
  return (
    clinica.sinais.find((sinal) => sinal.chave === "falhas_de_envio")
      ?.quantidade ?? 0
  );
}

/** Uma linha do arquivo, na ordem das colunas. */
export function linhaDaClinicaNaExportacao(clinica: ClinicaNoPainel): string[] {
  const passos = passosDaImplantacao(clinica);
  const acesso = clinica.ultimoAcesso;
  return [
    clinica.nome,
    dataNaClinica(clinica.criadaEm, clinica.fuso),
    SAUDE_STATUS[clinica.saude].label,
    clinica.sinais.map(rotuloDoSinal).join(", "),
    acesso ? dataEHoraNaClinica(acesso.em, clinica.fuso) : "",
    acesso ? quemEntrouNaLista(acesso) : "",
    String(clinica.membrosAtivos),
    String(clinica.membrosPendentes),
    String(clinica.numerosTotal),
    String(clinica.numerosConectados),
    String(falhasDeEnvio(clinica)),
    ROTULO_DA_LIBERACAO[clinica.agente.estado],
    dolaresPrecisosParaPlanilha(clinica.gasto.mesMicrodolares),
    String(clinica.gasto.mesChamadas),
    clinica.tetoDiarioCentavos === null
      ? ""
      : dolaresParaCampo(clinica.tetoDiarioCentavos),
    String(clinica.leads30Dias),
    String(clinica.tendencia.leads.anterior),
    tendenciaParaPlanilha(clinica.tendencia.leads),
    String(clinica.conversas30Dias),
    String(clinica.tendencia.conversas.anterior),
    tendenciaParaPlanilha(clinica.tendencia.conversas),
    textoDaImplantacao(clinica.implantacao.feitos, clinica.implantacao.total),
    passos
      .filter((passo) => !passo.feito)
      .map((passo) => passo.rotulo)
      .join(", "),
    SITUACAO_DA_CONTA_STATUS[situacaoDaConta(clinica)].label,
    clinica.suspensao
      ? dataNaClinica(clinica.suspensao.suspensaEm, clinica.fuso)
      : "",
    clinica.ultimaNotaEm
      ? dataNaClinica(clinica.ultimaNotaEm, clinica.fuso)
      : "",
  ];
}

/** O cabecalho e uma linha por clinica, na ordem recebida (a da tela). */
export function linhasDaExportacaoDoPainel(
  clinicas: readonly ClinicaNoPainel[],
): string[][] {
  return [
    [...COLUNAS_DA_EXPORTACAO_DO_PAINEL],
    ...clinicas.map(linhaDaClinicaNaExportacao),
  ];
}

/** "painel-geral-2026-10-26.csv", no dia do fuso padrao do painel. */
export function nomeDoArquivoDoPainel(agora: Date): string {
  return `painel-geral-${diaCivil(FUSO_PADRAO_DO_PAINEL, agora)}.csv`;
}

/** O que vai para audit_log.detalhes (nunca o texto da busca). */
export type DetalhesDaTrilhaDoPainel = {
  quantidade: number;
  filtros: {
    uso?: string;
    conta?: string;
    agente?: string;
    saude?: string;
    com_busca?: true;
  };
  ordem: { coluna: ColunaDaOrdem; sentido: "asc" | "desc" };
};

export function detalhesDaTrilhaDoPainel(
  quantidade: number,
  filtros: FiltrosDoPainel,
  ordem: OrdemDaLista,
): DetalhesDaTrilhaDoPainel {
  return {
    quantidade,
    filtros: {
      ...(filtros.uso !== FILTROS_PADRAO.uso ? { uso: filtros.uso } : {}),
      ...(filtros.conta !== FILTROS_PADRAO.conta
        ? { conta: filtros.conta }
        : {}),
      ...(filtros.agente !== FILTROS_PADRAO.agente
        ? { agente: filtros.agente }
        : {}),
      ...(filtros.saude !== FILTROS_PADRAO.saude
        ? { saude: filtros.saude }
        : {}),
      ...(filtros.busca.trim() !== "" ? { com_busca: true as const } : {}),
    },
    ordem: { coluna: ordem.coluna, sentido: ordem.sentido },
  };
}
