import { rotuloDoCanal } from "@/components/leads/rotulos";
import { APPOINTMENT_STATUS } from "@/lib/design/status";
import {
  DIVISOR_DO_CUSTO_POR_LEAD,
  TEXTOS_DO_DIVISOR,
  avisoDeFusoDaConta,
  coberturaDoInvestimento,
  custoPorLeadCents,
  diaPorExtenso,
  estadoDoCustoPorLead,
  leadsDoDivisor,
  formatarAtualizadoEm,
  textoDoCustoPorLead,
  type DivisorDoCustoPorLead,
} from "@/lib/domain/custo-por-lead";
import { formatarDuracao } from "@/lib/domain/duracao";
import {
  formatarPercentual,
  formatarReaisCompleto,
  percentualDe,
} from "@/lib/domain/formato-compacto";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import type {
  AbaDeResultados,
  AgendaDoPeriodo,
  AtendimentoDoPeriodo,
  CampanhasDoPeriodo,
  FaturamentoDoPeriodo,
  FunilDoPeriodo,
  LinhaDeBase,
  LinhaDeCampanhaDoPeriodo,
  ObjetivoDeConversao,
  Periodizado,
  PontoDaSerie,
} from "@/lib/queries/relatorios";

// Regras PURAS da Tela 11 (Resultados), sem React e sem I/O: as linhas das
// tabelas de detalhe, o rodape do objetivo de conversao e a exportacao (CSV e
// impressao) da aba ativa. Mora aqui para ter teste de unidade: a tela e o
// arquivo exportado usam a MESMA conta, entao o CSV nunca diz outra coisa.
//
// Regra de valores (Fase 3): reais so para admin e gestor. O banco ja devolve
// null para os outros papeis; aqui, com podeVerValores falso, nenhuma linha
// com "R$" entra na exportacao, nem mesmo "Sem acesso" no lugar do valor.
//
// Fase 4 (investimento da Meta): a tabela Campanhas, o detalhe por campanha
// e o Custo por lead saem de campanhas_do_periodo (lead casado com a campanha
// so por id, nunca por nome). As colunas Investimento e Custo por lead so
// existem para a gestao; para os outros papeis a tabela tem a nota
// NOTA_DOS_VALORES_DAS_CAMPANHAS no lugar delas.

// ---------------------------------------------------------------------------
// Faturamento: o mesmo estado no cartao e no CSV
// ---------------------------------------------------------------------------

export const TEXTO_SEM_COMPARECIMENTO = "Nenhum comparecimento";
export const TEXTO_SEM_PRECO_PARA_SOMAR = "Sem preço para somar";

/**
 * Sem comparecimento, ou so com comparecimentos de convenio sem valor ou sem
 * preco cadastrado, "R$ 0,00" seria um numero falso: o cartao escreve o
 * estado e o CSV escreve o MESMO texto (revisao da Fase 3).
 */
export function estadoDoFaturamento(
  atual: Pick<FaturamentoDoPeriodo, "comparecimentos" | "comValor">,
): "sem-comparecimento" | "sem-preco" | "com-valor" {
  if (atual.comparecimentos === 0) {
    return "sem-comparecimento";
  }
  if (atual.comValor === 0) {
    return "sem-preco";
  }
  return "com-valor";
}

// ---------------------------------------------------------------------------
// Percentuais
// ---------------------------------------------------------------------------

/** "64,2%" com 1 casa; sem denominador, "sem dados" (nunca "0%"). */
export function percentualOuSemDados(parte: number, total: number): string {
  const percentual = percentualDe(parte, total);
  return percentual === null ? "sem dados" : `${formatarPercentual(percentual)}%`;
}

