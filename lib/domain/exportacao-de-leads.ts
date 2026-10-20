import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";

import { rotuloDoCanal } from "@/components/leads/rotulos";
import {
  idDoAnuncioDoWhatsapp,
  ROTULO_ANUNCIO_NAO_IDENTIFICADO,
  rotuloDoAnuncio,
} from "@/lib/domain/anuncio-do-whatsapp";
import { diaCivil } from "@/lib/domain/horarios";
import {
  campanhaDoContato,
  conjuntoDoContato,
  ehDiaCivilValido,
  ehLeadDeAnuncio,
  LOST_REASONS,
  rotuloDoMetodo,
  type AnuncioDaMeta,
  type SituacaoDoConsentimento,
  type ValoresDosFiltrosDeLeads,
} from "@/lib/domain/leads-ui";
import type { Role } from "@/lib/domain/permissions";
import { formatarTelefone } from "@/lib/domain/telefone";

// Exportacao dos leads da Tela 4 (pedido do dono em 20/10/2026: "conseguir
// exportar os leads e nao so importar"). Regras PURAS, sem I/O: quem pode,
// o teto, as colunas e os rotulos, a linha de cada lead, o nome do arquivo e
// o que vai para a trilha. Quem le o banco e grava a trilha e
// lib/queries/exportacao-de-leads.ts; a rota e app/api/leads/exportar.
//
// Decisoes do dono (20/10/2026):
// 1. So administrador e gestor exportam. Recepcao, profissional e somente
//    leitura veem o botao visivel e desabilitado, com a dica abaixo.
// 2. O arquivo sai com TODOS os leads que batem com os filtros da tela
//    naquele momento (nao so os carregados); sem filtro, a base inteira.
//
// Os rotulos sao os da tela (rotulos.ts e leads-ui.ts). Campo vazio fica
// vazio (nunca travessao nem "Sem nome"): o arquivo e dado para planilha.

/** Os papeis que exportam os leads (decisao do dono em 20/10/2026). */
export const PAPEIS_QUE_EXPORTAM_LEADS: readonly Role[] = ["admin", "gestor"];

export function podeExportarLeads(role: Role): boolean {
  return PAPEIS_QUE_EXPORTAM_LEADS.includes(role);
}

/** A dica do botao desabilitado e a resposta 403 da rota (texto do dono). */
export const DICA_EXPORTAR_LEADS =
  "Só o administrador e o gestor exportam os leads.";

/** Teto de leads num arquivo; acima disso a exportacao pede para filtrar. */
export const TETO_DA_EXPORTACAO_DE_LEADS = 20_000;

export const MENSAGEM_NENHUM_LEAD_PARA_EXPORTAR =
  "Nenhum lead para exportar com esses filtros.";
export const MENSAGEM_EXPORTACAO_SESSAO_EXPIRADA =
  "Sua sessão expirou. Entre de novo para exportar os leads.";
export const MENSAGEM_EXPORTACAO_SEM_CLINICA =
  "Escolha a clínica antes de exportar os leads.";
// Os vinculos nao carregaram (o banco oscilou): da para tentar de novo.
export const MENSAGEM_EXPORTACAO_ACESSO_INDISPONIVEL =
  "Não foi possível conferir seu acesso agora. Tente de novo.";
// A tela aberta e de uma clinica e a ativa agora e outra (troca em outra
// aba): o arquivo sairia da outra clinica com os filtros desta tela.
export const MENSAGEM_EXPORTACAO_CLINICA_MUDOU =
  "A clínica desta tela mudou em outra aba. Recarregue a página e exporte de novo.";

/**
 * Cabecalho com a clinica que a tela mostra. A rota so CONFERE com a clinica
 * ativa da sessao (diferente recusa com 409); nunca escolhe a clinica por ele.
 */
export const CABECALHO_DA_CLINICA_DA_TELA = "x-clinica-da-tela";
export const MENSAGEM_EXPORTACAO_FILTROS_INVALIDOS =
  "Não deu para ler os filtros da tela. Limpe os filtros e tente de novo.";
export const MENSAGEM_EXPORTACAO_FALHOU =
  "Não foi possível montar o arquivo dos leads. Tente de novo.";
