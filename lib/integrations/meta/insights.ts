import { diaCivil, diasEntre, somarDias } from "@/lib/domain/horarios";
import {
  normalizarContaDeAnuncios,
  PROBLEMAS_QUE_PAUSAM,
  type AdAccountId,
  type ProblemaDeLeitura,
} from "@/lib/domain/meta-anuncios";
import { GRAPH_VERSION } from "@/lib/integrations/meta/versao";

// Leitura do investimento na Marketing API da Meta (Insights), Fase 4.
//
// Mesmo molde do adaptador da CAPI (capi.ts) e do uazapi: timeout explicito
// com AbortController, retry LOCAL so para falha passageira, resultado
// tipado, fetch injetavel. Regras da chamada (critica da Fase 4, 4.3):
// - Token SEMPRE no cabecalho Authorization: Bearer, nunca na URL. A URL de
//   paging.next carrega o token quando ele vai na query, e URL acaba em log.
// - Paginacao pelo cursor `after`, montando a proxima requisicao aqui. O
//   paging.next NUNCA e seguido: e URL vinda de fora (SSRF) e serve so de
//   sinal de que ha mais pagina.
// - Ate 500 linhas por pagina e no maximo 40 paginas por consulta.
// - Consulta pesada divide o periodo ao meio, ate 2 niveis, como a propria
//   Meta orienta. Conta como pesada: o codigo de timeout da Meta, pagina
//   demais e a pagina do Insights que nao responde dentro do NOSSO timeout
//   (o timeout da Meta costuma passar dos nossos 15 s, entao o codigo dela
//   nem chega a tempo). No ultimo nivel, ou num periodo de 1 dia, esse
//   silencio volta a ser meta_indisponivel e o backoff do job repete.
// - Retry local (ate 2, backoff com jitter) so em meta_indisponivel, e
//   NUNCA no timeout de uma pagina do Insights: repetir a mesma consulta
//   pesada so gasta o prazo. Falha de rede rapida e 5xx continuam
//   repetindo; a leitura da conta e o teste tambem repetem o timeout.
//   limite_da_meta NUNCA repete aqui: "pare de fazer chamadas"; quem chama
//   reagenda.
// - O resultado nunca carrega a mensagem da Meta (pode vir em ingles e trazer
//   dado da conta), a URL nem o token: so os codigos numericos.
// - Prazo total explicito (prazoEm): nenhuma requisicao comeca sem tempo
//   para terminar, e nenhuma espera de retry estoura o prazo.
//
// Os dias vem no fuso da CONTA de anuncios ("We report ad insights data in
// the ad account's timezone"), entao a janela e calculada nesse fuso.

export type { AdAccountId, ProblemaDeLeitura };

const GRAPH_HOST = "https://graph.facebook.com";

/** Timeout de cada requisicao, quando quem chama nao passa outro. */
export const INSIGHTS_TIMEOUT_MS = 15_000;
/** Novas tentativas locais, so em meta_indisponivel. */
export const INSIGHTS_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_TETO_MS = 8_000;
/** Linhas por pagina pedidas a Meta. */
export const LIMITE_POR_PAGINA = 500;
/** Paginas por consulta; acima disso a consulta e tratada como pesada. */
export const MAX_PAGINAS = 40;
/** Quantas vezes a consulta pesada pode ser dividida ao meio. */
export const PROFUNDIDADE_DA_DIVISAO = 2;
/** Maior janela aceita (a regravar_gasto_meta recusa acima de 92 dias). */
export const DIAS_MAXIMOS_DA_JANELA = 92;
/** Espera sugerida no limite da Meta quando nenhum cabecalho diz quanto. */
export const ESPERA_DO_LIMITE_PADRAO_MS = 15 * 60_000;
/** Uso (do app ou da conta) a partir do qual a leitura desacelera. */
export const PCT_DESACELERAR = 75;
/** Uso a partir do qual a leitura para e devolve limite_da_meta. */
export const PCT_PARAR = 95;
const PAUSA_DE_DESACELERAR_MS = 2_000;
/** Requisicao com menos tempo que isto ate o prazo nem comeca. */
const TEMPO_MINIMO_DA_REQUISICAO_MS = 2_000;
/** "Invalid cursor": a paginacao recomeca do zero uma vez. */
const CODIGO_CURSOR_INVALIDO = 2642;

