import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FRASE_PADRAO } from "@/lib/domain/rastreio-do-site";

// Rota publica GET das frases do rastreio do site (ajuste de 04/10/2026 na
// F1 do Google). O contrato com o mundo:
// - so chama o banco com a chave no formato (20 hexadecimais minusculos);
// - 200 com {"frases": [...]} e nada mais, Cache-Control public, max-age=300;
// - rastreio desligado, chave inexistente, chave fora do formato, saida fora
//   da regra, erro ou demora do banco: 404 sem corpo e no-store;
// - CORS aberto; nunca escreve a chave nem o texto das frases no log.

type RespostaDoBanco = { data: unknown; error: { code?: string } | null };

const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
const sinaisDeTempo: AbortSignal[] = [];
let respostaDoBanco: RespostaDoBanco | Error = {
  data: [FRASE_PADRAO],
  error: null,
};
let clienteQuebrado = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (clienteQuebrado) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY ausente no ambiente do servidor.",
      );
    }
    return {
      rpc: (nome: string, args: Record<string, unknown>) => {
        chamadas.push({ nome, args });
        return {
          abortSignal: (sinal: AbortSignal) => {
            sinaisDeTempo.push(sinal);
            return respostaDoBanco instanceof Error
              ? Promise.reject(respostaDoBanco)
              : Promise.resolve(respostaDoBanco);
          },
        };
      },
    };
  },
}));

const { GET, OPTIONS } =
  await import("@/app/api/publico/rastreio/[chave]/route");

const CHAVE = "0123456789abcdef0123";
const FRASE_DA_CLINICA = "Oi! Vi o anúncio e quero marcar uma avaliação.";
const OUTRA_FRASE =
  "Bom dia, gostaria de saber os horários (pode ser sábado?).";

let escrito: string[] = [];

function pedir(chave: string): Promise<Response> {
  const pedido = new NextRequest(
    `https://app.conduzza.test/api/publico/rastreio/${encodeURIComponent(chave)}`,
    { headers: { origin: "https://www.clinica.com.br" } },
  );
  return GET(pedido, { params: Promise.resolve({ chave }) });
}

async function esperar404(resposta: Response): Promise<void> {
  expect(resposta.status).toBe(404);
  expect(await resposta.text()).toBe("");
  expect(resposta.headers.get("access-control-allow-origin")).toBe("*");
  expect(resposta.headers.get("cache-control")).toBe("no-store");
}

function nadaSensivelNoLog(): void {
  const tudo = escrito.join("");
  expect(tudo).not.toContain(CHAVE);
  expect(tudo).not.toContain("anúncio");
  expect(tudo).not.toContain("Vim pelo site");
  expect(tudo).not.toContain("horários");
  for (const linha of escrito) {
    const campos = Object.keys(JSON.parse(linha) as Record<string, unknown>);
    for (const campo of campos) {
      expect([
        "ts",
        "nivel",
        "evento",
        "status",
        "count",
        "error_code",
      ]).toContain(campo);
    }
  }
}

