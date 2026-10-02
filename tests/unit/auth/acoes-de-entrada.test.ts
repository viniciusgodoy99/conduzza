import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions das telas de entrada (achados 118 e 128 da revisao). O que
// importa aqui e o contrato com a pessoa: a mensagem certa para cada recusa
// do GoTrue, sem revelar se um e-mail tem cadastro.

const auth = {
  signInWithPassword: vi.fn(),
  resend: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
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

const { signInAction, reenviarConfirmacaoAction, updatePasswordAction } =
  await import("@/app/(auth)/actions");
const { cadastrarClinicaAction, cadastrarPorCodigoAction } =
  await import("@/app/(auth)/cadastro/actions");
const { REPITA_A_SENHA, SENHA_CURTA, SENHAS_DIFERENTES } =
  await import("@/lib/auth/senha");

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
  auth.updateUser.mockReset();
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
  const pedido = (mudancas: Record<string, string> = {}) =>
    formulario({
      codigo: "a1b2c3d4",
      nome: "Recepcionista",
      email: "recepcao@clinica.test",
      password: "senha-nova-123",
      confirmacao: "senha-nova-123",
      ...mudancas,
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

  // Pedido do dono em 02/10/2026: a senha vem duas vezes. A conferencia
  // acontece antes de qualquer ida ao banco ou ao GoTrue.
  it("senhas diferentes param antes da conferencia do codigo e do signUp", async () => {
    const estado = await cadastrarPorCodigoAction(
      {},
      pedido({ confirmacao: "senha-nova-124" }),
    );
    expect(estado).toEqual({ error: SENHAS_DIFERENTES });
    expect(rpc).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("sem a confirmacao a mensagem sai em portugues", async () => {
    const dados = pedido();
    dados.delete("confirmacao");
    const estado = await cadastrarPorCodigoAction({}, dados);
    expect(estado).toEqual({ error: REPITA_A_SENHA });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("confirmacao vazia pede para repetir a senha", async () => {
    const estado = await cadastrarPorCodigoAction(
      {},
      pedido({ confirmacao: "" }),
    );
    expect(estado).toEqual({ error: REPITA_A_SENHA });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("senha curta vem antes de senhas diferentes", async () => {
    const estado = await cadastrarPorCodigoAction(
      {},
      pedido({ password: "curta", confirmacao: "outra" }),
    );
    expect(estado).toEqual({ error: SENHA_CURTA });
  });

  it("a confirmacao nao vai para o signUp", async () => {
    rpc.mockResolvedValue({ data: { nome: "Clínica Teste" }, error: null });
    auth.signUp.mockResolvedValue({ error: null });
    await cadastrarPorCodigoAction({}, pedido());
    const chamada = auth.signUp.mock.calls[0]?.[0];
    expect(chamada.password).toBe("senha-nova-123");
    expect(Object.keys(chamada)).not.toContain("confirmacao");
    expect(Object.keys(chamada.options.data)).not.toContain("confirmacao");
  });
});

describe("cadastrarClinicaAction", () => {
  const pedido = (mudancas: Record<string, string> = {}) =>
    formulario({
      nomeClinica: "Clínica Sorriso",
      nome: "Dona da Clínica",
      email: "dona@clinica.test",
      password: "senha-nova-123",
      confirmacao: "senha-nova-123",
      ...mudancas,
    });

  it("senhas diferentes nao chegam ao signUp", async () => {
    const estado = await cadastrarClinicaAction(
      {},
      pedido({ confirmacao: "senha-nova-321" }),
    );
    expect(estado).toEqual({ error: SENHAS_DIFERENTES });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("espaco faz parte da senha: com espaco a mais nao confere", async () => {
    const estado = await cadastrarClinicaAction(
      {},
      pedido({ confirmacao: "senha-nova-123 " }),
    );
    expect(estado).toEqual({ error: SENHAS_DIFERENTES });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("sem a confirmacao a mensagem sai em portugues", async () => {
    const dados = pedido();
    dados.delete("confirmacao");
    const estado = await cadastrarClinicaAction({}, dados);
    expect(estado).toEqual({ error: REPITA_A_SENHA });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("senhas iguais criam a conta sem levar a confirmacao", async () => {
    auth.signUp.mockResolvedValue({ error: null });
    const estado = await cadastrarClinicaAction({}, pedido());
    expect(estado).toEqual({ success: "clinica", email: "dona@clinica.test" });
    expect(auth.signUp).toHaveBeenCalledTimes(1);
    const chamada = auth.signUp.mock.calls[0]?.[0];
    expect(chamada.email).toBe("dona@clinica.test");
    expect(chamada.password).toBe("senha-nova-123");
    expect(Object.keys(chamada)).not.toContain("confirmacao");
    expect(chamada.options.data).toEqual({
      tipo: "clinica",
      nome: "Dona da Clínica",
      nome_clinica: "Clínica Sorriso",
      name: "Dona da Clínica",
    });
  });
});

describe("updatePasswordAction", () => {
  const pedido = (mudancas: Record<string, string> = {}) =>
    formulario({
      password: "senha-nova-123",
      confirmacao: "senha-nova-123",
      ...mudancas,
    });

  it("senhas diferentes se resolvem no campo, sem pedir link novo", async () => {
    const estado = await updatePasswordAction(
      {},
      pedido({ confirmacao: "senha-nova-321" }),
    );
    expect(estado).toEqual({ error: SENHAS_DIFERENTES });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("sem a confirmacao a mensagem sai em portugues", async () => {
    const dados = pedido();
    dados.delete("confirmacao");
    const estado = await updatePasswordAction({}, dados);
    expect(estado).toEqual({ error: REPITA_A_SENHA });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("senha curta continua com a mensagem de sempre", async () => {
    const estado = await updatePasswordAction(
      {},
      pedido({ password: "curta", confirmacao: "curta" }),
    );
    expect(estado).toEqual({ error: SENHA_CURTA });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("senhas iguais salvam so a senha e entram", async () => {
    auth.updateUser.mockResolvedValue({ error: null });
    await expect(updatePasswordAction({}, pedido())).rejects.toThrow(
      "redirect:/inicio",
    );
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "senha-nova-123",
    });
  });

  it("link vencido continua pedindo link novo", async () => {
    auth.updateUser.mockResolvedValue({
      error: erroDoGoTrue("session_not_found", 403),
    });
    const estado = await updatePasswordAction({}, pedido());
    expect(estado.pedirLinkNovo).toBe(true);
  });
});
