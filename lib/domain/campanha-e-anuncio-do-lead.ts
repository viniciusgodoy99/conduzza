import {
  FORMATO_DO_ID_DO_ANUNCIO,
  idDoAnuncioDoWhatsapp,
  ROTULO_ANUNCIO_NAO_IDENTIFICADO,
  ROTULO_SEM_ANUNCIO,
  rotuloDoAnuncio,
  rotulosDosAnuncios,
  type AnuncioParaRotular,
} from "@/lib/domain/anuncio-do-whatsapp";
import type { ValoresDosFiltrosDeLeads } from "@/lib/domain/leads-ui";

// Canal, campanha e anuncio de um lead COMO RESULTADOS CONTA (pedido do dono
// em 20/10/2026, depois da reuniao com um cliente que conferia "Trafego pago
// 16" contra outra ferramenta): a lista de Leads filtra por campanha e por
// anuncio, e cada linha de Resultados abre a lista com os MESMOS leads. A
// paridade e o ponto: as regras daqui reproduzem, campo a campo, as funcoes
// SQL de Resultados. Mudou o SQL, muda aqui; o teste contra o banco
// (tests/rls/filtro-por-campanha-e-anuncio.test.ts) confere linha a linha.
//
// - Canal (funil_do_periodo, migration 20260918100000): source_channel;
//   nulo e "Sem atribuição" (sem_atribuicao na URL).
// - Campanha (campanhas_do_periodo, versao da migration 20261004100000):
//   meta_campaign_id = coalesce(an.campaign_id, cr.campaign_id). an e a
//   linha de meta_anuncio da clinica com ad_id IGUAL a source_ad_id, sem
//   aparar nada (um id com espaco nas pontas nao casa); cr sao as campanhas
//   de meta_anuncio da clinica, casadas por source_campaign_id. Com ela, a
//   chave e "meta:<campaign_id>"; sem ela, source_campaign sem os espacos
//   das pontas (so o U+0020: o btrim sem lista), "texto:<texto>"; sem os
//   dois, "Sem campanha" (sem). O lead do clique do Google cai em "Sem
//   campanha", como no SQL, mesmo com "Campanha do Google {id}" na coluna.
// - Anuncio (anuncios_do_periodo, migration 20261020100000): o id do
//   anuncio aparado pela regra do JavaScript e no formato ^[0-9]{1,32}$
//   (idDoAnuncioDoWhatsapp; o SQL faz o btrim com a lista do String.trim).
//   Sem ele: "Anúncio não identificado" (nao_identificado) para o lead de
//   anuncio (clique, id de anuncio, de conjunto ou de campanha, ou metodo
//   anuncio_ctwa; texto vazio conta, o SQL olha so "nao nulo") e "Sem
//   anúncio da Meta" (sem) para o resto.
//
// Regras PURAS, sem I/O e sem React: a lista (navegador), a exportacao
// (servidor) e o link de cada linha de Resultados usam as mesmas. O mapa da
// clinica (meta_anuncio e anuncio_do_whatsapp, lido pela sessao em
// lib/queries/leads.ts) entra pronto.

// ---------------------------------------------------------------------------
// Valores na URL da Tela 4 e rotulos
// ---------------------------------------------------------------------------

/** Metodo de captura do anuncio Click-to-WhatsApp da Meta (source_method). */
export const METODO_ANUNCIO_CTWA = "anuncio_ctwa";

/** Origem na URL para o canal nulo: "Sem atribuição". */
export const ORIGEM_SEM_ATRIBUICAO = "sem_atribuicao";
/** Campanha na URL: sem campanha da Meta e sem texto. */
export const CAMPANHA_SEM = "sem";
/** Anuncio na URL: lead de anuncio sem id de anuncio valido. */
export const ANUNCIO_NAO_IDENTIFICADO = "nao_identificado";
/** Anuncio na URL: o resto (nao veio de anuncio da Meta). */
export const ANUNCIO_SEM = "sem";

