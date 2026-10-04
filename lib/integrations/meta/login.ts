import { createHmac } from "node:crypto";

import type { AdAccountId } from "@/lib/domain/meta-anuncios";
import { GRAPH_VERSION } from "@/lib/integrations/meta/versao";

// "Conectar com a Meta" (F3): Facebook Login for Business com config_id,
// fluxo manual (sem o SDK em JS), tudo no servidor.
//
// Mesmo molde de insights.ts (Fase 4): timeout explicito com AbortController,
// prazo total (prazoEm), retry LOCAL so em falha passageira com backoff e
// jitter, fetch, relogio, espera e sorteio injetaveis, resultado tipado.
// Regras desta integracao:
// - A configuracao (META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID e o
//   endereco de retorno) chega POR PARAMETRO: quem chama le as variaveis de
//   ambiente. Nada aqui le process.env.
// - O resultado de erro nunca carrega a mensagem da Meta, a URL, o code, o
//   token nem o segredo do app: so o problema, a acao e os codigos numericos.
//   A mensagem e lida dentro da classificacao (casos que a Meta so distingue
//   pelo texto) e esquecida ali. Nada aqui escreve log.
// - Token do usuario sempre no cabecalho Authorization: Bearer. Excecoes
//   documentadas, as duas montadas so aqui e nunca devolvidas:
//   * a troca do code vai por POST com corpo de formulario (client_secret e
//     code fora da URL, como manda o OAuth 2.0 para o endpoint de token);
//   * o debug_token so aceita o token inspecionado em input_token, na query.
//     O token do app (id|segredo) vai no cabecalho.
// - A troca do code e UMA tentativa so: o code e de uso unico, e repetir
//   depois de um timeout em que a Meta ja consumiu o code so devolveria
//   "codigo ja usado". Qualquer falha ali pede um novo login.
// - Paginacao de contas pelo cursor `after`, montando a proxima requisicao
//   aqui. O paging.next NUNCA e seguido: e URL vinda de fora (SSRF) e serve
//   so de sinal de que ha mais pagina.
// - appsecret_proof (com appsecret_time) vai nas chamadas com o token do
//   usuario quando quem chama passa o segredo do app. Hoje o "Require App
//   Secret" esta desligado (critica 0.6) e mandar a prova correta e inocuo;
//   quando ele for ligado, este arquivo ja funciona.

const GRAPH_HOST = "https://graph.facebook.com";
const DIALOGO_HOST = "https://www.facebook.com";

/** Timeout de cada requisicao, quando quem chama nao passa outro. */
export const LOGIN_TIMEOUT_MS = 10_000;
/** Novas tentativas locais, so em meta_indisponivel (nunca na troca do code). */
export const LOGIN_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
const BACKOFF_TETO_MS = 4_000;
/** Requisicao com menos tempo que isto ate o prazo nem comeca. */
const TEMPO_MINIMO_DA_REQUISICAO_MS = 2_000;
/** Espera sugerida no limite da Meta quando nenhum cabecalho diz quanto. */
export const ESPERA_DO_LIMITE_PADRAO_MS = 15 * 60_000;
/** A unica permissao que a configuracao do login pede. */
export const PERMISSAO_DE_LEITURA = "ads_read";
/** Contas por pagina em /me/adaccounts. */
export const CONTAS_POR_PAGINA = 100;
/** Paginas lidas no maximo; acima disso a lista volta marcada incompleta. */
export const MAX_PAGINAS_DE_CONTAS = 10;
/** "Invalid cursor": a paginacao recomeca do zero uma vez. */
const CODIGO_CURSOR_INVALIDO = 2642;

const CAMPOS_DAS_CONTAS =
  "id,name,account_id,currency,timezone_name,account_status";

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

/**
 * Os problemas do login, na ordem em que podem aparecer no fluxo:
 * - configuracao_invalida: id do app, segredo, config_id, endereco de retorno
 *   ou state fora do formato. Nem chamou a Meta.
 * - app_recusado: a Meta recusou o app (id ou segredo errado, prova invalida).
 * - redirect_divergente: o endereco de retorno nao bate com o cadastrado ou
 *   com o do login.
 * - codigo_recusado: code vencido, ja usado ou invalido.
 * - token_de_outro_app: o token nao e do nosso app. A Meta costuma recusar o
 *   debug_token com 100 ("App_id in the input_token did not match"); um
 *   data.app_id diferente do nosso e a segunda defesa.
 * - token_invalido: is_valid falso, ou 190/102 numa chamada com o token.
 * - sem_ads_read: o token nao tem ads_read concedida.
 * - sem_permissao: 10, 200 a 299 ou 294 numa chamada com o token.
 * - exige_prova_do_app: o app exige appsecret_proof e o segredo nao veio.
 * - parametro_recusado, versao_descontinuada, limite_da_meta,
 *   meta_indisponivel, resposta_invalida, prazo_esgotado, outro: como em
 *   insights.ts.
 */
