import { beforeEach, describe, expect, it, vi } from "vitest";

import { BancoEmMemoria, type Linha } from "../ia-whatsapp/banco-em-memoria";

// Ligar uma regua de follow-up COM etiqueta e sem mensagem (onda 4, correcao
// de 22/10/2026). A precedencia (regua_de_followup_do_contato) olha so as
// reguas LIGADAS, sem olhar os passos: ligada e vazia, ela vale para os
// leads com as etiquetas dela e nao manda nada, e eles perdem a regua geral
// da etapa. Por isso alternarReguaAction so liga a regua com etiqueta que tem
// pelo menos uma mensagem. A geral, as outras reguas e o desligar seguem
// como sempre; leitura que falha recusa (nada muda).

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const COM_ETIQUETA = "b2222222-2222-4222-8222-222222222222";
const GERAL = "a1111111-1111-4111-8111-111111111111";
const CONFIRMACAO = "d4444444-4444-4444-8444-444444444444";

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
    active: {
      clinicId: CLINICA,
      role: "gestor",
      status: "ativo",
      timezone: "America/Fortaleza",
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { alternarReguaAction } =
  await import("@/app/(app)/confirmacoes/actions");

const RECUSA =
  "Escreva pelo menos uma mensagem antes de ligar esta régua. Ligada sem mensagem, os leads com estas etiquetas não receberiam nada, nem a régua geral da etapa.";

let banco: BancoEmMemoria;

function regua(campos: Linha): Linha {
  return {
    clinic_id: CLINICA,
    kind: "followup",
    trigger_stage: "em_contato",
    active: false,
    etiquetas: [],
    etiquetas_modo: "qualquer",
    prioridade: 0,
    send_window_start: "08:00:00",
    send_window_end: "18:00:00",
    send_weekdays: [1, 2, 3, 4, 5],
    ...campos,
  };
}

const ativa = (id: string) =>
  banco.linhas("cadence").find((linha) => linha.id === id)?.active;
const trilha = () => banco.linhas("audit_log");

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  banco
    .linhas("cadence")
    .push(
      regua({ id: COM_ETIQUETA, etiquetas: ["Psiquiatria"] }),
      regua({ id: GERAL }),
      regua({ id: CONFIRMACAO, kind: "confirmacao", trigger_stage: null }),
    );
});

describe("ligar régua de follow-up com etiqueta e sem mensagem", () => {
  it("recusa, sem mudar nada nem gravar trilha", async () => {
    expect(
      await alternarReguaAction({ cadence_id: COM_ETIQUETA, ativar: true }),
    ).toEqual({ ok: false, error: RECUSA });
    expect(ativa(COM_ETIQUETA)).toBe(false);
    expect(trilha()).toEqual([]);
  });

  it("com uma mensagem, liga", async () => {
    banco.linhas("cadence_step").push({
      id: "passo-1",
      clinic_id: CLINICA,
      cadence_id: COM_ETIQUETA,
      offset_minutes: 60,
      fixed_body: "Oi!",
    });
    expect(
      await alternarReguaAction({ cadence_id: COM_ETIQUETA, ativar: true }),
    ).toEqual({ ok: true });
    expect(ativa(COM_ETIQUETA)).toBe(true);
    expect(trilha().map((linha) => linha.action)).toEqual(["ativou_regua"]);
  });

  it("a geral e as outras réguas sem mensagem ligam como sempre", async () => {
    for (const id of [GERAL, CONFIRMACAO]) {
      expect(
        await alternarReguaAction({ cadence_id: id, ativar: true }),
      ).toEqual({ ok: true });
      expect(ativa(id)).toBe(true);
    }
  });

  it("desligar não confere nada (a vazia ligada por corrida pode desligar)", async () => {
    banco.linhas("cadence")[0]!.active = true;
    expect(
      await alternarReguaAction({ cadence_id: COM_ETIQUETA, ativar: false }),
    ).toEqual({ ok: true });
    expect(ativa(COM_ETIQUETA)).toBe(false);
  });

  it.each(["cadence", "cadence_step"])(
    "a leitura de %s falha: recusa, nada muda",
    async (tabela) => {
      banco.erros.set(`${tabela}:select`, {
        code: "57014",
        message: "statement timeout",
      });
      expect(
        await alternarReguaAction({ cadence_id: COM_ETIQUETA, ativar: true }),
      ).toEqual({ ok: false, error: "Não foi possível mudar a régua." });
      expect(ativa(COM_ETIQUETA)).toBe(false);
      expect(trilha()).toEqual([]);
    },
  );
});
