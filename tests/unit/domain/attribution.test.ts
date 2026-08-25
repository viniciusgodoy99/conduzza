import { describe, expect, it } from "vitest";

import {
  atribuirOrigem,
  extrairToken,
  gerarToken,
  montarLinkWhatsApp,
  normalizarTexto,
  TOKEN_ALPHABET,
  TOKEN_LENGTH,
  type CampaignRule,
} from "@/lib/domain/attribution";

// Aceite da 4.2: 3 mecanismos deterministicos, precedencia
// token > mensagem padrao > palavra-chave, nunca chutar "direto".

function regra(parcial: Partial<CampaignRule> & { id: string }): CampaignRule {
  return {
    token: null,
    channel: "trafego_pago",
    origin: null,
    medium: null,
    campaign: null,
    defaultMessage: null,
    keywords: [],
    ...parcial,
  };
}

describe("extrairToken", () => {
  it("acha token no meio do texto, entre colchetes e em minusculo", () => {
    expect(
      extrairToken("Ola! Vim pelo anuncio [#ab2cde] e quero agendar"),
    ).toBe("AB2CDE");
  });

  it("sem token devolve null", () => {
    expect(extrairToken("Quero agendar uma consulta")).toBeNull();
    expect(extrairToken("preco #12 rapido")).toBeNull();
  });
});

describe("atribuirOrigem: token", () => {
  const regras: readonly CampaignRule[] = [
    regra({
      id: "a",
      token: "ab2cde",
      channel: "trafego_pago",
      origin: "meta",
      medium: "cpc",
      campaign: "botox_agosto",
    }),
    regra({ id: "b", token: "XY7WQ2", channel: "redes_sociais" }),
  ];

  it("casa token uppercase dos dois lados e copia os campos da regra", () => {
    const resultado = atribuirOrigem("oi [#Ab2CdE] vim do anuncio", regras);
    expect(resultado).toEqual({
      channel: "trafego_pago",
      origin: "meta",
      medium: "cpc",
      campaign: "botox_agosto",
      method: "link_token",
    });
  });

  it("token que nao existe nas regras cai para os mecanismos seguintes", () => {
    const comKeyword: readonly CampaignRule[] = [
      ...regras,
      regra({ id: "c", channel: "busca_organica", keywords: ["agendar"] }),
    ];
    const resultado = atribuirOrigem("quero agendar [#ZZZZZZ]", comKeyword);
    expect(resultado?.method).toBe("palavra_chave");
    expect(resultado?.channel).toBe("busca_organica");
  });
});

describe("atribuirOrigem: mensagem padrao", () => {
  const regras: readonly CampaignRule[] = [
    regra({
      id: "a",
      channel: "trafego_pago",
      origin: "meta",
      defaultMessage: "Olá! Quero saber mais sobre a promoção de limpeza",
    }),
  ];

  it("casa com acentos, caixa e espacos diferentes", () => {
    const resultado = atribuirOrigem(
      "ola!  quero saber MAIS sobre a promocao de limpeza ",
      regras,
    );
    expect(resultado?.method).toBe("mensagem_padrao");
    expect(resultado?.origin).toBe("meta");
  });

  it("texto editado pelo paciente NAO casa (so igualdade total)", () => {
    expect(
      atribuirOrigem("Olá! Quero saber mais sobre a promoção", regras),
    ).toBeNull();
    expect(
      atribuirOrigem(
        "Oi, olá! Quero saber mais sobre a promoção de limpeza",
        regras,
      ),
    ).toBeNull();
  });

  it("empate entre mensagens iguais fica com a primeira regra", () => {
    const duplicadas: readonly CampaignRule[] = [
      regra({ id: "a", channel: "trafego_pago", defaultMessage: "Oi, preço?" }),
      regra({ id: "b", channel: "redes_sociais", defaultMessage: "oi preco?" }),
    ];
    // Normalizacao nao remove pontuacao: os textos acima diferem na virgula.
    expect(atribuirOrigem("oi, preço?", duplicadas)?.channel).toBe(
      "trafego_pago",
    );
  });
});

describe("atribuirOrigem: palavra-chave", () => {
  it("casa por substring normalizada do corpo", () => {
    const regras = [
      regra({ id: "a", channel: "indicacao", keywords: ["indicação"] }),
    ];
    const resultado = atribuirOrigem(
      "vim por INDICACAO da minha amiga",
      regras,
    );
    expect(resultado?.method).toBe("palavra_chave");
    expect(resultado?.channel).toBe("indicacao");
  });

  it("a keyword casada mais longa vence, mesmo em regra posterior", () => {
    const regras: readonly CampaignRule[] = [
      regra({ id: "a", channel: "busca_organica", keywords: ["botox"] }),
      regra({
        id: "b",
        channel: "trafego_pago",
        keywords: ["botox dia das maes"],
      }),
    ];
    const resultado = atribuirOrigem(
      "vi a promo de botox dia das mães no site",
      regras,
    );
    expect(resultado?.channel).toBe("trafego_pago");
  });

  it("empate de comprimento fica com a primeira regra na ordem dada", () => {
    const regras: readonly CampaignRule[] = [
      regra({ id: "a", channel: "redes_sociais", keywords: ["preço"] }),
      regra({ id: "b", channel: "offline", keywords: ["preco"] }),
    ];
    expect(atribuirOrigem("qual o preço?", regras)?.channel).toBe(
      "redes_sociais",
    );
  });
});

