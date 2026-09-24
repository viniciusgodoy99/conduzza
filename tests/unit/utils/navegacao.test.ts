import { describe, expect, it } from "vitest";

import {
  NAV_GROUP_ORDER,
  NAV_ITEMS,
  itemDaRota,
  preferenciaDoRail,
} from "@/lib/navigation";

// Menu lateral do Conduzza Design System (docs/06 secao 5.1): o item ativo e
// o titulo da barra superior saem de itemDaRota, e a largura do menu da
// preferencia lida do cookie cz_rail.

describe("itemDaRota", () => {
  it("acha o item pela rota exata", () => {
    expect(itemDaRota("/agenda")?.href).toBe("/agenda");
  });

  it("marca o item pai numa rota filha", () => {
    expect(itemDaRota("/pacientes/0f8b2c1e-1234")?.href).toBe("/pacientes");
  });

  it("nao confunde prefixo de texto com rota filha", () => {
    expect(itemDaRota("/agendamentos")).toBeNull();
  });

  it("devolve null fora do menu", () => {
    expect(itemDaRota("/selecionar-clinica")).toBeNull();
  });
});

describe("preferenciaDoRail", () => {
  it("aceita so as duas escolhas gravadas", () => {
    expect(preferenciaDoRail("expanded")).toBe("expanded");
    expect(preferenciaDoRail("collapsed")).toBe("collapsed");
  });

  it("qualquer outro valor segue a largura da tela", () => {
    expect(preferenciaDoRail(undefined)).toBe("auto");
    expect(preferenciaDoRail("")).toBe("auto");
    expect(preferenciaDoRail("aberto")).toBe("auto");
  });
});

describe("blocos do menu", () => {
  it("todo item pertence a um bloco da ordem", () => {
    for (const item of NAV_ITEMS) {
      expect(NAV_GROUP_ORDER).toContain(item.group);
    }
  });

  it("contadores so em Atendimento e Confirmações", () => {
    const comContador = NAV_ITEMS.filter((item) => item.badge).map(
      (item) => item.href,
    );
    expect(comContador).toEqual(["/atendimento", "/confirmacoes"]);
  });
});
