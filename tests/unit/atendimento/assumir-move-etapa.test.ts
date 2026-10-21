import { beforeEach, describe, expect, it, vi } from "vitest";

import { BancoEmMemoria, type Linha } from "../ia-whatsapp/banco-em-memoria";

// O lead anda para Em contato quando a equipe pega a conversa, nas Server
// Actions de verdade (app/(app)/atendimento/actions.ts), com a sessao e o
// banco trocados por um banco em memoria. A regra pura esta provada em
// tests/unit/domain/etapa-apos-assumir.test.ts; aqui, o encanamento:
//   - Assumir le chave, papel e POSICAO da jornada pelo cliente admin e
//     move o lead de Novo e, desde a onda 3 (21/10/2026), tambem de
//     Aguardando resposta, com a trilha em nome de quem assumiu;
//   - com o banco de antes da migration 20261023100000 (as duas etapas sem
//     papel) nada muda: Novo vai para a chave em_contato, Aguardando fica;
//   - a posicao lida e respeitada: nunca para tras;
//   - Transferir e Reabrir (decisao D7 do dono) movem pela mesma regra, cada
//     um com a propria trilha e o usuario da acao;
//   - o CAS que perde para a manutencao do funil (que levou o lead de Novo
//     para Aguardando resposta no mesmo instante) rele o contato uma vez e
//     leva o lead para Em contato (achado da revisao de 21/10/2026);
//   - mover etapa e melhor esforco: falha nunca derruba a acao.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "a0000000-0000-4000-8000-000000000001";
const COLEGA = "a0000000-0000-4000-8000-000000000002";
const CONTATO = "10000000-0000-4000-8000-000000000001";
const CONVERSA = "30000000-0000-4000-8000-000000000001";
const NUMERO = "20000000-0000-4000-8000-000000000001";

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  adminQuebrado: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    (estado.banco as { cliente: () => unknown }).cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (estado.adminQuebrado) {
      throw new Error("sem service role");
    }
    return (estado.banco as { cliente: () => unknown }).cliente();
  },
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => ({
    userId: USUARIO,
    userName: "Ana Recepção",
    active: {
      clinicId: CLINICA,
      clinicName: "Clínica",
      slug: "clinica",
      timezone: "America/Fortaleza",
      role: "recepcao",
      status: "ativo",
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const {
  assumirConversaAction,
  reabrirConversaAction,
  transferirConversaAction,
} = await import("@/app/(app)/atendimento/actions");

type Etapa = { chave: string; papel: string | null; posicao: number };

/** A jornada depois da migration: as seis etapas de sistema. */
const NOVA: Etapa[] = [
  { chave: "novo", papel: "entrada", posicao: 10 },
  { chave: "aguardando_resposta", papel: "aguardando", posicao: 20 },
  { chave: "em_contato", papel: "em_contato", posicao: 30 },
  { chave: "agendou", papel: "agendou", posicao: 40 },
  { chave: "compareceu", papel: "compareceu", posicao: 50 },
  { chave: "perdido", papel: "perdido", posicao: 60 },
];

/** A jornada de antes: Em contato e Aguardando resposta livres. */
const VELHA: Etapa[] = [
  { chave: "novo", papel: "entrada", posicao: 10 },
  { chave: "em_contato", papel: null, posicao: 20 },
  { chave: "aguardando_resposta", papel: null, posicao: 30 },
  { chave: "agendou", papel: "agendou", posicao: 40 },
  { chave: "compareceu", papel: "compareceu", posicao: 50 },
  { chave: "perdido", papel: "perdido", posicao: 60 },
];

let banco: BancoEmMemoria;

function montar(campos: {
  jornada?: Etapa[];
  etapa?: string;
  kind?: "lead" | "paciente";
  status?: string;
  responsavel?: string | null;
}): void {
  banco.linhas("funnel_stage_def").push(
    ...(campos.jornada ?? NOVA).map((linha): Linha => ({
      clinic_id: CLINICA,
      nome: linha.chave,
      ...linha,
    })),
  );
  banco.linhas("contact").push({
    id: CONTATO,
    clinic_id: CLINICA,
    kind: campos.kind ?? "lead",
    funnel_stage: campos.etapa ?? "novo",
  });
  banco.linhas("conversation").push({
    id: CONVERSA,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    status: campos.status ?? "aguardando_humano",
    assignee_user_id: campos.responsavel ?? null,
    whatsapp_account_id: NUMERO,
  });
}

function etapaDoContato(): unknown {
  return banco.linhas("contact")[0]?.funnel_stage;
}

function trilhas(): { action: unknown; user_id: unknown; entity: unknown }[] {
  return banco.linhas("audit_log").map((linha) => ({
    action: linha.action,
    user_id: linha.user_id,
    entity: linha.entity,
  }));
}

function movimentosDeEtapa(): Linha[] {
  return banco
    .linhas("audit_log")
    .filter((linha) => String(linha.action).endsWith("_moveu_etapa"));
}

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  estado.adminQuebrado = false;
});

describe("Assumir: o lead anda para Em contato", () => {
  it("de Novo, com a trilha de quem assumiu", async () => {
    montar({ etapa: "novo" });
    expect(await assumirConversaAction(CONVERSA)).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("em_contato");
    expect(trilhas()).toEqual([
      { action: "assumiu_conversa", user_id: USUARIO, entity: "conversation" },
      { action: "assumir_moveu_etapa", user_id: USUARIO, entity: "contact" },
    ]);
  });

  it("de Aguardando resposta (a IA passou a conversa para a equipe)", async () => {
    montar({ etapa: "aguardando_resposta" });
    expect(await assumirConversaAction(CONVERSA)).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("em_contato");
    expect(movimentosDeEtapa()).toHaveLength(1);
  });

  it("a trilha do movimento só tem ids e o nome da ação", async () => {
    montar({ etapa: "novo" });
    await assumirConversaAction(CONVERSA);
    const [movimento] = movimentosDeEtapa();
    expect(Object.keys(movimento!).sort()).toEqual(
      [
        "action",
        "clinic_id",
        "created_at",
        "entity",
        "entity_id",
        "id",
        "user_id",
      ].sort(),
    );
    expect(movimento!.entity_id).toBe(CONTATO);
  });

  it("paciente, Em contato, Agendou e Perdido ficam onde estão", async () => {
    for (const [kind, etapa] of [
      ["paciente", "novo"],
      ["lead", "em_contato"],
      ["lead", "agendou"],
      ["lead", "perdido"],
    ] as const) {
      banco = new BancoEmMemoria();
      estado.banco = banco;
      montar({ kind, etapa });
      expect(await assumirConversaAction(CONVERSA), `${kind} ${etapa}`).toEqual(
        { ok: true },
      );
      expect(etapaDoContato(), `${kind} ${etapa}`).toBe(etapa);
      expect(movimentosDeEtapa(), `${kind} ${etapa}`).toHaveLength(0);
    }
  });

  it("lê a posição: Em contato antes da etapa atual não move (nunca para trás)", async () => {
    montar({
      etapa: "aguardando_resposta",
      jornada: [
        { chave: "novo", papel: "entrada", posicao: 10 },
        { chave: "em_contato", papel: "em_contato", posicao: 20 },
        { chave: "aguardando_resposta", papel: "aguardando", posicao: 30 },
      ],
    });
    expect(await assumirConversaAction(CONVERSA)).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("aguardando_resposta");
    expect(movimentosDeEtapa()).toHaveLength(0);
  });

  it("acha Em contato pelo papel, mesmo com outra chave", async () => {
    montar({
      etapa: "novo",
      jornada: [
        { chave: "novo", papel: "entrada", posicao: 10 },
        { chave: "contato_inicial", papel: "em_contato", posicao: 20 },
      ],
    });
    await assumirConversaAction(CONVERSA);
    expect(etapaDoContato()).toBe("contato_inicial");
  });
});

describe("Assumir com o banco de antes da migration", () => {
  it("Novo vai para a chave em_contato, como sempre", async () => {
    montar({ jornada: VELHA, etapa: "novo" });
    await assumirConversaAction(CONVERSA);
    expect(etapaDoContato()).toBe("em_contato");
  });

  it("Aguardando resposta sem papel fica onde está", async () => {
    montar({ jornada: VELHA, etapa: "aguardando_resposta" });
    expect(await assumirConversaAction(CONVERSA)).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("aguardando_resposta");
    expect(movimentosDeEtapa()).toHaveLength(0);
  });
});

/**
 * Uma escrita concorrente na etapa do contato, no instante entre a leitura e
 * o CAS do movimento: antes de cada update de funnel_stage em contact, roda
 * aoAtualizar (a vez 1 e o primeiro CAS). Imita quem confirmou primeiro.
 */
function comCorrida(aoAtualizar: (vez: number) => void): void {
  const original = banco;
  let vez = 0;
  estado.banco = {
    cliente: () => {
      const cliente = original.cliente() as unknown as {
        from: (tabela: string) => Record<string, unknown>;
      };
      return {
        ...cliente,
        from: (tabela: string) => {
          const consulta = cliente.from(tabela);
          if (tabela !== "contact") {
            return consulta;
          }
          const update = consulta.update as (valores: Linha) => unknown;
          consulta.update = (valores: Linha) => {
            if ("funnel_stage" in valores) {
              vez += 1;
              aoAtualizar(vez);
            }
            return update.call(consulta, valores);
          };
          return consulta;
        },
      };
    },
  };
}

describe("corrida com a manutenção do funil (revisão de 21/10/2026)", () => {
  it("o CAS perdeu para a manutenção: relê e leva de Aguardando resposta para Em contato", async () => {
    montar({ etapa: "novo" });
    // A manutencao do funil leva o lead de Novo para Aguardando resposta
    // entre a leitura do contato e o CAS do Assumir.
    comCorrida((vez) => {
      if (vez === 1) {
        banco.linhas("contact")[0]!.funnel_stage = "aguardando_resposta";
      }
    });
    expect(await assumirConversaAction(CONVERSA)).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("em_contato");
    expect(
      movimentosDeEtapa().map((linha) => [linha.action, linha.user_id]),
    ).toEqual([["assumir_moveu_etapa", USUARIO]]);
  });

  it("relê uma vez só: perdeu de novo (o lead agendou no meio), não move e a ação vale", async () => {
    montar({ etapa: "novo" });
    comCorrida((vez) => {
      banco.linhas("contact")[0]!.funnel_stage =
        vez === 1 ? "aguardando_resposta" : "agendou";
    });
    expect(await assumirConversaAction(CONVERSA)).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("agendou");
    expect(movimentosDeEtapa()).toHaveLength(0);
  });

  it("a releitura também vale para Transferir", async () => {
    banco.linhas("clinic_member").push({
      clinic_id: CLINICA,
      user_id: COLEGA,
      status: "ativo",
      role: "recepcao",
    });
    banco.linhas("profile").push({ user_id: COLEGA, name: "Bia Lima" });
    montar({ etapa: "novo" });
    comCorrida((vez) => {
      if (vez === 1) {
        banco.linhas("contact")[0]!.funnel_stage = "aguardando_resposta";
      }
    });
    expect(
      await transferirConversaAction({
        conversation_id: CONVERSA,
        para_user_id: COLEGA,
      }),
    ).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("em_contato");
    expect(movimentosDeEtapa().map((linha) => linha.action)).toEqual([
      "transferir_moveu_etapa",
    ]);
  });
});

describe("mover etapa nunca derruba a ação", () => {
  it("leitura da jornada que falha: assume e não move", async () => {
    montar({ etapa: "novo" });
    banco.erros.set("funnel_stage_def:select", {
      code: "57014",
      message: "canceling statement due to statement timeout",
    });
    expect(await assumirConversaAction(CONVERSA)).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("novo");
    expect(banco.linhas("conversation")[0]).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: USUARIO,
    });
  });

  it("cliente admin que quebra: assume, não move e não loga dado do paciente", async () => {
    montar({ etapa: "novo" });
    estado.adminQuebrado = true;
    const saida = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      expect(await assumirConversaAction(CONVERSA)).toEqual({ ok: true });
      expect(etapaDoContato()).toBe("novo");
      const linhas = saida.mock.calls.map(([texto]) => String(texto));
      const aviso = linhas.find((linha) =>
        linha.includes("assumir_moveu_etapa_falhou"),
      );
      expect(aviso).toBeDefined();
      expect(JSON.parse(aviso!)).toMatchObject({
        nivel: "warn",
        clinic_id: CLINICA,
        contact_id: CONTATO,
      });
      expect(aviso).not.toContain("Ana Recepção");
    } finally {
      saida.mockRestore();
    }
  });
});

