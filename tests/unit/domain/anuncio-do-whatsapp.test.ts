import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  apararIdDoAnuncio,
  CARACTERES_POR_LINHA_DA_DESCRICAO,
  cortarSemPartir,
  descricaoPareceLonga,
  detalhesParaMostrar,
  idDoAnuncioDoWhatsapp,
  idEntreParenteses,
  LIMITE_DA_DESCRICAO_DO_ANUNCIO,
  LIMITE_DO_LINK_DO_ANUNCIO,
  LIMITE_DO_TITULO_DO_ANUNCIO,
  rotuloDoAnuncio,
  sanearDescricaoDoAnuncio,
  sanearLinkDoAnuncio,
  sanearTituloDoAnuncio,
  TEXTO_ERRO_DOS_DETALHES_DO_ANUNCIO,
  TEXTO_SEM_DETALHES_DO_ANUNCIO,
  TITULO_DO_BLOCO_DO_ANUNCIO,
} from "@/lib/domain/anuncio-do-whatsapp";

// Regras puras dos detalhes do anuncio (pedido do dono em 20/10/2026): o
// saneamento que o parser aplica antes de gravar (e que os CHECKs da tabela
// anuncio_do_whatsapp garantem no banco), a conferencia do link que a tela
// repete e o rotulo da dimensao Anuncio em Resultados.

const MIGRATION = readFileSync(
  path.resolve(
    __dirname,
    "../../../supabase/migrations/20261020100000_anuncio_do_whatsapp.sql",
  ),
  "utf8",
);

// Os dois anuncios reais da primeira clinica (Salud Care, 20/10/2026): os
// dois terminam em 10289.
const ANUNCIO_REAL_1 = "120240624148610289";
const ANUNCIO_REAL_2 = "120248355615910289";

const EMOJI = "\u{1f469}\u{200d}\u{2695}\u{fe0f}"; // 4 pontos de codigo

describe("limites (os mesmos dos CHECKs da migration 20261020100000)", () => {
  it("300 no título, 2.000 na descrição e no link", () => {
    expect(LIMITE_DO_TITULO_DO_ANUNCIO).toBe(300);
    expect(LIMITE_DA_DESCRICAO_DO_ANUNCIO).toBe(2000);
    expect(LIMITE_DO_LINK_DO_ANUNCIO).toBe(2000);
  });
});

describe("sanearTituloDoAnuncio", () => {
  it("uma linha só: quebra, tabulação e controle viram espaço, espaços seguidos viram um", () => {
    expect(sanearTituloDoAnuncio("  Limpeza\r\nde\tpele\u{0007}hoje  ")).toBe(
      "Limpeza de pele hoje",
    );
    expect(sanearTituloDoAnuncio("a\u{0085}b\u{009f}c")).toBe("a b c");
    expect(sanearTituloDoAnuncio("a\u{2028}b")).toBe("a b");
  });

  it("tira as marcas de direção de texto e o par substituto solto, mas não o ZWJ do emoji", () => {
    expect(sanearTituloDoAnuncio("laudo\u{202e}fdp.exe")).toBe("laudofdp.exe");
    expect(
      sanearTituloDoAnuncio(
        "\u{200e}a\u{200f}b\u{061c}c\u{2066}d\u{2069}e\u{202a}f",
      ),
    ).toBe("abcdef");
    expect(sanearTituloDoAnuncio("a\u{d83d}b")).toBe("ab");
    expect(sanearTituloDoAnuncio(`Doutora ${EMOJI} atende`)).toBe(
      `Doutora ${EMOJI} atende`,
    );
  });

  it("vazio, só espaço ou não texto vira null", () => {
    expect(sanearTituloDoAnuncio("")).toBeNull();
    expect(sanearTituloDoAnuncio(" \n\t ")).toBeNull();
    expect(sanearTituloDoAnuncio(null)).toBeNull();
    expect(sanearTituloDoAnuncio(42)).toBeNull();
    expect(sanearTituloDoAnuncio({ texto: "x" })).toBeNull();
  });

  it("corta em 300 sem partir o emoji e sem espaço na ponta", () => {
    expect(sanearTituloDoAnuncio("t".repeat(301))).toBe("t".repeat(300));
    expect(sanearTituloDoAnuncio(`${"a".repeat(298)}${EMOJI}b`)).toBe(
      "a".repeat(298),
    );
    expect(sanearTituloDoAnuncio(`${"a".repeat(296)}${EMOJI}b`)).toBe(
      `${"a".repeat(296)}${EMOJI}`,
    );
    expect(sanearTituloDoAnuncio(`${"a".repeat(299)} b`)).toBe("a".repeat(299));
  });
});

