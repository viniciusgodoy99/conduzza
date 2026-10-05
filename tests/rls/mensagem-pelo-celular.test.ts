import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Mensagem enviada pelo celular pareado (migration 20261005120000), pela API
// com JWT real de cada papel. O que esta em jogo:
//   - message.pelo_celular herda a RLS de message: a clinica A nunca le a
//     mensagem do celular da B; o profissional so a ve na conversa atribuida
//     a ele; o pendente nao ve nada.
//   - registrar_mensagem_do_celular, adotar_eco_do_envio e
//     reclassificar_resposta_automatica (com o horario de envio, 3
//     argumentos) sao so do service role do webhook, do envio e da
//     ingestao: nenhum papel nem anon executa (42501). A reclassificacao
//     troca a autoria de mensagem e grava o horario de envio do paciente:
//     aberta a sessao, qualquer um reescreveria a primeira resposta das
//     metricas.
//   - espera_pelo_celular_sem_linha (auxiliar da registrar, que derruba a
//     espera sem gravar linha) nao e de ninguem: nem papel, nem anon, nem o
//     proprio service role a chamam direto (42501); ela so roda dentro da
//     registrar.
//   - Nenhuma sessao grava o rotulo: a policy de INSERT (usuario exige
//     author_user_id = auth.uid(); sistema exige content_type 'evento') e o
//     CHECK message_pelo_celular_coerente (sem pessoa, sem evento) juntos
//     recusam toda combinacao. Sem policy de UPDATE, ninguem liga nem
//     desliga o rotulo depois.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).

const RLS_VIOLATION = "42501";
const CHECK_VIOLATION = "23514";
const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "PeloCelular!Rls2026";

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
let telefoneA = "";
let conversaA = "";
let contatoA = "";
let celularA = "";
let celularB = "";
let entradaA = "";
const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();