const PREFIXO_DA_META = "meta:";
const PREFIXO_DO_TEXTO = "texto:";

export const ROTULO_SEM_ATRIBUICAO = "Sem atribuição";
export const ROTULO_SEM_CAMPANHA = "Sem campanha";
export { ROTULO_ANUNCIO_NAO_IDENTIFICADO, ROTULO_SEM_ANUNCIO };
// Valor da URL fora do formato (link editado a mao): a opcao aparece, para o
// filtro ativo ficar visivel, e nao casa com lead nenhum.
export const ROTULO_CAMPANHA_NAO_RECONHECIDA = "Campanha não reconhecida";
export const ROTULO_ANUNCIO_NAO_RECONHECIDO = "Anúncio não reconhecido";

// ---------------------------------------------------------------------------
// O lead e o mapa da clinica
// ---------------------------------------------------------------------------

/**
 * Os campos do contato que Resultados le para separar campanha e anuncio.
 * Ausente vale nulo (o tipo aceita o lead montado a mao); toda leitura da
 * lista e da exportacao traz todos (LEAD_SELECT, em lib/queries/leads.ts).
 */
export type AtribuicaoDoLead = {
  source_campaign?: string | null;
  source_campaign_id?: string | null;
  source_ad_id?: string | null;
  source_adset_id?: string | null;
  source_method?: string | null;
  /**
   * contact.ctwa_clid nao nulo. So o fato: o identificador do clique nao
   * fica guardado na tela.
   */
  com_ctwa_clid?: boolean;
};

/** Uma linha de meta_anuncio da clinica, so o que as chaves e os rotulos usam. */
export type AnuncioDoMapa = {
  ad_id: string;
  campaign_id: string;
  campaign_name: string | null;
  ad_name: string | null;
  ultimo_dia_com_entrega: string | null;
  atualizado_em: string;
};

/** Uma linha de anuncio_do_whatsapp da clinica: o titulo guardado. */
export type TituloDoMapa = { ad_id: string; titulo: string | null };

/**
 * O mapa da clinica como sai do banco: TODAS as linhas de meta_anuncio e de
 * anuncio_do_whatsapp dela. Serializavel (vai do servidor ao navegador).
 */
export type MapaDeAtribuicaoLido = {
  anuncios: AnuncioDoMapa[];
  titulos: TituloDoMapa[];
};

/** O mapa indexado, pronto para as chaves e os rotulos. */
export type MapaDeAtribuicao = {
  /** meta_anuncio por ad_id EXATO (o "an" do SQL). */
  anuncios: ReadonlyMap<
    string,
    { campaignId: string; nomeNaMeta: string | null }
  >;
  /** As campanhas de meta_anuncio (o "cr" do SQL) e o nome mais recente. */
  campanhas: ReadonlyMap<string, string | null>;
  /** anuncio_do_whatsapp: o titulo guardado de cada anuncio. */
  titulos: ReadonlyMap<string, string | null>;
};

/** Instante timestamptz do PostgREST em microssegundos (o Date para no ms). */
function microssegundos(instante: string): number {
  const fracao = /\.(\d+)/.exec(instante)?.[1] ?? "";
  return (
    Date.parse(instante) * 1000 + Number(fracao.padEnd(6, "0").slice(3, 6))
  );
}

/**
 * Negativo quando `a` vem antes de `b` no distinct on de campanha_meta, que
 * escolhe a linha do nome da campanha: o dia com entrega mais recente (sem
 * dia por ultimo), a atualizacao mais recente e o menor ad_id. O nome e o
 * DESSA linha, mesmo nulo (o SQL nao procura outro).
 */
