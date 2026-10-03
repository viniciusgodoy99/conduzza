import { describe, expect, it } from "vitest";

import {
  alvoDoBotao,
  anuncioDaLista,
  aplicarResposta,
  atalhoDoTitulo,
  camposDesconhecidos,
  chaveDoGatilho,
  filtrarRespostas,
  gatilhoDaBarra,
  LIMITE_DO_TEXTO,
  limparAtalho,
  MAXIMO_NA_LISTA,
  mensagemPadraoSchema,
  novaOrdem,
  renderizarResposta,
  usaNome,
  type RespostaRapida,
} from "@/lib/domain/respostas-rapidas";

// Mensagens padrao ("/" no compositor, spec 1.11): o gatilho da barra pelo
// valor e pelo cursor, o filtro sem acento, a troca do trecho pelo texto
// renderizado e as regras do cadastro.

/** Cursor no fim do texto: o caso de quem esta digitando. */
const noFim = (texto: string) => gatilhoDaBarra(texto, texto.length);

describe("gatilhoDaBarra", () => {
  it("abre com a barra no inicio do texto", () => {
    expect(noFim("/")).toEqual({
      inicio: 0,
      fim: 1,
      termo: "",
      separador: "",
    });
    expect(noFim("/conf")).toEqual({
      inicio: 0,
      fim: 5,
      termo: "conf",
      separador: "",
    });
  });

  it("abre depois de espaco e depois de quebra de linha", () => {
    expect(noFim("Olá /end")).toMatchObject({ inicio: 4, termo: "end" });
    expect(noFim("Olá\n/end")).toMatchObject({ inicio: 4, termo: "end" });
    expect(noFim("Olá\t/")).toMatchObject({ inicio: 4, termo: "" });
  });

  it("nao abre em URL, data, e/ou nem barra dupla", () => {
    expect(noFim("https://x.com/a")).toBeNull();
    expect(noFim("veja https://x.com/")).toBeNull();
    expect(noFim("dia 12/10")).toBeNull();
    expect(noFim("12/")).toBeNull();
    expect(noFim("e/ou")).toBeNull();
    expect(noFim("//")).toBeNull();
    expect(noFim("texto //conf")).toBeNull();
  });

  it("fecha ao digitar espaco", () => {
    expect(noFim("/conf ")).toBeNull();
    expect(noFim("/ ")).toBeNull();
  });

  it("nao abre sem barra ou com a barra longe do cursor", () => {
    expect(noFim("")).toBeNull();
    expect(noFim("bom dia")).toBeNull();
    expect(noFim("/conf ok")).toBeNull();
  });

  it("cursor no meio de uma palavra nao abre (nao come o resto)", () => {
    // "/conf|irma": logo depois do cursor vem letra.
    expect(gatilhoDaBarra("/confirma", 5)).toBeNull();
    // "Olá /|mundo": barra digitada colada numa palavra que ja existia.
    expect(gatilhoDaBarra("Olá /mundo", 5)).toBeNull();
  });

  it("cursor no fim do trecho, com texto depois, abre", () => {
    const texto = "/end e depois";
    expect(gatilhoDaBarra(texto, 4)).toEqual({
      inicio: 0,
      fim: 4,
      termo: "end",
      separador: "",
    });
    expect(gatilhoDaBarra("Oi /end\nfim", 7)).toMatchObject({
      inicio: 3,
      fim: 7,
      termo: "end",
    });
  });

  it("cursor fora do texto nao abre", () => {
    expect(gatilhoDaBarra("/a", 0)).toBeNull();
    expect(gatilhoDaBarra("/a", 9)).toBeNull();
  });

  it("termo maior que qualquer titulo fecha a lista", () => {
    expect(noFim(`/${"a".repeat(60)}`)).not.toBeNull();
    expect(noFim(`/${"a".repeat(61)}`)).toBeNull();
  });

  it("a chave muda quando o termo muda (o Esc vale ate o termo mudar)", () => {
    const a = noFim("/con")!;
    const b = noFim("/conf")!;
    expect(chaveDoGatilho(a)).not.toBe(chaveDoGatilho(b));
    expect(chaveDoGatilho(a)).toBe(chaveDoGatilho(noFim("/con")!));
  });
});

