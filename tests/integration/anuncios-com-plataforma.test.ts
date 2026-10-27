import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Resultados (aba Marketing): o anuncio com o texto, o link e a plataforma
// (migration 20261026130000_anuncios_com_plataforma.sql), contra o banco
// REAL, pelo cliente de servico. Pedido do dono de 26/10/2026: sem a conta
// da Meta ligada, ver em Resultados o anuncio que o uazapi grava por lead (o
// titulo, o texto e o link em anuncio_do_whatsapp) e a plataforma
// (contact.source_medium). anuncios_do_periodo ganhou, SO POR ACRESCIMO:
// - em cada linha, "descricao" e "link" (da linha do anuncio; null sem ela)
//   e "plataformas";
// - em nao_identificado, "plataformas" (vazia sem lead).
// "plataformas": os leads do grupo por plataforma, a source_medium aparada
// como no JavaScript (o .trim()) e o vazio virando null, sem mudar a caixa;
// mais leads primeiro, depois a plataforma em ordem de byte, null por
// ultimo; a soma e o "leads" do grupo.
// O que esta em jogo aqui, numa clinica com os mesmos casos do ensaio da
// migration (~/.claude/plans/resultados-anuncios/ensaio-20261026130000.sql):
// - o X (linha completa: titulo, texto e link): Instagram, Facebook com
//   espacos ASCII nas pontas, com NBSP e U+2003, com tab, o id entre NBSP e
//   tab, o vazio e o so de brancos (null), "instagram" em minuscula (outra
//   plataforma);
// - o Y (sem linha; com o nome na Meta): o empate de caixa ("Instagram"
//   antes de "instagram", em ordem de byte) e o null por ultimo;
// - o Z (so o titulo), o W (so o link, o lead chegando EXATAMENTE no inicio
//   do periodo) e o V (so o texto);
// - os nao identificados por plataforma (so o clique, so o conjunto, so a
//   campanha, o metodo anuncio_ctwa sem ids, o id "abc", o id vazio, o id de
//   33 digitos) e o lead sem anuncio com plataforma, que fica fora;
// - as pontas do periodo (o fim aberto e o lead 1 microssegundo antes do
//   inicio) mudam as contagens das plataformas com o periodo maior;
// - as chaves de hoje, as mesmas; agendaram e compareceram como antes;
// - a clinica sem lead: zeros, com plataformas vazia em nao_identificado.
// Quem recebe o que por papel (a RLS de quem chama) fica em
// tests/rls/anuncio-do-whatsapp.test.ts.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// anuncios-plataforma-int-*, apagadas no afterAll (prazo de 60 s; contatos,
// consultas, cadastros e as linhas de anuncio vao em cascata; o beforeAll
// apaga a sobra de uma execucao que morreu ha mais de uma hora). Nenhum
// usuario e criado. Nada aqui usa a id da Salud Care, da teste123 nem da
// Conduzza Teste, nem envia mensagem. ESCRITO, AINDA NAO RODADO (roda depois
// de aplicar a migration: npm run test:integration --
// anuncios-com-plataforma).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'anuncios-plataforma-int-%';
//   delete from public.clinic where slug like 'anuncios-plataforma-int-%';

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const slug = (nome: string) => `anuncios-plataforma-int-${nome}-${sufixo}`;

// Outubro de 2026 em Fortaleza: [01/10 03:00Z, 01/11 03:00Z).
const P_DE = "2026-10-01T03:00:00.000Z";
const P_ATE = "2026-11-01T03:00:00.000Z";
// Um periodo que pega tudo.
const TUDO_DE = "1900-01-01T00:00:00.000Z";
const TUDO_ATE = "2200-01-01T00:00:00.000Z";

const X = "900000000000400001";
const Y = "900000000000400002";
const Z = "900000000000400003";
const W = "900000000000400004";
const V = "900000000000400005";

/** Brancos que o .trim() do JavaScript tira, montados pelo codigo. */
const NBSP = String.fromCharCode(0xa0);
const EM_SPACE = String.fromCharCode(0x2003);
const ESPACO_IDEOGRAFICO = String.fromCharCode(0x3000);
const TAB = String.fromCharCode(0x09);