describe("Transferir para um colega (decisão D7)", () => {
  beforeEach(() => {
    banco.linhas("clinic_member").push({
      clinic_id: CLINICA,
      user_id: COLEGA,
      status: "ativo",
      role: "recepcao",
    });
    banco.linhas("profile").push({ user_id: COLEGA, name: "Bia Lima" });
  });

  it("lead em Aguardando resposta anda para Em contato, com a trilha de quem passou", async () => {
    montar({ etapa: "aguardando_resposta" });
    expect(
      await transferirConversaAction({
        conversation_id: CONVERSA,
        para_user_id: COLEGA,
      }),
    ).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("em_contato");
    expect(banco.linhas("conversation")[0]).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: COLEGA,
    });
    expect(trilhas()).toEqual([
      {
        action: "transferiu_conversa",
        user_id: USUARIO,
        entity: "conversation",
      },
      {
        action: "transferir_moveu_etapa",
        user_id: USUARIO,
        entity: "contact",
      },
    ]);
  });

  it("transferência recusada não mexe na etapa", async () => {
    montar({ etapa: "novo" });
    expect(
      await transferirConversaAction({
        conversation_id: CONVERSA,
        para_user_id: "a0000000-0000-4000-8000-000000000009",
      }),
    ).toMatchObject({ ok: false });
    expect(etapaDoContato()).toBe("novo");
    expect(movimentosDeEtapa()).toHaveLength(0);
  });

  it("paciente transferido fica onde está", async () => {
    montar({ etapa: "novo", kind: "paciente" });
    await transferirConversaAction({
      conversation_id: CONVERSA,
      para_user_id: COLEGA,
    });
    expect(etapaDoContato()).toBe("novo");
  });
});

describe("Reabrir (decisão D7)", () => {
  it("lead em Novo anda para Em contato, com a trilha de quem reabriu", async () => {
    montar({ etapa: "novo", status: "resolvida" });
    expect(await reabrirConversaAction(CONVERSA)).toEqual({ ok: true });
    expect(etapaDoContato()).toBe("em_contato");
    expect(trilhas()).toEqual([
      { action: "reabrir_moveu_etapa", user_id: USUARIO, entity: "contact" },
    ]);
  });

  it("conversa que já estava aberta: nada reabre e nada se move", async () => {
    montar({ etapa: "novo", status: "em_atendimento", responsavel: COLEGA });
    expect(await reabrirConversaAction(CONVERSA)).toEqual({
      ok: false,
      error: "A conversa já foi reaberta.",
    });
    expect(etapaDoContato()).toBe("novo");
  });
});