function compararNaOrdemDoNome(a: AnuncioDoMapa, b: AnuncioDoMapa): number {
  if (a.ultimo_dia_com_entrega !== b.ultimo_dia_com_entrega) {
    if (a.ultimo_dia_com_entrega === null) {
      return 1;
    }
    if (b.ultimo_dia_com_entrega === null) {
      return -1;
    }
    return a.ultimo_dia_com_entrega > b.ultimo_dia_com_entrega ? -1 : 1;
  }
  const atualizacao =
    microssegundos(b.atualizado_em) - microssegundos(a.atualizado_em);
  if (atualizacao !== 0) {
    return atualizacao;
  }
  // Id so de digitos: a ordem do texto e a mesma em qualquer collation.
  return a.ad_id < b.ad_id ? -1 : a.ad_id > b.ad_id ? 1 : 0;
}

/** As linhas lidas viram os indices que as chaves e os rotulos consultam. */
export function indexarMapaDeAtribuicao(
  lido: MapaDeAtribuicaoLido,
): MapaDeAtribuicao {
  const anuncios = new Map<
    string,
    { campaignId: string; nomeNaMeta: string | null }
  >();
  const linhaDoNome = new Map<string, AnuncioDoMapa>();
  for (const linha of lido.anuncios) {
    anuncios.set(linha.ad_id, {
      campaignId: linha.campaign_id,
      nomeNaMeta: linha.ad_name,
    });
    const escolhida = linhaDoNome.get(linha.campaign_id);
    if (!escolhida || compararNaOrdemDoNome(linha, escolhida) < 0) {
      linhaDoNome.set(linha.campaign_id, linha);
    }
  }
  const campanhas = new Map<string, string | null>();
  for (const [campanhaId, linha] of linhaDoNome) {
    campanhas.set(campanhaId, linha.campaign_name);
  }
  const titulos = new Map<string, string | null>();
  for (const linha of lido.titulos) {
    titulos.set(linha.ad_id, linha.titulo);
  }
  return { anuncios, campanhas, titulos };
}

// ---------------------------------------------------------------------------
// As chaves (as linhas de Resultados)
// ---------------------------------------------------------------------------

/**
 * O texto da campanha como campanhas_do_periodo agrupa:
 * nullif(btrim(source_campaign), ''). O btrim sem lista tira SO o espaco
 * U+0020 das pontas: tabulacao e NBSP ficam. Vazio vira null.
 */
export function textoDaCampanhaComoResultados(
  texto: string | null | undefined,
): string | null {
  if (texto === null || texto === undefined) {
    return null;
  }
  let inicio = 0;
  let fim = texto.length;
  while (inicio < fim && texto.charCodeAt(inicio) === 32) {
    inicio += 1;
  }
  while (fim > inicio && texto.charCodeAt(fim - 1) === 32) {
    fim -= 1;
  }
  return fim > inicio ? texto.slice(inicio, fim) : null;
}

/**
 * A campanha da Meta do lead: a do anuncio (source_ad_id IGUAL a um ad_id
 * da clinica em meta_anuncio), senao source_campaign_id quando e uma
 * campanha que a clinica conhece. null fora da Meta.
 */
export function campanhaDaMetaDoLead(
  lead: AtribuicaoDoLead,
  mapa: MapaDeAtribuicao,
): string | null {
  const adId = lead.source_ad_id ?? null;
  const doAnuncio = adId === null ? undefined : mapa.anuncios.get(adId);
  if (doAnuncio) {
    return doAnuncio.campaignId;
  }
  const campanhaId = lead.source_campaign_id ?? null;
  return campanhaId !== null && mapa.campanhas.has(campanhaId)
    ? campanhaId
    : null;
}

/**
 * A linha do lead na tabela Campanhas e no Detalhe por campanha: a mesma
 * chave que campanhas_do_periodo devolve ("meta:<id>" ou "texto:<texto>"),
 * ou "sem" para quem cai em "Sem campanha".
 */
export function chaveDaCampanhaDoLead(
  lead: AtribuicaoDoLead,
  mapa: MapaDeAtribuicao,
): string {
  const daMeta = campanhaDaMetaDoLead(lead, mapa);
  if (daMeta !== null) {
    return `${PREFIXO_DA_META}${daMeta}`;
  }
  const texto = textoDaCampanhaComoResultados(lead.source_campaign);
  return texto === null ? CAMPANHA_SEM : `${PREFIXO_DO_TEXTO}${texto}`;
}

