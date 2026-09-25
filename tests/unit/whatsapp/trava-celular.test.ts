import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BancoFalso, type Linha } from "./banco-falso";

// Trava contra o MESMO celular em duas instancias, depois da revisao da Fase 2
// (docs/07_multiplos_numeros_whatsapp.md; achados N[1] e N[2]). Prova, contra
// um banco em memoria e um servidor uazapi falso por fetch:
//   - a recusa corta PELO NOSSO LADO: o webhook_secret gira (a URL antiga
//     passa a receber 401) e o instance_token fica;
//   - o desligamento no provedor so conta com 2xx, e sem ele sai o evento
//     proprio whatsapp_trava_sem_desligar;
//   - numero conectado sem telefone (nome de perfil ou nulo) e desconhecido:
//     o provedor e consultado e o telefone gravado antes de decidir;
//   - o evento "conectado" do webhook passa pela mesma trava, e o que ela
//     nao consegue confirmar volta 503 para o provedor reenviar;
//   - quando o webhook recusa primeiro, a consulta seguinte do dialogo mostra
//     o motivo, que mora na trilha (achado M[0] da revisao das Fases 3 e 4);
//   - a mensagem recebida por numero ainda nao conectado so entra depois da
//     trava (achado M[5]);
//   - "conectando" so vale no pareamento aberto pelo QR: a sessao ja pareada
//     que reconecta nao cai na espera da porta (achado T[0] da revisao da
//     trava);
//   - fora do pareamento, a porta consulta o provedor uma vez so e com prazo
//     curto (achado T[1]);
//   - so a linha de sistema da trilha (user_id nulo) vira motivo (achado
//     T[2]);
//   - o nome de perfil nunca vira telefone no parse do uazapi.

const CLINICA_A = "0a0a0a0a-0000-4000-8000-00000000000a";
const CLINICA_B = "0b0b0b0b-0000-4000-8000-00000000000b";
const TEXTO_OUTRA_CONTA =
  "Este número já está conectado em outra conta do Conduzza. Fale com o suporte.";

const banco = new BancoFalso();
const sessao = {
  userId: "usuario-da-sessao",
  userName: "Pessoa da sessão",
  active: {
    clinicId: CLINICA_A,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "admin" as string,
    status: "ativo",
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => banco.cliente(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.cliente(),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([
      ["origin", "https://app.exemplo.test"],
      ["host", "app.exemplo.test"],
    ]),
}));
// A rota importa a ingestao e o interceptador; o evento de conexao nao passa
// por nenhum dos dois.
vi.mock("@/lib/integrations/whatsapp/ingest", () => ({
  ingerirMensagemRecebida: vi.fn(),
}));
vi.mock("@/lib/integrations/whatsapp/interceptar-resposta", () => ({
  interceptarRespostaDePaciente: vi.fn(),
}));

const { checarConexaoAction, connectWhatsAppAction, pollWhatsAppStatusAction } =
  await import("@/lib/actions/whatsapp-connect");
const { POST } = await import("@/app/api/webhooks/whatsapp/route");
const {
  motivoDaRecusaVigente,
  TEXTO_CELULAR_EM_OUTRO_NUMERO,
  TEXTO_SEM_CONFIRMACAO,
} = await import("@/lib/integrations/whatsapp/trava-celular");
const { UazapiHttpError, UazapiProvider } =
  await import("@/lib/integrations/whatsapp/uazapi");
const { ingerirMensagemRecebida } =
  await import("@/lib/integrations/whatsapp/ingest");
const ingerir = vi.mocked(ingerirMensagemRecebida);

type Chamada = { caminho: string; method: string; token: string | null };
type Resposta = { status: number; body?: unknown };

