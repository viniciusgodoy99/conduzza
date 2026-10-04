import { diasEntre, somarDias } from "@/lib/domain/horarios";
import {
  classificarErroAds,
  criarContexto,
  ehObjeto,
  falhaGoogle,
  pedir,
  type Contexto,
  type FalhaGoogle,
  type OpcoesDeChamada,
} from "@/lib/integrations/google/erros";
import {
  GOOGLE_ADS_API_VERSION,
  GOOGLE_ADS_HOST,
} from "@/lib/integrations/google/versao";

// Google Ads API em REST, com fetch puro (nao existe biblioteca oficial para
// Node). Espelho de lib/integrations/meta/insights.ts (Fase 4).
//
// Regras da chamada:
// - Host fixo (googleads.googleapis.com) e versao de versao.ts. O customer id
//   so entra no caminho depois de virar 10 digitos; datas, gclid e ids so
//   entram na GAQL depois de validados (nada de texto livre na consulta).
// - Cabecalhos: Authorization: Bearer e, quando o acesso passa por uma conta
//   de administrador (MCC), login-customer-id com 10 digitos. NUNCA o
//   developer-token (acabou em 09/09/2026: "optional and ignored").
// - `search`, nao `searchStream`: o volume e pequeno e o erro chega na
//   resposta HTTP. Paginacao pelo nextPageToken, mandando a MESMA consulta
//   com pageToken no corpo (nunca na URL). Pagina fixa de 10.000 linhas; no
//   maximo MAX_PAGINAS. Token de pagina vencido ou invalido recomeca uma vez.
// - A consulta usa snake_case e a resposta vem em camelCase; int64 (ids,
//   cost_micros, level) chega como texto decimal. Campo com valor padrao
//   (0, false) pode vir omitido no JSON do proto3: ausente vale o padrao.
// - Datas no fuso da CONTA (customer.time_zone). Linha com metricas zeradas
//   nao volta; campanha removida volta (a API nao filtra removidas).
// - Timeout, prazo, retry e classificacao vivem em erros.ts. O resultado de
//   falha leva so o enum, o HTTP e o requestId. O de sucesso leva os dados
//   pedidos (inclusive o gclid na consulta de cliques): quem chama nao loga.

/** Paginas por consulta; acima disso a consulta e tratada como pesada. */
export const MAX_PAGINAS = 10;
/** Maior janela aceita para o gasto diario. */
export const DIAS_MAXIMOS_DA_JANELA = 92;
/** gclids numa consulta de click_view. */
export const MAX_GCLIDS_POR_CONSULTA = 100;

export type ConfigDoAds = OpcoesDeChamada & {
  /** Access token (da conta de servico ou renovado pelo refresh token). */
  accessToken: string;
  /**
   * Conta de administrador (MCC) pela qual o acesso passa, com ou sem hifen.
   * Vai no cabecalho login-customer-id; sem ela, o acesso pela MCC devolve
   * USER_PERMISSION_DENIED.
   */
  loginCustomerId?: string | null;
};

/** Dias AAAA-MM-DD no fuso da CONTA, inclusivos nas duas pontas. */
export type Periodo = { de: string; ate: string };

export type GastoDaCampanhaNoDia = {
  dia: string;
  campaignId: string;
  campaignName: string | null;
  /** Custo exato em micros (1.000.000 = 1 unidade da moeda), em texto. */
  custoMicros: string;
  /** Centesimos da moeda da conta, arredondado meio para cima. */
  custoCentavos: number;
};

export type SituacaoDaConta =
  "ENABLED" | "CANCELED" | "SUSPENDED" | "CLOSED" | "UNKNOWN";

export type DadosDaConta = {
  id: string;
  nome: string | null;
  /** ISO 4217, imutavel na conta. */
  moeda: string;
  /** Fuso IANA, imutavel na conta (as datas do relatorio seguem este fuso). */
  fuso: string;
  status: SituacaoDaConta;
  ativa: boolean;
  /** Conta de administrador (MCC): nao tem gasto proprio. */
  gerente: boolean;
  contaDeTeste: boolean;
};

export type ContaDaHierarquia = {
  id: string;
  nome: string | null;
  /** 0 e a propria conta consultada; 1 os filhos diretos. */
  nivel: number;
  gerente: boolean;
  status: SituacaoDaConta;
  moeda: string | null;
  fuso: string | null;
  contaDeTeste: boolean;
  oculta: boolean;
};

