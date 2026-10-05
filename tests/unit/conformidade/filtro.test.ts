import { describe, expect, it, vi } from "vitest";

import {
  CATEGORIAS_DO_VERIFICADOR,
  type CategoriaDoVerificador,
} from "@/lib/domain/conformidade/categorias";
import {
  filtrarSaida,
  sha256DoTexto,
  versaoDasRegras,
} from "@/lib/domain/conformidade/filtro";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import {
  CASOS_DE_SAIDA,
  CONTEXTO_PADRAO,
  CONTROLES_DE_SAIDA,
  contextoDo,
} from "@/tests/fixtures/ia/conformidade/casos";

// O pipeline inteiro (regras + verificador injetado), sem chave e sem rede.
// O pior caso e o verificador enganado, que aprova tudo: os casos
// deterministicos continuam bloqueados. E todo verificador que falha, de
// qualquer jeito, bloqueia 100%.

const USO = {
  tokensEntrada: 900,
  tokensSaida: 30,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

function verificadorQueSempreAprova() {
  return vi.fn<Verificador>(async () => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "claude-haiku-4-5-20251001",
    uso: USO,
  }));
}

function verificadorQueReprova(categoria: CategoriaDoVerificador = "triagem") {
  return vi.fn<Verificador>(async () => ({
    tipo: "veredicto",
    veredicto: {
      aprovado: false,
      violacoes: [{ categoria, gravidade: "alta" }],
      confianca: "alta",
    },
    modelo: "claude-haiku-4-5-20251001",
    uso: USO,
  }));
}

const deterministicos = CASOS_DE_SAIDA.filter((caso) => !caso.soModelo);
const soModelo = CASOS_DE_SAIDA.filter((caso) => caso.soModelo);

describe("com um verificador que SEMPRE aprova (modelo enganado)", () => {
  it.each(deterministicos.map((caso) => [caso.id, caso] as const))(
    "%s bloqueia pela regra, sem chamar o modelo",
    async (_id, caso) => {
      const verificador = verificadorQueSempreAprova();
      const decisao = await filtrarSaida({
        rascunho: caso.rascunho,
        contexto: contextoDo(caso),
        verificador,
      });
      expect(decisao.aprovado).toBe(false);
      if (!decisao.aprovado) {
        expect(decisao.camada).toBe("regra");
      }
      expect(verificador).not.toHaveBeenCalled();
    },
  );

  it.each(CONTROLES_DE_SAIDA.map((caso) => [caso.id, caso] as const))(
    "controle %s aprova, com o texto byte a byte e o hash",
    async (_id, caso) => {
      const verificador = verificadorQueSempreAprova();
      const decisao = await filtrarSaida({
        rascunho: caso.rascunho,
        contexto: contextoDo(caso),
        verificador,
      });
      expect(decisao.aprovado).toBe(true);
      if (decisao.aprovado) {
        expect(decisao.texto).toBe(caso.rascunho);
        expect(decisao.sha256).toBe(sha256DoTexto(caso.rascunho));
        expect(decisao.verificador.modelo).toBe("claude-haiku-4-5-20251001");
        expect(decisao.verificador.uso).toEqual(USO);
      }
      expect(verificador).toHaveBeenCalledTimes(1);
    },
  );
});

describe("casos que so o modelo pega", () => {
  it("existem, para a rodada paga medir o residuo", () => {
    expect(soModelo.length).toBeGreaterThan(0);
  });

  it.each(soModelo.map((caso) => [caso.id, caso] as const))(
    "%s bloqueia na camada do modelo quando o modelo reprova",
    async (_id, caso) => {
      // So entra como "so o modelo" o que o verificador sabe apontar.
      const categoria = CATEGORIAS_DO_VERIFICADOR.find(
        (c) => c === caso.categoria,
      );
      expect(categoria).toBeDefined();
      const decisao = await filtrarSaida({
        rascunho: caso.rascunho,
        contexto: contextoDo(caso),
        verificador: verificadorQueReprova(categoria),
      });
      expect(decisao).toMatchObject({ aprovado: false, camada: "modelo" });
      if (!decisao.aprovado) {
        expect(decisao.categoria).toBe(caso.categoria);
      }
    },
  );
});