describe("sanearDescricaoDoAnuncio", () => {
  it("NEL vira quebra de linha; VT e FF viram espaço (nunca colam as palavras)", () => {
    expect(sanearDescricaoDoAnuncio("L5\u{0085}L6\u{000B}L7\u{000C}L8")).toBe(
      "L5\nL6 L7 L8",
    );
    // O mesmo controle no título vira espaço, como sempre.
    expect(sanearTituloDoAnuncio("A\u{0085}B\u{000B}C\u{000C}D")).toBe(
      "A B C D",
    );
  });

  it("mantém a quebra de linha (CRLF e CR viram LF) e tira os outros controles", () => {
    expect(
      sanearDescricaoDoAnuncio(
        "Linha 1\r\nLinha 2\rLinha 3\u{2029}Linha 4\tfim\u{0000}\u{001b}!",
      ),
    ).toBe("Linha 1\nLinha 2\nLinha 3\nLinha 4 fim!");
  });

  it("três ou mais quebras seguidas viram duas; espaço antes da quebra e nas pontas sai", () => {
    expect(sanearDescricaoDoAnuncio("\n\n  a  \n\n\n\n\nb \u{a0}\n  ")).toBe(
      "a\n\nb",
    );
  });

  it("corta em 2.000", () => {
    const cortada = sanearDescricaoDoAnuncio(
      `${"d".repeat(1999)}\n${"e".repeat(10)}`,
    );
    expect(cortada).toBe("d".repeat(1999));
    expect(
      Array.from(sanearDescricaoDoAnuncio("x".repeat(5000)) ?? ""),
    ).toHaveLength(2000);
  });

  it("vazio ou não texto vira null", () => {
    expect(sanearDescricaoDoAnuncio("\r\n\r\n")).toBeNull();
    expect(sanearDescricaoDoAnuncio(undefined)).toBeNull();
  });
});

