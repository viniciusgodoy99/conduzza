import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "../rls/stack";

// Clique rastreado pelo site, banco (migration 20261005100000, F1 do
// Google) contra o banco REAL, com o cliente de servico:
// - registrar_clique_do_site: ok, chave_invalida, desligado, limite (30 por
//   minuto por clinica), duplicado, codigo_reservado e 22023; chave trocada
//   (a velha da chave_invalida); teto de 2.000 vivos por clinica (cheio, o
//   clique novo entra e sai o vivo que vence primeiro; nunca trava a rota,
//   nem com a chave trocada);
// - casar_clique_do_site: origem_gravada (Trafego pago, Google, metodo
//   clique_site e os ids da campanha e do grupo), vinculado, nao_achado
//   (codigo ja usado, codigo da A na B, contato de outra clinica) e
//   expirado; o anuncio da Meta e a origem ja gravada vem antes;
// - coerencia da origem clique_site (23514) e imutabilidade (P0001);
// - podar_cliques_do_site: nao casado sai 1 dia depois de vencer; casado
//   perde gclid, gbraid e wbraid 90 dias depois do clique;
// - anon recebe 42501 em todas as funcoes novas e em clique_do_site.
// Mesmos cenarios do ensaio (scratchpad/google/banco-f1/asserts.sql). Quem
// le o que esta em tests/rls/clique-do-site.test.ts.
//
// CUIDADO, o banco de desenvolvimento e a producao. Todas as clinicas daqui
// sao de teste (e_de_teste = true) e somem no afterAll (cliques, rastreio e
// contatos vao junto). O motor de producao poda os cliques de TODAS as
// clinicas a cada minuto: os casos de poda conferem o estado final das
// linhas, nunca a contagem devolvida (o motor pode ter podado antes).

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicas: string[] = [];

const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const DIA = 86_400_000;

/** Codigo valido de numero n (base 31 no alfabeto de attribution.ts). */
function codigo(n: number): string {
  let texto = "";
  let resto = n;
  for (let i = 0; i < 6; i++) {
    texto = ALFABETO.charAt(resto % 31) + texto;
    resto = Math.floor(resto / 31);
  }
  return texto;
}

let sequencia = 0;
/** Codigo novo por chamada, diferente entre execucoes do teste. */
function codigoNovo(): string {
  sequencia += 1;
  return codigo((Date.now() % 50_000_000) * 10 + sequencia);
}

async function novaClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `CliqueDoSite ${nome} ${sufixo}`,
      slug: `clique-do-site-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
      timezone: "America/Fortaleza",
    })
    .select("id")
    .single()
    .throwOnError();
  clinicas.push(data!.id as string);
  return data!.id as string;
}

/** Rastreio ligado, criado pelo sistema; devolve a chave nascida no banco. */
async function ligarRastreio(clinicId: string): Promise<string> {
  const { data } = await admin
    .from("rastreio_do_site")
    .insert({ clinic_id: clinicId, ativo: true })
    .select("chave")
    .single()
    .throwOnError();
  return data!.chave as string;
}

let telefone = 0;
async function contato(
  clinicId: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  telefone += 1;
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+55849797${String(telefone).padStart(5, "0")}`,
      name: `Contato ${telefone}`,
      ...extras,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

type Clique = {
  chave: string;
  codigo: string;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  gadSource?: string | null;
  campanha?: string | null;
  grupo?: string | null;
  host?: string | null;
};

async function registrar(
  clique: Clique,
): Promise<{ data: string | null; error: { code?: string } | null }> {
  const { data, error } = await admin.rpc("registrar_clique_do_site", {
    p_chave: clique.chave,
    p_codigo: clique.codigo,
    p_gclid: clique.gclid ?? null,
    p_gbraid: clique.gbraid ?? null,
    p_wbraid: clique.wbraid ?? null,
    p_gad_source: clique.gadSource ?? null,
    p_google_campaign_id: clique.campanha ?? null,
    p_google_adgroup_id: clique.grupo ?? null,
    p_site_host: clique.host ?? null,
  });
  return { data: (data as string | null) ?? null, error };
}

async function registrarOk(clique: Clique): Promise<void> {
  const { data, error } = await registrar(clique);
  expect(error).toBeNull();
  expect(data).toBe("ok");
}

async function casar(
  clinicId: string,
  contactId: string,
  codigoDaMensagem: string,
): Promise<string> {
  const { data, error } = await admin.rpc("casar_clique_do_site", {
    p_clinic_id: clinicId,
    p_contact_id: contactId,
    p_codigo: codigoDaMensagem,
  });
  expect(error).toBeNull();
  return data as string;
}

async function cliqueGravado(clinicId: string, codigoDoClique: string) {
  const { data } = await admin
    .from("clique_do_site")
    .select(
      "codigo, gclid, gbraid, wbraid, gad_source, google_campaign_id, google_adgroup_id, site_host, criado_em, valido_ate, contact_id, casado_em",
    )
    .eq("clinic_id", clinicId)
    .eq("codigo", codigoDoClique)
    .maybeSingle()
    .throwOnError();
  return data;
}

