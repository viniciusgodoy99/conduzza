import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Detalhes do anuncio do WhatsApp (migration 20261020100000, pedido do dono
// em 20/10/2026), contra o banco real. O que esta em jogo:
// - anuncio_do_whatsapp: todo membro ATIVO le a propria clinica, nunca outra
//   clinica; pendente nao le nada; anon nao le;
// - ninguem escreve pela sessao, nem o admin (42501), nem executa a escrita:
//   so o sistema, pela registrar_anuncio_do_whatsapp (service role);
// - a RPC: inserido, sem_mudanca, atualizado (so o campo que veio, nulo
//   nunca apaga), sem_detalhes, 22023 e 23514; a ordem das mensagens (so a
//   mais nova troca o texto, campo vazio qualquer uma preenche, horario no
//   futuro vale agora) e plataforma e tipo que so preenchem o vazio;
// - anuncios_do_periodo: as linhas por anuncio para quem le a clinica (o id
//   aparado como no JavaScript; so o id do conjunto ou so o da campanha em
//   nao identificado; o inicio do periodo fechado e o fim aberto), os
//   mesmos numeros em todo papel que le, zeros para outra clinica, null para
//   o profissional, 42501 para anon.
// - desde a migration 20261026130000 (pedido do dono de 26/10/2026, ver em
//   Resultados o anuncio e a plataforma sem a conta da Meta): em cada linha,
//   a descricao e o link da linha do anuncio (null sem ela) e as plataformas
//   dos leads (contact.source_medium aparado como no JavaScript, vazio vira
//   null; mais leads primeiro, depois a plataforma em ordem de byte, null
//   por ultimo); as plataformas tambem em nao_identificado (vazia sem lead);
//   a soma das plataformas e o leads do grupo; o lead sem anuncio com
//   plataforma nao entra em plataforma nenhuma.
// Toda negacao tem o caso positivo ao lado (anti falso positivo). Clinicas
// e_de_teste: o motor de producao as ignora. ESCRITO, AINDA NAO RODADO
// (roda depois de aplicar a migration: npm run test:rls -- anuncio-do-whatsapp).

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "AnuncioWpp!Rls2026";

const email = (papel: string) => `anuncio-wpp-${papel}-${sufixo}@teste.dev`;

// Periodo fixo: outubro de 2026 em Fortaleza (00:00 local = 03:00 UTC).
const P_DE = "2026-10-01T03:00:00.000Z";
const P_ATE = "2026-11-01T03:00:00.000Z";

const ANUNCIO_X = "900000000000000101";
const ANUNCIO_Y = "900000000000000102";

/** Brancos que o .trim() do JavaScript tira, montados pelo codigo. */
const ESPACO_NAO_SEPARAVEL = String.fromCharCode(0xa0);
const TAB = String.fromCharCode(0x09);

// Horarios das mensagens (o envio no aparelho), do mais velho ao mais novo.
const T0 = "2026-10-05T12:00:00.000Z";
const T1 = "2026-10-05T13:00:00.000Z";
const T2 = "2026-10-05T14:00:00.000Z";
const T3 = "2026-10-05T15:00:00.000Z";

let clinicaA = "";
let clinicaB = "";
let profissionalA = "";

/** Os leads de anuncio de um grupo numa plataforma (20261026130000). */
type Plataforma = { plataforma: string | null; leads: number };

type Bloco = {
  leads: number;
  linhas: {
    ad_id: string;
    titulo: string | null;
    nome_na_meta: string | null;
    leads: number;
    agendaram: number;
    compareceram: number;
    descricao: string | null;
    link: string | null;
    plataformas: Plataforma[];
  }[];
  nao_identificado: {
    leads: number;
    agendaram: number;
    compareceram: number;
    plataformas: Plataforma[];
  };
  sem_anuncio: { leads: number; agendaram: number; compareceram: number };
};

async function criarUsuario(
  papelNoEmail: string,
  clinicId: string,
  role: string,
  opcoes: { status?: string; professionalId?: string } = {},
): Promise<void> {
  const { data } = await admin.auth.admin.createUser({
    email: email(papelNoEmail),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: papelNoEmail },
  });
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status: opcoes.status ?? "ativo",
      ...(opcoes.professionalId
        ? { professional_id: opcoes.professionalId }
        : {}),
    })
    .throwOnError();
}