describe("sanearLinkDoAnuncio", () => {
  it("aceita https onde o anúncio vive (host exato), normalizado", () => {
    expect(sanearLinkDoAnuncio("https://fb.me/abcXYZ")).toBe(
      "https://fb.me/abcXYZ",
    );
    expect(sanearLinkDoAnuncio("  https://FB.ME/Caminho  ")).toBe(
      "https://fb.me/Caminho",
    );
    expect(sanearLinkDoAnuncio("https://www.instagram.com/p/abc/")).toBe(
      "https://www.instagram.com/p/abc/",
    );
    for (const link of [
      "https://fb.watch/abc123/",
      "https://facebook.com/reel/123",
      "https://www.facebook.com/clinica/posts/123",
      "https://m.facebook.com/story.php?story_fbid=1&id=2",
      "https://web.facebook.com/clinica/posts/123",
      "https://business.facebook.com/clinica/posts/123",
      "https://instagram.com/reel/abc/",
      "https://www.instagram.com/stories/clinica/123/",
      "https://www.instagram.com/p/abc/?igsh=MTIz&utm_source=ig_web_copy_link",
      "https://WWW.FACEBOOK.COM:443/clinica/posts/1",
    ]) {
      expect(sanearLinkDoAnuncio(link), link).not.toBeNull();
    }
  });

  it("recusa os redirecionadores, mesmo num endereço aceito", () => {
    for (const link of [
      "https://l.facebook.com/l.php?u=x",
      "https://l.facebook.com/l.php?u=https%3A%2F%2Fgolpe.example%2F",
      "https://lm.facebook.com/l.php?u=https%3A%2F%2Fgolpe.example%2F",
      "https://l.instagram.com/?u=https%3A%2F%2Fgolpe.example%2F",
      "https://l.messenger.com/l.php?u=x",
      "https://www.facebook.com/l.php?u=https%3A%2F%2Fgolpe.example%2F",
      "https://m.facebook.com/l.php?u=https%3A%2F%2Fgolpe.example%2F",
      "https://www.facebook.com/L.PHP?u=x",
      "https://www.facebook.com/l%2Ephp?u=x",
      "https://www.facebook.com/l.php",
      "https://www.facebook.com/flx/warn/?u=https%3A%2F%2Fgolpe.example%2F",
      "https://www.instagram.com/p/abc/?u=https%3A%2F%2Fgolpe.example%2F",
    ]) {
      expect(sanearLinkDoAnuncio(link), link).toBeNull();
    }
  });

  it("recusa grupo, conversa e os outros endereços da Meta (não abrem o anúncio)", () => {
    for (const link of [
      "https://chat.whatsapp.com/ConviteDeGrupo123",
      "https://wa.me/5584999990000",
      "https://wa.me/5584999990000?text=Pague%20o%20sinal",
      "https://api.whatsapp.com/send?phone=5584999990000",
      "https://www.whatsapp.com/",
      "https://m.me/golpista",
      "https://ig.me/m/golpista",
      "https://messenger.com/t/golpista",
      "https://www.messenger.com/t/golpista",
      "https://fb.com/clinica",
      "https://instagr.am/p/abc/",
      "https://threads.net/@clinica",
      "https://www.meta.com/",
      "https://qualquer.facebook.com/x",
      "https://www.fb.me/abc",
      "https://facebook.com./x",
    ]) {
      expect(sanearLinkDoAnuncio(link), link).toBeNull();
    }
  });

  it("recusa outro protocolo, outro endereço, usuário e senha, porta, espaço e controle", () => {
    for (const link of [
      "http://fb.me/abc",
      "javascript:alert(1)",
      "data:text/html,oi",
      "https://golpe.example.com/fb.me",
      "https://facebook.com.golpe.example/",
      "https://fakefacebook.com/",
      "https://usuario:senha@facebook.com/x",
      "https://facebook.com:8443/x",
      "https://fb.me/a b",
      "https://fb.me/a\u{0000}b",
      "fb.me/abc",
      "",
    ]) {
      expect(sanearLinkDoAnuncio(link)).toBeNull();
    }
    expect(sanearLinkDoAnuncio(null)).toBeNull();
  });

  it("até 2.000 caracteres", () => {
    expect(
      sanearLinkDoAnuncio(`https://fb.me/${"a".repeat(1986)}`),
    ).toHaveLength(2000);
    expect(sanearLinkDoAnuncio(`https://fb.me/${"a".repeat(1987)}`)).toBeNull();
  });
});

describe("cortarSemPartir", () => {
  it("devolve o texto quando cabe e null quando vazio", () => {
    expect(cortarSemPartir("abc", 3)).toBe("abc");
    expect(cortarSemPartir("", 3)).toBeNull();
  });

  it("conta pontos de código, como o char_length do banco", () => {
    expect(cortarSemPartir(`ab${EMOJI}`, 6)).toBe(`ab${EMOJI}`);
    expect(cortarSemPartir(`ab${EMOJI}`, 5)).toBe("ab");
  });
});

describe("idDoAnuncioDoWhatsapp", () => {
  it("só dígitos, de 1 a 32, aparado", () => {
    expect(idDoAnuncioDoWhatsapp(" 120240624148610289 ")).toBe(
      "120240624148610289",
    );
    expect(idDoAnuncioDoWhatsapp("abc")).toBeNull();
    expect(idDoAnuncioDoWhatsapp("1".repeat(33))).toBeNull();
    expect(idDoAnuncioDoWhatsapp(null)).toBeNull();
  });
});

