import { describe, expect, it } from "vitest";

import {
  ehAbaAntigaDoRastreio,
  passosAbertosDeInicio,
  passosDoRastreio,
  prontosDoRastreio,
  type ChaveDoPasso,
  type EstadoDoRastreio,
} from "@/lib/domain/passos-do-rastreio";

const VAZIO: EstadoDoRastreio = {
  meta: {
    temPixel: false,
    temWaba: false,
    temToken: false,
    temModo: false,
    envioLigado: false,
    temContaDeAnuncios: false,
    temTokenDeLeitura: false,
    leituraComProblema: false,
  },
  site: { ligado: false },
  origens: 0,
  conversoes: 0,
};

const TUDO: EstadoDoRastreio = {
  meta: {
    temPixel: true,
    temWaba: true,
    temToken: true,
    temModo: true,
    envioLigado: true,
    temContaDeAnuncios: true,
    temTokenDeLeitura: true,
    leituraComProblema: false,
  },
  site: { ligado: true },
  origens: 4,
  conversoes: 3,
};

/** O passo pela chave: a ordem muda (24/11/2026 ganhou o das conversoes). */
const passo = (estado: EstadoDoRastreio, chave: ChaveDoPasso) =>
  passosDoRastreio(estado).find((p) => p.chave === chave)!;

const situacoes = (estado: EstadoDoRastreio) =>
  Object.fromEntries(
    passosDoRastreio(estado).map((passo) => [passo.chave, passo.situacao]),
  );

describe("passosDoRastreio", () => {
  it("são sete, numerados, na ordem em que a clínica configura", () => {
    const passos = passosDoRastreio(VAZIO);
    expect(passos.map((passo) => [passo.numero, passo.chave])).toEqual([
      [1, "conta"],
      [2, "token"],
      [3, "conversoes"],
      [4, "envio"],
      [5, "investimento"],
      [6, "site"],
      [7, "origens"],
    ]);
    for (const passo of passos) {
      expect(passo.titulo.length).toBeGreaterThan(3);
      // Regra de interface: nenhum travessao.
      expect(`${passo.titulo}${passo.paraQueServe}${passo.detalhe ?? ""}`).not.toMatch(
        /[—–]/,
      );
    }
  });

  it("clínica nova: o que é cadastro falta fazer, o que é chave está desligado", () => {
    expect(situacoes(VAZIO)).toEqual({
      conta: "falta",
      token: "falta",
      conversoes: "falta",
      envio: "desligado",
      investimento: "falta",
      site: "desligado",
      origens: "falta",
    });
    expect(prontosDoRastreio(passosDoRastreio(VAZIO))).toBe(0);
    expect(passo(VAZIO, "envio").detalhe).toBe("Precisa do Pixel e do token.");
    expect(passo(VAZIO, "conversoes").detalhe).toBe(
      "Nenhuma etapa manda conversão.",
    );
  });

  it("tudo configurado: sete prontos, com o rótulo que diz mais", () => {
    const passos = passosDoRastreio(TUDO);
    expect(prontosDoRastreio(passos)).toBe(7);
    expect(passo(TUDO, "conversoes").rotulo).toBe("3 etapas");
    expect(passo({ ...TUDO, conversoes: 1 }, "conversoes").rotulo).toBe("1 etapa");
    expect(passo(TUDO, "envio").rotulo).toBe("Ligado");
    expect(passo(TUDO, "site").rotulo).toBe("Ligado");
    expect(passo(TUDO, "origens").rotulo).toBe("4 origens");
    expect(passo({ ...TUDO, origens: 1 }, "origens").rotulo).toBe("1 origem");
  });

  it("com o Pixel, o token, o modo e uma etapa, o envio desligado diz que está pronto para ligar", () => {
    const comPixelEToken = { ...VAZIO.meta!, temPixel: true, temToken: true };
    const semModo = passo({ ...VAZIO, meta: comPixelEToken, conversoes: 2 }, "envio");
    expect(semModo.situacao).toBe("desligado");
    // Sem o modo a chave fica travada: dizer "pronto para ligar" seria mentira.
    expect(semModo.detalhe).toBe("Falta escolher como enviar os dados.");
    const meta = { ...comPixelEToken, temModo: true };
    expect(passo({ ...VAZIO, meta, conversoes: 2 }, "envio").detalhe).toBe(
      "Pronto para ligar.",
    );
    // Sem etapa nenhuma, ligar nao mandaria nada (24/11/2026).
    expect(passo({ ...VAZIO, meta, conversoes: 0 }, "envio").detalhe).toBe(
      "Antes, escolha as etapas no passo 3.",
    );
  });

  it("envio ligado sem etapa nenhuma não fica pronto: falta, apontando o passo 3", () => {
    const envio = passo({ ...TUDO, conversoes: 0 }, "envio");
    expect(envio.situacao).toBe("falta");
    expect(envio.detalhe).toBe(
      "Está ligado, mas nenhuma etapa manda conversão (passo 3).",
    );
    // Jornada que nao carregou nao acusa falta no envio: nao se sabe.
    expect(passo({ ...TUDO, conversoes: null }, "envio").situacao).toBe("pronto");
  });

  it("pronto só quando funciona: conta sem WhatsApp Business e investimento sem conta ou com problema faltam", () => {
    // Sem a conta do WhatsApp Business, a conversão do anúncio que abre o
    // WhatsApp é descartada (sem_waba_id): o passo não pode ficar verde.
    const semWaba = passo({ ...TUDO, meta: { ...TUDO.meta!, temWaba: false } }, "conta");
    expect(semWaba.situacao).toBe("falta");
    expect(semWaba.detalhe).toBe("Falta a conta do WhatsApp Business.");

    const semConta = passo(
      { ...TUDO, meta: { ...TUDO.meta!, temContaDeAnuncios: false } },
      "investimento",
    );
    expect(semConta.situacao).toBe("falta");
    expect(semConta.detalhe).toBe("Falta a conta de anúncios, no passo 1.");

    const comProblema = passo(
      { ...TUDO, meta: { ...TUDO.meta!, leituraComProblema: true } },
      "investimento",
    );
    expect(comProblema.situacao).toBe("falta");
    expect(comProblema.detalhe).toBe("A leitura está com problema.");
  });

  it("leitura que falhou não vira pronto nem falta: indisponível, só nos passos dela", () => {
    expect(
      situacoes({ meta: null, site: null, origens: null, conversoes: null }),
    ).toEqual({
      conta: "indisponivel",
      token: "indisponivel",
      conversoes: "indisponivel",
      envio: "indisponivel",
      investimento: "indisponivel",
      site: "indisponivel",
      origens: "indisponivel",
    });
    expect(situacoes({ ...TUDO, site: null }).site).toBe("indisponivel");
    expect(situacoes({ ...TUDO, site: null }).conta).toBe("pronto");
    expect(situacoes({ ...TUDO, conversoes: null }).conversoes).toBe(
      "indisponivel",
    );
  });
});

