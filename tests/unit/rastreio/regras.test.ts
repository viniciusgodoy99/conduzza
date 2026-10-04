import { describe, expect, it } from "vitest";

import {
  extrairToken,
  gerarToken,
  TOKEN_ALPHABET,
} from "@/lib/domain/attribution";
import {
  argumentosDoRegistro,
  CAMINHO_DO_AVISO,
  CAMINHO_DO_SCRIPT,
  contarSinais,
  corpoDoCliqueSchema,
  FORMATO_DO_CODIGO,
  hostDoOrigin,
  LIMITE_DO_CORPO_EM_BYTES,
  lerCorpoDoClique,
  linhaDoScript,
  linkComCodigo,
  resultadoDoRegistro,
  sinaisDaUrl,
  SUFIXO_DE_URL_FINAL,
  TEXTO_SEM_MENSAGEM_PRONTA,
  type CorpoDoClique,
} from "@/lib/domain/rastreio-do-site";

// Regras puras do rastreio do site (F1 do Google). Os formatos sao os da
// migration 20261005100000 (registrar_clique_do_site e CHECKs de
// clique_do_site): o que o Zod deixa passar nunca volta 22023 do banco.

const CHAVE = "0123456789abcdef0123";
const CODIGO = "K7Q2MX";

function corpo(parcial: Partial<CorpoDoClique> = {}): Record<string, unknown> {
  return {
    chave: CHAVE,
    codigo: CODIGO,
    gclid: "EAIaIQobChMI_teste-1",
    ...parcial,
  };
}

describe("formato do codigo", () => {
  it("e o alfabeto e o tamanho do codigo fixo de campaign_link", () => {
    expect(FORMATO_DO_CODIGO.source).toBe(`^[${TOKEN_ALPHABET}]{6}$`);
    for (let i = 0; i < 50; i++) {
      expect(FORMATO_DO_CODIGO.test(gerarToken())).toBe(true);
    }
  });

  it("recusa minuscula e letra ambigua (0, 1, I, L, O)", () => {
    expect(FORMATO_DO_CODIGO.test("k7q2mx")).toBe(false);
    for (const ambiguo of ["K7Q2M0", "K7Q2M1", "K7Q2MI", "K7Q2ML", "K7Q2MO"]) {
      expect(FORMATO_DO_CODIGO.test(ambiguo)).toBe(false);
    }
    expect(FORMATO_DO_CODIGO.test("K7Q2M")).toBe(false);
    expect(FORMATO_DO_CODIGO.test("K7Q2MXX")).toBe(false);
  });
});

describe("sinaisDaUrl", () => {
  it("sem parametro do Google devolve null", () => {
    expect(sinaisDaUrl("")).toBeNull();
    expect(sinaisDaUrl("?utm_source=instagram&fbclid=abc")).toBeNull();
  });

  it("le os 7 parametros", () => {
    expect(
      sinaisDaUrl(
        "?gclid=Cj0K_a-b&gbraid=0AAA&wbraid=CkB1&gad_source=1&gad_campaignid=123&cz_campanha=456&cz_grupo=789",
      ),
    ).toEqual({
      gclid: "Cj0K_a-b",
      gbraid: "0AAA",
      wbraid: "CkB1",
      gad_source: "1",
      gad_campaignid: "123",
      cz_campanha: "456",
      cz_grupo: "789",
    });
  });

  it("descarta so o valor fora do formato, e o resto fica", () => {
    // Performance Max nao tem {adgroupid}: o sufixo chega vazio.
    expect(
      sinaisDaUrl("?gclid=abc&cz_grupo=&cz_campanha={campaignid}"),
    ).toEqual({ gclid: "abc" });
    expect(sinaisDaUrl("?gad_campaignid=12a&gad_source=1")).toEqual({
      gad_source: "1",
    });
  });

  it("todos fora do formato: null", () => {
    expect(sinaisDaUrl("?gclid=&gad_campaignid=abc")).toBeNull();
    expect(sinaisDaUrl(`?gclid=${"a".repeat(513)}`)).toBeNull();
    expect(sinaisDaUrl("?gclid=tem%20espaco")).toBeNull();
  });

  it("iPhone sem gclid fica so com a campanha (e conta como sinal)", () => {
    expect(sinaisDaUrl("?gad_source=1&gad_campaignid=22334455")).toEqual({
      gad_source: "1",
      gad_campaignid: "22334455",
    });
  });
});