function resposta(
  campos: Partial<RespostaRapida> & Pick<RespostaRapida, "atalho" | "titulo">,
): RespostaRapida {
  return {
    id: `id-${campos.atalho}`,
    corpo: `Texto de ${campos.titulo}`,
    ativo: true,
    posicao: 10,
    ...campos,
  };
}

describe("filtrarRespostas", () => {
  const lista = [
    resposta({
      atalho: "endereco",
      titulo: "Endereço da clínica",
      posicao: 30,
    }),
    resposta({ atalho: "conf", titulo: "Confirmação de horário", posicao: 10 }),
    resposta({ atalho: "preco", titulo: "Preço da consulta", posicao: 20 }),
    resposta({
      atalho: "boas_vindas",
      titulo: "Boas-vindas e confirmação",
      posicao: 40,
    }),
    resposta({
      atalho: "antigo",
      titulo: "Confirmação antiga",
      posicao: 5,
      ativo: false,
    }),
  ];

  it("sem termo: as ativas na ordem da clinica", () => {
    expect(filtrarRespostas(lista, "").map((item) => item.atalho)).toEqual([
      "conf",
      "preco",
      "endereco",
      "boas_vindas",
    ]);
  });

  it("ignora acento e caixa", () => {
    expect(
      filtrarRespostas(lista, "ENDERE").map((item) => item.atalho),
    ).toEqual(["endereco"]);
    expect(filtrarRespostas(lista, "preço").map((item) => item.atalho)).toEqual(
      ["preco"],
    );
  });

  it("atalho que comeca, depois titulo que comeca, depois titulo que contem", () => {
    const lista2 = [
      resposta({ atalho: "x1", titulo: "Reconfirmar presença", posicao: 10 }),
      resposta({ atalho: "x2", titulo: "Confirmar consulta", posicao: 20 }),
      resposta({ atalho: "conf", titulo: "Horário marcado", posicao: 30 }),
    ];
    expect(filtrarRespostas(lista2, "conf").map((item) => item.atalho)).toEqual(
      ["conf", "x2", "x1"],
    );
  });

  it("esconde as desativadas", () => {
    expect(filtrarRespostas(lista, "antig").map((item) => item.atalho)).toEqual(
      [],
    );
    expect(
      filtrarRespostas(lista, "confirma").map((item) => item.atalho),
    ).toEqual(["conf", "boas_vindas"]);
  });

  it("no maximo 8 no gatilho da barra; o botao pode pedir todas", () => {
    const muitas = Array.from({ length: 12 }, (_, indice) =>
      resposta({
        atalho: `m${indice}`,
        titulo: `Mensagem ${indice}`,
        posicao: indice,
      }),
    );
    expect(MAXIMO_NA_LISTA).toBe(8);
    expect(filtrarRespostas(muitas, "")).toHaveLength(8);
    expect(filtrarRespostas(muitas, "m")).toHaveLength(8);
    expect(filtrarRespostas(muitas, "", Number.POSITIVE_INFINITY)).toHaveLength(
      12,
    );
  });

  it("termo sem nada parecido devolve vazio", () => {
    expect(filtrarRespostas(lista, "zzz")).toEqual([]);
  });
});

describe("renderizarResposta", () => {
  it("troca o nome do contato e o da clinica", () => {
    expect(
      renderizarResposta("Olá, {{nome}}! Aqui é da {{clinica}}.", {
        nome: "Ana Souza",
        clinica: "Clínica Sorriso",
      }),
    ).toBe("Olá, Ana Souza! Aqui é da Clínica Sorriso.");
  });

  it("contato sem nome leva junto o vocativo, como na regua", () => {
    for (const vazio of [null, undefined, "", "  "]) {
      expect(
        renderizarResposta("Olá, {{nome}}! Tudo bem?", {
          nome: vazio,
          clinica: "Clínica Sorriso",
        }),
      ).toBe("Olá! Tudo bem?");
      expect(
        renderizarResposta("{{nome}}, seu horário está confirmado.", {
          nome: vazio,
          clinica: "X",
        }),
      ).toBe("Seu horário está confirmado.");
    }
  });

  it("campo que a mensagem padrao nao conhece sai em branco, sem chaves", () => {
    const texto = renderizarResposta("Dia {{data}} com {{nome}}.", {
      nome: "Ana",
      clinica: "X",
    });
    expect(texto).not.toContain("{{");
    expect(texto).toContain("Ana");
  });
});