describe("passosAbertosDeInicio", () => {
  it("o endereço manda: ?passo= abre só aquele", () => {
    expect(passosAbertosDeInicio(passosDoRastreio(VAZIO), "site", "rastreio")).toEqual([
      "site",
    ]);
  });

  it("link antigo de aba abre os passos que ela virou", () => {
    const passos = passosDoRastreio(TUDO);
    expect(passosAbertosDeInicio(passos, null, "meta")).toEqual([
      "conta",
      "token",
      "conversoes",
      "envio",
      "investimento",
    ]);
    // A aba "Conversoes" antiga (09/09/2026) cai no passo dela.
    expect(passosAbertosDeInicio(passos, null, "conversoes")).toEqual([
      "conversoes",
    ]);
    expect(passosAbertosDeInicio(passos, null, "google")).toEqual(["site"]);
    expect(passosAbertosDeInicio(passos, null, "origem")).toEqual(["origens"]);
    expect(ehAbaAntigaDoRastreio("meta")).toBe(true);
    expect(ehAbaAntigaDoRastreio("equipe")).toBe(false);
    // Chave de objeto herdada nao e aba.
    expect(ehAbaAntigaDoRastreio("constructor")).toBe(false);
  });

  it("sem pedido no endereço, abre o primeiro que falta fazer; com tudo pronto, nenhum", () => {
    expect(passosAbertosDeInicio(passosDoRastreio(VAZIO), undefined, "rastreio")).toEqual([
      "conta",
    ]);
    expect(
      passosAbertosDeInicio(
        passosDoRastreio({
          ...VAZIO,
          meta: { ...VAZIO.meta!, temPixel: true, temWaba: true },
        }),
        "nao-existe",
        "rastreio",
      ),
    ).toEqual(["token"]);
    expect(passosAbertosDeInicio(passosDoRastreio(TUDO), null, "rastreio")).toEqual([]);
  });
});
