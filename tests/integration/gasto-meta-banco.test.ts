import { createHash } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Fase 4, investimento da Meta (migration 20261003100000) contra o banco
// REAL: fila (tipo novo e um job vivo por clinica), enfileirar (dedupe,
// 10 minutos do pedido manual, pausa, clinica de teste), o diario (06:00 no
// fuso da clinica, 3 por passagem), a regravacao (so a janela, conta antiga
// apagada, posse e sha256 do token), o registro de falha e o gatilho da
// troca de conta. Mesmos cenarios do ensaio da migration
// (scratchpad/fase4/banco/asserts.sql). Quem le o que esta em
// tests/rls/investimento-meta.test.ts.
//
// CUIDADO, o banco de desenvolvimento e a producao. Todas as clinicas daqui
// sao de teste (e_de_teste = true) do comeco ao fim, nunca viram "reais":
// - enfileirar e o diario sao chamados com p_incluir_teste = true (so os
//   testes passam esse parametro, no molde de planejar_automacoes_de_fluxo).
//   O claim do motor de producao e o motor_manutencao chamam sem ele e nunca
//   enxergam clinica de teste: nenhum job daqui e reivindicado (a Graph API
//   nunca e chamada com o token falso) e nenhuma linha de leitura daqui e
//   remarcada pelo diario de producao no meio do teste;
// - o diario recebe p_clinic_ids com as clinicas daqui: nenhuma clinica real
//   e tocada com o p_agora de mentira, e as clinicas de teste das outras
//   suites ficam de fora (clinica de teste so entra se estiver na lista);
// - saude_do_motor conta pendente de QUALQUER clinica com mais de 5 minutos
//   de atraso: comJobsAdiados joga o job para amanha no fim de cada caso,
//   mesmo com erro, e o afterAll apaga as clinicas (o job vai junto).

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicas: string[] = [];
const WORKER = `teste-gasto-${sufixo}`;
const FUSO_DO_DIARIO = "America/Noronha";

const sha256 = (texto: string) =>
  createHash("sha256").update(texto, "utf8").digest("hex");

type Enfileirado = { codigo: string; liberado_em?: string };

