import { describe, expect, it } from "vitest";

import {
  chaveDeTelefone,
  DDDS_VALIDOS,
  formatarTelefone,
  mensagemDeTelefoneDuplicado,
  mesmoTelefone,
  normalizarTelefone,
} from "@/lib/domain/telefone";

// A regra unica de identidade de telefone. O WhatsApp entrega o celular de
// muitos DDDs SEM o nono digito e a recepcao digita COM ele: sem uma chave
// canonica, a mesma pessoa vira dois contatos e a confirmacao por resposta
// quebra. chaveDeTelefone tem ESPELHO no banco (public.chave_telefone); os
// casos da tabela abaixo foram conferidos tambem contra a funcao SQL.

describe("normalizarTelefone (entrada humana)", () => {
  it.each([
    ["(85) 99999-0000", "+5585999990000"],
    ["85999990000", "+5585999990000"],
    ["+55 85 99999-0000", "+5585999990000"],
    ["+55 (85) 9 9999-0000", "+5585999990000"],
    ["5585999990000", "+5585999990000"],
    ["085 99999-0000", "+5585999990000"],
    ["(085) 99999-0000", "+5585999990000"],
    ["(85) 3222-0000", "+558532220000"],
    ["8532220000", "+558532220000"],
    // Celular no formato antigo, como o WhatsApp entrega: vale, sem inventar o 9.
    ["+558488887777", "+558488887777"],
    ["(84) 8888-7777", "+558488887777"],
    ["+14155552671", "+14155552671"],
    ["+1 (415) 555-2671", "+14155552671"],
  ])("%s vira %s", (entrada, esperado) => {
    expect(normalizarTelefone(entrada)).toBe(esperado);
  });

  it.each([
    ["vazio", ""],
    ["letras", "sem telefone"],
    ["curto", "123"],
    ["sem DDD", "999990000"],
    ["longo demais", "859999900001234"],
    // Colado com +55 e depois o servidor punha +55 de novo: nunca mais.
    ["+55 duplicado", "+555585999990000"],
    ["DDD que nao existe (23)", "(23) 99999-0000"],
    ["DDD com zero (20)", "(20) 99999-0000"],
    ["celular de 9 digitos sem o 9 na frente", "(85) 89999-0000"],
  ])("%s vira null", (_nome, entrada) => {
    expect(normalizarTelefone(entrada)).toBeNull();
  });

  it("e idempotente: normalizar um E.164 valido devolve o mesmo", () => {
    for (const e164 of [
      "+5585999990000",
      "+558532220000",
      "+558488887777",
      "+14155552671",
    ]) {
      expect(normalizarTelefone(e164)).toBe(e164);
    }
  });
});

describe("chaveDeTelefone (comparacao)", () => {
  it.each([
    // celular sem o 9 ganha o 9 (6 a 9 depois do DDD)
    ["+558499990000", "+5584999990000"],
    ["+558488887777", "+5584988887777"],
    ["+558477776666", "+5584977776666"],
    ["+558466665555", "+5584966665555"],
    // celular que ja tem o 9 fica igual
    ["+5584999990000", "+5584999990000"],
    // fixo (2 a 5) fica igual
    ["+558432220000", "+558432220000"],
    ["+551155550000", "+551155550000"],
    // estrangeiro fica igual
    ["+442071234567", "+442071234567"],
    ["+14155552671", "+14155552671"],
    // DDD que nao existe: fora do padrao, fica igual
    ["+552381239999", "+552381239999"],
    // lixo fica igual (nunca inventa)
    ["+555585999990000", "+555585999990000"],
  ])("%s tem chave %s", (e164, chave) => {
    expect(chaveDeTelefone(e164)).toBe(chave);
  });

  it("com e sem o nono digito sao a mesma pessoa", () => {
    expect(mesmoTelefone("+558499990000", "+5584999990000")).toBe(true);
    expect(mesmoTelefone("+5584999990000", "+558499990000")).toBe(true);
  });

  it("fixo e celular com os mesmos 8 digitos finais NAO sao a mesma pessoa", () => {
    expect(mesmoTelefone("+558432220000", "+5584932220000")).toBe(false);
  });

  it("a chave e idempotente", () => {
    const chave = chaveDeTelefone("+558499990000");
    expect(chaveDeTelefone(chave)).toBe(chave);
  });

  it("todo DDD da lista tem dois digitos sem zero", () => {
    expect(DDDS_VALIDOS.size).toBe(67);
    for (const ddd of DDDS_VALIDOS) {
      expect(ddd).toMatch(/^[1-9][1-9]$/);
    }
  });
});

describe("formatarTelefone (exibicao)", () => {
  it("celular aparece com o nono digito, como se disca hoje", () => {
    expect(formatarTelefone("+5585999990000")).toBe("(85) 99999-0000");
    expect(formatarTelefone("+558588887777")).toBe("(85) 98888-7777");
  });

  it("fixo aparece com 8 digitos", () => {
    expect(formatarTelefone("+558532220000")).toBe("(85) 3222-0000");
  });

  it("estrangeiro ou fora do padrao aparece como esta", () => {
    expect(formatarTelefone("+14155552671")).toBe("+14155552671");
    expect(formatarTelefone("+555585999990000")).toBe("+555585999990000");
  });

  it("nenhum travessao no texto exibido", () => {
    expect(formatarTelefone("+5585999990000")).not.toMatch(
      new RegExp("[\\u2013\\u2014]"),
    );
  });
});

describe("mensagem de duplicado", () => {
  it("diz quem ja tem o numero", () => {
    expect(mensagemDeTelefoneDuplicado("Maria Souza")).toBe(
      "Já existe um contato com este telefone: Maria Souza.",
    );
  });

  it("cadastro sem nome nao vira dois pontos soltos", () => {
    expect(mensagemDeTelefoneDuplicado(null)).toBe(
      "Já existe um contato com este telefone (cadastro sem nome).",
    );
    expect(mensagemDeTelefoneDuplicado("  ")).toBe(
      "Já existe um contato com este telefone (cadastro sem nome).",
    );
  });
});