// O mesmo texto da Agenda e de Resultados quando a trilha nao grava.
export const MENSAGEM_EXPORTACAO_TRILHA_FALHOU =
  "Não foi possível registrar a exportação. Tente de novo.";
export const MENSAGEM_EXPORTACAO_SEM_CONEXAO =
  "Não foi possível exportar agora. Confira a internet e tente de novo.";

const numero = new Intl.NumberFormat("pt-BR");

/**
 * Recusa acima do teto, com o tamanho de verdade quando o banco contou.
 * Sem travessao: virgula e ponto.
 */
export function mensagemAcimaDoTeto(total: number | null): string {
  const quantos =
    total !== null && total > TETO_DA_EXPORTACAO_DE_LEADS
      ? `São ${numero.format(total)} leads com esses filtros`
      : `São mais de ${numero.format(TETO_DA_EXPORTACAO_DE_LEADS)} leads com esses filtros`;
  return `${quantos}, e cada arquivo leva até ${numero.format(TETO_DA_EXPORTACAO_DE_LEADS)}. Filtre por etapa, origem, responsável ou período e exporte em partes.`;
}

// ---------------------------------------------------------------------------
// Entrada da rota: os filtros da tela
// ---------------------------------------------------------------------------

// Vazio e "sem filtro", como na URL da tela.
const vazioViraAusente = (valor: unknown) => (valor === "" ? undefined : valor);

// Chave da jornada e canal: o formato do CHECK de funnel_stage_def.chave
// (^[a-z0-9_]{1,40}$), que tambem cobre os 8 canais. Canal que nao existe
// passa e da zero lead, como na tela.
const chaveSchema = z.preprocess(
  vazioViraAusente,
  z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .optional(),
);
const diaSchema = z.preprocess(
  vazioViraAusente,
  z.string().refine(ehDiaCivilValido).optional(),
);

/**
 * O corpo do pedido de exportacao: os valores da barra de filtros, como na
 * URL da tela (vazio ou ausente = sem filtro). Campo a mais recusa.
 */
export const filtrosDaExportacaoSchema = z.strictObject({
  etapa: chaveSchema,
  origem: chaveSchema,
  resp: z.preprocess(vazioViraAusente, z.guid().optional()),
  de: diaSchema,
  ate: diaSchema,
});

export type FiltrosDaExportacao = z.infer<typeof filtrosDaExportacaoSchema>;

/** Os valores validados de volta ao formato da tela (ausente vira vazio). */
export function valoresDaExportacao(
  filtros: FiltrosDaExportacao,
): ValoresDosFiltrosDeLeads {
  return {
    etapa: filtros.etapa ?? "",
    origem: filtros.origem ?? "",
    resp: filtros.resp ?? "",
    de: filtros.de ?? "",
    ate: filtros.ate ?? "",
  };
}

/**
 * O que o navegador manda: so os filtros preenchidos. Dia que nao existe no
 * calendario fica de fora, porque a tela tambem o ignora
 * (filtrosDeLeadsDosValores): o arquivo sai com o que a tela mostra.
 */
export function corpoDoPedidoDeExportacao(
  valores: ValoresDosFiltrosDeLeads,
): Partial<ValoresDosFiltrosDeLeads> {
  const corpo: Partial<ValoresDosFiltrosDeLeads> = {};
  if (valores.etapa) {
    corpo.etapa = valores.etapa;
  }
  if (valores.origem) {
    corpo.origem = valores.origem;
  }
  if (valores.resp) {
    corpo.resp = valores.resp;
  }
  if (ehDiaCivilValido(valores.de)) {
    corpo.de = valores.de;
  }
  if (ehDiaCivilValido(valores.ate)) {
    corpo.ate = valores.ate;
  }
  return corpo;
}

// ---------------------------------------------------------------------------
// Trilha (LGPD): quantos e com quais filtros, nunca dado de paciente
// ---------------------------------------------------------------------------

/** O resumo dos filtros que vai para a trilha: so chaves, ids e datas. */
export type ResumoDosFiltrosDaExportacao = {
  etapa?: string;
  origem?: string;
  /** Id do membro da equipe (nunca de paciente). */
  responsavel?: string;
  de?: string;
  ate?: string;
};

export type DetalhesDaTrilhaDaExportacao = {
  quantidade: number;
  filtros: ResumoDosFiltrosDaExportacao;
};

