import { describe, expect, it } from "vitest";

import { decodificarCsv } from "@/components/leads/importacao/decodificar-csv";
import { parseCsv } from "@/lib/utils/csv";

// Achado 101 da revisao: o CSV do Excel em portugues vem em Windows-1252, e a
// leitura como UTF-8 trocava "João" por "Jo�o" sem aviso.

describe("decodificarCsv", () => {
  it("UTF-8 passa direto, sem marcar recodificacao", () => {
    const bytes = new TextEncoder().encode("Nome;Telefone\nJoão;85999990000");
    const lido = decodificarCsv(bytes);
    expect(lido.recodificado).toBe(false);
    expect(lido.texto).toContain("João");
  });

  it("Windows-1252 do Excel volta com os acentos certos", () => {
    // "Nome;Telefone\nJoão Conceição;85999990000" em Windows-1252:
    // ã = 0xE3, ç = 0xE7.
    const texto = "Nome;Telefone\nJoão Conceição;85999990000";
    const bytes = Uint8Array.from(
      [...texto].map((letra) =>
        letra === "ã" ? 0xe3 : letra === "ç" ? 0xe7 : letra.charCodeAt(0),
      ),
    );
    const lido = decodificarCsv(bytes);
    expect(lido.recodificado).toBe(true);
    expect(lido.texto).toBe(texto);
    expect(lido.texto).not.toContain("�");
    expect(parseCsv(lido.texto).linhas[1]?.[0]).toBe("João Conceição");
  });

  it("o BOM do UTF-8 nao vira caractere no cabecalho", () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("Nome;Telefone\nAna;85999990000"),
    ]);
    const lido = decodificarCsv(bytes);
    expect(lido.recodificado).toBe(false);
    expect(parseCsv(lido.texto).linhas[0]?.[0]).toBe("Nome");
  });
});
