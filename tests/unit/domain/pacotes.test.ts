import { describe, expect, it } from "vitest";

import {
  descontoDoPacote,
  ITENS_POR_PACOTE_MAX,
  precoAvulsoDoPacote,
  problemaNosItens,
  totalDeSessoes,
} from "@/lib/domain/pacotes";

// Pacote com varios procedimentos (pedido do dono em 29/09/2026): o cadastro
// mostra o preco avulso (soma de sessoes x preco base de cada procedimento,
// calculado) ao lado do preco do pacote, para ver o desconto. O exemplo do
// dono: Botox 2 sessoes + Facelift 1 sessao.

const BOTOX = { id: "botox", base_price_cents: 100_000 };
const FACELIFT = { id: "facelift", base_price_cents: 500_000 };
const SEM_PRECO = { id: "avaliacao", base_price_cents: null };
const PROCEDIMENTOS = [BOTOX, FACELIFT, SEM_PRECO];

describe("preço avulso do pacote", () => {
  it("soma sessões x preço base de cada procedimento", () => {
    expect(
      precoAvulsoDoPacote(
        [
          { procedure_id: "botox", sessions: 2 },
          { procedure_id: "facelift", sessions: 1 },
        ],
        PROCEDIMENTOS,
      ),
    ).toEqual({ centavos: 700_000, itensSemPreco: 0 });
  });

  it("procedimento sem preço base não entra na soma e é contado à parte", () => {
    expect(
      precoAvulsoDoPacote(
        [
          { procedure_id: "botox", sessions: 2 },
          { procedure_id: "avaliacao", sessions: 1 },
          { procedure_id: "sumiu", sessions: 3 },
        ],
        PROCEDIMENTOS,
      ),
    ).toEqual({ centavos: 200_000, itensSemPreco: 2 });
  });

  it("preço base zero é preço (R$ 0,00), não ausência", () => {
    expect(
      precoAvulsoDoPacote(
        [{ procedure_id: "gratis", sessions: 4 }],
        [{ id: "gratis", base_price_cents: 0 }],
      ),
    ).toEqual({ centavos: 0, itensSemPreco: 0 });
  });
});

describe("desconto do pacote", () => {
  const avulso = { centavos: 700_000, itensSemPreco: 0 };

  it("desconto em centavos e em fração do avulso", () => {
    expect(descontoDoPacote(560_000, avulso)).toEqual({
      centavos: 140_000,
      fracao: 0.2,
    });
  });

  it("pacote mais caro que o avulso vira desconto negativo, sem esconder", () => {
    expect(descontoDoPacote(770_000, avulso)?.centavos).toBe(-70_000);
  });

  it("avulso incompleto ou zero não tem desconto para mostrar", () => {
    expect(
      descontoDoPacote(100, { centavos: 700_000, itensSemPreco: 1 }),
    ).toBeNull();
    expect(descontoDoPacote(0, { centavos: 0, itensSemPreco: 0 })).toBeNull();
  });
});

describe("itens do pacote antes de gravar", () => {
  it("lista válida passa", () => {
    expect(
      problemaNosItens([
        { procedure_id: "botox", sessions: 2 },
        { procedure_id: "facelift", sessions: 1 },
      ]),
    ).toBeNull();
    expect(totalDeSessoes([{ sessions: 2 }, { sessions: 1 }])).toBe(3);
  });

  it("o mesmo procedimento uma vez só", () => {
    expect(
      problemaNosItens([
        { procedure_id: "botox", sessions: 2 },
        { procedure_id: "botox", sessions: 1 },
      ]),
    ).toBe("O mesmo procedimento aparece duas vezes no pacote.");
  });

  it("sem item, com sessão fora de 1 a 200 ou com itens demais, recusa", () => {
    expect(problemaNosItens([])).toBe(
      "Escolha ao menos um procedimento para o pacote.",
    );
    expect(problemaNosItens([{ procedure_id: "botox", sessions: 0 }])).toMatch(
      /de 1 a 200 sessões/,
    );
    expect(
      problemaNosItens([{ procedure_id: "botox", sessions: 1.5 }]),
    ).not.toBeNull();
    expect(
      problemaNosItens([{ procedure_id: "botox", sessions: 201 }]),
    ).not.toBeNull();
    const demais = Array.from({ length: ITENS_POR_PACOTE_MAX + 1 }, (_, i) => ({
      procedure_id: `p${i}`,
      sessions: 1,
    }));
    expect(problemaNosItens(demais)).toMatch(/no máximo 30/);
  });

  it("as mensagens não têm travessão", () => {
    for (const mensagem of [
      problemaNosItens([]),
      problemaNosItens([{ procedure_id: "x", sessions: 0 }]),
      problemaNosItens([
        { procedure_id: "x", sessions: 1 },
        { procedure_id: "x", sessions: 1 },
      ]),
    ]) {
      expect(mensagem).not.toMatch(/[–—]/);
    }
  });
});
