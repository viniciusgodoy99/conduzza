import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BALDE_DA_MIDIA,
  caminhoDoArquivoDaMensagem,
  lerArquivoParaAIa,
  PRAZO_DO_ARQUIVO_NO_STORAGE_MS,
} from "@/lib/integrations/storage/arquivo-para-a-ia";

// O arquivo do paciente no Storage para o turno da IA (AG6b, desenho 4.3)
// com um cliente FALSO do Storage e um fetch falso: nada sai da maquina.
// Prova o formato de info() (data.size, em bytes: o @supabase/storage-js
// 2.112 instalado, dist/index.d.mts, FileObjectV2 e info()), o teto antes de
// baixar, a falha fechada sem tamanho, o prazo unico (o menor entre o do
// arquivo e o de quem chama) valendo para info, createSignedUrl e download,
// e o download cortado no tamanho declarado.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const MENSAGEM = "e0000000-0000-4000-8000-000000000001";
const MEDIA_URL = `storage://${BALDE_DA_MIDIA}/${CLINICA}/${MENSAGEM}`;
const CAMINHO = `${CLINICA}/${MENSAGEM}`;
const URL_ASSINADA =
  "https://projeto-de-teste.supabase.co/storage/v1/object/sign/midia-conversas/x?token=t";
const MAXIMO = 5 * 1024 * 1024;
const BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PRAZO_CURTO = 400;
/** O prazo com uma folga para o relogio do teste. */
const ATE_O_PRAZO = PRAZO_CURTO + 150;

type Resposta = { data: unknown; error: unknown };

