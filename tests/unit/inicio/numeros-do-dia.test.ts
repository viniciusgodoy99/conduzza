import { describe, expect, it } from "vitest";

import {
  COMPARADO_COM_O_DIA,
  contarConsultas,
  contarLeads,
  maiorValor,
  rodapeDasConfirmadas,
  rodapeDasUnidades,
  rodapeDoAguardando,
  rotuloDoDia,
  tomDaEtapa,
} from "@/components/inicio/numeros-do-dia";

// Textos dos blocos do Inicio (Fase 3): rodape de unidades so com 2 ou
// mais, taxa das confirmadas com 1 casa e sem taxa quando nao ha consulta,
// "Ultimo disparo" no fuso da CLINICA, rotulo de cada dia com "Hoje"
// escrito, e nenhum travessao em texto de interface.

const FORTALEZA = "America/Fortaleza";
const TRAVESSAO = /[–—]/;

describe("rodapeDasUnidades", () => {
  it("some com 0 ou 1 unidade e aparece com 2 ou mais", () => {
    expect(rodapeDasUnidades(0)).toBeUndefined();
    expect(rodapeDasUnidades(1)).toBeUndefined();
    expect(rodapeDasUnidades(2)).toBe("2 unidades");
    expect(rodapeDasUnidades(1200)).toBe("1.200 unidades");
  });
});

describe("rodapeDasConfirmadas", () => {
  it("diz o percentual com 1 casa", () => {
    expect(rodapeDasConfirmadas(128, 147)).toBe("87,1% do total");
    expect(rodapeDasConfirmadas(0, 10)).toBe("0,0% do total");
    expect(rodapeDasConfirmadas(10, 10)).toBe("100,0% do total");
  });

  it("sem consulta no dia não inventa taxa", () => {
    expect(rodapeDasConfirmadas(0, 0)).toBeUndefined();
  });
});

describe("rodapeDoAguardando", () => {
  it("formata a hora no fuso da clínica, não no do servidor", () => {
    expect(
      rodapeDoAguardando("2026-10-02T12:02:30.123456+00:00", FORTALEZA),
    ).toBe("Último disparo 09:02");
    // 02:30 UTC do dia 03 ainda e 23:30 do dia 02 em Fortaleza.
    expect(rodapeDoAguardando("2026-10-03T02:30:00+00:00", FORTALEZA)).toBe(
      "Último disparo 23:30",
    );
    expect(rodapeDoAguardando("2026-10-02T12:02:30+00:00", "Asia/Tokyo")).toBe(
      "Último disparo 21:02",
    );
  });

  it("sem disparo hoje diz isso", () => {
    expect(rodapeDoAguardando(null, FORTALEZA)).toBe("Nenhum disparo hoje");
  });
});

describe("rotuloDoDia", () => {
  it("nomeia o dia da semana curto e diz a data por extenso", () => {
    expect(rotuloDoDia("2026-09-26", "2026-10-02")).toEqual({
      nome: "Sáb",
      data: "26/09",
      falado: "sábado, 26 de setembro",
      ehHoje: false,
    });
    expect(rotuloDoDia("2026-09-28", "2026-10-02").nome).toBe("Seg");
  });

  it("escreve Hoje no dia de hoje", () => {
    expect(rotuloDoDia("2026-10-02", "2026-10-02")).toEqual({
      nome: "Hoje",
      data: "02/10",
      falado: "hoje, 2 de outubro",
      ehHoje: true,
    });
  });

  it("lê o dia civil sem deslocar: 01/01/2026 é quinta-feira", () => {
    // 01/01 lido ao meio-dia UTC continua sendo quinta-feira, 1 de janeiro.
    expect(rotuloDoDia("2026-01-01", "2026-01-07").falado).toBe(
      "quinta-feira, 1 de janeiro",
    );
  });
});

describe("contagens com singular e plural", () => {
  it("consultas e leads", () => {
    expect(contarConsultas(0)).toBe("0 consultas");
    expect(contarConsultas(1)).toBe("1 consulta");
    expect(contarConsultas(1234)).toBe("1.234 consultas");
    expect(contarLeads(1)).toBe("1 lead");
    expect(contarLeads(38)).toBe("38 leads");
  });
});

describe("tomDaEtapa e maiorValor", () => {
  it("só Perdido fica neutro; a barra mede, não julga", () => {
    expect(tomDaEtapa("entrada")).toBe("destaque");
    expect(tomDaEtapa("agendou")).toBe("destaque");
    expect(tomDaEtapa("compareceu")).toBe("destaque");
    expect(tomDaEtapa(null)).toBe("destaque");
    expect(tomDaEtapa("perdido")).toBe("neutro");
  });

  it("maior valor da lista, 0 na lista vazia", () => {
    expect(maiorValor([3, 9, 1])).toBe(9);
    expect(maiorValor([])).toBe(0);
  });
});

describe("texto de interface", () => {
  it("nenhum travessão", () => {
    const textos = [
      COMPARADO_COM_O_DIA,
      rodapeDasUnidades(3) ?? "",
      rodapeDasConfirmadas(1, 3) ?? "",
      rodapeDoAguardando(null, FORTALEZA),
      rodapeDoAguardando("2026-10-02T12:02:30+00:00", FORTALEZA),
      ...Object.values(rotuloDoDia("2026-09-30", "2026-10-02")).map(String),
      contarConsultas(2),
      contarLeads(2),
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(TRAVESSAO);
    }
  });
});
