import type { DimensaoDaOrigem } from "@/lib/domain/exportacao-de-resultados";
import type { AbaDeResultados } from "@/lib/queries/relatorios";

// Painel por origem em Resultados (decisao do dono de 17/11/2026): os quatro
// grupos que o Tintim mostra, como filtro da tela (?origem=) e como serie do
// grafico "Origem dos leads por dia". A regra de qual lead cai em qual grupo
// vive no banco (grupo_de_origem, migration 20261117110000); aqui ficam as
// chaves, os rotulos, a leitura do que vem do endereco e do banco, e o texto
// do aviso que diz o que acompanha o filtro em cada aba.

/** As quatro chaves, na ordem fixa do seletor, da legenda e da exportacao. */
export const GRUPOS_DE_ORIGEM = [
  "meta",
  "google",
  "outras",
  "nao_rastreada",
] as const;

export type GrupoDeOrigem = (typeof GRUPOS_DE_ORIGEM)[number];

export const ROTULO_DO_GRUPO_DE_ORIGEM: Record<GrupoDeOrigem, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  outras: "Outras origens",
  nao_rastreada: "Não rastreada",
};

/** Sem filtro. */
export const ROTULO_TODAS_AS_ORIGENS = "Todas as origens";

/**
 * O ?origem= do endereco (ou o valor do seletor) vira grupo; qualquer coisa
 * fora da lista vira null, que e "todas as origens". Busca na lista, nunca
 * em objeto: "constructor" ou "toString" nao podem achar o prototipo.
 */
export function lerGrupoDeOrigem(valor: unknown): GrupoDeOrigem | null {
  return GRUPOS_DE_ORIGEM.find((grupo) => grupo === valor) ?? null;
}

/** Leads em cada grupo (por_grupo do banco), sempre com as quatro chaves. */
export type LeadsPorGrupo = Record<GrupoDeOrigem, number>;

/**
 * por_grupo como veio do banco. Sem o campo (banco de antes da migration
 * 20261117110000) ou fora do formato: null, e a tela diz que o dado nao esta
 * disponivel em vez de inventar zero. Com o campo, o grupo ausente e zero de
 * verdade: funil_do_periodo so manda os grupos que tem lead.
 */
export function lerLeadsPorGrupo(bruto: unknown): LeadsPorGrupo | null {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    return null;
  }
  const lido = {} as LeadsPorGrupo;
  for (const grupo of GRUPOS_DE_ORIGEM) {
    const valor = Object.prototype.hasOwnProperty.call(bruto, grupo)
      ? (bruto as Record<string, unknown>)[grupo]
      : 0;
    // So numero de verdade: Number(null) e Number("") dariam zero inventado.
    if (
      typeof valor !== "number" ||
      !Number.isSafeInteger(valor) ||
      valor < 0
    ) {
      return null;
    }
    lido[grupo] = valor;
  }
  return lido;
}

/** "12 leads", "1 lead". */
export function textoDeLeads(leads: number): string {
  return `${leads.toLocaleString("pt-BR")} ${leads === 1 ? "lead" : "leads"}`;
}

// ---------------------------------------------------------------------------
// O aviso do filtro
// ---------------------------------------------------------------------------
// So acompanha o filtro o que vem de funil_do_periodo, de
// serie_diaria_do_periodo e, desde 23/11/2026, de vendas_do_periodo (Vendas e
// Valor das vendas). Os nomes abaixo sao os que aparecem na tela, na
// ordem da tela; quem mexer num bloco de Resultados confere esta lista (o
// teste painel-por-origem cobra os nomes de cada aba).

const BLOCOS_POR_ABA: Record<
  AbaDeResultados,
  { acompanham: string[]; continuam: string[] }
> = {
  geral: {
    acompanham: [
      "Leads recebidos",
      "Consultas agendadas",
      "Taxa de conversão",
      "Leads x consultas agendadas",
      "Origem dos leads",
      "Funil comercial",
    ],
    continuam: [
      "Custo por lead",
      "Faturamento estimado",
      "Confirmação de consulta",
      "Agente de IA",
      "Campanhas",
    ],
  },
  marketing: {
    acompanham: [
      "Leads recebidos",
      "Com origem identificada",
      "Lead para comparecimento",
      "Taxa de falta",
      "Origem dos leads",
      "Origem dos leads por dia",
    ],
    continuam: ["Custo por lead", "Campanhas", "Conversões devolvidas à Meta"],
  },
  comercial: {
    acompanham: ["Vendas", "Valor das vendas", "Funil comercial"],
    continuam: [
      "Consultas agendadas",
      "Comparecimentos",
      "Faltas",
      "Cancelamentos",
      "Consultas recuperadas",
      "Faturamento estimado",
      "Confirmação de consulta",
      "Detalhe da agenda",
    ],
  },
  ia: { acompanham: [], continuam: [] },
};

const LISTA = new Intl.ListFormat("pt-BR", { type: "conjunction" });

export type AvisoDoFiltroDeOrigem = {
  titulo: string;
  /** O que acompanha a origem e o que continua com todas (tela e arquivo). */
  texto: string;
  /** So da tela: os links para a lista de Leads que somem com o filtro. */
  notaDaTela: string | null;
};

/**
 * O aviso da tela (e da exportacao) com uma origem escolhida: o que esta
 * filtrado e o que continua com todas as origens NA ABA ABERTA. O Detalhe da
 * origem (Marketing) so acompanha na dimensao Canal: por campanha e por
 * anuncio as linhas vem de outras consultas, sem o filtro.
 */
export function avisoDoFiltroDeOrigem(
  aba: AbaDeResultados,
  grupo: GrupoDeOrigem,
  dimensaoOrigem: DimensaoDaOrigem = "canal",
): AvisoDoFiltroDeOrigem {
  const titulo = `Origem escolhida: ${ROTULO_DO_GRUPO_DE_ORIGEM[grupo]}`;
  if (aba === "ia") {
    return {
      titulo,
      texto:
        "Nada nesta aba acompanha a origem escolhida: os números do agente de IA continuam com todas as origens.",
      notaDaTela: null,
    };
  }
  const blocos = BLOCOS_POR_ABA[aba];
  const acompanham = [...blocos.acompanham];
  const continuam = [...blocos.continuam];
  if (aba === "marketing") {
    if (dimensaoOrigem === "canal") {
      acompanham.push("Detalhe da origem por canal");
    } else {
      continuam.push(
        dimensaoOrigem === "campanha"
          ? "Detalhe da origem por campanha"
          : "Detalhe da origem por anúncio",
      );
    }
  }
  return {
    titulo,
    texto: `Acompanham a origem: ${LISTA.format(acompanham)}. Continuam com todas as origens: ${LISTA.format(continuam)}.`,
    // A lista de Leads nao conhece este filtro: o link abriria mais leads do
    // que a linha mostra, entao some enquanto houver origem escolhida.
    notaDaTela:
      aba === "geral"
        ? "Enquanto houver origem escolhida, os nomes em Origem dos leads não abrem a lista de Leads."
        : aba === "marketing"
          ? "Enquanto houver origem escolhida, os nomes em Origem dos leads e no detalhe por canal não abrem a lista de Leads."
          : null,
  };
}