const CAMPOS_DA_CONTA = "id,name,currency,timezone_name,account_status";
const CAMPOS_POR_ANUNCIO = [
  "ad_id",
  "adset_id",
  "campaign_id",
  "campaign_name",
  "spend",
  "account_currency",
  "date_start",
  "date_stop",
].join(",");
const CAMPOS_DO_TOTAL_DA_CONTA = "spend,account_currency,date_start,date_stop";

export type ConfigDeLeitura = {
  adAccountId: AdAccountId;
  accessToken: string;
  /** Instante (ms, no relogio de `agora`) em que a leitura inteira acaba. */
  prazoEm: number;
  /** Timeout de cada requisicao (padrao 15 s), sempre limitado ao prazo. */
  timeoutMs?: number;
  /** Novas tentativas locais em meta_indisponivel (padrao 2). */
  maxRetries?: number;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
};

export type ContaDeAnuncios = {
  id: AdAccountId;
  nome: string | null;
  /** ISO 4217 da conta (o spend vem nessa moeda, sem conversao). */
  moeda: string;
  /** Fuso IANA da conta (os dias do Insights seguem este fuso). */
  fuso: string;
  /** account_status da Meta (1 ativa, 2 desativada, 3 sem pagamento...). */
  status: number;
  ativa: boolean;
};

/** Dias AAAA-MM-DD no fuso da CONTA, inclusivos nas duas pontas. */
export type Periodo = { de: string; ate: string };

export type GastoDoAnuncioNoDia = {
  dia: string;
  adId: string;
  adsetId: string | null;
  campaignId: string;
  campaignName: string | null;
  /** Centesimos da moeda da conta. */
  spendCents: number;
};

export type GastoDaContaNoDia = { dia: string; spendCents: number };

/**
 * O que quem chama faz com a falha:
 * - pausar: problema de configuracao; grava o problema (pausa o diario).
 * - reagendar: limite da Meta; volta depois de `tentarEmMs`, sem tentativa.
 * - repetir: passageiro; o backoff do job tenta de novo.
 * - desistir: repetir nao conserta, mas nao e configuracao da clinica.
 */
export type AcaoDaFalha = "pausar" | "reagendar" | "repetir" | "desistir";

export type FalhaDeLeitura = {
  ok: false;
  problema: ProblemaDeLeitura;
  acao: AcaoDaFalha;
  /** So em limite_da_meta: quanto esperar, pelos cabecalhos de uso. */
  tentarEmMs: number | null;
  /** error.code da Meta (null quando nem houve resposta dela). */
  codigoDaMeta: number | null;
  subcodigoDaMeta: number | null;
  http: number | null;
};

const ACAO_DO_PROBLEMA: Record<ProblemaDeLeitura, AcaoDaFalha> = {
  token_invalido: "pausar",
  sem_permissao: "pausar",
  conta_sem_acesso: "pausar",
  exige_prova_do_app: "pausar",
  parametro_recusado: "desistir",
  versao_descontinuada: "desistir",
  consulta_pesada: "repetir",
  limite_da_meta: "reagendar",
  meta_indisponivel: "repetir",
  resposta_invalida: "repetir",
  prazo_esgotado: "repetir",
  outro: "desistir",
};

/** A acao de cada problema; pausar vale exatamente para PROBLEMAS_QUE_PAUSAM. */
export function acaoDoProblema(problema: ProblemaDeLeitura): AcaoDaFalha {
  return PROBLEMAS_QUE_PAUSAM.has(problema)
    ? "pausar"
    : ACAO_DO_PROBLEMA[problema];
}

function falha(
  problema: ProblemaDeLeitura,
  extra: Partial<
    Pick<
      FalhaDeLeitura,
      "tentarEmMs" | "codigoDaMeta" | "subcodigoDaMeta" | "http"
    >
  > = {},
): FalhaDeLeitura {
  return {
    ok: false,
    problema,
    acao: acaoDoProblema(problema),
    tentarEmMs: extra.tentarEmMs ?? null,
    codigoDaMeta: extra.codigoDaMeta ?? null,
    subcodigoDaMeta: extra.subcodigoDaMeta ?? null,
    http: extra.http ?? null,
  };
}

/**
 * Falhas em que o NOSSO timer abortou a chamada sem resposta da Meta. Marca
 * interna (nao entra no objeto, no JSON nem no tipo): separa o silencio da
 * consulta pesada da falha de rede, que continua sendo repetida.
 */
const SEM_RESPOSTA_A_TEMPO = new WeakSet<FalhaDeLeitura>();

function semRespostaATempo(): FalhaDeLeitura {
  const f = falha("meta_indisponivel");
  SEM_RESPOSTA_A_TEMPO.add(f);
  return f;
}

function eObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function inteiro(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) ? valor : null;
}

function numeroFinito(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return valor;
  }
  if (typeof valor === "string" && /^\d+(\.\d+)?$/.test(valor)) {
    return Number(valor);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Funcoes puras (exportadas para teste)
// ---------------------------------------------------------------------------

const DECIMAL = /^(\d{1,13})(?:\.(\d+))?$/;

/**
 * "12.345" (string numerica da Meta) para centesimos, sem float: 1235.
 * Arredonda meio para cima pela terceira casa. Notacao cientifica, sinal,
 * texto vazio ou ponto sem casa decimal viram null.
 */
export function decimalParaCentavos(valor: string): number | null {
  const casou = DECIMAL.exec(valor);
  if (!casou) {
    return null;
  }
  const inteiroDoValor = Number(casou[1]);
  const fracao = casou[2] ?? "";
  const duasCasas = Number(`${fracao}00`.slice(0, 2));
  const terceira = fracao.length > 2 ? Number(fracao[2]) : 0;
  const centavos = inteiroDoValor * 100 + duasCasas + (terceira >= 5 ? 1 : 0);
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** Os `dias` dias que terminam hoje, com "hoje" no fuso da CONTA. */
export function janelaNoFusoDaConta(
  fuso: string,
  agoraMs: number,
  dias: number,
): Periodo {
  const ate = diaCivil(fuso, new Date(agoraMs));
  return { de: somarDias(ate, -(dias - 1)), ate };
}

/** Divide o periodo ao meio (a primeira metade fica com o dia a mais). */
export function dividirPeriodo(periodo: Periodo): [Periodo, Periodo] {
  const total = diasEntre(periodo.de, periodo.ate) + 1;
  if (total < 2) {
    throw new RangeError("periodo de um dia nao se divide");
  }
  const meio = somarDias(periodo.de, Math.ceil(total / 2) - 1);
  return [
    { de: periodo.de, ate: meio },
    { de: somarDias(meio, 1), ate: periodo.ate },
  ];
}

function lerJsonDoCabecalho(headers: Headers, nome: string): unknown {
  const valor = headers.get(nome);
  if (!valor) {
    return null;
  }
  try {
    return JSON.parse(valor) as unknown;
  } catch {
    return null;
  }
}

/**
 * Quanto esperar depois de um limite da Meta: o maior entre
 * estimated_time_to_regain_access (minutos, x-business-use-case-usage) e
 * reset_time_duration (segundos, x-ad-account-usage). Sem nenhum, 15 min.
 */
export function esperaDoLimite(headers: Headers): number {
  let maior = 0;
  const porCasoDeUso = lerJsonDoCabecalho(headers, "x-business-use-case-usage");
  if (eObjeto(porCasoDeUso)) {
    for (const lista of Object.values(porCasoDeUso)) {
      if (!Array.isArray(lista)) continue;
      for (const item of lista) {
        if (!eObjeto(item)) continue;
        const minutos = numeroFinito(item.estimated_time_to_regain_access);
        if (minutos !== null && minutos > 0) {
          maior = Math.max(maior, minutos * 60_000);
        }
      }
    }
  }
  const daConta = lerJsonDoCabecalho(headers, "x-ad-account-usage");
  if (eObjeto(daConta)) {
    const segundos = numeroFinito(daConta.reset_time_duration);
    if (segundos !== null && segundos > 0) {
      maior = Math.max(maior, segundos * 1_000);
    }
  }
  return maior > 0 ? Math.round(maior) : ESPERA_DO_LIMITE_PADRAO_MS;
}

/**
 * O maior percentual de uso que a Meta informou na resposta (app ou conta,
 * no Insights, na conta e por caso de uso). null quando nenhum veio.
 */
export function percentualDeUso(headers: Headers): number | null {
  const valores: number[] = [];
  const somar = (valor: unknown) => {
    const n = numeroFinito(valor);
    if (n !== null) valores.push(n);
  };
  const doInsights = lerJsonDoCabecalho(headers, "x-fb-ads-insights-throttle");
  if (eObjeto(doInsights)) {
    somar(doInsights.app_id_util_pct);
    somar(doInsights.acc_id_util_pct);
  }
  const daConta = lerJsonDoCabecalho(headers, "x-ad-account-usage");
  if (eObjeto(daConta)) {
    somar(daConta.acc_id_util_pct);
  }
  const porCasoDeUso = lerJsonDoCabecalho(headers, "x-business-use-case-usage");
  if (eObjeto(porCasoDeUso)) {
    for (const lista of Object.values(porCasoDeUso)) {
      if (!Array.isArray(lista)) continue;
      for (const item of lista) {
        if (!eObjeto(item)) continue;
        somar(item.call_count);
        somar(item.total_cputime);
        somar(item.total_time);
      }
    }
  }
  return valores.length > 0 ? Math.max(...valores) : null;
}

function problemaDoErro(
  http: number,
  codigo: number | null,
  subcodigo: number | null,
  passageiro: boolean,
  mensagem: string,
): ProblemaDeLeitura {
  if (codigo === 190 || codigo === 102) return "token_invalido";
  // App que exige appsecret_proof: a Meta so diz isso na mensagem (codigo
  // 100 generico). A mensagem e lida aqui para escolher o problema e
  // esquecida: nunca sai desta funcao.
  if (codigo === 100 && /appsecret_proof/i.test(mensagem)) {
    return "exige_prova_do_app";
  }
  if (
    codigo === 10 ||
    codigo === 294 ||
    (codigo !== null && codigo >= 200 && codigo <= 299) ||
    (codigo === 100 && subcodigo === 3191001)
  ) {
    return "sem_permissao";
  }
  if ((codigo === 100 && subcodigo === 33) || codigo === 803) {
    return "conta_sem_acesso";
  }
  if (codigo === 2635) return "versao_descontinuada";
  if (
    (codigo === 100 && (subcodigo === 1504018 || subcodigo === 1487534)) ||
    (codigo === 2 && subcodigo === 1504038)
  ) {
    return "consulta_pesada";
  }
  if (codigo === CODIGO_CURSOR_INVALIDO) return "resposta_invalida";
  if (
    codigo === 4 ||
    codigo === 17 ||
    codigo === 32 ||
    codigo === 341 ||
    codigo === 613 ||
    (codigo !== null && codigo >= 80000 && codigo <= 80014) ||
    http === 429
  ) {
    return "limite_da_meta";
  }
  // Codigo 2 nem sempre e passageiro (error-codes do Insights).
  if (codigo === 2 && (subcodigo === 1504041 || subcodigo === 1504042)) {
    return "parametro_recusado";
  }
  if (codigo === 1 || codigo === 2 || passageiro || http >= 500) {
    return "meta_indisponivel";
  }
  if (
    codigo === 100 ||
    codigo === 105 ||
    codigo === 2500 ||
    codigo === 3001 ||
    codigo === 3018
  ) {
    return "parametro_recusado";
  }
  if (http === 401) return "token_invalido";
  if (http === 403) return "sem_permissao";
  if (http === 404) return "conta_sem_acesso";
  return "outro";
}

/**
 * Classifica a resposta de erro da Graph. O resultado leva so o problema, a
 * acao e os codigos numericos; a mensagem da Meta nunca sai daqui.
 */
export function classificarErroMeta(
  http: number,
  corpo: unknown,
  headers: Headers,
): FalhaDeLeitura {
  const erro = eObjeto(corpo) && eObjeto(corpo.error) ? corpo.error : null;
  const codigo = inteiro(erro?.code);
  const subcodigo = inteiro(erro?.error_subcode);
  const passageiro = erro?.is_transient === true;
  const mensagem = typeof erro?.message === "string" ? erro.message : "";
  const problema = problemaDoErro(http, codigo, subcodigo, passageiro, mensagem);
  return falha(problema, {
    http,
    codigoDaMeta: codigo,
    subcodigoDaMeta: subcodigo,
    tentarEmMs: problema === "limite_da_meta" ? esperaDoLimite(headers) : null,
  });
}

/** Espera antes da nova tentativa n (0, 1...): metade fixa, metade sorteada. */
export function esperaDoBackoff(tentativa: number, aleatorio: () => number): number {
  const teto = Math.min(BACKOFF_TETO_MS, BACKOFF_BASE_MS * 2 ** tentativa);
  return Math.round(teto / 2 + aleatorio() * (teto / 2));
}

// ---------------------------------------------------------------------------
// Requisicao
// ---------------------------------------------------------------------------

type Contexto = {
  adAccountId: AdAccountId;
  token: string;
  prazoEm: number;
  timeoutMs: number;
  maxRetries: number;
  fetchFn: typeof fetch;
  agora: () => number;
  dormir: (ms: number) => Promise<void>;
  aleatorio: () => number;
  chamadas: number;
  ultimosCabecalhos: Headers | null;
};

type RespostaDaMeta = { ok: true; corpo: Record<string, unknown> };

const CONTA_VALIDA = /^act_\d{5,20}$/;
// Token: so caracteres visiveis de ASCII (vai num cabecalho HTTP).
const TOKEN_VALIDO = /^[\x21-\x7e]{20,500}$/;

function criarContexto(config: ConfigDeLeitura): Contexto | FalhaDeLeitura {
  // A conta entra no caminho da URL: so depois de bater com o formato. O
  // host e fixo, entao nao ha como apontar a chamada para outro lugar.
  if (!CONTA_VALIDA.test(config.adAccountId)) {
    return falha("conta_sem_acesso");
  }
  if (!TOKEN_VALIDO.test(config.accessToken)) {
    return falha("token_invalido");
  }
  return {
    adAccountId: config.adAccountId,
    token: config.accessToken,
    prazoEm: config.prazoEm,
    timeoutMs: config.timeoutMs ?? INSIGHTS_TIMEOUT_MS,
    maxRetries: config.maxRetries ?? INSIGHTS_MAX_RETRIES,
    fetchFn: config.fetchFn ?? fetch,
    agora: config.agora ?? Date.now,
    dormir:
      config.dormir ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    aleatorio: config.aleatorio ?? Math.random,
    chamadas: 0,
    ultimosCabecalhos: null,
  };
}

async function umaChamada(
  ctx: Contexto,
  url: URL,
  timeoutMs: number,
): Promise<RespostaDaMeta | FalhaDeLeitura> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let recebida: { status: number; headers: Headers; corpo: unknown } | null =
    null;
  try {
    const resposta = await ctx.fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    let corpo: unknown = undefined;
    let semJson = false;
    try {
      corpo = await resposta.json();
    } catch {
      semJson = true;
    }
    if (semJson && controller.signal.aborted) {
      // O tempo acabou no meio do corpo: e falta de resposta, nao resposta
      // torta.
      return semRespostaATempo();
    }
    recebida = {
      status: resposta.status,
      headers: resposta.headers,
      corpo: semJson ? undefined : corpo,
    };
  } catch {
    // A Meta nao respondeu: pelo nosso timer (abort) ou por falha de rede.
    return controller.signal.aborted
      ? semRespostaATempo()
      : falha("meta_indisponivel");
  } finally {
    clearTimeout(timer);
    ctx.chamadas += 1;
  }

  ctx.ultimosCabecalhos = recebida.headers;
  if (recebida.status >= 200 && recebida.status < 300) {
    if (!eObjeto(recebida.corpo)) {
      return falha("resposta_invalida", { http: recebida.status });
    }
    if (eObjeto(recebida.corpo.error)) {
      return classificarErroMeta(recebida.status, recebida.corpo, recebida.headers);
    }
    return { ok: true, corpo: recebida.corpo };
  }
  return classificarErroMeta(recebida.status, recebida.corpo, recebida.headers);
}

async function pedir(
  ctx: Contexto,
  caminho: string,
  params: Record<string, string>,
  opcoes: {
    /**
     * false: o timeout do nosso timer volta na hora, sem retry local (pagina
     * do Insights, que divide o periodo). Padrao true.
     */
    repetirSemResposta?: boolean;
  } = {},
): Promise<RespostaDaMeta | FalhaDeLeitura> {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${caminho}`);
  for (const [chave, valor] of Object.entries(params)) {
    url.searchParams.set(chave, valor);
  }

  // Ritmo (boas praticas da Meta): perto do teto do app ou da conta,
  // desacelera; no teto, para e deixa quem chama reagendar.
  if (ctx.chamadas > 0 && ctx.ultimosCabecalhos) {
    const uso = percentualDeUso(ctx.ultimosCabecalhos);
    if (uso !== null && uso >= PCT_PARAR) {
      return falha("limite_da_meta", {
        tentarEmMs: esperaDoLimite(ctx.ultimosCabecalhos),
      });
    }
    if (uso !== null && uso >= PCT_DESACELERAR) {
      if (
        ctx.agora() + PAUSA_DE_DESACELERAR_MS + TEMPO_MINIMO_DA_REQUISICAO_MS >
        ctx.prazoEm
      ) {
        return falha("prazo_esgotado");
      }
      await ctx.dormir(PAUSA_DE_DESACELERAR_MS);
    }
  }

  for (let tentativa = 0; ; tentativa += 1) {
    const restante = ctx.prazoEm - ctx.agora();
    if (restante < TEMPO_MINIMO_DA_REQUISICAO_MS) {
      return falha("prazo_esgotado");
    }
    const resultado = await umaChamada(
      ctx,
      url,
      Math.min(ctx.timeoutMs, restante),
    );
    if (resultado.ok) {
      return resultado;
    }
    if (
      resultado.problema !== "meta_indisponivel" ||
      tentativa >= ctx.maxRetries ||
      (opcoes.repetirSemResposta === false &&
        SEM_RESPOSTA_A_TEMPO.has(resultado))
    ) {
      return resultado;
    }
    const espera = esperaDoBackoff(tentativa, ctx.aleatorio);
    if (ctx.agora() + espera + TEMPO_MINIMO_DA_REQUISICAO_MS > ctx.prazoEm) {
      return falha("prazo_esgotado", {
        http: resultado.http,
        codigoDaMeta: resultado.codigoDaMeta,
        subcodigoDaMeta: resultado.subcodigoDaMeta,
      });
    }
    await ctx.dormir(espera);
  }
}

/**
 * Le todas as paginas de uma consulta, pagina a pagina, pelo cursor after.
 * O timeout de uma pagina volta sem retry local e com a marca
 * SEM_RESPOSTA_A_TEMPO (e o mesmo objeto da falha), para lerPeriodo dividir.
 */
async function lerPaginas(
  ctx: Contexto,
  caminho: string,
  params: Record<string, string>,
): Promise<{ ok: true; paginas: unknown[][] } | FalhaDeLeitura> {
  const paginas: unknown[][] = [];
  let after: string | null = null;
  let recomecou = false;
  let pedidas = 0;
  for (;;) {
    if (pedidas >= MAX_PAGINAS) {
      // Pagina demais: para quem chama, e consulta pesada (divide o periodo).
      return falha("consulta_pesada");
    }
    pedidas += 1;
    const resposta = await pedir(
      ctx,
      caminho,
      after ? { ...params, after } : params,
      { repetirSemResposta: false },
    );
    if (!resposta.ok) {
      if (resposta.codigoDaMeta === CODIGO_CURSOR_INVALIDO && !recomecou) {
        recomecou = true;
        after = null;
        paginas.length = 0;
        continue;
      }
      return resposta;
    }
    const dados = resposta.corpo.data;
    if (!Array.isArray(dados)) {
      return falha("resposta_invalida");
    }
    paginas.push(dados);
    const paging = eObjeto(resposta.corpo.paging) ? resposta.corpo.paging : null;
    const temProxima =
      paging !== null &&
      paging.next !== undefined &&
      paging.next !== null &&
      paging.next !== "";
    if (!temProxima) {
      return { ok: true, paginas };
    }
    const cursores = eObjeto(paging.cursors) ? paging.cursors : null;
    const proximo = typeof cursores?.after === "string" ? cursores.after : "";
    if (proximo === "") {
      return falha("resposta_invalida");
    }
    after = proximo;
  }
}

// ---------------------------------------------------------------------------
// Validacao das linhas
// ---------------------------------------------------------------------------

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ID_NUMERICO = /^\d{1,32}$/;

function diaDaLinha(linha: Record<string, unknown>, periodo: Periodo): string | null {
  const inicio = linha.date_start;
  const fim = linha.date_stop;
  if (typeof inicio !== "string" || !DIA.test(inicio) || inicio !== fim) {
    return null;
  }
  // Dia de calendario de verdade (2026-02-30 nao passa) e dentro do pedido.
  if (somarDias(inicio, 0) !== inicio) {
    return null;
  }
  return inicio >= periodo.de && inicio <= periodo.ate ? inicio : null;
}

function idNumerico(valor: unknown): string | null {
  return typeof valor === "string" && ID_NUMERICO.test(valor) ? valor : null;
}

function centavosDaLinha(valor: unknown): number | null {
  if (typeof valor === "string") {
    return decimalParaCentavos(valor);
  }
  if (typeof valor === "number" && Number.isFinite(valor) && valor >= 0) {
    return decimalParaCentavos(String(valor));
  }
  return null;
}

function moedaConfere(valor: unknown, moeda: string): boolean {
  return valor === undefined || valor === null || valor === moeda;
}

type Validada<T> = { chave: string; valor: T };

function validarLinhaDeAnuncio(
  bruta: unknown,
  periodo: Periodo,
  moeda: string,
): Validada<GastoDoAnuncioNoDia> | null {
  if (!eObjeto(bruta)) return null;
  const dia = diaDaLinha(bruta, periodo);
  const adId = idNumerico(bruta.ad_id);
  const campaignId = idNumerico(bruta.campaign_id);
  const spendCents = centavosDaLinha(bruta.spend);
  if (!dia || !adId || !campaignId || spendCents === null) return null;
  if (!moedaConfere(bruta.account_currency, moeda)) return null;
  let adsetId: string | null = null;
  if (
    bruta.adset_id !== undefined &&
    bruta.adset_id !== null &&
    bruta.adset_id !== ""
  ) {
    adsetId = idNumerico(bruta.adset_id);
    if (!adsetId) return null;
  }
  const nome =
    typeof bruta.campaign_name === "string"
      ? bruta.campaign_name.trim().slice(0, 400) || null
      : null;
  return {
    chave: `${dia}|${adId}`,
    valor: {
      dia,
      adId,
      adsetId,
      campaignId,
      campaignName: nome,
      spendCents,
    },
  };
}

function validarLinhaDaConta(
  bruta: unknown,
  periodo: Periodo,
  moeda: string,
): Validada<GastoDaContaNoDia> | null {
  if (!eObjeto(bruta)) return null;
  const dia = diaDaLinha(bruta, periodo);
  const spendCents = centavosDaLinha(bruta.spend);
  if (!dia || spendCents === null) return null;
  if (!moedaConfere(bruta.account_currency, moeda)) return null;
  return { chave: dia, valor: { dia, spendCents } };
}

type Lido<T> = { ok: true; linhas: Map<string, T>; paginas: number };

/**
 * Le um nivel do Insights (ad ou account), dia a dia, no periodo. Consulta
 * pesada (o codigo da Meta, pagina demais ou pagina sem resposta dentro do
 * nosso timeout) divide o periodo ao meio ate PROFUNDIDADE_DA_DIVISAO
 * niveis. Fora disso a falha volta como veio (o silencio, como
 * meta_indisponivel, acao repetir).
 * Linha repetida DENTRO de uma pagina e resposta torta (resposta_invalida);
 * entre paginas (cursor que andou enquanto os dados mudavam), a ultima lida
 * vence. Nunca soma.
 */
async function lerPeriodo<T>(
  ctx: Contexto,
  level: "ad" | "account",
  campos: string,
  periodo: Periodo,
  validar: (bruta: unknown, periodo: Periodo) => Validada<T> | null,
  nivel = 0,
): Promise<Lido<T> | FalhaDeLeitura> {
  const lidas = await lerPaginas(ctx, `${ctx.adAccountId}/insights`, {
    level,
    fields: campos,
    time_increment: "1",
    time_range: JSON.stringify({ since: periodo.de, until: periodo.ate }),
    limit: String(LIMITE_POR_PAGINA),
  });
  if (!lidas.ok) {
    if (
      (lidas.problema === "consulta_pesada" ||
        SEM_RESPOSTA_A_TEMPO.has(lidas)) &&
      nivel < PROFUNDIDADE_DA_DIVISAO &&
      diasEntre(periodo.de, periodo.ate) >= 1
    ) {
      const [primeira, segunda] = dividirPeriodo(periodo);
      const a = await lerPeriodo(ctx, level, campos, primeira, validar, nivel + 1);
      if (!a.ok) return a;
      const b = await lerPeriodo(ctx, level, campos, segunda, validar, nivel + 1);
      if (!b.ok) return b;
      return {
        ok: true,
        linhas: new Map([...a.linhas, ...b.linhas]),
        paginas: a.paginas + b.paginas,
      };
    }
    return lidas;
  }
  const linhas = new Map<string, T>();
  for (const pagina of lidas.paginas) {
    const daPagina = new Set<string>();
    for (const bruta of pagina) {
      const validada = validar(bruta, periodo);
      if (!validada || daPagina.has(validada.chave)) {
        return falha("resposta_invalida");
      }
      daPagina.add(validada.chave);
      linhas.set(validada.chave, validada.valor);
    }
  }
  return { ok: true, linhas, paginas: lidas.paginas.length };
}

function fusoValido(fuso: string): boolean {
  if (fuso.length === 0 || fuso.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

async function lerConta(
  ctx: Contexto,
): Promise<{ ok: true; conta: ContaDeAnuncios } | FalhaDeLeitura> {
  const resposta = await pedir(ctx, ctx.adAccountId, { fields: CAMPOS_DA_CONTA });
  if (!resposta.ok) {
    return resposta;
  }
  const corpo = resposta.corpo;
  const id =
    typeof corpo.id === "string" ? normalizarContaDeAnuncios(corpo.id) : null;
  const moeda =
    typeof corpo.currency === "string" && /^[A-Z]{3}$/.test(corpo.currency)
      ? corpo.currency
      : null;
  const fuso =
    typeof corpo.timezone_name === "string" && fusoValido(corpo.timezone_name)
      ? corpo.timezone_name
      : null;
  const status =
    inteiro(corpo.account_status) ??
    (typeof corpo.account_status === "string" &&
    /^\d{1,4}$/.test(corpo.account_status)
      ? Number(corpo.account_status)
      : null);
  if (id !== ctx.adAccountId || !moeda || !fuso || status === null) {
    return falha("resposta_invalida");
  }
  const nome =
    typeof corpo.name === "string" ? corpo.name.trim().slice(0, 200) || null : null;
  return {
    ok: true,
    conta: { id, nome, moeda, fuso, status, ativa: status === 1 },
  };
}

// ---------------------------------------------------------------------------
// Entradas publicas
// ---------------------------------------------------------------------------

/**
 * "Testar leitura": 2 chamadas, a conta (nome, moeda, fuso, situacao) e o
 * total da conta nos ultimos 30 dias (limit=1). Os codigos 10, 200-299 e 190
 * ja separam permissao de token.
 */
export async function testarLeituraDeAnuncios(
  config: ConfigDeLeitura,
): Promise<
  | { ok: true; conta: ContaDeAnuncios; temGastoEm30Dias: boolean }
  | FalhaDeLeitura
> {
  const ctx = criarContexto(config);
  if ("ok" in ctx) {
    return ctx;
  }
  const conta = await lerConta(ctx);
  if (!conta.ok) {
    return conta;
  }
  const resposta = await pedir(ctx, `${ctx.adAccountId}/insights`, {
    level: "account",
    fields: "spend",
    date_preset: "last_30d",
    limit: "1",
  });
  if (!resposta.ok) {
    return resposta;
  }
  const dados = resposta.corpo.data;
  if (!Array.isArray(dados)) {
    return falha("resposta_invalida");
  }
  const temGastoEm30Dias = dados.some(
    (linha) => eObjeto(linha) && (centavosDaLinha(linha.spend) ?? 0) > 0,
  );
  return { ok: true, conta: conta.conta, temGastoEm30Dias };
}

/**
 * A leitura do job: a conta (fuso e moeda), a janela de `dias` dias que
 * termina hoje no fuso da conta, o gasto por anuncio por dia (level=ad) e o
 * total da conta por dia (level=account, que cobre anuncio arquivado ou
 * apagado). As linhas saem deduplicadas por (dia, anuncio) e por dia.
 */
export async function lerGastoParaSincronizar(
  config: ConfigDeLeitura,
  opcoes: { dias: number; agoraMs: number },
): Promise<
  | {
      ok: true;
      conta: ContaDeAnuncios;
      periodo: Periodo;
      porAnuncio: GastoDoAnuncioNoDia[];
      daConta: GastoDaContaNoDia[];
      paginas: number;
    }
  | FalhaDeLeitura
> {
  if (
    !Number.isInteger(opcoes.dias) ||
    opcoes.dias < 1 ||
    opcoes.dias > DIAS_MAXIMOS_DA_JANELA
  ) {
    throw new RangeError("dias da leitura fora de 1 a 92");
  }
  const ctx = criarContexto(config);
  if ("ok" in ctx) {
    return ctx;
  }
  const lida = await lerConta(ctx);
  if (!lida.ok) {
    return lida;
  }
  const { conta } = lida;
  const periodo = janelaNoFusoDaConta(conta.fuso, opcoes.agoraMs, opcoes.dias);

  const porAnuncio = await lerPeriodo(
    ctx,
    "ad",
    CAMPOS_POR_ANUNCIO,
    periodo,
    (bruta, p) => validarLinhaDeAnuncio(bruta, p, conta.moeda),
  );
  if (!porAnuncio.ok) {
    return porAnuncio;
  }
  const daConta = await lerPeriodo(
    ctx,
    "account",
    CAMPOS_DO_TOTAL_DA_CONTA,
    periodo,
    (bruta, p) => validarLinhaDaConta(bruta, p, conta.moeda),
  );
  if (!daConta.ok) {
    return daConta;
  }

  return {
    ok: true,
    conta,
    periodo,
    porAnuncio: [...porAnuncio.linhas.values()].sort(
      (a, b) => a.dia.localeCompare(b.dia) || a.adId.localeCompare(b.adId),
    ),
    daConta: [...daConta.linhas.values()].sort((a, b) =>
      a.dia.localeCompare(b.dia),
    ),
    paginas: porAnuncio.paginas + daConta.paginas,
  };
}