describe("apararIdDoAnuncio: a mesma regra no contato, na gravação e em Resultados", () => {
  it("tira espaço Unicode, tabulação, quebra, NBSP e BOM das pontas", () => {
    expect(apararIdDoAnuncio("\u{a0}120240624148610289\t")).toBe(
      "120240624148610289",
    );
    expect(apararIdDoAnuncio("\u{feff}\u{3000}120240624148610289\u{2028}")).toBe(
      "120240624148610289",
    );
    expect(apararIdDoAnuncio(" \u{a0} ")).toBeNull();
    expect(apararIdDoAnuncio(null)).toBeNull();
  });

  it("anuncios_do_periodo apara com a MESMA lista de caracteres do JavaScript", () => {
    // Todo ponto de código que o trim do JavaScript tira.
    const doJs: number[] = [];
    for (let codigo = 0; codigo <= 0x10ffff; codigo++) {
      if (codigo >= 0xd800 && codigo <= 0xdfff) continue;
      if (String.fromCodePoint(codigo).trim() === "") doJs.push(codigo);
    }
    // A lista do btrim da migration (E'\\uXXXX...').
    const lista = /btrim\(c\.source_ad_id, E'((?:\\u[0-9a-f]{4})+)'\)/.exec(
      MIGRATION,
    )?.[1];
    expect(lista).toBeTruthy();
    const doBanco = [...(lista ?? "").matchAll(/\\u([0-9a-f]{4})/g)].map(
      (m) => Number.parseInt(m[1]!, 16),
    );
    expect(doBanco).toEqual(doJs);
  });
});

describe("detalhesParaMostrar", () => {
  it("só o que tem texto, e o link só se passar na conferência", () => {
    expect(
      detalhesParaMostrar({
        ad_id: "1",
        titulo: "Título",
        descricao: " ",
        link: "https://golpe.example.com/",
      }),
    ).toEqual({ titulo: "Título", descricao: null, link: null });
    expect(
      detalhesParaMostrar({
        ad_id: "1",
        titulo: null,
        descricao: null,
        link: "https://fb.me/x",
      }),
    ).toEqual({ titulo: null, descricao: null, link: "https://fb.me/x" });
  });

  it("nada para mostrar (ou nenhuma linha): null", () => {
    expect(detalhesParaMostrar(null)).toBeNull();
    expect(
      detalhesParaMostrar({
        ad_id: "1",
        titulo: null,
        descricao: null,
        link: "http://fb.me/x",
      }),
    ).toBeNull();
  });
});

describe("descricaoPareceLonga (estimativa antes de medir, pela largura da tela)", () => {
  it("passa de 3 linhas na largura da tela; cada parágrafo ocupa ao menos uma", () => {
    expect(descricaoPareceLonga("a".repeat(120), 40)).toBe(false);
    expect(descricaoPareceLonga("a".repeat(121), 40)).toBe(true);
    expect(descricaoPareceLonga("a\nb\nc", 40)).toBe(false);
    expect(descricaoPareceLonga("a\nb\nc\nd", 40)).toBe(true);
    // Um parágrafo de 2 linhas e mais dois curtos: 4 linhas.
    expect(descricaoPareceLonga(`${"a".repeat(60)}\nb\nc`, 40)).toBe(true);
  });

  it("a ficha (cartão de 380px) cabe mais por linha que o painel", () => {
    // O caso da revisão: cerca de 125 caracteres num parágrafo cabem em 3
    // linhas na ficha; o "Ver mais" do HTML do servidor sumia na hidratação.
    const media =
      "Agende sua avaliação gratuita com a nossa equipe de dermatologia. Vagas limitadas para outubro, com condições especiais.";
    expect(
      descricaoPareceLonga(media, CARACTERES_POR_LINHA_DA_DESCRICAO.ficha),
    ).toBe(false);
    expect(
      CARACTERES_POR_LINHA_DA_DESCRICAO.ficha,
    ).toBeGreaterThan(CARACTERES_POR_LINHA_DA_DESCRICAO.painel);
    expect(
      CARACTERES_POR_LINHA_DA_DESCRICAO.gaveta,
    ).toBeGreaterThan(CARACTERES_POR_LINHA_DA_DESCRICAO.ficha);
  });
});

