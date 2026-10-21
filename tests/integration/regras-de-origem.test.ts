import { afterAll, describe, expect, it } from "vitest";

import type {
  AnuncioDeOrigem,
  InboundEvent,
} from "@/lib/integrations/whatsapp/inbound";
import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Onda 5, item 17: as regras de origem (campaign_link) pela INGESTAO real,
// contra o banco REAL. Aceite do link da bio: o lead novo cuja primeira
// mensagem e o texto pronto do link, mesmo com centenas de caracteres
// invisiveis no meio (o texto de link rastreavel de outra ferramenta, como
// o dos leads da Salud Care de 09 a 20/10/2026), ganha a origem da regra
// (metodo mensagem_padrao, rotulo "Mensagem pronta do link"). E tambem:
// - contato que ja existia nao ganha origem por texto, so por codigo;
// - a precedencia de sempre: anuncio da Meta, codigo, mensagem pronta,
//   palavra-chave (o clique do site entre o codigo e a mensagem pronta tem
//   a suite propria, atribuicao-clique-do-site.test.ts);
// - regra desativada nao reconhece;
// - a reentrega da mesma mensagem nao regrava, e a origem nunca muda.
//
// Depende da migration 20261025100000_regras_de_origem.sql aplicada (as
// regras daqui passam nos CHECKs dela) e da normalizacao nova de
// lib/domain/attribution.ts (tira \p{Cf} e \p{M}). O texto com invisiveis e
// SINTETICO: nenhum texto de paciente foi lido nem copiado.
//
// CUIDADO, o banco de desenvolvimento e a producao. Cada cenario usa a
// propria clinica de teste (e_de_teste = true), apagada no afterAll
// (regras, contatos e conversas vao junto pela cascata). Telefones
// ficticios. ESCRITO, AINDA NAO RODADO (roda depois de aplicar a migration:
// npm run test:integration -- regras-de-origem).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'regras-origem-int-%';
//   delete from public.clinic where slug like 'regras-origem-int-%';

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 100_000).padStart(5, "0");
const clinicasCriadas: string[] = [];

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;

/** O texto pronto do link, como a clinica o cadastra. */
const TEXTO_DO_LINK =
  "Olá! Vim pelo link da bio e quero saber mais sobre a avaliação.";

/**
 * O mesmo texto como chega de um link rastreavel de outra ferramenta: um
 * bloco de 265 caracteres invisiveis (largura zero, juncao, U+2060, U+FEFF,
 * U+180E) no meio. Sintetico.
 */
function comInvisiveis(texto: string): string {
  const invisiveis = [
    "\u200b",
    "\u200c",
    "\u200d",
    "\u2060",
    "\ufeff",
    "\u180e",
  ];
  const bloco = Array.from(
    { length: 265 },
    (_, i) => invisiveis[i % invisiveis.length],
  ).join("");
  const meio = texto.indexOf(" e quero");
  return texto.slice(0, meio) + bloco + texto.slice(meio);
}

let telefoneSeq = 0;
/** Telefone ficticio por cenario (+5584976, 5 digitos da execucao, 1 da sequencia). */
function telefone(): string {
  telefoneSeq += 1;
  return `+5584976${digitos}${telefoneSeq % 10}`;
}

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `RegrasOrigem ${nome} ${sufixo}`,
      slug: `regras-origem-int-${nome}-${sufixo}`,
      e_de_teste: true,
      timezone: "America/Fortaleza",
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = (data as { id: string }).id;
  clinicasCriadas.push(clinicId);
  // Conversa exige numero de WhatsApp (contrato da Fase 3).
  await criarNumeroDeTeste(admin, clinicId);
  return clinicId;
}

