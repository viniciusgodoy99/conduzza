import { randomInt } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { TOKEN_ALPHABET, TOKEN_LENGTH } from "@/lib/domain/attribution";
import type {
  AnuncioDeOrigem,
  InboundEvent,
} from "@/lib/integrations/whatsapp/inbound";
import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Clique rastreado pelo site na INGESTAO (F1 do Google), contra o banco REAL.
// Aceite: o lead que veio do anuncio do Google pelo site da clinica chega
// com origem (Trafego pago, Google, metodo clique_site) e campanha reais,
// sem ninguem digitar nada e sem cadastro de campanha. Precedencia: anuncio
// da Meta, codigo fixo (campaign_link), clique do site, mensagem padrao,
// palavra-chave. A origem e imutavel, entao cada caso confere tambem o que
// NAO pode mudar (inclusive o clique que nao pode ser casado).
//
// Depende da migration 20261005100000_clique_do_site.sql aplicada. Os casos
// do banco isolado (registrar, casar, poda, RLS) estao em
// tests/integration/clique-do-site.test.ts e tests/rls/clique-do-site.test.ts.
//
// CUIDADO, o banco de desenvolvimento e a producao. Cada cenario usa a
// propria clinica de teste (e_de_teste = true), apagada no afterAll
// (contatos, cliques e rastreio vao junto pela cascata). Uma clinica por
// cenario tambem mantem cada um longe do limite de 30 cliques por minuto.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
const DIA = 86_400_000;

const CAMPANHA_GOOGLE = "21987654321";
const GRUPO_GOOGLE = "16543210987";

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;

/** Codigo aleatorio no alfabeto do token (o script do site faz o mesmo). */
function codigoNovo(): string {
  let codigo = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    codigo += TOKEN_ALPHABET.charAt(randomInt(TOKEN_ALPHABET.length));
  }
  return codigo;
}

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `CliqueIngestao ${nome} ${sufixo}`,
      slug: `clique-ing-${nome}-${sufixo}`,
      e_de_teste: true,
      timezone: "America/Fortaleza",
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  // Conversa exige numero de WhatsApp (contrato da Fase 3).
  await criarNumeroDeTeste(admin, clinicId);
  return clinicId;
}

/** Rastreio do site ligado, criado pelo sistema; devolve a chave do banco. */
async function ligarRastreio(clinicId: string): Promise<string> {
  const { data } = await admin
    .from("rastreio_do_site")
    .insert({ clinic_id: clinicId, ativo: true })
    .select("chave")
    .single()
    .throwOnError();
  return data!.chave as string;
}

/**
 * Clique do anuncio pelo caminho da rota publica (registrar_clique_do_site
 * com a service role), com gclid, campanha e grupo. Devolve o codigo.
 */
async function registrarClique(chave: string): Promise<string> {
  const codigo = codigoNovo();
  const { data, error } = await admin.rpc("registrar_clique_do_site", {
    p_chave: chave,
    p_codigo: codigo,
    p_gclid: `Cj0KCQjw-teste_${sufixo}`,
    p_gbraid: null,
    p_wbraid: null,
    p_gad_source: "1",
    p_google_campaign_id: CAMPANHA_GOOGLE,
    p_google_adgroup_id: GRUPO_GOOGLE,
    p_site_host: "clinica-exemplo.com.br",
  });
  expect(error).toBeNull();
  expect(data).toBe("ok");
  return codigo;
}

/** Clique vencido ha uma hora (ainda nao podado: a poda e 1 dia depois). */
async function registrarCliqueVencido(clinicId: string): Promise<string> {
  const codigo = codigoNovo();
  const agora = Date.now();
  await admin
    .from("clique_do_site")
    .insert({
      clinic_id: clinicId,
      codigo,
      criado_em: new Date(agora - 7 * DIA - 3_600_000).toISOString(),
      valido_ate: new Date(agora - 3_600_000).toISOString(),
      gclid: `Cj0KCQjw-vencido_${sufixo}`,
      google_campaign_id: CAMPANHA_GOOGLE,
    })
    .throwOnError();
  return codigo;
}

