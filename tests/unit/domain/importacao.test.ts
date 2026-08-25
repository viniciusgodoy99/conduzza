import { describe, expect, it } from "vitest";

import {
  dividirEmLotes,
  normalizarTelefone,
  validarLinha,
} from "@/lib/domain/importacao";

// Aceite da importacao de planilha: telefone em E.164, linha sem telefone
// reportada e divisao em lotes para gravar com progresso.

describe("normalizarTelefone", () => {
  it("celular com DDD e sem +55 ganha o +55", () => {
    expect(normalizarTelefone("85999990000")).toBe("+5585999990000");
  });

  it("pontuacao e espacos de planilha nao atrapalham", () => {
    expect(normalizarTelefone("(85) 99999-0000")).toBe("+5585999990000");
    expect(normalizarTelefone("+55 85 99999-0000")).toBe("+5585999990000");
  });

  it("fixo de 8 digitos com DDD vale sem o nono digito", () => {
    expect(normalizarTelefone("8532220000")).toBe("+558532220000");
    expect(normalizarTelefone("(85) 3222-0000")).toBe("+558532220000");
  });

  it("55 do pais sem o + tambem normaliza", () => {
    expect(normalizarTelefone("5585999990000")).toBe("+5585999990000");
  });

  it("zero de operadora na frente e descartado", () => {
    expect(normalizarTelefone("085999990000")).toBe("+5585999990000");
  });

  it("internacional ja em E.164 passa direto", () => {
    expect(normalizarTelefone("+14155552671")).toBe("+14155552671");
    expect(normalizarTelefone("+1 (415) 555-2671")).toBe("+14155552671");
  });

  it("lixo irrecuperavel vira null, nunca chute", () => {
    expect(normalizarTelefone("sem telefone")).toBeNull();
    expect(normalizarTelefone("123")).toBeNull();
    expect(normalizarTelefone("")).toBeNull();
    // Celular sem DDD: nao ha como montar E.164 sem inventar regiao.
    expect(normalizarTelefone("999990000")).toBeNull();
    // Longo demais para numero nacional.
    expect(normalizarTelefone("859999900001234")).toBeNull();
  });
});

describe("validarLinha", () => {
  const mapeamento = {
    name: 0,
    phone_e164: 1,
    email: 2,
    insurance_name: null,
    source_campaign: null,
  };

  it("linha valida sai mapeada com o telefone em E.164", () => {
    const resultado = validarLinha(
      ["Maria Silva", "(85) 99999-0000", "maria@exemplo.com"],
      mapeamento,
    );
    expect(resultado).toEqual({
      ok: true,
      linha: {
        name: "Maria Silva",
        phone_e164: "+5585999990000",
        email: "maria@exemplo.com",
        insurance_name: null,
        source_campaign: null,
      },
    });
  });

  it("linha sem telefone e reportada, telefone e obrigatorio", () => {
    const semColuna = validarLinha(["Maria Silva"], mapeamento);
    expect(semColuna.ok).toBe(false);
    const vazio = validarLinha(["Maria Silva", "  ", ""], mapeamento);
    expect(vazio.ok).toBe(false);
    const semMapeamento = validarLinha(["Maria", "85999990000"], {
      ...mapeamento,
      phone_e164: null,
    });
    expect(semMapeamento.ok).toBe(false);
  });

  it("telefone irrecuperavel e reportado com motivo", () => {
    const resultado = validarLinha(["Maria", "abc"], mapeamento);
    expect(resultado).toEqual({ ok: false, motivo: "Telefone inválido" });
  });

  it("campo opcional vazio vira null", () => {
    const resultado = validarLinha(["", "85999990000", "  "], mapeamento);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.linha.name).toBeNull();
      expect(resultado.linha.email).toBeNull();
    }
  });
});

describe("dividirEmLotes", () => {
  it("divide na ordem, com o resto no ultimo lote", () => {
    expect(dividirEmLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("lista vazia devolve zero lotes", () => {
    expect(dividirEmLotes([], 10)).toEqual([]);
  });

  it("lote maior que a lista devolve um lote so", () => {
    expect(dividirEmLotes([1, 2], 100)).toEqual([[1, 2]]);
  });

  it("tamanho invalido e erro de programacao, nao silencio", () => {
    expect(() => dividirEmLotes([1], 0)).toThrow();
    expect(() => dividirEmLotes([1], 1.5)).toThrow();
  });
});
