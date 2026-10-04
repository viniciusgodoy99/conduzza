import { rotuloDoCanal } from "@/components/leads/rotulos";
import type { ContactRecency } from "@/lib/design/status";

// Regras PURAS da Tela 4 (Leads): recencia de contato, consentimento vigente,
// ordenacao por "quem espera ha mais tempo" e agrupamento do Kanban. Zero
// I/O: quem busca dados e lib/queries/leads.ts; aqui vive so a decisao,
// testavel direto.

const HORA_MS = 60 * 60 * 1000;

/** Limiar do badge verde: contato ha ate 4 horas esta em dia. */
export const RECENCIA_EM_DIA_MS = 4 * HORA_MS;

/** Limiar do badge ambar: de 4 a 24 horas esta esfriando; acima, frio. */
export const RECENCIA_ESFRIANDO_MS = 24 * HORA_MS;

/**
 * Recencia do ultimo contato para o badge do cartao de lead. Fronteiras
 * inclusivas: exatamente 4h ainda esta em dia, exatamente 24h ainda esta
 * esfriando. Sem contato nenhum devolve null e o badge nem aparece (o cartao
 * ja comunica isso pela posicao: nunca contatado vem primeiro).
 */
export function recencyDe(
  lastContactAt: string | null,
  agora: Date,
): ContactRecency | null {
  if (lastContactAt === null) {
    return null;
  }
  const decorrido = agora.getTime() - new Date(lastContactAt).getTime();
  if (decorrido <= RECENCIA_EM_DIA_MS) {
    return "em_dia";
  }
  if (decorrido <= RECENCIA_ESFRIANDO_MS) {
    return "esfriando";
  }
  return "frio";
}

export type LinhaConsent = {
  channel: string;
  granted_at: string;
  revoked_at: string | null;
};

/**
 * Consentimento vigente de WhatsApp a partir das linhas de contact_consent:
 * filtra o canal, ordena por granted_at desc e olha SO a linha mais recente,
 * a mesma regra da RPC consentimento_vigente. Filtrar por "ativa" ANTES de
 * ordenar seria o bug do fetchConsent antigo: uma linha antiga ativa
 * mascararia a revogacao mais recente, e disparo sem autorizacao e
 * exatamente o que a regra 3.3 proibe.
 */
export function consentimentoVigenteDeLinhas(
  linhas: readonly LinhaConsent[],
): boolean {
  const doCanal = linhas
    .filter((linha) => linha.channel === "whatsapp")
    .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
  const maisRecente = doCanal[0];
  if (!maisRecente) {
    return false;
  }
  return maisRecente.revoked_at === null;
}

/**
 * Ordem de "proxima acao": o lead mais esquecido primeiro. Nunca contatado
 * (null) vem antes de todos; depois, last_contact_at ascendente (contato
 * mais antigo primeiro).
 */
export function compararPorProximaAcao(
  a: { last_contact_at: string | null },
  b: { last_contact_at: string | null },
): number {
  if (a.last_contact_at === null && b.last_contact_at === null) {
    return 0;
  }
  if (a.last_contact_at === null) {
    return -1;
  }
  if (b.last_contact_at === null) {
    return 1;
  }
  return a.last_contact_at.localeCompare(b.last_contact_at);
}

// Motivos de perda do check do banco, com o rotulo de interface. "Outro"
// exige nota (regra da action e do check contact_perdido_exige_motivo).
export const LOST_REASONS: readonly { codigo: string; rotulo: string }[] = [
  { codigo: "preco", rotulo: "Preço" },
  { codigo: "distancia", rotulo: "Distância" },
  { codigo: "horario", rotulo: "Horário" },
  { codigo: "nao_respondeu", rotulo: "Não respondeu" },
  { codigo: "agendou_em_outro_lugar", rotulo: "Agendou em outro lugar" },
  { codigo: "outro", rotulo: "Outro" },
];

/** O minimo que um lead precisa ter para os filtros e o Kanban puros. */
export type LeadFiltravel = {
  funnel_stage: string;
  source_channel: string | null;
  owner_user_id: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
};

export type FiltrosDeLeads = {
  etapa?: string;
  origem?: string;
  responsavel?: string;
  /** Inicio do periodo (instante ISO), inclusivo, sobre first_contact_at. */
  deISO?: string;
  /** Fim do periodo (instante ISO), inclusivo, sobre first_contact_at. */
  ateISO?: string;
};

/**
 * Filtros da barra da Tela 4, aplicados no cliente (mesma decisao da Agenda:
 * troca de filtro instantanea, sem refetch). O periodo e sobre
 * first_contact_at; quem converte o dia civil da clinica em instantes e o
 * chamador, respeitando a regra 3.6 de fuso.
 */
