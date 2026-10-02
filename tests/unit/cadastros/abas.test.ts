import { describe, expect, it } from "vitest";

import {
  ABA_PADRAO_DE_CADASTROS,
  ABAS_DE_CADASTROS,
  abaDeCadastros,
  redirecionamentoDeAbaQueSaiu,
} from "@/app/(app)/cadastros/abas";

// Decisao do dono de 29/09/2026: Vinculos, Recursos e Bloqueios sairam de
// Cadastros. A tela fica com cinco abas e o link antigo leva para onde o
// assunto mora agora.

describe("abas de Cadastros", () => {
  it("tem as cinco abas, na ordem da tela, sem as que sairam", () => {
    expect(ABAS_DE_CADASTROS.map(([chave]) => chave)).toEqual([
      "profissionais",
      "procedimentos",
      "convenios",
      "pacotes",
      "unidades",
    ]);
  });

  it("a aba padrao e Profissionais", () => {
    expect(ABA_PADRAO_DE_CADASTROS).toBe("profissionais");
  });

  it("aceita a aba que existe e cai na padrao para o resto", () => {
    expect(abaDeCadastros("procedimentos")).toBe("procedimentos");
    expect(abaDeCadastros("unidades")).toBe("unidades");
    expect(abaDeCadastros(undefined)).toBe("profissionais");
    expect(abaDeCadastros("")).toBe("profissionais");
    expect(abaDeCadastros("inexistente")).toBe("profissionais");
    // As que sairam nao voltam a ser aba valida por engano.
    expect(abaDeCadastros("vinculos")).toBe("profissionais");
    expect(abaDeCadastros("recursos")).toBe("profissionais");
    expect(abaDeCadastros("bloqueios")).toBe("profissionais");
  });
});

describe("link antigo de aba que saiu", () => {
  it("vinculos vai para Procedimentos, onde o vinculo e feito agora", () => {
    expect(redirecionamentoDeAbaQueSaiu("vinculos")).toBe(
      "/cadastros?aba=procedimentos",
    );
  });

  it("recursos e bloqueios vao para a aba padrao", () => {
    expect(redirecionamentoDeAbaQueSaiu("recursos")).toBe("/cadastros");
    expect(redirecionamentoDeAbaQueSaiu("bloqueios")).toBe("/cadastros");
  });

  it("aba que existe, ausente ou desconhecida nao redireciona", () => {
    for (const [chave] of ABAS_DE_CADASTROS) {
      expect(redirecionamentoDeAbaQueSaiu(chave)).toBeNull();
    }
    expect(redirecionamentoDeAbaQueSaiu(undefined)).toBeNull();
    expect(redirecionamentoDeAbaQueSaiu("inexistente")).toBeNull();
    // Nada herdado do prototipo de objeto casa com uma aba que saiu.
    expect(redirecionamentoDeAbaQueSaiu("constructor")).toBeNull();
    expect(redirecionamentoDeAbaQueSaiu("__proto__")).toBeNull();
  });

  it("aba repetida na URL (lista) nao redireciona nem quebra", () => {
    expect(redirecionamentoDeAbaQueSaiu(["vinculos", "recursos"])).toBeNull();
  });
});
