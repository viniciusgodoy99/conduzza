import { describe, expect, it } from "vitest";

import {
  CABECALHO_DOS_REMEDIOS,
  comporTextoDoPreparo,
  ehMensagemDoPreparo,
  mensagemDoPreparo,
  nomesDeRemedioDoTexto,
  partesDaMensagemDoPreparo,
  podeSerAMensagemDoPreparo,
  separarIntroducaoDoPreparo,
  separarRemediosDoTexto,
  textoDoPreparoValido,
} from "@/lib/domain/preparo";

// Os remedios do preparo e a introducao da IA (decisao do dono de 06/11/2026,
// opcao A). Os remedios sao parte do texto da versao: sem coluna, o caminho de
// ida e o de volta tem de escrever o mesmo texto, byte a byte, porque o hash e a
// aprovacao do RT sao dele. PURO: sem banco e sem modelo.

const BISACODIL = {
  nome: "Bisacodil 5 mg",
  comoTomar: "tomar 2 comprimidos às 20h da véspera do exame.",
  descricao: "",
};
const MANITOL = {
  nome: "Manitol",
  comoTomar: "diluir em 1 litro de suco e beber até as 18h.",
  descricao: "Usado para limpar o intestino.",
};
const RT = { nome: "Dra. Ana", conselho: "CRM", uf: "CE", numero: "1234" };

describe("o texto da versao com os remedios", () => {
  it("o exemplo do dono: o texto exato, palavra por palavra", () => {
    expect(comporTextoDoPreparo("", [BISACODIL])).toBe(
      "Remédios do preparo:\n\nBisacodil 5 mg: tomar 2 comprimidos às 20h da véspera do exame.",
    );
  });

  it("a orientacao, o bloco, a descricao na linha de baixo e a ordem de quem digitou", () => {
    expect(
      comporTextoDoPreparo("Jejum de 8 horas.", [BISACODIL, MANITOL]),
    ).toBe(
      "Jejum de 8 horas.\n\nRemédios do preparo:\n\nBisacodil 5 mg: tomar 2 comprimidos às 20h da véspera do exame.\n\nManitol: diluir em 1 litro de suco e beber até as 18h.\nUsado para limpar o intestino.",
    );
  });

  it("sem remedio, o texto fica como veio (o texto de sempre nao muda de hash)", () => {
    expect(comporTextoDoPreparo("  Jejum.\r\n", [])).toBe("  Jejum.\r\n");
    expect(
      comporTextoDoPreparo("Jejum.", [
        { nome: " ", comoTomar: "", descricao: "\t" },
      ]),
    ).toBe("Jejum.");
  });

  it("os brancos e as quebras coladas nos campos viram um espaco (cada campo e uma linha)", () => {
    expect(
      comporTextoDoPreparo("", [
        {
          nome: " Bisacodil\n5  mg ",
          comoTomar: "tomar\r\n2 comprimidos ",
          descricao: " Laxante\tforte ",
        },
      ]),
    ).toBe(
      "Remédios do preparo:\n\nBisacodil 5 mg: tomar 2 comprimidos\nLaxante forte",
    );
  });

  it("o texto composto cabe na regra do texto do banco", () => {
    expect(
      textoDoPreparoValido(
        comporTextoDoPreparo("Jejum de 8 horas.", [BISACODIL, MANITOL]),
      ),
    ).toBe(true);
  });
});

describe("o caminho de volta", () => {
  it("ida e volta dao o mesmo texto e os mesmos campos", () => {
    for (const [orientacao, remedios] of [
      ["", [BISACODIL]],
      ["Jejum de 8 horas.", [BISACODIL, MANITOL]],
      ["Primeira linha.\n\nSegunda parte.", [MANITOL]],
    ] as const) {
      const texto = comporTextoDoPreparo(orientacao, remedios);
      const lido = separarRemediosDoTexto(texto);
      expect(lido).toEqual({ orientacao, remedios });
      expect(comporTextoDoPreparo(lido.orientacao, lido.remedios)).toBe(texto);
    }
  });

  it("o texto sem o bloco fica inteiro na orientacao", () => {
    expect(separarRemediosDoTexto("Jejum de 8 horas.")).toEqual({
      orientacao: "Jejum de 8 horas.",
      remedios: [],
    });
    expect(separarRemediosDoTexto("")).toEqual({
      orientacao: "",
      remedios: [],
    });
  });

  it.each([
    ["sem os dois pontos e o espaco", "Bisacodil tomar 2"],
    ["o nome vazio", ": tomar 2"],
    ["tres linhas num remedio", "Bisacodil: tomar 2\nLinha.\nOutra."],
    ["o espaco sobrando no fim do nome", "Bisacodil : tomar 2"],
    ["o espaco sobrando no fim da linha", "Bisacodil: tomar 2 "],
  ])(
    "o bloco que nao seria escrito igual (%s) fica inteiro, nada se perde",
    (_n, bloco) => {
      const texto = `Jejum.\n\n${CABECALHO_DOS_REMEDIOS}\n\n${bloco}`;
      expect(separarRemediosDoTexto(texto)).toEqual({
        orientacao: texto,
        remedios: [],
      });
    },
  );

  it("o cabecalho repetido no texto livre: vale o ultimo, e a volta confere", () => {
    const texto = `${CABECALHO_DOS_REMEDIOS}\n\nA: b\n\nJejum.\n\n${CABECALHO_DOS_REMEDIOS}\n\nC: d`;
    const lido = separarRemediosDoTexto(texto);
    expect(lido.remedios).toEqual([
      { nome: "C", comoTomar: "d", descricao: "" },
    ]);
    expect(comporTextoDoPreparo(lido.orientacao, lido.remedios)).toBe(texto);
  });
});

