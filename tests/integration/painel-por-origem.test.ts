import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fetchFunilDoPeriodo,
  fetchSerieDiariaDoPeriodo,
} from "@/lib/queries/relatorios";
import { adminClient } from "../rls/stack";

// Painel por origem (decisao do dono de 17/11/2026) contra o banco REAL:
// grupo_de_origem e o p_grupo de funil_do_periodo e de
// serie_diaria_do_periodo (migration 20261117110000). Escrito em 17/11/2026
// com a migration NAO aplicada e NAO rodado: so passa depois dela
// (npm run test:integration -- painel-por-origem).
//
// Clinica e_de_teste (o motor de producao a ignora), apagada no fim. Datas
// fixas de outubro de 2026 em America/Fortaleza (UTC-3, sem horario de
// verao): o dia civil de cada lead e conhecido de antemao.
//
// Os cinco leads do periodo (dias 10 a 13), um por jeito de cair num grupo:
//   M1  origem Meta, canal trafego_pago (anuncio)      dia 10   meta
//   M2  so o clique do anuncio (ctwa_clid), sem canal  dia 10*  meta
//   G1  origem Google, canal trafego_pago              dia 11   google
//   O1  canal redes_sociais                            dia 12   outras
//   N1  sem canal                                      dia 13   nao_rastreada
// (*) M2 chega as 23:30 locais do dia 10, que ja e dia 11 em UTC.
// No periodo anterior (dias 6 a 9): P1, da Meta, no dia 7.
// Consultas: a de M1 criada no dia 12 e com comparecimento no dia 13; a de
// G1 criada no dia 11 e com falta no dia 13.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const TZ = "America/Fortaleza";
const DIA_DE = "2026-10-10";
const DIA_ATE = "2026-10-13";
// Os mesmos limites que janelaDoPeriodo calcula para DIA_DE e DIA_ATE.
const JANELA = {
  p_de: "2026-10-10T03:00:00.000Z",
  p_ate: "2026-10-14T03:00:00.000Z",
};

const GRUPOS = ["meta", "google", "outras", "nao_rastreada"] as const;

let clinicId = "";

type Bloco = {
  leads: number;
  agendamentos_criados: number;
  comparecimentos: number;
  faltas: number;
  coorte: { leads: number; agendaram: number; compareceram: number };
  por_canal: { canal: string | null; leads: number }[];
  por_campanha: { leads: number }[];
  por_grupo: Record<string, number>;
};

type Ponto = {
  dia: string;
  leads: number;
  agendadas: number;
  por_grupo: Record<string, number>;
};