async function criarContato(
  clinicId: string,
  telefone: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Contato Clique",
      ...extras,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function origemDe(contactId: string) {
  const { data } = await admin
    .from("contact")
    .select(
      "ctwa_clid, source_ad_id, source_campaign_id, source_channel, source_origin, source_medium, source_campaign, source_method, source_captured_at, source_google_campaign_id, source_google_adgroup_id",
    )
    .eq("id", contactId)
    .single()
    .throwOnError();
  return data!;
}

async function cliqueDe(clinicId: string, codigo: string) {
  const { data } = await admin
    .from("clique_do_site")
    .select("contact_id, casado_em")
    .eq("clinic_id", clinicId)
    .eq("codigo", codigo)
    .single()
    .throwOnError();
  return data!;
}

function evento(
  telefone: string,
  waMessageId: string,
  corpo: string,
  anuncio: AnuncioDeOrigem | null = null,
): MensagemRecebida {
  return {
    kind: "message_received",
    phone: telefone,
    name: "Paciente Clique",
    waMessageId,
    contentType: "texto",
    body: corpo,
    mediaUrl: null,
    mediaFilename: null,
    mediaMimetype: null,
    quotedWaMessageId: null,
    anuncio,
    instanceToken: null,
  };
}

async function ingerir(clinicId: string, mensagem: MensagemRecebida) {
  const resultado = await ingerirMensagemRecebida(
    admin,
    clinicId,
    null,
    mensagem,
  );
  expect(resultado.error).toBeNull();
  return resultado.data!;
}

afterAll(async () => {
  if (clinicasCriadas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicasCriadas);
  }
});

