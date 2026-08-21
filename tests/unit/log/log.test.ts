import { describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";

// A garantia de "nenhum dado de paciente em log" e estrutural: chave fora da
// lista fechada e descartada. Este teste e a blindagem disso.

function capturar(fn: () => void): Record<string, unknown> {
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    fn();
    const linha = spy.mock.calls[0]?.[0];
    return JSON.parse(String(linha)) as Record<string, unknown>;
  } finally {
    spy.mockRestore();
  }
}

describe("logger estruturado", () => {
  it("mantém apenas campos da lista fechada", () => {
    const saida = capturar(() =>
      log.info("teste", {
        clinic_id: "abc",
        error_code: "463",
        // Tudo abaixo simula dado de paciente vazando por engano: TEM que sumir.
        body: "minha pele está ardendo",
        name: "Maria da Silva",
        phone: "+5584999990000",
        transcript: "quero adiantar minha consulta",
        email: "paciente@exemplo.com",
      } as never),
    );
    expect(saida.clinic_id).toBe("abc");
    expect(saida.error_code).toBe("463");
    expect(saida).not.toHaveProperty("body");
    expect(saida).not.toHaveProperty("name");
    expect(saida).not.toHaveProperty("phone");
    expect(saida).not.toHaveProperty("transcript");
    expect(saida).not.toHaveProperty("email");
  });

  it("carimba nível e evento", () => {
    const saida = capturar(() => log.warn("whatsapp_desconectou"));
    expect(saida.nivel).toBe("warn");
    expect(saida.evento).toBe("whatsapp_desconectou");
    expect(typeof saida.ts).toBe("string");
  });
});