/** Percentual do objetivo como a clinica digitou: 60 -> "60", 35.5 -> "35,5". */
export function formatarPercentualDoObjetivo(percentual: number): string {
  return percentual.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

const PERCENTUAL_DO_OBJETIVO_RE = /^\d{1,3}(?:[.,]\d)?$/;

/**
 * O que a pessoa digitou no dialogo do objetivo: "35,5" -> 35.5. Mesma faixa
 * do Zod da Server Action e do check do banco (0,1 a 100, uma casa decimal);
 * fora disso, null.
 */
export function lerPercentualDoObjetivo(texto: string): number | null {
  const limpo = texto.trim();
  if (!PERCENTUAL_DO_OBJETIVO_RE.test(limpo)) {
    return null;
  }
  const valor = Number(limpo.replace(",", "."));
  if (!Number.isFinite(valor) || valor < 0.1 || valor > 100) {
    return null;
  }
  return valor;
}

/**
 * Rodape do cartao Taxa de conversao. Sem objetivo definido, nada: o rodape
 * some (nao existe "Objetivo: nenhum").
 */
export function textoDoObjetivo(
  objetivo: ObjetivoDeConversao | undefined,
): string | undefined {
  if (!objetivo) {
    return undefined;
  }
  return `Objetivo: ${formatarPercentualDoObjetivo(objetivo.percentual)}%`;
}

/**
 * Taxa de conversao da COORTE: dos leads que chegaram no periodo, quantos ja
 * agendaram. null sem lead (sem denominador nao ha taxa).
 */
export function taxaDeConversao(
  coorte: FunilDoPeriodo["coorte"],
): number | null {
  return percentualDe(coorte.agendaram, coorte.leads);
}

// ---------------------------------------------------------------------------
// Linhas de detalhe (tabelas da tela e da exportacao)
// ---------------------------------------------------------------------------

export type DimensaoDaOrigem = "canal" | "campanha";
export type DimensaoDaAgenda = "profissional" | "procedimento" | "status";

export type LinhaDeOrigem = {
  rotulo: string;
  leads: number;
  /** null = nao da para saber sem mentir (celula vazia, como no status) */
  agendaram: number | null;
  compareceram: number | null;
  /** compareceram / leads, "64,2%", "sem dados" ou "" quando null */
  comparecimento: string;
};

/** Rotulo de uma linha de campanha: o nome, senao "Campanha {id}". */
export function rotuloDaLinhaDeCampanha(linha: LinhaDeCampanhaDoPeriodo): string {
  return (
    linha.rotulo ??
    (linha.metaCampaignId ? `Campanha ${linha.metaCampaignId}` : "Sem campanha")
  );
}

/**
 * Detalhe da origem (Marketing). Por canal: o funil. Por campanha: as MESMAS
 * linhas da tabela Campanhas (uma verdade so na aba), mais "Sem campanha"
 * com os leads de leads_sem_campanha. Agendaram e compareceram de "Sem
 * campanha" saem da coorte do funil menos as linhas; so quando os dois
 * retratos batem (mesmo total de leads e diferencas validas), senao a celula
 * fica vazia em vez de um numero errado. Por campanha sem as campanhas
 * carregadas: null (a tela mostra carregando; a exportacao pula a secao).
 */
export function montarDetalheDeOrigem(
  funil: FunilDoPeriodo,
  dimensao: DimensaoDaOrigem,
  campanhas: CampanhasDoPeriodo | undefined,
): LinhaDeOrigem[] | null {
  if (dimensao === "canal") {
    return funil.porCanal.map((linha) => ({
      rotulo: rotuloDoCanal(linha.canal) ?? "Sem atribuição",
      leads: linha.leads,
      agendaram: linha.agendaram,
      compareceram: linha.compareceram,
      comparecimento: percentualOuSemDados(linha.compareceram, linha.leads),
    }));
  }
  if (!campanhas) {
    return null;
  }
  const linhas: LinhaDeOrigem[] = campanhas.linhas
    .filter((linha) => linha.leads > 0)
    .map((linha) => ({
      rotulo: rotuloDaLinhaDeCampanha(linha),
      leads: linha.leads,
      agendaram: linha.agendaram,
      compareceram: linha.compareceram,
      comparecimento: percentualOuSemDados(linha.compareceram, linha.leads),
    }));
  if (campanhas.leadsSemCampanha > 0) {
    const somaAgendaram = linhas.reduce((soma, l) => soma + (l.agendaram ?? 0), 0);
    const somaCompareceram = linhas.reduce(
      (soma, l) => soma + (l.compareceram ?? 0),
      0,
    );
    const agendaram = funil.coorte.agendaram - somaAgendaram;
    const compareceram = funil.coorte.compareceram - somaCompareceram;
    const batem =
      funil.coorte.leads === campanhas.leads &&
      agendaram >= 0 &&
      compareceram >= 0 &&
      agendaram <= campanhas.leadsSemCampanha &&
      compareceram <= agendaram;
    linhas.push({
      rotulo: "Sem campanha",
      leads: campanhas.leadsSemCampanha,
      agendaram: batem ? agendaram : null,
      compareceram: batem ? compareceram : null,
      comparecimento: batem
        ? percentualOuSemDados(compareceram, campanhas.leadsSemCampanha)
        : "",
    });
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Tabela Campanhas (Fase 4)
// ---------------------------------------------------------------------------

export const CELULA_FORA_DA_META = "Fora da Meta";
export const CELULA_SEM_LEADS = "Sem leads";
export const CELULA_NAO_MEDIDO = "Não medido";
export const NOTA_DOS_VALORES_DAS_CAMPANHAS =
  "Investimento e custo por lead: só administrador e gestor.";

/** Celula de dinheiro: o valor, ou um estado escrito (nunca R$ 0,00 falso). */
export type CelulaDeCampanha = {
  texto: string;
  /** true = texto de estado ("Fora da Meta"), nao numero */
  estado: boolean;
};

export type LinhaDeCampanhaDaTela = {
  chave: string;
  rotulo: string;
  /** null = a coluna nao existe para este papel */
  investimento: CelulaDeCampanha | null;
  leads: number;
  custoPorLead: CelulaDeCampanha | null;
  agendaram: number;
  /** agendaram / leads, a mesma regra da Taxa de conversao */
  conversao: string;
};

/** As colunas Investimento e Custo por lead existem para este retrato? */
export function campanhasComValores(
  campanhas: CampanhasDoPeriodo,
  podeVerValores: boolean,
): boolean {
  return podeVerValores && campanhas.investimento !== null;
}

function celulaDeEstado(texto: string): CelulaDeCampanha {
  return { texto, estado: true };
}

function celulaEmReais(centavos: number): CelulaDeCampanha {
  return { texto: formatarReaisCompleto(centavos), estado: false };
}

/**
 * Linhas da tabela Campanhas, na ordem do banco (Meta antes de texto,
 * investimento, leads). Celulas de dinheiro, so para a gestao:
 * - linha de texto (campanha da clinica fora da Meta): "Fora da Meta";
 * - Meta com o periodo inteiro lido: o investimento da campanha e o custo
 *   por lead dela (investimento / leads casados), ou "Sem leads";
 * - Meta sem medida (sem leitura, antes da primeira, periodo antes do
 *   primeiro dia lido, leitura parada antes do fim, outra moeda): "Não
 *   medido", nunca R$ 0,00.
 * Para os outros papeis as duas celulas sao null e a linha com 0 lead (que
 * so existe para a gestao) nunca entra.
 */
export function montarCampanhas(
  campanhas: CampanhasDoPeriodo,
  podeVerValores: boolean,
): LinhaDeCampanhaDaTela[] {
  const comValores = campanhasComValores(campanhas, podeVerValores);
  const medido =
    comValores && coberturaDoInvestimento(campanhas.investimento) === "completa";
  return campanhas.linhas
    .filter((linha) => comValores || linha.leads > 0)
    .map((linha) => {
      let investimento: CelulaDeCampanha | null = null;
      let custoPorLead: CelulaDeCampanha | null = null;
      if (comValores) {
        if (linha.tipo === "texto") {
          investimento = celulaDeEstado(CELULA_FORA_DA_META);
          custoPorLead = celulaDeEstado(CELULA_FORA_DA_META);
        } else {
          investimento = medido
            ? celulaEmReais(linha.investimentoCents ?? 0)
            : celulaDeEstado(CELULA_NAO_MEDIDO);
          const custo = custoPorLeadCents(linha.investimentoCents ?? 0, linha.leads);
          custoPorLead =
            linha.leads === 0
              ? celulaDeEstado(CELULA_SEM_LEADS)
              : medido && custo !== null
                ? celulaEmReais(custo)
                : celulaDeEstado(CELULA_NAO_MEDIDO);
        }
      }
      return {
        chave: linha.chave,
        rotulo: rotuloDaLinhaDeCampanha(linha),
        investimento,
        leads: linha.leads,
        custoPorLead,
        agendaram: linha.agendaram,
        conversao: percentualOuSemDados(linha.agendaram, linha.leads),
      };
    });
}

/** Os dois estados vazios da tabela Campanhas. Sem travessao. */
export const TEXTOS_DO_VAZIO_DAS_CAMPANHAS = {
  semLead: {
    titulo: "Nenhum lead no período",
    descricao:
      "As campanhas aparecem quando os primeiros contatos chegarem no período escolhido.",
  },
  semCampanha: {
    titulo: "Nenhum lead com campanha no período",
    descricao:
      "Os leads deste período chegaram sem campanha reconhecida. A contagem está logo abaixo.",
  },
} as const;

/**
 * O estado vazio da tabela (so aparece sem nenhuma linha). Com leads no
 * periodo, todos chegaram sem campanha: "Nenhum lead no período" seria
 * falso, e a contagem esta no rodape ("Leads sem campanha: N de N").
 */
export function estadoVazioDasCampanhas(
  campanhas: Pick<CampanhasDoPeriodo, "leads">,
): { titulo: string; descricao: string } {
  return campanhas.leads > 0
    ? TEXTOS_DO_VAZIO_DAS_CAMPANHAS.semCampanha
    : TEXTOS_DO_VAZIO_DAS_CAMPANHAS.semLead;
}

function plural(n: number, singular: string, pluralizado: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : pluralizado}`;
}

/**
 * Linhas de conferencia embaixo da tabela, para o custo por lead nao mentir:
 * - "Investimento sem lead casado: R$ X em N campanhas" (so a gestao, com o
 *   periodo inteiro lido e alguma campanha nessa situacao);
 * - "Leads sem campanha: N de M" (todo papel, as contagens sao as mesmas);
 * - "Leads de anúncio sem campanha reconhecida: K" (todo papel, quando ha):
 *   entram no divisor do custo por lead, mas em nenhuma linha da Meta.
 */
export function rodapesDasCampanhas(
  campanhas: CampanhasDoPeriodo,
  podeVerValores: boolean,
): string[] {
  const linhas: string[] = [];
  const investimento = campanhas.investimento;
  if (
    campanhasComValores(campanhas, podeVerValores) &&
    investimento &&
    coberturaDoInvestimento(investimento) === "completa" &&
    investimento.campanhasSemLead > 0
  ) {
    linhas.push(
      `Investimento sem lead casado: ${formatarReaisCompleto(
        investimento.investimentoSemLeadCents,
      )} em ${plural(investimento.campanhasSemLead, "campanha", "campanhas")}`,
    );
  }
  if (campanhas.leads > 0) {
    linhas.push(
      `Leads sem campanha: ${campanhas.leadsSemCampanha.toLocaleString(
        "pt-BR",
      )} de ${campanhas.leads.toLocaleString("pt-BR")}`,
    );
  }
  if (campanhas.leadsDeAnuncioSemCampanha > 0) {
    linhas.push(
      `Leads de anúncio sem campanha reconhecida: ${campanhas.leadsDeAnuncioSemCampanha.toLocaleString(
        "pt-BR",
      )}`,
    );
  }
  return linhas;
}

export type LinhaDaAgenda = {
  rotulo: string;
  total: number;
  compareceu: number | null;
  faltou: number | null;
};

export function montarDetalheDaAgenda(
  agenda: AgendaDoPeriodo,
  dimensao: DimensaoDaAgenda,
): LinhaDaAgenda[] {
  if (dimensao === "profissional") {
    return agenda.porProfissional.map((linha) => ({
      rotulo: linha.nome,
      total: linha.total,
      compareceu: linha.compareceu,
      faltou: linha.faltou,
    }));
  }
  if (dimensao === "procedimento") {
    return agenda.porProcedimento.map((linha) => ({
      rotulo: linha.nome,
      total: linha.total,
      compareceu: linha.compareceu,
      faltou: linha.faltou,
    }));
  }
  // Por status: o proprio recorte E o status, entao as colunas de desfecho
  // ficam vazias em vez de repetir o numero (nao mentir por preenchimento).
  return (
    Object.entries(agenda.porStatus)
      .filter(([, total]) => total > 0)
      .map(([status, total]) => ({
        rotulo:
          APPOINTMENT_STATUS[status as keyof typeof APPOINTMENT_STATUS]
            ?.label ?? status,
        total,
        compareceu: null,
        faltou: null,
      }))
      // Maior volume primeiro, como as barras.
      .sort((a, b) => b.total - a.total)
  );
}

export type LinhaDoCanal = {
  chave: string;
  rotulo: string;
  leads: number;
  /** false = tom neutro ("Sem atribuição" e magnitude sem canal) */
  destaque: boolean;
};

/** Barras da Origem dos leads, maior volume primeiro. */
export function linhasDaOrigem(funil: FunilDoPeriodo): LinhaDoCanal[] {
  return [...funil.porCanal]
    .sort((a, b) => b.leads - a.leads)
    .map((linha) => ({
      chave: linha.canal ?? "sem_atribuicao",
      rotulo: rotuloDoCanal(linha.canal) ?? "Sem atribuição",
      leads: linha.leads,
      destaque: linha.canal !== null,
    }));
}

export type EtapaDoFunilComercial = {
  rotulo: string;
  valor: number;
  /** Taxa sobre a etapa anterior ("64,2%"); null na primeira etapa. */
  taxa: string | null;
};

/** Funil comercial de COORTE (spec 10.4): chegaram, agendaram, compareceram. */
export function etapasDoFunilComercial(
  coorte: FunilDoPeriodo["coorte"],
): EtapaDoFunilComercial[] {
  return [
    { rotulo: "Chegaram", valor: coorte.leads, taxa: null },
    {
      rotulo: "Agendaram",
      valor: coorte.agendaram,
      taxa: percentualOuSemDados(coorte.agendaram, coorte.leads),
    },
    {
      rotulo: "Compareceram",
      valor: coorte.compareceram,
      taxa: percentualOuSemDados(coorte.compareceram, coorte.agendaram),
    },
  ];
}

export type TaxaDaConfirmacao = {
  rotulo: string;
  parte: number;
  total: number;
  /** null sem denominador */
  percentual: number | null;
};

/**
 * As taxas do bloco Confirmacao de consulta, todas com o par bruto ao lado
 * (a barra nunca e a unica forma de ler o numero):
 * - confirmadas em algum momento / consultas com inicio no periodo;
 * - comparecimento e faltas / consultas com desfecho (compareceu ou faltou);
 * - remarcaram apos a falta / faltas.
 */
export function taxasDaConfirmacao(agenda: AgendaDoPeriodo): TaxaDaConfirmacao[] {
  const comDesfecho = agenda.porStatus.compareceu + agenda.porStatus.faltou;
  const taxa = (rotulo: string, parte: number, total: number) => ({
    rotulo,
    parte,
    total,
    percentual: percentualDe(parte, total),
  });
  return [
    taxa("Confirmadas em algum momento", agenda.confirmadasAlgumaVez, agenda.total),
    taxa("Comparecimento", agenda.porStatus.compareceu, comDesfecho),
    taxa("Faltas", agenda.porStatus.faltou, comDesfecho),
    taxa(
      "Remarcaram após a falta",
      agenda.remarcadasAposFalta.remarcadas,
      agenda.remarcadasAposFalta.faltas,
    ),
  ];
}

/** Quem enviou: rotulo humano do autor da mensagem. */
export const AUTOR_ROTULO: Record<string, string> = {
  paciente: "Pacientes",
  usuario: "Equipe",
  sistema: "Mensagens automáticas",
  ia: "Recepcionista de IA",
};

// Desempenho do agente de IA (A2). Ainda nao medido: o agente nao atende.
// Regras de calculo documentadas agora, para quando o agente existir (nada
// disso e calculado hoje; numero inventado nao entra na tela nem no CSV):
// - atendidas pela IA: conversas com ao menos uma mensagem author='ia' no
//   periodo;
// - resolvidas sem humano: dessas, as sem nenhuma saida de author='usuario'
//   que nao seja nota interna;
// - transferidas para a equipe: com ai_decision_log.escalation_reason nao
//   nulo;
// - escalonadas por insatisfacao: escalation_reason = 'insatisfacao' (a
//   coluna e texto livre, o vocabulario fecha junto com o agente);
// - primeira resposta da IA: mediana entre a 1a entrada e a 1a saida 'ia';
// - agendamentos feitos pela IA: appointment.created_by = 'ia';
// - satisfacao: regra decidida depois.
export const METRICAS_DO_AGENTE = [
  "Resolvidas sem humano",
  "Transferidas para a equipe",
  "Escalonadas por insatisfação",
  "Primeira resposta da IA",
  "Agendamentos feitos pela IA",
  "Satisfação",
] as const;

// ---------------------------------------------------------------------------
// Exportacao
// ---------------------------------------------------------------------------

export type SecaoExportavel = {
  titulo: string;
  /** Primeira linha = cabecalho. */
  linhas: string[][];
};

export type ExportavelDaAba = {
  titulo: string;
  secoes: SecaoExportavel[];
};

export type EntradaDaExportacao = {
  aba: AbaDeResultados;
  /** admin ou gestor: so com isso entra linha em reais */
  podeVerValores: boolean;
  /** canal oficial do WhatsApp (isOfficialChannel): so com ele ha custo */
  canalOficial: boolean;
  funil?: Periodizado<FunilDoPeriodo>;
  agenda?: Periodizado<AgendaDoPeriodo>;
  atendimento?: Periodizado<AtendimentoDoPeriodo>;
  serie?: PontoDaSerie[];
  /** null = o banco recusou (sem permissao); nunca vira zero */
  faturamento?: Periodizado<FaturamentoDoPeriodo> | null;
  linhaDeBase?: LinhaDeBase;
  objetivo?: ObjetivoDeConversao;
  conversoes?: ConversoesResumo;
  /** Fase 4: campanhas_do_periodo (investimento null fora da gestao) */
  campanhas?: Periodizado<CampanhasDoPeriodo>;
  /** Fuso da clinica: o "Atualizado em" do investimento sai nele */
  timezone?: string;
  dimensaoOrigem: DimensaoDaOrigem;
  dimensaoAgenda: DimensaoDaAgenda;
};

const TITULO_DA_ABA: Record<AbaDeResultados, string> = {
  geral: "Resultados: visão geral",
  marketing: "Resultados: marketing",
  comercial: "Resultados: comercial",
  ia: "Resultados: agente de IA",
};

function numero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

function diaCurto(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

function secaoDeOrigem(funil: FunilDoPeriodo): SecaoExportavel {
  const linhas = linhasDaOrigem(funil);
  const total = linhas.reduce((soma, linha) => soma + linha.leads, 0);
  return {
    titulo: "Origem dos leads",
    linhas: [
      ["Origem", "Leads", "Participação"],
      ...linhas.map((linha) => [
        linha.rotulo,
        numero(linha.leads),
        percentualOuSemDados(linha.leads, total),
      ]),
    ],
  };
}

function secaoDoFunil(funil: FunilDoPeriodo): SecaoExportavel {
  return {
    titulo: "Funil comercial (leads que chegaram no período)",
    linhas: [
      ["Etapa", "Leads", "Taxa sobre a etapa anterior"],
      ...etapasDoFunilComercial(funil.coorte).map((etapa) => [
        etapa.rotulo,
        numero(etapa.valor),
        etapa.taxa ?? "",
      ]),
    ],
  };
}

function celula(valor: CelulaDeCampanha | null): string {
  return valor?.texto ?? "";
}

/** A tabela Campanhas como na tela, com as linhas de conferencia no fim. */
function secaoDeCampanhas(
  campanhas: CampanhasDoPeriodo,
  podeVerValores: boolean,
): SecaoExportavel {
  const comValores = campanhasComValores(campanhas, podeVerValores);
  const linhas = montarCampanhas(campanhas, podeVerValores);
  const cabecalho = comValores
    ? ["Campanha", "Investimento", "Leads", "Custo por lead", "Agendados", "Conversão"]
    : ["Campanha", "Leads", "Agendados", "Conversão"];
  return {
    titulo: "Campanhas",
    linhas: [
      cabecalho,
      ...linhas.map((linha) =>
        comValores
          ? [
              linha.rotulo,
              celula(linha.investimento),
              numero(linha.leads),
              celula(linha.custoPorLead),
              numero(linha.agendaram),
              linha.conversao,
            ]
          : [
              linha.rotulo,
              numero(linha.leads),
              numero(linha.agendaram),
              linha.conversao,
            ],
      ),
      ...rodapesDasCampanhas(campanhas, podeVerValores).map((texto) => [texto]),
      ...(comValores ? [] : [[NOTA_DOS_VALORES_DAS_CAMPANHAS]]),
    ],
  };
}

/**
 * As linhas do investimento nos Indicadores, so para a gestao: o custo por
 * lead com o MESMO texto do cartao (textoDoCustoPorLead), o investimento do
 * periodo (cheio, ou o estado quando nao ha medida), o divisor, de quando a
 * quando o investimento foi lido, quando foi atualizado (no fuso da
 * clinica) e o aviso de fuso da conta, o mesmo do cartao.
 */
function linhasDoInvestimento(
  podeVerValores: boolean,
  campanhas: Periodizado<CampanhasDoPeriodo> | undefined,
  timezone: string | undefined,
  divisor: DivisorDoCustoPorLead = DIVISOR_DO_CUSTO_POR_LEAD,
): string[][] {
  const atual = campanhas?.atual;
  const investimento = atual?.investimento;
  if (!podeVerValores || !atual || !investimento) {
    return [];
  }
  const estadoDoCusto = estadoDoCustoPorLead(atual, divisor);
  const cobertura = coberturaDoInvestimento(investimento);
  const linhas: string[][] = [
    ["Custo por lead", textoDoCustoPorLead(estadoDoCusto)],
    [
      "Investimento no período",
      cobertura === "completa"
        ? formatarReaisCompleto(investimento.investimentoCents)
        : textoDoCustoPorLead(estadoDoCusto),
    ],
    [TEXTOS_DO_DIVISOR[divisor].rotulo, numero(leadsDoDivisor(atual, divisor))],
  ];
  if (investimento.lidoDesde) {
    linhas.push([
      "Investimento lido a partir de",
      diaPorExtenso(investimento.lidoDesde),
    ]);
  }
  if (investimento.lidoAte) {
    linhas.push(["Investimento lido até", diaPorExtenso(investimento.lidoAte)]);
  }
  const atualizado = timezone
    ? formatarAtualizadoEm(investimento.sincronizadoEm, timezone)
    : null;
  if (atualizado) {
    linhas.push(["Investimento atualizado em", atualizado]);
  }
  const avisoDeFuso = timezone ? avisoDeFusoDaConta(investimento, timezone) : null;
  if (avisoDeFuso) {
    linhas.push(["Fuso do investimento", avisoDeFuso]);
  }
  return linhas;
}

function linhasDoFaturamento(
  podeVerValores: boolean,
  faturamento: Periodizado<FaturamentoDoPeriodo> | null | undefined,
): string[][] {
  if (!podeVerValores || !faturamento) {
    return [];
  }
  const atual = faturamento.atual;
  const estado = estadoDoFaturamento(atual);
  const valor =
    estado === "sem-comparecimento"
      ? TEXTO_SEM_COMPARECIMENTO
      : estado === "sem-preco"
        ? TEXTO_SEM_PRECO_PARA_SOMAR
        : formatarReaisCompleto(atual.valorCents);
  return [
    ["Faturamento estimado", valor],
    [
      "Comparecimentos com valor",
      `${numero(atual.comValor)} de ${numero(atual.comparecimentos)}`,
    ],
    ["Comparecimentos de convênio sem valor", numero(atual.cobertas)],
    ["Comparecimentos sem preço cadastrado", numero(atual.semPreco)],
  ];
}

function linhasDaConfirmacao(
  agenda: AgendaDoPeriodo,
  linhaDeBase: LinhaDeBase | undefined,
  podeVerValores: boolean,
): string[][] {
  const linhas: string[][] = [
    ["Consultas com início no período", numero(agenda.total)],
    ...taxasDaConfirmacao(agenda).map((taxa) => [
      taxa.rotulo,
      `${numero(taxa.parte)} de ${numero(taxa.total)} (${
        taxa.percentual === null
          ? "sem dados"
          : `${formatarPercentual(taxa.percentual)}%`
      })`,
    ]),
    ["Recuperadas pela lista de espera", numero(agenda.recuperadas.total)],
  ];
  if (podeVerValores && agenda.recuperadas.receitaCents !== null) {
    linhas.push([
      "Receita associada às recuperadas",
      formatarReaisCompleto(agenda.recuperadas.receitaCents),
    ]);
    linhas.push([
      "Recuperadas sem preço cadastrado",
      numero(agenda.recuperadas.semPreco),
    ]);
  }
  if (linhaDeBase) {
    linhas.push([
      "Linha de base de faltas (informada pela clínica)",
      `${formatarPercentualDoObjetivo(linhaDeBase.ratePercent)}%`,
    ]);
  }
  return linhas;
}

function montarGeral(entrada: EntradaDaExportacao): SecaoExportavel[] {
  const secoes: SecaoExportavel[] = [];
  const funil = entrada.funil?.atual;
  if (funil) {
    const taxa = taxaDeConversao(funil.coorte);
    const indicadores: string[][] = [
      ["Indicador", "Valor"],
      ["Leads recebidos", numero(funil.leads)],
      ["Consultas agendadas", numero(funil.agendamentosCriados)],
      [
        "Taxa de conversão",
        taxa === null ? "sem dados" : `${formatarPercentual(taxa)}%`,
      ],
    ];
    if (entrada.objetivo) {
      indicadores.push([
        "Objetivo de conversão",
        `${formatarPercentualDoObjetivo(entrada.objetivo.percentual)}%`,
      ]);
    }
    indicadores.push(
      ...linhasDoInvestimento(
        entrada.podeVerValores,
        entrada.campanhas,
        entrada.timezone,
      ),
    );
    indicadores.push(
      ...linhasDoFaturamento(entrada.podeVerValores, entrada.faturamento),
    );
    secoes.push({ titulo: "Indicadores do período", linhas: indicadores });
  }
  if (entrada.serie) {
    secoes.push({
      titulo: "Leads x consultas agendadas",
      linhas: [
        ["Dia", "Leads recebidos", "Consultas agendadas"],
        ...entrada.serie.map((ponto) => [
          diaCurto(ponto.dia),
          numero(ponto.leads),
          numero(ponto.agendadas),
        ]),
      ],
    });
  }
  if (funil) {
    secoes.push(secaoDeOrigem(funil));
    secoes.push(secaoDoFunil(funil));
  }
  const agenda = entrada.agenda?.atual;
  if (agenda) {
    secoes.push({
      titulo: "Confirmação de consulta",
      linhas: [
        ["Indicador", "Valor"],
        ...linhasDaConfirmacao(
          agenda,
          entrada.linhaDeBase,
          entrada.podeVerValores,
        ),
      ],
    });
  }
  const atendimento = entrada.atendimento?.atual;
  if (atendimento) {
    secoes.push({
      titulo: "Agente de IA",
      linhas: [
        ["Indicador", "Valor"],
        ...METRICAS_DO_AGENTE.map((rotulo) => [rotulo, "Ainda não medido"]),
        [
          "Primeira resposta da equipe (mediana)",
          formatarDuracao(atendimento.primeiraResposta.medianaSegundos),
        ],
      ],
    });
  }
  if (entrada.campanhas) {
    secoes.push(
      secaoDeCampanhas(entrada.campanhas.atual, entrada.podeVerValores),
    );
  }
  return secoes;
}

function montarMarketing(entrada: EntradaDaExportacao): SecaoExportavel[] {
  const secoes: SecaoExportavel[] = [];
  const funil = entrada.funil?.atual;
  if (funil) {
    const semCanal =
      funil.porCanal.find((linha) => linha.canal === null)?.leads ?? 0;
    const indicadores: string[][] = [
      ["Indicador", "Valor"],
      ["Leads recebidos", numero(funil.leads)],
      [
        "Com origem identificada",
        percentualOuSemDados(funil.leads - semCanal, funil.leads),
      ],
      [
        "Lead para comparecimento",
        percentualOuSemDados(funil.coorte.compareceram, funil.coorte.leads),
      ],
    ];
    indicadores.push(
      ...linhasDoInvestimento(
        entrada.podeVerValores,
        entrada.campanhas,
        entrada.timezone,
      ),
    );
    secoes.push({ titulo: "Indicadores do período", linhas: indicadores });
    secoes.push(secaoDeOrigem(funil));
    const detalhe = montarDetalheDeOrigem(
      funil,
      entrada.dimensaoOrigem,
      entrada.campanhas?.atual,
    );
    if (detalhe) {
      secoes.push({
        titulo:
          entrada.dimensaoOrigem === "canal"
            ? "Detalhe por canal"
            : "Detalhe por campanha",
        linhas: [
          ["Origem", "Leads", "Agendaram", "Compareceram", "Comparecimento"],
          ...detalhe.map((linha) => [
            linha.rotulo,
            numero(linha.leads),
            linha.agendaram === null ? "" : numero(linha.agendaram),
            linha.compareceram === null ? "" : numero(linha.compareceram),
            linha.comparecimento,
          ]),
        ],
      });
    }
    if (entrada.campanhas) {
      secoes.push(
        secaoDeCampanhas(entrada.campanhas.atual, entrada.podeVerValores),
      );
    }
  }
  const conversoes = entrada.conversoes;
  if (conversoes) {
    const linhas: string[][] = [
      ["Situação", "Conversões"],
      ["Registradas", numero(conversoes.porStatus.registrado)],
      ["Na fila", numero(conversoes.porStatus.enfileirado)],
      ["Enviadas", numero(conversoes.porStatus.enviado)],
      ["Com falha", numero(conversoes.porStatus.falhou)],
      ["Descartadas", numero(conversoes.porStatus.descartado)],
      ["Com identificador do anúncio", numero(conversoes.comCtwa)],
    ];
    if (entrada.podeVerValores) {
      linhas.push([
        "Valor já enviado",
        formatarReaisCompleto(conversoes.valorEnviadoCents),
      ]);
    }
    secoes.push({
      titulo: "Conversões devolvidas à Meta (desde o início)",
      linhas,
    });
  }
  return secoes;
}

function montarComercial(entrada: EntradaDaExportacao): SecaoExportavel[] {
  const secoes: SecaoExportavel[] = [];
  const agenda = entrada.agenda?.atual;
  if (agenda) {
    const cancelados =
      agenda.porStatus.cancelado_paciente + agenda.porStatus.cancelado_clinica;
    const indicadores: string[][] = [
      ["Indicador", "Valor"],
      ["Consultas agendadas", numero(agenda.criados)],
      ["Comparecimentos", numero(agenda.porStatus.compareceu)],
      ["Faltas", numero(agenda.porStatus.faltou)],
      ["Cancelamentos", numero(cancelados)],
      ["Consultas recuperadas", numero(agenda.recuperadas.total)],
    ];
    if (entrada.podeVerValores && agenda.recuperadas.receitaCents !== null) {
      indicadores.push([
        "Receita associada às recuperadas",
        formatarReaisCompleto(agenda.recuperadas.receitaCents),
      ]);
    }
    secoes.push({ titulo: "Indicadores do período", linhas: indicadores });
  }
  const faturamento = linhasDoFaturamento(
    entrada.podeVerValores,
    entrada.faturamento,
  );
  if (faturamento.length > 0) {
    secoes.push({
      titulo: "Faturamento estimado",
      linhas: [["Indicador", "Valor"], ...faturamento],
    });
  }
  const funil = entrada.funil?.atual;
  if (funil) {
    secoes.push(secaoDoFunil(funil));
  }
  if (agenda) {
    secoes.push({
      titulo: "Confirmação de consulta",
      linhas: [
        ["Indicador", "Valor"],
        ...linhasDaConfirmacao(
          agenda,
          entrada.linhaDeBase,
          entrada.podeVerValores,
        ),
      ],
    });
    secoes.push({
      titulo: "Detalhe da agenda",
      linhas: [
        ["Detalhe", "Consultas", "Compareceram", "Faltaram"],
        ...montarDetalheDaAgenda(agenda, entrada.dimensaoAgenda).map(
          (linha) => [
            linha.rotulo,
            numero(linha.total),
            linha.compareceu === null ? "" : numero(linha.compareceu),
            linha.faltou === null ? "" : numero(linha.faltou),
          ],
        ),
      ],
    });
  }
  return secoes;
}

function montarAgente(entrada: EntradaDaExportacao): SecaoExportavel[] {
  const atual = entrada.atendimento?.atual;
  if (!atual) {
    return [];
  }
  const mensagens: string[][] = [
    ["Indicador", "Valor"],
    ["Mensagens enviadas", numero(atual.mensagens.saida)],
    ["Mensagens recebidas", numero(atual.mensagens.entrada)],
    ["Notas internas", numero(atual.mensagens.notasInternas)],
    // So quem ENVIA: 'paciente' e quem recebe, nao entra como envio.
    ...Object.entries(atual.mensagens.porAutor)
      .filter(([autor]) => autor !== "paciente")
      .map(([autor, total]) => [
        `Enviadas: ${AUTOR_ROTULO[autor] ?? autor}`,
        numero(total),
      ]),
  ];
  // Custo por mensagem so existe no canal oficial, e e valor em reais.
  if (entrada.canalOficial && entrada.podeVerValores) {
    mensagens.push(["Custo do período", "Ainda não medido"]);
  }
  return [
    {
      titulo: "Atendimento da equipe",
      linhas: [
        ["Indicador", "Valor"],
        ["Conversas iniciadas", numero(atual.conversasIniciadas)],
        [
          "Novas conversas respondidas",
          `${numero(atual.primeiraResposta.respondidas)} de ${numero(atual.primeiraResposta.conversas)}`,
        ],
        [
          "Primeira resposta (mediana)",
          formatarDuracao(atual.primeiraResposta.medianaSegundos),
        ],
        [
          "Primeira resposta (90% em até)",
          formatarDuracao(atual.primeiraResposta.p90Segundos),
        ],
      ],
    },
    {
      titulo: "Desempenho do agente de IA",
      linhas: [
        ["Indicador", "Valor"],
        ...METRICAS_DO_AGENTE.map((rotulo) => [rotulo, "Ainda não medido"]),
      ],
    },
    { titulo: "Mensagens no período", linhas: mensagens },
  ];
}

/** O retrato da aba ATIVA, em secoes, com os mesmos numeros da tela. */
export function montarExportavelDaAba(
  entrada: EntradaDaExportacao,
): ExportavelDaAba {
  const secoes =
    entrada.aba === "geral"
      ? montarGeral(entrada)
      : entrada.aba === "marketing"
        ? montarMarketing(entrada)
        : entrada.aba === "comercial"
          ? montarComercial(entrada)
          : montarAgente(entrada);
  return { titulo: TITULO_DA_ABA[entrada.aba], secoes };
}

/**
 * Linhas do CSV: cada secao abre com uma linha so com o titulo e termina com
 * uma linha vazia antes da proxima.
 */
export function linhasDoCsv(exportavel: ExportavelDaAba): string[][] {
  const linhas: string[][] = [];
  exportavel.secoes.forEach((secao, indice) => {
    if (indice > 0) {
      linhas.push([]);
    }
    linhas.push([secao.titulo]);
    linhas.push(...secao.linhas);
  });
  return linhas;
}