const email = (apelido: string) =>
  `pelo-celular-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  status: "ativo" | "pendente" = "ativo",
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(apelido),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: apelido },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(apelido, data.user.id);
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinicId, user_id: data.user.id, role, status })
    .throwOnError();
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email: email(apelido),
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  clientes.set(apelido, cliente);
}

/** Contato com consentimento e a conversa aberta dele no numero. */
async function contatoComConversa(
  clinicId: string,
  numeroId: string,
  telefone: string,
): Promise<{ contactId: string; conversationId: string }> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone, name: "Paciente" })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      channel: "whatsapp",
      source: "recepcao",
    })
    .throwOnError();
  const { data: conversa } = await admin
    .rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
      p_whatsapp_account_id: numeroId,
    })
    .throwOnError();
  return { contactId, conversationId: conversa as unknown as string };
}

/** Grava a mensagem do celular como o webhook grava (service role). */
async function registrarComoWebhook(
  clinicId: string,
  numeroId: string,
  telefone: string,
  waMessageId: string,
): Promise<string> {
  const { data } = await admin
    .rpc("registrar_mensagem_do_celular", {
      p_clinic_id: clinicId,
      p_whatsapp_account_id: numeroId,
      p_phone_e164: telefone,
      p_wa_message_id: waMessageId,
      p_content_type: "texto",
      p_body: "Respondido pelo celular",
    })
    .throwOnError();
  const resultado = data as { inserted: boolean; message_id: string };
  expect(resultado.inserted).toBe(true);
  return resultado.message_id;
}

async function linhasCom(waMessageIds: string[]): Promise<number> {
  const { count } = await admin
    .from("message")
    .select("id", { count: "exact", head: true })
    .in("wa_message_id", waMessageIds)
    .throwOnError();
  return count ?? 0;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Pelo celular A ${sufixo}`,
        slug: `pelo-celular-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Pelo celular B ${sufixo}`,
        slug: `pelo-celular-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `pelo-celular-a-${sufixo}`)!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug === `pelo-celular-b-${sufixo}`)!
    .id as string;

  // Conversa exige numero (contrato da Fase 3).
  numeroA = (await criarNumeroDeTeste(admin, clinicaA)).id;
  const numeroB = (await criarNumeroDeTeste(admin, clinicaB)).id;

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("prof-a", clinicaA, "profissional");
  await criarPessoa("pendente-a", clinicaA, "recepcao", "pendente");
  await criarPessoa("admin-b", clinicaB, "admin");

  telefoneA = `+5584981${sufixo.replace(/\D/g, "0").slice(0, 4)}01`;
  const telefoneB = `+5584981${sufixo.replace(/\D/g, "0").slice(0, 4)}02`;
  const daA = await contatoComConversa(clinicaA, numeroA, telefoneA);
  conversaA = daA.conversationId;
  contatoA = daA.contactId;
  await contatoComConversa(clinicaB, numeroB, telefoneB);

  // Mensagem do paciente da A, de uma hora atras: alvo das chamadas de
  // reclassificar_resposta_automatica. Insert direto, que nao mexe na espera
  // nem na ordem da conversa (e a mensagem do celular, gravada agora, fica
  // fora da janela de 8 s dela).
  const { data: entrada } = await admin
    .from("message")
    .insert({
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: "entrada",
      author: "paciente",
      content_type: "texto",
      body: "Oi",
      billable: false,
      cost_cents: 0,
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  entradaA = entrada!.id as string;

  celularA = await registrarComoWebhook(
    clinicaA,
    numeroA,
    telefoneA,
    `cel-rls:${sufixo}:a`,
  );
  celularB = await registrarComoWebhook(
    clinicaB,
    numeroB,
    telefoneB,
    `cel-rls:${sufixo}:b`,
  );
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const usuario of ids.values()) {
    await admin.auth.admin.deleteUser(usuario);
  }
});

describe("leitura da mensagem pelo celular", () => {
  it("a clínica A não lê a mensagem pelo celular da B (nem filtrando pelo rótulo)", async () => {
    for (const papel of ["admin-a", "gestor-a", "recepcao-a", "leitura-a"]) {
      const porId = await como(papel)
        .from("message")
        .select("id, pelo_celular")
        .eq("id", celularB);
      expect(porId.error, papel).toBeNull();
      expect(porId.data, papel).toEqual([]);

      const peloRotulo = await como(papel)
        .from("message")
        .select("id, clinic_id")
        .eq("pelo_celular", true);
      expect(peloRotulo.error, papel).toBeNull();
      for (const linha of peloRotulo.data ?? []) {
        expect(linha.clinic_id, papel).toBe(clinicaA);
      }
    }
    // Anti falso positivo: a linha da B existe e a B le, com o rotulo.
    const { data } = await admin
      .from("message")
      .select("id")
      .eq("id", celularB)
      .throwOnError();
    expect(data).toHaveLength(1);
    const daB = await como("admin-b")
      .from("message")
      .select("id, pelo_celular, author, author_user_id")
      .eq("id", celularB);
    expect(daB.error).toBeNull();
    expect(daB.data).toEqual([
      {
        id: celularB,
        pelo_celular: true,
        author: "usuario",
        author_user_id: null,
      },
    ]);
  });

  it("a A lê a própria (positivo); o pendente não lê; a B não lê a da A", async () => {
    for (const papel of ["admin-a", "gestor-a", "recepcao-a", "leitura-a"]) {
      const { data, error } = await como(papel)
        .from("message")
        .select("id, pelo_celular")
        .eq("id", celularA);
      expect(error, papel).toBeNull();
      expect(data, papel).toEqual([{ id: celularA, pelo_celular: true }]);
    }
    for (const papel of ["pendente-a", "admin-b"]) {
      const { data, error } = await como(papel)
        .from("message")
        .select("id")
        .eq("id", celularA);
      expect(error, papel).toBeNull();
      expect(data, papel).toEqual([]);
    }
  });

  it("o profissional só vê a mensagem do celular na conversa atribuída a ele", async () => {
    const antes = await como("prof-a")
      .from("message")
      .select("id")
      .eq("id", celularA);
    expect(antes.error).toBeNull();
    expect(antes.data).toEqual([]);

    await admin
      .from("conversation")
      .update({ assignee_user_id: ids.get("prof-a")! })
      .eq("id", conversaA)
      .throwOnError();
    try {
      const depois = await como("prof-a")
        .from("message")
        .select("id, pelo_celular")
        .eq("id", celularA);
      expect(depois.error).toBeNull();
      expect(depois.data).toEqual([{ id: celularA, pelo_celular: true }]);
    } finally {
      await admin
        .from("conversation")
        .update({ assignee_user_id: null })
        .eq("id", conversaA)
        .throwOnError();
    }
  });
});

describe("as três RPCs são só do service role; a auxiliar não é de ninguém", () => {
  it("nenhum papel (nem admin) nem anon executa registrar_mensagem_do_celular, adotar_eco_do_envio, reclassificar_resposta_automatica nem espera_pelo_celular_sem_linha", async () => {
    const sessoes: [string, SupabaseClient][] = [
      ...[
        "admin-a",
        "gestor-a",
        "recepcao-a",
        "leitura-a",
        "prof-a",
        "pendente-a",
        "admin-b",
      ].map((papel): [string, SupabaseClient] => [papel, como(papel)]),
      ["anon", anonClient()],
    ];
    const forjados: string[] = [];
    for (const [papel, cliente] of sessoes) {
      const forjado = `cel-rls:${sufixo}:forjado-${papel}`;
      forjados.push(forjado);
      const registrar = await cliente.rpc("registrar_mensagem_do_celular", {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: numeroA,
        p_phone_e164: telefoneA,
        p_wa_message_id: forjado,
        p_content_type: "texto",
        p_body: "Forjada",
      });
      expect(registrar.error?.code, `${papel} registrou`).toBe(
        PERMISSAO_NEGADA,
      );
      expect(registrar.data, papel).toBeNull();

      const adotar = await cliente.rpc("adotar_eco_do_envio", {
        p_clinic_id: clinicaA,
        p_message_id: celularA,
        p_wa_message_id: `cel-rls:${sufixo}:a`,
      });
      expect(adotar.error?.code, `${papel} adotou`).toBe(PERMISSAO_NEGADA);
      expect(adotar.data, papel).toBeNull();

      const reclassificar = await cliente.rpc(
        "reclassificar_resposta_automatica",
        {
          p_clinic_id: clinicaA,
          p_message_id: entradaA,
          p_enviada_em: new Date().toISOString(),
        },
      );
      expect(reclassificar.error?.code, `${papel} reclassificou`).toBe(
        PERMISSAO_NEGADA,
      );
      expect(reclassificar.data, papel).toBeNull();

      const espera = await cliente.rpc("espera_pelo_celular_sem_linha", {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: numeroA,
        p_phone_e164: telefoneA,
        p_base: new Date().toISOString(),
      });
      expect(espera.error?.code, `${papel} chamou a auxiliar`).toBe(
        PERMISSAO_NEGADA,
      );
      expect(espera.data, papel).toBeNull();
    }
    // Nenhuma sessao gravou o horario de envio na mensagem do paciente.
    const { data: semHorario } = await admin
      .from("message")
      .select("enviada_no_aparelho_em")
      .eq("id", entradaA)
      .single()
      .throwOnError();
    expect(semHorario!.enviada_no_aparelho_em).toBeNull();
    expect(await linhasCom(forjados)).toBe(0);
    // A linha do celular da A continua la, com o rotulo.
    const { data } = await admin
      .from("message")
      .select("id, pelo_celular")
      .eq("id", celularA)
      .throwOnError();
    expect(data).toEqual([{ id: celularA, pelo_celular: true }]);
    // E continua de pessoa: nenhuma sessao a reclassificou.
    const { data: autoria } = await admin
      .from("message")
      .select("author")
      .eq("id", celularA)
      .single()
      .throwOnError();
    expect(autoria!.author).toBe("usuario");

    // Contraprova: o service role executa (a adocao responde false porque a
    // linha da A e do celular, nao um envio nosso; a reclassificacao responde
    // 0 porque a mensagem do paciente chegou bem depois da do celular).
    const { data: peloSistema, error } = await admin.rpc(
      "adotar_eco_do_envio",
      {
        p_clinic_id: clinicaA,
        p_message_id: celularA,
        p_wa_message_id: `cel-rls:${sufixo}:a`,
      },
    );
    expect(error).toBeNull();
    expect(peloSistema).toBe(false);
    const envioDaEntrada = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: reclassificadas, error: erroReclassificar } = await admin.rpc(
      "reclassificar_resposta_automatica",
      {
        p_clinic_id: clinicaA,
        p_message_id: entradaA,
        p_enviada_em: envioDaEntrada,
      },
    );
    expect(erroReclassificar).toBeNull();
    expect(reclassificadas).toBe(0);
    const { data: comHorario } = await admin
      .from("message")
      .select("enviada_no_aparelho_em")
      .eq("id", entradaA)
      .single()
      .throwOnError();
    expect(Date.parse(comHorario!.enviada_no_aparelho_em as string)).toBe(
      Date.parse(envioDaEntrada),
    );
  });

  it("nem o service role chama a auxiliar direto (42501); pela registrar, ela roda", async () => {
    const auxiliar = await admin.rpc("espera_pelo_celular_sem_linha", {
      p_clinic_id: clinicaA,
      p_whatsapp_account_id: numeroA,
      p_phone_e164: telefoneA,
      p_base: new Date().toISOString(),
    });
    expect(auxiliar.error?.code).toBe(PERMISSAO_NEGADA);
    expect(auxiliar.data).toBeNull();

    // Contraprova: a registrar (security definer) chega na auxiliar. O id ja
    // existe na B: colisao, sem linha, com o contato da A devolvido.
    const { data, error } = await admin.rpc("registrar_mensagem_do_celular", {
      p_clinic_id: clinicaA,
      p_whatsapp_account_id: numeroA,
      p_phone_e164: telefoneA,
      p_wa_message_id: `cel-rls:${sufixo}:b`,
      p_content_type: "texto",
      p_body: "Colisão",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      inserted: false,
      ignorada: "colisao_wa_message_id",
      contact_id: contatoA,
      message_id: null,
    });
  });
});

describe("nenhuma sessão grava nem troca o rótulo", () => {
  it("insert com pelo_celular = true é recusado em toda combinação de autor (pela policy ou pelo CHECK)", async () => {
    const base = {
      clinic_id: clinicaA,
      conversation_id: conversaA,
      direction: "saida",
      body: "Forjada como do celular",
      pelo_celular: true,
    };
    const tentativas: [string, string, Record<string, unknown>][] = [
      // A policy aceita (autor e a sessao), o CHECK recusa (tem pessoa).
      [
        "admin-a",
        "usuario com a propria pessoa",
        {
          ...base,
          author: "usuario",
          author_user_id: ids.get("admin-a")!,
          content_type: "texto",
        },
      ],
      // A policy recusa (usuario sem ser a sessao).
      [
        "admin-a",
        "usuario sem pessoa",
        {
          ...base,
          author: "usuario",
          author_user_id: null,
          content_type: "texto",
        },
      ],
      // A policy aceita (evento de sistema), o CHECK recusa (evento).
      [
        "recepcao-a",
        "evento de sistema",
        { ...base, author: "sistema", content_type: "evento" },
      ],
      // A policy recusa (sistema so com evento).
      [
        "gestor-a",
        "texto de sistema",
        { ...base, author: "sistema", content_type: "texto" },
      ],
      // Leitura nunca escreve.
      [
        "leitura-a",
        "leitura",
        {
          ...base,
          author: "usuario",
          author_user_id: ids.get("leitura-a")!,
          content_type: "texto",
        },
      ],
    ];
    for (const [papel, caso, linha] of tentativas) {
      const { error } = await como(papel).from("message").insert(linha);
      expect(
        [RLS_VIOLATION, CHECK_VIOLATION],
        `${papel}, ${caso}: ${error?.code ?? "sem erro"}`,
      ).toContain(error?.code);
    }
    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversaA)
      .eq("pelo_celular", true)
      .throwOnError();
    // So a gravada pelo webhook no preparo.
    expect(count).toBe(1);

    // Anti falso positivo: a mesma sessao grava a mensagem comum (sem o
    // rotulo) na mesma conversa.
    const { data: comum, error: erroComum } = await como("admin-a")
      .from("message")
      .insert({
        ...base,
        pelo_celular: false,
        author: "usuario",
        author_user_id: ids.get("admin-a")!,
        content_type: "texto",
        body: "Mensagem comum",
      })
      .select("id, pelo_celular")
      .single();
    expect(erroComum).toBeNull();
    expect(comum!.pelo_celular).toBe(false);
  });

  it("sem UPDATE pela sessão: ninguém liga nem desliga o rótulo", async () => {
    // Uma mensagem comum de saida (como a regua grava), sem o rotulo.
    const { data: comum } = await admin
      .from("message")
      .insert({
        clinic_id: clinicaA,
        conversation_id: conversaA,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Lembrete",
        billable: false,
        cost_cents: 0,
        delivery_status: "enviada",
      })
      .select("id")
      .single()
      .throwOnError();
    const comumId = comum!.id as string;

    for (const [alvo, valor] of [
      [celularA, false],
      [comumId, true],
    ] as const) {
      const { data, error } = await como("admin-a")
        .from("message")
        .update({ pelo_celular: valor })
        .eq("id", alvo)
        .select("id");
      // Sem policy de UPDATE em message: nenhuma linha casa (ou erro).
      if (!error) {
        expect(data).toEqual([]);
      }
    }
    const { data: depois } = await admin
      .from("message")
      .select("id, pelo_celular")
      .in("id", [celularA, comumId])
      .throwOnError();
    const porId = new Map(
      (depois ?? []).map((l) => [l.id as string, l.pelo_celular as boolean]),
    );
    expect(porId.get(celularA)).toBe(true);
    expect(porId.get(comumId)).toBe(false);
  });
});