// Uma sessao por papel, reaproveitada (o Auth limita a taxa de login).
const sessoes = new Map<string, ReturnType<typeof anonClient>>();

async function logado(papelNoEmail: string) {
  const pronta = sessoes.get(papelNoEmail);
  if (pronta) {
    return pronta;
  }
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: email(papelNoEmail),
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${papelNoEmail}: ${error.message}`);
  }
  sessoes.set(papelNoEmail, cliente);
  return cliente;
}

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `AnuncioWpp ${nome} ${sufixo}`,
      slug: `anuncio-wpp-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** A escrita do sistema (service role), como a ingestao faz. */
async function registrar(args: Record<string, unknown>) {
  return admin.rpc("registrar_anuncio_do_whatsapp", args);
}

function telefone(n: number): string {
  const digitos = sufixo.replace(/\D/g, "").padEnd(4, "7").slice(0, 4);
  return `+55849780${digitos}${String(n).padStart(2, "0")}`;
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Anuncio" })
    .select("id")
    .single()
    .throwOnError();
  profissionalA = prof!.id as string;

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("prof-a", clinicaA, "profissional", {
    professionalId: profissionalA,
  });
  await criarUsuario("pendente-a", clinicaA, "recepcao", {
    status: "pendente",
  });
  await criarUsuario("admin-b", clinicaB, "admin");

  // Detalhes guardados pelo sistema: o anuncio X na A e na B (textos
  // diferentes), o Y so com o nome na Meta.
  const a = await registrar({
    p_clinic_id: clinicaA,
    p_ad_id: ANUNCIO_X,
    p_titulo: "Limpeza de pele com 30% de desconto",
    p_descricao: "Agende sua avaliação.\nVagas limitadas.",
    p_link: "https://fb.me/ensaioX",
    p_plataforma: "Instagram",
    p_tipo: "ad",
    p_visto_em: T1,
  });
  expect(a.error).toBeNull();
  const b = await registrar({
    p_clinic_id: clinicaB,
    p_ad_id: ANUNCIO_X,
    p_titulo: "Anúncio da clínica B",
    p_visto_em: T1,
  });
  expect(b.error).toBeNull();
  await admin
    .from("meta_anuncio")
    .insert({
      clinic_id: clinicaA,
      ad_id: ANUNCIO_Y,
      ad_account_id: "act_9000001",
      campaign_id: "900000000000009001",
      ad_name: "Nome do Y na Meta",
      ultimo_dia_com_entrega: "2026-10-05",
    })
    .throwOnError();

  // Leads de outubro na A: tres do X (um com NBSP e tabulacao nas pontas do
  // id: a regra do JavaScript), um do Y, tres nao identificados (so o
  // clique, so o id do conjunto, so o da campanha) e dois sem anuncio (um
  // chegou exatamente no inicio do periodo). Fora: um do Y que chegou
  // exatamente no fim (o fim e aberto). Na B: um do X.
  // A plataforma (source_medium, 20261026130000): no X, Instagram, Facebook
  // e Instagram com NBSP e tabulacao nas pontas (aparado: Instagram); o Y
  // sem; nos nao identificados, Instagram, vazio (null) e Facebook; o
  // organico com Instagram (sem anuncio: fora das plataformas); na B,
  // Facebook.
  await admin
    .from("contact")
    .insert([
      {
        clinic_id: clinicaA,
        phone_e164: telefone(1),
        name: "Lead X 1",
        first_contact_at: "2026-10-05T15:00:00.000Z",
        ctwa_clid: `clid-x1-${sufixo}`,
        source_ad_id: ANUNCIO_X,
        source_medium: "Instagram",
      },
      {
        clinic_id: clinicaA,
        phone_e164: telefone(2),
        name: "Lead X 2",
        first_contact_at: "2026-10-06T15:00:00.000Z",
        ctwa_clid: `clid-x2-${sufixo}`,
        source_ad_id: ANUNCIO_X,
        source_medium: "Facebook",
      },
      {
        clinic_id: clinicaA,
        phone_e164: telefone(3),
        name: "Lead Y",
        first_contact_at: "2026-10-07T15:00:00.000Z",
        source_ad_id: ANUNCIO_Y,
      },
      {
        clinic_id: clinicaA,
        phone_e164: telefone(4),
        name: "Lead so clique",
        first_contact_at: "2026-10-08T15:00:00.000Z",
        ctwa_clid: `clid-solto-${sufixo}`,
        source_medium: "Instagram",
      },
      {
        clinic_id: clinicaA,
        phone_e164: telefone(5),
        name: "Lead organico",
        first_contact_at: "2026-10-09T15:00:00.000Z",
        source_medium: "Instagram",
      },
      {
        clinic_id: clinicaA,
        phone_e164: telefone(7),
        name: "Lead X com espaco Unicode no id",
        first_contact_at: "2026-10-10T15:00:00.000Z",
        ctwa_clid: `clid-x3-${sufixo}`,
        source_ad_id: `\u00a0${ANUNCIO_X}\t`,
        source_medium: `${ESPACO_NAO_SEPARAVEL}Instagram${TAB}`,
      },
      {
        clinic_id: clinicaA,
        phone_e164: telefone(8),
        name: "Lead so com o conjunto",
        first_contact_at: "2026-10-11T15:00:00.000Z",
        source_adset_id: "900000000000005001",
        source_medium: "",
      },
      {
        clinic_id: clinicaA,
        phone_e164: telefone(9),
        name: "Lead so com a campanha",
        first_contact_at: "2026-10-12T15:00:00.000Z",
        source_campaign_id: "900000000000006001",
        source_medium: "Facebook",
      },
      {
        clinic_id: clinicaA,
        phone_e164: telefone(10),
        name: "Lead no inicio do periodo",
        first_contact_at: P_DE,
      },
      {
        clinic_id: clinicaA,
        phone_e164: telefone(11),
        name: "Lead no fim do periodo",
        first_contact_at: P_ATE,
        source_ad_id: ANUNCIO_Y,
      },
      {
        clinic_id: clinicaB,
        phone_e164: telefone(6),
        name: "Lead X da B",
        first_contact_at: "2026-10-05T15:00:00.000Z",
        ctwa_clid: `clid-b-${sufixo}`,
        source_ad_id: ANUNCIO_X,
        source_medium: "Facebook",
      },
    ])
    .throwOnError();
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const usuarios = data?.users ?? [];
    for (const usuario of usuarios) {
      if (usuario.email?.includes(`-${sufixo}@teste.dev`)) {
        await admin.auth.admin.deleteUser(usuario.id);
      }
    }
    if (usuarios.length < 200) {
      break;
    }
  }
});

