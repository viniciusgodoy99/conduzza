import { TZDate, tzOffset } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { formatarReaisCompleto } from "@/lib/domain/formato-compacto";
import { instanteLocal, somarDias } from "@/lib/domain/horarios";
import type { EntradaDaVariacao } from "@/lib/domain/variacao";
import type {
  CampanhasDoPeriodo,
  InvestimentoDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Custo por lead de Resultados (Fase 4, investimento da Meta). Modulo PURO:
// o cartao (Server Component usado pelas abas client), a tabela Campanhas e
// a exportacao (CSV e impressao) usam a MESMA regra e o MESMO texto, como em
// estadoDoFaturamento. Nada aqui converte moeda, inventa zero ou mostra
// valor para quem nao e admin nem gestor.
//
// Numerador: o investimento TOTAL da conta de anuncios no periodo, em real
// (level=account, cobre anuncio arquivado e post impulsionado). Divisor:
// escolhido por DIVISOR_DO_CUSTO_POR_LEAD (decisao D2 do dono, pendente). O
// banco devolve as tres contagens, entao trocar o divisor e trocar a
// constante: as tres opcoes estao implementadas e testadas.

/** As opcoes de divisor que o banco ja devolve prontas. */
export const DIVISORES_DO_CUSTO_POR_LEAD = [
  "leads_de_anuncio",
  "leads_casados",
  "leads",
] as const;

export type DivisorDoCustoPorLead = (typeof DIVISORES_DO_CUSTO_POR_LEAD)[number];

/**
 * Decisao D2 (pendente com o dono; recomendacao da critica da Fase 4):
 * investimento total da conta dividido pelos leads que chegaram por anuncio
 * no periodo (com ctwa_clid, source_ad_id ou source_campaign_id, com
 * campanha reconhecida ou nao).
 * - "leads_casados": so os leads casados com uma campanha (fica alto quando
 *   ha anuncio arquivado);
 * - "leads": todos os leads, como no prototipo (mistura lead organico).
 */
export const DIVISOR_DO_CUSTO_POR_LEAD: DivisorDoCustoPorLead =
  "leads_de_anuncio";

type TextosDoDivisor = {
  /** Estado do cartao quando o divisor e zero. */
  semLead: string;
  /** "N {singular|plural}" no rodape do valor. */
  singular: string;
  plural: string;
  /** Rotulo da contagem na exportacao. */
  rotulo: string;
};

export const TEXTOS_DO_DIVISOR: Record<DivisorDoCustoPorLead, TextosDoDivisor> = {
  leads_de_anuncio: {
    semLead: "Nenhum lead de anúncio",
    singular: "lead de anúncio",
    plural: "leads de anúncio",
    rotulo: "Leads de anúncio",
  },
  leads_casados: {
    semLead: "Nenhum lead ligado a campanha",
    singular: "lead ligado a campanha",
    plural: "leads ligados a campanhas",
    rotulo: "Leads ligados a campanhas",
  },
  leads: {
    semLead: "Nenhum lead no período",
    singular: "lead",
    plural: "leads",
    rotulo: "Leads recebidos",
  },
};

/** Textos fixos do cartao (contrato da Fase 4, secao 4.5). Sem travessao. */
export const TEXTOS_DO_CUSTO_POR_LEAD = {
  naoMedido: "Ainda não medido",
  dicaNaoConfigurado:
    "Ligue a leitura do investimento em Configurações, aba Anúncios da Meta.",
  dicaAguardando: "A primeira leitura do investimento ainda não terminou.",
  dicaComProblema:
    "A leitura do investimento está com problema. Veja o motivo em Configurações, aba Anúncios da Meta.",
  outraMoeda: "Conta em outra moeda",
  rodapeOutraMoeda: "A conta de anúncios não usa real, e o valor não é convertido.",
  semInvestimento: "Sem investimento no período",
  /**
   * Aviso de fuso (critica §6): o texto da config §215 sem o nome IANA do
   * fuso, que nao e linguagem de recepcionista.
   */
  outroFuso:
    "Os dias do investimento seguem o fuso da conta de anúncios, diferente do fuso da clínica.",
} as const;

/**
 * Folga do FIM da leitura, em dias. O diario roda as 06:00 no fuso da
 * clinica e le ate o "hoje" da conta: antes dele a leitura vai ate ontem, e
 * um dia de falha passageira deixa anteontem. Mais atrasada que isso, a
 * leitura parou (token vencido, limite da Meta todo dia): o periodo nao e
 * medido, porque o numerador teria so parte dos dias e o divisor todos.
 */
export const DIAS_DE_FOLGA_DA_LEITURA = 2;

/** Leads que entram no divisor escolhido. */
export function leadsDoDivisor(
  bloco: Pick<CampanhasDoPeriodo, "leads" | "leadsDeAnuncio" | "leadsCasados">,
  divisor: DivisorDoCustoPorLead = DIVISOR_DO_CUSTO_POR_LEAD,
): number {
  if (divisor === "leads_casados") {
    return bloco.leadsCasados;
  }
  if (divisor === "leads") {
    return bloco.leads;
  }
  return bloco.leadsDeAnuncio;
}

/** Centavos por lead, arredondado ao centavo; null sem lead (nunca 0). */
export function custoPorLeadCents(
  investimentoCents: number,
  leads: number,
): number | null {
  if (!(leads > 0) || !Number.isFinite(investimentoCents)) {
    return null;
  }
  return Math.round(investimentoCents / leads);
}

// ---------------------------------------------------------------------------
// Cobertura do investimento: da para medir o periodo?
// ---------------------------------------------------------------------------

export type CoberturaDoInvestimento =
  /** Fora de admin e gestor: o banco nem devolve o bloco. */
  | "sem-acesso"
  /**
   * Sem conta de anuncios salva ou sem linha de leitura (configurada, no
   * banco, e conta salva com linha de leitura: a sessao nao le o token).
   */
  | "nao-configurado"
  /** A conta nao e em real: nada e convertido nem somado. */
  | "outra-moeda"
  /** Configurada, mas a primeira leitura ainda nao gravou nada. */
  | "aguardando-primeira-leitura"
  /** O periodo comeca antes do primeiro dia lido. */
  | "antes-da-leitura"
  /**
   * A leitura parou antes do fim do periodo (ou de hoje, se o periodo vai
   * ate o futuro), alem da folga de DIAS_DE_FOLGA_DA_LEITURA dias.
   */
  | "leitura-atrasada"
  | "completa";

/** A conta de anuncios esta (ou teve gasto no periodo) em outra moeda. */
function emOutraMoeda(investimento: InvestimentoDoPeriodo): boolean {
  return (
    investimento.outraMoeda ||
    (investimento.moeda !== null && investimento.moeda !== "BRL")
  );
}

/**
 * Ordem de proposito: sem acesso, sem configuracao, outra moeda (nunca vai
 * ser medido em real, entao vence a espera), antes da primeira leitura,
 * periodo antes do primeiro dia lido (lido_desde > dia_de: o numerador teria
 * so parte dos dias e o custo sairia baixo demais), leitura atrasada,
 * completa. O fim conta com folga: a leitura tem de ir pelo menos ate
 * DIAS_DE_FOLGA_DA_LEITURA dias antes do MENOR entre o fim do periodo e
 * hoje (periodo que termina no futuro mede ate hoje). Assim o atraso normal
 * do diario nao apaga o numero, e uma leitura parada nao vira custo baixo
 * demais, variacao verde nem "Sem investimento no período" falso. So
 * comparacao de texto aaaa-mm-dd, sem new Date (regra 3.6).
 */
export function coberturaDoInvestimento(
  investimento: InvestimentoDoPeriodo | null | undefined,
): CoberturaDoInvestimento {
  if (!investimento) {
    return "sem-acesso";
  }
  if (!investimento.configurada) {
    return "nao-configurado";
  }
  if (emOutraMoeda(investimento)) {
    return "outra-moeda";
  }
  // As duas pontas sao gravadas juntas (regravar_gasto_meta); sem alguma
  // delas, nada foi lido por inteiro ainda.
  if (investimento.lidoDesde === null || investimento.lidoAte === null) {
    return "aguardando-primeira-leitura";
  }
  if (investimento.lidoDesde > investimento.diaDe) {
    return "antes-da-leitura";
  }
  const fim =
    investimento.diaAte < investimento.hoje
      ? investimento.diaAte
      : investimento.hoje;
  if (investimento.lidoAte < somarDias(fim, -DIAS_DE_FOLGA_DA_LEITURA)) {
    return "leitura-atrasada";
  }
  return "completa";
}

/**
 * Aviso de fuso (critica §6, D5): o gasto diario vem no dia civil da CONTA,
 * e agregado diario nao se converte. Avisa so quando o DESLOCAMENTO UTC da
 * conta difere do da clinica (Fortaleza e Sao Paulo coincidem, sem aviso),
 * conferido ao meio-dia (no fuso da clinica) do primeiro e do ultimo dia do
 * periodo, para pegar horario de verao no meio. So com o periodo medido
 * (cobertura completa): sem numero na tela, nao ha o que avisar. Fora da
 * gestao (bloco null), sem fuso gravado ou com fuso invalido: null.
 */
export function avisoDeFusoDaConta(
  investimento: InvestimentoDoPeriodo | null | undefined,
  timezoneDaClinica: string,
): string | null {
  if (!investimento || coberturaDoInvestimento(investimento) !== "completa") {
    return null;
  }
  const fuso = investimento.fusoDaConta;
  if (!fuso || fuso === timezoneDaClinica) {
    return null;
  }
  for (const dia of [investimento.diaDe, investimento.diaAte]) {
    let instante: Date;
    try {
      instante = instanteLocal(timezoneDaClinica, dia, "12:00");
    } catch {
      return null;
    }
    const daConta = tzOffset(fuso, instante);
    const daClinica = tzOffset(timezoneDaClinica, instante);
    if (!Number.isFinite(daConta) || !Number.isFinite(daClinica)) {
      return null;
    }
    if (daConta !== daClinica) {
      return TEXTOS_DO_CUSTO_POR_LEAD.outroFuso;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Estado do cartao
// ---------------------------------------------------------------------------

export type EstadoDoCustoPorLead =
  | { tipo: "sem-acesso" }
  | { tipo: "nao-configurado" }
  | { tipo: "outra-moeda" }
  | { tipo: "aguardando-primeira-leitura"; comProblema: boolean }
  | { tipo: "antes-da-leitura"; lidoDesde: string }
  | { tipo: "leitura-atrasada"; lidoAte: string; comProblema: boolean }
  | { tipo: "sem-investimento" }
  | {
      tipo: "sem-lead";
      investimentoCents: number;
      divisor: DivisorDoCustoPorLead;
    }
  | {
      tipo: "valor";
      custoCents: number;
      investimentoCents: number;
      leads: number;
      divisor: DivisorDoCustoPorLead;
    };

export function estadoDoCustoPorLead(
  bloco: CampanhasDoPeriodo,
  divisor: DivisorDoCustoPorLead = DIVISOR_DO_CUSTO_POR_LEAD,
): EstadoDoCustoPorLead {
  const investimento = bloco.investimento;
  const cobertura = coberturaDoInvestimento(investimento);
  if (!investimento || cobertura === "sem-acesso") {
    return { tipo: "sem-acesso" };
  }
  if (cobertura === "nao-configurado") {
    return { tipo: "nao-configurado" };
  }
  if (cobertura === "outra-moeda") {
    return { tipo: "outra-moeda" };
  }
  if (cobertura === "aguardando-primeira-leitura") {
    return {
      tipo: "aguardando-primeira-leitura",
      comProblema: investimento.situacao === "com_problema",
    };
  }
  if (cobertura === "antes-da-leitura") {
    // lidoDesde nao e null aqui (a cobertura ja conferiu).
    return { tipo: "antes-da-leitura", lidoDesde: investimento.lidoDesde ?? "" };
  }
  if (cobertura === "leitura-atrasada") {
    // lidoAte nao e null aqui (a cobertura ja conferiu).
    return {
      tipo: "leitura-atrasada",
      lidoAte: investimento.lidoAte ?? "",
      comProblema: investimento.situacao === "com_problema",
    };
  }
  if (!(investimento.investimentoCents > 0)) {
    return { tipo: "sem-investimento" };
  }
  const leads = leadsDoDivisor(bloco, divisor);
  const custo = custoPorLeadCents(investimento.investimentoCents, leads);
  if (custo === null) {
    return {
      tipo: "sem-lead",
      investimentoCents: investimento.investimentoCents,
      divisor,
    };
  }
  return {
    tipo: "valor",
    custoCents: custo,
    investimentoCents: investimento.investimentoCents,
    leads,
    divisor,
  };
}

/** "04/09/2026" a partir de "2026-09-04" (rotulo de dia, sem fuso). */
export function diaPorExtenso(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

export function dicaAntesDaLeitura(lidoDesde: string): string {
  return `O investimento é lido a partir de ${diaPorExtenso(lidoDesde)}.`;
}

/** Leitura parada: ate que dia o investimento foi lido. */
export function dicaLeituraAtrasada(lidoAte: string): string {
  return `O investimento foi lido até ${diaPorExtenso(lidoAte)}.`;
}

function contagem(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : plural}`;
}

/**
 * O texto do VALOR do cartao, o mesmo no CSV: o numero cheio no estado
 * "valor", "Ainda não medido" nos quatro estados sem medida, o estado escrito
 * nos outros. Nunca "R$ 0,00" no lugar de uma medida que nao existe.
 */
export function textoDoCustoPorLead(estado: EstadoDoCustoPorLead): string {
  switch (estado.tipo) {
    case "sem-acesso":
      return "Sem acesso";
    case "nao-configurado":
    case "aguardando-primeira-leitura":
    case "antes-da-leitura":
    case "leitura-atrasada":
      return TEXTOS_DO_CUSTO_POR_LEAD.naoMedido;
    case "outra-moeda":
      return TEXTOS_DO_CUSTO_POR_LEAD.outraMoeda;
    case "sem-investimento":
      return TEXTOS_DO_CUSTO_POR_LEAD.semInvestimento;
    case "sem-lead":
      return TEXTOS_DO_DIVISOR[estado.divisor].semLead;
    case "valor":
      return formatarReaisCompleto(estado.custoCents);
  }
}

/** O porque do "Ainda não medido" (dica do cartao). null nos outros estados. */
export function dicaDoCustoPorLead(estado: EstadoDoCustoPorLead): string | null {
  switch (estado.tipo) {
    case "nao-configurado":
      return TEXTOS_DO_CUSTO_POR_LEAD.dicaNaoConfigurado;
    case "aguardando-primeira-leitura":
      return estado.comProblema
        ? TEXTOS_DO_CUSTO_POR_LEAD.dicaComProblema
        : TEXTOS_DO_CUSTO_POR_LEAD.dicaAguardando;
    case "antes-da-leitura":
      return dicaAntesDaLeitura(estado.lidoDesde);
    case "leitura-atrasada":
      return estado.comProblema
        ? `${dicaLeituraAtrasada(estado.lidoAte)} ${TEXTOS_DO_CUSTO_POR_LEAD.dicaComProblema}`
        : dicaLeituraAtrasada(estado.lidoAte);
    default:
      return null;
  }
}

/**
 * Rodape do numero: "R$ 3.420,00 em 186 leads de anúncio" no valor, o
 * investimento escrito quando nao ha lead para dividir, a moeda no estado
 * de outra moeda. null nos outros.
 */
export function rodapeDoCustoPorLead(estado: EstadoDoCustoPorLead): string | null {
  if (estado.tipo === "valor") {
    const textos = TEXTOS_DO_DIVISOR[estado.divisor];
    return `${formatarReaisCompleto(estado.investimentoCents)} em ${contagem(
      estado.leads,
      textos.singular,
      textos.plural,
    )}`;
  }
  if (estado.tipo === "sem-lead") {
    return `${formatarReaisCompleto(estado.investimentoCents)} investidos no período`;
  }
  if (estado.tipo === "outra-moeda") {
    return TEXTOS_DO_CUSTO_POR_LEAD.rodapeOutraMoeda;
  }
  return null;
}

/**
 * Variacao contra o periodo anterior: so com os DOIS periodos medidos por
 * inteiro (estado "valor" nos dois). Cair e bom (polaridade menor-melhor).
 */
export function variacaoDoCustoPorLead(
  campanhas: Periodizado<CampanhasDoPeriodo>,
  divisor: DivisorDoCustoPorLead = DIVISOR_DO_CUSTO_POR_LEAD,
): EntradaDaVariacao | null {
  if (!campanhas.anterior) {
    return null;
  }
  const atual = estadoDoCustoPorLead(campanhas.atual, divisor);
  const anterior = estadoDoCustoPorLead(campanhas.anterior, divisor);
  if (atual.tipo !== "valor" || anterior.tipo !== "valor") {
    return null;
  }
  return {
    atual: atual.custoCents,
    anterior: anterior.custoCents,
    polaridade: "menor-melhor",
    comparadoCom: "período anterior",
  };
}

/**
 * "03/10 às 06:00" no fuso da CLINICA (regra 3.6), a partir do instante da
 * ultima leitura que deu certo. null antes da primeira.
 */
export function formatarAtualizadoEm(
  sincronizadoEm: string | null,
  timezone: string,
): string | null {
  if (!sincronizadoEm) {
    return null;
  }
  const instante = new Date(sincronizadoEm);
  if (Number.isNaN(instante.getTime())) {
    return null;
  }
  return format(new TZDate(instante.getTime(), timezone), "dd/MM 'às' HH:mm", {
    locale: ptBR,
  });
}

/** "Atualizado em 03/10 às 06:00", ou null antes da primeira leitura. */
export function textoAtualizadoEm(
  sincronizadoEm: string | null,
  timezone: string,
): string | null {
  const quando = formatarAtualizadoEm(sincronizadoEm, timezone);
  return quando ? `Atualizado em ${quando}` : null;
}