async function criarRegra(
  clinicId: string,
  campos: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from("campaign_link")
    .insert({ clinic_id: clinicId, channel: "redes_sociais", ...campos })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function origemDe(contactId: string) {
  const { data } = await admin
    .from("contact")
    .select(
      "source_channel, source_origin, source_medium, source_campaign, source_method, source_captured_at",
    )
    .eq("id", contactId)
    .single()
    .throwOnError();
  return data as {
    source_channel: string | null;
    source_origin: string | null;
    source_medium: string | null;
    source_campaign: string | null;
    source_method: string | null;
    source_captured_at: string | null;
  };
}

function evento(
  fone: string,
  waMessageId: string,
  corpo: string,
  anuncio: AnuncioDeOrigem | null = null,
): MensagemRecebida {
  return {
    kind: "message_received",
    phone: fone,
    name: "Paciente Regras",
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

describe("a mensagem pronta do link da bio", () => {
  it("contato novo com o texto pronto e 265 invisíveis no meio ganha a origem da regra", async () => {
    const clinicId = await criarClinica("bio");
    await criarRegra(clinicId, {
      name: "Link da bio do Instagram",
      origin: "Instagram",
      medium: "Bio",
      default_message: TEXTO_DO_LINK,
    });

    const data = await ingerir(
      clinicId,
      evento(telefone(), `rgo-1-${sufixo}`, comInvisiveis(TEXTO_DO_LINK)),
    );
    expect(data.contact_created).toBe(true);
    const origem = await origemDe(data.contact_id!);
    expect(origem).toMatchObject({
      source_channel: "redes_sociais",
      source_origin: "Instagram",
      source_medium: "Bio",
      source_method: "mensagem_padrao",
    });
    expect(origem.source_captured_at).not.toBeNull();
  });

  it("a palavra-chave que atravessa o bloco invisível também casa", async () => {
    const clinicId = await criarClinica("palavra");
    await criarRegra(clinicId, {
      name: "Palavra avaliação",
      origin: "Instagram",
      keywords: ["quero saber mais"],
    });
    // O bloco invisivel cai entre "quero" e "saber".
    const corpo = `Oi, eu quero${"\u200b".repeat(120)} saber mais do clareamento`;
    const data = await ingerir(
      clinicId,
      evento(telefone(), `rgo-2-${sufixo}`, corpo),
    );
    expect(await origemDe(data.contact_id!)).toMatchObject({
      source_channel: "redes_sociais",
      source_method: "palavra_chave",
    });
  });

  it("contato que já existia não ganha origem pela mensagem pronta, só pelo código", async () => {
    const clinicId = await criarClinica("antigo");
    await criarRegra(clinicId, {
      name: "Link da bio com código",
      origin: "Instagram",
      medium: "Bio",
      default_message: TEXTO_DO_LINK,
      token: "K7Q2MX",
    });
    const fone = telefone();
    const primeira = await ingerir(
      clinicId,
      evento(fone, `rgo-3a-${sufixo}`, "Oi, tudo bem?"),
    );
    expect((await origemDe(primeira.contact_id!)).source_channel).toBeNull();

    const segunda = await ingerir(
      clinicId,
      evento(fone, `rgo-3b-${sufixo}`, TEXTO_DO_LINK),
    );
    expect(segunda.contact_created).toBe(false);
    expect((await origemDe(segunda.contact_id!)).source_channel).toBeNull();

    const terceira = await ingerir(
      clinicId,
      evento(fone, `rgo-3c-${sufixo}`, `${TEXTO_DO_LINK} [#K7Q2MX]`),
    );
    expect(await origemDe(terceira.contact_id!)).toMatchObject({
      source_channel: "redes_sociais",
      source_origin: "Instagram",
      source_method: "link_token",
    });
  });

  it("regra desativada não reconhece", async () => {
    const clinicId = await criarClinica("desativada");
    await criarRegra(clinicId, {
      name: "Link antigo",
      default_message: TEXTO_DO_LINK,
      keywords: ["avaliação"],
      active: false,
    });
    const data = await ingerir(
      clinicId,
      evento(telefone(), `rgo-4-${sufixo}`, TEXTO_DO_LINK),
    );
    expect((await origemDe(data.contact_id!)).source_channel).toBeNull();
  });
});

describe("a precedência de sempre", () => {
  it("o código vence a mensagem pronta e a palavra-chave", async () => {
    const clinicId = await criarClinica("codigovence");
    await criarRegra(clinicId, {
      name: "Palavra avaliação",
      channel: "indicacao",
      keywords: ["avaliação"],
    });
    await criarRegra(clinicId, {
      name: "Link da bio",
      default_message: TEXTO_DO_LINK,
    });
    await criarRegra(clinicId, {
      name: "QR code da recepção",
      channel: "offline",
      origin: "QR code",
      token: "D8M4G2",
    });
    const data = await ingerir(
      clinicId,
      evento(telefone(), `rgo-5-${sufixo}`, `${TEXTO_DO_LINK} [#D8M4G2]`),
    );
    expect(await origemDe(data.contact_id!)).toMatchObject({
      source_channel: "offline",
      source_origin: "QR code",
      source_method: "link_token",
    });
  });

  it("a mensagem pronta vence a palavra-chave", async () => {
    const clinicId = await criarClinica("mensagemvence");
    await criarRegra(clinicId, {
      name: "Palavra avaliação",
      channel: "indicacao",
      keywords: ["avaliação"],
    });
    await criarRegra(clinicId, {
      name: "Link da bio",
      origin: "Instagram",
      default_message: TEXTO_DO_LINK,
    });
    const data = await ingerir(
      clinicId,
      evento(telefone(), `rgo-6-${sufixo}`, TEXTO_DO_LINK),
    );
    expect(await origemDe(data.contact_id!)).toMatchObject({
      source_channel: "redes_sociais",
      source_origin: "Instagram",
      source_method: "mensagem_padrao",
    });
  });

  it("o anúncio da Meta vence a mensagem pronta e o código", async () => {
    const clinicId = await criarClinica("metavence");
    await criarRegra(clinicId, {
      name: "Link da bio",
      default_message: TEXTO_DO_LINK,
      token: "H5N7P2",
    });
    const anuncio: AnuncioDeOrigem = {
      ctwaClid: `Af-REGRAS-${sufixo}`,
      adId: "120240624148610290",
      adsetId: null,
      campaignId: null,
      sourceUrl: "https://fb.me/abcXYZ",
      titulo: null,
      descricao: null,
      plataforma: "Instagram",
      tipo: "ad",
      chavesVistas: { anuncio: ["ctwaClid"], contexto: [] },
    };
    const data = await ingerir(
      clinicId,
      evento(
        telefone(),
        `rgo-7-${sufixo}`,
        `${TEXTO_DO_LINK} [#H5N7P2]`,
        anuncio,
      ),
    );
    expect(await origemDe(data.contact_id!)).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_method: "anuncio_ctwa",
    });
  });
});

describe("a origem não muda", () => {
  it("a reentrega da mesma mensagem não regrava, e outra regra depois não troca a origem", async () => {
    const clinicId = await criarClinica("reentrega");
    await criarRegra(clinicId, {
      name: "Link da bio",
      origin: "Instagram",
      default_message: TEXTO_DO_LINK,
    });
    await criarRegra(clinicId, {
      name: "QR code",
      channel: "offline",
      token: "Z2Z2Z2",
    });
    const fone = telefone();
    const waId = `rgo-8-${sufixo}`;
    const primeira = await ingerir(clinicId, evento(fone, waId, TEXTO_DO_LINK));
    const antes = await origemDe(primeira.contact_id!);
    expect(antes.source_method).toBe("mensagem_padrao");

    const reentrega = await ingerir(
      clinicId,
      evento(fone, waId, TEXTO_DO_LINK),
    );
    expect(reentrega.contact_id).toBe(primeira.contact_id);
    expect(await origemDe(primeira.contact_id!)).toEqual(antes);

    await ingerir(
      clinicId,
      evento(fone, `rgo-8b-${sufixo}`, "Voltei [#Z2Z2Z2]"),
    );
    expect(await origemDe(primeira.contact_id!)).toEqual(antes);
  });
});
