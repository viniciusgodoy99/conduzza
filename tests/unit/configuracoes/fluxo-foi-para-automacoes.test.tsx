import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Item 13 da onda 4 (decisao do dono de 20/10/2026): as automacoes de fluxo
// sairam de Configuracoes e moram na tela Automacoes (?aba=fluxo de la). O
// lado de Configuracoes:
//   - o link antigo, /configuracoes?aba=fluxo, vai para /automacoes?aba=fluxo
//     no servidor, antes de abrir a sessao ou o banco;
//   - as outras abas seguem o caminho de sempre;
//   - a fileira de abas nao tem mais "Automações de fluxo", e ?aba=fluxo que
//     chegasse ao cliente cairia na equipe, como aba desconhecida.
// Quem ve a aba nova (so administrador e gestor) esta em
// tests/unit/automacoes/tela-guarda.test.tsx.

vi.mock("server-only", () => ({}));

const espias = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/configuracoes",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: espias.getSessionContext,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: espias.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: espias.createAdminClient,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () => new Map(),
  cookies: async () => new Map(),
}));

const { default: ConfiguracoesPage } =
  await import("@/app/(app)/configuracoes/page");
const { ConfiguracoesClient } =
  await import("@/app/(app)/configuracoes/configuracoes-client");
const { TooltipProvider } = await import("@/components/ui/tooltip");

async function destinoDaPagina(aba?: string): Promise<string> {
  try {
    await ConfiguracoesPage({
      searchParams: Promise.resolve(aba ? { aba } : {}),
    });
    return "renderizou";
  } catch (erro) {
    return erro instanceof Error ? erro.message : "erro";
  }
}

function tela(abaInicial: string | undefined): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ConfiguracoesClient
        abaInicial={abaInicial}
        equipe={null}
        meuUserId="u1"
        podeGerenciar
        ehAdmin
        dica="Somente administradores e gestores alteram as configurações"
        clinica={null}
        codigo={null}
        codigoAtivo={false}
        whatsapp={null}
        jornada={null}
        etiquetas={null}
        mensagens={null}
        meta={null}
        google={null}
      />
    </TooltipProvider>,
  );
}

/** Os rotulos das abas (role="tab"), na ordem. */
function abas(html: string): string[] {
  return [...html.matchAll(/<button[^>]*role="tab"[^>]*>(.*?)<\/button>/g)].map(
    (casamento) => (casamento[1] ?? "").replace(/<[^>]+>/g, "").trim(),
  );
}

function abaSelecionada(html: string): string {
  const casamento =
    /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>(.*?)<\/button>/.exec(
      html,
    );
  return (casamento?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sem sessao: a pagina que passa da conferencia do ?aba=fluxo para no
  // Inicio, sem precisar do banco.
  espias.getSessionContext.mockResolvedValue(null);
});

describe("/configuracoes?aba=fluxo, o link antigo", () => {
  it("vai para a aba nova em Automações, antes da sessão e do banco", async () => {
    expect(await destinoDaPagina("fluxo")).toBe(
      "redirect:/automacoes?aba=fluxo",
    );
    expect(espias.getSessionContext).not.toHaveBeenCalled();
    expect(espias.createClient).not.toHaveBeenCalled();
    expect(espias.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([undefined, "equipe", "jornada", "etiquetas"])(
    "?aba=%s segue o caminho de sempre (não vai para Automações)",
    async (aba) => {
      expect(await destinoDaPagina(aba)).toBe("redirect:/inicio");
      expect(espias.getSessionContext).toHaveBeenCalledTimes(1);
    },
  );
});

describe("a fileira de Configurações sem Automações de fluxo", () => {
  it("a aba não existe mais; a jornada é seguida pelas etiquetas", () => {
    const rotulos = abas(tela(undefined));
    expect(rotulos).not.toContain("Automações de fluxo");
    expect(rotulos.some((rotulo) => rotulo.includes("fluxo"))).toBe(false);
    expect(rotulos.indexOf("Etiquetas de conversa")).toBe(
      rotulos.indexOf("Jornada e conversões") + 1,
    );
  });

  it("?aba=fluxo que chegasse ao cliente cairia na equipe", () => {
    const html = tela("fluxo");
    expect(abaSelecionada(html)).toMatch(/^Equipe e permissões/);
    expect(html).not.toContain("Automações de fluxo da clínica");
  });
});
