import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  etapaRecebeFollowup,
  recusaDeFollowup,
  PAPEIS_DE_ETAPA,
} from "@/lib/domain/jornada";

import {
  BancoEmMemoria,
  type Linha,
  type Resposta,
} from "../ia-whatsapp/banco-em-memoria";

// Regua de follow-up e a etapa em que o lead espera a equipe (decisao D3 do
// dono, 21/10/2026, padrao A). Desde a onda 3, Aguardando resposta (papel
// 'aguardando', migration 20261023100000) e onde a passagem da IA poe o
// lead: quem esta ali espera a resposta da CLINICA. Uma regua de follow-up
// nela mandaria mensagem automatica a quem espera gente, na hora, e no canal
// nao oficial isso e risco de denuncia. Entao:
//   - a regra pura: Perdido e Aguardando resposta nao recebem regua;
//   - a action recusa antes do banco, com a frase e o nome da etapa da
//     clinica, e nao grava nada;
//   - o gatilho do banco recusa o mesmo (hint etapa_sem_followup) e a action
//     traduz a recusa;
//   - Em contato (agora de sistema) continua aceitando;
//   - com o banco de antes da migration, Aguardando resposta ainda sem
//     papel ja e recusada pela chave (achado da revisao de 21/10/2026: uma
//     regua criada ali no meio tempo faria a conferencia da migration parar,
//     e mandaria mensagem a quem passa a esperar a clinica).
// A tela tira a etapa da lista (app/(app)/automacoes/page.tsx); o teste da
// tela esta em tests/unit/automacoes/tela-guarda.test.tsx.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";

