import { createHash } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Origem real do lead de anuncio, banco (migration 20261004100000) contra o
// banco REAL, com o cliente de servico:
// - contact: anuncio_ctwa so com canal trafego_pago, origem Meta, meio
//   Facebook/Instagram/nulo e source_campaign nulo (23514); o caminho da
//   ingestao (um update so) e a origem imutavel depois;
// - fila: resolver_anuncio_meta, um job vivo por clinica;
// - enfileirar_resolucao_de_anuncios_meta: enfileirado, ja_na_fila,
//   sem_configuracao, pausada, nada_a_resolver, clinica_de_teste, 22023;
// - anuncios_meta_a_resolver: pendente = source_ad_id numerico sem linha no
//   mapa (ou linha nunca consultada) e sem recusa valida (mesma conta e
//   mesmo token); ordem, limite, nova tentativa;
// - gravar_resolucao_de_anuncios_meta: sem_posse, config_mudou, 22023, so a
//   conta salva entra no mapa, outra_conta e resposta_invalida viram recusa,
//   novas tentativas (1 h, 6 h, 24 h ate 7 dias), troca de token;
// - registrar_falha_do_gasto_meta aceita o job do resolvedor;
// - regravar_gasto_meta sobre a linha criada pela consulta (dia nulo).
// Mesmos cenarios do ensaio (scratchpad/origem/banco/asserts.sql). A
// correcao dos contatos de anuncio ja existentes e um bloco da migration
// (roda uma vez, sem sessao, so contato com ctwa_clid; id de anuncio sem
// clique pode ser post e fica sem origem): coberta so pelo ensaio (blocos O
// e X). Quem le
// o que esta em tests/rls/investimento-meta.test.ts.
//
// CUIDADO, o banco de desenvolvimento e a producao. Todas as clinicas daqui
// sao de teste (e_de_teste = true) do comeco ao fim:
// - enfileirar e chamado com p_incluir_teste = true (so os testes passam
//   esse parametro); o claim do motor de producao (claim_jobs_por_clinica)
//   nunca reivindica job de clinica de teste: a Graph API nunca e chamada
//   com o token falso;
// - saude_do_motor conta pendente de QUALQUER clinica com mais de 5 minutos
//   de atraso: comJobsAdiados joga o job para amanha no fim de cada caso,
//   mesmo com erro, e o afterAll apaga as clinicas (os jobs vao junto).

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicas: string[] = [];
const WORKER = `teste-resolver-${sufixo}`;
const UMA_HORA = 3_600_000;

const sha256 = (texto: string) =>
  createHash("sha256").update(texto, "utf8").digest("hex");

type Enfileirado = { codigo: string; run_at?: string };
type Lista =
  | { codigo: "config_mudou" }
  | {
      codigo: "ok";
      ad_ids: string[];
      restantes: number;
      proxima_tentativa_em: string | null;
    };
type Recusa = {
  ad_id: string;
  motivo: string;
  codigo_da_meta: number | null;
  ad_account_id: string;
  token_sha256: string;
  tentativas: number;
  primeira_recusa_em: string;
  recusado_em: string;
  tentar_de_novo_em: string | null;
};

const ms = (iso: string | null | undefined) =>
  iso ? new Date(iso).getTime() : null;

async function novaClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `ResolverAnuncio ${nome} ${sufixo}`,
      slug: `resolver-anuncio-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
      timezone: "America/Fortaleza",
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
): Promise<{ conta: string; token: string }> {
  contaSeq += 1;
  const conta = `act_${String(9_300_000 + contaSeq)}`;
  const token = `EAAtokenDoResolvedor${sufixo}${contaSeq}`;
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

let telefone = 0;
/** Contato gravado pelo sistema (como a ingestao grava os ids do anuncio). */
async function contato(
  clinicId: string,
  extras: Record<string, unknown> = {},
): Promise<{ id: string; error: { code?: string } | null }> {
  telefone += 1;
  const { data, error } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+55849796${String(telefone).padStart(5, "0")}`,
      name: `Contato ${telefone}`,
      ...extras,
    })
    .select("id")
    .maybeSingle();
  return { id: (data?.id as string | undefined) ?? "", error };
}

async function contatoDeAnuncio(
  clinicId: string,
  adId: string,
  chegada = new Date().toISOString(),
): Promise<string> {
  const { id, error } = await contato(clinicId, {
    source_ad_id: adId,
    first_contact_at: chegada,
  });
  expect(error).toBeNull();
  return id;
}

async function enfileirar(
  clinicId: string,
  origem: string,
  opcoes: { runAt?: string; incluirTeste?: boolean } = {},
): Promise<Enfileirado> {
  const { data, error } = await admin.rpc(
    "enfileirar_resolucao_de_anuncios_meta",
    {
      p_clinic_id: clinicId,
      p_origem: origem,
      ...(opcoes.runAt ? { p_run_at: opcoes.runAt } : {}),
      ...((opcoes.incluirTeste ?? true) ? { p_incluir_teste: true } : {}),
    },
  );
  expect(error).toBeNull();
  return data as Enfileirado;
}

async function lista(
  clinicId: string,
  conta: string,
  sha: string | null,
  extras: { limite?: number; agora?: string } = {},
): Promise<Lista> {
  const { data, error } = await admin.rpc("anuncios_meta_a_resolver", {
    p_clinic_id: clinicId,
    p_ad_account_id: conta,
    p_token_sha256: sha,
    ...(extras.limite !== undefined ? { p_limite: extras.limite } : {}),
    ...(extras.agora ? { p_agora: extras.agora } : {}),
  });
  expect(error).toBeNull();
  return data as Lista;
}

async function jobsVivos(clinicId: string) {
  const { data } = await admin
    .from("job_queue")
    .select("id, status, max_attempts, attempts, payload, run_at")
    .eq("clinic_id", clinicId)
    .eq("kind", "resolver_anuncio_meta")
    .in("status", ["pendente", "executando"])
    .throwOnError();
  return data ?? [];
}