describe("os nomes de remedio de um texto", () => {
  it("as palavras do nome do bloco, na visao base; a sigla curta e o numero ficam de fora", () => {
    expect(
      nomesDeRemedioDoTexto(
        comporTextoDoPreparo("", [
          { ...BISACODIL, nome: "Picossulfato Sódico 5 mg" },
        ]),
      ),
    ).toEqual(expect.arrayContaining(["picossulfato", "sodico"]));
    expect(
      nomesDeRemedioDoTexto(comporTextoDoPreparo("", [BISACODIL])),
    ).not.toContain("5");
  });

  it("a palavra colada numa dose no texto livre (o texto escrito a mao, o antigo)", () => {
    expect(
      nomesDeRemedioDoTexto("Tome Xyzina 10 mg de manhã e Fortex 2 gotas."),
    ).toEqual(expect.arrayContaining(["xyzina", "fortex"]));
    expect(nomesDeRemedioDoTexto("Jejum de 8 horas.")).toEqual([]);
  });
});

describe("a introducao antes do bloco", () => {
  const BLOCO = mensagemDoPreparo({
    procedimento: "Colonoscopia",
    rt: RT,
    texto: comporTextoDoPreparo("Jejum.", [BISACODIL]),
  });
  const INTRO =
    "Claro! Como sua colonoscopia é na terça de manhã, segue a orientação da clínica:";
  const CORPO = `${INTRO}\n\n${BLOCO}`;

  it("separa a introducao do bloco, e o bloco sozinho nao tem introducao", () => {
    expect(separarIntroducaoDoPreparo(BLOCO)).toEqual({
      introducao: null,
      bloco: BLOCO,
    });
    expect(separarIntroducaoDoPreparo(CORPO)).toEqual({
      introducao: INTRO,
      bloco: BLOCO,
    });
  });

  it.each([
    ["sem a linha em branco", `${INTRO}\n${BLOCO}`],
    ["duas linhas", `Oi.\nClaro!\n\n${BLOCO}`],
    ["duas introducoes", `${INTRO}\n\n${INTRO}\n\n${BLOCO}`],
    ["longa demais", `${"a".repeat(161)}\n\n${BLOCO}`],
    ["vazia", `\n\n${BLOCO}`],
    ["so a introducao", INTRO],
    ["o bloco sem o rodape", `${INTRO}\n\n${BLOCO.slice(0, -5)}`],
    ["invisivel", `Claro​!\n\n${BLOCO}`],
  ])("%s: nao e a mensagem do preparo", (_n, corpo) => {
    expect(separarIntroducaoDoPreparo(corpo)).toBeNull();
  });

  it("o limite: 160 sim", () => {
    expect(
      separarIntroducaoDoPreparo(`${"a".repeat(160)}\n\n${BLOCO}`)?.introducao,
    ).toBe("a".repeat(160));
  });

  it("partesDaMensagemDoPreparo continua lendo so o bloco (o envio confere o que o banco montou)", () => {
    expect(partesDaMensagemDoPreparo(BLOCO)?.procedimento).toBe("Colonoscopia");
    expect(partesDaMensagemDoPreparo(CORPO)).toBeNull();
  });

  it("o Atendimento reconhece a mensagem com a introducao, so com a decisao do job", () => {
    const m = {
      author: "sistema",
      body: CORPO,
      is_internal_note: false,
      author_user_id: null,
      direction: "saida",
      content_type: "texto",
      media_url: null,
      job_id: "job-1",
    };
    expect(podeSerAMensagemDoPreparo(m)).toBe(true);
    expect(ehMensagemDoPreparo(m, new Set(["job-1"]))).toBe(true);
    expect(ehMensagemDoPreparo(m, new Set(["job-2"]))).toBe(false);
    expect(
      podeSerAMensagemDoPreparo({ ...m, body: `${INTRO}\n${BLOCO}` }),
    ).toBe(false);
  });
});