/**
 * Lead de anuncio para anuncios_do_periodo: clique, id de anuncio, de
 * conjunto ou de campanha nao nulos (texto vazio conta), ou o metodo
 * anuncio_ctwa. Mais largo que o de campanhas_do_periodo (que nao olha o
 * conjunto nem o metodo) e que ehLeadDeAnuncio das telas.
 */
export function ehLeadDeAnuncioComoResultados(lead: AtribuicaoDoLead): boolean {
  return (
    lead.com_ctwa_clid === true ||
    (lead.source_ad_id ?? null) !== null ||
    (lead.source_adset_id ?? null) !== null ||
    (lead.source_campaign_id ?? null) !== null ||
    lead.source_method === METODO_ANUNCIO_CTWA
  );
}

/**
 * A linha do lead no Detalhe por anuncio: o id do anuncio (aparado como no
 * JavaScript e no formato), "nao_identificado" ou "sem".
 */
export function chaveDoAnuncioDoLead(lead: AtribuicaoDoLead): string {
  const adId = idDoAnuncioDoWhatsapp(lead.source_ad_id);
  if (adId !== null) {
    return adId;
  }
  return ehLeadDeAnuncioComoResultados(lead)
    ? ANUNCIO_NAO_IDENTIFICADO
    : ANUNCIO_SEM;
}

// ---------------------------------------------------------------------------
// Valores validos (URL e corpo da exportacao)
// ---------------------------------------------------------------------------

/** O id da campanha da Meta numa chave "meta:<id>"; null em qualquer outra. */
export function idDaCampanhaDaChave(chave: string): string | null {
  if (!chave.startsWith(PREFIXO_DA_META)) {
    return null;
  }
  const id = chave.slice(PREFIXO_DA_META.length);
  return FORMATO_DO_ID_DO_ANUNCIO.test(id) ? id : null;
}

/** O texto numa chave "texto:<texto>"; null em qualquer outra. */
function textoDaChave(chave: string): string | null {
  if (!chave.startsWith(PREFIXO_DO_TEXTO)) {
    return null;
  }
  const texto = chave.slice(PREFIXO_DO_TEXTO.length);
  return texto === "" ? null : texto;
}

/** "sem", "meta:<id da Meta>" ou "texto:<texto nao vazio>". */
export function ehChaveDeCampanha(valor: string): boolean {
  return (
    valor === CAMPANHA_SEM ||
    idDaCampanhaDaChave(valor) !== null ||
    textoDaChave(valor) !== null
  );
}

/** "nao_identificado", "sem" ou o id de um anuncio (^[0-9]{1,32}$). */
export function ehChaveDeAnuncio(valor: string): boolean {
  return (
    valor === ANUNCIO_NAO_IDENTIFICADO ||
    valor === ANUNCIO_SEM ||
    FORMATO_DO_ID_DO_ANUNCIO.test(valor)
  );
}

// ---------------------------------------------------------------------------
// Rotulos e opcoes dos filtros
// ---------------------------------------------------------------------------

/**
 * Rotulo de uma chave de campanha: o nome mais recente na Meta (senao
 * "Campanha {id}", a regra de rotuloDaLinhaDeCampanha), o texto, "Sem
 * campanha" ou, fora do formato, "Campanha não reconhecida".
 */
export function rotuloDaCampanhaDaChave(
  chave: string,
  mapa: MapaDeAtribuicao | null,
): string {
  if (chave === CAMPANHA_SEM) {
    return ROTULO_SEM_CAMPANHA;
  }
  const campanhaId = idDaCampanhaDaChave(chave);
  if (campanhaId !== null) {
    const nome = mapa?.campanhas.get(campanhaId) ?? null;
    return nome?.trim() ? nome : `Campanha ${campanhaId}`;
  }
  return textoDaChave(chave) ?? ROTULO_CAMPANHA_NAO_RECONHECIDA;
}

