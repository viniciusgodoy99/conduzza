import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PlayerDeAudio,
  proximaVelocidade,
  rotuloDaVelocidade,
  VELOCIDADES_DO_AUDIO,
} from "@/components/atendimento/media/player-de-audio";

// Velocidade do audio, como no WhatsApp (pedido do dono em 06/10/2026).

describe("velocidade do áudio", () => {
  it("gira 1x, 1,5x, 2x e volta para 1x", () => {
    expect(VELOCIDADES_DO_AUDIO).toEqual([1, 1.5, 2]);
    expect(proximaVelocidade(1)).toBe(1.5);
    expect(proximaVelocidade(1.5)).toBe(2);
    expect(proximaVelocidade(2)).toBe(1);
  });

  it("escreve com a vírgula decimal", () => {
    expect(rotuloDaVelocidade(1)).toBe("1x");
    expect(rotuloDaVelocidade(1.5)).toBe("1,5x");
    expect(rotuloDaVelocidade(2)).toBe("2x");
  });

  it("o player nasce em 1x, com o botão nomeado para o leitor de tela", () => {
    const html = renderToStaticMarkup(<PlayerDeAudio messageId="m1" />);
    expect(html).toContain(
      'aria-label="Velocidade do áudio: 1x. Trocar para 1,5x"',
    );
    expect(html).toContain(">1x<");
  });
});
