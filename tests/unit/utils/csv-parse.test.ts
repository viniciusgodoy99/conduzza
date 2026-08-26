import { describe, expect, it } from "vitest";

import { gerarCsv, parseCsv } from "@/lib/utils/csv";

// Fase 4 (importacao da Tela 4): o leitor de CSV cobre o dialeto Excel
// pt-BR (";" e BOM) e o americano (","), aspas escapadas e quebra de linha
// dentro de celula.

describe("parseCsv", () => {
  it("lê o dialeto Excel pt-BR com BOM e ponto e vírgula", () => {
    const { delimitador, linhas } = parseCsv(
      "﻿Nome;Telefone\r\nMaria Silva;+5585999990001\r\n",
    );
    expect(delimitador).toBe(";");
    expect(linhas).toEqual([
      ["Nome", "Telefone"],
      ["Maria Silva", "+5585999990001"],
    ]);
  });

  it("detecta vírgula quando é o delimitador dominante", () => {
    const { delimitador, linhas } = parseCsv(
      "name,phone\nAna,+5585999990002\n",
    );
    expect(delimitador).toBe(",");
    expect(linhas[1]).toEqual(["Ana", "+5585999990002"]);
  });

  it("respeita aspas: delimitador e aspas escapadas dentro da célula", () => {
    const { linhas } = parseCsv('Nome;Obs\n"Silva; Maria";"disse ""oi"""\n');
    expect(linhas[1]).toEqual(["Silva; Maria", 'disse "oi"']);
  });

  it("mantém quebra de linha dentro de célula entre aspas", () => {
    const { linhas } = parseCsv('Nome;Obs\nAna;"linha um\nlinha dois"\n');
    expect(linhas[1]).toEqual(["Ana", "linha um\nlinha dois"]);
  });

  it("ignora linhas totalmente vazias no fim da planilha", () => {
    const { linhas } = parseCsv("Nome;Fone\nAna;1\n;\n\n");
    expect(linhas).toHaveLength(2);
  });

  it("delimitador dentro de aspas não conta na detecção", () => {
    const { delimitador } = parseCsv('"a,b,c,d";x\n1;2\n');
    expect(delimitador).toBe(";");
  });

  it("faz ida e volta com gerarCsv", () => {
    const original = [
      ["Nome", "Obs"],
      ["Silva; Maria", 'disse "oi"'],
    ];
    const { linhas } = parseCsv(gerarCsv(original));
    expect(linhas).toEqual(original);
  });
});