export type CliqueDoAnuncio = {
  gclid: string;
  dia: string;
  campaignId: string;
  campaignName: string | null;
  adGroupId: string | null;
};

export type SituacaoDoVinculo =
  | "ativo"
  | "pendente"
  | "recusado"
  | "cancelado"
  | "inativo"
  | "desconhecido"
  | "inexistente";

// ---------------------------------------------------------------------------
// Funcoes puras (exportadas para teste)
// ---------------------------------------------------------------------------

const CUSTOMER_ID = /^(\d{3})-?(\d{3})-?(\d{4})$/;

/** "123-456-7890" ou "1234567890" para "1234567890"; o resto vira null. */
export function normalizarCustomerId(valor: string): string | null {
  const casou = CUSTOMER_ID.exec(valor.trim());
  return casou ? `${casou[1]}${casou[2]}${casou[3]}` : null;
}

const INT64_MAX = BigInt("9223372036854775807");
const MEIO_CENTAVO_EM_MICROS = BigInt(5_000);
const MICROS_POR_CENTAVO = BigInt(10_000);

/**
 * Micros (int64 do Google: texto decimal, inteiro seguro ou bigint) em texto
 * canonico, sem float. Sinal, fracao, notacao cientifica e texto vazio
 * viram null.
 */
export function normalizarMicros(valor: unknown): string | null {
  let n: bigint | null = null;
  if (typeof valor === "string" && /^\d{1,19}$/.test(valor)) {
    n = BigInt(valor);
  } else if (
    typeof valor === "number" &&
    Number.isSafeInteger(valor) &&
    valor >= 0
  ) {
    n = BigInt(valor);
  } else if (typeof valor === "bigint" && valor >= BigInt(0)) {
    n = valor;
  }
  if (n === null || n > INT64_MAX) {
    return null;
  }
  return n.toString();
}

/**
 * Micros para centesimos, arredondando meio para cima (5.000 micros sobem):
 * "12345678" (12,345678) vira 1235. Conta em BigInt, nunca em float.
 */