async function origemDoContato(contactId: string) {
  const { data } = await admin
    .from("contact")
    .select(
      "source_channel, source_origin, source_medium, source_campaign, source_method, source_captured_at, source_google_campaign_id, source_google_adgroup_id",
    )
    .eq("id", contactId)
    .single()
    .throwOnError();
  return data!;
}

/** Clique gravado direto pelo sistema (datas no passado para prazo e poda). */
async function cliqueAntigo(
  clinicId: string,
  campos: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("clique_do_site")
    .insert({ clinic_id: clinicId, ...campos })
    .throwOnError();
}

let clinicaA = "";
let clinicaB = "";
let chaveA = "";
let chaveB = "";

beforeAll(async () => {
  clinicaA = await novaClinica("A");
  clinicaB = await novaClinica("B");
  chaveA = await ligarRastreio(clinicaA);
  chaveB = await ligarRastreio(clinicaB);
});

afterAll(async () => {
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
});

describe("registrar_clique_do_site", () => {
  it("grava o clique com prazo de 7 dias, host em minusculas e o ultimo clique", async () => {
    const cod = codigoNovo();
    const antes = Date.now();
    await registrarOk({
      chave: chaveA,
      codigo: cod,
      gclid: "Cj0KCQjw-abc_DEF.123",
      gbraid: "gb-1",
      wbraid: "wb-1",
      gadSource: "1",
      campanha: "123",
      grupo: "456",
      host: " WWW.Clinica.COM.br ",
    });
    const clique = await cliqueGravado(clinicaA, cod);
    expect(clique).toMatchObject({
      gclid: "Cj0KCQjw-abc_DEF.123",
      gbraid: "gb-1",
      wbraid: "wb-1",
      gad_source: "1",
      google_campaign_id: "123",
      google_adgroup_id: "456",
      site_host: "www.clinica.com.br",
      contact_id: null,
      casado_em: null,
    });
    const criado = new Date(clique!.criado_em).getTime();
    expect(new Date(clique!.valido_ate).getTime() - criado).toBe(7 * DIA);
    expect(criado).toBeGreaterThanOrEqual(antes - 60_000);
    const { data: rastreio } = await admin
      .from("rastreio_do_site")
      .select("ultimo_clique_em")
      .eq("clinic_id", clinicaA)
      .single()
      .throwOnError();
    expect(new Date(rastreio!.ultimo_clique_em as string).getTime()).toBe(
      criado,
    );
  });

  it("chave fora do formato ou inexistente: chave_invalida, sem gravar", async () => {
    const cod = codigoNovo();
    // curta, com letra fora do hexadecimal, em maiusculas e inexistente
    for (const chave of [
      "XYZ",
      `g${chaveA.slice(1)}`,
      `A${chaveA.slice(1)}`,
      "f".repeat(20),
    ]) {
      const { data, error } = await registrar({
        chave,
        codigo: cod,
        gclid: "g",
      });
      expect(error).toBeNull();
      expect(data).toBe("chave_invalida");
    }
    expect(await cliqueGravado(clinicaA, cod)).toBeNull();
  });

  it("rastreio desligado: desligado; religado: ok", async () => {
    const clinica = await novaClinica("Desligada");
    const chave = await ligarRastreio(clinica);
    await admin
      .from("rastreio_do_site")
      .update({ ativo: false })
      .eq("clinic_id", clinica)
      .throwOnError();
    const cod = codigoNovo();
    const { data } = await registrar({ chave, codigo: cod, gclid: "g" });
    expect(data).toBe("desligado");
    expect(await cliqueGravado(clinica, cod)).toBeNull();
    await admin
      .from("rastreio_do_site")
      .update({ ativo: true })
      .eq("clinic_id", clinica)
      .throwOnError();
    await registrarOk({ chave, codigo: cod, gclid: "g" });
  });

  it("o mesmo aviso de novo: duplicado, e o clique fica como estava", async () => {
    const cod = codigoNovo();
    await registrarOk({ chave: chaveA, codigo: cod, gclid: "primeiro" });
    const { data } = await registrar({
      chave: chaveA,
      codigo: cod,
      gclid: "segundo",
    });
    expect(data).toBe("duplicado");
    expect((await cliqueGravado(clinicaA, cod))!.gclid).toBe("primeiro");
  });

  it("codigo igual a token de campaign_link da clinica (ativo ou nao): codigo_reservado", async () => {
    const ativo = codigoNovo();
    const inativo = codigoNovo();
    const daB = codigoNovo();
    await admin
      .from("campaign_link")
      .insert([
        {
          clinic_id: clinicaA,
          name: "Link ativo",
          token: ativo.toLowerCase(),
          channel: "redes_sociais",
          active: true,
        },
        {
          clinic_id: clinicaA,
          name: "Link inativo",
          token: inativo,
          channel: "redes_sociais",
          active: false,
        },
        {
          clinic_id: clinicaB,
          name: "Link da B",
          token: daB,
          channel: "redes_sociais",
          active: true,
        },
      ])
      .throwOnError();
    expect(
      (await registrar({ chave: chaveA, codigo: ativo, gclid: "g" })).data,
    ).toBe("codigo_reservado");
    expect(
      (await registrar({ chave: chaveA, codigo: inativo, gclid: "g" })).data,
    ).toBe("codigo_reservado");
    // token de outra clinica nao reserva
    await registrarOk({ chave: chaveA, codigo: daB, gclid: "g" });
  });

  it("dado fora do formato: 22023 (a rota valida antes)", async () => {
    const casos: Clique[] = [
      { chave: chaveA, codigo: "k7q2my", gclid: "g" },
      { chave: chaveA, codigo: "K7Q2M0", gclid: "g" },
      { chave: chaveA, codigo: "K7Q2M", gclid: "g" },
      { chave: chaveA, codigo: codigoNovo() },
      { chave: chaveA, codigo: codigoNovo(), campanha: "12a" },
      { chave: chaveA, codigo: codigoNovo(), grupo: "x" },
      { chave: chaveA, codigo: codigoNovo(), gclid: "tem espaco" },
      { chave: chaveA, codigo: codigoNovo(), gclid: "a".repeat(513) },
      { chave: chaveA, codigo: codigoNovo(), gadSource: "<x>" },
    ];
    for (const caso of casos) {
      const { error } = await registrar(caso);
      expect(error?.code).toBe("22023");
    }
    // so o wbraid (iPhone) basta; gclid de 512 passa; host invalido vira nulo
    await registrarOk({
      chave: chaveA,
      codigo: codigoNovo(),
      wbraid: "wbraid-so",
    });
    await registrarOk({
      chave: chaveA,
      codigo: codigoNovo(),
      gclid: "a".repeat(512),
    });
    const cod = codigoNovo();
    await registrarOk({
      chave: chaveA,
      codigo: cod,
      campanha: "555",
      host: "exa mple.com/caminho",
    });
    expect((await cliqueGravado(clinicaA, cod))!.site_host).toBeNull();
  });

  it("chave trocada: a velha da chave_invalida, a nova grava e o rastreio segue ligado", async () => {
    const clinica = await novaClinica("Troca");
    const velha = await ligarRastreio(clinica);
    const { data: nova, error } = await admin.rpc("trocar_chave_do_rastreio", {
      p_clinic_id: clinica,
    });
    expect(error).toBeNull();
    expect(nova).toMatch(/^[0-9a-f]{20}$/);
    expect(nova).not.toBe(velha);
    const cod = codigoNovo();
    expect(
      (await registrar({ chave: velha, codigo: cod, gclid: "g" })).data,
    ).toBe("chave_invalida");
    await registrarOk({ chave: nova as string, codigo: cod, gclid: "g" });
    const { data: rastreio } = await admin
      .from("rastreio_do_site")
      .select("ativo, chave")
      .eq("clinic_id", clinica)
      .single()
      .throwOnError();
    expect(rastreio).toEqual({ ativo: true, chave: nova });
  });

  it("limite por minuto: 30 passam, o 31o volta limite (o repetido continua duplicado)", async () => {
    const clinica = await novaClinica("Minuto");
    const chave = await ligarRastreio(clinica);
    const codigos = Array.from({ length: 31 }, () => codigoNovo());
    for (const cod of codigos.slice(0, 30)) {
      await registrarOk({ chave, codigo: cod, gclid: "g" });
    }
    expect(
      (await registrar({ chave, codigo: codigos[30]!, gclid: "g" })).data,
    ).toBe("limite");
    expect(
      (await registrar({ chave, codigo: codigos[0]!, gclid: "g" })).data,
    ).toBe("duplicado");
    const { count } = await admin
      .from("clique_do_site")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica)
      .throwOnError();
    expect(count).toBe(30);
  });

  it("teto de 2.000 vivos: cheio, o novo entra e sai o que vence primeiro; vencido, casado e outra clinica ficam; a troca de chave segue gravando", async () => {
    const clinica = await novaClinica("Vivos");
    const outra = await novaClinica("VivosOutra");
    const chave = await ligarRastreio(clinica);
    const agora = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    // 1.999 vivos, um por segundo a partir de 2 minutos atras (fora do
    // limite por minuto): codigo(6998) vence primeiro, depois codigo(6997)
    const linhas = Array.from({ length: 1999 }, (_, i) => {
      const criado = agora - 120_000 - i * 1000;
      return {
        clinic_id: clinica,
        codigo: codigo(5000 + i),
        criado_em: iso(criado),
        valido_ate: iso(criado + 7 * DIA),
        gclid: "g-v",
      };
    });
    for (let i = 0; i < linhas.length; i += 500) {
      await admin
        .from("clique_do_site")
        .insert(linhas.slice(i, i + 500))
        .throwOnError();
    }
    // vencido ha 1 hora, casado ainda no prazo e vivo de outra clinica:
    // os tres vencem antes de todos os vivos da clinica
    await cliqueAntigo(clinica, {
      codigo: codigo(7001),
      criado_em: iso(agora - 7 * DIA - 3_600_000),
      valido_ate: iso(agora - 3_600_000),
      gclid: "g-vencido",
    });
    const ct = await contato(clinica);
    await cliqueAntigo(clinica, {
      codigo: codigo(7002),
      criado_em: iso(agora - 3 * DIA),
      valido_ate: iso(agora + 4 * DIA),
      gclid: "g-casado",
      contact_id: ct,
      casado_em: iso(agora - 3 * DIA),
    });
    await cliqueAntigo(outra, {
      codigo: codigo(7005),
      criado_em: iso(agora - 6 * DIA),
      valido_ate: iso(agora + DIA),
      gclid: "g-outra",
    });

    const vivos = async () => {
      const { count } = await admin
        .from("clique_do_site")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinica)
        .is("contact_id", null)
        .gt("valido_ate", new Date().toISOString())
        .throwOnError();
      return count;
    };
    const preCarregados = async () => {
      const { count } = await admin
        .from("clique_do_site")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinica)
        .eq("gclid", "g-v")
        .throwOnError();
      return count;
    };

    // com 1.999 o clique 2.000 entra e ninguem sai
    await registrarOk({ chave, codigo: codigo(9001), gclid: "g" });
    expect(await vivos()).toBe(2000);
    expect(await preCarregados()).toBe(1999);

    // cheio: o novo entra (nunca limite) e sai so o que vence primeiro
    await registrarOk({ chave, codigo: codigo(9002), gclid: "g" });
    expect(await vivos()).toBe(2000);
    expect(await cliqueGravado(clinica, codigo(6998))).toBeNull();
    expect(await cliqueGravado(clinica, codigo(6997))).not.toBeNull();
    expect(await cliqueGravado(clinica, codigo(9001))).not.toBeNull();
    expect(await cliqueGravado(clinica, codigo(7001))).toMatchObject({
      contact_id: null,
    });
    expect(await cliqueGravado(clinica, codigo(7002))).toMatchObject({
      contact_id: ct,
    });
    expect(await cliqueGravado(outra, codigo(7005))).not.toBeNull();

    // troca de chave com o teto cheio: a velha da chave_invalida, a nova grava
    const { data: nova, error } = await admin.rpc("trocar_chave_do_rastreio", {
      p_clinic_id: clinica,
    });
    expect(error).toBeNull();
    expect(
      (await registrar({ chave, codigo: codigo(9003), gclid: "g" })).data,
    ).toBe("chave_invalida");
    await registrarOk({
      chave: nova as string,
      codigo: codigo(9003),
      gclid: "g",
    });
    expect(await vivos()).toBe(2000);
    expect(await cliqueGravado(clinica, codigo(6997))).toBeNull();
  });
});

