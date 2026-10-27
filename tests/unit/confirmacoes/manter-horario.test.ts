import { beforeEach, describe, expect, it, vi } from "vitest";

import { BancoFalso, type Linha } from "../agenda/banco-falso-da-agenda";

// "Manter o horário" da Tela 2 (revisao da leva 1, R12) na AG4 (desenho,
// secao 5; D-29 e D-32 pela recomendacao): quando o pedido de remarcacao
// veio da IA e a remarcacao dela (a consulta nova, ligada por remarcacao_de)
// ainda espera a equipe na Agenda, nada muda e a tela avisa "Há uma
// remarcação pedida pela IA esperando aprovação na Agenda.". Sem remarcacao
// pendente, tudo como antes. A leitura que falha recusa (nunca zera a marca
// sem conferir). Contra um cliente do Supabase dublado.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const ANTIGA = "c0c0c0c0-0000-4000-8000-0000000000a0";
const NOVA = "c0c0c0c0-0000-4000-8000-0000000000a1";
const USUARIO = "e1e1e1e1-0000-4000-8000-000000000001";

const AVISO = "Há uma remarcação pedida pela IA esperando aprovação na Agenda.";

let banco = new BancoFalso();

const sessao = {
  userId: USUARIO,
  active: {
    clinicId: CLINICA,
    timezone: "America/Fortaleza",
    role: "recepcao" as string,
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));

const { manterHorarioAction } =
  await import("@/app/(app)/confirmacoes/actions");
const { retornoDoManterHorario, TEXTOS_DO_MANTER_HORARIO } =
  await import("@/components/confirmacoes/manter-horario");

function antiga(extra: Linha = {}): Linha {
  return {
    id: ANTIGA,
    clinic_id: CLINICA,
    status: "agendado",
    approval_status: null,
    remarcacao_de: null,
    remarcacao_pedida_em: "2026-10-27T15:00:00.000Z",
    ...extra,
  };
}

function nova(extra: Linha = {}): Linha {
  return {
    id: NOVA,
    clinic_id: CLINICA,
    status: "agendado",
    approval_status: "pendente",
    remarcacao_de: ANTIGA,
    remarcacao_pedida_em: null,
    ...extra,
  };
}

beforeEach(() => {
  banco = new BancoFalso();
  banco.tabelas.appointment = [antiga(), nova()];
  sessao.active.role = "recepcao";
});

describe("Manter o horário com a remarcação da IA pendente", () => {
  it("nada muda, e a ação diz que a remarcação está na Agenda", async () => {
    expect(await manterHorarioAction({ appointment_id: ANTIGA })).toEqual({
      ok: false,
      code: "remarcacao_da_ia_pendente",
      error: AVISO,
    });
    expect(banco.gravacoes()).toEqual([]);
    expect(banco.linha("appointment", ANTIGA).remarcacao_pedida_em).toBe(
      "2026-10-27T15:00:00.000Z",
    );
  });

  it("a remarcação é lida do banco, pela clínica, pela antiga e só a pendente viva", async () => {
    await manterHorarioAction({ appointment_id: ANTIGA });
    const [leitura] = banco.doTipo("appointment", "select");
    expect(leitura?.colunas).toBe("id");
    expect(leitura?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["remarcacao_de", ANTIGA],
      ["approval_status", "pendente"],
    ]);
    expect(leitura?.excluidos).toEqual([
      ["status", ["cancelado_paciente", "cancelado_clinica"]],
    ]);
  });

  it("a remarcação já tratada (aprovada, recusada ou cancelada) não impede: mantém como antes", async () => {
    for (const mudanca of [
      { approval_status: "aprovado" },
      { approval_status: "recusado", status: "cancelado_clinica" },
      { status: "cancelado_paciente" },
    ]) {
      banco = new BancoFalso();
      banco.tabelas.appointment = [antiga(), nova(mudanca)];
      expect(
        await manterHorarioAction({ appointment_id: ANTIGA }),
        JSON.stringify(mudanca),
      ).toEqual({ ok: true });
      expect(
        banco.linha("appointment", ANTIGA).remarcacao_pedida_em,
      ).toBeNull();
      expect(
        banco.doTipo("audit_log", "insert").map((op) => op.dados),
      ).toMatchObject([
        { action: "manteve_horario_apos_pedido_de_remarcacao" },
      ]);
    }
  });

  it("leitura que falha recusa, sem zerar a marca", async () => {
    banco.errosNaLeitura.appointment = { code: "57014" };
    expect(await manterHorarioAction({ appointment_id: ANTIGA })).toEqual({
      ok: false,
      error: "Não foi possível manter o horário.",
    });
    expect(banco.gravacoes()).toEqual([]);
  });

  it("guarda e Zod antes do banco", async () => {
    sessao.active.role = "leitura";
    expect(await manterHorarioAction({ appointment_id: ANTIGA })).toEqual({
      ok: false,
      error: "Seu perfil não pode alterar confirmações.",
    });
    sessao.active.role = "recepcao";
    expect(await manterHorarioAction({ appointment_id: "x" })).toEqual({
      ok: false,
      error: "Consulta inválida.",
    });
    expect(banco.operacoes).toEqual([]);
  });
});

describe("o que a Tela 2 diz", () => {
  it("a remarcação pendente é atenção, nunca erro nem sucesso", () => {
    expect(
      retornoDoManterHorario({
        ok: false,
        code: "remarcacao_da_ia_pendente",
        error: AVISO,
      }),
    ).toEqual({ tipo: "warning", texto: AVISO });
    expect(retornoDoManterHorario({ ok: true })).toEqual({
      tipo: "success",
      texto: "Horário mantido. O pedido de remarcação saiu da lista.",
    });
    expect(retornoDoManterHorario({ ok: false, error: "X." })).toEqual({
      tipo: "error",
      texto: "X.",
    });
    expect(retornoDoManterHorario({ ok: false })).toEqual({
      tipo: "error",
      texto: "Não foi possível manter o horário.",
    });
  });

  it("sem travessão e sem jargão", () => {
    for (const amostra of [AVISO, ...Object.values(TEXTOS_DO_MANTER_HORARIO)]) {
      expect(amostra).not.toMatch(/[—–]/);
      expect(amostra).not.toMatch(/\b(remarcacao_de|appointment|handoff)\b/i);
    }
  });
});
