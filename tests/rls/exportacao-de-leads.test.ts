import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  COLUNAS_DA_EXPORTACAO_DE_LEADS,
  DICA_EXPORTAR_LEADS,
} from "@/lib/domain/exportacao-de-leads";
import type { Role } from "@/lib/domain/permissions";
import { formatarTelefone } from "@/lib/domain/telefone";
import {
  exportarLeads,
  type ResultadoDaExportacao,
} from "@/lib/queries/exportacao-de-leads";
import { parseCsv } from "@/lib/utils/csv";

import { adminClient, anonClient } from "./stack";

// Exportacao de leads (pedido do dono em 20/10/2026) contra o banco de
// verdade, com a SESSAO de cada papel (o mesmo caminho da rota
// app/api/leads/exportar: lib/queries/exportacao-de-leads.ts com o cliente
// logado). Prova:
// - o administrador da clinica A exporta SO os leads da A (nunca os da B);
// - mesmo forjando a clinica B na sessao, a RLS nao devolve nada da B, e
//   nada e gravado na trilha da B;
// - recepcao, profissional e leitura recebem 403, sem trilha;
// - cada exportacao grava UMA linha em audit_log (exportou, leads, sem id),
//   com a quantidade e os filtros e sem dado de paciente.
//
// RODAR DEPOIS de aplicar a migration 20261020120000_trilha_com_detalhes.sql
// (as asserções de `detalhes` dependem da coluna). Padrao da suite: toda
// negacao tem a verificacao anti falso-positivo pela service role.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Exporta!Rls2026";
const FUSO = "America/Fortaleza";

let clinicaA = "";
let clinicaB = "";
const idDoUsuario = new Map<string, string>();

const TELEFONES_A = ["+5584971110001", "+5584971110002", "+5584971110003"];
const TELEFONE_B = "+5584972220001";
const NOME_B = `Paciente da B ${sufixo}`;

function email(papel: string, clinica: "a" | "b"): string {
  return `exporta-${papel}-${clinica}-${sufixo}@teste.dev`;
}

async function criarUsuario(
  endereco: string,
  clinicId: string,
  role: Role,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: endereco,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: endereco.split("@")[0] },
  });
  if (error || !data.user) {
    throw new Error(`criar ${endereco}: ${error?.message}`);
  }
  idDoUsuario.set(endereco, data.user.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: "ativo",
    })
    .throwOnError();
}

async function logado(endereco: string) {
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: endereco,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${endereco}: ${error.message}`);
  }
  return cliente;
}

async function exportarComo(
  endereco: string,
  role: Role,
  clinicId: string,
  entrada: unknown = {},
): Promise<ResultadoDaExportacao> {
  return exportarLeads({
    supabase: await logado(endereco),
    sessao: {
      userId: idDoUsuario.get(endereco) ?? "",
      clinicId,
      role,
      timezone: FUSO,
    },
    // A tela mostra a mesma clinica da sessao (a conferencia da troca em
    // outra aba passa): o que se prova aqui e a RLS por baixo.
    clinicaDaTela: clinicId,
    entrada,
    agora: new Date(),
  });
}

async function trilhaDaExportacao(clinicId: string, userId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("clinic_id, user_id, action, entity, entity_id, detalhes")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .eq("action", "exportou")
    .eq("entity", "leads")
    .throwOnError();
  return (data ?? []) as {
    clinic_id: string;
    user_id: string;
    action: string;
    entity: string;
    entity_id: string | null;
    detalhes: { quantidade: number; filtros: Record<string, string> } | null;
  }[];
}

function linhasDoArquivo(resultado: ResultadoDaExportacao): string[][] {
  if (resultado.tipo !== "arquivo") {
    throw new Error(`esperava arquivo, veio ${resultado.tipo}`);
  }
  return parseCsv(resultado.conteudo).linhas;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Exporta A ${sufixo}`, slug: `exporta-a-${sufixo}` },
      { name: `Exporta B ${sufixo}`, slug: `exporta-b-${sufixo}` },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("exporta-a"))!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("exporta-b"))!
    .id as string;

  for (const papel of [
    "admin",
    "gestor",
    "recepcao",
    "profissional",
    "leitura",
  ] as const) {
    await criarUsuario(email(papel, "a"), clinicaA, papel);
  }
  await criarUsuario(email("admin", "b"), clinicaB, "admin");

  await admin
    .from("contact")
    .insert([
      {
        clinic_id: clinicaA,
        phone_e164: TELEFONES_A[0],
        name: `Paciente A1 ${sufixo}`,
        tags: ["vip"],
      },
      {
        clinic_id: clinicaA,
        phone_e164: TELEFONES_A[1],
        name: `Paciente A2 ${sufixo}`,
      },
      {
        clinic_id: clinicaA,
        phone_e164: TELEFONES_A[2],
        name: `Paciente A3 ${sufixo}`,
        funnel_stage: "perdido",
        lost_reason: "preco",
      },
      { clinic_id: clinicaB, phone_e164: TELEFONE_B, name: NOME_B },
    ])
    .throwOnError();
});

