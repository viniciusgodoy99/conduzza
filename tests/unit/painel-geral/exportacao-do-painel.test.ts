import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Exportar a lista do Painel geral (segunda leva, 26/10/2026; escolha (7)
// do dono), no molde da exportacao dos leads:
//   - as regras puras: o corpo do pedido (so o que foge do padrao), o Zod
//     estrito, as colunas e as linhas do arquivo (o gasto exato, a saude e
//     os sinais, a tendencia, a implantacao, datas no fuso de cada clinica,
//     campo vazio vazio), o nome do arquivo e a trilha SEM o texto da busca;
//   - o servidor: a lista lida de novo pela sessao, com os mesmos filtros e
//     a mesma ordem da tela; nenhuma clinica nao grava trilha; sem a trilha
//     gravada, nada sai;
//   - a rota: so a equipe Conduzza (401 e 403 antes de tudo), o CSV com o
//     BOM e o nome, 204, os erros em JSON e o log sem filtro nem busca;
//   - a tela: o pedido e a resposta em texto de recepcao, sem lancar.
// De paciente, so contagens: nada no arquivo, na trilha ou no log.

type Contexto = { userId: string; isProductAdmin: boolean } | null;

const registro = vi.hoisted(() => ({
  contexto: null as Contexto,
  painel: null as unknown,
  erroDoPainel: null as unknown,
  erroDaTrilha: null as unknown,
  rpcs: [] as { nome: string; args: unknown }[],
  inseridos: [] as { tabela: string; linha: unknown }[],
  logs: [] as [string, unknown][],
}));

vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => registro.contexto,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clienteFalso(),
}));
vi.mock("@/lib/log", () => ({
  log: {
    info: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
    warn: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
    error: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
  },
}));

function clienteFalso() {
  return {
    rpc: async (nome: string, args?: unknown) => {
      registro.rpcs.push({ nome, args });
      return registro.erroDoPainel
        ? { data: null, error: registro.erroDoPainel }
        : { data: registro.painel, error: null };
    },
    from: (tabela: string) => ({
      insert: async (linha: unknown) => {
        registro.inseridos.push({ tabela, linha });
        return { data: null, error: registro.erroDaTrilha };
      },
    }),
  };
}

