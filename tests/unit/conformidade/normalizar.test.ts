import { describe, expect, it } from "vitest";

import {
  compactar,
  compactarComInicios,
  desfazerLeet,
  distanciaDeEdicao,
  emendarPalavras,
  juntarLetrasSoltas,
  juntarLetrasSoltasPreservando,
  mascararNomes,
  neutralizador,
  normalizarBase,
  ocorreNoInicioDePalavra,
  sinaisDeOfuscacao,
  temLetraForaDoAlfabeto,
  temLetrasSoltas,
  temSimboloEntreLetras,
  visoesDoTexto,
} from "@/lib/domain/conformidade/normalizar";

// A normalizacao e o que impede o truque barato: escrever a palavra proibida
// de um jeito que a regra nao reconhece. Cada teste e um truque.

describe("normalizarBase", () => {
  it("tira acento e baixa a caixa", () => {
    expect(normalizarBase("ORIENTAÇÃO Clínica")).toBe("orientacao clinica");
  });

  it("apaga caracteres invisiveis no meio da palavra", () => {
    expect(normalizarBase("dipi\u200brona")).toBe("dipirona");
    expect(normalizarBase("dipi\u00adrona")).toBe("dipirona");
    expect(normalizarBase("dipi\u2060rona")).toBe("dipirona");
    expect(normalizarBase("dipi\ufeffrona")).toBe("dipirona");
    expect(normalizarBase("dip\u200di\u200crona")).toBe("dipirona");
  });

  it("troca homoglifo cirilico e grego pela letra latina", () => {
    expect(normalizarBase("d\u0456pirona")).toBe("dipirona");
    expect(normalizarBase("g\u0430r\u0430nt\u0456do")).toBe("garantido");
    expect(normalizarBase("\u039f\u0396\u0395\u039cPIC")).toBe("ozempic");
    expect(normalizarBase("\u0397\u0399")).toBe("hi");
  });

  it("troca latim estendido com risco ou barra (fora do alfabeto estranho)", () => {
    expect(normalizarBase("D\u0268pirona")).toBe("dipirona");
    expect(normalizarBase("Para\u023cetamol")).toBe("paracetamol");
    expect(normalizarBase("Ibupr\u0275feno")).toBe("ibuprofeno");
    expect(normalizarBase("\u0256ipirona")).toBe("dipirona");
  });

  it("desfaz largura cheia, letra matematica e versalete", () => {
    expect(
      normalizarBase("\uff24\uff29\uff30\uff29\uff32\uff2f\uff2e\uff21"),
    ).toBe("dipirona");
    expect(
      normalizarBase(
        "\u{1d41d}\u{1d422}\u{1d429}\u{1d422}\u{1d42b}\u{1d428}\u{1d427}\u{1d41a}",
      ),
    ).toBe("dipirona");
    expect(
      normalizarBase("\u1d05\u026a\u1d18\u026a\u0280\u1d0f\u0274\u1d00"),
    ).toBe("dipirona");
  });

  it("tira riscos e acentos empilhados", () => {
    expect(
      normalizarBase(
        "d\u0336i\u0336p\u0336i\u0336r\u0336o\u0336n\u0336a\u0336",
      ),
    ).toBe("dipirona");
  });

  it("simplifica pontuacao tipografica e espacos", () => {
    expect(normalizarBase("pronto\u2014socorro   agora\u00a0ja")).toBe(
      "pronto-socorro agora ja",
    );
  });

  it("preserva numero e simbolo de dinheiro", () => {
    expect(normalizarBase("R$ 1.500,00 e 500 mg")).toBe("r$ 1.500,00 e 500 mg");
  });
});

