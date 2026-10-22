import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Onda 5, item 18 (migration 20261025110000_implementador.sql): o papel
// Implementador pela API, com JWT real de cada papel. No banco ele e um
// vinculo 'admin' com a marca em membro_implementador (P18-1 b-i do dono,
// 21/10/2026). O que esta em jogo:
// - paridade com o administrador numa tabela de cada lista de papeis:
//   clinic (editar, so admin) e message_template (so admin); campaign_link
//   e audit_log (admin e gestor); waitlist (admin, gestor e recepcao);
//   contact e message (leitura e escrita); as tres funcoes de acesso
//   respondem igual para os dois (contraprova: o gestor e a recepcao sao
//   barrados nas mesmas operacoes);
// - isolamento A contra B nos dois sentidos, com contraprova;
// - a marca: so o administrador pleno marca e desmarca; ninguem marca a si
//   mesmo; gestor, recepcao, o proprio Implementador e o administrador da
//   outra clinica recebem 42501 (ou 0 linhas no DELETE); quem le a marca;
// - P18-2: o Implementador nao promove a administrador, nao rebaixa, nao
//   desativa nem exclui administrador ou outro Implementador; mexe em quem
//   nao e administrador, como o gestor;
// - P18-3: o administrador pleno unico nao sai com um Implementador ativo
//   (nem pela service role, nem excluindo o proprio vinculo), e a service
//   role nao marca o ultimo administrador pleno;
// - o gatilho de limpeza: admin para gestor apaga a marca;
// - user_e_implementador e user_e_admin_pleno por papel; admins_plenos_ativos
//   so pela service role; anon sem grant.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// Rodar DEPOIS da onda 1 aplicada (as funcoes de acesso na versao dela) e
// da migration 20261025110000. CUIDADO, o banco e o da producao: clinicas
// e_de_teste (o motor de producao as ignora), apagadas no afterAll (vinculos,
// marcas, contatos, conversas e a trilha vao em cascata) e depois os
// usuarios desta execucao. Nada aqui usa a id da salud-care, da teste123
// nem da Conduzza Teste; telefones ficticios. ESCRITO, AINDA NAO RODADO
// (roda depois de aplicar a migration: npm run test:rls -- implementador).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// conferir e depois apagar, NESTA ORDEM (as clinicas primeiro: a trilha
// delas, que segura os usuarios, vai junto).
//   select id, name from public.clinic where slug like 'implementador-rls-%';
//   delete from public.clinic where slug like 'implementador-rls-%';
//   select u.id, u.email from auth.users u where u.email like 'implementador-%@teste.dev';
//   delete from auth.users u where u.email like 'implementador-%@teste.dev';

const PERMISSAO_NEGADA = "42501";
const SO_ADMINISTRADOR_CRIA =
  "Somente um administrador cria outro administrador.";
const SO_ADMINISTRADOR_ALTERA =
  "Somente um administrador altera o acesso de outro administrador.";
const SO_ADMINISTRADOR_REMOVE =
  "Somente um administrador remove outro administrador.";
const PRECISA_DE_ADMINISTRADOR =
  "A clínica precisa de pelo menos um administrador ativo.";
const PROPRIO_PAPEL = "Você não altera o próprio papel.";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `Implementador!Rls${sufixo}`;

const email = (papel: string) => `implementador-${papel}-${sufixo}@teste.dev`;

let clinicaA = "";
let clinicaB = "";
/** A conversa sintetica da clinica A (a escrita de mensagem pela sessao). */
let conversaA = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string } | null;

