import { afterAll, describe, expect, it } from "vitest";

import type { InboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Link rastreado da origem (etapa 3a do plano de 16/11/2026, o link da bio
// com endereco proprio), contra o banco REAL. Aceite: o clique do link grava
// (com ou sem sinal na URL), conta no dia e devolve para onde mandar a
// pessoa; a mensagem que chega com o codigo do clique da ao lead a origem
// CADASTRADA (metodo link_token), e o resumo mostra cliques e leads.
//
// Depende da migration 20261116120000_link_rastreado.sql aplicada. RLS em
// tests/rls/clique-do-site.test.ts.
//
// CUIDADO, o banco de desenvolvimento e a producao. Cada cenario usa a
// propria clinica de teste (e_de_teste = true), apagada no afterAll.

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
const MENSAGEM = "Olá! Vi o perfil da clínica e quero agendar uma avaliação.";
const CODIGO_DO_CLIQUE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

async function criarClinica(nome: string, comNumero = true): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Link ${nome} ${sufixo}`,
      slug: `link-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  if (comNumero) {
    await criarNumeroDeTeste(admin, clinicId, {
      display_phone: "+55 (84) 97777-0001",
    });
  }
  return clinicId;
}

async function criarOrigem(
  clinicId: string,
  campos: Record<string, unknown> = {},
): Promise<{ id: string; codigoPublico: string }> {
  const { data } = await admin
    .from("campaign_link")
    .insert({
      clinic_id: clinicId,
      name: "Link da bio",
      token: "C7K3F9",
      channel: "redes_sociais",
      origin: "Instagram",
      medium: "Bio",
      campaign: "Bio novembro",
      default_message: MENSAGEM,
      ...campos,
    })
    .select("id, codigo_publico")
    .single()
    .throwOnError();
  return {
    id: data!.id as string,
    codigoPublico: data!.codigo_publico as string,
  };
}

async function clicar(
  codigoPublico: string,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { data } = await admin
    .rpc("registrar_clique_do_link", {
      p_codigo_publico: codigoPublico,
      ...extras,
    })
    .throwOnError();
  return data as Record<string, unknown>;
}

async function cliquesDe(clinicId: string) {
  const { data } = await admin
    .from("clique_do_site")
    .select(
      "codigo, via, campaign_link_id, whatsapp_account_id, utm_source, fbclid, meta_ad_id, contact_id",
    )
    .eq("clinic_id", clinicId)
    .throwOnError();
  return data ?? [];
}

function evento(
  telefone: string,
  waMessageId: string,
  corpo: string,
): MensagemRecebida {
  return {
    kind: "message_received",
    phone: telefone,
    name: "Paciente Link",
    waMessageId,
    contentType: "texto",
    body: corpo,
    mediaUrl: null,
    mediaFilename: null,
    mediaMimetype: null,
    quotedWaMessageId: null,
    anuncio: null,
    instanceToken: null,
  };
}

afterAll(async () => {
  if (clinicasCriadas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicasCriadas);
  }
});

