import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  recusadoPelasRegrasDeHoje,
  recusasDasVersoesAprovadas,
} from "@/app/(app)/cadastros/recusas-do-preparo";
import {
  fetchPreparoDaHabilidade,
  preparoDaHabilidade,
  versoesEmVigorDosAtivos,
  type VersaoDoPreparo,
} from "@/lib/queries/preparo";

// Revisao curta da AG7 (a sobra da CURTA-5 na Tela 6): a nota de "Enviar
// orientação de preparo" contava como em vigor o texto aprovado que as regras
// de hoje recusam, e esse texto nao sai (conferirParaEnvio e a regua). Agora
// a leitura da Tela 6 confere as regras de hoje no servidor, com o mesmo
// criterio do chip "Aprovada, sem envio" de Cadastros, e le o texto so das
// versoes em vigor. Contra um cliente do Supabase dublado; nada aqui chama
// rede, banco ou a OpenAI.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const COLONO = "3d3d3d3d-0000-4000-8000-000000000001";
const ENDO = "3d3d3d3d-0000-4000-8000-000000000002";
const INATIVO = "3d3d3d3d-0000-4000-8000-000000000003";
const RT = "4e4e4e4e-0000-4000-8000-000000000001";
const RT_ANTIGO = "4e4e4e4e-0000-4000-8000-000000000002";
const USUARIO_DO_RT = "5f5f5f5f-0000-4000-8000-000000000001";

/** Remedio, dose e jejum so avisam (D-80): o texto sai. */
const TEXTO_QUE_SAI = "Jejum de 8 horas antes do exame.";
/** Link: as regras de hoje recusam, e o texto nao sai. */
const TEXTO_RECUSADO = "Veja o preparo completo em www.clinicaexemplo.com.br.";

type Linha = Record<string, unknown>;

function versao(campos: Partial<Linha> & { id: string }): Linha {
  return {
    clinic_id: CLINICA,
    procedure_id: COLONO,
    versao: 1,
    situacao: "aprovado",
    texto: TEXTO_QUE_SAI,
    texto_sha256: "a".repeat(64),
    nome_do_procedimento: "Colonoscopia",
    origem: "cadastro",
    escrito_por: USUARIO_DO_RT,
    escrito_em: "2026-11-03T12:00:00Z",
    aprovado_por: USUARIO_DO_RT,
    aprovado_em: "2026-11-03T12:10:00Z",
    rt_id: RT,
    encerrado_por: null,
    encerrado_em: null,
    comentario: null,
    ...campos,
  };
}

const RT_ABERTO: Linha = {
  id: RT,
  clinic_id: CLINICA,
  user_id: USUARIO_DO_RT,
  nome: "Dra. Ana Souza",
  conselho: "CRM",
  numero: "12345",
  uf: "CE",
  desde: "2026-11-01T12:00:00Z",
  ate: null,
};

const PROCEDIMENTOS: Linha[] = [
  { id: COLONO, clinic_id: CLINICA, name: "Colonoscopia", active: true },
  { id: ENDO, clinic_id: CLINICA, name: "Endoscopia", active: true },
  { id: INATIVO, clinic_id: CLINICA, name: "Raio X", active: false },
];

/**
 * O cliente dublado: devolve so as colunas pedidas no select (a leitura das
 * versoes nao traz o texto) e guarda as leituras do texto.
 */