export function microsParaCentavos(valor: unknown): number | null {
  const micros = normalizarMicros(valor);
  if (micros === null) {
    return null;
  }
  const centavos =
    (BigInt(micros) + MEIO_CENTAVO_EM_MICROS) / MICROS_POR_CENTAVO;
  return centavos <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(centavos) : null;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function diaValido(valor: unknown): valor is string {
  // Dia de calendario de verdade: 2026-02-30 nao passa.
  return (
    typeof valor === "string" &&
    DIA.test(valor) &&
    somarDias(valor, 0) === valor
  );
}

function periodoValido(periodo: Periodo): boolean {
  return (
    diaValido(periodo.de) &&
    diaValido(periodo.ate) &&
    periodo.de <= periodo.ate &&
    diasEntre(periodo.de, periodo.ate) + 1 <= DIAS_MAXIMOS_DA_JANELA
  );
}

// gclid: base64url. Validado antes de entrar na GAQL (sem aspas, sem espaco).
const GCLID = /^[A-Za-z0-9_-]{8,512}$/;

export function montarConsultaDoGasto(periodo: Periodo): string {
  return (
    "SELECT customer.currency_code, customer.time_zone, campaign.id, " +
    "campaign.name, segments.date, metrics.cost_micros FROM campaign " +
    `WHERE segments.date BETWEEN '${periodo.de}' AND '${periodo.ate}' ` +
    "AND metrics.cost_micros > 0"
  );
}

export const CONSULTA_DA_CONTA =
  "SELECT customer.id, customer.descriptive_name, customer.currency_code, " +
  "customer.time_zone, customer.status, customer.manager, " +
  "customer.test_account FROM customer";

export function montarConsultaDaHierarquia(nivelMaximo: number): string {
  return (
    "SELECT customer_client.client_customer, customer_client.id, " +
    "customer_client.descriptive_name, customer_client.level, " +
    "customer_client.manager, customer_client.status, " +
    "customer_client.currency_code, customer_client.time_zone, " +
    "customer_client.test_account, customer_client.hidden " +
    `FROM customer_client WHERE customer_client.level <= ${nivelMaximo}`
  );
}

export function montarConsultaDeCliques(
  dia: string,
  gclids: readonly string[],
): string {
  const filtro =
    gclids.length === 1
      ? `click_view.gclid = '${gclids[0]}'`
      : `click_view.gclid IN (${gclids.map((g) => `'${g}'`).join(", ")})`;
  return (
    "SELECT click_view.gclid, segments.date, campaign.id, campaign.name, " +
    `ad_group.id FROM click_view WHERE segments.date = '${dia}' AND ${filtro}`
  );
}

export function montarConsultaDoVinculo(clienteId: string): string {
  return (
    "SELECT customer_client_link.client_customer, " +
    "customer_client_link.manager_link_id, customer_client_link.status " +
    "FROM customer_client_link " +
    `WHERE customer_client_link.client_customer = 'customers/${clienteId}'`
  );
}

// ---------------------------------------------------------------------------
// Leitura de campos
// ---------------------------------------------------------------------------

function objeto(valor: unknown): Record<string, unknown> | null {
  return ehObjeto(valor) ? valor : null;
}

function idNumerico(valor: unknown): string | null {
  if (typeof valor === "string" && /^\d{1,20}$/.test(valor)) return valor;
  if (typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0) {
    return String(valor);
  }
  return null;
}

function textoOuNull(valor: unknown, maximo: number): string | null {
  return typeof valor === "string"
    ? valor.trim().slice(0, maximo) || null
    : null;
}

/** Booleano do proto3: ausente e false; outro tipo e resposta torta. */
function booleano(valor: unknown): boolean | null {
  if (valor === undefined) return false;
  return typeof valor === "boolean" ? valor : null;
}

function inteiroPequeno(valor: unknown): number | null {
  if (valor === undefined) return 0;
  if (typeof valor === "string" && /^\d{1,4}$/.test(valor))
    return Number(valor);
  if (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= 0 &&
    valor < 10_000
  ) {
    return valor;
  }
  return null;
}

function moedaValida(valor: unknown): string | null {
  return typeof valor === "string" && /^[A-Z]{3}$/.test(valor) ? valor : null;
}

function fusoValido(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length === 0 || valor.length > 64) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: valor });
    return valor;
  } catch {
    return null;
  }
}

const SITUACOES_DA_CONTA: ReadonlySet<string> = new Set([
  "ENABLED",
  "CANCELED",
  "SUSPENDED",
  "CLOSED",
]);