type Plataforma = { plataforma: string | null; leads: number };
type Linha = {
  ad_id: string;
  titulo: string | null;
  nome_na_meta: string | null;
  leads: number;
  agendaram: number;
  compareceram: number;
  descricao: string | null;
  link: string | null;
  plataformas: Plataforma[];
};
type Bloco = {
  leads: number;
  linhas: Linha[];
  nao_identificado: {
    leads: number;
    agendaram: number;
    compareceram: number;
    plataformas: Plataforma[];
  };
  sem_anuncio: { leads: number; agendaram: number; compareceram: number };
};

let clinicaA = "";
let clinicaVazia = "";
let telefone = 0;

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Anuncios Plataforma Int ${nome} ${sufixo}`,
      slug: slug(nome.toLowerCase()),
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** Um lead na clinica A (a origem do anuncio vai em extras). */
async function lead(
  chegada: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  telefone += 1;
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: `+55849775${String(telefone).padStart(5, "0")}`,
      name: `Lead plataforma ${telefone}`,
      first_contact_at: chegada,
      ...extras,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** A origem de anuncio que a ingestao grava (metodo anuncio_ctwa). */
function doAnuncio(
  adId: string | null,
  plataforma: string | null,
  clique: string | null,
): Record<string, unknown> {
  return {
    source_method: "anuncio_ctwa",
    source_channel: "trafego_pago",
    source_origin: "Meta",
    source_medium: plataforma,
    source_ad_id: adId,
    ctwa_clid: clique,
  };
}

/** O dia D de outubro de 2026 em Fortaleza, ao meio-dia. */
const dia = (d: number) =>
  `2026-10-${String(d).padStart(2, "0")}T15:00:00.000Z`;

async function anuncios(
  clinicId: string,
  de = P_DE,
  ate = P_ATE,
): Promise<Bloco> {
  const { data, error } = await admin.rpc("anuncios_do_periodo", {
    p_clinic_id: clinicId,
    p_de: de,
    p_ate: ate,
  });
  expect(error).toBeNull();
  return data as Bloco;
}

/** Ordem de byte (UTF-8), sem colacao. */
function porByte(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

beforeAll(async () => {
  // A sobra de uma execucao que morreu (mais de uma hora).
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "anuncios-plataforma-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaVazia = await criarClinica("Vazia");

  // As linhas de anuncio_do_whatsapp pela escrita do sistema: X completa,
  // Z so com o titulo, W so com o link, V so com o texto; Y sem linha (so o
  // nome na Meta).
  for (const args of [
    {
      p_ad_id: X,
      p_titulo: "Plataforma X titulo",
      p_descricao: "Plataforma X texto.\nSegunda linha.",
      p_link: "https://fb.me/plataformaX",
      p_plataforma: "Instagram",
      p_tipo: "ad",
    },
    { p_ad_id: Z, p_titulo: "Plataforma Z so titulo" },
    { p_ad_id: W, p_link: "https://www.instagram.com/p/plataformaW/" },
    { p_ad_id: V, p_descricao: "Plataforma V so texto" },
  ]) {
    const { data, error } = await admin.rpc("registrar_anuncio_do_whatsapp", {
      p_clinic_id: clinicaA,
      ...args,
    });
    expect(error).toBeNull();
    expect(data).toBe("inserido");
  }
  await admin
    .from("meta_anuncio")
    .insert({
      clinic_id: clinicaA,
      ad_id: Y,
      ad_account_id: "act_9000401",
      campaign_id: "900000000000409001",
      ad_name: "Plataforma Y na Meta",
      ultimo_dia_com_entrega: "2026-10-05",
    })
    .throwOnError();

  const ids = new Map<string, string>();
  // X em outubro: Instagram 4 (um com o id entre NBSP e tab), Facebook 4
  // (com espacos ASCII, com NBSP e U+2003, com tab), null 3 (nulo, vazio,
  // so brancos), "instagram" 1.
  ids.set(
    "x1",
    await lead(dia(2), doAnuncio(X, "Instagram", `clid-p1-${sufixo}`)),
  );
  ids.set(
    "x2",
    await lead(dia(3), doAnuncio(X, "Instagram", `clid-p2-${sufixo}`)),
  );
  await lead(dia(4), doAnuncio(X, "Instagram", `clid-p3-${sufixo}`));
  await lead(
    dia(5),
    doAnuncio(`${NBSP}${X}${TAB}`, "Instagram", `clid-p4-${sufixo}`),
  );
  await lead(dia(6), doAnuncio(X, "Facebook", `clid-p5-${sufixo}`));
  ids.set(
    "x6",
    await lead(dia(7), { source_ad_id: X, source_medium: " Facebook " }),
  );
  await lead(dia(8), {
    source_ad_id: X,
    source_medium: `${NBSP}Facebook${EM_SPACE}`,
  });
  await lead(dia(9), { source_ad_id: X, source_medium: `${TAB}Facebook` });
  await lead(dia(10), doAnuncio(X, null, `clid-p9-${sufixo}`));
  await lead(dia(11), { source_ad_id: X, source_medium: "" });
  await lead(dia(12), {
    source_ad_id: X,
    source_medium: ` ${TAB}${ESPACO_IDEOGRAFICO} `,
  });
  await lead(dia(13), { source_ad_id: X, source_medium: "instagram" });
  // Y em outubro: Facebook 2, Instagram 1, "instagram" 1, null 1.
  ids.set(
    "y1",
    await lead(dia(14), doAnuncio(Y, "Instagram", `clid-p13-${sufixo}`)),
  );
  await lead(dia(15), { source_ad_id: Y, source_medium: "instagram" });
  await lead(dia(16), doAnuncio(Y, null, `clid-p15-${sufixo}`));
  await lead(dia(17), doAnuncio(Y, "Facebook", `clid-p16-${sufixo}`));
  await lead(dia(18), doAnuncio(Y, "Facebook", `clid-p17-${sufixo}`));
  // Z, W (EXATAMENTE no inicio do periodo) e V.
  await lead(dia(19), { source_ad_id: Z, source_medium: "Messenger" });
  await lead(P_DE, doAnuncio(W, "Instagram", `clid-p19-${sufixo}`));
  await lead(dia(20), doAnuncio(V, null, `clid-p20-${sufixo}`));
  // Fora de outubro: X EXATAMENTE no fim (o fim e aberto) e Y 1
  // microssegundo antes do inicio.
  await lead(P_ATE, doAnuncio(X, "Facebook", `clid-p21-${sufixo}`));
  await lead(
    "2026-10-01T02:59:59.999999Z",
    doAnuncio(Y, "Instagram", `clid-p22-${sufixo}`),
  );
  // Nao identificados em outubro: Facebook 3, Instagram 2, null 2.
  ids.set(
    "n1",
    await lead(dia(21), {
      ctwa_clid: `clid-p23-${sufixo}`,
      source_medium: "Instagram",
    }),
  );
  await lead(dia(22), { source_adset_id: "900000000000405001" });
  ids.set(
    "n3",
    await lead(dia(23), {
      source_campaign_id: "900000000000406001",
      source_medium: "Facebook",
    }),
  );
  await lead(dia(24), doAnuncio(null, "Instagram", null));
  await lead(dia(25), { source_ad_id: "abc", source_medium: "  " });
  await lead(dia(26), { source_ad_id: "", source_medium: "Facebook" });
  await lead(dia(27), {
    source_ad_id: "1".repeat(33),
    source_medium: `${TAB}Facebook`,
  });
  // Sem anuncio em outubro: o organico com a plataforma (fica fora das
  // plataformas) e o organico sem nada.
  await lead(dia(28), {
    source_channel: "redes_sociais",
    source_medium: "Instagram",
  });
  ids.set("s2", await lead(dia(29)));

  // As consultas: agendaram x1, x2 (compareceu), x6, y1 (compareceu), n1, n3
  // (compareceu) e s2.
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Plataforma" })
    .select("id")
    .single()
    .throwOnError();
  const { data: proc } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicaA, name: "Avaliação" })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicaA,
      professional_id: (prof as { id: string }).id,
      procedure_id: (proc as { id: string }).id,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  let hora = 0;
  for (const [chave, compareceu] of [
    ["x1", false],
    ["x2", true],
    ["x6", false],
    ["y1", true],
    ["n1", false],
    ["n3", true],
    ["s2", false],
  ] as const) {
    hora += 1;
    const inicio = new Date(
      Date.parse("2026-10-20T12:00:00.000Z") + hora * 60 * 60_000,
    );
    const { data: consulta } = await admin
      .from("appointment")
      .insert({
        clinic_id: clinicaA,
        contact_id: ids.get(chave)!,
        professional_id: (prof as { id: string }).id,
        service_link_id: (vinculo as { id: string }).id,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();
    if (compareceu) {
      await admin
        .from("appointment")
        .update({ status: "compareceu" })
        .eq("id", (consulta as { id: string }).id)
        .throwOnError();
    }
  }
}, 120_000);

afterAll(async () => {
  // As clinicas desta execucao pelo slug; contatos, consultas, cadastros e
  // as linhas de anuncio vao em cascata. O erro conferido: limpeza que falha
  // calada deixaria clinica de teste na producao.
  const { error } = await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", `anuncios-plataforma-int-%-${sufixo}`);
  expect(error, "apagar as clinicas do teste").toBeNull();
}, 60_000);

describe("anuncios_do_periodo: o texto, o link e a plataforma (20261026130000)", () => {
  it("outubro: cada anúncio com o texto e o link da linha dele e os leads por plataforma", async () => {
    expect(await anuncios(clinicaA)).toEqual({
      leads: 29,
      linhas: [
        {
          ad_id: X,
          titulo: "Plataforma X titulo",
          nome_na_meta: null,
          leads: 12,
          agendaram: 3,
          compareceram: 1,
          descricao: "Plataforma X texto.\nSegunda linha.",
          link: "https://fb.me/plataformaX",
          // Os brancos das pontas aparados; vazio e so brancos viram null;
          // a minuscula e outra plataforma. Empate em 4: ordem de byte.
          plataformas: [
            { plataforma: "Facebook", leads: 4 },
            { plataforma: "Instagram", leads: 4 },
            { plataforma: null, leads: 3 },
            { plataforma: "instagram", leads: 1 },
          ],
        },
        {
          ad_id: Y,
          titulo: null,
          nome_na_meta: "Plataforma Y na Meta",
          leads: 5,
          agendaram: 1,
          compareceram: 1,
          descricao: null,
          link: null,
          // Empate em 1: "Instagram" antes de "instagram" (ordem de byte) e
          // a nula por ultimo.
          plataformas: [
            { plataforma: "Facebook", leads: 2 },
            { plataforma: "Instagram", leads: 1 },
            { plataforma: "instagram", leads: 1 },
            { plataforma: null, leads: 1 },
          ],
        },
        {
          ad_id: Z,
          titulo: "Plataforma Z so titulo",
          nome_na_meta: null,
          leads: 1,
          agendaram: 0,
          compareceram: 0,
          descricao: null,
          link: null,
          plataformas: [{ plataforma: "Messenger", leads: 1 }],
        },
        {
          ad_id: W,
          titulo: null,
          nome_na_meta: null,
          leads: 1,
          agendaram: 0,
          compareceram: 0,
          descricao: null,
          link: "https://www.instagram.com/p/plataformaW/",
          plataformas: [{ plataforma: "Instagram", leads: 1 }],
        },
        {
          ad_id: V,
          titulo: null,
          nome_na_meta: null,
          leads: 1,
          agendaram: 0,
          compareceram: 0,
          descricao: "Plataforma V so texto",
          link: null,
          plataformas: [{ plataforma: null, leads: 1 }],
        },
      ],
      nao_identificado: {
        leads: 7,
        agendaram: 2,
        compareceram: 1,
        plataformas: [
          { plataforma: "Facebook", leads: 3 },
          { plataforma: "Instagram", leads: 2 },
          { plataforma: null, leads: 2 },
        ],
      },
      // O organico com a plataforma Instagram fica aqui, e em nenhuma
      // plataforma.
      sem_anuncio: { leads: 2, agendaram: 1, compareceram: 0 },
    });
  });

  it("a soma das plataformas é o leads de cada grupo, sem plataforma vazia, repetida ou com branco na ponta, na ordem", async () => {
    for (const [de, ate] of [
      [P_DE, P_ATE],
      [TUDO_DE, TUDO_ATE],
    ] as const) {
      const bloco = await anuncios(clinicaA, de, ate);
      const grupos = [
        ...bloco.linhas.map((l) => ({ leads: l.leads, lista: l.plataformas })),
        {
          leads: bloco.nao_identificado.leads,
          lista: bloco.nao_identificado.plataformas,
        },
      ];
      for (const grupo of grupos) {
        expect(grupo.lista.reduce((t, i) => t + i.leads, 0)).toBe(grupo.leads);
        const nomes = grupo.lista.map((i) => i.plataforma);
        expect(new Set(nomes).size).toBe(nomes.length);
        for (const item of grupo.lista) {
          expect(Number.isInteger(item.leads) && item.leads > 0).toBe(true);
          if (item.plataforma !== null) {
            expect(item.plataforma).not.toBe("");
            expect(item.plataforma.trim()).toBe(item.plataforma);
          }
        }
        for (let i = 1; i < grupo.lista.length; i++) {
          const antes = grupo.lista[i - 1]!;
          const depois = grupo.lista[i]!;
          expect(antes.leads).toBeGreaterThanOrEqual(depois.leads);
          if (antes.leads === depois.leads) {
            expect(antes.plataforma).not.toBeNull();
            if (depois.plataforma !== null) {
              expect(
                porByte(antes.plataforma!, depois.plataforma),
              ).toBeLessThan(0);
            }
          }
        }
      }
      // Toda linha tem plataforma (nunca vazia).
      for (const linha of bloco.linhas) {
        expect(linha.plataformas.length).toBeGreaterThan(0);
      }
    }
  });

  it("as pontas do período: com o período maior, o lead do fim e o de antes do início entram nas plataformas", async () => {
    const tudo = await anuncios(clinicaA, TUDO_DE, TUDO_ATE);
    expect(tudo.leads).toBe(31);
    expect(tudo.linhas.find((l) => l.ad_id === X)).toMatchObject({
      leads: 13,
      plataformas: [
        { plataforma: "Facebook", leads: 5 },
        { plataforma: "Instagram", leads: 4 },
        { plataforma: null, leads: 3 },
        { plataforma: "instagram", leads: 1 },
      ],
    });
    expect(tudo.linhas.find((l) => l.ad_id === Y)).toMatchObject({
      leads: 6,
      plataformas: [
        { plataforma: "Facebook", leads: 2 },
        { plataforma: "Instagram", leads: 2 },
        { plataforma: "instagram", leads: 1 },
        { plataforma: null, leads: 1 },
      ],
    });
  });

  it("as chaves de hoje continuam as mesmas, com as novas só por acréscimo", async () => {
    const bloco = await anuncios(clinicaA);
    const chaves = (objeto: object) => Object.keys(objeto).sort();
    expect(chaves(bloco)).toEqual([
      "leads",
      "linhas",
      "nao_identificado",
      "sem_anuncio",
    ]);
    for (const linha of bloco.linhas) {
      expect(chaves(linha)).toEqual([
        "ad_id",
        "agendaram",
        "compareceram",
        "descricao",
        "leads",
        "link",
        "nome_na_meta",
        "plataformas",
        "titulo",
      ]);
    }
    expect(chaves(bloco.nao_identificado)).toEqual([
      "agendaram",
      "compareceram",
      "leads",
      "plataformas",
    ]);
    expect(chaves(bloco.sem_anuncio)).toEqual([
      "agendaram",
      "compareceram",
      "leads",
    ]);
    // A invariante de antes: linhas + nao_identificado + sem_anuncio = leads.
    expect(
      bloco.linhas.reduce((t, l) => t + l.leads, 0) +
        bloco.nao_identificado.leads +
        bloco.sem_anuncio.leads,
    ).toBe(bloco.leads);
  });

  it("a clínica sem lead: zeros, com as plataformas vazias em nao_identificado", async () => {
    expect(await anuncios(clinicaVazia)).toEqual({
      leads: 0,
      linhas: [],
      nao_identificado: {
        leads: 0,
        agendaram: 0,
        compareceram: 0,
        plataformas: [],
      },
      sem_anuncio: { leads: 0, agendaram: 0, compareceram: 0 },
    });
  });
});
