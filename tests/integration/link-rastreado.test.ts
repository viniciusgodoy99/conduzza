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
      { campaign_link_id: origem.id, cliques: 1, leads: 1 },
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
    expect(resposta).toEqual({
      resultado: "sem_gravar",
      digitos: "5584977770001",
      mensagem: MENSAGEM,
      codigo_fixo: "C7K3F9",
    });
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
    expect(resposta).toEqual({
      resultado: "limite",
      digitos: "5584977770001",
      mensagem: MENSAGEM,
      codigo_fixo: "C7K3F9",
    });
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