function situacaoDaConta(valor: unknown): SituacaoDaConta {
  return typeof valor === "string" && SITUACOES_DA_CONTA.has(valor)
    ? (valor as SituacaoDaConta)
    : "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Requisicao
// ---------------------------------------------------------------------------

type Acesso = {
  ctx: Contexto;
  token: string;
  loginCustomerId: string | null;
};

// Token: so ASCII visivel (vai num cabecalho HTTP).
const TOKEN_VALIDO = /^[\x21-\x7e]{20,4096}$/;
const PAGE_TOKEN_MAXIMO = 8_192;
const CONSULTA_MAXIMA = 20_000;

function criarAcesso(config: ConfigDoAds): Acesso | FalhaGoogle {
  if (!TOKEN_VALIDO.test(config.accessToken)) {
    return falhaGoogle("credencial_invalida");
  }
  let loginCustomerId: string | null = null;
  if (
    config.loginCustomerId !== undefined &&
    config.loginCustomerId !== null &&
    config.loginCustomerId !== ""
  ) {
    loginCustomerId = normalizarCustomerId(config.loginCustomerId);
    if (!loginCustomerId) {
      return falhaGoogle("entrada_invalida");
    }
  }
  return {
    ctx: criarContexto(config),
    token: config.accessToken,
    loginCustomerId,
  };
}

function cabecalhos(
  acesso: Acesso,
  opcoes: { json: boolean; comLogin: boolean },
): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${acesso.token}`,
    Accept: "application/json",
  };
  if (opcoes.json) {
    h["Content-Type"] = "application/json";
  }
  if (opcoes.comLogin && acesso.loginCustomerId) {
    h["login-customer-id"] = acesso.loginCustomerId;
  }
  return h;
}

function urlDoCliente(customerId: string, metodo: string): string {
  return `${GOOGLE_ADS_HOST}/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/${metodo}`;
}

type Paginas = { ok: true; paginas: Record<string, unknown>[][] };

/**
 * Todas as paginas de uma consulta. Token de pagina vencido ou invalido
 * (EXPIRED_PAGE_TOKEN, INVALID_PAGE_TOKEN) recomeca do zero uma vez.
 */
async function buscarPaginas(
  acesso: Acesso,
  customerId: string,
  query: string,
): Promise<Paginas | FalhaGoogle> {
  const paginas: Record<string, unknown>[][] = [];
  let pageToken: string | null = null;
  let recomecou = false;
  let pedidas = 0;
  for (;;) {
    if (pedidas >= MAX_PAGINAS) {
      return falhaGoogle("consulta_pesada");
    }
    pedidas += 1;
    const resposta = await pedir(
      acesso.ctx,
      {
        url: urlDoCliente(customerId, "googleAds:search"),
        method: "POST",
        headers: cabecalhos(acesso, { json: true, comLogin: true }),
        corpo: JSON.stringify(pageToken ? { query, pageToken } : { query }),
      },
      classificarErroAds,
    );
    if (!resposta.ok) {
      const tokenDePagina =
        resposta.codigoDoGoogle === "EXPIRED_PAGE_TOKEN" ||
        resposta.codigoDoGoogle === "INVALID_PAGE_TOKEN";
      if (tokenDePagina && pageToken !== null && !recomecou) {
        recomecou = true;
        pageToken = null;
        paginas.length = 0;
        pedidas = 0;
        continue;
      }
      return resposta;
    }
    const corpo = objeto(resposta.corpo);
    if (!corpo) {
      return falhaGoogle("resposta_invalida", {
        http: resposta.http,
        requestId: resposta.requestId,
      });
    }
    // Consulta sem linha pode vir sem `results`.
    const resultados = corpo.results ?? [];
    if (!Array.isArray(resultados) || !resultados.every(ehObjeto)) {
      return falhaGoogle("resposta_invalida", {
        http: resposta.http,
        requestId: resposta.requestId,
      });
    }
    paginas.push(resultados);
    const proximo = corpo.nextPageToken;
    if (proximo === undefined || proximo === null || proximo === "") {
      return { ok: true, paginas };
    }
    if (typeof proximo !== "string" || proximo.length > PAGE_TOKEN_MAXIMO) {
      return falhaGoogle("resposta_invalida", {
        http: resposta.http,
        requestId: resposta.requestId,
      });
    }
    pageToken = proximo;
  }
}

// ---------------------------------------------------------------------------
// Entradas publicas
// ---------------------------------------------------------------------------

/**
 * googleAds:search com todas as paginas. A consulta e de quem chama: so
 * texto fixo ou montado com valores ja validados.
 */
export async function buscar(
  config: ConfigDoAds,
  customerId: string,
  query: string,
): Promise<
  { ok: true; linhas: Record<string, unknown>[]; paginas: number } | FalhaGoogle
> {
  const cid = normalizarCustomerId(customerId);
  if (!cid || query.trim() === "" || query.length > CONSULTA_MAXIMA) {
    return falhaGoogle("entrada_invalida");
  }
  const acesso = criarAcesso(config);
  if ("ok" in acesso) return acesso;
  const lidas = await buscarPaginas(acesso, cid, query);
  if (!lidas.ok) return lidas;
  return {
    ok: true,
    linhas: lidas.paginas.flat(),
    paginas: lidas.paginas.length,
  };
}

/**
 * (Q1) Gasto diario por campanha no periodo (dias no fuso da conta), com a
 * moeda e o fuso da conta vindos na propria linha. Sem linha (nenhum gasto),
 * moeda e fuso voltam null: o fuso da janela vem antes, de lerDadosDaConta.
 * (dia, campanha) repetido na mesma pagina e resposta torta; entre paginas,
 * vale a ultima. Nunca soma.
 */
export async function lerGastoDiarioPorCampanha(
  config: ConfigDoAds,
  customerId: string,
  periodo: Periodo,
): Promise<
  | {
      ok: true;
      moeda: string | null;
      fuso: string | null;
      linhas: GastoDaCampanhaNoDia[];
      paginas: number;
    }
  | FalhaGoogle
> {
  const cid = normalizarCustomerId(customerId);
  if (!cid || !periodoValido(periodo)) {
    return falhaGoogle("entrada_invalida");
  }
  const acesso = criarAcesso(config);
  if ("ok" in acesso) return acesso;
  const lidas = await buscarPaginas(
    acesso,
    cid,
    montarConsultaDoGasto(periodo),
  );
  if (!lidas.ok) return lidas;

  let moeda: string | null = null;
  let fuso: string | null = null;
  const porChave = new Map<string, GastoDaCampanhaNoDia>();
  for (const pagina of lidas.paginas) {
    const daPagina = new Set<string>();
    for (const linha of pagina) {
      const conta = objeto(linha.customer);
      const campanha = objeto(linha.campaign);
      const segmentos = objeto(linha.segments);
      const metricas = objeto(linha.metrics);
      const moedaDaLinha = moedaValida(conta?.currencyCode);
      const fusoDaLinha = fusoValido(conta?.timeZone);
      const campaignId = idNumerico(campanha?.id);
      const dia = segmentos?.date;
      const custoMicros = normalizarMicros(metricas?.costMicros ?? "0");
      if (
        !moedaDaLinha ||
        !fusoDaLinha ||
        !campaignId ||
        !diaValido(dia) ||
        dia < periodo.de ||
        dia > periodo.ate ||
        custoMicros === null ||
        (moeda !== null && moeda !== moedaDaLinha) ||
        (fuso !== null && fuso !== fusoDaLinha)
      ) {
        return falhaGoogle("resposta_invalida");
      }
      moeda = moedaDaLinha;
      fuso = fusoDaLinha;
      const chave = `${dia}|${campaignId}`;
      const custoCentavos = microsParaCentavos(custoMicros);
      if (daPagina.has(chave) || custoCentavos === null) {
        return falhaGoogle("resposta_invalida");
      }
      daPagina.add(chave);
      porChave.set(chave, {
        dia,
        campaignId,
        campaignName: textoOuNull(campanha?.name, 400),
        custoMicros,
        custoCentavos,
      });
    }
  }
  const linhas = [...porChave.values()].sort(
    (a, b) =>
      a.dia.localeCompare(b.dia) || a.campaignId.localeCompare(b.campaignId),
  );
  return { ok: true, moeda, fuso, linhas, paginas: lidas.paginas.length };
}

/**
 * (Q2) Dados da conta: nome, moeda, fuso, situacao, se e administradora (MCC)
 * e se e conta de teste. O id devolvido tem de ser o pedido.
 */
export async function lerDadosDaConta(
  config: ConfigDoAds,
  customerId: string,
): Promise<{ ok: true; conta: DadosDaConta } | FalhaGoogle> {
  const cid = normalizarCustomerId(customerId);
  if (!cid) return falhaGoogle("entrada_invalida");
  const acesso = criarAcesso(config);
  if ("ok" in acesso) return acesso;
  const lidas = await buscarPaginas(acesso, cid, CONSULTA_DA_CONTA);
  if (!lidas.ok) return lidas;
  const linhas = lidas.paginas.flat();
  const conta = linhas.length === 1 ? objeto(linhas[0]?.customer) : null;
  const id = idNumerico(conta?.id);
  const moeda = moedaValida(conta?.currencyCode);
  const fuso = fusoValido(conta?.timeZone);
  const gerente = booleano(conta?.manager);
  const contaDeTeste = booleano(conta?.testAccount);
  if (
    !conta ||
    id !== cid ||
    !moeda ||
    !fuso ||
    gerente === null ||
    contaDeTeste === null
  ) {
    return falhaGoogle("resposta_invalida");
  }
  const status = situacaoDaConta(conta.status);
  return {
    ok: true,
    conta: {
      id,
      nome: textoOuNull(conta.descriptiveName, 200),
      moeda,
      fuso,
      status,
      ativa: status === "ENABLED",
      gerente,
      contaDeTeste,
    },
  };
}

/**
 * (Q3) customers:listAccessibleCustomers: as contas em que a credencial tem
 * acesso DIRETO. O Google ignora login-customer-id aqui, entao ele nem vai.
 */
export async function listarContasAcessiveis(
  config: ConfigDoAds,
): Promise<{ ok: true; contas: string[] } | FalhaGoogle> {
  const acesso = criarAcesso(config);
  if ("ok" in acesso) return acesso;
  const resposta = await pedir(
    acesso.ctx,
    {
      url: `${GOOGLE_ADS_HOST}/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
      method: "GET",
      headers: cabecalhos(acesso, { json: false, comLogin: false }),
    },
    classificarErroAds,
  );
  if (!resposta.ok) return resposta;
  const corpo = objeto(resposta.corpo);
  const nomes = corpo ? (corpo.resourceNames ?? []) : null;
  if (!Array.isArray(nomes)) {
    return falhaGoogle("resposta_invalida", {
      http: resposta.http,
      requestId: resposta.requestId,
    });
  }
  const contas: string[] = [];
  for (const nome of nomes) {
    const casou =
      typeof nome === "string" ? /^customers\/(\d{10})$/.exec(nome) : null;
    if (!casou?.[1]) {
      return falhaGoogle("resposta_invalida", {
        http: resposta.http,
        requestId: resposta.requestId,
      });
    }
    if (!contas.includes(casou[1])) contas.push(casou[1]);
  }
  return { ok: true, contas };
}