describe("link rastreado da origem", () => {
  it("o clique grava, conta no dia e o lead ganha a origem cadastrada, com o anúncio da Meta que veio na URL", async () => {
    const clinicId = await criarClinica("aceite");
    const origem = await criarOrigem(clinicId);
    expect(origem.codigoPublico).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);

    const clique = await clicar(origem.codigoPublico, {
      p_utm_source: "instagram",
      p_utm_medium: "bio",
      p_fbclid: `IwAR0-link_${sufixo}`,
      p_meta_ad_id: "120211223344556",
    });
    expect(clique).toMatchObject({
      resultado: "ok",
      digitos: "5584977770001",
      mensagem: MENSAGEM,
      codigo_fixo: "C7K3F9",
    });
    const codigo = clique.codigo as string;
    expect(codigo).toMatch(CODIGO_DO_CLIQUE);
    expect(codigo).not.toBe("C7K3F9");

    const [linha] = await cliquesDe(clinicId);
    expect(linha).toMatchObject({
      codigo,
      via: "link",
      campaign_link_id: origem.id,
      utm_source: "instagram",
      fbclid: `IwAR0-link_${sufixo}`,
      meta_ad_id: "120211223344556",
      contact_id: null,
    });
    expect(linha?.whatsapp_account_id).not.toBeNull();

    const { data: contagem } = await admin
      .from("clique_do_link_dia")
      .select("cliques, campaign_link_id, clinic_id")
      .eq("campaign_link_id", origem.id)
      .throwOnError();
    expect(contagem).toEqual([
      { cliques: 1, campaign_link_id: origem.id, clinic_id: clinicId },
    ]);

    const resultado = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584975550001", `lnk-1-${sufixo}`, `${MENSAGEM} [#${codigo}]`),
    );
    expect(resultado.error).toBeNull();
    const { data: contato } = await admin
      .from("contact")
      .select(
        "source_channel, source_origin, source_medium, source_campaign, source_method, source_ad_id, source_google_campaign_id",
      )
      .eq("id", resultado.data!.contact_id!)
      .single()
      .throwOnError();
    // A origem do link sempre vence: as UTMs ficam no clique, como detalhe.
    expect(contato).toEqual({
      source_channel: "redes_sociais",
      source_origin: "Instagram",
      source_medium: "Bio",
      source_campaign: "Bio novembro",
      source_method: "link_token",
      source_ad_id: "120211223344556",
      source_google_campaign_id: null,
    });

    const { data: resumo } = await admin
      .rpc("resumo_dos_links_rastreados", { p_clinic_id: clinicId })
      .throwOnError();
    expect(resumo).toEqual([
      { campaign_link_id: origem.id, cliques: 1, leads: 1, provaveis: 0 },
    ]);
  });

  it("o toque na bio, sem sinal nenhum na URL, também grava e dá a origem", async () => {
    const clinicId = await criarClinica("semsinal");
    const origem = await criarOrigem(clinicId, { origin: null, medium: null });
    const clique = await clicar(origem.codigoPublico);
    expect(clique.resultado).toBe("ok");

    const resultado = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(
        "+5584975550002",
        `lnk-2-${sufixo}`,
        `${MENSAGEM} [#${String(clique.codigo).toLowerCase()}]`,
      ),
    );
    const { data: contato } = await admin
      .from("contact")
      .select("source_channel, source_origin, source_campaign, source_method")
      .eq("id", resultado.data!.contact_id!)
      .single()
      .throwOnError();
    expect(contato).toEqual({
      source_channel: "redes_sociais",
      source_origin: null,
      source_campaign: "Bio novembro",
      source_method: "link_token",
    });
  });

  it("sem gravar (robô, prévia): devolve o destino e não grava nem conta", async () => {
    const clinicId = await criarClinica("semgravar");
    const origem = await criarOrigem(clinicId);
    const resposta = await clicar(origem.codigoPublico, {
      p_gravar: false,
      p_utm_source: "instagram",
    });
    expect(resposta).toMatchObject({
      resultado: "sem_gravar",
      digitos: "5584977770001",
      mensagem: MENSAGEM,
      codigo_fixo: "C7K3F9",
    });
    expect(resposta.codigo).toBeUndefined();
    expect(await cliquesDe(clinicId)).toEqual([]);
    const { data: contagem } = await admin
      .from("clique_do_link_dia")
      .select("cliques")
      .eq("clinic_id", clinicId)
      .throwOnError();
    expect(contagem).toEqual([]);
  });

  it("link desativado, sem mensagem pronta ou que não existe: indisponível; clínica sem número: sem_numero", async () => {
    const clinicId = await criarClinica("indisponivel");
    const desativada = await criarOrigem(clinicId, { active: false });
    const semMensagem = await criarOrigem(clinicId, {
      name: "Só o código",
      token: "D8M4G2",
      default_message: null,
    });
    for (const codigoPublico of [
      desativada.codigoPublico,
      semMensagem.codigoPublico,
      "22222222",
      "FORA DO FORMATO",
    ]) {
      expect(await clicar(codigoPublico)).toEqual({ resultado: "indisponivel" });
    }

    const semNumero = await criarClinica("semnumero", false);
    const origem = await criarOrigem(semNumero);
    expect(await clicar(origem.codigoPublico)).toEqual({
      resultado: "sem_numero",
    });
    expect(await cliquesDe(clinicId)).toEqual([]);
  });

  it("o número conectado vence o principal que caiu", async () => {
    const clinicId = await criarClinica("numeros", false);
    await criarNumeroDeTeste(admin, clinicId, {
      nome: "Principal caído",
      connection_status: "desconectado",
      display_phone: "+55 (84) 97777-0002",
    });
    await criarNumeroDeTeste(admin, clinicId, {
      nome: "Recepção conectada",
      connection_status: "conectado",
      display_phone: "+55 (84) 97777-0003",
    });
    const origem = await criarOrigem(clinicId);
    expect((await clicar(origem.codigoPublico)).digitos).toBe("5584977770003");
  });

  it("no limite de 30 por minuto o destino vem do mesmo jeito, sem gravar", async () => {
    const clinicId = await criarClinica("limite");
    const origem = await criarOrigem(clinicId);
    for (let i = 0; i < 30; i += 1) {
      expect((await clicar(origem.codigoPublico)).resultado).toBe("ok");
    }
    const resposta = await clicar(origem.codigoPublico);
    expect(resposta).toMatchObject({
      resultado: "limite",
      digitos: "5584977770001",
      mensagem: MENSAGEM,
      codigo_fixo: "C7K3F9",
    });
    expect(resposta.codigo).toBeUndefined();
    expect(await cliquesDe(clinicId)).toHaveLength(30);
  });

  it("sinal fora do formato: 22023 (o redirect filtra antes)", async () => {
    const clinicId = await criarClinica("formato");
    const origem = await criarOrigem(clinicId);
    for (const extras of [
      { p_fbclid: "tem espaco" },
      { p_meta_ad_id: "12a" },
      { p_utm_source: "a".repeat(101) },
      { p_gclid: "a".repeat(513) },
    ]) {
      const { error } = await admin.rpc("registrar_clique_do_link", {
        p_codigo_publico: origem.codigoPublico,
        ...extras,
      });
      expect(error?.code).toBe("22023");
    }
  });
});