describe("clique do site na ingestão", () => {
  it("lead do anúncio do Google pelo site chega com origem e campanha reais, sem campanha cadastrada", async () => {
    const clinicId = await criarClinica("aceite");
    const codigo = await registrarClique(await ligarRastreio(clinicId));

    const data = await ingerir(
      clinicId,
      evento(
        "+5584976660001",
        `clq-1-${sufixo}`,
        `Olá! Quero agendar uma avaliação [#${codigo.toLowerCase()}]`,
      ),
    );
    expect(data.contact_created).toBe(true);

    const origem = await origemDe(data.contact_id!);
    expect(origem).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_medium: null,
      source_campaign: null,
      source_method: "clique_site",
      source_google_campaign_id: CAMPANHA_GOOGLE,
      source_google_adgroup_id: GRUPO_GOOGLE,
      // O Google nunca grava as colunas da Meta.
      ctwa_clid: null,
      source_ad_id: null,
      source_campaign_id: null,
    });
    expect(origem.source_captured_at).not.toBeNull();

    const clique = await cliqueDe(clinicId, codigo);
    expect(clique.contact_id).toBe(data.contact_id);
    expect(clique.casado_em).not.toBeNull();
  });

  it("o clique vem antes da palavra-chave", async () => {
    const clinicId = await criarClinica("antesdapalavra");
    await admin
      .from("campaign_link")
      .insert({
        clinic_id: clinicId,
        name: "Palavra agendar",
        channel: "busca_organica",
        keywords: ["agendar"],
      })
      .throwOnError();
    const codigo = await registrarClique(await ligarRastreio(clinicId));

    const data = await ingerir(
      clinicId,
      evento("+5584976660002", `clq-2-${sufixo}`, `quero agendar [#${codigo}]`),
    );

    expect(await origemDe(data.contact_id!)).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_method: "clique_site",
    });
  });

  it("código fixo de campaign_link vence o clique na mesma mensagem", async () => {
    const clinicId = await criarClinica("fixovence");
    await admin
      .from("campaign_link")
      .insert({
        clinic_id: clinicId,
        name: "Botox Outubro",
        token: "C7K3F9",
        channel: "redes_sociais",
        campaign: "Botox Outubro",
      })
      .throwOnError();
    const codigo = await registrarClique(await ligarRastreio(clinicId));

    const data = await ingerir(
      clinicId,
      evento(
        "+5584976660003",
        `clq-3-${sufixo}`,
        `Quero agendar [#${codigo}] [#C7K3F9]`,
      ),
    );

    expect(await origemDe(data.contact_id!)).toMatchObject({
      source_channel: "redes_sociais",
      source_method: "link_token",
      source_campaign: "Botox Outubro",
      source_google_campaign_id: null,
      source_google_adgroup_id: null,
    });
    // Nem o vinculo: o casamento nao e chamado quando ha codigo fixo.
    const clique = await cliqueDe(clinicId, codigo);
    expect(clique.contact_id).toBeNull();
    expect(clique.casado_em).toBeNull();
  });

  it("anúncio da Meta vence: a origem fica Meta e o clique só é vinculado", async () => {
    const clinicId = await criarClinica("metavence");
    const codigo = await registrarClique(await ligarRastreio(clinicId));
    const anuncio: AnuncioDeOrigem = {
      ctwaClid: `Af-CLIQUE-${sufixo}`,
      adId: "120240624148610289",
      adsetId: null,
      campaignId: null,
      sourceUrl: "https://fb.me/abcXYZ",
      plataforma: "Instagram",
      tipo: "ad",
      chavesVistas: { anuncio: ["ctwaClid"], contexto: [] },
    };

    const data = await ingerir(
      clinicId,
      evento(
        "+5584976660004",
        `clq-4-${sufixo}`,
        `Quero agendar [#${codigo}]`,
        anuncio,
      ),
    );

    expect(await origemDe(data.contact_id!)).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_google_campaign_id: null,
      source_google_adgroup_id: null,
    });
    expect((await cliqueDe(clinicId, codigo)).contact_id).toBe(data.contact_id);
  });

  it("contato com origem manual só ganha o vínculo com o clique", async () => {
    const clinicId = await criarClinica("manual");
    const telefone = "+5584976660005";
    const capturadaEm = "2026-09-01T10:00:00+00:00";
    const contatoId = await criarContato(clinicId, telefone, {
      source_channel: "indicacao",
      source_method: "manual",
      source_captured_at: capturadaEm,
    });
    const codigo = await registrarClique(await ligarRastreio(clinicId));

    const data = await ingerir(
      clinicId,
      evento(telefone, `clq-5-${sufixo}`, `Vi no site [#${codigo}]`),
    );
    expect(data.contact_created).toBe(false);

    const origem = await origemDe(contatoId);
    expect(origem).toMatchObject({
      source_channel: "indicacao",
      source_method: "manual",
      source_origin: null,
      source_google_campaign_id: null,
    });
    expect(Date.parse(origem.source_captured_at as string)).toBe(
      Date.parse(capturadaEm),
    );
    expect((await cliqueDe(clinicId, codigo)).contact_id).toBe(contatoId);
  });

  it("contato antigo sem origem ganha a origem do clique numa mensagem posterior", async () => {
    const clinicId = await criarClinica("tardio");
    const telefone = "+5584976660006";
    const codigo = await registrarClique(await ligarRastreio(clinicId));

    const primeira = await ingerir(
      clinicId,
      evento(telefone, `clq-6a-${sufixo}`, "Oi, tudo bem?"),
    );
    expect((await origemDe(primeira.contact_id!)).source_channel).toBeNull();

    const segunda = await ingerir(
      clinicId,
      evento(telefone, `clq-6b-${sufixo}`, `Voltei pelo site [#${codigo}]`),
    );
    expect(segunda.contact_created).toBe(false);
    expect(await origemDe(primeira.contact_id!)).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Google",
      source_method: "clique_site",
      source_google_campaign_id: CAMPANHA_GOOGLE,
    });
  });

  it("clique vencido não grava nada e a palavra-chave segue valendo", async () => {
    const clinicId = await criarClinica("vencido");
    await admin
      .from("campaign_link")
      .insert({
        clinic_id: clinicId,
        name: "Palavra agendar",
        channel: "busca_organica",
        keywords: ["agendar"],
      })
      .throwOnError();
    const codigo = await registrarCliqueVencido(clinicId);

    const data = await ingerir(
      clinicId,
      evento("+5584976660007", `clq-7-${sufixo}`, `quero agendar [#${codigo}]`),
    );

    expect(await origemDe(data.contact_id!)).toMatchObject({
      source_channel: "busca_organica",
      source_method: "palavra_chave",
      source_google_campaign_id: null,
    });
    const clique = await cliqueDe(clinicId, codigo);
    expect(clique.contact_id).toBeNull();
    expect(clique.casado_em).toBeNull();
  });

  describe("mensagem padrão igual ao texto do botão do site, com o clique perdido", () => {
    const TEXTO_DO_BOTAO = "Olá! Quero agendar uma avaliação";

    /**
     * Duas campanhas sem codigo: a da palavra "avaliação" (criada antes, para
     * a ordem nao decidir nada) e a do botao do site, com a mensagem padrao.
     */
    async function criarCampanhasDoSite(clinicId: string): Promise<void> {
      const agora = Date.now();
      await admin
        .from("campaign_link")
        .insert({
          clinic_id: clinicId,
          name: "Palavra avaliação",
          channel: "redes_sociais",
          origin: "Instagram orgânico",
          keywords: ["avaliação"],
          created_at: new Date(agora - 60_000).toISOString(),
        })
        .throwOnError();
      await admin
        .from("campaign_link")
        .insert({
          clinic_id: clinicId,
          name: "Botão do site",
          channel: "busca_organica",
          origin: "Site",
          default_message: TEXTO_DO_BOTAO,
          created_at: new Date(agora).toISOString(),
        })
        .throwOnError();
    }

    it("rastreio desligado: o script põe o código, o registro diz desligado e a mensagem padrão vale (não a palavra-chave)", async () => {
      const clinicId = await criarClinica("desligado");
      await criarCampanhasDoSite(clinicId);
      const { data: rastreio } = await admin
        .from("rastreio_do_site")
        .insert({ clinic_id: clinicId, ativo: false })
        .select("chave")
        .single()
        .throwOnError();

      // O script continua no site e manda o aviso: nada e gravado.
      const codigo = codigoNovo();
      const { data: resposta, error } = await admin.rpc(
        "registrar_clique_do_site",
        {
          p_chave: rastreio!.chave as string,
          p_codigo: codigo,
          p_gclid: `Cj0KCQjw-desligado_${sufixo}`,
          p_gbraid: null,
          p_wbraid: null,
          p_gad_source: "1",
          p_google_campaign_id: CAMPANHA_GOOGLE,
          p_google_adgroup_id: GRUPO_GOOGLE,
          p_site_host: "clinica-exemplo.com.br",
        },
      );
      expect(error).toBeNull();
      expect(resposta).toBe("desligado");

      const data = await ingerir(
        clinicId,
        evento(
          "+5584976660012",
          `clq-11-${sufixo}`,
          `${TEXTO_DO_BOTAO} [#${codigo}]`,
        ),
      );
      expect(data.contact_created).toBe(true);

      expect(await origemDe(data.contact_id!)).toMatchObject({
        source_channel: "busca_organica",
        source_origin: "Site",
        source_campaign: null,
        source_method: "mensagem_padrao",
        source_google_campaign_id: null,
        source_google_adgroup_id: null,
      });
      const { data: cliques } = await admin
        .from("clique_do_site")
        .select("id")
        .eq("clinic_id", clinicId)
        .throwOnError();
      expect(cliques).toEqual([]);
    });

    it("clique vencido: a mensagem padrão vale e o clique continua sem contato", async () => {
      const clinicId = await criarClinica("vencidopadrao");
      await criarCampanhasDoSite(clinicId);
      const codigo = await registrarCliqueVencido(clinicId);

      const data = await ingerir(
        clinicId,
        evento(
          "+5584976660013",
          `clq-12-${sufixo}`,
          `${TEXTO_DO_BOTAO} [#${codigo}]`,
        ),
      );

      expect(await origemDe(data.contact_id!)).toMatchObject({
        source_channel: "busca_organica",
        source_origin: "Site",
        source_method: "mensagem_padrao",
        source_google_campaign_id: null,
      });
      const clique = await cliqueDe(clinicId, codigo);
      expect(clique.contact_id).toBeNull();
      expect(clique.casado_em).toBeNull();
    });

    it("clique vivo continua vencendo a mensagem padrão", async () => {
      const clinicId = await criarClinica("vivopadrao");
      await criarCampanhasDoSite(clinicId);
      const codigo = await registrarClique(await ligarRastreio(clinicId));

      const data = await ingerir(
        clinicId,
        evento(
          "+5584976660014",
          `clq-13-${sufixo}`,
          `${TEXTO_DO_BOTAO} [#${codigo}]`,
        ),
      );

      expect(await origemDe(data.contact_id!)).toMatchObject({
        source_channel: "trafego_pago",
        source_origin: "Google",
        source_method: "clique_site",
        source_google_campaign_id: CAMPANHA_GOOGLE,
      });
    });
  });

  it("código da clínica A não casa na clínica B", async () => {
    const clinicaA = await criarClinica("clinicaa");
    const clinicaB = await criarClinica("clinicab");
    const codigoDaA = await registrarClique(await ligarRastreio(clinicaA));

    const data = await ingerir(
      clinicaB,
      evento("+5584976660008", `clq-8-${sufixo}`, `Olá! [#${codigoDaA}]`),
    );

    expect(await origemDe(data.contact_id!)).toMatchObject({
      source_channel: null,
      source_method: null,
      source_google_campaign_id: null,
    });
    expect((await cliqueDe(clinicaA, codigoDaA)).contact_id).toBeNull();
  });

  it("código já usado não casa para outro contato (mensagem encaminhada)", async () => {
    const clinicId = await criarClinica("usado");
    const codigo = await registrarClique(await ligarRastreio(clinicId));

    const primeiro = await ingerir(
      clinicId,
      evento("+5584976660009", `clq-9a-${sufixo}`, `Olá! [#${codigo}]`),
    );
    const segundo = await ingerir(
      clinicId,
      evento("+5584976660010", `clq-9b-${sufixo}`, `Olá! [#${codigo}]`),
    );

    expect((await origemDe(primeiro.contact_id!)).source_method).toBe(
      "clique_site",
    );
    expect(await origemDe(segundo.contact_id!)).toMatchObject({
      source_channel: null,
      source_method: null,
      source_google_campaign_id: null,
    });
    expect((await cliqueDe(clinicId, codigo)).contact_id).toBe(
      primeiro.contact_id,
    );
  });

  it("reentrega do mesmo webhook não muda nada nem dá erro", async () => {
    const clinicId = await criarClinica("reentrega");
    const codigo = await registrarClique(await ligarRastreio(clinicId));
    const mensagem = evento(
      "+5584976660011",
      `clq-10-${sufixo}`,
      `Olá! [#${codigo}]`,
    );

    const primeira = await ingerir(clinicId, mensagem);
    const antes = await origemDe(primeira.contact_id!);
    const cliqueAntes = await cliqueDe(clinicId, codigo);

    const segunda = await ingerir(clinicId, mensagem);
    expect(segunda.inserted).toBe(false);
    expect(segunda.contact_id).toBe(primeira.contact_id);

    expect(await origemDe(primeira.contact_id!)).toEqual(antes);
    expect(await cliqueDe(clinicId, codigo)).toEqual(cliqueAntes);
  });
});
