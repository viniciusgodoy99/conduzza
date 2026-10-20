import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DICA_EXPORTAR_LEADS,
  detalhesDaTrilhaDaExportacao,
  filtrosDaExportacaoSchema,
  linhasDaExportacaoDeLeads,
  mensagemAcimaDoTeto,
  MENSAGEM_EXPORTACAO_CLINICA_MUDOU,
  MENSAGEM_EXPORTACAO_FALHOU,
  MENSAGEM_EXPORTACAO_FILTROS_INVALIDOS,
  MENSAGEM_EXPORTACAO_TRILHA_FALHOU,
  nomeDoArquivoDaExportacao,
  podeExportarLeads,
  TETO_DA_EXPORTACAO_DE_LEADS,
  valoresDaExportacao,
  type DetalhesDaTrilhaDaExportacao,
  type LeadParaExportar,
} from "@/lib/domain/exportacao-de-leads";
import {
  compararNaOrdemDaTela,
  filtrarLeads,
  filtrosDeLeadsDosValores,
  idDeAnuncioValido,
  situacaoDoConsentimentoDeLinhas,
  type FiltrosDeLeads,
} from "@/lib/domain/leads-ui";
import type { Role } from "@/lib/domain/permissions";
import { fetchDetalhesDosAnuncios } from "@/lib/queries/anuncio-do-whatsapp";
import { fetchJornada } from "@/lib/queries/jornada";
import {
  aplicarFiltrosDeLeads,
  consultaDosLeads,
  fetchAnunciosDaMeta,
  LEAD_SELECT,
  linhasDeConsentimentoDoLead,
  linhasDosLeads,
  normalizarLead,
  type LeadResumo,
} from "@/lib/queries/leads";
import { gerarCsv } from "@/lib/utils/csv";

// Exportacao dos leads da Tela 4 no SERVIDOR (pedido do dono em 20/10/2026).
// A lista da tela carrega so os LEADS_LIMIT contatos mais recentes; o arquivo
// precisa de TODOS os que batem com os filtros, entao a leitura e paginada
// aqui, pela SESSAO de quem pediu (a RLS recorta a clinica: se a guarda de
// codigo falhar, o dado de outra clinica continua fora), com o MESMO
// construtor de consulta e os MESMOS filtros da lista (consultaDosLeads,
// aplicarFiltrosDeLeads e, no fim, o proprio filtrarLeads da tela).
//
// Ordem de cada pedido:
// 1. papel (so administrador e gestor; senao 403 com a dica do dono);
// 2. a clinica da tela igual a ativa (senao 409: trocou em outra aba);
// 3. filtros validados (Zod);
// 4. leitura paginada com a contagem na primeira pagina (acima do teto,
//    recusa antes de ler o resto);
// 5. anuncios (campanha, conjunto e nome na Meta; titulo guardado) e a
//    jornada, para os rotulos;
// 6. o CSV inteiro montado;
// 7. a trilha (UMA linha em audit_log, com a quantidade e os filtros);
//    sem ela gravada, nada sai;
// 8. so entao o arquivo.
//
// Nada de dado de paciente vai para log: quem chama (a rota) loga so o
// motivo da falha e ids.

/** Linhas por pagina: o teto de linhas por resposta do PostgREST. */
export const PAGINA_DA_EXPORTACAO = 1000;

// O select da lista, mais o tipo do contato (coluna Tipo do arquivo).
const SELECT_DA_EXPORTACAO = `${LEAD_SELECT}, kind`;

/**
 * Coluna que o PostgREST nao conhece (PGRST204): audit_log.detalhes antes da
 * migration 20261020120000 ser aplicada.
 */
const COLUNA_DESCONHECIDA = "PGRST204";

export type SessaoDaExportacao = {
  userId: string;
  clinicId: string;
  role: Role;
  /** Fuso IANA da clinica ativa (regra 3.6). */
  timezone: string;
};

export type ResultadoDaExportacao =
  | {
      tipo: "arquivo";
      nome: string;
      conteudo: string;
      quantidade: number;
      /** A trilha gravou sem `detalhes` (migration ainda nao aplicada). */
      trilhaSemDetalhes: boolean;
    }
  | { tipo: "vazio" }
  | { tipo: "recusada"; status: 400 | 403 | 409 | 422; mensagem: string }
  | {
      tipo: "falhou";
      status: 500 | 503;
      mensagem: string;
      /** Para o log da rota: em que passo parou (nunca o dado). */
      motivo: "leitura" | "trilha";
      /** Codigo do PostgREST da leitura dos contatos, quando houve. */
      codigo: string | null;
    };

export type LeituraDaExportacao =
  | { tipo: "acima_do_teto"; total: number | null }
  | {
      tipo: "lidos";
      leads: LeadParaExportar[];
      /** Chave da etapa -> nome, da jornada da clinica. */
      etapas: Map<string, string>;
    };

