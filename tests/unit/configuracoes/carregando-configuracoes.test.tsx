import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CarregandoConfiguracoes from "@/app/(app)/configuracoes/loading";

// O esqueleto de Configuracoes desenha uma barra por aba. A tela ganhou
// "Automações de fluxo" e "Mensagens padrão" em 02/10/2026 e o esqueleto
// ficou com 6 barras para 8 abas: a tela "pulava" quando carregava. A lista
// de abas mora num componente de cliente (configuracoes-client.tsx, sem
// export), entao o teste conta as tuplas [chave, rotulo] do ABAS no fonte.
// Desde 20/10/2026 "Automações de fluxo" mora na tela Automacoes (decisao
// do dono, onda 4), e a onda 5 trouxe "Origem dos leads" logo depois de
// "Anúncios do Google" (P17-1 do dono): a fileira e o esqueleto ficam com 9.

function abasDaTela(): string[] {
  const fonte = readFileSync(
    join(process.cwd(), "app/(app)/configuracoes/configuracoes-client.tsx"),
    "utf-8",
  );
  const bloco = /const ABAS = \[([\s\S]*?)\] as const;/.exec(fonte)?.[1];
  expect(bloco, "ABAS de configuracoes-client.tsx").toBeDefined();
  return [...(bloco ?? "").matchAll(/\[\s*"([a-z_]+)",\s*"[^"]+"\s*\]/g)].map(
    (casamento) => casamento[1] ?? "",
  );
}

function barrasDoEsqueleto(): number {
  const html = renderToStaticMarkup(<CarregandoConfiguracoes />);
  const inicio = html.indexOf("pt-2.5 pb-3");
  expect(inicio, "a fileira de abas do esqueleto").toBeGreaterThan(-1);
  // Ate o primeiro cartao, que vem logo depois da fileira.
  const fileira = html.slice(inicio, html.indexOf("rounded-card", inicio));
  return (fileira.match(/data-slot="skeleton"/g) ?? []).length;
}

describe("esqueleto de Configurações", () => {
  it("tem uma barra para cada aba da tela", () => {
    const abas = abasDaTela();
    expect(abas).toContain("mensagens");
    expect(abas).toContain("rastreio");
    expect(barrasDoEsqueleto()).toBe(abas.length);
  });

  it("Automações de fluxo saiu da fileira (mora em Automações)", () => {
    const abas = abasDaTela();
    expect(abas).not.toContain("fluxo");
    // Em 17/11/2026 as tres abas de anuncios viraram uma: Anuncios e rastreio.
    expect(abas).toHaveLength(7);
    // A jornada agora e seguida direto pelas etiquetas.
    expect(abas.indexOf("etiquetas")).toBe(abas.indexOf("jornada") + 1);
  });

  it("Anúncios e rastreio é a última aba, no lugar das três de anúncios e origem (17/11/2026)", () => {
    const abas = abasDaTela();
    expect(abas.at(-1)).toBe("rastreio");
    expect(abas.indexOf("rastreio")).toBe(abas.indexOf("mensagens") + 1);
    for (const antiga of ["meta", "google", "origem"]) {
      expect(abas).not.toContain(antiga);
    }
    expect(barrasDoEsqueleto()).toBe(7);
  });
});
