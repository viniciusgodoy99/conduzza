import { describe, expect, it } from "vitest";

import {
  minimizarParaLlm,
  temDadoPessoal,
} from "@/lib/domain/conformidade/minimizar";

// LGPD: o que identifica a pessoa sai antes de qualquer texto ir a um modelo.
// Data e hora ficam, porque sao o que a recepcao precisa entender.

describe("minimizarParaLlm", () => {
  it.each([
    ["meu cpf é 123.456.789-09", "meu cpf é [cpf]"],
    ["cpf 12345678909", "cpf [numero]"],
    ["cnpj 12.345.678/0001-90", "cnpj [cnpj]"],
    ["me liga no (85) 99999-0000", "me liga no [telefone]"],
    ["+55 85 99999-0000", "[telefone]"],
    ["5585999990000", "[numero]"],
    ["99999-0000", "[telefone]"],
    ["9999-0000", "[telefone]"],
    ["email maria.silva@gmail.com", "email [email]"],
    ["cep 60000-000 e 60.000-000", "cep [cep] e [cep]"],
    ["carteirinha 0 123 456789012345 0", "carteirinha [numero]"],
    ["RG 12.345.678-9", "RG [numero]"],
  ])("troca %j", (entrada, esperado) => {
    expect(minimizarParaLlm(entrada)).toBe(esperado);
  });

  it.each([
    "dia 05/10/2026 às 10:30 ou 10h30 ou 14h",
    "dia 14-10-2026",
    "R$ 1.500,00 e R$ 150,00",
    "tenho 16 anos",
    "rua das flores 123",
    "às 9 e 30",
  ])("preserva %j", (entrada) => {
    expect(minimizarParaLlm(entrada)).toBe(entrada);
  });

  it("nao deixa o telefone colar na palavra anterior", () => {
    expect(minimizarParaLlm("ligue 85 99999-0000 hoje")).toBe(
      "ligue [telefone] hoje",
    );
  });

  it("temDadoPessoal responde pela mesma regra", () => {
    expect(temDadoPessoal("meu cpf é 123.456.789-09")).toBe(true);
    expect(temDadoPessoal("amanhã às 10h, R$ 250,00")).toBe(false);
  });
});