describe("falha fechada: todo verificador que falha bloqueia", () => {
  const rascunhoLimpo = "Tenho horário amanhã às 10h. Pode ser?";

  const falhas: Array<[string, Verificador, string]> = [
    [
      "lanca erro",
      async () => Promise.reject(new Error("rede caiu")),
      "desconhecida",
    ],
    [
      "lanca algo que nem e erro",
      async () => Promise.reject("texto solto"),
      "desconhecida",
    ],
    [
      "devolve falha de timeout",
      async () => ({
        tipo: "falha",
        motivo: "timeout",
        modelo: "claude-haiku-4-5",
        uso: null,
        httpStatus: null,
      }),
      "timeout",
    ],
    [
      "devolve recusa",
      async () => ({
        tipo: "falha",
        motivo: "recusa",
        modelo: "claude-haiku-4-5",
        uso: USO,
        httpStatus: null,
      }),
      "recusa",
    ],
    [
      "devolve max_tokens",
      async () => ({
        tipo: "falha",
        motivo: "max_tokens",
        modelo: "claude-haiku-4-5",
        uso: USO,
        httpStatus: null,
      }),
      "max_tokens",
    ],
    [
      "devolve falha com motivo desconhecido",
      async () =>
        ({
          tipo: "falha",
          motivo: "qualquer coisa",
          modelo: null,
          uso: null,
          httpStatus: null,
        }) as unknown as ResultadoDoVerificador,
      "desconhecida",
    ],
    [
      "devolve null",
      async () => null as unknown as ResultadoDoVerificador,
      "saida_invalida",
    ],
    [
      "devolve undefined",
      async () => undefined as unknown as ResultadoDoVerificador,
      "saida_invalida",
    ],
    [
      "devolve tipo desconhecido",
      async () => ({ tipo: "talvez" }) as unknown as ResultadoDoVerificador,
      "saida_invalida",
    ],
    [
      "devolve veredicto null",
      async () =>
        ({
          tipo: "veredicto",
          veredicto: null,
          modelo: "x",
          uso: null,
        }) as unknown as ResultadoDoVerificador,
      "saida_invalida",
    ],
    [
      "devolve aprovado como texto",
      async () =>
        ({
          tipo: "veredicto",
          veredicto: { aprovado: "true", violacoes: [], confianca: "alta" },
          modelo: "x",
          uso: null,
        }) as unknown as ResultadoDoVerificador,
      "saida_invalida",
    ],
    [
      "devolve categoria inventada",
      async () =>
        ({
          tipo: "veredicto",
          veredicto: {
            aprovado: false,
            violacoes: [{ categoria: "outra", gravidade: "alta" }],
            confianca: "alta",
          },
          modelo: "x",
          uso: null,
        }) as unknown as ResultadoDoVerificador,
      "saida_invalida",
    ],
    [
      "devolve campo a mais (eco de texto)",
      async () =>
        ({
          tipo: "veredicto",
          veredicto: {
            aprovado: true,
            violacoes: [],
            confianca: "alta",
            trecho: "pode tomar dipirona",
          },
          modelo: "x",
          uso: null,
        }) as unknown as ResultadoDoVerificador,
      "saida_invalida",
    ],
    [
      "aprova apontando violacao (contradicao)",
      async () => ({
        tipo: "veredicto",
        veredicto: {
          aprovado: true,
          violacoes: [{ categoria: "triagem", gravidade: "media" }],
          confianca: "alta",
        },
        modelo: "x",
        uso: null,
      }),
      "incoerente",
    ],
    [
      "reprova sem dizer o motivo",
      async () => ({
        tipo: "veredicto",
        veredicto: { aprovado: false, violacoes: [], confianca: "alta" },
        modelo: "x",
        uso: null,
      }),
      "incoerente",
    ],
    [
      "aprova com confianca baixa",
      async () => ({
        tipo: "veredicto",
        veredicto: { aprovado: true, violacoes: [], confianca: "baixa" },
        modelo: "x",
        uso: null,
      }),
      "confianca_baixa",
    ],
  ];

  it.each(falhas)("verificador que %s", async (_nome, verificador, motivo) => {
    const decisao = await filtrarSaida({
      rascunho: rascunhoLimpo,
      contexto: CONTEXTO_PADRAO,
      verificador,
    });
    expect(decisao).toMatchObject({
      aprovado: false,
      categoria: "falha_verificador",
      camada: "falha",
      motivoDaFalha: motivo,
    });
  });

  it("verificador que nunca responde: corta no prazo e aborta a chamada", async () => {
    let sinalRecebido: AbortSignal | null = null;
    const verificador: Verificador = ({ sinal }) => {
      sinalRecebido = sinal;
      return new Promise(() => undefined);
    };
    const decisao = await filtrarSaida({
      rascunho: rascunhoLimpo,
      contexto: CONTEXTO_PADRAO,
      verificador,
      prazoDoVerificadorMs: 20,
    });
    expect(decisao).toMatchObject({
      aprovado: false,
      camada: "falha",
      motivoDaFalha: "timeout",
    });
    expect((sinalRecebido as AbortSignal | null)?.aborted).toBe(true);
  });

  it("prazo do job ja estourado: nem chama o verificador", async () => {
    const verificador = verificadorQueSempreAprova();
    const decisao = await filtrarSaida({
      rascunho: rascunhoLimpo,
      contexto: CONTEXTO_PADRAO,
      verificador,
      prazoEm: 1_000,
      agora: () => 2_000,
    });
    expect(decisao).toMatchObject({ aprovado: false, motivoDaFalha: "prazo" });
    expect(verificador).not.toHaveBeenCalled();
  });

  it("aprovacao que chega depois do prazo do job nao vale", async () => {
    let relogio = 1_000;
    const verificador: Verificador = async () => {
      relogio = 5_000;
      return {
        tipo: "veredicto",
        veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
        modelo: "x",
        uso: null,
      };
    };
    const decisao = await filtrarSaida({
      rascunho: rascunhoLimpo,
      contexto: CONTEXTO_PADRAO,
      verificador,
      prazoEm: 3_000,
      agora: () => relogio,
    });
    expect(decisao).toMatchObject({ aprovado: false, motivoDaFalha: "prazo" });
  });

  it("mais de cinco mensagens sem resposta: bloqueia sem chamar o verificador (contexto truncado)", async () => {
    const verificador = verificadorQueSempreAprova();
    const decisao = await filtrarSaida({
      rascunho: rascunhoLimpo,
      contexto: {
        ...CONTEXTO_PADRAO,
        mensagensDoPaciente: [
          "oi",
          "bom dia",
          "quero marcar",
          "consulta",
          "com a Dra. Ana",
          "pode ser sexta?",
        ],
      },
      verificador,
    });
    expect(decisao).toMatchObject({
      aprovado: false,
      categoria: "falha_verificador",
      camada: "falha",
      motivoDaFalha: "contexto_truncado",
    });
    expect(verificador).not.toHaveBeenCalled();
  });

  it("cinco mensagens sem resposta ainda vao inteiras ao verificador", async () => {
    const verificador = verificadorQueSempreAprova();
    const mensagens = ["oi", "bom dia", "quero marcar", "consulta", "sexta?"];
    const decisao = await filtrarSaida({
      rascunho: rascunhoLimpo,
      contexto: { ...CONTEXTO_PADRAO, mensagensDoPaciente: mensagens },
      verificador,
    });
    expect(decisao.aprovado).toBe(true);
    expect(verificador).toHaveBeenCalledWith(
      expect.objectContaining({ mensagensDoPaciente: mensagens }),
    );
  });

  it("verificador que lanca de forma sincrona bloqueia", async () => {
    const verificador = (() => {
      throw new Error("boom");
    }) as unknown as Verificador;
    const decisao = await filtrarSaida({
      rascunho: rascunhoLimpo,
      contexto: CONTEXTO_PADRAO,
      verificador,
    });
    expect(decisao).toMatchObject({
      aprovado: false,
      camada: "falha",
      motivoDaFalha: "desconhecida",
    });
  });

  it("verificador ausente bloqueia", async () => {
    const decisao = await filtrarSaida({
      rascunho: rascunhoLimpo,
      contexto: CONTEXTO_PADRAO,
      verificador: undefined as unknown as Verificador,
    });
    expect(decisao).toMatchObject({ aprovado: false, camada: "falha" });
  });

  it("contexto malformado bloqueia sem chamar o verificador", async () => {
    const verificador = verificadorQueSempreAprova();
    const decisao = await filtrarSaida({
      rascunho: rascunhoLimpo,
      contexto: { precosDoTurno: ["250"] } as never,
      verificador,
    });
    expect(decisao.aprovado).toBe(false);
    expect(verificador).not.toHaveBeenCalled();
  });

  it("rascunho que nao e texto bloqueia", async () => {
    const decisao = await filtrarSaida({
      rascunho: 42 as unknown as string,
      contexto: CONTEXTO_PADRAO,
      verificador: verificadorQueSempreAprova(),
    });
    expect(decisao.aprovado).toBe(false);
  });
});

