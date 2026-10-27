import { beforeEach, describe, expect, it, vi } from "vitest";

import { BancoFalso, type Linha } from "../agenda/banco-falso-da-agenda";

// "Manter o horário" da Tela 2 (revisao da leva 1, R12) na AG4 (desenho,
// secao 5; D-29 e D-32 pela recomendacao): quando o pedido de remarcacao
// veio da IA e a remarcacao dela (a consulta nova, ligada por remarcacao_de)
// ainda espera a equipe na Agenda, nada muda e a tela avisa "Há uma
// remarcação pedida pela IA esperando aprovação na Agenda.". Sem remarcacao
// pendente, tudo como antes. A leitura que falha recusa (nunca zera a marca
// sem conferir). Contra um cliente do Supabase dublado.
//
// Revisao da AG4 (achado 7): a conferencia e o update eram dois passos; a
// remarcacao que a IA pedisse no meio teria a marca zerada. Agora a versao
// da consulta (updated_at, lida antes de conferir) vai no filtro do update:
// a IA so cria a remarcacao gravando na antiga (a marca, com coalesce, na
// mesma transacao), o que muda a versao, e o update nao acha a linha.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const ANTIGA = "c0c0c0c0-0000-4000-8000-0000000000a0";
const NOVA = "c0c0c0c0-0000-4000-8000-0000000000a1";
const USUARIO = "e1e1e1e1-0000-4000-8000-000000000001";

const AVISO = "Há uma remarcação pedida pela IA esperando aprovação na Agenda.";
const PEDIDO = "2026-10-27T15:00:00.000Z";
const VERSAO = "2026-10-27T15:00:00.123456+00:00";
const VERSAO_DA_IA = "2026-10-27T15:00:01.654321+00:00";

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
    remarcacao_pedida_em: PEDIDO,
    updated_at: VERSAO,
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
    updated_at: VERSAO,
    ...extra,
  };
}

/**
 * Roda `antes` logo antes de cada update da consulta (a tentativa conta a
 * partir de 1): o que outra transacao grava entre a conferencia e o update.
 */
function entreAConferenciaEOUpdate(antes: (tentativa: number) => void) {
  const original = banco.cliente.bind(banco);
  let tentativa = 0;
  banco.cliente = () => {
    const cliente = original();
    return {
      ...cliente,
      from: (tabela: string) => {
        const consulta = cliente.from(tabela);
        if (tabela !== "appointment") {
          return consulta;
        }
        const update = consulta.update;
        consulta.update = (dados: unknown) => {
          tentativa += 1;
          antes(tentativa);
          return update(dados);
        };
        return consulta;
      },
    };
  };
}

