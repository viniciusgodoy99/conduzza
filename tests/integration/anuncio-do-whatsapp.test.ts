import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/webhooks/whatsapp/route";
import {
  caminhoDoWebhook,
  criarNumeroDeTeste,
  type NumeroDeTeste,
} from "../rls/numeros";
import { adminClient, stackCredentials } from "../rls/stack";

// Detalhes do anuncio do WhatsApp (migration 20261020100000, pedido do dono
// em 20/10/2026), contra o banco REAL e pela porta real: o POST da rota do
// webhook com o payload do uazapi (a mensagem que o paciente manda depois de
// tocar no anuncio, com o externalAdReply no contextInfo).
//
// O que se prova: a mensagem de anuncio grava os detalhes (titulo, descricao
// com as quebras, link, plataforma, tipo e o horario da mensagem) em
// anuncio_do_whatsapp, uma linha por anuncio da clinica, alem da origem de
// sempre; a reentrega identica do mesmo evento nao duplica nem mexe em nada
// (nem no atualizado_em, nem no texto_visto_em); texto novo do mesmo anuncio,
// numa mensagem mais nova de outro paciente, atualiza so o campo que veio e
// nao troca a plataforma; a reentrega atrasada e o clique mais antigo nao
// voltam o texto velho; a forma PascalCase do whatsmeow tambem grava; post
// nao grava; link fora dos enderecos do anuncio e redirecionador nao viram
// link; o id com espaco Unicode vai aparado para o contato e para a linha; e
// anuncios_do_periodo devolve o titulo guardado na linha do anuncio.
// Desde a migration 20261026130000 (pedido do dono de 26/10/2026): a linha
// do anuncio em anuncios_do_periodo traz tambem a descricao e o link
// guardados e os leads por plataforma, a plataforma que a ingestao gravou no
// contato de cada clique (o sourceApp do referral; sem ele, o
// entryPointConversionApp do contexto), somando os leads da linha; sem lead
// de anuncio sem id, nao_identificado vem com as plataformas vazias. Esses
// asserts rodam depois de aplicar a 20261026130000.
//
// ESCRITO, AINDA NAO RODADO: roda depois de aplicar a migration
// (npm run test:integration -- anuncio-do-whatsapp). Clinicas e_de_teste
// (o motor de producao as ignora). Provedor 'fake' em todo numero: nenhum
// teste encosta no WhatsApp real. Nada aqui imprime conteudo de mensagem.

// A rota cria o admin client pelo ambiente; fora do Next ele nao vem
// carregado.
const credenciais = stackCredentials();
process.env.NEXT_PUBLIC_SUPABASE_URL ??= credenciais.url;
process.env.SUPABASE_SERVICE_ROLE_KEY ??= credenciais.serviceRoleKey;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

let sequencia = 0;
function telefone(): string {
  sequencia += 1;
  return `+55849786${String(sequencia).padStart(5, "0")}`;
}