function anuncioParaRotular(
  adId: string,
  mapa: MapaDeAtribuicao | null,
): AnuncioParaRotular {
  return {
    adId,
    titulo: mapa?.titulos.get(adId) ?? null,
    nomeNaMeta: mapa?.anuncios.get(adId)?.nomeNaMeta ?? null,
  };
}

/**
 * Rotulo de uma chave de anuncio, o de Resultados (rotuloDoAnuncio: o
 * titulo, senao o nome na Meta, senao "Anúncio sem título (id ...)"), "Anúncio
 * não identificado", "Sem anúncio da Meta" ou "Anúncio não reconhecido".
 */
export function rotuloDoAnuncioDaChave(
  chave: string,
  mapa: MapaDeAtribuicao | null,
): string {
  if (chave === ANUNCIO_NAO_IDENTIFICADO) {
    return ROTULO_ANUNCIO_NAO_IDENTIFICADO;
  }
  if (chave === ANUNCIO_SEM) {
    return ROTULO_SEM_ANUNCIO;
  }
  if (!FORMATO_DO_ID_DO_ANUNCIO.test(chave)) {
    return ROTULO_ANUNCIO_NAO_RECONHECIDO;
  }
  return rotuloDoAnuncio(anuncioParaRotular(chave, mapa));
}

/** Uma opcao de filtro da barra (o SelectFiltro). */
export type OpcaoDoFiltro = { value: string; label: string };

type Entrada = {
  valor: string;
  rotulo: string;
  quantos: number;
  /** 0 = linha de verdade; os restos ("Sem ...") e o fora do formato no fim. */
  grupo: number;
};

function contarChaves<T>(
  leads: readonly T[],
  chaveDe: (lead: T) => string,
): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const lead of leads) {
    const chave = chaveDe(lead);
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  return contagem;
}

function emOrdem(entradas: Entrada[]): OpcaoDoFiltro[] {
  return [...entradas]
    .sort(
      (a, b) =>
        a.grupo - b.grupo ||
        b.quantos - a.quantos ||
        a.rotulo.localeCompare(b.rotulo, "pt-BR") ||
        (a.valor < b.valor ? -1 : a.valor > b.valor ? 1 : 0),
    )
    .map((entrada) => ({ value: entrada.valor, label: entrada.rotulo }));
}

/**
 * As opcoes do filtro Campanha: as chaves dos leads CARREGADOS (todos, nao
 * so os filtrados), mais leads primeiro e "Sem campanha" no fim. O valor da
 * URL que nenhum lead carregado tem (o lead esta fora dos carregados, ou o
 * link foi editado) entra mesmo assim, com o rotulo de reserva, para o
 * filtro ativo ficar visivel. Sem o mapa (carregando ou erro) so ele entra.
 * Duas campanhas com o mesmo rotulo (o mesmo nome em duas campanhas da
 * Meta, ou o texto igual ao nome da Meta): a da Meta ganha o id.
 */
export function opcoesDeCampanha(
  leads: readonly AtribuicaoDoLead[],
  mapa: MapaDeAtribuicao | null,
  valorAtual: string,
): OpcaoDoFiltro[] {
  const contagem = mapa
    ? contarChaves(leads, (lead) => chaveDaCampanhaDoLead(lead, mapa))
    : new Map<string, number>();
  if (valorAtual && !contagem.has(valorAtual)) {
    contagem.set(valorAtual, 0);
  }
  const entradas: Entrada[] = [...contagem].map(([valor, quantos]) => ({
    valor,
    quantos,
    rotulo: rotuloDaCampanhaDaChave(valor, mapa),
    grupo: valor === CAMPANHA_SEM ? 1 : ehChaveDeCampanha(valor) ? 0 : 2,
  }));
  const vezes = contarChaves(entradas, (entrada) =>
    entrada.rotulo.toLocaleLowerCase("pt-BR"),
  );
  for (const entrada of entradas) {
    const campanhaId = idDaCampanhaDaChave(entrada.valor);
    if (
      campanhaId !== null &&
      (vezes.get(entrada.rotulo.toLocaleLowerCase("pt-BR")) ?? 0) > 1
    ) {
      entrada.rotulo = `${entrada.rotulo} (id ${campanhaId})`;
    }
  }
  return emOrdem(entradas);
}

