import { beforeEach, describe, expect, it, vi } from "vitest";

// enviarComoAtendente (app/(app)/atendimento/actions.ts): o nucleo do
// sendMessageAction, extraido para o "Enviar agora" da mensagem agendada. O
// que se prova: e a MESMA resposta digitada (trilho 1:1, em nome de quem
// envia, sem as marcas do motor), confere a posse da conversa com a sessao,
// e anda o termo da clinica depois do envio (A4: o Enviar agora anda). O
// sendMessageAction continua igual: os testes dele (envio-move-por-termo,
// acoes-por-numero) seguem valendo.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const CONTATO = "d4444444-4444-4444-8444-444444444444";
const CONVERSA = "e5555555-5555-4555-8555-555555555555";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const COLEGA = "98888888-8888-4888-8888-888888888888";

const dubles = vi.hoisted(() => ({
  after: vi.fn<(tarefa: () => Promise<void>) => void>(),
  mover: vi.fn<(...args: unknown[]) => Promise<string | null>>(),
  enviar: vi.fn(),
  papel: "recepcao",
  conversa: {} as Record<string, unknown>,
}));

vi.mock("next/server", () => ({ after: dubles.after }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const cadeia: Record<string, unknown> = {};
    for (const metodo of ["select", "eq"]) {
      cadeia[metodo] = () => cadeia;
    }
    cadeia.maybeSingle = () =>
      Promise.resolve({ data: dubles.conversa, error: null });
    return { from: () => cadeia };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ admin: true }),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => ({
    userId: USUARIO,
    userName: "Ana Recepção",
    active: {
      clinicId: CLINICA,
      timezone: "America/Fortaleza",
      role: dubles.papel,
      status: "ativo",
    },
  }),
}));
vi.mock("@/lib/integrations/whatsapp/send", () => ({
  sendWhatsAppText: dubles.enviar,
  sendWhatsAppMedia: vi.fn(),
  carregarInstancia: vi.fn(),
}));
vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: dubles.mover,
}));

const { enviarComoAtendente, sendMessageAction } =
  await import("@/app/(app)/atendimento/actions");

beforeEach(() => {
  dubles.after.mockReset();
  dubles.mover.mockReset();
  dubles.mover.mockResolvedValue(null);
  dubles.enviar.mockReset();
  dubles.enviar.mockResolvedValue({ ok: true, messageId: "nova" });
  dubles.papel = "recepcao";
  dubles.conversa = {
    id: CONVERSA,
    contact_id: CONTATO,
    status: "em_atendimento",
    assignee_user_id: USUARIO,
    whatsapp_account_id: null,
  };
});

describe("enviarComoAtendente", () => {
  it("envia como resposta digitada, em nome de quem envia, e anda o termo da clínica", async () => {
    expect(await enviarComoAtendente(CONVERSA, "  Até quinta!  ")).toEqual({
      ok: true,
      messageId: "nova",
    });
    expect(dubles.enviar).toHaveBeenCalledTimes(1);
    const [, envio] = dubles.enviar.mock.calls[0]!;
    expect(envio).toEqual({
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      body: "Até quinta!",
      authorUserId: USUARIO,
      replyTo: null,
    });
    await dubles.after.mock.calls[0]![0]();
    expect(dubles.mover.mock.calls[0]![1]).toMatchObject({
      contactId: CONTATO,
      corpo: "Até quinta!",
      quemEscreveu: "clinica",
      userId: USUARIO,
    });
  });

  it("conversa que não está com quem envia: nada sai", async () => {
    dubles.conversa = { ...dubles.conversa, assignee_user_id: COLEGA };
    expect(await enviarComoAtendente(CONVERSA, "Até quinta!")).toEqual({
      ok: false,
      error: "Assuma a conversa antes de responder.",
    });
    expect(dubles.enviar).not.toHaveBeenCalled();
  });

  describe("falha do canal: o código e se é certo que nada saiu (F1)", () => {
    it.each([
      // Pode ter chegado: o "Enviar agora" nao devolve o texto.
      [
        { reason: "falha_envio", code: "envio_incerto", message: "Confira." },
        "envio_incerto",
        false,
      ],
      [
        { reason: "falha_envio", code: "uazapi_500", message: "Falhou." },
        "uazapi_500",
        false,
      ],
      // Certo que nada saiu.
      [
        { reason: "falha_envio", code: "leitura_falhou", message: "Tente." },
        "leitura_falhou",
        true,
      ],
      [
        {
          reason: "falha_envio",
          code: "provider_indisponivel",
          message: "Tente.",
        },
        "provider_indisponivel",
        true,
      ],
      [
        { reason: "falha_envio", code: "registro_falhou", message: "x" },
        "registro_falhou",
        true,
      ],
      [
        { reason: "sem_consentimento", message: "Sem autorização." },
        "sem_consentimento",
        true,
      ],
      [
        { reason: "desconectado", code: "desconectado", message: "Caiu." },
        "desconectado",
        true,
      ],
      [
        {
          reason: "slot_adiado",
          code: "canal_ocupado",
          livreEm: "2026-10-06T15:00:00.000Z",
          message: "Remarcado.",
        },
        "canal_ocupado",
        true,
      ],
    ])("%o", async (falha, codigo, naoSaiu) => {
      dubles.enviar.mockResolvedValue({ ok: false, ...falha });
      const resultado = await enviarComoAtendente(CONVERSA, "Até quinta!");
      expect(resultado).toMatchObject({ ok: false, codigo, naoSaiu });
      expect(dubles.after).not.toHaveBeenCalled();
    });

    it("a recusa antes do canal não traz código nem naoSaiu", async () => {
      dubles.conversa = { ...dubles.conversa, status: "aguardando_humano" };
      const resultado = await enviarComoAtendente(CONVERSA, "Até quinta!");
      expect(resultado).not.toHaveProperty("codigo");
      expect(resultado).not.toHaveProperty("naoSaiu");
    });
  });

  it("Somente leitura não envia", async () => {
    dubles.papel = "leitura";
    const resultado = await enviarComoAtendente(CONVERSA, "Até quinta!");
    expect(resultado.ok).toBe(false);
    expect(dubles.enviar).not.toHaveBeenCalled();
  });

  it("opções nulas vindas do cliente não quebram", async () => {
    const resultado = await enviarComoAtendente(
      CONVERSA,
      "Até quinta!",
      null as never,
    );
    expect(resultado.ok).toBe(true);
  });

  it("sendMessageAction delega e devolve o mesmo resultado", async () => {
    expect(await sendMessageAction(CONVERSA, "Até quinta!")).toEqual({
      ok: true,
      messageId: "nova",
    });
    expect(dubles.enviar.mock.calls[0]![1]).toMatchObject({
      body: "Até quinta!",
      authorUserId: USUARIO,
      replyTo: null,
    });
  });
});