describe("anuncio_do_whatsapp: leitura", () => {
  it("todo membro ativo de A lê os detalhes da A e nada da B", async () => {
    for (const papel of [
      "admin-a",
      "gestor-a",
      "recepcao-a",
      "leitura-a",
      "prof-a",
    ]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente
        .from("anuncio_do_whatsapp")
        .select("clinic_id, ad_id, titulo, descricao, link");
      expect(error).toBeNull();
      expect(data).toEqual([
        {
          clinic_id: clinicaA,
          ad_id: ANUNCIO_X,
          titulo: "Limpeza de pele com 30% de desconto",
          descricao: "Agende sua avaliação.\nVagas limitadas.",
          link: "https://fb.me/ensaioX",
        },
      ]);
      const { data: daB } = await cliente
        .from("anuncio_do_whatsapp")
        .select("ad_id")
        .eq("clinic_id", clinicaB);
      expect(daB).toEqual([]);
    }
  });

  it("o admin da B lê só a B; o pendente da A não lê nada (contraprova: o sistema vê as duas)", async () => {
    const b = await logado("admin-b");
    const { data: daB } = await b
      .from("anuncio_do_whatsapp")
      .select("clinic_id, titulo");
    expect(daB).toEqual([
      { clinic_id: clinicaB, titulo: "Anúncio da clínica B" },
    ]);

    const pendente = await logado("pendente-a");
    const { data: doPendente, error } = await pendente
      .from("anuncio_do_whatsapp")
      .select("ad_id");
    expect(error).toBeNull();
    expect(doPendente).toEqual([]);

    const { data: tudo } = await admin
      .from("anuncio_do_whatsapp")
      .select("clinic_id")
      .in("clinic_id", [clinicaA, clinicaB]);
    expect(tudo).toHaveLength(2);
  });

  it("anon não lê (sem grant)", async () => {
    const { error } = await anonClient()
      .from("anuncio_do_whatsapp")
      .select("ad_id");
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });
});

