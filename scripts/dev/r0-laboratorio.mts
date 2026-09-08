/**
 * R0: arma o laboratorio que prova se a uazapi entrega o ctwa_clid.
 *
 * Metodo A do docs/07_r0_captura_ctwa_uazapi.md: instancia de laboratorio com
 * numero de TESTE, webhook apontando para um coletor descartavel (webhook.site)
 * e um anuncio Click-to-WhatsApp de orcamento minimo apontando para esse
 * numero. Nenhum codigo de producao muda e nenhum dado de paciente circula: o
 * numero e de teste e quem manda a mensagem e o proprio operador.
 *
 * NAO DESLIGUE O TINTIM antes de este teste dar positivo (docs/07). O Tintim
 * captura o ctwa_clid pela API oficial; a uazapi e nao oficial e pode nao
 * entregar. Este teste e o que decide.
 *
 * Uso:
 *   npx tsx scripts/dev/r0-laboratorio.mts            # cria tudo e imprime o QR
 *   npx tsx scripts/dev/r0-laboratorio.mts status     # estado atual + QR de novo
 *   npx tsx scripts/dev/r0-laboratorio.mts limpar     # APAGA a instancia de lab
 *
 * O estado (token da instancia, URL do coletor) fica em scripts/dev/.r0-lab.json,
 * que esta no .gitignore de proposito: e credencial de laboratorio, nao codigo.
 *
 * LIMPEZA OBRIGATORIA depois do R0: rode `limpar`. O servidor uazapi e
 * compartilhado com outros produtos e tem teto de instancias; laboratorio
 * esquecido ocupa a vaga de uma clinica real.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ESTADO_PATH = join(process.cwd(), "scripts/dev/.r0-lab.json");
const NOME_INSTANCIA = "conduzza_lab_r0";

function carregarEnv(): void {
  const caminho = join(process.cwd(), ".env.local");
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const igual = linha.indexOf("=");
    if (igual < 1 || linha.trimStart().startsWith("#")) continue;
    const chave = linha.slice(0, igual).trim();
    const valor = linha.slice(igual + 1).trim();
    if (/^[A-Z0-9_]+$/.test(chave) && valor && !process.env[chave]) {
      process.env[chave] = valor;
    }
  }
}
carregarEnv();

type Estado = {
  instanceToken: string;
  coletorId: string;
  coletorUrl: string;
  inspecaoUrl: string;
};

function baseUazapi(): string {
  const url = process.env.UAZAPI_SERVER_URL;
  if (!url) {
    throw new Error("UAZAPI_SERVER_URL ausente no .env.local");
  }
  return (/^https?:\/\//.test(url) ? url : `https://${url}`).replace(/\/$/, "");
}

async function uazapi(
  path: string,
  opts: {
    method?: "GET" | "POST" | "DELETE";
    payload?: Record<string, unknown>;
    token?: string;
    admin?: boolean;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.admin) {
    const adminToken = process.env.UAZAPI_ADMIN_TOKEN;
    if (!adminToken) throw new Error("UAZAPI_ADMIN_TOKEN ausente no .env.local");
    headers.admintoken = adminToken;
  } else if (opts.token) {
    headers.token = opts.token;
  }
  const res = await fetch(`${baseUazapi()}${path}`, {
    method: opts.method ?? "POST",
    headers,
    body: (opts.method ?? "POST") === "GET" ? undefined : JSON.stringify(opts.payload ?? {}),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

function achar(body: Record<string, unknown>, caminhos: string[]): string | null {
  for (const caminho of caminhos) {
    let atual: unknown = body;
    for (const chave of caminho.split(".")) {
      if (atual && typeof atual === "object" && chave in atual) {
        atual = (atual as Record<string, unknown>)[chave];
      } else {
        atual = undefined;
        break;
      }
    }
    if (typeof atual === "string" && atual.length > 0) return atual;
  }
  return null;
}

function lerEstado(): Estado | null {
  if (!existsSync(ESTADO_PATH)) return null;
  return JSON.parse(readFileSync(ESTADO_PATH, "utf8")) as Estado;
}

async function criarColetor(): Promise<Pick<Estado, "coletorId" | "coletorUrl" | "inspecaoUrl">> {
  // O webhook.site cria um endpoint descartavel por chamada. So trafego de
  // laboratorio passa por ele: numero de teste, mensagem do proprio operador.
  const res = await fetch("https://webhook.site/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ default_status: 200, default_content: "ok" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`webhook.site recusou: ${res.status}`);
  }
  const body = (await res.json()) as { uuid: string };
  return {
    coletorId: body.uuid,
    coletorUrl: `https://webhook.site/${body.uuid}`,
    inspecaoUrl: `https://webhook.site/#!/view/${body.uuid}`,
  };
}

async function imprimirStatus(estado: Estado): Promise<void> {
  const { body } = await uazapi("/instance/status", {
    method: "GET",
    token: estado.instanceToken,
  });
  const status = achar(body, ["instance.status", "status"]) ?? "?";
  const qr = achar(body, ["instance.qrcode", "qrcode"]);
  const numero = achar(body, ["instance.owner", "owner"]);
  console.log(`instancia ${NOME_INSTANCIA}: ${status}${numero ? ` (numero ${numero})` : ""}`);
  if (qr && status !== "connected") {
    const arquivo = join(process.cwd(), "scripts/dev/.r0-qr.txt");
    writeFileSync(arquivo, qr);
    console.log(`QR (base64) gravado em scripts/dev/.r0-qr.txt`);
    console.log("Para ver: cole o conteudo num visualizador de data URI, ou rode");
    console.log("  npx tsx -e \"const s=require('fs').readFileSync('scripts/dev/.r0-qr.txt','utf8');console.log(s.slice(0,80)+'...')\"");
  }
  console.log(`coletor: ${estado.inspecaoUrl}`);
}

async function armar(): Promise<void> {
  let estado = lerEstado();
  if (estado) {
    console.log("Laboratorio ja existe; mostrando o estado.\n");
    await imprimirStatus(estado);
    imprimirChecklist(estado);
    return;
  }

  console.log("1. criando o coletor descartavel no webhook.site");
  const coletor = await criarColetor();
  console.log(`   ${coletor.inspecaoUrl}`);

  console.log("2. criando a instancia de laboratorio no servidor uazapi");
  const criada = await uazapi("/instance/create", {
    payload: { name: NOME_INSTANCIA },
    admin: true,
  });
  if (criada.status === 429) {
    // Servidor compartilhado com teto de instancias: parar e avisar, nunca
    // insistir ocupando a vaga de uma clinica real.
    throw new Error(
      "O servidor uazapi atingiu o teto de instancias. Nao insisti: fale com o dono do servidor antes de criar o laboratorio.",
    );
  }
  const token = achar(criada.body, ["token", "instance.token"]);
  if (!token) {
    throw new Error(
      `instance/create nao devolveu token (status ${criada.status}): ${JSON.stringify(criada.body).slice(0, 300)}`,
    );
  }

  estado = { instanceToken: token, ...coletor };
  writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2));

  console.log("3. apontando o webhook da instancia para o coletor");
  // SEM excludeMessages: no laboratorio queremos ver TUDO que a uazapi manda,
  // inclusive o que a producao filtra. E so evento 'messages': conexao e
  // recibo nao interessam ao R0.
  await uazapi("/webhook", {
    token,
    payload: { enabled: true, url: estado.coletorUrl, events: ["messages"] },
  });

  console.log("4. abrindo o pareamento (QR)");
  await uazapi("/instance/connect", { token, payload: {} });
  await imprimirStatus(estado);
  imprimirChecklist(estado);
}

function imprimirChecklist(estado: Estado): void {
  console.log(`
== O que falta, e e com o dono ==
1. Parear o NUMERO DE TESTE: escaneie o QR acima com o WhatsApp dele.
   (rode 'status' para renovar o QR se expirar)
2. Subir um anuncio Click-to-WhatsApp de orcamento minimo na conta da Meta,
   apontando para esse numero de teste.
3. Do celular, CLICAR NO ANUNCIO e mandar a primeira mensagem.
4. Me avisar: eu leio o payload em ${estado.inspecaoUrl}
   procurando ctwa_clid / referral / externalAdReply / sourceId
   (tabela de leitura no docs/07).

Depois do teste: npx tsx scripts/dev/r0-laboratorio.mts limpar
(o servidor e compartilhado; laboratorio esquecido ocupa vaga de clinica real)
`);
}

async function limpar(): Promise<void> {
  const estado = lerEstado();
  if (!estado) {
    console.log("Nada a limpar: sem estado de laboratorio.");
    return;
  }
  console.log("desconectando e apagando a instancia de laboratorio");
  await uazapi("/instance/disconnect", { token: estado.instanceToken, payload: {} }).catch(() => {});
  // A OpenAPI expoe DELETE /instance para a propria instancia autenticada.
  const del = await uazapi("/instance", {
    method: "DELETE",
    token: estado.instanceToken,
  }).catch(() => ({ status: 0, body: {} as Record<string, unknown> }));
  console.log(`remocao da instancia: status ${del.status}`);
  unlinkSync(ESTADO_PATH);
  console.log("estado local apagado. O coletor do webhook.site expira sozinho.");
}

const comando = process.argv[2] ?? "armar";
const execucao =
  comando === "limpar"
    ? limpar()
    : comando === "status"
      ? (async () => {
          const estado = lerEstado();
          if (!estado) {
            console.log("Sem laboratorio. Rode sem argumentos para criar.");
            return;
          }
          await imprimirStatus(estado);
          imprimirChecklist(estado);
        })()
      : armar();

execucao.catch((erro) => {
  console.log("erro:", erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
});
