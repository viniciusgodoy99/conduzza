import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Membership, SessionContext } from "@/lib/auth/active-clinic";

// A guarda e o menu da area do super admin (app/(admin)/layout.tsx; decisao
// do dono de 03/11/2026, "Conta propria so para o painel"), com a sessao
// falsa e nada de rede:
// - sem sessao, o login; quem nao e super admin (com ou sem clinica), o
//   Inicio; leitura que falhou, "Seu acesso nao carregou" com "Tentar de
//   novo" e Sair, sem o painel;
// - o super admin fica: o menu proprio com o Painel geral (a rota atual,
//   aria-current), o e-mail da conta e Sair, alvo de 40px, e o conteudo da
//   rota dentro dele; nada do menu da clinica;
// - "Abrir a clinica" (para o Inicio) so para a conta que ainda e membro
//   ativo de alguma clinica (as contas antigas, ate a limpeza);
// - nenhum travessao e nada do banco (a guarda so le a sessao).

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  sessao: null as SessionContext | null,
}));

vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => estado.sessao,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  usePathname: () => "/painel-geral",
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
const banco = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: banco.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: banco.createAdminClient,
}));
vi.mock("@/app/(auth)/actions", () => ({
  pickClinicAction: vi.fn(),
  signOutAction: vi.fn(),
}));

const { default: AreaDaEquipeLayout } = await import("@/app/(admin)/layout");

const EMAIL = "painel@equipe.test";

function vinculo(status: Membership["status"]): Membership {
  return {
    clinicId: "a1111111-1111-4111-8111-111111111111",
    clinicName: "Clínica Centro",
    slug: "clinica-centro",
    timezone: "America/Fortaleza",
    role: "admin",
    implementador: false,
    status,
    productName: "Conduzza Clínicas",
    primaryColor: "#B2E54F",
    labels: null,
  };
}

function sessao(campos: Partial<SessionContext> = {}): SessionContext {
  return {
    userId: "u0000000-0000-4000-8000-000000000001",
    userName: EMAIL,
    userEmail: EMAIL,
    memberships: [],
    active: null,
    clinicaSuspensa: null,
    isProductAdmin: true,
    vinculoIndisponivel: false,
    marcaDeImplementadorIndisponivel: false,
    ...campos,
  };
}

async function html(): Promise<string> {
  const elemento = (await AreaDaEquipeLayout({
    children: <p>conteúdo do painel</p>,
  })) as ReactElement;
  return renderToStaticMarkup(elemento);
}

function texto(marcacao: string): string {
  return marcacao
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  estado.sessao = null;
});

describe("guarda da área do super admin", () => {
  it("sem sessão: vai para o login", async () => {
    estado.sessao = null;
    await expect(html()).rejects.toThrow("redirect:/login");
  });

  it("quem não é super admin, sem clínica: vai para o Início", async () => {
    estado.sessao = sessao({ isProductAdmin: false });
    await expect(html()).rejects.toThrow("redirect:/inicio");
  });

  it("quem não é super admin, administrador de clínica: vai para o Início", async () => {
    const ativo = vinculo("ativo");
    estado.sessao = sessao({
      isProductAdmin: false,
      memberships: [ativo],
      active: ativo,
    });
    await expect(html()).rejects.toThrow("redirect:/inicio");
  });

  it("leitura que falhou: o erro com Tentar de novo e Sair, sem o painel", async () => {
    estado.sessao = sessao({
      isProductAdmin: false,
      vinculoIndisponivel: true,
    });
    const visivel = texto(await html());
    expect(visivel).toContain("Seu acesso não carregou");
    expect(visivel).toContain("Tentar de novo");
    expect(visivel).toContain("Sair");
    expect(visivel).toContain(EMAIL);
    expect(visivel).not.toContain("conteúdo do painel");
    expect(visivel).not.toContain("Painel geral");
  });

  it("nada do banco na guarda (ela só lê a sessão)", async () => {
    estado.sessao = sessao();
    await html();
    expect(banco.createClient).not.toHaveBeenCalled();
    expect(banco.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("menu da área do super admin", () => {
  it("a conta do painel: Painel geral ativo, o e-mail e Sair, com o conteúdo dentro", async () => {
    estado.sessao = sessao();
    const marcacao = await html();
    const visivel = texto(marcacao);

    expect(marcacao).toMatch(
      /<a[^>]*href="\/painel-geral"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/painel-geral"/,
    );
    expect(visivel).toContain("Painel geral");
    expect(visivel).toContain("Equipe Conduzza");
    expect(visivel).toContain(EMAIL);
    expect(marcacao).toContain('aria-label="Sair"');
    expect(visivel).toContain("conteúdo do painel");
    // O Sair do menu e um formulario (funciona sem JavaScript) de 40px.
    const sair = marcacao
      .split("</form>")
      .find((trecho) => trecho.includes('aria-label="Sair"'));
    expect(sair).toMatch(/<button[^>]*type="submit"/);
    expect(sair).toMatch(/<button[^>]*class="[^"]*\bsize-10\b/);
  });

  it("a conta do painel: sem Abrir a clínica e sem nada do menu da clínica", async () => {
    estado.sessao = sessao();
    const marcacao = await html();
    expect(texto(marcacao)).not.toContain("Abrir a clínica");
    expect(marcacao).not.toContain('href="/inicio"');
    for (const rota of [
      "/atendimento",
      "/agenda",
      "/leads",
      "/pacientes",
      "/configuracoes",
      "/selecionar-clinica",
    ]) {
      expect(marcacao, rota).not.toContain(`href="${rota}"`);
    }
    expect(texto(marcacao)).not.toContain("Criar clínica");
  });

  it("a conta antiga (membro ativo de clínica): Abrir a clínica leva ao Início, alvo de 40px", async () => {
    const ativo = vinculo("ativo");
    estado.sessao = sessao({
      userName: "Vinicius Rodrigues",
      memberships: [ativo],
      active: ativo,
    });
    const marcacao = await html();
    expect(texto(marcacao)).toContain("Abrir a clínica");
    const link = (marcacao.match(/<a [^>]*>/g) ?? []).find((tag) =>
      tag.includes('href="/inicio"'),
    );
    expect(link).toMatch(/class="[^"]*\bh-10\b/);
    // O Painel geral continua o item ativo.
    expect(marcacao).toMatch(/aria-current="page"/);
  });

  it("só pendente não abre clínica nenhuma: sem Abrir a clínica", async () => {
    estado.sessao = sessao({ memberships: [vinculo("pendente")] });
    expect(texto(await html())).not.toContain("Abrir a clínica");
  });

  it("nenhum travessão no menu nem no erro", async () => {
    estado.sessao = sessao({ memberships: [vinculo("ativo")] });
    expect(await html()).not.toMatch(/[—–]/);
    estado.sessao = sessao({ vinculoIndisponivel: true });
    expect(await html()).not.toMatch(/[—–]/);
  });
});