async function novaClinica(
  nome: string,
  timezone = "America/Fortaleza",
): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `GastoMeta ${nome} ${sufixo}`,
      slug: `gasto-meta-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
      timezone,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicas.push(data!.id as string);
  return data!.id as string;
}

let contaSeq = 0;
/** Conta de anuncios e token de leitura gravados pelo sistema. */
async function configurar(
  clinicId: string,
  token = `EAAtokenDeLeitura${sufixo}${clinicId.slice(0, 8)}`,
): Promise<{ conta: string; token: string }> {
  contaSeq += 1;
  const conta = `act_${String(9_100_000 + contaSeq)}`;
  await admin
    .from("meta_ads_account")
    .insert({ clinic_id: clinicId, ad_account_id: conta })
    .throwOnError();
  await admin
    .from("meta_ads_account_secret")
    .insert({ clinic_id: clinicId, insights_access_token: token })
    .throwOnError();
  return { conta, token };
}

async function leitura(clinicId: string) {
  const { data } = await admin
    .from("meta_gasto_leitura")
    .select("*")
    .eq("clinic_id", clinicId)
    .maybeSingle()
    .throwOnError();
  return data;
}

async function jobsVivos(clinicId: string) {
  const { data } = await admin
    .from("job_queue")
    .select("id, status, max_attempts, payload, run_at")
    .eq("clinic_id", clinicId)
    .eq("kind", "sincronizar_gasto_meta")
    .in("status", ["pendente", "executando"])
    .throwOnError();
  return data ?? [];
}

/**
 * Joga o job pendente para amanha: saude_do_motor nao o conta como atrasado
 * (o motor de producao ja nao o reivindica, a clinica e de teste).
 */
async function adiarJobs(clinicId: string): Promise<void> {
  await admin
    .from("job_queue")
    .update({ run_at: new Date(Date.now() + 86_400_000).toISOString() })
    .eq("clinic_id", clinicId)
    .eq("kind", "sincronizar_gasto_meta")
    .eq("status", "pendente")
    .throwOnError();
}

/**
 * Roda fn e, no fim (mesmo com erro), adia os jobs das clinicas para amanha:
 * saude_do_motor acusaria fila_atrasada com job de teste pendente ha mais de
 * 5 minutos.
 */
async function comJobsAdiados<T>(
  ids: string[],
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } finally {
    for (const id of ids) {
      await adiarJobs(id);
    }
  }
}

/**
 * incluirTeste = true por padrao (a clinica daqui e de teste); false e como a
 * Server Action e o motor chamam.
 */
async function enfileirar(
  clinicId: string,
  origem: "manual" | "diario" | "configuracao",
  agora?: string,
  incluirTeste = true,
): Promise<Enfileirado> {
  const { data, error } = await admin.rpc(
    "enfileirar_sincronizacao_de_gasto_meta",
    {
      p_clinic_id: clinicId,
      p_origem: origem,
      ...(agora ? { p_agora: agora } : {}),
      ...(incluirTeste ? { p_incluir_teste: true } : {}),
    },
  );
  expect(error).toBeNull();
  return data as Enfileirado;
}

/** Job "executando" com o worker do teste (como o claim deixaria). */
async function jobEmExecucao(clinicId: string): Promise<string> {
  const { data } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicId,
      kind: "sincronizar_gasto_meta",
      payload: { origem: "configuracao" },
      max_attempts: 5,
      status: "executando",
      locked_by: WORKER,
      locked_at: new Date().toISOString(),
      attempts: 1,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

type Regravacao = {
  jobId: string;
  worker?: string;
  clinicId: string;
  conta: string;
  token: string;
  desde: string;
  ate: string;
  porAnuncio?: unknown[];
  daConta?: unknown[];
  nome?: string;
};

async function regravar(r: Regravacao): Promise<string> {
  const { data, error } = await admin.rpc("regravar_gasto_meta", {
    p_job_id: r.jobId,
    p_worker: r.worker ?? WORKER,
    p_clinic_id: r.clinicId,
    p_ad_account_id: r.conta,
    p_token_sha256: sha256(r.token),
    p_desde: r.desde,
    p_ate: r.ate,
    p_moeda: "BRL",
    p_fuso: "America/Sao_Paulo",
    p_nome_da_conta: r.nome ?? "Conta da clínica",
    p_conta_ativa: true,
    p_por_anuncio: r.porAnuncio ?? [],
    p_da_conta: r.daConta ?? [],
  });
  expect(error).toBeNull();
  return data as string;
}

afterAll(async () => {
  for (const clinicId of clinicas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("fila: tipo novo e um job vivo por clínica", () => {
  it("o check aceita sincronizar_gasto_meta e o índice recusa o segundo job vivo (23505)", async () => {
    const a = await novaClinica("FilaA");
    const b = await novaClinica("FilaB");
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    await admin
      .from("job_queue")
      .insert({ clinic_id: a, kind: "sincronizar_gasto_meta", run_at: amanha })
      .throwOnError();
    const { error } = await admin
      .from("job_queue")
      .insert({ clinic_id: a, kind: "sincronizar_gasto_meta", run_at: amanha });
    expect(error?.code).toBe("23505");
    // Outra clinica entra; job concluido nao conta como vivo.
    await admin
      .from("job_queue")
      .insert({ clinic_id: b, kind: "sincronizar_gasto_meta", run_at: amanha })
      .throwOnError();
    await admin
      .from("job_queue")
      .update({ status: "concluido" })
      .eq("clinic_id", a)
      .throwOnError();
    await admin
      .from("job_queue")
      .insert({ clinic_id: a, kind: "sincronizar_gasto_meta", run_at: amanha })
      .throwOnError();
    const { error: erroKind } = await admin
      .from("job_queue")
      .insert({ clinic_id: a, kind: "sincronizar_qualquer_coisa" });
    expect(erroKind?.code).toBe("23514");
  });
});

describe("enfileirar_sincronizacao_de_gasto_meta", () => {
  it("clínica de teste nunca ganha job; sem conta ou sem token é sem_configuracao", async () => {
    const teste = await novaClinica("Teste");
    await configurar(teste);
    // Sem p_incluir_teste, como a Server Action e o motor chamam.
    for (const origem of ["manual", "configuracao", "diario"] as const) {
      expect((await enfileirar(teste, origem, undefined, false)).codigo).toBe(
        "clinica_de_teste",
      );
    }
    expect(await jobsVivos(teste)).toEqual([]);
    expect(await leitura(teste)).toBeNull();

    const semToken = await novaClinica("SemToken");
    await admin
      .from("meta_ads_account")
      .insert({ clinic_id: semToken, ad_account_id: "act_9199999" })
      .throwOnError();
    const resultado = await enfileirar(semToken, "manual");
    expect(resultado.codigo).toBe("sem_configuracao");
    expect(await jobsVivos(semToken)).toEqual([]);
  });

  it("cria um job (max_attempts 5), deduplica e segura o pedido manual por 10 minutos", async () => {
    const c = await novaClinica("Fila");
    await configurar(c);
    const t0 = "2026-10-05T12:00:00.000Z";
    const mais = (min: number) =>
      new Date(new Date(t0).getTime() + min * 60_000).toISOString();
    const [primeiro, segundo, cedo, liberado] = await comJobsAdiados(
      [c],
      async () => [
        await enfileirar(c, "manual", t0),
        await enfileirar(c, "configuracao", t0),
        await enfileirar(c, "manual", mais(5)),
        await enfileirar(c, "manual", mais(10)),
      ],
    );
    expect(primeiro).toEqual({ codigo: "enfileirado" });
    expect(segundo).toEqual({ codigo: "ja_na_fila" });
    expect(cedo!.codigo).toBe("aguarde");
    expect(new Date(cedo!.liberado_em!).toISOString()).toBe(mais(10));
    expect(liberado).toEqual({ codigo: "ja_na_fila" });

    const jobs = await jobsVivos(c);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.max_attempts).toBe(5);
    expect(jobs[0]!.payload).toEqual({ origem: "manual" });
    const situacao = await leitura(c);
    expect(
      new Date(situacao!.atualizacao_pedida_em as string).toISOString(),
    ).toBe(mais(10));
  });

  it("token recusado pausa manual e diário; a origem configuracao passa", async () => {
    const c = await novaClinica("Pausa");
    await configurar(c);
    await admin
      .from("meta_gasto_leitura")
      .insert({
        clinic_id: c,
        situacao: "com_problema",
        problema: "token_invalido",
        codigo_da_meta: 190,
      })
      .throwOnError();
    const [manual, diario, configuracao] = await comJobsAdiados(
      [c],
      async () => [
        await enfileirar(c, "manual"),
        await enfileirar(c, "diario"),
        await enfileirar(c, "configuracao"),
      ],
    );
    expect(manual!.codigo).toBe("pausada");
    expect(diario!.codigo).toBe("pausada");
    expect(configuracao!.codigo).toBe("enfileirado");
  });

  it("origem fora da lista é erro 22023", async () => {
    const c = await novaClinica("Origem");
    const { error } = await admin.rpc(
      "enfileirar_sincronizacao_de_gasto_meta",
      {
        p_clinic_id: c,
        p_origem: "qualquer",
      },
    );
    expect(error?.code).toBe("22023");
  });
});

describe("enfileirar_gasto_meta_do_dia (o diário)", () => {
  // 07:59 e 08:00 UTC: 05:59 e 06:00 em Noronha, o fuso das clinicas daqui.
  // A lista p_clinic_ids deixa toda clinica real fora da varredura.
  const ANTES = "2031-03-10T07:59:00.000Z";
  const AS_SEIS = "2031-03-10T08:00:00.000Z";

  it("respeita 06:00 no fuso da clínica, para em 3 por passagem, pula pausada e não testada e só vê clínica de teste listada", async () => {
    const elegiveis: string[] = [];
    for (let i = 1; i <= 5; i++) {
      elegiveis.push(await novaClinica(`Diario${i}`, FUSO_DO_DIARIO));
    }
    const pausada = await novaClinica("DiarioPausada", FUSO_DO_DIARIO);
    const naoTestada = await novaClinica("DiarioNaoTestada", FUSO_DO_DIARIO);
    // Elegivel em tudo, mas fora da lista: prova que a lista restringe.
    const foraDaLista = await novaClinica("DiarioForaDaLista", FUSO_DO_DIARIO);
    for (const id of [...elegiveis, pausada, naoTestada, foraDaLista]) {
      await configurar(id);
    }
    await admin
      .from("meta_gasto_leitura")
      .insert([
        ...elegiveis.map((id) => ({ clinic_id: id, situacao: "funcionando" })),
        { clinic_id: foraDaLista, situacao: "funcionando" },
        {
          clinic_id: pausada,
          situacao: "com_problema",
          problema: "sem_permissao",
        },
        { clinic_id: naoTestada, situacao: "nao_testada" },
      ])
      .throwOnError();

    const diario = async (
      agora: string,
      limite: number,
      ids: string[],
      incluirTeste: boolean,
    ) => {
      const { data, error } = await admin.rpc("enfileirar_gasto_meta_do_dia", {
        p_agora: agora,
        p_limite: limite,
        p_clinic_ids: ids,
        p_incluir_teste: incluirTeste,
      });
      expect(error).toBeNull();
      return data as number;
    };

    const lista = [...elegiveis, pausada, naoTestada];
    const atendidas = await comJobsAdiados(
      [...lista, foraDaLista],
      async () => [
        // Sem p_incluir_teste (como o motor_manutencao): clinica de teste
        // fica de fora mesmo listada.
        await diario(AS_SEIS, 10, [...lista, foraDaLista], false),
        await diario(ANTES, 3, lista, true),
        await diario(AS_SEIS, 3, lista, true),
        await diario(AS_SEIS, 3, lista, true),
        await diario(AS_SEIS, 3, lista, true),
      ],
    );
    expect(atendidas).toEqual([0, 0, 3, 2, 0]);

    for (const id of elegiveis) {
      const jobs = await jobsVivos(id);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.payload).toEqual({ origem: "diario" });
      expect((await leitura(id))!.ultimo_diario_dia).toBe("2031-03-10");
    }
    for (const id of [pausada, naoTestada, foraDaLista]) {
      expect(await jobsVivos(id)).toEqual([]);
      expect((await leitura(id))!.ultimo_diario_dia).toBeNull();
    }
  });
});

describe("regravar_gasto_meta", () => {
  it("substitui só a janela, apaga a conta antiga, monta o mapa e marca a leitura", async () => {
    const c = await novaClinica("Regravar");
    const { conta, token } = await configurar(c);
    // Dado anterior: conta atual fora e dentro da janela, e uma conta antiga.
    await admin
      .from("meta_gasto_diario")
      .insert([
        {
          clinic_id: c,
          ad_account_id: conta,
          dia: "2026-09-01",
          ad_id: "111",
          campaign_id: "501",
          spend_cents: 300,
          currency: "BRL",
        },
        {
          clinic_id: c,
          ad_account_id: conta,
          dia: "2026-09-20",
          ad_id: "333",
          campaign_id: "503",
          spend_cents: 777,
          currency: "BRL",
        },
        {
          clinic_id: c,
          ad_account_id: "act_9999999",
          dia: "2026-08-01",
          ad_id: "999",
          campaign_id: "599",
          spend_cents: 900,
          currency: "BRL",
        },
      ])
      .throwOnError();
    await admin
      .from("meta_anuncio")
      .insert([
        {
          clinic_id: c,
          ad_id: "444",
          ad_account_id: conta,
          campaign_id: "504",
          campaign_name: "Julho",
          ultimo_dia_com_entrega: "2026-07-01",
        },
        {
          clinic_id: c,
          ad_id: "999",
          ad_account_id: "act_9999999",
          campaign_id: "599",
          ultimo_dia_com_entrega: "2026-08-01",
        },
      ])
      .throwOnError();
    const jobId = await jobEmExecucao(c);
    const base = {
      jobId,
      clinicId: c,
      conta,
      token,
      desde: "2026-09-15",
      ate: "2026-10-04",
    };
    const porAnuncio = [
      {
        dia: "2026-09-20",
        ad_id: "111",
        adset_id: "601",
        campaign_id: "501",
        campaign_name: "Nome velho",
        spend_cents: 1000,
      },
      {
        dia: "2026-10-04",
        ad_id: "111",
        adset_id: "601",
        campaign_id: "501",
        campaign_name: "Nome novo",
        spend_cents: 2000,
      },
      {
        dia: "2026-10-01",
        ad_id: "222",
        adset_id: null,
        campaign_id: "502",
        campaign_name: null,
        spend_cents: 500,
      },
    ];
    const daConta = [
      { dia: "2026-09-20", spend_cents: 1200 },
      { dia: "2026-10-01", spend_cents: 600 },
      { dia: "2026-10-04", spend_cents: 2500 },
    ];

    expect(
      await regravar({ ...base, worker: "outro-worker", porAnuncio, daConta }),
    ).toBe("sem_posse");
    expect(
      await regravar({
        ...base,
        token: "outro-token-outro-token",
        porAnuncio,
        daConta,
      }),
    ).toBe("config_mudou");
    expect(
      await regravar({ ...base, conta: "act_7777777", porAnuncio, daConta }),
    ).toBe("config_mudou");
    expect(
      await regravar({ ...base, desde: "2026-07-01", ate: "2026-10-01" }),
    ).toBe("janela_invalida");
    expect(
      await regravar({ ...base, desde: "2026-10-04", ate: "2026-09-15" }),
    ).toBe("janela_invalida");
    // Nada mudou com as recusas.
    const { data: intacto } = await admin
      .from("meta_gasto_diario")
      .select("ad_id")
      .eq("clinic_id", c);
    expect(intacto).toHaveLength(3);

    expect(await regravar({ ...base, porAnuncio, daConta })).toBe("ok");
    const { data: gasto } = await admin
      .from("meta_gasto_diario")
      .select("dia, ad_id, ad_account_id, spend_cents, currency")
      .eq("clinic_id", c)
      .order("dia");
    expect(gasto).toEqual([
      {
        dia: "2026-09-01",
        ad_id: "111",
        ad_account_id: conta,
        spend_cents: 300,
        currency: "BRL",
      },
      {
        dia: "2026-09-20",
        ad_id: "111",
        ad_account_id: conta,
        spend_cents: 1000,
        currency: "BRL",
      },
      {
        dia: "2026-10-01",
        ad_id: "222",
        ad_account_id: conta,
        spend_cents: 500,
        currency: "BRL",
      },
      {
        dia: "2026-10-04",
        ad_id: "111",
        ad_account_id: conta,
        spend_cents: 2000,
        currency: "BRL",
      },
    ]);
    const { data: total } = await admin
      .from("meta_gasto_conta_diario")
      .select("spend_cents")
      .eq("clinic_id", c);
    expect(
      (total ?? []).reduce((s, l) => s + (l.spend_cents as number), 0),
    ).toBe(4300);
    const { data: mapa } = await admin
      .from("meta_anuncio")
      .select("ad_id, campaign_id, campaign_name, ultimo_dia_com_entrega")
      .eq("clinic_id", c)
      .order("ad_id");
    expect(mapa).toEqual([
      {
        ad_id: "111",
        campaign_id: "501",
        campaign_name: "Nome novo",
        ultimo_dia_com_entrega: "2026-10-04",
      },
      {
        ad_id: "222",
        campaign_id: "502",
        campaign_name: null,
        ultimo_dia_com_entrega: "2026-10-01",
      },
      {
        ad_id: "444",
        campaign_id: "504",
        campaign_name: "Julho",
        ultimo_dia_com_entrega: "2026-07-01",
      },
    ]);
    expect(await leitura(c)).toMatchObject({
      ad_account_id: conta,
      situacao: "funcionando",
      problema: null,
      lido_desde: "2026-09-15",
      lido_ate: "2026-10-04",
      moeda: "BRL",
      fuso_da_conta: "America/Sao_Paulo",
    });

    // Janela que encosta: a cobertura fica com o menor inicio e o maior fim.
    expect(
      await regravar({
        ...base,
        desde: "2026-09-25",
        ate: "2026-10-05",
        porAnuncio: [
          {
            dia: "2026-10-05",
            ad_id: "111",
            adset_id: null,
            campaign_id: "501",
            campaign_name: "Nome mais novo",
            spend_cents: 50,
          },
        ],
        daConta: [{ dia: "2026-10-05", spend_cents: 70 }],
      }),
    ).toBe("ok");
    expect(await leitura(c)).toMatchObject({
      lido_desde: "2026-09-15",
      lido_ate: "2026-10-05",
    });
    const { data: depois } = await admin
      .from("meta_gasto_diario")
      .select("dia")
      .eq("clinic_id", c)
      .order("dia");
    expect(depois!.map((l) => l.dia)).toEqual([
      "2026-09-01",
      "2026-09-20",
      "2026-10-05",
    ]);
  });

  it("o token trocado no meio da leitura dá config_mudou; o novo passa", async () => {
    const c = await novaClinica("TokenTrocado");
    const { conta, token } = await configurar(c);
    const jobId = await jobEmExecucao(c);
    const novo = `EAAtokenNovo${sufixo}0123456789`;
    await admin
      .from("meta_ads_account_secret")
      .update({ insights_access_token: novo })
      .eq("clinic_id", c)
      .throwOnError();
    const base = {
      jobId,
      clinicId: c,
      conta,
      desde: "2026-10-01",
      ate: "2026-10-02",
    };
    expect(await regravar({ ...base, token })).toBe("config_mudou");
    expect(await regravar({ ...base, token: novo })).toBe("ok");
  });
});

describe("registrar_falha_do_gasto_meta", () => {
  it("grava o problema sem mexer na cobertura, pausa o pedido manual e confere posse e token", async () => {
    const c = await novaClinica("Falha");
    const { conta, token } = await configurar(c);
    const jobId = await jobEmExecucao(c);
    expect(
      await regravar({
        jobId,
        clinicId: c,
        conta,
        token,
        desde: "2026-09-01",
        ate: "2026-09-30",
      }),
    ).toBe("ok");

    const falhar = async (worker: string, tokenUsado: string) => {
      const { data, error } = await admin.rpc("registrar_falha_do_gasto_meta", {
        p_job_id: jobId,
        p_worker: worker,
        p_clinic_id: c,
        p_ad_account_id: conta,
        p_token_sha256: sha256(tokenUsado),
        p_problema: "token_invalido",
        p_codigo: 190,
      });
      expect(error).toBeNull();
      return data as string;
    };
    expect(await falhar("outro-worker", token)).toBe("sem_posse");
    expect(await falhar(WORKER, "outro-token-outro-token")).toBe(
      "config_mudou",
    );
    expect(await falhar(WORKER, token)).toBe("ok");
    expect(await leitura(c)).toMatchObject({
      situacao: "com_problema",
      problema: "token_invalido",
      codigo_da_meta: 190,
      lido_desde: "2026-09-01",
      lido_ate: "2026-09-30",
    });

    await admin
      .from("job_queue")
      .update({ status: "concluido" })
      .eq("id", jobId)
      .throwOnError();
    const pedido = await enfileirar(c, "manual");
    expect(pedido.codigo).toBe("pausada");

    const { error } = await admin.rpc("registrar_falha_do_gasto_meta", {
      p_job_id: jobId,
      p_worker: WORKER,
      p_clinic_id: c,
      p_ad_account_id: conta,
      p_token_sha256: sha256(token),
      p_problema: "qualquer",
    });
    expect(error?.code).toBe("22023");
  });
});

describe("troca da conta de anúncios", () => {
  it("volta a leitura para nao_testada e a regravação da conta nova apaga a antiga", async () => {
    const c = await novaClinica("Troca");
    const { conta, token } = await configurar(c);
    const jobId = await jobEmExecucao(c);
    expect(
      await regravar({
        jobId,
        clinicId: c,
        conta,
        token,
        desde: "2026-09-01",
        ate: "2026-09-30",
        porAnuncio: [
          {
            dia: "2026-09-10",
            ad_id: "1",
            campaign_id: "10",
            spend_cents: 100,
          },
        ],
        daConta: [{ dia: "2026-09-10", spend_cents: 100 }],
      }),
    ).toBe("ok");

    await admin
      .from("meta_ads_account")
      .update({ ad_account_id: "act_9188888" })
      .eq("clinic_id", c)
      .throwOnError();
    expect(await leitura(c)).toMatchObject({
      situacao: "nao_testada",
      problema: null,
      lido_desde: "2026-09-01",
    });
    // O job que leu a conta velha nao grava.
    expect(
      await regravar({
        jobId,
        clinicId: c,
        conta,
        token,
        desde: "2026-09-01",
        ate: "2026-09-30",
      }),
    ).toBe("config_mudou");
    expect(
      await regravar({
        jobId,
        clinicId: c,
        conta: "act_9188888",
        token,
        desde: "2026-10-01",
        ate: "2026-10-02",
        porAnuncio: [
          { dia: "2026-10-01", ad_id: "2", campaign_id: "20", spend_cents: 50 },
        ],
        daConta: [{ dia: "2026-10-01", spend_cents: 50 }],
      }),
    ).toBe("ok");
    const { data: contas } = await admin
      .from("meta_gasto_diario")
      .select("ad_account_id")
      .eq("clinic_id", c);
    expect(contas).toEqual([{ ad_account_id: "act_9188888" }]);
    expect(await leitura(c)).toMatchObject({
      ad_account_id: "act_9188888",
      situacao: "funcionando",
      lido_desde: "2026-10-01",
      lido_ate: "2026-10-02",
    });
  });
});

describe("motor_manutencao", () => {
  it("devolve gasto_meta e não acusa erro no bloco novo", async () => {
    const { data, error } = await admin.rpc("motor_manutencao");
    expect(error).toBeNull();
    const resultado = data as { gasto_meta: number; erros: string[] };
    expect(typeof resultado.gasto_meta).toBe("number");
    expect(
      resultado.erros.filter((codigo) => codigo.startsWith("gasto_meta")),
    ).toEqual([]);
  });
});
