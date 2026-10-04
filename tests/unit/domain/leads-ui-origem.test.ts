import { describe, expect, it } from "vitest";

import {
  CAMPANHA_PENDENTE,
  CAMPANHA_SEM_ANUNCIO,
  campanhaDoContato,
  CONJUNTO_PENDENTE,
  conjuntoDoContato,
  ehLeadDeAnuncio,
  idDeAnuncioValido,
  LEITURA_SEM_ANUNCIO,
  melhorLeitura,
  METODO_LABELS,
  rotuloDoMetodo,
  textoDaOrigem,
  type AnuncioDaMeta,
  type LeituraDoAnuncio,
  type OrigemDoContato,
} from "@/lib/domain/leads-ui";

// Origem real do anuncio (frente E, 04/10/2026): o texto de origem, a
// campanha, o conjunto e o metodo que a lista e o drawer de Leads, a ficha
// do paciente e o painel do Atendimento mostram. Regras do contrato: a
// campanha do lead de anuncio vem de meta_anuncio pelo source_ad_id (nunca
// de source_campaign, que fica nulo nele), "Campanha {id}" sem nome (a regra
// de Resultados) e "Campanha da Meta ainda não identificada" sem linha.

const AD_ID = "120240624148610289";

const ANUNCIO: AnuncioDaMeta = {
  ad_id: AD_ID,
  campaign_id: "120240624148610001",
  campaign_name: "Botox Fortaleza Setembro",
  adset_id: "120240624148610002",
  adset_name: "Mulheres 30 a 45",
};

const LIDA: LeituraDoAnuncio = { estado: "lida", anuncio: ANUNCIO };
const LIDA_SEM_LINHA: LeituraDoAnuncio = { estado: "lida", anuncio: null };
const ERRO: LeituraDoAnuncio = { estado: "erro" };
const CARREGANDO: LeituraDoAnuncio = { estado: "carregando" };

/** Lead de anuncio como a ingestao (frente D) grava. */
function leadDeAnuncio(campos: Partial<OrigemDoContato> = {}): OrigemDoContato {
  return {
    source_channel: "trafego_pago",
    source_origin: "Meta",
    source_medium: "Instagram",
    source_method: "anuncio_ctwa",
    source_campaign: null,
    source_ad_id: AD_ID,
    ...campos,
  };
}

/** Contato que nao veio de anuncio nenhum. */
function semAnuncio(campos: Partial<OrigemDoContato> = {}): OrigemDoContato {
  return {
    source_channel: null,
    source_origin: null,
    source_medium: null,
    source_method: null,
    source_campaign: null,
    source_ad_id: null,
    ...campos,
  };
}

describe("rotuloDoMetodo", () => {
  it("anuncio_ctwa vira Anúncio de clique para WhatsApp", () => {
    expect(rotuloDoMetodo("anuncio_ctwa")).toBe(
      "Anúncio de clique para WhatsApp",
    );
  });

  it("os seis métodos do check do banco têm rótulo humano, sem chave crua", () => {
    for (const metodo of [
      "anuncio_ctwa",
      "link_token",
      "mensagem_padrao",
      "palavra_chave",
      "manual",
      "importacao",
    ]) {
      const rotulo = rotuloDoMetodo(metodo);
      expect(rotulo).toBe(METODO_LABELS[metodo]);
      expect(rotulo).not.toContain("_");
    }
    expect(rotuloDoMetodo("link_token")).toBe("Link com código");
    expect(rotuloDoMetodo("manual")).toBe("Cadastro manual");
    expect(rotuloDoMetodo("importacao")).toBe("Importação de planilha");
  });

  it("nulo, vazio ou só espaço some; desconhecido volta como veio", () => {
    expect(rotuloDoMetodo(null)).toBeNull();
    expect(rotuloDoMetodo(undefined)).toBeNull();
    expect(rotuloDoMetodo("  ")).toBeNull();
    expect(rotuloDoMetodo("anuncio_google")).toBe("anuncio_google");
  });
});

