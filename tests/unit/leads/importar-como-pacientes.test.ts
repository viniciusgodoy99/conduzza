import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaImportada } from "@/lib/domain/importacao";
import { chaveDeTelefone } from "@/lib/domain/telefone";
import {
  importarContatos,
  type DeclaracaoDeConsentimento,
} from "@/lib/integrations/importar-contatos";

import { BancoEmMemoria } from "../ia-whatsapp/banco-em-memoria";

// "Importar como" (decisao do dono em 20/10/2026: "pode ser manualmente ou
// via importação"). O miolo (lib/integrations/importar-contatos.ts) e a
// Server Action, contra um banco em memoria: com Pacientes, o contato novo
// nasce paciente, o lead que ja existia vira paciente e o paciente continua;
// com Leads (o padrao, inclusive sem a escolha), tudo como sempre. A etapa
// nunca muda, e a trilha 'importou_planilha' leva a escolha e as contagens,
// nunca dado de paciente. Contra o banco real: tests/integration/
// importacao.test.ts (escrito, nao rodado nesta entrega).

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "a0000000-0000-4000-8000-000000000001";
const LEAD_EXISTENTE = "10000000-0000-4000-8000-000000000001";
const PACIENTE_EXISTENTE = "10000000-0000-4000-8000-000000000002";

const TELEFONE_NOVO = "+5585999990001";
const TELEFONE_DO_LEAD = "+5585999990002";
const TELEFONE_DO_PACIENTE = "+5585999990003";

const DECLARACAO: DeclaracaoDeConsentimento = { opcao: "recepcao" };

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  sessao: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    (estado.banco as { cliente: () => unknown }).cliente(),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => estado.sessao,
}));
vi.mock("@/lib/auth/read-audit", () => ({
  auditarLeituraDePaciente: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { importarContatosAction } = await import("@/app/(app)/leads/actions");

let banco: BancoEmMemoria;

function linha(telefone: string, nome: string | null = null): LinhaImportada {
  return {
    name: nome,
    phone_e164: telefone,
    email: null,
    insurance_name: null,
    source_campaign: null,
  };
}

function existente(
  id: string,
  telefone: string,
  kind: "lead" | "paciente",
  etapa: string,
) {
  return {
    id,
    clinic_id: CLINICA,
    phone_e164: telefone,
    phone_key: chaveDeTelefone(telefone),
    kind,
    funnel_stage: etapa,
    name: "Nome Gravado",
    email: null,
    insurance_id: null,
  };
}

function contatoPorTelefone(telefone: string) {
  return banco
    .linhas("contact")
    .find((contato) => contato.phone_e164 === telefone);
}

const LOTE = [
  linha(TELEFONE_NOVO, "Pessoa Nova"),
  linha(TELEFONE_DO_LEAD),
  linha(TELEFONE_DO_PACIENTE),
];

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  estado.sessao = {
    userId: USUARIO,
    userName: "Ana Recepção",
    active: {
      clinicId: CLINICA,
      role: "recepcao",
      status: "ativo",
      timezone: "America/Fortaleza",
    },
  };
  banco
    .linhas("contact")
    .push(
      existente(LEAD_EXISTENTE, TELEFONE_DO_LEAD, "lead", "em_contato"),
      existente(PACIENTE_EXISTENTE, TELEFONE_DO_PACIENTE, "paciente", "novo"),
    );
});

describe("importarContatos como Pacientes", () => {
  it("novo nasce paciente, lead vira paciente, paciente continua, e as contagens batem", async () => {
    const resultado = await importarContatos(banco.cliente(), CLINICA, {
      declaracao: DECLARACAO,
      lote: LOTE,
      importarComo: "pacientes",
    });
    expect(resultado).toEqual({
      ok: true,
      importados: 1,
      atualizados: 2,
      viraram_pacientes: 1,
      ja_eram_pacientes: 1,
      mantidos_sem_autorizacao: 0,
      pulados: 0,
    });
    expect(contatoPorTelefone(TELEFONE_NOVO)?.kind).toBe("paciente");
    expect(contatoPorTelefone(TELEFONE_DO_LEAD)?.kind).toBe("paciente");
    expect(contatoPorTelefone(TELEFONE_DO_PACIENTE)?.kind).toBe("paciente");
  });

  it("a etapa não muda: o lead que virou paciente continua em Em contato", async () => {
    await importarContatos(banco.cliente(), CLINICA, {
      declaracao: DECLARACAO,
      lote: LOTE,
      importarComo: "pacientes",
    });
    expect(contatoPorTelefone(TELEFONE_DO_LEAD)?.funnel_stage).toBe(
      "em_contato",
    );
    expect(contatoPorTelefone(TELEFONE_DO_PACIENTE)?.funnel_stage).toBe("novo");
    // O contato novo nasce sem etapa escolhida (o default do banco) e com a
    // marca de importacao, como qualquer importado.
    const inseridos = banco.operacoes.find(
      (op) => op.tabela === "contact" && op.operacao === "insert",
    )?.valores as Record<string, unknown>[];
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]).toMatchObject({
      kind: "paciente",
      criado_por_importacao: true,
    });
    expect(inseridos[0]).not.toHaveProperty("funnel_stage");
  });

  it("o lead vira paciente set-based, só se ainda for lead, gravando só o kind", async () => {
    await importarContatos(banco.cliente(), CLINICA, {
      declaracao: DECLARACAO,
      lote: LOTE,
      importarComo: "pacientes",
    });
    const updates = banco.operacoes.filter(
      (op) => op.tabela === "contact" && op.operacao === "update",
    );
    // So o update do kind: o nome ja preenchido nao e sobrescrito e nada mais
    // mudou nos que ja existiam.
    expect(updates.map((op) => op.valores)).toEqual([{ kind: "paciente" }]);
  });

  it("falha ao passar os que já existiam devolve a frase e não segue para a autorização", async () => {
    banco.erros.set("contact:update", { code: "57014" });
    const resultado = await importarContatos(banco.cliente(), CLINICA, {
      declaracao: DECLARACAO,
      lote: LOTE,
      importarComo: "pacientes",
    });
    expect(resultado).toEqual({
      ok: false,
      error:
        "Não foi possível passar para pacientes os contatos que já existiam.",
    });
    expect(banco.linhas("contact_consent")).toHaveLength(0);
  });

  it("a autorização segue a regra de sempre (um registro por contato sem autorização)", async () => {
    await importarContatos(banco.cliente(), CLINICA, {
      declaracao: DECLARACAO,
      lote: LOTE,
      importarComo: "pacientes",
    });
    expect(banco.linhas("contact_consent")).toHaveLength(3);
    expect(
      banco
        .linhas("contact_consent")
        .every((linha) => linha.source === "importacao_planilha"),
    ).toBe(true);
  });
});