import { exportarPainel } from "@/app/(app)/painel-geral/exportar/exportar-painel";
import { POST } from "@/app/(app)/painel-geral/exportar/route";
import {
  COLUNAS_DA_EXPORTACAO_DO_PAINEL,
  corpoDoPedidoDoPainel,
  detalhesDaTrilhaDoPainel,
  exportacaoDoPainelSchema,
  filtrosEOrdemDoPedido,
  linhasDaExportacaoDoPainel,
  MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU,
  MENSAGEM_EXPORTACAO_DO_PAINEL_TRILHA_FALHOU,
  nomeDoArquivoDoPainel,
} from "@/components/painel-geral/exportacao-do-painel";
import { pedirExportacaoDoPainel } from "@/components/painel-geral/exportar-painel";
import {
  FILTROS_PADRAO,
  ORDEM_PADRAO,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { lerPainelDoBanco } from "@/lib/queries/painel-geral";

const AURORA = "a1111111-1111-4111-8111-111111111111";
const ARVORE = "b2222222-2222-4222-8222-222222222222";
const BELA = "c3333333-3333-4333-8333-333333333333";
const PESSOA = "d4444444-4444-4444-8444-444444444444";
const EU = "e5555555-5555-4555-8555-555555555555";
const GERADO_EM = "2026-10-26T15:00:00+00:00";

const PASSOS = [
  "whatsapp_conectado",
  "equipe_com_duas_pessoas",
  "procedimentos_cadastrados",
  "profissionais_cadastrados",
  "regua_de_confirmacao_ligada",
  "anuncios_conectados",
];

/** Uma linha do painel no formato do banco (migration 20261026110000). */
function linhaDoBanco(campos: Record<string, unknown> = {}) {
  const feitos = (campos.feitos as boolean[] | undefined) ?? [
    true,
    true,
    false,
    false,
    false,
    false,
  ];
  const passos = PASSOS.map((chave, indice) => ({
    chave,
    feito: feitos[indice] ?? false,
    quantidade: feitos[indice] ? 1 : 0,
  }));
  const linha: Record<string, unknown> = {
    id: AURORA,
    nome: "Clínica Aurora",
    criada_em: "2026-09-01T12:00:00+00:00",
    fuso: "America/Fortaleza",
    em_uso: true,
    ultimo_acesso: {
      // 13:05 UTC = 10:05 em Fortaleza
      em: "2026-10-26T13:05:00+00:00",
      user_id: PESSOA,
      nome: "Ana Souza",
      email: "ana@aurora.com.br",
      papel: "admin",
      implementador: false,
      equipe_conduzza: false,
    },
    membros_ativos: 3,
    membros_pendentes: 1,
    membros_equipe_conduzza: 0,
    pessoas: [{ nome: "Ana Souza", email: "ana@aurora.com.br" }],
    numeros_total: 2,
    numeros_conectados: 1,
    numeros: [],
    contatos: 120,
    leads_30_dias: 14,
    conversas_30_dias: 40,
    ultima_mensagem_em: null,
    suspensao: null,
    agente: {
      estado: "teste",
      modo: "contatos",
      liberada: true,
      pausada_pela_clinica: false,
      telefones_ligados: 1,
    },
    gasto: {
      ultimas_24h_centavos_usd: 0,
      mes_centavos_usd: 0,
      ultimas_24h_sem_simulador_centavos_usd: 0,
      mes_sem_simulador_centavos_usd: 0,
      ultimas_24h_microdolares: 0,
      mes_microdolares: 1000,
      ultimas_24h_sem_simulador_microdolares: 0,
      mes_sem_simulador_microdolares: 0,
      ultimas_24h_chamadas: 0,
      mes_chamadas: 7,
      ultimas_24h_sem_simulador_chamadas: 0,
      mes_sem_simulador_chamadas: 0,
    },
    teto_diario_centavos_usd: 500,
    saude: "atencao",
    sinais: [
      {
        chave: "falhas_de_envio",
        nivel: "atencao",
        quantidade: 3,
        desde: "2026-10-24T09:00:00+00:00",
      },
    ],
    implantacao: {
      feitos: passos.filter((passo) => passo.feito).length,
      total: 6,
      passos,
      anuncios: { meta: false, google: false },
    },
    tendencia: {
      leads: {
        atual: 14,
        anterior: 10,
        variacao_percentual: 40,
        direcao: "subindo",
      },
      conversas: {
        atual: 40,
        anterior: 38,
        variacao_percentual: 5,
        direcao: "estavel",
      },
    },
    ultima_nota_em: "2026-10-25T02:30:00+00:00",
    ...campos,
  };
  delete linha.feitos;
  return linha;
}

function painelDoBanco(linhas: Record<string, unknown>[]) {
  const saude = { saudavel: 0, atencao: 0, em_risco: 0 };
  for (const linha of linhas) {
    saude[linha.saude as keyof typeof saude] += 1;
  }
  return {
    gerado_em: GERADO_EM,
    totais: {
      clinicas: linhas.length,
      em_uso: linhas.filter((linha) => linha.em_uso).length,
      sem_uso: linhas.filter((linha) => !linha.em_uso).length,
      suspensas: 0,
      agente_liberado: 1,
      gasto_mes_centavos_usd: 0,
      gasto_mes_microdolares: 1000,
      chamadas_mes: 7,
      saude,
    },
    clinicas: linhas,
  };
}

const LINHAS = [
  linhaDoBanco(),
  linhaDoBanco({
    id: ARVORE,
    nome: "Odonto Árvore",
    em_uso: false,
    ultimo_acesso: null,
    numeros_total: 0,
    numeros_conectados: 0,
    agente: {
      estado: "desligado",
      modo: null,
      liberada: false,
      pausada_pela_clinica: false,
      telefones_ligados: 0,
    },
    gasto: {
      ...(linhaDoBanco().gasto as Record<string, unknown>),
      mes_microdolares: 0,
      mes_chamadas: 0,
    },
    teto_diario_centavos_usd: null,
    saude: "em_risco",
    sinais: [
      { chave: "sem_uso", nivel: "em_risco", quantidade: null, desde: null },
      {
        chave: "sem_numero_de_whatsapp",
        nivel: "atencao",
        quantidade: null,
        desde: null,
      },
    ],
    feitos: [false, false, false, false, false, false],
    tendencia: {
      leads: {
        atual: 14,
        anterior: 0,
        variacao_percentual: null,
        direcao: "sem_base",
      },
      conversas: {
        atual: 40,
        anterior: 80,
        variacao_percentual: -50,
        direcao: "caindo",
      },
    },
    ultima_nota_em: null,
  }),
  linhaDoBanco({
    id: BELA,
    nome: "Estética Bela",
    saude: "saudavel",
    sinais: [],
    feitos: [true, true, true, true, true, true],
    gasto: {
      ...(linhaDoBanco().gasto as Record<string, unknown>),
      mes_centavos_usd: 310,
      mes_microdolares: 3_100_400,
      mes_chamadas: 40,
    },
  }),
];

beforeEach(() => {
  registro.contexto = { userId: EU, isProductAdmin: true };
  registro.painel = painelDoBanco(LINHAS);
  // Os totais batem com as linhas (a leitura confere o gasto exato).
  (registro.painel as { totais: Record<string, unknown> }).totais = {
    ...(registro.painel as { totais: Record<string, unknown> }).totais,
    gasto_mes_centavos_usd: 310,
    gasto_mes_microdolares: 3_101_400,
    chamadas_mes: 47,
  };
  registro.erroDoPainel = null;
  registro.erroDaTrilha = null;
  registro.rpcs = [];
  registro.inseridos = [];
  registro.logs = [];
});

describe("as regras puras da exportação", () => {
  it("o corpo do pedido leva só o que foge do padrão; sem filtro, {}", () => {
    expect(corpoDoPedidoDoPainel(FILTROS_PADRAO, ORDEM_PADRAO)).toEqual({});
    expect(
      corpoDoPedidoDoPainel(
        { ...FILTROS_PADRAO, busca: "  joao ", saude: "em_risco" },
        { coluna: "ia", sentido: "desc" },
      ),
    ).toEqual({
      busca: "joao",
      saude: "em_risco",
      ordem: "ia",
      sentido: "desc",
    });
  });

  it("o Zod estrito: só os valores das listas e a busca de até 80", () => {
    expect(exportacaoDoPainelSchema.safeParse({}).success).toBe(true);
    for (const invalido of [
      { saude: "otima" },
      { ordem: "nome" },
      { sentido: "cima" },
      { busca: "x".repeat(81) },
      { clinicId: AURORA },
      "tudo",
    ]) {
      expect(
        exportacaoDoPainelSchema.safeParse(invalido).success,
        JSON.stringify(invalido),
      ).toBe(false);
    }
    expect(
      filtrosEOrdemDoPedido({ saude: "atencao", ordem: "implantacao" }),
    ).toEqual({
      filtros: { ...FILTROS_PADRAO, saude: "atencao" },
      ordem: { coluna: "implantacao", sentido: "asc" },
    });
  });

  it("as linhas: as colunas da lista, o gasto exato, os sinais, a tendência e a implantação; datas no fuso; vazio fica vazio", () => {
    const painel = lerPainelDoBanco(registro.painel);
    const [cabecalho, aurora, arvore] = linhasDaExportacaoDoPainel(
      painel.clinicas,
    );
    expect(cabecalho).toEqual([...COLUNAS_DA_EXPORTACAO_DO_PAINEL]);
    const coluna = (linha: string[] | undefined, nome: string) =>
      linha?.[cabecalho!.indexOf(nome)];
    expect(coluna(aurora, "Clínica")).toBe("Clínica Aurora");
    expect(coluna(aurora, "Criada em")).toBe("01/09/2026");
    expect(coluna(aurora, "Saúde")).toBe("Atenção");
    expect(coluna(aurora, "Sinais de alerta")).toBe("3 falhas de envio");
    expect(coluna(aurora, "Último acesso")).toBe("26/10/2026, 10:05");
    expect(coluna(aurora, "Último acesso por")).toBe("Ana Souza");
    expect(coluna(aurora, "Falhas de envio em 7 dias")).toBe("3");
    expect(coluna(aurora, "Agente de IA")).toBe("Liberado (Teste)");
    expect(coluna(aurora, "IA no mês (US$)")).toBe("0,001");
    expect(coluna(aurora, "Chamadas da IA no mês")).toBe("7");
    expect(coluna(aurora, "Teto de IA por dia (US$)")).toBe("5,00");
    expect(coluna(aurora, "Tendência dos leads")).toBe("+40%");
    expect(coluna(aurora, "Tendência das conversas")).toBe("Estável (+5%)");
    expect(coluna(aurora, "Implantação")).toBe("2 de 6 passos");
    expect(coluna(aurora, "Passos que faltam")).toBe(
      "Procedimentos cadastrados, Profissionais cadastrados, Régua de confirmação ligada, Anúncios conectados (Meta ou rastreio do Google)",
    );
    expect(coluna(aurora, "Conta")).toBe("Ativa");
    expect(coluna(aurora, "Suspensa desde")).toBe("");
    // 02:30 UTC do dia 25 ainda e o dia 24 em Fortaleza.
    expect(coluna(aurora, "Última nota em")).toBe("24/10/2026");

    expect(coluna(arvore, "Sinais de alerta")).toBe(
      "Sem uso há 30 dias, Sem número de WhatsApp",
    );
    expect(coluna(arvore, "Último acesso")).toBe("");
    expect(coluna(arvore, "Último acesso por")).toBe("");
    expect(coluna(arvore, "IA no mês (US$)")).toBe("0,00");
    expect(coluna(arvore, "Teto de IA por dia (US$)")).toBe("");
    expect(coluna(arvore, "Falhas de envio em 7 dias")).toBe("0");
    expect(coluna(arvore, "Tendência dos leads")).toBe("Sem base");
    expect(coluna(arvore, "Tendência das conversas")).toBe("-50%");
    expect(coluna(arvore, "Última nota em")).toBe("");
    // Nenhum dado de paciente: o arquivo nao tem nome nem telefone de
    // contato, so contagens (o nome e da equipe da clinica).
    expect(
      JSON.stringify(linhasDaExportacaoDoPainel(painel.clinicas)),
    ).not.toMatch(/\+55|@paciente/);
  });

  it("o nome do arquivo no dia do fuso padrão do painel", () => {
    expect(nomeDoArquivoDoPainel(new Date("2026-10-26T15:00:00Z"))).toBe(
      "painel-geral-2026-10-26.csv",
    );
    // 02:00 UTC do dia 27 ainda e o dia 26 em Fortaleza.
    expect(nomeDoArquivoDoPainel(new Date("2026-10-27T02:00:00Z"))).toBe(
      "painel-geral-2026-10-26.csv",
    );
  });

  it("a trilha leva a quantidade, os filtros de lista e a ordem; da busca, só que havia uma", () => {
    expect(
      detalhesDaTrilhaDoPainel(
        3,
        { ...FILTROS_PADRAO, busca: "joao@arvore.com", uso: "sem_uso" },
        { coluna: "saude", sentido: "desc" },
      ),
    ).toEqual({
      quantidade: 3,
      filtros: { uso: "sem_uso", com_busca: true },
      ordem: { coluna: "saude", sentido: "desc" },
    });
    expect(detalhesDaTrilhaDoPainel(1, FILTROS_PADRAO, ORDEM_PADRAO)).toEqual({
      quantidade: 1,
      filtros: {},
      ordem: { coluna: "ultimo_acesso", sentido: "desc" },
    });
  });
});

describe("a exportação no servidor", () => {
  const agora = new Date("2026-10-26T15:00:00Z");

  it("lê de novo pela sessão, com os filtros e a ordem da tela; grava UMA linha na trilha antes do arquivo", async () => {
    const resultado = await exportarPainel({
      supabase: clienteFalso() as never,
      userId: EU,
      entrada: { busca: "a", ordem: "ia", sentido: "desc" },
      agora,
    });
    expect(resultado.tipo).toBe("arquivo");
    if (resultado.tipo !== "arquivo") {
      return;
    }
    expect(resultado.nome).toBe("painel-geral-2026-10-26.csv");
    expect(resultado.quantidade).toBe(3);
    expect(resultado.conteudo.startsWith("﻿Clínica;Criada em;Saúde")).toBe(
      true,
    );
    const ordem = ["Estética Bela", "Clínica Aurora", "Odonto Árvore"].map(
      (nome) => resultado.conteudo.indexOf(nome),
    );
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(registro.rpcs).toEqual([
      { nome: "painel_cs_das_clinicas", args: undefined },
    ]);
    expect(registro.inseridos).toEqual([
      {
        tabela: "audit_log",
        linha: {
          clinic_id: null,
          user_id: EU,
          action: "exportou",
          entity: "painel_geral",
          entity_id: null,
          detalhes: {
            quantidade: 3,
            filtros: { com_busca: true },
            ordem: { coluna: "ia", sentido: "desc" },
          },
        },
      },
    ]);
    // Nunca o texto da busca na trilha.
    expect(JSON.stringify(registro.inseridos)).not.toContain('"a"');
  });

  it("o filtro de saúde da tela vale no arquivo", async () => {
    const resultado = await exportarPainel({
      supabase: clienteFalso() as never,
      userId: EU,
      entrada: { saude: "em_risco" },
      agora,
    });
    expect(resultado).toMatchObject({ tipo: "arquivo", quantidade: 1 });
    if (resultado.tipo === "arquivo") {
      expect(resultado.conteudo).toContain("Odonto Árvore");
      expect(resultado.conteudo).not.toContain("Clínica Aurora");
    }
  });

  it("nenhuma clínica com os filtros: vazio, sem trilha", async () => {
    expect(
      await exportarPainel({
        supabase: clienteFalso() as never,
        userId: EU,
        entrada: { busca: "zzz" },
        agora,
      }),
    ).toEqual({ tipo: "vazio" });
    expect(registro.inseridos).toEqual([]);
  });

  it("corpo fora do formato: recusado antes de ler o banco", async () => {
    for (const entrada of [undefined, { saude: "otima" }, { x: 1 }]) {
      expect(
        await exportarPainel({
          supabase: clienteFalso() as never,
          userId: EU,
          entrada,
          agora,
        }),
      ).toEqual({
        tipo: "recusada",
        status: 400,
        mensagem: TEXTOS_DO_PAINEL.dadosInvalidos,
      });
    }
    expect(registro.rpcs).toEqual([]);
  });

  it("a leitura falhou (ou veio fora do formato): 500, sem trilha", async () => {
    registro.erroDoPainel = { code: "42501" };
    expect(
      await exportarPainel({
        supabase: clienteFalso() as never,
        userId: EU,
        entrada: {},
        agora,
      }),
    ).toEqual({
      tipo: "falhou",
      status: 500,
      mensagem: MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU,
      motivo: "leitura",
    });
    registro.erroDoPainel = null;
    registro.painel = { clinicas: "x" };
    expect(
      await exportarPainel({
        supabase: clienteFalso() as never,
        userId: EU,
        entrada: {},
        agora,
      }),
    ).toMatchObject({ tipo: "falhou", motivo: "leitura" });
    expect(registro.inseridos).toEqual([]);
  });

  it("a trilha não gravou: 503, e o arquivo não sai", async () => {
    registro.erroDaTrilha = { code: "42501" };
    expect(
      await exportarPainel({
        supabase: clienteFalso() as never,
        userId: EU,
        entrada: {},
        agora,
      }),
    ).toEqual({
      tipo: "falhou",
      status: 503,
      mensagem: MENSAGEM_EXPORTACAO_DO_PAINEL_TRILHA_FALHOU,
      motivo: "trilha",
    });
  });
});

describe("a rota POST /painel-geral/exportar", () => {
  function pedido(
    corpo: string | null,
    tipo = "application/json",
  ): NextRequest {
    return new NextRequest("https://app.conduzza.test/painel-geral/exportar", {
      method: "POST",
      headers: { "content-type": tipo },
      body: corpo,
    });
  }

  it("sem sessão: 401; quem não é da equipe Conduzza: 403; nada é lido", async () => {
    registro.contexto = null;
    const sem = await POST(pedido("{}"));
    expect(sem.status).toBe(401);
    expect(await sem.json()).toEqual({
      mensagem: TEXTOS_DO_PAINEL.sessaoExpirada,
    });
    registro.contexto = { userId: EU, isProductAdmin: false };
    const outro = await POST(pedido("{}"));
    expect(outro.status).toBe(403);
    expect(await outro.json()).toEqual({
      mensagem: TEXTOS_DO_PAINEL.soEquipeConduzza,
    });
    expect(registro.rpcs).toEqual([]);
    expect(registro.inseridos).toEqual([]);
  });

  it("o arquivo: CSV com o BOM, o nome no Content-Disposition, sem cache; o log sem filtro nem busca", async () => {
    const resposta = await POST(
      pedido(JSON.stringify({ busca: "joao@arvore.com" })),
    );
    expect(resposta.status).toBe(204);
    const comClinicas = await POST(pedido(JSON.stringify({ busca: "a" })));
    expect(comClinicas.status).toBe(200);
    expect(comClinicas.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(comClinicas.headers.get("content-disposition")).toMatch(
      /^attachment; filename="painel-geral-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(comClinicas.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await comClinicas.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(registro.logs).toEqual([
      [
        "painel_geral_exportado",
        { user_id: EU, count: 3, duration_ms: expect.any(Number) },
      ],
    ]);
    expect(JSON.stringify(registro.logs)).not.toContain("joao");
  });

  it("corpo que não é JSON: 400; a trilha que falhou: 503 com o texto, e o log só do passo", async () => {
    const naoJson = await POST(pedido("busca=a", "text/plain"));
    expect(naoJson.status).toBe(400);
    expect(await naoJson.json()).toEqual({
      mensagem: TEXTOS_DO_PAINEL.dadosInvalidos,
    });

    registro.erroDaTrilha = { code: "42501" };
    const semTrilha = await POST(pedido("{}"));
    expect(semTrilha.status).toBe(503);
    expect(await semTrilha.json()).toEqual({
      mensagem: MENSAGEM_EXPORTACAO_DO_PAINEL_TRILHA_FALHOU,
    });
    expect(registro.logs).toEqual([
      [
        "exportacao_do_painel_falhou",
        {
          user_id: EU,
          status: "trilha",
          http_status: 503,
          duration_ms: expect.any(Number),
        },
      ],
    ]);
  });
});

describe("o pedido da tela", () => {
  function resposta(
    corpo: BodyInit | null,
    init: ResponseInit & { redirected?: boolean } = {},
  ): typeof fetch {
    return async () => {
      const r = new Response(corpo, init);
      if (init.redirected) {
        Object.defineProperty(r, "redirected", { value: true });
      }
      return r;
    };
  }

  it("o arquivo com o nome da rota; 204 vira vazio", async () => {
    const arquivo = await pedirExportacaoDoPainel(
      {},
      resposta("﻿Clínica", {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition":
            'attachment; filename="painel-geral-2026-10-26.csv"',
        },
      }),
    );
    expect(arquivo).toMatchObject({
      tipo: "arquivo",
      nome: "painel-geral-2026-10-26.csv",
    });
    expect(
      await pedirExportacaoDoPainel({}, resposta(null, { status: 204 })),
    ).toEqual({ tipo: "vazio" });
  });

  it("erros em texto de recepção, com o tentar de novo só quando ajuda; nunca lança", async () => {
    expect(
      await pedirExportacaoDoPainel(
        {},
        resposta(
          JSON.stringify({ mensagem: MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
      ),
    ).toEqual({
      tipo: "erro",
      mensagem: MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU,
      podeTentarDeNovo: true,
    });
    expect(
      await pedirExportacaoDoPainel(
        {},
        resposta(
          JSON.stringify({ mensagem: TEXTOS_DO_PAINEL.soEquipeConduzza }),
          {
            status: 403,
          },
        ),
      ),
    ).toEqual({
      tipo: "erro",
      mensagem: TEXTOS_DO_PAINEL.soEquipeConduzza,
      podeTentarDeNovo: false,
    });
    expect(
      await pedirExportacaoDoPainel(
        {},
        resposta("<html>login</html>", { status: 200, redirected: true }),
      ),
    ).toEqual({
      tipo: "erro",
      mensagem: TEXTOS_DO_PAINEL.sessaoExpirada,
      podeTentarDeNovo: false,
    });
    expect(
      await pedirExportacaoDoPainel({}, async () => {
        throw new TypeError("rede");
      }),
    ).toEqual({
      tipo: "erro",
      mensagem: TEXTOS_DO_PAINEL.semResposta,
      podeTentarDeNovo: true,
    });
    expect(
      await pedirExportacaoDoPainel({}, resposta("quebrou", { status: 502 })),
    ).toEqual({
      tipo: "erro",
      mensagem: MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU,
      podeTentarDeNovo: true,
    });
  });
});