describe("casar_clique_do_site", () => {
  it("contato sem origem: origem_gravada com campanha e grupo do Google; repetir so vincula", async () => {
    const cod = codigoNovo();
    await registrarOk({
      chave: chaveA,
      codigo: cod,
      gclid: "g",
      campanha: "321",
      grupo: "654",
    });
    const ct = await contato(clinicaA);
    expect(await casar(clinicaA, ct, cod)).toBe("origem_gravada");
    expect(await origemDoContato(ct)).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_medium: null,
      source_campaign: null,
      source_method: "clique_site",
      source_google_campaign_id: "321",
      source_google_adgroup_id: "654",
    });
    const clique = await cliqueGravado(clinicaA, cod);
    expect(clique!.contact_id).toBe(ct);
    expect(clique!.casado_em).not.toBeNull();
    // reentrega da mesma mensagem
    expect(await casar(clinicaA, ct, cod)).toBe("vinculado");
    // o codigo casado nunca volta a ser registrado
    expect(
      (await registrar({ chave: chaveA, codigo: cod, gclid: "g" })).data,
    ).toBe("duplicado");
  });

  it("codigo ja usado por outro contato: nao_achado, nada muda", async () => {
    const cod = codigoNovo();
    await registrarOk({ chave: chaveA, codigo: cod, gclid: "g" });
    const primeiro = await contato(clinicaA);
    const segundo = await contato(clinicaA);
    expect(await casar(clinicaA, primeiro, cod)).toBe("origem_gravada");
    expect(await casar(clinicaA, segundo, cod)).toBe("nao_achado");
    expect((await origemDoContato(segundo)).source_channel).toBeNull();
    expect((await cliqueGravado(clinicaA, cod))!.contact_id).toBe(primeiro);
  });

  it("codigo da clinica A na B (e contato de outra clinica): nao_achado", async () => {
    const cod = codigoNovo();
    await registrarOk({
      chave: chaveA,
      codigo: cod,
      gclid: "g",
      campanha: "999",
    });
    const daB = await contato(clinicaB);
    const daA = await contato(clinicaA);
    expect(await casar(clinicaB, daB, cod)).toBe("nao_achado");
    expect(await casar(clinicaB, daA, cod)).toBe("nao_achado");
    expect(await casar(clinicaA, daB, cod)).toBe("nao_achado");
    expect((await cliqueGravado(clinicaA, cod))!.contact_id).toBeNull();
    expect((await origemDoContato(daB)).source_channel).toBeNull();
    // contraprova: na propria clinica casa
    expect(await casar(clinicaA, daA, cod)).toBe("origem_gravada");
  });

  it("prazo vencido: expirado, o clique continua livre e o contato sem origem", async () => {
    const cod = codigoNovo();
    const agora = Date.now();
    await cliqueAntigo(clinicaA, {
      codigo: cod,
      // Validade maxima e 7 dias (check clique_do_site_validade): criado ha
      // 7 dias, venceu ha 1 minuto.
      criado_em: new Date(agora - 7 * DIA).toISOString(),
      valido_ate: new Date(agora - 60_000).toISOString(),
      gclid: "g-exp",
    });
    const ct = await contato(clinicaA);
    expect(await casar(clinicaA, ct, cod)).toBe("expirado");
    expect((await origemDoContato(ct)).source_channel).toBeNull();
    const clique = await cliqueGravado(clinicaA, cod);
    // o motor pode ter podado? Nao: vencido ha 1 minuto (a poda espera 1 dia)
    expect(clique!.contact_id).toBeNull();
  });

  it("codigo em minusculas e com espaco casa; fora do formato e nao_achado", async () => {
    const cod = codigoNovo();
    await registrarOk({ chave: chaveA, codigo: cod, gclid: "g" });
    const ct = await contato(clinicaA);
    expect(await casar(clinicaA, ct, "XX")).toBe("nao_achado");
    expect(await casar(clinicaA, ct, ` ${cod.toLowerCase()} `)).toBe(
      "origem_gravada",
    );
  });

  it("contato com origem, campanha em texto, metodo ou sinal da Meta: so o vinculo", async () => {
    const casos: Record<string, unknown>[] = [
      { source_channel: "indicacao", source_method: "manual" },
      { ctwa_clid: `clid-${sufixo}`, source_ad_id: "7006" },
      { source_ad_id: "7007" },
      { source_method: "importacao" },
      { source_campaign: "Lista antiga" },
      { source_campaign_id: "8010" },
    ];
    for (const extras of casos) {
      const cod = codigoNovo();
      await registrarOk({
        chave: chaveA,
        codigo: cod,
        gclid: "g",
        campanha: "111",
      });
      const ct = await contato(clinicaA, extras);
      const antes = await origemDoContato(ct);
      expect(await casar(clinicaA, ct, cod)).toBe("vinculado");
      expect(await origemDoContato(ct)).toEqual(antes);
      expect((await cliqueGravado(clinicaA, cod))!.contact_id).toBe(ct);
    }
  });

  it("o primeiro casamento vence e a origem do clique e imutavel", async () => {
    const primeiro = codigoNovo();
    const segundo = codigoNovo();
    await registrarOk({
      chave: chaveA,
      codigo: primeiro,
      gclid: "g",
      campanha: "201",
    });
    await registrarOk({
      chave: chaveA,
      codigo: segundo,
      gclid: "g",
      campanha: "202",
    });
    const ct = await contato(clinicaA);
    expect(await casar(clinicaA, ct, primeiro)).toBe("origem_gravada");
    expect(await casar(clinicaA, ct, segundo)).toBe("vinculado");
    expect((await origemDoContato(ct)).source_google_campaign_id).toBe("201");
    // nem o sistema troca
    for (const campos of [
      { source_origin: "Meta" },
      { source_method: "manual" },
      { source_google_campaign_id: "1" },
      { source_google_adgroup_id: "1" },
    ]) {
      const { error } = await admin.from("contact").update(campos).eq("id", ct);
      expect(error?.code).toBe("P0001");
    }
  });

  it("sem clinica ou sem contato: 22023", async () => {
    const ct = await contato(clinicaA);
    const semClinica = await admin.rpc("casar_clique_do_site", {
      p_clinic_id: null,
      p_contact_id: ct,
      p_codigo: "K7Q2MX",
    });
    expect(semClinica.error?.code).toBe("22023");
    const semContato = await admin.rpc("casar_clique_do_site", {
      p_clinic_id: clinicaA,
      p_contact_id: null,
      p_codigo: "K7Q2MX",
    });
    expect(semContato.error?.code).toBe("22023");
  });
});