describe("importarContatos como Leads (o padrão)", () => {
  it.each([
    ["sem a escolha", undefined],
    ["com Leads", "leads" as const],
  ])(
    "%s: novo nasce lead, lead continua lead, paciente continua paciente",
    async (_caso, importarComo) => {
      const resultado = await importarContatos(banco.cliente(), CLINICA, {
        declaracao: DECLARACAO,
        lote: LOTE,
        ...(importarComo ? { importarComo } : {}),
      });
      expect(resultado).toMatchObject({
        ok: true,
        importados: 1,
        atualizados: 2,
        viraram_pacientes: 0,
        ja_eram_pacientes: 1,
      });
      expect(contatoPorTelefone(TELEFONE_NOVO)?.kind).toBe("lead");
      expect(contatoPorTelefone(TELEFONE_DO_LEAD)?.kind).toBe("lead");
      expect(contatoPorTelefone(TELEFONE_DO_PACIENTE)?.kind).toBe("paciente");
      expect(
        banco.operacoes.filter(
          (op) => op.tabela === "contact" && op.operacao === "update",
        ),
      ).toHaveLength(0);
    },
  );
});

describe("importarContatosAction: escolha e trilha", () => {
  it("Pacientes: a trilha registra a escolha e as contagens do lote, sem dado de paciente", async () => {
    const resultado = await importarContatosAction({
      declaracao: DECLARACAO,
      lote: LOTE,
      importar_como: "pacientes",
    });
    expect(resultado).toMatchObject({
      ok: true,
      importados: 1,
      viraram_pacientes: 1,
      ja_eram_pacientes: 1,
    });
    const trilha = banco.linhas("audit_log");
    expect(trilha).toHaveLength(1);
    expect(trilha[0]).toMatchObject({
      clinic_id: CLINICA,
      user_id: USUARIO,
      action: "importou_planilha",
      entity: "contact",
      entity_id: null,
      detalhes: {
        importar_como: "pacientes",
        importados: 1,
        atualizados: 2,
        viraram_pacientes: 1,
        ja_eram_pacientes: 1,
        mantidos_sem_autorizacao: 0,
        pulados: 0,
      },
    });
    const texto = JSON.stringify(trilha[0]);
    expect(texto).not.toContain("99999");
    expect(texto).not.toContain("Pessoa Nova");
  });

  it("sem a escolha (tela antiga): importa como Leads e a trilha diz isso", async () => {
    await importarContatosAction({ declaracao: DECLARACAO, lote: LOTE });
    expect(contatoPorTelefone(TELEFONE_NOVO)?.kind).toBe("lead");
    expect(banco.linhas("audit_log")[0]?.detalhes).toMatchObject({
      importar_como: "leads",
      viraram_pacientes: 0,
    });
  });

  it("escolha fora da lista é recusada sem gravar nada", async () => {
    const resultado = await importarContatosAction({
      declaracao: DECLARACAO,
      lote: LOTE,
      importar_como: "clientes",
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Confira os contatos do lote.",
    });
    expect(banco.operacoes).toHaveLength(0);
  });

  it("profissional não importa", async () => {
    estado.sessao = {
      userId: USUARIO,
      active: {
        clinicId: CLINICA,
        role: "profissional",
        status: "ativo",
        timezone: "America/Fortaleza",
      },
    };
    const resultado = await importarContatosAction({
      declaracao: DECLARACAO,
      lote: LOTE,
      importar_como: "pacientes",
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Seu perfil não pode editar leads e pacientes",
    });
    expect(banco.operacoes).toHaveLength(0);
  });
});
