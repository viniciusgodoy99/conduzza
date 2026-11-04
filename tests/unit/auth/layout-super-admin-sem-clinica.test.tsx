import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Membership, SessionContext } from "@/lib/auth/active-clinic";

// A entrada do super admin pelo layout da clinica (app/(app)/layout.tsx;
// decisao do dono de 03/11/2026, "Conta propria so para o painel"). Todo
// caminho de entrada passa por aqui (o login, o "/", a senha nova e o
// /selecionar-clinica mandam para o /inicio):
// - o super admin sem vinculo ativo (a conta do painel) vai direto para o
//   /painel-geral, antes da tela de espera e nunca para "Criar clinica";
// - o super admin que ainda e membro ativo (as contas antigas) entra na
//   clinica como antes: com uma, o shell; com duas sem escolha, a escolha;
// - quem nao e super admin continua como antes ("Sem clinica vinculada");
// - leitura que falhou continua "Seu acesso nao carregou", sem redirecionar.
// Sessao falsa; quando o layout passa dos estados antes do shell, a primeira
// leitura do banco (createClient) lanca um marcador: chegar nela prova que a
// pessoa entrou na clinica.

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

const CHEGOU_AO_SHELL = "chegou ao shell da clínica";

function vinculo(
  status: Membership["status"],
  clinicId = "a1111111-1111-4111-8111-111111111111",
  clinicName = "Clínica Centro",
): Membership {
  return {
    clinicId,
    clinicName,
    slug: "",
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
    userName: "Equipe",
    userEmail: "painel@equipe.test",
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
  banco.createClient.mockImplementation(() => {
    throw new Error(CHEGOU_AO_SHELL);
  });
});

describe("layout da clínica: a entrada do super admin", () => {
  it("a conta do painel (sem vínculo): vai direto para o Painel geral, sem ler o banco", async () => {
    estado.sessao = sessao();
    await expect(html()).rejects.toThrow("redirect:/painel-geral");
    expect(banco.createClient).not.toHaveBeenCalled();
    expect(banco.createAdminClient).not.toHaveBeenCalled();
  });

  it("super admin só com pedido pendente: o Painel geral, antes da tela de espera", async () => {
    estado.sessao = sessao({ memberships: [vinculo("pendente")] });
    await expect(html()).rejects.toThrow("redirect:/painel-geral");
  });

  it("a conta antiga com uma clínica ativa: entra na clínica, como antes", async () => {
    const ativo = vinculo("ativo");
    estado.sessao = sessao({ memberships: [ativo], active: ativo });
    await expect(html()).rejects.toThrow(CHEGOU_AO_SHELL);
  });

  it("a conta antiga com duas clínicas e sem escolha: a escolha, como antes", async () => {
    estado.sessao = sessao({
      memberships: [
        vinculo("ativo"),
        vinculo("ativo", "a2222222-2222-4222-8222-222222222222", "Clínica Sul"),
      ],
    });
    await expect(html()).rejects.toThrow("redirect:/selecionar-clinica");
  });

  it("quem não é super admin e não tem clínica: Sem clínica vinculada, sem Criar clínica", async () => {
    estado.sessao = sessao({ isProductAdmin: false });
    const visivel = texto(await html());
    expect(visivel).toContain("Sem clínica vinculada");
    expect(visivel).not.toContain("Criar clínica");
    expect(visivel).not.toContain("Crie a primeira clínica");
    expect(visivel).not.toContain("conteudo do sistema");
  });

  it("leitura que falhou: Seu acesso não carregou, sem mandar para o painel", async () => {
    estado.sessao = sessao({ vinculoIndisponivel: true });
    const visivel = texto(await html());
    expect(visivel).toContain("Seu acesso não carregou");
    expect(visivel).not.toContain("Criar clínica");
  });
});
