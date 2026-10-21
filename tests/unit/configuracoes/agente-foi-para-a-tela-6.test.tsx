import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Onda 2, item 8 (decisao do dono de 20/10/2026): tudo do agente na Tela 6.
// O lado de Configuracoes:
//   - a aba "Agente de IA" nao existe mais, em clinica nenhuma;
//   - o link antigo, /configuracoes?aba=ia, vai para /agente?aba=whatsapp
//     no servidor, antes de abrir a sessao ou o banco;
//   - nas clinicas com o agente habilitado (decisao do servidor), a aba
//     WhatsApp avisa onde ficaram os numeros e os telefones do assistente,
//     com o link; nas outras, nenhum aviso;
//   - ?aba=ia que chegasse ao cliente cairia na equipe.
// A aba nova esta em tests/unit/agente/whatsapp/aba-whatsapp.test.tsx.

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
const { AVISO_DO_ASSISTENTE, ConfiguracoesClient } =
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

function tela(
  abaInicial: string | undefined,
  comAgenteDeIa: boolean | undefined,
): string {
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
        comAgenteDeIa={comAgenteDeIa}
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
  // Sem sessao: a pagina que passa da conferencia do ?aba= para no Inicio,
  // sem precisar do banco.
  espias.getSessionContext.mockResolvedValue(null);
});

describe("/configuracoes?aba=ia, o link antigo", () => {
  it("vai para a aba WhatsApp da tela Agente de IA, antes da sessão e do banco", async () => {
    expect(await destinoDaPagina("ia")).toBe("redirect:/agente?aba=whatsapp");
    expect(espias.getSessionContext).not.toHaveBeenCalled();
    expect(espias.createClient).not.toHaveBeenCalled();
    expect(espias.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([undefined, "equipe", "whatsapp"])(
    "?aba=%s segue o caminho de sempre",
    async (aba) => {
      expect(await destinoDaPagina(aba)).toBe("redirect:/inicio");
      expect(espias.getSessionContext).toHaveBeenCalledTimes(1);
    },
  );
});

describe("a fileira de Configurações sem a aba do agente", () => {
  it("em clínica nenhuma, nem nas que têm o agente habilitado", () => {
    for (const comAgente of [true, false, undefined]) {
      const rotulos = abas(tela(undefined, comAgente));
      expect(rotulos).not.toContain("Agente de IA");
      expect(rotulos.at(-1)).toBe("Anúncios do Google");
    }
  });

  it("?aba=ia que chegasse ao cliente cairia na equipe", () => {
    const html = tela("ia", true);
    expect(abaSelecionada(html)).toMatch(/^Equipe e permissões/);
    expect(html).not.toContain("Assistente de IA nesta clínica");
  });
});

describe("o aviso de onde o assistente mora agora", () => {
  it("com o agente habilitado: o aviso na aba WhatsApp, com o link para a Tela 6", () => {
    const html = tela("whatsapp", true);
    expect(html).toContain(AVISO_DO_ASSISTENTE.texto);
    expect(html).toContain('href="/agente?aba=whatsapp"');
    expect(html).toContain(`${AVISO_DO_ASSISTENTE.acao}</a>`);
  });

  it("sem o agente habilitado: nenhum aviso", () => {
    for (const comAgente of [false, undefined]) {
      expect(tela("whatsapp", comAgente)).not.toContain(
        AVISO_DO_ASSISTENTE.texto,
      );
    }
  });

  it("o texto sem travessão e em linguagem de recepção", () => {
    for (const texto of Object.values(AVISO_DO_ASSISTENTE)) {
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/\b(tenant|opt-in|handoff)\b/i);
    }
  });
});