describe("coerencia da origem de clique no site (sistema)", () => {
  it("clique_site so com Trafego pago, Google, sem meio e sem campanha em texto; ids so com clique_site", async () => {
    const base = {
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_method: "clique_site",
    };
    const recusados: Record<string, unknown>[] = [
      { ...base, source_channel: null },
      { ...base, source_channel: "redes_sociais" },
      { ...base, source_origin: "Meta" },
      { ...base, source_origin: "google" },
      { ...base, source_origin: null },
      { ...base, source_medium: "cpc" },
      { ...base, source_campaign: "Campanha" },
      { ...base, source_google_campaign_id: "abc" },
      { ...base, source_google_campaign_id: "1".repeat(21) },
      {
        source_channel: "trafego_pago",
        source_origin: "Google",
        source_method: "manual",
        source_google_campaign_id: "123",
      },
      { source_google_adgroup_id: "456" },
    ];
    for (const extras of recusados) {
      telefone += 1;
      const { error } = await admin.from("contact").insert({
        clinic_id: clinicaA,
        phone_e164: `+55849798${String(telefone).padStart(5, "0")}`,
        name: "Recusado",
        ...extras,
      });
      expect(error?.code).toBe("23514");
    }
    // contraprova
    await contato(clinicaA, {
      ...base,
      source_google_campaign_id: "9".repeat(20),
      source_google_adgroup_id: "456",
    });
    await contato(clinicaA, base);
  });
});