function clienteCom(
  tabelas: Record<string, Linha[]>,
  erro: { tabela: string } | null = null,
) {
  const leiturasDoTexto: string[][] = [];
  function consulta(tabela: string) {
    let colunas: string[] = [];
    const filtros: ((linha: Linha) => boolean)[] = [];
    const resolver = () => {
      if (erro?.tabela === tabela) {
        return { data: null, error: { message: "falhou" } };
      }
      const linhas = (tabelas[tabela] ?? [])
        .filter((linha) => filtros.every((filtro) => filtro(linha)))
        .map((linha) => Object.fromEntries(colunas.map((c) => [c, linha[c]])));
      return { data: linhas, error: null };
    };
    const api = {
      select: (texto: string) => {
        colunas = texto.split(",").map((c) => c.trim());
        return api;
      },
      eq: (coluna: string, valor: unknown) => {
        filtros.push((linha) => linha[coluna] === valor);
        return api;
      },
      is: (coluna: string, valor: unknown) => {
        filtros.push((linha) => linha[coluna] === valor);
        return api;
      },
      in: (coluna: string, valores: readonly unknown[]) => {
        if (tabela === "preparo_do_procedimento" && colunas.includes("texto")) {
          leiturasDoTexto.push(valores.map(String));
        }
        filtros.push((linha) => valores.includes(linha[coluna]));
        return api;
      },
      order: () => api,
      maybeSingle: async () => {
        const r = resolver();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      then: <T>(
        resolverPromessa: (valor: ReturnType<typeof resolver>) => T,
        rejeitar?: (motivo: unknown) => T,
      ) => Promise.resolve(resolver()).then(resolverPromessa, rejeitar),
    };
    return api;
  }
  const cliente = { from: (tabela: string) => consulta(tabela) };
  return {
    cliente: cliente as unknown as SupabaseClient,
    leiturasDoTexto,
  };
}

function tabelas(versoes: Linha[], extras: Record<string, Linha[]> = {}) {
  return {
    preparo_do_procedimento: versoes,
    responsavel_tecnico: [RT_ABERTO],
    procedure: PROCEDIMENTOS,
    clinic_member: [
      { clinic_id: CLINICA, user_id: USUARIO_DO_RT, status: "ativo" },
    ],
    ...extras,
  };
}

function lida(linha: Linha): VersaoDoPreparo {
  return {
    id: linha.id as string,
    procedureId: linha.procedure_id as string,
    versao: linha.versao as number,
    situacao: linha.situacao as VersaoDoPreparo["situacao"],
    texto: null,
    textoSha256: linha.texto_sha256 as string,
    nomeDoProcedimento: linha.nome_do_procedimento as string,
    origem: "cadastro",
    escritoPor: null,
    escritoEm: linha.escrito_em as string,
    aprovadoPor: null,
    aprovadoEm: null,
    rtId: (linha.rt_id as string | null) ?? null,
    encerradoPor: null,
    encerradoEm: null,
    comentario: null,
  };
}

describe("versoesEmVigorDosAtivos", () => {
  const rtAberto = {
    id: RT,
    userId: USUARIO_DO_RT,
    nome: "Dra. Ana Souza",
    conselho: "CRM",
    numero: "12345",
    uf: "CE",
    desde: "2026-11-01T12:00:00Z",
    ate: null,
  };
  const ativos = PROCEDIMENTOS.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    active: p.active as boolean,
  }));

  it("a aprovada mais nova de cada procedimento ativo com o chip aprovada", () => {
    const versoes = [
      lida(versao({ id: "v1", versao: 1 })),
      lida(
        versao({
          id: "v2",
          procedure_id: ENDO,
          nome_do_procedimento: "Endoscopia",
        }),
      ),
    ];
    expect(
      versoesEmVigorDosAtivos({ versoes, rtAberto, rtComAcesso: true }, ativos),
    ).toEqual(["v1", "v2"]);
  });

  it("fora: o procedimento inativo, o RT de antes, o nome mudado e o RT sem acesso", () => {
    const doInativo = lida(
      versao({
        id: "v3",
        procedure_id: INATIVO,
        nome_do_procedimento: "Raio X",
      }),
    );
    const doRtAntigo = lida(versao({ id: "v4", rt_id: RT_ANTIGO }));
    const nomeVelho = lida(
      versao({
        id: "v5",
        procedure_id: ENDO,
        nome_do_procedimento: "Endoscopia alta",
      }),
    );
    expect(
      versoesEmVigorDosAtivos(
        {
          versoes: [doInativo, doRtAntigo, nomeVelho],
          rtAberto,
          rtComAcesso: true,
        },
        ativos,
      ),
    ).toEqual([]);
    expect(
      versoesEmVigorDosAtivos(
        {
          versoes: [lida(versao({ id: "v1" }))],
          rtAberto,
          rtComAcesso: false,
        },
        ativos,
      ),
    ).toEqual([]);
  });
});

describe("preparoDaHabilidade", () => {
  const recusaSoOLink = (texto: string) => texto === TEXTO_RECUSADO;

  it("sem versao em vigor: sem texto aprovado", () => {
    expect(preparoDaHabilidade([], new Map(), recusaSoOLink)).toBe(
      "sem_texto_aprovado",
    );
  });

  it("todas recusadas pelas regras de hoje: aprovada, sem envio", () => {
    const textos = new Map([
      ["v1", TEXTO_RECUSADO],
      ["v2", TEXTO_RECUSADO],
    ]);
    expect(preparoDaHabilidade(["v1", "v2"], textos, recusaSoOLink)).toBe(
      "aprovada_sem_envio",
    );
  });

  it("uma que sai basta; e o texto que nao veio na leitura conta como o que sai (a tela nao inventa a nota)", () => {
    const textos = new Map([
      ["v1", TEXTO_RECUSADO],
      ["v2", TEXTO_QUE_SAI],
    ]);
    expect(preparoDaHabilidade(["v1", "v2"], textos, recusaSoOLink)).toBe(
      "sai",
    );
    expect(
      preparoDaHabilidade(
        ["v1", "v3"],
        new Map([["v1", TEXTO_RECUSADO]]),
        recusaSoOLink,
      ),
    ).toBe("sai");
  });
});