type LeadLido = LeadResumo & {
  kind: string;
  consentimento: LeadParaExportar["consentimento"];
};

function normalizarLeadDaExportacao(row: Record<string, unknown>): LeadLido {
  return {
    ...normalizarLead(row),
    kind: (row.kind as string | null) ?? "lead",
    consentimento: situacaoDoConsentimentoDeLinhas(
      linhasDeConsentimentoDoLead(row),
    ),
  };
}

/**
 * Falha ao ler os contatos, com o codigo do PostgREST para o log da rota (o
 * codigo nunca carrega dado; a mensagem pode carregar, e nao sai daqui).
 */
export class ErroNaLeituraDosLeads extends Error {
  constructor(readonly codigo: string | null) {
    super("leitura_dos_leads");
  }
}

/**
 * TODOS os leads da clinica que batem com os filtros, ja com o que o arquivo
 * escreve, na ordem da tela (compararNaOrdemDaTela). Paginado por id
 * (cursor), que nao pula nem repete contato quando chega lead novo no meio
 * da leitura. O banco conta na primeira pagina: acima do teto, para ali.
 * Pagina curta so encerra depois de ler tudo o que o banco contou: o
 * PostgREST corta cada resposta no "Max rows" do projeto, que pode ser menor
 * que a pagina pedida, e parar ali daria um arquivo pela metade sem erro.
 * LANCA em erro de leitura (contatos, anuncios ou jornada): arquivo pela
 * metade nunca sai.
 */
export async function lerLeadsParaExportar(
  supabase: SupabaseClient,
  clinicId: string,
  filtros: FiltrosDeLeads,
  teto: number = TETO_DA_EXPORTACAO_DE_LEADS,
): Promise<LeituraDaExportacao> {
  const linhas: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let contados: number | null = null;
  for (let pagina = 0; ; pagina += 1) {
    let consulta = aplicarFiltrosDeLeads(
      consultaDosLeads(supabase, clinicId, {
        colunas: SELECT_DA_EXPORTACAO,
        contar: pagina === 0,
      }),
      filtros,
    );
    if (cursor !== null) {
      consulta = consulta.gt("id", cursor);
    }
    const { data, error, count } = await consulta
      .order("id", { ascending: true })
      .limit(PAGINA_DA_EXPORTACAO);
    if (error) {
      throw new ErroNaLeituraDosLeads(error.code ?? null);
    }
    if (pagina === 0 && typeof count === "number") {
      if (count > teto) {
        return { tipo: "acima_do_teto", total: count };
      }
      contados = count;
    }
    const lote = linhasDosLeads(data);
    linhas.push(...lote);
    // Lead que chegou durante a leitura nao passa o teto por tras.
    if (linhas.length > teto) {
      return { tipo: "acima_do_teto", total: null };
    }
    const ultimo = lote[lote.length - 1];
    // Sem contagem, so a pagina vazia prova o fim.
    const leuTudoQueFoiContado = contados !== null && linhas.length >= contados;
    if (
      !ultimo ||
      (lote.length < PAGINA_DA_EXPORTACAO && leuTudoQueFoiContado)
    ) {
      break;
    }
    cursor = ultimo.id as string;
  }

  // A decisao final e a MESMA funcao da tela: o banco so adiantou o recorte.
  const lidos = filtrarLeads(linhas.map(normalizarLeadDaExportacao), filtros);
  if (lidos.length === 0) {
    return { tipo: "lidos", leads: [], etapas: new Map() };
  }

  const adIds = lidos.map((lead) => lead.source_ad_id);
  const [anuncios, detalhes, jornada] = await Promise.all([
    fetchAnunciosDaMeta(supabase, clinicId, adIds, { comNome: true }),
    fetchDetalhesDosAnuncios(supabase, clinicId, adIds),
    fetchJornada(supabase, clinicId),
  ]);

  const leads: LeadParaExportar[] = lidos
    .map((lead) => {
      const adId = idDeAnuncioValido(lead.source_ad_id);
      return {
        ...lead,
        anuncio_meta: {
          estado: "lida" as const,
          anuncio: adId ? (anuncios.get(adId) ?? null) : null,
        },
        titulo_do_anuncio: adId ? (detalhes.get(adId)?.titulo ?? null) : null,
      };
    })
    .sort(compararNaOrdemDaTela);

  return {
    tipo: "lidos",
    leads,
    etapas: new Map(jornada.map((etapa) => [etapa.chave, etapa.nome])),
  };
}

/** Como a trilha da exportacao ficou. */
export type TrilhaDaExportacao = "com_detalhes" | "sem_detalhes" | "falhou";