const estado = vi.hoisted(() => ({ banco: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    (estado.banco as { cliente: () => unknown }).cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    (estado.banco as { cliente: () => unknown }).cliente(),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => ({
    userId: USUARIO,
    active: { clinicId: CLINICA, role: "gestor", status: "ativo" },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { criarReguaDeFollowupAction } =
  await import("@/app/(app)/automacoes/actions");

let banco: BancoEmMemoria;

function etapa(chave: string, nome: string, papel: string | null): Linha {
  return { clinic_id: CLINICA, chave, nome, papel };
}

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  banco
    .linhas("funnel_stage_def")
    .push(
      etapa("novo", "Novo", "entrada"),
      etapa("aguardando_resposta", "Esperando a recepção", "aguardando"),
      etapa("em_contato", "Contato inicial", "em_contato"),
      etapa("pediu_valor", "Pediu valor", null),
      etapa("perdido", "Perdido", "perdido"),
    );
});

describe("etapaRecebeFollowup e recusaDeFollowup", () => {
  it("só Perdido e Aguardando resposta ficam de fora", () => {
    const semRegua = PAPEIS_DE_ETAPA.filter(
      (papel) => !etapaRecebeFollowup({ chave: "qualquer", papel }),
    );
    expect(semRegua).toEqual(["aguardando", "perdido"]);
    expect(etapaRecebeFollowup({ chave: "pediu_valor", papel: null })).toBe(
      true,
    );
  });

  it("banco de antes da migration: a chave aguardando_resposta sem papel também fica de fora", () => {
    expect(
      etapaRecebeFollowup({ chave: "aguardando_resposta", papel: null }),
    ).toBe(false);
    expect(
      recusaDeFollowup({
        chave: "aguardando_resposta",
        nome: "Aguardando resposta",
        papel: null,
      }),
    ).toBe(
      "Quem está em Aguardando resposta espera a resposta da clínica: esta etapa não tem régua de follow-up.",
    );
    // Em contato sem papel (o banco de antes) continua aceitando.
    expect(etapaRecebeFollowup({ chave: "em_contato", papel: null })).toBe(
      true,
    );
  });

  it("a frase diz por quê, com o nome da etapa da clínica", () => {
    expect(
      recusaDeFollowup({
        chave: "aguardando_resposta",
        nome: "Esperando a recepção",
        papel: "aguardando",
      }),
    ).toBe(
      "Quem está em Esperando a recepção espera a resposta da clínica: esta etapa não tem régua de follow-up.",
    );
    expect(
      recusaDeFollowup({ chave: "perdido", nome: "Perdido", papel: "perdido" }),
    ).toBe("A etapa de perda não recebe follow-up automático.");
    expect(
      recusaDeFollowup({
        chave: "em_contato",
        nome: "Em contato",
        papel: "em_contato",
      }),
    ).toBeNull();
    expect(
      recusaDeFollowup({
        chave: "pediu_valor",
        nome: "Pediu valor",
        papel: null,
      }),
    ).toBeNull();
  });

  it("nenhum travessão nas frases", () => {
    for (const papel of PAPEIS_DE_ETAPA) {
      expect(
        recusaDeFollowup({ chave: "etapa", nome: "Etapa", papel }) ?? "",
      ).not.toMatch(/[–—]/);
    }
  });
});

describe("criarReguaDeFollowupAction", () => {
  it("recusa a etapa em que o lead espera a equipe e não grava nada", async () => {
    const resultado = await criarReguaDeFollowupAction({
      trigger_stage: "aguardando_resposta",
    });
    expect(resultado).toEqual({
      ok: false,
      error:
        "Quem está em Esperando a recepção espera a resposta da clínica: esta etapa não tem régua de follow-up.",
    });
    expect(banco.linhas("cadence")).toHaveLength(0);
    expect(banco.linhas("audit_log")).toHaveLength(0);
  });

  it("Perdido continua recusado como antes", async () => {
    expect(
      await criarReguaDeFollowupAction({ trigger_stage: "perdido" }),
    ).toEqual({
      ok: false,
      error: "A etapa de perda não recebe follow-up automático.",
    });
    expect(banco.linhas("cadence")).toHaveLength(0);
  });

  it("Em contato, agora etapa de sistema, continua aceitando a régua", async () => {
    expect(
      await criarReguaDeFollowupAction({ trigger_stage: "em_contato" }),
    ).toEqual({ ok: true });
    expect(banco.linhas("cadence")).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA,
        kind: "followup",
        trigger_stage: "em_contato",
        name: "Follow-up de Contato inicial",
        active: false,
      }),
    ]);
    expect(banco.linhas("audit_log")).toEqual([
      expect.objectContaining({
        action: "criou_regua_de_followup",
        user_id: USUARIO,
      }),
    ]);
  });

  it("banco de antes da migration: Aguardando resposta sem papel também é recusada, sem gravar nada", async () => {
    const etapas = banco.linhas("funnel_stage_def");
    const aguardando = etapas.find((e) => e.chave === "aguardando_resposta")!;
    aguardando.papel = null;
    expect(
      await criarReguaDeFollowupAction({
        trigger_stage: "aguardando_resposta",
      }),
    ).toEqual({
      ok: false,
      error:
        "Quem está em Esperando a recepção espera a resposta da clínica: esta etapa não tem régua de follow-up.",
    });
    expect(banco.linhas("cadence")).toHaveLength(0);
    expect(banco.linhas("audit_log")).toHaveLength(0);
  });

  it("a recusa do gatilho do banco (etapa_sem_followup) vira a mesma frase", async () => {
    // Defesa: o gatilho recusa o que a regra de cima deixou passar (hoje o
    // papel aguardando so existe na chave aguardando_resposta, que a regra ja
    // recusa). A frase leva o nome da etapa pedida.
    banco.aoInserir = (tabela) =>
      tabela === "cadence"
        ? ({
            code: "P0001",
            message:
              "A etapa em que o lead espera a resposta da equipe não tem régua de follow-up.",
            hint: "etapa_sem_followup",
          } as Resposta["error"])
        : null;
    expect(
      await criarReguaDeFollowupAction({ trigger_stage: "pediu_valor" }),
    ).toEqual({
      ok: false,
      error:
        "Quem está em Pediu valor espera a resposta da clínica: esta etapa não tem régua de follow-up.",
    });
    expect(banco.linhas("audit_log")).toHaveLength(0);
  });

  it("outra recusa do banco continua no genérico", async () => {
    banco.aoInserir = (tabela) =>
      tabela === "cadence" ? { code: "42501", message: "negado" } : null;
    expect(
      await criarReguaDeFollowupAction({ trigger_stage: "pediu_valor" }),
    ).toEqual({ ok: false, error: "Não foi possível criar a régua." });
  });
});
