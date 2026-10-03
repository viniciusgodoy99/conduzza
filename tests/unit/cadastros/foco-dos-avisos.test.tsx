import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foco do teclado nas confirmacoes que tomam o lugar do Salvar nos modais de
// Cadastros (achado de 02/10/2026). O vitest roda em node, sem DOM: os
// efeitos nao rodam no renderToStaticMarkup. Aqui ficam a regra de "foco
// perdido" (a unica condicao para as pecas moverem o foco) e o alvo de foco
// que o AvisoDeConsultas desenha. A sequencia real (aviso entra, Tab, Enter)
// esta no e2e de tests/e2e/procedimento-quem-faz.spec.ts.

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { AvisoDeConsultas, focoPerdido } =
  await import("@/components/cadastros/comum");

class ElementoFalso {
  constructor(
    public tabIndex: number,
    public isConnected = true,
  ) {}
}

function comFoco(ativo: ElementoFalso | null, body: ElementoFalso) {
  vi.stubGlobal("HTMLElement", ElementoFalso);
  vi.stubGlobal("document", { activeElement: ativo, body });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("focoPerdido: quando as peças podem mover o foco", () => {
  it("sem DOM (servidor), nunca", () => {
    expect(focoPerdido()).toBe(false);
  });

  it("foco no body: perdido", () => {
    const body = new ElementoFalso(-1);
    comFoco(body, body);
    expect(focoPerdido()).toBe(true);
  });

  it("nenhum elemento ativo: perdido", () => {
    comFoco(null, new ElementoFalso(-1));
    expect(focoPerdido()).toBe(true);
  });

  it("o próprio modal (tabIndex -1, para onde o Radix joga o foco): perdido", () => {
    comFoco(new ElementoFalso(-1), new ElementoFalso(-1));
    expect(focoPerdido()).toBe(true);
  });

  it("elemento que saiu da página: perdido", () => {
    comFoco(new ElementoFalso(0, false), new ElementoFalso(-1));
    expect(focoPerdido()).toBe(true);
  });

  it("campo, botão ou caixa que a pessoa escolheu (tabIndex 0): fica onde está", () => {
    comFoco(new ElementoFalso(0), new ElementoFalso(-1));
    expect(focoPerdido()).toBe(false);
  });
});

describe("AvisoDeConsultas: o aviso é o alvo do foco", () => {
  const props = {
    consultas: 1,
    primeira: null,
    timezone: "America/Fortaleza",
    rotuloConfirmar: "Salvar mesmo assim",
    confirmando: false,
    aoConfirmar: () => undefined,
  };

  it("contorno com o raio do aviso, fora da ordem do Tab, com o id de quem monta", () => {
    const html = renderToStaticMarkup(
      <AvisoDeConsultas {...props} id="proc-aviso-de-consultas" />,
    );
    expect(html).toMatch(
      /^<div id="proc-aviso-de-consultas" tabindex="-1" class="rounded-xl"><div role="alert"/u,
    );
  });

  it("sem id, o alvo continua lá", () => {
    const html = renderToStaticMarkup(<AvisoDeConsultas {...props} />);
    expect(html).toMatch(/^<div tabindex="-1" class="rounded-xl">/u);
  });

  it("com consulta, a ordem do Tab a partir do aviso: Abrir a Agenda e depois a confirmação", () => {
    const html = renderToStaticMarkup(<AvisoDeConsultas {...props} />);
    const agenda = html.indexOf("Abrir a Agenda");
    const confirmar = html.indexOf("Salvar mesmo assim");
    expect(agenda).toBeGreaterThan(-1);
    expect(confirmar).toBeGreaterThan(agenda);
  });

  it("o título padrão conta as consultas", () => {
    const html = renderToStaticMarkup(
      <AvisoDeConsultas {...props} consultas={2} />,
    );
    expect(html).toContain(
      "consultas marcadas neste período. Remarque ou cancele.",
    );
  });
});
