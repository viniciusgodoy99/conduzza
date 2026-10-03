import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// CRM, Leva A (migration 20261002120000), pela API com JWT real de cada
// papel. O que esta em jogo:
//   - Jornada: termos_de_quem e descricao seguem a policy da jornada (admin
//     e gestor gravam; o resto so le; a B nunca ve a da A).
//   - Mensagens padrao (resposta_rapida): membro ATIVO le, admin e gestor
//     escrevem, autoria e sempre a sessao.
//   - Atividades (contact_activity): dado de paciente. Membro ativo le;
//     admin, gestor e recepcao criam em nome proprio e editam; profissional
//     e leitura so leem; pendente nao le; sem DELETE; responsavel e conversa
//     validados pelo banco; carimbos de concluida e cancelada so pelo gatilho.
//   - contagem_de_atividades: a RLS recorta (a B recebe zeros da A).
//   - termo_eco_visto e marcar_eco_para_termo (a marca do eco do celular
//     para o termo-chave): nenhum papel de cliente le, grava nem chama; so o
//     service role do webhook.
// Toda negacao tem o caso positivo ao lado (anti falso positivo). Mesmos
// cenarios do ensaio (scratchpad fluxo/corrigir/banco-a/asserts.sql).

const RLS_VIOLATION = "42501";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "CrmLevaA!Rls2026";
const TZ = "America/Fortaleza";
const hoje = diaCivil(TZ, new Date());

let clinicaA = "";
let clinicaB = "";
let contatoA1 = "";
let contatoA2 = "";
let contatoB = "";
let conversaA1 = "";
let conversaA2 = "";
let conversaB = "";
const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();

const email = (apelido: string) => `crm-leva-a-${apelido}-${sufixo}@teste.dev`;
const id = (apelido: string) => ids.get(apelido)!;
const como = (apelido: string) => clientes.get(apelido)!;

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  status: "ativo" | "pendente" = "ativo",
  professionalId?: string,
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
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status,
      ...(professionalId ? { professional_id: professionalId } : {}),
    })
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

async function novoContato(
  clinicId: string,
  telefone: string,
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone, kind: "lead" })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function novaConversa(
  clinicId: string,
  contactId: string,
  numeroId: string,
): Promise<string> {
  const { data } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      whatsapp_account_id: numeroId,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

type AtividadeNoBanco = {
  status: string;
  titulo: string;
  created_by: string | null;
  completed_by: string | null;
  completed_at: string | null;
  canceled_by: string | null;
  canceled_at: string | null;
  assignee_user_id: string | null;
};

/** A atividade como o banco guardou (service role, sem RLS). */
async function atividadeNoBanco(
  atividadeId: string,
): Promise<AtividadeNoBanco> {
  const { data } = await admin
    .from("contact_activity")
    .select(
      "status, titulo, created_by, completed_by, completed_at, canceled_by, canceled_at, assignee_user_id",
    )
    .eq("id", atividadeId)
    .single()
    .throwOnError();
  return data as AtividadeNoBanco;
}

/** Cria pela sessao do apelido e devolve o id (falha alto se recusar). */
async function criarAtividade(
  apelido: string,
  campos: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await como(apelido)
    .from("contact_activity")
    .insert({
      clinic_id: clinicaA,
      contact_id: contatoA1,
      due_on: hoje,
      ...campos,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `criar atividade como ${apelido}: ${error?.code} ${error?.message}`,
    );
  }
  return data.id as string;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `CRM A ${sufixo}`,
        slug: `crm-leva-a-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `CRM B ${sufixo}`,
        slug: `crm-leva-a-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `crm-leva-a-a-${sufixo}`)!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug === `crm-leva-a-b-${sufixo}`)!
    .id as string;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Atividade" })
    .select("id")
    .single()
    .throwOnError();

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("recepcao2-a", clinicaA, "recepcao");
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa(
    "prof-a",
    clinicaA,
    "profissional",
    "ativo",
    prof!.id as string,
  );
  await criarPessoa("pendente-a", clinicaA, "recepcao", "pendente");
  await criarPessoa("admin-b", clinicaB, "admin");

  contatoA1 = await novoContato(
    clinicaA,
    `+5584977${sufixo.replace(/\D/g, "1").slice(0, 4)}01`,
  );
  contatoA2 = await novoContato(
    clinicaA,
    `+5584977${sufixo.replace(/\D/g, "1").slice(0, 4)}02`,
  );
  contatoB = await novoContato(
    clinicaB,
    `+5584977${sufixo.replace(/\D/g, "1").slice(0, 4)}03`,
  );
  const numeroA = await criarNumeroDeTeste(admin, clinicaA);
  const numeroB = await criarNumeroDeTeste(admin, clinicaB);
  conversaA1 = await novaConversa(clinicaA, contatoA1, numeroA.id);
  conversaA2 = await novaConversa(clinicaA, contatoA2, numeroA.id);
  conversaB = await novaConversa(clinicaB, contatoB, numeroB.id);
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const usuario of ids.values()) {
    await admin.auth.admin.deleteUser(usuario);
  }
});