function pendurado<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function dormir(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function cronometro() {
  const inicio = performance.now();
  return () => performance.now() - inicio;
}

/** O erro do storage-js (StorageApiError): status e statusCode. */
function erroDoStorage(status: number, statusCode: string = String(status)) {
  return { name: "StorageApiError", message: "x", status, statusCode };
}

function storageFalso(opcoes: {
  info?: () => Promise<Resposta>;
  assinar?: () => Promise<Resposta>;
} = {}) {
  const info = vi.fn(
    opcoes.info ?? (async () => ({ data: { size: BYTES.length }, error: null })),
  );
  const createSignedUrl = vi.fn(
    opcoes.assinar ??
      (async () => ({ data: { signedUrl: URL_ASSINADA }, error: null })),
  );
  const from = vi.fn(() => ({ info, createSignedUrl }));
  return {
    admin: { storage: { from } } as unknown as SupabaseClient,
    info,
    createSignedUrl,
    from,
  };
}

function fetchFalso(impl: (sinal: AbortSignal | null) => Promise<Response>) {
  const falso = vi.fn<typeof fetch>(async (_url, init) => impl(init?.signal ?? null));
  vi.stubGlobal("fetch", falso);
  return falso;
}

function sinalDo(falso: ReturnType<typeof fetchFalso>, i = 0): AbortSignal {
  return (falso.mock.calls[i]?.[1] as RequestInit).signal as AbortSignal;
}

function ler(
  admin: SupabaseClient,
  extra: { prazoMs?: number; maximoDeBytes?: number; sinal?: AbortSignal } = {},
) {
  return lerArquivoParaAIa(admin, {
    clinicId: CLINICA,
    messageId: MENSAGEM,
    mediaUrl: MEDIA_URL,
    maximoDeBytes: extra.maximoDeBytes ?? MAXIMO,
    prazoMs: extra.prazoMs,
    sinal: extra.sinal,
  });
}

beforeEach(() => {
  // Nenhum fetch de verdade nestes testes (o falso de cada teste troca este).
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("rede proibida nos testes");
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("o caminho e o caminho feliz", () => {
  it("so o formato exato da mensagem do turno vale", async () => {
    expect(caminhoDoArquivoDaMensagem(MEDIA_URL, CLINICA, MENSAGEM)).toBe(CAMINHO);
    for (const outro of [
      null,
      undefined,
      `storage://${BALDE_DA_MIDIA}/${CLINICA}/outra`,
      `storage://outro-balde/${CLINICA}/${MENSAGEM}`,
      `https://x/${CLINICA}/${MENSAGEM}`,
    ]) {
      expect(caminhoDoArquivoDaMensagem(outro, CLINICA, MENSAGEM)).toBeNull();
    }
    const { admin, from } = storageFalso();
    expect(
      await lerArquivoParaAIa(admin, {
        clinicId: CLINICA,
        messageId: MENSAGEM,
        mediaUrl: `storage://${BALDE_DA_MIDIA}/${CLINICA}/outra`,
        maximoDeBytes: MAXIMO,
      }),
    ).toEqual({ tipo: "nao_encontrado" });
    expect(from).not.toHaveBeenCalled();
  });

  it("info, a URL assinada de 60 s e o download com o sinal: os bytes", async () => {
    const { admin, from, info, createSignedUrl } = storageFalso();
    const falso = fetchFalso(async () => new Response(BYTES));
    const r = await ler(admin);
    expect(r).toEqual({ tipo: "ok", bytes: BYTES });
    expect(from).toHaveBeenCalledWith(BALDE_DA_MIDIA);
    expect(info).toHaveBeenCalledWith(CAMINHO);
    expect(createSignedUrl).toHaveBeenCalledWith(CAMINHO, 60);
    expect(falso).toHaveBeenCalledTimes(1);
    expect(falso.mock.calls[0]?.[0]).toBe(URL_ASSINADA);
    expect(falso.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
    expect(sinalDo(falso)).toBeInstanceOf(AbortSignal);
  });
});

describe("o tamanho antes de baixar", () => {
  it("acima do teto: nada baixa (nem a URL assinada)", async () => {
    const { admin, createSignedUrl } = storageFalso({
      info: async () => ({ data: { size: MAXIMO + 1 }, error: null }),
    });
    const falso = fetchFalso(async () => new Response(BYTES));
    expect(await ler(admin)).toEqual({ tipo: "grande_demais" });
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(falso).not.toHaveBeenCalled();
  });

  it("tamanho ausente ou invalido: falha fechada, nada baixa", async () => {
    for (const data of [
      {},
      { size: null },
      { size: "8" },
      { size: -1 },
      { size: 1.5 },
      { size: Number.NaN },
      { size: Number.POSITIVE_INFINITY },
      // O tamanho do storage.objects.metadata nao e o campo de info().
      { metadata: { size: 8 } },
    ]) {
      const { admin, createSignedUrl } = storageFalso({
        info: async () => ({ data, error: null }),
      });
      const falso = fetchFalso(async () => new Response(BYTES));
      expect(await ler(admin), JSON.stringify(data)).toEqual({
        tipo: "falhou",
        codigo: "sem_tamanho",
      });
      expect(createSignedUrl).not.toHaveBeenCalled();
      expect(falso).not.toHaveBeenCalled();
    }
  });

  it("o objeto que nao existe: nao_encontrado, sem nova tentativa (404, 400 e o statusCode do corpo)", async () => {
    for (const erro of [
      erroDoStorage(404),
      erroDoStorage(400, "404"),
      erroDoStorage(404, "NoSuchKey"),
    ]) {
      const { admin, info } = storageFalso({
        info: async () => ({ data: null, error: erro }),
      });
      expect(await ler(admin)).toEqual({ tipo: "nao_encontrado" });
      expect(info).toHaveBeenCalledTimes(1);
    }
  });
});

describe("o download contado", () => {
  it("maior que o declarado: a leitura para logo e falha fechada", async () => {
    let puxadas = 0;
    let cancelado = false;
    const corpo = new ReadableStream<Uint8Array>({
      pull(controle) {
        puxadas += 1;
        controle.enqueue(new Uint8Array(64 * 1024));
        if (puxadas >= 160) {
          controle.close();
        }
      },
      cancel() {
        cancelado = true;
      },
    });
    const { admin } = storageFalso({
      info: async () => ({ data: { size: BYTES.length }, error: null }),
    });
    const falso = fetchFalso(async () => new Response(corpo));
    expect(await ler(admin)).toEqual({ tipo: "falhou", codigo: "tamanho_divergente" });
    // 10 MB do outro lado; so o primeiro pedaco foi lido.
    expect(puxadas).toBeLessThanOrEqual(3);
    expect(cancelado).toBe(true);
    expect(sinalDo(falso).aborted).toBe(true);
  });

  it("acima do limite mesmo com o declarado mentindo: nunca le alem do declarado", async () => {
    const { admin } = storageFalso({
      info: async () => ({ data: { size: 100 }, error: null }),
    });
    fetchFalso(async () => new Response(new Uint8Array(200)));
    expect(await ler(admin, { maximoDeBytes: 150 })).toEqual({
      tipo: "falhou",
      codigo: "tamanho_divergente",
    });
  });

  it("menor que o declarado: falha fechada", async () => {
    const { admin } = storageFalso({
      info: async () => ({ data: { size: BYTES.length + 1 }, error: null }),
    });
    fetchFalso(async () => new Response(BYTES));
    expect(await ler(admin)).toEqual({ tipo: "falhou", codigo: "tamanho_divergente" });
  });
});

describe("o prazo unico: info, createSignedUrl e download terminam no prazo", () => {
  it("info travado: termina no prazo, sem URL nem download", async () => {
    const { admin, createSignedUrl } = storageFalso({ info: () => pendurado() });
    const falso = fetchFalso(async () => new Response(BYTES));
    const passou = cronometro();
    expect(await ler(admin, { prazoMs: PRAZO_CURTO })).toEqual({
      tipo: "falhou",
      codigo: "prazo",
    });
    expect(passou()).toBeLessThan(ATE_O_PRAZO);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(falso).not.toHaveBeenCalled();
  });

  it("info que volta DEPOIS do prazo: nada mais sai", async () => {
    const { admin, createSignedUrl } = storageFalso({
      info: async () => {
        await dormir(PRAZO_CURTO + 100);
        return { data: { size: BYTES.length }, error: null };
      },
    });
    const falso = fetchFalso(async () => new Response(BYTES));
    expect(await ler(admin, { prazoMs: PRAZO_CURTO })).toEqual({
      tipo: "falhou",
      codigo: "prazo",
    });
    await dormir(200);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(falso).not.toHaveBeenCalled();
  });

  it("createSignedUrl travado: termina no prazo, sem download", async () => {
    const { admin } = storageFalso({ assinar: () => pendurado() });
    const falso = fetchFalso(async () => new Response(BYTES));
    const passou = cronometro();
    expect(await ler(admin, { prazoMs: PRAZO_CURTO })).toEqual({
      tipo: "falhou",
      codigo: "prazo",
    });
    expect(passou()).toBeLessThan(ATE_O_PRAZO);
    expect(falso).not.toHaveBeenCalled();
  });

  it("download travado (nem responde ao sinal): termina no prazo e o sinal do download aborta", async () => {
    const { admin } = storageFalso();
    const falso = fetchFalso(() => pendurado());
    const passou = cronometro();
    expect(await ler(admin, { prazoMs: PRAZO_CURTO })).toEqual({
      tipo: "falhou",
      codigo: "prazo",
    });
    expect(passou()).toBeLessThan(ATE_O_PRAZO);
    expect(sinalDo(falso).aborted).toBe(true);
  });

  it("corpo que trava depois dos cabecalhos: termina no prazo", async () => {
    const { admin } = storageFalso();
    const falso = fetchFalso(
      async () => new Response(new ReadableStream<Uint8Array>({ start: () => undefined })),
    );
    const passou = cronometro();
    expect(await ler(admin, { prazoMs: PRAZO_CURTO })).toEqual({
      tipo: "falhou",
      codigo: "prazo",
    });
    expect(passou()).toBeLessThan(ATE_O_PRAZO);
    expect(sinalDo(falso).aborted).toBe(true);
  });

  it("o prazo de quem chama maior que o do arquivo nao vale: corta em PRAZO_DO_ARQUIVO_NO_STORAGE_MS", async () => {
    vi.useFakeTimers();
    const { admin } = storageFalso({ info: () => pendurado() });
    let terminou = false;
    const leitura = ler(admin, { prazoMs: 31_000 });
    void leitura.then(() => {
      terminou = true;
    });
    await vi.advanceTimersByTimeAsync(PRAZO_DO_ARQUIVO_NO_STORAGE_MS - 1);
    expect(terminou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // Com o prazo de 31 s de quem chama, esta espera nao terminaria.
    expect(await leitura).toEqual({ tipo: "falhou", codigo: "prazo" });
    expect(PRAZO_DO_ARQUIVO_NO_STORAGE_MS).toBe(8_000);
  });

  it("prazo menor que o minimo (ou invalido): nada sai", async () => {
    for (const prazoMs of [100, 0, -5, Number.NaN]) {
      const { admin, info } = storageFalso();
      expect(await ler(admin, { prazoMs })).toEqual({ tipo: "falhou", codigo: "prazo" });
      expect(info).not.toHaveBeenCalled();
    }
  });
});

describe("o sinal de quem chama (o corte da porta, o turno cancelado)", () => {
  it("abortado com info travado: termina na hora, com abortado, e nada mais sai", async () => {
    const { admin, createSignedUrl } = storageFalso({ info: () => pendurado() });
    const falso = fetchFalso(async () => new Response(BYTES));
    const porta = new AbortController();
    setTimeout(() => porta.abort(), 50);
    const passou = cronometro();
    expect(await ler(admin, { sinal: porta.signal })).toEqual({
      tipo: "falhou",
      codigo: "abortado",
    });
    expect(passou()).toBeLessThan(250);
    await dormir(100);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(falso).not.toHaveBeenCalled();
  });

  it("abortado no download (que ignora o sinal): termina na hora e o sinal chega ao fetch", async () => {
    const { admin } = storageFalso();
    const falso = fetchFalso(() => pendurado());
    const porta = new AbortController();
    setTimeout(() => porta.abort(), 50);
    const passou = cronometro();
    expect(await ler(admin, { sinal: porta.signal })).toEqual({
      tipo: "falhou",
      codigo: "abortado",
    });
    expect(passou()).toBeLessThan(250);
    expect(sinalDo(falso).aborted).toBe(true);
  });

  it("ja abortado: nada sai", async () => {
    const { admin, info } = storageFalso();
    const porta = new AbortController();
    porta.abort();
    expect(await ler(admin, { sinal: porta.signal })).toEqual({
      tipo: "falhou",
      codigo: "abortado",
    });
    expect(info).not.toHaveBeenCalled();
  });

  it("sem abortar, o sinal nao muda nada", async () => {
    const { admin } = storageFalso();
    fetchFalso(async () => new Response(BYTES));
    const porta = new AbortController();
    expect(await ler(admin, { sinal: porta.signal })).toEqual({ tipo: "ok", bytes: BYTES });
  });
});

describe("a nova tentativa (rede ou 5xx), dentro do prazo", () => {
  it("info 5xx e depois ok: repete uma vez", async () => {
    let chamadas = 0;
    const { admin, info } = storageFalso({
      info: async () => {
        chamadas += 1;
        return chamadas === 1
          ? { data: null, error: erroDoStorage(503) }
          : { data: { size: BYTES.length }, error: null };
      },
    });
    fetchFalso(async () => new Response(BYTES));
    expect(await ler(admin)).toEqual({ tipo: "ok", bytes: BYTES });
    expect(info).toHaveBeenCalledTimes(2);
  });

  it("download 5xx e depois ok; rede e depois ok", async () => {
    for (const primeira of [
      async () => new Response("x", { status: 502 }),
      async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
    ]) {
      const { admin } = storageFalso();
      let chamadas = 0;
      const falso = fetchFalso(async () => {
        chamadas += 1;
        return chamadas === 1 ? primeira() : new Response(BYTES);
      });
      expect(await ler(admin)).toEqual({ tipo: "ok", bytes: BYTES });
      expect(falso).toHaveBeenCalledTimes(2);
    }
  });

  it("5xx duas vezes: no maximo duas tentativas", async () => {
    const { admin } = storageFalso();
    const falso = fetchFalso(async () => new Response("x", { status: 500 }));
    expect(await ler(admin)).toEqual({ tipo: "falhou", codigo: "http_500" });
    expect(falso).toHaveBeenCalledTimes(2);
  });

  it("a nova tentativa so sai se a espera e uma tentativa couberem no prazo", async () => {
    const { admin, info } = storageFalso({
      info: async () => {
        await dormir(250);
        return { data: null, error: erroDoStorage(500) };
      },
    });
    const passou = cronometro();
    expect(await ler(admin, { prazoMs: PRAZO_CURTO })).toEqual({
      tipo: "falhou",
      codigo: "info_falhou",
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(passou()).toBeLessThan(PRAZO_CURTO);
  });

  it("404 no download nao repete", async () => {
    const { admin } = storageFalso();
    const falso = fetchFalso(async () => new Response("x", { status: 404 }));
    expect(await ler(admin)).toEqual({ tipo: "nao_encontrado" });
    expect(falso).toHaveBeenCalledTimes(1);
  });
});