function idDe(papel: string): string {
  const id = ids.get(papel);
  if (!id) {
    throw new Error(`sem usuário ${papel}`);
  }
  return id;
}

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Implementador RLS ${nome} ${sufixo}`,
      slug: `implementador-rls-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarUsuario(
  papelNoEmail: string,
  clinicId: string | null,
  role: string,
  opcoes: { status?: string; professionalId?: string } = {},
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papelNoEmail),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Implementador ${papelNoEmail}` },
  });
  if (error || !data.user) {
    throw new Error(
      `criar ${papelNoEmail}: ${error?.message ?? "sem usuário"}`,
    );
  }
  ids.set(papelNoEmail, data.user.id);
  if (!clinicId) {
    return;
  }
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: opcoes.status ?? "ativo",
      ...(opcoes.professionalId
        ? { professional_id: opcoes.professionalId }
        : {}),
    })
    .throwOnError();
}

/** A marca pela service role (sem sessao: o gatilho pula a permissao). */
async function marcarPeloServidor(
  clinicId: string,
  papel: string,
): Promise<void> {
  await admin
    .from("membro_implementador")
    .insert({ clinic_id: clinicId, user_id: idDe(papel) })
    .throwOnError();
}

// Uma sessao por papel, reaproveitada (o Auth limita a taxa de login).
const sessoes = new Map<string, SupabaseClient>();

async function logado(papelNoEmail: string): Promise<SupabaseClient> {
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

async function linhasVisiveis(
  cliente: SupabaseClient,
  tabela: string,
  clinicId: string,
  coluna = "clinic_id",
): Promise<number> {
  const { data, error } = await cliente
    .from(tabela)
    .select(coluna)
    .eq(coluna, clinicId);
  expect(error, `${tabela} pela sessao`).toBeNull();
  return (data ?? []).length;
}

/** O vinculo (papel:situacao) e a marca da pessoa, lidos pela service role. */
async function vinculo(clinicId: string, papel: string): Promise<string> {
  const { data: membro } = await admin
    .from("clinic_member")
    .select("role, status")
    .eq("clinic_id", clinicId)
    .eq("user_id", idDe(papel))
    .maybeSingle();
  const { data: marca } = await admin
    .from("membro_implementador")
    .select("user_id")
    .eq("clinic_id", clinicId)
    .eq("user_id", idDe(papel))
    .maybeSingle();
  const m = membro as { role: string; status: string } | null;
  return `${m ? `${m.role}:${m.status}` : "sem vinculo"}:${marca ? "marca" : "sem marca"}`;
}

async function mudarVinculo(
  cliente: SupabaseClient,
  clinicId: string,
  papel: string,
  campos: Record<string, string>,
): Promise<{ error: Erro; linhas: number }> {
  const { data, error } = await cliente
    .from("clinic_member")
    .update(campos)
    .eq("clinic_id", clinicId)
    .eq("user_id", idDe(papel))
    .select("user_id");
  return { error: error as Erro, linhas: (data ?? []).length };
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Implementador" })
    .select("id")
    .single()
    .throwOnError();

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("admin2-a", clinicaA, "admin");
  await criarUsuario("impl-a", clinicaA, "admin");
  await criarUsuario("impl2-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("prof-a", clinicaA, "profissional", {
    professionalId: (prof as { id: string }).id,
  });
  await criarUsuario("pendente-a", clinicaA, "leitura", { status: "pendente" });
  await criarUsuario("admin-b", clinicaB, "admin");
  await criarUsuario("impl-b", clinicaB, "admin");
  await criarUsuario("gestor-b", clinicaB, "gestor");
  await criarUsuario("sem-clinica", null, "");

  await marcarPeloServidor(clinicaA, "impl-a");
  await marcarPeloServidor(clinicaB, "impl-b");

  // Um numero, um contato, uma conversa, uma mensagem e uma linha de trilha
  // em cada clinica (dados sinteticos).
  const digitos = sufixo.replace(/\D/g, "").padEnd(4, "5").slice(0, 4);
  for (const [clinicId, final, quem] of [
    [clinicaA, "1", "admin-a"],
    [clinicaB, "2", "admin-b"],
  ] as const) {
    const numero = await criarNumeroDeTeste(admin, clinicId, {
      nome: "Recepção",
    });
    const { data: contato } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: `+55849785${digitos}${final}`,
        name: "Contato sintético do implementador",
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: conversa } = await admin
      .from("conversation")
      .insert({
        clinic_id: clinicId,
        contact_id: (contato as { id: string }).id,
        whatsapp_account_id: numero.id,
      })
      .select("id")
      .single()
      .throwOnError();
    if (clinicId === clinicaA) {
      conversaA = (conversa as { id: string }).id;
    }
    await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: (conversa as { id: string }).id,
        direction: "entrada",
        author: "paciente",
        content_type: "texto",
        body: "Mensagem sintética do teste",
      })
      .throwOnError();
    await admin
      .from("audit_log")
      .insert({
        clinic_id: clinicId,
        user_id: idDe(quem),
        action: "teste_implementador",
        entity: "clinic",
        entity_id: clinicId,
      })
      .throwOnError();
  }
});

afterAll(async () => {
  // As clinicas primeiro (vinculos, marcas, contatos e a trilha vao em
  // cascata; a trilha segura os usuarios), depois os usuarios desta
  // execucao, com o erro conferido.
  const { error: erroDasClinicas } = await admin
    .from("clinic")
    .delete()
    .in("id", [clinicaA, clinicaB]);
  expect(erroDasClinicas, "apagar as clinicas do teste").toBeNull();
  const falhas: string[] = [];
  for (const id of ids.values()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
});

describe("o implementador vê e faz tudo como o administrador", () => {
  it("as três funções de acesso respondem igual para os dois", async () => {
    for (const papel of ["admin-a", "impl-a"]) {
      const cliente = await logado(papel);
      const { data: ehAdmin } = await cliente.rpc("user_has_role", {
        p_clinic_id: clinicaA,
        p_roles: ["admin"],
      });
      expect(ehAdmin, papel).toBe(true);
      const { data: escreve } = await cliente.rpc("user_can_write", {
        p_clinic_id: clinicaA,
      });
      expect(escreve, papel).toBe(true);
      const { data: ativas } = await cliente.rpc("user_active_clinic_ids");
      expect(ativas as string[], papel).toContain(clinicaA);
    }
  });

  it("edita a clínica e os modelos (só admin), como o administrador", async () => {
    for (const papel of ["admin-a", "impl-a"]) {
      const cliente = await logado(papel);
      const { data: clinica } = await cliente
        .from("clinic")
        .update({ name: `Implementador RLS A ${sufixo}` })
        .eq("id", clinicaA)
        .select("id");
      expect(clinica, papel).toHaveLength(1);
      const { data: modelo, error } = await cliente
        .from("message_template")
        .insert({
          clinic_id: clinicaA,
          name: `Modelo de ${papel}`,
          category: "utility",
          body: "Texto de teste",
        })
        .select("id")
        .single();
      expect(error, papel).toBeNull();
      const { data: removido } = await cliente
        .from("message_template")
        .delete()
        .eq("id", (modelo as { id: string }).id)
        .select("id");
      expect(removido, papel).toHaveLength(1);
    }
    // Contraprova: o gestor nao edita a clinica nem cria modelo.
    const gestor = await logado("gestor-a");
    const { data: nada } = await gestor
      .from("clinic")
      .update({ name: "Sequestrada" })
      .eq("id", clinicaA)
      .select("id");
    expect(nada ?? []).toHaveLength(0);
    const { error: erroModelo } = await gestor.from("message_template").insert({
      clinic_id: clinicaA,
      name: "Modelo do gestor",
      category: "utility",
      body: "Texto",
    });
    expect((erroModelo as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });

  it("cria origem e lê a trilha (admin e gestor), como o administrador", async () => {
    for (const papel of ["admin-a", "impl-a"]) {
      const cliente = await logado(papel);
      const { error } = await cliente.from("campaign_link").insert({
        clinic_id: clinicaA,
        name: `Origem de ${papel}`,
        channel: "offline",
        keywords: ["parceria"],
      });
      expect(error, papel).toBeNull();
      expect(
        await linhasVisiveis(cliente, "audit_log", clinicaA),
        papel,
      ).toBeGreaterThanOrEqual(1);
    }
    // Contraprova: a recepcao nao le a trilha nem cria origem.
    const recepcao = await logado("recepcao-a");
    expect(await linhasVisiveis(recepcao, "audit_log", clinicaA)).toBe(0);
    const { error: erroOrigem } = await recepcao.from("campaign_link").insert({
      clinic_id: clinicaA,
      name: "Origem da recepção",
      channel: "offline",
      keywords: ["parceria"],
    });
    expect((erroOrigem as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });

  it("lê e escreve contatos, mensagens e a lista de espera, como o administrador", async () => {
    const contagens: Record<string, number[]> = { contact: [], message: [] };
    for (const [i, papel] of ["admin-a", "impl-a"].entries()) {
      const cliente = await logado(papel);
      contagens.contact!.push(
        await linhasVisiveis(cliente, "contact", clinicaA),
      );
      contagens.message!.push(
        await linhasVisiveis(cliente, "message", clinicaA),
      );
      const { data: contato, error } = await cliente
        .from("contact")
        .insert({
          clinic_id: clinicaA,
          phone_e164: `+55849786${String(Date.now() % 10_000).padStart(4, "0")}${i}`,
          name: "Contato sintético",
        })
        .select("id")
        .single();
      expect(error, papel).toBeNull();
      const { error: erroEspera } = await cliente.from("waitlist").insert({
        clinic_id: clinicaA,
        contact_id: (contato as { id: string }).id,
      });
      expect(erroEspera, papel).toBeNull();
      // A escrita de mensagem pela sessao (policy "membro com escrita
      // escreve mensagem": user_can_write, saida, autor = quem grava, na
      // conversa da mesma clinica): a nota interna do Inbox.
      const { error: erroMensagem } = await cliente.from("message").insert({
        clinic_id: clinicaA,
        conversation_id: conversaA,
        direction: "saida",
        author: "usuario",
        author_user_id: idDe(papel),
        content_type: "texto",
        body: "Nota sintética do teste",
        is_internal_note: true,
      });
      expect(erroMensagem, papel).toBeNull();
    }
    // O implementador leu o mesmo que o administrador (o contato e a nota do
    // administrador entraram antes da leitura do implementador: +1).
    expect(contagens.contact![1]).toBe(contagens.contact![0]! + 1);
    expect(contagens.message![1]).toBe(contagens.message![0]! + 1);
    // Contraprova: a leitura nao grava mensagem (42501, a mesma nota) nem
    // poe ninguem na lista de espera.
    const leitura = await logado("leitura-a");
    const { error: erroMensagemDaLeitura } = await leitura
      .from("message")
      .insert({
        clinic_id: clinicaA,
        conversation_id: conversaA,
        direction: "saida",
        author: "usuario",
        author_user_id: idDe("leitura-a"),
        content_type: "texto",
        body: "Nota sintética da leitura",
        is_internal_note: true,
      });
    expect((erroMensagemDaLeitura as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { data: algum } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicaA)
      .limit(1)
      .single()
      .throwOnError();
    const { error: erroLeitura } = await leitura.from("waitlist").insert({
      clinic_id: clinicaA,
      contact_id: (algum as { id: string }).id,
    });
    expect((erroLeitura as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });
});

describe("isolamento entre clínicas", () => {
  it("o implementador da A não lê nem escreve na B, e o da B não lê a A", async () => {
    // Contraprova: as duas tem contato e marca.
    expect(
      await linhasVisiveis(admin, "contact", clinicaB),
    ).toBeGreaterThanOrEqual(1);
    expect(await linhasVisiveis(admin, "membro_implementador", clinicaB)).toBe(
      1,
    );
    expect(await linhasVisiveis(admin, "membro_implementador", clinicaA)).toBe(
      1,
    );

    const implA = await logado("impl-a");
    expect(await linhasVisiveis(implA, "contact", clinicaB)).toBe(0);
    expect(await linhasVisiveis(implA, "membro_implementador", clinicaB)).toBe(
      0,
    );
    const { error: erroContato } = await implA.from("contact").insert({
      clinic_id: clinicaB,
      phone_e164: "+5584978559999",
      name: "Invasão",
    });
    // Barrado antes da RLS: o gatilho validar_etapa_do_contato (BEFORE
    // INSERT) le a jornada com a sessao de quem grava, nao enxerga a da B e
    // recusa com 23514; sem ele, a policy recusaria com 42501. O que importa
    // e que nada entra na B (conferido pelo sistema logo abaixo).
    expect(["23514", PERMISSAO_NEGADA]).toContain((erroContato as Erro)?.code);
    const { count: invasoes } = await admin
      .from("contact")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaB)
      .eq("phone_e164", "+5584978559999");
    expect(invasoes).toBe(0);
    const { error: erroMarca } = await implA
      .from("membro_implementador")
      .insert({ clinic_id: clinicaB, user_id: idDe("gestor-b") });
    expect((erroMarca as Erro)?.code).toBe(PERMISSAO_NEGADA);

    const implB = await logado("impl-b");
    expect(await linhasVisiveis(implB, "contact", clinicaA)).toBe(0);
    expect(await linhasVisiveis(implB, "membro_implementador", clinicaA)).toBe(
      0,
    );
    const adminB = await logado("admin-b");
    const { data: desmarcadas } = await adminB
      .from("membro_implementador")
      .delete()
      .eq("clinic_id", clinicaA)
      .select("user_id");
    expect(desmarcadas ?? []).toHaveLength(0);
    expect(await vinculo(clinicaA, "impl-a")).toBe("admin:ativo:marca");
  });
});

describe("a marca: quem marca, quem desmarca e quem lê", () => {
  it("gestor, recepção, o implementador e o administrador da outra clínica não marcam (42501)", async () => {
    for (const papel of ["gestor-a", "recepcao-a", "impl-a", "admin-b"]) {
      const cliente = await logado(papel);
      const { error } = await cliente
        .from("membro_implementador")
        .insert({ clinic_id: clinicaA, user_id: idDe("admin2-a") });
      expect((error as Erro)?.code, papel).toBe(PERMISSAO_NEGADA);
    }
    expect(await vinculo(clinicaA, "admin2-a")).toBe("admin:ativo:sem marca");
  });

  it("ninguém marca a si mesmo; só vínculo de administrador vira implementador", async () => {
    const adminA = await logado("admin-a");
    const { error: erroSi } = await adminA
      .from("membro_implementador")
      .insert({ clinic_id: clinicaA, user_id: idDe("admin-a") });
    expect((erroSi as Erro)?.message).toBe(PROPRIO_PAPEL);
    const { error: erroRecepcao } = await adminA
      .from("membro_implementador")
      .insert({ clinic_id: clinicaA, user_id: idDe("recepcao-a") });
    expect((erroRecepcao as Erro)?.message).toBe(
      "Só um administrador da clínica pode ser implementador.",
    );
  });

  it("o administrador pleno marca e desmarca; o implementador e o gestor não desmarcam", async () => {
    const adminA = await logado("admin-a");
    const { error } = await adminA
      .from("membro_implementador")
      .insert({ clinic_id: clinicaA, user_id: idDe("admin2-a") });
    expect(error).toBeNull();
    expect(await vinculo(clinicaA, "admin2-a")).toBe("admin:ativo:marca");

    for (const papel of ["impl-a", "gestor-a"]) {
      const cliente = await logado(papel);
      const { data } = await cliente
        .from("membro_implementador")
        .delete()
        .eq("clinic_id", clinicaA)
        .select("user_id");
      expect(data ?? [], papel).toHaveLength(0);
    }
    expect(await vinculo(clinicaA, "impl-a")).toBe("admin:ativo:marca");

    const { data: desmarcada } = await adminA
      .from("membro_implementador")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("admin2-a"))
      .select("user_id");
    expect(desmarcada).toHaveLength(1);
    expect(await vinculo(clinicaA, "admin2-a")).toBe("admin:ativo:sem marca");
  });

  it("lê a marca o próprio, o membro ativo e ninguém mais", async () => {
    for (const papel of [
      "impl-a",
      "admin-a",
      "gestor-a",
      "recepcao-a",
      "leitura-a",
      "prof-a",
    ]) {
      expect(
        await linhasVisiveis(
          await logado(papel),
          "membro_implementador",
          clinicaA,
        ),
        papel,
      ).toBe(1);
    }
    for (const papel of ["pendente-a", "admin-b", "sem-clinica"]) {
      expect(
        await linhasVisiveis(
          await logado(papel),
          "membro_implementador",
          clinicaA,
        ),
        papel,
      ).toBe(0);
    }
    const { error } = await anonClient()
      .from("membro_implementador")
      .select("user_id")
      .eq("clinic_id", clinicaA);
    expect((error as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });

  it("user_e_implementador e user_e_admin_pleno por papel", async () => {
    const esperado: [string, boolean, boolean][] = [
      ["admin-a", false, true],
      ["admin2-a", false, true],
      ["impl-a", true, false],
      ["gestor-a", false, false],
      ["recepcao-a", false, false],
      ["leitura-a", false, false],
      ["prof-a", false, false],
      ["pendente-a", false, false],
      ["admin-b", false, false],
      ["sem-clinica", false, false],
    ];
    for (const [papel, implementador, pleno] of esperado) {
      const cliente = await logado(papel);
      const { data: ehImplementador } = await cliente.rpc(
        "user_e_implementador",
        {
          p_clinic_id: clinicaA,
        },
      );
      const { data: ehPleno } = await cliente.rpc("user_e_admin_pleno", {
        p_clinic_id: clinicaA,
      });
      expect([ehImplementador, ehPleno], papel).toEqual([implementador, pleno]);
    }
    const { error } = await anonClient().rpc("user_e_implementador", {
      p_clinic_id: clinicaA,
    });
    expect((error as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });

  it("admins_plenos_ativos: a sessão não executa; a service role conta", async () => {
    const { error } = await (
      await logado("admin-a")
    ).rpc("admins_plenos_ativos", {
      p_clinic_id: clinicaA,
    });
    expect((error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { data, error: erroServidor } = await admin.rpc(
      "admins_plenos_ativos",
      {
        p_clinic_id: clinicaA,
      },
    );
    expect(erroServidor).toBeNull();
    // admin-a, admin2-a e impl2-a; impl-a tem a marca.
    expect(data).toBe(3);
  });
});

describe("P18-2: o implementador não mexe em administrador", () => {
  it("não promove ninguém a administrador", async () => {
    const implA = await logado("impl-a");
    const { error: erroConvite } = await implA.from("clinic_member").insert({
      clinic_id: clinicaA,
      user_id: idDe("sem-clinica"),
      role: "admin",
      status: "ativo",
    });
    expect((erroConvite as Erro)?.message).toBe(SO_ADMINISTRADOR_CRIA);
    const { error: erroPromover } = await mudarVinculo(
      implA,
      clinicaA,
      "recepcao-a",
      {
        role: "admin",
      },
    );
    expect(erroPromover?.message).toBe(SO_ADMINISTRADOR_CRIA);
    const { error: erroRpc } = await implA.rpc("entrar_como_implementador", {
      p_clinic_id: clinicaA,
      p_user_id: idDe("recepcao-a"),
      p_situacao_lida: "ativo",
      p_papel_lido: "recepcao",
    });
    expect((erroRpc as Erro)?.code).toBe(PERMISSAO_NEGADA);
    expect(await vinculo(clinicaA, "recepcao-a")).toBe(
      "recepcao:ativo:sem marca",
    );
  });

  it.each(["admin-a", "admin2-a", "impl2-a"])(
    "não rebaixa, não desativa nem exclui %s",
    async (alvo) => {
      if (alvo === "impl2-a") {
        // O alvo e outro implementador.
        await marcarPeloServidor(clinicaA, "impl2-a");
      }
      const implA = await logado("impl-a");
      const rebaixar = await mudarVinculo(implA, clinicaA, alvo, {
        role: "gestor",
      });
      expect(rebaixar.error?.message).toBe(SO_ADMINISTRADOR_ALTERA);
      const desativar = await mudarVinculo(implA, clinicaA, alvo, {
        status: "inativo",
      });
      expect(desativar.error?.message).toContain("Somente um administrador");
      const { error: erroExcluir } = await implA
        .from("clinic_member")
        .delete()
        .eq("clinic_id", clinicaA)
        .eq("user_id", idDe(alvo));
      expect((erroExcluir as Erro)?.message).toBe(SO_ADMINISTRADOR_REMOVE);
      expect(await vinculo(clinicaA, alvo)).toMatch(/^admin:ativo:/);
    },
  );

  it("mexe em quem não é administrador, como o gestor", async () => {
    const implA = await logado("impl-a");
    const promover = await mudarVinculo(implA, clinicaA, "leitura-a", {
      role: "recepcao",
    });
    expect(promover.error).toBeNull();
    expect(promover.linhas).toBe(1);
    const voltar = await mudarVinculo(implA, clinicaA, "leitura-a", {
      role: "leitura",
    });
    expect(voltar.linhas).toBe(1);
    expect(await vinculo(clinicaA, "leitura-a")).toBe(
      "leitura:ativo:sem marca",
    );
  });
});

describe("P18-3: a clínica sempre tem um administrador pleno ativo", () => {
  // Na B: admin-b e o unico pleno, impl-b e implementador.
  it("o único administrador pleno não sai com um implementador ativo, nem pela service role", async () => {
    const desativar = await mudarVinculo(admin, clinicaB, "admin-b", {
      status: "inativo",
    });
    expect(desativar.error?.message).toBe(PRECISA_DE_ADMINISTRADOR);
    const rebaixar = await mudarVinculo(admin, clinicaB, "admin-b", {
      role: "gestor",
    });
    expect(rebaixar.error?.message).toBe(PRECISA_DE_ADMINISTRADOR);
    const { error: erroExcluir } = await admin
      .from("clinic_member")
      .delete()
      .eq("clinic_id", clinicaB)
      .eq("user_id", idDe("admin-b"));
    expect((erroExcluir as Erro)?.message).toBe(PRECISA_DE_ADMINISTRADOR);
    // Nem excluindo o proprio vinculo pela sessao.
    const { error: erroProprio } = await (
      await logado("admin-b")
    )
      .from("clinic_member")
      .delete()
      .eq("clinic_id", clinicaB)
      .eq("user_id", idDe("admin-b"));
    expect((erroProprio as Erro)?.message).toBe(PRECISA_DE_ADMINISTRADOR);
    expect(await vinculo(clinicaB, "admin-b")).toBe("admin:ativo:sem marca");
  });

  it("a service role não marca o último administrador pleno", async () => {
    const { error } = await admin
      .from("membro_implementador")
      .insert({ clinic_id: clinicaB, user_id: idDe("admin-b") });
    expect((error as Erro)?.message).toBe(PRECISA_DE_ADMINISTRADOR);
    expect(await vinculo(clinicaB, "admin-b")).toBe("admin:ativo:sem marca");
  });

  it("com outro administrador pleno, sai e volta (contraprova)", async () => {
    const desativar = await mudarVinculo(admin, clinicaA, "admin2-a", {
      status: "inativo",
    });
    expect(desativar.error).toBeNull();
    expect(desativar.linhas).toBe(1);
    const reativar = await mudarVinculo(admin, clinicaA, "admin2-a", {
      status: "ativo",
    });
    expect(reativar.linhas).toBe(1);
  });
});

describe("a marca acompanha o papel", () => {
  it("administrador para gestor apaga a marca; voltar a administrador não marca sozinho", async () => {
    const adminA = await logado("admin-a");
    expect(await vinculo(clinicaA, "impl2-a")).toBe("admin:ativo:marca");
    const rebaixar = await mudarVinculo(adminA, clinicaA, "impl2-a", {
      role: "gestor",
    });
    expect(rebaixar.linhas).toBe(1);
    expect(await vinculo(clinicaA, "impl2-a")).toBe("gestor:ativo:sem marca");
    const voltar = await mudarVinculo(adminA, clinicaA, "impl2-a", {
      role: "admin",
    });
    expect(voltar.linhas).toBe(1);
    expect(await vinculo(clinicaA, "impl2-a")).toBe("admin:ativo:sem marca");
  });
});
