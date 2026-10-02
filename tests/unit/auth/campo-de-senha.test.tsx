import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Olho para mostrar a senha e senha digitada duas vezes (pedido do dono em
// 02/10/2026). O Vitest roda sem DOM: aqui se confere a marcacao que sai do
// servidor (rotulos, ligacoes de acessibilidade, o botao que nunca envia o
// formulario e a ordem dos elementos). O clique e a conferencia no navegador
// ficam no e2e (tests/e2e/senha.spec.ts).

vi.mock("@/app/(auth)/actions", () => ({
  signInAction: vi.fn(),
  reenviarConfirmacaoAction: vi.fn(),
  updatePasswordAction: vi.fn(),
}));
vi.mock("@/app/(auth)/cadastro/actions", () => ({
  cadastrarClinicaAction: vi.fn(),
  cadastrarPorCodigoAction: vi.fn(),
  conferirCodigoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const { CampoDeSenha } = await import("@/components/shared/campo-de-senha");
const { SenhaComConfirmacao } =
  await import("@/app/(auth)/components/senha-com-confirmacao");
const { PasswordForm } = await import("@/app/(auth)/components/password-form");
const { CadastroForm } = await import("@/app/(auth)/cadastro/cadastro-form");
const { LoginForm } = await import("@/app/(auth)/login/login-form");
const { SENHAS_DIFERENTES } = await import("@/lib/auth/senha");

// O React escreve os atributos como na prop (autoComplete, minLength), e o
// HTML nao diferencia maiuscula: a comparacao e feita em minusculas.
function campo(html: string, id: string): string {
  const achado = html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`));
  if (!achado) {
    throw new Error(`campo ${id} nao encontrado`);
  }
  return achado[0].toLowerCase();
}

function botoes(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
}

function botaoDoOlho(html: string, rotulo: string): string {
  const achado = botoes(html).find((b) => b.includes(`aria-label="${rotulo}"`));
  if (!achado) {
    throw new Error(`botao ${rotulo} nao encontrado`);
  }
  return achado;
}

function camposDeSenha(html: string): string[] {
  return [...html.matchAll(/<input[^>]*type="password"[^>]*>/g)].map(
    (m) => m[0],
  );
}

describe("CampoDeSenha", () => {
  const html = renderToStaticMarkup(
    <CampoDeSenha
      id="password"
      name="password"
      autoComplete="current-password"
      required
      className="h-11"
    />,
  );

  it("comeca com a senha oculta", () => {
    expect(campo(html, "password")).toContain('type="password"');
  });

  it("o olho nunca envia o formulario e controla o campo", () => {
    const botao = botaoDoOlho(html, "Mostrar senha");
    expect(botao).toContain('type="button"');
    expect(botao).toContain('aria-controls="password"');
  });

  it("sem aria-pressed: o rotulo que muda ja diz o estado", () => {
    expect(html).not.toContain("aria-pressed");
  });

  it("o icone e decorativo", () => {
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("repassa o autocomplete e desliga corretor e maiuscula automatica", () => {
    const input = campo(html, "password");
    expect(input).toContain('autocomplete="current-password"');
    expect(input).toContain('spellcheck="false"');
    expect(input).toContain('autocapitalize="none"');
    expect(input).toContain('autocorrect="off"');
    expect(input).toContain('name="password"');
    expect(input).toContain("required");
  });

  it("deixa espaco para o botao dentro do campo de 44px", () => {
    const input = campo(html, "password");
    expect(input).toMatch(/class="[^"]*\bpr-12\b/);
    expect(input).toMatch(/class="[^"]*\bh-11\b/);
    // Alvo de toque de 40px (size icon) com o olho neutro, por token.
    const botao = botaoDoOlho(html, "Mostrar senha");
    expect(botao).toMatch(/class="[^"]*\bsize-10\b/);
    expect(botao).toMatch(/class="[^"]*\btext-text-secondary\b/);
    expect(botao).toMatch(/class="[^"]*\babsolute\b/);
  });

  it("o olho vem logo depois do campo na ordem do Tab", () => {
    expect(html.indexOf('id="password"')).toBeLessThan(
      html.indexOf('aria-label="Mostrar senha"'),
    );
  });

  it("oQueMostrar muda o nome do botao", () => {
    const outro = renderToStaticMarkup(
      <CampoDeSenha
        id="confirmacao"
        autoComplete="new-password"
        oQueMostrar="a senha repetida"
      />,
    );
    const botao = botaoDoOlho(outro, "Mostrar a senha repetida");
    expect(botao).toContain('aria-controls="confirmacao"');
    expect(campo(outro, "confirmacao")).toContain(
      'autocomplete="new-password"',
    );
  });

  it("campo desabilitado desabilita o olho tambem", () => {
    const desabilitado = renderToStaticMarkup(
      <CampoDeSenha id="password" autoComplete="new-password" disabled />,
    );
    expect(campo(desabilitado, "password")).toMatch(/\sdisabled=""/);
    expect(botaoDoOlho(desabilitado, "Mostrar senha")).toMatch(/\sdisabled=""/);
  });

  it("classNameDoContainer posiciona o contorno, nao o campo", () => {
    const naGrade = renderToStaticMarkup(
      <CampoDeSenha
        id="password"
        autoComplete="current-password"
        classNameDoContainer="col-span-2 row-start-2"
      />,
    );
    expect(naGrade).toMatch(
      /^<div class="relative grid col-span-2 row-start-2"><input/,
    );
    expect(campo(naGrade, "password")).not.toContain("col-span-2");
  });
});

describe("SenhaComConfirmacao", () => {
  const html = renderToStaticMarkup(<SenhaComConfirmacao />);

  it("pede a senha e a repeticao, as duas como senha nova", () => {
    expect(html).toMatch(/<label[^>]*for="password"[^>]*>Senha<\/label>/);
    expect(html).toMatch(
      /<label[^>]*for="confirmacao"[^>]*>Repita a senha<\/label>/,
    );
    const senha = campo(html, "password");
    const confirmacao = campo(html, "confirmacao");
    expect(senha).toContain('name="password"');
    expect(confirmacao).toContain('name="confirmacao"');
    for (const input of [senha, confirmacao]) {
      expect(input).toContain('type="password"');
      expect(input).toContain('autocomplete="new-password"');
      expect(input).toContain("required");
    }
  });

  it("a regra das 8 letras continua no primeiro campo, com a dica", () => {
    const senha = campo(html, "password");
    expect(senha).toContain('minlength="8"');
    expect(senha).toContain('aria-describedby="password-dica"');
    expect(html).toMatch(
      /<p id="password-dica"[^>]*>Pelo menos 8 caracteres\.<\/p>/,
    );
  });

  it("dois olhos com nomes diferentes no mesmo formulario", () => {
    expect(botaoDoOlho(html, "Mostrar senha")).toContain(
      'aria-controls="password"',
    );
    expect(botaoDoOlho(html, "Mostrar a senha repetida")).toContain(
      'aria-controls="confirmacao"',
    );
  });

  it("a confirmacao aponta para a regiao do erro, que nasce vazia", () => {
    const confirmacao = campo(html, "confirmacao");
    expect(confirmacao).toContain('aria-describedby="confirmacao-erro"');
    expect(confirmacao).not.toMatch(/\saria-invalid=/);
    expect(html).toContain(
      '<div id="confirmacao-erro" aria-live="polite"></div>',
    );
    expect(html).not.toContain(SENHAS_DIFERENTES);
  });

  it("o PasswordForm troca so o rotulo do primeiro campo", () => {
    const nova = renderToStaticMarkup(
      <SenhaComConfirmacao rotulo="Nova senha" />,
    );
    expect(nova).toMatch(/<label[^>]*for="password"[^>]*>Nova senha<\/label>/);
    expect(nova).toMatch(
      /<label[^>]*for="confirmacao"[^>]*>Repita a senha<\/label>/,
    );
  });
});

describe("onde a senha aparece", () => {
  it("convite e redefinicao: nova senha e repeticao", () => {
    const html = renderToStaticMarkup(
      <PasswordForm
        title="Redefinir senha"
        description="Escolha uma senha nova para a sua conta."
        submitLabel="Salvar nova senha"
      />,
    );
    expect(camposDeSenha(html)).toHaveLength(2);
    expect(html).toContain(">Nova senha</label>");
    expect(html).toContain(">Repita a senha</label>");
    // So o botao de salvar envia; os dois olhos sao type="button".
    const envio = botoes(html).filter((b) => b.includes('type="submit"'));
    expect(envio).toHaveLength(1);
  });

  it.each(["clinica", "codigo"])(
    "cadastro pelo caminho %s: senha e repeticao",
    (tipo) => {
      const html = renderToStaticMarkup(<CadastroForm tipoInicial={tipo} />);
      expect(camposDeSenha(html)).toHaveLength(2);
      expect(html).toMatch(/<label[^>]*for="password"[^>]*>Senha<\/label>/);
      expect(html).toContain(">Repita a senha</label>");
      expect(campo(html, "confirmacao")).toContain('name="confirmacao"');
      const envio = botoes(html).filter((b) => b.includes('type="submit"'));
      expect(envio).toHaveLength(1);
    },
  );

  it("login: so o olho, sem repeticao, rotulo Senha exato", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    expect(camposDeSenha(html)).toHaveLength(1);
    expect(html).not.toContain("Repita a senha");
    expect(html).toMatch(/<label[^>]*for="password"[^>]*>Senha<\/label>/);
    const senha = campo(html, "password");
    expect(senha).toContain('autocomplete="current-password"');
    expect(senha).not.toContain("minlength");
    expect(botaoDoOlho(html, "Mostrar senha")).toContain('type="button"');
  });

  it("login: Tab do e-mail cai na senha, depois o olho, o link e Entrar", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    const ordem = [
      html.indexOf('id="email"'),
      html.indexOf('id="password"'),
      html.indexOf('aria-label="Mostrar senha"'),
      html.indexOf('href="/recuperar-senha"'),
      html.indexOf(">Entrar</button>"),
    ];
    expect(ordem.every((posicao) => posicao >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    // "Entrar" e o primeiro botao de envio: o Enter no campo cai nele.
    const primeiroEnvio = html.search(/<button[^>]*type="submit"/);
    const fimDoBotao = html.indexOf("</button>", primeiroEnvio);
    expect(html.slice(primeiroEnvio, fimDoBotao)).toMatch(/>Entrar$/);
  });
});
