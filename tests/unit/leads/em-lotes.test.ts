import { describe, expect, it } from "vitest";

import {
  executarEmLotes,
  LOTE_DE_ACOES,
  mensagemDeFalhaParcial,
} from "@/components/leads/em-lotes";

// Achado 95 da revisao: "Selecionar todos" com mais de 100 leads mandava tudo
// numa chamada so e o Zod da Server Action recusava. A tela agora divide em
// lotes do tamanho do teto, em sequencia, e para no primeiro que falha.

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `id-${i + 1}`);
}

describe("executarEmLotes", () => {
  it("127 selecionados viram 2 chamadas, nenhuma acima do teto", async () => {
    const chamadas: string[][] = [];
    const progresso: number[] = [];
    const resultado = await executarEmLotes(
      ids(127),
      async (lote) => {
        chamadas.push(lote);
        return { ok: true };
      },
      (feitos) => progresso.push(feitos),
    );
    expect(chamadas.map((lote) => lote.length)).toEqual([100, 27]);
    expect(chamadas.every((lote) => lote.length <= LOTE_DE_ACOES)).toBe(true);
    expect(progresso).toEqual([100, 127]);
    expect(resultado).toEqual({
      feitos: ids(127),
      restantes: [],
      erro: null,
    });
  });

  it("para no lote que falhou e devolve o que ficou sem gravar", async () => {
    let chamada = 0;
    const resultado = await executarEmLotes(ids(250), async () => {
      chamada += 1;
      return chamada === 2
        ? { ok: false, error: "Não foi possível mudar a etapa." }
        : { ok: true };
    });
    // O terceiro lote nem e tentado.
    expect(chamada).toBe(2);
    expect(resultado.feitos).toHaveLength(100);
    expect(resultado.restantes).toHaveLength(150);
    expect(resultado.restantes[0]).toBe("id-101");
    expect(resultado.erro).toBe("Não foi possível mudar a etapa.");
  });

  it("excecao da acao conta como falha, sem derrubar a tela", async () => {
    const resultado = await executarEmLotes(ids(3), async () => {
      throw new Error("rede");
    });
    expect(resultado.feitos).toEqual([]);
    expect(resultado.restantes).toEqual(ids(3));
    expect(resultado.erro).not.toBeNull();
  });
});

describe("mensagemDeFalhaParcial", () => {
  it("diz quantos mudaram, quantos nao e o motivo", () => {
    const mensagem = mensagemDeFalhaParcial(
      { feitos: ids(100), restantes: ids(27), erro: "Tente de novo." },
      127,
    );
    expect(mensagem).toBe(
      "100 de 127 leads foram alterados. Os outros 27 continuam como estavam. Tente de novo.",
    );
    // Sem travessao nem meia-risca no texto de interface.
    expect(mensagem).not.toMatch(/[—–]/);
  });

  it("sem nada gravado, volta so o motivo", () => {
    expect(
      mensagemDeFalhaParcial(
        {
          feitos: [],
          restantes: ids(5),
          erro: "Selecione até 100 leads por vez.",
        },
        5,
      ),
    ).toBe("Selecione até 100 leads por vez.");
  });
});
