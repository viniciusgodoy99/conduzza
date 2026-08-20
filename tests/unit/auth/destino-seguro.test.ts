import { describe, expect, it } from "vitest";

import { destinoSeguro } from "@/lib/auth/destino-seguro";

// Defeito real encontrado na auditoria de 20/08/2026 e reproduzido contra o
// servidor: com next=@dominio, a rota devolvia
// "http://localhost:3000@dominio/", que o navegador entende como o HOST
// dominio. O usuario clicava no link legitimo de recuperacao de senha, o
// token era consumido, e ele caia no site do atacante ja autenticado.

const ORIGEM = "http://localhost:3000";

describe("destino seguro do link de e-mail", () => {
  it.each([
    ["@evil.example.com", "o vetor que foi explorado de verdade"],
    ["//evil.example.com", "protocolo relativo"],
    ["///evil.example.com", "barras extras"],
    ["https://evil.example.com", "URL absoluta"],
    ["http://evil.example.com", "URL absoluta sem TLS"],
    ["\\\\evil.example.com", "contrabarra"],
    ["/\\evil.example.com", "barra e contrabarra"],
    ["evil.example.com", "sem barra inicial"],
    ["javascript:alert(1)", "esquema perigoso"],
    ["", "vazio"],
  ])("recusa %s (%s)", (entrada) => {
    expect(destinoSeguro(entrada, ORIGEM)).toBe("/inicio");
  });

  it("aceita caminho interno simples", () => {
    expect(destinoSeguro("/inicio", ORIGEM)).toBe("/inicio");
    expect(destinoSeguro("/redefinir-senha", ORIGEM)).toBe("/redefinir-senha");
    expect(destinoSeguro("/convite", ORIGEM)).toBe("/convite");
  });

  it("preserva a consulta de um caminho interno", () => {
    expect(destinoSeguro("/atendimento?conversa=abc", ORIGEM)).toBe(
      "/atendimento?conversa=abc",
    );
  });

  it("sem parâmetro, vai para o início", () => {
    expect(destinoSeguro(null, ORIGEM)).toBe("/inicio");
  });

  it("nunca devolve destino cuja origem seja outra", () => {
    for (const entrada of [
      "@evil.example.com",
      "//evil.example.com",
      "https://evil.example.com",
    ]) {
      const destino = destinoSeguro(entrada, ORIGEM);
      expect(new URL(destino, ORIGEM).origin).toBe(ORIGEM);
    }
  });
});