/**
 * (Q3) Hierarquia abaixo de uma conta de administrador (customer_client),
 * ate `nivelMaximo` (padrao 1: a propria e os filhos diretos).
 * ATENCAO (critica 0.2): no modo administrador, a lista de filhas da MCC da
 * Conduzza NUNCA vai para a tela da clinica; serve ao product_admin e ao
 * modo login (a hierarquia da propria agencia da clinica).
 */
export async function listarHierarquia(
  config: ConfigDoAds,
  gerenteId: string,
  opcoes: { nivelMaximo?: number } = {},
): Promise<{ ok: true; contas: ContaDaHierarquia[] } | FalhaGoogle> {
  const cid = normalizarCustomerId(gerenteId);
  const nivelMaximo = opcoes.nivelMaximo ?? 1;
  if (
    !cid ||
    !Number.isInteger(nivelMaximo) ||
    nivelMaximo < 0 ||
    nivelMaximo > 10
  ) {
    return falhaGoogle("entrada_invalida");
  }
  const acesso = criarAcesso(config);
  if ("ok" in acesso) return acesso;
  const lidas = await buscarPaginas(
    acesso,
    cid,
    montarConsultaDaHierarquia(nivelMaximo),
  );
  if (!lidas.ok) return lidas;
  const contas: ContaDaHierarquia[] = [];
  const vistos = new Set<string>();
  for (const linha of lidas.paginas.flat()) {
    const cliente = objeto(linha.customerClient);
    const idDoCampo = idNumerico(cliente?.id);
    const id = idDoCampo ? normalizarCustomerId(idDoCampo) : null;
    const nivel = inteiroPequeno(cliente?.level);
    const gerente = booleano(cliente?.manager);
    const contaDeTeste = booleano(cliente?.testAccount);
    const oculta = booleano(cliente?.hidden);
    if (
      !cliente ||
      !id ||
      nivel === null ||
      nivel > nivelMaximo ||
      gerente === null ||
      contaDeTeste === null ||
      oculta === null
    ) {
      return falhaGoogle("resposta_invalida");
    }
    if (vistos.has(id)) continue;
    vistos.add(id);
    contas.push({
      id,
      nome: textoOuNull(cliente.descriptiveName, 200),
      nivel,
      gerente,
      status: situacaoDaConta(cliente.status),
      moeda: moedaValida(cliente.currencyCode),
      fuso: fusoValido(cliente.timeZone),
      contaDeTeste,
      oculta,
    });
  }
  contas.sort((a, b) => a.nivel - b.nivel || a.id.localeCompare(b.id));
  return { ok: true, contas };
}

