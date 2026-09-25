import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions das telas de entrada (achados 118 e 128 da revisao). O que
// importa aqui e o contrato com a pessoa: a mensagem certa para cada recusa
// do GoTrue, sem revelar se um e-mail tem cadastro.

const auth = {
  signInWithPassword: vi.fn(),
  resend: vi.fn(),
  signUp: vi.fn(),
};
const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth, rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/active-clinic", () => ({
  ACTIVE_CLINIC_COOKIE: "clinica_ativa",
  getSessionContext: async () => null,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([
      ["origin", "https://app.exemplo.test"],
      ["host", "app.exemplo.test"],
    ]),
  cookies: async () => ({ set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
}));

const { signInAction, reenviarConfirmacaoAction } =
  await import("@/app/(auth)/actions");
const { cadastrarPorCodigoAction } =
  await import("@/app/(auth)/cadastro/actions");

function formulario(campos: Record<string, string>): FormData {
  const dados = new FormData();
  for (const [nome, valor] of Object.entries(campos)) {
    dados.set(nome, valor);
  }
  return dados;
}

function erroDoGoTrue(code: string, status: number, message = code) {
  return { code, status, message, name: "AuthApiError" };
}

const LOGIN = { email: "dona@clinica.test", password: "senha-certa-123" };

beforeEach(() => {
  auth.signInWithPassword.mockReset();
  auth.resend.mockReset();
  auth.signUp.mockReset();
  rpc.mockReset();
});

describe("signInAction", () => {
  it("e-mail nao confirmado ganha mensagem propria e o e-mail para reenviar", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: erroDoGoTrue("email_not_confirmed", 400, "Email not confirmed"),
    });
    const estado = await signInAction({}, formulario(LOGIN));
    expect(estado.emailNaoConfirmado).toBe(LOGIN.email);
    expect(estado.error).toMatch(/^Falta confirmar seu e-mail/);
  });

  it("senha errada continua generica e sem o botao de reenviar", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: erroDoGoTrue("invalid_credentials", 400),
    });
    const estado = await signInAction({}, formulario(LOGIN));
    expect(estado).toEqual({ error: "E-mail ou senha incorretos" });
  });

  it("falha do servidor de login nao culpa a senha", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", status: 0, message: "fetch" },
    });
    const estado = await signInAction({}, formulario(LOGIN));
    expect(estado.error).toMatch(/^Não foi possível entrar agora/);
  });

  it("login certo vai para a area logada", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(signInAction({}, formulario(LOGIN))).rejects.toThrow(
      "redirect:/inicio",
    );
  });
});

describe("reenviarConfirmacaoAction", () => {
  const pedido = () => formulario({ email: LOGIN.email });

  it("reenvia pela confirmacao do app", async () => {
    auth.resend.mockResolvedValue({ error: null });
    const estado = await reenviarConfirmacaoAction({}, pedido());
    expect(estado.success).toBeTruthy();
    expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: LOGIN.email,
      options: {
        emailRedirectTo: "https://app.exemplo.test/confirm?next=/inicio",
      },
    });
  });

  it("limite por conta e conta inexistente dao a mesma resposta do sucesso", async () => {
    auth.resend.mockResolvedValue({ error: null });
    const sucesso = await reenviarConfirmacaoAction({}, pedido());

    auth.resend.mockResolvedValue({
      error: erroDoGoTrue(
        "over_email_send_rate_limit",
        429,
        "For security purposes, you can only request this after 42 seconds.",
      ),
    });
    const limitePorConta = await reenviarConfirmacaoAction({}, pedido());

    auth.resend.mockResolvedValue({
      error: erroDoGoTrue("user_not_found", 400),
    });
    const semConta = await reenviarConfirmacaoAction({}, pedido());

    expect(limitePorConta).toEqual(sucesso);
    expect(semConta).toEqual(sucesso);
  });

  it("limite geral de envio pede para esperar", async () => {
    auth.resend.mockResolvedValue({
      error: erroDoGoTrue(
        "over_email_send_rate_limit",
        429,
        "Email rate limit exceeded",
      ),
    });
    const estado = await reenviarConfirmacaoAction({}, pedido());
    expect(estado.error).toMatch(/Espere alguns minutos/);
  });

  it("e-mail invalido nao chega ao GoTrue", async () => {
    const estado = await reenviarConfirmacaoAction(
      {},
      formulario({ email: "nao-e-email" }),
    );
    expect(estado.error).toBe("Informe um e-mail válido");
    expect(auth.resend).not.toHaveBeenCalled();
  });
});

describe("cadastrarPorCodigoAction", () => {
  const pedido = () =>
    formulario({
      codigo: "a1b2c3d4",
      nome: "Recepcionista",
      email: "recepcao@clinica.test",
      password: "senha-nova-123",
    });

  it("codigo desligado depois da conferencia e recusado antes do signUp", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const estado = await cadastrarPorCodigoAction({}, pedido());
    expect(estado.error).toMatch(/^Código da clínica inválido ou desativado\./);
    expect(rpc).toHaveBeenCalledWith("validar_codigo_clinica", {
      p_codigo: "A1B2C3D4",
    });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("recusa do gatilho no caminho do codigo orienta a conferir o codigo", async () => {
    rpc.mockResolvedValue({ data: { nome: "Clínica Teste" }, error: null });
    auth.signUp.mockResolvedValue({
      error: erroDoGoTrue(
        "unexpected_failure",
        500,
        "Database error saving new user",
      ),
    });
    const estado = await cadastrarPorCodigoAction({}, pedido());
    expect(estado.error).toMatch(/Confira com a clínica/);
  });

  it("falha da conferencia deixa o gatilho decidir", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "timeout" } });
    auth.signUp.mockResolvedValue({ error: null });
    const estado = await cadastrarPorCodigoAction({}, pedido());
    expect(estado).toEqual({
      success: "codigo",
      email: "recepcao@clinica.test",
    });
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.exemplo.test/confirm?next=/inicio",
          data: expect.objectContaining({ tipo: "codigo", codigo: "A1B2C3D4" }),
        }),
      }),
    );
  });
});