afterAll(async () => {
  // A clinica leva junto contatos, vinculos e a trilha (cascade); so depois
  // o usuario sai (audit_log.user_id nao deixa apagar quem tem trilha).
  await admin.from("clinic").delete().eq("id", clinicaA);
  await admin.from("clinic").delete().eq("id", clinicaB);
  for (const id of idDoUsuario.values()) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("administrador e gestor exportam só a própria clínica", () => {
  it("o administrador da A recebe TODOS os leads da A e nenhum da B, com UMA linha de trilha", async () => {
    const resultado = await exportarComo(
      email("admin", "a"),
      "admin",
      clinicaA,
    );
    const linhas = linhasDoArquivo(resultado);
    expect(linhas[0]).toEqual([...COLUNAS_DA_EXPORTACAO_DE_LEADS]);
    const telefones = linhas
      .slice(1)
      .map((linha) => linha[1])
      .sort();
    expect(telefones).toEqual(TELEFONES_A.map(formatarTelefone).sort());
    const arquivo = resultado.tipo === "arquivo" ? resultado.conteudo : "";
    expect(arquivo).not.toContain(NOME_B);
    expect(arquivo).not.toContain(formatarTelefone(TELEFONE_B));

    // Anti falso-positivo: o lead da B existe.
    const { data: daB } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicaB)
      .throwOnError();
    expect(daB).toHaveLength(1);

    // A trilha: UMA linha, com quantidade e filtros e sem dado de paciente.
    const userId = idDoUsuario.get(email("admin", "a")) ?? "";
    const trilhas = await trilhaDaExportacao(clinicaA, userId);
    expect(trilhas).toHaveLength(1);
    const [linha] = trilhas;
    expect(linha).toMatchObject({
      clinic_id: clinicaA,
      user_id: userId,
      action: "exportou",
      entity: "leads",
      entity_id: null,
      detalhes: { quantidade: 3, filtros: {} },
    });
    const trilha = JSON.stringify(linha);
    for (const telefone of TELEFONES_A) {
      expect(trilha).not.toContain(telefone);
      expect(trilha).not.toContain(formatarTelefone(telefone));
    }
    expect(trilha).not.toContain("Paciente A");
  });

  it("o gestor da A exporta com o filtro da tela (etapa Perdido)", async () => {
    const resultado = await exportarComo(
      email("gestor", "a"),
      "gestor",
      clinicaA,
      { etapa: "perdido" },
    );
    const linhas = linhasDoArquivo(resultado);
    expect(linhas.slice(1).map((linha) => linha[1])).toEqual([
      formatarTelefone(TELEFONES_A[2]!),
    ]);
    const trilha = await trilhaDaExportacao(
      clinicaA,
      idDoUsuario.get(email("gestor", "a")) ?? "",
    );
    expect(trilha).toHaveLength(1);
    expect(trilha[0]?.detalhes).toEqual({
      quantidade: 1,
      filtros: { etapa: "perdido" },
    });
  });

  it("o administrador da B exporta só a B", async () => {
    const resultado = await exportarComo(
      email("admin", "b"),
      "admin",
      clinicaB,
    );
    const linhas = linhasDoArquivo(resultado);
    expect(linhas.slice(1).map((linha) => linha[0])).toEqual([NOME_B]);
  });
});

describe("a RLS segura mesmo com a clínica forjada", () => {
  it("o administrador da A pedindo a clínica B não recebe nada nem grava trilha na B", async () => {
    const resultado = await exportarComo(
      email("admin", "a"),
      "admin",
      clinicaB,
    );
    expect(resultado).toEqual({ tipo: "vazio" });
    const trilhaNaB = await trilhaDaExportacao(
      clinicaB,
      idDoUsuario.get(email("admin", "a")) ?? "",
    );
    expect(trilhaNaB).toHaveLength(0);
  });
});

describe("os outros papéis recebem 403", () => {
  for (const papel of ["recepcao", "profissional", "leitura"] as const) {
    it(`${papel} da A: 403 com a dica do dono, sem trilha`, async () => {
      const resultado = await exportarComo(email(papel, "a"), papel, clinicaA);
      expect(resultado).toEqual({
        tipo: "recusada",
        status: 403,
        mensagem: DICA_EXPORTAR_LEADS,
      });
      const trilha = await trilhaDaExportacao(
        clinicaA,
        idDoUsuario.get(email(papel, "a")) ?? "",
      );
      expect(trilha).toHaveLength(0);

      // Anti falso-positivo: a sessão dela LÊ os leads da A (o 403 é do
      // papel na exportação, não da RLS).
      const sessao = await logado(email(papel, "a"));
      const { data } = await sessao
        .from("contact")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect((data ?? []).length).toBeGreaterThan(0);
    });
  }
});
