import { describe, expect, it } from "vitest";

import {
  duracaoParaAltura,
  minutoParaY,
  posicionarBlocos,
  yParaMinutos,
} from "@/lib/domain/agenda-layout";

const H = 96; // px por hora (handoff)
const INICIO = new Date("2026-09-01T10:00:00Z"); // inicio visivel do dia

function item(min: number, dur: number) {
  return {
    startsAt: new Date(INICIO.getTime() + min * 60_000),
    endsAt: new Date(INICIO.getTime() + (min + dur) * 60_000),
  };
}

describe("conversões px e minuto", () => {
  it("minuto para y e duração para altura", () => {
    expect(minutoParaY(60, H)).toBe(96);
    expect(minutoParaY(30, H)).toBe(48);
    expect(duracaoParaAltura(item(0, 40).startsAt, item(0, 40).endsAt, H)).toBe(
      64,
    );
  });

  it("y para minutos com snap de 15", () => {
    expect(yParaMinutos(96, H)).toBe(60);
    expect(yParaMinutos(100, H)).toBe(60); // 62,5 min arredonda para 60
    expect(yParaMinutos(112, H)).toBe(75); // 70 min arredonda para 75
    expect(yParaMinutos(50, H, 30)).toBe(30);
  });
});

describe("pistas de sobreposição", () => {
  it("itens sem sobreposição ficam todos na pista única", () => {
    const blocos = posicionarBlocos(
      [item(0, 30), item(30, 30), item(90, 30)],
      INICIO,
      H,
    );
    expect(blocos.every((b) => b.lane === 0 && b.lanes === 1)).toBe(true);
  });

  it("dois sobrepostos dividem em duas pistas", () => {
    const blocos = posicionarBlocos([item(0, 60), item(30, 60)], INICIO, H);
    expect(blocos[0]!.lane).toBe(0);
    expect(blocos[1]!.lane).toBe(1);
    expect(blocos.every((b) => b.lanes === 2)).toBe(true);
  });

  it("fim encostado em início NÃO sobrepõe (range semiaberto)", () => {
    const blocos = posicionarBlocos([item(0, 30), item(30, 30)], INICIO, H);
    expect(blocos.every((b) => b.lanes === 1)).toBe(true);
  });

  it("grupos independentes não contaminam as pistas um do outro", () => {
    const blocos = posicionarBlocos(
      [item(0, 60), item(30, 30), item(120, 30)],
      INICIO,
      H,
    );
    expect(blocos[0]!.lanes).toBe(2);
    expect(blocos[1]!.lanes).toBe(2);
    expect(blocos[2]!.lanes).toBe(1);
    expect(blocos[2]!.lane).toBe(0);
  });

  it("posição vertical acompanha o início visível", () => {
    const [bloco] = posicionarBlocos([item(90, 45)], INICIO, H);
    expect(bloco!.top).toBe(minutoParaY(90, H));
    expect(bloco!.height).toBe(minutoParaY(45, H));
  });
});
