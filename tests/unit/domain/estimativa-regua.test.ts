import { describe, expect, it } from "vitest";

import { estimarRegua } from "@/lib/domain/estimativa-regua";

// Aceite da estimativa da Tela 7 (spec 7.5): volume e aritmetica de dado
// real; custo em reais SO com preco na tabela (pendencia P1, nunca inventado).

describe("estimarRegua", () => {
  it("multiplica eventos por passos e monta a frase de recepção", () => {
    const r = estimarRegua({
      eventos30d: 440,
      passos: 3,
      rotuloDoEvento: "consultas marcadas",
      rotuloDoEventoSingular: "consulta marcada",
      precoCents: null,
    });
    expect(r.mensagensPorMes).toBe(1320);
    expect(r.frase).toContain("cerca de 1320 mensagens por mês");
    expect(r.frase).toContain("440 consultas marcadas");
    expect(r.frase).toContain("3 mensagens por consulta");
  });

  it("sem preço na tabela, fala do custo zero do canal por QR e nada de reais", () => {
    const r = estimarRegua({
      eventos30d: 10,
      passos: 2,
      rotuloDoEvento: "faltas registradas",
      rotuloDoEventoSingular: "falta registrada",
      precoCents: null,
    });
    expect(r.fraseDeCusto).toContain("não há custo por mensagem");
    expect(r.fraseDeCusto).not.toContain("R$");
  });

  it("com preço na tabela, calcula os reais do mês", () => {
    const r = estimarRegua({
      eventos30d: 100,
      passos: 3,
      rotuloDoEvento: "consultas marcadas",
      rotuloDoEventoSingular: "consulta marcada",
      precoCents: 5,
    });
    // 300 mensagens x 5 centavos = R$ 15,00
    expect(r.fraseDeCusto).toContain("15,00");
    expect(r.fraseDeCusto).toContain("por mês");
  });

  it("régua sem passo com texto avisa que nada é enviado", () => {
    const r = estimarRegua({
      eventos30d: 50,
      passos: 0,
      rotuloDoEvento: "consultas marcadas",
      rotuloDoEventoSingular: "consulta marcada",
      precoCents: null,
    });
    expect(r.mensagensPorMes).toBe(0);
    expect(r.frase).toContain("nada é enviado");
  });

  it("singular honesto: 1 evento com 1 mensagem", () => {
    const r = estimarRegua({
      eventos30d: 1,
      passos: 1,
      rotuloDoEvento: "faltas registradas",
      rotuloDoEventoSingular: "falta registrada",
      precoCents: null,
    });
    expect(r.frase).toContain("cerca de 1 mensagem por mês");
    expect(r.frase).toContain("1 falta registrada nos últimos 30 dias");
    expect(r.frase).toContain("1 mensagem por falta");
  });
});
