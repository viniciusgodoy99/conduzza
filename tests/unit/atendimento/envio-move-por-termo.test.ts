import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Termo-chave escrito pela CLINICA pelo sistema (pedido do dono em
// 02/10/2026, item 0 do plano "Automacoes de fluxo e CRM"): depois que a
// atendente envia um texto pelo Inbox, o mesmo teste de termo da mensagem do
// paciente roda com quem escreveu = clinica. O que se prova aqui, com a
// sessao, o banco e o envio trocados por dubles:
//   - so depois do envio BEM-SUCEDIDO (envio recusado nao move nada);
//   - DEPOIS da resposta (after): a action responde sem esperar o movimento;
//   - fora de uma requisicao (after indisponivel) a tarefa roda solta;
//   - falha do movimento nunca vira falha do envio, e o log nao leva texto;
//   - a LEGENDA do arquivo enviado pelo Inbox (enviarArquivoAction) e texto
//     da recepcao e passa pelo mesmo movimento; sem legenda ou com envio
//     recusado, nada.
// O movimento em si esta em tests/unit/whatsapp/termo-chave.test.ts.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const CONTATO = "d4444444-4444-4444-8444-444444444444";
const CONVERSA = "e5555555-5555-4555-8555-555555555555";
const USUARIO = "97777777-7777-4777-8777-777777777777";

const dubles = vi.hoisted(() => ({
  after: vi.fn<(tarefa: () => Promise<void>) => void>(),
  mover: vi.fn<(...args: unknown[]) => Promise<string | null>>(),
  enviar:
    vi.fn<
      (
        ...args: unknown[]
      ) => Promise<
        | { ok: true; messageId: string }
        | { ok: false; reason: string; message: string }
      >
    >(),
  enviarMidia:
    vi.fn<
      (
        ...args: unknown[]
      ) => Promise<
        | { ok: true; messageId: string }
        | { ok: false; reason: string; message: string }
      >
    >(),
}));

const conversa = {
  id: CONVERSA,
  contact_id: CONTATO,
  status: "em_atendimento",
  assignee_user_id: USUARIO,
  whatsapp_account_id: null,
};

function clienteDaSessao() {
  const cadeia: Record<string, unknown> = {};
  for (const metodo of ["select", "eq"]) {
    cadeia[metodo] = () => cadeia;
  }
  cadeia.maybeSingle = () => Promise.resolve({ data: conversa, error: null });
  return { from: () => cadeia };
}

vi.mock("next/server", () => ({ after: dubles.after }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clienteDaSessao(),
}));
// O balde de midia do envio de arquivo: guardar e remover sempre funcionam.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    admin: true,
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  }),
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
vi.mock("@/lib/integrations/whatsapp/send", () => ({
  sendWhatsAppText: dubles.enviar,
  sendWhatsAppMedia: dubles.enviarMidia,
  carregarInstancia: vi.fn(),
}));
vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: dubles.mover,
}));

const { enviarArquivoAction, sendMessageAction } = await import(
  "@/app/(app)/atendimento/actions"
);

function formularioComFoto(legenda?: string): FormData {
  const formulario = new FormData();
  formulario.set(
    "arquivo",
    new File([new Uint8Array([0xff, 0xd8, 0xff])], "foto.jpg", {
      type: "image/jpeg",
    }),
  );
  if (legenda !== undefined) {
    formulario.set("legenda", legenda);
  }
  return formulario;
}

let saida: string[] = [];