describe("fetchPreparoDaHabilidade: as regras de hoje conferidas no servidor", () => {
  it("o texto em vigor que sai: sem nota; o texto lido so das versoes em vigor", async () => {
    const { cliente, leiturasDoTexto } = clienteCom(
      tabelas([
        // Substituida e aguardando nao entram (a leitura so pede aprovado).
        versao({
          id: "v0",
          versao: 1,
          situacao: "substituido",
          texto: TEXTO_RECUSADO,
        }),
        versao({ id: "v1", versao: 2 }),
        versao({
          id: "v9",
          versao: 3,
          situacao: "aguardando_rt",
          texto: TEXTO_RECUSADO,
        }),
      ]),
    );
    await expect(
      fetchPreparoDaHabilidade(cliente, CLINICA, recusadoPelasRegrasDeHoje),
    ).resolves.toBe("sai");
    expect(leiturasDoTexto).toEqual([["v1"]]);
  });

  it("o texto aprovado que as regras de hoje recusam nao conta: aprovada, sem envio", async () => {
    const { cliente } = clienteCom(
      tabelas([versao({ id: "v1", texto: TEXTO_RECUSADO })]),
    );
    await expect(
      fetchPreparoDaHabilidade(cliente, CLINICA, recusadoPelasRegrasDeHoje),
    ).resolves.toBe("aprovada_sem_envio");
  });

  it("um procedimento com texto que sai e outro recusado: sem nota (o recusado passa para a equipe, como o sem texto)", async () => {
    const { cliente } = clienteCom(
      tabelas([
        versao({ id: "v1", texto: TEXTO_RECUSADO }),
        versao({
          id: "v2",
          procedure_id: ENDO,
          nome_do_procedimento: "Endoscopia",
        }),
      ]),
    );
    await expect(
      fetchPreparoDaHabilidade(cliente, CLINICA, recusadoPelasRegrasDeHoje),
    ).resolves.toBe("sai");
  });

  it("sem aprovada, sem RT ou so do procedimento inativo: sem texto aprovado, sem ler texto nenhum", async () => {
    for (const montado of [
      clienteCom(tabelas([])),
      clienteCom(tabelas([versao({ id: "v1" })], { responsavel_tecnico: [] })),
      clienteCom(
        tabelas([
          versao({
            id: "v3",
            procedure_id: INATIVO,
            nome_do_procedimento: "Raio X",
          }),
        ]),
      ),
    ]) {
      await expect(
        fetchPreparoDaHabilidade(
          montado.cliente,
          CLINICA,
          recusadoPelasRegrasDeHoje,
        ),
      ).resolves.toBe("sem_texto_aprovado");
      expect(montado.leiturasDoTexto).toEqual([]);
    }
  });

  // Decisao do dono de 06/11/2026: a conferencia do registro nao conta mais.
  it("o registro nao conferido nao tira a orientacao aprovada", async () => {
    const semConferencia = tabelas([versao({ id: "v1" })]);
    semConferencia.responsavel_tecnico = semConferencia.responsavel_tecnico.map(
      (r: Record<string, unknown>) => ({ ...r, registro_conferido_em: null }),
    );
    const { cliente } = clienteCom(semConferencia);
    await expect(
      fetchPreparoDaHabilidade(cliente, CLINICA, recusadoPelasRegrasDeHoje),
    ).resolves.toBe("sai");
  });

  it("a leitura que falha lanca (a pagina nao mostra a nota sem conferir)", async () => {
    const { cliente } = clienteCom(tabelas([versao({ id: "v1" })]), {
      tabela: "procedure",
    });
    await expect(
      fetchPreparoDaHabilidade(cliente, CLINICA, recusadoPelasRegrasDeHoje),
    ).rejects.toThrow();
  });
});

describe("recusadoPelasRegrasDeHoje: o criterio do chip Aprovada, sem envio", () => {
  it("o mesmo das recusas de Cadastros, texto a texto", () => {
    for (const texto of [
      TEXTO_QUE_SAI,
      TEXTO_RECUSADO,
      "Tome 2 comprimidos de bisacodil na véspera.",
      "Resultado garantido: você sai sem dor.",
    ]) {
      const recusas = recusasDasVersoesAprovadas([
        { id: "v", situacao: "aprovado", texto },
      ]);
      expect(recusadoPelasRegrasDeHoje(texto), texto).toBe(
        recusas.v !== undefined,
      );
    }
    expect(recusadoPelasRegrasDeHoje(TEXTO_QUE_SAI)).toBe(false);
    expect(recusadoPelasRegrasDeHoje(TEXTO_RECUSADO)).toBe(true);
  });
});