describe("textoDaOrigem", () => {
  it("com plataforma: Tráfego pago, Meta (Instagram)", () => {
    expect(textoDaOrigem(leadDeAnuncio())).toBe(
      "Tráfego pago, Meta (Instagram)",
    );
    expect(textoDaOrigem(leadDeAnuncio({ source_medium: "Facebook" }))).toBe(
      "Tráfego pago, Meta (Facebook)",
    );
  });

  it("sem plataforma (os 8 corrigidos e o canal oficial): Tráfego pago, Meta", () => {
    expect(textoDaOrigem(leadDeAnuncio({ source_medium: null }))).toBe(
      "Tráfego pago, Meta",
    );
  });

  it("nunca mostra a chave crua do canal", () => {
    const texto = textoDaOrigem(leadDeAnuncio());
    expect(texto).not.toContain("trafego_pago");
  });

  it("só o canal: o rótulo do canal", () => {
    expect(textoDaOrigem(semAnuncio({ source_channel: "indicacao" }))).toBe(
      "Indicação",
    );
  });

  it("origem igual ao canal não repete, sem diferenciar acento nem caixa", () => {
    expect(
      textoDaOrigem(
        semAnuncio({ source_channel: "indicacao", source_origin: "indicacao" }),
      ),
    ).toBe("Indicação");
  });

  it("sem canal, com origem: só a origem (com o meio, se houver)", () => {
    expect(
      textoDaOrigem(
        semAnuncio({ source_origin: "Google", source_medium: "Pesquisa" }),
      ),
    ).toBe("Google (Pesquisa)");
  });

  it("nada preenchido (ou só espaço): null, e a tela diz Não informado", () => {
    expect(textoDaOrigem(semAnuncio())).toBeNull();
    expect(
      textoDaOrigem(semAnuncio({ source_origin: "  ", source_medium: " " })),
    ).toBeNull();
  });

  it("campos ausentes (contato montado sem eles) contam como nulos", () => {
    expect(textoDaOrigem({ source_channel: "trafego_pago" })).toBe(
      "Tráfego pago",
    );
  });

  it("nenhuma combinação produz travessão", () => {
    for (const contato of [
      leadDeAnuncio(),
      leadDeAnuncio({ source_medium: null }),
      semAnuncio({ source_origin: "Google", source_medium: "Pesquisa" }),
    ]) {
      expect(textoDaOrigem(contato)).not.toMatch(/[—–]/);
    }
  });
});

describe("ehLeadDeAnuncio", () => {
  it("método anuncio_ctwa ou id do anúncio gravado", () => {
    expect(ehLeadDeAnuncio(leadDeAnuncio())).toBe(true);
    expect(ehLeadDeAnuncio(leadDeAnuncio({ source_ad_id: null }))).toBe(true);
    // Origem manual que depois clicou num anúncio: conta, como em
    // campanhas_do_periodo.
    expect(
      ehLeadDeAnuncio(
        semAnuncio({ source_method: "manual", source_ad_id: AD_ID }),
      ),
    ).toBe(true);
  });

  it("sem método de anúncio e sem id: não é lead de anúncio", () => {
    expect(ehLeadDeAnuncio(semAnuncio())).toBe(false);
    expect(ehLeadDeAnuncio(semAnuncio({ source_method: "manual" }))).toBe(
      false,
    );
    expect(ehLeadDeAnuncio(semAnuncio({ source_ad_id: "  " }))).toBe(false);
  });
});

describe("idDeAnuncioValido", () => {
  it("só dígitos, de 1 a 32, como o check de meta_anuncio", () => {
    expect(idDeAnuncioValido(AD_ID)).toBe(AD_ID);
    expect(idDeAnuncioValido(` ${AD_ID} `)).toBe(AD_ID);
    expect(idDeAnuncioValido("abc")).toBeNull();
    expect(idDeAnuncioValido("1".repeat(33))).toBeNull();
    expect(idDeAnuncioValido(null)).toBeNull();
    expect(idDeAnuncioValido("")).toBeNull();
  });
});