/** Servidor uazapi falso: responde por "METODO /caminho" e registra tudo. */
function servidorUazapi(
  respostas: Record<string, (chamada: Chamada) => Resposta> = {},
): Chamada[] {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const cabecalhos = (init?.headers ?? {}) as Record<string, string>;
      const chamada: Chamada = {
        caminho: new URL(String(url)).pathname,
        method: init?.method ?? "GET",
        token: cabecalhos.token ?? null,
      };
      chamadas.push(chamada);
      const resposta = respostas[`${chamada.method} ${chamada.caminho}`]?.(
        chamada,
      ) ?? { status: 200, body: {} };
      return new Response(JSON.stringify(resposta.body ?? {}), {
        status: resposta.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return chamadas;
}

/** GET /instance/status respondido por token de instancia. */
function statusPorToken(
  porToken: Record<string, Resposta>,
): Record<string, (chamada: Chamada) => Resposta> {
  return {
    "GET /instance/status": (chamada) =>
      porToken[chamada.token ?? ""] ?? { status: 404 },
  };
}

function usarUazapi(): void {
  vi.stubEnv("WHATSAPP_PROVIDER", "uazapi");
  vi.stubEnv("UAZAPI_SERVER_URL", "https://uazapi.exemplo.test");
  vi.stubEnv("UAZAPI_ADMIN_TOKEN", "token-admin");
}

function conectadoCom(owner: string): Resposta {
  return {
    status: 200,
    body: {
      instance: { status: "connected", owner: `${owner}@s.whatsapp.net` },
    },
  };
}

const escritas: string[] = [];

/** Eventos de log escritos durante o teste (stdout e stderr). */
function logs(): Linha[] {
  return escritas
    .flatMap((texto) => texto.split("\n"))
    .filter((linha) => linha.startsWith("{"))
    .map((linha) => JSON.parse(linha) as Linha);
}

function evento(nome: string): Linha | undefined {
  return logs().find((linha) => linha.evento === nome);
}

function chamou(chamadas: Chamada[], caminho: string): boolean {
  return chamadas.some((chamada) => chamada.caminho === caminho);
}

/** O numero da clinica A no meio do pareamento, com instancia e segredo. */
function numeroEmPareamento(status = "aguardando_qr"): {
  numero: Linha;
  segredo: Linha;
} {
  const numero = banco.numero({
    clinic_id: CLINICA_A,
    provider: "uazapi",
    connection_status: status,
  });
  const segredo = banco.segredo({
    clinic_id: CLINICA_A,
    account_id: numero.id as string,
    instance_token: "tok-a",
    webhook_secret: "segredo-antigo",
  });
  return { numero, segredo };
}

/** Numero conectado da clinica B, com o que a busca da trava devolve. */
function numeroDaOutraClinica(displayPhone: string | null): Linha {
  const numero = banco.numero({
    clinic_id: CLINICA_B,
    provider: "uazapi",
    connection_status: "conectado",
    display_phone: displayPhone,
  });
  banco.segredo({
    clinic_id: CLINICA_B,
    account_id: numero.id as string,
    instance_token: "tok-b",
  });
  return numero;
}

function pedido(query: string, corpo: unknown): NextRequest {
  return new NextRequest(
    `https://exemplo.test/api/webhooks/whatsapp?${query}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    },
  );
}

function urlDoNumero(numero: Linha, segredo: string): string {
  return `clinic=${numero.clinic_id as string}&account=${numero.id as string}&secret=${segredo}`;
}

/** Evento de conexao como o uazapi manda, com o token da instancia. */
function eventoConectado(token: string) {
  return { EventType: "connection", token, instance: { status: "connected" } };
}

/** O mesmo evento com a instancia ainda conectando. */
function eventoConectando(token: string) {
  return {
    EventType: "connection",
    token,
    instance: { status: "connecting" },
  };
}

/** A ingestao (simulada) grava a mensagem. */
function ingestaoInserida(): void {
  ingerir.mockResolvedValue({
    data: {
      inserted: true,
      contact_id: null,
      contact_created: false,
      conversation_id: null,
      message_id: "mensagem-1",
      whatsapp_account_id: null,
    },
    error: null,
  } as unknown as Awaited<ReturnType<typeof ingerirMensagemRecebida>>);
}

/** Mensagem de paciente como o uazapi manda, com o token da instancia. */
function mensagemRecebida(token: string) {
  return {
    EventType: "messages",
    token,
    message: {
      messageid: "wa-trava-1",
      chatid: "5584970000001@s.whatsapp.net",
      sender_pn: "5584970000001@s.whatsapp.net",
      senderName: "Paciente",
      fromMe: false,
      type: "text",
      messageType: "ExtendedTextMessage",
      text: "Bom dia",
    },
  };
}

/**
 * GET /instance/status do numero da clinica A: conectado com `owner` ate o
 * provedor receber o desligamento, e desconectado depois dele.
 */
function instanciaQueDesliga(
  owner: string,
): Record<string, (chamada: Chamada) => Resposta> {
  let desligada = false;
  return {
    "GET /instance/status": (chamada) => {
      if (chamada.token !== "tok-a") {
        return { status: 404 };
      }
      return desligada
        ? { status: 200, body: { instance: { status: "disconnected" } } }
        : conectadoCom(owner);
    },
    "POST /instance/disconnect": () => {
      desligada = true;
      return { status: 200 };
    },
  };
}

beforeEach(() => {
  banco.limpar();
  // Clinicas diferentes, um numero cada: o unique temporario nao atrapalha.
  banco.uniqueTemporario = false;
  sessao.active.role = "admin";
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("WHATSAPP_PROVIDER", "");
  ingerir.mockReset();
  escritas.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation((texto) => {
    escritas.push(String(texto));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((texto) => {
    escritas.push(String(texto));
    return true;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("recusa corta pelo nosso lado (N[1])", () => {
  it("gira o segredo do webhook, mantém o token, e a URL antiga passa a receber 401", async () => {
    usarUazapi();
    numeroDaOutraClinica("558499990000");
    const { numero, segredo } = numeroEmPareamento();
    const chamadas = servidorUazapi(
      statusPorToken({ "tok-a": conectadoCom("5584999990000") }),
    );

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado).toMatchObject({
      status: "desconectado",
      error: TEXTO_OUTRA_CONTA,
    });
    expect(numero.connection_status).toBe("desconectado");
    expect(segredo.webhook_secret).not.toBe("segredo-antigo");
    expect(segredo.webhook_secret).toMatch(/^[0-9a-f]{64}$/);
    // O token fica: a rota confere o token quando ele esta guardado.
    expect(segredo.instance_token).toBe("tok-a");
    expect(chamou(chamadas, "/instance/disconnect")).toBe(true);
    expect(evento("whatsapp_trava_sem_desligar")).toBeUndefined();

    // A instancia continua com a URL antiga gravada: agora ela recebe 401.
    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );
    expect(resposta.status).toBe(401);
  });

  it("desligamento não confirmado pelo provedor: grava desconectado mesmo assim e registra evento próprio", async () => {
    usarUazapi();
    numeroDaOutraClinica("558499990000");
    const { numero, segredo } = numeroEmPareamento();
    servidorUazapi({
      ...statusPorToken({ "tok-a": conectadoCom("5584999990000") }),
      // Antes um 409 aqui voltava como sucesso.
      "POST /instance/disconnect": () => ({ status: 409 }),
    });

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado.status).toBe("desconectado");
    expect(numero.connection_status).toBe("desconectado");
    expect(segredo.webhook_secret).not.toBe("segredo-antigo");
    const semDesligar = evento("whatsapp_trava_sem_desligar");
    expect(semDesligar).toMatchObject({
      nivel: "error",
      clinic_id: CLINICA_A,
      whatsapp_account_id: numero.id,
      provider: "uazapi",
      http_status: 409,
      error_code: "uazapi_409",
    });
    // Nada da outra clinica, nenhum telefone.
    expect(JSON.stringify(semDesligar)).not.toContain(CLINICA_B);
    expect(JSON.stringify(logs())).not.toContain("99990000");
  });
});

describe("número conectado sem telefone é desconhecido (N[2])", () => {
  it("nome de perfil no lugar do telefone: consulta o provedor, grava o telefone e recusa o duplicado", async () => {
    usarUazapi();
    const outro = numeroDaOutraClinica("Clínica Sorriso");
    const { numero } = numeroEmPareamento();
    const chamadas = servidorUazapi(
      statusPorToken({
        "tok-a": conectadoCom("5584999990000"),
        "tok-b": conectadoCom("558499990000"),
      }),
    );

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado).toMatchObject({
      status: "desconectado",
      error: TEXTO_OUTRA_CONTA,
    });
    expect(chamadas.some((chamada) => chamada.token === "tok-b")).toBe(true);
    // So o telefone: o status do outro numero nao e papel desta consulta.
    expect(outro.display_phone).toBe("558499990000");
    expect(outro.connection_status).toBe("conectado");
  });

  it("telefone nulo também é conferido; celular diferente passa e os dois ficam com telefone", async () => {
    usarUazapi();
    const outro = numeroDaOutraClinica(null);
    const { numero } = numeroEmPareamento();
    servidorUazapi(
      statusPorToken({
        "tok-a": conectadoCom("5584999990000"),
        "tok-b": conectadoCom("5584988880000"),
      }),
    );

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado.status).toBe("conectado");
    expect(estado.error).toBeUndefined();
    expect(numero.connection_status).toBe("conectado");
    expect(numero.display_phone).toBe("5584999990000");
    expect(outro.display_phone).toBe("5584988880000");
  });

  it("provedor sem resposta para o desconhecido: não confirma e não grava conectado", async () => {
    usarUazapi();
    numeroDaOutraClinica("Clínica Sorriso");
    const { numero, segredo } = numeroEmPareamento();
    const chamadas = servidorUazapi(
      statusPorToken({
        "tok-a": conectadoCom("5584999990000"),
        "tok-b": { status: 403 },
      }),
    );

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado).toMatchObject({
      status: "conectando",
      error: TEXTO_SEM_CONFIRMACAO,
    });
    expect(numero.connection_status).toBe("aguardando_qr");
    expect(segredo.webhook_secret).toBe("segredo-antigo");
    expect(chamou(chamadas, "/instance/disconnect")).toBe(false);
    expect(evento("whatsapp_trava_numero_sem_telefone")).toMatchObject({
      clinic_id: CLINICA_B,
      error_code: "uazapi_403",
    });
  });

  it("instância que o servidor não reconhece mais (401) não bloqueia ninguém", async () => {
    usarUazapi();
    numeroDaOutraClinica("Clínica Sorriso");
    const { numero } = numeroEmPareamento();
    servidorUazapi(
      statusPorToken({
        "tok-a": conectadoCom("5584999990000"),
        "tok-b": { status: 401, body: { error: "invalid token" } },
      }),
    );

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado.status).toBe("conectado");
    expect(numero.connection_status).toBe("conectado");
  });

  it("pareamento novo sem telefone não é gravado, e o nome de perfil não vira telefone", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento();
    servidorUazapi(
      statusPorToken({
        "tok-a": {
          status: 200,
          body: {
            instance: { status: "connected", profileName: "Clínica 2024" },
          },
        },
      }),
    );

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado).toMatchObject({
      status: "conectando",
      error: TEXTO_SEM_CONFIRMACAO,
    });
    expect(numero.connection_status).toBe("aguardando_qr");
    expect(numero.display_phone).toBeNull();
  });
});

describe("evento de conexão do webhook passa pela trava", () => {
  it("mesmo celular em outra clínica: não grava conectado, gira o segredo e desliga a instância", async () => {
    usarUazapi();
    numeroDaOutraClinica("558499990000");
    const { numero, segredo } = numeroEmPareamento("desconectado");
    const chamadas = servidorUazapi(
      statusPorToken({ "tok-a": conectadoCom("5584999990000") }),
    );

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true, gravado: false });
    expect(numero.connection_status).toBe("desconectado");
    expect(numero.connected_at).toBeNull();
    expect(segredo.webhook_secret).not.toBe("segredo-antigo");
    expect(chamou(chamadas, "/instance/disconnect")).toBe(true);
    expect(evento("whatsapp_celular_em_outro_numero")).toMatchObject({
      clinic_id: CLINICA_A,
      status: "outra_clinica",
    });

    // O reenvio do mesmo evento, pela URL antiga, ja nao entra.
    const reenvio = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );
    expect(reenvio.status).toBe(401);
  });

  it("sem duplicado: grava conectado com o telefone que o provedor confirmou", async () => {
    usarUazapi();
    numeroDaOutraClinica("558488880000");
    const { numero } = numeroEmPareamento("desconectado");
    servidorUazapi(statusPorToken({ "tok-a": conectadoCom("5584999990000") }));

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );

    expect(resposta.status).toBe(200);
    expect(numero.connection_status).toBe("conectado");
    expect(numero.connected_at).not.toBeNull();
    expect(numero.display_phone).toBe("5584999990000");
  });

  it("provedor sem resposta: nada é gravado e o 503 faz o provedor reenviar (M[5])", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("desconectado");
    servidorUazapi(statusPorToken({ "tok-a": { status: 403 } }));

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );

    // Antes era 200, e ninguem conferia de novo: a reconexao sozinha ficava
    // "desconectado" com a instancia viva.
    expect(resposta.status).toBe(503);
    expect(numero.connection_status).toBe("desconectado");
    expect(evento("whatsapp_conexao_sem_confirmacao")).toMatchObject({
      clinic_id: CLINICA_A,
      whatsapp_account_id: numero.id,
      http_status: 403,
    });

    // O reenvio, com o provedor de volta, confere e grava.
    servidorUazapi(statusPorToken({ "tok-a": conectadoCom("5584999990000") }));
    const reenvio = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );
    expect(reenvio.status).toBe(200);
    expect(numero.connection_status).toBe("conectado");
    expect(numero.display_phone).toBe("5584999990000");
  });

  it("trava sem leitura do outro número: 503, nada gravado e nada cortado", async () => {
    usarUazapi();
    numeroDaOutraClinica("Clínica Sorriso");
    const { numero, segredo } = numeroEmPareamento();
    const chamadas = servidorUazapi(
      statusPorToken({
        "tok-a": conectadoCom("5584999990000"),
        "tok-b": { status: 403 },
      }),
    );

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );

    expect(resposta.status).toBe(503);
    expect(numero.connection_status).toBe("aguardando_qr");
    expect(segredo.webhook_secret).toBe("segredo-antigo");
    expect(chamou(chamadas, "/instance/disconnect")).toBe(false);
  });

  it("instância que o servidor não reconhece (404): 200, sem reenvio em laço", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("desconectado");
    servidorUazapi(statusPorToken({}));

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true, gravado: false });
    expect(numero.connection_status).toBe("desconectado");
  });

  it("número do simulador conecta sem consultar provedor nenhum", async () => {
    const numero = banco.numero({ clinic_id: CLINICA_A });
    banco.segredo({
      clinic_id: CLINICA_A,
      account_id: numero.id as string,
      webhook_secret: "segredo-fake",
    });
    const chamadas = servidorUazapi();

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-fake"), {
        kind: "connection_update",
        status: "conectado",
      }),
    );

    expect(resposta.status).toBe(200);
    expect(numero.connection_status).toBe("conectado");
    expect(chamadas).toHaveLength(0);
  });

  it("evento repetido com o número já conectado não consulta o provedor", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("conectado");
    numero.display_phone = "5584999990000";
    const chamadas = servidorUazapi();

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );

    expect(resposta.status).toBe(200);
    expect(chamadas).toHaveLength(0);
    expect(numero.connection_status).toBe("conectado");
  });

  it("desconexão continua sendo gravada direto, sem trava", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("conectado");
    const chamadas = servidorUazapi();

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), {
        EventType: "connection",
        token: "tok-a",
        instance: { status: "disconnected" },
      }),
    );

    expect(resposta.status).toBe(200);
    expect(numero.connection_status).toBe("desconectado");
    expect(chamadas).toHaveLength(0);
  });
});

describe("o webhook recusa primeiro e a tela ainda diz por quê (M[0])", () => {
  it("outra clínica: a consulta seguinte ao corte devolve o motivo, e a trilha não guarda nada de lá", async () => {
    usarUazapi();
    const outro = numeroDaOutraClinica("558499990000");
    const { numero } = numeroEmPareamento();
    servidorUazapi(instanciaQueDesliga("5584999990000"));

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );
    expect(resposta.status).toBe(200);
    expect(numero.connection_status).toBe("desconectado");

    // A consulta do dialogo so ve a instancia ja desligada.
    const estado = await pollWhatsAppStatusAction(numero.id as string);
    expect(estado).toMatchObject({
      status: "desconectado",
      error: TEXTO_OUTRA_CONTA,
    });
    // "Verificar agora" diz o mesmo.
    expect((await pollWhatsAppStatusAction(numero.id as string)).error).toBe(
      TEXTO_OUTRA_CONTA,
    );

    const trilha = banco.linhas("audit_log");
    expect(trilha).toEqual([
      {
        clinic_id: CLINICA_A,
        user_id: null,
        entity: "whatsapp_account",
        entity_id: numero.id,
        action: "recusou_celular_de_outra_clinica",
        created_at: numero.disconnected_at,
      },
    ]);
    expect(JSON.stringify(trilha)).not.toContain(CLINICA_B);
    expect(JSON.stringify(trilha)).not.toContain(outro.id as string);
  });

  it("mesma clínica: o nome do outro número é lido na hora da consulta", async () => {
    usarUazapi();
    const recepcao = banco.numero({
      clinic_id: CLINICA_A,
      provider: "uazapi",
      connection_status: "conectado",
      display_phone: "558499990000",
      nome: "Recepção 1",
    });
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      provider: "uazapi",
      connection_status: "aguardando_qr",
      nome: "Recepção 2",
      principal: false,
    });
    banco.segredo({
      clinic_id: CLINICA_A,
      account_id: numero.id as string,
      instance_token: "tok-a",
      webhook_secret: "segredo-antigo",
    });
    servidorUazapi(instanciaQueDesliga("5584999990000"));

    await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );
    expect(numero.connection_status).toBe("desconectado");

    // Renomeado depois da recusa: a tela diz o nome de agora.
    recepcao.nome = "Recepção Central";
    expect(await pollWhatsAppStatusAction(numero.id as string)).toMatchObject({
      status: "desconectado",
      error: "Este número já está conectado como Recepção Central.",
    });

    // Removido: a mensagem so diz que e desta clinica.
    recepcao.removido_em = "2026-09-25T12:00:00.000Z";
    expect((await pollWhatsAppStatusAction(numero.id as string)).error).toBe(
      TEXTO_CELULAR_EM_OUTRO_NUMERO,
    );
  });

  it("o motivo e o carimbo existem antes do desligamento: quem vê a instância desligada acha os dois", async () => {
    usarUazapi();
    numeroDaOutraClinica("558499990000");
    const { numero } = numeroEmPareamento();
    const noDesligamento: {
      status: unknown;
      carimbo: unknown;
      trilha: number;
    }[] = [];
    servidorUazapi({
      ...statusPorToken({ "tok-a": conectadoCom("5584999990000") }),
      "POST /instance/disconnect": () => {
        noDesligamento.push({
          status: numero.connection_status,
          carimbo: numero.disconnected_at,
          trilha: banco.linhas("audit_log").length,
        });
        return { status: 200 };
      },
    });

    await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );

    expect(noDesligamento).toHaveLength(1);
    expect(noDesligamento[0]!.status).toBe("desconectado");
    expect(noDesligamento[0]!.trilha).toBe(1);
    expect(noDesligamento[0]!.carimbo).toBe(
      banco.linhas("audit_log")[0]!.created_at,
    );
  });

  it("número já desconectado no banco quando a recusa chega: o carimbo passa a ser o da recusa", async () => {
    usarUazapi();
    numeroDaOutraClinica("558499990000");
    const { numero } = numeroEmPareamento();
    servidorUazapi(instanciaQueDesliga("5584999990000"));

    // O mesmo numero, ja "desconectado" no banco quando a recusa chega (o
    // evento de desconexao passou antes): o carimbo muda para o da recusa.
    numero.connection_status = "desconectado";
    numero.disconnected_at = "2026-09-01T00:00:00.000Z";

    await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );

    expect(numero.disconnected_at).not.toBe("2026-09-01T00:00:00.000Z");
    expect((await pollWhatsAppStatusAction(numero.id as string)).error).toBe(
      TEXTO_OUTRA_CONTA,
    );
  });

  it("pareamento novo depois da recusa: o QR que expira não repete o motivo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00.000Z"));
    usarUazapi();
    numeroDaOutraClinica("558499990000");
    const { numero } = numeroEmPareamento();
    servidorUazapi(instanciaQueDesliga("5584999990000"));

    await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), eventoConectado("tok-a")),
    );
    expect((await pollWhatsAppStatusAction(numero.id as string)).error).toBe(
      TEXTO_OUTRA_CONTA,
    );

    // Conectar de novo grava "aguardando_qr"; o QR expira sem leitura.
    vi.setSystemTime(new Date("2026-09-25T12:03:00.000Z"));
    numero.connection_status = "aguardando_qr";
    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado.status).toBe("desconectado");
    expect(estado.error).toBeUndefined();
    expect(numero.disconnected_at).toBe("2026-09-25T12:03:00.000Z");
  });

  it("desconexão comum, sem recusa: continua sem mensagem", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento();
    servidorUazapi(
      statusPorToken({
        "tok-a": {
          status: 200,
          body: { instance: { status: "disconnected" } },
        },
      }),
    );

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado.status).toBe("desconectado");
    expect(estado.error).toBeUndefined();
  });

  it("linha igual à da trava, mas gravada por um membro (user_id preenchido), não vira motivo (T[2])", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("desconectado");
    numero.disconnected_at = "2026-09-25T12:00:00.000Z";
    // O que a policy da trilha deixa uma recepcionista gravar pela API: a
    // mesma action e o carimbo que ela le em disconnected_at, com o PROPRIO
    // user_id.
    const forjada: Linha = {
      clinic_id: CLINICA_A,
      user_id: "recepcionista-da-clinica-a",
      entity: "whatsapp_account",
      entity_id: numero.id,
      action: "recusou_celular_de_outra_clinica",
      created_at: numero.disconnected_at,
    };
    banco.linhas("audit_log").push(forjada);
    servidorUazapi(
      statusPorToken({
        "tok-a": {
          status: 200,
          body: { instance: { status: "disconnected" } },
        },
      }),
    );
    const admin = banco.cliente() as unknown as SupabaseClient;
    const alvo = { clinicId: CLINICA_A, accountId: numero.id as string };

    expect(await motivoDaRecusaVigente(admin, alvo)).toBeNull();
    const estado = await pollWhatsAppStatusAction(numero.id as string);
    expect(estado.status).toBe("desconectado");
    expect(estado.error).toBeUndefined();

    // Controle: a MESMA linha, gravada pelo sistema (user_id nulo), vale.
    forjada.user_id = null;
    expect(await motivoDaRecusaVigente(admin, alvo)).toBe(TEXTO_OUTRA_CONTA);
  });
});

describe("a mensagem recebida respeita a trava (M[5])", () => {
  it("número conectado: entra sem consultar o provedor", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("conectado");
    const chamadas = servidorUazapi();
    ingestaoInserida();

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), mensagemRecebida("tok-a")),
    );

    expect(resposta.status).toBe(200);
    expect(ingerir).toHaveBeenCalledTimes(1);
    expect(chamadas).toHaveLength(0);
  });

  it("pareamento que a trava confirma: grava conectado e a mensagem entra", async () => {
    usarUazapi();
    numeroDaOutraClinica("558488880000");
    const { numero } = numeroEmPareamento();
    servidorUazapi(statusPorToken({ "tok-a": conectadoCom("5584999990000") }));
    ingestaoInserida();

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), mensagemRecebida("tok-a")),
    );

    expect(resposta.status).toBe(200);
    expect(ingerir).toHaveBeenCalledTimes(1);
    expect(numero.connection_status).toBe("conectado");
    expect(numero.connected_at).not.toBeNull();
    expect(numero.display_phone).toBe("5584999990000");
  });

  it("pareamento com o celular de outra clínica: a mensagem não entra e o número é cortado", async () => {
    usarUazapi();
    numeroDaOutraClinica("558499990000");
    const { numero, segredo } = numeroEmPareamento();
    const chamadas = servidorUazapi(
      statusPorToken({ "tok-a": conectadoCom("5584999990000") }),
    );

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), mensagemRecebida("tok-a")),
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ignorada: "celular_recusado" });
    expect(ingerir).not.toHaveBeenCalled();
    expect(numero.connection_status).toBe("desconectado");
    expect(segredo.webhook_secret).not.toBe("segredo-antigo");
    expect(chamou(chamadas, "/instance/disconnect")).toBe(true);

    // O reenvio da mesma mensagem, pela URL antiga, ja nao entra.
    const reenvio = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), mensagemRecebida("tok-a")),
    );
    expect(reenvio.status).toBe(401);
    expect(ingerir).not.toHaveBeenCalled();
  });

  it("pareamento que a trava não consegue decidir: 503 e nada entra", async () => {
    usarUazapi();
    numeroDaOutraClinica("Clínica Sorriso");
    const { numero } = numeroEmPareamento("conectando");
    servidorUazapi(
      statusPorToken({
        "tok-a": conectadoCom("5584999990000"),
        "tok-b": { status: 403 },
      }),
    );

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), mensagemRecebida("tok-a")),
    );

    expect(resposta.status).toBe(503);
    expect(ingerir).not.toHaveBeenCalled();
    expect(numero.connection_status).toBe("conectando");
    expect(evento("webhook_mensagem_adiada")).toMatchObject({
      clinic_id: CLINICA_A,
      whatsapp_account_id: numero.id,
      wa_message_id: "wa-trava-1",
      connection_status: "conectando",
      status: "sem_confirmacao",
    });
    // Nenhum conteudo da mensagem nem telefone no log.
    expect(JSON.stringify(logs())).not.toContain("Bom dia");
    expect(JSON.stringify(logs())).not.toContain("5584970000001");
  });

  it("número que caiu e voltou sem confirmação: a mensagem entra como antes", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("desconectado");
    numero.display_phone = "5584999990000";
    servidorUazapi(statusPorToken({ "tok-a": { status: 403 } }));
    ingestaoInserida();

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), mensagemRecebida("tok-a")),
    );

    expect(resposta.status).toBe(200);
    expect(ingerir).toHaveBeenCalledTimes(1);
    expect(numero.connection_status).toBe("desconectado");
  });

  it("número que caiu e voltou: a primeira mensagem confirma a reconexão", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("desconectado");
    numero.display_phone = "5584999990000";
    servidorUazapi(statusPorToken({ "tok-a": conectadoCom("5584999990000") }));
    ingestaoInserida();

    const resposta = await POST(
      pedido(urlDoNumero(numero, "segredo-antigo"), mensagemRecebida("tok-a")),
    );

    expect(resposta.status).toBe(200);
    expect(ingerir).toHaveBeenCalledTimes(1);
    expect(numero.connection_status).toBe("conectado");
  });
});

describe("'conectando' só vale no pareamento aberto pelo QR (T[0])", () => {
  it.each(["conectado", "desconectado"])(
    "'connecting' com o número %s não muda o status, e a mensagem seguinte entra com o provedor falhando",
    async (situacao) => {
      usarUazapi();
      const { numero } = numeroEmPareamento(situacao);
      numero.display_phone = "5584999990000";
      const chamadas = servidorUazapi(
        statusPorToken({ "tok-a": { status: 403 } }),
      );
      ingestaoInserida();
      const url = urlDoNumero(numero, "segredo-antigo");

      const reconectando = await POST(pedido(url, eventoConectando("tok-a")));

      expect(reconectando.status).toBe(200);
      expect(await reconectando.json()).toEqual({ ok: true, gravado: false });
      expect(numero.connection_status).toBe(situacao);
      expect(evento("whatsapp_conectando_fora_do_pareamento")).toMatchObject({
        clinic_id: CLINICA_A,
        whatsapp_account_id: numero.id,
        connection_status: situacao,
      });

      const resposta = await POST(pedido(url, mensagemRecebida("tok-a")));

      expect(resposta.status).toBe(200);
      expect(ingerir).toHaveBeenCalledTimes(1);
      expect(numero.connection_status).toBe(situacao);
      // Conectado passa direto; desconectado confere, o provedor falha e a
      // mensagem entra sem decisao, como antes.
      expect(chamadas).toHaveLength(situacao === "conectado" ? 0 : 1);
      expect(evento("webhook_mensagem_adiada")).toBeUndefined();
    },
  );

  it("o cenário do achado: reconexão sozinha, 'connected' com o provedor fora, e a mensagem do paciente entra", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("conectado");
    numero.display_phone = "5584999990000";
    const chamadas = servidorUazapi(
      statusPorToken({ "tok-a": { status: 503 } }),
    );
    ingestaoInserida();
    const url = urlDoNumero(numero, "segredo-antigo");

    expect((await POST(pedido(url, eventoConectando("tok-a")))).status).toBe(
      200,
    );
    expect((await POST(pedido(url, eventoConectado("tok-a")))).status).toBe(
      200,
    );
    const resposta = await POST(pedido(url, mensagemRecebida("tok-a")));

    expect(resposta.status).toBe(200);
    expect(ingerir).toHaveBeenCalledTimes(1);
    expect(numero.connection_status).toBe("conectado");
    expect(chamadas).toHaveLength(0);
  });

  it("'connecting' durante 'aguardando_qr' continua gravando 'conectando', e a mensagem sem decisão recebe 503", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("aguardando_qr");
    servidorUazapi(statusPorToken({ "tok-a": { status: 403 } }));
    const url = urlDoNumero(numero, "segredo-antigo");

    const lido = await POST(pedido(url, eventoConectando("tok-a")));

    expect(lido.status).toBe(200);
    expect(await lido.json()).toEqual({ ok: true });
    expect(numero.connection_status).toBe("conectando");
    expect(evento("whatsapp_conectando_fora_do_pareamento")).toBeUndefined();

    const resposta = await POST(pedido(url, mensagemRecebida("tok-a")));

    expect(resposta.status).toBe(503);
    expect(ingerir).not.toHaveBeenCalled();
    expect(evento("webhook_mensagem_adiada")).toMatchObject({
      whatsapp_account_id: numero.id,
      connection_status: "conectando",
      status: "sem_confirmacao",
    });
  });

  it("'Verificar conexão' com a sessão reconectando: o número conectado continua conectado", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("conectado");
    numero.display_phone = "5584999990000";
    numero.connected_at = "2026-09-02T14:01:00.000Z";
    servidorUazapi(
      statusPorToken({
        "tok-a": { status: 200, body: { instance: { status: "connecting" } } },
      }),
    );

    const checagem = await checarConexaoAction();

    expect(numero.connection_status).toBe("conectado");
    expect(numero.connected_at).toBe("2026-09-02T14:01:00.000Z");
    // A faixa aplica o que ficou no banco, sem piscar "conectando".
    expect(checagem.numeros).toMatchObject([
      { id: numero.id, connection_status: "conectado" },
    ]);
  });

  it("a consulta do diálogo não rebaixa o conectado, e no QR aberto grava 'conectando'", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("conectado");
    numero.display_phone = "5584999990000";
    servidorUazapi(
      statusPorToken({
        "tok-a": { status: 200, body: { instance: { status: "connecting" } } },
      }),
    );

    await pollWhatsAppStatusAction(numero.id as string);
    expect(numero.connection_status).toBe("conectado");

    // Com o QR na tela, o QR lido segue o caminho de sempre.
    numero.connection_status = "aguardando_qr";
    const estado = await pollWhatsAppStatusAction(numero.id as string);
    expect(estado.status).toBe("conectando");
    expect(numero.connection_status).toBe("conectando");
  });

  it("o Conectar abre o pareamento: 'conectando' sem QR é gravado mesmo vindo de desconectado", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("desconectado");
    servidorUazapi({
      "POST /instance/connect": () => ({
        status: 200,
        body: { instance: { status: "connecting", paircode: "ABCD-1234" } },
      }),
    });

    const estado = await connectWhatsAppAction(numero.id as string);

    expect(estado.status).toBe("conectando");
    expect(numero.connection_status).toBe("conectando");
  });
});

describe("fora do pareamento, a porta consulta o provedor curto (T[1])", () => {
  type Relogio = { inicios: number[]; abortos: number[] };

  /**
   * Provedor que nunca responde: cada chamada so termina quando o prazo dela
   * aborta. Registra, no relogio falso, quando cada uma comecou e abortou.
   */
  function provedorQueNaoResponde(): Relogio {
    const relogio: Relogio = { inicios: [], abortos: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        relogio.inicios.push(Date.now());
        return new Promise<Response>((_resolver, rejeitar) => {
          init?.signal?.addEventListener("abort", () => {
            relogio.abortos.push(Date.now());
            rejeitar(new DOMException("tempo esgotado", "AbortError"));
          });
        });
      }),
    );
    return relogio;
  }

  /** Manda o pedido e deixa o relogio falso correr ate ele responder. */
  async function comRelogioFalso(
    numero: Linha,
    corpo: unknown,
  ): Promise<{ resposta: Response; relogio: Relogio }> {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const relogio = provedorQueNaoResponde();
    const pendente = POST(pedido(urlDoNumero(numero, "segredo-antigo"), corpo));
    // So o relogio dos prazos e falso: o caminho ate o provedor anda sozinho.
    for (let volta = 0; volta < 200 && relogio.inicios.length === 0; volta++) {
      await new Promise((seguir) => setImmediate(seguir));
    }
    await vi.advanceTimersByTimeAsync(60_000);
    return { resposta: await pendente, relogio };
  }

  it("número desconectado: uma tentativa só, com prazo de 5 s, e a mensagem entra", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("desconectado");
    numero.display_phone = "5584999990000";
    ingestaoInserida();

    const { resposta, relogio } = await comRelogioFalso(
      numero,
      mensagemRecebida("tok-a"),
    );

    expect(resposta.status).toBe(200);
    expect(ingerir).toHaveBeenCalledTimes(1);
    expect(relogio.inicios).toHaveLength(1);
    expect(relogio.abortos).toHaveLength(1);
    expect(relogio.abortos[0]! - relogio.inicios[0]!).toBe(5_000);
    expect(numero.connection_status).toBe("desconectado");
  });

  it("pareamento: a mensagem continua com o padrão (10 s por tentativa, com novas tentativas)", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("aguardando_qr");

    const { resposta, relogio } = await comRelogioFalso(
      numero,
      mensagemRecebida("tok-a"),
    );

    expect(resposta.status).toBe(503);
    expect(ingerir).not.toHaveBeenCalled();
    expect(relogio.inicios).toHaveLength(3);
    expect(relogio.abortos[0]! - relogio.inicios[0]!).toBe(10_000);
  });

  it("evento de conexão do número desconectado: continua com o padrão", async () => {
    usarUazapi();
    const { numero } = numeroEmPareamento("desconectado");
    numero.display_phone = "5584999990000";

    const { resposta, relogio } = await comRelogioFalso(
      numero,
      eventoConectado("tok-a"),
    );

    expect(resposta.status).toBe(503);
    expect(relogio.inicios).toHaveLength(3);
    expect(relogio.abortos[0]! - relogio.inicios[0]!).toBe(10_000);
  });
});

describe("uazapi: desligar e ler o telefone", () => {
  const REF = {
    clinicId: CLINICA_A,
    serverUrl: "https://uazapi.exemplo.test",
    instanceToken: "tok-a",
  };

  function responder(status: number, body: unknown = {}): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
  }

  it("desconectar só conta com 2xx", async () => {
    await expect(
      new UazapiProvider({ fetchFn: responder(200) }).disconnect(REF),
    ).resolves.toBeUndefined();

    for (const status of [401, 409, 429]) {
      const erro = await new UazapiProvider({ fetchFn: responder(status) })
        .disconnect(REF)
        .then(
          () => null,
          (motivo: unknown) => motivo,
        );
      expect(erro).toBeInstanceOf(UazapiHttpError);
      expect((erro as InstanceType<typeof UazapiHttpError>).operacao).toBe(
        "desconectar",
      );
      expect((erro as InstanceType<typeof UazapiHttpError>).status).toBe(
        status,
      );
    }
  });

  it("o nome de perfil nunca vira telefone; owner e jid continuam valendo", async () => {
    const soNome = await new UazapiProvider({
      fetchFn: responder(200, {
        instance: { status: "connected", profileName: "Clínica 2024" },
      }),
    }).getStatus(REF);
    expect(soNome.displayPhone).toBeNull();

    const comOwner = await new UazapiProvider({
      fetchFn: responder(200, {
        instance: {
          status: "connected",
          owner: "5584999990000@s.whatsapp.net",
          profileName: "Clínica 2024",
        },
      }),
    }).getStatus(REF);
    expect(comOwner.displayPhone).toBe("5584999990000");

    const comJid = await new UazapiProvider({
      fetchFn: responder(200, {
        instance: { status: "connected", profileName: "Clínica 2024" },
        status: { jid: { user: "5584988880000" } },
      }),
    }).getStatus(REF);
    expect(comJid.displayPhone).toBe("5584988880000");
  });
});
