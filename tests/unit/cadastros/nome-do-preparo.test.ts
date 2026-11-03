import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fraseDoNomeComInvisivel } from "@/components/cadastros/preparo-na-tela";
import {
  invisivelNoNome,
  LIMITE_DO_NOME_DO_PREPARO,
  nomeDoPreparoValido,
} from "@/lib/domain/preparo";

// Revisao curta da AG7 (CURTA-6): o banco recusa o nome do procedimento e o
// do RT com invisivel ou marca de direcao (preparo_nome_valido, migration
// 20261103100000), e o Cadastros e o formulario do RT nao conferiam: a
// pessoa lia "Confira o nome..." sem ver nada de errado. O espelho TS confere
// o mesmo, e a frase diz o que tirar e onde. Sem banco: a paridade e com as
// classes de caractere da funcao, lidas da migration.

const MIGRATION = readFileSync(
  path.resolve(
    __dirname,
    "../../../supabase/migrations/20261103100000_preparo_aprovado_pelo_rt.sql",
  ),
  "utf8",
);

/** O corpo de preparo_nome_valido na migration. */
function corpoDaFuncao(): string {
  const inicio = MIGRATION.indexOf(
    "create function public.preparo_nome_valido(p_nome text)",
  );
  expect(inicio).toBeGreaterThanOrEqual(0);
  const fim = MIGRATION.indexOf("$function$;", inicio);
  return MIGRATION.slice(inicio, fim);
}

/** Os pontos de codigo de uma classe "[...]" do Postgres (\xNN, \uNNNN, \UNNNNNNNN). */
function pontosDaClasse(classe: string): Set<number> {
  const unidade =
    /\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/y;
  const pontos: number[] = [];
  const marcas: ("-" | number)[] = [];
  let i = 0;
  while (i < classe.length) {
    if (classe[i] === "-") {
      marcas.push("-");
      i += 1;
      continue;
    }
    unidade.lastIndex = i;
    const achado = unidade.exec(classe);
    if (!achado) {
      throw new Error(`classe fora do formato: ${classe.slice(i, i + 12)}`);
    }
    marcas.push(parseInt(achado[1] ?? achado[2] ?? achado[3] ?? "", 16));
    i = unidade.lastIndex;
  }
  for (let j = 0; j < marcas.length; j += 1) {
    const atual = marcas[j];
    if (marcas[j + 1] === "-" && typeof atual === "number") {
      const fim = marcas[j + 2];
      if (typeof fim !== "number") {
        throw new Error("faixa sem fim");
      }
      for (let p = atual; p <= fim; p += 1) {
        pontos.push(p);
      }
      j += 2;
    } else if (typeof atual === "number") {
      pontos.push(atual);
    }
  }
  return new Set(pontos);
}

describe("revisao curta da AG7 (CURTA-6): o espelho de preparo_nome_valido", () => {
  const classes = [
    ...corpoDaFuncao().matchAll(/p_nome !~ '\[([^\]]+)\]'/g),
  ].map((m) => pontosDaClasse(m[1] ?? ""));
  const recusados = new Set(classes.flatMap((classe) => [...classe]));

  it("a migration tem as duas classes (o controle e os invisiveis)", () => {
    expect(classes).toHaveLength(2);
    expect(recusados.has(0x200e)).toBe(true);
    expect(recusados.has(0x0a)).toBe(true);
  });

  it("cada caractere que o banco recusa no meio do nome, o espelho recusa; e os vizinhos passam", () => {
    const vizinhos = new Set<number>();
    for (const ponto of recusados) {
      for (const perto of [ponto - 1, ponto + 1]) {
        if (perto > 0 && !recusados.has(perto)) {
          vizinhos.add(perto);
        }
      }
    }
    for (const ponto of recusados) {
      const nome = `Ana${String.fromCodePoint(ponto)}Souza`;
      expect(nomeDoPreparoValido(nome), ponto.toString(16)).toBe(false);
    }
    for (const ponto of vizinhos) {
      const caractere = String.fromCodePoint(ponto);
      // A surrogate solta nao e caractere de verdade.
      if (ponto >= 0xd800 && ponto <= 0xdfff) {
        continue;
      }
      expect(
        nomeDoPreparoValido(`Ana${caractere}Souza`),
        ponto.toString(16),
      ).toBe(true);
    }
  });

  it("o tamanho e as pontas, como cadastro_texto_valido", () => {
    expect(LIMITE_DO_NOME_DO_PREPARO).toBe(120);
    expect(nomeDoPreparoValido("Colonoscopia")).toBe(true);
    expect(nomeDoPreparoValido("a".repeat(120))).toBe(true);
    expect(nomeDoPreparoValido("a".repeat(121))).toBe(false);
    expect(nomeDoPreparoValido("")).toBe(false);
    expect(nomeDoPreparoValido(" Colonoscopia")).toBe(false);
    expect(nomeDoPreparoValido("Colonoscopia ")).toBe(false);
    // O dente (fora do plano basico) conta um.
    expect(nomeDoPreparoValido(`${"a".repeat(119)}\u{1f9b7}`)).toBe(true);
  });

  it("invisivelNoNome: o primeiro, pela posicao; o controle fica com a frase de sempre", () => {
    expect(invisivelNoNome("Colonoscopia")).toBeNull();
    expect(invisivelNoNome("Colono\u200escopia\u200f")).toEqual({
      posicao: 6,
    });
    expect(invisivelNoNome("Ana\nSouza")).toBeNull();
  });
});

describe("revisao curta da AG7 (CURTA-6): a frase diz o que tirar e onde", () => {
  it("o procedimento: o caractere logo depois das palavras, e o que fazer", () => {
    expect(
      fraseDoNomeComInvisivel(
        "Ultrassom de abdome total\u200e",
        "procedimento",
      ),
    ).toBe(
      "Tire o caractere invisível do nome do procedimento, logo depois de “Ultrassom de abdome total”: apague e escreva de novo esse pedaço do nome, salve o procedimento e envie o texto de novo.",
    );
    expect(fraseDoNomeComInvisivel("\u200bColonoscopia", "procedimento")).toBe(
      "Tire o caractere invisível do começo do nome do procedimento: apague e escreva de novo o começo do nome, salve o procedimento e envie o texto de novo.",
    );
  });

  it("o RT: a marca de direcao do nome colado do portal do conselho", () => {
    expect(fraseDoNomeComInvisivel("Dra. Ana Souza\u200f", "rt")).toBe(
      "Tire o caractere invisível do nome, logo depois de “Dra. Ana Souza”: apague e escreva de novo esse pedaço do nome.",
    );
  });

  it("o emoji com juncao: pelo proprio emoji", () => {
    const medica = "\u{1f469}\u200d\u2695\ufe0f";
    expect(fraseDoNomeComInvisivel(`Consulta ${medica}`, "procedimento")).toBe(
      `Tire o emoji ${medica} do nome do procedimento: ele leva um caractere invisível, que não pode ir na mensagem ao paciente. Apague o emoji, salve o procedimento e envie o texto de novo.`,
    );
  });

  it("sem invisivel, nenhuma frase; e nenhuma frase tem travessao", () => {
    expect(fraseDoNomeComInvisivel("Colonoscopia", "procedimento")).toBeNull();
    for (const nome of [
      "A\u200eB",
      "\u2066A",
      "A \u{1f469}\u200d\u2695\ufe0f",
    ]) {
      for (const de of ["procedimento", "rt"] as const) {
        expect(fraseDoNomeComInvisivel(nome, de)).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });
});
