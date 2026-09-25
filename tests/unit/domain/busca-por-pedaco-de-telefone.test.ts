import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { chaveDeTelefone, normalizarTelefone } from "@/lib/domain/telefone";

// Achado L15 da revisao da leva 2: o pedaco de numero digitado nos modais
// de busca de paciente (Agenda e Lista de espera) comparava so com o texto
// gravado (phone_e164). Quem veio do WhatsApp sem o nono digito
// (+558599990000) nao era achado por "99999-0000", que e o numero que a tela
// mostra (formatarTelefone formata pela chave, com o 9). A busca de pedaco
// passa a olhar a chave (coluna gerada phone_key, sempre com o 9) e continua
// olhando o texto gravado.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const MODAIS = [
  "components/agenda/agendamento-modal.tsx",
  "components/espera/modal-adicionar.tsx",
];

function digitos(termo: string): string {
  return termo.replace(/\D/g, "");
}

describe("busca por pedaço de telefone", () => {
  // O WhatsApp gravou sem o nono digito; a tela mostra "(85) 98765-4321".
  const gravadoSemNove = "+558587654321";

  it("o pedaço com o 9 não aparece no texto gravado sem o 9, mas aparece na chave", () => {
    const pedaco = digitos("98765-4321");
    // Nove digitos sem DDD nao viram numero completo: cai no ramo de pedaco.
    expect(normalizarTelefone("98765-4321")).toBeNull();
    expect(gravadoSemNove.includes(pedaco)).toBe(false);
    expect(chaveDeTelefone(gravadoSemNove).includes(pedaco)).toBe(true);
    expect(gravadoSemNove.includes(digitos("98765"))).toBe(false);
    expect(chaveDeTelefone(gravadoSemNove).includes(digitos("98765"))).toBe(
      true,
    );
    // O caso do achado: +558599990000 buscado por "99999-0000".
    expect("+558599990000".includes(digitos("99999-0000"))).toBe(false);
    expect(
      chaveDeTelefone("+558599990000").includes(digitos("99999-0000")),
    ).toBe(true);
  });

  it("pedaço sem o 9 que atravessa o DDD só casa com o texto gravado", () => {
    const pedaco = digitos("85 8765");
    expect(gravadoSemNove.includes(pedaco)).toBe(true);
    expect(chaveDeTelefone(gravadoSemNove).includes(pedaco)).toBe(false);
  });

  for (const arquivo of MODAIS) {
    it(`${arquivo} procura o pedaço pela chave e pelo texto gravado`, () => {
      const fonte = readFileSync(path.join(RAIZ, arquivo), "utf8");
      expect(fonte).toContain(
        "phone_key.ilike.%${digitos}%,phone_e164.ilike.%${digitos}%",
      );
      expect(fonte).not.toMatch(/\.ilike\(\s*"phone_e164"/);
    });
  }
});
