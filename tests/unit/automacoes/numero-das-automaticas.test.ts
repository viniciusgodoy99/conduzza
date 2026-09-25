import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";

import { BancoFalso, type Linha } from "../whatsapp/banco-falso";

// Numero das mensagens automaticas (decisao 2 do dono, docs/07 Fase 2):
// app/(app)/automacoes/actions.ts contra o banco em memoria.
//   - definirNumeroDasAutomaticasAction grava a politica pela sessao, com
//     Zod e trilha, e recarimba os envios pendentes de cada numero ativo;
//   - testarEnvioAction sai pelo numero pedido, senao pelo fixo da politica,
//     senao pelo principal, e o numero manda para ele mesmo.

const CLINICA_A = "0a0a0a0a-0000-4000-8000-00000000000a";
const CLINICA_B = "0b0b0b0b-0000-4000-8000-00000000000b";
const PASSO = "0e0e0e0e-0000-4000-8000-00000000000e";

const banco = new BancoFalso();
const sessao = {
  userId: "usuario-da-sessao",
  active: {
    clinicId: CLINICA_A,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "gestor" as string,
    status: "ativo",
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => banco.cliente(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.cliente(),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { definirNumeroDasAutomaticasAction, testarEnvioAction } =
  await import("@/app/(app)/automacoes/actions");

function politica(): Linha | undefined {
  return banco.linhas("whatsapp_envio_automatico")[0];
}

let principal: Linha;
let recepcao: Linha;

beforeEach(() => {
  banco.limpar();
  resetFakeProvider();
  sessao.active.role = "gestor";
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("WHATSAPP_PROVIDER", "");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  principal = banco.numero({
    clinic_id: CLINICA_A,
    connection_status: "conectado",
    display_phone: "+55 84 91111-0000",
  });
  recepcao = banco.numero({
    clinic_id: CLINICA_A,
    nome: "Recepção",
    principal: false,
    connection_status: "conectado",
    display_phone: "5584922220000",
  });
  banco.numero({
    clinic_id: CLINICA_A,
    nome: "Antigo",
    principal: false,
    removido_em: "2026-09-20T12:00:00Z",
  });
  banco.numero({ clinic_id: CLINICA_B, connection_status: "conectado" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("definirNumeroDasAutomaticasAction", () => {
  it("fixa o número, registra na trilha e recarimba os pendentes de cada número ativo", async () => {
    banco.rpc.mockResolvedValue({ data: 2, error: null });

    const resultado = await definirNumeroDasAutomaticasAction({
      modo: "fixo",
      contaFixaId: recepcao.id,
    });

    expect(resultado).toEqual({ ok: true });
    expect(politica()).toMatchObject({
      clinic_id: CLINICA_A,
      modo: "fixo",
      conta_fixa_id: recepcao.id,
    });
    expect(banco.linhas("audit_log")).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA_A,
        user_id: "usuario-da-sessao",
        action: "definiu_numero_das_automaticas",
      }),
    ]);
    // Os dois ATIVOS da clinica: nem o removido, nem o de outra clinica.
    const recarimbados = banco.rpc.mock.calls
      .filter(([nome]) => nome === "redistribuir_jobs_do_numero")
      .map(([, args]) => args.p_account_id);
    expect(recarimbados.sort()).toEqual(
      [principal.id, recepcao.id].sort() as string[],
    );
  });

  it("voltar ao último usado limpa o número fixo", async () => {
    banco.linhas("whatsapp_envio_automatico").push({
      clinic_id: CLINICA_A,
      modo: "fixo",
      conta_fixa_id: recepcao.id,
    });

    const resultado = await definirNumeroDasAutomaticasAction({
      modo: "ultimo_usado",
    });

    expect(resultado.ok).toBe(true);
    expect(politica()).toMatchObject({
      modo: "ultimo_usado",
      conta_fixa_id: null,
    });
  });

  it("modo fixo sem número, ou número que não é uuid, é recusado", async () => {
    for (const entrada of [
      { modo: "fixo" },
      { modo: "fixo", contaFixaId: "recepcao" },
      { modo: "sempre" },
    ]) {
      const resultado = await definirNumeroDasAutomaticasAction(entrada);
      expect(resultado).toEqual({
        ok: false,
        error: "Escolha por qual número as mensagens automáticas saem.",
      });
    }
    expect(politica()).toBeUndefined();
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("recepção não altera", async () => {
    sessao.active.role = "recepcao";

    const resultado = await definirNumeroDasAutomaticasAction({
      modo: "ultimo_usado",
    });

    expect(resultado.ok).toBe(false);
    expect(politica()).toBeUndefined();
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("recarimbo que falha não desfaz a escolha, e a tela ouve a ressalva", async () => {
    banco.rpc.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "tempo esgotado" },
    });

    const resultado = await definirNumeroDasAutomaticasAction({
      modo: "fixo",
      contaFixaId: principal.id,
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.aviso).toBe(
      "A escolha foi salva, mas parte das mensagens que já estavam agendadas continua saindo pelo número de antes.",
    );
    expect(politica()).toMatchObject({ conta_fixa_id: principal.id });
  });
});

describe("testarEnvioAction: por qual número", () => {
  beforeEach(() => {
    banco.linhas("clinic").push({
      id: CLINICA_A,
      name: "Clínica A",
      timezone: "America/Fortaleza",
    });
    banco.linhas("cadence_step").push({
      id: PASSO,
      clinic_id: CLINICA_A,
      fixed_body: "Olá {nome}",
      media_path: null,
      media_type: null,
      media_mimetype: null,
      media_filename: null,
      cadence: { kind: "followup" },
    });
  });

  it("sem política, sai pelo principal para ele mesmo", async () => {
    const resultado = await testarEnvioAction({ cadence_step_id: PASSO });

    expect(resultado.ok).toBe(true);
    expect(fakeSentMessages()).toEqual([
      expect.objectContaining({
        accountId: principal.id,
        to: "5584911110000",
      }),
    ]);
  });

  it("com número fixo nas automáticas, sai por ele", async () => {
    banco.linhas("whatsapp_envio_automatico").push({
      clinic_id: CLINICA_A,
      modo: "fixo",
      conta_fixa_id: recepcao.id,
    });

    await testarEnvioAction({ cadence_step_id: PASSO });

    expect(fakeSentMessages()).toEqual([
      expect.objectContaining({
        accountId: recepcao.id,
        to: "5584922220000",
      }),
    ]);
  });

  it("o número pedido vence a política", async () => {
    banco.linhas("whatsapp_envio_automatico").push({
      clinic_id: CLINICA_A,
      modo: "fixo",
      conta_fixa_id: recepcao.id,
    });

    await testarEnvioAction({
      cadence_step_id: PASSO,
      whatsapp_account_id: principal.id,
    });

    expect(fakeSentMessages()).toEqual([
      expect.objectContaining({ accountId: principal.id }),
    ]);
  });

  it("número de outra clínica ou removido não serve", async () => {
    const alheio = banco
      .linhas("whatsapp_account")
      .find((numero) => numero.clinic_id === CLINICA_B)!;
    const removido = banco
      .linhas("whatsapp_account")
      .find((numero) => numero.nome === "Antigo")!;

    for (const id of [alheio.id, removido.id]) {
      const resultado = await testarEnvioAction({
        cadence_step_id: PASSO,
        whatsapp_account_id: id,
      });
      expect(resultado.error).toBe(
        "Este número não existe mais nesta clínica. Recarregue a página.",
      );
    }
    expect(fakeSentMessages()).toHaveLength(0);
  });

  it("número escolhido desconectado não recebe o teste", async () => {
    recepcao.connection_status = "desconectado";

    const resultado = await testarEnvioAction({
      cadence_step_id: PASSO,
      whatsapp_account_id: recepcao.id,
    });

    expect(resultado.ok).toBe(false);
    expect(fakeSentMessages()).toHaveLength(0);
  });
});
