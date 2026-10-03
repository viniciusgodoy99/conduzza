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
    expect(abas).toContain("fluxo");
    expect(abas).toContain("mensagens");
    expect(barrasDoEsqueleto()).toBe(abas.length);
  });
});
