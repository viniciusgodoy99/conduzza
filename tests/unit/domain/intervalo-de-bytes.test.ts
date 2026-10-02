import { describe, expect, it } from "vitest";

import {
  TETO_DO_PEDACO,
  cabecalhoRange,
  intervaloPedido,
} from "@/lib/domain/intervalo-de-bytes";

// A rota de midia entrega o audio em pedacos de no maximo 1 MiB, pedindo ao
// Storage so o intervalo que o navegador quer (corrigido em 02/10/2026: o
// link assinado de 5 minutos expirava e o audio parava no que ja tinha
// carregado).

describe("intervaloPedido", () => {
  it("'bytes=0-' do Chrome vira o primeiro pedaço, cortado no teto", () => {
    expect(intervaloPedido("bytes=0-")).toEqual({
      inicio: 0,
      fim: TETO_DO_PEDACO - 1,
    });
  });

  it("continuação no meio do arquivo também respeita o teto", () => {
    expect(intervaloPedido("bytes=32768-")).toEqual({
      inicio: 32768,
      fim: 32768 + TETO_DO_PEDACO - 1,
    });
  });

  it("intervalo fechado menor que o teto passa como veio (Safari: 'bytes=0-1')", () => {
    expect(intervaloPedido("bytes=0-1")).toEqual({ inicio: 0, fim: 1 });
    expect(intervaloPedido("bytes=100-199")).toEqual({ inicio: 100, fim: 199 });
  });

  it("intervalo fechado maior que o teto é cortado", () => {
    expect(intervaloPedido("bytes=0-479999", 1000)).toEqual({
      inicio: 0,
      fim: 999,
    });
  });

  it("sem Range ou formato que a rota não atende: null (repassa sem intervalo)", () => {
    expect(intervaloPedido(null)).toBeNull();
    expect(intervaloPedido("")).toBeNull();
    expect(intervaloPedido("bytes=-500")).toBeNull();
    expect(intervaloPedido("bytes=0-10,20-30")).toBeNull();
    expect(intervaloPedido("items=0-10")).toBeNull();
    expect(intervaloPedido("bytes=50-10")).toBeNull();
  });

  it("cabecalhoRange monta o pedido ao Storage", () => {
    expect(cabecalhoRange({ inicio: 0, fim: 1023 })).toBe("bytes=0-1023");
    expect(cabecalhoRange({ inicio: 5, fim: null })).toBe("bytes=5-");
  });
});
