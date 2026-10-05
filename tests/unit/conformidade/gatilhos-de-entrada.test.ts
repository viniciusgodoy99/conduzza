import { describe, expect, it } from "vitest";

import { GATILHOS_DO_CLASSIFICADOR } from "@/lib/domain/conformidade/categorias";
import {
  detectarGatilhosDeEntrada,
  idadeEmAnos,
  LIMITE_DE_MENSAGEM,
  MAXIMO_DE_MENSAGENS_NO_CONTEXTO,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  CASOS_DE_ENTRADA,
  CONTROLES_DE_ENTRADA,
} from "@/tests/fixtures/ia/conformidade/casos";

// O portao de entrada escala ANTES do agente. Cada caso da bateria que nao
// e "so do modelo" tem de disparar o gatilho esperado, e mensagem normal de
// recepcao nao pode disparar nada.

const deterministicos = CASOS_DE_ENTRADA.filter((caso) => !caso.soModelo);
const soModelo = CASOS_DE_ENTRADA.filter((caso) => caso.soModelo);

describe("bateria: mensagens que tem de escalar", () => {
  it("tem pelo menos 15 casos e ids unicos", () => {
    expect(deterministicos.length).toBeGreaterThanOrEqual(15);
    const ids = CASOS_DE_ENTRADA.map((caso) => caso.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(deterministicos.map((caso) => [caso.id, caso] as const))(
    "%s dispara o gatilho esperado",
    (_id, caso) => {
      const gatilhos = detectarGatilhosDeEntrada({
        mensagens: caso.mensagens,
        dataDeNascimento: caso.dataDeNascimento,
        hojeNaClinica: caso.hojeNaClinica,
      });
      expect(gatilhos).toContain(caso.gatilho);
    },
  );
});

describe("casos que so o classificador pega (o portao deixa de proposito)", () => {
  it.each(soModelo.map((caso) => [caso.id, caso] as const))(
    "%s: o classificador sabe apontar o gatilho e o portao nao aponta",
    (_id, caso) => {
      expect(
        GATILHOS_DO_CLASSIFICADOR.find((g) => g === caso.gatilho),
      ).toBeDefined();
      expect(
        detectarGatilhosDeEntrada({ mensagens: caso.mensagens }),
      ).not.toContain(caso.gatilho);
    },
  );
});

describe("bateria: mensagens normais que nao escalam", () => {
  it.each(CONTROLES_DE_ENTRADA.map((caso) => [caso.id, caso] as const))(
    "%s passa pelo portao",
    (_id, caso) => {
      expect(detectarGatilhosDeEntrada({ mensagens: caso.mensagens })).toEqual(
        [],
      );
    },
  );
});

describe("regras do portao", () => {
  it("qualquer midia escala, mesmo audio com transcricao", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "audio", texto: "quero marcar uma consulta" }],
      }),
    ).toEqual(["midia"]);
  });

  it("mensagem no limite passa; acima escala", () => {
    const noLimite = "a".repeat(LIMITE_DE_MENSAGEM);
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: noLimite }],
      }),
    ).not.toContain("mensagem_longa");
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: `${noLimite}a` }],
      }),
    ).toContain("mensagem_longa");
  });

  it("mais de cinco mensagens sem resposta escala (os modelos so veem cinco)", () => {
    expect(MAXIMO_DE_MENSAGENS_NO_CONTEXTO).toBe(5);
    const mensagens = (n: number) =>
      Array.from({ length: n }, () => ({ tipo: "texto", texto: "oi" }));
    expect(detectarGatilhosDeEntrada({ mensagens: mensagens(5) })).toEqual([]);
    expect(detectarGatilhosDeEntrada({ mensagens: mensagens(6) })).toEqual([
      "mensagem_longa",
    ]);
  });

  it("gatilhos em ordem de prioridade (sintoma primeiro)", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "tem desconto? estou com febre" }],
      }),
    ).toEqual(["sintoma", "valor_fora_da_tabela"]);
  });

  it("idade por data de nascimento no fuso da clinica", () => {
    expect(idadeEmAnos("2008-10-06", "2026-10-05")).toBe(17);
    expect(idadeEmAnos("2008-10-05", "2026-10-05")).toBe(18);
    expect(idadeEmAnos("data", "2026-10-05")).toBeNull();
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "quero marcar" }],
        dataDeNascimento: "2008-10-05",
        hojeNaClinica: "2026-10-05",
      }),
    ).toEqual([]);
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "quero marcar" }],
        dataDeNascimento: "2008-10-06",
        hojeNaClinica: "2026-10-05",
      }),
    ).toEqual(["menor_de_idade"]);
  });

  it("sem o dia de hoje, a data de nascimento nao e usada (nunca chuta o fuso)", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "quero marcar" }],
        dataDeNascimento: "2015-01-01",
      }),
    ).toEqual([]);
  });

  it("idade declarada so conta com 'anos'", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("tenho 17 anos")).toEqual(["menor_de_idade"]);
    expect(de("tenho 18 anos")).toEqual([]);
    expect(de("fiz 3 sessões")).toEqual([]);
    expect(de("fiz uma limpeza semana passada")).toEqual([]);
  });

  it("caixa alta longa e exclamacoes escalam como insatisfacao", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("NINGUEM ME AVISOU DO HORARIO")).toContain("insatisfacao");
    expect(de("Que demora!!!")).toContain("insatisfacao");
    expect(de("OK")).toEqual([]);
  });

  it("texto com letra de outro alfabeto ou invisivel e tentativa de manipulacao", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("quero marcar \u0441onsulta")).toContain("manipulacao");
    expect(de("quero mar\u200bcar")).toContain("manipulacao");
  });

  it("letra fora de [a-z] e manipulacao; letras soltas nao (abreviacao de WhatsApp)", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("quero m\u0250rcar")).toContain("manipulacao");
    expect(de("q u e r o  m a r c a r")).toEqual([]);
    expect(de("o q e q eu preciso levar?")).toEqual([]);
    expect(de("p/ o q e a consulta?")).toEqual([]);
    expect(de("quero marcar às 9 e 30")).toEqual([]);
  });

  it("e-mail com sublinhado nao e identificador de codigo", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("meu email e joao_pedro_lima@gmail.com")).toEqual([]);
    expect(de("chama a tool_use_id agora")).toContain("manipulacao");
  });

  it("sinal de urgencia inequivoco escala; o mesmo verbo fora do corpo nao", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    for (const texto of [
      "minha boca ta formigando",
      "a palpebra caiu depois do botox",
      "to sem folego",
      "meu coracao ta disparado",
      "to vendo tudo embacado",
      "meu braco ficou fraco",
      "tô muito mal",
    ]) {
      expect(de(texto), texto).toContain("sintoma");
    }
    for (const texto of [
      "o alarme do carro disparou",
      "a foto ficou embacada, mando outra",
      "to meio sem tempo essa semana",
    ]) {
      expect(de(texto), texto).toEqual([]);
    }
  });

  it("palavra espacada com espaco duplo entre as palavras ainda e lida", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [
          { tipo: "texto", texto: "t o  c o m  d o r  n o  p e i t o" },
        ],
      }),
    ).toContain("sintoma");
  });
});