export const PROBLEMAS_DO_LOGIN = [
  "configuracao_invalida",
  "app_recusado",
  "redirect_divergente",
  "codigo_recusado",
  "token_de_outro_app",
  "token_invalido",
  "sem_ads_read",
  "sem_permissao",
  "exige_prova_do_app",
  "parametro_recusado",
  "versao_descontinuada",
  "limite_da_meta",
  "meta_indisponivel",
  "resposta_invalida",
  "prazo_esgotado",
  "outro",
] as const;

export type ProblemaDoLogin = (typeof PROBLEMAS_DO_LOGIN)[number];

/**
 * O que quem chama faz com a falha:
 * - conectar_de_novo: a pessoa clica em "Conectar com a Meta" outra vez.
 * - configurar_app: problema do app da Conduzza (variaveis, endereco de
 *   retorno, segredo); a clinica ve "erro" e o suporte corrige.
 * - repetir: passageiro; tentar de novo em instantes.
 * - aguardar: limite da Meta; voltar depois de `tentarEmMs`.
 * - desistir: repetir nao conserta e nao e configuracao.
 */
export type AcaoDoLogin =
  | "conectar_de_novo"
  | "configurar_app"
  | "repetir"
  | "aguardar"
  | "desistir";

export type FalhaDoLogin = {
  ok: false;
  problema: ProblemaDoLogin;
  acao: AcaoDoLogin;
  /** So em limite_da_meta: quanto esperar, pelos cabecalhos de uso. */
  tentarEmMs: number | null;
  /** error.code da Meta (null quando nem houve resposta dela). */
  codigoDaMeta: number | null;
  subcodigoDaMeta: number | null;
  http: number | null;
};

/** Execucao de uma chamada: prazo total, timeout e dependencias injetaveis. */
export type Execucao = {
  /** Instante (ms, no relogio de `agora`) em que a operacao inteira acaba. */
  prazoEm: number;
  /** Timeout de cada requisicao (padrao 10 s), sempre limitado ao prazo. */
  timeoutMs?: number;
  /** Novas tentativas locais em meta_indisponivel (padrao 2). */
  maxRetries?: number;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
};

export type ConfigDaUrlDoLogin = {
  /** META_APP_ID. */
  appId: string;
  /** META_LOGIN_CONFIG_ID (a configuracao do Login for Business). */
  configId: string;
  /** Endereco de retorno EXATO, o mesmo que vai na troca do code. */
  redirectUri: string;
  /** Nonce gerado por quem chama (o hash dele fica na oauth_estado). */
  state: string;
};

/** A troca do code: uma tentativa so, entao sem maxRetries nem backoff. */
export type ConfigDaTroca = Omit<
  Execucao,
  "maxRetries" | "dormir" | "aleatorio"
> & {
  appId: string;
  /** META_APP_SECRET. */
  appSecret: string;
  /** O MESMO endereco de retorno usado em montarUrlDoLogin. */
  redirectUri: string;
};

export type ConfigDaConferencia = Execucao & {
  appId: string;
  appSecret: string;
};

export type ConfigComToken = Execucao & {
  accessToken: string;
  /** Quando vem, as chamadas levam appsecret_proof e appsecret_time. */
  appSecret?: string;
};

export type TokenDoLogin = {
  accessToken: string;
  /** null quando a Meta nao informa validade (token que nao vence). */
  expiraEmMs: number | null;
};

export type TokenConferido = {
  /** type do debug_token (USER, SYSTEM_USER...), quando vem. */
  tipo: string | null;
  /** Permissoes concedidas (scopes do debug_token). Nada secreto. */
  escopos: string[];
  /** expires_at em ms; null quando 0 ou ausente (nao vence). */
  expiraEmMs: number | null;
  /** data_access_expires_at em ms; null quando 0 ou ausente. */
  acessoAosDadosExpiraEmMs: number | null;
};

