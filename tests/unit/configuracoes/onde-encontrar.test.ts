import { describe, expect, it } from "vitest";

import { ONDE_ENCONTRAR, type OndeEncontrar } from "@/lib/domain/onde-encontrar";

// Os links de "onde encontro" saem do sistema para a Meta e o Google: so
// enderecos oficiais, em https, e texto sem travessao.

const OFICIAIS = new Set([
  "business.facebook.com",
  "www.facebook.com",
  "ads.google.com",
  "support.google.com",
]);

describe("ONDE_ENCONTRAR", () => {
  const itens = Object.entries(ONDE_ENCONTRAR) as [string, OndeEncontrar][];

  it.each(itens)("%s: passos escritos e links só para páginas oficiais", (_nome, item) => {
    expect(item.passos.length).toBeGreaterThanOrEqual(2);
    for (const passo of item.passos) {
      expect(passo).not.toMatch(/[—–]/);
      expect(passo.endsWith(".")).toBe(true);
    }
    for (const link of [item.link, item.ajuda]) {
      if (!link) continue;
      const url = new URL(link.href);
      expect(url.protocol).toBe("https:");
      expect(OFICIAIS.has(url.hostname)).toBe(true);
      expect(link.rotulo).not.toMatch(/[—–]/);
    }
  });

  it("todo item tem pelo menos um link", () => {
    for (const [, item] of itens) {
      expect(item.link ?? item.ajuda).not.toBeNull();
    }
  });
});