describe("rótulo do anúncio em Resultados", () => {
  it("o título; senão o nome na Meta; senão o id inteiro", () => {
    expect(
      rotuloDoAnuncio({
        adId: "120240624148610289",
        titulo: "Botox",
        nomeNaMeta: "Nome Meta",
      }),
    ).toBe("Botox");
    expect(
      rotuloDoAnuncio({
        adId: "120240624148610289",
        titulo: "  ",
        nomeNaMeta: "Nome Meta",
      }),
    ).toBe("Nome Meta");
    expect(
      rotuloDoAnuncio({
        adId: "120240624148610289",
        titulo: null,
        nomeNaMeta: null,
      }),
    ).toBe("Anúncio sem título (id 120240624148610289)");
    expect(idEntreParenteses("12")).toBe("(id 12)");
  });

  it("os dois anúncios reais (os dois terminam em 10289) têm rótulos diferentes, achaveis no Gerenciador", () => {
    const primeiro = rotuloDoAnuncio({
      adId: ANUNCIO_REAL_1,
      titulo: null,
      nomeNaMeta: null,
    });
    const segundo = rotuloDoAnuncio({
      adId: ANUNCIO_REAL_2,
      titulo: null,
      nomeNaMeta: null,
    });
    expect(primeiro).toBe("Anúncio sem título (id 120240624148610289)");
    expect(segundo).toBe("Anúncio sem título (id 120248355615910289)");
    expect(primeiro).not.toBe(segundo);
  });
});

describe("CHECKs da migration e o saneamento", () => {
  // A classe do CHECK do título, no dialeto do Postgres (\\xHHHH), lida na
  // migration e convertida para o JavaScript.
  function classeDoCheck(coluna: "titulo" | "descricao"): RegExp {
    const trecho = new RegExp(`and ${coluna} !~ '(\\[[^']+\\])'`).exec(
      MIGRATION,
    )?.[1];
    expect(trecho).toBeTruthy();
    return new RegExp(
      (trecho ?? "").replace(/\\x([0-9a-fA-F]+)/g, "\\u{$1}"),
      "u",
    );
  }

  it("o CHECK do título recusa U+2028 e U+2029, além da quebra e da marca de direção", () => {
    const proibido = classeDoCheck("titulo");
    expect(proibido.test("a\u{2028}b")).toBe(true);
    expect(proibido.test("a\u{2029}b")).toBe(true);
    expect(proibido.test("a\nb")).toBe(true);
    expect(proibido.test("a\u{202e}b")).toBe(true);
    expect(proibido.test("Limpeza de pele com 30% de desconto")).toBe(false);
    // O que o saneador entrega nunca bate no CHECK.
    expect(
      proibido.test(
        sanearTituloDoAnuncio("A\u{2028}B\u{2029}C\u{0085}D\nE") ?? "",
      ),
    ).toBe(false);
  });

  it("o CHECK da descrição aceita a quebra e recusa NEL, VT e FF, que o saneador converte", () => {
    const proibido = classeDoCheck("descricao");
    expect(proibido.test("a\nb")).toBe(false);
    for (const controle of ["\u{0085}", "\u{000B}", "\u{000C}"]) {
      expect(proibido.test(`a${controle}b`)).toBe(true);
    }
    expect(
      proibido.test(
        sanearDescricaoDoAnuncio("L5\u{0085}L6\u{000B}L7\u{000C}L8") ?? "",
      ),
    ).toBe(false);
  });

  it("os tetos do CHECK são os do código", () => {
    expect(MIGRATION).toContain(
      `char_length(titulo) between 1 and ${LIMITE_DO_TITULO_DO_ANUNCIO}`,
    );
    expect(MIGRATION).toContain(
      `char_length(descricao) between 1 and ${LIMITE_DA_DESCRICAO_DO_ANUNCIO}`,
    );
    expect(MIGRATION).toContain(
      `char_length(link) <= ${LIMITE_DO_LINK_DO_ANUNCIO}`,
    );
  });
});

describe("textos da tela", () => {
  it("sem travessão nem meia-risca", () => {
    for (const texto of [
      TITULO_DO_BLOCO_DO_ANUNCIO,
      TEXTO_SEM_DETALHES_DO_ANUNCIO,
      TEXTO_ERRO_DOS_DETALHES_DO_ANUNCIO,
      rotuloDoAnuncio({ adId: "9", titulo: null, nomeNaMeta: null }),
    ]) {
      expect(texto).not.toMatch(/[\u{2013}\u{2014}]/u);
    }
    // Frase neutra: a tela não sabe por que os detalhes faltam.
    expect(TEXTO_SEM_DETALHES_DO_ANUNCIO).toBe(
      "Os detalhes deste anúncio ainda não estão disponíveis.",
    );
  });
});
