import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionContext } from "@/lib/auth/active-clinic";
import type { Role } from "@/lib/domain/permissions";
import { configPadraoDoAgente } from "@/lib/domain/agente/config";

import { CLINICA, ITEM_ATIVO } from "./tela-fixtures";

// A rota /agente: a guarda de papel do layout (profissional e leitura vao
// para o Inicio; recepcao entra; super admin entra com qualquer papel) e a
// decisao da pagina (fora da fase controlada, o vazio de sempre SEM ler nada
// do agente; dentro, o painel, com o erro honesto quando a leitura falha).
// Banco, sessao e motor sao falsos: nada aqui toca rede.

vi.mock("server-only", () => ({}));

const sessao = vi.hoisted(() => ({
  atual: null as SessionContext | null,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: () => Promise.resolve(sessao.atual),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

const banco = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  fetchConfigDoAgente: vi.fn(),
  fetchVersoesDoAgente: vi.fn(),
  motivoParaNaoSimular: vi.fn(),
  carregarConfigDoRascunho: vi.fn(),
  carregarCatalogoDoAgente: vi.fn(),
  carregarExtrasDoPainel: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: banco.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: banco.createAdminClient,
}));
vi.mock("@/lib/queries/agente", () => ({
  fetchConfigDoAgente: banco.fetchConfigDoAgente,
  fetchVersoesDoAgente: banco.fetchVersoesDoAgente,
}));
vi.mock("@/lib/agente/simulador", () => ({
  motivoParaNaoSimular: banco.motivoParaNaoSimular,
  TEXTOS_DO_SIMULADOR: {
    naoConferiu:
      "Não foi possível conferir se a IA pode responder. Tente de novo.",
  },
}));
vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigDoRascunho: banco.carregarConfigDoRascunho,
  carregarCatalogoDoAgente: banco.carregarCatalogoDoAgente,
}));
vi.mock("@/lib/agente/painel", () => ({
  carregarExtrasDoPainel: banco.carregarExtrasDoPainel,
}));
vi.mock("@/components/agente/acoes", () => ({ acoesDoAgente: {} }));

const { default: AgenteLayout } = await import("@/app/(app)/agente/layout");
const { default: AgentePage } = await import("@/app/(app)/agente/page");
const { TooltipProvider } = await import("@/components/ui/tooltip");

const FORA_DA_FASE = "99999999-9999-4999-8999-999999999999";

function contexto(
  role: Role,
  campos: { clinicId?: string; isProductAdmin?: boolean } = {},
): SessionContext {
  return {
    userId: "33333333-3333-4333-8333-333333333333",
    userName: "Teste",
    userEmail: "teste@exemplo.com",
    memberships: [],
    active: {
      clinicId: campos.clinicId ?? CLINICA,
      clinicName: "Clínica Teste",
      slug: "teste",
      timezone: "America/Fortaleza",
      role,
      status: "ativo",
      productName: "Conduzza Clínicas",
      primaryColor: "#B2E54F",
      labels: null,
    },
    isProductAdmin: campos.isProductAdmin ?? false,
    vinculoIndisponivel: false,
  };
}

async function destinoDoLayout(): Promise<string> {
  try {
    await AgenteLayout({ children: "conteudo" as ReactNode });
    return "entrou";
  } catch (erro) {
    return erro instanceof Error ? erro.message : "erro";
  }
}

async function paginaEmHtml(aba?: string): Promise<string> {
  const elemento = (await AgentePage({
    searchParams: Promise.resolve(aba ? { aba } : {}),
  })) as ReactElement;
  return renderToStaticMarkup(<TooltipProvider>{elemento}</TooltipProvider>);
}

