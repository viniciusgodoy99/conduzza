import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  lerPercentualDoObjetivo,
  textoDoObjetivo,
} from "@/lib/domain/exportacao-de-resultados";

// O objetivo de conversao (A3) no cartao Taxa de conversao: o rodape
// "Objetivo: X%" so existe com objetivo definido e some sem ele; a leitura
// do que a pessoa digita segue a faixa do banco (0,1 a 100, uma casa).

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { CartaoTaxaDeConversao } = await import(
  "@/components/relatorios/cartao-taxa-de-conversao"
);

const COORTE = { leads: 486, agendaram: 312, compareceram: 250 };

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("textoDoObjetivo", () => {
  it("sem objetivo, nada (o rodapé some)", () => {
    expect(textoDoObjetivo(null)).toBeUndefined();
    expect(textoDoObjetivo(undefined)).toBeUndefined();
  });

  it("escreve o percentual como a clínica definiu", () => {
    expect(
      textoDoObjetivo({ percentual: 60, atualizadoEm: "2026-10-02T12:00:00Z" }),
    ).toBe("Objetivo: 60%");
    expect(
      textoDoObjetivo({ percentual: 35.5, atualizadoEm: "2026-10-02T12:00:00Z" }),
    ).toBe("Objetivo: 35,5%");
  });
});

describe("CartaoTaxaDeConversao", () => {
  it("com objetivo, o rodapé mostra 'Objetivo: X%' no cartão em destaque", () => {
    const html = renderToStaticMarkup(
      <CartaoTaxaDeConversao
        coorte={COORTE}
        objetivo={{ percentual: 35.5, atualizadoEm: "2026-10-02T12:00:00Z" }}
      />,
    );
    expect(texto(html)).toContain("Taxa de conversão");
    expect(texto(html)).toContain("64,2 %");
    expect(texto(html)).toContain("Objetivo: 35,5%");
    expect(html).toContain("bg-primary");
  });

  it("sem objetivo, nenhum rodapé de objetivo", () => {
    const html = renderToStaticMarkup(
      <CartaoTaxaDeConversao coorte={COORTE} objetivo={null} />,
    );
    expect(texto(html)).not.toContain("Objetivo");
  });

  it("sem lead no período a taxa é campo vazio escrito, nunca 0%", () => {
    const html = renderToStaticMarkup(
      <CartaoTaxaDeConversao
        coorte={{ leads: 0, agendaram: 0, compareceram: 0 }}
        objetivo={{ percentual: 60, atualizadoEm: "2026-10-02T12:00:00Z" }}
      />,
    );
    expect(html).toContain('data-estado="vazio"');
    expect(texto(html)).toContain("Sem leads no período");
    // Nenhum "0%" ou "0,0 %" solto (o "60%" do objetivo nao conta).
    expect(texto(html)).not.toMatch(/\b0(,0)?\s?%/);
    // O objetivo continua visível: ele nao depende do periodo.
    expect(texto(html)).toContain("Objetivo: 60%");
  });

  it("a ação (definir objetivo) entra no cartão como veio montada", () => {
    const html = renderToStaticMarkup(
      <CartaoTaxaDeConversao
        coorte={COORTE}
        objetivo={null}
        acao={<button type="button">Definir objetivo</button>}
      />,
    );
    expect(texto(html)).toContain("Definir objetivo");
  });
});

describe("lerPercentualDoObjetivo", () => {
  it("aceita de 0,1 a 100 com vírgula ou ponto e até uma casa", () => {
    expect(lerPercentualDoObjetivo("35,5")).toBe(35.5);
    expect(lerPercentualDoObjetivo(" 7.5 ")).toBe(7.5);
    expect(lerPercentualDoObjetivo("60")).toBe(60);
    expect(lerPercentualDoObjetivo("0,1")).toBe(0.1);
    expect(lerPercentualDoObjetivo("100")).toBe(100);
  });

  it("recusa zero, acima de 100, duas casas e texto", () => {
    expect(lerPercentualDoObjetivo("0")).toBeNull();
    expect(lerPercentualDoObjetivo("0,0")).toBeNull();
    expect(lerPercentualDoObjetivo("100,1")).toBeNull();
    expect(lerPercentualDoObjetivo("12,34")).toBeNull();
    expect(lerPercentualDoObjetivo("-5")).toBeNull();
    expect(lerPercentualDoObjetivo("abc")).toBeNull();
    expect(lerPercentualDoObjetivo("")).toBeNull();
  });
});