/**
 * O que a linha de audit_log da exportacao guarda alem de quem, quando e
 * "leads": a quantidade e os filtros. Montado SO a partir dos filtros
 * validados e de um numero, nunca de um lead: nome, telefone ou qualquer
 * campo de paciente nao tem como entrar.
 */
export function detalhesDaTrilhaDaExportacao(
  quantidade: number,
  filtros: FiltrosDaExportacao,
): DetalhesDaTrilhaDaExportacao {
  const resumo: ResumoDosFiltrosDaExportacao = {};
  if (filtros.etapa) {
    resumo.etapa = filtros.etapa;
  }
  if (filtros.origem) {
    resumo.origem = filtros.origem;
  }
  if (filtros.resp) {
    resumo.responsavel = filtros.resp;
  }
  if (filtros.de) {
    resumo.de = filtros.de;
  }
  if (filtros.ate) {
    resumo.ate = filtros.ate;
  }
  return { quantidade, filtros: resumo };
}

// ---------------------------------------------------------------------------
// O arquivo
// ---------------------------------------------------------------------------

/** O lead como a exportacao precisa: os campos da lista e o que ela nao le. */
export type LeadParaExportar = {
  name: string | null;
  phone_e164: string;
  /** contact.kind: 'lead' ou 'paciente' (check do banco). */
  kind: string;
  funnel_stage: string;
  lost_reason: string | null;
  lost_reason_note: string | null;
  tags: readonly string[];
  source_channel: string | null;
  source_campaign: string | null;
  source_origin: string | null;
  source_medium: string | null;
  source_method: string | null;
  source_ad_id: string | null;
  source_google_campaign_id: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
  consentimento: SituacaoDoConsentimento;
  /**
   * A leitura de meta_anuncio JA FEITA: a exportacao falha inteira quando a
   * leitura falha, entao "carregando" e "erro" nao existem aqui (o arquivo
   * nunca diz "Não foi possível carregar a campanha").
   */
  anuncio_meta: { estado: "lida"; anuncio: AnuncioDaMeta | null };
  /** Titulo guardado do anuncio (anuncio_do_whatsapp); null sem titulo. */
  titulo_do_anuncio: string | null;
};

/** As colunas do arquivo, nesta ordem (rotulos da tela). */
export const COLUNAS_DA_EXPORTACAO_DE_LEADS = [
  "Nome",
  "Telefone",
  "Tipo",
  "Etapa da jornada",
  "Canal",
  "Origem",
  "Plataforma",
  "Como chegou",
  "Campanha",
  "Conjunto",
  "Anúncio",
  "Primeiro contato",
  "Último contato",
  "Etiquetas",
  "Autorização para receber mensagens",
  "Motivo da perda",
] as const;

/** O que a linha precisa saber da clinica. */
export type ContextoDaPlanilha = {
  /** Chave da etapa -> nome na jornada da clinica. */
  etapas: ReadonlyMap<string, string>;
  /** Fuso IANA da clinica (regra 3.6). */
  timezone: string;
};

function textoLimpo(valor: string | null | undefined): string {
  return valor?.trim() ?? "";
}

/** Data e hora no fuso da clinica, dd/mm/aaaa hh:mm (regra 3.6). */
export function dataHoraNoFuso(iso: string, timezone: string): string {
  return format(
    new TZDate(new Date(iso).getTime(), timezone),
    "dd/MM/yyyy HH:mm",
  );
}

export const TEXTOS_DA_AUTORIZACAO: Readonly<
  Record<SituacaoDoConsentimento, string>
> = {
  autorizado: "Sim",
  sem_autorizacao: "Não",
  revogado: "Revogada",
};

/** "Preço"; com a descricao que a equipe escreveu, "Outro: mudou de cidade". */
export function textoDoMotivoDaPerda(
  codigo: string | null,
  nota: string | null,
): string {
  const motivo = textoLimpo(codigo);
  if (!motivo) {
    return "";
  }
  const rotulo =
    LOST_REASONS.find((opcao) => opcao.codigo === motivo)?.rotulo ?? motivo;
  const descricao = textoLimpo(nota);
  return descricao ? `${rotulo}: ${descricao}` : rotulo;
}

/**
 * A coluna Campanha, igual a da lista: a do link ou do Google vence; senao a
 * da Meta pelo anuncio; quem nao veio de anuncio e nao tem campanha fica
 * vazio.
 */
