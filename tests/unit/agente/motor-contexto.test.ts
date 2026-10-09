import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  carregarBaseViva,
  carregarCatalogoDoAgente,
  carregarConfigDoRascunho,
  carregarConfigPublicada,
  maiorInstante,
  TENTATIVAS_DA_LEITURA_DO_RASCUNHO,
} from "@/lib/agente/contexto";
import { buscarProcedimento } from "@/lib/agente/ferramentas/buscar-procedimento";
import { extrasDoPainel, sinaisDasInstrucoes } from "@/lib/agente/painel";
import { MUDANCA_DAS_INSTRUCOES } from "@/lib/domain/agente/config";
import {
  COLUNAS_DA_CONFIG_DO_AGENTE,
  fetchConfigDoAgente,
  fetchVersoesDoAgente,
} from "@/lib/queries/agente";

// Carregadores do motor (service role, clinic_id SEMPRE explicito) e as
// consultas da Tela 6 pela sessao (colunas explicitas, nunca "*" nem
// instrucoes; instrucoes so pela RPC do super admin). Banco falso que
// devolve linhas por tabela e status e registra cada consulta.

vi.mock("server-only", () => ({}));

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const AUTOR = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

type Consulta = {
  tabela: string;
  colunas: string;
  filtros: [string, unknown][];
  range?: [number, number];
};

type Linha = Record<string, unknown>;

function linhaDaConfig(extra: Linha): Linha {
  return {
    id: `cfg-${String(extra.version)}`,
    version: 1,
    status: "publicada",
    agent_name: "Assistente",
    tone: "cordial",
    use_emoji: false,
    greeting: null,
    closing: null,
    skills: {},
    operating_mode: "24h",
    fallback_minutes: 5,
    operating_hours: {},
    instrucoes: null,
    conhecimento: [],
    published_at: "2026-10-06T12:00:00Z",
    published_by: AUTOR,
    ...extra,
  };
}

function bancoFalso(tabelas: Record<string, Linha[]>, rpc?: unknown) {
  const consultas: Consulta[] = [];
  const rpcs: { nome: string; args: unknown }[] = [];
  const from = (tabela: string) => {
    const c: Consulta = { tabela, colunas: "", filtros: [] };
    let limite: number | null = null;
    const linhas = () => {
      let todas = (tabelas[tabela] ?? []).filter((linha) =>
        c.filtros.every(([coluna, valor]) => linha[coluna] === valor),
      );
      if (tabela === "ai_agent_config") {
        todas = [...todas].sort(
          (a, b) => Number(b.version) - Number(a.version),
        );
      }
      if (c.range) {
        todas = todas.slice(c.range[0], c.range[1] + 1);
      }
      return limite === null ? todas : todas.slice(0, limite);
    };
    const consulta = {
      select: (colunas: string) => {
        c.colunas = colunas;
        consultas.push(c);
        return consulta;
      },
      eq: (coluna: string, valor: unknown) => {
        c.filtros.push([coluna, valor]);
        return consulta;
      },
      order: () => consulta,
      limit: (n: number) => {
        limite = n;
        return consulta;
      },
      range: (de: number, ate: number) => {
        c.range = [de, ate];
        return consulta;
      },
      in: () => consulta,
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      then: (ok: (valor: unknown) => unknown) =>
        Promise.resolve({ data: linhas(), error: null }).then(ok),
    };
    return consulta;
  };
  const cliente = {
    from,
    rpc: async (nome: string, args: unknown) => {
      rpcs.push({ nome, args });
      return { data: rpc ?? null, error: null };
    },
  } as unknown as SupabaseClient;
  return { cliente, consultas, rpcs };
}