// ---------------------------------------------------------------------------
// Jornada: termos_de_quem e descricao
// ---------------------------------------------------------------------------

describe("funnel_stage_def: termos_de_quem e descricao", () => {
  it("toda etapa semeada nasce 'paciente' e sem descrição", async () => {
    const { data } = await admin
      .from("funnel_stage_def")
      .select("chave, termos_de_quem, descricao")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect(data!.length).toBe(6);
    for (const etapa of data!) {
      expect(etapa.termos_de_quem).toBe("paciente");
      expect(etapa.descricao).toBeNull();
    }
  });

  it("gestor grava; valor fora da lista e descrição de 141 são recusados", async () => {
    const { data, error } = await como("gestor-a")
      .from("funnel_stage_def")
      .update({
        termos_de_quem: "clinica",
        descricao: "Primeiro contato, ainda sem conversa",
      })
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo")
      .select("termos_de_quem, descricao");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        termos_de_quem: "clinica",
        descricao: "Primeiro contato, ainda sem conversa",
      },
    ]);

    const invalido = await como("gestor-a")
      .from("funnel_stage_def")
      .update({ termos_de_quem: "outro" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo");
    expect(invalido.error?.code).toBe(CHECK_VIOLATION);

    for (const descricao of ["", "   ", "x".repeat(141)]) {
      const { error: erro } = await como("gestor-a")
        .from("funnel_stage_def")
        .update({ descricao })
        .eq("clinic_id", clinicaA)
        .eq("chave", "novo");
      expect(erro?.code).toBe(CHECK_VIOLATION);
    }

    const limite = await como("admin-a")
      .from("funnel_stage_def")
      .update({ descricao: "y".repeat(140), termos_de_quem: "qualquer" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "em_contato")
      .select("chave");
    expect(limite.error).toBeNull();
    expect(limite.data).toEqual([{ chave: "em_contato" }]);
  });

  it("recepção e leitura leem e não gravam; a B não lê nem grava a da A", async () => {
    for (const papel of ["recepcao-a", "leitura-a"]) {
      const { data: lido } = await como(papel)
        .from("funnel_stage_def")
        .select("descricao, termos_de_quem")
        .eq("clinic_id", clinicaA)
        .eq("chave", "novo");
      expect(lido).toEqual([
        {
          descricao: "Primeiro contato, ainda sem conversa",
          termos_de_quem: "clinica",
        },
      ]);
      const { data: alterados } = await como(papel)
        .from("funnel_stage_def")
        .update({ descricao: "Tentativa", termos_de_quem: "paciente" })
        .eq("clinic_id", clinicaA)
        .eq("chave", "novo")
        .select("chave");
      expect(alterados ?? []).toEqual([]);
    }

    const { data: daA } = await como("admin-b")
      .from("funnel_stage_def")
      .select("descricao")
      .eq("clinic_id", clinicaA);
    expect(daA ?? []).toEqual([]);
    const { data: alteradosB } = await como("admin-b")
      .from("funnel_stage_def")
      .update({ descricao: "B tentando" })
      .eq("clinic_id", clinicaA)
      .select("chave");
    expect(alteradosB ?? []).toEqual([]);
    const { data: propria } = await como("admin-b")
      .from("funnel_stage_def")
      .update({ descricao: "Da B" })
      .eq("clinic_id", clinicaB)
      .eq("chave", "novo")
      .select("descricao");
    expect(propria).toEqual([{ descricao: "Da B" }]);

    const { data: final } = await admin
      .from("funnel_stage_def")
      .select("descricao, termos_de_quem")
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo")
      .single()
      .throwOnError();
    expect(final).toEqual({
      descricao: "Primeiro contato, ainda sem conversa",
      termos_de_quem: "clinica",
    });
  });
});