describe("decisao do modelo", () => {
  it("reprovacao do modelo usa a categoria de maior prioridade", async () => {
    const verificador: Verificador = async () => ({
      tipo: "veredicto",
      veredicto: {
        aprovado: false,
        violacoes: [
          { categoria: "oferta_casada", gravidade: "media" },
          { categoria: "triagem", gravidade: "alta" },
        ],
        confianca: "media",
      },
      modelo: "x",
      uso: null,
    });
    const decisao = await filtrarSaida({
      rascunho: "Tenho horário amanhã.",
      contexto: CONTEXTO_PADRAO,
      verificador,
    });
    expect(decisao).toMatchObject({
      aprovado: false,
      categoria: "triagem",
      camada: "modelo",
    });
  });

  it("confianca media aprova", async () => {
    const verificador: Verificador = async () => ({
      tipo: "veredicto",
      veredicto: { aprovado: true, violacoes: [], confianca: "media" },
      modelo: "x",
      uso: null,
    });
    const decisao = await filtrarSaida({
      rascunho: "Tenho horário amanhã.",
      contexto: CONTEXTO_PADRAO,
      verificador,
    });
    expect(decisao.aprovado).toBe(true);
  });

  it("o verificador recebe o rascunho e as mensagens do paciente", async () => {
    const verificador = verificadorQueSempreAprova();
    await filtrarSaida({
      rascunho: "Tenho horário amanhã.",
      contexto: { ...CONTEXTO_PADRAO, mensagensDoPaciente: ["tem horário?"] },
      verificador,
    });
    expect(verificador).toHaveBeenCalledWith(
      expect.objectContaining({
        rascunho: "Tenho horário amanhã.",
        mensagensDoPaciente: ["tem horário?"],
      }),
    );
  });
});

describe("hash e versao", () => {
  it("sha256 do UTF-8, igual ao que o Postgres calcula", () => {
    // Conferido no banco em 05/10/2026:
    // select encode(sha256(convert_to('Olá, consulta às 10h \u2713', 'UTF8')), 'hex')
    expect(sha256DoTexto("Olá, consulta às 10h \u2713")).toBe(
      "dc5feda51963c8def82a0cfd967c8b0e17e5856724bc381fa099f481698c86a1",
    );
    expect(sha256DoTexto("Olá")).not.toBe(sha256DoTexto("Ola"));
  });

  it("versao das regras e estavel e marcada", () => {
    expect(versaoDasRegras()).toMatch(/^regras-[0-9a-f]{12}$/);
    expect(versaoDasRegras()).toBe(versaoDasRegras());
  });

  it("a decisao leva a versao das regras", async () => {
    const decisao = await filtrarSaida({
      rascunho: "Pode tomar dipirona.",
      contexto: CONTEXTO_PADRAO,
      verificador: verificadorQueSempreAprova(),
    });
    expect(decisao.versaoDasRegras).toBe(versaoDasRegras());
  });
});