async function cancelarJobs(clinicId: string): Promise<void> {
  await admin
    .from("job_queue")
    .update({ status: "cancelado" })
    .eq("clinic_id", clinicId)
    .eq("kind", "resolver_anuncio_meta")
    .eq("status", "pendente")
    .throwOnError();
}

/** Joga os jobs pendentes para amanha (saude_do_motor nao os acusa). */
async function adiarJobs(clinicId: string): Promise<void> {
  await admin
    .from("job_queue")
    .update({ run_at: new Date(Date.now() + 86_400_000).toISOString() })
    .eq("clinic_id", clinicId)
    .in("kind", ["resolver_anuncio_meta", "sincronizar_gasto_meta"])
    .eq("status", "pendente")
    .throwOnError();
}

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

/** Job "executando" com o worker do teste (como o claim deixaria). */
async function jobEmExecucao(
  clinicId: string,
  kind: "resolver_anuncio_meta" | "sincronizar_gasto_meta",
): Promise<string> {
  const { data } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicId,
      kind,
      payload: {
        origem: kind === "resolver_anuncio_meta" ? "ingestao" : "manual",
      },
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

type Gravacao = {
  jobId: string;
  clinicId: string;
  conta: string;
  sha: string | null;
  resolvidos?: unknown;
  recusas?: unknown;
  worker?: string;
};

async function gravarBruto(g: Gravacao) {
  return admin.rpc("gravar_resolucao_de_anuncios_meta", {
    p_job_id: g.jobId,
    p_worker: g.worker ?? WORKER,
    p_clinic_id: g.clinicId,
    p_ad_account_id: g.conta,
    p_token_sha256: g.sha,
    p_resolvidos: g.resolvidos === undefined ? [] : g.resolvidos,
    p_recusas: g.recusas === undefined ? [] : g.recusas,
  });
}

async function gravar(g: Gravacao): Promise<string> {
  const { data, error } = await gravarBruto(g);
  expect(error).toBeNull();
  return data as string;
}

async function recusa(clinicId: string, adId: string): Promise<Recusa | null> {
  const { data } = await admin
    .from("meta_anuncio_recusado")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("ad_id", adId)
    .maybeSingle()
    .throwOnError();
  return data as Recusa | null;
}

async function anuncio(clinicId: string, adId: string) {
  const { data } = await admin
    .from("meta_anuncio")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("ad_id", adId)
    .maybeSingle()
    .throwOnError();
  return data;
}

afterAll(async () => {
  for (const clinicId of clinicas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("contact: origem de anúncio coerente", () => {
  it("anuncio_ctwa exige canal trafego_pago, origem Meta, meio Facebook, Instagram ou nulo e source_campaign nulo", async () => {
    const c = await novaClinica("Checks");
    const recusados: Record<string, unknown>[] = [
      { source_method: "anuncio_ctwa", source_origin: "Meta" },
      { source_method: "anuncio_ctwa", source_channel: "trafego_pago" },
      { source_method: "anuncio_ctwa" },
      {
        source_method: "anuncio_ctwa",
        source_channel: "redes_sociais",
        source_origin: "Meta",
      },
      {
        source_method: "anuncio_ctwa",
        source_channel: "trafego_pago",
        source_origin: "Google",
      },
      {
        source_method: "anuncio_ctwa",
        source_channel: "trafego_pago",
        source_origin: "meta",
      },
      {
        source_method: "anuncio_ctwa",
        source_channel: "trafego_pago",
        source_origin: "Meta",
        source_medium: "TikTok",
      },
      {
        source_method: "anuncio_ctwa",
        source_channel: "trafego_pago",
        source_origin: "Meta",
        source_medium: "instagram",
      },
      // D3: a campanha nunca vai em source_campaign.
      {
        source_method: "anuncio_ctwa",
        source_channel: "trafego_pago",
        source_origin: "Meta",
        source_medium: "Instagram",
        source_campaign: "Campanha da Meta",
      },
      { source_method: "anuncio_google" },
    ];
    for (const extras of recusados) {
      const { error } = await contato(c, extras);
      expect(error?.code, JSON.stringify(extras)).toBe("23514");
    }
    // Positivos: sem plataforma, Facebook e Instagram.
    for (const meio of [null, "Facebook", "Instagram"]) {
      const { error } = await contato(c, {
        source_method: "anuncio_ctwa",
        source_channel: "trafego_pago",
        source_origin: "Meta",
        source_medium: meio,
        source_captured_at: new Date().toISOString(),
      });
      expect(error).toBeNull();
    }
    // O check so vale para anuncio_ctwa.
    const { error: manual } = await contato(c, {
      source_method: "manual",
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_medium: "cpc",
    });
    expect(manual).toBeNull();
  });

  it("caminho da ingestão: o contato sem origem ganha a origem de anúncio num update só e depois ela não muda", async () => {
    const c = await novaClinica("Ingestao");
    const { id } = await contato(c, {
      ctwa_clid: `clid-${sufixo}`,
      source_ad_id: "7000",
    });
    const { data: gravado, error } = await admin
      .from("contact")
      .update({
        source_channel: "trafego_pago",
        source_origin: "Meta",
        source_medium: "Instagram",
        source_method: "anuncio_ctwa",
        source_captured_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("source_channel", null)
      .select("id");
    expect(error).toBeNull();
    expect(gravado).toHaveLength(1);
    // Um segundo anuncio nao regrava (o filtro nao casa mais).
    const { data: segundo } = await admin
      .from("contact")
      .update({ source_medium: "Facebook" })
      .eq("id", id)
      .is("source_channel", null)
      .select("id")
      .throwOnError();
    expect(segundo).toEqual([]);
    // Trocar a plataforma direto: o gatilho de origem imutavel recusa.
    const { error: troca } = await admin
      .from("contact")
      .update({ source_medium: "Facebook" })
      .eq("id", id);
    expect(troca?.code).toBe("P0001");
    const { data: depois } = await admin
      .from("contact")
      .select(
        "source_channel, source_origin, source_medium, source_method, source_campaign, source_ad_id",
      )
      .eq("id", id)
      .single()
      .throwOnError();
    expect(depois).toEqual({
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_campaign: null,
      source_ad_id: "7000",
    });
    // So o metodo, sem canal: o check recusa.
    const { id: outro } = await contato(c);
    const { error: soMetodo } = await admin
      .from("contact")
      .update({ source_method: "anuncio_ctwa" })
      .eq("id", outro);
    expect(soMetodo?.code).toBe("23514");
  });
});

describe("fila: resolver_anuncio_meta", () => {
  it("o check aceita o tipo e o índice recusa o segundo job vivo (23505); o job do gasto convive", async () => {
    const c = await novaClinica("Fila");
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    const { data: primeiro } = await admin
      .from("job_queue")
      .insert({ clinic_id: c, kind: "resolver_anuncio_meta", run_at: amanha })
      .select("id")
      .single()
      .throwOnError();
    const { error } = await admin
      .from("job_queue")
      .insert({ clinic_id: c, kind: "resolver_anuncio_meta", run_at: amanha });
    expect(error?.code).toBe("23505");
    await admin
      .from("job_queue")
      .insert({ clinic_id: c, kind: "sincronizar_gasto_meta", run_at: amanha })
      .throwOnError();
    // Concluido nao conta como vivo.
    await admin
      .from("job_queue")
      .update({ status: "concluido" })
      .eq("id", primeiro!.id)
      .throwOnError();
    await admin
      .from("job_queue")
      .insert({ clinic_id: c, kind: "resolver_anuncio_meta", run_at: amanha })
      .throwOnError();
    const { error: erroKind } = await admin
      .from("job_queue")
      .insert({ clinic_id: c, kind: "resolver_qualquer_coisa" });
    expect(erroKind?.code).toBe("23514");
  });
});

describe("enfileirar_resolucao_de_anuncios_meta", () => {
  it("clínica de teste nunca ganha job sem p_incluir_teste", async () => {
    const c = await novaClinica("Teste");
    await configurar(c);
    await contatoDeAnuncio(c, "7301");
    for (const origem of ["ingestao", "gasto", "teste"]) {
      expect(
        (await enfileirar(c, origem, { incluirTeste: false })).codigo,
      ).toBe("clinica_de_teste");
    }
    expect(await jobsVivos(c)).toEqual([]);
    const comTeste = await comJobsAdiados([c], () => enfileirar(c, "ingestao"));
    expect(comTeste.codigo).toBe("enfileirado");
  });

  it("sem_configuracao: clínica inexistente, sem conta, sem token ou só com o token da CAPI", async () => {
    expect((await enfileirar(crypto.randomUUID(), "ingestao")).codigo).toBe(
      "sem_configuracao",
    );
    const c = await novaClinica("SemConfig");
    await contatoDeAnuncio(c, "7302");
    expect((await enfileirar(c, "ingestao")).codigo).toBe("sem_configuracao");
    await admin
      .from("meta_ads_account")
      .insert({ clinic_id: c, ad_account_id: "act_9399999" })
      .throwOnError();
    expect((await enfileirar(c, "teste")).codigo).toBe("sem_configuracao");
    await admin
      .from("meta_ads_account_secret")
      .insert({
        clinic_id: c,
        capi_access_token: `EAAtokenDaCapi${sufixo}0123456789`,
      })
      .throwOnError();
    expect((await enfileirar(c, "teste")).codigo).toBe("sem_configuracao");
    expect(await jobsVivos(c)).toEqual([]);
  });

  it("nada_a_resolver sem contato de anúncio ou com id que não é numérico", async () => {
    const c = await novaClinica("Nada");
    await configurar(c);
    expect((await enfileirar(c, "ingestao")).codigo).toBe("nada_a_resolver");
    await contatoDeAnuncio(c, "123_456");
    expect((await enfileirar(c, "gasto")).codigo).toBe("nada_a_resolver");
    expect(await jobsVivos(c)).toEqual([]);
  });

  it("cria um job (payload, max_attempts 5, agora), deduplica e trata executando como vivo", async () => {
    const c = await novaClinica("Cria");
    await configurar(c);
    await contatoDeAnuncio(c, "7101");
    const [primeiro, segundo] = await comJobsAdiados([c], async () => [
      await enfileirar(c, "ingestao"),
      await enfileirar(c, "gasto"),
    ]);
    expect(primeiro!.codigo).toBe("enfileirado");
    expect(Math.abs(ms(primeiro!.run_at)! - Date.now())).toBeLessThan(120_000);
    expect(segundo).toEqual({ codigo: "ja_na_fila" });
    const jobs = await jobsVivos(c);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toEqual({ origem: "ingestao" });
    expect(jobs[0]!.max_attempts).toBe(5);
    expect(jobs[0]!.attempts).toBe(0);

    await admin
      .from("job_queue")
      .update({
        status: "executando",
        locked_by: WORKER,
        locked_at: new Date().toISOString(),
      })
      .eq("id", jobs[0]!.id)
      .throwOnError();
    expect((await enfileirar(c, "teste")).codigo).toBe("ja_na_fila");
    await admin
      .from("job_queue")
      .update({ status: "concluido", locked_by: null, locked_at: null })
      .eq("id", jobs[0]!.id)
      .throwOnError();
    const depois = await comJobsAdiados([c], () => enfileirar(c, "teste"));
    expect(depois.codigo).toBe("enfileirado");
    expect(await jobsVivos(c)).toHaveLength(1);
  });

  it("token ou permissão recusados pausam ingestao e gasto; a origem teste passa; limite da Meta não pausa", async () => {
    const c = await novaClinica("Pausa");
    await configurar(c);
    await contatoDeAnuncio(c, "7101");
    await admin
      .from("meta_gasto_leitura")
      .insert({
        clinic_id: c,
        situacao: "com_problema",
        problema: "token_invalido",
        codigo_da_meta: 190,
      })
      .throwOnError();
    expect((await enfileirar(c, "ingestao")).codigo).toBe("pausada");
    expect((await enfileirar(c, "gasto")).codigo).toBe("pausada");
    expect(await jobsVivos(c)).toEqual([]);
    const teste = await comJobsAdiados([c], () => enfileirar(c, "teste"));
    expect(teste.codigo).toBe("enfileirado");
    await cancelarJobs(c);
    for (const problema of [
      "sem_permissao",
      "conta_sem_acesso",
      "exige_prova_do_app",
    ]) {
      await admin
        .from("meta_gasto_leitura")
        .update({ problema })
        .eq("clinic_id", c)
        .throwOnError();
      expect((await enfileirar(c, "gasto")).codigo, problema).toBe("pausada");
    }
    await admin
      .from("meta_gasto_leitura")
      .update({ problema: "limite_da_meta" })
      .eq("clinic_id", c)
      .throwOnError();
    const limite = await comJobsAdiados([c], () => enfileirar(c, "ingestao"));
    expect(limite.codigo).toBe("enfileirado");
  });

  it("linha só do insights continua pendente (ganha o conjunto); linha já consultada não", async () => {
    const c = await novaClinica("Insights");
    const { conta } = await configurar(c);
    await contatoDeAnuncio(c, "7101");
    await admin
      .from("meta_anuncio")
      .insert({
        clinic_id: c,
        ad_id: "7101",
        ad_account_id: conta,
        campaign_id: "9101",
        campaign_name: "Campanha 7101",
        ultimo_dia_com_entrega: "2026-09-30",
      })
      .throwOnError();
    const pendente = await comJobsAdiados([c], () => enfileirar(c, "gasto"));
    expect(pendente.codigo).toBe("enfileirado");
    await cancelarJobs(c);
    await admin
      .from("meta_anuncio")
      .update({ consultado_em: new Date().toISOString() })
      .eq("clinic_id", c)
      .eq("ad_id", "7101")
      .throwOnError();
    expect((await enfileirar(c, "gasto")).codigo).toBe("nada_a_resolver");
  });

  it("recusa vale só com a mesma conta e o mesmo token; nova tentativa futura vira o run_at; anúncio novo puxa o job", async () => {
    const c = await novaClinica("Recusa");
    const { conta, token } = await configurar(c);
    await contatoDeAnuncio(c, "7102");
    await admin
      .from("meta_anuncio_recusado")
      .insert({
        clinic_id: c,
        ad_id: "7102",
        motivo: "inacessivel",
        codigo_da_meta: 100,
        ad_account_id: conta,
        token_sha256: sha256(token),
      })
      .throwOnError();
    expect((await enfileirar(c, "ingestao")).codigo).toBe("nada_a_resolver");

    await admin
      .from("meta_anuncio_recusado")
      .update({ token_sha256: sha256("outro token qualquer") })
      .eq("clinic_id", c)
      .throwOnError();
    const outroToken = await comJobsAdiados([c], () =>
      enfileirar(c, "ingestao"),
    );
    expect(outroToken.codigo).toBe("enfileirado");
    await cancelarJobs(c);

    await admin
      .from("meta_anuncio_recusado")
      .update({ token_sha256: sha256(token), ad_account_id: "act_9999999" })
      .eq("clinic_id", c)
      .throwOnError();
    const outraConta = await comJobsAdiados([c], () =>
      enfileirar(c, "ingestao"),
    );
    expect(outraConta.codigo).toBe("enfileirado");
    await cancelarJobs(c);

    const daquiADuasHoras = new Date(Date.now() + 2 * UMA_HORA).toISOString();
    await admin
      .from("meta_anuncio_recusado")
      .update({
        ad_account_id: conta,
        motivo: "sem_entrega_ainda",
        tentar_de_novo_em: daquiADuasHoras,
      })
      .eq("clinic_id", c)
      .throwOnError();
    const futura = await enfileirar(c, "gasto");
    expect(futura.codigo).toBe("enfileirado");
    expect(ms(futura.run_at)).toBe(ms(daquiADuasHoras));
    let jobs = await jobsVivos(c);
    expect(ms(jobs[0]!.run_at as string)).toBe(ms(daquiADuasHoras));

    // Anuncio novo: o job marcado para depois e puxado para agora; um pedido
    // para depois nao o empurra de volta.
    await contatoDeAnuncio(c, "7103");
    const [puxado, depois] = await comJobsAdiados([c], async () => {
      const r1 = await enfileirar(c, "ingestao");
      const r2 = await enfileirar(c, "gasto", {
        runAt: new Date(Date.now() + 3 * UMA_HORA).toISOString(),
      });
      jobs = await jobsVivos(c);
      return [r1, r2];
    });
    expect(puxado).toEqual({ codigo: "ja_na_fila" });
    expect(depois).toEqual({ codigo: "ja_na_fila" });
    expect(jobs).toHaveLength(1);
    expect(Math.abs(ms(jobs[0]!.run_at as string)! - Date.now())).toBeLessThan(
      120_000,
    );
  });

  it("p_run_at no futuro vale; origem fora da lista é 22023", async () => {
    const c = await novaClinica("RunAt");
    await configurar(c);
    await contatoDeAnuncio(c, "7104");
    const mais3h = new Date(Date.now() + 3 * UMA_HORA).toISOString();
    const r = await comJobsAdiados([c], () =>
      enfileirar(c, "gasto", { runAt: mais3h }),
    );
    expect(r.codigo).toBe("enfileirado");
    expect(ms(r.run_at)).toBe(ms(mais3h));
    for (const origem of ["manual", "configuracao", ""]) {
      const { error } = await admin.rpc(
        "enfileirar_resolucao_de_anuncios_meta",
        { p_clinic_id: c, p_origem: origem, p_incluir_teste: true },
      );
      expect(error?.code, origem).toBe("22023");
    }
  });
});

describe("anuncios_meta_a_resolver", () => {
  it("config_mudou com token, conta ou sha errados", async () => {
    const c = await novaClinica("ListaConfig");
    const { conta, token } = await configurar(c);
    await contatoDeAnuncio(c, "7105");
    expect(await lista(c, conta, sha256("token errado"))).toEqual({
      codigo: "config_mudou",
    });
    expect(await lista(c, "act_9999999", sha256(token))).toEqual({
      codigo: "config_mudou",
    });
    expect(await lista(c, conta, null)).toEqual({ codigo: "config_mudou" });
  });

  it("nunca recusados primeiro (contato mais recente antes), depois a nova tentativa vencida; limite, restantes e p_agora", async () => {
    const c = await novaClinica("ListaOrdem");
    const { conta, token } = await configurar(c);
    await contatoDeAnuncio(c, "7102", "2026-10-01T11:00:00.000Z");
    await contatoDeAnuncio(c, "7104", "2026-10-02T10:00:00.000Z");
    await contatoDeAnuncio(c, "7104", "2026-10-01T09:00:00.000Z");
    await contatoDeAnuncio(c, "7105", "2026-10-02T11:00:00.000Z");
    await contatoDeAnuncio(c, "7106", "2026-10-02T12:00:00.000Z");
    await admin
      .from("meta_anuncio_recusado")
      .insert({
        clinic_id: c,
        ad_id: "7102",
        motivo: "sem_entrega_ainda",
        ad_account_id: conta,
        token_sha256: sha256(token),
        tentar_de_novo_em: new Date(Date.now() - 60_000).toISOString(),
      })
      .throwOnError();
    // O sha em maiusculas tambem vale.
    expect(await lista(c, conta, sha256(token).toUpperCase())).toEqual({
      codigo: "ok",
      ad_ids: ["7106", "7105", "7104", "7102"],
      restantes: 0,
      proxima_tentativa_em: null,
    });
    const dois = await lista(c, conta, sha256(token), { limite: 2 });
    expect(dois).toMatchObject({ ad_ids: ["7106", "7105"], restantes: 2 });
    const zero = await lista(c, conta, sha256(token), { limite: 0 });
    const mil = await lista(c, conta, sha256(token), { limite: 1000 });
    expect(zero.codigo === "ok" && zero.ad_ids).toHaveLength(1);
    expect(mil.codigo === "ok" && mil.ad_ids).toHaveLength(4);

    const daqui5h = new Date(Date.now() + 5 * UMA_HORA).toISOString();
    await admin
      .from("meta_anuncio_recusado")
      .update({ tentar_de_novo_em: daqui5h })
      .eq("clinic_id", c)
      .throwOnError();
    const futura = await lista(c, conta, sha256(token));
    expect(futura.codigo === "ok" && futura.ad_ids).toEqual([
      "7106",
      "7105",
      "7104",
    ]);
    expect(
      futura.codigo === "ok" ? ms(futura.proxima_tentativa_em) : null,
    ).toBe(ms(daqui5h));
    const comAgora = await lista(c, conta, sha256(token), {
      agora: new Date(Date.now() + 6 * UMA_HORA).toISOString(),
    });
    expect(comAgora).toMatchObject({
      ad_ids: ["7106", "7105", "7104", "7102"],
      proxima_tentativa_em: null,
    });
    // So le: a recusa continua la.
    expect(await recusa(c, "7102")).not.toBeNull();
  });
});

describe("gravar_resolucao_de_anuncios_meta", () => {
  it("sem_posse: outro worker, job de outra clínica, job do gasto e job pendente", async () => {
    const c = await novaClinica("Posse");
    const outra = await novaClinica("PosseOutra");
    const { conta, token } = await configurar(c);
    await configurar(outra);
    const jobR = await jobEmExecucao(c, "resolver_anuncio_meta");
    const jobG = await jobEmExecucao(c, "sincronizar_gasto_meta");
    const jobOutra = await jobEmExecucao(outra, "resolver_anuncio_meta");
    const base = { clinicId: c, conta, sha: sha256(token) };
    expect(await gravar({ ...base, jobId: jobR, worker: "outro" })).toBe(
      "sem_posse",
    );
    expect(await gravar({ ...base, jobId: jobOutra })).toBe("sem_posse");
    expect(
      await gravar({
        ...base,
        jobId: jobG,
        resolvidos: [
          { ad_id: "7106", ad_account_id: conta, campaign_id: "9106" },
        ],
      }),
    ).toBe("sem_posse");
    await admin
      .from("job_queue")
      .update({ status: "pendente" })
      .eq("id", jobR)
      .throwOnError();
    expect(
      await comJobsAdiados([c], () => gravar({ ...base, jobId: jobR })),
    ).toBe("sem_posse");
    expect(await anuncio(c, "7106")).toBeNull();
  });

  it("config_mudou com sha errado, conta errada ou sha nulo, e nada é gravado", async () => {
    const c = await novaClinica("Config");
    const { conta, token } = await configurar(c);
    const jobId = await jobEmExecucao(c, "resolver_anuncio_meta");
    const resolvidos = [
      { ad_id: "7106", ad_account_id: conta, campaign_id: "9106" },
    ];
    const recusas = [{ ad_id: "7105", motivo: "inacessivel", codigo: 100 }];
    expect(
      await gravar({
        jobId,
        clinicId: c,
        conta,
        sha: sha256("token errado"),
        resolvidos,
        recusas,
      }),
    ).toBe("config_mudou");
    expect(
      await gravar({
        jobId,
        clinicId: c,
        conta: "act_9999999",
        sha: sha256(token),
        resolvidos,
        recusas,
      }),
    ).toBe("config_mudou");
    expect(
      await gravar({
        jobId,
        clinicId: c,
        conta,
        sha: null,
        resolvidos,
        recusas,
      }),
    ).toBe("config_mudou");
    expect(await anuncio(c, "7106")).toBeNull();
    expect(await recusa(c, "7105")).toBeNull();
  });

  it("formato inválido é 22023 e não grava nada", async () => {
    const c = await novaClinica("Formato");
    const { conta, token } = await configurar(c);
    const jobId = await jobEmExecucao(c, "resolver_anuncio_meta");
    const base = { jobId, clinicId: c, conta, sha: sha256(token) };
    const invalidos: Array<Pick<Gravacao, "resolvidos" | "recusas">> = [
      { resolvidos: {} },
      { resolvidos: [{ ad_id: "abc", campaign_id: "1" }] },
      { resolvidos: ["7106"] },
      { recusas: [{ ad_id: "7105", motivo: "qualquer" }] },
      { recusas: [{ ad_id: "7105", motivo: "inacessivel", codigo: "abc" }] },
      { recusas: [{ motivo: "inacessivel" }] },
    ];
    for (const invalido of invalidos) {
      const { error } = await gravarBruto({ ...base, ...invalido });
      expect(error?.code, JSON.stringify(invalido)).toBe("22023");
    }
  });

  it("só a conta salva entra no mapa; outra conta e resposta sem campanha viram recusa; nada fica pendente depois", async () => {
    const c = await novaClinica("Grava");
    const { conta, token } = await configurar(c);
    for (const ad of ["7102", "7104", "7105", "7106", "7107", "7108"]) {
      await contatoDeAnuncio(c, ad);
    }
    const jobId = await jobEmExecucao(c, "resolver_anuncio_meta");
    const digitos = conta.slice("act_".length);
    expect(
      await gravar({
        jobId,
        clinicId: c,
        conta,
        sha: sha256(token).toUpperCase(),
        resolvidos: [
          {
            ad_id: "7106",
            ad_account_id: conta,
            campaign_id: "9106",
            campaign_name: "  Campanha 7106  ",
            adset_id: "8106",
            adset_name: "Conjunto 7106",
            ad_name: "Anúncio 7106",
          },
          // A Meta devolve account_id so com os digitos.
          {
            ad_id: "7105",
            ad_account_id: digitos,
            campaign_id: "9105",
            campaign_name: null,
            adset_id: null,
            adset_name: "",
            ad_name: null,
          },
          {
            ad_id: "7104",
            ad_account_id: "act_9999999",
            campaign_id: "9104",
            campaign_name: "Da agência",
          },
          {
            ad_id: "7107",
            ad_account_id: conta,
            campaign_id: null,
            campaign_name: "Sem id",
          },
        ],
        recusas: [
          { ad_id: "7102", motivo: "sem_entrega_ainda", codigo: null },
          { ad_id: "7108", motivo: "inacessivel", codigo: 100 },
          // Resolvido e recusado na mesma chamada: vale o resolvido.
          { ad_id: "7106", motivo: "inacessivel", codigo: 100 },
        ],
      }),
    ).toBe("ok");

    expect(await anuncio(c, "7106")).toMatchObject({
      ad_account_id: conta,
      campaign_id: "9106",
      campaign_name: "Campanha 7106",
      adset_id: "8106",
      adset_name: "Conjunto 7106",
      ad_name: "Anúncio 7106",
      origem: "consulta",
      ultimo_dia_com_entrega: null,
    });
    expect((await anuncio(c, "7106"))!.consultado_em).not.toBeNull();
    expect(await anuncio(c, "7105")).toMatchObject({
      ad_account_id: conta,
      campaign_id: "9105",
      campaign_name: null,
      adset_id: null,
      adset_name: null,
      origem: "consulta",
    });
    expect(await anuncio(c, "7104")).toBeNull();
    expect(await anuncio(c, "7107")).toBeNull();

    expect(await recusa(c, "7104")).toMatchObject({
      motivo: "outra_conta",
      codigo_da_meta: null,
      tentar_de_novo_em: null,
      tentativas: 1,
      ad_account_id: conta,
      token_sha256: sha256(token),
    });
    const semCampanha = (await recusa(c, "7107"))!;
    expect(semCampanha.motivo).toBe("resposta_invalida");
    expect(
      ms(semCampanha.tentar_de_novo_em)! - ms(semCampanha.recusado_em)!,
    ).toBe(24 * UMA_HORA);
    const semEntrega = (await recusa(c, "7102"))!;
    expect(semEntrega).toMatchObject({
      motivo: "sem_entrega_ainda",
      tentativas: 1,
    });
    expect(
      ms(semEntrega.tentar_de_novo_em)! - ms(semEntrega.recusado_em)!,
    ).toBe(UMA_HORA);
    expect(await recusa(c, "7108")).toMatchObject({
      motivo: "inacessivel",
      codigo_da_meta: 100,
      tentar_de_novo_em: null,
    });
    expect(await recusa(c, "7106")).toBeNull();

    const pendentes = await lista(c, conta, sha256(token));
    expect(pendentes).toMatchObject({ codigo: "ok", ad_ids: [] });
    expect(
      pendentes.codigo === "ok" ? ms(pendentes.proxima_tentativa_em) : null,
    ).toBe(ms(semEntrega.tentar_de_novo_em));

    // Anuncio recusado que se resolve perde a recusa.
    expect(
      await gravar({
        jobId,
        clinicId: c,
        conta,
        sha: sha256(token),
        resolvidos: [
          {
            ad_id: "7102",
            ad_account_id: conta,
            campaign_id: "9102",
            campaign_name: "Campanha 7102",
          },
        ],
      }),
    ).toBe("ok");
    expect(await recusa(c, "7102")).toBeNull();
    expect(await anuncio(c, "7102")).toMatchObject({ campaign_id: "9102" });

    // Listas nulas: ok, nada muda.
    expect(
      await gravar({
        jobId,
        clinicId: c,
        conta,
        sha: sha256(token),
        resolvidos: null,
        recusas: null,
      }),
    ).toBe("ok");
  });

  it("sem_entrega_ainda tenta de novo em 1 h, 6 h e 24 h até 7 dias da primeira recusa; outro motivo recomeça", async () => {
    const c = await novaClinica("Tentativas");
    const { conta, token } = await configurar(c);
    const jobId = await jobEmExecucao(c, "resolver_anuncio_meta");
    const recusar = (motivo: string, codigo: number | null = null) =>
      gravar({
        jobId,
        clinicId: c,
        conta,
        sha: sha256(token),
        recusas: [{ ad_id: "7102", motivo, codigo }],
      });
    const intervalo = (r: Recusa) =>
      r.tentar_de_novo_em === null
        ? null
        : ms(r.tentar_de_novo_em)! - ms(r.recusado_em)!;

    expect(await recusar("sem_entrega_ainda")).toBe("ok");
    const primeira = (await recusa(c, "7102"))!;
    expect(primeira.tentativas).toBe(1);
    expect(intervalo(primeira)).toBe(UMA_HORA);
    await recusar("sem_entrega_ainda");
    const segunda = (await recusa(c, "7102"))!;
    expect(segunda.tentativas).toBe(2);
    expect(intervalo(segunda)).toBe(6 * UMA_HORA);
    expect(segunda.primeira_recusa_em).toBe(primeira.primeira_recusa_em);
    await recusar("sem_entrega_ainda");
    const terceira = (await recusa(c, "7102"))!;
    expect(terceira.tentativas).toBe(3);
    expect(intervalo(terceira)).toBe(24 * UMA_HORA);

    // Passou dos 7 dias: nunca mais (ate trocar conta ou token).
    const seisDiasEMeio = new Date(
      Date.now() - (6 * 24 + 12) * UMA_HORA,
    ).toISOString();
    await admin
      .from("meta_anuncio_recusado")
      .update({ primeira_recusa_em: seisDiasEMeio })
      .eq("clinic_id", c)
      .throwOnError();
    await recusar("sem_entrega_ainda");
    const teto = (await recusa(c, "7102"))!;
    expect(teto.tentativas).toBe(4);
    expect(teto.tentar_de_novo_em).toBeNull();
    expect(ms(teto.primeira_recusa_em)).toBe(ms(seisDiasEMeio));

    // Outro motivo recomeca a contagem.
    await recusar("resposta_invalida", 1);
    const outroMotivo = (await recusa(c, "7102"))!;
    expect(outroMotivo).toMatchObject({
      motivo: "resposta_invalida",
      tentativas: 1,
      codigo_da_meta: 1,
    });
    expect(intervalo(outroMotivo)).toBe(24 * UMA_HORA);
  });

  it("trocar o token libera as recusas definitivas e recomeça a contagem; o token velho dá config_mudou", async () => {
    const c = await novaClinica("TrocaToken");
    const { conta, token } = await configurar(c);
    await contatoDeAnuncio(c, "7104");
    const jobId = await jobEmExecucao(c, "resolver_anuncio_meta");
    await gravar({
      jobId,
      clinicId: c,
      conta,
      sha: sha256(token),
      recusas: [{ ad_id: "7104", motivo: "outra_conta", codigo: null }],
    });
    expect(await lista(c, conta, sha256(token))).toMatchObject({ ad_ids: [] });

    const tokenNovo = `EAAtokenNovo${sufixo}9876543210`;
    await admin
      .from("meta_ads_account_secret")
      .update({ insights_access_token: tokenNovo })
      .eq("clinic_id", c)
      .throwOnError();
    expect(await lista(c, conta, sha256(tokenNovo))).toMatchObject({
      ad_ids: ["7104"],
    });
    expect(
      await gravar({ jobId, clinicId: c, conta, sha: sha256(token) }),
    ).toBe("config_mudou");
    await gravar({
      jobId,
      clinicId: c,
      conta,
      sha: sha256(tokenNovo),
      recusas: [{ ad_id: "7104", motivo: "outra_conta", codigo: null }],
    });
    expect(await recusa(c, "7104")).toMatchObject({
      tentativas: 1,
      token_sha256: sha256(tokenNovo),
    });
  });

  it("consulta sobre a linha do insights grava nomes e a hora; origem e dia ficam; consulta sem nome não apaga", async () => {
    const c = await novaClinica("SobreInsights");
    const { conta, token } = await configurar(c);
    await admin
      .from("meta_anuncio")
      .insert({
        clinic_id: c,
        ad_id: "7109",
        ad_account_id: conta,
        campaign_id: "9109",
        campaign_name: "Nome do insights",
        ultimo_dia_com_entrega: "2026-09-20",
      })
      .throwOnError();
    const jobId = await jobEmExecucao(c, "resolver_anuncio_meta");
    const base = { jobId, clinicId: c, conta, sha: sha256(token) };
    await gravar({
      ...base,
      resolvidos: [
        {
          ad_id: "7109",
          ad_account_id: conta,
          campaign_id: "9109",
          campaign_name: "Nome atual",
          adset_id: "8109",
          adset_name: "Conjunto 7109",
          ad_name: "Anúncio 7109",
        },
      ],
    });
    const esperado = {
      origem: "insights",
      ultimo_dia_com_entrega: "2026-09-20",
      campaign_name: "Nome atual",
      adset_id: "8109",
      adset_name: "Conjunto 7109",
      ad_name: "Anúncio 7109",
    };
    expect(await anuncio(c, "7109")).toMatchObject(esperado);
    expect((await anuncio(c, "7109"))!.consultado_em).not.toBeNull();
    await gravar({
      ...base,
      resolvidos: [
        { ad_id: "7109", ad_account_id: conta, campaign_id: "9109" },
      ],
    });
    expect(await anuncio(c, "7109")).toMatchObject(esperado);
  });
});

describe("registrar_falha_do_gasto_meta pelo job do resolvedor", () => {
  it("pausa a leitura igual ao gasto; a ingestão passa a dar pausada; outro tipo de job e outro worker são sem_posse", async () => {
    const c = await novaClinica("Falha");
    const { conta, token } = await configurar(c);
    const jobR = await jobEmExecucao(c, "resolver_anuncio_meta");
    const registrar = async (jobId: string, worker = WORKER) => {
      const { data, error } = await admin.rpc("registrar_falha_do_gasto_meta", {
        p_job_id: jobId,
        p_worker: worker,
        p_clinic_id: c,
        p_ad_account_id: conta,
        p_token_sha256: sha256(token),
        p_problema: "token_invalido",
        p_codigo: 190,
      });
      expect(error).toBeNull();
      return data as string;
    };
    expect(await registrar(jobR)).toBe("ok");
    const { data: leitura } = await admin
      .from("meta_gasto_leitura")
      .select("situacao, problema, codigo_da_meta")
      .eq("clinic_id", c)
      .single()
      .throwOnError();
    expect(leitura).toEqual({
      situacao: "com_problema",
      problema: "token_invalido",
      codigo_da_meta: 190,
    });
    await contatoDeAnuncio(c, "7112");
    expect((await enfileirar(c, "ingestao")).codigo).toBe("pausada");

    const { data: outroTipo } = await admin
      .from("job_queue")
      .insert({
        clinic_id: c,
        kind: "oferecer_lista_espera",
        status: "executando",
        locked_by: WORKER,
        locked_at: new Date().toISOString(),
        attempts: 1,
      })
      .select("id")
      .single()
      .throwOnError();
    expect(await registrar(outroTipo!.id as string)).toBe("sem_posse");
    expect(await registrar(jobR, "outro-worker")).toBe("sem_posse");
  });
});

describe("regravar_gasto_meta sobre a linha da consulta", () => {
  it("linha sem dia de entrega recebe o nome e o dia do insights; conjunto, nome do anúncio, origem e hora da consulta ficam", async () => {
    const c = await novaClinica("Regravar");
    const { conta, token } = await configurar(c);
    const ontem = new Date(Date.now() - 86_400_000).toISOString();
    await admin
      .from("meta_anuncio")
      .insert([
        {
          clinic_id: c,
          ad_id: "5001",
          ad_account_id: conta,
          campaign_id: "9501",
          campaign_name: "Nome da consulta",
          adset_name: "Conjunto da consulta",
          ad_name: "Anúncio da consulta",
          ultimo_dia_com_entrega: null,
          origem: "consulta",
          consultado_em: ontem,
        },
        {
          clinic_id: c,
          ad_id: "5002",
          ad_account_id: conta,
          campaign_id: "9502",
          campaign_name: "Consulta 5002",
          adset_name: "Conjunto 5002",
          ultimo_dia_com_entrega: null,
          origem: "consulta",
          consultado_em: ontem,
        },
      ])
      .throwOnError();
    // Nem o sistema cria linha sem dia vinda do insights (so a consulta).
    const { error: semDia } = await admin.from("meta_anuncio").insert({
      clinic_id: c,
      ad_id: "5009",
      ad_account_id: conta,
      campaign_id: "9509",
      ultimo_dia_com_entrega: null,
    });
    expect(semDia?.code).toBe("23514");

    const jobId = await jobEmExecucao(c, "sincronizar_gasto_meta");
    const regravar = async (
      desde: string,
      ate: string,
      porAnuncio: unknown[],
    ) => {
      const { data, error } = await admin.rpc("regravar_gasto_meta", {
        p_job_id: jobId,
        p_worker: WORKER,
        p_clinic_id: c,
        p_ad_account_id: conta,
        p_token_sha256: sha256(token),
        p_desde: desde,
        p_ate: ate,
        p_moeda: "BRL",
        p_fuso: "America/Sao_Paulo",
        p_nome_da_conta: "Conta da clínica",
        p_conta_ativa: true,
        p_por_anuncio: porAnuncio,
        p_da_conta: [],
      });
      expect(error).toBeNull();
      return data as string;
    };
    expect(
      await regravar("2026-09-01", "2026-09-30", [
        {
          dia: "2026-09-10",
          ad_id: "5001",
          adset_id: "6501",
          campaign_id: "9501",
          campaign_name: "Nome do insights",
          spend_cents: 100,
        },
        {
          dia: "2026-09-11",
          ad_id: "5002",
          adset_id: null,
          campaign_id: "9502",
          campaign_name: null,
          spend_cents: 50,
        },
        {
          dia: "2026-09-12",
          ad_id: "5003",
          adset_id: "6503",
          campaign_id: "9503",
          campaign_name: "Novo do insights",
          spend_cents: 10,
        },
      ]),
    ).toBe("ok");
    const a5001 = await anuncio(c, "5001");
    expect(a5001).toMatchObject({
      campaign_name: "Nome do insights",
      ultimo_dia_com_entrega: "2026-09-10",
      adset_id: "6501",
      adset_name: "Conjunto da consulta",
      ad_name: "Anúncio da consulta",
      origem: "consulta",
    });
    expect(ms(a5001!.consultado_em as string)).toBe(ms(ontem));
    expect(await anuncio(c, "5002")).toMatchObject({
      campaign_name: "Consulta 5002",
      adset_name: "Conjunto 5002",
      ultimo_dia_com_entrega: "2026-09-11",
    });
    expect(await anuncio(c, "5003")).toMatchObject({
      origem: "insights",
      consultado_em: null,
      adset_name: null,
      ad_name: null,
      ultimo_dia_com_entrega: "2026-09-12",
      campaign_name: "Novo do insights",
    });
    // Janela mais antiga nao troca o nome (regra da Fase 4).
    expect(
      await regravar("2026-08-01", "2026-08-31", [
        {
          dia: "2026-08-20",
          ad_id: "5001",
          adset_id: "6501",
          campaign_id: "9501",
          campaign_name: "Nome velho",
          spend_cents: 5,
        },
      ]),
    ).toBe("ok");
    expect(await anuncio(c, "5001")).toMatchObject({
      campaign_name: "Nome do insights",
      ultimo_dia_com_entrega: "2026-09-10",
    });
  });
});