// ---------------------------------------------------------------------------
// Mensagens padrao (resposta_rapida)
// ---------------------------------------------------------------------------

describe("resposta_rapida: quem lê e quem escreve", () => {
  let boasVindas = "";

  it("admin cria; a autoria é a sessão mesmo se o cliente mandar outra", async () => {
    const { data, error } = await como("admin-a")
      .from("resposta_rapida")
      .insert({
        clinic_id: clinicaA,
        atalho: "boas_vindas",
        titulo: "Boas vindas",
        corpo: "Olá, {{nome}}! Aqui é da {{clinica}}.",
        posicao: 10,
        created_by: id("gestor-a"),
        updated_by: id("gestor-a"),
      })
      .select("id, created_by, updated_by, ativo")
      .single();
    expect(error).toBeNull();
    boasVindas = data!.id as string;
    expect(data).toMatchObject({
      created_by: id("admin-a"),
      updated_by: id("admin-a"),
      ativo: true,
    });
  });

  it("gestor edita: updated_by vira o gestor e created_by fica", async () => {
    const { data, error } = await como("gestor-a")
      .from("resposta_rapida")
      .update({ corpo: "Olá, {{nome}}! Tudo bem?", created_by: id("gestor-a") })
      .eq("id", boasVindas)
      .select("created_by, updated_by, corpo");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        created_by: id("admin-a"),
        updated_by: id("gestor-a"),
        corpo: "Olá, {{nome}}! Tudo bem?",
      },
    ]);

    const mudarClinica = await como("gestor-a")
      .from("resposta_rapida")
      .update({ clinic_id: clinicaB })
      .eq("id", boasVindas);
    expect(mudarClinica.error?.code).toBe(CHECK_VIOLATION);
  });

  it("atalho e título repetidos e fora do formato são recusados", async () => {
    const cliente = como("gestor-a");
    const base = { clinic_id: clinicaA, corpo: "Texto" };
    const repetidos = [
      { ...base, atalho: "boas_vindas", titulo: "Outro título" },
      { ...base, atalho: "bv2", titulo: "  boas VINDAS " },
    ];
    for (const linha of repetidos) {
      const { error } = await cliente.from("resposta_rapida").insert(linha);
      expect(error?.code).toBe(UNIQUE_VIOLATION);
    }
    const invalidos = [
      { ...base, atalho: "Oi", titulo: "Maiúscula" },
      { ...base, atalho: "a-b", titulo: "Hífen" },
      { ...base, atalho: "a".repeat(31), titulo: "Longo" },
      { ...base, atalho: "curto", titulo: " x " },
      { ...base, atalho: "titulo_longo", titulo: "t".repeat(61) },
      {
        clinic_id: clinicaA,
        atalho: "vazio",
        titulo: "Corpo vazio",
        corpo: "",
      },
      {
        clinic_id: clinicaA,
        atalho: "espacos",
        titulo: "Só espaços",
        corpo: "   ",
      },
      {
        clinic_id: clinicaA,
        atalho: "grande",
        titulo: "Corpo grande",
        corpo: "c".repeat(4097),
      },
    ];
    for (const linha of invalidos) {
      const { error } = await cliente.from("resposta_rapida").insert(linha);
      expect(error?.code).toBe(CHECK_VIOLATION);
    }
    const limite = await cliente.from("resposta_rapida").insert({
      clinic_id: clinicaA,
      atalho: "z".repeat(30),
      titulo: "T".repeat(60),
      corpo: "c".repeat(4096),
      ativo: false,
      posicao: 20,
    });
    expect(limite.error).toBeNull();
  });

  it("recepção, profissional e leitura leem e não criam, editam nem apagam", async () => {
    for (const papel of ["recepcao-a", "prof-a", "leitura-a"]) {
      const cliente = como(papel);
      const { data: lidas, error } = await cliente
        .from("resposta_rapida")
        .select("atalho")
        .eq("clinic_id", clinicaA)
        .order("atalho");
      expect(error).toBeNull();
      expect(lidas).toEqual([
        { atalho: "boas_vindas" },
        { atalho: "z".repeat(30) },
      ]);

      const criar = await cliente
        .from("resposta_rapida")
        .insert({
          clinic_id: clinicaA,
          atalho: "tentativa",
          titulo: "Tentativa",
          corpo: "x",
        });
      expect(criar.error?.code).toBe(RLS_VIOLATION);

      const { data: alteradas } = await cliente
        .from("resposta_rapida")
        .update({ corpo: "mudado" })
        .eq("id", boasVindas)
        .select("id");
      expect(alteradas ?? []).toEqual([]);

      const { data: apagadas } = await cliente
        .from("resposta_rapida")
        .delete()
        .eq("id", boasVindas)
        .select("id");
      expect(apagadas ?? []).toEqual([]);
    }
  });

  it("pendente e anon não leem nem escrevem", async () => {
    const pendente = como("pendente-a");
    const { data } = await pendente
      .from("resposta_rapida")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(data ?? []).toEqual([]);

    const criar = await pendente.from("resposta_rapida").insert({
      clinic_id: clinicaA,
      atalho: "do_pendente",
      titulo: "Do pendente",
      corpo: "x",
    });
    expect(criar.error?.code).toBe(RLS_VIOLATION);
    const { data: alteradas } = await pendente
      .from("resposta_rapida")
      .update({ corpo: "pendente mudou" })
      .eq("id", boasVindas)
      .select("id");
    expect(alteradas ?? []).toEqual([]);
    const { data: apagadas } = await pendente
      .from("resposta_rapida")
      .delete()
      .eq("id", boasVindas)
      .select("id");
    expect(apagadas ?? []).toEqual([]);

    const anonimo = await anonClient()
      .from("resposta_rapida")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(anonimo.error !== null || (anonimo.data ?? []).length === 0).toBe(
      true,
    );
    const anonimoCria = await anonClient().from("resposta_rapida").insert({
      clinic_id: clinicaA,
      atalho: "do_anon",
      titulo: "Do anon",
      corpo: "x",
    });
    expect(anonimoCria.error).not.toBeNull();

    // A mensagem continua inteira (anti falso positivo das negacoes).
    const { data: final } = await admin
      .from("resposta_rapida")
      .select("corpo")
      .eq("id", boasVindas)
      .single()
      .throwOnError();
    expect(final!.corpo).toBe("Olá, {{nome}}! Tudo bem?");
  });

  it("a B não lê nem escreve na A; usa o mesmo atalho na própria clínica", async () => {
    const cliente = como("admin-b");
    const { data: lidas } = await cliente
      .from("resposta_rapida")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(lidas ?? []).toEqual([]);

    const criar = await cliente
      .from("resposta_rapida")
      .insert({
        clinic_id: clinicaA,
        atalho: "de_b",
        titulo: "De B",
        corpo: "x",
      });
    expect(criar.error?.code).toBe(RLS_VIOLATION);

    const { data: alteradas } = await cliente
      .from("resposta_rapida")
      .update({ corpo: "B mudou" })
      .eq("id", boasVindas)
      .select("id");
    expect(alteradas ?? []).toEqual([]);

    const { data: apagadas } = await cliente
      .from("resposta_rapida")
      .delete()
      .eq("id", boasVindas)
      .select("id");
    expect(apagadas ?? []).toEqual([]);

    const propria = await cliente
      .from("resposta_rapida")
      .insert({
        clinic_id: clinicaB,
        atalho: "boas_vindas",
        titulo: "Boas vindas",
        corpo: "Da B",
      });
    expect(propria.error).toBeNull();

    // E no sentido contrario: a A (gestao e recepcao) nao le nem mexe na da B.
    for (const papel of ["admin-a", "recepcao-a"]) {
      const { data: daB } = await como(papel)
        .from("resposta_rapida")
        .select("id")
        .eq("clinic_id", clinicaB);
      expect(daB ?? []).toEqual([]);
    }
    const { data: alteradasPelaA } = await como("admin-a")
      .from("resposta_rapida")
      .update({ corpo: "A mudou" })
      .eq("clinic_id", clinicaB)
      .select("id");
    expect(alteradasPelaA ?? []).toEqual([]);
    const { data: daBNoBanco } = await admin
      .from("resposta_rapida")
      .select("corpo")
      .eq("clinic_id", clinicaB)
      .throwOnError();
    expect(daBNoBanco).toEqual([{ corpo: "Da B" }]);

    const { data: final } = await admin
      .from("resposta_rapida")
      .select("corpo")
      .eq("id", boasVindas)
      .single()
      .throwOnError();
    expect(final!.corpo).toBe("Olá, {{nome}}! Tudo bem?");
  });

  it("gestor apaga (exclusão real)", async () => {
    const { data, error } = await como("gestor-a")
      .from("resposta_rapida")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("atalho", "z".repeat(30))
      .select("atalho");
    expect(error).toBeNull();
    expect(data).toEqual([{ atalho: "z".repeat(30) }]);
  });
});