beforeEach(() => {
  dubles.after.mockReset();
  dubles.mover.mockReset();
  dubles.mover.mockResolvedValue(null);
  dubles.enviar.mockReset();
  dubles.enviar.mockResolvedValue({ ok: true, messageId: "nova" });
  dubles.enviarMidia.mockReset();
  dubles.enviarMidia.mockResolvedValue({ ok: true, messageId: "arquivo" });
  saida = [];
  const capturar = (pedaco: string | Uint8Array): boolean => {
    saida.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendMessageAction: termo escrito pela clínica", () => {
  it("depois do envio, agenda o movimento como clínica, com quem enviou, sem esperar por ele", async () => {
    const resultado = await sendMessageAction(
      CONVERSA,
      "  Olá! Seja bem-vinda à Clínica Salud Care  ",
    );

    expect(resultado).toEqual({ ok: true, messageId: "nova" });
    // A action respondeu e o movimento ainda nao rodou: so o after o tem.
    expect(dubles.after).toHaveBeenCalledTimes(1);
    expect(dubles.mover).not.toHaveBeenCalled();

    await dubles.after.mock.calls[0]![0]();

    expect(dubles.mover).toHaveBeenCalledTimes(1);
    expect(dubles.mover.mock.calls[0]![1]).toEqual({
      clinicId: CLINICA,
      contactId: CONTATO,
      corpo: "Olá! Seja bem-vinda à Clínica Salud Care",
      quemEscreveu: "clinica",
      userId: USUARIO,
    });
  });

  it("envio recusado não agenda movimento nenhum", async () => {
    dubles.enviar.mockResolvedValue({
      ok: false,
      reason: "sem_consentimento",
      message: "Este paciente não autorizou receber mensagens.",
    });

    const resultado = await sendMessageAction(CONVERSA, "Seja bem-vinda");

    expect(resultado.ok).toBe(false);
    expect(dubles.after).not.toHaveBeenCalled();
    expect(dubles.mover).not.toHaveBeenCalled();
  });

  it("fora de uma requisição (after indisponível) a tarefa roda solta e a action não espera", async () => {
    dubles.after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    // Movimento que nunca termina: se a action esperasse por ele, o teste
    // estouraria o tempo.
    dubles.mover.mockReturnValue(new Promise<string | null>(() => undefined));

    const resultado = await sendMessageAction(CONVERSA, "Seja bem-vinda");

    expect(resultado).toEqual({ ok: true, messageId: "nova" });
    expect(dubles.mover).toHaveBeenCalledTimes(1);
  });

  it("falha do movimento não vira falha do envio e o log não leva o texto", async () => {
    dubles.mover.mockRejectedValue(new Error("Seja bem-vinda quebrou"));

    const resultado = await sendMessageAction(
      CONVERSA,
      "Seja bem-vinda à Clínica Salud Care",
    );
    expect(resultado).toEqual({ ok: true, messageId: "nova" });

    await expect(dubles.after.mock.calls[0]![0]()).resolves.toBeUndefined();
    const tudo = saida.join("");
    expect(tudo).toContain("termo_chave_falhou");
    expect(tudo).toContain('"kind":"clinica"');
    expect(tudo).not.toContain("bem-vinda");
    expect(tudo).not.toContain("Salud");
  });
});

describe("enviarArquivoAction: a legenda é texto da clínica", () => {
  it("depois do envio, a legenda aparada agenda o movimento como clínica, com quem enviou", async () => {
    const resultado = await enviarArquivoAction(
      CONVERSA,
      formularioComFoto("  Seja bem-vinda! Segue a foto da Clínica Salud Care  "),
    );

    expect(resultado).toEqual({ ok: true });
    expect(dubles.enviarMidia).toHaveBeenCalledTimes(1);
    expect(dubles.after).toHaveBeenCalledTimes(1);
    expect(dubles.mover).not.toHaveBeenCalled();

    await dubles.after.mock.calls[0]![0]();

    expect(dubles.mover).toHaveBeenCalledTimes(1);
    expect(dubles.mover.mock.calls[0]![1]).toEqual({
      clinicId: CLINICA,
      contactId: CONTATO,
      corpo: "Seja bem-vinda! Segue a foto da Clínica Salud Care",
      quemEscreveu: "clinica",
      userId: USUARIO,
    });
  });

  it("arquivo sem legenda (ou só com espaços) não agenda movimento", async () => {
    expect(await enviarArquivoAction(CONVERSA, formularioComFoto())).toEqual({
      ok: true,
    });
    expect(
      await enviarArquivoAction(CONVERSA, formularioComFoto("   ")),
    ).toEqual({ ok: true });
    expect(dubles.enviarMidia).toHaveBeenCalledTimes(2);
    expect(dubles.after).not.toHaveBeenCalled();
    expect(dubles.mover).not.toHaveBeenCalled();
  });

  it("envio do arquivo recusado não agenda movimento nenhum", async () => {
    dubles.enviarMidia.mockResolvedValue({
      ok: false,
      reason: "sem_consentimento",
      message: "Este paciente não autorizou receber mensagens.",
    });

    const resultado = await enviarArquivoAction(
      CONVERSA,
      formularioComFoto("Seja bem-vinda"),
    );

    expect(resultado.ok).toBe(false);
    expect(dubles.after).not.toHaveBeenCalled();
    expect(dubles.mover).not.toHaveBeenCalled();
  });

  it("falha do movimento pela legenda não vira falha do envio e o log não leva o texto", async () => {
    dubles.mover.mockRejectedValue(new Error("Seja bem-vinda quebrou"));

    const resultado = await enviarArquivoAction(
      CONVERSA,
      formularioComFoto("Seja bem-vinda à Clínica Salud Care"),
    );
    expect(resultado).toEqual({ ok: true });

    await expect(dubles.after.mock.calls[0]![0]()).resolves.toBeUndefined();
    const tudo = saida.join("");
    expect(tudo).toContain("termo_chave_falhou");
    expect(tudo).not.toContain("bem-vinda");
    expect(tudo).not.toContain("Salud");
  });
});