beforeAll(async () => {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Painel por origem ${sufixo}`,
      slug: `painel-origem-${sufixo}`,
      timezone: TZ,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicId = clinica!.id as string;

  const lead = async (
    final: string,
    chegada: string,
    origem: Record<string, unknown> = {},
  ): Promise<string> => {
    const { data } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: `+55849900520${final}`,
        first_contact_at: chegada,
        ...origem,
      })
      .select("id")
      .single()
      .throwOnError();
    return data!.id as string;
  };

  // A origem que a ingestao grava para o anuncio de clique para WhatsApp
  // (contact_origem_de_anuncio_coerente: canal trafego_pago, origem Meta).
  const m1 = await lead("01", "2026-10-10T15:00:00.000Z", {
    source_method: "anuncio_ctwa",
    source_channel: "trafego_pago",
    source_origin: "Meta",
  });
  await lead("02", "2026-10-11T02:30:00.000Z", {
    ctwa_clid: `clid-painel-${sufixo}`,
  });
  // A origem do clique no site vindo do Google
  // (contact_origem_do_clique_do_site_coerente).
  const g1 = await lead("03", "2026-10-11T15:00:00.000Z", {
    source_method: "clique_site",
    source_channel: "trafego_pago",
    source_origin: "Google",
  });
  await lead("04", "2026-10-12T15:00:00.000Z", {
    source_channel: "redes_sociais",
  });
  await lead("05", "2026-10-13T15:00:00.000Z");
  // Periodo anterior.
  await lead("06", "2026-10-07T15:00:00.000Z", {
    source_method: "anuncio_ctwa",
    source_channel: "trafego_pago",
    source_origin: "Meta",
  });

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Origem" })
    .select("id")
    .single()
    .throwOnError();
  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicId,
      name: "Avaliação",
      default_duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: prof!.id,
      procedure_id: proc!.id,
      insurance_id: null,
      price_cents: 10000,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();

  const consulta = (
    contato: string,
    status: string,
    inicio: string,
    fim: string,
    criadaEm: string,
  ) => ({
    clinic_id: clinicId,
    contact_id: contato,
    professional_id: prof!.id,
    service_link_id: vinculo!.id,
    status,
    starts_at: inicio,
    ends_at: fim,
    created_at: criadaEm,
  });
  await admin
    .from("appointment")
    .insert([
      consulta(
        m1,
        "compareceu",
        "2026-10-13T12:00:00.000Z",
        "2026-10-13T12:30:00.000Z",
        "2026-10-12T15:00:00.000Z",
      ),
      consulta(
        g1,
        "faltou",
        "2026-10-13T13:00:00.000Z",
        "2026-10-13T13:30:00.000Z",
        "2026-10-11T16:00:00.000Z",
      ),
    ])
    .throwOnError();
});

afterAll(async () => {
  if (clinicId) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

async function funilBruto(grupo?: string): Promise<{
  atual: Bloco;
  anterior?: Bloco;
}> {
  const { data, error } = await admin.rpc("funil_do_periodo", {
    p_clinic_id: clinicId,
    ...JANELA,
    p_de_anterior: "2026-10-06T03:00:00.000Z",
    ...(grupo === undefined ? {} : { p_grupo: grupo }),
  });
  expect(error).toBeNull();
  return data as { atual: Bloco; anterior?: Bloco };
}

async function serieBruta(grupo?: string): Promise<Ponto[]> {
  const { data, error } = await admin.rpc("serie_diaria_do_periodo", {
    p_clinic_id: clinicId,
    ...JANELA,
    ...(grupo === undefined ? {} : { p_grupo: grupo }),
  });
  expect(error).toBeNull();
  return data as Ponto[];
}

describe("funil_do_periodo: os quatro grupos", () => {
  it("sem filtro, os quatro grupos somam o total de leads", async () => {
    const funil = await fetchFunilDoPeriodo(
      admin,
      clinicId,
      TZ,
      DIA_DE,
      DIA_ATE,
    );
    expect(funil.atual.leads).toBe(5);
    expect(funil.atual.porGrupo).toEqual({
      meta: 2,
      google: 1,
      outras: 1,
      nao_rastreada: 1,
    });
    const soma = GRUPOS.reduce(
      (total, grupo) => total + (funil.atual.porGrupo?.[grupo] ?? 0),
      0,
    );
    expect(soma).toBe(funil.atual.leads);
    expect(funil.atual.agendamentosCriados).toBe(2);
    expect(funil.atual.comparecimentos).toBe(1);
    expect(funil.atual.faltas).toBe(1);
    // No periodo anterior so ha lead da Meta.
    expect(funil.anterior?.leads).toBe(1);
    expect(funil.anterior?.porGrupo).toEqual({
      meta: 1,
      google: 0,
      outras: 0,
      nao_rastreada: 0,
    });
  });

  it("o banco só manda em por_grupo os grupos que têm lead", async () => {
    const bruto = await funilBruto();
    expect(bruto.atual.por_grupo).toEqual({
      meta: 2,
      google: 1,
      outras: 1,
      nao_rastreada: 1,
    });
    expect(bruto.anterior?.por_grupo).toEqual({ meta: 1 });
  });

  it("p_grupo = meta: só os leads da Meta na coorte, no por_canal e nas consultas", async () => {
    const funil = await fetchFunilDoPeriodo(
      admin,
      clinicId,
      TZ,
      DIA_DE,
      DIA_ATE,
      { grupo: "meta" },
    );
    expect(funil.atual.leads).toBe(2);
    expect(funil.atual.coorte).toEqual({
      leads: 2,
      agendaram: 1,
      compareceram: 1,
    });
    // M1 tem canal; M2 so tem o clique do anuncio (sem canal).
    expect(funil.atual.porCanal).toHaveLength(2);
    expect(funil.atual.porCanal).toEqual(
      expect.arrayContaining([
        { canal: "trafego_pago", leads: 1, agendaram: 1, compareceram: 1 },
        { canal: null, leads: 1, agendaram: 0, compareceram: 0 },
      ]),
    );
    expect(
      funil.atual.porCampanha.reduce((soma, linha) => soma + linha.leads, 0),
    ).toBe(2);
    // A consulta do contato da Meta entra; a do contato do Google, nao.
    expect(funil.atual.agendamentosCriados).toBe(1);
    expect(funil.atual.comparecimentos).toBe(1);
    expect(funil.atual.faltas).toBe(0);
    // por_grupo continua sem o filtro: e o numero ao lado de cada opcao.
    expect(funil.atual.porGrupo).toEqual({
      meta: 2,
      google: 1,
      outras: 1,
      nao_rastreada: 1,
    });
    // O periodo anterior tambem e filtrado.
    expect(funil.anterior?.leads).toBe(1);
  });

  it("p_grupo = google: a consulta do contato da Meta não entra", async () => {
    const funil = await fetchFunilDoPeriodo(
      admin,
      clinicId,
      TZ,
      DIA_DE,
      DIA_ATE,
      { grupo: "google" },
    );
    expect(funil.atual.leads).toBe(1);
    expect(funil.atual.coorte).toEqual({
      leads: 1,
      agendaram: 1,
      compareceram: 0,
    });
    expect(funil.atual.porCanal).toEqual([
      { canal: "trafego_pago", leads: 1, agendaram: 1, compareceram: 0 },
    ]);
    expect(funil.atual.agendamentosCriados).toBe(1);
    expect(funil.atual.comparecimentos).toBe(0);
    expect(funil.atual.faltas).toBe(1);
    expect(funil.anterior?.leads).toBe(0);
  });

  it("outras e não rastreada: um lead cada, pelo canal", async () => {
    const outras = await fetchFunilDoPeriodo(
      admin,
      clinicId,
      TZ,
      DIA_DE,
      DIA_ATE,
      { grupo: "outras" },
    );
    expect(outras.atual.porCanal).toEqual([
      { canal: "redes_sociais", leads: 1, agendaram: 0, compareceram: 0 },
    ]);
    expect(outras.atual.agendamentosCriados).toBe(0);

    const semRastro = await fetchFunilDoPeriodo(
      admin,
      clinicId,
      TZ,
      DIA_DE,
      DIA_ATE,
      { grupo: "nao_rastreada" },
    );
    expect(semRastro.atual.porCanal).toEqual([
      { canal: null, leads: 1, agendaram: 0, compareceram: 0 },
    ]);
  });

  it("cada lead cai em um grupo só: os quatro filtros somam o total", async () => {
    let soma = 0;
    for (const grupo of GRUPOS) {
      soma += (await funilBruto(grupo)).atual.leads;
    }
    expect(soma).toBe((await funilBruto()).atual.leads);
  });

  it("valor desconhecido em p_grupo não devolve lead nenhum", async () => {
    for (const grupo of ["tiktok", "", "META", "meta "]) {
      const bruto = await funilBruto(grupo);
      expect(bruto.atual.leads).toBe(0);
      expect(bruto.atual.coorte).toEqual({
        leads: 0,
        agendaram: 0,
        compareceram: 0,
      });
      expect(bruto.atual.por_canal).toEqual([]);
      expect(bruto.atual.por_campanha).toEqual([]);
      expect(bruto.atual.agendamentos_criados).toBe(0);
      expect(bruto.atual.comparecimentos).toBe(0);
      expect(bruto.atual.faltas).toBe(0);
      expect(bruto.anterior?.leads).toBe(0);
    }
  });
});

describe("serie_diaria_do_periodo: por_grupo por dia, no fuso da clínica", () => {
  const grupos = (
    parcial: Partial<Record<(typeof GRUPOS)[number], number>>,
  ) => ({
    meta: 0,
    google: 0,
    outras: 0,
    nao_rastreada: 0,
    ...parcial,
  });

  it("sem filtro: os leads do dia em cada grupo, sempre com as quatro chaves", async () => {
    // M2 chegou as 23:30 locais do dia 10 (02:30 UTC do dia 11): conta no
    // dia 10, com M1.
    expect(await serieBruta()).toEqual([
      {
        dia: "2026-10-10",
        leads: 2,
        agendadas: 0,
        por_grupo: grupos({ meta: 2 }),
      },
      {
        dia: "2026-10-11",
        leads: 1,
        agendadas: 1,
        por_grupo: grupos({ google: 1 }),
      },
      {
        dia: "2026-10-12",
        leads: 1,
        agendadas: 1,
        por_grupo: grupos({ outras: 1 }),
      },
      {
        dia: "2026-10-13",
        leads: 1,
        agendadas: 0,
        por_grupo: grupos({ nao_rastreada: 1 }),
      },
    ]);
  });

  it("p_grupo = meta: leads e agendadas só da Meta; por_grupo continua sem o filtro", async () => {
    const serie = await fetchSerieDiariaDoPeriodo(
      admin,
      clinicId,
      TZ,
      DIA_DE,
      DIA_ATE,
      { grupo: "meta" },
    );
    expect(serie).toEqual([
      {
        dia: "2026-10-10",
        leads: 2,
        agendadas: 0,
        porGrupo: grupos({ meta: 2 }),
      },
      {
        dia: "2026-10-11",
        leads: 0,
        agendadas: 0,
        porGrupo: grupos({ google: 1 }),
      },
      // A consulta de M1 foi criada no dia 12.
      {
        dia: "2026-10-12",
        leads: 0,
        agendadas: 1,
        porGrupo: grupos({ outras: 1 }),
      },
      {
        dia: "2026-10-13",
        leads: 0,
        agendadas: 0,
        porGrupo: grupos({ nao_rastreada: 1 }),
      },
    ]);
  });

  it("a soma da série bate com o funil, com e sem filtro", async () => {
    const semFiltro = (await funilBruto()).atual;
    for (const grupo of [undefined, ...GRUPOS]) {
      const serie = await serieBruta(grupo);
      const funil = (await funilBruto(grupo)).atual;
      expect(serie.reduce((soma, ponto) => soma + ponto.leads, 0)).toBe(
        funil.leads,
      );
      expect(serie.reduce((soma, ponto) => soma + ponto.agendadas, 0)).toBe(
        funil.agendamentos_criados,
      );
      // por_grupo de cada dia soma os leads do dia SEM o filtro.
      for (const g of GRUPOS) {
        expect(
          serie.reduce((soma, ponto) => soma + (ponto.por_grupo[g] ?? 0), 0),
        ).toBe(semFiltro.por_grupo[g] ?? 0);
      }
    }
  });

  it("valor desconhecido em p_grupo: nenhum lead e nenhuma consulta em dia nenhum", async () => {
    const serie = await serieBruta("tiktok");
    expect(serie).toHaveLength(4);
    expect(serie.every((p) => p.leads === 0 && p.agendadas === 0)).toBe(true);
    // O grafico por origem nao depende do filtro.
    expect(serie[0]?.por_grupo).toEqual(grupos({ meta: 2 }));
  });
});

describe("grupo_de_origem: a regra, caso a caso", () => {
  async function grupoDe(args: {
    canal?: string | null;
    origem?: string | null;
    ctwa?: string | null;
    anuncio?: string | null;
    campanhaMeta?: string | null;
    campanhaGoogle?: string | null;
  }): Promise<unknown> {
    const { data, error } = await admin.rpc("grupo_de_origem", {
      p_canal: args.canal ?? null,
      p_origem: args.origem ?? null,
      p_ctwa_clid: args.ctwa ?? null,
      p_anuncio: args.anuncio ?? null,
      p_campanha_meta: args.campanhaMeta ?? null,
      p_campanha_google: args.campanhaGoogle ?? null,
    });
    expect(error).toBeNull();
    return data;
  }

  it("Meta: a origem Meta, o clique, o anúncio ou a campanha da Meta", async () => {
    expect(await grupoDe({ canal: "trafego_pago", origem: "Meta" })).toBe(
      "meta",
    );
    expect(await grupoDe({ ctwa: "clid" })).toBe("meta");
    expect(await grupoDe({ anuncio: "120000000000000001" })).toBe("meta");
    expect(await grupoDe({ campanhaMeta: "120000000000000002" })).toBe("meta");
  });

  it("Google: a origem Google ou a campanha do Google", async () => {
    expect(await grupoDe({ canal: "trafego_pago", origem: "Google" })).toBe(
      "google",
    );
    expect(await grupoDe({ campanhaGoogle: "123" })).toBe("google");
  });

  it("com canal e sem anúncio: outras; sem canal: não rastreada", async () => {
    expect(await grupoDe({ canal: "redes_sociais" })).toBe("outras");
    // A origem em minusculas (UTM) nao e a origem de anuncio.
    expect(await grupoDe({ canal: "busca_organica", origem: "google" })).toBe(
      "outras",
    );
    expect(await grupoDe({ canal: "trafego_pago" })).toBe("outras");
    expect(await grupoDe({})).toBe("nao_rastreada");
  });
});