function trilha(): unknown[] {
  return banco.doTipo("audit_log", "insert").map((op) => op.dados);
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
      PEDIDO,
    );
  });

  it("lê a consulta e a versão ANTES de conferir a remarcação, pela clínica, pela antiga e só a pendente viva", async () => {
    await manterHorarioAction({ appointment_id: ANTIGA });
    const [daConsulta, daRemarcacao, ...outras] = banco.doTipo(
      "appointment",
      "select",
    );
    expect(outras).toEqual([]);
    expect(daConsulta?.colunas).toBe("remarcacao_pedida_em, updated_at");
    expect(daConsulta?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", ANTIGA],
    ]);
    expect(daRemarcacao?.colunas).toBe("id");
    expect(daRemarcacao?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["remarcacao_de", ANTIGA],
      ["approval_status", "pendente"],
    ]);
    expect(daRemarcacao?.excluidos).toEqual([
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
      expect(trilha()).toMatchObject([
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

describe("a condição vai no próprio update (revisão da AG4, achado 7)", () => {
  it("o update só zera a marca da versão conferida", async () => {
    banco.tabelas.appointment = [antiga()];
    expect(await manterHorarioAction({ appointment_id: ANTIGA })).toEqual({
      ok: true,
    });
    const [update, ...outros] = banco.doTipo("appointment", "update");
    expect(outros).toEqual([]);
    expect(update?.dados).toEqual({ remarcacao_pedida_em: null });
    expect(update?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", ANTIGA],
      ["updated_at", VERSAO],
    ]);
    expect(update?.preenchidos).toEqual(["remarcacao_pedida_em"]);
    // A versao e lida antes da conferencia da remarcacao.
    expect(banco.sequencia).toEqual([
      "appointment:select",
      "appointment:select",
      "appointment:update",
      "audit_log:insert",
    ]);
  });

  it("a IA pede a remarcação entre a conferência e o update: nada muda, e a tela avisa", async () => {
    banco.tabelas.appointment = [antiga()];
    entreAConferenciaEOUpdate((tentativa) => {
      if (tentativa === 1) {
        // A transacao do agendar_pela_ia: a nova pendente e, na antiga, a
        // marca (coalesce: o mesmo instante) com a versao nova.
        banco.tabelas.appointment?.push(nova());
        banco.linha("appointment", ANTIGA).updated_at = VERSAO_DA_IA;
      }
    });
    expect(await manterHorarioAction({ appointment_id: ANTIGA })).toEqual({
      ok: false,
      code: "remarcacao_da_ia_pendente",
      error: AVISO,
    });
    expect(banco.linha("appointment", ANTIGA).remarcacao_pedida_em).toBe(
      PEDIDO,
    );
    expect(trilha()).toEqual([]);
    // Um update so (o que nao achou a linha); a segunda volta parou na
    // conferencia.
    expect(banco.doTipo("appointment", "update")).toHaveLength(1);
  });

  it("a consulta mudou por outro motivo: confere de novo e mantém, com a versão nova", async () => {
    banco.tabelas.appointment = [antiga()];
    entreAConferenciaEOUpdate((tentativa) => {
      if (tentativa === 1) {
        banco.linha("appointment", ANTIGA).updated_at = VERSAO_DA_IA;
      }
    });
    expect(await manterHorarioAction({ appointment_id: ANTIGA })).toEqual({
      ok: true,
    });
    const updates = banco.doTipo("appointment", "update");
    expect(updates.map((op) => op.filtros)).toEqual([
      [
        ["clinic_id", CLINICA],
        ["id", ANTIGA],
        ["updated_at", VERSAO],
      ],
      [
        ["clinic_id", CLINICA],
        ["id", ANTIGA],
        ["updated_at", VERSAO_DA_IA],
      ],
    ]);
    expect(banco.linha("appointment", ANTIGA).remarcacao_pedida_em).toBeNull();
    expect(trilha()).toHaveLength(1);
  });

  it("a consulta muda a cada volta: para em duas, sem zerar, e pede para tentar de novo", async () => {
    banco.tabelas.appointment = [antiga()];
    entreAConferenciaEOUpdate((tentativa) => {
      banco.linha("appointment", ANTIGA).updated_at =
        `2026-10-27T15:00:0${tentativa + 1}.000000+00:00`;
    });
    expect(await manterHorarioAction({ appointment_id: ANTIGA })).toEqual({
      ok: false,
      error: "Esta consulta acabou de mudar. Confira a lista e tente de novo.",
    });
    expect(banco.doTipo("appointment", "update")).toHaveLength(2);
    expect(banco.linha("appointment", ANTIGA).remarcacao_pedida_em).toBe(
      PEDIDO,
    );
    expect(trilha()).toEqual([]);
  });

  it("sem pedido em aberto (ou consulta de outra clínica): diz isso, sem conferir nem gravar", async () => {
    for (const linhas of [
      [antiga({ remarcacao_pedida_em: null })],
      [antiga({ clinic_id: "0a0a0a0a-0000-4000-8000-00000000000b" })],
      [],
    ]) {
      banco = new BancoFalso();
      banco.tabelas.appointment = linhas;
      expect(await manterHorarioAction({ appointment_id: ANTIGA })).toEqual({
        ok: false,
        error: "Esta consulta não tem mais pedido de remarcação em aberto.",
      });
      expect(banco.gravacoes()).toEqual([]);
      expect(banco.doTipo("appointment", "select")).toHaveLength(1);
    }
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
    for (const amostra of [
      AVISO,
      ...Object.values(TEXTOS_DO_MANTER_HORARIO),
      "Esta consulta acabou de mudar. Confira a lista e tente de novo.",
      "Esta consulta não tem mais pedido de remarcação em aberto.",
    ]) {
      expect(amostra).not.toMatch(/[—–]/);
      expect(amostra).not.toMatch(
        /\b(remarcacao_de|appointment|handoff|updated_at)\b/i,
      );
    }
  });
});
