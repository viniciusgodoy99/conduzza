import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  lerIdentificacaoDoWebhook,
  segredosIguais,
} from "../../lib/integrations/whatsapp/segredo-do-webhook";
import {
  filtrosDoWebhookConferem,
  UazapiHttpError,
  UazapiProvider,
  type WebhookDaInstancia,
} from "../../lib/integrations/whatsapp/uazapi";

// Conferencia SO LEITURA dos webhooks das instancias do uazapi.
//
// Ninguem reconfigura instancia ja pareada: configureWebhook so roda no
// "Conectar". O que o servidor COMPARTILHADO guarda pode ter envelhecido
// (configuracao de antes, alguem mexendo no painel), e a mensagem que a
// clinica manda pelo celular so chega se o evento "messages" estiver ligado e
// os filtros nao a cortarem. Este script pergunta a cada instancia o que ela
// tem (GET /webhook) e diz, por numero, se confere com o que configureWebhook
// grava. NAO altera nada: nem no banco, nem no uazapi.
//
//   npx tsx scripts/ops/conferir-webhooks.ts
//   npx tsx scripts/ops/conferir-webhooks.ts --host app.exemplo.com.br
//
// --host (opcional) e o host de PRODUCAO do app: com ele, cada webhook diz se
// aponta para la. Sem ele, so o host e mostrado (o PUBLIC_APP_URL do
// .env.local costuma ser o tunel de desenvolvimento, por isso nao e usado).
//
// Precisa de NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e
// UAZAPI_SERVER_URL (para o numero sem server_url proprio), lidos do ambiente
// ou do .env.local.
//
// O que a saida NUNCA tem: token da instancia, segredo do webhook, url
// completa (o segredo vai na query), telefone, dado de paciente. Dos
// parametros da url saem so os NOMES; a conferencia do numero e do segredo e
// feita aqui dentro e sai como sim ou nao.
//
// Uma instancia por vez, com prazo por chamada e sem nova tentativa: o
// servidor e compartilhado com outros produtos. Rodar de novo e barato.
//
// Veredito "ok" do numero: algum webhook dele aponta para a rota do WhatsApp
// e os filtros conferem (events tem "messages"; excludeMessages tem
// "wasSentByApi" e nao tem "fromMeYes" nem "wasNotSentByApi"). O resto
// (desligado, segredo diferente, sufixo no caminho, webhook duplicado) sai
// como alerta.

const CAMINHO_DA_ROTA = "/api/webhooks/whatsapp";
const PRAZO_POR_CHAMADA_MS = 10_000;
const PAUSA_ENTRE_INSTANCIAS_MS = 500;

function argumento(nome: string): string | null {
  const indice = process.argv.indexOf(nome);
  if (indice < 0) {
    return null;
  }
  const valor = process.argv[indice + 1];
  return valor && !valor.startsWith("--") ? valor : null;
}

const hostEsperado = argumento("--host")?.toLowerCase() ?? null;