describe("podar_cliques_do_site", () => {
  it("nao casado sai 1 dia depois de vencer; casado perde os identificadores aos 90 dias", async () => {
    const clinica = await novaClinica("Poda");
    const outra = await novaClinica("PodaOutra");
    const agora = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const [k1, k2, k3] = [
      await contato(clinica),
      await contato(clinica),
      await contato(clinica),
    ];
    await cliqueAntigo(clinica, {
      codigo: "PQA234",
      criado_em: iso(agora - 8 * DIA - 60_000),
      valido_ate: iso(agora - DIA - 60_000),
      gclid: "g",
    });
    await cliqueAntigo(clinica, {
      codigo: "PQB234",
      criado_em: iso(agora - 8 * DIA + 3_600_000),
      valido_ate: iso(agora - DIA + 3_600_000),
      gclid: "g",
    });
    await cliqueAntigo(clinica, {
      codigo: "PQD234",
      criado_em: iso(agora - 91 * DIA),
      valido_ate: iso(agora - 84 * DIA),
      gclid: "g-d",
      gbraid: "gb-d",
      wbraid: "wb-d",
      google_campaign_id: "901",
      contact_id: k1,
      casado_em: iso(agora - 91 * DIA + 3_600_000),
    });
    await cliqueAntigo(clinica, {
      codigo: "PQE234",
      criado_em: iso(agora - 89 * DIA),
      valido_ate: iso(agora - 82 * DIA),
      gclid: "g-e",
      contact_id: k2,
      casado_em: iso(agora - 88 * DIA),
    });
    await cliqueAntigo(clinica, {
      codigo: "PQF234",
      criado_em: iso(agora - 91 * DIA),
      valido_ate: iso(agora - 84 * DIA),
      gad_source: "1",
      google_campaign_id: "903",
      contact_id: k3,
      casado_em: iso(agora - 90 * DIA),
    });
    await cliqueAntigo(outra, {
      codigo: "PQG234",
      criado_em: iso(agora - 9 * DIA),
      valido_ate: iso(agora - 2 * DIA),
      gclid: "g",
    });

    // data futura sem a lista: recusado
    const futura = await admin.rpc("podar_cliques_do_site", {
      p_agora: iso(agora + 30 * DIA),
    });
    expect(futura.error?.code).toBe("22023");

    const { error } = await admin.rpc("podar_cliques_do_site", {
      p_clinic_ids: [clinica],
    });
    expect(error).toBeNull();
    expect(await cliqueGravado(clinica, "PQA234")).toBeNull();
    expect(await cliqueGravado(clinica, "PQB234")).not.toBeNull();
    expect(await cliqueGravado(clinica, "PQD234")).toMatchObject({
      gclid: null,
      gbraid: null,
      wbraid: null,
      google_campaign_id: "901",
      contact_id: k1,
    });
    expect(await cliqueGravado(clinica, "PQE234")).toMatchObject({
      gclid: "g-e",
      contact_id: k2,
    });
    expect(await cliqueGravado(clinica, "PQF234")).toMatchObject({
      gad_source: "1",
      google_campaign_id: "903",
    });

    // data futura com a lista: so as clinicas da lista
    const { error: erroFuturo } = await admin.rpc("podar_cliques_do_site", {
      p_agora: iso(agora + 30 * DIA),
      p_clinic_ids: [clinica],
    });
    expect(erroFuturo).toBeNull();
    expect(await cliqueGravado(clinica, "PQB234")).toBeNull();
    expect((await cliqueGravado(clinica, "PQE234"))!.gclid).toBeNull();
    // a outra clinica: so o motor (sem lista) poda; vencida ha 2 dias, ja
    // pode ter saido pelo motor, mas nunca pela poda com a lista da primeira
    const { error: erroSemLista } = await admin.rpc(
      "podar_cliques_do_site",
      {},
    );
    expect(erroSemLista).toBeNull();
    expect(await cliqueGravado(outra, "PQG234")).toBeNull();
  });
});

