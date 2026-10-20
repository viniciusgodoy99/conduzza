import { beforeEach, describe, expect, it, vi } from "vitest";

import { BancoEmMemoria } from "../ia-whatsapp/banco-em-memoria";

// Novo lead com a autorizacao para receber mensagens (decisao do dono em
// 20/10/2026, para a equipe poder iniciar a conversa pelo sistema): a
// pergunta e OPCIONAL, com as opcoes e a regra da declaracao da importacao
// ("Outra origem" exige observacao). A Server Action de verdade
// (criarLeadAction), contra um banco em memoria: cada opcao vira a linha de
// contact_consent com a fonte e a evidencia certas e a trilha
// 'concedeu_consentimento'; sem resposta, nada de autorizacao, como sempre.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "a0000000-0000-4000-8000-000000000001";
const TELEFONE = "(85) 99999-0001";

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

const { criarLeadAction } = await import("@/app/(app)/leads/actions");

let banco: BancoEmMemoria;

function sessao(papel = "recepcao") {
  return {
    userId: USUARIO,
    userName: "Ana Recepção",
    active: {
      clinicId: CLINICA,
      role: papel,
      status: "ativo",
      timezone: "America/Fortaleza",
    },
  };
}

function inseriuContato(): boolean {
  return banco.operacoes.some(
    (op) => op.tabela === "contact" && op.operacao === "insert",
  );
}

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  estado.sessao = sessao();
});

describe("Novo lead: cada opção da autorização", () => {
  it.each([
    [
      "formulário do site",
      { opcao: "formulario_site" },
      "formulario_site",
      "Formulário do site",
    ],
    [
      "anúncio com clique para o WhatsApp",
      { opcao: "anuncio_ctwa" },
      "anuncio_ctwa",
      "Anúncio com clique para o WhatsApp",
    ],
    [
      "cadastro na recepção, com observação",
      { opcao: "recepcao", observacao: "Assinou a ficha no balcão" },
      "recepcao",
      "Cadastro presencial na recepção: Assinou a ficha no balcão",
    ],
    [
      "outra origem, com a observação obrigatória",
      { opcao: "outra", observacao: "Pediu pelo Instagram da clínica" },
      // Sem fonte propria no banco: o registro feito pela equipe, e a
      // evidencia diz qual foi a origem.
      "recepcao",
      "Outra origem: Pediu pelo Instagram da clínica",
    ],
  ])(
    "%s grava a autorização com a fonte e a evidência",
    async (_caso, autorizacao, fonte, evidencia) => {
      const resultado = await criarLeadAction({
        name: "Maria Lima",
        phone_e164: TELEFONE,
        autorizacao,
      });
      expect(resultado.ok).toBe(true);
      expect(resultado.aviso).toBeUndefined();
      const [contato] = banco.linhas("contact");
      expect(contato).toMatchObject({
        clinic_id: CLINICA,
        kind: "lead",
        phone_e164: "+5585999990001",
      });
      expect(resultado.id).toBe(contato?.id);

      expect(banco.linhas("contact_consent")).toEqual([
        expect.objectContaining({
          clinic_id: CLINICA,
          contact_id: contato?.id,
          channel: "whatsapp",
          source: fonte,
          evidence: evidencia,
        }),
      ]);
      // Trilha: criou e concedeu, com o id do contato, sem dado de paciente.
      expect(
        banco.linhas("audit_log").map((linha) => ({
          action: linha.action,
          entity: linha.entity,
          entity_id: linha.entity_id,
        })),
      ).toEqual([
        { action: "criou", entity: "contact", entity_id: contato?.id },
        {
          action: "concedeu_consentimento",
          entity: "contact",
          entity_id: contato?.id,
        },
      ]);
    },
  );
});

describe("Novo lead: as recusas da autorização", () => {
  it.each([
    ["sem observação", { opcao: "outra" }],
    ["com observação de uma letra", { opcao: "outra", observacao: " x " }],
  ])(
    "outra origem %s é recusada e nada é gravado",
    async (_caso, autorizacao) => {
      const resultado = await criarLeadAction({
        phone_e164: TELEFONE,
        autorizacao,
      });
      expect(resultado).toEqual({
        ok: false,
        error: "Descreva como o contato autorizou receber mensagens.",
      });
      expect(inseriuContato()).toBe(false);
      expect(banco.linhas("contact_consent")).toHaveLength(0);
      expect(banco.linhas("audit_log")).toHaveLength(0);
    },
  );

  it("opção fora da lista é recusada sem gravar", async () => {
    const resultado = await criarLeadAction({
      phone_e164: TELEFONE,
      autorizacao: { opcao: "importacao_planilha" },
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Confira os campos do lead.",
    });
    expect(inseriuContato()).toBe(false);
  });

  it("leitura não cria lead nem autorização", async () => {
    estado.sessao = sessao("leitura");
    const resultado = await criarLeadAction({
      phone_e164: TELEFONE,
      autorizacao: { opcao: "recepcao" },
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Seu perfil não pode editar leads e pacientes",
    });
    expect(banco.operacoes).toHaveLength(0);
  });
});

describe("Novo lead: sem a pergunta respondida, como sempre", () => {
  it("o contato nasce sem autorização e a trilha só diz que criou", async () => {
    const resultado = await criarLeadAction({
      name: "João Souza",
      phone_e164: TELEFONE,
    });
    expect(resultado).toMatchObject({ ok: true });
    expect(banco.linhas("contact")).toHaveLength(1);
    expect(banco.linhas("contact_consent")).toHaveLength(0);
    expect(banco.linhas("audit_log").map((linha) => linha.action)).toEqual([
      "criou",
    ]);
  });
});

describe("Novo lead: a autorização que não gravou", () => {
  it("o lead fica criado e a tela recebe o aviso para registrar na ficha", async () => {
    banco.erros.set("contact_consent:insert", { code: "42501" });
    const resultado = await criarLeadAction({
      phone_e164: TELEFONE,
      autorizacao: { opcao: "formulario_site" },
    });
    expect(resultado).toEqual({
      ok: true,
      id: banco.linhas("contact")[0]?.id,
      aviso:
        "O lead foi criado, mas a autorização não foi registrada. Registre na ficha do contato.",
    });
    expect(banco.linhas("audit_log").map((linha) => linha.action)).toEqual([
      "criou",
    ]);
  });
});