describe("letras soltas, leet e compacto", () => {
  it("junta letras separadas por espaco ou ponto", () => {
    expect(juntarLetrasSoltas("pode tomar d i p i r o n a")).toBe(
      "pode tomar dipirona",
    );
    expect(juntarLetrasSoltas("d.i.p.i.r.o.n.a.")).toBe("dipirona.");
    expect(juntarLetrasSoltas("g a r a n t 1 d o")).toBe("garant1do");
  });

  it("nao junta palavras comuns curtas", () => {
    expect(juntarLetrasSoltas("as 9 e 30")).toBe("as 9 e 30");
    expect(juntarLetrasSoltas("e a consulta")).toBe("e a consulta");
  });

  it("desfaz numero no lugar de letra so dentro de palavra", () => {
    expect(desfazerLeet("t0 c0m f3br3")).toBe("to com febre");
    expect(desfazerLeet("garant1do")).toBe("garantido");
    expect(desfazerLeet("500 mg em 10 dias")).toBe("500 mg em 10 dias");
  });

  it("desfaz simbolo no lugar de letra so entre letras", () => {
    expect(desfazerLeet("d!p!rona")).toBe("dipirona");
    expect(desfazerLeet("d|p|rona")).toBe("dipirona");
    expect(desfazerLeet("dipir\u00b0na")).toBe("dipirona");
    expect(desfazerLeet("ola! tudo bem")).toBe("ola! tudo bem");
  });

  it("barra vertical na borda da palavra vira letra; ponto de exclamacao nao", () => {
    expect(desfazerLeet("|buprofeno")).toBe("ibuprofeno");
    expect(desfazerLeet("tramado| resolve")).toBe("tramadoi resolve");
    expect(desfazerLeet("seg | ter")).toBe("seg | ter");
    expect(desfazerLeet("combinado!")).toBe("combinado!");
  });

  it("visao que le 1 e | como l, so para o lexico de remedios", () => {
    expect(desfazerLeet("dorf1ex", true)).toBe("dorflex");
    expect(desfazerLeet("rivotri1 tramado|", true)).toBe("rivotril tramadol");
    expect(desfazerLeet("500 mg em 10 dias", true)).toBe("500 mg em 10 dias");
    const visoes = visoesDoTexto("Tramado1 resolve.");
    expect(visoes.leet).toBe("tramadoi resolve.");
    expect(visoes.leetComL).toBe("tramadol resolve.");
    expect(visoes.compactoComL).toBe("tramadolresolve");
  });

  it("preservado: nao engole a palavra de uma letra vizinha", () => {
    expect(juntarLetrasSoltasPreservando("e n o r m a l.")).toBe("e normal.");
    expect(juntarLetrasSoltasPreservando("procure o h o s p i t a l")).toBe(
      "procure o hospital",
    );
    expect(juntarLetrasSoltasPreservando("va a u p a")).toBe("va a upa");
    expect(juntarLetrasSoltasPreservando("d i p i r o n a")).toBe("dipirona");
  });

  it("preservado: espaco duplo separa palavras", () => {
    expect(
      juntarLetrasSoltasPreservando("t o  c o m  d o r  n o  p e i t o"),
    ).toBe("t o  com  dor  n o  peito");
    expect(visoesDoTexto("t o  c o m  d o r").preservado).toBe("t o com dor");
  });

  it("emendado: tira hifen e quebra de linha do meio da palavra", () => {
    expect(emendarPalavras("nor-mal")).toBe("normal");
    expect(emendarPalavras("gra\nve")).toBe("grave");
    expect(emendarPalavras("trama-\ndol")).toBe("tramadol");
    expect(emendarPalavras("dra. ana - dermatologia")).toBe(
      "dra. ana - dermatologia",
    );
    expect(visoesDoTexto("Isso é nor-mal.").emendado).toBe("isso e normal.");
    expect(visoesDoTexto("Não é gra\nve.").emendado).toBe("nao e grave.");
  });

  it("emendado: hifen com espaco de um lado so e varias quebras de linha", () => {
    expect(emendarPalavras("nor- mal")).toBe("normal");
    expect(emendarPalavras("nor -mal")).toBe("normal");
    expect(emendarPalavras("gra-\n\nve")).toBe("grave");
    expect(emendarPalavras("hos- \r\n \r\npital")).toBe("hospital");
    expect(emendarPalavras("gra\n\nve")).toBe("grave");
    // Hifen com espaco dos DOIS lados e separador, nao emenda.
    expect(emendarPalavras("ana - dermatologia")).toBe("ana - dermatologia");
  });

  it("compacto com o inicio de cada palavra", () => {
    const c = compactarComInicios("pouco de informacao; um especialista");
    expect(c.compacto).toBe("poucodeinformacaoumespecialista");
    expect(ocorreNoInicioDePalavra(c, "codein")).toBe(false);
    expect(ocorreNoInicioDePalavra(c, "cialis")).toBe(false);
    expect(ocorreNoInicioDePalavra(c, "especial")).toBe(true);
    expect(
      ocorreNoInicioDePalavra(compactarComInicios("trama dol"), "tramadol"),
    ).toBe(true);
    // Letra repetida que abria palavra: quem fica abre no lugar dela.
    expect(
      ocorreNoInicioDePalavra(compactarComInicios("mar rico"), "rico"),
    ).toBe(true);
    expect(compactar("di-pi-ro-na")).toBe(
      compactarComInicios("di-pi-ro-na").compacto,
    );
  });

  it("compacta sem espaco, sem pontuacao e sem letra repetida", () => {
    expect(compactar("di-pi-ro-na")).toBe("dipirona");
    expect(compactar("diiipiiiroooona")).toBe("dipirona");
    expect(compactar("dipi rona")).toBe("dipirona");
  });

  it("monta todas as visoes de uma vez", () => {
    const visoes = visoesDoTexto("Pode tomar D 1 P 1 R 0 N 4");
    expect(visoes.leet).toContain("dipirona");
    expect(visoes.compacto).toContain("dipirona");
  });
});