describe("anon nao chega em nada", () => {
  it("42501 nas cinco funcoes e em clique_do_site", async () => {
    const anon = anonClient();
    const chamadas = [
      anon.rpc("registrar_clique_do_site", {
        p_chave: chaveA,
        p_codigo: codigoNovo(),
        p_gclid: "g",
      }),
      anon.rpc("casar_clique_do_site", {
        p_clinic_id: clinicaA,
        p_contact_id: clinicaA,
        p_codigo: "K7Q2MX",
      }),
      anon.rpc("podar_cliques_do_site", {}),
      anon.rpc("trocar_chave_do_rastreio", { p_clinic_id: clinicaA }),
      anon.rpc("situacao_do_rastreio", { p_clinic_id: clinicaA }),
      anon.from("clique_do_site").select("gclid"),
      anon.from("rastreio_do_site").select("chave"),
    ];
    for (const chamada of chamadas) {
      const { error } = await chamada;
      expect(error?.code).toBe("42501");
    }
    // contraprova: a chave da A continua a mesma
    const { data } = await admin
      .from("rastreio_do_site")
      .select("chave")
      .eq("clinic_id", clinicaA)
      .single()
      .throwOnError();
    expect(data!.chave).toBe(chaveA);
    expect(chaveB).toMatch(/^[0-9a-f]{20}$/);
  });
});

