import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nascerDeMensagem } from "./lead-de-verdade";
import { adminClient, anonClient } from "./stack";

// Venda pela Jornada (migration 20261123110000): o isolamento de
// venda_da_jornada e de vendas_do_periodo, e as colunas de venda de
// campanhas_do_periodo. Quem ve e a mesma regra do faturamento: admin e
// gestor da clinica. A clinica A nao le a B (na tabela e na RPC); recepcao,
// leitura e profissional recebem null (e a tabela vazia); anon nao executa
// nem le; a sessao nao insere, altera nem apaga venda (so o gatilho grava).
// Escrito em 23/11/2026 com a migration NAO aplicada e NAO rodado: so passa
// depois dela (npm run test:rls -- venda-pela-jornada).

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Venda!Jornada2026";

let clinicaA = "";
let clinicaB = "";
let profissionalA = "";
let contatoA = "";
const usuarios: string[] = [];

const JANELA = {
  p_de: new Date(Date.now() - 3_600_000).toISOString(),
  // Uma hora no futuro: as vendas da fixture nascem depois deste modulo.
  p_ate: new Date(Date.now() + 3_600_000).toISOString(),
};

async function criarUsuario(
  email: string,
  clinicId: string,
  role: string,
  professionalId?: string,
): Promise<void> {
  const { data } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  usuarios.push(data.user!.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status: "ativo",
      ...(professionalId ? { professional_id: professionalId } : {}),
    })
    .throwOnError();
}

