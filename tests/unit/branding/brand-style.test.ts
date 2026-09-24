import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { brandStyleFor } = await import("@/lib/branding/brand-style");

// White-label com o Conduzza Design System (docs/06 secao 4.8): a marca
// padrao nunca e injetada (nem o lime antigo, default da coluna
// clinic_branding.primary_color, nem o novo); a cor custom leva os derivados.
describe("brandStyleFor", () => {
  it.each(["#A8D318", "#a8d318", "#B2E54F", "#b2e54f"])(
    "%s é a marca padrão e não injeta nada",
    (cor) => {
      expect(brandStyleFor(cor)).toBeUndefined();
    },
  );

  it.each([null, undefined, "", "roxo", "#7c3aed80", "#fff"])(
    "valor inválido (%s) não injeta nada",
    (cor) => {
      expect(brandStyleFor(cor)).toBeUndefined();
    },
  );

  it("cor custom injeta a primária e os derivados que mudam com o tema", () => {
    const estilo = brandStyleFor("#7C3AED") as Record<string, string>;
    expect(estilo["--primary"]).toBe("#7C3AED");
    expect(estilo["--primary-foreground"]).toBe("#ffffff");
    expect(estilo["--primary-soft"]).toContain("var(--surface-1)");
    expect(estilo["--primary-soft-hover"]).toContain("var(--surface-1)");
    expect(estilo["--primary-text"]).toContain("var(--text-strong)");
    expect(estilo["--primary-edge"]).toContain("var(--text-strong)");
    expect(estilo["--focus"]).toBe("var(--primary-text)");
    expect(estilo["--chart-bar"]).toBe("var(--primary-edge)");
    expect(estilo["--sidebar-primary"]).toBe("#7C3AED");
    expect(estilo["--sidebar-primary-foreground"]).toBe("#ffffff");
    expect(estilo["--sidebar-ring"]).toBe("#7C3AED");
  });

  it("cor custom clara usa a tinta da marca como texto", () => {
    const estilo = brandStyleFor("#F5D90A") as Record<string, string>;
    expect(estilo["--primary-foreground"]).toBe("#051813");
    expect(estilo["--sidebar-primary-foreground"]).toBe("#051813");
  });
});