// Frases do rastreio (migration 20261005110000), com o cliente de servico:
// - a linha nasce com a frase de fabrica (tambem a criada pela troca de
//   chave); frases_do_rastreio (o que a rota publica GET chama) devolve as
//   frases na ordem gravada, so com o rastreio ligado e a chave certa;
//   desligado, chave inexistente ou fora do formato: null (a rota responde
//   sem corpo e o script cai no padrao);
// - check: de 1 a 5 frases, cada uma de 1 a 300 caracteres (sem contar so
//   espacos), sem quebra de linha, caractere de controle, colchete ou
//   cerquilha (23514);
// - anon: 42501.
// Mesmos cenarios do ensaio (scratchpad/google/banco-frases/asserts.sql).
// Clinicas proprias (nao mexe nas da suite da F1).

const FRASE_DE_FABRICA =
  "Olá! Vim pelo site e gostaria de agendar uma consulta.";

async function frasesPelaChave(chave: string): Promise<string[] | null> {
  const { data, error } = await admin.rpc("frases_do_rastreio", {
    p_chave: chave,
  });
  expect(error).toBeNull();
  return data ?? null;
}

async function frasesGravadas(clinicId: string): Promise<string[] | null> {
  const { data } = await admin
    .from("rastreio_do_site")
    .select("frases")
    .eq("clinic_id", clinicId)
    .maybeSingle()
    .throwOnError();
  return data?.frases ?? null;
}

async function gravarFrases(clinicId: string, frases: string[]) {
  return admin
    .from("rastreio_do_site")
    .update({ frases })
    .eq("clinic_id", clinicId);
}