describe("corpoDoCliqueSchema", () => {
  it("aceita o corpo que o script manda", () => {
    expect(corpoDoCliqueSchema.safeParse(corpo()).success).toBe(true);
    expect(
      corpoDoCliqueSchema.safeParse({
        chave: CHAVE,
        codigo: CODIGO,
        gad_campaignid: "123",
      }).success,
    ).toBe(true);
  });

  it("campo a mais recusa o corpo inteiro", () => {
    expect(
      corpoDoCliqueSchema.safeParse(corpo({ pagina: "/botox" } as never))
        .success,
    ).toBe(false);
    expect(
      corpoDoCliqueSchema.safeParse(corpo({ ip: "1.2.3.4" } as never)).success,
    ).toBe(false);
  });

  it("sem nenhum sinal do Google recusa", () => {
    expect(
      corpoDoCliqueSchema.safeParse({ chave: CHAVE, codigo: CODIGO }).success,
    ).toBe(false);
  });

  it("formatos iguais aos do banco", () => {
    const recusados: Record<string, unknown>[] = [
      corpo({ chave: "0123456789ABCDEF0123" }),
      corpo({ chave: "0123456789abcdef012" }),
      corpo({ codigo: "k7q2mx" }),
      corpo({ codigo: "K7Q2M0" }),
      corpo({ gclid: "a".repeat(513) }),
      corpo({ gclid: "" }),
      corpo({ gclid: "com espaco" }),
      corpo({ gbraid: "<script>" }),
      corpo({ gad_source: "a".repeat(33) }),
      corpo({ gad_campaignid: "12a" }),
      corpo({ cz_campanha: "1".repeat(21) }),
      corpo({ cz_grupo: "-1" }),
      { ...corpo(), gclid: 123 },
    ];
    for (const recusado of recusados) {
      expect(corpoDoCliqueSchema.safeParse(recusado).success).toBe(false);
    }
    expect(
      corpoDoCliqueSchema.safeParse(
        corpo({ gclid: "a".repeat(512), wbraid: "A-z_0.9~+/=" }),
      ).success,
    ).toBe(true);
  });

  it("o maior corpo valido cabe nos 2 KB", () => {
    const maior = JSON.stringify({
      chave: CHAVE,
      codigo: CODIGO,
      gclid: "a".repeat(512),
      gbraid: "b".repeat(512),
      wbraid: "c".repeat(512),
      gad_source: "d".repeat(32),
      gad_campaignid: "1".repeat(20),
      cz_campanha: "2".repeat(20),
      cz_grupo: "3".repeat(20),
    });
    expect(lerCorpoDoClique(maior).ok).toBe(true);
    expect(Buffer.byteLength(maior, "utf8")).toBeLessThanOrEqual(
      LIMITE_DO_CORPO_EM_BYTES,
    );
  });
});

describe("lerCorpoDoClique", () => {
  it("JSON quebrado, lista e nulo", () => {
    expect(lerCorpoDoClique("{")).toEqual({
      ok: false,
      motivo: "json_invalido",
    });
    expect(lerCorpoDoClique("")).toEqual({
      ok: false,
      motivo: "json_invalido",
    });
    expect(lerCorpoDoClique("[]")).toEqual({
      ok: false,
      motivo: "fora_do_formato",
    });
    expect(lerCorpoDoClique("null")).toEqual({
      ok: false,
      motivo: "fora_do_formato",
    });
  });

  it("corpo valido volta tipado", () => {
    const leitura = lerCorpoDoClique(JSON.stringify(corpo()));
    expect(leitura.ok).toBe(true);
    if (leitura.ok) {
      expect(leitura.corpo.codigo).toBe(CODIGO);
    }
  });
});

describe("contarSinais", () => {
  it("conta os parametros do Google presentes", () => {
    expect(contarSinais({})).toBe(0);
    expect(contarSinais({ gclid: "a", cz_grupo: "1" })).toBe(2);
  });
});

describe("hostDoOrigin", () => {
  it("so o host, em minusculas, sem porta", () => {
    expect(hostDoOrigin("https://Clinica.Exemplo.com.br")).toBe(
      "clinica.exemplo.com.br",
    );
    expect(hostDoOrigin("http://127.0.0.1:3000")).toBe("127.0.0.1");
  });

  it("ausente, 'null', lixo ou IPv6: null", () => {
    expect(hostDoOrigin(null)).toBeNull();
    expect(hostDoOrigin("")).toBeNull();
    expect(hostDoOrigin("null")).toBeNull();
    expect(hostDoOrigin("nao e url")).toBeNull();
    expect(hostDoOrigin("http://[::1]:3000")).toBeNull();
  });
});

