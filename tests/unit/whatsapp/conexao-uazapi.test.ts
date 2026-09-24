import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CanalNaoConfiguradoError,
  conexaoRecusadaNoAmbiente,
  getWhatsAppProvider,
  MENSAGEM_CANAL_NAO_CONFIGURADO,
  provedorDoAmbiente,
} from "@/lib/integrations/whatsapp/provider";
import type { InstanceRef } from "@/lib/integrations/whatsapp/provider";
import {
  UazapiHttpError,
  UazapiProvider,
} from "@/lib/integrations/whatsapp/uazapi";

// Revisao de liberacao de 24/09/2026.
//
// (27) connectInstance, getStatus e configureWebhook liam o CORPO de erro
// como status: um 401 ou 404 (instancia apagada no servidor compartilhado)
// virava "desconectado" mudo, sem QR e sem mensagem, e o webhook recusado
// passava calado.
// (30) Sem WHATSAPP_PROVIDER, producao caia no provedor falso em silencio.

const REF: InstanceRef = {
  clinicId: "clinica-teste",
  serverUrl: "https://uazapi.exemplo",
  instanceToken: "token-instancia",
};

function responder(status: number, body: unknown = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

function uazapi(fetchFn: typeof fetch): UazapiProvider {
  return new UazapiProvider({ fetchFn });
}

async function erroDe(promessa: Promise<unknown>): Promise<UazapiHttpError> {
  try {
    await promessa;
  } catch (error) {
    if (error instanceof UazapiHttpError) {
      return error;
    }
    throw error;
  }
  throw new Error("esperava UazapiHttpError, mas a chamada passou");
}

describe("operações de instância olham o status HTTP", () => {
  it("401 no conectar vira instância inválida, não 'desconectado'", async () => {
    const erro = await erroDe(
      uazapi(responder(401, { error: "invalid token" })).connectInstance(REF),
    );
    expect(erro.status).toBe(401);
    expect(erro.operacao).toBe("conectar");
    expect(erro.motivo).toBe("instancia_invalida");
    // So operacao e codigo: o corpo da resposta nao entra na mensagem.
    expect(erro.message).not.toContain("invalid token");
  });

  it("404 no status também é instância inválida", async () => {
    const erro = await erroDe(uazapi(responder(404)).getStatus(REF));
    expect(erro.operacao).toBe("status");
    expect(erro.motivo).toBe("instancia_invalida");
  });

  it("409 é pareamento em andamento; 429 é limite de conexões", async () => {
    expect(
      (await erroDe(uazapi(responder(409)).connectInstance(REF))).motivo,
    ).toBe("fluxo_em_andamento");
    expect(
      (await erroDe(uazapi(responder(429)).connectInstance(REF))).motivo,
    ).toBe("limite_de_conexoes");
  });

  it("webhook recusado lança, em vez de passar calado", async () => {
    const erro = await erroDe(
      uazapi(responder(401)).configureWebhook(REF, "https://exemplo/webhook"),
    );
    expect(erro.operacao).toBe("webhook");
    expect(erro.motivo).toBe("instancia_invalida");
    const outro = await erroDe(
      uazapi(responder(400)).configureWebhook(REF, "https://exemplo/webhook"),
    );
    expect(outro.motivo).toBe("recusado");
  });

  it("2xx continua lendo o status normalmente", async () => {
    const status = await uazapi(
      responder(200, {
        instance: { status: "connecting", qrcode: "data:image/png;base64,AAA" },
      }),
    ).connectInstance(REF);
    expect(status.status).toBe("aguardando_qr");
    expect(status.qrCode).toBe("data:image/png;base64,AAA");
  });

  it("criar instância recusada pelo token administrativo chega tipada", async () => {
    process.env.UAZAPI_ADMIN_TOKEN = "admin-de-teste";
    const erro = await erroDe(
      uazapi(responder(401)).createInstance(REF, "conduzza_x"),
    );
    expect(erro.operacao).toBe("criar");
    expect(erro.status).toBe(401);
  });
});

describe("provedor em produção nunca cai no falso", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fora de produção, sem configuração, continua o falso", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("WHATSAPP_PROVIDER", "");
    expect(provedorDoAmbiente()).toBe("fake");
    expect(getWhatsAppProvider().name).toBe("fake");
  });

  it("em produção sem WHATSAPP_PROVIDER, recusa com texto claro", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("WHATSAPP_PROVIDER", "");
    expect(provedorDoAmbiente()).toBeNull();
    expect(() => getWhatsAppProvider()).toThrow(CanalNaoConfiguradoError);
    expect(() => getWhatsAppProvider()).toThrow(MENSAGEM_CANAL_NAO_CONFIGURADO);
  });

  it("em produção, 'fake' no ambiente ou gravado na conta não conecta", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("WHATSAPP_PROVIDER", "fake");
    expect(provedorDoAmbiente()).toBeNull();
    expect(() => getWhatsAppProvider()).toThrow(CanalNaoConfiguradoError);
    vi.stubEnv("WHATSAPP_PROVIDER", "uazapi");
    expect(conexaoRecusadaNoAmbiente("fake")).toBe(true);
    expect(conexaoRecusadaNoAmbiente("uazapi")).toBe(false);
  });

  it("fora de produção a conexão com o fake continua liberada", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(conexaoRecusadaNoAmbiente("fake")).toBe(false);
  });

  it("em produção com uazapi configurado, segue normal", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("WHATSAPP_PROVIDER", "uazapi");
    expect(provedorDoAmbiente()).toBe("uazapi");
    expect(getWhatsAppProvider("uazapi").name).toBe("uazapi");
    expect(getWhatsAppProvider().name).toBe("uazapi");
  });
});