export function textoDaCampanha(lead: LeadParaExportar): string {
  const campanha = campanhaDoContato(lead, lead.anuncio_meta);
  return campanha.tipo === "nenhuma" && !ehLeadDeAnuncio(lead)
    ? ""
    : campanha.texto;
}

/** A coluna Conjunto: so o lead de anuncio da Meta tem. */
export function textoDoConjunto(lead: LeadParaExportar): string {
  return conjuntoDoContato(lead, lead.anuncio_meta)?.texto ?? "";
}

/**
 * A coluna Anuncio: o titulo guardado; senao o nome do anuncio na Meta;
 * senao "Anúncio sem título (id 120240624148610289)", com o codigo inteiro
 * (a mesma regra de Resultados, e o codigo dentro do texto nao vira numero
 * na planilha). Lead de anuncio sem codigo: "Anúncio não identificado".
 * Quem nao veio de anuncio fica vazio.
 */
export function textoDoAnuncio(lead: LeadParaExportar): string {
  if (!ehLeadDeAnuncio(lead)) {
    return "";
  }
  const adId = idDoAnuncioDoWhatsapp(lead.source_ad_id);
  if (!adId) {
    return ROTULO_ANUNCIO_NAO_IDENTIFICADO;
  }
  return rotuloDoAnuncio({
    adId,
    titulo: lead.titulo_do_anuncio,
    nomeNaMeta: lead.anuncio_meta.anuncio?.ad_name ?? null,
  });
}

/**
 * O telefone como a tela mostra. O que nao tem o formato brasileiro (numero
 * de fora, DDD que nao existe) a tela mostra cru ("+14155550101"), e o
 * Excel leria isso como numero: tira o "+" e, com 12 digitos ou mais, mostra
 * em notacao cientifica. Ganha o apostrofo da neutralizacao de formula, a
 * mesma regra do texto que comeca com "+": a planilha guarda como texto.
 */
export function telefoneDaPlanilha(e164: string): string {
  const telefone = formatarTelefone(e164);
  return /^\+\d+$/.test(telefone) ? `'${telefone}` : telefone;
}

/** Uma linha do arquivo, na ordem de COLUNAS_DA_EXPORTACAO_DE_LEADS. */
export function linhaDoLead(
  lead: LeadParaExportar,
  contexto: ContextoDaPlanilha,
): string[] {
  return [
    lead.name ?? "",
    telefoneDaPlanilha(lead.phone_e164),
    lead.kind === "paciente" ? "Paciente" : "Lead",
    // Etapa fora da jornada sai com a chave crua, como na lista.
    contexto.etapas.get(lead.funnel_stage) ?? lead.funnel_stage,
    rotuloDoCanal(lead.source_channel?.trim() || null) ?? "",
    textoLimpo(lead.source_origin),
    textoLimpo(lead.source_medium),
    rotuloDoMetodo(lead.source_method) ?? "",
    textoDaCampanha(lead),
    textoDoConjunto(lead),
    textoDoAnuncio(lead),
    dataHoraNoFuso(lead.first_contact_at, contexto.timezone),
    lead.last_contact_at
      ? dataHoraNoFuso(lead.last_contact_at, contexto.timezone)
      : "",
    lead.tags
      .map((etiqueta) => etiqueta.trim())
      .filter((etiqueta) => etiqueta.length > 0)
      .join(", "),
    TEXTOS_DA_AUTORIZACAO[lead.consentimento],
    textoDoMotivoDaPerda(lead.lost_reason, lead.lost_reason_note),
  ];
}

/** Cabecalho e uma linha por lead, prontos para o gerarCsv. */
export function linhasDaExportacaoDeLeads(
  leads: readonly LeadParaExportar[],
  contexto: ContextoDaPlanilha,
): string[][] {
  return [
    [...COLUNAS_DA_EXPORTACAO_DE_LEADS],
    ...leads.map((lead) => linhaDoLead(lead, contexto)),
  ];
}

/** leads-AAAA-MM-DD.csv, com o dia civil da clinica (regra 3.6). */
export function nomeDoArquivoDaExportacao(
  agora: Date,
  timezone: string,
): string {
  return `leads-${diaCivil(timezone, agora)}.csv`;
}