describe("aplicarResposta", () => {
  it("troca o /termo pelo texto e poe o cursor no fim da mensagem", () => {
    const texto = "/conf";
    const alvo = gatilhoDaBarra(texto, texto.length)!;
    expect(aplicarResposta(texto, alvo, "Confirmado, Ana.")).toEqual({
      texto: "Confirmado, Ana.",
      cursor: 16,
    });
  });

  it("preserva o que vem antes e depois", () => {
    const texto = "Bom dia!\n/end\nAté logo.";
    const cursor = "Bom dia!\n/end".length;
    const alvo = gatilhoDaBarra(texto, cursor)!;
    const resultado = aplicarResposta(texto, alvo, "Rua A, 10.")!;
    expect(resultado.texto).toBe("Bom dia!\nRua A, 10.\nAté logo.");
    expect(resultado.texto.slice(0, resultado.cursor)).toBe(
      "Bom dia!\nRua A, 10.",
    );
  });

  it("recusa (null) quando passaria do teto de 4096, sem cortar", () => {
    const longo = "a".repeat(LIMITE_DO_TEXTO - 3);
    const texto = `${longo} /x`;
    const alvo = gatilhoDaBarra(texto, texto.length)!;
    expect(aplicarResposta(texto, alvo, "abc")).toBeNull();
    expect(aplicarResposta(texto, alvo, "ab")).not.toBeNull();
  });
});

describe("alvoDoBotao", () => {
  it("sem cursor conhecido, entra no fim", () => {
    expect(alvoDoBotao("Olá", null, null)).toEqual({
      inicio: 3,
      fim: 3,
      termo: "",
      separador: " ",
    });
    expect(alvoDoBotao("", null, null)).toEqual({
      inicio: 0,
      fim: 0,
      termo: "",
      separador: "",
    });
  });

  it("colada numa palavra ganha um espaco; depois de espaco, nao", () => {
    expect(alvoDoBotao("Olá ", 4, 4).separador).toBe("");
    expect(alvoDoBotao("Olá\n", 4, 4).separador).toBe("");
    const alvo = alvoDoBotao("Olá", 3, 3);
    expect(aplicarResposta("Olá", alvo, "Tudo bem?")).toEqual({
      texto: "Olá Tudo bem?",
      cursor: 13,
    });
  });

  it("substitui a selecao", () => {
    const alvo = alvoDoBotao("Oi XXX fim", 3, 6);
    expect(aplicarResposta("Oi XXX fim", alvo, "Ana")?.texto).toBe(
      "Oi Ana fim",
    );
  });

  it("selecao fora do texto fica dentro dos limites", () => {
    expect(alvoDoBotao("abc", 10, 20)).toMatchObject({ inicio: 3, fim: 3 });
  });
});