/**
 * (Q4) De qual campanha veio cada gclid, num dia (no fuso da conta). O
 * click_view exige filtro de UM dia e vai ate 90 dias para tras; nao tem
 * gbraid nem wbraid. Varios gclids vao num IN (SUPOSICAO a conferir no
 * primeiro teste real; com um so, vai `=`). gclid que nao voltou e clique
 * que o Google nao achou nesse dia.
 */
export async function lerCliquesPorGclid(
  config: ConfigDoAds,
  customerId: string,
  params: { dia: string; gclids: readonly string[] },
): Promise<{ ok: true; cliques: CliqueDoAnuncio[] } | FalhaGoogle> {
  const cid = normalizarCustomerId(customerId);
  const gclids = [...new Set(params.gclids)];
  if (
    !cid ||
    !diaValido(params.dia) ||
    gclids.length === 0 ||
    gclids.length > MAX_GCLIDS_POR_CONSULTA ||
    !gclids.every((g) => GCLID.test(g))
  ) {
    return falhaGoogle("entrada_invalida");
  }
  const acesso = criarAcesso(config);
  if ("ok" in acesso) return acesso;
  const lidas = await buscarPaginas(
    acesso,
    cid,
    montarConsultaDeCliques(params.dia, gclids),
  );
  if (!lidas.ok) return lidas;
  const pedidos = new Set(gclids);
  const porGclid = new Map<string, CliqueDoAnuncio>();
  for (const linha of lidas.paginas.flat()) {
    const clique = objeto(linha.clickView);
    const campanha = objeto(linha.campaign);
    const grupo = objeto(linha.adGroup);
    const segmentos = objeto(linha.segments);
    const gclid = clique?.gclid;
    const campaignId = idNumerico(campanha?.id);
    const dia = segmentos?.date ?? params.dia;
    const adGroupId = grupo?.id === undefined ? null : idNumerico(grupo.id);
    if (
      typeof gclid !== "string" ||
      !pedidos.has(gclid) ||
      !campaignId ||
      dia !== params.dia ||
      (grupo?.id !== undefined && adGroupId === null)
    ) {
      return falhaGoogle("resposta_invalida");
    }
    porGclid.set(gclid, {
      gclid,
      dia: params.dia,
      campaignId,
      campaignName: textoOuNull(campanha?.name, 400),
      adGroupId,
    });
  }
  return { ok: true, cliques: [...porGclid.values()] };
}