export function filtrarLeads<T extends LeadFiltravel>(
  leads: readonly T[],
  filtros: FiltrosDeLeads,
): T[] {
  const de = filtros.deISO ? new Date(filtros.deISO).getTime() : null;
  const ate = filtros.ateISO ? new Date(filtros.ateISO).getTime() : null;
  return leads.filter((lead) => {
    if (filtros.etapa && lead.funnel_stage !== filtros.etapa) {
      return false;
    }
    if (filtros.origem && lead.source_channel !== filtros.origem) {
      return false;
    }
    if (filtros.responsavel && lead.owner_user_id !== filtros.responsavel) {
      return false;
    }
    const primeiroContato = new Date(lead.first_contact_at).getTime();
    if (de !== null && primeiroContato < de) {
      return false;
    }
    if (ate !== null && primeiroContato > ate) {
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Origem do contato nas telas (frente E da "origem real do anuncio", 04/10/2026)
// ---------------------------------------------------------------------------
// Fonte unica do texto de origem, campanha, conjunto e metodo para a lista e
// o drawer de Leads, a ficha do paciente e o painel do Atendimento. Regras do
// contrato (decisao D3 do dono):
// - o lead de anuncio da Meta tem source_method 'anuncio_ctwa', canal
//   trafego_pago, origem 'Meta' e meio = plataforma ('Facebook', 'Instagram'
//   ou nulo quando o canal nao informa). source_campaign fica SEMPRE nulo nele
//   (check contact_origem_de_anuncio_coerente);
// - campanha e conjunto vem de meta_anuncio pelo source_ad_id (todo membro
//   ativo le, pela RLS), nunca de source_campaign;
// - Campanha = source_campaign (ou o nome amigavel do link), senao o nome da
//   Meta pelo anuncio, senao "Campanha da Meta ainda nao identificada" para o
//   lead de anuncio. Sem nome na Meta: "Campanha {id}", a mesma regra de
//   Resultados (rotuloDaLinhaDeCampanha).

/** Metodos do check contact_source_method_valido, em linguagem de recepcao. */
export const METODO_LABELS: Readonly<Record<string, string>> = {
  anuncio_ctwa: "Anúncio de clique para WhatsApp",
  link_token: "Link com código",
  mensagem_padrao: "Mensagem padrão do anúncio",
  palavra_chave: "Palavra-chave na primeira mensagem",
  manual: "Cadastro manual",
  importacao: "Importação de planilha",
};

/** O metodo de quem chegou por anuncio Click-to-WhatsApp da Meta. */
export const METODO_ANUNCIO_CTWA = "anuncio_ctwa";

/**
 * Rotulo do metodo de captura; nulo some. Metodo desconhecido volta como
 * veio, a mesma regra de rotuloDoCanal (o check do banco impede o caso).
 */
export function rotuloDoMetodo(
  metodo: string | null | undefined,
): string | null {
  const limpo = textoLimpo(metodo);
  if (!limpo) {
    return null;
  }
  return METODO_LABELS[limpo] ?? limpo;
}

/** Os campos de origem do contato que as telas leem. */
export type OrigemDoContato = {
  source_channel: string | null;
  source_campaign: string | null;
  /** Opcionais: o painel do Atendimento monta contato sem eles nos testes. */
  source_origin?: string | null;
  source_medium?: string | null;
  source_method?: string | null;
  source_ad_id?: string | null;
};

function textoLimpo(valor: string | null | undefined): string | null {
  const limpo = valor?.trim();
  return limpo ? limpo : null;
}

function mesmoTexto(a: string, b: string): boolean {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" }) === 0;
}

/**
 * Canal, origem e plataforma numa frase: "Tráfego pago, Meta (Instagram)".
 * Sem plataforma: "Tráfego pago, Meta". Origem igual ao canal nao repete.
 * Nada preenchido: null (a tela diz "Não informado").
 */
export function textoDaOrigem(
  contato: Pick<
    OrigemDoContato,
    "source_channel" | "source_origin" | "source_medium"
  >,
): string | null {
  const canal = rotuloDoCanal(textoLimpo(contato.source_channel));
  const origem = textoLimpo(contato.source_origin);
  const meio = textoLimpo(contato.source_medium);
  const partes: string[] = [];
  if (canal) {
    partes.push(canal);
  }
  if (origem && !(canal && mesmoTexto(canal, origem))) {
    partes.push(origem);
  }
  if (partes.length === 0) {
    return meio;
  }
  const base = partes.join(", ");
  return meio ? `${base} (${meio})` : base;
}

/**
 * Lead de anuncio para as telas: chegou por anuncio Click-to-WhatsApp
 * (metodo anuncio_ctwa) ou tem o id do anuncio gravado pela ingestao (um
 * contato de origem manual que depois clicou num anuncio tambem conta, como
 * em campanhas_do_periodo).
 */
export function ehLeadDeAnuncio(
  contato: Pick<OrigemDoContato, "source_method" | "source_ad_id">,
): boolean {
  return (
    contato.source_method === METODO_ANUNCIO_CTWA ||
    textoLimpo(contato.source_ad_id) !== null
  );
}

/** O id de anuncio que meta_anuncio aceita (check ^[0-9]{1,32}$). */
export function idDeAnuncioValido(
  adId: string | null | undefined,
): string | null {
  const limpo = textoLimpo(adId);
  return limpo && /^[0-9]{1,32}$/.test(limpo) ? limpo : null;
}

/** A linha de meta_anuncio do anuncio do contato, so o que a tela mostra. */
export type AnuncioDaMeta = {
  ad_id: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
};

/**
 * Como ficou a leitura de meta_anuncio para o contato. "lida" com anuncio
 * nulo = a Meta ainda nao identificou (ou o contato nem tem anuncio).
 */
export type LeituraDoAnuncio =
  | { estado: "carregando" }
  | { estado: "erro" }
  | { estado: "lida"; anuncio: AnuncioDaMeta | null };

export const LEITURA_SEM_ANUNCIO: LeituraDoAnuncio = {
  estado: "lida",
  anuncio: null,
};

/**
 * De duas leituras, a que mais sabe: uma lida vence erro e carregando (o
 * drawer junta a leitura da lista com a do detalhe, que e mais nova).
 */
export function melhorLeitura(
  preferida: LeituraDoAnuncio | null | undefined,
  reserva: LeituraDoAnuncio,
): LeituraDoAnuncio {
  if (!preferida) {
    return reserva;
  }
  if (preferida.estado === "lida" || reserva.estado !== "lida") {
    return preferida;
  }
  return reserva;
}

/**
 * Texto de uma linha de campanha ou conjunto. `tipo` diz como desenhar:
 * "nome" em texto normal; os outros em tom secundario, porque sao o que
 * falta, nao um nome.
 */
export type TextoDeAtribuicao = {
  texto: string;
  tipo: "nome" | "pendente" | "carregando" | "erro" | "nenhuma";
};

export const CAMPANHA_PENDENTE = "Campanha da Meta ainda não identificada";
export const CAMPANHA_SEM_ANUNCIO = "Campanha da Meta não informada";
export const CONJUNTO_PENDENTE = "Conjunto ainda não identificado";

/**
 * Campanha do contato. `nomeDoLink` e o nome amigavel de campaign_link
 * casado pelo texto (so o drawer le).
 */
export function campanhaDoContato(
  contato: OrigemDoContato,
  leitura: LeituraDoAnuncio,
  nomeDoLink?: string | null,
): TextoDeAtribuicao {
  const digitada = textoLimpo(contato.source_campaign);
  if (digitada) {
    return { texto: textoLimpo(nomeDoLink) ?? digitada, tipo: "nome" };
  }
  if (!ehLeadDeAnuncio(contato)) {
    return { texto: "Sem campanha", tipo: "nenhuma" };
  }
  if (!textoLimpo(contato.source_ad_id)) {
    // Clique sem id de anuncio: nunca vai ser identificada pela Meta.
    return { texto: CAMPANHA_SEM_ANUNCIO, tipo: "nenhuma" };
  }
  if (leitura.estado === "carregando") {
    return { texto: "Carregando a campanha", tipo: "carregando" };
  }
  if (leitura.estado === "erro") {
    return { texto: "Não foi possível carregar a campanha", tipo: "erro" };
  }
  if (!leitura.anuncio) {
    return { texto: CAMPANHA_PENDENTE, tipo: "pendente" };
  }
  return {
    texto:
      textoLimpo(leitura.anuncio.campaign_name) ??
      `Campanha ${leitura.anuncio.campaign_id}`,
    tipo: "nome",
  };
}

/**
 * Conjunto de anuncios do contato. null = a linha some (contato que nao veio
 * de anuncio nao tem conjunto). Sem nome na Meta: "Conjunto {id}".
 */
export function conjuntoDoContato(
  contato: OrigemDoContato,
  leitura: LeituraDoAnuncio,
): TextoDeAtribuicao | null {
  if (!ehLeadDeAnuncio(contato)) {
    return null;
  }
  if (!textoLimpo(contato.source_ad_id)) {
    return { texto: "Conjunto não informado", tipo: "nenhuma" };
  }
  if (leitura.estado === "carregando") {
    return { texto: "Carregando o conjunto", tipo: "carregando" };
  }
  if (leitura.estado === "erro") {
    return { texto: "Não foi possível carregar o conjunto", tipo: "erro" };
  }
  if (!leitura.anuncio) {
    return { texto: CONJUNTO_PENDENTE, tipo: "pendente" };
  }
  const nome = textoLimpo(leitura.anuncio.adset_name);
  if (nome) {
    return { texto: nome, tipo: "nome" };
  }
  const id = textoLimpo(leitura.anuncio.adset_id);
  if (id) {
    return { texto: `Conjunto ${id}`, tipo: "nome" };
  }
  return { texto: "Conjunto não informado pela Meta", tipo: "nenhuma" };
}