describe("frases_do_rastreio", () => {
  it("a linha nova nasce com a frase de fabrica e a rota le as frases pela chave, na ordem", async () => {
    const clinica = await novaClinica("Frases1");
    const chave = await ligarRastreio(clinica);
    expect(await frasesGravadas(clinica)).toEqual([FRASE_DE_FABRICA]);
    expect(await frasesPelaChave(chave)).toEqual([FRASE_DE_FABRICA]);

    const frases = [
      "Oi! Vim pelo site. Quero agendar uma avaliação, tudo bem?",
      "Olá! Gostaria de marcar uma consulta (pode ser à tarde).",
      "Bom dia! Vim pelo site e quero saber os horários.",
    ];
    const { error } = await gravarFrases(clinica, frases);
    expect(error).toBeNull();
    expect(await frasesPelaChave(chave)).toEqual(frases);
  });

  it("desligado, chave inexistente ou fora do formato: null (a rota cai no padrao)", async () => {
    const clinica = await novaClinica("Frases2");
    const chave = await ligarRastreio(clinica);
    await gravarFrases(clinica, ["Frase da clínica."]).then(({ error }) =>
      expect(error).toBeNull(),
    );

    await admin
      .from("rastreio_do_site")
      .update({ ativo: false })
      .eq("clinic_id", clinica)
      .throwOnError();
    expect(await frasesPelaChave(chave)).toBeNull();
    await admin
      .from("rastreio_do_site")
      .update({ ativo: true })
      .eq("clinic_id", clinica)
      .throwOnError();
    expect(await frasesPelaChave(chave)).toEqual(["Frase da clínica."]);

    // inexistente no formato (troca um caractere da chave real)
    const inexistente = chave.slice(0, 19) + (chave.endsWith("0") ? "1" : "0");
    expect(await frasesPelaChave(inexistente)).toBeNull();
    // fora do formato, mesmo parecida com a chave real
    const foraDoFormato = [
      chave.toUpperCase(),
      ` ${chave}`,
      `${chave} `,
      `${chave}\n`,
      chave.slice(0, 19),
      `${chave}0`,
      `${chave.slice(0, 19)}%`,
      "%",
      "",
    ].filter((variante) => variante !== chave);
    for (const variante of foraDoFormato) {
      expect(await frasesPelaChave(variante)).toBeNull();
    }
  });

  it("chave trocada: a velha null, a nova as frases; cada chave so as frases da propria clinica", async () => {
    const clinica = await novaClinica("Frases3");
    const outra = await novaClinica("Frases4");
    const chave = await ligarRastreio(clinica);
    const chaveDaOutra = await ligarRastreio(outra);
    await gravarFrases(clinica, ["Frase da primeira."]).then(({ error }) =>
      expect(error).toBeNull(),
    );
    await gravarFrases(outra, ["Frase da outra."]).then(({ error }) =>
      expect(error).toBeNull(),
    );
    expect(await frasesPelaChave(chaveDaOutra)).toEqual(["Frase da outra."]);

    const { data: nova, error } = await admin.rpc("trocar_chave_do_rastreio", {
      p_clinic_id: clinica,
    });
    expect(error).toBeNull();
    expect(nova).toMatch(/^[0-9a-f]{20}$/);
    expect(await frasesPelaChave(chave)).toBeNull();
    expect(await frasesPelaChave(nova as string)).toEqual([
      "Frase da primeira.",
    ]);
    expect(await frasesPelaChave(chaveDaOutra)).toEqual(["Frase da outra."]);
  });

  it("a troca de chave sem linha cria desligada com a frase de fabrica (e a rota nao le)", async () => {
    const clinica = await novaClinica("Frases5");
    const { data: chave, error } = await admin.rpc("trocar_chave_do_rastreio", {
      p_clinic_id: clinica,
    });
    expect(error).toBeNull();
    expect(await frasesGravadas(clinica)).toEqual([FRASE_DE_FABRICA]);
    expect(await frasesPelaChave(chave as string)).toBeNull();
  });

  it("check: de 1 a 5 frases, de 1 a 300 caracteres, sem quebra, controle, colchete ou cerquilha (23514)", async () => {
    const clinica = await novaClinica("Frases6");
    await ligarRastreio(clinica);
    const recusadas: string[][] = [
      [],
      ["1", "2", "3", "4", "5", "6"],
      [""],
      ["   "],
      ["Oi.", " "],
      ["a".repeat(301)],
      ["Oi.", "é".repeat(301)],
      [` ${"a".repeat(300)}`],
      ["Oi!\nQuero agendar."],
      ["Oi.", "Quero\nagendar."],
      ["Oi.\n"],
      ["Oi!\r\nQuero agendar."],
      ["Oi!\tQuero agendar."],
      ["Oi! Quero agendar."],
      ["Oi! Quero agendar."],
      ["Oi!\u0085Quero agendar."],
      ["Oi!\u007f"],
      ["\u0001Oi!"],
      ["Olá [site"],
      ["Olá site]"],
      ["Oi.", "Agende pelo #AGENDA"],
      ["Olá! [#K7Q2MX]"],
    ];
    for (const frases of recusadas) {
      const { error } = await gravarFrases(clinica, frases);
      expect(error?.code).toBe("23514");
    }
    expect(await frasesGravadas(clinica)).toEqual([FRASE_DE_FABRICA]);

    // contraprovas: 5 de exatamente 300 (acento e emoji contam 1); varias
    // sentencas e pontuacao; espaco nas pontas dentro dos 300; 1 caractere
    const aceitas: string[][] = [
      [
        "a".repeat(300),
        "é".repeat(300),
        "😊".repeat(300),
        "Olá. ".repeat(60),
        "Oi! Vim pelo site.".padEnd(300, "!"),
      ],
      [
        "Olá! Vim pelo site. Quero agendar uma avaliação, tudo bem? Obrigado (até logo): 10% \"já\"; é 'urgente'.",
      ],
      [" Oi! Quero agendar. ", "a"],
    ];
    for (const frases of aceitas) {
      const { error } = await gravarFrases(clinica, frases);
      expect(error).toBeNull();
      expect(await frasesGravadas(clinica)).toEqual(frases);
    }
  });

  it("anon: 42501 em frases_do_rastreio", async () => {
    const clinica = await novaClinica("Frases7");
    const chave = await ligarRastreio(clinica);
    const { data, error } = await anonClient().rpc("frases_do_rastreio", {
      p_chave: chave,
    });
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
    // contraprova: a service role le
    expect(await frasesPelaChave(chave)).toEqual([FRASE_DE_FABRICA]);
  });
});