async function logado(email: string) {
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${email}: ${error.message}`);
  }
  return cliente;
}

const email = (papel: string) => `venda-${papel}-${sufixo}@teste.dev`;

/** A etapa Compareceu vira venda de R$ 100,00 e um lead entra nela. */
async function montarClinica(clinicId: string, telefone: string) {
  await admin
    .from("funnel_stage_def")
    .update({ is_sale: true, value_source: "fixo", value_cents: 10_000 })
    .eq("clinic_id", clinicId)
    .eq("chave", "compareceu")
    .throwOnError();
  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      source_campaign: "Check-up",
    })
    .select("id")
    .single()
    .throwOnError();
  await nascerDeMensagem(admin, [clinicId], [contato!.id as string]);
  await admin
    .from("contact")
    .update({ funnel_stage: "compareceu" })
    .eq("id", contato!.id)
    .throwOnError();
  return contato!.id as string;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Venda A ${sufixo}`,
        slug: `venda-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Venda B ${sufixo}`,
        slug: `venda-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `venda-a-${sufixo}`)!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug === `venda-b-${sufixo}`)!
    .id as string;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Venda" })
    .select("id")
    .single()
    .throwOnError();
  profissionalA = prof!.id as string;

  await criarUsuario(email("admin-a"), clinicaA, "admin");
  await criarUsuario(email("gestor-a"), clinicaA, "gestor");
  await criarUsuario(email("recepcao-a"), clinicaA, "recepcao");
  await criarUsuario(email("leitura-a"), clinicaA, "leitura");
  await criarUsuario(email("prof-a"), clinicaA, "profissional", profissionalA);
  await criarUsuario(email("gestor-b"), clinicaB, "gestor");

  const digitos = sufixo.replace(/\D/g, "");
  contatoA = await montarClinica(
    clinicaA,
    `+558497${digitos.padEnd(6, "3").slice(0, 6)}3`,
  );
  await montarClinica(
    clinicaB,
    `+558497${digitos.padEnd(6, "4").slice(0, 6)}4`,
  );
}, 60_000);

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const id of usuarios) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("vendas_do_periodo", () => {
  it("admin e gestor da A veem as vendas da A", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(email(papel));
      const { data, error } = await cliente.rpc("vendas_do_periodo", {
        p_clinic_id: clinicaA,
        ...JANELA,
      });
      expect(error).toBeNull();
      expect(data).toEqual({
        tem_etapa_de_venda: true,
        vendas: 1,
        valor_cents: 10_000,
        sem_valor: 0,
      });
    }
  });

  it("a clínica A não lê as vendas da B: null, nunca um número", async () => {
    const cliente = await logado(email("admin-a"));
    const { data, error } = await cliente.rpc("vendas_do_periodo", {
      p_clinic_id: clinicaB,
      ...JANELA,
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("quem não vê faturamento (recepção, leitura, profissional) recebe null", async () => {
    for (const papel of ["recepcao-a", "leitura-a", "prof-a"]) {
      const cliente = await logado(email(papel));
      const { data, error } = await cliente.rpc("vendas_do_periodo", {
        p_clinic_id: clinicaA,
        ...JANELA,
      });
      expect(error).toBeNull();
      expect(data).toBeNull();
    }
  });

  it("anon não executa", async () => {
    const { error } = await anonClient().rpc("vendas_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(error).not.toBeNull();
  });
});

describe("venda_da_jornada (a tabela)", () => {
  it("admin da A lê só as da A; o gestor da B, só as da B", async () => {
    const adminA = await logado(email("admin-a"));
    const daA = await adminA.from("venda_da_jornada").select("clinic_id");
    expect(daA.error).toBeNull();
    expect(daA.data).toEqual([{ clinic_id: clinicaA }]);
    const daBPelaA = await adminA
      .from("venda_da_jornada")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(daBPelaA.data).toEqual([]);

    const gestorB = await logado(email("gestor-b"));
    const daB = await gestorB.from("venda_da_jornada").select("clinic_id");
    expect(daB.data).toEqual([{ clinic_id: clinicaB }]);
  });

  it("recepção, leitura e profissional não leem nenhuma venda", async () => {
    for (const papel of ["recepcao-a", "leitura-a", "prof-a"]) {
      const cliente = await logado(email(papel));
      const { data, error } = await cliente
        .from("venda_da_jornada")
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it("anon não lê", async () => {
    const { data, error } = await anonClient()
      .from("venda_da_jornada")
      .select("id");
    // Sem grant: erro de permissao (ou, no minimo, nada).
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("a sessão não insere, não altera e não apaga venda (só o gatilho grava)", async () => {
    const cliente = await logado(email("admin-a"));
    const inserir = await cliente.from("venda_da_jornada").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      etapa_chave: "compareceu",
      value_cents: 1,
    });
    expect(inserir.error).not.toBeNull();

    const alterar = await cliente
      .from("venda_da_jornada")
      .update({ value_cents: 1 })
      .eq("clinic_id", clinicaA)
      .select("id");
    expect(alterar.error !== null || (alterar.data ?? []).length === 0).toBe(
      true,
    );

    const apagar = await cliente
      .from("venda_da_jornada")
      .delete()
      .eq("clinic_id", clinicaA)
      .select("id");
    expect(apagar.error !== null || (apagar.data ?? []).length === 0).toBe(
      true,
    );

    // Nada mudou.
    const { data } = await admin
      .from("venda_da_jornada")
      .select("value_cents")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect(data).toEqual([{ value_cents: 10_000 }]);
  });

  it("a sessão move o lead e o gatilho grava a venda por ela", async () => {
    const cliente = await logado(email("recepcao-a"));
    await cliente
      .from("contact")
      .update({ funnel_stage: "agendou" })
      .eq("id", contatoA)
      .throwOnError();
    await cliente
      .from("contact")
      .update({ funnel_stage: "compareceu" })
      .eq("id", contatoA)
      .throwOnError();
    const { data } = await admin
      .from("venda_da_jornada")
      .select("id")
      .eq("contact_id", contatoA)
      .throwOnError();
    expect(data).toHaveLength(2);
  });
});

describe("campanhas_do_periodo: as colunas de venda", () => {
  type Linha = {
    chave: string;
    vendas: number | null;
    valor_das_vendas_cents: number | null;
    vendas_sem_valor: number | null;
  };
  type Bloco = { linhas: Linha[]; tem_etapa_de_venda: boolean | null };

  async function checkUp(papel: string, clinica = clinicaA) {
    const cliente = await logado(email(papel));
    const { data, error } = await cliente.rpc("campanhas_do_periodo", {
      p_clinic_id: clinica,
      ...JANELA,
    });
    expect(error).toBeNull();
    const atual = (data as { atual: Bloco } | null)?.atual;
    return {
      atual,
      linha: atual?.linhas.find((l) => l.chave === "texto:Check-up"),
    };
  }

  it("admin da A: as vendas na linha da campanha", async () => {
    const { atual, linha } = await checkUp("admin-a");
    expect(atual?.tem_etapa_de_venda).toBe(true);
    expect(linha?.vendas).toBeGreaterThanOrEqual(1);
    expect(linha?.valor_das_vendas_cents).toBeGreaterThanOrEqual(10_000);
  });

  it("recepção: a linha existe (o lead), as colunas de venda vêm nulas", async () => {
    const { atual, linha } = await checkUp("recepcao-a");
    expect(atual?.tem_etapa_de_venda).toBeNull();
    expect(linha).toMatchObject({
      vendas: null,
      valor_das_vendas_cents: null,
      vendas_sem_valor: null,
    });
  });

  it("admin da A pedindo a B: nenhuma venda da B", async () => {
    const { atual } = await checkUp("admin-a", clinicaB);
    for (const linha of atual?.linhas ?? []) {
      expect(linha.vendas ?? 0).toBe(0);
    }
  });
});