// ---------------------------------------------------------------------------
// Atividades (contact_activity)
// ---------------------------------------------------------------------------

describe("contact_activity: quem cria", () => {
  it("recepção cria sem mandar created_by: o banco preenche com a sessão", async () => {
    const atividade = await criarAtividade("recepcao-a", {
      titulo: "Retornar em dezembro",
      assignee_user_id: id("recepcao-a"),
    });
    expect(await atividadeNoBanco(atividade)).toMatchObject({
      status: "pendente",
      created_by: id("recepcao-a"),
      completed_at: null,
      canceled_at: null,
    });
  });

  it("created_by forjado e origem automação pela sessão são recusados", async () => {
    const forjado = await como("recepcao-a")
      .from("contact_activity")
      .insert({
        clinic_id: clinicaA,
        contact_id: contatoA1,
        titulo: "Em nome do gestor",
        due_on: hoje,
        created_by: id("gestor-a"),
      });
    expect(forjado.error?.code).toBe(RLS_VIOLATION);

    const automacao = await como("gestor-a").from("contact_activity").insert({
      clinic_id: clinicaA,
      contact_id: contatoA1,
      titulo: "Fingindo automação",
      due_on: hoje,
      origem: "automacao",
      automacao_id: crypto.randomUUID(),
    });
    expect(automacao.error?.code).toBe(RLS_VIOLATION);

    const { count } = await admin
      .from("contact_activity")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA)
      .in("titulo", ["Em nome do gestor", "Fingindo automação"]);
    expect(count).toBe(0);
  });

  it("admin e gestor criam; profissional, leitura e pendente não", async () => {
    await criarAtividade("admin-a", {
      titulo: "Ligar para o paciente",
      contact_id: contatoA2,
    });
    await criarAtividade("gestor-a", {
      titulo: "Mandar orçamento",
      conversation_id: conversaA1,
      assignee_user_id: id("prof-a"),
    });
    for (const papel of ["prof-a", "leitura-a", "pendente-a"]) {
      const { error } = await como(papel).from("contact_activity").insert({
        clinic_id: clinicaA,
        contact_id: contatoA1,
        titulo: "Tentativa",
        due_on: hoje,
      });
      expect(error?.code).toBe(RLS_VIOLATION);
    }
  });

  it("a B não cria na A; contato da A na clínica B é recusado", async () => {
    const naA = await como("admin-b").from("contact_activity").insert({
      clinic_id: clinicaA,
      contact_id: contatoA1,
      titulo: "B na A",
      due_on: hoje,
    });
    expect(naA.error?.code).toBe(RLS_VIOLATION);

    const cruzado = await como("admin-b").from("contact_activity").insert({
      clinic_id: clinicaB,
      contact_id: contatoA1,
      titulo: "Contato da A na B",
      due_on: hoje,
    });
    expect(cruzado.error).not.toBeNull();

    const propria = await como("admin-b")
      .from("contact_activity")
      .insert({
        clinic_id: clinicaB,
        contact_id: contatoB,
        conversation_id: conversaB,
        titulo: "Atividade da B",
        due_on: somarDias(hoje, -1),
      });
    expect(propria.error).toBeNull();
  });

  it("responsável de outra clínica ou pendente e conversa de outro contato são recusados", async () => {
    const cliente = como("recepcao-a");
    for (const responsavel of [
      id("admin-b"),
      id("pendente-a"),
      crypto.randomUUID(),
    ]) {
      const { error } = await cliente.from("contact_activity").insert({
        clinic_id: clinicaA,
        contact_id: contatoA1,
        titulo: "Responsável inválido",
        due_on: hoje,
        assignee_user_id: responsavel,
      });
      expect(error?.code).toBe(CHECK_VIOLATION);
    }
    for (const conversa of [conversaA2, conversaB]) {
      const { error } = await cliente.from("contact_activity").insert({
        clinic_id: clinicaA,
        contact_id: contatoA1,
        conversation_id: conversa,
        titulo: "Conversa de outro",
        due_on: hoje,
      });
      expect(error?.code).toBe(CHECK_VIOLATION);
    }
    const nasceConcluida = await cliente.from("contact_activity").insert({
      clinic_id: clinicaA,
      contact_id: contatoA1,
      titulo: "Já concluída",
      due_on: hoje,
      status: "concluida",
    });
    expect(nasceConcluida.error?.code).toBe(CHECK_VIOLATION);

    // anti falso positivo: responsável ativo (leitura) e conversa do contato
    await criarAtividade("recepcao-a", {
      titulo: "Para a leitura",
      assignee_user_id: id("leitura-a"),
      conversation_id: conversaA1,
    });
  });
});