describe("anuncio_do_whatsapp: ninguém escreve pela sessão", () => {
  it("nem o admin insere, altera ou apaga (42501), e a linha fica como estava", async () => {
    const cliente = await logado("admin-a");
    const inserir = await cliente.from("anuncio_do_whatsapp").insert({
      clinic_id: clinicaA,
      ad_id: "900000000000000199",
      titulo: "Forjado",
    });
    expect(inserir.error?.code).toBe(PERMISSAO_NEGADA);
    const alterar = await cliente
      .from("anuncio_do_whatsapp")
      .update({ titulo: "Forjado" })
      .eq("clinic_id", clinicaA);
    expect(alterar.error?.code).toBe(PERMISSAO_NEGADA);
    const apagar = await cliente
      .from("anuncio_do_whatsapp")
      .delete()
      .eq("clinic_id", clinicaA);
    expect(apagar.error?.code).toBe(PERMISSAO_NEGADA);

    const { data } = await admin
      .from("anuncio_do_whatsapp")
      .select("titulo")
      .eq("clinic_id", clinicaA);
    expect(data).toEqual([{ titulo: "Limpeza de pele com 30% de desconto" }]);
  });

  it("a sessão e anon não executam registrar_anuncio_do_whatsapp", async () => {
    const args = {
      p_clinic_id: clinicaA,
      p_ad_id: ANUNCIO_X,
      p_titulo: "Forjado pela sessão",
    };
    for (const cliente of [await logado("admin-a"), anonClient()]) {
      const { error } = await cliente.rpc(
        "registrar_anuncio_do_whatsapp",
        args,
      );
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    const { data } = await admin
      .from("anuncio_do_whatsapp")
      .select("titulo")
      .eq("clinic_id", clinicaA)
      .eq("ad_id", ANUNCIO_X)
      .single();
    expect(data?.titulo).toBe("Limpeza de pele com 30% de desconto");
  });
});

describe("registrar_anuncio_do_whatsapp (o sistema)", () => {
  const ANUNCIO_NOVO = "900000000000000150";

  async function linhaDoNovo() {
    const { data } = await admin
      .from("anuncio_do_whatsapp")
      .select("titulo, descricao, link, plataforma, tipo, texto_visto_em")
      .eq("clinic_id", clinicaB)
      .eq("ad_id", ANUNCIO_NOVO)
      .single();
    return data;
  }

  it("inserido, sem_mudanca, atualizado só no campo que veio, sem_detalhes", async () => {
    const primeiro = await registrar({
      p_clinic_id: clinicaB,
      p_ad_id: ANUNCIO_NOVO,
      p_titulo: "Título 1",
      p_descricao: "Descrição 1",
      p_plataforma: "Instagram",
      p_visto_em: T1,
    });
    expect(primeiro).toMatchObject({ data: "inserido", error: null });

    // A reentrega: a mesma mensagem, o mesmo horario.
    const repetido = await registrar({
      p_clinic_id: clinicaB,
      p_ad_id: ANUNCIO_NOVO,
      p_titulo: "Título 1",
      p_descricao: "Descrição 1",
      p_plataforma: "Instagram",
      p_visto_em: T1,
    });
    expect(repetido).toMatchObject({ data: "sem_mudanca", error: null });

    const novoTitulo = await registrar({
      p_clinic_id: clinicaB,
      p_ad_id: ANUNCIO_NOVO,
      p_titulo: "Título 2",
      p_descricao: "",
      p_visto_em: T2,
    });
    expect(novoTitulo).toMatchObject({ data: "atualizado", error: null });
    expect(await linhaDoNovo()).toMatchObject({
      titulo: "Título 2",
      descricao: "Descrição 1",
    });
    expect(Date.parse((await linhaDoNovo())!.texto_visto_em as string)).toBe(
      Date.parse(T2),
    );

    const semDetalhes = await registrar({
      p_clinic_id: clinicaB,
      p_ad_id: "900000000000000151",
      p_plataforma: "Facebook",
    });
    expect(semDetalhes).toMatchObject({ data: "sem_detalhes", error: null });
  });

  it("mensagem mais velha que a do texto não volta o texto; plataforma e tipo só preenchem o vazio", async () => {
    // A reentrega atrasada (T1, o titulo de antes): nada muda.
    const reentrega = await registrar({
      p_clinic_id: clinicaB,
      p_ad_id: ANUNCIO_NOVO,
      p_titulo: "Título 1",
      p_plataforma: "Instagram",
      p_visto_em: T1,
    });
    expect(reentrega).toMatchObject({ data: "sem_mudanca", error: null });
    // Um clique mais antigo (T0, no Facebook, como post): o tipo estava
    // vazio e a mensagem velha o preenche (campo vazio, qualquer mensagem);
    // o titulo, a descricao e a plataforma ficam.
    const antigo = await registrar({
      p_clinic_id: clinicaB,
      p_ad_id: ANUNCIO_NOVO,
      p_titulo: "Título mais antigo",
      p_descricao: "Descrição mais antiga",
      p_plataforma: "Facebook",
      p_tipo: "post",
      p_visto_em: T0,
    });
    expect(antigo).toMatchObject({ data: "atualizado", error: null });
    expect(await linhaDoNovo()).toMatchObject({
      titulo: "Título 2",
      descricao: "Descrição 1",
      plataforma: "Instagram",
      tipo: "post",
    });

    // O mesmo texto numa mensagem mais nova (T3), no Facebook: a plataforma
    // fica, nada mostrado muda, e o horario do texto avanca.
    const mesmoTexto = await registrar({
      p_clinic_id: clinicaB,
      p_ad_id: ANUNCIO_NOVO,
      p_titulo: "Título 2",
      p_plataforma: "Facebook",
      p_visto_em: T3,
    });
    expect(mesmoTexto).toMatchObject({ data: "sem_mudanca", error: null });
    const depois = await linhaDoNovo();
    expect(depois).toMatchObject({
      titulo: "Título 2",
      plataforma: "Instagram",
    });
    expect(Date.parse(depois!.texto_visto_em as string)).toBe(Date.parse(T3));
  });

  it("campo vazio, qualquer mensagem preenche; horário no futuro vale agora", async () => {
    const anuncio = "900000000000000160";
    expect(
      await registrar({
        p_clinic_id: clinicaB,
        p_ad_id: anuncio,
        p_titulo: "Só o título",
        p_visto_em: T2,
      }),
    ).toMatchObject({ data: "inserido", error: null });
    // Mensagem mais velha: preenche descricao e link, nao troca o titulo.
    expect(
      await registrar({
        p_clinic_id: clinicaB,
        p_ad_id: anuncio,
        p_titulo: "Título velho",
        p_descricao: "Descrição velha",
        p_link: "https://fb.me/ensaioVelho",
        p_visto_em: T0,
      }),
    ).toMatchObject({ data: "atualizado", error: null });
    const { data: preenchida } = await admin
      .from("anuncio_do_whatsapp")
      .select("titulo, descricao, link")
      .eq("clinic_id", clinicaB)
      .eq("ad_id", anuncio)
      .single();
    expect(preenchida).toEqual({
      titulo: "Só o título",
      descricao: "Descrição velha",
      link: "https://fb.me/ensaioVelho",
    });

    // Horario forjado la na frente: troca (e mais novo), mas o horario
    // guardado e o de agora, nunca o do futuro.
    const antes = Date.now();
    expect(
      await registrar({
        p_clinic_id: clinicaB,
        p_ad_id: anuncio,
        p_titulo: "Título do futuro",
        p_visto_em: "2099-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({ data: "atualizado", error: null });
    const { data: futuro } = await admin
      .from("anuncio_do_whatsapp")
      .select("titulo, texto_visto_em")
      .eq("clinic_id", clinicaB)
      .eq("ad_id", anuncio)
      .single();
    expect(futuro?.titulo).toBe("Título do futuro");
    expect(Date.parse(futuro!.texto_visto_em as string)).toBeLessThan(
      antes + 60_000,
    );
  });

  it("recusa id fora do formato, título com quebra e link sem https (23514); sem clínica, 22023", async () => {
    for (const args of [
      { p_ad_id: "abc", p_titulo: "x" },
      { p_ad_id: ANUNCIO_NOVO, p_titulo: "linha 1\nlinha 2" },
      { p_ad_id: ANUNCIO_NOVO, p_titulo: "linha 1\u2028linha 2" },
      { p_ad_id: ANUNCIO_NOVO, p_titulo: "parágrafo 1\u2029parágrafo 2" },
      { p_ad_id: ANUNCIO_NOVO, p_link: "http://fb.me/x" },
      { p_ad_id: ANUNCIO_NOVO, p_titulo: "x", p_tipo: "reel" },
    ]) {
      const { error } = await registrar({ p_clinic_id: clinicaB, ...args });
      expect(error?.code).toBe("23514");
    }
    // Clinica nula explicita: sem o argumento, o PostgREST nem acha a
    // funcao (PGRST202) e a regra do banco nao chega a rodar.
    const { error } = await registrar({
      p_clinic_id: null,
      p_ad_id: ANUNCIO_NOVO,
      p_titulo: "x",
    });
    expect(error?.code).toBe("22023");
  });
});

describe("anuncios_do_periodo", () => {
  async function periodo(papel: string | null, clinicId: string) {
    const cliente = papel ? await logado(papel) : anonClient();
    return cliente.rpc("anuncios_do_periodo", {
      p_clinic_id: clinicId,
      p_de: P_DE,
      p_ate: P_ATE,
    });
  }

  const ESPERADO_A: Bloco = {
    leads: 9,
    linhas: [
      {
        ad_id: ANUNCIO_X,
        titulo: "Limpeza de pele com 30% de desconto",
        nome_na_meta: null,
        leads: 3,
        agendaram: 0,
        compareceram: 0,
        descricao: "Agende sua avaliação.\nVagas limitadas.",
        link: "https://fb.me/ensaioX",
        // O Instagram com NBSP e tab nas pontas e o mesmo Instagram.
        plataformas: [
          { plataforma: "Instagram", leads: 2 },
          { plataforma: "Facebook", leads: 1 },
        ],
      },
      {
        ad_id: ANUNCIO_Y,
        titulo: null,
        nome_na_meta: "Nome do Y na Meta",
        leads: 1,
        agendaram: 0,
        compareceram: 0,
        descricao: null,
        link: null,
        plataformas: [{ plataforma: null, leads: 1 }],
      },
    ],
    // Empate em 1: a plataforma em ordem de byte, a nula (o vazio) por
    // ultimo.
    nao_identificado: {
      leads: 3,
      agendaram: 0,
      compareceram: 0,
      plataformas: [
        { plataforma: "Facebook", leads: 1 },
        { plataforma: "Instagram", leads: 1 },
        { plataforma: null, leads: 1 },
      ],
    },
    sem_anuncio: { leads: 2, agendaram: 0, compareceram: 0 },
  };

  it("os mesmos números para todo papel que lê a clínica, e a soma bate com o funil", async () => {
    for (const papel of ["admin-a", "gestor-a", "recepcao-a", "leitura-a"]) {
      const { data, error } = await periodo(papel, clinicaA);
      expect(error).toBeNull();
      expect(data as Bloco).toEqual(ESPERADO_A);
    }
    const cliente = await logado("admin-a");
    const { data: funil } = await cliente.rpc("funil_do_periodo", {
      p_clinic_id: clinicaA,
      p_de: P_DE,
      p_ate: P_ATE,
    });
    expect(
      (funil as { atual: { coorte: { leads: number } } }).atual.coorte.leads,
    ).toBe(ESPERADO_A.leads);
  });

  it("as plataformas somam os leads de cada linha e de nao_identificado, para todo papel que lê", async () => {
    const somar = (lista: Plataforma[]) =>
      lista.reduce((total, item) => total + item.leads, 0);
    for (const papel of ["admin-a", "gestor-a", "recepcao-a", "leitura-a"]) {
      const { data, error } = await periodo(papel, clinicaA);
      expect(error).toBeNull();
      const bloco = data as Bloco;
      for (const linha of bloco.linhas) {
        expect(linha.plataformas.length).toBeGreaterThan(0);
        expect(somar(linha.plataformas)).toBe(linha.leads);
      }
      expect(somar(bloco.nao_identificado.plataformas)).toBe(
        bloco.nao_identificado.leads,
      );
      // O organico com plataforma nao entra: so os leads de anuncio.
      const deAnuncio =
        bloco.linhas.reduce((total, linha) => total + linha.leads, 0) +
        bloco.nao_identificado.leads;
      expect(
        bloco.linhas.reduce(
          (total, linha) => total + somar(linha.plataformas),
          0,
        ) + somar(bloco.nao_identificado.plataformas),
      ).toBe(deAnuncio);
    }
  });

  it("outra clínica vê zeros; o profissional, null; anon, 42501", async () => {
    const { data: daB, error } = await periodo("admin-b", clinicaA);
    expect(error).toBeNull();
    expect(daB).toEqual({
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
    // Contraprova: a B ve o proprio lead do X, com o titulo da B.
    const { data: propria } = await periodo("admin-b", clinicaB);
    expect((propria as Bloco).linhas).toEqual([
      {
        ad_id: ANUNCIO_X,
        titulo: "Anúncio da clínica B",
        nome_na_meta: null,
        leads: 1,
        agendaram: 0,
        compareceram: 0,
        // A linha da B so tem o titulo: o texto e o link da A nao vazam.
        descricao: null,
        link: null,
        plataformas: [{ plataforma: "Facebook", leads: 1 }],
      },
    ]);

    const { data: doProfissional, error: erroDoProfissional } = await periodo(
      "prof-a",
      clinicaA,
    );
    expect(erroDoProfissional).toBeNull();
    expect(doProfissional).toBeNull();

    const { error: erroAnon } = await periodo(null, clinicaA);
    expect(erroAnon?.code).toBe(PERMISSAO_NEGADA);
  });
});