function carregarEnvLocal(): void {
  const caminho = join(process.cwd(), ".env.local");
  if (!existsSync(caminho)) {
    return;
  }
  for (const linha of readFileSync(caminho, "utf-8").split("\n")) {
    const igual = linha.indexOf("=");
    if (igual <= 0 || linha.trimStart().startsWith("#")) {
      continue;
    }
    const chave = linha.slice(0, igual).trim();
    if (!/^[A-Z0-9_]+$/.test(chave) || process.env[chave] !== undefined) {
      continue;
    }
    let valor = linha.slice(igual + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (valor) {
      process.env[chave] = valor;
    }
  }
}

function clienteDeServico(): SupabaseClient {
  carregarEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error(
      "Preencha NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente ou no .env.local.",
    );
  }
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Numero = {
  id: string;
  clinic_id: string;
  server_url: string | null;
  instance_id: string | null;
  connection_status: string;
};

type Segredo = {
  account_id: string;
  instance_token: string | null;
  webhook_secret: string | null;
};

type Situacao =
  | "ok"
  | "revisar"
  | "sem_token"
  | "instancia_invalida"
  | "recusado"
  | "tempo_esgotado"
  | "configuracao_ausente"
  | "provedor_indisponivel";

function simOuNao(valor: boolean): string {
  return valor ? "sim" : "não";
}

function lista(valores: string[]): string {
  return valores.length > 0 ? valores.join(", ") : "(vazio)";
}

/** O motivo de uma leitura que falhou, sem texto vindo de fora. */
function situacaoDoErro(erro: unknown): Situacao {
  if (erro instanceof UazapiHttpError) {
    return erro.motivo === "instancia_invalida"
      ? "instancia_invalida"
      : "recusado";
  }
  if (erro instanceof Error && erro.name === "AbortError") {
    return "tempo_esgotado";
  }
  if (erro instanceof Error && erro.message.includes("UAZAPI_SERVER_URL")) {
    return "configuracao_ausente";
  }
  return "provedor_indisponivel";
}

type AnaliseDoWebhook = {
  linhas: string[];
  alertas: string[];
  apontaParaRota: boolean;
  filtrosOk: boolean;
};

/**
 * O que se pode dizer de UM webhook sem expor a url: host, se o caminho e o
 * da rota, os NOMES dos parametros e se numero e segredo conferem com o
 * banco.
 */
function analisar(
  webhook: WebhookDaInstancia,
  numero: Numero,
  segredo: Segredo,
): AnaliseDoWebhook {
  const linhas: string[] = [];
  const alertas: string[] = [];
  const filtrosOk = filtrosDoWebhookConferem(webhook);

  linhas.push(
    `ligado: ${webhook.enabled === null ? "(não informado)" : simOuNao(webhook.enabled)}`,
    `events: ${lista(webhook.events)}`,
    `excludeMessages: ${lista(webhook.excludeMessages)}`,
  );
  if (webhook.enabled !== true) {
    alertas.push("webhook desligado: nada desta instância chega ao app");
  }
  if (webhook.addUrlEvents === true || webhook.addUrlTypesMessages === true) {
    alertas.push(
      "addUrlEvents ou addUrlTypesMessages ligado: o uazapi acrescenta sufixo ao caminho e a rota não atende",
    );
  }

  let url: URL | null = null;
  try {
    url = webhook.url ? new URL(webhook.url) : null;
  } catch {
    url = null;
  }
  if (!url) {
    linhas.push("url: ausente ou inválida");
    alertas.push("url ausente ou inválida");
    return { linhas, alertas, apontaParaRota: false, filtrosOk };
  }

  const caminho = url.pathname.replace(/\/+$/, "");
  const apontaParaRota = caminho === CAMINHO_DA_ROTA;
  const nomes = [...new Set(url.searchParams.keys())];
  linhas.push(
    `host: ${url.host}${hostEsperado ? ` (confere com --host: ${simOuNao(url.host.toLowerCase() === hostEsperado)})` : ""}`,
    `caminho é ${CAMINHO_DA_ROTA}: ${simOuNao(apontaParaRota)}`,
    `parâmetros: ${lista(nomes)}`,
  );
  if (hostEsperado && url.host.toLowerCase() !== hostEsperado) {
    alertas.push("host diferente do informado em --host");
  }
  if (!apontaParaRota) {
    return { linhas, alertas, apontaParaRota, filtrosOk };
  }

  // Mesma leitura da rota: forma nova (?clinic&account&secret) ou legada
  // (?clinic&secret). Os valores ficam aqui dentro.
  const ident = lerIdentificacaoDoWebhook(url.searchParams);
  if (!ident) {
    linhas.push("identificação: inválida (a rota recusa com 401)");
    alertas.push("parâmetros que a rota recusa");
    return { linhas, alertas, apontaParaRota, filtrosOk };
  }
  const clinicaConfere =
    ident.clinicId === null ||
    ident.clinicId === numero.clinic_id.toLowerCase();
  const numeroConfere =
    ident.tipo === "numero"
      ? ident.accountId === numero.id.toLowerCase()
      : null;
  const segredoConfere = segredo.webhook_secret
    ? segredosIguais(segredo.webhook_secret, ident.segredo)
    : false;
  linhas.push(
    `forma: ${ident.tipo === "numero" ? "nova (com o número)" : "legada (só a clínica)"}`,
    `clínica confere: ${simOuNao(clinicaConfere)}${numeroConfere === null ? "" : `, número confere: ${simOuNao(numeroConfere)}`}, segredo confere: ${simOuNao(segredoConfere)}`,
  );
  if (!clinicaConfere || numeroConfere === false) {
    alertas.push("a url aponta para outra clínica ou outro número");
  }
  if (!segredoConfere) {
    alertas.push(
      "segredo diferente do guardado: a rota recusa (401) tudo desta instância",
    );
  }
  return { linhas, alertas, apontaParaRota, filtrosOk };
}

async function conferir(
  provider: UazapiProvider,
  numero: Numero,
  segredo: Segredo | undefined,
  slug: string,
): Promise<Situacao> {
  const cabecalho = `número ${numero.id.slice(0, 8)} (clínica ${slug}, ${numero.connection_status})`;
  if (!segredo?.instance_token) {
    console.log(`${cabecalho}: sem token da instância, nada a consultar`);
    return "sem_token";
  }

  let webhooks: WebhookDaInstancia[];
  try {
    webhooks = await provider.lerWebhooks(
      {
        clinicId: numero.clinic_id,
        accountId: numero.id,
        serverUrl: numero.server_url,
        instanceToken: segredo.instance_token,
        instanceId: numero.instance_id,
      },
      { timeoutMs: PRAZO_POR_CHAMADA_MS, semRetry: true },
    );
  } catch (erro) {
    const situacao = situacaoDoErro(erro);
    const http =
      erro instanceof UazapiHttpError ? ` (HTTP ${erro.status})` : "";
    console.log(`${cabecalho}: leitura falhou, ${situacao}${http}`);
    return situacao;
  }

  console.log(`${cabecalho}: ${webhooks.length} webhook(s)`);
  let algumOk = false;
  let paraARota = 0;
  const alertasDoNumero: string[] = [];
  webhooks.forEach((webhook, indice) => {
    const analise = analisar(webhook, numero, segredo);
    console.log(`  [${indice + 1}]`);
    for (const linha of analise.linhas) {
      console.log(`      ${linha}`);
    }
    console.log(`      filtros: ${analise.filtrosOk ? "ok" : "revisar"}`);
    for (const alerta of analise.alertas) {
      console.log(`      alerta: ${alerta}`);
    }
    if (analise.apontaParaRota) {
      paraARota += 1;
      if (analise.filtrosOk) {
        algumOk = true;
      }
    }
  });
  if (webhooks.length === 0) {
    alertasDoNumero.push("nenhum webhook: nada desta instância chega ao app");
  } else if (paraARota === 0) {
    alertasDoNumero.push(`nenhum webhook aponta para ${CAMINHO_DA_ROTA}`);
  } else if (paraARota > 1) {
    alertasDoNumero.push(
      "mais de um webhook para a rota: cada evento chega repetido (a gravação é idempotente, mas a carga dobra)",
    );
  }
  for (const alerta of alertasDoNumero) {
    console.log(`  alerta: ${alerta}`);
  }
  const situacao: Situacao = algumOk ? "ok" : "revisar";
  console.log(`  veredito: ${situacao}`);
  return situacao;
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const admin = clienteDeServico();
  const { data, error } = await admin
    .from("whatsapp_account")
    .select("id, clinic_id, server_url, instance_id, connection_status")
    .is("removido_em", null)
    .eq("provider", "uazapi")
    .order("clinic_id")
    .order("id");
  if (error) {
    throw new Error(`Leitura dos números falhou (código ${error.code}).`);
  }
  const numeros = (data ?? []) as Numero[];
  if (numeros.length === 0) {
    console.log("Nenhum número ativo com o uazapi.");
    return;
  }

  const idsDasClinicas = [
    ...new Set(numeros.map((numero) => numero.clinic_id)),
  ];
  const [clinicas, segredos] = await Promise.all([
    admin.from("clinic").select("id, slug").in("id", idsDasClinicas),
    admin
      .from("whatsapp_account_secret")
      .select("account_id, instance_token, webhook_secret")
      .in(
        "account_id",
        numeros.map((numero) => numero.id),
      ),
  ]);
  if (clinicas.error || segredos.error) {
    throw new Error(
      `Leitura de clínicas ou segredos falhou (código ${clinicas.error?.code ?? segredos.error?.code}).`,
    );
  }
  const slugPorClinica = new Map(
    ((clinicas.data ?? []) as Array<{ id: string; slug: string }>).map(
      (clinica) => [clinica.id, clinica.slug] as const,
    ),
  );
  const segredoPorNumero = new Map(
    ((segredos.data ?? []) as Segredo[]).map(
      (segredo) => [segredo.account_id, segredo] as const,
    ),
  );

  console.log(
    `Conferência dos webhooks (só leitura): ${numeros.length} número(s) ativo(s) com o uazapi.`,
  );
  const provider = new UazapiProvider();
  const contagem = new Map<Situacao, number>();
  for (const [indice, numero] of numeros.entries()) {
    if (indice > 0) {
      await pausa(PAUSA_ENTRE_INSTANCIAS_MS);
    }
    const situacao = await conferir(
      provider,
      numero,
      segredoPorNumero.get(numero.id),
      slugPorClinica.get(numero.clinic_id) ?? numero.clinic_id.slice(0, 8),
    );
    contagem.set(situacao, (contagem.get(situacao) ?? 0) + 1);
  }

  console.log("Resumo:");
  for (const [situacao, quantos] of contagem) {
    console.log(`  ${situacao.padEnd(24)} ${quantos}`);
  }
  if ((contagem.get("ok") ?? 0) < numeros.length) {
    process.exitCode = 1;
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : "Falha inesperada.");
  process.exitCode = 1;
});