/**
 * UMA linha na trilha (regra 3.1): quem exportou, de que clinica, "leads",
 * com a quantidade e os filtros em `detalhes` (nunca dado de paciente).
 * Pela SESSAO: a policy exige user_id = auth.uid() e clinica ativa, e e isso
 * que impede forjar trilha alheia. Antes da migration que cria
 * audit_log.detalhes (20261020120000), a linha sai sem os detalhes: o
 * PostgREST recusa a coluna antes de gravar, entao nunca ficam duas.
 */
export async function registrarExportacaoDeLeads(
  supabase: SupabaseClient,
  registro: {
    clinicId: string;
    userId: string;
    detalhes: DetalhesDaTrilhaDaExportacao;
  },
): Promise<TrilhaDaExportacao> {
  const linha = {
    clinic_id: registro.clinicId,
    user_id: registro.userId,
    action: "exportou",
    entity: "leads",
    entity_id: null,
  };
  const { error } = await supabase
    .from("audit_log")
    .insert({ ...linha, detalhes: registro.detalhes });
  if (!error) {
    return "com_detalhes";
  }
  if (error.code !== COLUNA_DESCONHECIDA) {
    return "falhou";
  }
  const { error: erroSemDetalhes } = await supabase
    .from("audit_log")
    .insert(linha);
  return erroSemDetalhes ? "falhou" : "sem_detalhes";
}

/**
 * O pedido inteiro, do papel ao arquivo. `entrada` e o corpo da rota, ainda
 * nao validado. `agora` da o dia do nome do arquivo (no fuso da clinica).
 */
export async function exportarLeads({
  supabase,
  sessao,
  clinicaDaTela,
  entrada,
  agora,
}: {
  supabase: SupabaseClient;
  sessao: SessaoDaExportacao;
  /**
   * A clinica que a tela mostra (CABECALHO_DA_CLINICA_DA_TELA). So confere:
   * a clinica do arquivo e SEMPRE a ativa da sessao.
   */
  clinicaDaTela: string | null;
  entrada: unknown;
  agora: Date;
}): Promise<ResultadoDaExportacao> {
  // Papel antes de tudo: quem nao exporta nao chega nem a validar filtro, e
  // nada e lido do banco.
  if (!podeExportarLeads(sessao.role)) {
    return { tipo: "recusada", status: 403, mensagem: DICA_EXPORTAR_LEADS };
  }
  // A clinica ativa mudou em outra aba (ou a tela nao disse qual mostra): o
  // arquivo sairia de outra clinica com os filtros desta tela.
  if (clinicaDaTela !== sessao.clinicId) {
    return {
      tipo: "recusada",
      status: 409,
      mensagem: MENSAGEM_EXPORTACAO_CLINICA_MUDOU,
    };
  }
  // Sem corpo nao e "sem filtro": a tela manda {} quando nao ha filtro.
  const parsed = filtrosDaExportacaoSchema.safeParse(entrada);
  if (!parsed.success) {
    return {
      tipo: "recusada",
      status: 400,
      mensagem: MENSAGEM_EXPORTACAO_FILTROS_INVALIDOS,
    };
  }
  const filtros = filtrosDeLeadsDosValores(
    valoresDaExportacao(parsed.data),
    sessao.timezone,
  );

  let leitura: LeituraDaExportacao;
  let conteudo: string;
  try {
    leitura = await lerLeadsParaExportar(supabase, sessao.clinicId, filtros);
    if (leitura.tipo === "acima_do_teto") {
      return {
        tipo: "recusada",
        status: 422,
        mensagem: mensagemAcimaDoTeto(leitura.total),
      };
    }
    if (leitura.leads.length === 0) {
      return { tipo: "vazio" };
    }
    conteudo = gerarCsv(
      linhasDaExportacaoDeLeads(leitura.leads, {
        etapas: leitura.etapas,
        timezone: sessao.timezone,
      }),
    );
  } catch (erro) {
    return {
      tipo: "falhou",
      status: 500,
      mensagem: MENSAGEM_EXPORTACAO_FALHOU,
      motivo: "leitura",
      codigo: erro instanceof ErroNaLeituraDosLeads ? erro.codigo : null,
    };
  }

  const quantidade = leitura.leads.length;
  const trilha = await registrarExportacaoDeLeads(supabase, {
    clinicId: sessao.clinicId,
    userId: sessao.userId,
    detalhes: detalhesDaTrilhaDaExportacao(quantidade, parsed.data),
  }).catch((): TrilhaDaExportacao => "falhou");
  if (trilha === "falhou") {
    return {
      tipo: "falhou",
      status: 503,
      mensagem: MENSAGEM_EXPORTACAO_TRILHA_FALHOU,
      motivo: "trilha",
      codigo: null,
    };
  }

  return {
    tipo: "arquivo",
    nome: nomeDoArquivoDaExportacao(agora, sessao.timezone),
    conteudo,
    quantidade,
    trilhaSemDetalhes: trilha === "sem_detalhes",
  };
}