/**
 * Convite pela MCC: cria o CustomerClientLink como PENDING, a partir da conta
 * de administrador (o vinculo "must always be initiated from the manager
 * account"). A clinica aceita dentro do Google Ads dela. convite_ja_existe e
 * conta_ja_vinculada voltam como falha: quem chama decide (pela critica 0.2,
 * conta que ja estava na MCC so e ligada pelo product_admin).
 * O login-customer-id vai se a config trouxer; o caminho e o da MCC.
 *
 * UMA tentativa so (maxRetries 0, como a troca de code): o mutate nao e
 * idempotente. Se o Google gravou o PENDING e a resposta se perdeu (timeout,
 * rede, 5xx), repetir devolveria CLIENT_ALREADY_INVITED_BY_THIS_MANAGER, ou
 * seja, convite_ja_existe sem o managerLinkId de um convite que e nosso.
 *
 * Contrato de quem chama:
 * 1. Antes do primeiro convite: gravar para esta clinica a linha de
 *    google_ads_conta com esse customer_id (unico entre clinicas) e rodar
 *    conferirConvite SEM managerLinkId. "pendente" ou "ativo" ja ali e conta
 *    na MCC ou convite que nao e nosso: caminho do product_admin (0.2).
 * 2. Desfecho incerto (google_indisponivel, limite_do_google, prazo_esgotado,
 *    resposta_invalida, ou ok com managerLinkId null) NAO quer dizer que o
 *    convite falhou: em google_indisponivel ele pode ter sido gravado, e em
 *    resposta_invalida o Google respondeu 2xx. Antes de convidar de novo,
 *    conciliar com conferirConvite SEM managerLinkId. "pendente" ou "ativo"
 *    agora (e nao no passo 1) e o nosso convite: adota aquele managerLinkId e
 *    nao convida. Qualquer outra situacao: convida de novo.
 * 3. convite_ja_existe logo depois de um desfecho incerto NOSSO para a mesma
 *    conta pede a mesma conciliacao, e nao o caminho do product_admin.
 * Sem a reserva e a conferencia do passo 1, adotar um convite sem
 * managerLinkId poderia pegar um PENDING criado a mao para outra clinica.
 */
export async function convidarContaPelaMcc(
  config: ConfigDoAds,
  params: { gerenteId: string; clienteId: string },
): Promise<
  { ok: true; resourceName: string; managerLinkId: string | null } | FalhaGoogle