describe("argumentosDoRegistro", () => {
  it("campo ausente fica fora do objeto", () => {
    const leitura = lerCorpoDoClique(JSON.stringify(corpo()));
    if (!leitura.ok) throw new Error("corpo do teste invalido");
    expect(argumentosDoRegistro(leitura.corpo, null)).toEqual({
      p_chave: CHAVE,
      p_codigo: CODIGO,
      p_gclid: "EAIaIQobChMI_teste-1",
    });
  });

  it("cz_campanha vence gad_campaignid; grupo vem de cz_grupo; host do Origin", () => {
    const leitura = lerCorpoDoClique(
      JSON.stringify({
        chave: CHAVE,
        codigo: CODIGO,
        gbraid: "0AAA",
        wbraid: "CkB1",
        gad_source: "1",
        gad_campaignid: "111",
        cz_campanha: "222",
        cz_grupo: "333",
      }),
    );
    if (!leitura.ok) throw new Error("corpo do teste invalido");
    expect(
      argumentosDoRegistro(leitura.corpo, "https://www.clinica.com.br"),
    ).toEqual({
      p_chave: CHAVE,
      p_codigo: CODIGO,
      p_gbraid: "0AAA",
      p_wbraid: "CkB1",
      p_gad_source: "1",
      p_google_campaign_id: "222",
      p_google_adgroup_id: "333",
      p_site_host: "www.clinica.com.br",
    });
  });

  it("so gad_campaignid: ele vira a campanha", () => {
    const leitura = lerCorpoDoClique(
      JSON.stringify({ chave: CHAVE, codigo: CODIGO, gad_campaignid: "111" }),
    );
    if (!leitura.ok) throw new Error("corpo do teste invalido");
    expect(argumentosDoRegistro(leitura.corpo, "null")).toEqual({
      p_chave: CHAVE,
      p_codigo: CODIGO,
      p_google_campaign_id: "111",
    });
  });
});

describe("resultadoDoRegistro", () => {
  it("lista fechada; o resto vira desconhecido", () => {
    for (const r of [
      "ok",
      "chave_invalida",
      "desligado",
      "limite",
      "duplicado",
      "codigo_reservado",
    ]) {
      expect(resultadoDoRegistro(r)).toBe(r);
    }
    expect(resultadoDoRegistro("gclid=abc")).toBe("desconhecido");
    expect(resultadoDoRegistro(null)).toBe("desconhecido");
    expect(resultadoDoRegistro({ ok: true })).toBe("desconhecido");
  });
});