describe("contexto do motor (service role)", () => {
  it("toda consulta leva o clinic_id explícito", async () => {
    const { cliente, consultas } = bancoFalso({});
    await carregarConfigDoRascunho(cliente, CLINICA);
    await carregarCatalogoDoAgente(cliente, CLINICA);
    expect(consultas.length).toBeGreaterThan(0);
    for (const consulta of consultas) {
      expect(consulta.filtros, consulta.tabela).toContainEqual([
        "clinic_id",
        CLINICA,
      ]);
      expect(consulta.colunas).not.toContain("*");
    }
  });

  it("rascunho com instruções e a base viva; sem rascunho, copia a publicada", async () => {
    const tabelas = {
      ai_agent_config: [
        linhaDaConfig({
          clinic_id: CLINICA,
          version: 2,
          agent_name: "Bia",
          instrucoes: "Seja breve.",
          conhecimento: [{ id: "k0", pergunta: "Antiga?", resposta: "Sim." }],
        }),
      ],
      knowledge_item: [
        {
          clinic_id: CLINICA,
          id: "k1",
          question: "Tem estacionamento?",
          answer: "Sim.",
          active: true,
        },
        {
          clinic_id: CLINICA,
          id: "k2",
          question: "Aceitam pix?",
          answer: "Sim.",
          active: false,
        },
      ],
    };
    const { cliente } = bancoFalso(tabelas);
    const semRascunho = await carregarConfigDoRascunho(cliente, CLINICA);
    expect(semRascunho.rascunhoId).toBeNull();
    expect(semRascunho.config).toMatchObject({
      status: "rascunho",
      nome: "Bia",
      instrucoes: "Seja breve.",
    });
    expect(semRascunho.config.base.map((i) => [i.id, i.ativo])).toEqual([
      ["k1", true],
      ["k2", false],
    ]);
    expect(semRascunho.publicada?.base.map((i) => i.id)).toEqual(["k0"]);

    tabelas.ai_agent_config.push(
      linhaDaConfig({
        id: "rascunho-3",
        clinic_id: CLINICA,
        version: 3,
        status: "rascunho",
        agent_name: "Carla",
        instrucoes: "Nova.",
        published_at: null,
        published_by: null,
      }),
    );
    const comRascunho = await carregarConfigDoRascunho(cliente, CLINICA);
    expect(comRascunho.rascunhoId).toBe("rascunho-3");
    expect(comRascunho.config).toMatchObject({
      nome: "Carla",
      instrucoes: "Nova.",
    });

    const publicada = await carregarConfigPublicada(cliente, CLINICA);
    expect(publicada?.versao).toBe(2);
    expect(publicada?.base.map((i) => i.pergunta)).toEqual(["Antiga?"]);
  });

  it("catálogo: todos os convênios ativos da clínica viram os planos do Cadastro, só nome e plano (item 2)", async () => {
    const OUTRA = "bbbbbbbb-0000-4000-8000-000000000000";
    const { cliente, consultas } = bancoFalso({
      procedure: [
        {
          clinic_id: CLINICA,
          id: "proc",
          name: "Consulta",
          active: true,
          bookable_by_ai: true,
        },
      ],
      professional: [
        { clinic_id: CLINICA, id: "prof", name: "Dra. Helena", active: true },
      ],
      service_link: [
        {
          clinic_id: CLINICA,
          procedure_id: "proc",
          professional_id: "prof",
          insurance_id: "enf",
          price_cents: null,
          covered_by_insurance: true,
          bookable_by_ai: true,
          active: true,
        },
      ],
      insurance: [
        // Com vinculo do agente.
        {
          clinic_id: CLINICA,
          id: "enf",
          name: "Unimed",
          plan_name: "Enfermaria",
          active: true,
        },
        // Ativo, sem vinculo nenhum.
        {
          clinic_id: CLINICA,
          id: "apt",
          name: "Unimed",
          plan_name: "Apartamento",
          active: true,
        },
        // Inativo: fora.
        {
          clinic_id: CLINICA,
          id: "ant",
          name: "Unimed",
          plan_name: "Antigo",
          active: false,
        },
        // De outra clinica: fora.
        {
          clinic_id: OUTRA,
          id: "exe",
          name: "Unimed",
          plan_name: "Executivo",
          active: true,
        },
      ],
    });
    const catalogo = await carregarCatalogoDoAgente(cliente, CLINICA);
    expect(catalogo.convenios.map((c) => c.id)).toEqual(["enf"]);
    expect(catalogo.conveniosDoCadastro).toEqual([
      { id: "apt", nome: "Unimed", plano: "Apartamento" },
      { id: "enf", nome: "Unimed", plano: "Enfermaria" },
    ]);
    // A leitura dos convenios: clinic_id e ativos, sem coluna de preco.
    const deConvenios = consultas.filter((c) => c.tabela === "insurance");
    expect(deConvenios.length).toBeGreaterThan(0);
    for (const consulta of deConvenios) {
      expect(consulta.colunas).toBe("id, name, plan_name, active");
      expect(consulta.filtros).toContainEqual(["clinic_id", CLINICA]);
      expect(consulta.filtros).toContainEqual(["active", true]);
    }

    // E a busca usa: "tenho Unimed" pergunta o plano, com o Apartamento
    // como "sem informacao", sem valor e com o rotulo de cada plano.
    const r = buscarProcedimento(catalogo, {
      procedimento: "p1",
      convenio: "tenho Unimed",
    });
    expect(r.resultado).toBe("plano_nao_informado");
    expect(JSON.parse(r.saida)).toEqual({
      resultado: "plano_nao_informado",
      procedimento: "Consulta",
      planos_da_operadora: [
        {
          convenio: "Unimed (Apartamento)",
          chamar_com: "Unimed (Apartamento)",
          situacao: "sem_informacao",
        },
        {
          convenio: "Unimed (Enfermaria)",
          chamar_com: "Unimed (Enfermaria)",
          situacao: "coberto",
        },
      ],
    });
    expect(r.precos).toEqual([]);
    // O plano so do Cadastro, dito inteiro: sem informacao, nunca "nao cobre".
    expect(
      buscarProcedimento(catalogo, {
        procedimento: "p1",
        convenio: "Unimed Apartamento",
      }).resultado,
    ).toBe("convenio_sem_informacao");
  });

  it("base viva lê por páginas até a última", async () => {
    const itens = Array.from({ length: 1_500 }, (_, i) => ({
      clinic_id: CLINICA,
      id: `k${String(i).padStart(4, "0")}`,
      question: `P${i}?`,
      answer: "R.",
      active: true,
    }));
    const { cliente, consultas } = bancoFalso({ knowledge_item: itens });
    const base = await carregarBaseViva(cliente, CLINICA);
    expect(base).toHaveLength(1_500);
    expect(consultas.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});

describe("consultas da Tela 6 (sessão)", () => {
  it("nunca pedem instrucoes nem *", () => {
    expect(COLUNAS_DA_CONFIG_DO_AGENTE).not.toContain("instrucoes");
    expect(COLUNAS_DA_CONFIG_DO_AGENTE).not.toContain("*");
  });

  it("configuração: instruções só com lerInstrucoes, pela RPC", async () => {
    const tabelas = {
      ai_agent_config: [
        linhaDaConfig({ clinic_id: CLINICA, version: 1, agent_name: "Ana" }),
      ],
      knowledge_item: [],
    };
    const comum = bancoFalso(tabelas, "Instruções secretas.");
    const dados = await fetchConfigDoAgente(comum.cliente, CLINICA);
    expect(dados.config.instrucoes).toBeNull();
    expect(dados.temRascunho).toBe(false);
    expect(dados.mudancas).toEqual([]);
    expect(comum.rpcs).toEqual([]);
    for (const consulta of comum.consultas) {
      expect(consulta.colunas).not.toContain("instrucoes");
    }

    const superAdmin = bancoFalso(tabelas, "Instruções secretas.");
    const dele = await fetchConfigDoAgente(superAdmin.cliente, CLINICA, {
      lerInstrucoes: true,
    });
    expect(dele.config.instrucoes).toBe("Instruções secretas.");
    expect(superAdmin.rpcs).toEqual([
      { nome: "instrucoes_do_agente", args: { p_clinic_id: CLINICA } },
    ]);
    // As instrucoes nao contam como mudanca (a sessao nao le as da publicada).
    expect(dele.mudancas).toEqual([]);
  });

  it("rascunho diferente da publicada conta as mudanças; nunca publicada é a primeira versão", async () => {
    const { cliente } = bancoFalso({
      ai_agent_config: [
        linhaDaConfig({ clinic_id: CLINICA, version: 1, agent_name: "Ana" }),
        linhaDaConfig({
          clinic_id: CLINICA,
          version: 2,
          status: "rascunho",
          agent_name: "Bia",
          published_at: null,
          published_by: null,
        }),
      ],
      knowledge_item: [],
    });
    const dados = await fetchConfigDoAgente(cliente, CLINICA);
    expect(dados.temRascunho).toBe(true);
    expect(dados.mudancas.map((m) => m.campo)).toEqual(["nome"]);

    const vazio = bancoFalso({});
    const nunca = await fetchConfigDoAgente(vazio.cliente, CLINICA);
    expect(nunca.publicada).toBeNull();
    expect(nunca.mudancas.map((m) => m.campo)).toEqual(["primeira_publicacao"]);
  });

  it("versões: da mais nova para a mais antiga, com o que mudou e quem publicou", async () => {
    const { cliente } = bancoFalso({
      ai_agent_config: [
        linhaDaConfig({ clinic_id: CLINICA, version: 1 }),
        linhaDaConfig({
          clinic_id: CLINICA,
          version: 2,
          tone: "formal",
          published_by: null,
        }),
      ],
      profile: [{ user_id: AUTOR, name: "Vinicius" }],
    });
    const versoes = await fetchVersoesDoAgente(cliente, CLINICA);
    expect(
      versoes.map((v) => [
        v.versao,
        v.emUso,
        v.autor,
        v.mudancas.map((m) => m.rotulo),
      ]),
    ).toEqual([
      [2, true, null, ["Tom de voz: Formal"]],
      [1, false, "Vinicius", ["Primeira versão do assistente"]],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Revisao adversarial de 06/10/2026
// ---------------------------------------------------------------------------

describe("o que a publicação conferiu (achados 17 e 36)", () => {
  it("conferidoEm é o maior updated_at entre o rascunho e a base, sem perder os microssegundos", async () => {
    const tabelas = {
      ai_agent_config: [
        linhaDaConfig({
          id: "rascunho-2",
          clinic_id: CLINICA,
          version: 2,
          status: "rascunho",
          updated_at: "2026-10-06T19:00:00.5+00:00",
        }),
      ],
      knowledge_item: [
        {
          clinic_id: CLINICA,
          id: "k1",
          question: "P?",
          answer: "R.",
          active: true,
          updated_at: "2026-10-06T19:00:00.123456+00:00",
        },
        {
          clinic_id: CLINICA,
          id: "k2",
          question: "Q?",
          answer: "R.",
          active: false,
          updated_at: "2026-10-06T19:00:00.500001+00:00",
        },
      ],
    };
    const { cliente, consultas } = bancoFalso(tabelas);
    const lido = await carregarConfigDoRascunho(cliente, CLINICA);
    expect(lido.conferidoEm).toBe("2026-10-06T19:00:00.500001+00:00");
    expect(
      consultas.find((c) => c.tabela === "knowledge_item")?.colunas,
    ).toContain("updated_at");
    expect(
      consultas.find((c) => c.tabela === "ai_agent_config")?.colunas,
    ).toContain("updated_at");

    // Sem rascunho nao ha o que publicar: nulo.
    tabelas.ai_agent_config = [
      linhaDaConfig({ clinic_id: CLINICA, version: 1 }),
    ];
    const semRascunho = await carregarConfigDoRascunho(
      bancoFalso(tabelas).cliente,
      CLINICA,
    );
    expect(semRascunho.conferidoEm).toBeNull();
  });

  it("maiorInstante compara em microssegundos e com fuso, e devolve o texto do banco", () => {
    expect(
      maiorInstante([
        "2026-10-06T19:00:00+00:00",
        "2026-10-06T16:00:00.000001-03:00",
        "2026-10-06T18:59:59.999999Z",
        null,
        "lixo",
      ]),
    ).toBe("2026-10-06T16:00:00.000001-03:00");
    expect(maiorInstante([null, undefined, "x"])).toBeNull();
  });
});

describe("sinais das instruções para a tela (achados 16, 25, 28, 35 e 38)", () => {
  const tabelas = () => ({
    ai_agent_config: [
      linhaDaConfig({ clinic_id: CLINICA, version: 1, instrucoes: "A" }),
      linhaDaConfig({ clinic_id: CLINICA, version: 2, instrucoes: " A " }),
      linhaDaConfig({ clinic_id: CLINICA, version: 3, instrucoes: "B" }),
      linhaDaConfig({
        id: "rascunho-4",
        clinic_id: CLINICA,
        version: 4,
        status: "rascunho",
        instrucoes: "C",
      }),
    ],
    knowledge_item: [],
  });

  it("dizem só se mudou (rascunho e versões), nunca o texto", async () => {
    const { cliente, consultas } = bancoFalso(tabelas());
    const sinais = await sinaisDasInstrucoes(cliente, CLINICA);
    expect(sinais).toEqual({
      instrucoesMudaram: true,
      // v3 trocou A por B; v2 so mudou espacos; v1 trouxe as primeiras.
      versoesComInstrucoesMudadas: [3, 1],
    });
    expect(JSON.stringify(sinais)).not.toMatch(/"[ABC]"/);
    for (const consulta of consultas) {
      expect(consulta.filtros).toContainEqual(["clinic_id", CLINICA]);
    }

    const iguais = tabelas();
    iguais.ai_agent_config[3] = {
      ...iguais.ai_agent_config[3],
      instrucoes: "B",
    };
    expect(
      (await sinaisDasInstrucoes(bancoFalso(iguais).cliente, CLINICA))
        .instrucoesMudaram,
    ).toBe(false);
  });

  it("falha ao ler o catálogo não derruba os sinais (achado 38); quem não é super admin não ganha prévia", async () => {
    const { cliente } = bancoFalso(tabelas());
    const quebrado = {
      rpc: cliente.rpc,
      from: (tabela: string) => {
        if (tabela === "procedure") {
          throw new Error("tempo esgotado");
        }
        return cliente.from(tabela);
      },
    } as unknown as SupabaseClient;
    const doSuperAdmin = await extrasDoPainel(quebrado, {
      clinicId: CLINICA,
      timezone: "America/Fortaleza",
      superAdmin: true,
      agoraMs: Date.UTC(2026, 9, 6, 20, 0),
    });
    expect(doSuperAdmin).toEqual({
      instrucoesMudaram: true,
      versoesComInstrucoesMudadas: [3, 1],
      previa: null,
    });

    const lidas: string[] = [];
    const contado = {
      rpc: cliente.rpc,
      from: (tabela: string) => {
        lidas.push(tabela);
        return cliente.from(tabela);
      },
    } as unknown as SupabaseClient;
    const doGestor = await extrasDoPainel(contado, {
      clinicId: CLINICA,
      timezone: "America/Fortaleza",
      superAdmin: false,
      agoraMs: Date.UTC(2026, 9, 6, 20, 0),
    });
    expect(doGestor.previa).toBeNull();
    expect(doGestor.instrucoesMudaram).toBe(true);
    expect(new Set(lidas)).toEqual(new Set(["ai_agent_config"]));
  });

  it("as consultas da sessão põem a linha das instruções pelo sinal do servidor", async () => {
    const { cliente } = bancoFalso(tabelas());
    const dados = await fetchConfigDoAgente(cliente, CLINICA, {
      instrucoesMudaram: true,
    });
    expect(dados.mudancas).toContainEqual(MUDANCA_DAS_INSTRUCOES);
    const semSinal = await fetchConfigDoAgente(cliente, CLINICA);
    expect(semSinal.mudancas).not.toContainEqual(MUDANCA_DAS_INSTRUCOES);

    const versoes = await fetchVersoesDoAgente(cliente, CLINICA, {
      versoesComInstrucoesMudadas: [3, 1],
    });
    expect(
      versoes.map((v) => [
        v.versao,
        v.mudancas.some((m) => m.campo === "instrucoes"),
      ]),
    ).toEqual([
      [3, true],
      [2, false],
      [1, true],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Ordem da leitura do rascunho e da base (cetico de 06/10/2026)
// ---------------------------------------------------------------------------

/**
 * Banco falso com "rede": cada consulta registra quando comeca e quando
 * termina, e so le as linhas no fim (um tique depois). Com Promise.all as
 * consultas comecariam todas antes de qualquer fim; em sequencia, a da base
 * so comeca depois que a do rascunho terminou. `aoComecar` simula uma
 * escrita de outra pessoa no meio da leitura.
 */
function bancoComRede(
  tabelas: Record<string, Linha[]>,
  aoComecar: (rotulo: string) => void = () => undefined,
) {
  const ordem: string[] = [];
  const from = (tabela: string) => {
    const filtros: [string, unknown][] = [];
    let colunas = "";
    const rotulo = () => {
      const status = filtros.find(([coluna]) => coluna === "status")?.[1];
      if (status === undefined) {
        return tabela;
      }
      const marca = colunas === "id, updated_at" ? " (de novo)" : "";
      return `${String(status)}${marca}`;
    };
    const ler = async () => {
      const nome = rotulo();
      ordem.push(`começa ${nome}`);
      aoComecar(nome);
      await new Promise((pronto) => setTimeout(pronto, 0));
      const linhas = (tabelas[tabela] ?? []).filter((linha) =>
        filtros.every(([coluna, valor]) => linha[coluna] === valor),
      );
      ordem.push(`termina ${nome}`);
      return linhas;
    };
    const consulta = {
      select: (lidas: string) => {
        colunas = lidas;
        return consulta;
      },
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return consulta;
      },
      order: () => consulta,
      limit: () => consulta,
      range: () => consulta,
      maybeSingle: async () => ({
        data: (await ler())[0] ?? null,
        error: null,
      }),
      then: (ok: (valor: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        ler()
          .then((data) => ({ data, error: null }))
          .then(ok, erro),
    };
    return consulta;
  };
  return { cliente: { from } as unknown as SupabaseClient, ordem };
}

function rascunhoDaClinica(extra: Linha = {}): Linha {
  return linhaDaConfig({
    id: "rascunho-2",
    clinic_id: CLINICA,
    version: 2,
    status: "rascunho",
    greeting: "Olá!",
    published_at: null,
    published_by: null,
    updated_at: "2026-10-06T19:00:00+00:00",
    ...extra,
  });
}

function itemDaBase(extra: Linha = {}): Linha {
  return {
    clinic_id: CLINICA,
    id: "k1",
    question: "Tem estacionamento?",
    answer: "Sim.",
    active: true,
    updated_at: "2026-10-06T18:00:00+00:00",
    ...extra,
  };
}

describe("ordem da leitura para o carimbo da publicação", () => {
  it("lê o rascunho, DEPOIS a base e confere o rascunho de novo, em sequência", async () => {
    const { cliente, ordem } = bancoComRede({
      ai_agent_config: [
        linhaDaConfig({ clinic_id: CLINICA, version: 1 }),
        rascunhoDaClinica(),
      ],
      knowledge_item: [itemDaBase()],
    });
    const lido = await carregarConfigDoRascunho(cliente, CLINICA);
    expect(ordem).toEqual([
      "começa rascunho",
      "começa publicada",
      "termina rascunho",
      "termina publicada",
      "começa knowledge_item",
      "termina knowledge_item",
      "começa rascunho (de novo)",
      "termina rascunho (de novo)",
    ]);
    expect(lido.conferidoEm).toBe("2026-10-06T19:00:00+00:00");
  });

  it("escrita na base depois da leitura do rascunho: a base lida já traz e o carimbo a cobre", async () => {
    const tabelas = {
      ai_agent_config: [rascunhoDaClinica()],
      knowledge_item: [itemDaBase()],
    };
    const { cliente, ordem } = bancoComRede(tabelas, (rotulo) => {
      if (rotulo === "knowledge_item") {
        tabelas.knowledge_item = [
          itemDaBase({
            answer: "Sim, na rua ao lado.",
            updated_at: "2026-10-06T19:00:05+00:00",
          }),
        ];
      }
    });
    const lido = await carregarConfigDoRascunho(cliente, CLINICA);
    expect(lido.config.base.map((item) => item.resposta)).toEqual([
      "Sim, na rua ao lado.",
    ]);
    expect(lido.conferidoEm).toBe("2026-10-06T19:00:05+00:00");
    expect(ordem.filter((passo) => passo === "começa rascunho")).toHaveLength(
      1,
    );
  });

  it("o rascunho mudou enquanto a base era lida (restaurar grava os dois juntos): lê tudo de novo e o retrato fica inteiro", async () => {
    const tabelas = {
      ai_agent_config: [rascunhoDaClinica()],
      knowledge_item: [itemDaBase()],
    };
    let escreveu = false;
    const { cliente, ordem } = bancoComRede(tabelas, (rotulo) => {
      if (rotulo === "knowledge_item" && !escreveu) {
        escreveu = true;
        // A saudacao nova escapou da primeira leitura do rascunho, e a base
        // lida traz algo do mesmo instante: o carimbo nao passaria dela.
        tabelas.ai_agent_config = [
          rascunhoDaClinica({
            greeting: "Oi, sou a Bia!",
            updated_at: "2026-10-06T19:00:09+00:00",
          }),
        ];
        tabelas.knowledge_item = [
          itemDaBase({
            answer: "Sim, gratuito.",
            updated_at: "2026-10-06T19:00:09+00:00",
          }),
        ];
      }
    });
    const lido = await carregarConfigDoRascunho(cliente, CLINICA);
    expect(lido.config.saudacao).toBe("Oi, sou a Bia!");
    expect(lido.config.base.map((item) => item.resposta)).toEqual([
      "Sim, gratuito.",
    ]);
    expect(lido.conferidoEm).toBe("2026-10-06T19:00:09+00:00");
    expect(ordem.filter((passo) => passo === "começa rascunho")).toHaveLength(
      2,
    );
  });

  it("o rascunho que nasce depois da escrita na base (garantir de depois) também força a releitura", async () => {
    const tabelas: Record<string, Linha[]> = {
      ai_agent_config: [linhaDaConfig({ clinic_id: CLINICA, version: 1 })],
      knowledge_item: [itemDaBase()],
    };
    let escreveu = false;
    const { cliente } = bancoComRede(tabelas, (rotulo) => {
      if (rotulo === "knowledge_item" && !escreveu) {
        escreveu = true;
        tabelas.knowledge_item = [
          itemDaBase({
            answer: "Sim, coberto.",
            updated_at: "2026-10-06T19:00:01+00:00",
          }),
        ];
        tabelas.ai_agent_config = [
          ...(tabelas.ai_agent_config ?? []),
          rascunhoDaClinica({ updated_at: "2026-10-06T19:00:02+00:00" }),
        ];
      }
    });
    const lido = await carregarConfigDoRascunho(cliente, CLINICA);
    expect(lido.rascunhoId).toBe("rascunho-2");
    expect(lido.config.base.map((item) => item.resposta)).toEqual([
      "Sim, coberto.",
    ]);
    expect(lido.conferidoEm).toBe("2026-10-06T19:00:02+00:00");
  });

  it("rascunho que não para de mudar: desiste depois das tentativas e lança (quem chama pede para tentar de novo)", async () => {
    const tabelas = {
      ai_agent_config: [rascunhoDaClinica()],
      knowledge_item: [itemDaBase()],
    };
    let segundos = 10;
    const { cliente, ordem } = bancoComRede(tabelas, (rotulo) => {
      if (rotulo === "knowledge_item") {
        segundos += 1;
        tabelas.ai_agent_config = [
          rascunhoDaClinica({
            updated_at: `2026-10-06T19:00:${segundos}+00:00`,
          }),
        ];
      }
    });
    await expect(carregarConfigDoRascunho(cliente, CLINICA)).rejects.toThrow();
    expect(ordem.filter((passo) => passo === "começa rascunho")).toHaveLength(
      TENTATIVAS_DA_LEITURA_DO_RASCUNHO,
    );
  });
});