export type ContaAcessivel = {
  id: AdAccountId;
  /** account_id da Meta: os digitos de `id`. */
  accountId: string;
  nome: string | null;
  /** ISO 4217, quando vem e e valido. */
  moeda: string | null;
  /** Fuso IANA, quando vem e e valido. */
  fuso: string | null;
  /** account_status da Meta (1 ativa, 2 desativada, 3 sem pagamento...). */
  status: number | null;
  ativa: boolean;
};

export type SituacaoDaRevogacao = "revogado" | "ja_invalido";

/** Quem a chamada autentica: muda o sentido de 190 e de 100. */
export type PapelDaChamada = "troca" | "app" | "token";

// ---------------------------------------------------------------------------
// Falhas e classificacao
// ---------------------------------------------------------------------------

const ACAO_DO_PROBLEMA: Record<ProblemaDoLogin, AcaoDoLogin> = {
  configuracao_invalida: "configurar_app",
  app_recusado: "configurar_app",
  redirect_divergente: "configurar_app",
  codigo_recusado: "conectar_de_novo",
  token_de_outro_app: "conectar_de_novo",
  token_invalido: "conectar_de_novo",
  sem_ads_read: "conectar_de_novo",
  sem_permissao: "conectar_de_novo",
  exige_prova_do_app: "configurar_app",
  parametro_recusado: "desistir",
  versao_descontinuada: "desistir",
  limite_da_meta: "aguardar",
  meta_indisponivel: "repetir",
  resposta_invalida: "repetir",
  prazo_esgotado: "repetir",
  outro: "desistir",
};

/** A acao de cada problema (fora da troca do code, que nunca repete). */
export function acaoDoProblemaDoLogin(problema: ProblemaDoLogin): AcaoDoLogin {
  return ACAO_DO_PROBLEMA[problema];
}

type ExtraDaFalha = Partial<
  Pick<FalhaDoLogin, "tentarEmMs" | "codigoDaMeta" | "subcodigoDaMeta" | "http">
>;

function falha(problema: ProblemaDoLogin, extra: ExtraDaFalha = {}): FalhaDoLogin {
  return {
    ok: false,
    problema,
    acao: acaoDoProblemaDoLogin(problema),
    tentarEmMs: extra.tentarEmMs ?? null,
    codigoDaMeta: extra.codigoDaMeta ?? null,
    subcodigoDaMeta: extra.subcodigoDaMeta ?? null,
    http: extra.http ?? null,
  };
}

/**
 * Falhas de "campo inexistente" (100, "nonexisting field"). Marca interna
 * (nao entra no objeto, no JSON nem no tipo): lerNegocioDoCliente trata o
 * client_business_id ausente do no como "nao veio".
 */
const CAMPO_INEXISTENTE = new WeakSet<FalhaDoLogin>();

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
 * Quanto esperar depois de um limite da Meta (copia minima de insights.ts):
 * o maior entre estimated_time_to_regain_access (minutos,
 * x-business-use-case-usage) e reset_time_duration (segundos,
 * x-ad-account-usage). Sem nenhum, 15 min.
 */