beforeEach(() => {
  chamadas.length = 0;
  sinaisDeTempo.length = 0;
  respostaDoBanco = { data: [FRASE_PADRAO], error: null };
  clienteQuebrado = false;
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

describe("OPTIONS /api/publico/rastreio/[chave]", () => {
  it("204 sem corpo, com CORS aberto para GET", async () => {
    const resposta = OPTIONS();
    expect(resposta.status).toBe(204);
    expect(await resposta.text()).toBe("");
    expect(resposta.headers.get("access-control-allow-origin")).toBe("*");
    expect(resposta.headers.get("access-control-allow-methods")).toBe(
      "GET, OPTIONS",
    );
  });
});

describe("GET /api/publico/rastreio/[chave]", () => {
  it("chave ligada: 200 so com as frases, na ordem, cache curto e CORS", async () => {
    respostaDoBanco = {
      data: [FRASE_DA_CLINICA, OUTRA_FRASE],
      error: null,
    };
    const resposta = await pedir(CHAVE);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      frases: [FRASE_DA_CLINICA, OUTRA_FRASE],
    });
    expect(resposta.headers.get("cache-control")).toBe("public, max-age=300");
    expect(resposta.headers.get("access-control-allow-origin")).toBe("*");
    expect(resposta.headers.get("content-type")).toMatch(/application\/json/);
    expect(resposta.headers.get("x-content-type-options")).toBe("nosniff");
    expect(resposta.headers.get("set-cookie")).toBeNull();
    expect(chamadas).toEqual([
      { nome: "frases_do_rastreio", args: { p_chave: CHAVE } },
    ]);
    // Timeout explicito na chamada ao banco.
    expect(sinaisDeTempo).toHaveLength(1);
    expect(sinaisDeTempo[0]?.aborted).toBe(false);
    expect(escrito.join("")).toContain('"status":"ok"');
    expect(escrito.join("")).toContain('"count":2');
    nadaSensivelNoLog();
  });

  it("a frase de fabrica sai como esta, com acento", async () => {
    const resposta = await pedir(CHAVE);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ frases: [FRASE_PADRAO] });
  });

  it("desligado, inexistente ou chave velha (null): 404 sem corpo", async () => {
    respostaDoBanco = { data: null, error: null };
    await esperar404(await pedir(CHAVE));
    expect(chamadas).toHaveLength(1);
    expect(escrito.join("")).toContain('"status":"sem_frases"');
    nadaSensivelNoLog();
  });

  it("chave fora do formato nem chega ao banco", async () => {
    for (const chave of [
      "",
      "slug-da-clinica",
      CHAVE.toUpperCase(),
      CHAVE.slice(0, 19),
      `${CHAVE}0`,
      ` ${CHAVE}`,
      `${CHAVE}\n`,
      `${CHAVE.slice(0, 19)}%`,
      "../../clique",
      "０123456789abcdef0123",
    ]) {
      await esperar404(await pedir(chave));
    }
    expect(chamadas).toHaveLength(0);
    expect(escrito.join("")).toContain('"status":"chave_fora_do_formato"');
  });

  it("parametro a mais (rota mal montada): 404 sem banco", async () => {
    const pedido = new NextRequest(
      `https://app.conduzza.test/api/publico/rastreio/${CHAVE}`,
    );
    const params = Promise.resolve({ chave: CHAVE, clinic_id: "x" });
    await esperar404(await GET(pedido, { params }));
    expect(chamadas).toHaveLength(0);
  });

  it("saida fora da regra do banco: 404, como se nao houvesse frases", async () => {
    const estranhas: unknown[] = [
      [],
      ["1", "2", "3", "4", "5", "6"],
      [""],
      ["   "],
      ["a".repeat(301)],
      ["Quero agendar #AGENDA"],
      ["Quero [agendar]"],
      ["linha um\nlinha dois"],
      ["com\rretorno"],
      ["com\ttab"],
      ["com\u2028separador"],
      ["com\u0085controle C1"],
      [FRASE_PADRAO, null],
      [FRASE_PADRAO, 123],
      FRASE_PADRAO,
      { frases: [FRASE_PADRAO] },
      123,
    ];
    for (const data of estranhas) {
      respostaDoBanco = { data, error: null };
      await esperar404(await pedir(CHAVE));
    }
    expect(chamadas).toHaveLength(estranhas.length);
    expect(escrito.join("")).toContain('"status":"fora_da_regra"');
    nadaSensivelNoLog();
  });

  it("conta caracteres como o banco: 300 emojis passam, 301 nao", async () => {
    const trezentos = "😀".repeat(300);
    expect(trezentos.length).toBe(600);
    respostaDoBanco = { data: [trezentos], error: null };
    const resposta = await pedir(CHAVE);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ frases: [trezentos] });

    respostaDoBanco = { data: ["😀".repeat(301)], error: null };
    await esperar404(await pedir(CHAVE));
  });

  it("cinco frases de 300 caracteres passam", async () => {
    const cinco = ["a", "b", "c", "d", "e"].map((letra) => letra.repeat(300));
    respostaDoBanco = { data: cinco, error: null };
    const resposta = await pedir(CHAVE);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ frases: cinco });
  });

  it("erro do banco (42501, por exemplo): 404, log so com o codigo", async () => {
    respostaDoBanco = { data: null, error: { code: "42501" } };
    await esperar404(await pedir(CHAVE));
    const linha = escrito.find((l) => l.includes("frases_do_rastreio_falhou"));
    expect(JSON.parse(linha ?? "{}")).toMatchObject({
      nivel: "error",
      error_code: "42501",
    });
    nadaSensivelNoLog();
  });

  it("banco fora do ar ou tempo esgotado: 404", async () => {
    respostaDoBanco = new Error("fetch failed");
    await esperar404(await pedir(CHAVE));
    const abortado = new Error("The operation was aborted due to timeout");
    abortado.name = "TimeoutError";
    respostaDoBanco = abortado;
    await esperar404(await pedir(CHAVE));
    expect(escrito.join("")).toContain('"error_code":"TimeoutError"');
    nadaSensivelNoLog();
  });

  it("sem a service role no ambiente: 404", async () => {
    clienteQuebrado = true;
    await esperar404(await pedir(CHAVE));
    expect(chamadas).toHaveLength(0);
    nadaSensivelNoLog();
  });
});
