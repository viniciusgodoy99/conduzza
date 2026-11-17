import { describe, expect, it } from "vitest";

import {
  ehAbaAntigaDoRastreio,
  passosAbertosDeInicio,
  passosDoRastreio,
  prontosDoRastreio,
  type EstadoDoRastreio,
} from "@/lib/domain/passos-do-rastreio";

const VAZIO: EstadoDoRastreio = {
  meta: {
    temPixel: false,
    temToken: false,
    envioLigado: false,
    temTokenDeLeitura: false,
  },
  site: { ligado: false },
  origens: 0,
};

const TUDO: EstadoDoRastreio = {
  meta: {
    temPixel: true,
    temToken: true,
    envioLigado: true,
    temTokenDeLeitura: true,
  },
  site: { ligado: true },
  origens: 4,
};

const situacoes = (estado: EstadoDoRastreio) =>
  Object.fromEntries(
    passosDoRastreio(estado).map((passo) => [passo.chave, passo.situacao]),
  );

describe("passosDoRastreio", () => {
  it("são seis, numerados, na ordem em que a clínica configura", () => {
    const passos = passosDoRastreio(VAZIO);
    expect(passos.map((passo) => [passo.numero, passo.chave])).toEqual([
      [1, "conta"],
      [2, "token"],
      [3, "envio"],
      [4, "investimento"],
      [5, "site"],
      [6, "origens"],
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
      envio: "desligado",
      investimento: "falta",
      site: "desligado",
      origens: "falta",
    });
    expect(prontosDoRastreio(passosDoRastreio(VAZIO))).toBe(0);
    const envio = passosDoRastreio(VAZIO)[2]!;
    expect(envio.detalhe).toBe("Precisa do Pixel e do token.");
  });

  it("tudo configurado: seis prontos, com o rótulo que diz mais", () => {
    const passos = passosDoRastreio(TUDO);
    expect(prontosDoRastreio(passos)).toBe(6);
    expect(passos[2]!.rotulo).toBe("Ligado");
    expect(passos[4]!.rotulo).toBe("Ligado");
    expect(passos[5]!.rotulo).toBe("4 origens");
    expect(passosDoRastreio({ ...TUDO, origens: 1 })[5]!.rotulo).toBe("1 origem");
  });

  it("com o Pixel e o token, o envio desligado diz que está pronto para ligar", () => {
    const passos = passosDoRastreio({
      ...VAZIO,
      meta: { ...VAZIO.meta!, temPixel: true, temToken: true },
    });
    expect(passos[2]!.situacao).toBe("desligado");
    expect(passos[2]!.detalhe).toBe("Pronto para ligar.");
  });

  it("leitura que falhou não vira pronto nem falta: indisponível, só nos passos dela", () => {
    expect(situacoes({ meta: null, site: null, origens: null })).toEqual({
      conta: "indisponivel",
      token: "indisponivel",
      envio: "indisponivel",
      investimento: "indisponivel",
      site: "indisponivel",
      origens: "indisponivel",
    });
    expect(situacoes({ ...TUDO, site: null }).site).toBe("indisponivel");
    expect(situacoes({ ...TUDO, site: null }).conta).toBe("pronto");
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
      "envio",
      "investimento",
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
        passosDoRastreio({ ...VAZIO, meta: { ...VAZIO.meta!, temPixel: true } }),
        "nao-existe",
        "rastreio",
      ),
    ).toEqual(["token"]);
    expect(passosAbertosDeInicio(passosDoRastreio(TUDO), null, "rastreio")).toEqual([]);
  });
});