> {
  const gerenteId = normalizarCustomerId(params.gerenteId);
  const clienteId = normalizarCustomerId(params.clienteId);
  if (!gerenteId || !clienteId || gerenteId === clienteId) {
    return falhaGoogle("entrada_invalida");
  }
  const acesso = criarAcesso(config);
  if ("ok" in acesso) return acesso;
  const resposta = await pedir(
    acesso.ctx,
    {
      url: urlDoCliente(gerenteId, "customerClientLinks:mutate"),
      method: "POST",
      headers: cabecalhos(acesso, { json: true, comLogin: true }),
      corpo: JSON.stringify({
        operation: {
          create: {
            clientCustomer: `customers/${clienteId}`,
            status: "PENDING",
          },
        },
      }),
    },
    classificarErroAds,
    // Escrita nao idempotente: nunca repetir sozinho (ver o docstring).
    { maxRetries: 0 },
  );
  if (!resposta.ok) return resposta;
  const resultado = objeto(objeto(resposta.corpo)?.result);
  const nome = resultado?.resourceName;
  const prefixo = `customers/${gerenteId}/customerClientLinks/`;
  if (
    typeof nome !== "string" ||
    !nome.startsWith(prefixo) ||
    nome.length > 200
  ) {
    return falhaGoogle("resposta_invalida", {
      http: resposta.http,
      requestId: resposta.requestId,
    });
  }
  // Formato documentado: customers/{gerente}/customerClientLinks/{cliente}~{managerLinkId}
  const casou = new RegExp(`^${prefixo}${clienteId}~(\\d{1,20})$`).exec(nome);
  return { ok: true, resourceName: nome, managerLinkId: casou?.[1] ?? null };
}

function situacaoDoVinculo(valor: unknown): SituacaoDoVinculo {
  switch (valor) {
    case "ACTIVE":
      return "ativo";
    case "PENDING":
      return "pendente";
    case "REFUSED":
    case "DECLINED":
      return "recusado";
    case "CANCELED":
    case "CANCELLED":
      return "cancelado";
    case "INACTIVE":
      return "inativo";
    default:
      return "desconhecido";
  }
}

/**
 * Situacao do convite (customer_client_link) da MCC para a conta. Com
 * `managerLinkId` (o que convidarContaPelaMcc devolveu), confere SO aquele
 * convite: e assim que se prova que o vinculo nasceu do sistema. Sem ele, um
 * ACTIVE vence, depois um PENDING, depois o convite mais recente.
 */
export async function conferirConvite(
  config: ConfigDoAds,
  params: {
    gerenteId: string;
    clienteId: string;
    managerLinkId?: string | null;
  },
): Promise<
  | { ok: true; situacao: SituacaoDoVinculo; managerLinkId: string | null }
  | FalhaGoogle
> {
  const gerenteId = normalizarCustomerId(params.gerenteId);
  const clienteId = normalizarCustomerId(params.clienteId);
  const procurado = params.managerLinkId ?? null;
  if (
    !gerenteId ||
    !clienteId ||
    gerenteId === clienteId ||
    (procurado !== null && !/^\d{1,20}$/.test(procurado))
  ) {
    return falhaGoogle("entrada_invalida");
  }
  const acesso = criarAcesso(config);
  if ("ok" in acesso) return acesso;
  const lidas = await buscarPaginas(
    acesso,
    gerenteId,
    montarConsultaDoVinculo(clienteId),
  );
  if (!lidas.ok) return lidas;
  const vinculos: { id: string; situacao: SituacaoDoVinculo }[] = [];
  for (const linha of lidas.paginas.flat()) {
    const link = objeto(linha.customerClientLink);
    const id = idNumerico(link?.managerLinkId);
    if (!link || !id || link.clientCustomer !== `customers/${clienteId}`) {
      return falhaGoogle("resposta_invalida");
    }
    vinculos.push({ id, situacao: situacaoDoVinculo(link.status) });
  }
  if (procurado !== null) {
    const achado = vinculos.find((v) => v.id === procurado);
    return {
      ok: true,
      situacao: achado ? achado.situacao : "inexistente",
      managerLinkId: achado ? achado.id : null,
    };
  }
  const escolhido =
    vinculos.find((v) => v.situacao === "ativo") ??
    vinculos.find((v) => v.situacao === "pendente") ??
    [...vinculos].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))[0];
  return {
    ok: true,
    situacao: escolhido ? escolhido.situacao : "inexistente",
    managerLinkId: escolhido ? escolhido.id : null,
  };
}
