import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A tela de Configuracoes inteira (o cliente das abas), so para a aba
// "Agente de IA": ela existe quando o servidor manda os dados (as duas
// clinicas da fase controlada) e NAO existe quando manda nulo (todas as
// outras), nem por ?aba=ia na URL. O servidor decide por abaDaIaVisivel,
// coberta em agente-de-ia.test.ts.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/configuracoes",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/configuracoes/ia-liberacao-actions", () => ({
  adicionarTelefoneDaIaAction: vi.fn(),
  alternarTelefoneDaIaAction: vi.fn(),
  definirEscolhaDaIaAction: vi.fn(),
  definirInterruptorGeralAction: vi.fn(),
  escolherNumeroDaIaAction: vi.fn(),
}));

import { ConfiguracoesClient } from "@/app/(app)/configuracoes/configuracoes-client";
import type { DadosDaAbaDaIa } from "@/components/configuracoes/agente-de-ia-tab";
import { TooltipProvider } from "@/components/ui/tooltip";

const DA_IA: DadosDaAbaDaIa = {
  dados: {
    liberacao: null,
    numeros: [],
    telefones: [],
    interruptorLigado: false,
  },
  numeros: [],
  ambienteLigado: false,
  podeEditar: true,
  superAdmin: false,
};

function tela(
  agenteDeIa: DadosDaAbaDaIa | null,
  abaInicial: string | undefined,
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
        fluxo={null}
        etiquetas={null}
        mensagens={null}
        meta={null}
        google={null}
        agenteDeIa={agenteDeIa}
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

describe("aba Agente de IA na tela de Configurações", () => {
  it("clínica fora da fase controlada: a aba não existe, nem pela URL", () => {
    const html = tela(null, "ia");
    expect(abas(html)).not.toContain("Agente de IA");
    expect(html).not.toContain("Assistente de IA nesta clínica");
    // ?aba=ia sem a aba cai na equipe, como aba desconhecida
    expect(abaSelecionada(html)).toMatch(/^Equipe e permissões/);
  });

  it("clínica da fase controlada: a aba entra no fim e abre pela URL", () => {
    const html = tela(DA_IA, "ia");
    const rotulos = abas(html);
    expect(rotulos.at(-1)).toBe("Agente de IA");
    expect(rotulos.at(-2)).toBe("Anúncios do Google");
    expect(abaSelecionada(html)).toBe("Agente de IA");
    expect(html).toContain("Assistente de IA nesta clínica");
  });

  it("leitura que falhou: o erro da aba, sem derrubar a tela", () => {
    const html = tela({ ...DA_IA, dados: null }, "ia");
    expect(html).toContain("Não foi possível carregar o assistente de IA");
    expect(html).not.toContain("Assistente de IA nesta clínica");
  });
});
