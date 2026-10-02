import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";

import { BancoFalso, type Linha } from "../whatsapp/banco-falso";

// Numero das mensagens automaticas (decisao 2 do dono, docs/07 Fase 2; POR
// TIPO desde 29/09/2026): app/(app)/automacoes/actions.ts contra o banco em
// memoria.
//   - definirNumeroDasAutomaticasAction grava so os tipos que mudaram, pela
//     sessao, com Zod e trilha, e recarimba os envios pendentes DESSES tipos
//     em cada numero ativo;
//   - testarEnvioAction sai pelo numero pedido, senao pelo fixo do tipo da
//     regua, senao pelo principal, e o numero manda para ele mesmo.

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

function politica(tipo = "confirmacao"): Linha | undefined {
  return banco
    .linhas("whatsapp_envio_automatico")
    .find((linha) => linha.tipo === tipo);
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
  it("confirmação fixa e follow-up no último usado: grava por tipo, registra na trilha e recarimba só esses tipos", async () => {
    banco.rpc.mockResolvedValue({ data: 2, error: null });

    const resultado = await definirNumeroDasAutomaticasAction({
      escolhas: [
        { tipo: "confirmacao", contaFixaId: recepcao.id },
        { tipo: "followup", contaFixaId: null },
      ],
    });

    expect(resultado).toEqual({ ok: true });
    expect(politica("confirmacao")).toMatchObject({
      clinic_id: CLINICA_A,
      tipo: "confirmacao",
      modo: "fixo",
      conta_fixa_id: recepcao.id,
    });
    expect(politica("followup")).toMatchObject({
      clinic_id: CLINICA_A,
      tipo: "followup",
      modo: "ultimo_usado",
      conta_fixa_id: null,
    });
    // Tipo que ninguem mexeu nao ganha linha (sem linha = ultimo usado).
    expect(banco.linhas("whatsapp_envio_automatico")).toHaveLength(2);
    expect(banco.linhas("audit_log")).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA_A,
        user_id: "usuario-da-sessao",
        action: "definiu_numero_das_automaticas",
      }),
    ]);
    // Os dois ATIVOS da clinica (nem o removido, nem o de outra clinica), e
    // so os tipos que mudaram.
    const recarimbos = banco.rpc.mock.calls.filter(
      ([nome]) => nome === "redistribuir_jobs_do_numero",
    );
    expect(recarimbos.map(([, args]) => args.p_account_id).sort()).toEqual(
      [principal.id, recepcao.id].sort() as string[],
    );
    for (const [, args] of recarimbos) {
      expect(args.p_tipos).toEqual(["confirmacao", "followup"]);
    }
  });

  it("mudar um tipo não mexe na escolha dos outros", async () => {
    banco.linhas("whatsapp_envio_automatico").push(
      {
        clinic_id: CLINICA_A,
        tipo: "confirmacao",
        modo: "fixo",
        conta_fixa_id: recepcao.id,
      },
      {
        clinic_id: CLINICA_A,
        tipo: "aviso_remarcacao",
        modo: "fixo",
        conta_fixa_id: principal.id,
      },
    );

    const resultado = await definirNumeroDasAutomaticasAction({
      escolhas: [{ tipo: "confirmacao", contaFixaId: null }],
    });

    expect(resultado.ok).toBe(true);
    expect(politica("confirmacao")).toMatchObject({
      modo: "ultimo_usado",
      conta_fixa_id: null,
    });
    expect(politica("aviso_remarcacao")).toMatchObject({
      modo: "fixo",
      conta_fixa_id: principal.id,
    });
  });

  it("escolha fora do formato é recusada: tipo desconhecido, número que não é uuid, tipo repetido, lista vazia", async () => {
    for (const entrada of [
      { modo: "fixo", contaFixaId: recepcao.id },
      { escolhas: [] },
      { escolhas: [{ tipo: "eco", contaFixaId: null }] },
      { escolhas: [{ tipo: "confirmacao", contaFixaId: "recepcao" }] },
      { escolhas: [{ tipo: "confirmacao" }] },
      {
        escolhas: [
          { tipo: "followup", contaFixaId: null },
          { tipo: "followup", contaFixaId: recepcao.id },
        ],
      },
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
      escolhas: [{ tipo: "confirmacao", contaFixaId: null }],
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
      escolhas: [{ tipo: "confirmacao", contaFixaId: principal.id }],
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

  it("com o tipo da régua fixo num número, sai por ele", async () => {
    banco.linhas("whatsapp_envio_automatico").push({
      clinic_id: CLINICA_A,
      tipo: "followup",
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

  it("o fixo de OUTRO tipo não vale para esta régua: sai pelo principal", async () => {
    banco.linhas("whatsapp_envio_automatico").push({
      clinic_id: CLINICA_A,
      tipo: "confirmacao",
      modo: "fixo",
      conta_fixa_id: recepcao.id,
    });

    await testarEnvioAction({ cadence_step_id: PASSO });

    expect(fakeSentMessages()).toEqual([
      expect.objectContaining({ accountId: principal.id }),
    ]);
  });

  it("o número pedido vence a política", async () => {
    banco.linhas("whatsapp_envio_automatico").push({
      clinic_id: CLINICA_A,
      tipo: "followup",
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