describe("cadastro", () => {
  const valida = {
    id: null,
    atalho: "endereco",
    titulo: "Endereço",
    corpo: "Rua A, 10.",
    ativo: true,
  };

  it("aceita a mensagem valida e tira os espacos das pontas", () => {
    const resultado = mensagemPadraoSchema.safeParse({
      ...valida,
      titulo: "  Endereço  ",
      corpo: "\n Rua A, 10. \n",
    });
    expect(resultado.success).toBe(true);
    expect(resultado.data?.titulo).toBe("Endereço");
    expect(resultado.data?.corpo).toBe("Rua A, 10.");
  });

  it("recusa atalho fora do alfabeto do banco", () => {
    for (const atalho of [
      "",
      "Maiuscula",
      "com espaco",
      "acentuação",
      "a".repeat(31),
      "a-b",
    ]) {
      expect(
        mensagemPadraoSchema.safeParse({ ...valida, atalho }).success,
      ).toBe(false);
    }
  });

  it("titulo de 2 a 60 e texto de 1 a 4096, nao so de espacos", () => {
    expect(
      mensagemPadraoSchema.safeParse({ ...valida, titulo: "A" }).success,
    ).toBe(false);
    expect(
      mensagemPadraoSchema.safeParse({ ...valida, titulo: "a".repeat(61) })
        .success,
    ).toBe(false);
    expect(
      mensagemPadraoSchema.safeParse({ ...valida, corpo: "   " }).success,
    ).toBe(false);
    expect(
      mensagemPadraoSchema.safeParse({
        ...valida,
        corpo: "a".repeat(LIMITE_DO_TEXTO + 1),
      }).success,
    ).toBe(false);
    expect(
      mensagemPadraoSchema.safeParse({
        ...valida,
        corpo: "a".repeat(LIMITE_DO_TEXTO),
      }).success,
    ).toBe(true);
  });

  it("id, quando vem, e uuid", () => {
    expect(
      mensagemPadraoSchema.safeParse({ ...valida, id: "nao-e-uuid" }).success,
    ).toBe(false);
    expect(
      mensagemPadraoSchema.safeParse({
        ...valida,
        id: "3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b",
      }).success,
    ).toBe(true);
  });

  it("atalho sugerido pelo titulo e limpeza do que se digita", () => {
    expect(atalhoDoTitulo("Confirmação de horário")).toBe(
      "confirmacao_de_horario",
    );
    expect(atalhoDoTitulo("  Preço!! ")).toBe("preco");
    expect(atalhoDoTitulo("???")).toBe("");
    expect(atalhoDoTitulo("a".repeat(40))).toHaveLength(30);
    expect(limparAtalho("Boas Vindas")).toBe("boas_vindas");
    expect(limparAtalho("boas_")).toBe("boas_");
    expect(limparAtalho("pré-consulta")).toBe("pre_consulta");
    expect(limparAtalho("a/b.c")).toBe("abc");
  });

  it("campos desconhecidos e uso do nome", () => {
    expect(camposDesconhecidos("Oi {{nome}}, da {{ clinica }}.")).toEqual([]);
    expect(camposDesconhecidos("Dia {{data}} às {{hora}} {{data}}")).toEqual([
      "data",
      "hora",
    ]);
    expect(usaNome("Olá, {{ nome }}!")).toBe(true);
    expect(usaNome("Olá!")).toBe(false);
  });
});

describe("novaOrdem", () => {
  const lista = [
    { id: "a", posicao: 10, titulo: "A" },
    { id: "b", posicao: 20, titulo: "B" },
    { id: "c", posicao: 30, titulo: "C" },
  ];

  it("subir troca com a de cima e devolve so o que muda", () => {
    expect(novaOrdem(lista, "b", "subir")).toEqual([
      { id: "b", posicao: 10 },
      { id: "a", posicao: 20 },
    ]);
  });

  it("descer troca com a de baixo", () => {
    expect(novaOrdem(lista, "b", "descer")).toEqual([
      { id: "c", posicao: 20 },
      { id: "b", posicao: 30 },
    ]);
  });

  it("na ponta ou inexistente: null", () => {
    expect(novaOrdem(lista, "a", "subir")).toBeNull();
    expect(novaOrdem(lista, "c", "descer")).toBeNull();
    expect(novaOrdem(lista, "z", "subir")).toBeNull();
  });

  it("empate antigo de posicao: desempata pelo titulo e renumera", () => {
    const empatada = [
      { id: "b", posicao: 0, titulo: "Beta" },
      { id: "a", posicao: 0, titulo: "Alfa" },
    ];
    expect(novaOrdem(empatada, "b", "subir")).toEqual([
      { id: "b", posicao: 10 },
      { id: "a", posicao: 20 },
    ]);
  });
});

describe("anuncioDaLista", () => {
  it("diz o estado e a quantidade", () => {
    expect(anuncioDaLista("carregando", 0, 0)).toBe(
      "Carregando as mensagens padrão.",
    );
    expect(anuncioDaLista("erro", 0, 0)).toBe(
      "Não foi possível carregar as mensagens padrão.",
    );
    expect(anuncioDaLista("pronto", 0, 0)).toBe(
      "Nenhuma mensagem padrão cadastrada.",
    );
    expect(anuncioDaLista("pronto", 0, 3)).toBe(
      "Nenhuma mensagem com esse atalho.",
    );
    expect(anuncioDaLista("pronto", 1, 3)).toBe(
      "1 mensagem. Use as setas e Enter.",
    );
    expect(anuncioDaLista("pronto", 3, 3)).toBe(
      "3 mensagens. Use as setas e Enter.",
    );
  });
});