// Rodizio entre numeros (etapa 3b, migration 20261116130000).
describe("rodízio entre números do link", () => {
  it("peso 2 e peso 1 dão 20 e 10 em 30 pessoas; o número fixado do visitante volta sempre", async () => {
    const clinicId = await criarClinica("rodizio", false);
    const principal = await criarNumeroDeTeste(admin, clinicId, {
      nome: "Recepção",
      display_phone: "+55 (84) 97777-0011",
    });
    const comercial = await criarNumeroDeTeste(admin, clinicId, {
      nome: "Comercial",
      display_phone: "+55 (84) 97777-0012",
    });
    const origem = await criarOrigem(clinicId);
    await admin
      .from("campaign_link_numero")
      .insert([
        {
          clinic_id: clinicId,
          campaign_link_id: origem.id,
          whatsapp_account_id: principal.id,
          peso: 2,
        },
        {
          clinic_id: clinicId,
          campaign_link_id: origem.id,
          whatsapp_account_id: comercial.id,
          peso: 1,
        },
      ])
      .throwOnError();

    const contagem: Record<string, number> = {};
    for (let i = 0; i < 30; i += 1) {
      const clique = await clicar(origem.codigoPublico);
      expect(clique.resultado).toBe("ok");
      const digitos = String(clique.digitos);
      contagem[digitos] = (contagem[digitos] ?? 0) + 1;
      // O numero devolvido e o do destino (vai para o cookie).
      expect(clique.numero).toBe(
        digitos === "5584977770011" ? principal.id : comercial.id,
      );
    }
    expect(contagem).toEqual({ "5584977770011": 20, "5584977770012": 10 });

    const { data: entregues } = await admin
      .from("campaign_link_numero")
      .select("whatsapp_account_id, entregues")
      .eq("campaign_link_id", origem.id)
      .throwOnError();
    expect(
      Object.fromEntries(
        (entregues ?? []).map((linha) => [
          linha.whatsapp_account_id,
          linha.entregues,
        ]),
      ),
    ).toEqual({ [principal.id]: 20, [comercial.id]: 10 });

    // Robo nao entra no rodizio: recebe um numero e nao conta.
    const robo = await clicar(origem.codigoPublico, { p_gravar: false });
    expect(robo.resultado).toBe("sem_gravar");
    // O mesmo visitante (cookie) volta para o mesmo numero, mesmo com o
    // rodizio apontando para o outro; aqui ja no limite de 30 por minuto, e
    // o destino vem do mesmo jeito.
    for (const fixado of [comercial, principal, comercial]) {
      const volta = await clicar(origem.codigoPublico, {
        p_numero_fixado: fixado.id,
      });
      expect(volta).toMatchObject({ resultado: "limite", numero: fixado.id });
    }
    // Numero fixado que nao e do link (ou nem existe): vale o rodizio.
    const estranho = await clicar(origem.codigoPublico, {
      p_gravar: false,
      p_numero_fixado: "00000000-0000-4000-8000-000000000000",
    });
    expect([principal.id, comercial.id]).toContain(estranho.numero);
  });

  it("número desconectado fica de fora; todos caídos, qualquer um; nenhum escolhido serve, valem os da clínica", async () => {
    const clinicId = await criarClinica("caidos", false);
    const a = await criarNumeroDeTeste(admin, clinicId, {
      nome: "A",
      display_phone: "+55 (84) 97777-0021",
    });
    const b = await criarNumeroDeTeste(admin, clinicId, {
      nome: "B",
      display_phone: "+55 (84) 97777-0022",
    });
    // Fora do link: so entra se nenhum escolhido servir.
    const c = await criarNumeroDeTeste(admin, clinicId, {
      nome: "C",
      display_phone: "+55 (84) 97777-0023",
    });
    const origem = await criarOrigem(clinicId);
    await admin
      .from("campaign_link_numero")
      .insert(
        [a, b].map((numero) => ({
          clinic_id: clinicId,
          campaign_link_id: origem.id,
          whatsapp_account_id: numero.id,
        })),
      )
      .throwOnError();
    const destino = async (fixado?: string) =>
      (
        await clicar(origem.codigoPublico, {
          p_gravar: false,
          ...(fixado ? { p_numero_fixado: fixado } : {}),
        })
      ).numero;
    const situacao = async (id: string, connection_status: string) =>
      admin
        .from("whatsapp_account")
        .update({ connection_status })
        .eq("id", id)
        .throwOnError();

    // B caiu: mesmo fixado em B, vai para A (o unico conectado do link).
    await situacao(b.id, "desconectado");
    expect(await destino(b.id)).toBe(a.id);
    // Os dois do link cairam: qualquer um DO LINK (o fixado, se houver),
    // nunca o C, que esta conectado mas nao foi escolhido.
    await situacao(a.id, "desconectado");
    expect(await destino(b.id)).toBe(b.id);
    expect([a.id, b.id]).toContain(await destino());
    // Nenhum escolhido serve mais (sem telefone): valem os da clinica.
    await admin
      .from("whatsapp_account")
      .update({ display_phone: null })
      .in("id", [a.id, b.id])
      .throwOnError();
    expect(await destino()).toBe(c.id);
  });
});