describe("campanhaDoContato", () => {
  it("lead de anúncio com a linha da Meta: o nome da campanha da Meta", () => {
    expect(campanhaDoContato(leadDeAnuncio(), LIDA)).toEqual({
      texto: "Botox Fortaleza Setembro",
      tipo: "nome",
    });
  });

  it("linha da Meta sem nome: Campanha {id}, a regra de Resultados", () => {
    expect(
      campanhaDoContato(leadDeAnuncio(), {
        estado: "lida",
        anuncio: { ...ANUNCIO, campaign_name: "   " },
      }),
    ).toEqual({ texto: "Campanha 120240624148610001", tipo: "nome" });
  });

  it("lead de anúncio sem linha na Meta: Campanha da Meta ainda não identificada", () => {
    expect(campanhaDoContato(leadDeAnuncio(), LIDA_SEM_LINHA)).toEqual({
      texto: CAMPANHA_PENDENTE,
      tipo: "pendente",
    });
    expect(CAMPANHA_PENDENTE).toBe("Campanha da Meta ainda não identificada");
  });

  it("source_campaign digitado vence o nome da Meta", () => {
    expect(
      campanhaDoContato(
        semAnuncio({
          source_channel: "indicacao",
          source_method: "manual",
          source_campaign: "Indicação da Dra. Ana",
          source_ad_id: AD_ID,
        }),
        LIDA,
      ),
    ).toEqual({ texto: "Indicação da Dra. Ana", tipo: "nome" });
  });

  it("nome amigável do link vence o texto digitado", () => {
    expect(
      campanhaDoContato(
        semAnuncio({ source_campaign: "botox-set" }),
        LEITURA_SEM_ANUNCIO,
        "Botox de setembro",
      ),
    ).toEqual({ texto: "Botox de setembro", tipo: "nome" });
  });

  it("contato que não veio de anúncio e sem campanha: Sem campanha", () => {
    expect(campanhaDoContato(semAnuncio(), LEITURA_SEM_ANUNCIO)).toEqual({
      texto: "Sem campanha",
      tipo: "nenhuma",
    });
  });

  it("anúncio sem id (só o clique): nunca vai ser identificada", () => {
    expect(
      campanhaDoContato(leadDeAnuncio({ source_ad_id: null }), LIDA_SEM_LINHA),
    ).toEqual({ texto: CAMPANHA_SEM_ANUNCIO, tipo: "nenhuma" });
  });

  it("carregando e erro da leitura têm texto próprio, nunca Sem campanha", () => {
    expect(campanhaDoContato(leadDeAnuncio(), CARREGANDO)).toEqual({
      texto: "Carregando a campanha",
      tipo: "carregando",
    });
    expect(campanhaDoContato(leadDeAnuncio(), ERRO)).toEqual({
      texto: "Não foi possível carregar a campanha",
      tipo: "erro",
    });
  });
});

describe("conjuntoDoContato", () => {
  it("contato que não veio de anúncio: a linha some", () => {
    expect(conjuntoDoContato(semAnuncio(), LEITURA_SEM_ANUNCIO)).toBeNull();
  });

  it("com a linha da Meta: o nome do conjunto", () => {
    expect(conjuntoDoContato(leadDeAnuncio(), LIDA)).toEqual({
      texto: "Mulheres 30 a 45",
      tipo: "nome",
    });
  });

  it("linha só do insights (sem nome do conjunto): Conjunto {id}", () => {
    expect(
      conjuntoDoContato(leadDeAnuncio(), {
        estado: "lida",
        anuncio: { ...ANUNCIO, adset_name: null },
      }),
    ).toEqual({ texto: "Conjunto 120240624148610002", tipo: "nome" });
  });

  it("linha sem conjunto nenhum: não informado pela Meta", () => {
    expect(
      conjuntoDoContato(leadDeAnuncio(), {
        estado: "lida",
        anuncio: { ...ANUNCIO, adset_id: null, adset_name: null },
      }),
    ).toEqual({ texto: "Conjunto não informado pela Meta", tipo: "nenhuma" });
  });

  it("sem linha na Meta: ainda não identificado", () => {
    expect(conjuntoDoContato(leadDeAnuncio(), LIDA_SEM_LINHA)).toEqual({
      texto: CONJUNTO_PENDENTE,
      tipo: "pendente",
    });
  });

  it("carregando, erro e anúncio sem id", () => {
    expect(conjuntoDoContato(leadDeAnuncio(), CARREGANDO)?.tipo).toBe(
      "carregando",
    );
    expect(conjuntoDoContato(leadDeAnuncio(), ERRO)).toEqual({
      texto: "Não foi possível carregar o conjunto",
      tipo: "erro",
    });
    expect(
      conjuntoDoContato(leadDeAnuncio({ source_ad_id: null }), LIDA),
    ).toEqual({ texto: "Conjunto não informado", tipo: "nenhuma" });
  });
});

describe("melhorLeitura", () => {
  it("a leitura do detalhe vence a da lista quando foi lida", () => {
    expect(melhorLeitura(LIDA, LIDA_SEM_LINHA)).toBe(LIDA);
  });

  it("detalhe com erro ou carregando não apaga a lista lida", () => {
    expect(melhorLeitura(ERRO, LIDA)).toBe(LIDA);
    expect(melhorLeitura(CARREGANDO, LIDA)).toBe(LIDA);
  });

  it("sem detalhe, a da lista; as duas sem leitura, a do detalhe", () => {
    expect(melhorLeitura(undefined, LIDA)).toBe(LIDA);
    expect(melhorLeitura(null, ERRO)).toBe(ERRO);
    expect(melhorLeitura(CARREGANDO, ERRO)).toBe(CARREGANDO);
  });
});