/** O chatid do WhatsApp para um telefone E.164. */
function jid(phone: string): string {
  return `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
}

type RespostaDoWebhook = { status: number; corpo: Record<string, unknown> };

/** Chama o handler REAL do webhook, como o provedor chamaria. */
async function postar(
  caminho: string,
  corpo: unknown,
): Promise<RespostaDoWebhook> {
  const resposta = await POST(
    new NextRequest(new URL(caminho, "http://localhost:3000"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
  return {
    status: resposta.status,
    corpo: (await resposta.json()) as Record<string, unknown>,
  };
}

async function clinicaComNumero(nome: string): Promise<NumeroDeTeste> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Anuncio Wpp ${nome} ${sufixo}`,
      slug: `anuncio-wpp-int-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  return criarNumeroDeTeste(admin, clinicId);
}

/**
 * Evento "messages" do uazapi para a mensagem que o PACIENTE manda depois de
 * tocar no anuncio: o referral vem em content.contextInfo.externalAdReply.
 */
function doAnuncio(
  phone: string,
  id: string,
  externalAdReply: Record<string, unknown>,
  chaveDoReferral = "externalAdReply",
  messageTimestamp = Date.now(),
) {
  return {
    EventType: "messages",
    message: {
      messageid: id,
      chatid: jid(phone),
      sender_pn: jid(phone),
      fromMe: false,
      messageType: "ExtendedTextMessage",
      text: "Olá! Quero saber mais",
      messageTimestamp,
      content: {
        text: "Olá! Quero saber mais",
        contextInfo: {
          [chaveDoReferral]: externalAdReply,
          entryPointConversionApp: "instagram",
        },
      },
    },
  };
}

type LinhaDoAnuncio = {
  clinic_id: string;
  ad_id: string;
  titulo: string | null;
  descricao: string | null;
  link: string | null;
  plataforma: string | null;
  tipo: string | null;
  texto_visto_em: string;
  primeiro_visto_em: string;
  atualizado_em: string;
};

async function linhasDoAnuncio(
  clinicId: string,
  adId: string,
): Promise<LinhaDoAnuncio[]> {
  const { data } = await admin
    .from("anuncio_do_whatsapp")
    .select(
      "clinic_id, ad_id, titulo, descricao, link, plataforma, tipo, texto_visto_em, primeiro_visto_em, atualizado_em",
    )
    .eq("clinic_id", clinicId)
    .eq("ad_id", adId)
    .throwOnError();
  return (data ?? []) as LinhaDoAnuncio[];
}

async function quantasMensagens(waMessageId: string): Promise<number> {
  const { count } = await admin
    .from("message")
    .select("id", { count: "exact", head: true })
    .eq("wa_message_id", waMessageId);
  return count ?? 0;
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("webhook: a mensagem de anúncio grava os detalhes do anúncio", () => {
  const ANUNCIO = "900000000000000201";
  let numero: NumeroDeTeste;
  const primeiroTelefone = telefone();
  // Horarios de envio (messageTimestamp, ms): a primeira mensagem uma hora
  // atras; a reentrega traz o MESMO payload (o mesmo horario).
  const ENVIO_1 = Date.now() - 60 * 60_000;
  const primeiroEvento = () =>
    doAnuncio(
      primeiroTelefone,
      `anuncio-wpp:${sufixo}:1`,
      {
        title: "Limpeza de pele com 30% de desconto",
        body: "Agende sua avaliação.\r\nVagas limitadas para outubro.",
        sourceID: ANUNCIO,
        sourceURL: "https://fb.me/ensaioAnuncio",
        sourceType: "ad",
        sourceApp: "instagram",
        ctwaClid: `Af-ANUNCIO-${sufixo}`,
      },
      "externalAdReply",
      ENVIO_1,
    );

  it("grava a linha do anúncio e a origem do contato, como antes", async () => {
    numero = await clinicaComNumero("principal");
    const { status, corpo } = await postar(
      caminhoDoWebhook(numero),
      primeiroEvento(),
    );
    expect(status).toBe(200);
    expect(corpo).toEqual({ ok: true });

    const [linha, ...resto] = await linhasDoAnuncio(numero.clinicId, ANUNCIO);
    expect(resto).toEqual([]);
    expect(linha).toMatchObject({
      titulo: "Limpeza de pele com 30% de desconto",
      descricao: "Agende sua avaliação.\nVagas limitadas para outubro.",
      link: "https://fb.me/ensaioAnuncio",
      plataforma: "Instagram",
      tipo: "ad",
    });
    // O horario do texto e o do envio no aparelho, nao o da chegada.
    expect(Date.parse(linha!.texto_visto_em)).toBe(ENVIO_1);

    const { data: contato } = await admin
      .from("contact")
      .select("source_ad_id, source_method, source_medium")
      .eq("clinic_id", numero.clinicId)
      .eq("phone_e164", primeiroTelefone)
      .single()
      .throwOnError();
    expect(contato).toEqual({
      source_ad_id: ANUNCIO,
      source_method: "anuncio_ctwa",
      source_medium: "Instagram",
    });
  });

  it("reentrega do mesmo evento não duplica a mensagem nem mexe na linha", async () => {
    const [antes] = await linhasDoAnuncio(numero.clinicId, ANUNCIO);
    const { status } = await postar(caminhoDoWebhook(numero), primeiroEvento());
    expect(status).toBe(200);
    expect(await quantasMensagens(`anuncio-wpp:${sufixo}:1`)).toBe(1);
    const depois = await linhasDoAnuncio(numero.clinicId, ANUNCIO);
    expect(depois).toHaveLength(1);
    expect(depois[0]).toEqual(antes);
  });

  it("texto novo do mesmo anúncio (outro paciente, mensagem mais nova) atualiza só o que veio e não troca a plataforma", async () => {
    const [antes] = await linhasDoAnuncio(numero.clinicId, ANUNCIO);
    const envio2 = Date.now() - 30 * 60_000;
    const { status } = await postar(
      caminhoDoWebhook(numero),
      doAnuncio(
        telefone(),
        `anuncio-wpp:${sufixo}:2`,
        {
          title: "Limpeza de pele, texto novo do anunciante",
          sourceID: ANUNCIO,
          sourceApp: "facebook",
          ctwaClid: `Af-ANUNCIO-2-${sufixo}`,
        },
        "externalAdReply",
        envio2,
      ),
    );
    expect(status).toBe(200);
    const [depois] = await linhasDoAnuncio(numero.clinicId, ANUNCIO);
    expect(depois).toMatchObject({
      titulo: "Limpeza de pele, texto novo do anunciante",
      descricao: "Agende sua avaliação.\nVagas limitadas para outubro.",
      link: "https://fb.me/ensaioAnuncio",
      // A plataforma e do clique (o contato dele ficou com Facebook); a do
      // anuncio so preenche o vazio.
      plataforma: "Instagram",
      tipo: "ad",
      primeiro_visto_em: antes!.primeiro_visto_em,
    });
    expect(Date.parse(depois!.texto_visto_em)).toBe(envio2);
    expect(Date.parse(depois!.atualizado_em)).toBeGreaterThan(
      Date.parse(antes!.atualizado_em),
    );
  });

  it("a reentrega atrasada e o clique mais antigo não voltam o texto velho", async () => {
    const [antes] = await linhasDoAnuncio(numero.clinicId, ANUNCIO);
    // A primeira mensagem de novo (o provedor reentregou depois de um 500).
    const { status } = await postar(caminhoDoWebhook(numero), primeiroEvento());
    expect(status).toBe(200);
    // Outro paciente que tocou no anuncio antes da edicao: mensagem com o
    // texto velho e horario de envio mais antigo que o do texto guardado.
    const { status: statusAntigo } = await postar(
      caminhoDoWebhook(numero),
      doAnuncio(
        telefone(),
        `anuncio-wpp:${sufixo}:antigo`,
        {
          title: "Limpeza de pele com 30% de desconto",
          sourceID: ANUNCIO,
          ctwaClid: `Af-ANUNCIO-ANTIGO-${sufixo}`,
        },
        "externalAdReply",
        ENVIO_1 + 60_000,
      ),
    );
    expect(statusAntigo).toBe(200);
    const [depois] = await linhasDoAnuncio(numero.clinicId, ANUNCIO);
    expect(depois).toEqual(antes);
    expect(depois!.titulo).toBe("Limpeza de pele, texto novo do anunciante");
  });

  it("anuncios_do_periodo traz o título guardado na linha do anúncio", async () => {
    const agora = Date.now();
    const { data, error } = await admin.rpc("anuncios_do_periodo", {
      p_clinic_id: numero.clinicId,
      p_de: new Date(agora - 24 * 60 * 60_000).toISOString(),
      p_ate: new Date(agora + 24 * 60 * 60_000).toISOString(),
    });
    expect(error).toBeNull();
    type Plataforma = { plataforma: string | null; leads: number };
    const bloco = data as {
      linhas: {
        ad_id: string;
        titulo: string | null;
        leads: number;
        descricao: string | null;
        link: string | null;
        plataformas: Plataforma[];
      }[];
      nao_identificado: { leads: number; plataformas: Plataforma[] };
    };
    expect(bloco.linhas).toContainEqual(
      expect.objectContaining({
        ad_id: ANUNCIO,
        titulo: "Limpeza de pele, texto novo do anunciante",
        leads: 3,
      }),
    );
    // As chaves de 20261026130000: o texto e o link guardados e a
    // plataforma de cada clique (o primeiro e o "antigo" pelo Instagram, o
    // segundo pelo Facebook), mais leads primeiro.
    const linha = bloco.linhas.find((l) => l.ad_id === ANUNCIO);
    expect(linha).toMatchObject({
      descricao: "Agende sua avaliação.\nVagas limitadas para outubro.",
      link: "https://fb.me/ensaioAnuncio",
      plataformas: [
        { plataforma: "Instagram", leads: 2 },
        { plataforma: "Facebook", leads: 1 },
      ],
    });
    expect(
      linha!.plataformas.reduce((total, item) => total + item.leads, 0),
    ).toBe(linha!.leads);
    expect(bloco.nao_identificado).toMatchObject({
      leads: 0,
      plataformas: [],
    });
  });
});

describe("webhook: as outras formas e as recusas", () => {
  it("a forma PascalCase do whatsmeow (Title, Body, SourceID, SourceURL) também grava", async () => {
    const numero = await clinicaComNumero("pascal");
    const anuncio = "900000000000000202";
    const { status } = await postar(
      caminhoDoWebhook(numero),
      doAnuncio(
        telefone(),
        `anuncio-wpp:${sufixo}:pascal`,
        {
          Title: "Botox em Fortaleza",
          Body: "Avaliação gratuita",
          SourceID: anuncio,
          SourceURL: "https://www.instagram.com/p/ensaio/",
          SourceType: "ad",
          CtwaClid: `Af-PASCAL-${sufixo}`,
        },
        "ExternalAdReply",
      ),
    );
    expect(status).toBe(200);
    expect(await linhasDoAnuncio(numero.clinicId, anuncio)).toEqual([
      expect.objectContaining({
        titulo: "Botox em Fortaleza",
        descricao: "Avaliação gratuita",
        link: "https://www.instagram.com/p/ensaio/",
        tipo: "ad",
      }),
    ]);
  });

  it("post não grava detalhe; link fora dos endereços do anúncio não vira link; só o código não grava linha", async () => {
    const numero = await clinicaComNumero("recusas");
    const post = "900000000000000203";
    const linkEstranho = "900000000000000204";
    const soCodigo = "900000000000000205";

    await postar(
      caminhoDoWebhook(numero),
      doAnuncio(telefone(), `anuncio-wpp:${sufixo}:post`, {
        title: "Publicação orgânica",
        sourceID: post,
        sourceType: "post",
      }),
    );
    await postar(
      caminhoDoWebhook(numero),
      doAnuncio(telefone(), `anuncio-wpp:${sufixo}:link`, {
        title: "Anúncio com link estranho",
        sourceID: linkEstranho,
        sourceURL: "https://golpe.example.com/fb.me",
        ctwaClid: `Af-LINK-${sufixo}`,
      }),
    );
    await postar(
      caminhoDoWebhook(numero),
      doAnuncio(telefone(), `anuncio-wpp:${sufixo}:codigo`, {
        sourceID: soCodigo,
        ctwaClid: `Af-CODIGO-${sufixo}`,
      }),
    );

    expect(await linhasDoAnuncio(numero.clinicId, post)).toEqual([]);
    expect(await linhasDoAnuncio(numero.clinicId, linkEstranho)).toEqual([
      expect.objectContaining({
        titulo: "Anúncio com link estranho",
        link: null,
      }),
    ]);
    expect(await linhasDoAnuncio(numero.clinicId, soCodigo)).toEqual([]);
    // As tres mensagens entraram (os detalhes nunca barram a ingestao).
    for (const id of ["post", "link", "codigo"]) {
      expect(await quantasMensagens(`anuncio-wpp:${sufixo}:${id}`)).toBe(1);
    }
  });

  it("redirecionador e convite de grupo não viram link; o id com espaço Unicode vai aparado", async () => {
    const numero = await clinicaComNumero("redirecionador");
    const anuncio = "900000000000000207";
    const telefoneDoLead = telefone();
    await postar(
      caminhoDoWebhook(numero),
      doAnuncio(telefoneDoLead, `anuncio-wpp:${sufixo}:redirecionador`, {
        title: "Anúncio com redirecionador",
        sourceID: `\u00a0${anuncio}\u2003`,
        sourceURL:
          "https://l.facebook.com/l.php?u=https%3A%2F%2Fgolpe.example%2F",
        ctwaClid: `Af-REDIRECIONADOR-${sufixo}`,
      }),
    );
    await postar(
      caminhoDoWebhook(numero),
      doAnuncio(telefone(), `anuncio-wpp:${sufixo}:grupo`, {
        title: "Anúncio com convite de grupo",
        sourceID: anuncio,
        sourceURL: "https://chat.whatsapp.com/ConviteDeGrupo",
        ctwaClid: `Af-GRUPO-${sufixo}`,
      }),
    );
    expect(await linhasDoAnuncio(numero.clinicId, anuncio)).toEqual([
      expect.objectContaining({ link: null }),
    ]);
    const { data: contato } = await admin
      .from("contact")
      .select("source_ad_id")
      .eq("clinic_id", numero.clinicId)
      .eq("phone_e164", telefoneDoLead)
      .single()
      .throwOnError();
    expect(contato).toEqual({ source_ad_id: anuncio });
  });

  it("o mesmo anúncio em duas clínicas são duas linhas, cada uma com o seu texto", async () => {
    const a = await clinicaComNumero("duas-a");
    const b = await clinicaComNumero("duas-b");
    const anuncio = "900000000000000206";
    for (const [numero, titulo] of [
      [a, "Texto visto na A"],
      [b, "Texto visto na B"],
    ] as const) {
      await postar(
        caminhoDoWebhook(numero),
        doAnuncio(telefone(), `anuncio-wpp:${sufixo}:${numero.clinicId}`, {
          title: titulo,
          sourceID: anuncio,
          ctwaClid: `Af-DUAS-${numero.clinicId}`,
        }),
      );
    }
    expect((await linhasDoAnuncio(a.clinicId, anuncio))[0]?.titulo).toBe(
      "Texto visto na A",
    );
    expect((await linhasDoAnuncio(b.clinicId, anuncio))[0]?.titulo).toBe(
      "Texto visto na B",
    );
  });
});