// Casar sem o codigo (etapa 3d, migration 20261116140000).
describe("a pessoa apagou o código do link", () => {
  async function origemDoContato(contactId: string) {
    const { data } = await admin
      .from("contact")
      .select("source_channel, source_campaign, source_method, source_ad_id")
      .eq("id", contactId)
      .single()
      .throwOnError();
    return data!;
  }
  async function ingerir(clinicId: string, telefone: string, id: string, corpo: string) {
    const resultado = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(telefone, `${id}-${sufixo}`, corpo),
    );
    expect(resultado.error).toBeNull();
    return resultado.data!.contact_id!;
  }

  it("mensagem pronta sem o código: a origem vem pela mensagem e o único clique do link fica ligado ao contato (confirmado), com o anúncio da Meta", async () => {
    const clinicId = await criarClinica("reclamar");
    const origem = await criarOrigem(clinicId);
    const clique = await clicar(origem.codigoPublico, {
      p_utm_source: "instagram",
      p_meta_ad_id: "120211223344556",
    });
    expect(clique.resultado).toBe("ok");

    const contato = await ingerir(clinicId, "+5584974440001", "rec-1", MENSAGEM);
    expect(await origemDoContato(contato)).toEqual({
      source_channel: "redes_sociais",
      source_campaign: "Bio novembro",
      source_method: "mensagem_padrao",
      source_ad_id: "120211223344556",
    });
    const { data: linha } = await admin
      .from("clique_do_site")
      .select("contact_id, provavel")
      .eq("clinic_id", clinicId)
      .single()
      .throwOnError();
    expect(linha).toEqual({ contact_id: contato, provavel: false });

    const { data: resumo } = await admin
      .rpc("resumo_dos_links_rastreados", { p_clinic_id: clinicId })
      .throwOnError();
    expect(resumo).toEqual([
      { campaign_link_id: origem.id, cliques: 1, leads: 1, provaveis: 0 },
    ]);
  });

  it("contato novo sem nenhum sinal e um único clique de link nos últimos 10 minutos: origem provável, sem o anúncio", async () => {
    const clinicId = await criarClinica("janela");
    const origem = await criarOrigem(clinicId);
    await clicar(origem.codigoPublico, { p_meta_ad_id: "120211223344556" });

    const contato = await ingerir(
      clinicId,
      "+5584974440002",
      "jan-1",
      "Boa tarde, vocês atendem sábado?",
    );
    expect(await origemDoContato(contato)).toEqual({
      source_channel: "redes_sociais",
      source_campaign: "Bio novembro",
      source_method: "link_provavel",
      // O provavel nao leva o anuncio para o contato.
      source_ad_id: null,
    });
    const { data: resumo } = await admin
      .rpc("resumo_dos_links_rastreados", { p_clinic_id: clinicId })
      .throwOnError();
    expect(resumo).toEqual([
      { campaign_link_id: origem.id, cliques: 1, leads: 0, provaveis: 1 },
    ]);

    // O clique ja foi gasto: o proximo contato novo nao casa com nada.
    const outro = await ingerir(
      clinicId,
      "+5584974440003",
      "jan-2",
      "Oi, tudo bem?",
    );
    expect((await origemDoContato(outro)).source_method).toBeNull();
  });

  it("dois cliques na janela, clique velho ou de outro número: ninguém casa (na dúvida, vazio)", async () => {
    const clinicId = await criarClinica("duvida");
    const origem = await criarOrigem(clinicId);
    await clicar(origem.codigoPublico);
    await clicar(origem.codigoPublico);
    const comDois = await ingerir(
      clinicId,
      "+5584974440004",
      "duv-1",
      "Oi, quero saber dos horários",
    );
    expect((await origemDoContato(comDois)).source_method).toBeNull();
    const { data: semDono } = await admin
      .from("clique_do_site")
      .select("contact_id")
      .eq("clinic_id", clinicId)
      .throwOnError();
    expect(semDono).toEqual([{ contact_id: null }, { contact_id: null }]);

    // Um clique so, mas de 11 minutos atras: fora da janela.
    const velha = await criarClinica("velha");
    const origemVelha = await criarOrigem(velha);
    await clicar(origemVelha.codigoPublico);
    await admin
      .from("clique_do_site")
      // A validade acompanha (o check exige no maximo 7 dias depois do clique).
      .update({
        criado_em: new Date(Date.now() - 11 * 60_000).toISOString(),
        valido_ate: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      })
      .eq("clinic_id", velha)
      .throwOnError();
    const tarde = await ingerir(velha, "+5584974440005", "duv-2", "Oi, boa noite");
    expect((await origemDoContato(tarde)).source_method).toBeNull();

    // Direto na funcao: o numero que recebeu nao e o do clique.
    const { data: outroNumero } = await admin
      .rpc("casar_clique_sem_codigo", {
        p_clinic_id: clinicId,
        p_contact_id: comDois,
        p_whatsapp_account_id: "00000000-0000-4000-8000-000000000000",
      })
      .throwOnError();
    expect(outroNumero).toBe("nenhum");
  });

  it("contato que já tem origem (anúncio ou manual) não gasta o clique da janela", async () => {
    const clinicId = await criarClinica("comorigem");
    const origem = await criarOrigem(clinicId);
    await clicar(origem.codigoPublico);
    const { data: contato } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: "+5584974440006",
        name: "Já tem origem",
        source_channel: "indicacao",
        source_method: "manual",
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: numero } = await admin
      .from("whatsapp_account")
      .select("id")
      .eq("clinic_id", clinicId)
      .single()
      .throwOnError();
    const { data: resposta } = await admin
      .rpc("casar_clique_sem_codigo", {
        p_clinic_id: clinicId,
        p_contact_id: contato!.id,
        p_whatsapp_account_id: numero!.id,
      })
      .throwOnError();
    expect(resposta).toBe("nenhum");
    const { data: linha } = await admin
      .from("clique_do_site")
      .select("contact_id")
      .eq("clinic_id", clinicId)
      .single()
      .throwOnError();
    expect(linha).toEqual({ contact_id: null });
  });
});
