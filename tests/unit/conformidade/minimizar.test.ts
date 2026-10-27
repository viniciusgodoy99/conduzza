import { describe, expect, it } from "vitest";

import {
  mascararDadosDaColeta,
  mascararNascimentos,
  mascararNomeCompleto,
  mascararTrechosCitados,
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

// Revisao final da AG3 (achado 14): no turno da coleta de dados, a copia
// que vai ao classificador e ao verificador leva marcadores no lugar do nome
// completo e do nascimento (o agente le o texto inteiro).
describe("mascararDadosDaColeta", () => {
  it.each([
    [
      "Fulano da Silva Souza, nascida em 12/03/1985, CPF 529.982.247-25",
      "[nome], nascida em [nascimento], CPF 529.982.247-25",
    ],
    ["Maria da Silva Souza, 12/03/1985", "[nome], [nascimento]"],
    [
      "Meu nome é maria da silva souza e nasci em 12/03/1985",
      "Meu nome é [nome] e nasci em [nascimento]",
    ],
    [
      "nome completo: joão pereira dos santos\nnascimento: 05/06/1990",
      "nome completo: [nome]\nnascimento: [nascimento]",
    ],
    [
      "Me chamo Ana Clara Ribeiro. Nasci dia 3 de março de 1992.",
      "Me chamo [nome]. Nasci dia [nascimento].",
    ],
    ["MARIA DA SILVA SOUZA 12/03/85", "[nome] [nascimento]"],
    ["nasci em 1990-06-05", "nasci em [nascimento]"],
  ])("mascara %j", (entrada, esperado) => {
    expect(mascararDadosDaColeta(entrada, { anoCorrente: 2026 })).toBe(esperado);
  });

  it("deixa o que não é nome nem nascimento: o sintoma, a data da consulta e o profissional", () => {
    for (const [entrada, esperado] of [
      // A data com ano no passado vira marcador; o sintoma continua (o
      // classificador precisa dele).
      ["Estou com dor de cabeça desde 12/03/2024", "Estou com dor de cabeça desde [nascimento]"],
      ["Quero marcar dia 21/10/2026 às 14h", "Quero marcar dia 21/10/2026 às 14h"],
      ["Pode ser quarta às 14h com a Dra. Ana Lima?", "Pode ser quarta às 14h com a Dra. Ana Lima?"],
      ["Tenho 40 anos e sou alérgica a dipirona", "Tenho 40 anos e sou alérgica a dipirona"],
    ] as const) {
      expect(mascararDadosDaColeta(entrada, { anoCorrente: 2026 }), entrada).toBe(
        esperado,
      );
    }
  });

  it("o nome que o agente registrou some onde aparecer (sem diferenciar caixa e acento)", () => {
    expect(
      mascararDadosDaColeta("Obrigada, MARIA aparecida da silva souza!", {
        anoCorrente: 2026,
        nomes: ["Maria Aparecida da Silva Souza"],
      }),
    ).toBe("Obrigada, [nome]!");
    // O mais comprido primeiro: a marca do contato junto do nome.
    expect(
      mascararTrechosCitados(
        "Fulano da Silva Souza e da Silva Souza",
        ["da Silva Souza", "Fulano da Silva Souza"],
        "[nome]",
      ),
    ).toBe("[nome] e [nome]");
    // Palavra inteira: "Ana" nao some de "Banana".
    expect(mascararTrechosCitados("Banana", ["Ana"], "[nome]")).toBe("Banana");
  });

  it("as peças sozinhas: o nascimento e o nome", () => {
    expect(mascararNascimentos("12/03/85 e 21/10/26", 2026)).toBe(
      "[nascimento] e 21/10/26",
    );
    expect(mascararNomeCompleto("Ana Lima, [nascimento]")).toBe(
      "[nome], [nascimento]",
    );
    // Sem a deixa nem o nascimento ao lado, o nome em maiusculas fica.
    expect(mascararNomeCompleto("A Dra. Ana Lima atende quarta")).toBe(
      "A Dra. Ana Lima atende quarta",
    );
  });
});
