import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enviarEventoDoCliqueDoLink } from "@/lib/integrations/meta/evento-do-clique";

// O Contact do clique no link rastreado pelo servidor (etapa 3e do plano de
// 16/11/2026). Confere de novo, na hora do envio, que a clinica ainda tem o
// Pixel, o envio ligado e o token; manda para o Pixel certo com o codigo de
// teste; nunca lanca; e nunca escreve o IP, o navegador ou o token em log.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const PIXEL = "626829132163238";
const TOKEN = "EAAB-token-segredo-da-clinica";
const IP = "203.0.113.77";
const NAVEGADOR = "Mozilla/5.0 (iPhone) Instagram 350.0.0.0";
const CLIQUE = {
  clinicId: CLINICA,
  pixelId: PIXEL,
  eventId: "11111111-2222-4333-8444-555555555555",
  cliqueEmMs: 1_775_000_000_123,
  eventSourceUrl: "https://go.exemplo.com.br/l/k7q2mxab",
  userAgent: NAVEGADOR,
  ip: IP,
  fbclid: "IwAR0segredo",
};

let conta: Record<string, unknown> | null;
let segredo: Record<string, unknown> | null;
let pedidos: { url: string; corpo: Record<string, unknown> }[];
let escrito: string[];

function admin(): SupabaseClient {
  return {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: tabela === "meta_ads_account" ? conta : segredo,
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function fetchFalso(status = 200, corpo: unknown = { events_received: 1 }) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    pedidos.push({
      url: String(url),
      corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(corpo), { status });
  }) as typeof fetch;
}

beforeEach(() => {
  conta = { pixel_id: PIXEL, envio_ativado: true, test_event_code: "TEST123" };
  segredo = { capi_access_token: TOKEN };
  pedidos = [];
  escrito = [];
  const guardar = (pedaco: string | Uint8Array): boolean => {
    escrito.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(guardar);
  vi.spyOn(process.stderr, "write").mockImplementation(guardar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function nadaSensivelNoLog(): void {
  const tudo = escrito.join("");
  for (const segredoDoTeste of [TOKEN, IP, "iPhone", "IwAR0segredo", PIXEL]) {
    expect(tudo).not.toContain(segredoDoTeste);
  }
}

describe("enviarEventoDoCliqueDoLink", () => {
  it("manda o Contact de site para o Pixel da clínica, com o token e o código de teste", async () => {
    await enviarEventoDoCliqueDoLink(admin(), CLIQUE, fetchFalso());

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toMatch(
      new RegExp(`^https://graph\\.facebook\\.com/v[0-9.]+/${PIXEL}/events$`),
    );
    expect(pedidos[0]?.corpo).toMatchObject({
      access_token: TOKEN,
      test_event_code: "TEST123",
      data: [
        {
          event_name: "Contact",
          event_id: CLIQUE.eventId,
          action_source: "website",
          event_source_url: CLIQUE.eventSourceUrl,
          user_data: {
            client_user_agent: NAVEGADOR,
            client_ip_address: IP,
            fbc: "fb.1.1775000000123.IwAR0segredo",
          },
        },
      ],
    });
    expect(escrito.join("")).toContain('"status":"enviado"');
    nadaSensivelNoLog();
  });

  it("clínica que desligou o envio, trocou o Pixel ou ficou sem token: não chama a Meta", async () => {
    const casos = [
      () => {
        conta = { ...conta, envio_ativado: false };
      },
      () => {
        conta = { ...conta, pixel_id: "111111111111111" };
      },
      () => {
        segredo = { capi_access_token: null };
      },
      () => {
        conta = null;
      },
    ];
    for (const preparar of casos) {
      conta = { pixel_id: PIXEL, envio_ativado: true, test_event_code: null };
      segredo = { capi_access_token: TOKEN };
      preparar();
      await enviarEventoDoCliqueDoLink(admin(), CLIQUE, fetchFalso());
    }
    expect(pedidos).toEqual([]);
    expect(escrito.join("")).toContain('"status":"sem_configuracao"');
  });

  it("a Meta recusa (token inválido): vira log com código, sem lançar e sem dado do visitante", async () => {
    await expect(
      enviarEventoDoCliqueDoLink(
        admin(),
        CLIQUE,
        fetchFalso(400, { error: { code: 190 } }),
      ),
    ).resolves.toBeUndefined();
    expect(escrito.join("")).toContain('"error_code":"token_invalido"');
    nadaSensivelNoLog();
  });

  it("banco fora: não lança (o visitante já seguiu para o WhatsApp)", async () => {
    const quebrado = {
      from: () => {
        throw new Error("fora");
      },
    } as unknown as SupabaseClient;
    await expect(
      enviarEventoDoCliqueDoLink(quebrado, CLIQUE, fetchFalso()),
    ).resolves.toBeUndefined();
    expect(pedidos).toEqual([]);
  });
});