describe("mascarar nomes do catalogo", () => {
  it("troca o nome exato por um marcador neutro", () => {
    const base = normalizarBase("O Tratamento da dor lombar custa R$ 300,00");
    expect(mascararNomes(base, ["Tratamento da dor lombar"])).toBe(
      "o \u00a7 custa r$ 300,00",
    );
  });

  it("nao mascara pedaco do nome nem parafrase", () => {
    const base = normalizarBase("tratamento para dor nas costas");
    expect(mascararNomes(base, ["Tratamento da dor lombar"])).toBe(base);
  });

  it("ignora nome curto demais", () => {
    expect(mascararNomes("a b", ["a"])).toBe("a b");
  });
});

describe("neutralizador de expressao permitida", () => {
  const trocar = neutralizador([
    { nome: "teste", fonte: "\\bgarantir(?= sua vaga\\b)", troca: "reservar" },
  ]);

  it("troca so o trecho que casa, quantas vezes aparecer", () => {
    expect(trocar("garantir sua vaga e garantir sua vaga")).toBe(
      "reservar sua vaga e reservar sua vaga",
    );
    expect(trocar("garantir o resultado")).toBe("garantir o resultado");
  });

  it("nao guarda estado entre chamadas (regex com g so dentro do replace)", () => {
    expect(trocar("garantir sua vaga")).toBe("reservar sua vaga");
    expect(trocar("garantir sua vaga")).toBe("reservar sua vaga");
  });

  it("vale em todas as visoes de frase, ja normalizadas", () => {
    const visoes = visoesDoTexto("Pra GARANTIR sua vaga", [], trocar);
    for (const visao of [
      visoes.base,
      visoes.despacado,
      visoes.leet,
      visoes.emendado,
      visoes.preservado,
    ]) {
      expect(visao).toBe("pra reservar sua vaga");
    }
    expect(visoes.compacto).not.toContain("garant");
  });
});

describe("sinais estruturais", () => {
  it("letra fora de [a-z] depois da normalizacao", () => {
    expect(temLetraForaDoAlfabeto(normalizarBase("hor\u0250rio"))).toBe(true);
    expect(temLetraForaDoAlfabeto(normalizarBase("Horário às 10h, Zoë"))).toBe(
      false,
    );
  });

  it("frase colada depois de ! ou ? nao e simbolo entre letras", () => {
    expect(normalizarBase("Oi, Maria!Tudo bem?")).toBe("oi, maria! tudo bem?");
    expect(temSimboloEntreLetras(normalizarBase("Oi, Maria!Tudo bem?"))).toBe(
      false,
    );
    expect(temSimboloEntreLetras(normalizarBase("Dip!rona"))).toBe(true);
  });

  it("simbolo grudado entre letras", () => {
    expect(temSimboloEntreLetras(normalizarBase("d!p!rona"))).toBe(true);
    expect(temSimboloEntreLetras(normalizarBase("tra\u{1f48a}madol"))).toBe(
      true,
    );
    expect(
      temSimboloEntreLetras(normalizarBase("Ola, Maria! Dr(a). e/ou 10h30min")),
    ).toBe(false);
  });

  it("quatro ou mais letras soltas", () => {
    expect(temLetrasSoltas("e n o r m a l")).toBe(true);
    expect(temLetrasSoltas("a, b, c, d")).toBe(true);
    expect(temLetrasSoltas("a b c")).toBe(false);
    expect(temLetrasSoltas("1, 2, 3 e 4")).toBe(false);
  });
});

describe("sinais de ofuscacao", () => {
  it("aponta letra de outro alfabeto", () => {
    expect(sinaisDeOfuscacao("d\u0456pirona").alfabetoEstranho).toBe(true);
    expect(
      sinaisDeOfuscacao("\u{1d41d}\u{1d422}\u{1d429}").alfabetoEstranho,
    ).toBe(true);
  });

  it("aponta invisivel entre letras", () => {
    expect(sinaisDeOfuscacao("dipi\u200brona").invisivel).toBe(true);
    expect(sinaisDeOfuscacao("dipi\u00adrona").invisivel).toBe(true);
  });

  it("aponta marcas empilhadas", () => {
    expect(sinaisDeOfuscacao("d\u0336i\u0336p").marcasEmpilhadas).toBe(true);
  });

  it("nao acusa texto normal com acento e emoji", () => {
    const sinais = sinaisDeOfuscacao(
      "Olá, Maria! Sua consulta está confirmada \u{1F60A} \u2764\ufe0f \u{1F469}\u200d\u2695\ufe0f",
    );
    expect(sinais).toEqual({
      alfabetoEstranho: false,
      invisivel: false,
      marcasEmpilhadas: false,
    });
  });
});

describe("distancia de edicao", () => {
  it("mede troca, insercao e remocao", () => {
    expect(distanciaDeEdicao("dipirona", "dipirona")).toBe(0);
    expect(distanciaDeEdicao("dypirona", "dipirona")).toBe(1);
    expect(distanciaDeEdicao("paracetamoll", "paracetamol")).toBe(1);
    expect(distanciaDeEdicao("dipiona", "dipirona")).toBe(1);
    expect(distanciaDeEdicao("consulta", "dipirona")).toBeGreaterThan(2);
  });
});