describe("contact_activity: concluir, reabrir, cancelar e travas", () => {
  let atividade = "";

  beforeAll(async () => {
    atividade = await criarAtividade("recepcao-a", {
      titulo: "Confirmar retorno",
      due_on: somarDias(hoje, 2),
    });
  });

  it("concluir carimba com a sessão, ignorando o que o cliente manda", async () => {
    const { data, error } = await como("recepcao2-a")
      .from("contact_activity")
      .update({
        status: "concluida",
        completed_by: id("gestor-a"),
        completed_at: "2000-01-01T00:00:00Z",
      })
      .eq("id", atividade)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: atividade }]);
    const noBanco = await atividadeNoBanco(atividade);
    expect(noBanco.status).toBe("concluida");
    expect(noBanco.completed_by).toBe(id("recepcao2-a"));
    expect(new Date(noBanco.completed_at!).getFullYear()).toBeGreaterThan(2000);
    expect(noBanco.canceled_at).toBeNull();
  });

  it("com o status igual, os carimbos não mudam", async () => {
    await como("admin-a")
      .from("contact_activity")
      .update({
        completed_by: id("admin-a"),
        titulo: "Confirmar retorno (2a sessão)",
      })
      .eq("id", atividade)
      .throwOnError();
    expect(await atividadeNoBanco(atividade)).toMatchObject({
      completed_by: id("recepcao2-a"),
      titulo: "Confirmar retorno (2a sessão)",
    });
  });

  it("reabrir limpa; cancelar carimba o outro par", async () => {
    await como("gestor-a")
      .from("contact_activity")
      .update({ status: "pendente" })
      .eq("id", atividade)
      .throwOnError();
    expect(await atividadeNoBanco(atividade)).toMatchObject({
      status: "pendente",
      completed_by: null,
      completed_at: null,
      canceled_by: null,
      canceled_at: null,
    });

    await como("admin-a")
      .from("contact_activity")
      .update({ status: "cancelada" })
      .eq("id", atividade)
      .throwOnError();
    const cancelada = await atividadeNoBanco(atividade);
    expect(cancelada.canceled_by).toBe(id("admin-a"));
    expect(cancelada.canceled_at).not.toBeNull();
    expect(cancelada.completed_at).toBeNull();
  });

  it("contato, autoria e origem não mudam; o resto é editável", async () => {
    const cliente = como("admin-a");
    const travas: Record<string, unknown>[] = [
      { contact_id: contatoA2 },
      { created_by: id("admin-a") },
      { origem: "automacao", automacao_id: crypto.randomUUID() },
      { automacao_id: crypto.randomUUID() },
    ];
    for (const campos of travas) {
      const { error } = await cliente
        .from("contact_activity")
        .update(campos)
        .eq("id", atividade);
      expect(error?.code).toBe(CHECK_VIOLATION);
    }
    const { data, error } = await cliente
      .from("contact_activity")
      .update({
        status: "pendente",
        titulo: "Confirmar retorno adiado",
        detalhes: null,
        due_on: somarDias(hoje, 7),
        assignee_user_id: id("gestor-a"),
      })
      .eq("id", atividade)
      .select("titulo, created_by, assignee_user_id");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        titulo: "Confirmar retorno adiado",
        created_by: id("recepcao-a"),
        assignee_user_id: id("gestor-a"),
      },
    ]);
  });

  it("profissional e leitura leem e não editam; pendente e a B nem leem", async () => {
    for (const papel of ["prof-a", "leitura-a"]) {
      const { data: lidas, error } = await como(papel)
        .from("contact_activity")
        .select("id")
        .eq("id", atividade);
      expect(error).toBeNull();
      expect(lidas).toEqual([{ id: atividade }]);
      const { data: alteradas } = await como(papel)
        .from("contact_activity")
        .update({ status: "concluida" })
        .eq("id", atividade)
        .select("id");
      expect(alteradas ?? []).toEqual([]);
    }
    for (const papel of ["pendente-a", "admin-b"]) {
      const { data: lidas } = await como(papel)
        .from("contact_activity")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(lidas ?? []).toEqual([]);
      const { data: alteradas } = await como(papel)
        .from("contact_activity")
        .update({ status: "concluida" })
        .eq("id", atividade)
        .select("id");
      expect(alteradas ?? []).toEqual([]);
    }
    const { data: daB } = await como("admin-a")
      .from("contact_activity")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(daB ?? []).toEqual([]);
    expect((await atividadeNoBanco(atividade)).status).toBe("pendente");
  });

  it("DELETE é negado com erro, até para admin e gestor", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const { error } = await como(papel)
        .from("contact_activity")
        .delete()
        .eq("id", atividade);
      expect(error?.code).toBe(RLS_VIOLATION);
    }
    expect((await atividadeNoBanco(atividade)).titulo).toBe(
      "Confirmar retorno adiado",
    );
  });

  it("anon não lê", async () => {
    const { data, error } = await anonClient()
      .from("contact_activity")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe("contagem_de_atividades pela sessão", () => {
  type Contagem = {
    atrasadas: number;
    hoje: number;
    minhas_atrasadas: number;
    minhas_hoje: number;
  };

  async function contar(papel: string, clinicId: string): Promise<Contagem> {
    const { data, error } = await como(papel).rpc("contagem_de_atividades", {
      p_clinic_id: clinicId,
    });
    expect(error).toBeNull();
    return data as Contagem;
  }

  beforeAll(async () => {
    // Zera a A e monta um retrato conhecido (service role).
    await admin
      .from("contact_activity")
      .delete()
      .eq("clinic_id", clinicaA)
      .throwOnError();
    const base = {
      clinic_id: clinicaA,
      contact_id: contatoA1,
      created_by: id("recepcao-a"),
    };
    await admin
      .from("contact_activity")
      .insert([
        {
          ...base,
          titulo: "ontem, minha",
          due_on: somarDias(hoje, -1),
          assignee_user_id: id("recepcao-a"),
        },
        {
          ...base,
          titulo: "hoje, minha",
          due_on: hoje,
          assignee_user_id: id("recepcao-a"),
        },
        {
          ...base,
          titulo: "há 3 dias, do gestor",
          due_on: somarDias(hoje, -3),
          assignee_user_id: id("gestor-a"),
        },
        { ...base, titulo: "hoje, sem responsável", due_on: hoje },
        {
          ...base,
          titulo: "amanhã, minha",
          due_on: somarDias(hoje, 1),
          assignee_user_id: id("recepcao-a"),
        },
      ])
      .throwOnError();
  });

  it("recepção vê o total e as dela", async () => {
    expect(await contar("recepcao-a", clinicaA)).toEqual({
      atrasadas: 2,
      hoje: 2,
      minhas_atrasadas: 1,
      minhas_hoje: 1,
    });
  });

  it("gestor vê o total e as dele; leitura e profissional, só o total", async () => {
    expect(await contar("gestor-a", clinicaA)).toEqual({
      atrasadas: 2,
      hoje: 2,
      minhas_atrasadas: 1,
      minhas_hoje: 0,
    });
    for (const papel of ["leitura-a", "prof-a"]) {
      expect(await contar(papel, clinicaA)).toEqual({
        atrasadas: 2,
        hoje: 2,
        minhas_atrasadas: 0,
        minhas_hoje: 0,
      });
    }
  });

  it("pendente e a B recebem zeros da A", async () => {
    for (const papel of ["pendente-a", "admin-b"]) {
      expect(await contar(papel, clinicaA)).toEqual({
        atrasadas: 0,
        hoje: 0,
        minhas_atrasadas: 0,
        minhas_hoje: 0,
      });
    }
  });

  it("anon não chama", async () => {
    const { error } = await anonClient().rpc("contagem_de_atividades", {
      p_clinic_id: clinicaA,
    });
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Marca do eco do celular (termo_eco_visto, marcar_eco_para_termo)
// ---------------------------------------------------------------------------

describe("termo_eco_visto: só o service role do webhook", () => {
  const ecoId = `eco-rls-${sufixo}`;

  it("o service role marca uma vez por eco (positivo das negações abaixo)", async () => {
    await admin
      .from("funnel_stage_def")
      .update({ termos_de_quem: "clinica", termos_chave: ["seja bem-vinda"] })
      .eq("clinic_id", clinicaA)
      .eq("chave", "em_contato")
      .throwOnError();
    const primeira = await admin.rpc("marcar_eco_para_termo", {
      p_clinic_id: clinicaA,
      p_wa_message_id: ecoId,
    });
    expect(primeira.error).toBeNull();
    expect(primeira.data).toBe(true);
    const reentrega = await admin.rpc("marcar_eco_para_termo", {
      p_clinic_id: clinicaA,
      p_wa_message_id: ecoId,
    });
    expect(reentrega.data).toBe(false);
  });

  it("nenhum papel (nem admin, nem a B) nem anon lê, grava ou chama a marca", async () => {
    const sessoes: [string, SupabaseClient][] = [
      ...["admin-a", "gestor-a", "recepcao-a", "pendente-a", "admin-b"].map(
        (papel): [string, SupabaseClient] => [papel, como(papel)],
      ),
      ["anon", anonClient()],
    ];
    for (const [papel, cliente] of sessoes) {
      const lidas = await cliente
        .from("termo_eco_visto")
        .select("wa_message_id")
        .eq("clinic_id", clinicaA);
      expect(
        lidas.error !== null || (lidas.data ?? []).length === 0,
        `${papel} leu termo_eco_visto`,
      ).toBe(true);

      const gravar = await cliente
        .from("termo_eco_visto")
        .insert({ clinic_id: clinicaA, wa_message_id: `forjado-${papel}` });
      expect(gravar.error, `${papel} gravou termo_eco_visto`).not.toBeNull();

      const chamar = await cliente.rpc("marcar_eco_para_termo", {
        p_clinic_id: clinicaA,
        p_wa_message_id: `forjado-${papel}`,
      });
      expect(chamar.error, `${papel} chamou marcar_eco_para_termo`).not.toBeNull();
    }

    const { data: marcas } = await admin
      .from("termo_eco_visto")
      .select("wa_message_id")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect(marcas).toEqual([{ wa_message_id: ecoId }]);
  });
});
