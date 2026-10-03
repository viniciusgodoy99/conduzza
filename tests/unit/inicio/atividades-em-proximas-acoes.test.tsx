import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// As duas linhas de atividades em Proximas acoes do Inicio: "Suas
// atividades atrasadas" e "Suas atividades para hoje", com os numeros SO do
// responsavel = quem usa e os links ja filtrados; erro vira linha de erro
// com "Tentar de novo", nunca zero.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/shell/botao-recarregar", () => ({
  BotaoRecarregar: ({ rotulo }: { rotulo: string }) => (
    <button type="button">{rotulo}</button>
  ),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...resto
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

const { LinhasDeAtividadesView, linhasDeAtividades } =
  await import("@/components/inicio/atividades-em-proximas-acoes");

const CONTAGEM = { atrasadas: 9, hoje: 7, minhas_atrasadas: 2, minhas_hoje: 4 };

function texto(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("linhas de atividades em Próximas ações", () => {
  it("usa só as suas, com os links da tela Atividades já filtrada", () => {
    expect(
      linhasDeAtividades(CONTAGEM).map((l) => [l.rotulo, l.valor, l.href]),
    ).toEqual([
      ["Suas atividades atrasadas", 2, "/atividades?filtro=atrasadas"],
      ["Suas atividades para hoje", 4, "/atividades?filtro=hoje"],
    ]);
  });

  it("desenha as duas linhas com o número e a seta", () => {
    const markup = renderToStaticMarkup(
      <ul>
        <LinhasDeAtividadesView leitura={{ ok: true, dados: CONTAGEM }} />
      </ul>,
    );
    expect(markup).toContain('href="/atividades?filtro=atrasadas"');
    expect(markup).toContain('href="/atividades?filtro=hoje"');
    const visivel = texto(markup);
    expect(visivel).toContain("Suas atividades atrasadas 2");
    expect(visivel).toContain("Suas atividades para hoje 4");
    // Icone da atrasada na cor de alerta (ClockAlert, reservado).
    expect(markup).toContain("text-alert-text");
    expect(visivel).not.toMatch(/[–—]/);
  });

  it("erro: diz que não contou e oferece Tentar de novo, sem zero", () => {
    const markup = renderToStaticMarkup(
      <ul>
        <LinhasDeAtividadesView leitura={{ ok: false }} />
      </ul>,
    );
    const visivel = texto(markup);
    expect(visivel).toContain("Não foi possível contar suas atividades.");
    expect(visivel).toContain("Tentar de novo");
    expect(visivel).not.toMatch(/\b0\b/);
    expect(markup).not.toContain("href=");
  });
});
