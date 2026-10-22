import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { chaveDaEtiqueta } from "@/lib/domain/etiquetas-do-lead";

// Paridade da chave da etiqueta (onda 4, contrato 2.1): o filtro por
// etiqueta casa pela chave, que o banco calcula em chave_de_etiqueta (o
// MESMO corpo de chave_de_especialidade: translate dos acentos, lower,
// espacos colapsados e btrim) e o codigo calcula em chaveDaEtiqueta (NFD sem
// marcas, minusculas pt-BR, espacos colapsados e trim). As duas regras sao
// diferentes por dentro; em pt-BR dao o mesmo resultado. Este teste prova
// isso com uma tabela FIXA (a saida que o SQL da, conferida a mao) e com uma
// copia do corpo do SQL lida da propria migration, para a tabela nunca se
// desencontrar do banco. Fora do portugues (oe, ss alemao) as duas podem
// divergir: o risco 8 do contrato, aceito.

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/** O translate do corpo SQL: os acentos e as letras sem acento, na ordem. */
function translateDoSql(): { de: string; para: string } {
  const arquivos = readdirSync(MIGRATIONS).sort();
  // A funcao da onda 4 (chave_de_etiqueta) quando a migration existir; o
  // corpo e o de chave_de_especialidade, que a de 29/09/2026 define.
  const candidatos = [
    ...arquivos.filter((nome) => nome.startsWith("20261024100000")),
    "20260929110000_regua_vinculada.sql",
  ];
  for (const arquivo of candidatos) {
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS, arquivo), "utf8");
    } catch {
      continue;
    }
    const funcao = arquivo.startsWith("20261024100000")
      ? "chave_de_etiqueta"
      : "chave_de_especialidade";
    const inicio = sql.indexOf(`function public.${funcao}(`);
    if (inicio < 0) {
      continue;
    }
    const corpo = sql.slice(inicio, inicio + 1500);
    const achado = /translate\(\s*p_texto,\s*'([^']+)',\s*'([^']+)'\s*\)/.exec(
      corpo,
    );
    if (achado?.[1] && achado[2]) {
      return { de: achado[1], para: achado[2] };
    }
  }
  throw new Error("translate da chave nao encontrado nas migrations");
}

/**
 * O corpo SQL em TypeScript: btrim(regexp_replace(lower(translate(t)),
 * '\s+', ' ', 'g')). O btrim do Postgres tira so espaco.
 */
function chaveComoNoSql(texto: string): string {
  const { de, para } = translateDoSql();
  const trocado = [...texto]
    .map((letra) => {
      const indice = [...de].indexOf(letra);
      return indice >= 0 ? [...para][indice]! : letra;
    })
    .join("");
  return trocado
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^ +| +$/g, "");
}

// A saida que o SQL da para cada entrada (conferida a mao contra o corpo).
const TABELA: readonly [string, string][] = [
  ["Psiquiatria", "psiquiatria"],
  ["PSIQUIATRIA", "psiquiatria"],
  ["Avaliação", "avaliacao"],
  ["  avaliação   inicial ", "avaliacao inicial"],
  ["Ortodontia\tInfantil", "ortodontia infantil"],
  ["Ação", "acao"],
  ["Coração", "coracao"],
  ["Ç", "c"],
  ["Doña", "dona"],
  ["ÁÀÂÃÄ áàâãä", "aaaaa aaaaa"],
  ["ÉÈÊË éèêë", "eeee eeee"],
  ["ÍÌÎÏ íìîï", "iiii iiii"],
  ["ÓÒÔÕÖ óòôõö", "ooooo ooooo"],
  ["ÚÙÛÜ úùûü", "uuuu uuuu"],
  ["Ñ ñ", "n n"],
  ["Pós-operatório", "pos-operatorio"],
  ["Retorno (30 dias)", "retorno (30 dias)"],
  ["LEAD", "lead"],
];

describe("chaveDaEtiqueta x chave_de_etiqueta do banco (pt-BR)", () => {
  it.each(TABELA)("%j vira %j nos dois", (entrada, esperada) => {
    expect(chaveDaEtiqueta(entrada)).toBe(esperada);
    expect(chaveComoNoSql(entrada)).toBe(esperada);
  });

  it("o translate do banco cobre as letras acentuadas do português", () => {
    const { de, para } = translateDoSql();
    expect([...de]).toHaveLength([...para].length);
    for (const letra of "áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ") {
      expect(de).toContain(letra);
    }
  });
});