describe("linkComCodigo", () => {
  const sufixo = encodeURIComponent(` [#${CODIGO}]`);
  const padrao = encodeURIComponent(
    `${TEXTO_SEM_MENSAGEM_PRONTA} [#${CODIGO}]`,
  );

  it("acrescenta o codigo no fim do texto do wa.me, sem recodificar o texto", () => {
    expect(
      linkComCodigo("https://wa.me/5584999990000?text=Quero%20agendar", CODIGO),
    ).toBe(`https://wa.me/5584999990000?text=Quero%20agendar${sufixo}`);
    // O `+` do site continua `+`: o texto da clinica nao muda.
    expect(
      linkComCodigo("https://wa.me/5584999990000?text=Quero+agendar", CODIGO),
    ).toBe(`https://wa.me/5584999990000?text=Quero+agendar${sufixo}`);
  });

  it("o texto resultante e o do formato de campaign_link e a ingestao le o codigo", () => {
    const href = linkComCodigo(
      "https://wa.me/5584999990000?text=Ol%C3%A1%2C%20quero%20agendar",
      CODIGO,
    );
    const texto = new URL(href ?? "").searchParams.get("text") ?? "";
    expect(texto).toBe(`Olá, quero agendar [#${CODIGO}]`);
    expect(extrairToken(texto)).toBe(CODIGO);
  });

  it("sem texto, ou texto em branco, vai o texto padrao", () => {
    expect(linkComCodigo("https://wa.me/5584999990000", CODIGO)).toBe(
      `https://wa.me/5584999990000?text=${padrao}`,
    );
    expect(linkComCodigo("https://wa.me/5584999990000/", CODIGO)).toBe(
      `https://wa.me/5584999990000/?text=${padrao}`,
    );
    expect(linkComCodigo("https://wa.me/5584999990000?text=", CODIGO)).toBe(
      `https://wa.me/5584999990000?text=${padrao}`,
    );
    expect(linkComCodigo("https://wa.me/5584999990000?text=%20+", CODIGO)).toBe(
      `https://wa.me/5584999990000?text=${padrao}`,
    );
    expect(linkComCodigo("https://wa.me/5584999990000?text", CODIGO)).toBe(
      `https://wa.me/5584999990000?text=${padrao}`,
    );
  });

  it("api.whatsapp.com, web.whatsapp.com e whatsapp://, mantendo os outros parametros e o hash", () => {
    expect(
      linkComCodigo(
        "https://api.whatsapp.com/send?phone=5584999990000&text=Oi&type=phone_number",
        CODIGO,
      ),
    ).toBe(
      `https://api.whatsapp.com/send?phone=5584999990000&text=Oi${sufixo}&type=phone_number`,
    );
    expect(
      linkComCodigo(
        "https://api.whatsapp.com/send/?phone=5584999990000",
        CODIGO,
      ),
    ).toBe(`https://api.whatsapp.com/send/?phone=5584999990000&text=${padrao}`);
    expect(
      linkComCodigo(
        "https://web.whatsapp.com/send?phone=5584999990000&text=Oi#x",
        CODIGO,
      ),
    ).toBe(
      `https://web.whatsapp.com/send?phone=5584999990000&text=Oi${sufixo}#x`,
    );
    expect(linkComCodigo("whatsapp://send?phone=5584999990000", CODIGO)).toBe(
      `whatsapp://send?phone=5584999990000&text=${padrao}`,
    );
    expect(linkComCodigo("//WA.ME/5584999990000?text=Oi", CODIGO)).toBe(
      `//WA.ME/5584999990000?text=Oi${sufixo}`,
    );
    expect(
      linkComCodigo("  https://wa.me/5584999990000?text=Oi \n", CODIGO),
    ).toBe(`https://wa.me/5584999990000?text=Oi${sufixo}`);
  });

  it("texto que ja tem codigo (codigo fixo vence) nao e tocado", () => {
    expect(
      linkComCodigo(
        "https://wa.me/5584999990000?text=Oi%20%5B%23AB2CDE%5D",
        CODIGO,
      ),
    ).toBeNull();
    expect(
      linkComCodigo("https://wa.me/5584999990000?text=Oi+%23ab2cde", CODIGO),
    ).toBeNull();
  });

  it("o que nao e link do WhatsApp com texto editavel nao e tocado", () => {
    for (const href of [
      "/contato",
      "https://clinica.com.br/?wa.me/55",
      "https://wa.me.golpe.com/5584999990000",
      "https://wa.me/message/ABCDEF123",
      "https://wa.link/abc123",
      "https://chat.whatsapp.com/convite",
      "https://api.whatsapp.com/sendx?phone=1",
      "mailto:contato@clinica.com.br",
      "javascript:void(0)",
      "",
    ]) {
      expect(linkComCodigo(href, CODIGO)).toBeNull();
    }
  });

  it("texto mal codificado nao e tocado", () => {
    expect(
      linkComCodigo("https://wa.me/5584999990000?text=%E0%A4%A", CODIGO),
    ).toBeNull();
  });

  it("codigo fora do formato nao entra", () => {
    expect(linkComCodigo("https://wa.me/5584999990000", "k7q2mx")).toBeNull();
  });
});

describe("linhaDoScript e sufixo", () => {
  it("monta a linha que a clinica cola no site", () => {
    expect(linhaDoScript("https://app.conduzza.com.br/", CHAVE)).toBe(
      `<script src="https://app.conduzza.com.br/rastreio/v1.js" data-chave="${CHAVE}" referrerpolicy="no-referrer" async></script>`,
    );
    expect(CAMINHO_DO_SCRIPT).toBe("/rastreio/v1.js");
    expect(CAMINHO_DO_AVISO).toBe("/api/publico/clique");
  });

  it("chave ou endereco fora do formato: null", () => {
    expect(linhaDoScript("https://app.conduzza.com.br", "abc")).toBeNull();
    expect(linhaDoScript("nao e url", CHAVE)).toBeNull();
    expect(linhaDoScript("javascript:alert(1)", CHAVE)).toBeNull();
  });

  it("so https, salvo localhost em desenvolvimento", () => {
    expect(linhaDoScript("http://app.conduzza.com.br", CHAVE)).toBeNull();
    expect(linhaDoScript("http://localhost:3000", CHAVE)).toBe(
      `<script src="http://localhost:3000/rastreio/v1.js" data-chave="${CHAVE}" referrerpolicy="no-referrer" async></script>`,
    );
  });

  it("o sufixo do Google Ads usa os parametros que o script le", () => {
    expect(
      sinaisDaUrl(
        `?${SUFIXO_DE_URL_FINAL.replace("{campaignid}", "1").replace("{adgroupid}", "2")}`,
      ),
    ).toEqual({
      cz_campanha: "1",
      cz_grupo: "2",
    });
  });

  it("texto padrao sem travessao", () => {
    expect(TEXTO_SEM_MENSAGEM_PRONTA).not.toMatch(/[–—]/);
  });
});