/**
 * As opcoes do filtro Anúncio: os anuncios dos leads CARREGADOS, mais leads
 * primeiro, com os rotulos de Resultados (rotulosDosAnuncios: o mesmo rotulo
 * em dois anuncios ganha o id inteiro), e depois "Anúncio não identificado"
 * e "Sem anúncio da Meta". O valor da URL fora dos carregados entra com o
 * rotulo de reserva. Sem o mapa, os rotulos ficam sem titulo e sem nome.
 */
export function opcoesDeAnuncio(
  leads: readonly AtribuicaoDoLead[],
  mapa: MapaDeAtribuicao | null,
  valorAtual: string,
): OpcaoDoFiltro[] {
  const contagem = contarChaves(leads, chaveDoAnuncioDoLead);
  if (valorAtual && !contagem.has(valorAtual)) {
    contagem.set(valorAtual, 0);
  }
  const ids = [...contagem.keys()].filter((valor) =>
    FORMATO_DO_ID_DO_ANUNCIO.test(valor),
  );
  const rotulos = rotulosDosAnuncios(
    ids.map((adId) => anuncioParaRotular(adId, mapa)),
  );
  const rotuloDoId = new Map(
    ids.map((adId, indice) => [adId, rotulos[indice] ?? adId]),
  );
  const entradas: Entrada[] = [...contagem].map(([valor, quantos]) => ({
    valor,
    quantos,
    rotulo: rotuloDoId.get(valor) ?? rotuloDoAnuncioDaChave(valor, mapa),
    grupo:
      valor === ANUNCIO_NAO_IDENTIFICADO
        ? 1
        : valor === ANUNCIO_SEM
          ? 2
          : ehChaveDeAnuncio(valor)
            ? 0
            : 3,
  }));
  return emOrdem(entradas);
}

// ---------------------------------------------------------------------------
// De Resultados para a lista de Leads
// ---------------------------------------------------------------------------

/**
 * O filtro da lista que mostra os leads de uma linha de Resultados. O campo
 * e o nome do parametro na URL da Tela 4 (a mesma chave dos valores da
 * barra de filtros).
 */
export type FiltroDaListaDeLeads = {
  campo: keyof Pick<ValoresDosFiltrosDeLeads, "origem" | "campanha" | "anuncio">;
  valor: string;
};

/** O periodo de Resultados, em dias civis da clinica (aaaa-mm-dd). */
export type PeriodoDaLista = { diaDe: string; diaAte: string };

/**
 * A lista de Leads (visao Lista) com o MESMO periodo de Resultados e o
 * filtro da linha: /leads?visao=lista&de=...&ate=...&campanha=meta%3A123.
 * O periodo da lista e o mesmo dia civil da clinica que Resultados usa
 * (filtrosDeLeadsDosValores e janelaDoPeriodo, as duas no fuso dela).
 */
export function hrefDaListaDeLeads(
  periodo: PeriodoDaLista,
  filtro: FiltroDaListaDeLeads,
): string {
  const parametros = new URLSearchParams();
  parametros.set("visao", "lista");
  parametros.set("de", periodo.diaDe);
  parametros.set("ate", periodo.diaAte);
  parametros.set(filtro.campo, filtro.valor);
  return `/leads?${parametros.toString()}`;
}

/**
 * O nome acessivel do link, que diz o destino e contem o rotulo que se ve:
 * "Ver os 16 leads de Tráfego pago na lista de Leads".
 */
export function nomeDoLinkDaLista(rotulo: string, leads: number): string {
  const quantos =
    leads === 1 ? "o lead" : `os ${leads.toLocaleString("pt-BR")} leads`;
  return `Ver ${quantos} de ${rotulo} na lista de Leads`;
}