async function pagina(aba?: string): Promise<string> {
  return (await paginaEmHtml(aba))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

beforeEach(() => {
  vi.clearAllMocks();
  banco.createClient.mockResolvedValue({});
  banco.createAdminClient.mockReturnValue({});
  banco.motivoParaNaoSimular.mockResolvedValue(null);
  banco.carregarExtrasDoPainel.mockResolvedValue({
    instrucoesMudaram: false,
    versoesComInstrucoesMudadas: [],
    previa: null,
  });
  banco.fetchVersoesDoAgente.mockResolvedValue([]);
  banco.fetchConfigDoAgente.mockResolvedValue({
    config: { ...configPadraoDoAgente(), base: [ITEM_ATIVO] },
    temRascunho: true,
    publicada: null,
    mudancas: [],
  });
});

describe("guarda de papel da rota", () => {
  it.each<[Role, string]>([
    ["admin", "entrou"],
    ["gestor", "entrou"],
    ["recepcao", "entrou"],
    ["profissional", "redirect:/inicio"],
    ["leitura", "redirect:/inicio"],
  ])("%s: %s", async (papel, esperado) => {
    sessao.atual = contexto(papel);
    expect(await destinoDoLayout()).toBe(esperado);
  });

  it("super admin entra com qualquer papel", async () => {
    sessao.atual = contexto("leitura", { isProductAdmin: true });
    expect(await destinoDoLayout()).toBe("entrou");
  });

  it("sem sessão vai para o login", async () => {
    sessao.atual = null;
    expect(await destinoDoLayout()).toBe("redirect:/login");
  });
});

describe("página", () => {
  it("fora da fase controlada: o vazio, sem ler nada do agente", async () => {
    sessao.atual = contexto("admin", { clinicId: FORA_DA_FASE });
    const visivel = await pagina("instrucoes");
    expect(visivel).toContain(
      "A recepcionista de IA ainda não está ligada nesta clínica",
    );
    expect(visivel).toContain("Abrir Atendimento");
    expect(visivel).not.toContain("Publicar alterações");
    expect(banco.createClient).not.toHaveBeenCalled();
    expect(banco.createAdminClient).not.toHaveBeenCalled();
    expect(banco.fetchConfigDoAgente).not.toHaveBeenCalled();
    expect(banco.motivoParaNaoSimular).not.toHaveBeenCalled();
    expect(banco.carregarExtrasDoPainel).not.toHaveBeenCalled();
  });

  it("na fase: o painel, com o motivo do simulador para quem configura", async () => {
    sessao.atual = contexto("gestor");
    banco.motivoParaNaoSimular.mockResolvedValue(
      "O interruptor geral da IA está desligado.",
    );
    const visivel = await pagina();
    expect(visivel).toContain("Publicar alterações");
    expect(visivel).toContain("Simulador");
    expect(visivel).toContain("O interruptor geral da IA está desligado.");
    // so o super admin le as instrucoes
    expect(banco.fetchConfigDoAgente).toHaveBeenCalledWith(
      expect.anything(),
      CLINICA,
      { lerInstrucoes: false },
    );
    expect(banco.carregarConfigDoRascunho).not.toHaveBeenCalled();
  });

  it("recepção: nem confere o simulador, e ve a dica", async () => {
    sessao.atual = contexto("recepcao");
    const visivel = await pagina();
    expect(banco.motivoParaNaoSimular).not.toHaveBeenCalled();
    expect(visivel).toContain(
      "Somente administradores e gestores alteram o agente de IA",
    );
  });

  it("super admin: lê as instruções e mostra a prévia do servidor", async () => {
    sessao.atual = contexto("admin", { isProductAdmin: true });
    banco.carregarExtrasDoPainel.mockResolvedValue({
      instrucoesMudaram: false,
      versoesComInstrucoesMudadas: [],
      previa: "Você é a recepcionista virtual.",
    });
    const visivel = await pagina("instrucoes");
    expect(banco.fetchConfigDoAgente).toHaveBeenCalledWith(
      expect.anything(),
      CLINICA,
      { lerInstrucoes: true },
    );
    expect(banco.carregarExtrasDoPainel).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINICA, superAdmin: true }),
    );
    expect(visivel).toContain("Prévia do prompt");
    expect(visivel).toContain("Você é a recepcionista virtual.");
  });

  it("gestor: a linha das instruções vem do servidor, sem o texto (S5)", async () => {
    sessao.atual = contexto("gestor");
    const config = { ...configPadraoDoAgente(), base: [ITEM_ATIVO] };
    banco.fetchConfigDoAgente.mockResolvedValue({
      config,
      temRascunho: true,
      publicada: {
        ...config,
        versao: 2,
        status: "publicada",
        instrucoes: null,
      },
      mudancas: [],
    });
    banco.fetchVersoesDoAgente.mockResolvedValue([
      {
        versao: 2,
        publicadaEm: "2026-10-06T17:05:00.000Z",
        autorId: null,
        autor: "Vinicius",
        mudancas: [],
        emUso: true,
      },
      {
        versao: 1,
        publicadaEm: "2026-10-05T17:05:00.000Z",
        autorId: null,
        autor: "Vinicius",
        mudancas: [
          {
            campo: "primeira_publicacao",
            rotulo: "Primeira versão do assistente",
          },
        ],
        emUso: false,
      },
    ]);
    banco.carregarExtrasDoPainel.mockResolvedValue({
      instrucoesMudaram: true,
      versoesComInstrucoesMudadas: [2],
      previa: "não deveria aparecer",
    });
    const visivel = await pagina("versoes");
    expect(banco.carregarExtrasDoPainel).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINICA, superAdmin: false }),
    );
    // a contagem do rodape e a proxima versao
    expect(visivel).toContain("1 alteração não publicada");
    expect(visivel).toMatch(/Próxima versão .*Instruções da equipe Conduzza/);
    // a v2 so mudou as instrucoes: deixa de dizer "Sem mudança"
    expect(visivel).not.toContain("Sem mudança em relação à versão anterior.");
    // a v1 continua com o que tinha
    expect(visivel).toContain("Primeira versão do assistente");
    // a previa nunca chega a quem nao e super admin
    expect(visivel).not.toContain("não deveria aparecer");
  });

  it("extras que falharam (null) não inventam a linha das instruções", async () => {
    sessao.atual = contexto("admin");
    const config = { ...configPadraoDoAgente(), base: [ITEM_ATIVO] };
    banco.fetchConfigDoAgente.mockResolvedValue({
      config,
      temRascunho: true,
      publicada: { ...config, versao: 2, status: "publicada" },
      mudancas: [],
    });
    banco.carregarExtrasDoPainel.mockResolvedValue({
      instrucoesMudaram: null,
      versoesComInstrucoesMudadas: null,
      previa: null,
    });
    const visivel = await pagina();
    expect(visivel).toContain("Nenhuma alteração para publicar");
    expect(visivel).not.toContain("Instruções da equipe Conduzza");
  });

  it("a casca do painel ocupa a altura e reserva o rodapé na rolagem do foco (achado 32)", async () => {
    sessao.atual = contexto("admin");
    const html = await paginaEmHtml();
    const casca = html.match(/^<div class="([^"]*)"/)?.[1] ?? "";
    expect(casca).toContain("min-h-full");
    expect(casca).toContain("flex-col");
    // scroll-padding-bottom no main so enquanto o painel esta na tela
    expect(casca).toContain("[main:has(&amp;)]:scroll-pb-32");
  });

  it("leitura da configuração que falha vira o erro, nunca um painel vazio", async () => {
    sessao.atual = contexto("admin");
    banco.fetchConfigDoAgente.mockRejectedValue(new Error("falhou"));
    const visivel = await pagina();
    expect(visivel).toContain("Não foi possível carregar o assistente de IA");
    expect(visivel).not.toContain("Publicar alterações");
  });

  it("versões que falham só apagam a aba delas", async () => {
    sessao.atual = contexto("admin");
    banco.fetchVersoesDoAgente.mockRejectedValue(new Error("falhou"));
    const visivel = await pagina("versoes");
    expect(visivel).toContain("Não foi possível carregar as versões");
    expect(visivel).toContain("Publicar alterações");
  });
});