describe("atribuirOrigem: precedencia num corpo que casa os tres", () => {
  const corpo = "Quero saber sobre botox [#AB2CDE]";
  const regraToken = regra({ id: "t", token: "AB2CDE", channel: "trafego_pago" });
  const regraMensagem = regra({
    id: "m",
    channel: "redes_sociais",
    defaultMessage: "quero saber sobre botox [#ab2cde]",
  });
  const regraKeyword = regra({
    id: "k",
    channel: "busca_organica",
    keywords: ["botox"],
  });

  it("token ganha de mensagem padrao e de keyword", () => {
    const resultado = atribuirOrigem(corpo, [
      regraKeyword,
      regraMensagem,
      regraToken,
    ]);
    expect(resultado?.method).toBe("link_token");
    expect(resultado?.channel).toBe("trafego_pago");
  });

  it("sem regra de token, mensagem padrao ganha de keyword", () => {
    const resultado = atribuirOrigem(corpo, [regraKeyword, regraMensagem]);
    expect(resultado?.method).toBe("mensagem_padrao");
    expect(resultado?.channel).toBe("redes_sociais");
  });

  it("so keyword sobrando, keyword atribui", () => {
    const resultado = atribuirOrigem(corpo, [regraKeyword]);
    expect(resultado?.method).toBe("palavra_chave");
    expect(resultado?.channel).toBe("busca_organica");
  });
});

describe("atribuirOrigem: nunca chutar", () => {
  const regras = [regra({ id: "a", channel: "direto", keywords: ["oi"] })];

  it("corpo null devolve null", () => {
    expect(atribuirOrigem(null, regras)).toBeNull();
  });

  it("corpo vazio ou so espacos devolve null", () => {
    expect(atribuirOrigem("", regras)).toBeNull();
    expect(atribuirOrigem("   ", regras)).toBeNull();
  });

  it("sem regras devolve null", () => {
    expect(atribuirOrigem("oi, quero agendar", [])).toBeNull();
  });

  it("nada casou devolve null, nao 'direto'", () => {
    expect(atribuirOrigem("bom dia, tudo bem?", regras)).toBeNull();
  });
});

describe("normalizarTexto", () => {
  it("minusculas, sem acentos, espacos colapsados e trim", () => {
    expect(normalizarTexto("  Promoção   de  LIMPEZA\n hoje ")).toBe(
      "promocao de limpeza hoje",
    );
  });
});

describe("gerarToken", () => {
  it("e deterministico com RNG injetado", () => {
    expect(gerarToken(() => 0)).toBe("222222");
    const fazRng = () => {
      const sequencia = [0, 0.5, 0.999, 0.1, 0.25, 0.75];
      let chamadas = 0;
      return () => sequencia[chamadas++ % sequencia.length] ?? 0;
    };
    const token = gerarToken(fazRng());
    expect(token).toBe("2HZ59S");
    expect(token).toBe(gerarToken(fazRng()));
    expect(token).toHaveLength(TOKEN_LENGTH);
  });

  it("so usa caracteres do alfabeto, mesmo com RNG devolvendo 1", () => {
    const token = gerarToken(() => 1);
    expect(token).toHaveLength(TOKEN_LENGTH);
    for (const char of token) {
      expect(TOKEN_ALPHABET).toContain(char);
    }
  });

  it("com Math.random tem comprimento e alfabeto corretos", () => {
    const token = gerarToken();
    expect(token).toHaveLength(TOKEN_LENGTH);
    for (const char of token) {
      expect(TOKEN_ALPHABET).toContain(char);
    }
  });
});

describe("montarLinkWhatsApp", () => {
  it("remove o + do numero e codifica #, espacos e colchetes", () => {
    const link = montarLinkWhatsApp(
      "+5585999990000",
      "Olá! Quero agendar",
      "AB2CDE",
    );
    expect(link).toBe(
      `https://wa.me/5585999990000?text=${encodeURIComponent(
        "Olá! Quero agendar [#AB2CDE]",
      )}`,
    );
    expect(link).toContain("%23AB2CDE");
    expect(link).toContain("%20");
    expect(link).not.toContain(" ");
  });

  it("o token do link e extraivel de volta pelo extrairToken", () => {
    const mensagem = decodeURIComponent(
      montarLinkWhatsApp("+5511988887777", "Oi", "kmnpqr").split("?text=")[1] ??
        "",
    );
    expect(extrairToken(mensagem)).toBe("KMNPQR");
  });
});