function esperaDoLimite(headers: Headers): number {
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

function problemaDoErro(
  http: number,
  codigo: number | null,
  passageiro: boolean,
  mensagem: string,
  papel: PapelDaChamada,
): ProblemaDoLogin {
  // Na troca do code a Meta usa 100 para quase tudo e so o texto separa o
  // endereco de retorno divergente do code vencido ou ja usado. O segredo
  // errado vem como 1 ("Error validating client secret") ou 101.
  if (papel === "troca") {
    if (codigo === 101 || /client[ _]?secret/i.test(mensagem)) {
      return "app_recusado";
    }
    if (codigo === 191 || (codigo === 100 && /redirect_uri/i.test(mensagem))) {
      return "redirect_divergente";
    }
    if (codigo === 100 || codigo === 190) return "codigo_recusado";
  }
  // No debug_token quem autentica e o token do app: 190, 102 e 101 dizem
  // que o app (id ou segredo) esta errado, nao o token inspecionado.
  if (
    papel === "app" &&
    (codigo === 190 || codigo === 102 || codigo === 101 || http === 401)
  ) {
    return "app_recusado";
  }
  // Token de outro app no debug_token: com o token do app autenticando, a
  // Meta nao devolve o app_id alheio no data; ela recusa com 100 e o texto
  // "(#100) The App_id in the input_token did not match the Viewing App".
  // Vem antes da regra generica do 100, que daria parametro_recusado.
  if (
    papel === "app" &&
    codigo === 100 &&
    /app_?id in the input[_ ]?token did not match/i.test(mensagem)
  ) {
    return "token_de_outro_app";
  }
  if (codigo === 190 || codigo === 102) return "token_invalido";
  if (codigo === 100 && /invalid appsecret_proof/i.test(mensagem)) {
    return "app_recusado";
  }
  if (codigo === 100 && /appsecret_proof/i.test(mensagem)) {
    return "exige_prova_do_app";
  }
  if (
    codigo === 10 ||
    codigo === 294 ||
    (codigo !== null && codigo >= 200 && codigo <= 299)
  ) {
    return "sem_permissao";
  }
  if (codigo === 2635) return "versao_descontinuada";
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
  if (http === 401) {
    return papel === "troca" ? "codigo_recusado" : "token_invalido";
  }
  if (http === 403) return "sem_permissao";
  return "outro";
}

/**
 * Classifica a resposta de erro da Graph para o papel da chamada. O
 * resultado leva so o problema, a acao e os codigos numericos; a mensagem da
 * Meta nunca sai daqui.
 */
export function classificarErroDoLogin(
  http: number,
  corpo: unknown,
  headers: Headers,
  papel: PapelDaChamada,
): FalhaDoLogin {
  const erro = eObjeto(corpo) && eObjeto(corpo.error) ? corpo.error : null;
  const codigo = inteiro(erro?.code);
  const subcodigo = inteiro(erro?.error_subcode);
  const passageiro = erro?.is_transient === true;
  const mensagem = typeof erro?.message === "string" ? erro.message : "";
  const problema = problemaDoErro(http, codigo, passageiro, mensagem, papel);
  const resultado = falha(problema, {
    http,
    codigoDaMeta: codigo,
    subcodigoDaMeta: subcodigo,
    tentarEmMs: problema === "limite_da_meta" ? esperaDoLimite(headers) : null,
  });
  if (codigo === 100 && /nonexist(?:ing|ent) field/i.test(mensagem)) {
    CAMPO_INEXISTENTE.add(resultado);
  }
  return resultado;
}

/** Espera antes da nova tentativa n (0, 1...): metade fixa, metade sorteada. */
function esperaDoBackoff(tentativa: number, aleatorio: () => number): number {
  const teto = Math.min(BACKOFF_TETO_MS, BACKOFF_BASE_MS * 2 ** tentativa);
  return Math.round(teto / 2 + aleatorio() * (teto / 2));
}

// ---------------------------------------------------------------------------
// Validacao da configuracao
// ---------------------------------------------------------------------------

const APP_ID_VALIDO = /^\d{5,32}$/;
const CONFIG_ID_VALIDO = /^\d{5,32}$/;
const SEGREDO_VALIDO = /^[A-Za-z0-9]{16,128}$/;
// Token: so caracteres visiveis de ASCII (vai num cabecalho HTTP). O mesmo
// teto de insights.ts: token que a leitura recusaria nao passa no login.
const TOKEN_VALIDO = /^[\x21-\x7e]{20,500}$/;
const CODIGO_VALIDO = /^[\x21-\x7e]{1,4096}$/;
// O state e um nonce: so caracteres seguros de URL e pelo menos 16.
const STATE_VALIDO = /^[A-Za-z0-9._~-]{16,512}$/;
const CONTA_VALIDA = /^act_(\d{5,20})$/;
const ID_NUMERICO = /^\d{1,32}$/;
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Endereco de retorno aceito: absoluto, https (http so em localhost, para
 * desenvolvimento), sem fragmento, sem usuario e senha, sem espaco nas
 * pontas. O texto e usado como veio, nas duas pontas do fluxo: o Modo
 * estrito da Meta exige igualdade exata com o cadastrado.
 */
function redirectValido(redirectUri: string): boolean {
  if (
    redirectUri.length === 0 ||
    redirectUri.length > 2048 ||
    redirectUri.trim() !== redirectUri ||
    redirectUri.includes("#")
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && HOSTS_LOCAIS.has(url.hostname);
}

function appValido(appId: string, appSecret: string): boolean {
  return APP_ID_VALIDO.test(appId) && SEGREDO_VALIDO.test(appSecret);
}

// ---------------------------------------------------------------------------
// Requisicao
// ---------------------------------------------------------------------------

type Contexto = {
  prazoEm: number;
  timeoutMs: number;
  maxRetries: number;
  fetchFn: typeof fetch;
  agora: () => number;
  dormir: (ms: number) => Promise<void>;
  aleatorio: () => number;
};

type Pedido = {
  metodo: "GET" | "POST" | "DELETE";
  caminho: string;
  params: Record<string, string>;
  /** Corpo de formulario (so na troca do code). */
  formulario: Record<string, string> | null;
  /** Vai no cabecalho Authorization: Bearer (null: sem cabecalho). */
  bearer: string | null;
  /** Segredo para appsecret_proof (so nas chamadas com o token do usuario). */
  segredoDaProva: string | null;
  papel: PapelDaChamada;
};

type RespostaDaMeta = { ok: true; corpo: unknown };

function criarContexto(config: Execucao): Contexto {
  return {
    prazoEm: config.prazoEm,
    timeoutMs: config.timeoutMs ?? LOGIN_TIMEOUT_MS,
    maxRetries: config.maxRetries ?? LOGIN_MAX_RETRIES,
    fetchFn: config.fetchFn ?? fetch,
    agora: config.agora ?? Date.now,
    dormir:
      config.dormir ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    aleatorio: config.aleatorio ?? Math.random,
  };
}

function montarUrlDaGraph(ctx: Contexto, pedido: Pedido): URL {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${pedido.caminho}`);
  for (const [chave, valor] of Object.entries(pedido.params)) {
    url.searchParams.set(chave, valor);
  }
  if (pedido.segredoDaProva !== null && pedido.bearer !== null) {
    // Prova com carimbo de tempo (pagina de seguranca do login): HMAC-SHA256
    // de "token|segundos" com o segredo do app, gerada a cada chamada.
    const segundos = Math.floor(ctx.agora() / 1_000);
    const prova = createHmac("sha256", pedido.segredoDaProva)
      .update(`${pedido.bearer}|${segundos}`)
      .digest("hex");
    url.searchParams.set("appsecret_proof", prova);
    url.searchParams.set("appsecret_time", String(segundos));
  }
  return url;
}

async function umaChamada(
  ctx: Contexto,
  pedido: Pedido,
  timeoutMs: number,
): Promise<RespostaDaMeta | FalhaDoLogin> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const cabecalhos: Record<string, string> = { Accept: "application/json" };
  if (pedido.bearer !== null) {
    cabecalhos.Authorization = `Bearer ${pedido.bearer}`;
  }
  let corpoDoPedido: string | undefined;
  if (pedido.formulario !== null) {
    cabecalhos["Content-Type"] = "application/x-www-form-urlencoded";
    corpoDoPedido = new URLSearchParams(pedido.formulario).toString();
  }
  let recebida: { status: number; headers: Headers; corpo: unknown } | null =
    null;
  try {
    const resposta = await ctx.fetchFn(montarUrlDaGraph(ctx, pedido).toString(), {
      method: pedido.metodo,
      headers: cabecalhos,
      body: corpoDoPedido,
      signal: controller.signal,
      cache: "no-store",
      // A Graph nao redireciona chamada de API; seguir um redirecionamento
      // levaria o cabecalho com o token para outro lugar.
      redirect: "error",
    });
    let corpo: unknown = undefined;
    let semJson = false;
    try {
      corpo = await resposta.json();
    } catch {
      semJson = true;
    }
    if (semJson && controller.signal.aborted) {
      return falha("meta_indisponivel");
    }
    recebida = { status: resposta.status, headers: resposta.headers, corpo };
  } catch {
    // A Meta nao respondeu: pelo nosso timer (abort) ou por falha de rede.
    return falha("meta_indisponivel");
  } finally {
    clearTimeout(timer);
  }

  if (recebida.status >= 200 && recebida.status < 300) {
    if (recebida.corpo === undefined) {
      return falha("resposta_invalida", { http: recebida.status });
    }
    if (eObjeto(recebida.corpo) && eObjeto(recebida.corpo.error)) {
      return classificarErroDoLogin(
        recebida.status,
        recebida.corpo,
        recebida.headers,
        pedido.papel,
      );
    }
    return { ok: true, corpo: recebida.corpo };
  }
  return classificarErroDoLogin(
    recebida.status,
    recebida.corpo,
    recebida.headers,
    pedido.papel,
  );
}

async function pedir(
  ctx: Contexto,
  pedido: Pedido,
  opcoes: { repetir: boolean },
): Promise<RespostaDaMeta | FalhaDoLogin> {
  for (let tentativa = 0; ; tentativa += 1) {
    const restante = ctx.prazoEm - ctx.agora();
    if (restante < TEMPO_MINIMO_DA_REQUISICAO_MS) {
      return falha("prazo_esgotado");
    }
    const resultado = await umaChamada(
      ctx,
      pedido,
      Math.min(ctx.timeoutMs, restante),
    );
    if (resultado.ok) {
      return resultado;
    }
    if (
      !opcoes.repetir ||
      resultado.problema !== "meta_indisponivel" ||
      tentativa >= ctx.maxRetries
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

/** Pedido com o token do usuario, ou a falha quando o token ou o segredo nao servem. */
function pedidoComToken(
  config: ConfigComToken,
  metodo: Pedido["metodo"],
  caminho: string,
  params: Record<string, string>,
): Pedido | FalhaDoLogin {
  if (!TOKEN_VALIDO.test(config.accessToken)) {
    return falha("token_invalido");
  }
  if (config.appSecret !== undefined && !SEGREDO_VALIDO.test(config.appSecret)) {
    return falha("configuracao_invalida");
  }
  return {
    metodo,
    caminho,
    params,
    formulario: null,
    bearer: config.accessToken,
    segredoDaProva: config.appSecret ?? null,
    papel: "token",
  };
}

function instanteEmMs(segundos: unknown): number | null {
  const n = inteiro(segundos);
  return n !== null && n > 0 ? n * 1_000 : null;
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

// ---------------------------------------------------------------------------
// Entradas publicas
// ---------------------------------------------------------------------------

/**
 * A URL do dialogo do Login for Business: client_id, redirect_uri exato,
 * state do chamador, config_id (que substitui o scope), response_type=code e
 * override_default_response_type=true (o token de usuario do sistema so sai
 * pelo fluxo de code). Funcao pura, sem rede; nenhum segredo vai na URL.
 */
export function montarUrlDoLogin(
  config: ConfigDaUrlDoLogin,
): { ok: true; url: string } | FalhaDoLogin {
  if (
    !APP_ID_VALIDO.test(config.appId) ||
    !CONFIG_ID_VALIDO.test(config.configId) ||
    !redirectValido(config.redirectUri) ||
    !STATE_VALIDO.test(config.state)
  ) {
    return falha("configuracao_invalida");
  }
  const url = new URL(`${DIALOGO_HOST}/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", config.state);
  url.searchParams.set("config_id", config.configId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  return { ok: true, url: url.toString() };
}

/**
 * Troca o code do retorno pelo token, servidor a servidor, em UMA tentativa
 * (POST /oauth/access_token com corpo de formulario). Falha passageira volta
 * com acao conectar_de_novo: o code e de uso unico e nao se repete aqui.
 */
export async function trocarCodigoPorToken(
  config: ConfigDaTroca,
  code: string,
): Promise<{ ok: true; token: TokenDoLogin } | FalhaDoLogin> {
  if (
    !appValido(config.appId, config.appSecret) ||
    !redirectValido(config.redirectUri)
  ) {
    return falha("configuracao_invalida");
  }
  if (!CODIGO_VALIDO.test(code)) {
    return falha("codigo_recusado");
  }
  const ctx = criarContexto({ ...config, maxRetries: 0 });
  const resposta = await pedir(
    ctx,
    {
      metodo: "POST",
      caminho: "oauth/access_token",
      params: {},
      formulario: {
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: config.redirectUri,
        code,
      },
      // O endpoint de token autentica pelo client_secret do corpo.
      bearer: null,
      segredoDaProva: null,
      papel: "troca",
    },
    { repetir: false },
  );
  if (!resposta.ok) {
    return resposta.acao === "repetir"
      ? { ...resposta, acao: "conectar_de_novo" }
      : resposta;
  }
  const corpo = resposta.corpo;
  if (
    !eObjeto(corpo) ||
    typeof corpo.access_token !== "string" ||
    !TOKEN_VALIDO.test(corpo.access_token)
  ) {
    return { ...falha("resposta_invalida"), acao: "conectar_de_novo" };
  }
  const segundos = inteiro(corpo.expires_in);
  return {
    ok: true,
    token: {
      accessToken: corpo.access_token,
      expiraEmMs:
        segundos !== null && segundos > 0 ? ctx.agora() + segundos * 1_000 : null,
    },
  };
}

/**
 * Confere o token com o debug_token, autenticado pelo token do app: o
 * app_id tem de ser o nosso (protege contra token de outro app colado no
 * retorno), is_valid verdadeiro e ads_read entre as permissoes concedidas.
 * Token de outro app costuma voltar como erro 100 (classificado em
 * problemaDoErro); a checagem do data.app_id abaixo e a segunda defesa.
 */
export async function conferirToken(
  config: ConfigDaConferencia,
  accessToken: string,
): Promise<{ ok: true; conferido: TokenConferido } | FalhaDoLogin> {
  if (!appValido(config.appId, config.appSecret)) {
    return falha("configuracao_invalida");
  }
  if (!TOKEN_VALIDO.test(accessToken)) {
    return falha("token_invalido");
  }
  const ctx = criarContexto(config);
  const resposta = await pedir(
    ctx,
    {
      metodo: "GET",
      caminho: "debug_token",
      params: { input_token: accessToken },
      formulario: null,
      bearer: `${config.appId}|${config.appSecret}`,
      segredoDaProva: null,
      papel: "app",
    },
    { repetir: true },
  );
  if (!resposta.ok) {
    return resposta;
  }
  const dados =
    eObjeto(resposta.corpo) && eObjeto(resposta.corpo.data)
      ? resposta.corpo.data
      : null;
  if (!dados) {
    return falha("resposta_invalida");
  }

  // app_id vem como texto; numero so serve se for inteiro seguro (id grande
  // em numero perde digitos no JSON).
  let appIdDoToken: string | null = null;
  if (typeof dados.app_id === "string" && ID_NUMERICO.test(dados.app_id)) {
    appIdDoToken = dados.app_id;
  } else if (
    typeof dados.app_id === "number" &&
    Number.isSafeInteger(dados.app_id) &&
    dados.app_id > 0
  ) {
    appIdDoToken = String(dados.app_id);
  } else if (dados.app_id !== undefined && dados.app_id !== null) {
    return falha("resposta_invalida");
  }
  if (appIdDoToken !== null && appIdDoToken !== config.appId) {
    return falha("token_de_outro_app");
  }
  if (dados.is_valid !== true) {
    const erro = eObjeto(dados.error) ? dados.error : null;
    return falha("token_invalido", {
      http: 200,
      codigoDaMeta: inteiro(erro?.code),
      subcodigoDaMeta: inteiro(erro?.subcode ?? erro?.error_subcode),
    });
  }
  if (appIdDoToken === null) {
    return falha("resposta_invalida");
  }
  const brutos: unknown[] = Array.isArray(dados.scopes) ? dados.scopes : [];
  const escopos = brutos.filter(
    (escopo): escopo is string => typeof escopo === "string",
  );
  if (!Array.isArray(dados.scopes) || escopos.length !== brutos.length) {
    return falha("resposta_invalida");
  }
  if (!escopos.includes(PERMISSAO_DE_LEITURA)) {
    return falha("sem_ads_read");
  }
  return {
    ok: true,
    conferido: {
      tipo:
        typeof dados.type === "string" && /^[A-Z_]{1,40}$/.test(dados.type)
          ? dados.type
          : null,
      escopos,
      expiraEmMs: instanteEmMs(dados.expires_at),
      acessoAosDadosExpiraEmMs: instanteEmMs(dados.data_access_expires_at),
    },
  };
}

/**
 * O id do portfolio empresarial do cliente (GET /me?fields=client_business_id).
 * Vem no token de usuario do sistema da integracao; quando nao vem (campo
 * ausente ou inexistente no no), devolve null.
 */
export async function lerNegocioDoCliente(
  config: ConfigComToken,
): Promise<{ ok: true; clientBusinessId: string | null } | FalhaDoLogin> {
  const pedido = pedidoComToken(config, "GET", "me", {
    fields: "client_business_id",
  });
  if ("ok" in pedido) {
    return pedido;
  }
  const resposta = await pedir(criarContexto(config), pedido, { repetir: true });
  if (!resposta.ok) {
    return CAMPO_INEXISTENTE.has(resposta)
      ? { ok: true, clientBusinessId: null }
      : resposta;
  }
  if (!eObjeto(resposta.corpo)) {
    return falha("resposta_invalida");
  }
  const id = resposta.corpo.client_business_id;
  if (id === undefined || id === null || id === "") {
    return { ok: true, clientBusinessId: null };
  }
  if (typeof id !== "string" || !ID_NUMERICO.test(id)) {
    return falha("resposta_invalida");
  }
  return { ok: true, clientBusinessId: id };
}

function validarConta(bruta: unknown): ContaAcessivel | null {
  if (!eObjeto(bruta) || typeof bruta.id !== "string") {
    return null;
  }
  const casou = CONTA_VALIDA.exec(bruta.id);
  const digitos = casou?.[1];
  if (!digitos) {
    return null;
  }
  if (
    bruta.account_id !== undefined &&
    bruta.account_id !== null &&
    bruta.account_id !== digitos
  ) {
    return null;
  }
  const status =
    inteiro(bruta.account_status) ??
    (typeof bruta.account_status === "string" &&
    /^\d{1,4}$/.test(bruta.account_status)
      ? Number(bruta.account_status)
      : null);
  return {
    id: `act_${digitos}`,
    accountId: digitos,
    nome:
      typeof bruta.name === "string"
        ? bruta.name.trim().slice(0, 200) || null
        : null,
    moeda:
      typeof bruta.currency === "string" && /^[A-Z]{3}$/.test(bruta.currency)
        ? bruta.currency
        : null,
    fuso:
      typeof bruta.timezone_name === "string" && fusoValido(bruta.timezone_name)
        ? bruta.timezone_name
        : null,
    status,
    ativa: status === 1,
  };
}

/**
 * As contas de anuncios que o token alcanca (GET /me/adaccounts com id,
 * name, account_id, currency, timezone_name e account_status), pagina a
 * pagina pelo cursor after. Conta repetida entre paginas vale a ultima lida;
 * linha sem id valido torna a resposta invalida. Acima de
 * MAX_PAGINAS_DE_CONTAS paginas, devolve o que leu com incompleta=true.
 */
export async function listarContasAcessiveis(
  config: ConfigComToken,
): Promise<
  { ok: true; contas: ContaAcessivel[]; incompleta: boolean } | FalhaDoLogin
> {
  const base = pedidoComToken(config, "GET", "me/adaccounts", {
    fields: CAMPOS_DAS_CONTAS,
    limit: String(CONTAS_POR_PAGINA),
  });
  if ("ok" in base) {
    return base;
  }
  const ctx = criarContexto(config);
  const porId = new Map<string, ContaAcessivel>();
  let after: string | null = null;
  let recomecou = false;
  let pedidas = 0;
  for (;;) {
    if (pedidas >= MAX_PAGINAS_DE_CONTAS) {
      return { ok: true, contas: [...porId.values()], incompleta: true };
    }
    pedidas += 1;
    const resposta = await pedir(
      ctx,
      after ? { ...base, params: { ...base.params, after } } : base,
      { repetir: true },
    );
    if (!resposta.ok) {
      if (resposta.codigoDaMeta === CODIGO_CURSOR_INVALIDO && !recomecou) {
        recomecou = true;
        after = null;
        porId.clear();
        continue;
      }
      return resposta;
    }
    const corpo = eObjeto(resposta.corpo) ? resposta.corpo : null;
    if (!corpo || !Array.isArray(corpo.data)) {
      return falha("resposta_invalida");
    }
    for (const bruta of corpo.data) {
      const conta = validarConta(bruta);
      if (!conta) {
        return falha("resposta_invalida");
      }
      porId.set(conta.id, conta);
    }
    const paging = eObjeto(corpo.paging) ? corpo.paging : null;
    const temProxima =
      paging !== null &&
      paging.next !== undefined &&
      paging.next !== null &&
      paging.next !== "";
    if (!temProxima) {
      return { ok: true, contas: [...porId.values()], incompleta: false };
    }
    const cursores = eObjeto(paging.cursors) ? paging.cursors : null;
    const proximo = typeof cursores?.after === "string" ? cursores.after : "";
    if (proximo === "" || proximo.length > 2048) {
      return falha("resposta_invalida");
    }
    after = proximo;
  }
}

/**
 * Revoga a autorizacao do app (DELETE /me/permissions com o token). Token
 * ja invalido (190/102) volta como ja_invalido: nao ha o que revogar. Quem
 * chama decide se revoga (nao revogar quando outra clinica usa o mesmo
 * portfolio) e limpa o token guardado de qualquer jeito.
 */
export async function revogarAcesso(
  config: ConfigComToken,
): Promise<{ ok: true; situacao: SituacaoDaRevogacao } | FalhaDoLogin> {
  const pedido = pedidoComToken(config, "DELETE", "me/permissions", {});
  if ("ok" in pedido) {
    return pedido.problema === "token_invalido"
      ? { ok: true, situacao: "ja_invalido" }
      : pedido;
  }
  const resposta = await pedir(criarContexto(config), pedido, { repetir: true });
  if (!resposta.ok) {
    return resposta.problema === "token_invalido"
      ? { ok: true, situacao: "ja_invalido" }
      : resposta;
  }
  if (
    resposta.corpo === true ||
    (eObjeto(resposta.corpo) && resposta.corpo.success === true)
  ) {
    return { ok: true, situacao: "revogado" };
  }
  return falha("resposta_invalida");
}
