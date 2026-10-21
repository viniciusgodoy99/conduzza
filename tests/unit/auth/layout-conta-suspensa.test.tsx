import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Membership, SessionContext } from "@/lib/auth/active-clinic";

// A tela "Conta suspensa" do layout da area logada (onda 1, decisao do dono
// de 20/10/2026): no lugar do sistema, o nome da clinica e o texto exato,
// com Sair e, havendo outra clinica ativa, a troca (a escolha, com duas ou
// mais; direto para a outra, com uma so). Nada do banco e lido nesse ramo.
// Sessao falsa: nada de rede.

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  sessao: null as SessionContext | null,
}));

vi.mock("@/lib/auth/active-clinic", async () => ({
  getSessionContext: async () => estado.sessao,
  ROLE_LABELS: (await import("@/lib/domain/permissions")).ROLE_LABELS,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  useRouter: () => ({ refresh: () => undefined }),
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

const { default: AppLayout } = await import("@/app/(app)/layout");

const SUSPENSA = "b3333333-3333-4333-8333-333333333333";
const ATIVA = "a1111111-1111-4111-8111-111111111111";
const OUTRA_ATIVA = "a2222222-2222-4222-8222-222222222222";

const FRASE =
  "A conta desta clínica está suspensa. Fale com a equipe Conduzza para reativar.";

function vinculo(
  clinicId: string,
  clinicName: string,
  status: Membership["status"],
): Membership {
  return {
    clinicId,
    clinicName,
    slug: "",
    timezone: "America/Fortaleza",
    role: "admin",
    status,
    productName: "Conduzza Clínicas",
    primaryColor: "#B2E54F",
    labels: null,
  };
}

function sessao(
  outras: Membership[],
  campos: Partial<SessionContext> = {},
): SessionContext {
  const suspensa = vinculo(SUSPENSA, "Clínica Bem Estar", "suspensa");
  return {
    userId: "u0000000-0000-4000-8000-000000000001",
    userName: "Ana",
    userEmail: "ana@clinica.test",
    memberships: [suspensa, ...outras],
    active: null,
    clinicaSuspensa: suspensa,
    isProductAdmin: false,
    vinculoIndisponivel: false,
    ...campos,
  };
}

async function html(): Promise<string> {
  const elemento = (await AppLayout({
    children: "conteudo do sistema",
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
});

describe("layout: conta suspensa", () => {
  it("só a suspensa: o nome, o texto exato e Sair, sem troca e sem o sistema", async () => {
    estado.sessao = sessao([]);
    const marcacao = await html();
    const visivel = texto(marcacao);
    expect(visivel).toContain("Conta suspensa");
    expect(visivel).toContain("Clínica Bem Estar");
    expect(visivel).toContain(FRASE);
    expect(visivel).toContain("Sair");
    expect(visivel).toContain("ana@clinica.test");
    expect(visivel).not.toContain("Trocar");
    expect(visivel).not.toContain("conteudo do sistema");
    // Nada do banco nesse ramo.
    expect(banco.createClient).not.toHaveBeenCalled();
    expect(banco.createAdminClient).not.toHaveBeenCalled();
  });

  it("com outra clínica ativa: troca direto para ela (formulário com a clínica), alvo de 40px", async () => {
    estado.sessao = sessao([vinculo(ATIVA, "Clínica Centro", "ativo")]);
    const marcacao = await html();
    expect(texto(marcacao)).toContain("Trocar para Clínica Centro");
    // O formulario da troca: a clinica escolhida e o botao de 40px.
    const formulario = marcacao
      .split("</form>")
      .find((trecho) => trecho.includes('name="clinicId"'));
    expect(formulario).toContain(`value="${ATIVA}"`);
    expect(formulario).toMatch(/<button[^>]*class="[^"]*\bh-10\b/);
    expect(formulario).toContain('type="submit"');
  });

  it("com duas ou mais ativas: Trocar de clínica leva à escolha", async () => {
    estado.sessao = sessao([
      vinculo(ATIVA, "Clínica Centro", "ativo"),
      vinculo(OUTRA_ATIVA, "Clínica Sul", "ativo"),
    ]);
    const marcacao = await html();
    expect(texto(marcacao)).toContain("Trocar de clínica");
    expect(marcacao).toMatch(/<a[^>]*href="\/selecionar-clinica"/);
    expect(marcacao).toMatch(/<a[^>]*class="[^"]*h-10/);
  });

  it("acesso que não carregou vem antes: o erro honesto, não a suspensão", async () => {
    estado.sessao = sessao([], { vinculoIndisponivel: true });
    const visivel = texto(await html());
    expect(visivel).toContain("Seu acesso não carregou");
    expect(visivel).not.toContain("Conta suspensa");
  });

  it("nenhum travessão no texto da tela", async () => {
    for (const outras of [
      [],
      [vinculo(ATIVA, "Clínica Centro", "ativo")],
      [
        vinculo(ATIVA, "Clínica Centro", "ativo"),
        vinculo(OUTRA_ATIVA, "Clínica Sul", "ativo"),
      ],
    ]) {
      estado.sessao = sessao(outras);
      expect(texto(await html())).not.toMatch(/[–—]/);
    }
  });
});
